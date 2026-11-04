// Ca "Nhiều lần vào/ra" (theo CA) quẹt LẺ lượt: chỉ cộng cặp đủ (vào 1 → ra 1), lượt lẻ phía sau không tính.
// Anh chốt 04/11/2026 (giống chế độ theo giờ v1.28.10). Trước: 1 cặp + lượt lẻ → lấy đầu → cuối
// (vào 08 · ra 10 · vào 11 = 180 phút, tính cả 1 tiếng ra ngoài; quên ra trưa 08 · 13 · 17 = đủ 480).
// Cài đặt "nghỉ trưa cố định kiểu HR-ERP" (pairs_fixed_break) vẫn đầu → cuối như cũ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeDayPunches } from '../server/attendance-calc.js';
import { computeDayMetrics } from '../server/day-metrics.js';

const D = '2026-10-07';   // Thứ Tư
const iso = (t) => new Date(`${D}T${t}:00+07:00`).toISOString();
const CA = { id: 1, start_time: '08:00', end_time: '17:00', break_minutes: 60, break_start: '12:00', merge_rule: 'pairs',
  late_grace_min: 0, early_grace_min: 0, work_unit_value: 1, allow_ot: 1, ot_start_after_min: 30 };
const ctx = (over = {}) => ({ weekend: '7', weekendOt: false, roundingDecimals: 2, roundingMode: 0, isHoliday: () => false,
  otRound: { decimals: 2, mode: 0, block: 30 }, ...over });
const day = (list, { shift = CA, fixedBreak = false } = {}) => {
  const r = mergeDayPunches(list.map((t) => ({ punch_at: iso(t) })), shift, 'pairs', {}, D, { dupMin: 5, pairsFixedBreak: fixedBreak });
  return computeDayMetrics(ctx({ pairsFixedBreak: fixedBreak }), shift, D, r.inIso, r.outIso, r.pairs);
};

test('4 lượt đủ 08 · 12 · 13 · 17 → 480 phút (không đổi)', () => {
  const m = day(['08:00', '12:00', '13:00', '17:00']);
  assert.equal(m.work_minutes, 480);
  assert.equal(m.early_min, 0);
});

test('ra 10:00, vào lại 11:00, quên ra → chỉ tính 08–10 = 120 phút, về sớm tính từ 10:00', () => {
  const m = day(['08:00', '10:00', '11:00']);
  assert.equal(m.work_minutes, 120);   // trước: 180
  assert.equal(m.early_min, 360);      // 10:00 → 17:00 trừ nghỉ trưa 12–13
});

test('quên ra 2 (08 · 12 · 13) → 240 phút; quên ra trưa (08 · 13 · 17) → chỉ cặp 08–13 = 240, lượt 17:00 không tính', () => {
  assert.equal(day(['08:00', '12:00', '13:00']).work_minutes, 240);
  const m = day(['08:00', '13:00', '17:00']);
  assert.equal(m.work_minutes, 240);   // trước: 480
  assert.equal(m.early_min, 240);
});

test('ca nghỉ 60 phút không cố định giờ: 08 · 10 · 11 → 120 phút', () => {
  assert.equal(day(['08:00', '10:00', '11:00'], { shift: { ...CA, break_start: null } }).work_minutes, 120);
});

test('quẹt lặp ở lượt ra (08 · 17:00 · 17:02) vẫn là 1 cặp đủ → 480, không coi là lẻ', () => {
  assert.equal(day(['08:00', '17:00', '17:02']).work_minutes, 480);
});

test('bật "nghỉ trưa cố định kiểu HR-ERP": quẹt lẻ vẫn lấy đầu → cuối trừ nghỉ như cũ', () => {
  assert.equal(day(['08:00', '13:00', '17:00'], { fixedBreak: true }).work_minutes, 480);
});
