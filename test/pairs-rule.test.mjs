// Quy tắc ghép log "Nhiều lần vào/ra" (pairs): giờ công = tổng các cặp, kẹp trong khung ca, không trừ nghỉ giữa ca.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeDayPunches, computeCheckout, punchPairs } from '../server/attendance-calc.js';

const shift = { start_time: '08:00', end_time: '17:00', break_minutes: 60, late_grace_min: 0, early_grace_min: 0, work_unit_value: 1 };
const D = '2026-10-01';
const vn = (hm) => new Date(`${D}T${hm}:00+07:00`).toISOString();
const P = (...hms) => hms.map((h) => ({ punch_at: vn(h), serial: 'S' }));

test('punchPairs: ghép 1-2, 3-4, bỏ trùng trong 1 phút và lượt lẻ cuối', () => {
  const r = punchPairs([vn('08:00'), vn('08:00'), vn('12:00'), vn('13:00'), vn('17:00'), vn('18:00')].concat([new Date(`${D}T18:00:30+07:00`).toISOString()]));
  assert.deepEqual(r.map(([a, b]) => [a.slice(11, 16), b.slice(11, 16)]), [['01:00', '05:00'], ['06:00', '10:00']]);
  assert.equal(punchPairs([vn('08:00'), vn('12:00'), vn('13:00')]).length, 1);
});

test('mergeDayPunches pairs: vào/ra như FILO + trả danh sách cặp', () => {
  const r = mergeDayPunches(P('08:00', '12:00', '13:00', '17:00'), shift, 'pairs', {}, D);
  assert.equal(r.inIso, vn('08:00'));
  assert.equal(r.outIso, vn('17:00'));
  assert.equal(r.pairs.length, 2);
  assert.equal(mergeDayPunches(P('08:00', '17:00'), shift, 'filo', {}, D).pairs, undefined);
});

test('computeCheckout pairs: 08-12 + 13-17 = 480 phút = 1 công (không trừ thêm 60p nghỉ)', () => {
  const pairs = [[vn('08:00'), vn('12:00')], [vn('13:00'), vn('17:00')]];
  const c = computeCheckout(shift, vn('08:00'), vn('17:00'), D, { pairs });
  assert.equal(c.work_minutes, 480);
  assert.equal(c.work_unit, 1);
});

test('computeCheckout pairs: ra ngoài 2 tiếng giữa chiều bị trừ', () => {
  const pairs = [[vn('08:00'), vn('12:00')], [vn('13:00'), vn('14:00')], [vn('16:00'), vn('17:00')]];
  const c = computeCheckout(shift, vn('08:00'), vn('17:00'), D, { pairs });
  assert.equal(c.work_minutes, 360);
  assert.equal(c.work_unit, 0.75);
});

test('computeCheckout pairs: cặp ngoài khung ca bị kẹp (vào sớm không tính)', () => {
  const pairs = [[vn('07:00'), vn('12:00')], [vn('13:00'), vn('17:30')]];
  assert.equal(computeCheckout(shift, vn('07:00'), vn('17:30'), D, { pairs }).work_minutes, 480);
});

test('Không có cặp (chỉ 1 cặp hoặc FILO) → tính như cũ, có trừ nghỉ giữa ca', () => {
  const one = [[vn('08:00'), vn('17:00')]];
  assert.equal(computeCheckout(shift, vn('08:00'), vn('17:00'), D, { pairs: one }).work_minutes, 480);
  assert.equal(computeCheckout(shift, vn('08:00'), vn('17:00'), D, {}).work_minutes, 480);
});
