// Nhóm route PHÂN CA — theo ngày (lịch tuần), theo khoảng ngày (shift_assignments) và phân ca bằng Excel.
import ExcelJS from 'exceljs';
import { db, adminAttWhere, getSetting } from '../../db.js';
import { resolveShift, schedDay } from '../../shift-resolver.js';
import { vnWeekday } from '../../attendance-calc.js';
import { sendCaughtError } from '../../util.js';
import { rebuildDays } from '../../device-sync.js';

// Đổi phân ca theo NGÀY xong → tính lại công ngay các ngày đó (ngày đã có giờ chấm từ máy), khỏi phải bấm "Tính lại công".
// keys: tập 'empId|YYYY-MM-DD'. Ngày kế tiếp cũng được tính lại (ca đêm lấy giờ ra sáng hôm sau).
function recalcDays(keys) {
  const has = db.prepare('SELECT 1 FROM device_punches WHERE employee_id = ? AND work_date IN (?, ?) LIMIT 1');
  const list = [...keys].filter((k) => {
    const [e, d] = k.split('|'); const nx = new Date(d + 'T12:00:00Z'); nx.setUTCDate(nx.getUTCDate() + 1);
    return has.get(+e, d, nx.toISOString().slice(0, 10));
  });
  if (!list.length) return 0;
  db.exec('BEGIN');
  try { rebuildDays(list); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); console.error('[phân ca] tính lại công lỗi:', e.message); return 0; }
  return list.length;
}

const WDVN = { 1: 'T2', 2: 'T3', 3: 'T4', 4: 'T5', 5: 'T6', 6: 'T7', 7: 'CN' };
function monthDaysList(month) {
  const [y, m] = month.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}
// Danh sách ngày [from, to] (tối đa 93 ngày)
function rangeDaysList(from, to) {
  const out = [];
  for (let d = new Date(from + 'T12:00:00Z'); d <= new Date(to + 'T12:00:00Z') && out.length < 93; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}
const isYmd = (x) => /^\d{4}-\d{2}-\d{2}$/.test(String(x || ''));
const vnWd = (d) => { const dow = new Date(d + 'T12:00:00Z').getUTCDay(); return dow === 0 ? 7 : dow; };

// Bộ đọc giá trị 1 Ô phân ca (dùng chung cho Nhập Excel và Bảng phân ca gõ trực tiếp).
// Giá trị: mã ca hoặc tên ca · "S+C" nhiều ca · NGHỈ/N/X/OFF · "-"/AUTO = bỏ phân ca ngày đó (về lịch đã phân).
// Trả hàm apply(empId, date, value) → 'set:N' | 'off' | 'clear' | 'skip' | { error }
function cellApplier() {
  const shiftByCode = new Map();
  const allShifts = db.prepare('SELECT id, code, name FROM shifts WHERE active=1').all();
  for (const sh of allShifts) if ((sh.name || '').trim()) shiftByCode.set(sh.name.trim().toUpperCase(), sh.id);
  for (const sh of allShifts) if ((sh.code || '').trim()) shiftByCode.set(sh.code.trim().toUpperCase(), sh.id);   // mã ca ưu tiên hơn tên
  // Chỉ đụng tới lớp ô Excel ('sheet'); lịch trình tạm thời nằm bên dưới giữ nguyên → xoá ô Excel là về lại ca tự động / tạm thời
  const del = db.prepare("DELETE FROM daily_shift_assignments WHERE employee_id=? AND work_date=? AND source <> 'temp'");
  const ins = db.prepare("INSERT INTO daily_shift_assignments(employee_id, work_date, shift_id, is_off, source) VALUES (?,?,?,?, 'sheet')");
  return (empId, date, value, emptyMeans = 'skip') => {
    const v = String(value ?? '').trim();
    const V = v.toUpperCase();
    if (v === '') { if (emptyMeans !== 'clear') return 'skip'; del.run(empId, date); return 'clear'; }
    if (['AUTO', 'TĐ', 'TU DONG', 'TỰ ĐỘNG', '-'].includes(V)) { del.run(empId, date); return 'clear'; }
    if (['NGHỈ', 'NGHI', 'OFF', 'N', 'X'].includes(V)) { del.run(empId, date); ins.run(empId, date, null, 1); return 'off'; }
    const codes = shiftByCode.has(V) ? [V] : V.split(/[+,/;]/).map((x) => x.trim()).filter(Boolean);
    const sids = [];
    for (const cd of codes) { const sid = shiftByCode.get(cd); if (!sid) return { error: cd }; sids.push(sid); }
    const uniq = [...new Set(sids)];
    del.run(empId, date);                       // thay toàn bộ ca ngày đó
    for (const sid of uniq) ins.run(empId, date, sid, 0);
    return 'set:' + uniq.length;
  };
}

// Ca phần mềm TỰ TÌM cho từng NV × ngày, KHÔNG tính ô nhập tay ở bảng Excel:
//   lịch trình tạm thời → gán ca NV → gán ca phòng ban → ca mặc định; ngày đã chấm mà lịch có nhiều ca → ca đã dò theo giờ chấm.
// Trả Map empId → [{ l: nhãn ngắn (mã ca / 'Nghỉ' / '📋' / ''), k: off | temp | assign | default | found | schedule | none, t: chú thích }]
function autoGrid(empIds, days) {
  const out = new Map();
  if (!empIds.length || !days.length) return out;
  const from = days[0], to = days[days.length - 1];
  const short = (sh) => ((sh.code || '').trim() || sh.name || '');
  const shById = new Map(db.prepare('SELECT id, code, name FROM shifts').all().map((x) => [x.id, x]));
  const found = new Map();   // empId|date → [ca đã dò theo giờ chấm]
  for (const a of db.prepare('SELECT employee_id, work_date, shift_id FROM attendance WHERE work_date >= ? AND work_date <= ? AND shift_id IS NOT NULL ORDER BY check_in_at').all(from, to)) {
    const k = a.employee_id + '|' + a.work_date, sh = shById.get(a.shift_id); if (!sh) continue;
    if (!found.has(k)) found.set(k, []); if (!found.get(k).includes(sh)) found.get(k).push(sh);
  }
  const foundCell = (k, why) => { const f = found.get(k); return f && f.length ? { l: f.map(short).join('+'), k: 'found', t: `${f.map((x) => x.name).join(' + ')} (phần mềm tự dò theo giờ chấm${why ? ' — ' + why : ''})` } : null; };
  for (const id of empIds) {
    out.set(id, days.map((d) => {
      const rs = resolveShift(id, d, { ignoreSheet: true });
      const tmp = rs.layer === 'temp', tag = tmp ? 'Lịch trình tạm thời: ' : '';
      if (rs.off) return { l: 'Nghỉ', k: tmp ? 'temp' : 'off', t: tag + 'Nghỉ' + (!tmp && rs.scheduleName ? ' (theo ' + rs.scheduleName + ')' : '') };
      if (rs.shift) return { l: short(rs.shift), k: tmp ? 'temp' : rs.source === 'assign' ? 'assign' : 'default', t: tag + rs.shift.name + (rs.scheduleName ? ' (theo ' + rs.scheduleName + ')' : '') };
      if (rs.source === 'schedule') {
        const why = tmp ? 'lịch trình tạm thời ' + (rs.scheduleName || '') : rs.scheduleName || 'lịch trình';
        return foundCell(id + '|' + d, why) || (tmp && rs.shifts ? { l: rs.shifts.map(short).join('+'), k: 'temp', t: tag + rs.shifts.map((x) => x.name).join(' + ') } : { l: '📋', k: 'schedule', t: (rs.scheduleName || 'Lịch trình') + ' — chưa chấm nên chưa dò được ca' });
      }
      return foundCell(id + '|' + d, '') || { l: '', k: 'none' };
    }));
  }
  return out;
}
// Nhãn ca tự tìm dùng được trong file Excel ('' = không có / chưa xác định)
const autoLabel = (g) => (!g || !g.l || g.l === '📋' ? '' : g.l === 'Nghỉ' ? 'NGHỈ' : g.l);

export function registerAssignmentRoutes(r, { need }) {
  /* ----------------------------- PHÂN CA THEO NGÀY ----------------------------- */
  // Danh sách NV + ca + các phân ca trong khoảng ngày
  r.get('/assignments', need('assignments'), (req, res) => {
    const from = (req.query.from || '').slice(0, 10);
    const to = (req.query.to || '').slice(0, 10);
    const dept = req.query.dept || null;
    if (!from || !to) return res.status(400).json({ error: 'Thiếu khoảng ngày' });

    let empSql = `SELECT e.id, e.code, e.full_name, e.department, e.shift_id, s.name AS shift_name
                  FROM employees e LEFT JOIN shifts s ON s.id = e.shift_id
                  WHERE e.active = 1${adminAttWhere('e.role')}`;
    const args = [];
    if (dept) { empSql += ' AND e.department = ?'; args.push(dept); }
    empSql += ' ORDER BY e.department, e.full_name';
    const employees = db.prepare(empSql).all(...args);

    // Nhãn phân ca gốc của từng NV (lịch trình / ca mặc định / tự động) để hiện trên lịch tuần
    for (const e of employees) {
      const rs = resolveShift(e.id, from);
      e.base = rs.off ? '🛌 Nghỉ'
        : rs.source === 'schedule' ? ('📋 ' + (rs.scheduleName || 'Lịch trình'))
        : (rs.source === 'assign' || rs.source === 'manual') && rs.shift ? ('📌 ' + rs.shift.name)
        : rs.shift ? rs.shift.name
        : '⚙ Tự động theo giờ';
    }

    const assignments = db.prepare(
      'SELECT employee_id, work_date, shift_id, is_off, source FROM daily_shift_assignments WHERE work_date >= ? AND work_date <= ?'
    ).all(from, to);

    // ?grid=1 → ca phần mềm TỰ TÌM cho từng NV từng ngày (không tính ô nhập ở bảng Excel — ô Excel hiện đè lên trên ở giao diện)
    if (req.query.grid) {
      const days = [];
      for (let d = new Date(from + 'T12:00:00Z'); d <= new Date(to + 'T12:00:00Z') && days.length < 62; d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
      const g = autoGrid(employees.map((e) => e.id), days);
      for (const e of employees) e.grid = g.get(e.id);
    }

    const shifts = db.prepare('SELECT id, code, name, start_time, end_time FROM shifts WHERE active = 1 ORDER BY name').all();
    res.json({ employees, assignments, shifts });
  });

  // Gán / xoá 1 ô (upsert). shift_id null & is_off false => xoá (về ca mặc định)
  r.post('/assignments', need('assignments'), (req, res) => {
    const b = req.body || {};
    if (!b.employee_id || !b.work_date) return res.status(400).json({ error: 'Thiếu nhân viên hoặc ngày' });
    const isOff = b.is_off ? 1 : 0;
    const shiftId = isOff ? null : (b.shift_id || null);
    // Ô lịch tuần = 1 ca/ngày → thay lớp nhập tay của ngày đó (lịch trình tạm thời bên dưới giữ nguyên)
    db.prepare("DELETE FROM daily_shift_assignments WHERE employee_id = ? AND work_date = ? AND source <> 'temp'").run(b.employee_id, b.work_date);
    const key = new Set([b.employee_id + '|' + String(b.work_date).slice(0, 10)]);
    if (!isOff && !shiftId) { recalcDays(key); return res.json({ ok: true, cleared: true }); }
    db.prepare("INSERT INTO daily_shift_assignments(employee_id, work_date, shift_id, is_off, source) VALUES (?,?,?,?, 'sheet')")
      .run(b.employee_id, b.work_date, shiftId, isOff);
    recalcDays(key);
    res.json({ ok: true });
  });

  /* ----------------------------- LỊCH TRÌNH TẠM THỜI ----------------------------- */
  // Thêm lịch tạm thời cho nhiều NV và/hoặc cả phòng ban trong một khoảng ngày → bung ra từng NV × từng ngày.
  //   { employee_ids:[], departments:[tên], include_children, from, to, skip_off, weekdays:[1..7],
  //     shift_id | work_schedule_id | is_off }   (không có cả 3 = BỎ lịch tạm thời trong khoảng đó)
  // Ghi vào lớp 'temp'. Ngày đã có ô nhập ở bảng Excel thì ô Excel vẫn được ưu tiên (đếm keptSheet để báo); xoá ô Excel thì lịch tạm thời hiện ra.
  r.post('/assignments/bulk', need('assignments'), (req, res) => {
    const b = req.body || {};
    const from = (b.from || '').slice(0, 10), to = (b.to || '').slice(0, 10);
    if (!from || !to) return res.status(400).json({ error: 'Thiếu khoảng ngày' });
    if (to < from) return res.status(400).json({ error: 'Đến ngày phải sau Từ ngày' });
    // Nhân viên: tick trực tiếp + mọi người thuộc các phòng ban đã tick (kèm phòng cấp dưới nếu chọn)
    const ids = new Set((Array.isArray(b.employee_ids) ? b.employee_ids : []).map(Number).filter(Boolean));
    const deptNames = new Set((Array.isArray(b.departments) ? b.departments : []).map((x) => String(x || '').trim()).filter(Boolean));
    if (deptNames.size && b.include_children !== false) {
      const all = db.prepare('SELECT id, name, parent_id FROM departments').all();
      let grew = true;
      while (grew) { grew = false; for (const d of all) { const p = all.find((x) => x.id === d.parent_id); if (p && deptNames.has(p.name) && !deptNames.has(d.name)) { deptNames.add(d.name); grew = true; } } }
    }
    if (deptNames.size) for (const e of db.prepare("SELECT id, department FROM employees WHERE active = 1" + adminAttWhere()).all()) if (deptNames.has((e.department || '').trim())) ids.add(e.id);
    if (!ids.size) return res.status(400).json({ error: 'Chưa chọn nhân viên hoặc phòng ban nào (hoặc phòng ban chưa có nhân viên)' });

    const weekdays = Array.isArray(b.weekdays) && b.weekdays.length ? new Set(b.weekdays.map(Number)) : null; // 1..7
    const isOff = b.is_off ? 1 : 0;
    const scheduleId = !isOff && b.work_schedule_id ? +b.work_schedule_id : null;
    const shiftId = !isOff && !scheduleId ? (b.shift_id || null) : null;
    const clear = !isOff && !shiftId && !scheduleId;
    const skipOff = !!b.skip_off && !clear;
    const weekend = new Set(String(getSetting('weekend_days', '7')).split(',').map(Number));
    const holidays = new Set(db.prepare('SELECT holiday_date FROM public_holidays WHERE holiday_date >= ? AND holiday_date <= ?').all(from, to).map((h) => h.holiday_date));

    const insert = db.prepare("INSERT INTO daily_shift_assignments(employee_id, work_date, shift_id, is_off, source) VALUES (?,?,?,?, 'temp')");
    const delTemp = db.prepare("DELETE FROM daily_shift_assignments WHERE employee_id = ? AND work_date = ? AND source = 'temp'");
    const hasSheet = db.prepare("SELECT 1 FROM daily_shift_assignments WHERE employee_id = ? AND work_date = ? AND source <> 'temp' LIMIT 1");

    let n = 0, keptSheet = 0, skippedOff = 0;
    const touched = new Set();
    db.exec('BEGIN');
    try {
      for (let d = new Date(from + 'T12:00:00Z'); d <= new Date(to + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
        const ds = d.toISOString().slice(0, 10);
        if (weekdays && !weekdays.has(vnWeekday(ds))) continue;
        const dayOff = holidays.has(ds) || weekend.has(vnWeekday(ds));
        // lịch trình theo chu kỳ: ca của ngày này (mốc chu kỳ = ngày bắt đầu khoảng)
        const sd = scheduleId ? schedDay(scheduleId, ds, from) : null;
        for (const eid of ids) {
          if (skipOff && (dayOff || (sd && sd.off))) { skippedOff++; continue; }  // bỏ qua ngày nghỉ
          delTemp.run(eid, ds);
          touched.add(eid + '|' + ds);
          if (hasSheet.get(eid, ds)) keptSheet++;                                  // ô Excel vẫn đè lên lịch tạm thời
          if (clear) { n++; continue; }
          if (isOff || (sd && sd.off)) insert.run(eid, ds, null, 1);
          else if (sd) for (const sh of sd.shifts) insert.run(eid, ds, sh.id, 0);
          else insert.run(eid, ds, shiftId, 0);
          n++;
        }
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    const recalculated = recalcDays(touched);
    res.json({ ok: true, count: n, employees: ids.size, keptSheet, skippedOff, recalculated });
  });
  // Xoá nhiều dòng phân ca theo ngày: { items: [{ employee_id, date }] } (nhân viên quay về lịch đã gán)
  r.post('/assignments/clear', need('assignments'), (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ error: 'Chưa chọn dòng nào' });
    // it.source: 'temp' = chỉ xoá lịch tạm thời · 'sheet' = chỉ xoá ô nhập ở bảng Excel · bỏ trống = xoá cả hai
    const delAll = db.prepare('DELETE FROM daily_shift_assignments WHERE employee_id = ? AND work_date = ?');
    const delTemp = db.prepare("DELETE FROM daily_shift_assignments WHERE employee_id = ? AND work_date = ? AND source = 'temp'");
    const delSheet = db.prepare("DELETE FROM daily_shift_assignments WHERE employee_id = ? AND work_date = ? AND source <> 'temp'");
    let n = 0;
    db.exec('BEGIN');
    try {
      for (const it of items) {
        const st = it.source === 'temp' ? delTemp : it.source === 'sheet' ? delSheet : delAll;
        n += st.run(+it.employee_id, String(it.date || '').slice(0, 10)).changes ? 1 : 0;
      }
      db.exec('COMMIT');
    }
    catch (e) { db.exec('ROLLBACK'); throw e; }
    recalcDays(new Set(items.map((it) => +it.employee_id + '|' + String(it.date || '').slice(0, 10))));
    res.json({ ok: true, count: n });
  });

  /* -------------------- PHÂN CA LÀM VIỆC (gán ca/lịch trình theo khoảng ngày) -------------------- */
  // Danh sách phân ca khoảng đang hiệu lực (kèm tên NV, ca/lịch trình)
  r.get('/shift-assignments', need('assignments'), (req, res) => {
    const rows = db.prepare(`SELECT sa.*, e.code AS emp_code, e.full_name AS emp_name, e.department,
        s.name AS shift_name, ws.name AS schedule_name, io.name AS inout_name
      FROM shift_assignments sa
      JOIN employees e ON e.id = sa.employee_id
      LEFT JOIN shifts s ON s.id = sa.shift_id
      LEFT JOIN work_schedules ws ON ws.id = sa.work_schedule_id
      LEFT JOIN inout_schedules io ON io.id = sa.inout_schedule_id
      WHERE sa.active = 1 ORDER BY sa.id DESC`).all();
    res.json({ rows });
  });

  // Tạo phân ca khoảng — áp cho 1 NV / cả phòng ban / toàn bộ NV
  r.post('/shift-assignments', need('assignments'), (req, res) => {
    const b = req.body || {};
    const scope = b.scope || 'emp';                       // emp | dept | all
    const mode = b.mode === 'schedule' ? 'schedule' : 'shift';
    const from = (b.from_date || '').slice(0, 10);
    const to = (b.to_date || '').slice(0, 10) || null;
    if (!from) return res.status(400).json({ error: 'Thiếu ngày bắt đầu' });
    if (to && to < from) return res.status(400).json({ error: 'Ngày kết thúc phải sau ngày bắt đầu' });
    const shiftId = mode === 'shift' ? (b.shift_id || null) : null;
    const scheduleId = mode === 'schedule' ? (b.work_schedule_id || null) : null;
    if (mode === 'shift' && !shiftId) return res.status(400).json({ error: 'Chưa chọn ca làm việc' });
    if (mode === 'schedule' && !scheduleId) return res.status(400).json({ error: 'Chưa chọn lịch trình' });

    // Xác định danh sách NV theo phạm vi áp dụng
    let emps;
    if (scope === 'all') emps = db.prepare("SELECT id FROM employees WHERE active=1" + adminAttWhere()).all();
    else if (scope === 'dept') {
      if (!b.department) return res.status(400).json({ error: 'Chưa chọn phòng ban' });
      emps = db.prepare("SELECT id FROM employees WHERE active=1" + adminAttWhere() + " AND department=?").all(b.department);
    } else {
      // Nhân viên cụ thể: nhận NHIỀU NV (employee_ids) hoặc 1 NV (employee_id) cho tương thích cũ
      const ids = Array.isArray(b.employee_ids) ? b.employee_ids.filter(Boolean) : (b.employee_id ? [b.employee_id] : []);
      if (!ids.length) return res.status(400).json({ error: 'Chưa chọn nhân viên' });
      emps = ids.map((id) => ({ id }));
    }
    if (!emps.length) return res.status(400).json({ error: 'Không có nhân viên phù hợp trong phạm vi đã chọn' });

    const shiftType = b.shift_type === 'rotating' ? 'rotating' : 'fixed';
    const mergeRule = b.merge_rule || 'default';
    const note = (b.note || '').slice(0, 500);
    const ioId = b.inout_schedule_id ? +b.inout_schedule_id : null;
    const ins = db.prepare(`INSERT INTO shift_assignments
      (employee_id, mode, shift_id, work_schedule_id, from_date, to_date, shift_type, merge_rule, note, inout_schedule_id)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
    let n = 0;
    db.exec('BEGIN');
    try {
      for (const e of emps) { ins.run(e.id, mode, shiftId, scheduleId, from, to, shiftType, mergeRule, note, ioId); n++; }
      db.exec('COMMIT');
    } catch (err) { db.exec('ROLLBACK'); throw err; }
    res.json({ ok: true, count: n });
  });

  r.delete('/shift-assignments/:id', need('assignments'), (req, res) => {
    db.prepare('DELETE FROM shift_assignments WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // Xoá nhiều phân ca khoảng: {ids:[...]} , hoặc {all:true} (tuỳ chọn lọc theo department)
  r.post('/shift-assignments/delete', need('assignments'), (req, res) => {
    const b = req.body || {};
    let n = 0;
    if (b.all) {
      n = b.department
        ? db.prepare('DELETE FROM shift_assignments WHERE employee_id IN (SELECT id FROM employees WHERE department=?)').run(b.department).changes
        : db.prepare('DELETE FROM shift_assignments').run().changes;
    } else {
      const ids = Array.isArray(b.ids) ? b.ids.filter(Boolean) : [];
      if (!ids.length) return res.status(400).json({ error: 'Chưa chọn phân ca để xoá' });
      const del = db.prepare('DELETE FROM shift_assignments WHERE id = ?');
      for (const id of ids) n += del.run(id).changes;
    }
    res.json({ ok: true, count: n });
  });

  /* -------------------- LỊCH TRÌNH PHÒNG BAN -------------------- */
  r.get('/dept-shift-assignments', need('assignments'), (req, res) => {
    const rows = db.prepare(`SELECT da.*, s.name AS shift_name, ws.name AS schedule_name, io.name AS inout_name
      FROM dept_shift_assignments da
      LEFT JOIN shifts s ON s.id = da.shift_id
      LEFT JOIN work_schedules ws ON ws.id = da.work_schedule_id
      LEFT JOIN inout_schedules io ON io.id = da.inout_schedule_id
      WHERE da.active = 1 ORDER BY da.department, da.id DESC`).all();
    res.json({ rows });
  });
  // { departments: ['Kế toán', …], include_children, mode, shift_id | work_schedule_id, from_date, to_date }
  r.post('/dept-shift-assignments', need('assignments'), (req, res) => {
    const b = req.body || {};
    const depts = [...new Set((Array.isArray(b.departments) ? b.departments : []).map((x) => String(x || '').trim()).filter(Boolean))];
    if (!depts.length) return res.status(400).json({ error: 'Chưa chọn phòng ban' });
    const mode = b.mode === 'schedule' ? 'schedule' : 'shift';
    const from = (b.from_date || '').slice(0, 10), to = (b.to_date || '').slice(0, 10) || null;
    if (!from) return res.status(400).json({ error: 'Thiếu ngày bắt đầu' });
    if (to && to < from) return res.status(400).json({ error: 'Ngày kết thúc phải sau ngày bắt đầu' });
    const shiftId = mode === 'shift' ? (b.shift_id || null) : null;
    const scheduleId = mode === 'schedule' ? (b.work_schedule_id || null) : null;
    if (mode === 'shift' && !shiftId) return res.status(400).json({ error: 'Chưa chọn ca làm việc' });
    if (mode === 'schedule' && !scheduleId) return res.status(400).json({ error: 'Chưa chọn lịch trình' });
    const ioId = b.inout_schedule_id ? +b.inout_schedule_id : null;
    const ins = db.prepare(`INSERT INTO dept_shift_assignments
      (department, include_children, mode, shift_id, work_schedule_id, from_date, to_date, merge_rule, note, inout_schedule_id) VALUES (?,?,?,?,?,?,?,?,?,?)`);
    db.exec('BEGIN');
    try {
      for (const d of depts) ins.run(d, b.include_children === false ? 0 : 1, mode, shiftId, scheduleId, from, to, b.merge_rule || 'default', String(b.note || '').slice(0, 500), ioId);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    res.json({ ok: true, count: depts.length });
  });
  r.post('/dept-shift-assignments/delete', need('assignments'), (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ error: 'Chưa chọn dòng nào để xoá' });
    const del = db.prepare('DELETE FROM dept_shift_assignments WHERE id = ?');
    let n = 0; for (const id of ids) n += del.run(id).changes;
    res.json({ ok: true, count: n });
  });

  /* -------------------- PHÂN CA BẰNG EXCEL -------------------- */
  // Xuất mẫu Excel phân ca tháng (lưới NV × ngày)
  r.get('/assignments/export.xlsx', need('assignments'), async (req, res) => {
    // Khoảng ngày: ?from&to (xuất 1 khoảng nhỏ cho nhập lại nhanh) hoặc ?month (cả tháng)
    const month = (req.query.month || '').slice(0, 7);
    const dept = req.query.dept || null;
    const qf = String(req.query.from || '').slice(0, 10), qt = String(req.query.to || '').slice(0, 10);
    let days;
    if (isYmd(qf) && isYmd(qt) && qt >= qf) days = rangeDaysList(qf, qt);
    else if (month) days = monthDaysList(month);
    else return res.status(400).json({ error: 'Thiếu khoảng ngày' });
    const fileTag = month && !(isYmd(qf) && isYmd(qt)) ? month : `${days[0]}_${days[days.length - 1]}`;

    let empSql = "SELECT id, code, full_name, department FROM employees WHERE active=1" + adminAttWhere();
    const args = [];
    if (dept) { empSql += ' AND department = ?'; args.push(dept); }
    empSql += ' ORDER BY department, full_name';
    const emps = db.prepare(empSql).all(...args);

    const shifts = db.prepare('SELECT id, code, name, start_time, end_time FROM shifts WHERE active=1').all();
    const codeOf = new Map(shifts.map((s) => [s.id, (s.code || s.name || '').trim()]));
    // 1 ngày có thể NHIỀU ca (ca gãy) → gom mảng theo emp|date
    const assigns = new Map();
    for (const a of db.prepare("SELECT employee_id, work_date, shift_id, is_off FROM daily_shift_assignments WHERE work_date LIKE ? AND source <> 'temp'").all(month + '%')) {
      const k = a.employee_id + '|' + a.work_date; if (!assigns.has(k)) assigns.set(k, []); assigns.get(k).push(a);
    }

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('PhanCa');
    // Cột ngày ghi 'ngày/tháng' (VD 05/10) để nhập lại đúng ngày dù khoảng chọn qua 2 tháng
    const header = ['Mã NV', 'Họ tên', 'Bộ phận', ...days.map((d) => `${d.slice(8)}/${d.slice(5, 7)}\n${WDVN[vnWd(d)]}`)];
    const hr = ws.addRow(header);
    hr.height = 28;
    hr.eachCell((c, col) => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      const weekend = col > 3 && vnWd(days[col - 4]) >= 6;
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: weekend ? 'FFB45309' : 'FF1E3A5F' } };
    });
    // Ô chưa nhập tay → ghi luôn ca phần mềm TỰ TÌM (chữ xám nghiêng) để sửa cho dễ;
    // nhập lại mà để nguyên ca tự tìm thì vẫn là tự động, chỉ ô sửa khác đi mới thành ô nhập tay.
    const auto = autoGrid(emps.map((e) => e.id), days);
    for (const e of emps) {
      const cells = [e.code, e.full_name, e.department || ''];
      const isAuto = [];
      days.forEach((d, i) => {
        const arr = assigns.get(e.id + '|' + d) || [];
        if (arr.length) { isAuto.push(false); cells.push(arr.some((x) => x.is_off) ? 'NGHỈ' : arr.map((x) => codeOf.get(x.shift_id)).filter(Boolean).join('+')); } // "S+C" = 2 ca gãy
        else { const v = autoLabel(auto.get(e.id)?.[i]); isAuto.push(!!v); cells.push(v); }
      });
      const row = ws.addRow(cells);
      row.eachCell((c, col) => {
        if (col <= 3) return;
        if (vnWd(days[col - 4]) >= 6) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3E6' } };
        c.alignment = { horizontal: 'center' };
        c.font = isAuto[col - 4] ? { italic: true, color: { argb: 'FF9CA3AF' } } : { bold: true };
      });
    }
    ws.getColumn(1).width = 10; ws.getColumn(2).width = 22; ws.getColumn(3).width = 14;
    for (let i = 0; i < days.length; i++) ws.getColumn(4 + i).width = 7;
    ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 1 }];

    // Sheet chú thích mã ca
    const ws2 = wb.addWorksheet('Mã ca');
    ws2.addRow(['Mã ca', 'Tên ca', 'Giờ']).font = { bold: true };
    for (const s of shifts) ws2.addRow([(s.code || '').trim() || s.name, s.name, `${s.start_time}-${s.end_time}`]);   // ca chưa có mã → gõ tên ca
    ws2.addRow(['NGHỈ', 'Ngày nghỉ', '']);
    ws2.addRow(['(trống)', 'Tự động tìm ca theo giờ chấm', '']);
    ws2.addRow(['Chữ xám nghiêng', 'Ca phần mềm tự tìm (theo lịch đã gán / lịch tạm thời / giờ chấm). Để nguyên = vẫn tự động; gõ mã khác = đổi ca ngày đó', '']);
    ws2.addRow(['Chữ đậm', 'Ca đã nhập tay ở bảng Excel (ưu tiên cao nhất)', '']);
    ws2.addRow(['-', 'Bỏ ca đã nhập tay → phần mềm tự tìm ca lại', '']);
    ws2.addRow(['VD: S+C', 'NHIỀU ca trong 1 ngày (ca gãy) — nối mã ca bằng dấu +', 'VD sáng + chiều']);
    ws2.getColumn(1).width = 14; ws2.getColumn(2).width = 48; ws2.getColumn(3).width = 16;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="phanca_${fileTag}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  });

  // Nhập Excel phân ca: { fileBase64, from?, to?, month? } — cột ngày đọc từ dòng tiêu đề của file ('05/10' hoặc kiểu cũ '05' theo tháng)
  r.post('/assignments/import', need('assignments'), async (req, res) => {
    const month = (req.body?.month || '').slice(0, 7);
    const b64 = req.body?.fileBase64 || '';
    if (!b64) return res.status(400).json({ error: 'Thiếu file' });
    const buf = Buffer.from(b64.replace(/^data:.*;base64,/, ''), 'base64');
    // Mốc để đoán NĂM của cột 'ngày/tháng' và THÁNG của cột kiểu cũ chỉ ghi số ngày
    const hint = isYmd(req.body?.from) ? req.body.from : month ? month + '-01' : new Date().toISOString().slice(0, 10);
    const hintMonth = month || hint.slice(0, 7);

    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buf); } catch { return res.status(400).json({ error: 'File Excel không đọc được' }); }
    const ws = wb.worksheets[0];
    if (!ws) return res.status(400).json({ error: 'File rỗng' });

    const empByCode = new Map(db.prepare("SELECT id, code FROM employees WHERE active=1").all().map((e) => [String(e.code).trim().toUpperCase(), e.id]));
    const applyCell = cellApplier();

    // map cột → ngày (từ header dòng 1, phần trước xuống dòng): '05/10' → ngày 05 tháng 10 (năm gần mốc nhất); '05' → ngày 05 của tháng đang xem
    const dayCol = new Map();
    const headerRow = ws.getRow(1);
    const hy = +hint.slice(0, 4), hintMs = Date.parse(hint + 'T12:00:00Z');
    const pad = (n) => String(n).padStart(2, '0');
    const monthDays = monthDaysList(hintMonth);
    headerRow.eachCell((cell, col) => {
      if (col <= 3) return;
      const txt = String(cell.value ?? '').split('\n')[0].trim();
      const m = /^(\d{1,2})\/(\d{1,2})$/.exec(txt);
      if (m) {
        const dd = +m[1], mm = +m[2]; if (!(dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12)) return;
        let best = null;
        for (const y of [hy - 1, hy, hy + 1]) { const iso = `${y}-${pad(mm)}-${pad(dd)}`; const t = Date.parse(iso + 'T12:00:00Z'); if (isNaN(t) || new Date(t).getUTCDate() !== dd) continue; if (!best || Math.abs(t - hintMs) < Math.abs(Date.parse(best + 'T12:00:00Z') - hintMs)) best = iso; }
        if (best) dayCol.set(col, best);
        return;
      }
      const dnum = parseInt(txt, 10);
      if (String(dnum) === txt.replace(/^0/, '') && dnum >= 1 && dnum <= monthDays.length) dayCol.set(col, monthDays[dnum - 1]);
    });
    if (!dayCol.size) return res.status(400).json({ error: 'Không thấy cột ngày ở dòng đầu file (VD "05/10")' });
    const days = [...new Set(dayCol.values())].sort();

    let updated = 0, cleared = 0, off = 0, keptAuto = 0; const errors = [];
    const touchedImp = new Set();
    const auto = autoGrid([...new Set(empByCode.values())], days);
    const hasSheetRow = db.prepare("SELECT 1 FROM daily_shift_assignments WHERE employee_id = ? AND work_date = ? AND source <> 'temp' LIMIT 1");
    const NGHI = ['NGHỈ', 'NGHI', 'OFF', 'N', 'X'];
    const sameAsAuto = (empId, date, v) => {
      const t = String(v ?? '').trim().toUpperCase(); if (!t) return false;
      const lab = autoLabel(auto.get(empId)?.[days.indexOf(date)]).toUpperCase(); if (!lab) return false;
      return t === lab || (lab === 'NGHỈ' && NGHI.includes(t));
    };

    db.exec('BEGIN');
    try {
      for (let r2 = 2; r2 <= ws.rowCount; r2++) {
        const row = ws.getRow(r2);
        const code = String(row.getCell(1).value ?? '').trim().toUpperCase();
        if (!code) continue;
        const empId = empByCode.get(code);
        if (!empId) { errors.push(`Mã NV "${code}" không tồn tại`); continue; }
        for (const [col, date] of dayCol) {
          const val = row.getCell(col).value;
          if (sameAsAuto(empId, date, val) && !hasSheetRow.get(empId, date)) { keptAuto++; continue; }   // để nguyên ca tự tìm → vẫn tự động
          const out = applyCell(empId, date, val);   // ô trống = không đổi
          if (out !== 'skip' && !(out && out.error)) touchedImp.add(empId + '|' + date);
          if (out === 'clear') cleared++;
          else if (out === 'off') off++;
          else if (typeof out === 'string' && out.startsWith('set:')) updated += +out.slice(4);
          else if (out && out.error) errors.push(`Ngày ${date.slice(8)}: mã ca "${out.error}" (NV ${code}) không tồn tại`);
        }
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); return sendCaughtError(res, 'POST /admin/assignments/import', e); }
    recalcDays(touchedImp);

    res.json({ ok: true, updated, off, cleared, keptAuto, from: days[0], to: days[days.length - 1], errors: errors.slice(0, 20), errorCount: errors.length });
  });

  // Lưu các ô sửa trực tiếp trên Bảng phân ca (kiểu Excel): { cells: [{ employee_id, date, value }] }
  // value rỗng hoặc "-" = bỏ phân ca ngày đó (quay về lịch đã phân). Ô sai mã ca thì bỏ qua và báo lỗi, các ô khác vẫn lưu.
  r.post('/assignments/cells', need('assignments'), (req, res) => {
    const cells = Array.isArray(req.body?.cells) ? req.body.cells : [];
    if (!cells.length) return res.status(400).json({ error: 'Không có ô nào để lưu' });
    if (cells.length > 20000) return res.status(400).json({ error: 'Quá nhiều ô trong 1 lần lưu' });
    const applyCell = cellApplier();
    const empOk = new Set(db.prepare('SELECT id FROM employees WHERE active=1').all().map((e) => e.id));
    let saved = 0; const errors = [];
    const touchedCells = new Set();
    db.exec('BEGIN');
    try {
      for (const c of cells) {
        const eid = +c.employee_id, date = String(c.date || '').slice(0, 10);
        if (!empOk.has(eid) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { errors.push({ employee_id: eid, date, error: 'Nhân viên hoặc ngày không hợp lệ' }); continue; }
        const out = applyCell(eid, date, c.value, 'clear');
        if (!(out && out.error)) touchedCells.add(eid + '|' + date);
        if (out && out.error) errors.push({ employee_id: eid, date, error: `Mã ca "${out.error}" không tồn tại` });
        else saved++;
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); return sendCaughtError(res, 'POST /admin/assignments/cells', e); }
    recalcDays(touchedCells);
    res.json({ ok: true, saved, errors: errors.slice(0, 50), errorCount: errors.length });
  });
}
