// Nhóm route PHÂN CA — theo ngày (lịch tuần), theo khoảng ngày (shift_assignments) và phân ca bằng Excel.
import ExcelJS from 'exceljs';
import { db } from '../../db.js';
import { resolveShift } from '../../shift-resolver.js';
import { vnWeekday } from '../../attendance-calc.js';
import { sendCaughtError } from '../../util.js';

const WDVN = { 1: 'T2', 2: 'T3', 3: 'T4', 4: 'T5', 5: 'T6', 6: 'T7', 7: 'CN' };
function monthDaysList(month) {
  const [y, m] = month.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}
const vnWd = (d) => { const dow = new Date(d + 'T12:00:00Z').getUTCDay(); return dow === 0 ? 7 : dow; };

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
                  WHERE e.active = 1 AND e.role != 'admin'`;
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
      'SELECT employee_id, work_date, shift_id, is_off FROM daily_shift_assignments WHERE work_date >= ? AND work_date <= ?'
    ).all(from, to);

    const shifts = db.prepare('SELECT id, name, start_time, end_time FROM shifts WHERE active = 1 ORDER BY name').all();
    res.json({ employees, assignments, shifts });
  });

  // Gán / xoá 1 ô (upsert). shift_id null & is_off false => xoá (về ca mặc định)
  r.post('/assignments', need('assignments'), (req, res) => {
    const b = req.body || {};
    if (!b.employee_id || !b.work_date) return res.status(400).json({ error: 'Thiếu nhân viên hoặc ngày' });
    const isOff = b.is_off ? 1 : 0;
    const shiftId = isOff ? null : (b.shift_id || null);
    // Ô lịch tuần = 1 ca/ngày → thay thế toàn bộ phân ca ngày (kể cả nhiều ca NV tự chọn)
    db.prepare('DELETE FROM daily_shift_assignments WHERE employee_id = ? AND work_date = ?').run(b.employee_id, b.work_date);
    if (!isOff && !shiftId) return res.json({ ok: true, cleared: true });
    db.prepare('INSERT INTO daily_shift_assignments(employee_id, work_date, shift_id, is_off) VALUES (?,?,?,?)')
      .run(b.employee_id, b.work_date, shiftId, isOff);
    res.json({ ok: true });
  });

  // Gán hàng loạt: nhiều NV × khoảng ngày × lọc thứ
  r.post('/assignments/bulk', need('assignments'), (req, res) => {
    const b = req.body || {};
    const empIds = Array.isArray(b.employee_ids) ? b.employee_ids : [];
    const from = (b.from || '').slice(0, 10), to = (b.to || '').slice(0, 10);
    if (!empIds.length || !from || !to) return res.status(400).json({ error: 'Thiếu nhân viên hoặc khoảng ngày' });
    const weekdays = Array.isArray(b.weekdays) && b.weekdays.length ? new Set(b.weekdays.map(Number)) : null; // 1..7
    const isOff = b.is_off ? 1 : 0;
    const shiftId = isOff ? null : (b.shift_id || null);
    const clear = !isOff && !shiftId;

    const insert = db.prepare('INSERT INTO daily_shift_assignments(employee_id, work_date, shift_id, is_off) VALUES (?,?,?,?)');
    const del = db.prepare('DELETE FROM daily_shift_assignments WHERE employee_id = ? AND work_date = ?');

    let n = 0;
    db.exec('BEGIN');
    try {
      for (let d = new Date(from + 'T12:00:00Z'); d <= new Date(to + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
        const ds = d.toISOString().slice(0, 10);
        if (weekdays && !weekdays.has(vnWeekday(ds))) continue;
        for (const eid of empIds) {
          del.run(eid, ds);                       // thay thế toàn bộ ca ngày đó
          if (!clear) insert.run(eid, ds, shiftId, isOff);
          n++;
        }
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    res.json({ ok: true, count: n });
  });

  /* -------------------- PHÂN CA LÀM VIỆC (gán ca/lịch trình theo khoảng ngày) -------------------- */
  // Danh sách phân ca khoảng đang hiệu lực (kèm tên NV, ca/lịch trình)
  r.get('/shift-assignments', need('assignments'), (req, res) => {
    const rows = db.prepare(`SELECT sa.*, e.code AS emp_code, e.full_name AS emp_name, e.department,
        s.name AS shift_name, ws.name AS schedule_name
      FROM shift_assignments sa
      JOIN employees e ON e.id = sa.employee_id
      LEFT JOIN shifts s ON s.id = sa.shift_id
      LEFT JOIN work_schedules ws ON ws.id = sa.work_schedule_id
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
    if (scope === 'all') emps = db.prepare("SELECT id FROM employees WHERE active=1 AND role!='admin'").all();
    else if (scope === 'dept') {
      if (!b.department) return res.status(400).json({ error: 'Chưa chọn phòng ban' });
      emps = db.prepare("SELECT id FROM employees WHERE active=1 AND role!='admin' AND department=?").all(b.department);
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
    const ins = db.prepare(`INSERT INTO shift_assignments
      (employee_id, mode, shift_id, work_schedule_id, from_date, to_date, shift_type, merge_rule, note)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    let n = 0;
    db.exec('BEGIN');
    try {
      for (const e of emps) { ins.run(e.id, mode, shiftId, scheduleId, from, to, shiftType, mergeRule, note); n++; }
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

  /* -------------------- PHÂN CA BẰNG EXCEL -------------------- */
  // Xuất mẫu Excel phân ca tháng (lưới NV × ngày)
  r.get('/assignments/export.xlsx', need('assignments'), async (req, res) => {
    const month = (req.query.month || '').slice(0, 7);
    const dept = req.query.dept || null;
    if (!month) return res.status(400).json({ error: 'Thiếu tháng' });
    const days = monthDaysList(month);

    let empSql = "SELECT id, code, full_name, department FROM employees WHERE active=1 AND role!='admin'";
    const args = [];
    if (dept) { empSql += ' AND department = ?'; args.push(dept); }
    empSql += ' ORDER BY department, full_name';
    const emps = db.prepare(empSql).all(...args);

    const shifts = db.prepare('SELECT id, code, name, start_time, end_time FROM shifts WHERE active=1').all();
    const codeOf = new Map(shifts.map((s) => [s.id, (s.code || s.name || '').trim()]));
    // 1 ngày có thể NHIỀU ca (ca gãy) → gom mảng theo emp|date
    const assigns = new Map();
    for (const a of db.prepare('SELECT employee_id, work_date, shift_id, is_off FROM daily_shift_assignments WHERE work_date LIKE ?').all(month + '%')) {
      const k = a.employee_id + '|' + a.work_date; if (!assigns.has(k)) assigns.set(k, []); assigns.get(k).push(a);
    }

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('PhanCa ' + month);
    const header = ['Mã NV', 'Họ tên', 'Bộ phận', ...days.map((d) => `${d.slice(8)}\n${WDVN[vnWd(d)]}`)];
    const hr = ws.addRow(header);
    hr.height = 28;
    hr.eachCell((c, col) => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      const weekend = col > 3 && vnWd(days[col - 4]) >= 6;
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: weekend ? 'FFB45309' : 'FF1E3A5F' } };
    });
    for (const e of emps) {
      const cells = [e.code, e.full_name, e.department || ''];
      for (const d of days) {
        const arr = assigns.get(e.id + '|' + d) || [];
        if (!arr.length) cells.push('');
        else if (arr.some((x) => x.is_off)) cells.push('NGHỈ');
        else cells.push(arr.map((x) => codeOf.get(x.shift_id)).filter(Boolean).join('+')); // "S+C" = 2 ca gãy
      }
      const row = ws.addRow(cells);
      row.eachCell((c, col) => { if (col > 3 && vnWd(days[col - 4]) >= 6) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3E6' } }; });
    }
    ws.getColumn(1).width = 10; ws.getColumn(2).width = 22; ws.getColumn(3).width = 14;
    for (let i = 0; i < days.length; i++) ws.getColumn(4 + i).width = 6;
    ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 1 }];

    // Sheet chú thích mã ca
    const ws2 = wb.addWorksheet('Mã ca');
    ws2.addRow(['Mã ca', 'Tên ca', 'Giờ']).font = { bold: true };
    for (const s of shifts) ws2.addRow([(s.code || '').trim(), s.name, `${s.start_time}-${s.end_time}`]);
    ws2.addRow(['NGHỈ', 'Ngày nghỉ', '']);
    ws2.addRow(['(trống)', 'Tự động tìm ca theo giờ chấm', '']);
    ws2.addRow(['VD: S+C', 'NHIỀU ca trong 1 ngày (ca gãy) — nối mã ca bằng dấu +', 'VD sáng + chiều']);
    ws2.getColumn(1).width = 14; ws2.getColumn(2).width = 48; ws2.getColumn(3).width = 16;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="phanca_${month}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  });

  // Nhập Excel phân ca: {month, fileBase64}
  r.post('/assignments/import', need('assignments'), async (req, res) => {
    const month = (req.body?.month || '').slice(0, 7);
    const b64 = req.body?.fileBase64 || '';
    if (!month || !b64) return res.status(400).json({ error: 'Thiếu tháng hoặc file' });
    const buf = Buffer.from(b64.replace(/^data:.*;base64,/, ''), 'base64');
    const days = monthDaysList(month);

    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buf); } catch { return res.status(400).json({ error: 'File Excel không đọc được' }); }
    const ws = wb.worksheets[0];
    if (!ws) return res.status(400).json({ error: 'File rỗng' });

    const empByCode = new Map(db.prepare("SELECT id, code FROM employees WHERE active=1").all().map((e) => [String(e.code).trim().toUpperCase(), e.id]));
    const shiftByCode = new Map(db.prepare('SELECT id, code, name FROM shifts WHERE active=1').all()
      .filter((s) => (s.code || '').trim())
      .map((s) => [s.code.trim().toUpperCase(), s.id]));

    // map cột → ngày (từ header dòng 1, phần số trước xuống dòng)
    const dayCol = new Map();
    const headerRow = ws.getRow(1);
    headerRow.eachCell((cell, col) => {
      if (col <= 3) return;
      const txt = String(cell.value ?? '').split('\n')[0].trim();
      const dnum = parseInt(txt, 10);
      if (dnum >= 1 && dnum <= days.length) dayCol.set(col, days[dnum - 1]);
    });

    let updated = 0, cleared = 0, off = 0; const errors = [];
    const del = db.prepare('DELETE FROM daily_shift_assignments WHERE employee_id=? AND work_date=?');
    const ins = db.prepare('INSERT INTO daily_shift_assignments(employee_id, work_date, shift_id, is_off) VALUES (?,?,?,?)');
    const up = (empId, date, sid, isOff) => { del.run(empId, date); ins.run(empId, date, sid, isOff); }; // 1 ca/ô = thay thế

    db.exec('BEGIN');
    try {
      for (let r2 = 2; r2 <= ws.rowCount; r2++) {
        const row = ws.getRow(r2);
        const code = String(row.getCell(1).value ?? '').trim().toUpperCase();
        if (!code) continue;
        const empId = empByCode.get(code);
        if (!empId) { errors.push(`Mã NV "${code}" không tồn tại`); continue; }
        for (const [col, date] of dayCol) {
          const v = String(row.getCell(col).value ?? '').trim();
          if (v === '') continue; // trống = không đổi
          const V = v.toUpperCase();
          if (['AUTO', 'TĐ', 'TU DONG', 'TỰ ĐỘNG', '-'].includes(V)) { del.run(empId, date); cleared++; continue; }
          if (['NGHỈ', 'NGHI', 'OFF', 'N', 'X'].includes(V)) { up(empId, date, null, 1); off++; continue; }
          // Nhiều ca gãy trong 1 ngày: nối mã bằng + , / hoặc ; (VD "S+C")
          const codes = V.split(/[+,/;]/).map((s) => s.trim()).filter(Boolean);
          const sids = [];
          let bad = null;
          for (const cd of codes) { const sid = shiftByCode.get(cd); if (!sid) { bad = cd; break; } sids.push(sid); }
          if (bad) { errors.push(`Ngày ${date.slice(8)}: mã ca "${bad}" (NV ${code}) không tồn tại`); continue; }
          const uniq = [...new Set(sids)];
          del.run(empId, date);                       // thay toàn bộ ca ngày đó
          for (const sid of uniq) ins.run(empId, date, sid, 0);
          updated += uniq.length;
        }
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); return sendCaughtError(res, 'POST /admin/assignments/import', e); }

    res.json({ ok: true, updated, off, cleared, errors: errors.slice(0, 20), errorCount: errors.length });
  });
}
