// Nhóm route DANH MỤC TỔ CHỨC: lịch trình ca, bộ phận, chức danh, chi nhánh/định vị, ca làm.
import { db } from '../../db.js';

export function registerOrgRoutes(r, { need }) {
  /* ----------------------------- LỊCH TRÌNH CA ----------------------------- */
  r.get('/schedules', (req, res) => {
    const rows = db.prepare('SELECT * FROM work_schedules WHERE active = 1 ORDER BY name').all();
    const links = db.prepare(`SELECT wss.work_schedule_id, wss.shift_id, wss.sort_order, s.name, s.code, s.start_time, s.end_time
      FROM work_schedule_shifts wss JOIN shifts s ON s.id = wss.shift_id WHERE s.active = 1 ORDER BY wss.sort_order`).all();
    for (const ws of rows) ws.shifts = links.filter((l) => l.work_schedule_id === ws.id);
    res.json({ rows });
  });
  r.post('/schedules', need('shifts'), (req, res) => {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'Nhập tên lịch trình' });
    const ids = Array.isArray(b.shift_ids) ? b.shift_ids.map(Number).filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ error: 'Chọn ít nhất 1 ca cho lịch trình' });
    db.exec('BEGIN');
    try {
      const info = db.prepare('INSERT INTO work_schedules(code, name, description) VALUES (?,?,?)').run(b.code || '', b.name.trim(), b.description || '');
      const wsId = info.lastInsertRowid;
      const ins = db.prepare('INSERT OR IGNORE INTO work_schedule_shifts(work_schedule_id, shift_id, sort_order) VALUES (?,?,?)');
      ids.forEach((sid, i) => ins.run(wsId, sid, i));
      db.exec('COMMIT');
      res.json({ ok: true, id: wsId });
    } catch (e) { db.exec('ROLLBACK'); res.status(500).json({ error: e.message }); }
  });
  r.put('/schedules/:id', need('shifts'), (req, res) => {
    const b = req.body || {};
    const ws = db.prepare('SELECT * FROM work_schedules WHERE id = ?').get(req.params.id);
    if (!ws) return res.status(404).json({ error: 'Không tìm thấy lịch trình' });
    const ids = Array.isArray(b.shift_ids) ? b.shift_ids.map(Number).filter(Boolean) : null;
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE work_schedules SET code=?, name=?, description=?, active=? WHERE id=?').run(
        b.code ?? ws.code, b.name ?? ws.name, b.description ?? ws.description,
        b.active != null ? (b.active ? 1 : 0) : ws.active, ws.id);
      if (ids) {
        db.prepare('DELETE FROM work_schedule_shifts WHERE work_schedule_id = ?').run(ws.id);
        const ins = db.prepare('INSERT OR IGNORE INTO work_schedule_shifts(work_schedule_id, shift_id, sort_order) VALUES (?,?,?)');
        ids.forEach((sid, i) => ins.run(ws.id, sid, i));
      }
      db.exec('COMMIT');
      res.json({ ok: true });
    } catch (e) { db.exec('ROLLBACK'); res.status(500).json({ error: e.message }); }
  });
  r.delete('/schedules/:id', need('shifts'), (req, res) => {
    const used = db.prepare('SELECT COUNT(*) c FROM employees WHERE work_schedule_id = ? AND active = 1').get(req.params.id).c;
    if (used > 0) return res.status(400).json({ error: `Còn ${used} nhân viên đang dùng lịch trình này` });
    db.prepare('UPDATE work_schedules SET active = 0 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  /* ----------------------------- BỘ PHẬN ----------------------------- */
  r.get('/departments', (req, res) => {
    res.json({ rows: db.prepare('SELECT id, name, parent_id FROM departments ORDER BY name').all() });
  });
  r.post('/departments', need('departments'), (req, res) => {
    const name = (req.body?.name || '').trim();
    const parent_id = req.body?.parent_id ? +req.body.parent_id : null;
    if (!name) return res.status(400).json({ error: 'Nhập tên bộ phận' });
    if (parent_id && !db.prepare('SELECT 1 FROM departments WHERE id=?').get(parent_id))
      return res.status(400).json({ error: 'Bộ phận cha không hợp lệ' });
    try {
      const info = db.prepare('INSERT INTO departments(name, parent_id) VALUES(?,?)').run(name, parent_id);
      res.json({ ok: true, id: info.lastInsertRowid, name });
    } catch (e) { res.status(400).json({ error: /UNIQUE/.test(e.message) ? 'Bộ phận đã tồn tại' : e.message }); }
  });
  r.put('/departments/:id', need('departments'), (req, res) => {
    const d = db.prepare('SELECT * FROM departments WHERE id=?').get(req.params.id);
    if (!d) return res.status(404).json({ error: 'Không tìm thấy' });
    const name = req.body?.name != null ? String(req.body.name).trim() : d.name;
    let parent_id = req.body?.parent_id !== undefined ? (req.body.parent_id ? +req.body.parent_id : null) : d.parent_id;
    if (parent_id === +req.params.id) return res.status(400).json({ error: 'Bộ phận không thể là cha của chính nó' });
    try {
      // đổi tên bộ phận → cập nhật luôn tên đang lưu ở nhân viên (department lưu theo tên)
      if (name !== d.name) db.prepare('UPDATE employees SET department=? WHERE department=?').run(name, d.name);
      db.prepare('UPDATE departments SET name=?, parent_id=? WHERE id=?').run(name, parent_id, d.id);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: /UNIQUE/.test(e.message) ? 'Bộ phận đã tồn tại' : e.message }); }
  });
  r.delete('/departments/:id', need('departments'), (req, res) => {
    const d = db.prepare('SELECT name FROM departments WHERE id = ?').get(req.params.id);
    if (!d) return res.status(404).json({ error: 'Không tìm thấy' });
    const children = db.prepare('SELECT COUNT(*) c FROM departments WHERE parent_id = ?').get(req.params.id).c;
    if (children > 0) return res.status(400).json({ error: `Bộ phận này còn ${children} bộ phận con — xoá con trước` });
    const used = db.prepare('SELECT COUNT(*) c FROM employees WHERE department = ? AND active = 1').get(d.name).c;
    if (used > 0) return res.status(400).json({ error: `Còn ${used} nhân viên thuộc bộ phận này` });
    db.prepare('DELETE FROM departments WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  /* -------- Chức danh (danh mục để chọn khi khai báo NV) -------- */
  r.get('/positions', (req, res) => {
    res.json({ rows: db.prepare('SELECT id, name FROM positions ORDER BY name').all() });
  });
  r.post('/positions', need('departments'), (req, res) => {
    const name = (req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Nhập tên chức danh' });
    try {
      const info = db.prepare('INSERT INTO positions(name) VALUES(?)').run(name);
      res.json({ ok: true, id: info.lastInsertRowid, name });
    } catch (e) { res.status(400).json({ error: /UNIQUE/.test(e.message) ? 'Chức danh đã tồn tại' : e.message }); }
  });
  r.delete('/positions/:id', need('departments'), (req, res) => {
    const p = db.prepare('SELECT name FROM positions WHERE id=?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Không tìm thấy' });
    const used = db.prepare('SELECT COUNT(*) c FROM employees WHERE position = ? AND active = 1').get(p.name).c;
    if (used > 0) return res.status(400).json({ error: `Còn ${used} nhân viên đang giữ chức danh này` });
    db.prepare('DELETE FROM positions WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  });

  /* ----------------------------- CHI NHÁNH / VỊ TRÍ ----------------------------- */
  r.get('/offices', (req, res) => {
    res.json({ rows: db.prepare('SELECT * FROM offices ORDER BY active DESC, name').all() });
  });
  r.post('/offices', need('offices'), (req, res) => {
    const b = req.body || {};
    if (!b.name || b.lat == null || b.lng == null) return res.status(400).json({ error: 'Thiếu tên hoặc toạ độ' });
    const info = db.prepare(`INSERT INTO offices(name,address,lat,lng,radius_m,active)
      VALUES (?,?,?,?,?,1)`).run(b.name, b.address || '', b.lat, b.lng, b.radius_m || 200);
    res.json({ ok: true, id: info.lastInsertRowid });
  });
  r.put('/offices/:id', need('offices'), (req, res) => {
    const b = req.body || {};
    const o = db.prepare('SELECT * FROM offices WHERE id = ?').get(req.params.id);
    if (!o) return res.status(404).json({ error: 'Không tìm thấy chi nhánh' });
    db.prepare('UPDATE offices SET name=?, address=?, lat=?, lng=?, radius_m=?, active=? WHERE id=?').run(
      b.name ?? o.name, b.address ?? o.address, b.lat ?? o.lat, b.lng ?? o.lng,
      b.radius_m ?? o.radius_m, b.active != null ? (b.active ? 1 : 0) : o.active, o.id);
    res.json({ ok: true });
  });
  r.delete('/offices/:id', need('offices'), (req, res) => {
    db.prepare('UPDATE offices SET active = 0 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // Nhân viên được phép chấm ở 1 định vị (quản lý từ phía định vị cho nhanh)
  r.get('/offices/:id/employees', need('offices'), (req, res) => {
    const oid = +req.params.id;
    const emps = db.prepare("SELECT id, code, full_name, department FROM employees WHERE active=1 AND role!='admin' ORDER BY department, full_name").all();
    const picked = new Set(db.prepare('SELECT employee_id FROM employee_offices WHERE office_id=?').all(oid).map((r) => r.employee_id));
    // NV chưa cấu hình định vị nào = được chấm mọi nơi (mặc định)
    const restricted = new Set(db.prepare('SELECT DISTINCT employee_id FROM employee_offices').all().map((r) => r.employee_id));
    for (const e of emps) { e.picked = picked.has(e.id); e.anywhere = !restricted.has(e.id); }
    res.json({ rows: emps });
  });

  // Đặt danh sách NV được phép chấm ở định vị này (thay toàn bộ cho office này)
  r.post('/offices/:id/employees', need('offices'), (req, res) => {
    const oid = +req.params.id;
    const ids = Array.isArray(req.body?.employee_ids) ? req.body.employee_ids.filter(Boolean).map(Number) : [];
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM employee_offices WHERE office_id=?').run(oid);
      const ins = db.prepare('INSERT OR IGNORE INTO employee_offices(employee_id, office_id) VALUES (?,?)');
      for (const eid of ids) ins.run(eid, oid);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); return res.status(500).json({ error: e.message }); }
    res.json({ ok: true, count: ids.length });
  });

  /* ----------------------------- CA LÀM ----------------------------- */
  r.get('/shifts', (req, res) => {
    res.json({ rows: db.prepare('SELECT * FROM shifts ORDER BY active DESC, name').all() });
  });
  r.post('/shifts', need('shifts'), (req, res) => {
    const b = req.body || {};
    if (!b.name || !b.start_time || !b.end_time) return res.status(400).json({ error: 'Thiếu tên hoặc giờ ca' });
    const info = db.prepare(`INSERT INTO shifts
      (name,start_time,end_time,late_grace_min,work_days,active,
       break_minutes,early_grace_min,work_unit_value,allow_ot,ot_start_after_min,ot_rounding_unit,
       code,check_in_start,check_in_end,check_out_start,check_out_end,merge_rule,cross_midnight,tdqd_mode)
      VALUES (?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        b.name, b.start_time, b.end_time, b.late_grace_min || 0, b.work_days || '1,2,3,4,5,6',
        b.break_minutes || 0, b.early_grace_min ?? 15, b.work_unit_value ?? 1.0,
        b.allow_ot ? 1 : 0, b.ot_start_after_min ?? 30, b.ot_rounding_unit || 0,
        (b.code || '').trim(), b.check_in_start || null, b.check_in_end || null, b.check_out_start || null, b.check_out_end || null,
        b.merge_rule || 'filo', b.cross_midnight ? 1 : 0, b.tdqd_mode || 'pair');
    res.json({ ok: true, id: info.lastInsertRowid });
  });
  r.put('/shifts/:id', need('shifts'), (req, res) => {
    const b = req.body || {};
    const s = db.prepare('SELECT * FROM shifts WHERE id = ?').get(req.params.id);
    if (!s) return res.status(404).json({ error: 'Không tìm thấy ca' });
    db.prepare(`UPDATE shifts SET name=?, start_time=?, end_time=?, late_grace_min=?, work_days=?, active=?,
      break_minutes=?, early_grace_min=?, work_unit_value=?, allow_ot=?, ot_start_after_min=?, ot_rounding_unit=?,
      code=?, check_in_start=?, check_in_end=?, check_out_start=?, check_out_end=?, merge_rule=?, cross_midnight=?, tdqd_mode=? WHERE id=?`).run(
      b.name ?? s.name, b.start_time ?? s.start_time, b.end_time ?? s.end_time,
      b.late_grace_min ?? s.late_grace_min, b.work_days ?? s.work_days,
      b.active != null ? (b.active ? 1 : 0) : s.active,
      b.break_minutes ?? s.break_minutes, b.early_grace_min ?? s.early_grace_min,
      b.work_unit_value ?? s.work_unit_value, b.allow_ot != null ? (b.allow_ot ? 1 : 0) : s.allow_ot,
      b.ot_start_after_min ?? s.ot_start_after_min, b.ot_rounding_unit ?? s.ot_rounding_unit,
      b.code != null ? b.code.trim() : s.code, b.check_in_start !== undefined ? (b.check_in_start || null) : s.check_in_start,
      b.check_in_end !== undefined ? (b.check_in_end || null) : s.check_in_end,
      b.check_out_start !== undefined ? (b.check_out_start || null) : s.check_out_start,
      b.check_out_end !== undefined ? (b.check_out_end || null) : s.check_out_end,
      b.merge_rule ?? s.merge_rule, b.cross_midnight != null ? (b.cross_midnight ? 1 : 0) : s.cross_midnight,
      b.tdqd_mode ?? s.tdqd_mode, s.id);
    res.json({ ok: true });
  });
  r.delete('/shifts/:id', need('shifts'), (req, res) => {
    db.prepare('UPDATE shifts SET active = 0 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });
}
