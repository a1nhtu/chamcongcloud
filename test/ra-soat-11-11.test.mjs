// RÀ SOÁT 11/11/2026 — các sửa đổi Anh duyệt:
//  · sao lưu nằm cạnh file CSDL đang dùng (máy chủ thử với DB_PATH không còn ghi vào data/backups của bản chính)
//  · đổi mật khẩu → phiên đăng nhập cấp trước đó bị từ chối
//  · số giờ chuẩn 1 ngày công (pay_hours_per_day, mặc định 8) dùng cho đơn giá giờ
//  · phép năm: tháng vào làm được tính khi còn từ 50% số ngày của tháng
//  · chế độ ưu đãi có loại "Hành kinh"
// Chạy: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = join(tmpdir(), `dgp-ra-soat-1111-${process.pid}`);
mkdirSync(DIR, { recursive: true });
const DBP = join(DIR, 'digiplus.db');
process.env.DB_PATH = DBP;

let db, setSetting, A, B, P, L, PV, R;
before(async () => {
  const D = await import('../server/db.js');
  ({ db, setSetting } = D); D.initSchema();
  A = await import('../server/auth.js');
  B = await import('../server/backup.js');
  P = await import('../server/payroll-calc.js');
  L = await import('../server/leave-quota.js');
  PV = await import('../server/privilege.js');
  R = await import('../server/pay-rules.js');
});
after(() => { try { db.close(); } catch {} try { rmSync(DIR, { recursive: true, force: true }); } catch {} });

test('sao lưu đi theo thư mục của CSDL đang dùng, không rơi vào data/backups của bản chính', () => {
  const appData = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'backups');
  assert.equal(resolve(B.backupDir()), resolve(DIR, 'backups'));
  assert.notEqual(resolve(B.backupDir()), appData);
  const r = B.doBackup('manual');
  assert.ok(B.listBackups().some((b) => b.name === r.name), 'bản vừa sao lưu nằm trong thư mục cạnh CSDL');
});

// gọi middleware authRequired với 1 token, trả về mã trạng thái (200 = qua)
function auth(token) {
  let status = 200, body = null;
  const res = { status(c) { status = c; return this; }, json(b) { body = b; return this; } };
  A.authRequired({ headers: { authorization: 'Bearer ' + token } }, res, () => {});
  return { status, body };
}

test('đổi mật khẩu → phiên cũ bị từ chối, phiên mới dùng được; phiên cấp trước bản này (không có pv) vẫn dùng được', () => {
  const id = Number(db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash) VALUES ('PV1','Người Thử','employee','pv1','x')").run().lastInsertRowid);
  const row = () => db.prepare('SELECT * FROM employees WHERE id=?').get(id);
  assert.equal(row().pw_ver, 0);
  const cu = A.signToken(row());
  // token kiểu cũ (trước v1.33.7) không có trường pv
  const legacy = A.signToken({ id, code: 'PV1', role: 'employee', full_name: 'Người Thử' });
  assert.equal(auth(cu).status, 200);
  assert.equal(auth(legacy).status, 200);
  db.prepare('UPDATE employees SET pw_ver = IFNULL(pw_ver,0) + 1 WHERE id=?').run(id);   // như khi đổi mật khẩu
  assert.equal(auth(cu).status, 401);
  assert.equal(auth(legacy).status, 401);
  assert.equal(auth(A.signToken(row())).status, 200);
});

test('số giờ chuẩn 1 ngày công: mặc định 8, đổi được 1–24, giá trị sai thì về 8', () => {
  assert.equal(P.hoursPerDay(), 8);
  setSetting('pay_hours_per_day', '12'); assert.equal(P.hoursPerDay(), 12);
  setSetting('pay_hours_per_day', '7.5'); assert.equal(P.hoursPerDay(), 7.5);
  setSetting('pay_hours_per_day', '0'); assert.equal(P.hoursPerDay(), 8);
  setSetting('pay_hours_per_day', 'abc'); assert.equal(P.hoursPerDay(), 8);
  setSetting('pay_hours_per_day', '8');
});

test('lương cơ bản: tiền tăng ca theo đơn giá giờ = đơn giá ngày ÷ số giờ chuẩn', () => {
  const id = Number(db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash) VALUES ('HP1','Giờ Chuẩn','employee','hp1','x')").run().lastInsertRowid);
  db.prepare(`INSERT INTO salary_configs(employee_id, basic_salary, daily_rate, working_days_per_month, ot_rate_weekday, ot_rate_weekend, ot_rate_holiday, allowance, hourly_rate)
              VALUES (?, 0, 480000, 26, 1.5, 2, 3, 0, 0)`).run(id);
  db.prepare(`INSERT INTO attendance(employee_id, work_date, check_in_at, check_out_at, work_unit, work_minutes, ot_min, ot_type)
              VALUES (?, '2026-11-02', '2026-11-02T01:00:00.000Z', '2026-11-02T12:00:00.000Z', 1, 480, 120, 'thuong')`).run(id);
  const ot = () => P.computePayrollForEmployee(id, '2026-11-01', '2026-11-30').otSalary;
  assert.equal(ot(), 2 * (480000 / 8) * 1.5);     // 8 giờ: 60.000 đ/giờ × 2 giờ × 1,5
  setSetting('pay_hours_per_day', '12');
  assert.equal(ot(), 2 * (480000 / 12) * 1.5);    // 12 giờ: 40.000 đ/giờ
  setSetting('pay_hours_per_day', '8');
});

test('tiền lương nâng cao: biến DON_GIA_GIO theo số giờ chuẩn truyền vào', () => {
  const params = R.normalizeParams({});
  const base = { workUnits: 26, paidLeaveDays: 0, dailyRate: 480000, workSalary: 0, paidLeaveSalary: 0, otSalary: 0, allowance: 0, basicSalary: 0 };
  const comps = R.compileComponents([{ code: 'GIO', name: 'Đơn giá giờ', kind: 'info', value_type: 'formula', formula: 'DON_GIA_GIO', show: 1, deptList: [] }]);
  const ctx = { params, flags: { formula: true }, profile: { ins_on: 0, tax_mode: 'none', dependents: 0 }, basic: 0, workDays: 26, comps, periodItems: {}, advance: 0 };
  assert.equal(R.computeSlip(base, ctx).comp.GIO, 60000);
  assert.equal(R.computeSlip(base, { ...ctx, hoursPerDay: 12 }).comp.GIO, 40000);
});

test('phép năm năm đầu: tháng vào làm tính khi còn từ 50% số ngày của tháng', () => {
  const y = 2026;
  const mk = (code, start) => Number(db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash, start_date) VALUES (?,?,'employee',?,'x',?)").run(code, code, code.toLowerCase(), start).lastInsertRowid);
  const full = (start, code) => L.leaveBalance(mk(code, start), y, `${y}-12-31`).full;
  assert.equal(full('2026-06-15', 'LQ1'), 7);   // tháng 6 tính → 7 tháng × 1 ngày
  assert.equal(full('2026-06-16', 'LQ2'), 7);   // 15/30 ngày còn lại = đúng 50% → VẪN tính (trước đây bị bỏ)
  assert.equal(full('2026-06-17', 'LQ3'), 6);   // dưới 50% → không tính tháng 6
  assert.equal(full('2026-07-16', 'LQ4'), 6);   // tháng 31 ngày: 16/31 → tính
  assert.equal(full('2026-02-15', 'LQ5'), 11);  // tháng 2 có 28 ngày: 14/28 = 50% → tính
  assert.equal(full('2026-02-16', 'LQ6'), 10);  // 13/28 → không tính
});

test('chế độ ưu đãi có loại Hành kinh (30 phút/ngày theo Điều 137 BLLĐ 2019)', () => {
  assert.deepEqual(PV.PRIV_KINDS, ['Mang thai', 'Nuôi con nhỏ', 'Hành kinh', 'Khác']);
});
