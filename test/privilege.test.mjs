// Chế độ ưu đãi (thai sản, nuôi con nhỏ…): được đến muộn / về sớm số phút đã khai, không tính trễ/sớm, không trừ công. Chạy: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCheckout, computeLate, computeNoOut } from '../server/attendance-calc.js';
import { privilegeLookup } from '../server/privilege.js';

const iso = (d, hm) => new Date(`${d}T${hm}:00+07:00`).toISOString();
const WD = '2026-10-05';
// ca hành chính 8–17, nghỉ 60 phút KHÔNG cố định giờ
const HC = { id: 1, start_time: '08:00', end_time: '17:00', break_minutes: 60, late_grace_min: 0, early_grace_min: 0, work_unit_value: 1 };
// cùng ca nhưng nghỉ trưa CỐ ĐỊNH 12:00–13:00
const HCB = { ...HC, break_start: '12:00' };
const P = (o) => ({ late: 0, midOut: 0, midIn: 0, early: 0, ...o });

test('mang thai về sớm 60 phút: ra 16:00 vẫn đủ công, không tính về sớm', () => {
  const c = computeCheckout(HC, iso(WD, '08:00'), iso(WD, '16:00'), WD, { priv: P({ early: 60 }) });
  assert.equal(c.early_min, 0);
  assert.equal(c.work_minutes, 480);
  assert.equal(c.work_unit, 1);
  // không ưu đãi → về sớm 60
  assert.equal(computeCheckout(HC, iso(WD, '08:00'), iso(WD, '16:00'), WD).early_min, 60);
});

test('về sớm quá số phút ưu đãi → chỉ tính phần vượt', () => {
  const c = computeCheckout(HC, iso(WD, '08:00'), iso(WD, '15:50'), WD, { priv: P({ early: 60 }) });
  assert.equal(c.early_min, 10);
  assert.equal(c.work_minutes, 470);
});

test('được đến muộn 30 phút: vào 8:30 = đúng giờ, vào 8:40 = trễ 10', () => {
  assert.equal(computeLate(HC, iso(WD, '08:30'), WD, 0, P({ late: 30 })), 0);
  assert.equal(computeLate(HC, iso(WD, '08:40'), WD, 0, P({ late: 30 })), 10);
  assert.equal(computeLate(HC, iso(WD, '08:30'), WD), 30);
  const c = computeCheckout(HC, iso(WD, '08:30'), iso(WD, '17:00'), WD, { priv: P({ late: 30 }) });
  assert.equal(c.work_minutes, 480);
  // ca nghỉ trưa cố định cũng vậy
  assert.equal(computeCheckout(HCB, iso(WD, '08:30'), iso(WD, '17:00'), WD, { priv: P({ late: 30 }) }).work_minutes, 480);
});

test('nghỉ trưa cố định: chỉ làm chiều → ưu đãi "sau nghỉ trưa đến muộn" trừ vào phần trễ buổi chiều, buổi sáng vắng vẫn tính đủ', () => {
  // vào 13:20: sáng vắng 240' + chiều trễ 20' (trong 30' ưu đãi) → trễ 240
  assert.equal(computeLate(HCB, iso(WD, '13:20'), WD, 0, P({ late: 60, midIn: 30 })), 240);
  assert.equal(computeLate(HCB, iso(WD, '13:20'), WD), 260);
});

test('nghỉ trưa cố định: chỉ làm sáng → ưu đãi "trước nghỉ trưa về sớm" trừ vào phần sớm buổi sáng', () => {
  const c = computeCheckout(HCB, iso(WD, '08:00'), iso(WD, '11:40'), WD, { priv: P({ midOut: 30, early: 60 }) });
  assert.equal(c.early_min, 240);   // chiều vắng 240' + sáng về sớm 20' (trong 30' ưu đãi)
  assert.equal(c.work_minutes, 240);
});

test('nhiều lần vào/ra: ra ngoài giữa giờ được bù tối đa midOut + midIn phút (ngoài giờ nghỉ của ca)', () => {
  const pairs = [[iso(WD, '08:00'), iso(WD, '11:30')], [iso(WD, '13:00'), iso(WD, '17:00')]];
  const base = computeCheckout(HC, iso(WD, '08:00'), iso(WD, '17:00'), WD, { pairs });
  assert.equal(base.work_minutes, 450);
  const c = computeCheckout(HC, iso(WD, '08:00'), iso(WD, '17:00'), WD, { pairs, priv: P({ midOut: 30, midIn: 30 }) });
  assert.equal(c.work_minutes, 480);   // ra ngoài 90' − nghỉ 60' = 30' → bù 30'
});

test('thiếu giờ ra vẫn tính công (ca bật): trừ phần đi trễ SAU ưu đãi', () => {
  const S = { ...HC, no_out_credit: 1 };
  assert.equal(computeNoOut(S, iso(WD, '08:30'), WD, { priv: P({ late: 30 }) }).work_minutes, 480);
  assert.equal(computeNoOut(S, iso(WD, '08:30'), WD).work_minutes, 450);
});

test('tra ưu đãi theo ngày: đúng khoảng ngày, nhiều dòng cộng dồn, không hạn khi bỏ trống đến ngày', () => {
  const rows = [
    { employee_id: 7, from_date: '2026-10-01', to_date: '2026-10-31', late_min: 0, mid_out_min: 0, mid_in_min: 0, early_min: 60 },
    { employee_id: 7, from_date: '2026-10-20', to_date: '', late_min: 15, mid_out_min: 0, mid_in_min: 0, early_min: 0 },
  ];
  const fakeDb = { prepare: () => ({ all: () => rows }) };
  const look = privilegeLookup(fakeDb);
  assert.equal(look(7, '2026-09-30'), null);
  assert.deepEqual(look(7, '2026-10-05'), { late: 0, midOut: 0, midIn: 0, early: 60 });
  assert.deepEqual(look(7, '2026-10-25'), { late: 15, midOut: 0, midIn: 0, early: 60 });
  assert.deepEqual(look(7, '2027-01-01'), { late: 15, midOut: 0, midIn: 0, early: 0 });
  assert.equal(look(8, '2026-10-05'), null);
  // CSDL chưa có bảng → không lỗi
  assert.equal(privilegeLookup({ prepare: () => { throw new Error('no table'); } })(7, '2026-10-05'), null);
});
