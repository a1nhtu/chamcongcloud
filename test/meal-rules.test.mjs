// Test PHÂN HỆ QUẢN LÝ SUẤT ĂN — quy tắc THUẦN (server/meal-rules.js), không cần CSDL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MEAL_SHIFTS, windowBoundsUtc, inWindow, shiftForPunch, countValidPunches, buildBoard, parseCount, canOrderMeal,
  cleanDishes, checkShiftConfig, isOvernight, isHHMM, isIsoDate, addDaysIso, vnNow,
} from '../server/meal-rules.js';

const [TRUA, CHIEU, DEM] = DEFAULT_MEAL_SHIFTS;

test('3 ca mặc định: Trưa & Đêm đếm chấm công, Chiều đối chiếu đăng ký làm thêm', () => {
  assert.deepEqual(DEFAULT_MEAL_SHIFTS.map((s) => [s.code, s.mode]), [['trua', 'punch'], ['chieu', 'ot'], ['dem', 'punch']]);
  assert.equal(isOvernight(DEM), true);
  assert.equal(isOvernight(TRUA), false);
});

test('khung giờ chốt đổi sang UTC đúng (VN = UTC+7), gồm trọn phút kết thúc', () => {
  assert.deepEqual(windowBoundsUtc('2026-10-15', TRUA), ['2026-10-15T03:30:00.000Z', '2026-10-15T06:30:59.999Z']);
  // ca đêm qua nửa đêm: 23:00 ngày 15 → 02:00 ngày 16 (giờ VN)
  assert.deepEqual(windowBoundsUtc('2026-10-15', DEM), ['2026-10-15T16:00:00.000Z', '2026-10-15T19:00:59.999Z']);
});

test('quẹt NGOÀI giờ chốt bị loại; sát biên vẫn tính', () => {
  assert.equal(inWindow('2026-10-15T03:30:00.000Z', '2026-10-15', TRUA), true);    // đúng 10:30
  assert.equal(inWindow('2026-10-15T03:29:59.000Z', '2026-10-15', TRUA), false);   // 10:29:59
  assert.equal(inWindow('2026-10-15T06:30:30.000Z', '2026-10-15', TRUA), true);    // 13:30:30 (còn trong phút chốt)
  assert.equal(inWindow('2026-10-15T06:31:00.000Z', '2026-10-15', TRUA), false);   // 13:31
  assert.equal(inWindow('2026-10-15T18:00:00.000Z', '2026-10-15', DEM), true);     // 01:00 sáng 16 thuộc đêm ngày 15
  assert.equal(inWindow('2026-10-15T18:00:00.000Z', '2026-10-16', DEM), false);    // …không thuộc đêm ngày 16
});

test('shiftForPunch: quẹt 00:30 sáng thuộc đêm HÔM TRƯỚC; quẹt giữa chiều không thuộc ca nào', () => {
  const shifts = DEFAULT_MEAL_SHIFTS;
  assert.deepEqual(shiftForPunch('2026-10-15T17:30:00.000Z', shifts), { workDate: '2026-10-15', shift: DEM });   // 00:30 ngày 16 VN
  assert.equal(shiftForPunch('2026-10-15T16:30:00.000Z', shifts).workDate, '2026-10-15');                         // 23:30 ngày 15
  assert.equal(shiftForPunch('2026-10-15T04:00:00.000Z', shifts).shift.code, 'trua');
  assert.equal(shiftForPunch('2026-10-15T09:00:00.000Z', shifts), null);                                          // 16:00 VN
  assert.equal(shiftForPunch('2026-10-15T11:00:00.000Z', shifts).shift.code, 'chieu');                            // 18:00 VN (màn bếp hiện cả ca Chiều)
  assert.equal(shiftForPunch('2026-10-15T04:00:00.000Z', [{ ...TRUA, enabled: 0 }]), null);                       // ca tắt
});

test('countValidPunches: mỗi người 1 suất/ca dù quẹt nhiều lần; đếm số lượt bị loại', () => {
  const p = (id, iso, dep) => ({ employee_id: id, punch_at: iso, department: dep });
  const r = countValidPunches([
    p(1, '2026-10-15T04:00:00.000Z', 'Sản xuất'), p(1, '2026-10-15T04:05:00.000Z', 'Sản xuất'),   // cùng người quẹt 2 lần
    p(2, '2026-10-15T05:00:00.000Z', 'Sản xuất'), p(3, '2026-10-15T05:10:00.000Z', 'Kho'),
    p(4, '2026-10-15T01:00:00.000Z', 'Kho'),     // 08:00 — sáng, ngoài giờ chốt
    p(5, '2026-10-15T09:00:00.000Z', 'Kho'),     // 16:00 — chiều, ngoài giờ chốt
    { employee_id: null, punch_at: '2026-10-15T04:00:00.000Z', department: '' },   // chưa khớp NV
  ], '2026-10-15', TRUA);
  assert.deepEqual(r.byDept, { 'Sản xuất': { people: 2, swipes: 3 }, Kho: { people: 1, swipes: 1 } });
  assert.equal(r.people, 3); assert.equal(r.swipes, 4); assert.equal(r.outside, 2);
});

test('buildBoard ca Trưa: tham chiếu = người quẹt; chênh lệch = đăng ký − tham chiếu; tổng = số đăng ký', () => {
  const b = buildBoard({
    mode: 'punch', depts: ['Kho', 'May', 'Sản xuất'],
    punch: { 'Sản xuất': { people: 40, swipes: 42 }, Kho: { people: 10, swipes: 10 }, May: { people: 5, swipes: 5 } },
    reg: { 'Sản xuất': { count: 38, note: 'nghỉ 2' }, Kho: { count: 10 } },
  });
  const by = Object.fromEntries(b.rows.map((r) => [r.department, r]));
  assert.equal(by['Sản xuất'].diff, -2); assert.equal(by['Sản xuất'].total, 38); assert.equal(by['Sản xuất'].note, 'nghỉ 2');
  assert.equal(by.Kho.diff, 0);
  assert.equal(by.May.registered, null); assert.equal(by.May.diff, null); assert.equal(by.May.missing, true); assert.equal(by.May.total, 0);
  assert.deepEqual(b.totals, { punch_people: 55, punch_swipes: 57, ot_people: 0, registered: 48, ref: 55, diff: -7, total: 48, missing: 1 });
});

test('buildBoard ca Chiều: KHÔNG dùng chấm công — đối chiếu với đăng ký làm thêm', () => {
  const b = buildBoard({
    mode: 'ot', depts: ['Kho', 'Sản xuất'],
    punch: { Kho: { people: 99, swipes: 99 } },   // có số chấm công cũng không được dùng
    ot: { 'Sản xuất': { people: 30, minutes: 3600 }, Kho: { people: 4, minutes: 480 } },
    reg: { 'Sản xuất': { count: 33 }, Kho: { count: 4 } },
  });
  const by = Object.fromEntries(b.rows.map((r) => [r.department, r]));
  assert.equal(by['Sản xuất'].ref, 30); assert.equal(by['Sản xuất'].diff, 3);
  assert.equal(by.Kho.ref, 4); assert.equal(by.Kho.diff, 0);
  assert.equal(b.totals.ref, 34); assert.equal(b.totals.total, 37);
});

test('parseCount: số nguyên 0…99999; rỗng = xoá; còn lại không hợp lệ', () => {
  assert.equal(parseCount('12'), 12); assert.equal(parseCount(0), 0); assert.equal(parseCount(''), null); assert.equal(parseCount(null), null);
  for (const bad of ['-1', 1.5, 'abc', 100000, '1e2x']) assert.equal(parseCount(bad), undefined, String(bad));
});

test('canOrderMeal: ngày sau được; hôm nay chỉ trước giờ bắt đầu khung ăn; ngày qua khoá', () => {
  const now = new Date('2026-10-15T02:00:00.000Z');   // 09:00 VN ngày 15
  assert.equal(vnNow(now).date, '2026-10-15');
  assert.equal(canOrderMeal('2026-10-16', TRUA, now), true);
  assert.equal(canOrderMeal('2026-10-15', TRUA, now), true);    // 09:00 < 10:30
  assert.equal(canOrderMeal('2026-10-15', TRUA, new Date('2026-10-15T04:00:00.000Z')), false);   // 11:00 > 10:30
  assert.equal(canOrderMeal('2026-10-14', TRUA, now), false);
});

test('cleanDishes: bỏ trống / trùng (không phân biệt hoa thường), cắt độ dài, tối đa 40', () => {
  assert.deepEqual(cleanDishes([' Cơm gà ', 'cơm GÀ', '', null, 'Bún  bò   Huế']), ['Cơm gà', 'Bún bò Huế']);
  assert.equal(cleanDishes(Array.from({ length: 60 }, (_, i) => 'Món ' + i)).length, 40);
  assert.equal(cleanDishes('x').length, 0);
  assert.equal(cleanDishes(['a'.repeat(200)])[0].length, 80);
});

test('checkShiftConfig: kiểm tra giờ / cách đối chiếu', () => {
  assert.equal(checkShiftConfig({ name: 'Trưa', from_time: '10:30', to_time: '13:30', mode: 'punch', enabled: true }).ok, true);
  assert.equal(checkShiftConfig({ name: 'Đêm', from_time: '23:00', to_time: '02:00', mode: 'punch' }).ok, true);   // qua nửa đêm hợp lệ
  assert.equal(checkShiftConfig({ name: '', from_time: '10:30', to_time: '13:30', mode: 'punch' }).ok, false);
  assert.equal(checkShiftConfig({ name: 'x', from_time: '25:00', to_time: '13:30', mode: 'punch' }).ok, false);
  assert.equal(checkShiftConfig({ name: 'x', from_time: '10:30', to_time: '10:30', mode: 'punch' }).ok, false);
  assert.equal(checkShiftConfig({ name: 'x', from_time: '10:30', to_time: '13:30', mode: 'abc' }).ok, false);
});

test('tiện ích ngày giờ', () => {
  assert.equal(isHHMM('09:05'), true); assert.equal(isHHMM('9:05'), false);
  assert.equal(isIsoDate('2026-10-15'), true); assert.equal(isIsoDate('2026-13-45'), false); assert.equal(isIsoDate('15/10/2026'), false);
  assert.equal(addDaysIso('2026-12-31', 1), '2027-01-01');
});
