// Test SỬA LƯƠNG HÀNG LOẠT (bulkSetSalary ở server/payroll-calc.js): chọn bộ phận (kèm con) / tất cả,
// chỉ ghi đè ô được gửi, ô khác giữ nguyên; bỏ qua NV nghỉ việc và admin; giá trị sai thì báo lỗi, không ghi gì.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-salary-bulk-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, bulkSetSalary;
let seq = 0;
function emp(dept, { role = 'employee', active = 1 } = {}) {
  const code = 'SB' + (++seq);
  db.prepare('INSERT INTO employees(code,full_name,username,password_hash,role,department,active) VALUES(?,?,?,?,?,?,?)')
    .run(code, code, code, 'x', role, dept, active);
  return db.prepare('SELECT id FROM employees WHERE code=?').get(code).id;
}
const cfg = (id) => db.prepare('SELECT * FROM salary_configs WHERE employee_id=?').get(id);

before(async () => {
  const m = await import('../server/db.js');
  db = m.db; m.initSchema();
  ({ bulkSetSalary } = await import('../server/payroll-calc.js'));
  db.prepare("INSERT INTO departments(name) VALUES('Sản xuất')").run();
  const p = db.prepare("SELECT id FROM departments WHERE name='Sản xuất'").get().id;
  db.prepare("INSERT INTO departments(name,parent_id) VALUES('Tổ in',?)").run(p);
  db.prepare("INSERT INTO departments(name) VALUES('Văn phòng')").run();
});

test('theo bộ phận: áp cả bộ phận con, không đụng bộ phận khác, giữ ô không gửi', () => {
  const a = emp('Sản xuất'), b = emp('Tổ in'), c = emp('Văn phòng');
  db.prepare('INSERT INTO salary_configs(employee_id,basic_salary,allowance,working_days_per_month,ot_rate_weekday,ot_rate_weekend,ot_rate_holiday) VALUES(?,?,?,?,?,?,?)')
    .run(a, 7000000, 300000, 24, 1.5, 2, 3);
  const n = bulkSetSalary({ dept: 'Sản xuất', fields: { basic_salary: 6000000 } });
  assert.equal(n, 2);
  assert.equal(cfg(a).basic_salary, 6000000);
  assert.equal(cfg(a).allowance, 300000);          // giữ nguyên
  assert.equal(cfg(a).working_days_per_month, 24); // giữ nguyên
  assert.equal(cfg(b).basic_salary, 6000000);      // bộ phận con
  assert.equal(cfg(b).working_days_per_month, 26); // NV mới → mặc định
  assert.equal(cfg(c), undefined);                 // bộ phận khác không đụng
});

test('tất cả NV: bỏ qua NV nghỉ việc và admin (khi không tính lương admin)', () => {
  const off = emp('Văn phòng', { active: 0 }), adm = emp('Văn phòng', { role: 'admin' }), x = emp('Văn phòng');
  bulkSetSalary({ fields: { allowance: 500000, ot_rate_weekday: 1.8 } });
  assert.equal(cfg(x).allowance, 500000);
  assert.equal(cfg(x).ot_rate_weekday, 1.8);
  assert.equal(cfg(off), undefined);
  assert.equal(cfg(adm), undefined);
});

test('đơn giá ngày rỗng/null = tự tính (lưu null)', () => {
  const a = emp('Văn phòng');
  bulkSetSalary({ dept: 'Văn phòng', fields: { daily_rate: 250000 } });
  assert.equal(cfg(a).daily_rate, 250000);
  bulkSetSalary({ dept: 'Văn phòng', fields: { daily_rate: null } });
  assert.equal(cfg(a).daily_rate, null);
});

test('giá trị sai hoặc không chọn ô nào → báo lỗi, không ghi gì', () => {
  const a = emp('Văn phòng');
  bulkSetSalary({ dept: 'Văn phòng', fields: { basic_salary: 5000000 } });
  assert.throws(() => bulkSetSalary({ dept: 'Văn phòng', fields: {} }), /Chưa chọn/);
  assert.throws(() => bulkSetSalary({ dept: 'Văn phòng', fields: { basic_salary: -1 } }), /không hợp lệ/);
  assert.throws(() => bulkSetSalary({ dept: 'Văn phòng', fields: { working_days_per_month: 40 } }), /1 đến 31/);
  assert.throws(() => bulkSetSalary({ dept: 'Văn phòng', fields: { ot_rate_holiday: 0 } }), /lớn hơn 0/);
  assert.equal(cfg(a).basic_salary, 5000000);
});
