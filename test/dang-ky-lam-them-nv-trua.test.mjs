// ĐĂNG KÝ LÀM THÊM — 2 công tắc mới (đều mặc định TẮT, tắt = chạy y như cũ):
//  · ot_self_reg  "Nhân viên tự đăng ký làm thêm trên app": NV gửi đơn (ngày, từ giờ → đến giờ, lý do), quản lý duyệt mới ghi vào đăng ký.
//  · ot_lunch_reg "Đăng ký tăng ca trưa theo giờ": tăng ca trưa = phần khung đã đăng ký (VD 11:30–13:30) nằm trong giờ nghỉ giữa ca,
//    trong khoảng giờ vào đầu → giờ ra cuối, CỘNG THÊM vào tăng ca được tính. CHỈ xét có đăng ký hay không — lượt quẹt giờ trưa
//    (ra trưa · vào chiều) không xét: NV ngày nào cũng quẹt 4 lần (Anh chốt 22/11/2026, khách Thép Hòn Gai).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { moCong } from './_cong.mjs';

const dir = mkdtempSync(join(tmpdir(), 'dgp-otnv-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema, setSetting, getSetting } = await import('../server/db.js');
const { signToken } = await import('../server/auth.js');
const { lunchOtMinutes, dayLunchOt } = await import('../server/attendance-calc.js');
const { computeDayMetrics, payrollCtx } = await import('../server/day-metrics.js');
const { otRegCapper } = await import('../server/ot-cap.js');
const { syncOtReg, normHm, hmSpan } = await import('../server/ot-reg.js');
const express = (await import('express')).default;

const iso = (d, hm) => new Date(`${d}T${hm}:00+07:00`).toISOString();
const WD = '2026-11-16';   // Thứ Hai
// ca 07:30–17:30, nghỉ trưa cố định 11:30–13:30 (120')
const HC = { id: 1, name: 'HC', start_time: '07:30', end_time: '17:30', break_minutes: 120, break_start: '11:30', late_grace_min: 0, early_grace_min: 0,
  work_unit_value: 1, allow_ot: 1, ot_start_after_min: 30, ot_rounding_unit: 0, break_ot: 0 };

test('normHm / hmSpan', () => {
  assert.equal(normHm('7:30'), '07:30'); assert.equal(normHm('1130'), '11:30'); assert.equal(normHm('17'), '17:00');
  assert.equal(normHm(''), ''); assert.equal(normHm('25:00'), null); assert.equal(normHm('ab'), null);
  assert.equal(hmSpan('11:30', '13:30'), 120); assert.equal(hmSpan('22:00', '01:00'), 180); assert.equal(hmSpan('08:00', '08:00'), 0);
});

test('lunchOtMinutes: khung đăng ký ∩ giờ nghỉ ∩ [vào đầu, ra cuối] — lượt quẹt trưa không xét', () => {
  const L = (inn, out, f, t, sh = HC) => lunchOtMinutes(sh, WD, iso(WD, inn), iso(WD, out), f, t);
  assert.equal(L('07:30', '17:30', '11:30', '13:30'), 120);                    // quẹt 2 lần, đăng ký đúng giờ nghỉ → 120'
  assert.equal(L('07:30', '17:30', '12:00', '13:00'), 60);                     // đăng ký 1 tiếng giữa giờ nghỉ
  assert.equal(L('07:30', '17:30', '11:00', '14:00'), 120);                    // khung rộng hơn giờ nghỉ: phần trùng giờ làm không tính 2 lần
  assert.equal(L('07:30', '12:30', '11:30', '13:30'), 60);                     // về lúc 12:30 → có mặt 60'
  assert.equal(L('12:00', '17:30', '11:30', '13:30'), 90);                     // vào lúc 12:00 → 90'
  assert.equal(L('07:10', '17:05', '11:30', '12:00'), 30);                     // ví dụ của Anh: 07:10 · 11:32 · 12:58 · 17:05, đăng ký 11:30–12:00
  assert.equal(L('07:10', '17:05', '11:30', '12:30'), 60);                     //   … đăng ký 11:30–12:30
  assert.equal(L('07:30', '17:30', '07:00', '14:00'), 120);                    // khung bắt đầu trước giờ vào ca (ca ngày) vẫn là của hôm nay
  assert.equal(L('07:30', '17:30', '11:30', '13:30', { ...HC, allow_ot: 0 }), 0);            // ca không cho tăng ca
  assert.equal(L('07:30', '17:30', '11:30', '13:30', { ...HC, break_start: '' }), 0);        // ca không khai giờ bắt đầu nghỉ
  assert.equal(L('07:30', '17:30', '18:00', '19:00'), 0);                      // khung ngoài giờ nghỉ → không phải tăng ca trưa
  assert.equal(L('07:30', '17:30', '11:30', '11:30'), 0);
  // ca đêm 19:00–03:00 nghỉ 00:00–01:00: khung 00:00–01:00 là của rạng sáng hôm sau
  const D = { ...HC, start_time: '19:00', end_time: '03:00', break_start: '00:00', break_minutes: 60, cross_midnight: 1 };
  assert.equal(lunchOtMinutes(D, WD, iso(WD, '19:00'), iso('2026-11-17', '03:00'), '00:00', '01:00'), 60);
});

test('dayLunchOt: ngày tách ca Sáng + Chiều (không có giờ nghỉ) → khoảng giữa 2 ca, cộng vào dòng ca chiều', () => {
  const S = { start_time: '07:15', end_time: '11:30', allow_ot: 0 }, C = { start_time: '13:00', end_time: '17:00', allow_ot: 1 };
  const rows = [{ shift: S, inIso: iso(WD, '07:10'), outIso: iso(WD, '11:32') }, { shift: C, inIso: iso(WD, '12:58'), outIso: iso(WD, '17:05') }];
  assert.deepEqual(dayLunchOt(rows, WD, '11:30', '12:00'), [0, 30]);
  assert.deepEqual(dayLunchOt(rows, WD, '11:30', '12:30'), [0, 60]);
  assert.deepEqual(dayLunchOt(rows, WD, '11:00', '14:00'), [0, 90]);           // phần trùng giờ làm của 2 ca không tính 2 lần
  assert.deepEqual(dayLunchOt(rows, WD, '', ''), [0, 0]);
  assert.deepEqual(dayLunchOt([rows[0], { ...rows[1], shift: { ...C, allow_ot: 0 } }], WD, '11:30', '12:30'), [0, 0]);   // 2 ca không cho tăng ca
  assert.deepEqual(dayLunchOt([{ ...rows[0], shift: { ...S, allow_ot: 1 } }, { ...rows[1], shift: { ...C, allow_ot: 0 } }], WD, '11:30', '12:30'), [60, 0]);
  assert.deepEqual(dayLunchOt([rows[0], null], WD, '11:30', '12:30'), [0, 0]);   // chỉ làm buổi sáng
  assert.deepEqual(dayLunchOt([rows[0]], WD, '11:30', '12:30'), [0]);
  // 1 dòng ca có giờ nghỉ: như lunchOtMinutes
  assert.deepEqual(dayLunchOt([{ shift: HC, inIso: iso(WD, '07:10'), outIso: iso(WD, '17:05') }], WD, '11:30', '12:30'), [60]);
});

// ---- computeDayMetrics: ctx giả ----
const fakeDb = (regs) => ({ prepare: () => ({ get: (e, d) => (`${e}|${d}` in regs ? { minutes: regs[`${e}|${d}`] } : undefined) }) });
const ctxOf = (regs, { required = false, lunch = null } = {}) => ({
  weekend: '7', roundingDecimals: 2, roundingMode: 0, hourly: false, isHoliday: () => false,
  otRound: { decimals: 2, mode: 0, block: 0 },
  otReg: otRegCapper(fakeDb(regs), (k, d) => (k === 'ot_reg_required' ? (required ? '1' : '0') : d)),
  otLunch: lunch,
});
const day = (c, sh, inn, out) => computeDayMetrics(c, sh, WD, iso(WD, inn), iso(WD, out), null, { empId: 5 });

test('công tắc trưa TẮT (otLunch null) → y như cũ, kể cả ca bật break_ot', () => {
  const sh = { ...HC, break_ot: 1 };
  assert.equal(day(ctxOf({ [`5|${WD}`]: 240 }), sh, '07:30', '19:30').ot_min, 240);   // 2h tối + 2h trưa bù đăng ký 4h (cách cũ)
  assert.equal(day(ctxOf({}), HC, '07:30', '19:30').ot_min, 120);
});

test('công tắc trưa BẬT: tăng ca trưa theo khung giờ cộng thêm; giờ nghỉ không còn bù số phút', () => {
  const lunch120 = () => 120, lunch0 = () => 0;
  const sh = { ...HC, break_ot: 1 };
  let m = day(ctxOf({ [`5|${WD}`]: 60 }, { lunch: lunch120 }), sh, '07:30', '19:30');   // tối 2h, đăng ký 1h → 60 + trưa 120
  assert.equal(m.ot_min, 180); assert.equal(m.ot_raw, 120); assert.equal(m.work_minutes, 480);
  m = day(ctxOf({ [`5|${WD}`]: 240 }, { lunch: lunch0 }), sh, '07:30', '19:30');        // không đăng ký trưa → giờ nghỉ KHÔNG bù đăng ký 4h
  assert.equal(m.ot_min, 120);
  m = day(ctxOf({}, { required: true, lunch: lunch120 }), HC, '07:30', '17:30');         // bắt buộc đăng ký, chỉ đăng ký trưa → 120
  assert.equal(m.ot_min, 120); assert.equal(m.ot_raw, 0);
  m = day(ctxOf({}, { required: true, lunch: lunch120 }), HC, '07:30', '19:30');         // tối không đăng ký → 0, trưa 120
  assert.equal(m.ot_min, 120);
});

// ---- CSDL thật: payrollCtx + syncOtReg + API ----
// ngày thử tính theo HÔM NAY (đơn NV chỉ nhận 31 ngày trước → 93 ngày tới), đều là ngày thường T2–T6
const addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const TODAY = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const MON = (() => { let d = addD(TODAY, -7); while (new Date(d + 'T12:00:00Z').getUTCDay() !== 1) d = addD(d, -1); return d; })();
const DAY = { a: addD(MON, 2), b: addD(MON, 3), c: addD(MON, 4), d: addD(MON, 7), e: addD(MON, 8), f: addD(MON, 9) };
const ins = (t, o) => { const k = Object.keys(o); return Number(db.prepare(`INSERT INTO ${t}(${k.join(',')}) VALUES(${k.map(() => '?').join(',')})`).run(...k.map((x) => o[x])).lastInsertRowid); };
let EMP, ADMIN, SH, srv, base;
const tok = (id) => 'Bearer ' + signToken(db.prepare('SELECT * FROM employees WHERE id=?').get(id));
const call = async (method, path, who, body) => {
  const x = await fetch(base + path, { method, headers: { 'content-type': 'application/json', Authorization: tok(who) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await x.json(); } catch {}
  return { status: x.status, body: j };
};
const addAtt = (d, inn, out, ot) => ins('attendance', { employee_id: EMP, work_date: d, shift_id: SH, check_in_at: iso(d, inn), check_out_at: iso(d, out),
  work_minutes: 480, work_unit: 1, ot_min: ot, ot_raw_min: ot, day_status: 'lam_viec', ot_type: 'thuong' });
const otOf = (id) => db.prepare('SELECT ot_min FROM attendance WHERE id=?').get(id).ot_min;

before(async () => {
  initSchema();
  setSetting('attendance_mode', 'shift');
  SH = ins('shifts', { name: 'HC', code: 'HC7', start_time: '07:30', end_time: '17:30', break_minutes: 120, break_start: '11:30', allow_ot: 1, ot_start_after_min: 30, work_unit_value: 1 });
  EMP = ins('employees', { code: 'NV1', full_name: 'Nguyễn Văn Một', username: 'nv1', password_hash: 'x', role: 'employee', active: 1, att_mode: 'shift' });
  ADMIN = ins('employees', { code: 'AD', full_name: 'Quản Lý', username: 'ad', password_hash: 'x', role: 'admin', active: 1 });
  ins('shift_assignments', { employee_id: EMP, mode: 'shift', shift_id: SH, from_date: '2026-01-01', shift_type: 'fixed', merge_rule: 'default', active: 1 });
  const app = express(); app.use(express.json({ limit: '2mb' }));
  app.use('/api/admin', (await import('../server/routes/admin.js')).default);
  app.use('/api/ot-requests', (await import('../server/routes/ot-requests.js')).default);
  app.use((err, req, res, next) => { res.status(500).json({ error: 'LOI 500: ' + err.message }); });   // eslint-disable-line no-unused-vars
  srv = await moCong(app); base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { srv?.close(); try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} });

test('mặc định 2 công tắc TẮT; payrollCtx.otLunch = null', () => {
  assert.equal(getSetting('ot_self_reg', '0'), '0'); assert.equal(getSetting('ot_lunch_reg', '0'), '0');
  assert.equal(payrollCtx(getSetting, db).otLunch, null);
});

test('NV gửi đơn khi công tắc TẮT → 403; info enabled=false', async () => {
  assert.equal((await call('GET', '/api/ot-requests/info', EMP)).body.enabled, false);
  const r = await call('POST', '/api/ot-requests', EMP, { work_date: DAY.a, from_hm: '17:30', to_hm: '19:30' });
  assert.equal(r.status, 403);
});

test('bật công tắc qua API (chỉ khoá gửi lên, không đụng "Phải đăng ký")', async () => {
  setSetting('ot_reg_required', '1');
  const r = await call('PUT', '/api/admin/ot-reg/settings', ADMIN, { self: true, lunch: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.self, r.body.lunch, r.body.required], [true, true, true]);
  setSetting('ot_reg_required', '0');
});

test('NV gửi đơn làm thêm + tăng ca trưa, quản lý duyệt → ghi đăng ký, áp ngay vào công', async () => {
  const D = DAY.a;
  const a = addAtt(D, '07:30', '19:30', 120);   // tối 2h, quẹt 2 lần (có mặt trưa)
  const info = await call('GET', `/api/ot-requests/info?date=${D}`, EMP);
  assert.equal(info.body.enabled, true); assert.equal(info.body.lunch, true);
  assert.deepEqual([info.body.suggest.ot_from, info.body.suggest.lunch_from, info.body.suggest.lunch_to], ['17:30', '11:30', '13:30']);
  const r1 = await call('POST', '/api/ot-requests', EMP, { work_date: D, kind: 'ot', from_hm: '17:30', to_hm: '18:30', reason: 'Hàng gấp' });
  assert.equal(r1.status, 200, JSON.stringify(r1.body)); assert.equal(r1.body.request.minutes, 60);
  const r2 = await call('POST', '/api/ot-requests', EMP, { work_date: D, kind: 'lunch', from_hm: '11:30', to_hm: '13:30' });
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  // trùng giờ / tăng ca trưa thứ 2 cùng ngày → không nhận
  assert.equal((await call('POST', '/api/ot-requests', EMP, { work_date: D, kind: 'ot', from_hm: '18:00', to_hm: '19:00' })).status, 400);
  assert.equal((await call('POST', '/api/ot-requests', EMP, { work_date: D, kind: 'lunch', from_hm: '12:00', to_hm: '13:00' })).status, 400);
  // chưa duyệt → công chưa đổi
  assert.equal(otOf(a), 120);
  const list = await call('GET', '/api/admin/ot-reg/requests', ADMIN);
  assert.equal(list.body.rows.length, 2);
  const rv = await call('POST', '/api/admin/ot-reg/requests/review', ADMIN, { ids: list.body.rows.map((x) => x.id), action: 'approve' });
  assert.equal(rv.status, 200, JSON.stringify(rv.body)); assert.equal(rv.body.done, 2);
  assert.equal(db.prepare('SELECT minutes FROM ot_registrations WHERE employee_id=? AND work_date=?').get(EMP, D).minutes, 60);
  assert.deepEqual({ ...db.prepare('SELECT from_hm, to_hm FROM ot_lunch_reg WHERE employee_id=? AND work_date=?').get(EMP, D) }, { from_hm: '11:30', to_hm: '13:30' });
  assert.equal(otOf(a), 60 + 120);   // tối chặn theo đăng ký 60' + trưa 120'
  // duyệt lại đơn đã duyệt → bỏ qua
  assert.equal((await call('POST', '/api/admin/ot-reg/requests/review', ADMIN, { ids: [r1.body.request.id], action: 'reject' })).body.skipped, 1);
  // đơn làm thêm thứ 2 cùng ngày (không trùng giờ) → CỘNG DỒN
  const r3 = await call('POST', '/api/ot-requests', EMP, { work_date: D, kind: 'ot', from_hm: '18:30', to_hm: '19:00' });
  await call('POST', '/api/admin/ot-reg/requests/review', ADMIN, { ids: [r3.body.request.id], action: 'approve' });
  assert.equal(db.prepare('SELECT minutes FROM ot_registrations WHERE employee_id=? AND work_date=?').get(EMP, D).minutes, 90);
  assert.equal(otOf(a), 90 + 120);
});

test('từ chối đơn → không ghi đăng ký; NV huỷ được đơn còn chờ, không huỷ được đơn đã xử lý', async () => {
  const D = DAY.b;
  const r = await call('POST', '/api/ot-requests', EMP, { work_date: D, from_hm: '17:30', to_hm: '20:00' });
  await call('POST', '/api/admin/ot-reg/requests/review', ADMIN, { ids: [r.body.request.id], action: 'reject', note: 'Không cần' });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ot_registrations WHERE employee_id=? AND work_date=?').get(EMP, D).c, 0);
  assert.equal((await call('DELETE', '/api/ot-requests/' + r.body.request.id, EMP)).status, 400);
  const r2 = await call('POST', '/api/ot-requests', EMP, { work_date: D, from_hm: '17:30', to_hm: '20:00' });   // gửi lại được (đơn cũ đã từ chối)
  assert.equal(r2.status, 200);
  assert.equal((await call('DELETE', '/api/ot-requests/' + r2.body.request.id, EMP)).status, 200);
  const mine = await call('GET', '/api/ot-requests/mine', EMP);
  assert.ok(mine.body.rows.some((x) => x.status === 'rejected' && x.review_note === 'Không cần'));
});

test('quẹt 4 lần (ra trưa · vào chiều) + đã đăng ký trưa → vẫn tính đủ khung đăng ký', () => {
  const D = DAY.c;
  const a = addAtt(D, '07:30', '17:30', 0);
  for (const h of ['07:30', '11:30', '13:30', '17:30']) ins('device_punches', { serial: 'M1', pin: '1', punch_at: iso(D, h), work_date: D, status: 0, verify: 1, employee_id: EMP });
  ins('ot_lunch_reg', { employee_id: EMP, work_date: D, from_hm: '11:30', to_hm: '13:30' });
  syncOtReg([EMP], D, D);
  assert.equal(otOf(a), 120);
  // payrollCtx (tính lại công) cho cùng kết quả
  const m = computeDayMetrics(payrollCtx(getSetting, db), { ...HC, id: SH }, D, iso(D, '07:30'), iso(D, '17:30'), null, { empId: EMP });
  assert.equal(m.ot_min, 120);
});

test('áp nhanh khung tăng ca trưa cho nhiều ngày, xoá bằng ô trống', async () => {
  const a = addAtt(DAY.d, '07:30', '17:30', 0), b = addAtt(DAY.e, '07:30', '17:30', 0);
  let r = await call('POST', '/api/admin/ot-reg/apply', ADMIN, { kind: 'lunch', from_hm: '12:00', to_hm: '13:30', employee_ids: [EMP], from: DAY.d, to: DAY.e });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(otOf(a), 90); assert.equal(otOf(b), 90);
  r = await call('POST', '/api/admin/ot-reg/apply', ADMIN, { kind: 'lunch', from_hm: '', to_hm: '', employee_ids: [EMP], from: DAY.e, to: DAY.e });
  assert.equal(otOf(a), 90); assert.equal(otOf(b), 0);
  assert.equal((await call('POST', '/api/admin/ot-reg/apply', ADMIN, { kind: 'lunch', from_hm: '12:00', to_hm: '', employee_ids: [EMP], from: DAY.e, to: DAY.e })).status, 400);
  const g = await call('GET', `/api/admin/ot-reg?from=${MON}&to=${addD(MON, 13)}`, ADMIN);
  assert.equal(g.body.lunchOn, true); assert.equal(g.body.selfOn, true);
  assert.ok(g.body.lunch.some(([e, d, f, t]) => e === EMP && d === DAY.d && f === '12:00' && t === '13:30'));
});

test('TẮT công tắc trưa → tăng ca trưa theo giờ bỏ khỏi công (về cách cũ)', async () => {
  const before = otOf(db.prepare("SELECT id FROM attendance WHERE employee_id=? AND work_date=?").get(EMP, DAY.d).id);
  assert.equal(before, 90);
  const r = await call('PUT', '/api/admin/ot-reg/settings', ADMIN, { lunch: false });
  assert.equal(r.body.lunch, false); assert.ok(r.body.changed >= 1);
  assert.equal(otOf(db.prepare("SELECT id FROM attendance WHERE employee_id=? AND work_date=?").get(EMP, DAY.d).id), 0);
  assert.equal(otOf(db.prepare("SELECT id FROM attendance WHERE employee_id=? AND work_date=?").get(EMP, DAY.a).id), 90);   // còn phần tối theo đăng ký
  // NV không gửi được tăng ca trưa nữa
  assert.equal((await call('POST', '/api/ot-requests', EMP, { work_date: DAY.f, kind: 'lunch', from_hm: '11:30', to_hm: '13:30' })).status, 400);
});
