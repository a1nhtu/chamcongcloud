// Test động cơ tính công (hàm thuần, không chạm DB). Chạy: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shiftBounds, computeLate, computeCheckout, noShiftUnit,
  mergeDayPunches, vnWeekday, isWeekendDay,
} from '../server/attendance-calc.js';

const iso = (d, hm) => new Date(`${d}T${hm}:00+07:00`).toISOString();
const WD = '2026-01-05'; // Thứ Hai
const shift = {
  id: 7, start_time: '08:00', end_time: '17:00', break_minutes: 60,
  late_grace_min: 5, early_grace_min: 15, work_unit_value: 1.0,
  allow_ot: 0, ot_start_after_min: 30, ot_rounding_unit: 0,
};

test('shiftBounds: ca ngày thường', () => {
  const { start, end } = shiftBounds(WD, shift);
  assert.equal(start.toISOString(), iso(WD, '08:00'));
  assert.equal(end.toISOString(), iso(WD, '17:00'));
});

test('shiftBounds: ca đêm qua ngày (end <= start → +24h)', () => {
  const night = { start_time: '22:00', end_time: '06:00' };
  const { start, end } = shiftBounds(WD, night);
  assert.equal(end.getTime() - start.getTime(), 8 * 3600 * 1000);
});

test('computeLate: trong ân hạn → 0, quá ân hạn → phút muộn THỰC TẾ (không trừ dung sai)', () => {
  assert.equal(computeLate(shift, iso(WD, '08:03'), WD), 0);   // 3' <= grace 5' → bỏ qua
  assert.equal(computeLate(shift, iso(WD, '08:10'), WD), 10);  // 10' > grace 5' → ghi đủ 10'
  assert.equal(computeLate(shift, iso(WD, '09:41'), WD), 101); // 101' > grace 5' → ghi đủ 101'
  assert.equal(computeLate(null, iso(WD, '08:10'), WD), 0);    // không ca
});

test('computeCheckout: làm đủ ca → 1 công, trừ nghỉ giữa ca', () => {
  const c = computeCheckout(shift, iso(WD, '08:00'), iso(WD, '17:00'), WD, {});
  assert.equal(c.work_minutes, 480);   // 540 - 60 nghỉ
  assert.equal(c.work_unit, 1.0);
  assert.equal(c.early_min, 0);
  assert.equal(c.ot_min, 0);
  assert.equal(c.day_status, 'lam_viec');
});

test('computeCheckout: về sớm → early_min + công theo tỉ lệ (floor)', () => {
  const c = computeCheckout(shift, iso(WD, '08:00'), iso(WD, '16:00'), WD, {});
  assert.equal(c.early_min, 45);       // sớm 60' - grace 15'
  assert.equal(c.work_minutes, 420);   // 480 - 60 nghỉ
  assert.equal(c.work_unit, 0.87);     // floor(0.875*100)/100
});

test('computeCheckout: có OT khi ca cho phép + ở lại quá ngưỡng', () => {
  const otShift = { ...shift, allow_ot: 1 };
  const c = computeCheckout(otShift, iso(WD, '08:00'), iso(WD, '18:30'), WD, {});
  assert.equal(c.ot_min, 90);          // 90' sau tan ca
  assert.equal(c.work_minutes, 480);   // kẹp trong ca
});

test('computeCheckout: ot_type theo cờ ngày', () => {
  assert.equal(computeCheckout(shift, iso(WD, '08:00'), iso(WD, '17:00'), WD, { isHoliday: true }).ot_type, 'le');
  assert.equal(computeCheckout(shift, iso(WD, '08:00'), iso(WD, '17:00'), WD, { isWeekend: true }).ot_type, 'cuoi_tuan');
  assert.equal(computeCheckout(shift, iso(WD, '08:00'), iso(WD, '17:00'), WD, {}).ot_type, 'thuong');
});

test('noShiftUnit: theo tỉ lệ 8h, chặn trên 1 công (chống 6 phút = 1 công)', () => {
  assert.equal(noShiftUnit(6), 0.01);    // 6/480 floor 2 số lẻ
  assert.equal(noShiftUnit(240), 0.5);   // 4h
  assert.equal(noShiftUnit(480), 1);     // 8h
  assert.equal(noShiftUnit(600), 1);     // >8h vẫn tối đa 1
  assert.equal(noShiftUnit(0), 0);
});

test('mergeDayPunches FILO: vào sớm nhất, ra muộn nhất', () => {
  const punches = [{ punch_at: iso(WD, '08:00'), serial: 'A' }, { punch_at: iso(WD, '12:00'), serial: 'A' }, { punch_at: iso(WD, '17:05'), serial: 'A' }];
  const r = mergeDayPunches(punches, shift, 'filo', {}, WD);
  assert.equal(r.inIso, iso(WD, '08:00'));
  assert.equal(r.outIso, iso(WD, '17:05'));
});

test('mergeDayPunches IDM: máy lẻ VÀO, máy chẵn RA', () => {
  const punches = [{ punch_at: iso(WD, '08:00'), serial: 'A' }, { punch_at: iso(WD, '17:00'), serial: 'B' }];
  const r = mergeDayPunches(punches, shift, 'idm', { A: 1, B: 2 }, WD);
  assert.equal(r.inIso, iso(WD, '08:00'));
  assert.equal(r.outIso, iso(WD, '17:00'));
});

test('mergeDayPunches: 1 lần quẹt duy nhất → chỉ có VÀO', () => {
  const r = mergeDayPunches([{ punch_at: iso(WD, '08:00'), serial: 'A' }], shift, 'filo', {}, WD);
  assert.equal(r.inIso, iso(WD, '08:00'));
  assert.equal(r.outIso, null);
});

test('vnWeekday + isWeekendDay', () => {
  assert.equal(vnWeekday('2026-01-05'), 1);          // Thứ Hai
  assert.equal(vnWeekday('2026-01-04'), 7);          // Chủ Nhật
  assert.equal(isWeekendDay('2026-01-04', '7'), true);
  assert.equal(isWeekendDay('2026-01-05', '7'), false);
  assert.equal(isWeekendDay('2026-01-03', '6,7'), true); // Thứ Bảy
});
