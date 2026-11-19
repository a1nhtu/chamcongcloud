// TĂNG CA TRƯA (ca bật break_ot — mặc định TẮT, theo Phụ lục A hợp đồng khách may Hualida):
// giờ nghỉ giữa ca mà NV có mặt chỉ được dùng để BÙ phần đăng ký làm thêm còn thiếu (không vượt số đăng ký).
// Không đăng ký → giờ nghỉ không thành tăng ca; ot_raw (tăng ca thực tế ngoài ca) giữ nguyên để soát "làm quá đăng ký".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

// CSDL TẠM phải đặt TRƯỚC khi nạp mã máy chủ (db.js chốt đường dẫn lúc import) → import động bên dưới
const DBP = join(tmpdir(), `dgp-tangcatrua-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;
const { computeDayMetrics } = await import('../server/day-metrics.js');
const { capOt, otRegCapper } = await import('../server/ot-cap.js');
const { breakOtAvail } = await import('../server/attendance-calc.js');

const iso = (d, hm) => new Date(`${d}T${hm}:00+07:00`).toISOString();
const WD = '2026-01-05'; // Thứ Hai
// ca HC 07:30–16:30, nghỉ 12:00–13:00
const HC = { id: 1, start_time: '07:30', end_time: '16:30', break_minutes: 60, break_start: '12:00', late_grace_min: 0, early_grace_min: 0,
  work_unit_value: 1, allow_ot: 1, ot_start_after_min: 30, ot_rounding_unit: 0, break_ot: 1 };
const fakeDb = (regs) => ({ prepare: () => ({ get: (e, d) => (`${e}|${d}` in regs ? { minutes: regs[`${e}|${d}`] } : undefined) }) });
const ctx = (regs, required = true) => ({
  weekend: '7', roundingDecimals: 2, roundingMode: 0, hourly: false, isHoliday: () => false,
  otRound: { decimals: 2, mode: 0, block: 0 },
  otReg: otRegCapper(fakeDb(regs), (k, d) => (k === 'ot_reg_required' ? (required ? '1' : '0') : d)),
});
const day = (c, shift, inn, out) => computeDayMetrics(c, shift, WD, iso(WD, inn), iso(WD, out), null, { empId: 5 });

test('capOt: giờ trưa chỉ bù khi có đăng ký, không vượt đăng ký', () => {
  assert.equal(capOt(180, 240, true, 60), 240);   // 3h tối + 1h trưa, đăng ký 4h → 4h
  assert.equal(capOt(180, 180, true, 60), 180);   // đăng ký 3h → vẫn 3h
  assert.equal(capOt(0, 60, true, 60), 60);       // chỉ làm trưa, đăng ký 1h → 1h
  assert.equal(capOt(0, 60, true, 30), 30);       // có mặt 30' giờ nghỉ → 30'
  assert.equal(capOt(180, null, false, 60), 180); // không đăng ký, không bắt buộc → thực tế ngoài ca, giờ trưa không tính
  assert.equal(capOt(180, null, true, 60), 0);
  assert.equal(capOt(180, 240, true), 180);       // không có giờ trưa → như cũ
});

test('breakOtAvail: chỉ ca bật + cho tăng ca + có giờ bắt đầu nghỉ', () => {
  assert.equal(breakOtAvail(HC, WD, iso(WD, '07:30'), iso(WD, '16:30')), 60);
  assert.equal(breakOtAvail(HC, WD, iso(WD, '12:30'), iso(WD, '16:30')), 30);   // vào giữa giờ nghỉ → chỉ phần có mặt
  assert.equal(breakOtAvail(HC, WD, iso(WD, '07:30'), iso(WD, '11:00')), 0);
  assert.equal(breakOtAvail({ ...HC, break_ot: 0 }, WD, iso(WD, '07:30'), iso(WD, '16:30')), 0);
  assert.equal(breakOtAvail({ ...HC, allow_ot: 0 }, WD, iso(WD, '07:30'), iso(WD, '16:30')), 0);
  assert.equal(breakOtAvail({ ...HC, break_start: '' }, WD, iso(WD, '07:30'), iso(WD, '16:30')), 0);
  // ca đêm D4 19:00–03:00 nghỉ 00:00–01:00
  const D4 = { ...HC, start_time: '19:00', end_time: '03:00', break_start: '00:00' };
  assert.equal(breakOtAvail(D4, WD, iso(WD, '19:00'), iso('2026-01-06', '03:00')), 60);
});

test('ngày thường: 3h tối + có mặt giờ trưa, đăng ký 4h → tăng ca 4h; ot_raw vẫn 3h', () => {
  const m = day(ctx({ [`5|${WD}`]: 240 }), HC, '07:30', '19:30');
  assert.equal(m.ot_min, 240); assert.equal(m.ot_raw, 180);
  assert.equal(m.work_unit, 1); assert.equal(m.work_minutes, 480);   // công không đổi
});

test('đăng ký 1h, về đúng giờ → 1h tăng ca trưa', () => {
  const m = day(ctx({ [`5|${WD}`]: 60 }), HC, '07:30', '16:30');
  assert.equal(m.ot_min, 60); assert.equal(m.ot_raw, 0);
});

test('không đăng ký → giờ trưa không bao giờ thành tăng ca', () => {
  assert.equal(day(ctx({}, true), HC, '07:30', '16:30').ot_min, 0);
  assert.equal(day(ctx({}, false), HC, '07:30', '16:30').ot_min, 0);
  assert.equal(day(ctx({}, false), HC, '07:30', '19:30').ot_min, 180);   // không bắt buộc đăng ký: tăng ca tối như cũ
});

test('ca KHÔNG bật tăng ca trưa → y như cũ (đăng ký 4h, làm 3h tối → 3h)', () => {
  const m = day(ctx({ [`5|${WD}`]: 240 }), { ...HC, break_ot: 0 }, '07:30', '19:30');
  assert.equal(m.ot_min, 180); assert.equal(m.ot_raw, 180);
});

// ---- syncOtReg (đổi đăng ký sau khi đã tính công) dùng CSDL tạm ----
let db, syncOtReg, setSetting;
before(async () => {
  const D = await import('../server/db.js');
  db = D.db; setSetting = D.setSetting; D.initSchema();
  ({ syncOtReg } = await import('../server/ot-reg.js'));
  db.prepare(`INSERT INTO shifts(id, name, code, start_time, end_time, break_minutes, break_start, allow_ot, break_ot) VALUES (1,'HC','HC','07:30','16:30',60,'12:00',1,1)`).run();
  db.prepare(`INSERT INTO shifts(id, name, code, start_time, end_time, break_minutes, break_start, allow_ot, break_ot) VALUES (2,'HC cũ','HC0','07:30','16:30',60,'12:00',1,0)`).run();
  db.prepare("INSERT INTO employees(id, code, full_name, role, username, password_hash) VALUES (9,'T9','Trần Trưa','employee','t9','x')").run();
});
after(() => { for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} } });

const addRow = (date, shiftId, out, raw) => db.prepare(`INSERT INTO attendance(employee_id, work_date, shift_id, check_in_at, check_out_at, work_minutes, work_unit, ot_min, ot_raw_min, day_status, ot_type)
  VALUES (9,?,?,?,?,480,1,?,?,'lam_viec','thuong')`).run(date, shiftId, iso(date, '07:30'), iso(date, out), raw, raw).lastInsertRowid;
const reg = (date, m) => db.prepare('INSERT OR REPLACE INTO ot_registrations(employee_id, work_date, minutes) VALUES (9,?,?)').run(date, m);
const otOf = (id) => db.prepare('SELECT ot_min FROM attendance WHERE id=?').get(id).ot_min;

test('syncOtReg: đổi đăng ký sau khi tính công → bù giờ trưa đúng như lúc tính', () => {
  setSetting('ot_reg_required', '1');
  const a = addRow('2026-03-02', 1, '19:30', 180);   // 3h tối, ca bật trưa
  const b = addRow('2026-03-03', 1, '16:30', 0);     // không tăng ca tối, ca bật trưa
  const c = addRow('2026-03-04', 2, '19:30', 180);   // ca không bật trưa
  reg('2026-03-02', 240); reg('2026-03-03', 60); reg('2026-03-04', 240);
  syncOtReg([9], '2026-03-01', '2026-03-31');
  assert.equal(otOf(a), 240); assert.equal(otOf(b), 60); assert.equal(otOf(c), 180);
  db.prepare('DELETE FROM ot_registrations WHERE work_date=?').run('2026-03-03');   // bỏ đăng ký → về 0
  syncOtReg([9], '2026-03-01', '2026-03-31');
  assert.equal(otOf(b), 0);
});
