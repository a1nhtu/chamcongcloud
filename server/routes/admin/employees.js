// Nhóm route NHÂN VIÊN + phân quyền chi tiết + khoá thiết bị chấm công điện thoại.
import ExcelJS from 'exceljs';
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

// Map chữ vai trò trong Excel → role hệ thống
function mapRole(txt) {
  const t = String(txt || '').trim().toLowerCase();
  if (['admin', 'quản trị', 'quan tri', 'quản trị viên', 'quan tri vien', 'qtv'].includes(t)) return 'admin';
  if (['manager', 'quản lý', 'quan ly', 'quản lí', 'quan li', 'ql'].includes(t)) return 'manager';
  return 'employee';
}
// Đặt lương cơ bản, giữ nguyên các cấu hình lương khác nếu đã có
function setBasicSalary(empId, basic) {
  db.prepare(`INSERT INTO salary_configs (employee_id, basic_salary, working_days_per_month)
    VALUES (?, ?, 26)
    ON CONFLICT(employee_id) DO UPDATE SET basic_salary=excluded.basic_salary, updated_at=datetime('now')`).run(empId, basic);
}
// Các cột file Excel nhập nhân viên (thứ tự cố định)
const EMP_IMPORT_COLS = [
  'Mã NV *', 'Họ tên *', 'Bộ phận', 'Chức danh', 'Số điện thoại',
  'Vai trò', 'Số ID máy chấm công', 'Lương cơ bản', 'Tài khoản đăng nhập', 'Mật khẩu',
];

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

  // Tải file Excel mẫu để nhập nhân viên hàng loạt
  r.get('/employees/template.xlsx', need('employees'), async (req, res) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('NhanVien');
    const hr = ws.addRow(EMP_IMPORT_COLS);
    hr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    hr.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } }; c.alignment = { vertical: 'middle', horizontal: 'center' }; });
    // 2 dòng ví dụ
    ws.addRow(['NV001', 'Nguyễn Văn A', 'Kinh doanh', 'Nhân viên bán hàng', '0900000001', 'Nhân viên', '1', 8000000, 'nv001', '123456']);
    ws.addRow(['QL001', 'Trần Thị B', 'Kinh doanh', 'Trưởng phòng', '0900000002', 'Quản lý', '2', 15000000, 'ql001', '123456']);
    const widths = [12, 22, 18, 20, 14, 12, 16, 14, 18, 12];
    ws.columns.forEach((c, i) => { c.width = widths[i] || 14; });
    // Sheet hướng dẫn
    const g = wb.addWorksheet('HuongDan');
    g.addRow(['HƯỚNG DẪN NHẬP NHÂN VIÊN']).font = { bold: true, size: 13 };
    [
      ['• Mã NV *', 'Bắt buộc, không trùng. Dùng để đối chiếu khi Cập nhật.'],
      ['• Họ tên *', 'Bắt buộc.'],
      ['• Bộ phận', 'Nếu chưa có trong phần mềm sẽ TỰ TẠO MỚI.'],
      ['• Chức danh', 'Nếu chưa có sẽ TỰ TẠO MỚI.'],
      ['• Vai trò', 'Nhân viên / Quản lý / Admin (để trống = Nhân viên).'],
      ['• Số ID máy chấm công', 'Số ID trên máy chấm công (nếu có). Đã có rồi thì không đổi.'],
      ['• Lương cơ bản', 'Số tiền/tháng. Để trống = không đặt lương.'],
      ['• Tài khoản đăng nhập', 'Để trống = lấy theo Mã NV.'],
      ['• Mật khẩu', 'Để trống = 123456 (nên nhắc nhân viên đổi sau).'],
      ['', ''],
      ['CHẾ ĐỘ THÊM MỚI', 'Thêm nhân viên mới. Mã đã tồn tại sẽ bỏ qua.'],
      ['CHẾ ĐỘ CẬP NHẬT', 'Sửa nhân viên theo Mã. Ô để trống = giữ nguyên. Mã chưa có sẽ bỏ qua.'],
    ].forEach((r2) => g.addRow(r2));
    g.getColumn(1).width = 26; g.getColumn(2).width = 60;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="mau_nhan_vien.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  });

  // Nhập nhân viên bằng Excel: {fileBase64, mode:'add'|'update'}
  // Tự tạo bộ phận / chức danh mới nếu chưa có; đặt lương cơ bản nếu điền.
  r.post('/employees/import', need('employees'), async (req, res) => {
    const b64 = req.body?.fileBase64 || '';
    const mode = req.body?.mode === 'update' ? 'update' : 'add';
    if (!b64) return res.status(400).json({ error: 'Thiếu file' });
    const buf = Buffer.from(b64.replace(/^data:.*;base64,/, ''), 'base64');
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buf); } catch { return res.status(400).json({ error: 'File Excel không đọc được' }); }
    const ws = wb.worksheets[0];
    if (!ws) return res.status(400).json({ error: 'File rỗng' });

    const cellStr = (row, c) => String(row.getCell(c).value ?? '').trim();
    const cellNum = (row, c) => { const n = Number(String(row.getCell(c).value ?? '').replace(/[^\d.-]/g, '')); return isNaN(n) ? 0 : n; };

    const deptSet = new Set(db.prepare('SELECT name FROM departments').all().map((d) => d.name));
    const posSet = new Set(db.prepare('SELECT name FROM positions').all().map((p) => p.name));
    const insDept = db.prepare('INSERT OR IGNORE INTO departments(name) VALUES(?)');
    const insPos = db.prepare('INSERT OR IGNORE INTO positions(name) VALUES(?)');
    const empByCode = new Map(db.prepare('SELECT id, code, device_pin FROM employees').all().map((e) => [String(e.code).trim().toUpperCase(), e]));
    const pinUsed = db.prepare("SELECT 1 FROM employees WHERE device_pin=? AND device_pin<>'' AND id<>?");

    const lic = licenseState();
    let activeCount = db.prepare("SELECT COUNT(*) c FROM employees WHERE active=1 AND role!='admin'").get().c;

    let added = 0, updated = 0, skipped = 0, newDepts = 0, newPos = 0;
    const errors = [];

    db.exec('BEGIN');
    try {
      for (let r2 = 2; r2 <= ws.rowCount; r2++) {
        const row = ws.getRow(r2);
        const code = cellStr(row, 1);
        if (!code) continue;
        const name = cellStr(row, 2);
        const dept = cellStr(row, 3);
        const pos = cellStr(row, 4);
        const phone = cellStr(row, 5);
        const roleTxt = cellStr(row, 6);
        const role = mapRole(roleTxt);
        const pin = cellStr(row, 7);
        const basic = cellNum(row, 8);
        const username = cellStr(row, 9) || code;
        const password = cellStr(row, 10) || '123456';
        const CODE = code.toUpperCase();

        // Tự tạo bộ phận / chức danh mới
        if (dept && !deptSet.has(dept)) { insDept.run(dept); deptSet.add(dept); newDepts++; }
        if (pos && !posSet.has(pos)) { insPos.run(pos); posSet.add(pos); newPos++; }

        const existing = empByCode.get(CODE);

        if (mode === 'add') {
          if (existing) { errors.push(`Dòng ${r2}: Mã "${code}" đã tồn tại — bỏ qua`); skipped++; continue; }
          if (!name) { errors.push(`Dòng ${r2}: thiếu Họ tên — bỏ qua`); skipped++; continue; }
          if (lic.maxEmp && role !== 'admin' && activeCount >= lic.maxEmp) { errors.push(`Dòng ${r2}: vượt giới hạn bản quyền ${lic.maxEmp} NV — bỏ qua`); skipped++; continue; }
          let pinOk = pin;
          if (pin && pinUsed.get(pin, 0)) { errors.push(`Dòng ${r2}: Số ID máy "${pin}" đã có NV dùng — bỏ qua số ID`); pinOk = ''; }
          try {
            const info = db.prepare(`INSERT INTO employees
              (code, full_name, department, position, phone, role, username, password_hash, permissions, device_pin, active)
              VALUES (?,?,?,?,?,?,?,?,?,?,1)`).run(
              code, name, dept, pos, phone, role, username, hashPassword(password),
              normPerms(role, role === 'admin' ? null : []), pinOk);
            empByCode.set(CODE, { id: info.lastInsertRowid, code, device_pin: pinOk });
            if (basic > 0) setBasicSalary(info.lastInsertRowid, basic);
            if (role !== 'admin') activeCount++;
            added++;
          } catch (e) { errors.push(`Dòng ${r2}: ${/UNIQUE/.test(e.message) ? `trùng Mã NV hoặc tài khoản "${username}"` : e.message}`); skipped++; }
        } else { // update theo mã
          if (!existing) { errors.push(`Dòng ${r2}: Mã "${code}" chưa có — bỏ qua`); skipped++; continue; }
          const sets = [], args = [];
          if (name) { sets.push('full_name=?'); args.push(name); }
          if (dept) { sets.push('department=?'); args.push(dept); }
          if (pos) { sets.push('position=?'); args.push(pos); }
          if (phone) { sets.push('phone=?'); args.push(phone); }
          if (roleTxt) { sets.push('role=?'); args.push(role); }
          // Số ID: chỉ đặt khi NV chưa có ID và ID chưa bị NV khác dùng
          if (pin && !(existing.device_pin || '').trim() && !pinUsed.get(pin, existing.id)) { sets.push('device_pin=?'); args.push(pin); }
          if (sets.length) { args.push(existing.id); db.prepare(`UPDATE employees SET ${sets.join(', ')} WHERE id=?`).run(...args); }
          if (cellStr(row, 10)) db.prepare('UPDATE employees SET password_hash=? WHERE id=?').run(hashPassword(cellStr(row, 10)), existing.id);
          if (basic > 0) setBasicSalary(existing.id, basic);
          updated++;
        }
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); return res.status(400).json({ error: 'Lỗi khi nhập: ' + e.message }); }
    res.json({ ok: true, mode, added, updated, skipped, newDepts, newPos, errors: errors.slice(0, 80) });
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
