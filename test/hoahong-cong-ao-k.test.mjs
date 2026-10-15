// Công ảo kiểu "công khách K" của HR-ERP (khách Hoa Hồng): giờ ĐẾN – RA – VÀO trưa. Hàm thuần k-times.js (không CSDL). Chạy: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kDayTimes, realFourTimes, kSeed, seededRnd } from '../server/k-times.js';

const T = (hm) => Date.parse(`2026-08-12T${hm}+07:00`);
const hm = (ms) => new Date(ms + 7 * 3600e3).toISOString().slice(11, 19);
const S = T('07:00:00'), B1 = T('11:30:00'), B2 = T('13:00:00');
const K = { early: 15, lateMax: 60, outGap: 15, inGap: 5 };
const run = (o, seed = 1) => kDayTimes({ start: S, breakStart: B1, breakEnd: B2, den: null, ra: null, vao: null, ...o }, K, seed);

test('ĐẾN: sớm ≥ 15 phút → hiện 1–14 phút trước giờ vào ca (06:46–06:59)', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const r = run({ den: T('06:27:14') }, seed);
    assert.ok(r.den >= T('06:45:00') && r.den < T('07:00:00'), hm(r.den));
    assert.equal(r.lateHidden, false);
  }
});

test('ĐẾN: sớm < 15 phút giữ giờ thật; trễ 1–60 phút → hiện sớm + che trễ; trễ > 60 phút giữ giờ thật', () => {
  assert.equal(run({ den: T('06:50:33') }).den, T('06:50:33'));       // sớm 10'
  assert.equal(run({ den: T('06:45:40') }).den !== T('06:45:40'), true); // phút tròn 06:45 → sớm 15' → đổi
  assert.equal(run({ den: T('07:00:40') }).den, T('07:00:40'));       // trễ 0 phút tròn: giữ
  const late = run({ den: T('07:21:00') }); assert.equal(late.lateHidden, true); assert.ok(late.den < S);
  assert.equal(run({ den: T('08:00:30') }).lateHidden, true);          // trễ đúng 60'
  const over = run({ den: T('08:01:00') }); assert.equal(over.den, T('08:01:00')); assert.equal(over.lateHidden, false);   // trễ 61'
  assert.equal(run({ den: T('08:43:30') }).den, T('08:43:30'));
});

test('RA trưa: muộn ≥ 15 phút sau giờ nghỉ → 11:30–11:41; sớm hơn giữ thật', () => {
  assert.equal(run({ ra: T('11:34:15') }).ra, T('11:34:15'));
  assert.equal(run({ ra: T('10:32:35') }).ra, T('10:32:35'));
  for (let seed = 1; seed <= 200; seed++) { const r = run({ ra: T('11:52:00') }, seed).ra; assert.ok(r >= B1 && r < B1 + 12 * 60000 + 60000, hm(r)); }
});

test('VÀO sau trưa: sớm hơn 12:55 → 12:55–13:00:59; từ 12:55 trở đi và vào muộn giữ thật', () => {
  assert.equal(run({ vao: T('12:56:10') }).vao, T('12:56:10'));
  assert.equal(run({ vao: T('14:28:01') }).vao, T('14:28:01'));
  for (let seed = 1; seed <= 200; seed++) { const v = run({ vao: T('11:34:15') }, seed).vao; assert.ok(v >= B2 - 5 * 60000 && v < B2 + 60000, hm(v)); }
  for (let seed = 1; seed <= 50; seed++) { const v = run({ vao: T('12:44:38') }, seed).vao; assert.ok(v >= B2 - 5 * 60000 && v < B2 + 60000, hm(v)); }
});

test('số ngẫu nhiên CỐ ĐỊNH theo NV + ngày + mức; mức khác nhau cho giờ khác', () => {
  const a = kSeed(55, '2026-08-12', 1), b = kSeed(55, '2026-08-12', 1), c = kSeed(55, '2026-08-12', 2), d = kSeed(56, '2026-08-12', 1);
  assert.equal(a, b); assert.notEqual(a, c); assert.notEqual(a, d);
  assert.equal(run({ den: T('06:27:14'), ra: T('11:52:00'), vao: T('11:40:00') }, a).den, run({ den: T('06:27:14'), ra: T('11:52:00'), vao: T('11:40:00') }, b).den);
  const r1 = seededRnd(7), r2 = seededRnd(7); assert.deepEqual([r1(14), r1(60), r1(12)], [r2(14), r2(60), r2(12)]);
});

test('tắt riêng từng quy tắc bằng 0', () => {
  const off = { early: 0, lateMax: 0, outGap: 0, inGap: 0 };
  const spec = { start: S, breakStart: B1, breakEnd: B2, den: T('06:27:14'), ra: T('11:52:00'), vao: T('11:40:00') };
  const r = kDayTimes(spec, off, 3);
  assert.deepEqual([r.den, r.ra, r.vao, r.lateHidden], [spec.den, spec.ra, spec.vao, false]);
  assert.equal(kDayTimes({ ...spec, den: T('07:21:00') }, { ...off, early: 15 }, 3).den, T('07:21:00'));   // chỉ bật "đến sớm": trễ không đổi
});

test('lượt quẹt thật → Đến / Ra / Vào / Về như HR-ERP', () => {
  // 4 lần
  assert.deepEqual(realFourTimes([T('06:55:20'), T('11:30:39'), T('14:28:01'), T('18:03:26')], B1),
    { den: T('06:55:20'), ra: T('11:30:39'), vao: T('14:28:01'), ve: T('18:03:26') });
  // 6 lần (HR-ERP: Ra = Vào = lượt đầu tiên từ giờ nghỉ)
  const six = realFourTimes([T('06:54:57'), T('07:05:04'), T('11:20:03'), T('11:34:15'), T('12:58:36'), T('18:06:19')], B1);
  assert.equal(six.ra, T('11:34:15')); assert.equal(six.vao, T('11:34:15')); assert.equal(six.ve, T('18:06:19'));
  // 2 lần: không có Ra / Vào
  const two = realFourTimes([T('06:50:00'), T('16:35:00')], B1); assert.equal(two.ra, null); assert.equal(two.vao, null);
  // 1 lần: chỉ Đến; lượt trùng cách < 1 giây bị bỏ; không có lượt
  assert.deepEqual(realFourTimes([T('06:50:00')], B1), { den: T('06:50:00'), ra: null, vao: null, ve: null });
  assert.equal(realFourTimes([T('06:50:00'), T('06:50:00')], B1).ve, null);
  assert.deepEqual(realFourTimes([], B1), { den: null, ra: null, vao: null, ve: null });
});
