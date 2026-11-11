// PHỤ CẤP LÀM ĐÊM (công tắc night_pay, mặc định TẮT) — Điều 98 BLLĐ 2019:
//   giờ làm trong ca rơi vào 22:00–06:00 thêm 30%; tăng ca ban đêm thêm 30% + 20% × lương giờ ban ngày của ngày đó
//   (ngày thường 200%, ngày nghỉ 270%, ngày lễ 390% khi hệ số tăng ca 1,5 / 2 / 3). Tắt công tắc = bảng lương y như cũ.
// Chạy: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, mkdirSync } from 'node:fs';

const DIR = join(tmpdir(), `dgp-lam-dem-${process.pid}`);
mkdirSync(DIR, { recursive: true });
process.env.DB_PATH = join(DIR, 'digiplus.db');

let db, setSetting, C, P, R;
// giờ Việt Nam → ISO (UTC)
const vn = (date, hm, addDay = 0) => new Date(Date.parse(`${date}T${hm}:00+07:00`) + addDay * 86400000).toISOString();

before(async () => {
  const D = await import('../server/db.js');
  ({ db, setSetting } = D); D.initSchema();
  C = await import('../server/attendance-calc.js');
  P = await import('../server/payroll-calc.js');
  R = await import('../server/pay-rules.js');
});
after(() => { try { db.close(); } catch {} try { rmSync(DIR, { recursive: true, force: true }); } catch {} });

test('nightMinutes: đếm đúng phút nằm trong 22:00–06:00 giờ Việt Nam', () => {
  const D = '2026-11-02';
  assert.equal(C.nightMinutes(vn(D, '22:00'), vn(D, '06:00', 1)), 480);   // trọn ca đêm
  assert.equal(C.nightMinutes(vn(D, '08:00'), vn(D, '17:00')), 0);        // ca ngày
  assert.equal(C.nightMinutes(vn(D, '20:00'), vn(D, '23:00')), 60);       // chỉ 22:00–23:00
  assert.equal(C.nightMinutes(vn(D, '05:00'), vn(D, '07:00')), 60);       // đêm hôm trước kéo tới 06:00
  assert.equal(C.nightMinutes(vn(D, '21:59'), vn(D, '22:00')), 0);        // sát mốc: chưa tới 22:00
  assert.equal(C.nightMinutes(vn(D, '06:00'), vn(D, '06:01')), 0);        // sát mốc: đúng 06:00 là hết
  assert.equal(C.nightMinutes(vn(D, '00:00'), vn(D, '00:00', 2)), 960);   // 2 ngày liền = 2 × 8 giờ
  assert.equal(C.nightMinutes(vn(D, '23:00'), vn(D, '22:00')), 0);        // khoảng ngược
  assert.equal(C.nightMinutes(null, vn(D, '22:00')), 0);
});

test('nightSplit: tách giờ đêm trong ca và giờ đêm tăng ca, không vượt giờ công / phút tăng ca của dòng', () => {
  const D = '2026-11-02';
  const dem = { start_time: '22:00', end_time: '06:00' }, hc = { start_time: '08:00', end_time: '17:00' };
  // ca đêm 22–06 nghỉ giữa ca 60 phút → giờ công 420: giờ đêm trong ca không vượt 420
  assert.deepEqual(P.nightSplit({ work_date: D, ...dem, check_in_at: vn(D, '21:55'), check_out_at: vn(D, '06:05', 1), work_minutes: 420, ot_min: 0 }), { reg: 420, ot: 0 });
  // ca ngày tăng ca tới 23:30: 90 phút tăng ca rơi vào đêm
  assert.deepEqual(P.nightSplit({ work_date: D, ...hc, check_in_at: vn(D, '08:00'), check_out_at: vn(D, '23:30'), work_minutes: 480, ot_min: 390 }), { reg: 0, ot: 90 });
  // tăng ca đã bị làm tròn / cắt còn 30 phút → giờ đêm tăng ca không vượt 30
  assert.deepEqual(P.nightSplit({ work_date: D, ...hc, check_in_at: vn(D, '08:00'), check_out_at: vn(D, '23:30'), work_minutes: 480, ot_min: 30 }), { reg: 0, ot: 30 });
  // tăng ca TRƯỚC ca: vào 04:00 cho ca 08:00 → 120 phút đêm (04:00–06:00) là tăng ca
  assert.deepEqual(P.nightSplit({ work_date: D, ...hc, check_in_at: vn(D, '04:00'), check_out_at: vn(D, '17:00'), work_minutes: 480, ot_min: 240 }), { reg: 0, ot: 120 });
  // ngày nghỉ: cả ngày là tăng ca (giờ công 0) → giờ đêm tính hết vào tăng ca
  assert.deepEqual(P.nightSplit({ work_date: D, ...hc, check_in_at: vn(D, '20:00'), check_out_at: vn(D, '04:00', 1), work_minutes: 0, ot_min: 480 }), { reg: 0, ot: 360 });
  // không rõ ca → coi là giờ làm thường
  assert.deepEqual(P.nightSplit({ work_date: D, check_in_at: vn(D, '21:00'), check_out_at: vn(D, '02:00', 1), work_minutes: 300, ot_min: 0 }), { reg: 240, ot: 0 });
  // thiếu giờ ra → 0
  assert.deepEqual(P.nightSplit({ work_date: D, ...dem, check_in_at: vn(D, '22:00'), check_out_at: null, work_minutes: 0, ot_min: 0 }), { reg: 0, ot: 0 });
});

test('bảng lương: tắt công tắc = y như cũ; bật = thêm đúng tiền làm đêm (ngày thường 200%, ngày nghỉ 270%, ngày lễ 390%)', () => {
  const emp = Number(db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash) VALUES ('ND1','Làm Đêm','employee','nd1','x')").run().lastInsertRowid);
  const sh = (n, s, e) => Number(db.prepare('INSERT INTO shifts(name, start_time, end_time, break_minutes) VALUES (?,?,?,0)').run(n, s, e).lastInsertRowid);
  const DEM = sh('Đêm thử', '22:00', '06:00'), HC = sh('HC thử', '08:00', '17:00');
  // đơn giá ngày 480.000, 8 giờ chuẩn → 60.000 đ/giờ; hệ số tăng ca 1,5 / 2 / 3
  db.prepare(`INSERT INTO salary_configs(employee_id, basic_salary, daily_rate, working_days_per_month, ot_rate_weekday, ot_rate_weekend, ot_rate_holiday, allowance, hourly_rate)
              VALUES (?, 0, 480000, 26, 1.5, 2, 3, 0, 0)`).run(emp);
  const att = db.prepare(`INSERT INTO attendance(employee_id, work_date, shift_id, check_in_at, check_out_at, work_unit, work_minutes, ot_min, ot_type) VALUES (?,?,?,?,?,?,?,?,?)`);
  att.run(emp, '2026-11-02', DEM, vn('2026-11-02', '22:00'), vn('2026-11-02', '06:00', 1), 1, 480, 0, 'thuong');      // ca đêm trọn 8 giờ
  att.run(emp, '2026-11-03', HC, vn('2026-11-03', '08:00'), vn('2026-11-03', '23:59'), 1, 480, 120, 'thuong');   // ca ngày, tăng ca 120 phút được tính (22:00–23:59 rơi vào đêm → tối đa 119, lấy 119)
  att.run(emp, '2026-11-08', HC, vn('2026-11-08', '22:00'), vn('2026-11-08', '00:00', 1), 0, 0, 120, 'cuoi_tuan');     // Chủ nhật: 2 giờ tăng ca đêm
  att.run(emp, '2026-11-10', HC, vn('2026-11-10', '22:00'), vn('2026-11-10', '00:00', 1), 0, 0, 120, 'le');            // ngày lễ: 2 giờ tăng ca đêm
  const pay = () => P.computePayrollForEmployee(emp, '2026-11-01', '2026-11-30');

  const off = pay();
  assert.equal(off.nightPay, undefined, 'tắt công tắc: không có trường phụ cấp đêm');
  const otOff = (120 / 60) * 60000 * 1.5 + 2 * 60000 * 2 + 2 * 60000 * 3;
  assert.equal(off.otSalary, otOff);
  assert.equal(off.gross, 2 * 480000 + otOff);

  setSetting('night_pay', '1');
  const on = pay();
  assert.equal(on.otSalary, off.otSalary, 'tiền tăng ca không đổi');
  assert.equal(on.workSalary, off.workSalary);
  assert.equal(on.nightHours, 8);
  assert.equal(on.nightOtHours, Math.round((119 + 120 + 120) / 60 * 100) / 100);
  const expect = 8 * 60000 * 0.30                     // ca đêm: +30%
    + (119 / 60) * 60000 * (0.30 + 0.20 * 1)          // tăng ca đêm ngày thường: +50% → cộng 150% tăng ca = 200%
    + 2 * 60000 * (0.30 + 0.20 * 2)                   // ngày nghỉ: +70% → 270%
    + 2 * 60000 * (0.30 + 0.20 * 3);                  // ngày lễ: +90% → 390%
  assert.equal(on.nightPay, Math.round(expect));
  assert.equal(on.gross, Math.round(off.gross + expect));
  assert.equal(on.net, on.gross);

  // đổi phần trăm
  setSetting('night_pct', '35'); setSetting('night_ot_pct', '0');
  assert.equal(pay().nightPay, Math.round((8 + 119 / 60 + 2 + 2) * 60000 * 0.35));
  setSetting('night_pct', '30'); setSetting('night_ot_pct', '20'); setSetting('night_pay', '0');
  assert.deepEqual(pay(), off, 'tắt lại: kết quả trùng khít bản trước khi bật');
});

test('tiền lương nâng cao: có dòng Phụ cấp làm đêm (miễn thuế cùng công tắc phần chênh tăng ca) + biến công thức', () => {
  const params = R.normalizeParams({});
  const base = { workUnits: 26, paidLeaveDays: 0, dailyRate: 480000, workSalary: 12480000, paidLeaveSalary: 0, otSalary: 0, allowance: 0, basicSalary: 12480000,
    nightHours: 8, nightOtHours: 2, nightPay: 204000 };
  const comps = R.compileComponents([{ code: 'X2', name: 'Gấp đôi phụ cấp đêm', kind: 'info', value_type: 'formula', formula: 'PHU_CAP_DEM * 2 + GIO_LAM_DEM', show: 1, deptList: [] }]);
  const ctx = { params, flags: { ins: false, tax: true, formula: true }, profile: { ins_on: 0, tax_mode: 'progressive', dependents: 0 }, basic: 12480000, workDays: 26, comps, periodItems: {}, advance: 0 };
  const s = R.computeSlip(base, ctx);
  const line = s.lines.find((l) => l.code === 'PHU_CAP_DEM');
  assert.ok(line, 'có dòng PHU_CAP_DEM');
  assert.equal(line.amount, 204000);
  assert.equal(line.taxable, 0);
  assert.equal(s.comp.X2, 204000 * 2 + 10);
  // không bật phụ cấp đêm (bảng lương cơ bản không trả nightPay) → không có dòng này
  const { nightHours, nightOtHours, nightPay, ...plain } = base;
  assert.equal(R.computeSlip(plain, ctx).lines.some((l) => l.code === 'PHU_CAP_DEM'), false);
  // tắt miễn thuế phần chênh → phụ cấp đêm chịu thuế đủ
  const s2 = R.computeSlip(base, { ...ctx, params: R.normalizeParams({ ot_premium_exempt: 0 }) });
  assert.equal(s2.lines.find((l) => l.code === 'PHU_CAP_DEM').taxable, 204000);
});
