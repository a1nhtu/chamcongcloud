// Làm tròn SỐ CÔNG không được hụt / dư 0,01 do sai số số thực.
//   VD ca chuẩn 450 phút, làm 261 phút = 0,58 công đúng, nhưng 261/450*100 = 57,99999999999999 → "lùi" ra 0,57.
//   VD ca chuẩn 480 phút, làm 264 phút = 0,55 công đúng, nhưng 264/480*100 = 55,00000000000001 → "tới" ra 0,56.
// Test so 3 chỗ tính (computeCheckout, noShiftUnit, computeNoOut) với kết quả tính bằng SỐ NGUYÊN (BigInt), không qua số thực.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCheckout, noShiftUnit, computeNoOut } from '../server/attendance-calc.js';

const WD = '2026-11-02';
const iso = (hm, addMin = 0) => {
  const [h, m] = hm.split(':').map(Number);
  const t = h * 60 + m + addMin;
  return new Date(`${WD}T${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}:00+07:00`).toISOString();
};
const hm = (addMin) => `${String(Math.floor((6 * 60 + addMin) / 60)).padStart(2, '0')}:${String((6 * 60 + addMin) % 60).padStart(2, '0')}`;

const STDS = [240, 420, 450, 480, 510, 540, 600, 660, 720];   // giờ chuẩn 1 ca (phút) — đã trừ nghỉ giữa ca
const UNITS = [{ bn: 1n, bd: 1n, v: 1 }, { bn: 1n, bd: 2n, v: 0.5 }];   // công của ca: 1 và 0,5 (dạng phân số để tính nguyên)
const MODES = [{ id: 0, ten: 'lùi' }, { id: 1, ten: 'tới' }];

// Kết quả ĐÚNG, tính bằng số nguyên: k = floor|ceil(100 · công_ca · w / std) rồi k / 100 (2 số lẻ), chặn trên bằng công của ca
function dung(w, std, unit, mode, decimals = 2) {
  const f = 10n ** BigInt(decimals);
  const num = f * unit.bn * BigInt(w), den = unit.bd * BigInt(std);
  const k = mode === 1 ? (num + den - 1n) / den : num / den;
  return Math.min(unit.v, Number(k) / Number(f));
}
// Công thức CŨ (trước khi sửa) — chỉ để chứng minh test này bắt được lỗi
function cu(w, std, unit, mode, decimals = 2) {
  const factor = Math.pow(10, decimals);
  const roundFn = mode === 1 ? Math.ceil : mode === 2 ? Math.round : Math.floor;
  return Math.min(unit.v, roundFn(unit.v * w / std * factor) / factor);
}

// Ca không nghỉ giữa ca, bắt đầu 06:00, dài đúng `std` phút → giờ chuẩn = std
const ca = (std, unit, extra = {}) => ({ start_time: '06:00', end_time: hm(std), break_minutes: 0, late_grace_min: 0, early_grace_min: 0, allow_ot: 0, work_unit_value: unit.v, ...extra });

// 26 trường hợp CŨ bị lệch 0,01 (std · công ca · kiểu → các số phút làm) — sau khi sửa phải ra đúng như tính bằng số nguyên
const LECH_CU = {
  'tới|1|240': [132], 'tới|1|420': [231], 'lùi|1|450': [261], 'tới|1|450': [63, 126, 252], 'lùi|0.5|450': [261], 'tới|0.5|450': [63, 126, 252],
  'tới|1|480': [264], 'tới|1|540': [297], 'lùi|1|600': [174, 342, 348], 'tới|1|600': [42, 84, 168, 330, 336], 'lùi|0.5|600': [348], 'tới|0.5|600': [84, 168, 336],
  'tới|1|660': [363], 'tới|1|720': [396],
};

test('bản sao công thức CŨ trong test lệch đúng 26 trường hợp → test này bắt được lỗi (các test sau: mã mới không lệch ca nào)', () => {
  const lech = {};
  for (const std of STDS) for (const unit of UNITS) for (const m of MODES) for (let w = 1; w <= std; w++) {
    if (cu(w, std, unit, m.id) !== dung(w, std, unit, m.id)) (lech[`${m.ten}|${unit.v}|${std}`] ??= []).push(w);
  }
  assert.deepEqual(lech, LECH_CU);
  assert.equal(Object.values(lech).flat().length, 26);
});

test('computeCheckout: số công = tính bằng số nguyên (giờ chuẩn × số phút làm × công của ca × lùi/tới)', () => {
  for (const std of STDS) for (const unit of UNITS) for (const m of MODES) for (let w = 1; w <= std; w++) {
    const c = computeCheckout(ca(std, unit), iso('06:00'), iso('06:00', w), WD, { roundingMode: m.id });
    assert.equal(c.work_minutes, w, `giờ làm: chuẩn ${std} làm ${w}`);
    assert.equal(c.work_unit, dung(w, std, unit, m.id), `${m.ten} · ca ${unit.v} công chuẩn ${std}' làm ${w}'`);
  }
});

test('noShiftUnit: số công không ca = tính bằng số nguyên (chuẩn tùy ý, tối đa 1 công)', () => {
  const U1 = UNITS[0];
  for (const std of STDS) for (const m of MODES) for (let w = 1; w <= std; w++) {
    assert.equal(noShiftUnit(w, { roundingMode: m.id, standardMinutes: std }), dung(w, std, U1, m.id), `${m.ten} · chuẩn ${std}' làm ${w}'`);
  }
  // mặc định (chuẩn 480', lùi 2 số lẻ) vẫn như cũ
  assert.equal(noShiftUnit(278), dung(278, 480, U1, 0));
  assert.equal(noShiftUnit(600), 1);
  assert.equal(noShiftUnit(0), 0);
});

test('computeNoOut (thiếu giờ ra vẫn tính công): số công = tính bằng số nguyên', () => {
  for (const std of STDS) for (const unit of UNITS) for (const m of MODES) for (let late = 0; late < std; late++) {
    const w = std - late;   // đi trễ `late` phút (dung sai 0) → giờ công = chuẩn − trễ
    const c = computeNoOut(ca(std, unit, { no_out_credit: 1 }), iso('06:00', late), WD, { roundingMode: m.id });
    assert.equal(c.work_minutes, w, `giờ làm: chuẩn ${std} trễ ${late}`);
    assert.equal(c.work_unit, dung(w, std, unit, m.id), `${m.ten} · ca ${unit.v} công chuẩn ${std}' làm ${w}'`);
  }
});

test('số lẻ khác (1 và 3 chữ số thập phân) cũng khớp tính nguyên; "gần nhất" giữ nguyên như cũ', () => {
  for (const decimals of [1, 3]) for (const std of [450, 480, 600]) for (const unit of UNITS) for (const m of MODES) for (let w = 1; w <= std; w++) {
    const c = computeCheckout(ca(std, unit), iso('06:00'), iso('06:00', w), WD, { roundingMode: m.id, roundingDecimals: decimals });
    assert.equal(c.work_unit, dung(w, std, unit, m.id, decimals), `${m.ten} · ${decimals} số lẻ · ca ${unit.v} công chuẩn ${std}' làm ${w}'`);
  }
  // kiểu "gần nhất" (roundingMode 2): hành vi không đổi — vẫn Math.round như công thức cũ
  for (const std of STDS) for (const unit of UNITS) for (let w = 1; w <= std; w++) {
    const c = computeCheckout(ca(std, unit), iso('06:00'), iso('06:00', w), WD, { roundingMode: 2 });
    assert.equal(c.work_unit, cu(w, std, unit, 2), `gần nhất · ca ${unit.v} công chuẩn ${std}' làm ${w}'`);
    assert.equal(noShiftUnit(w, { roundingMode: 2, standardMinutes: std }), cu(w, std, UNITS[0], 2));
  }
});

test('làm tròn không đổi ở các số đã ổn (ca 450/480 phút, 0,5 công ca nửa ngày, làm đủ / quá chuẩn)', () => {
  const U1 = UNITS[0];
  const c = computeCheckout(ca(480, U1), iso('06:00'), iso('06:00', 480), WD, {});
  assert.equal(c.work_unit, 1);
  assert.equal(computeCheckout(ca(480, U1), iso('06:00'), iso('06:00', 420), WD, {}).work_unit, 0.87);   // 420/480 = 0,875 → lùi 0,87
  assert.equal(computeCheckout(ca(480, U1), iso('06:00'), iso('06:00', 420), WD, { roundingMode: 1 }).work_unit, 0.88);   // tới 0,88
  assert.equal(noShiftUnit(6), 0.01);
  assert.equal(noShiftUnit(240), 0.5);
});
