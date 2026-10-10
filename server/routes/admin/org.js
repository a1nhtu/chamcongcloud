// Nhóm route DANH MỤC TỔ CHỨC: lịch trình ca, bộ phận, chức danh, chi nhánh/định vị, ca làm.
import { db, adminAttWhere } from '../../db.js';
import { sendCaughtError } from '../../util.js';

// Lưu các tùy chọn tăng ca nâng cao / bù trừ / thiếu giờ ra của ca (trường nào không gửi thì giữ giá trị cũ)
const SHIFT_EXTRA = {
  ot_before: 'bool', ot_before_min: 'int', ot_tier1_min: 'int', ot_tier2_min: 'int', ot_tier3_min: 'int',
  ot_tier2_rate: 'num', ot_tier3_rate: 'num', ot_tier4_rate: 'num',
  weekend_as_ot: 'bool', holiday_as_ot: 'bool', compensate_late: 'bool', no_out_credit: 'bool',
  grace_deduct: 'bool', shift_as_ot: 'bool',
};
function saveShiftExtra(id, b, old) {
  const keys = Object.keys(SHIFT_EXTRA).filter((k) => b[k] !== undefined);
  if (!keys.length) return;
  const val = (k) => {
    const t = SHIFT_EXTRA[k], v = b[k];
    if (t === 'bool') return v ? 1 : 0;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return old[k] ?? 0;
    return t === 'int' ? Math.round(n) : n;
  };
  db.prepare(`UPDATE shifts SET ${keys.map((k) => k + '=?').join(', ')} WHERE id=?`).run(...keys.map(val), id);
}

// Đọc phần "chu kỳ" của lịch trình từ body: unit (auto|week|day|month), cycle, days:[{ idx, shift_ids:[...] }]
function schedPattern(b) {
  const unit = ['week', 'day', 'month'].includes(b.unit) ? b.unit : 'auto';
  const cycle = Math.min(unit === 'day' ? 62 : 12, Math.max(1, parseInt(b.cycle, 10) || 1));
  const maxIdx = unit === 'week' ? cycle * 7 : unit === 'month' ? cycle * 31 : unit === 'day' ? cycle : 0;
  const cells = [];
  if (unit !== 'auto') for (const d of (Array.isArray(b.days) ? b.days : [])) {
    const idx = parseInt(d.idx, 10);
    if (!(idx >= 0 && idx < maxIdx)) continue;
    for (const sid of [...new Set((d.shift_ids || (d.shift_id ? [d.shift_id] : [])).map(Number).filter(Boolean))]) cells.push([idx, sid]);
  }
  return { unit, cycle, cells, shiftIds: [...new Set(cells.map((c) => c[1]))] };
}
function saveSchedDays(wsId, pat) {
  db.prepare('DELETE FROM work_schedule_days WHERE work_schedule_id = ?').run(wsId);
  const ins = db.prepare('INSERT OR IGNORE INTO work_schedule_days(work_schedule_id, idx, shift_id) VALUES (?,?,?)');
  for (const [idx, sid] of pat.cells) ins.run(wsId, idx, sid);
}

export function registerOrgRoutes(r, { need }) {
  /* ----------------------------- LỊCH TRÌNH CA ----------------------------- */
  r.get('/schedules', (req, res) => {
    const rows = db.prepare('SELECT * FROM work_schedules WHERE active = 1 ORDER BY name').all();
    const links = db.prepare(`SELECT wss.work_schedule_id, wss.shift_id, wss.sort_order, s.name, s.code, s.start_time, s.end_time
      FROM work_schedule_shifts wss JOIN shifts s ON s.id = wss.shift_id WHERE s.active = 1 ORDER BY wss.sort_order`).all();
    const days = db.prepare('SELECT work_schedule_id, idx, shift_id FROM work_schedule_days').all();
    for (const ws of rows) { ws.shifts = links.filter((l) => l.work_schedule_id === ws.id); ws.days = days.filter((d) => d.work_schedule_id === ws.id).map((d) => ({ idx: d.idx, shift_id: d.shift_id })); }
    res.json({ rows });
  });
  r.post('/schedules', need('shifts'), (req, res) => {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'Nhập tên lịch trình' });
    const pat = schedPattern(b);
    const ids = pat.unit === 'auto' ? (Array.isArray(b.shift_ids) ? b.shift_ids.map(Number).filter(Boolean) : []) : pat.shiftIds;
    if (!ids.length) return res.status(400).json({ error: pat.unit === 'auto' ? 'Chọn ít nhất 1 ca cho lịch trình' : 'Chưa gán ca vào ngày nào trong lịch trình' });
    db.exec('BEGIN');
    try {
      const info = db.prepare('INSERT INTO work_schedules(code, name, description, unit, cycle) VALUES (?,?,?,?,?)').run(b.code || '', b.name.trim(), b.description || '', pat.unit, pat.cycle);
      const wsId = info.lastInsertRowid;
      const ins = db.prepare('INSERT OR IGNORE INTO work_schedule_shifts(work_schedule_id, shift_id, sort_order) VALUES (?,?,?)');
      ids.forEach((sid, i) => ins.run(wsId, sid, i));
      saveSchedDays(wsId, pat);
      db.exec('COMMIT');
      res.json({ ok: true, id: wsId });
    } catch (e) { db.exec('ROLLBACK'); sendCaughtError(res, 'POST /admin/schedules', e); }
  });
  r.put('/schedules/:id', need('shifts'), (req, res) => {
    const b = req.body || {};
    const ws = db.prepare('SELECT * FROM work_schedules WHERE id = ?').get(req.params.id);
    if (!ws) return res.status(404).json({ error: 'Không tìm thấy lịch trình' });
    const pat = b.unit != null ? schedPattern(b) : null;   // có gửi unit = sửa cả kiểu chu kỳ
    const ids = pat && pat.unit !== 'auto' ? pat.shiftIds : (Array.isArray(b.shift_ids) ? b.shift_ids.map(Number).filter(Boolean) : null);
    if (pat && !ids?.length) return res.status(400).json({ error: pat.unit === 'auto' ? 'Chọn ít nhất 1 ca cho lịch trình' : 'Chưa gán ca vào ngày nào trong lịch trình' });
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE work_schedules SET code=?, name=?, description=?, active=? WHERE id=?').run(
        b.code ?? ws.code, b.name ?? ws.name, b.description ?? ws.description,
        b.active != null ? (b.active ? 1 : 0) : ws.active, ws.id);
      if (pat) { db.prepare('UPDATE work_schedules SET unit=?, cycle=? WHERE id=?').run(pat.unit, pat.cycle, ws.id); saveSchedDays(ws.id, pat); }
      if (ids) {
        db.prepare('DELETE FROM work_schedule_shifts WHERE work_schedule_id = ?').run(ws.id);
        const ins = db.prepare('INSERT OR IGNORE INTO work_schedule_shifts(work_schedule_id, shift_id, sort_order) VALUES (?,?,?)');
        ids.forEach((sid, i) => ins.run(ws.id, sid, i));
      }
      db.exec('COMMIT');
      res.json({ ok: true });
    } catch (e) { db.exec('ROLLBACK'); sendCaughtError(res, 'PUT /admin/schedules/:id', e); }
  });
  r.delete('/schedules/:id', need('shifts'), (req, res) => {
    const used = db.prepare('SELECT COUNT(*) c FROM employees WHERE work_schedule_id = ? AND active = 1').get(req.params.id).c;
    if (used > 0) return res.status(400).json({ error: `Còn ${used} nhân viên đang dùng lịch trình này` });
    const used2 = db.prepare('SELECT COUNT(*) c FROM shift_assignments WHERE work_schedule_id = ? AND active = 1').get(req.params.id).c
      + db.prepare('SELECT COUNT(*) c FROM dept_shift_assignments WHERE work_schedule_id = ? AND active = 1').get(req.params.id).c;
    if (used2 > 0) return res.status(400).json({ error: `Lịch trình này đang được gán ở ${used2} dòng Lịch trình nhân viên / phòng ban. Xoá các dòng đó trước.` });
    db.prepare('UPDATE work_schedules SET active = 0 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  /* ----------------------------- LỊCH TRÌNH VÀO RA ----------------------------- */
  const IO_RULES = ['filo', 'pairs', 'tdqd', 'idm', 'state', 'tdhc'];
  const ioBody = (b, old = {}) => ({
    code: String(b.code ?? old.code ?? '').trim(), name: String(b.name ?? old.name ?? '').trim(),
    rule: IO_RULES.includes(b.rule) ? b.rule : (old.rule || 'filo'),
    min: Math.max(0, parseInt(b.min_minutes ?? old.min_minutes ?? 30, 10) || 0),
    max: Math.max(0, parseInt(b.max_minutes ?? old.max_minutes ?? 960, 10) || 0),
    gap: Math.max(0, parseInt(b.gap_minutes ?? old.gap_minutes ?? 30, 10) || 0),
    def: (b.is_default != null ? b.is_default : old.is_default) ? 1 : 0,
  });
  r.get('/inout-schedules', (req, res) => {
    res.json({ rows: db.prepare('SELECT * FROM inout_schedules WHERE active = 1 ORDER BY is_default DESC, name').all() });
  });
  r.post('/inout-schedules', need('shifts'), (req, res) => {
    const v = ioBody(req.body || {});
    if (!v.name) return res.status(400).json({ error: 'Nhập tên lịch trình vào ra' });
    if (v.def) db.prepare('UPDATE inout_schedules SET is_default = 0').run();
    const first = !db.prepare('SELECT 1 FROM inout_schedules WHERE active = 1').get();   // lịch trình đầu tiên tự là mặc định
    const info = db.prepare('INSERT INTO inout_schedules(code, name, rule, min_minutes, max_minutes, gap_minutes, is_default) VALUES (?,?,?,?,?,?,?)')
      .run(v.code, v.name, v.rule, v.min, v.max, v.gap, v.def || first ? 1 : 0);
    res.json({ ok: true, id: info.lastInsertRowid });
  });
  r.put('/inout-schedules/:id', need('shifts'), (req, res) => {
    const old = db.prepare('SELECT * FROM inout_schedules WHERE id = ?').get(req.params.id);
    if (!old) return res.status(404).json({ error: 'Không tìm thấy lịch trình vào ra' });
    const v = ioBody(req.body || {}, old);
    if (!v.name) return res.status(400).json({ error: 'Nhập tên lịch trình vào ra' });
    if (v.def) db.prepare('UPDATE inout_schedules SET is_default = 0 WHERE id <> ?').run(old.id);
    db.prepare('UPDATE inout_schedules SET code=?, name=?, rule=?, min_minutes=?, max_minutes=?, gap_minutes=?, is_default=? WHERE id=?')
      .run(v.code, v.name, v.rule, v.min, v.max, v.gap, v.def, old.id);
    res.json({ ok: true });
  });
  r.delete('/inout-schedules/:id', need('shifts'), (req, res) => {
    const used = db.prepare('SELECT COUNT(*) c FROM shift_assignments WHERE inout_schedule_id = ? AND active = 1').get(req.params.id).c
      + db.prepare('SELECT COUNT(*) c FROM dept_shift_assignments WHERE inout_schedule_id = ? AND active = 1').get(req.params.id).c;
    if (used > 0) return res.status(400).json({ error: `Lịch trình vào ra này đang được gán ở ${used} dòng gán ca. Xoá hoặc đổi các dòng đó trước.` });
    db.prepare('UPDATE inout_schedules SET active = 0, is_default = 0 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });
  // Bỏ quy tắc ghép giờ riêng còn lưu ở ca (kiểu cũ) → ca dùng theo Lịch trình vào ra
  r.post('/shifts/:id/clear-merge-rule', need('shifts'), (req, res) => {
    db.prepare("UPDATE shifts SET merge_rule = 'filo' WHERE id = ?").run(req.params.id);
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
    } catch (e) {
      if (/UNIQUE/.test(e.message)) return res.status(400).json({ error: 'Bộ phận đã tồn tại' });
      sendCaughtError(res, 'POST /admin/departments', e, { status: 400 });
    }
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
    } catch (e) {
      if (/UNIQUE/.test(e.message)) return res.status(400).json({ error: 'Bộ phận đã tồn tại' });
      sendCaughtError(res, 'PUT /admin/departments/:id', e, { status: 400 });
    }
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
    } catch (e) {
      if (/UNIQUE/.test(e.message)) return res.status(400).json({ error: 'Chức danh đã tồn tại' });
      sendCaughtError(res, 'POST /admin/positions', e, { status: 400 });
    }
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
    const id = req.params.id;
    // Xoá HẲN (force): gỡ gán NV + bỏ liên kết lịch sử chấm rồi xoá khỏi CSDL
    if (req.query.force === '1') {
      db.prepare('DELETE FROM employee_offices WHERE office_id=?').run(id);
      db.prepare('UPDATE employees SET office_id=NULL WHERE office_id=?').run(id);
      db.prepare('UPDATE attendance SET check_in_office_id=NULL WHERE check_in_office_id=?').run(id);
      db.prepare('DELETE FROM offices WHERE id=?').run(id);
      return res.json({ ok: true, hard: true, forced: true });
    }
    // Còn NV đang gán / còn lịch sử chấm công → chỉ TẮT (giữ dữ liệu); chưa dùng → XÓA HẲN
    const empCnt = db.prepare('SELECT COUNT(*) c FROM employees WHERE office_id=?').get(id).c
      + db.prepare('SELECT COUNT(*) c FROM employee_offices WHERE office_id=?').get(id).c;
    const attCnt = db.prepare('SELECT COUNT(*) c FROM attendance WHERE check_in_office_id=?').get(id).c;
    if (empCnt === 0 && attCnt === 0) {
      db.prepare('DELETE FROM offices WHERE id=?').run(id);
      return res.json({ ok: true, hard: true });
    }
    db.prepare('UPDATE offices SET active = 0 WHERE id = ?').run(id);
    res.json({ ok: true, hard: false, reason: empCnt ? 'còn nhân viên được gán' : 'còn lịch sử chấm công' });
  });

  // Nhân viên được phép chấm ở 1 định vị (quản lý từ phía định vị cho nhanh)
  r.get('/offices/:id/employees', need('offices'), (req, res) => {
    const oid = +req.params.id;
    const emps = db.prepare("SELECT id, code, full_name, department FROM employees WHERE active=1" + adminAttWhere() + " ORDER BY department, full_name").all();
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
    } catch (e) { db.exec('ROLLBACK'); return sendCaughtError(res, 'POST /admin/offices/:id/employees', e); }
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
    saveShiftExtra(info.lastInsertRowid, b, {});
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
    saveShiftExtra(s.id, b, s);
    res.json({ ok: true });
  });
  r.delete('/shifts/:id', need('shifts'), (req, res) => {
    db.prepare('UPDATE shifts SET active = 0 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });
}
