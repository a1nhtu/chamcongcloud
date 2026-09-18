// Nhóm route CÔNG: tính lại công, lưới chấm công, sửa/thêm/xoá giờ chấm tay, xoá theo khoảng.
import { db, getSetting } from '../../db.js';
import { resolveEffectiveShift } from '../../shift-resolver.js';
import { payrollCtx, computeDayMetrics } from '../../day-metrics.js';

const WDVN = { 1: 'T2', 2: 'T3', 3: 'T4', 4: 'T5', 5: 'T6', 6: 'T7', 7: 'CN' };
const vnWd = (d) => { const dow = new Date(d + 'T12:00:00Z').getUTCDay(); return dow === 0 ? 7 : dow; };

// Đổi 'YYYY-MM-DD' + 'HH:MM' (giờ VN) → ISO UTC
function vnToIso(date, hm) {
  if (!hm) return null;
  return new Date(`${date}T${hm}:00+07:00`).toISOString();
}
// Tính lại các chỉ số cho 1 bản ghi khi admin nhập tay
function computeManual(employeeId, workDate, inIso, outIso) {
  const ctx = payrollCtx(getSetting, db);
  // Chế độ theo GIỜ: không dò ca, không muộn/sớm (giữ nguyên hành vi cũ)
  const eff = ctx.hourly ? { shift: null } : resolveEffectiveShift(employeeId, workDate, inIso || `${workDate}T00:00:00Z`, outIso || null);
  return computeDayMetrics(ctx, eff.shift, workDate, inIso, outIso);
}

export function registerAttendanceRoutes(r, { need }) {
  /* -------------------- TÍNH LẠI CÔNG (áp cho dữ liệu cũ) -------------------- */
  r.post('/recompute', need('recompute'), (req, res) => {
    const month = (req.query.month || '').slice(0, 7);
    // Đọc cấu hình + ngày lễ MỘT LẦN cho cả mẻ (thay vì query mỗi dòng)
    const ctx = payrollCtx(getSetting, db);

    // Phạm vi: ids (vài NV) > depts (nhiều phòng ban) > dept (1 phòng ban) > cả công ty
    const dept = (req.query.dept || '').trim();
    const deptList = String(req.query.depts || '').split(',').map((s) => s.trim()).filter(Boolean);
    const ids = String(req.query.ids || '').split(',').map((s) => parseInt(s, 10)).filter(Boolean);
    const rcFrom = String(req.query.from || '').slice(0, 10);
    const rcTo = String(req.query.to || '').slice(0, 10);
    const where = ['a.check_in_at IS NOT NULL']; const args = [];
    if (/^\d{4}-\d{2}-\d{2}$/.test(rcFrom) && /^\d{4}-\d{2}-\d{2}$/.test(rcTo)) { where.push('a.work_date>=? AND a.work_date<=?'); args.push(rcFrom, rcTo); }
    else if (month) { where.push('a.work_date LIKE ?'); args.push(month + '%'); }
    let join = '';
    if (ids.length) { where.push(`a.employee_id IN (${ids.map(() => '?').join(',')})`); args.push(...ids); }
    else if (deptList.length) { join = ' JOIN employees e ON e.id=a.employee_id'; where.push(`e.department IN (${deptList.map(() => '?').join(',')})`); args.push(...deptList); }
    else if (dept) { join = ' JOIN employees e ON e.id=a.employee_id'; where.push('e.department=?'); args.push(dept); }
    const rows = db.prepare(`SELECT a.* FROM attendance a${join} WHERE ${where.join(' AND ')}`).all(...args);

    // Prepare MỘT LẦN ngoài vòng (không re-prepare mỗi dòng)
    const updNoOut = db.prepare('UPDATE attendance SET late_min=?, day_status=?, ot_type=?, shift_id=?, shift_source=? WHERE id=?');
    const updFull = db.prepare(`UPDATE attendance SET late_min=?, early_min=?, ot_min=?, work_minutes=?,
      work_unit=?, day_status=?, ot_type=?, shift_id=?, shift_source=? WHERE id=?`);

    let n = 0;
    db.exec('BEGIN');
    try {
      for (const row of rows) {
        // Dò lại ca: phân ca thủ công (Excel) đè → tự động theo giờ → mặc định
        const eff = resolveEffectiveShift(row.employee_id, row.work_date, row.check_in_at, row.check_out_at || null);
        const m = computeDayMetrics(ctx, eff.shift, row.work_date, row.check_in_at, row.check_out_at || null);
        if (!row.check_out_at) {
          // Chưa chấm ra: chỉ cập nhật muộn/trạng thái/ca — GIỮ NGUYÊN giờ công cũ (như trước)
          updNoOut.run(m.late, m.day_status, m.ot_type, m.shiftId, eff.source, row.id);
        } else {
          updFull.run(m.late, m.early_min, m.ot_min, m.work_minutes, m.work_unit, m.day_status, m.ot_type, m.shiftId, eff.source, row.id);
        }
        n++;
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    res.json({ ok: true, updated: n });
  });

  // LƯỚI CHẤM CÔNG theo KHOẢNG NGÀY + phạm vi (cả công ty / phòng ban / vài NV).
  // mode=detail: từng ngày (giờ vào/ra, ca, CÁC LẦN CHẤM, nghỉ). mode=summary: tổng hợp mỗi NV.
  r.get('/attendance/grid', need('reports'), (req, res) => {
    const from = String(req.query.from || '').slice(0, 10);
    const to = String(req.query.to || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return res.status(400).json({ error: 'Thiếu khoảng ngày hợp lệ' });
    if (to < from) return res.status(400).json({ error: 'Đến ngày phải sau Từ ngày' });
    const dept = (req.query.dept || '').trim();
    const deptList = String(req.query.depts || '').split(',').map((s) => s.trim()).filter(Boolean);
    const ids = String(req.query.ids || '').split(',').map((s) => parseInt(s, 10)).filter(Boolean);
    const mode = req.query.mode === 'summary' ? 'summary' : 'detail';

    let esql = "SELECT id, code, full_name, department FROM employees WHERE active=1 AND role!='admin'";
    const eargs = [];
    if (ids.length) { esql += ` AND id IN (${ids.map(() => '?').join(',')})`; eargs.push(...ids); }
    else if (deptList.length) { esql += ` AND department IN (${deptList.map(() => '?').join(',')})`; eargs.push(...deptList); }
    else if (dept) { esql += ' AND department=?'; eargs.push(dept); }
    esql += ' ORDER BY department, full_name';
    const emps = db.prepare(esql).all(...eargs);
    if (!emps.length) return res.json({ mode, rows: [] });
    const empIds = emps.map((e) => e.id);
    const ph = empIds.map(() => '?').join(',');
    const empById = new Map(emps.map((e) => [e.id, e]));

    const vnHM = (iso) => { if (!iso) return ''; const t = new Date(new Date(iso).getTime() + 7 * 3600000); return String(t.getUTCHours()).padStart(2, '0') + ':' + String(t.getUTCMinutes()).padStart(2, '0'); };
    const addDay = (d) => new Date(new Date(d + 'T00:00:00Z').getTime() + 86400000).toISOString().slice(0, 10);

    // Nghỉ đã duyệt phủ theo từng ngày
    const leaves = db.prepare(`SELECT * FROM leave_requests WHERE status='approved' AND employee_id IN (${ph}) AND from_date<=? AND to_date>=?`).all(...empIds, to, from);
    const leaveSym = { 'Nghỉ phép': 'P', 'Nghỉ không lương': 'KL', 'Công tác': 'CT', 'Khác': 'K' };
    const leaveMap = new Map();
    for (const l of leaves) {
      let d = l.from_date < from ? from : l.from_date; const end = l.to_date > to ? to : l.to_date;
      while (d <= end) { leaveMap.set(l.employee_id + '|' + d, { sym: leaveSym[l.type] || 'N', type: l.type }); d = addDay(d); }
    }

    if (mode === 'summary') {
      const att = db.prepare(`SELECT employee_id, work_date, check_in_at, work_unit, work_minutes, ot_min, late_min, early_min FROM attendance WHERE employee_id IN (${ph}) AND work_date>=? AND work_date<=?`).all(...empIds, from, to);
      const agg = new Map();
      for (const e of emps) agg.set(e.id, { id: e.id, code: e.code, name: e.full_name, dept: e.department || '', cong: 0, minutes: 0, ot: 0, lateN: 0, lateM: 0, earlyN: 0, earlyM: 0, leaveN: 0, days: 0 });
      for (const a of att) { const g = agg.get(a.employee_id); if (!g) continue; g.cong += a.work_unit || 0; g.minutes += a.work_minutes || 0; g.ot += a.ot_min || 0; if (a.late_min > 0) { g.lateN++; g.lateM += a.late_min; } if (a.early_min > 0) { g.earlyN++; g.earlyM += a.early_min; } if (a.check_in_at) g.days++; }
      for (const key of leaveMap.keys()) { const g = agg.get(+key.split('|')[0]); if (g) g.leaveN++; }
      const r2 = (n) => Math.round(n * 100) / 100;
      const rows = [...agg.values()].map((g) => ({ id: g.id, code: g.code, name: g.name, dept: g.dept, cong: r2(g.cong), gio: r2(g.minutes / 60), ot: r2(g.ot / 60), lateN: g.lateN, lateM: g.lateM, earlyN: g.earlyN, earlyM: g.earlyM, leaveN: g.leaveN, days: g.days }));
      return res.json({ mode, rows });
    }

    // detail
    const att = db.prepare(`SELECT a.*, s.name shift_name FROM attendance a LEFT JOIN shifts s ON s.id=a.shift_id
      WHERE a.employee_id IN (${ph}) AND a.work_date>=? AND a.work_date<=?`).all(...empIds, from, to);
    const punches = db.prepare(`SELECT employee_id, work_date, punch_at FROM device_punches WHERE employee_id IN (${ph}) AND work_date>=? AND work_date<=? ORDER BY punch_at`).all(...empIds, from, to);
    const punchMap = new Map();
    for (const p of punches) { const k = p.employee_id + '|' + p.work_date; if (!punchMap.has(k)) punchMap.set(k, []); punchMap.get(k).push(vnHM(p.punch_at)); }

    const rows = []; const seen = new Set();
    for (const a of att) {
      const e = empById.get(a.employee_id); if (!e) continue;
      const key = a.employee_id + '|' + a.work_date; seen.add(key);
      const lv = leaveMap.get(key);
      rows.push({
        date: a.work_date, wd: WDVN[vnWd(a.work_date)], employee_id: a.employee_id, code: e.code, name: e.full_name, dept: e.department || '',
        shift: a.shift_name || '', in: vnHM(a.check_in_at), out: vnHM(a.check_out_at),
        punches: punchMap.get(key) || [], late: a.late_min || 0, early: a.early_min || 0, ot: a.ot_min || 0,
        cong: Math.round((a.work_unit || 0) * 100) / 100, leave: lv ? lv.sym : '',
        status: a.check_out_at ? (a.late_min > 0 ? 'Đi muộn' : a.early_min > 0 ? 'Về sớm' : 'Đủ công') : (a.check_in_at ? 'Thiếu ra' : ''),
        att_id: a.id,
      });
    }
    for (const [key, lv] of leaveMap) {   // ngày CHỈ có nghỉ (không có bản ghi chấm)
      if (seen.has(key)) continue;
      const [eid, d] = key.split('|'); const e = empById.get(+eid); if (!e) continue;
      rows.push({ date: d, wd: WDVN[vnWd(d)], employee_id: +eid, code: e.code, name: e.full_name, dept: e.department || '',
        shift: '', in: '', out: '', punches: [], late: 0, early: 0, ot: 0, cong: 0, leave: lv.sym, status: lv.type, att_id: null });
    }
    rows.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return res.json({ mode, rows });
  });

  /* -------------------- SỬA / THÊM / XOÁ GIỜ CHẤM (bằng tay) -------------------- */
  // Danh sách chấm công của 1 NV theo tháng (để sửa)
  r.get('/attendance', need('attendance_edit'), (req, res) => {
    const eid = +req.query.employee_id;
    const month = (req.query.month || '').slice(0, 7);
    if (!eid || !month) return res.status(400).json({ error: 'Thiếu nhân viên hoặc tháng' });
    const rows = db.prepare('SELECT * FROM attendance WHERE employee_id=? AND work_date LIKE ? ORDER BY work_date').all(eid, month + '%');
    res.json({ rows });
  });

  // Thêm / cập nhật giờ chấm cho 1 ngày (upsert theo employee_id + work_date)
  r.post('/attendance', need('attendance_edit'), (req, res) => {
    const b = req.body || {};
    const eid = +b.employee_id;
    const date = (b.work_date || '').slice(0, 10);
    if (!eid || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Thiếu nhân viên hoặc ngày hợp lệ' });
    if (!db.prepare('SELECT 1 FROM employees WHERE id=?').get(eid)) return res.status(404).json({ error: 'Không tìm thấy nhân viên' });
    let inIso = vnToIso(date, b.check_in);
    let outIso = vnToIso(date, b.check_out);
    if (inIso && outIso && new Date(outIso) <= new Date(inIso)) outIso = new Date(new Date(outIso).getTime() + 86400000).toISOString(); // qua đêm
    const m = computeManual(eid, date, inIso, outIso);
    // Khoá theo (NV, ngày, CA) → cho phép thêm nhiều ca/ngày (VD ca gãy sáng + chiều)
    const existing = db.prepare('SELECT id FROM attendance WHERE employee_id=? AND work_date=? AND COALESCE(shift_id,0)=COALESCE(?,0)').get(eid, date, m.shiftId ?? null);
    if (existing) {
      db.prepare(`UPDATE attendance SET check_in_at=?, check_out_at=?, late_min=?, early_min=?, ot_min=?,
        work_minutes=?, work_unit=?, day_status=?, ot_type=?, shift_id=?, shift_source='manual', manual=1, note=? WHERE id=?`)
        .run(inIso, outIso, m.late, m.early_min, m.ot_min, m.work_minutes, m.work_unit, m.day_status, m.ot_type, m.shiftId, b.note || '', existing.id);
      return res.json({ ok: true, id: existing.id, updated: true });
    }
    const info = db.prepare(`INSERT INTO attendance
      (employee_id, work_date, check_in_at, check_out_at, late_min, early_min, ot_min, work_minutes, work_unit, day_status, ot_type, shift_id, shift_source, manual, note)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'manual', 1, ?)`)
      .run(eid, date, inIso, outIso, m.late, m.early_min, m.ot_min, m.work_minutes, m.work_unit, m.day_status, m.ot_type, m.shiftId, b.note || '');
    res.json({ ok: true, id: info.lastInsertRowid });
  });

  // Sửa giờ 1 bản ghi có sẵn
  r.put('/attendance/:id', need('attendance_edit'), (req, res) => {
    const b = req.body || {};
    const row = db.prepare('SELECT * FROM attendance WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Không tìm thấy bản ghi' });
    let inIso = b.check_in !== undefined ? vnToIso(row.work_date, b.check_in) : row.check_in_at;
    let outIso = b.check_out !== undefined ? vnToIso(row.work_date, b.check_out) : row.check_out_at;
    if (inIso && outIso && new Date(outIso) <= new Date(inIso)) outIso = new Date(new Date(outIso).getTime() + 86400000).toISOString();
    const m = computeManual(row.employee_id, row.work_date, inIso, outIso);
    db.prepare(`UPDATE attendance SET check_in_at=?, check_out_at=?, late_min=?, early_min=?, ot_min=?,
      work_minutes=?, work_unit=?, day_status=?, ot_type=?, shift_id=?, shift_source='manual', manual=1, note=? WHERE id=?`)
      .run(inIso, outIso, m.late, m.early_min, m.ot_min, m.work_minutes, m.work_unit, m.day_status, m.ot_type, m.shiftId, b.note ?? row.note ?? '', row.id);
    res.json({ ok: true });
  });

  // Xoá 1 bản ghi chấm công
  r.delete('/attendance/:id', need('attendance_edit'), (req, res) => {
    const row = db.prepare('SELECT id FROM attendance WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Không tìm thấy bản ghi' });
    db.prepare('DELETE FROM attendance WHERE id=?').run(row.id);
    res.json({ ok: true });
  });

  // Xóa dữ liệu chấm công TRONG PHẦN MỀM theo khoảng ngày (không đụng máy)
  r.post('/attendance/clear-range', need('attendance_edit'), (req, res) => {
    const from = (req.body?.from || '').slice(0, 10), to = (req.body?.to || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return res.status(400).json({ error: 'Thiếu khoảng ngày hợp lệ' });
    if (to < from) return res.status(400).json({ error: 'Đến ngày phải sau Từ ngày' });
    const a = db.prepare('DELETE FROM attendance WHERE work_date >= ? AND work_date <= ?').run(from, to).changes;
    const p = db.prepare('DELETE FROM device_punches WHERE work_date >= ? AND work_date <= ?').run(from, to).changes;
    res.json({ ok: true, attendance: a, punches: p });
  });
}
