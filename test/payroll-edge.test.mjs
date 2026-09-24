// Test biên cho payroll-calc.js: làm tròn tiền, lương ngày/giờ/tháng, nghỉ không lương,
// phạt đi trễ/về sớm (qua work_unit đã bị giảm), tháng thiếu dữ liệu, số âm/0.
// Các hàm đụng DB → dùng DB tạm riêng (như shift-resolver.test.mjs).
// node --test chạy mỗi file test trong tiến trình RIÊNG → set DB_PATH tạm ở đây không đụng DB khác.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-payroll-edge-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, initSchema, setSetting, computePayrollForEmployee, computePayrollTable;

const PERIOD_FROM = '2026-05-01';
const PERIOD_TO = '2026-05-31';

let empSeq = 0;
function makeEmployee({ role = 'employee', active = 1, dept = '' } = {}) {
  empSeq++;
  const code = `EE${empSeq}`;
  db.prepare(
    "INSERT INTO employees(code,full_name,username,password_hash,role,department,active) VALUES(?,?,?,?,?,?,?)"
  ).run(code, code, code, 'x', role, dept, active);
  return db.prepare('SELECT id FROM employees WHERE code=?').get(code).id;
}

function setCfg(employeeId, over = {}) {
  const c = {
    basic_salary: 0, daily_rate: null, working_days_per_month: 26,
    ot_rate_weekday: 1.5, ot_rate_weekend: 2.0, ot_rate_holiday: 3.0,
    allowance: 0, hourly_rate: 0, ...over,
  };
  db.prepare(`INSERT INTO salary_configs
    (employee_id, basic_salary, daily_rate, working_days_per_month, ot_rate_weekday, ot_rate_weekend, ot_rate_holiday, allowance, hourly_rate)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(employeeId, c.basic_salary, c.daily_rate, c.working_days_per_month, c.ot_rate_weekday, c.ot_rate_weekend, c.ot_rate_holiday, c.allowance, c.hourly_rate);
}

function addAtt(employeeId, workDate, { work_unit = 0, work_minutes = 0, ot_min = 0, ot_type = null } = {}) {
  db.prepare('INSERT INTO attendance(employee_id, work_date, work_unit, work_minutes, ot_min, ot_type) VALUES(?,?,?,?,?,?)')
    .run(employeeId, workDate, work_unit, work_minutes, ot_min, ot_type);
}

function addLeave(employeeId, type, from, to, status = 'approved') {
  db.prepare('INSERT INTO leave_requests(employee_id, type, from_date, to_date, status) VALUES(?,?,?,?,?)')
    .run(employeeId, type, from, to, status);
}

before(async () => {
  ({ db, initSchema, setSetting } = await import('../server/db.js'));
  ({ computePayrollForEmployee, computePayrollTable } = await import('../server/payroll-calc.js'));
  initSchema();
  setSetting('attendance_mode', 'shift'); // mặc định — mỗi test hourly tự bật rồi các test sau tự đặt lại
});

// ---- Lương theo NGÀY (daily_rate) vs THÁNG (basic_salary / working_days) ----

test('daily_rate > 0 → dùng trực tiếp, bỏ qua basic_salary', () => {
  const id = makeEmployee();
  setCfg(id, { basic_salary: 5000000, daily_rate: 300000, working_days_per_month: 26 });
  addAtt(id, '2026-05-05', { work_unit: 1 });
  const r = computePayrollForEmployee(id, PERIOD_FROM, PERIOD_TO);
  assert.equal(r.dailyRate, 300000);
  assert.equal(r.workSalary, 300000);
  assert.equal(r.gross, 300000);
});

test('daily_rate = 0 → coi như chưa đặt, quay về basic_salary / working_days_per_month', () => {
  const id = makeEmployee();
  setCfg(id, { basic_salary: 2600000, daily_rate: 0, working_days_per_month: 26 });
  addAtt(id, '2026-05-05', { work_unit: 1 });
  const r = computePayrollForEmployee(id, PERIOD_FROM, PERIOD_TO);
  assert.equal(r.dailyRate, 100000);
  assert.equal(r.workSalary, 100000);
});

test('daily_rate âm → coi như chưa đặt (chỉ >0 mới được dùng), quay về basic_salary / working_days', () => {
  const id = makeEmployee();
  setCfg(id, { basic_salary: 2600000, daily_rate: -500000, working_days_per_month: 26 });
  addAtt(id, '2026-05-05', { work_unit: 1 });
  const r = computePayrollForEmployee(id, PERIOD_FROM, PERIOD_TO);
  assert.equal(r.dailyRate, 100000);
});

// GHI CHÚ (không sửa logic): working_days_per_month dùng `cfg.working_days_per_month || 26`, chỉ chặn 0 (falsy),
// KHÔNG chặn số âm. Cấu hình sai (số âm) khiến dailyRate và lương ra ÂM mà không có cảnh báo/chặn nào.
test('[NGHI NGỜ LOGIC] working_days_per_month âm → dailyRate và workSalary bị tính RA SỐ ÂM (không có chặn)', () => {
  const id = makeEmployee();
  setCfg(id, { basic_salary: 2600000, daily_rate: null, working_days_per_month: -2 });
  addAtt(id, '2026-05-05', { work_unit: 1 });
  const r = computePayrollForEmployee(id, PERIOD_FROM, PERIOD_TO);
  assert.equal(r.dailyRate, -1300000);
  assert.equal(r.workSalary, -1300000);
  assert.equal(r.gross, -1300000);
});

test('basic_salary = 0 và daily_rate = null → dailyRate = 0, dù có công vẫn không ra lương', () => {
  const id = makeEmployee();
  setCfg(id, { basic_salary: 0, daily_rate: null, working_days_per_month: 26 });
  addAtt(id, '2026-05-05', { work_unit: 1 });
  const r = computePayrollForEmployee(id, PERIOD_FROM, PERIOD_TO);
  assert.equal(r.dailyRate, 0);
  assert.equal(r.workSalary, 0);
  assert.equal(r.gross, 0);
});

test('không có bản ghi salary_configs (NV chưa cấu hình lương) → dùng cấu hình mặc định, lương = 0', () => {
  const id = makeEmployee(); // không gọi setCfg
  addAtt(id, '2026-05-05', { work_unit: 1 });
  const r = computePayrollForEmployee(id, PERIOD_FROM, PERIOD_TO);
  assert.equal(r.dailyRate, 0);
  assert.equal(r.workSalary, 0);
  assert.equal(r.gross, 0);
  assert.equal(r.net, 0);
});

// ---- Làm tròn tiền ----

test('làm tròn: Math.round quy tròn .5 lên (round half up)', () => {
  const id = makeEmployee();
  setCfg(id, { daily_rate: 100.5 });
  addAtt(id, '2026-05-05', { work_unit: 1 });
  const r = computePayrollForEmployee(id, PERIOD_FROM, PERIOD_TO);
  assert.equal(r.workSalary, 101); // Math.round(100.5) = 101
});

// GHI CHÚ (không sửa logic): mỗi thành phần (workSalary, paidLeaveSalary...) được làm tròn RIÊNG trước khi trả về,
// còn `gross` được làm tròn từ TỔNG CHƯA làm tròn. Khi cộng dồn số lẻ, tổng các thành phần đã làm tròn
// có thể LỆCH với gross đã làm tròn (sai số cộng dồn do làm tròn riêng lẻ).
test('[NGHI NGỜ LOGIC] làm tròn từng phần rồi cộng lại có thể LỆCH với gross (đã làm tròn trên tổng thô)', () => {
  const id = makeEmployee();
  setCfg(id, { daily_rate: 100.5 });
  addAtt(id, '2026-05-05', { work_unit: 1 });
  addLeave(id, 'Nghỉ phép', '2026-05-06', '2026-05-06'); // 1 ngày nghỉ có lương, cùng đơn giá 100.5
  const r = computePayrollForEmployee(id, PERIOD_FROM, PERIOD_TO);
  assert.equal(r.workSalary, 101);       // round(100.5)
  assert.equal(r.paidLeaveSalary, 101);  // round(100.5)
  assert.equal(r.gross, 201);            // round(100.5 + 100.5) = round(201) = 201
  // 101 + 101 = 202 ≠ 201 — cộng các cột lẻ trên bảng lương sẽ không khớp cột "Thực nhận".
  assert.notEqual(r.workSalary + r.paidLeaveSalary, r.gross);
});

// ---- Lương theo GIỜ (chế độ chấm công 'hourly') ----

test('chế độ hourly: tổng giờ làm × đơn giá giờ + phụ cấp, ngày 0 phút không tính vào daysWorked', () => {
  const id = makeEmployee();
  setSetting('attendance_mode', 'hourly');
  setCfg(id, { hourly_rate: 50000, allowance: 200000 });
  addAtt(id, '2026-05-01', { work_minutes: 480 }); // 8h
  addAtt(id, '2026-05-02', { work_minutes: 0 });   // ngày không đi làm — không tính daysWorked
  addAtt(id, '2026-05-03', { work_minutes: 240 }); // 4h
  const r = computePayrollForEmployee(id, PERIOD_FROM, PERIOD_TO);
  assert.equal(r.hourly, true);
  assert.equal(r.totalHours, 12);
  assert.equal(r.daysWorked, 2);
  assert.equal(r.workSalary, 600000);
  assert.equal(r.gross, 800000);
  setSetting('attendance_mode', 'shift'); // trả lại mặc định cho các test sau
});

test('chế độ hourly: hourly_rate = 0 → workSalary = 0, gross chỉ còn phụ cấp', () => {
  const id = makeEmployee();
  setSetting('attendance_mode', 'hourly');
  setCfg(id, { hourly_rate: 0, allowance: 300000 });
  addAtt(id, '2026-05-01', { work_minutes: 480 });
  const r = computePayrollForEmployee(id, PERIOD_FROM, PERIOD_TO);
  assert.equal(r.workSalary, 0);
  assert.equal(r.gross, 300000);
  setSetting('attendance_mode', 'shift');
});

// ---- Nghỉ không lương vs nghỉ có lương ----

test('nghỉ KHÔNG LƯƠNG (đã duyệt) → không tính vào paidLeaveDays/paidLeaveSalary', () => {
  const id = makeEmployee();
  setCfg(id, { daily_rate: 100000 });
  addLeave(id, 'Nghỉ không lương', '2026-05-10', '2026-05-12', 'approved'); // 3 ngày
  const r = computePayrollForEmployee(id, PERIOD_FROM, PERIOD_TO);
  assert.equal(r.paidLeaveDays, 0);
  assert.equal(r.paidLeaveSalary, 0);
  assert.equal(r.gross, 0);
});

test('nghỉ phép CHƯA DUYỆT (pending) → không tính vào paidLeaveDays', () => {
  const id = makeEmployee();
  setCfg(id, { daily_rate: 100000 });
  addLeave(id, 'Nghỉ phép', '2026-05-10', '2026-05-12', 'pending');
  const r = computePayrollForEmployee(id, PERIOD_FROM, PERIOD_TO);
  assert.equal(r.paidLeaveDays, 0);
  assert.equal(r.paidLeaveSalary, 0);
});

test('nghỉ phép có lương lấn qua TRƯỚC kỳ lương → chỉ tính phần nằm trong kỳ (cắt ở đầu kỳ)', () => {
  const id = makeEmployee();
  const from = '2026-03-01', to = '2026-03-31';
  setCfg(id, { daily_rate: 100000 });
  addLeave(id, 'Nghỉ phép', '2026-02-27', '2026-03-02', 'approved'); // cắt còn 03-01..03-02 = 2 ngày
  const r = computePayrollForEmployee(id, from, to);
  assert.equal(r.paidLeaveDays, 2);
  assert.equal(r.paidLeaveSalary, 200000);
});

test('nghỉ phép có lương lấn qua SAU kỳ lương → chỉ tính phần nằm trong kỳ (cắt ở cuối kỳ)', () => {
  const id = makeEmployee();
  const from = '2026-03-01', to = '2026-03-31';
  setCfg(id, { daily_rate: 100000 });
  addLeave(id, 'Nghỉ phép', '2026-03-30', '2026-04-05', 'approved'); // cắt còn 03-30..03-31 = 2 ngày
  const r = computePayrollForEmployee(id, from, to);
  assert.equal(r.paidLeaveDays, 2);
  assert.equal(r.paidLeaveSalary, 200000);
});

// ---- Phạt đi trễ / về sớm (phản ánh qua work_unit đã bị giảm bởi tầng tính công) ----

test('work_unit bị giảm do đi trễ/về sớm (0.5 thay vì 1.0) → payroll nhân đúng theo work_unit thực tế', () => {
  const id = makeEmployee();
  setCfg(id, { daily_rate: 200000 });
  addAtt(id, '2026-05-04', { work_unit: 1.0 });  // ngày đủ công
  addAtt(id, '2026-05-05', { work_unit: 0.5 });  // ngày bị trừ nửa công vì trễ/sớm
  const r = computePayrollForEmployee(id, PERIOD_FROM, PERIOD_TO);
  assert.equal(r.workUnits, 1.5);
  assert.equal(r.workSalary, 300000);
});

// ---- Tăng ca (OT): 3 mức + ot_type mặc định ----

test('OT: 3 mức thường/cuối tuần/lễ nhân đúng hệ số riêng cấu hình', () => {
  const id = makeEmployee();
  setCfg(id, { daily_rate: 240000, ot_rate_weekday: 1.2, ot_rate_weekend: 1.8, ot_rate_holiday: 2.5 });
  addAtt(id, '2026-05-04', { ot_min: 60, ot_type: 'thuong' });     // 1h thường
  addAtt(id, '2026-05-09', { ot_min: 120, ot_type: 'cuoi_tuan' }); // 2h cuối tuần
  addAtt(id, '2026-05-19', { ot_min: 30, ot_type: 'le' });         // 0.5h lễ
  const r = computePayrollForEmployee(id, PERIOD_FROM, PERIOD_TO);
  // hourlyRate = 240000/8 = 30000
  assert.equal(r.otHoursWeekday, 1);
  assert.equal(r.otHoursWeekend, 2);
  assert.equal(r.otHoursHoliday, 0.5);
  assert.equal(r.otSalary, 36000 + 108000 + 37500);
  assert.equal(r.gross, 181500);
});

test('OT: ot_type NULL/khác được coi là OT THƯỜNG (mặc định weekday)', () => {
  const id = makeEmployee();
  setCfg(id, { daily_rate: 240000 }); // ot_rate_weekday mặc định 1.5
  addAtt(id, '2026-05-04', { ot_min: 60, ot_type: null });
  const r = computePayrollForEmployee(id, PERIOD_FROM, PERIOD_TO);
  assert.equal(r.otHoursWeekday, 1);
  assert.equal(r.otSalary, 45000); // 1 * 30000 * 1.5
});

// ---- Tháng thiếu dữ liệu ----

test('kỳ lương không có chấm công lẫn nghỉ phép nào → chỉ còn phụ cấp', () => {
  const id = makeEmployee();
  setCfg(id, { daily_rate: 100000, allowance: 500000 });
  const r = computePayrollForEmployee(id, PERIOD_FROM, PERIOD_TO);
  assert.equal(r.workUnits, 0);
  assert.equal(r.paidLeaveDays, 0);
  assert.equal(r.otSalary, 0);
  assert.equal(r.workSalary, 0);
  assert.equal(r.gross, 500000);
  assert.equal(r.net, r.gross);
});

// ---- Số âm / bằng 0 ----

test('phụ cấp ÂM → trừ thẳng vào gross (không bị chặn ở mức 0)', () => {
  const id = makeEmployee();
  setCfg(id, { daily_rate: 100000, allowance: -50000 });
  addAtt(id, '2026-05-05', { work_unit: 1 });
  const r = computePayrollForEmployee(id, PERIOD_FROM, PERIOD_TO);
  assert.equal(r.allowance, -50000);
  assert.equal(r.workSalary, 100000);
  assert.equal(r.gross, 50000);
});

test('work_unit = 0 nhưng vẫn có OT/nghỉ phép → các khoản tính độc lập với công đi làm', () => {
  const id = makeEmployee();
  setCfg(id, { daily_rate: 100000 });
  addLeave(id, 'Nghỉ phép', '2026-05-10', '2026-05-10', 'approved');
  addAtt(id, '2026-05-15', { work_unit: 0, ot_min: 60, ot_type: 'thuong' });
  const r = computePayrollForEmployee(id, PERIOD_FROM, PERIOD_TO);
  assert.equal(r.workUnits, 0);
  assert.equal(r.workSalary, 0);
  assert.equal(r.paidLeaveDays, 1);
  assert.equal(r.paidLeaveSalary, 100000);
  assert.equal(r.otHoursWeekday, 1);
  assert.ok(r.otSalary > 0);
});

// ---- computePayrollTable: lọc bộ phận/ids, loại admin và NV ngừng hoạt động ----

test('computePayrollTable: loại role=admin và NV active=0, lọc theo dept', () => {
  const empA = makeEmployee({ dept: 'KD', role: 'employee', active: 1 });
  makeEmployee({ dept: 'KD', role: 'admin', active: 1 });   // phải bị loại (admin)
  makeEmployee({ dept: 'KD', role: 'employee', active: 0 }); // phải bị loại (ngừng hoạt động)
  makeEmployee({ dept: 'KT', role: 'employee', active: 1 }); // khác bộ phận
  const { rows } = computePayrollTable(2026, 6, { dept: 'KD' });
  const ids = rows.map((r) => r.emp.id);
  assert.ok(ids.includes(empA));
  assert.equal(rows.length, 1);
});

test('computePayrollTable: filter.ids được ưu tiên hơn filter.dept', () => {
  const empKD = makeEmployee({ dept: 'KD2', role: 'employee', active: 1 });
  const empKT = makeEmployee({ dept: 'KT2', role: 'employee', active: 1 });
  const { rows } = computePayrollTable(2026, 6, { dept: 'KD2', ids: [empKT] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].emp.id, empKT);
  assert.notEqual(rows[0].emp.id, empKD);
});
