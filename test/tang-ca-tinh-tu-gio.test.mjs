// Test tùy chọn CA "Tăng ca tính từ giờ" (shifts.ot_from_time) — khách mythuatlt:
// ca 07:00–11:00 + 13:30–17:30 (chấm 2 lần, nghỉ 150'), tăng ca chỉ tính từ 18:00;
// mốc 1 = 18–21 (TC1 180'), mốc 2 = 21–0h (TC2 180'), mốc 3 = 0h–6h và phần sau 6h cũng vào mốc 3 (TC3 = 0 → nhận hết phần còn lại).
// "Ở lại tối thiểu" đo từ 18:00. Để trống ô = tính từ giờ ra ca như cũ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDayMetrics } from '../server/day-metrics.js';
import { splitOtTiers, otStartAt, shiftBounds, computeCheckout } from '../server/attendance-calc.js';

const iso = (d, hm, add = 0) => { const t = new Date(`${d}T${hm}:00+07:00`); t.setUTCDate(t.getUTCDate() + add); return t.toISOString(); };
const WD = '2026-01-05'; // Thứ Hai
const MT = {
  id: 9, start_time: '07:00', end_time: '17:30', break_minutes: 150, break_start: '11:00',
  late_grace_min: 0, early_grace_min: 0, work_unit_value: 1.0,
  allow_ot: 1, ot_start_after_min: 30, ot_from_time: '18:00',
  ot_tier1_min: 180, ot_tier2_min: 180, ot_tier3_min: 0,
};
const ctx = { weekend: '7', roundingDecimals: 2, roundingMode: 0, hourly: false, isHoliday: () => false };
const day = (o, add = 0, sh = MT) => computeDayMetrics(ctx, sh, WD, iso(WD, '07:00'), iso(WD, o, add));
const tiers = (m) => splitOtTiers(m.ot_min, MT).slice(0, 3);

test('ca mythuatlt: đủ ca 07:00–17:30 = 480 phút = 1 công, không tăng ca', () => {
  const m = day('17:30');
  assert.deepEqual([m.work_minutes, m.work_unit, m.ot_min, m.early_min], [480, 1, 0, 0]);
});

test('tăng ca tính từ 18:00: 17:30–18:00 không tính', () => {
  assert.equal(day('21:00').ot_min, 180);              // mốc 1 đủ 3 tiếng
  assert.deepEqual(tiers(day('21:00')), [180, 0, 0]);
  assert.equal(day('19:00').ot_min, 60);
});

test('ở lại tối thiểu (30\') đo từ 18:00', () => {
  assert.equal(day('18:00').ot_min, 0);
  assert.equal(day('18:25').ot_min, 0);
  assert.equal(day('18:30').ot_min, 30);
  const s0 = { ...MT, ot_start_after_min: 0 };
  // (phút lẻ: computeDayMetrics làm tròn tăng ca theo giờ 2 số lẻ như cũ → so phút thô của computeCheckout)
  assert.equal(computeCheckout(s0, iso(WD, '07:00'), iso(WD, '18:10'), WD, {}).ot_min, 10);
  assert.equal(day('17:50', 0, s0).ot_min, 0);       // về trước 18:00 → không có tăng ca
});

test('chia mốc 18–21 · 21–0h · 0h–6h, quá 6h vẫn vào mốc 3', () => {
  assert.deepEqual(tiers(day('23:00')), [180, 120, 0]);
  assert.deepEqual(tiers(day('00:00', 1)), [180, 180, 0]);
  assert.deepEqual(tiers(day('03:00', 1)), [180, 180, 180]);
  assert.deepEqual(tiers(day('06:00', 1)), [180, 180, 360]);
  const late = splitOtTiers(computeCheckout(MT, iso(WD, '07:00'), iso(WD, '06:40', 1), WD, {}).ot_min, MT);
  assert.deepEqual(late, [180, 180, 400, 0]);           // không ra TC4
});

test('để trống ô = tính từ giờ ra ca như cũ', () => {
  const old = { ...MT, ot_from_time: '' };
  assert.equal(day('21:00', 0, old).ot_min, 210);
  assert.equal(day('18:00', 0, old).ot_min, 30);
  const { end } = shiftBounds(WD, old);
  assert.equal(otStartAt(WD, old, end), end);
  assert.equal(otStartAt(WD, { ...MT, ot_from_time: '17:30' }, end), end);   // trùng giờ ra
});

test('ca đêm 22:00–06:00 khai 06:30 → mốc là 06:30 sáng hôm sau', () => {
  const n = { start_time: '22:00', end_time: '06:00', ot_from_time: '06:30' };
  const { end } = shiftBounds(WD, n);
  assert.equal(otStartAt(WD, n, end).toISOString(), iso(WD, '06:30', 1));
});

test('bù trừ đi trễ: dùng khoảng 17:30–18:00 trước rồi mới trừ vào tăng ca', () => {
  const c = { ...MT, compensate_late: 1, ot_start_after_min: 0, late_grace_min: 0 };
  // vào trễ 20' (07:20), về 19:00: 20' bù lấy trong 17:30–18:00 → tăng ca 60' giữ nguyên, công đủ 480'
  const a = computeCheckout(c, iso(WD, '07:20'), iso(WD, '19:00'), WD, {});
  assert.deepEqual([a.work_minutes, a.ot_min], [480, 60]);
  // vào trễ 50': 30' trong 17:30–18:00 + 20' trừ vào tăng ca → tăng ca 40'
  const b = computeCheckout(c, iso(WD, '07:50'), iso(WD, '19:00'), WD, {});
  assert.deepEqual([b.work_minutes, b.ot_min], [480, 40]);
});
