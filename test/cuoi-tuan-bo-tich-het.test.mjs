// Cài đặt > Ngày cuối tuần BỎ TÍCH HẾT (weekend_days = '') = không có ngày cuối tuần: CN đi làm là ngày thường, không thành tăng ca CN
// (lỗi cũ: chuỗi rỗng bị coi như mặc định "CN" — khách trankimxuyen bỏ tích CN mà CN vẫn ra OT; Anh 11/11/2026)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWeekendDay, weekendToOt } from '../server/attendance-calc.js';

test('weekend_days rỗng: không ngày nào là cuối tuần', () => {
  assert.equal(isWeekendDay('2026-11-01', ''), false);   // CN
  assert.equal(isWeekendDay('2026-11-08', ''), false);   // CN
  const c = { work_minutes: 720, work_unit: 1, ot_min: 0 };
  assert.equal(weekendToOt(c, { weekendOt: true, isWeekend: isWeekendDay('2026-11-01', '') }), c);
});
test('chưa cài (null/undefined) vẫn mặc định CN; cài 6,7 = T7 + CN', () => {
  assert.equal(isWeekendDay('2026-11-01', undefined), true);
  assert.equal(isWeekendDay('2026-11-01', null), true);
  assert.equal(isWeekendDay('2026-11-02', undefined), false);
  assert.equal(isWeekendDay('2026-11-07', '6,7'), true);
  assert.equal(isWeekendDay('2026-11-01', '6'), false);
});
