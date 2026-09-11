// Tạo dữ liệu khởi tạo lần đầu: cài đặt, chi nhánh mẫu, ca mẫu, tài khoản admin + nhân viên demo
import { db, getSetting, setSetting } from './db.js';
import { hashPassword } from './auth.js';

export function ensureSeed() {
  if (getSetting('seeded') === '1') return;

  if (!getSetting('company_name')) setSetting('company_name', 'Digiplus');

  // Chi nhánh mẫu (toạ độ trung tâm TP.HCM — sửa lại trong trang Admin)
  let officeId = db.prepare('SELECT id FROM offices LIMIT 1').get()?.id;
  if (!officeId) {
    officeId = db.prepare(
      `INSERT INTO offices(name,address,lat,lng,radius_m) VALUES (?,?,?,?,?)`
    ).run('Văn phòng chính', 'TP. Hồ Chí Minh', 10.776889, 106.700806, 200).lastInsertRowid;
  }

  // Ca hành chính mẫu
  let shiftId = db.prepare('SELECT id FROM shifts LIMIT 1').get()?.id;
  if (!shiftId) {
    shiftId = db.prepare(
      `INSERT INTO shifts(name,start_time,end_time,late_grace_min,work_days)
       VALUES (?,?,?,?,?)`
    ).run('Hành chính', '08:00', '17:30', 5, '1,2,3,4,5,6').lastInsertRowid;
  }

  // Tài khoản admin
  if (!db.prepare("SELECT id FROM employees WHERE username = 'admin'").get()) {
    db.prepare(`INSERT INTO employees
      (code, full_name, department, position, role, username, password_hash, office_id, shift_id)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      'AD001', 'Quản trị Digiplus', 'Ban giám đốc', 'Admin', 'admin',
      'admin', hashPassword('admin123'), officeId, shiftId);
  }

  // Nhân viên demo
  if (!db.prepare("SELECT id FROM employees WHERE username = 'nv001'").get()) {
    db.prepare(`INSERT INTO employees
      (code, full_name, department, position, role, username, password_hash, office_id, shift_id)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      'NV001', 'Nguyễn Việt Hoàng', 'Kinh doanh', 'Nhân viên · Sale', 'employee',
      'nv001', hashPassword('123456'), officeId, shiftId);
  }

  setSetting('seeded', '1');
  console.log('  ✓ Đã tạo dữ liệu khởi tạo (admin/admin123, nv001/123456)');
}

// Cho phép chạy trực tiếp: node server/seed.js
if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/')) {
  const { initSchema } = await import('./db.js');
  initSchema();
  ensureSeed();
  console.log('Seed xong.');
}
