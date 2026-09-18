// Nhóm route NHÂN VIÊN + phân quyền chi tiết + khoá thiết bị chấm công điện thoại.
import { db } from '../../db.js';
import { hashPassword, PERMISSIONS } from '../../auth.js';
import { licenseState } from '../../license.js';

const PERM_KEYS = PERMISSIONS.map(([k]) => k);
// Chuẩn hoá quyền để lưu: admin = null (toàn quyền); còn lại = JSON mảng key hợp lệ.
function normPerms(role, perms) {
  if (role === 'admin') return null;
  if (Array.isArray(perms)) return JSON.stringify(perms.filter((k) => PERM_KEYS.includes(k)));
  return null;
}

// Đặt danh sách định vị được phép chấm cho 1 NV (thay toàn bộ)
function setEmpOffices(empId, officeIds) {
  if (!Array.isArray(officeIds)) return;
  db.prepare('DELETE FROM employee_offices WHERE employee_id=?').run(empId);
  const ins = db.prepare('INSERT OR IGNORE INTO employee_offices(employee_id, office_id) VALUES (?,?)');
  for (const oid of officeIds) { if (oid) ins.run(empId, +oid); }
}

export function registerEmployeeRoutes(r, { need }) {
  // Danh mục quyền (cho giao diện dựng ô tích phân quyền)
  r.get('/perm-catalog', (req, res) => res.json({ permissions: PERMISSIONS }));

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
    const ph = db.prepare('SELECT kind, photo FROM device_user_photos WHERE pin=?').get(pin);
    const photo = ph ? ph.kind : '';   // '' = không có, 'face' | 'user'
    const photoData = ph && ph.photo ? ('data:image/jpeg;base64,' + ph.photo) : '';
    const byDevice = db.prepare(`SELECT s.serial, COALESCE(d.name,'') AS name,
        (SELECT COUNT(DISTINCT b.idx) FROM device_bio_templates b WHERE b.serial=s.serial AND b.pin=s.pin AND b.bio_type=1) AS fp,
        (SELECT COUNT(DISTINCT b.idx) FROM device_bio_templates b WHERE b.serial=s.serial AND b.pin=s.pin AND b.bio_type IN (2,9)) AS face
      FROM device_users_serial s LEFT JOIN push_devices d ON d.serial=s.serial WHERE s.pin=?`).all(pin);
    res.json({ pin, fp, face, card, password, photo, photoData, byDevice });
  });
  // Ảnh người dùng/khuôn mặt của NV (lấy từ máy) → trả JPG để hiện avatar
  r.get('/employees/:id/photo', need('employees'), (req, res) => {
    const emp = db.prepare('SELECT device_pin FROM employees WHERE id=?').get(req.params.id);
    const pin = emp && (emp.device_pin || '').trim();
    if (!pin) return res.status(404).end();
    const ph = db.prepare('SELECT photo FROM device_user_photos WHERE pin=?').get(pin);
    if (!ph || !ph.photo) return res.status(404).end();
    try {
      const buf = Buffer.from(ph.photo, 'base64');
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(buf);
    } catch { res.status(404).end(); }
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
}
