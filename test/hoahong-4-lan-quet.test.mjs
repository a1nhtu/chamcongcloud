// Tính giờ 4 lần quẹt/ngày (Đến – Ra – Vào – Về) theo HR-ERP của khách Hoa Hồng (HRM_ThanhHa, T8/2026). Chạy: npm test
// Ca HC 07:00–16:30, nghỉ trưa CỐ ĐỊNH 11:30–13:00 (90'), công chính 8 giờ, tăng ca sau ca ngưỡng 30'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCheckout, mergeDayPunches, punchPairs, roundOtParts } from '../server/attendance-calc.js';
import { computeDayMetrics } from '../server/day-metrics.js';

const iso = (d, hm) => new Date(`${d}T${hm}+07:00`).toISOString();   // hm = 'HH:MM' hoặc 'HH:MM:SS'
const iso2 = (d, hm) => iso(d, hm.length === 5 ? hm + ':00' : hm);
const WD = '2026-08-12';   // Thứ Tư
const SUN = '2026-08-16';  // Chủ nhật
const HC = {
  id: 2, start_time: '07:00', end_time: '16:30', break_minutes: 90, break_start: '11:30', merge_rule: 'pairs',
  late_grace_min: 0, early_grace_min: 0, work_unit_value: 1, allow_ot: 1, ot_start_after_min: 30, ot_before: 0, ot_before_min: 15,
};
const pp = (d, list) => punchPairs(list.map((t) => iso2(d, t)), 1);
const calc = (d, list, o = {}) => {
  const pairs = pp(d, list);
  return computeCheckout(HC, iso2(d, list[0]), iso2(d, list[list.length - 1]), d, { pairs: pairs.length >= 2 ? pairs : null, pairsFixedBreak: true, ...o });
};

test('4 lần quẹt bình thường: Đến 06:55, Ra 11:30, Vào 12:44, Về 16:30 → 480 phút (nghỉ trưa 11:30–13:00 không tính)', () => {
  const c = calc(WD, ['06:55:20', '11:30:39', '12:44:38', '16:30:24']);
  assert.equal(c.work_minutes, 480);
  assert.equal(c.ot_min, 0);
});

test('vào lại SAU 13:00 (14:28) → mất phần chiều chưa có mặt: 270 + 122 = 392; tăng ca sau ca 93\' → 90', () => {
  const c = calc(WD, ['06:55:20', '11:30:39', '14:28:01', '18:03:26']);
  assert.equal(c.work_minutes, 392);
  assert.deepEqual(c.ot_parts, [93]);
  assert.equal(roundOtParts(c.ot_min, c.ot_parts, 2, 0, 30), 90);
});

test('6 lần quẹt (có quẹt tay xen kẽ): cộng từng cặp, mỗi cặp chỉ lấy phần ngoài giờ nghỉ trưa = 5 + 10 + 210 = 225', () => {
  const c = calc(WD, ['06:54:57', '07:05:04', '11:20:03', '11:34:15', '12:58:36', '18:06:19']);
  assert.equal(c.work_minutes, 225);
});

test('số lần quẹt LẺ (3, 5) + nghỉ trưa cố định: không ghép cặp, lấy đầu → cuối trừ giờ nghỉ', () => {
  const pts = ['06:54:14', '11:30:00', '16:30:00'].map((t) => ({ punch_at: iso2(WD, t) }));
  const r = mergeDayPunches(pts, HC, 'pairs', {}, WD, { dupMin: 1, pairsFixedBreak: true });
  assert.equal(r.pairs, null);
  assert.equal(r.inIso, iso2(WD, '06:54:14'));
  assert.equal(r.outIso, iso2(WD, '16:30:00'));
  // số chẵn vẫn ghép cặp
  const ev = ['06:54:14', '11:30:00', '12:50:00', '16:30:00'].map((t) => ({ punch_at: iso2(WD, t) }));
  assert.equal(mergeDayPunches(ev, HC, 'pairs', {}, WD, { dupMin: 1, pairsFixedBreak: true }).pairs.length, 2);
  // ca KHÔNG có nghỉ trưa cố định: giữ cách cũ (bỏ lượt lẻ cuối)
  const noBrk = { ...HC, break_start: null };
  assert.equal(mergeDayPunches(pts, noBrk, 'pairs', {}, WD, { dupMin: 1, pairsFixedBreak: true }).pairs.length, 1);
});

const ctx = (over = {}) => ({
  weekend: '7', weekendOt: true, roundingDecimals: 2, roundingMode: 0, hourly: false, isHoliday: () => false,
  otRound: { decimals: 2, mode: 0, block: 30 }, pairsFixedBreak: true, ...over,
});
// pairs truyền NGUYÊN như mergeDayPunches trả (1 cặp = 2 lần quẹt)
const day = (c, list) => {
  const pairs = pp(SUN, list);
  return computeDayMetrics(c, HC, SUN, iso2(SUN, list[0]), iso2(SUN, list[list.length - 1]), pairs);
};

test('CHỦ NHẬT (ngày nghỉ): mặc định tăng ca = giờ làm (làm tròn khối 30\') + sau ca — như trước, không đổi', () => {
  // 06:27 → 12:?? ... 18:04: làm 480, sau ca 94' → 90; trước ca KHÔNG tính (ca không bật tăng ca trước ca)
  const m = day(ctx(), ['06:27:00', '11:31:00', '12:49:00', '18:04:00']);
  assert.equal(m.work_minutes, 0);
  assert.equal(m.ot_min, 570);
});

test('CHỦ NHẬT + weekend_ot_before + weekend_work_exact: giờ trong ca giữ đúng phút, đến sớm 33\' → 30, sau ca 94\' → 90', () => {
  const m = day(ctx({ weekendOtBefore: true, weekendWorkExact: true }), ['06:27:00', '11:31:00', '12:49:00', '18:04:00']);
  assert.equal(m.ot_min, 600);   // 480 + 30 + 90 (HR-ERP: 600)
  assert.equal(m.ot_type, 'cuoi_tuan');
  // giờ làm lẻ phút (vào 06:59, ra chiều 16:33): 270 + 160 = 430 giữ nguyên, sau ca 3' → 0
  const n = day(ctx({ weekendOtBefore: true, weekendWorkExact: true }), ['06:59:29', '11:30:36', '13:50:48', '16:33:14']);
  assert.equal(n.ot_min, 430);   // HR-ERP: 430 (không làm tròn xuống 420)
  // không bật weekend_work_exact → làm tròn cả khối như cũ (430 → 420)
  assert.equal(day(ctx({ weekendOtBefore: true }), ['06:59:29', '11:30:36', '13:50:48', '16:33:14']).ot_min, 420);
  // đến sớm dưới ngưỡng 15' không tính: 06:50 → 10' sớm
  assert.equal(day(ctx({ weekendOtBefore: true, weekendWorkExact: true }), ['06:50:00', '11:30:36', '12:50:00', '16:30:00']).ot_min, 480);
});

test('ngày THƯỜNG không bị ảnh hưởng bởi weekend_ot_before: đến sớm không tính tăng ca', () => {
  const pairs = pp(WD, ['06:27:00', '11:31:00', '12:49:00', '18:04:00']);
  const m = computeDayMetrics(ctx({ weekendOtBefore: true, weekendWorkExact: true }), HC, WD, iso2(WD, '06:27:00'), iso2(WD, '18:04:00'), pairs);
  assert.equal(m.work_minutes, 480);
  assert.equal(m.ot_min, 90);
});

test('roundOtParts: tham số exact giữ nguyên số phút, mặc định không đổi', () => {
  assert.equal(roundOtParts(430 + 90, [90], 2, 0, 30), 510);          // như cũ: 430 → 420
  assert.equal(roundOtParts(430 + 90, [90], 2, 0, 30, 430), 520);     // giữ 430
  assert.equal(roundOtParts(100, [], 2, 0, 30, 500), 100);            // exact > tổng → chặn bằng tổng
});

test('CHỦ NHẬT chỉ 2 lần quẹt + weekend_need_pairs: không tính giờ trong ca, vẫn tính tăng ca sau ca; 4 lần quẹt thì tính bình thường', () => {
  const c = ctx({ weekendWorkExact: true, weekendNeedPairs: true });
  // 12:52 → 18:03 (HR-ERP: tăng ca 90 = chỉ phần sau ca 16:30 → 18:03)
  assert.equal(day(c, ['12:52:00', '18:03:00']).ot_min, 90);
  // sáng 06:54 → 11:30 (HR-ERP: 0)
  assert.equal(day(c, ['06:54:00', '11:30:00']).ot_min, 0);
  // không bật cài đặt → như trước (có tính giờ làm trong ca)
  assert.equal(day(ctx({ weekendWorkExact: true }), ['06:54:00', '11:30:00']).ot_min, 270);
  // 4 lần quẹt → tính đủ
  assert.equal(day(c, ['06:59:29', '11:30:36', '13:50:48', '16:33:14']).ot_min, 430);
  // ngày THƯỜNG chỉ 2 lần quẹt vẫn tính công
  const pairs = pp(WD, ['06:54:00', '11:30:00']);
  assert.equal(computeDayMetrics(c, HC, WD, iso2(WD, '06:54:00'), iso2(WD, '11:30:00'), pairs).work_minutes, 270);
});

test('MẶC ĐỊNH TẮT (pairs_fixed_break): công ty khác dùng "nhiều lần vào/ra" + nghỉ trưa cố định tính y như trước', () => {
  // 6 lần quẹt: trước đây KHÔNG trừ giờ nghỉ khỏi từng cặp (cặp 11:20→11:34 tính đủ 14', cặp 06:54→07:05 = 11')
  const off = calc(WD, ['06:54:57', '07:05:04', '11:20:03', '11:34:15', '12:58:36', '18:06:19'], { pairsFixedBreak: false });
  assert.equal(off.work_minutes, 5 + 14 + 212);   // 231 = đúng như code cũ (cặp kẹp trong ca, không trừ giờ nghỉ) — khác kiểu HR-ERP (225)
  // số lần quẹt lẻ: vẫn ghép cặp như cũ (bỏ lượt lẻ cuối)
  const pts = ['06:54:14', '11:30:00', '12:50:00', '16:30:00', '18:00:00'].map((x) => ({ punch_at: iso2(WD, x) }));
  assert.equal(mergeDayPunches(pts, HC, 'pairs', {}, WD, { dupMin: 1 }).pairs.length, 2);
  assert.equal(mergeDayPunches(pts, HC, 'pairs', {}, WD, { dupMin: 1, pairsFixedBreak: true }).pairs, null);
  // 3 cài đặt Chủ nhật mặc định tắt: Chủ nhật tính như trước
  const c0 = { weekend: '7', weekendOt: true, roundingDecimals: 2, roundingMode: 0, hourly: false, isHoliday: () => false, otRound: { decimals: 2, mode: 0, block: 30 } };
  const pairs = pp(SUN, ['06:27:00', '11:31:00', '12:49:00', '18:04:00']);
  const m = computeDayMetrics(c0, HC, SUN, iso2(SUN, '06:27:00'), iso2(SUN, '18:04:00'), pairs);
  assert.equal(m.ot_type, 'cuoi_tuan');
  assert.equal(m.ot_min % 30, 0);   // vẫn làm tròn cả khối 30' như cũ
});
