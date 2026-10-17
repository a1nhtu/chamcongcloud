// Test PHÂN HỆ QUẢN LÝ SUẤT ĂN — quy tắc THUẦN (server/meal-rules.js), không cần CSDL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MEAL_SHIFTS, windowBoundsUtc, inWindow, shiftForPunch, countValidPunches, buildBoard, parseCount, canOrderMeal,
  cleanDishes, checkShiftConfig, isOvernight, isHHMM, isIsoDate, addDaysIso, vnNow, orderDeadlineMs, orderDeadlineVn, buildDishReport, parseAdjust,
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

test('hạn chọn món: khoá trước N giờ / lúc giờ cố định (muộn hơn giờ ăn = hôm trước); mặc định = lúc bắt đầu như cũ', () => {
  const CHIEU = { from_time: '16:00', to_time: '20:00' };
  const vn = (s) => new Date(s + ':00+07:00');   // giờ VN → Date
  // mặc định (không cấu hình) = đúng 16:00
  assert.equal(orderDeadlineVn('2026-10-16', CHIEU), '2026-10-16 16:00');
  assert.equal(canOrderMeal('2026-10-16', CHIEU, vn('2026-10-16T15:58')), true);
  // trước 2 tiếng → 14:00: 13:59 còn chọn được, 15:58 đã khoá (đúng tình huống Anh nêu)
  const T2 = { ...CHIEU, lock_before_min: 120 };
  assert.equal(orderDeadlineVn('2026-10-16', T2), '2026-10-16 14:00');
  assert.equal(canOrderMeal('2026-10-16', T2, vn('2026-10-16T13:59')), true);
  assert.equal(canOrderMeal('2026-10-16', T2, vn('2026-10-16T15:58')), false);
  // khoá lúc 10:00 cùng ngày
  assert.equal(orderDeadlineVn('2026-10-16', { ...CHIEU, lock_at: '10:00' }), '2026-10-16 10:00');
  // bữa trưa 10:30 khoá lúc 20:00 → 20:00 HÔM TRƯỚC; tối hôm trước 20:30 đã khoá bữa trưa mai
  const TRUA20 = { from_time: '10:30', to_time: '13:30', lock_at: '20:00' };
  assert.equal(orderDeadlineVn('2026-10-17', TRUA20), '2026-10-16 20:00');
  assert.equal(canOrderMeal('2026-10-17', TRUA20, vn('2026-10-16T19:59')), true);
  assert.equal(canOrderMeal('2026-10-17', TRUA20, vn('2026-10-16T20:30')), false);
  assert.equal(canOrderMeal('2026-10-18', TRUA20, vn('2026-10-16T20:30')), true);
  // bữa đêm 23:00 trước 24 tiếng → 23:00 hôm trước
  assert.equal(orderDeadlineVn('2026-10-17', { from_time: '23:00', to_time: '02:00', lock_before_min: 1440 }), '2026-10-16 23:00');
  // lock_at được ưu tiên hơn lock_before_min
  assert.equal(orderDeadlineMs('2026-10-16', { ...CHIEU, lock_at: '15:00', lock_before_min: 600 }), vn('2026-10-16T15:00').getTime());
});

test('checkShiftConfig: cách khoá chọn món', () => {
  const B = { name: 'Chiều', from_time: '16:00', to_time: '20:00', mode: 'ot', enabled: true };
  assert.deepEqual(pick(checkShiftConfig({ ...B, lock_mode: 'before', lock_hours: '1,5' })), { lock_before_min: 90, lock_at: '' });
  assert.deepEqual(pick(checkShiftConfig({ ...B, lock_mode: 'at', lock_at: '14:00' })), { lock_before_min: 0, lock_at: '14:00' });
  assert.deepEqual(pick(checkShiftConfig({ ...B, lock_mode: 'start' })), { lock_before_min: 0, lock_at: '' });
  assert.equal(checkShiftConfig(B).value.lock_before_min, undefined);   // giao diện cũ không gửi → giữ nguyên
  for (const bad of [{ lock_mode: 'before', lock_hours: '0' }, { lock_mode: 'before', lock_hours: '49' }, { lock_mode: 'before', lock_hours: 'x' },
    { lock_mode: 'at', lock_at: '25:00' }, { lock_mode: 'abc' }]) assert.equal(checkShiftConfig({ ...B, ...bad }).ok, false, JSON.stringify(bad));
  function pick(c) { assert.equal(c.ok, true); return { lock_before_min: c.value.lock_before_min, lock_at: c.value.lock_at }; }
});

test('buildDishReport: tổng phải nấu = NV chọn + HR chọn hộ + điều chỉnh; suất mặc định = trưởng BP đăng ký vượt số người chọn; thực tế theo người quẹt', () => {
  const orders = [{ employee_id: 1, dish: 'Cơm gà', set_by: '' }, { employee_id: 2, dish: 'Cơm gà', set_by: 'HR' }, { employee_id: 3, dish: 'Bún bò', set_by: '' },
    { employee_id: 4, dish: 'Món đã gỡ', set_by: '' }];
  const r = buildDishReport({ menu: ['Cơm gà', 'Bún bò', 'Cháo'], orders, adjust: { 'cơm gà': 2, '': -1, 'Cháo': -5 }, punchers: new Set([1, 3, 9]), registered: 10 });
  assert.deepEqual(r.rows.map((x) => [x.dish, x.app, x.hr, x.adjust, x.total, x.ate]),
    [['Cơm gà', 1, 1, 2, 4, 1], ['Bún bò', 1, 0, 0, 1, 1], ['Cháo', 0, 0, -5, 0, 0], ['Món đã gỡ', 1, 0, 0, 1, 0]]);   // không âm; món đã gỡ vẫn hiện
  assert.deepEqual(r.default, { dish: '', base: 6, adjust: -1, total: 5, ate: 1 });   // 10 đăng ký − 4 người chọn; người 9 quẹt mà không chọn
  assert.equal(r.totals.total, 4 + 1 + 0 + 1 + 5);
  assert.equal(r.totals.not_yet, 2);   // người 2 và 4 đã chọn nhưng chưa quẹt
  assert.equal(r.totals.ate, 3);
  // chưa bộ phận nào đăng ký → không có suất mặc định
  assert.equal(buildDishReport({ menu: ['A'], orders: [], registered: null }).default.base, 0);
});

test('parseAdjust: số nguyên −9999…9999, có dấu + được; rỗng = 0', () => {
  assert.equal(parseAdjust('+3'), 3); assert.equal(parseAdjust('-2'), -2); assert.equal(parseAdjust(''), 0); assert.equal(parseAdjust(null), 0);
  for (const bad of ['1.5', 'abc', 10000, '--1']) assert.equal(parseAdjust(bad), undefined, String(bad));
});
