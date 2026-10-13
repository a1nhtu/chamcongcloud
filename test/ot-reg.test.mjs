// Test ĐĂNG KÝ LÀM THÊM: làm quá đăng ký → chỉ tính theo đăng ký; làm thiếu → tính thực tế;
// không đăng ký → thực tế (hoặc 0 khi bật "phải đăng ký mới tính tăng ca"). Dùng ctx + CSDL giả, không cần DB thật.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDayMetrics } from '../server/day-metrics.js';
import { capOt, otRegCapper } from '../server/ot-cap.js';

const iso = (d, hm) => new Date(`${d}T${hm}:00+07:00`).toISOString();
const WD = '2026-01-05'; // Thứ Hai
const shift = {
  id: 7, start_time: '08:00', end_time: '17:00', break_minutes: 60,
  late_grace_min: 5, early_grace_min: 15, work_unit_value: 1.0,
  allow_ot: 1, ot_start_after_min: 30, ot_rounding_unit: 0,
};
// CSDL giả: regs = { 'empId|ngày': phút }
const fakeDb = (regs) => ({ prepare: () => ({ get: (e, d) => (`${e}|${d}` in regs ? { minutes: regs[`${e}|${d}`] } : undefined) }) });
const ctx = (regs, required = false) => ({
  weekend: '7', roundingDecimals: 2, roundingMode: 0, hourly: false, isHoliday: () => false,
  otRound: { decimals: 2, mode: 0, block: 0 },
  otReg: otRegCapper(fakeDb(regs), (k, d) => (k === 'ot_reg_required' ? (required ? '1' : '0') : d)),
});
const day = (c, out = '20:00') => computeDayMetrics(c, shift, WD, iso(WD, '08:00'), iso(WD, out), null, { empId: 5 });

test('capOt: bảng quy tắc', () => {
  assert.equal(capOt(180, 120, false), 120);   // làm quá → theo đăng ký
  assert.equal(capOt(90, 120, false), 90);     // làm thiếu → thực tế
  assert.equal(capOt(180, 0, false), 0);       // đăng ký 0 → không tính
  assert.equal(capOt(180, null, false), 180);  // không đăng ký → thực tế
  assert.equal(capOt(180, null, true), 0);     // bắt buộc đăng ký mà không đăng ký → 0
  assert.equal(capOt(180, 120, true), 120);
});

test('không đăng ký → tăng ca thực tế, ot_raw = ot_min', () => {
  const m = day(ctx({}));
  assert.equal(m.ot_min, 180); assert.equal(m.ot_raw, 180);
});

test('làm 3 giờ, đăng ký 2 giờ → chỉ tính 2 giờ, vẫn giữ số thực tế', () => {
  const m = day(ctx({ [`5|${WD}`]: 120 }));
  assert.equal(m.ot_min, 120); assert.equal(m.ot_raw, 180);
  assert.equal(m.work_unit, 1.0);   // công ngày không đổi
});

test('làm 1,5 giờ, đăng ký 2 giờ → tính thực tế 1,5 giờ', () => {
  const m = day(ctx({ [`5|${WD}`]: 120 }), '18:30');
  assert.equal(m.ot_min, 90); assert.equal(m.ot_raw, 90);
});

test('đăng ký của người khác / ngày khác không ảnh hưởng', () => {
  const m = day(ctx({ [`6|${WD}`]: 30, '5|2026-01-06': 30 }));
  assert.equal(m.ot_min, 180);
});

test('bật "phải đăng ký mới tính tăng ca": không đăng ký → 0, có đăng ký → theo đăng ký', () => {
  assert.equal(day(ctx({}, true)).ot_min, 0);
  assert.equal(day(ctx({}, true)).ot_raw, 180);
  assert.equal(day(ctx({ [`5|${WD}`]: 60 }, true)).ot_min, 60);
});

test('ctx cũ không có otReg / không truyền empId → không chặn', () => {
  const c = ctx({ [`5|${WD}`]: 60 });
  assert.equal(computeDayMetrics(c, shift, WD, iso(WD, '08:00'), iso(WD, '20:00')).ot_min, 180);
  delete c.otReg;
  assert.equal(day(c).ot_min, 180);
});

test('CSDL chưa có bảng ot_registrations → coi như chưa đăng ký (không văng lỗi)', () => {
  const cap = otRegCapper({ prepare: () => { throw new Error('no such table'); } }, () => '0');
  assert.equal(cap(5, WD, 180), 180);
  assert.equal(cap(5, WD, 90), 90);
});
