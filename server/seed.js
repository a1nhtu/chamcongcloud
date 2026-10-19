// Tạo dữ liệu khởi tạo lần đầu (chỉ chạy 1 lần khi MỚI CÀI, đánh dấu bằng setting 'seeded'):
// cài đặt, chi nhánh mẫu, 4 bộ phận, 4 ca, 2 lịch trình vào ra, 2 lịch trình ca, tài khoản admin (bộ phận Quản trị).
// KHÔNG tạo nhân viên mẫu — khách tự thêm / tải từ máy chấm công.
import { db, getSetting, setSetting } from './db.js';
import { hashPassword } from './auth.js';

// Bộ phận mặc định (cấp trên cùng). Tài khoản admin luôn nằm ở bộ phận "Quản trị".
export const ADMIN_DEPT = 'Quản trị';
const DEFAULT_DEPTS = ['Hành chính', 'Văn phòng', 'Kế toán', ADMIN_DEPT];

// Ca mặc định — có cửa sổ nhận VÀO/RA để lịch trình tự dò đúng ca theo giờ chấm (HC và Sáng cùng giờ vào, phân biệt bằng giờ ra)
const DEFAULT_SHIFTS = [
  { code: 'HC', name: 'Ca hành chính', start: '08:00', end: '17:00', brk: 60, brkStart: '12:00', unit: 1.0, cross: 0,
    ci: ['06:00', '10:00'], co: ['15:00', '20:00'] },
  { code: 'S', name: 'Ca sáng', start: '08:00', end: '12:00', brk: 0, brkStart: '', unit: 0.5, cross: 0,
    ci: ['06:00', '10:00'], co: ['10:30', '14:00'] },
  { code: 'C', name: 'Ca chiều', start: '13:00', end: '17:00', brk: 0, brkStart: '', unit: 0.5, cross: 0,
    ci: ['11:30', '14:30'], co: ['15:00', '20:00'] },
  { code: 'DEM', name: 'Ca đêm', start: '22:00', end: '06:00', brk: 0, brkStart: '', unit: 1.0, cross: 1,
    ci: ['20:00', '23:59'], co: ['04:00', '09:00'] },
];

function seedShiftsAndSchedules() {
  if (db.prepare('SELECT 1 FROM shifts LIMIT 1').get()) return;   // đã có ca (DB cũ) → không đụng
  const ins = db.prepare(`INSERT INTO shifts
    (code, name, start_time, end_time, late_grace_min, early_grace_min, work_days, break_minutes, break_start,
     work_unit_value, cross_midnight, check_in_start, check_in_end, check_out_start, check_out_end)
    VALUES (?,?,?,?,5,15,'1,2,3,4,5,6',?,?,?,?,?,?,?,?)`);
  const id = {};
  for (const s of DEFAULT_SHIFTS) {
    id[s.code] = ins.run(s.code, s.name, s.start, s.end, s.brk, s.brkStart, s.unit, s.cross,
      s.ci[0], s.ci[1], s.co[0], s.co[1]).lastInsertRowid;
  }

  // Lịch trình vào ra: "Giờ đầu - Giờ cuối" (mặc định) + "Tự động - Qua đêm"
  if (!db.prepare('SELECT 1 FROM inout_schedules LIMIT 1').get()) {
    const io = db.prepare('INSERT INTO inout_schedules(code, name, rule, min_minutes, max_minutes, gap_minutes, is_default) VALUES (?,?,?,?,?,?,?)');
    io.run('GDGC', 'Giờ đầu - Giờ cuối', 'filo', 30, 960, 30, 1);
    io.run('TDQD', 'Tự động - Qua đêm', 'tdqd', 30, 960, 30, 0);
  }

  // Lịch trình ca làm việc (nhóm ca, tự dò ca theo giờ chấm)
  if (!db.prepare('SELECT 1 FROM work_schedules LIMIT 1').get()) {
    const ws = db.prepare("INSERT INTO work_schedules(code, name, description, unit, cycle) VALUES (?,?,?,'auto',1)");
    const link = db.prepare('INSERT INTO work_schedule_shifts(work_schedule_id, shift_id, sort_order) VALUES (?,?,?)');
    const add = (code, name, desc, codes) => {
      const wsId = ws.run(code, name, desc).lastInsertRowid;
      codes.forEach((c, i) => link.run(wsId, id[c], i));
    };
    add('HC', 'Hành chính', 'Ca hành chính - Ca sáng - Ca chiều', ['HC', 'S', 'C']);
    add('THEOCA', 'Theo ca', 'Ca hành chính - Ca đêm', ['HC', 'DEM']);
  }
  return id.HC;
}

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

  // Bộ phận mặc định
  const insDept = db.prepare('INSERT OR IGNORE INTO departments(name) VALUES(?)');
  for (const d of DEFAULT_DEPTS) insDept.run(d);

  // Ca + lịch trình mặc định
  const shiftId = seedShiftsAndSchedules() || db.prepare('SELECT id FROM shifts ORDER BY id LIMIT 1').get()?.id || null;

  // Tài khoản admin — bộ phận "Quản trị"
  if (!db.prepare("SELECT id FROM employees WHERE username = 'admin'").get()) {
    db.prepare(`INSERT INTO employees
      (code, full_name, department, position, role, username, password_hash, office_id, shift_id)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      'AD001', 'Quản trị Digiplus', ADMIN_DEPT, 'Admin', 'admin',
      'admin', hashPassword('admin123'), officeId, shiftId);
  }

  setSetting('seeded', '1');
  console.log('  ✓ Đã tạo dữ liệu khởi tạo (admin/admin123)');
}

// Cho phép chạy trực tiếp: node server/seed.js
if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/')) {
  const { initSchema } = await import('./db.js');
  initSchema();
  ensureSeed();
  console.log('Seed xong.');
}
