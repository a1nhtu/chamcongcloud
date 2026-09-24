// Test tính TĂNG CA (OT): ngưỡng, làm tròn, cờ allow_ot, ca đêm qua ngày,
// và quy đổi OT → lương (otSalary) theo hệ số ngày thường/cuối tuần/lễ.
// Phần thuần (attendance-calc.js) không chạm DB; phần lương (payroll-calc.js)
// dùng DB SQLite tạm giống test/shift-resolver.test.mjs (mỗi file test chạy
// tiến trình riêng nên set DB_PATH tạm ở đây không đụng DB khác).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { computeCheckout } from '../server/attendance-calc.js';

const iso = (d, hm) => new Date(`${d}T${hm}:00+07:00`).toISOString();
const WD = '2026-01-05'; // Thứ Hai
const NEXT = '2026-01-06'; // Thứ Ba (dùng cho ca đêm qua ngày)

const baseShift = {
  id: 7, start_time: '08:00', end_time: '17:00', break_minutes: 60,
  late_grace_min: 5, early_grace_min: 15, work_unit_value: 1.0,
  allow_ot: 1, ot_start_after_min: 30, ot_rounding_unit: 0,
};

// ===================== computeCheckout: ngưỡng & cờ allow_ot =====================

test('OT: allow_ot=0 → không tính OT dù ở lại rất lâu sau tan ca', () => {
  const shift = { ...baseShift, allow_ot: 0 };
  const c = computeCheckout(shift, iso(WD, '08:00'), iso(WD, '20:00'), WD, {});
  assert.equal(c.ot_min, 0);
});

test('OT: ở lại DƯỚI ngưỡng ot_start_after_min → ot_min = 0', () => {
  // Tan ca 17:00, ngưỡng 30' → ở lại 29' chưa đủ ngưỡng
  const c = computeCheckout(baseShift, iso(WD, '08:00'), iso(WD, '17:29'), WD, {});
  assert.equal(c.ot_min, 0);
});

test('OT: ở lại ĐÚNG ngưỡng ot_start_after_min → tính đủ (>=)', () => {
  const c = computeCheckout(baseShift, iso(WD, '08:00'), iso(WD, '17:30'), WD, {});
  assert.equal(c.ot_min, 30);
});

test('OT: ở lại TRÊN ngưỡng → ghi đúng số phút OT thực tế (không làm tròn khi unit=0)', () => {
  const c = computeCheckout(baseShift, iso(WD, '08:00'), iso(WD, '18:17'), WD, {});
  assert.equal(c.ot_min, 77); // 77' sau tan ca, ot_rounding_unit=0 → không làm tròn
});

test('OT: ot_rounding_unit > 0 → làm tròn XUỐNG theo đơn vị', () => {
  const shift = { ...baseShift, ot_rounding_unit: 15 };
  // Ở lại 47' sau tan ca → floor(47/15)*15 = 45
  const c = computeCheckout(shift, iso(WD, '08:00'), iso(WD, '17:47'), WD, {});
  assert.equal(c.ot_min, 45);
});

test('OT: ot_rounding_unit > 0 nhưng chưa đủ 1 đơn vị → làm tròn về 0', () => {
  const shift = { ...baseShift, ot_rounding_unit: 60 };
  // Ở lại 40' (đã qua ngưỡng 30') nhưng floor(40/60)*60 = 0
  const c = computeCheckout(shift, iso(WD, '08:00'), iso(WD, '17:40'), WD, {});
  assert.equal(c.ot_min, 0);
});

test('OT: không có mặt sau tan ca (về đúng giờ) → ot_min = 0', () => {
  const c = computeCheckout(baseShift, iso(WD, '08:00'), iso(WD, '17:00'), WD, {});
  assert.equal(c.ot_min, 0);
});

test('OT: ca đêm qua ngày (22:00-06:00), ở lại sau tan ca hôm sau vẫn tính đúng', () => {
  const night = { ...baseShift, start_time: '22:00', end_time: '06:00' };
  // Tan ca 06:00 hôm sau, ở lại đến 07:30 hôm sau → 90' OT
  const c = computeCheckout(night, iso(WD, '22:00'), iso(NEXT, '07:30'), WD, {});
  assert.equal(c.ot_min, 90);
});

test('OT: ot_type đi kèm ot_min theo cờ ngày (lễ/cuối tuần/thường)', () => {
  const c1 = computeCheckout(baseShift, iso(WD, '08:00'), iso(WD, '18:00'), WD, { isHoliday: true });
  assert.equal(c1.ot_min, 60); assert.equal(c1.ot_type, 'le');
  const c2 = computeCheckout(baseShift, iso(WD, '08:00'), iso(WD, '18:00'), WD, { isWeekend: true });
  assert.equal(c2.ot_min, 60); assert.equal(c2.ot_type, 'cuoi_tuan');
  const c3 = computeCheckout(baseShift, iso(WD, '08:00'), iso(WD, '18:00'), WD, {});
  assert.equal(c3.ot_min, 60); assert.equal(c3.ot_type, 'thuong');
});

// ===================== computePayrollForEmployee: quy đổi OT → lương =====================
// Dùng DB SQLite tạm (giống test/shift-resolver.test.mjs) vì hàm này đọc trực tiếp từ DB.

const DBP = join(tmpdir(), `dgp-overtime-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, initSchema, setSetting, computePayrollForEmployee;
const id = {};
const FROM = '2026-01-01', TO = '2026-01-31';

before(async () => {
  ({ db, initSchema, setSetting } = await import('../server/db.js'));
  ({ computePayrollForEmployee } = await import('../server/payroll-calc.js'));
  initSchema();

  const insEmp = (code) => {
    db.prepare("INSERT INTO employees(code,full_name,username,password_hash,role) VALUES(?,?,?,'x','employee')").run(code, code, code);
    return db.prepare('SELECT id FROM employees WHERE code=?').get(code).id;
  };
  id.G = insEmp('G'); // hệ số OT mặc định (1.5 / 2.0 / 3.0)
  id.H = insEmp('H'); // hệ số OT tuỳ chỉnh
  id.K = insEmp('K'); // chế độ tính công theo GIỜ

  // G: lương cơ bản 7.800.000, 26 công/tháng → dailyRate=300.000, hourlyRate=37.500
  db.prepare(`INSERT INTO salary_configs(employee_id, basic_salary, working_days_per_month) VALUES(?, ?, ?)`)
    .run(id.G, 7800000, 26);
  const insAtt = (empId, day, workUnit, otMin, otType) => {
    db.prepare(`INSERT INTO attendance(employee_id, work_date, work_minutes, work_unit, ot_min, ot_type)
                VALUES(?, ?, 0, ?, ?, ?)`).run(empId, day, workUnit, otMin, otType);
  };
  insAtt(id.G, '2026-01-05', 1, 60, 'thuong');    // 1h OT ngày thường
  insAtt(id.G, '2026-01-06', 1, 120, 'cuoi_tuan'); // 2h OT cuối tuần
  insAtt(id.G, '2026-01-07', 1, 180, 'le');        // 3h OT ngày lễ

  // H: hệ số OT tuỳ chỉnh (2.0 / 2.5 / 4.0)
  db.prepare(`INSERT INTO salary_configs(employee_id, basic_salary, working_days_per_month, ot_rate_weekday, ot_rate_weekend, ot_rate_holiday)
              VALUES(?, ?, ?, ?, ?, ?)`).run(id.H, 7800000, 26, 2.0, 2.5, 4.0);
  insAtt(id.H, '2026-01-08', 1, 60, 'thuong');

  // K: chế độ tính công theo GIỜ (hourly)
  db.prepare(`INSERT INTO salary_configs(employee_id, basic_salary, working_days_per_month, hourly_rate)
              VALUES(?, 0, 26, ?)`).run(id.K, 50000);
  db.prepare(`INSERT INTO attendance(employee_id, work_date, work_minutes, work_unit, ot_min, ot_type)
              VALUES(?, ?, ?, ?, ?, ?)`).run(id.K, '2026-01-09', 480, 1, 120, 'thuong'); // 8h công + 2h "OT" gộp trong work_minutes
});

test('OT: hệ số mặc định (1.5 thường / 2.0 cuối tuần / 3.0 lễ) quy ra đúng lương OT', () => {
  const p = computePayrollForEmployee(id.G, FROM, TO);
  assert.equal(p.otHoursWeekday, 1);
  assert.equal(p.otHoursWeekend, 2);
  assert.equal(p.otHoursHoliday, 3);
  assert.equal(p.otHoursTotal, 6);
  assert.equal(p.dailyRate, 300000);
  // hourlyRate = 300000/8 = 37500
  // otSalary = 1*37500*1.5 + 2*37500*2.0 + 3*37500*3.0 = 56250 + 150000 + 337500
  assert.equal(p.otSalary, 543750);
  assert.equal(p.workSalary, 900000); // 3 công * 300.000
  assert.equal(p.gross, 900000 + 543750);
});

test('OT: hệ số tuỳ chỉnh theo cấu hình lương từng nhân viên (không hard-code 1.5/2.0/3.0)', () => {
  const p = computePayrollForEmployee(id.H, FROM, TO);
  assert.equal(p.otHoursWeekday, 1);
  // hourlyRate = 300000/8 = 37500; otSalary = 1*37500*2.0 = 75000
  assert.equal(p.otSalary, 75000);
});

test('OT: chế độ tính công theo GIỜ (hourly) không cộng thêm hệ số OT riêng — trả theo tổng giờ làm', () => {
  setSetting('attendance_mode', 'hourly');
  const p = computePayrollForEmployee(id.K, FROM, TO);
  assert.equal(p.hourly, true);
  assert.equal(p.totalHours, 8); // 480 phút, không nhân hệ số OT
  assert.equal(p.otSalary, 0);
  assert.equal(p.workSalary, 8 * 50000); // 8h * 50.000đ/h
  setSetting('attendance_mode', 'shift'); // trả lại mặc định cho các test khác trong tiến trình
});
