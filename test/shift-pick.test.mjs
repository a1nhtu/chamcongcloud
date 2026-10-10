// Lịch trình nhiều ca trong 1 ngày: chọn đúng bộ ca nhân viên thực làm theo giờ chấm (pickShiftSet)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickShiftSet } from '../server/attendance-calc.js';

const S = { id: 1, code: 'S', start_time: '08:00', end_time: '12:00' };
const C = { id: 2, code: 'C', start_time: '13:00', end_time: '17:00' };
const HC = { id: 3, code: 'HC', start_time: '08:00', end_time: '17:00' };
const D = { id: 4, code: 'D', start_time: '22:00', end_time: '06:00', cross_midnight: 1 };
const P = (d, hm) => ({ punch_at: new Date(`2026-11-${d}T${hm}:00+07:00`).toISOString() });
const pick = (cands, ps) => pickShiftSet(cands, ps, '2026-11-02').map((x) => `${x.shift.code}:${x.punches.length}`).join(',');

test('chỉ làm buổi sáng → Ca sáng (không tính thêm HC / Ca chiều)', () => {
  assert.equal(pick([S, C, HC], [P('02', '08:00'), P('02', '12:00')]), 'S:2');
});
test('chỉ làm buổi chiều → Ca chiều', () => {
  assert.equal(pick([S, C, HC], [P('02', '13:00'), P('02', '17:00')]), 'C:2');
});
test('làm cả ngày 2 lượt quẹt → Hành chính', () => {
  assert.equal(pick([S, C, HC], [P('02', '07:58'), P('02', '17:02')]), 'HC:2');
});
test('ca gãy 4 lượt quẹt → Ca sáng + Ca chiều', () => {
  assert.equal(pick([S, C], [P('02', '08:00'), P('02', '12:00'), P('02', '13:00'), P('02', '17:00')]), 'S:2,C:2');
});
test('lịch ngày / đêm: vào tối, ra sáng hôm sau → Ca đêm', () => {
  assert.equal(pick([HC, D], [P('02', '21:58'), P('03', '06:05')]), 'D:2');
});
test('trễ / về sớm vẫn nhận đúng ca gần nhất', () => {
  assert.equal(pick([S, C, HC], [P('02', '08:40'), P('02', '16:20')]), 'HC:2');
  assert.equal(pick([S, C, HC], [P('02', '13:25'), P('02', '17:00')]), 'C:2');
});
test('không có lượt quẹt → không chọn ca nào', () => {
  assert.deepEqual(pickShiftSet([S, C], [], '2026-11-02'), []);
});
