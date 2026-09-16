import { Router, raw } from 'express';
import ExcelJS from 'exceljs';
import { db, getSetting, setSetting, resolveShift, resolveEffectiveShift } from '../db.js';
import { authRequired, roleRequired, hashPassword, permRequired, PERMISSIONS, effectivePermissions } from '../auth.js';
import { computeLate, computeCheckout, isWeekendDay, vnWeekday } from '../attendance-calc.js';
import { computePayrollTable } from '../payroll-calc.js';
import { licenseState } from '../license.js';
import { doBackup, listBackups, pruneBackups, backupPath, deleteBackup, stageRestore, doFullBackup, stageFullRestore } from '../backup.js';
import { rebuildDay, resyncNow, importUsbAttlog, importUsbUsers, deviceUserList, clearDeviceLog, clearDeviceAll, deleteDeviceUsers, clearDeviceAdmins, openDoor, queryDeviceUsers } from '../device-sync.js';
import { saveBrandLogo, removeBrandLogo } from '../storage.js';
import { getVapid, saveSubscription, removeSubscription, notifyManagers } from '../push.js';
import { checkUpdate, applyUpdate, currentVersion, updateConfig } from '../update.js';
import { networkInterfaces } from 'node:os';
function lanIPs() {
  const real = [], virt = [];
  // Adapter ảo (Hyper-V/WSL/VMware/VirtualBox/Docker/Bluetooth...) → xếp xuống cuối, không lấy làm IP chính
  const isVirtual = (name) => /vethernet|virtual|vmware|virtualbox|hyper-?v|wsl|loopback|default switch|docker|tap-|tailscale|zerotier|bluetooth|npcap/i.test(name);
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family !== 'IPv4' || ni.internal || /^169\.254\./.test(ni.address)) continue;
      (isVirtual(name) ? virt : real).push(ni.address);
    }
  }
  // Trong nhóm mạng thật, ưu tiên dải LAN phổ biến: 192.168.* → 10.* → còn lại
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
  real.sort((a, b) => rank(a) - rank(b));
  return [...real, ...virt];
}

const r = Router();
r.use(authRequired, roleRequired('admin', 'manager'));

const adminOnly = roleRequired('admin');
const need = (key) => permRequired(key); // yêu cầu quyền chi tiết (admin luôn qua)

// Danh mục quyền (cho giao diện dựng ô tích phân quyền)
r.get('/perm-catalog', (req, res) => res.json({ permissions: PERMISSIONS }));
const PERM_KEYS = PERMISSIONS.map(([k]) => k);
// Chuẩn hoá quyền để lưu: admin = null (toàn quyền); còn lại = JSON mảng key hợp lệ.
function normPerms(role, perms) {
  if (role === 'admin') return null;
  if (Array.isArray(perms)) return JSON.stringify(perms.filter((k) => PERM_KEYS.includes(k)));
  return null;
}

/* ----------------------------- NHÂN VIÊN ----------------------------- */
r.get('/employees', (req, res) => {
  const rows = db.prepare(`
    SELECT e.id,e.code,e.full_name,e.department,e.position,e.phone,e.role,e.username,
           e.active,e.office_id,e.shift_id,e.work_schedule_id,e.permissions,e.device_pin,e.from_device,
           e.device_id,e.pending_device,e.device_label,
           o.name AS office_name, s.name AS shift_name, ws.name AS schedule_name
    FROM employees e
    LEFT JOIN offices o ON o.id = e.office_id
    LEFT JOIN shifts s ON s.id = e.shift_id
    LEFT JOIN work_schedules ws ON ws.id = e.work_schedule_id
    ORDER BY e.active DESC, e.full_name`).all();
  // Danh sách định vị được phép chấm của từng NV
  const eoMap = new Map();
  for (const x of db.prepare('SELECT employee_id, office_id FROM employee_offices').all()) {
    if (!eoMap.has(x.employee_id)) eoMap.set(x.employee_id, []);
    eoMap.get(x.employee_id).push(x.office_id);
  }
  for (const e of rows) e.office_ids = eoMap.get(e.id) || [];
  res.json({ rows });
});

// Đặt danh sách định vị được phép chấm cho 1 NV (thay toàn bộ)
function setEmpOffices(empId, officeIds) {
  if (!Array.isArray(officeIds)) return;
  db.prepare('DELETE FROM employee_offices WHERE employee_id=?').run(empId);
  const ins = db.prepare('INSERT OR IGNORE INTO employee_offices(employee_id, office_id) VALUES (?,?)');
  for (const oid of officeIds) { if (oid) ins.run(empId, +oid); }
}

r.post('/employees', need('employees'), (req, res) => {
  const b = req.body || {};
  if (!b.code || !b.full_name || !b.username || !b.password)
    return res.status(400).json({ error: 'Thiếu mã NV, họ tên, tài khoản hoặc mật khẩu' });
  // Chống trùng mã NV + số ID máy chấm công
  const code0 = b.code.trim();
  if (db.prepare('SELECT 1 FROM employees WHERE code=?').get(code0))
    return res.status(400).json({ error: `Mã nhân viên "${code0}" đã tồn tại` });
  const pin0 = (b.device_pin || '').trim();
  if (pin0 && db.prepare("SELECT 1 FROM employees WHERE device_pin=? AND device_pin<>''").get(pin0))
    return res.status(400).json({ error: `Số ID máy chấm công "${pin0}" đã có nhân viên dùng` });
  const lic = licenseState();
  if (lic.maxEmp) {
    const cnt = db.prepare("SELECT COUNT(*) c FROM employees WHERE active = 1 AND role != 'admin'").get().c;
    if (cnt >= lic.maxEmp) return res.status(400).json({ error: `Bản quyền giới hạn ${lic.maxEmp} nhân viên. Liên hệ Digiplus để nâng gói.` });
  }
  try {
    const info = db.prepare(`INSERT INTO employees
      (code, full_name, department, position, phone, role, username, password_hash, office_id, shift_id, work_schedule_id, permissions, device_pin, active)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)`).run(
      b.code.trim(), b.full_name.trim(), b.department || '', b.position || '', b.phone || '',
      b.role || 'employee', b.username.trim(), hashPassword(b.password),
      (Array.isArray(b.office_ids) && b.office_ids.length ? +b.office_ids[0] : (b.office_id || null)),
      b.shift_id || null, b.work_schedule_id || null, normPerms(b.role, b.permissions),
      (b.device_pin || '').trim());
    setEmpOffices(info.lastInsertRowid, b.office_ids);
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: /UNIQUE/.test(e.message) ? 'Mã NV hoặc tài khoản đã tồn tại' : e.message });
  }
});

r.put('/employees/:id', need('employees'), (req, res) => {
  const b = req.body || {};
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Không tìm thấy nhân viên' });
  // Chống trùng mã NV khi đổi mã (loại trừ chính NV này)
  if (b.code != null && b.code.trim() !== emp.code
      && db.prepare('SELECT 1 FROM employees WHERE code=? AND id<>?').get(b.code.trim(), emp.id))
    return res.status(400).json({ error: `Mã nhân viên "${b.code.trim()}" đã tồn tại` });
  try {
    const newRole = b.role ?? emp.role;
    const newPerms = b.permissions !== undefined ? normPerms(newRole, b.permissions) : emp.permissions;
    // SỐ ID (device_pin): chỉ ĐẶT được khi đang TRỐNG (chưa có). Đã có rồi thì KHÓA, không đổi.
    if (b.device_pin !== undefined && !(emp.device_pin || '').trim()) {
      const pin1 = (b.device_pin || '').trim();
      if (pin1) {
        if (db.prepare("SELECT 1 FROM employees WHERE device_pin=? AND device_pin<>'' AND id<>?").get(pin1, emp.id))
          return res.status(400).json({ error: `Số ID máy chấm công "${pin1}" đã có nhân viên dùng` });
        db.prepare('UPDATE employees SET device_pin=? WHERE id=?').run(pin1, emp.id);
      }
    }
    db.prepare(`UPDATE employees SET code=?, full_name=?, department=?, position=?, phone=?,
      role=?, username=?, office_id=?, shift_id=?, work_schedule_id=?, permissions=?, active=? WHERE id=?`).run(
      b.code ?? emp.code, b.full_name ?? emp.full_name, b.department ?? emp.department,
      b.position ?? emp.position, b.phone ?? emp.phone, newRole,
      b.username ?? emp.username,
      (Array.isArray(b.office_ids) ? (b.office_ids.length ? +b.office_ids[0] : null) : (b.office_id ?? emp.office_id)),
      b.shift_id !== undefined ? (b.shift_id || null) : emp.shift_id,
      b.work_schedule_id !== undefined ? (b.work_schedule_id || null) : emp.work_schedule_id,
      newPerms,
      b.active != null ? (b.active ? 1 : 0) : emp.active, emp.id);
    if (b.office_ids !== undefined) setEmpOffices(emp.id, b.office_ids);
    if (b.password) db.prepare('UPDATE employees SET password_hash=? WHERE id=?').run(hashPassword(b.password), emp.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: /UNIQUE/.test(e.message) ? 'Mã NV hoặc tài khoản đã tồn tại' : e.message });
  }
});

// Vô hiệu hoá (không xoá cứng để giữ lịch sử chấm công) — nút "Khoá"
r.delete('/employees/:id', need('employees'), (req, res) => {
  db.prepare('UPDATE employees SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
// XÓA CỨNG nhân viên + toàn bộ dữ liệu liên quan (khác Khoá). Lượt quẹt máy thô được GỠ KHỚP
// (employee_id=NULL) chứ không xoá, để không mất log; NV nếu được tải lại từ máy sẽ tạo mới.
r.delete('/employees/:id/purge', need('employees'), (req, res) => {
  const emp = db.prepare('SELECT id, role FROM employees WHERE id=?').get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Không tìm thấy nhân viên' });
  if (req.user && req.user.id != null && Number(req.user.id) === emp.id)
    return res.status(400).json({ error: 'Không thể tự xóa tài khoản đang đăng nhập' });
  try {
    for (const t of ['employee_offices', 'attendance', 'leave_requests', 'daily_shift_assignments', 'shift_assignments', 'shift_requests', 'salary_configs', 'push_subscriptions'])
      db.prepare(`DELETE FROM ${t} WHERE employee_id=?`).run(emp.id);
    db.prepare('UPDATE device_punches SET employee_id=NULL WHERE employee_id=?').run(emp.id);
    db.prepare('DELETE FROM employees WHERE id=?').run(emp.id);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Số vân tay / khuôn mặt / thẻ / mật mã của 1 NV (theo Số ID máy) — cho tab Sinh trắc
r.get('/employees/:id/biometrics', need('employees'), (req, res) => {
  const emp = db.prepare('SELECT device_pin FROM employees WHERE id=?').get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Không tìm thấy nhân viên' });
  const pin = (emp.device_pin || '').trim();
  if (!pin) return res.json({ pin: '', fp: 0, face: 0, card: 0, password: 0, byDevice: [] });
  const fp = db.prepare("SELECT COUNT(DISTINCT idx) c FROM device_bio_templates WHERE pin=? AND bio_type=1").get(pin).c;
  const face = db.prepare("SELECT COUNT(DISTINCT idx) c FROM device_bio_templates WHERE pin=? AND bio_type IN (2,9)").get(pin).c;
  const u = db.prepare("SELECT card, passwd FROM device_users WHERE pin=?").get(pin) || {};
  const card = (u.card && u.card !== '0') ? 1 : 0;
  const password = (u.passwd && u.passwd !== '') ? 1 : 0;
  const byDevice = db.prepare(`SELECT s.serial, COALESCE(d.name,'') AS name,
      (SELECT COUNT(DISTINCT b.idx) FROM device_bio_templates b WHERE b.serial=s.serial AND b.pin=s.pin AND b.bio_type=1) AS fp,
      (SELECT COUNT(DISTINCT b.idx) FROM device_bio_templates b WHERE b.serial=s.serial AND b.pin=s.pin AND b.bio_type IN (2,9)) AS face
    FROM device_users_serial s LEFT JOIN push_devices d ON d.serial=s.serial WHERE s.pin=?`).all(pin);
  res.json({ pin, fp, face, card, password, byDevice });
});

// ---- Khoá thiết bị chấm công: duyệt đổi máy / gỡ thiết bị ----
// Danh sách NV đang xin đổi thiết bị
r.get('/device-requests', need('employees'), (req, res) => {
  const rows = db.prepare(`SELECT id, code, full_name, device_id, pending_device, device_label
    FROM employees WHERE pending_device IS NOT NULL AND pending_device != '' ORDER BY full_name`).all();
  res.json({ rows });
});
// Duyệt: gán điện thoại đang chờ thành điện thoại chính thức
r.post('/employees/:id/approve-device', need('employees'), (req, res) => {
  const e = db.prepare('SELECT pending_device FROM employees WHERE id = ?').get(req.params.id);
  if (!e || !e.pending_device) return res.status(400).json({ error: 'Nhân viên này không có yêu cầu đổi thiết bị' });
  db.prepare("UPDATE employees SET device_id = pending_device, pending_device = '' WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});
// Gỡ thiết bị: xoá cả máy đã gắn lẫn máy chờ → NV chấm lần sau sẽ tự gắn máy đang cầm (VD khi mất/đổi điện thoại)
r.post('/employees/:id/reset-device', need('employees'), (req, res) => {
  db.prepare("UPDATE employees SET device_id = '', pending_device = '', device_label = '' WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

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

/* ----------------------------- CÀI ĐẶT ----------------------------- */
r.get('/settings', (req, res) => {
  res.json({
    company_name: getSetting('company_name', 'Digiplus'),
    company_address: getSetting('company_address', ''),
    weekend_days: getSetting('weekend_days', '7'),
    workunit_rounding: getSetting('workunit_rounding', '2'),
    workunit_rounding_mode: getSetting('workunit_rounding_mode', '0'), // 0=lùi,1=tới,2=gần nhất
    pay_period_start_day: getSetting('pay_period_start_day', '1'),
    geofence_enforce: getSetting('geofence_enforce', '0'),
    attendance_mode: getSetting('attendance_mode', 'shift'),   // shift | hourly
    device_enabled: getSetting('device_enabled', '0'),         // dùng máy chấm công
    device_autocreate: getSetting('device_autocreate', '1'),   // tự tạo NV khi máy đăng ký vân tay
    device_lock_enabled: getSetting('device_lock_enabled', '0'), // khoá thiết bị chấm công điện thoại
    self_shift_enabled: getSetting('self_shift_enabled', '0'), // NV tự chọn ca
    self_shift_approve: getSetting('self_shift_approve', '1'), // chọn ca cần duyệt
    setup_done: getSetting('setup_done', '0'),
    company_logo: getSetting('company_logo', ''),
    app_version: currentVersion(),
    update_repo: updateConfig().repo,
    update_branch: updateConfig().branch,
  });
});
r.put('/settings', need('settings'), (req, res) => {
  const b = req.body || {};
  if (b.company_name != null) setSetting('company_name', b.company_name);
  if (b.company_address != null) setSetting('company_address', b.company_address);
  if (b.weekend_days != null) setSetting('weekend_days', b.weekend_days);
  if (b.workunit_rounding != null) setSetting('workunit_rounding', b.workunit_rounding);
  if (b.workunit_rounding_mode != null) setSetting('workunit_rounding_mode', String(parseInt(b.workunit_rounding_mode, 10) || 0));
  if (b.pay_period_start_day != null) setSetting('pay_period_start_day', b.pay_period_start_day);
  if (b.geofence_enforce != null) setSetting('geofence_enforce', b.geofence_enforce ? '1' : '0');
  if (b.attendance_mode != null) setSetting('attendance_mode', b.attendance_mode === 'hourly' ? 'hourly' : 'shift');
  // Bật/tắt tính năng MÁY CHẤM CÔNG: CHỈ tài khoản tổng mới đổi được
  if (req.user.master) {
    if (b.device_enabled != null) setSetting('device_enabled', b.device_enabled ? '1' : '0');
    if (b.device_autocreate != null) setSetting('device_autocreate', b.device_autocreate ? '1' : '0');
  }
  if (b.device_lock_enabled != null) setSetting('device_lock_enabled', b.device_lock_enabled ? '1' : '0');
  if (b.self_shift_enabled != null) setSetting('self_shift_enabled', b.self_shift_enabled ? '1' : '0');
  if (b.self_shift_approve != null) setSetting('self_shift_approve', b.self_shift_approve ? '1' : '0');
  if (b.setup_done != null) setSetting('setup_done', b.setup_done ? '1' : '0');
  if (b.update_repo != null) setSetting('update_repo', String(b.update_repo).trim());
  if (b.update_branch != null) setSetting('update_branch', String(b.update_branch).trim() || 'main');
  res.json({ ok: true });
});

// Logo công ty: upload (dataURL base64) hoặc xoá → hiện ở màn đăng nhập + app nhân viên
r.post('/branding', need('settings'), (req, res) => {
  const b = req.body || {};
  try {
    if (b.remove) { removeBrandLogo(); setSetting('company_logo', ''); return res.json({ ok: true, logo: '' }); }
    const url = saveBrandLogo(b.logo);
    setSetting('company_logo', url);
    res.json({ ok: true, logo: url });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/* ----------------------------- CẬP NHẬT PHẦN MỀM ----------------------------- */
// Kiểm tra bản mới trên GitHub (chỉ admin)
r.get('/update/check', adminOnly, async (req, res) => {
  try { res.json(await checkUpdate()); }
  catch (e) { res.status(400).json({ error: e.message, current: currentVersion() }); }
});
// Tải & áp dụng bản mới rồi khởi động lại (chỉ admin)
r.post('/update/apply', adminOnly, async (req, res) => {
  try { res.json(await applyUpdate()); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

/* ----------------------------- CẤU HÌNH LƯƠNG ----------------------------- */
r.get('/salary', need('salary'), (req, res) => {
  const rows = db.prepare(`
    SELECT e.id AS employee_id, e.code, e.full_name, e.department,
           c.basic_salary, c.daily_rate, c.working_days_per_month,
           c.ot_rate_weekday, c.ot_rate_weekend, c.ot_rate_holiday, c.allowance, c.hourly_rate
    FROM employees e LEFT JOIN salary_configs c ON c.employee_id = e.id
    WHERE e.active = 1 AND e.role != 'admin'
    ORDER BY e.department, e.full_name`).all();
  res.json({ rows });
});
r.put('/salary/:empId', need('salary'), (req, res) => {
  const b = req.body || {};
  const eid = +req.params.empId;
  const emp = db.prepare('SELECT id FROM employees WHERE id = ?').get(eid);
  if (!emp) return res.status(404).json({ error: 'Không tìm thấy nhân viên' });
  db.prepare(`INSERT INTO salary_configs
      (employee_id, basic_salary, daily_rate, working_days_per_month, ot_rate_weekday, ot_rate_weekend, ot_rate_holiday, allowance, hourly_rate, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?, datetime('now'))
    ON CONFLICT(employee_id) DO UPDATE SET
      basic_salary=excluded.basic_salary, daily_rate=excluded.daily_rate,
      working_days_per_month=excluded.working_days_per_month,
      ot_rate_weekday=excluded.ot_rate_weekday, ot_rate_weekend=excluded.ot_rate_weekend,
      ot_rate_holiday=excluded.ot_rate_holiday, allowance=excluded.allowance,
      hourly_rate=excluded.hourly_rate, updated_at=datetime('now')`)
    .run(eid, +b.basic_salary || 0, b.daily_rate ? +b.daily_rate : null, +b.working_days_per_month || 26,
      +b.ot_rate_weekday || 1.5, +b.ot_rate_weekend || 2.0, +b.ot_rate_holiday || 3.0, +b.allowance || 0, +b.hourly_rate || 0);
  res.json({ ok: true });
});

// Bảng lương tính sẵn cho 1 tháng (kèm chi tiết từng NV để in phiếu lương)
r.get('/payroll', need('salary'), (req, res) => {
  const month = (req.query.month || '').slice(0, 7);
  const dept = req.query.dept || null;
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return res.status(400).json({ error: 'Thiếu tháng (YYYY-MM)' });
  const data = computePayrollTable(+m[1], +m[2], dept);
  res.json({ ...data, month, mode: getSetting('attendance_mode', 'shift'), company: getSetting('company_name', 'Digiplus') });
});

/* ----------------------------- NGÀY LỄ ----------------------------- */
r.get('/holidays', (req, res) => {
  res.json({ rows: db.prepare('SELECT * FROM public_holidays ORDER BY holiday_date DESC').all() });
});
r.post('/holidays', need('holidays'), (req, res) => {
  const b = req.body || {};
  if (!b.holiday_date) return res.status(400).json({ error: 'Thiếu ngày' });
  try {
    db.prepare('INSERT INTO public_holidays(holiday_date, name) VALUES (?,?)').run(b.holiday_date, b.name || '');
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: /UNIQUE/.test(e.message) ? 'Ngày lễ đã tồn tại' : e.message }); }
});
r.delete('/holidays/:id', need('holidays'), (req, res) => {
  db.prepare('DELETE FROM public_holidays WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* ----------------------------- PHÂN CA THEO NGÀY ----------------------------- */
// Danh sách NV + ca + các phân ca trong khoảng ngày
r.get('/assignments', (req, res) => {
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
r.get('/shift-assignments', (req, res) => {
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
const WDVN = { 1: 'T2', 2: 'T3', 3: 'T4', 4: 'T5', 5: 'T6', 6: 'T7', 7: 'CN' };
function monthDaysList(month) {
  const [y, m] = month.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}
const vnWd = (d) => { const dow = new Date(d + 'T12:00:00Z').getUTCDay(); return dow === 0 ? 7 : dow; };

// Xuất mẫu Excel phân ca tháng (lưới NV × ngày)
r.get('/assignments/export.xlsx', async (req, res) => {
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
  } catch (e) { db.exec('ROLLBACK'); return res.status(500).json({ error: e.message }); }

  res.json({ ok: true, updated, off, cleared, errors: errors.slice(0, 20), errorCount: errors.length });
});

/* -------------------- TÍNH LẠI CÔNG (áp cho dữ liệu cũ) -------------------- */
r.post('/recompute', need('recompute'), (req, res) => {
  const month = (req.query.month || '').slice(0, 7);
  const weekend = getSetting('weekend_days', '7');
  const roundingDecimals = parseInt(getSetting('workunit_rounding', '2'), 10) || 2;
  const roundingMode = parseInt(getSetting('workunit_rounding_mode', '0'), 10) || 0;
  const isHol = (d) => !!db.prepare('SELECT 1 FROM public_holidays WHERE holiday_date=?').get(d);

  const rows = month
    ? db.prepare("SELECT * FROM attendance WHERE work_date LIKE ? AND check_in_at IS NOT NULL").all(month + '%')
    : db.prepare("SELECT * FROM attendance WHERE check_in_at IS NOT NULL").all();

  let n = 0;
  db.exec('BEGIN');
  try {
    for (const row of rows) {
      // Dò lại ca: phân ca thủ công (Excel) đè → tự động theo giờ → mặc định
      const eff = resolveEffectiveShift(row.employee_id, row.work_date, row.check_in_at, row.check_out_at || null);
      const shift = eff.shift;
      const flags = { isHoliday: isHol(row.work_date), isWeekend: isWeekendDay(row.work_date, weekend), roundingDecimals, roundingMode };
      const otType = flags.isHoliday ? 'le' : flags.isWeekend ? 'cuoi_tuan' : 'thuong';
      const late = shift ? computeLate(shift, row.check_in_at, row.work_date) : 0;
      if (!row.check_out_at) {
        db.prepare('UPDATE attendance SET late_min=?, day_status=?, ot_type=?, shift_id=?, shift_source=? WHERE id=?')
          .run(late, 'thieu_ra', otType, shift?.id ?? null, eff.source, row.id);
      } else {
        let c;
        if (shift) c = computeCheckout(shift, row.check_in_at, row.check_out_at, row.work_date, flags);
        else {
          const wm = Math.max(0, Math.round((new Date(row.check_out_at) - new Date(row.check_in_at)) / 60000));
          c = { early_min: 0, ot_min: 0, work_minutes: wm, work_unit: wm > 0 ? 1 : 0, ot_type: otType, day_status: 'lam_viec' };
        }
        db.prepare(`UPDATE attendance SET late_min=?, early_min=?, ot_min=?, work_minutes=?,
          work_unit=?, day_status=?, ot_type=?, shift_id=?, shift_source=? WHERE id=?`)
          .run(late, c.early_min, c.ot_min, c.work_minutes, c.work_unit, c.day_status, c.ot_type, shift?.id ?? null, eff.source, row.id);
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

/* -------------------- SỬA / THÊM / XOÁ GIỜ CHẤM (bằng tay) -------------------- */
// Đổi 'YYYY-MM-DD' + 'HH:MM' (giờ VN) → ISO UTC
function vnToIso(date, hm) {
  if (!hm) return null;
  return new Date(`${date}T${hm}:00+07:00`).toISOString();
}
// Tính lại các chỉ số cho 1 bản ghi khi admin nhập tay
function computeManual(employeeId, workDate, inIso, outIso) {
  const weekend = getSetting('weekend_days', '7');
  const roundingDecimals = parseInt(getSetting('workunit_rounding', '2'), 10) || 2;
  const roundingMode = parseInt(getSetting('workunit_rounding_mode', '0'), 10) || 0;
  const isHol = (d) => !!db.prepare('SELECT 1 FROM public_holidays WHERE holiday_date=?').get(d);
  const hourly = getSetting('attendance_mode', 'shift') === 'hourly';
  const eff = hourly ? { shift: null, source: 'manual' } : resolveEffectiveShift(employeeId, workDate, inIso || `${workDate}T00:00:00Z`, outIso || null);
  const shift = eff.shift;
  const flags = { isHoliday: isHol(workDate), isWeekend: isWeekendDay(workDate, weekend), roundingDecimals, roundingMode };
  const otType = flags.isHoliday ? 'le' : flags.isWeekend ? 'cuoi_tuan' : 'thuong';
  const late = (!hourly && shift && inIso) ? computeLate(shift, inIso, workDate) : 0;
  let c;
  if (inIso && outIso) {
    if (shift && !hourly) c = computeCheckout(shift, inIso, outIso, workDate, flags);
    else { const wm = Math.max(0, Math.round((new Date(outIso) - new Date(inIso)) / 60000)); c = { early_min: 0, ot_min: 0, work_minutes: wm, work_unit: wm > 0 ? 1 : 0, ot_type: otType, day_status: 'lam_viec' }; }
  } else {
    c = { early_min: 0, ot_min: 0, work_minutes: 0, work_unit: 0, ot_type: otType, day_status: inIso ? 'thieu_ra' : 'vang' };
  }
  return { shiftId: shift?.id ?? null, late, ...c };
}

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

/* -------------------- SAO LƯU / PHỤC HỒI DỮ LIỆU -------------------- */
r.get('/backup', need('backup'), (req, res) => {
  res.json({
    config: {
      enabled: getSetting('backup_enabled', '1') === '1',
      hour: parseInt(getSetting('backup_hour', '2'), 10),
      keep_days: parseInt(getSetting('backup_keep_days', '7'), 10),
      last_date: getSetting('backup_last_date', ''),
    },
    list: listBackups(),
  });
});
r.put('/backup/config', need('backup'), (req, res) => {
  const b = req.body || {};
  if (b.enabled != null) setSetting('backup_enabled', b.enabled ? '1' : '0');
  if (b.hour != null) setSetting('backup_hour', String(Math.max(0, Math.min(23, +b.hour || 0))));
  if (b.keep_days != null) setSetting('backup_keep_days', String(Math.max(1, +b.keep_days || 7)));
  pruneBackups(getSetting('backup_keep_days', '7'));
  res.json({ ok: true });
});
r.post('/backup/now', need('backup'), (req, res) => {
  try { const r2 = doBackup('manual'); pruneBackups(getSetting('backup_keep_days', '7')); res.json({ ok: true, ...r2 }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
r.get('/backup/download', need('backup'), (req, res) => {
  const p = backupPath(req.query.name || '');
  if (!p) return res.status(404).json({ error: 'Không tìm thấy bản sao lưu' });
  res.download(p, req.query.name);
});
r.delete('/backup', need('backup'), (req, res) => {
  if (!deleteBackup(req.query.name || '')) return res.status(404).json({ error: 'Không tìm thấy bản sao lưu' });
  res.json({ ok: true });
});
// Phục hồi: nhận file .db (nhị phân) → ghi file chờ, cần khởi động lại app để áp
r.post('/backup/restore', need('backup'), raw({ type: () => true, limit: '200mb' }), (req, res) => {
  try {
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'Chưa nhận được file' });
    stageRestore(req.body);
    res.json({ ok: true, restartNeeded: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
// Sao lưu TOÀN BỘ (.zip = DB + ảnh + logo) — dùng khi chuyển máy/VPS
r.post('/backup/full', need('backup'), (req, res) => {
  try { res.json({ ok: true, ...doFullBackup() }); }
  catch (e) { res.status(500).json({ error: 'Không tạo được bản sao lưu toàn bộ: ' + e.message }); }
});
// Phục hồi TOÀN BỘ từ .zip → nạp DB (áp lúc khởi động lại) + thay ảnh/logo ngay
r.post('/backup/full-restore', need('backup'), raw({ type: () => true, limit: '500mb' }), (req, res) => {
  try {
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'Chưa nhận được file' });
    stageFullRestore(req.body);
    res.json({ ok: true, restartNeeded: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/* -------------------- MÁY CHẤM CÔNG (ZKTeco ADMS push) -------------------- */
r.get('/devices', need('devices'), (req, res) => {
  const rows = db.prepare('SELECT * FROM push_devices ORDER BY created_at').all();
  for (const d of rows) {
    d.punch_count = db.prepare('SELECT COUNT(*) c FROM device_punches WHERE serial=?').get(d.serial).c;
    d.unmatched = db.prepare('SELECT COUNT(DISTINCT pin) c FROM device_punches WHERE serial=? AND employee_id IS NULL').get(d.serial).c;
    d.emp_count = db.prepare('SELECT COUNT(*) c FROM (SELECT pin FROM device_users_serial WHERE serial=? UNION SELECT pin FROM device_bio_templates WHERE serial=?)').get(d.serial, d.serial).c;
    d.fp_count = db.prepare('SELECT COUNT(*) c FROM device_bio_templates WHERE serial=? AND bio_type=1').get(d.serial).c;
    d.face_count = db.prepare('SELECT COUNT(*) c FROM device_bio_templates WHERE serial=? AND bio_type IN (2,9)').get(d.serial).c;
    d.card_count = db.prepare("SELECT COUNT(*) c FROM device_users_serial WHERE serial=? AND card<>''").get(d.serial).c;
  }
  res.json({ rows, enabled: getSetting('device_enabled', '0') === '1', autocreate: getSetting('device_autocreate', '1') === '1', server_ips: lanIPs(), port: Number(process.env.PORT || 8080) });
});
// Lấy lại IP mạng LAN hiện tại (bấm "Refresh mạng" sau khi đổi mạng) để điền vào máy chấm công
r.get('/server-ips', need('devices'), (req, res) => {
  res.json({ ips: lanIPs(), port: Number(process.env.PORT || 8080) });
});
// Đồng bộ NGAY: đẩy toàn bộ vân tay/user của nhóm sang mọi máy trong nhóm (khỏi cần restart máy)
r.post('/devices/resync', need('devices'), (req, res) => {
  try { res.json(resyncNow()); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

/* ------------- THÔNG BÁO ĐẨY (Web Push) cho quản lý ------------- */
r.get('/push/vapid', (req, res) => res.json({ publicKey: getVapid().publicKey }));
r.post('/push/subscribe', (req, res) => {
  try { saveSubscription(req.user.id, req.body?.subscription); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
r.post('/push/unsubscribe', (req, res) => { removeSubscription(req.body?.endpoint); res.json({ ok: true }); });
r.post('/push/test', async (req, res) => {
  try { const r2 = await notifyManagers({ title: 'Digiplus Chấm công', body: 'Thông báo thử — hoạt động tốt ✅', url: '/admin' }); res.json({ ok: true, ...r2 }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
r.put('/devices/:id', need('devices'), (req, res) => {
  const b = req.body || {};
  const d = db.prepare('SELECT * FROM push_devices WHERE id=?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Không tìm thấy máy' });
  db.prepare('UPDATE push_devices SET name=?, active=?, sync_group=?, machine_number=?, access_control=? WHERE id=?')
    .run(b.name ?? d.name, b.active != null ? (b.active ? 1 : 0) : d.active,
         b.sync_group !== undefined ? (b.sync_group || '').trim() : (d.sync_group || ''),
         b.machine_number != null ? (parseInt(b.machine_number, 10) || 0) : (d.machine_number || 0),
         b.access_control != null ? (b.access_control ? 1 : 0) : (d.access_control || 0), d.id);
  res.json({ ok: true });
});
// Mở cửa từ xa (chỉ máy có kiểm soát cửa) — gửi lệnh ADMS AC_UNLOCK xuống hàng đợi
r.post('/devices/:id/open-door', need('door_open'), (req, res) => {
  const d = db.prepare('SELECT serial, access_control FROM push_devices WHERE id=?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Không tìm thấy máy' });
  if (!d.access_control) return res.status(400).json({ error: 'Máy này chưa bật chức năng kiểm soát cửa.' });
  openDoor(d.serial);
  res.json({ ok: true, msg: 'Đã gửi lệnh mở cửa. Máy sẽ mở khi có kết nối.' });
});
r.delete('/devices/:id', need('devices'), (req, res) => {
  const d = db.prepare('SELECT serial FROM push_devices WHERE id=?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Không tìm thấy máy' });
  db.prepare('DELETE FROM push_devices WHERE id=?').run(req.params.id);
  db.prepare('DELETE FROM push_device_commands WHERE serial=?').run(d.serial);
  db.prepare('DELETE FROM device_bio_templates WHERE serial=?').run(d.serial);
  res.json({ ok: true });
});
// Log quẹt gần đây (để kiểm tra kết nối)
r.get('/devices/:id/punches', need('devices'), (req, res) => {
  const d = db.prepare('SELECT serial FROM push_devices WHERE id=?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Không tìm thấy máy' });
  const rows = db.prepare(`SELECT p.pin, p.punch_at, p.verify, p.employee_id, e.full_name
    FROM device_punches p LEFT JOIN employees e ON e.id = p.employee_id
    WHERE p.serial=? ORDER BY p.punch_at DESC LIMIT 100`).all(d.serial);
  res.json({ rows });
});
// Dựng lại chấm công từ toàn bộ punch (khi mới khớp thêm nhân viên với mã trên máy)
r.post('/devices/rebuild', need('devices'), (req, res) => {
  // gán lại employee_id cho punch chưa khớp (mã trùng employees.code)
  const un = db.prepare('SELECT DISTINCT pin FROM device_punches WHERE employee_id IS NULL').all();
  for (const { pin } of un) {
    const emp = db.prepare('SELECT id FROM employees WHERE code=? AND active=1').get(pin);
    if (emp) db.prepare('UPDATE device_punches SET employee_id=? WHERE pin=? AND employee_id IS NULL').run(emp.id, pin);
  }
  const days = db.prepare('SELECT DISTINCT employee_id, work_date FROM device_punches WHERE employee_id IS NOT NULL').all();
  let n = 0;
  db.exec('BEGIN');
  try { for (const d of days) { rebuildDay(d.employee_id, d.work_date); n++; } db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); return res.status(500).json({ error: e.message }); }
  res.json({ ok: true, rebuilt: n });
});

// Nhập dữ liệu từ USB (máy không kết nối mạng): file chấm công *_attlog.dat/.txt hoặc danh sách NV.
// Body: { kind:'attlog'|'users', fileBase64 hoặc text }
r.post('/devices/import-usb', need('devices'), (req, res) => {
  const b = req.body || {};
  let content = b.text || '';
  if (!content && b.fileBase64) { try { content = Buffer.from(b.fileBase64.replace(/^data:.*;base64,/, ''), 'base64').toString('utf8'); } catch {} }
  if (!content.trim()) return res.status(400).json({ error: 'File rỗng hoặc không đọc được' });
  db.exec('BEGIN');
  try {
    const r2 = b.kind === 'users' ? importUsbUsers(content) : importUsbAttlog(content);
    db.exec('COMMIT');
    res.json({ ok: true, kind: b.kind || 'attlog', ...r2 });
  } catch (e) { db.exec('ROLLBACK'); res.status(500).json({ error: e.message }); }
});

/* -------- Xóa dữ liệu / nhân viên TRÊN MÁY (gửi lệnh ADMS xuống máy) -------- */
const serialOfDevice = (id) => db.prepare('SELECT serial FROM push_devices WHERE id=?').get(id)?.serial;

r.get('/devices/:id/users', need('devices'), (req, res) => {
  const serial = serialOfDevice(req.params.id);
  if (!serial) return res.status(404).json({ error: 'Không tìm thấy máy' });
  res.json({ rows: deviceUserList(serial) });
});
r.post('/devices/:id/query-users', need('devices'), (req, res) => {
  const serial = serialOfDevice(req.params.id);
  if (!serial) return res.status(404).json({ error: 'Không tìm thấy máy' });
  queryDeviceUsers(serial);
  res.json({ ok: true, msg: 'Đã gửi lệnh tải nhân viên từ máy. Máy sẽ đẩy danh sách NV + vân tay lên khi có kết nối (chờ chút rồi làm mới).' });
});
r.post('/devices/:id/clear-log', need('devices'), (req, res) => {
  const serial = serialOfDevice(req.params.id);
  if (!serial) return res.status(404).json({ error: 'Không tìm thấy máy' });
  clearDeviceLog(serial);
  res.json({ ok: true, msg: 'Đã gửi lệnh xóa log chấm công. Máy sẽ xóa khi kết nối.' });
});
r.post('/devices/:id/clear-admins', need('devices'), (req, res) => {
  const serial = serialOfDevice(req.params.id);
  if (!serial) return res.status(404).json({ error: 'Không tìm thấy máy' });
  const n = clearDeviceAdmins(serial);
  res.json({ ok: true, count: n, msg: n ? `Đã gửi lệnh hạ quyền ${n} quản trị.` : 'Không thấy quản trị nào trên máy (theo dữ liệu đã đồng bộ).' });
});
r.post('/devices/:id/clear-all', need('devices'), (req, res) => {
  const serial = serialOfDevice(req.params.id);
  if (!serial) return res.status(404).json({ error: 'Không tìm thấy máy' });
  clearDeviceAll(serial);
  res.json({ ok: true, msg: 'Đã gửi lệnh xóa TOÀN BỘ dữ liệu trên máy (NV + vân tay + log).' });
});
r.post('/devices/:id/delete-users', need('devices'), (req, res) => {
  const serial = serialOfDevice(req.params.id);
  if (!serial) return res.status(404).json({ error: 'Không tìm thấy máy' });
  const pins = Array.isArray(req.body?.pins) ? req.body.pins : [];
  if (!pins.length) return res.status(400).json({ error: 'Chưa chọn nhân viên' });
  const n = deleteDeviceUsers(serial, pins);
  res.json({ ok: true, count: n, msg: `Đã gửi lệnh xóa ${n} nhân viên trên máy.` });
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

export default r;
