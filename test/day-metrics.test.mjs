// Test computeDayMetrics — nguồn chân lý gộp của recompute/computeManual/check-out.
// Dùng ctx giả (không cần DB) để test thuần công thức.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDayMetrics } from '../server/day-metrics.js';

const iso = (d, hm) => new Date(`${d}T${hm}:00+07:00`).toISOString();
const WD = '2026-01-05'; // Thứ Hai
const SUN = '2026-01-04'; // Chủ Nhật
const shift = {
  id: 7, start_time: '08:00', end_time: '17:00', break_minutes: 60,
  late_grace_min: 5, early_grace_min: 15, work_unit_value: 1.0,
  allow_ot: 0, ot_start_after_min: 30, ot_rounding_unit: 0,
};
const ctx = (over = {}) => ({
  weekend: '7', roundingDecimals: 2, roundingMode: 0, hourly: false,
  isHoliday: () => false, ...over,
});

test('có ca + đủ vào/ra → dùng computeCheckout', () => {
  const m = computeDayMetrics(ctx(), shift, WD, iso(WD, '08:00'), iso(WD, '17:00'));
  assert.equal(m.shiftId, 7);
  assert.equal(m.work_unit, 1.0);
  assert.equal(m.work_minutes, 480);
  assert.equal(m.late, 0);
  assert.equal(m.day_status, 'lam_viec');
  assert.equal(m.ot_type, 'thuong');
});

test('có ca + đi muộn → late tính theo ca', () => {
  const m = computeDayMetrics(ctx(), shift, WD, iso(WD, '08:20'), iso(WD, '17:00'));
  assert.equal(m.late, 15); // 20' - grace 5'
});

test('KHÔNG ca + có vào/ra → công theo tỉ lệ 8h (không còn 6 phút = 1 công)', () => {
  const m = computeDayMetrics(ctx(), null, WD, iso(WD, '08:00'), iso(WD, '08:06'));
  assert.equal(m.shiftId, null);
  assert.equal(m.work_minutes, 6);
  assert.equal(m.work_unit, 0.01);
  assert.equal(m.late, 0);
  assert.equal(m.day_status, 'lam_viec');
});

test('chỉ có VÀO, chưa RA → thieu_ra, không giờ công', () => {
  const m = computeDayMetrics(ctx(), shift, WD, iso(WD, '08:00'), null);
  assert.equal(m.day_status, 'thieu_ra');
  assert.equal(m.work_minutes, 0);
  assert.equal(m.work_unit, 0);
});

test('không vào không ra → vang', () => {
  const m = computeDayMetrics(ctx(), null, WD, null, null);
  assert.equal(m.day_status, 'vang');
  assert.equal(m.work_unit, 0);
});

test('ngày Chủ Nhật → ot_type cuoi_tuan', () => {
  const m = computeDayMetrics(ctx(), null, SUN, iso(SUN, '08:00'), iso(SUN, '12:00'));
  assert.equal(m.ot_type, 'cuoi_tuan');
});

test('ngày lễ (ctx.isHoliday=true) → ot_type le', () => {
  const m = computeDayMetrics(ctx({ isHoliday: () => true }), null, WD, iso(WD, '08:00'), iso(WD, '12:00'));
  assert.equal(m.ot_type, 'le');
});

test('chế độ giờ (shift=null như caller truyền) → không muộn, công theo giờ', () => {
  const m = computeDayMetrics(ctx({ hourly: true }), null, WD, iso(WD, '08:00'), iso(WD, '16:00'));
  assert.equal(m.late, 0);
  assert.equal(m.work_minutes, 480);
  assert.equal(m.work_unit, 1); // 8h → tối đa 1
});
