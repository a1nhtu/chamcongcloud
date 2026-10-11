// Các quy tắc thêm khi đối chiếu với HR-ERP (khách Bao Bì Thủ Đô, T2–T3/2025). Chạy: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCheckout, computeLate, ruleWindow, roundUpBlock, roundOtParts, mergeDayPunches } from '../server/attendance-calc.js';

const iso = (d, hm) => new Date(`${d}T${hm}:00+07:00`).toISOString();
const WD = '2025-03-10'; // Thứ Hai
const ND = '2025-03-11';
const HC = { id: 1, start_time: '08:00', end_time: '17:00', break_minutes: 60, late_grace_min: 0, early_grace_min: 0,
  work_unit_value: 1, allow_ot: 1, ot_start_after_min: 15 };
const DEM = { id: 2, start_time: '22:00', end_time: '06:00', cross_midnight: 1, break_minutes: 0, late_grace_min: 0, early_grace_min: 0,
  work_unit_value: 1, allow_ot: 1, ot_start_after_min: 1, ot_before: 1, ot_before_min: 30 };

test('ca đêm có tăng ca trước ca: nhận lượt vào sớm tới 6 tiếng (22h → từ 16h)', () => {
  assert.equal(ruleWindow(WD, DEM).winStart.toISOString(), iso(WD, '16:00'));
  // ca ngày vẫn 4 tiếng như cũ
  assert.equal(ruleWindow(WD, { ...HC, ot_before: 1 }).winStart.toISOString(), iso(WD, '04:00'));
});

test('khai "Bắt đầu vào" → khung nhận vào theo đúng giờ đã khai (như "quét trước ca" của HR-ERP)', () => {
  assert.equal(ruleWindow(WD, { ...DEM, check_in_start: '17:00' }).winStart.toISOString(), iso(WD, '17:00'));
  // ca ngày 1 ca/ngày: đã khai thì KHÔNG nới về 00:00
  const S = { ...HC, start_time: '14:00', end_time: '22:00', check_in_start: '12:00', check_out_end: '06:00' };
  assert.equal(ruleWindow(WD, S, { toDayEnd: true }).winStart.toISOString(), iso(WD, '12:00'));
  // không khai → nới về đầu ngày như trước
  assert.equal(ruleWindow(WD, { ...S, check_in_start: null }, { toDayEnd: true }).winStart.toISOString(), iso(WD, '00:00'));
  // khai muộn hơn giờ vào ca → không lùi sang hôm trước
  assert.equal(ruleWindow(WD, { ...HC, check_in_start: '08:30' }).winStart.toISOString(), iso(WD, '08:00'));
});

test('tăng ca làm tròn TỪNG ĐOẠN (trước ca / sau ca) như HR-ERP', () => {
  // vào 17:46, ra 06:03: trước ca 254' → 240, sau ca 3' → 0 = 240 (cộng rồi làm tròn = 255)
  const c = computeCheckout(DEM, iso(WD, '17:46'), iso(ND, '06:03'), WD, {});
  assert.deepEqual(c.ot_parts, [3, 254]);
  assert.equal(roundOtParts(c.ot_min, c.ot_parts, 2, 0, 15), 240);
  assert.equal(roundOtParts(257, null, 2, 0, 15), 255);            // không có đoạn → làm tròn cả tổng như cũ
  assert.equal(roundOtParts(257 + 480, [3, 254], 2, 0, 15), 720);  // phần cộng thêm (cả ca ngày nghỉ) là 1 đoạn riêng
});

test('làm tròn đi trễ / về sớm theo khối phút (tới) + trừ công theo số đã làm tròn', () => {
  assert.equal(roundUpBlock(1, 15), 15);
  assert.equal(roundUpBlock(16, 15), 30);
  assert.equal(roundUpBlock(15, 15), 15);
  assert.equal(roundUpBlock(7, 0), 7);
  assert.equal(computeLate(HC, iso(WD, '08:01'), WD, 15), 15);
  const c = computeCheckout(HC, iso(WD, '08:01'), iso(WD, '17:00'), WD, { lateBlock: 15 });
  assert.equal(c.work_minutes, 465);                                // HR-ERP: trễ 1' → công 465
  const e = computeCheckout({ ...HC, start_time: '06:00', end_time: '14:00', break_minutes: 0 }, iso(WD, '05:53'), iso(WD, '11:59'), WD, { lateBlock: 15 });
  assert.equal(e.early_min, 135);                                   // về sớm 121' → 135
  assert.equal(e.work_minutes, 345);
  // tắt (0) → đúng số phút như cũ
  assert.equal(computeCheckout(HC, iso(WD, '08:01'), iso(WD, '17:00'), WD, {}).work_minutes, 479);
});

test('nghỉ giữa ca CỐ ĐỊNH giờ: vào trong giờ nghỉ vẫn đủ buổi chiều, trễ không tính giờ nghỉ', () => {
  const S = { ...HC, break_start: '12:00' };
  assert.equal(computeLate(S, iso(WD, '12:19'), WD, 15), 240);
  const c = computeCheckout(S, iso(WD, '12:19'), iso(WD, '17:14'), WD, { lateBlock: 15 });
  assert.equal(c.work_minutes, 240);
  // về trong giờ nghỉ: về sớm không tính 60' nghỉ
  const m = computeCheckout(S, iso(WD, '08:00'), iso(WD, '12:30'), WD, {});
  assert.equal(m.early_min, 240);
  assert.equal(m.work_minutes, 240);
  // đủ ca: như cũ
  assert.equal(computeCheckout(S, iso(WD, '07:55'), iso(WD, '17:05'), WD, {}).work_minutes, 480);
});

test('vào SAU giờ tan ca: tăng ca chỉ tính từ lúc có mặt', () => {
  const c = computeCheckout(HC, iso(WD, '18:07'), iso(WD, '18:55'), WD, {});
  assert.equal(c.work_minutes, 0);
  assert.equal(c.ot_min, 48);    // 18:07 → 18:55 (trước đây tính từ 17:00 = 115')
});

test('quẹt lặp: giờ VÀO lấy lượt đầu, giờ RA lấy lượt cuối; cả ngày 1 cụm lặp → thiếu giờ ra', () => {
  const P = (hm) => ({ punch_at: iso(WD, hm), serial: 'A' });
  const r = mergeDayPunches([P('07:55'), P('08:02'), P('17:59'), P('18:00')], HC, 'filo', {}, WD, { dupMin: 15 });
  assert.equal(r.inIso, iso(WD, '07:55'));
  assert.equal(r.outIso, iso(WD, '18:00'));
  const one = mergeDayPunches([P('08:00'), P('08:05')], HC, 'filo', {}, WD, { dupMin: 15 });
  assert.equal(one.inIso, iso(WD, '08:00'));
  assert.equal(one.outIso, null);
});
