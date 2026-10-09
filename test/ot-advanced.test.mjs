// Tăng ca nâng cao + bù trừ + thiếu giờ ra (tham khảo Ronald Jack). Chạy: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCheckout, computeNoOut, splitOtTiers, ruleWindow } from '../server/attendance-calc.js';

const iso = (d, hm) => new Date(`${d}T${hm}:00+07:00`).toISOString();
const WD = '2026-01-05'; // Thứ Hai
const base = {
  id: 1, start_time: '08:00', end_time: '17:00', break_minutes: 60,
  late_grace_min: 5, early_grace_min: 15, work_unit_value: 1.0,
  allow_ot: 1, ot_start_after_min: 30, ot_rounding_unit: 0,
};

test('mặc định (tùy chọn mới tắt) → kết quả như cũ', () => {
  const c = computeCheckout(base, iso(WD, '07:00'), iso(WD, '18:00'), WD, {});
  assert.equal(c.ot_min, 60);          // chỉ tăng ca sau giờ, đến sớm 1h không tính
  assert.equal(c.work_minutes, 480);
  assert.equal(c.work_unit, 1);
});

test('1. tăng ca TRƯỚC giờ vào ca: đến sớm >= ngưỡng thì cộng vào OT', () => {
  const s = { ...base, ot_before: 1, ot_before_min: 30 };
  assert.equal(computeCheckout(s, iso(WD, '07:00'), iso(WD, '18:00'), WD, {}).ot_min, 120);   // 60 trước + 60 sau
  assert.equal(computeCheckout(s, iso(WD, '07:40'), iso(WD, '17:00'), WD, {}).ot_min, 0);     // sớm 20' < 30'
  assert.equal(computeCheckout({ ...s, allow_ot: 0 }, iso(WD, '07:00'), iso(WD, '17:00'), WD, {}).ot_min, 0); // ca không cho OT
  // cửa sổ nhận log rộng hơn để bắt được lượt đến sớm
  const w = ruleWindow(WD, s);
  assert.equal(w.winStart.toISOString(), iso(WD, '04:00'));
});

test('2. chia mức TC1→TC4 theo giới hạn phút', () => {
  const s = { ot_tier1_min: 120, ot_tier2_min: 120, ot_tier3_min: 60 };
  assert.deepEqual(splitOtTiers(300, s), [120, 120, 60, 0]);
  assert.deepEqual(splitOtTiers(400, s), [120, 120, 60, 100]);
  assert.deepEqual(splitOtTiers(90, s), [90, 0, 0, 0]);
  assert.deepEqual(splitOtTiers(300, { ot_tier1_min: 120 }), [120, 180, 0, 0]);   // TC2 = 0 → nhận hết phần còn lại
  assert.deepEqual(splitOtTiers(300, {}), [300, 0, 0, 0]);                        // không đặt mức → tất cả TC1
  assert.deepEqual(splitOtTiers(300, null), [300, 0, 0, 0]);
});

test('3. xem cả ca là tăng ca vào cuối tuần / ngày lễ', () => {
  const s = { ...base, weekend_as_ot: 1 };
  const we = computeCheckout(s, iso(WD, '08:00'), iso(WD, '18:00'), WD, { isWeekend: true });
  assert.equal(we.work_unit, 0);
  assert.equal(we.work_minutes, 0);
  assert.equal(we.ot_min, 480 + 60);   // cả ca + 1h sau giờ
  assert.equal(we.ot_type, 'cuoi_tuan');
  // ngày thường không ảnh hưởng; ngày lễ chỉ khi bật holiday_as_ot
  assert.equal(computeCheckout(s, iso(WD, '08:00'), iso(WD, '17:00'), WD, {}).work_unit, 1);
  assert.equal(computeCheckout(s, iso(WD, '08:00'), iso(WD, '17:00'), WD, { isHoliday: true }).work_unit, 1);
  const hol = computeCheckout({ ...base, holiday_as_ot: 1 }, iso(WD, '08:00'), iso(WD, '17:00'), WD, { isHoliday: true });
  assert.equal(hol.ot_min, 480); assert.equal(hol.ot_type, 'le'); assert.equal(hol.work_unit, 0);
});

test('4. bù trừ: đi trễ thì về trễ bù lại, không bị trừ giờ', () => {
  const s = { ...base, compensate_late: 1 };
  const c = computeCheckout(s, iso(WD, '08:30'), iso(WD, '17:30'), WD, {});
  assert.equal(c.work_minutes, 480);   // trễ 30' được bù bằng 30' ở lại
  assert.equal(c.work_unit, 1);
  assert.equal(c.ot_min, 0);           // phút dùng để bù không thành tăng ca
  // ở lại nhiều hơn số phút trễ → phần dư vẫn là tăng ca (nếu đủ ngưỡng)
  const c2 = computeCheckout(s, iso(WD, '08:30'), iso(WD, '18:30'), WD, {});
  assert.equal(c2.work_minutes, 480);
  assert.equal(c2.ot_min, 60);
  // không bật bù trừ → bị trừ 30' và 30' ở lại vừa đủ ngưỡng thành tăng ca
  const c3 = computeCheckout(base, iso(WD, '08:30'), iso(WD, '17:30'), WD, {});
  assert.equal(c3.work_minutes, 450);
  assert.equal(c3.ot_min, 30);
});

test('5. thiếu giờ ra: mặc định 0 công; bật tùy chọn → đủ công trừ phần đi trễ', () => {
  const off = computeNoOut(base, iso(WD, '08:20'), WD, {});
  assert.equal(off.work_unit, 0); assert.equal(off.day_status, 'thieu_ra');
  const s = { ...base, no_out_credit: 1 };
  const ok = computeNoOut(s, iso(WD, '08:00'), WD, {});
  assert.equal(ok.work_minutes, 480); assert.equal(ok.work_unit, 1); assert.equal(ok.day_status, 'thieu_ra');
  const late = computeNoOut(s, iso(WD, '08:20'), WD, {});
  assert.equal(late.work_minutes, 460);   // trừ 20' đi trễ
  assert.equal(late.work_unit, 0.95);     // floor(460/480 × 100)/100
  assert.equal(computeNoOut(null, iso(WD, '08:00'), WD, {}).work_unit, 0);   // không ca → 0
});
