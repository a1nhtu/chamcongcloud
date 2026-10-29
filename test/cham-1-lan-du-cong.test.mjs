// Test tùy chọn CA "Khi chỉ chấm 1 lần (thiếu giờ ra)" (shifts.no_out_credit):
//   0 = không tính công (mặc định) · 1 = tính đủ công, trừ phần đi trễ (kiểu cũ) · 2 = CÓ MẶT LÀ TÍNH ĐỦ CÔNG (mới)
// Kiểu 2: chỉ có giờ vào HOẶC chỉ có giờ ra → đủ công của ca, không đi muộn / về sớm / tăng ca;
// ngày nghỉ đi làm tính tăng ca → không tính gì; báo cáo hiện "Đủ công" (không phải "Thiếu ra").
// Kiểu 0 / 1 phải tính y như cũ.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeDayMetrics } from '../server/day-metrics.js';

const iso = (d, hm) => new Date(`${d}T${hm}:00+07:00`).toISOString();
const WD = '2026-01-05'; // Thứ Hai
const SUN = '2026-01-04'; // Chủ Nhật
const base = {
  id: 7, start_time: '08:00', end_time: '17:00', break_minutes: 60,
  late_grace_min: 5, early_grace_min: 15, work_unit_value: 1.0,
  allow_ot: 1, ot_start_after_min: 30,
};
const sh = (mode, over = {}) => ({ ...base, no_out_credit: mode, ...over });
const ctx = (over = {}) => ({ weekend: '7', roundingDecimals: 2, roundingMode: 0, hourly: false, isHoliday: () => false, ...over });
const pick = (m) => ({ late: m.late, early: m.early_min, ot: m.ot_min, wm: m.work_minutes, wu: m.work_unit, st: m.day_status });

test('kiểu 2: chỉ chấm vào (kể cả vào muộn) → đủ công, không đi muộn', () => {
  for (const t of ['07:55', '08:20', '10:00', '17:05']) {
    assert.deepEqual(pick(computeDayMetrics(ctx(), sh(2), WD, iso(WD, t), null)), { late: 0, early: 0, ot: 0, wm: 480, wu: 1, st: 'mot_lan' }, t);
  }
});

test('kiểu 2: chỉ có giờ ra → đủ công', () => {
  assert.deepEqual(pick(computeDayMetrics(ctx(), sh(2), WD, null, iso(WD, '17:10'))), { late: 0, early: 0, ot: 0, wm: 480, wu: 1, st: 'mot_lan' });
});

test('kiểu 2: ca nửa công → đủ 0,5 công', () => {
  const m = computeDayMetrics(ctx(), sh(2, { end_time: '12:00', break_minutes: 0, work_unit_value: 0.5 }), WD, iso(WD, '08:30'), null);
  assert.equal(m.work_unit, 0.5); assert.equal(m.work_minutes, 240); assert.equal(m.late, 0);
});

test('kiểu 2: đủ vào + ra (muộn / về sớm) → vẫn đủ công, không trừ; ở lại sau ca vẫn có tăng ca', () => {
  const one = (i, o) => pick(computeDayMetrics(ctx(), sh(2), WD, iso(WD, i), iso(WD, o)));
  assert.deepEqual(one('08:20', '10:06'), { late: 0, early: 0, ot: 0, wm: 480, wu: 1, st: 'lam_viec' });
  assert.deepEqual(one('09:00', '15:00'), { late: 0, early: 0, ot: 0, wm: 480, wu: 1, st: 'lam_viec' });
  assert.deepEqual(one('08:00', '18:30'), { late: 0, early: 0, ot: 90, wm: 480, wu: 1, st: 'lam_viec' });
  // chủ nhật đi làm tính tăng ca: tăng ca theo giờ làm THỰC (08–12 = 4 tiếng), không phải đủ ca
  const sun = computeDayMetrics(ctx({ weekendOt: true }), sh(2), SUN, iso(SUN, '08:00'), iso(SUN, '12:00'));
  assert.deepEqual([sun.work_unit, sun.ot_min, sun.ot_type], [0, 240, 'cuoi_tuan']);
  assert.deepEqual(sun, computeDayMetrics(ctx({ weekendOt: true }), sh(0), SUN, iso(SUN, '08:00'), iso(SUN, '12:00')));
});

test('kiểu 2: ngày nghỉ đi làm tính tăng ca → chấm 1 lần không tính tăng ca, không tính công', () => {
  const m = computeDayMetrics(ctx({ weekendOt: true }), sh(2), SUN, iso(SUN, '08:00'), null);
  assert.deepEqual(pick(m), { late: 0, early: 0, ot: 0, wm: 0, wu: 0, st: 'thieu_ra' });
  assert.equal(m.ot_raw, 0);
  // ca tăng ca / ngày lễ ca tính cả ca là tăng ca → cũng không tính
  assert.equal(computeDayMetrics(ctx(), sh(2, { shift_as_ot: 1 }), WD, iso(WD, '08:00'), null).ot_min, 0);
  assert.equal(computeDayMetrics(ctx({ isHoliday: () => true }), sh(2, { holiday_as_ot: 1 }), WD, iso(WD, '08:00'), null).ot_min, 0);
});

test('kiểu 2: chủ nhật KHÔNG tính tăng ca (cài đặt tắt) → đủ công như ngày thường', () => {
  const m = computeDayMetrics(ctx({ weekendOt: false }), sh(2), SUN, iso(SUN, '08:00'), null);
  assert.equal(m.work_unit, 1); assert.equal(m.ot_min, 0); assert.equal(m.day_status, 'mot_lan');
});

test('kiểu 1 (cũ): chỉ chấm vào muộn → đủ công TRỪ đi muộn, vẫn "Thiếu ra" — như cũ', () => {
  const m = computeDayMetrics(ctx(), sh(1), WD, iso(WD, '08:20'), null);
  assert.deepEqual(pick(m), { late: 20, early: 0, ot: 0, wm: 460, wu: 0.95, st: 'thieu_ra' });
  assert.equal(computeDayMetrics(ctx(), sh(1), WD, null, iso(WD, '17:00')).day_status, 'vang');   // chỉ giờ ra: vẫn vắng
});

test('kiểu 0 (mặc định): chỉ chấm vào → 0 công, Thiếu ra; chỉ giờ ra → vắng — như cũ', () => {
  for (const mode of [0, undefined, null]) {
    assert.deepEqual(pick(computeDayMetrics(ctx(), sh(mode), WD, iso(WD, '08:20'), null)), { late: 20, early: 0, ot: 0, wm: 0, wu: 0, st: 'thieu_ra' });
    assert.equal(computeDayMetrics(ctx(), sh(mode), WD, null, iso(WD, '17:00')).day_status, 'vang');
  }
});

/* ============ Qua CSDL thật: máy chấm công, sửa tay, Tính lại, báo cáo, bất thường ============ */
const dir = mkdtempSync(join(tmpdir(), 'dgp-1lan-'));
let db, srv, url, tok, E2, E0;
const D = '2026-09-07';   // Thứ Hai
const call = async (m, p, b) => {
  const x = await fetch(url + p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  return { status: x.status, body: await x.json() };
};
const rowOf = (eid, d = D) => db.prepare('SELECT * FROM attendance WHERE employee_id=? AND work_date=?').get(eid, d);

before(async () => {
  process.env.DB_PATH = join(dir, 'test.db');
  let initSchema;
  ({ db, initSchema } = await import('../server/db.js'));
  initSchema();
  const express = (await import('express')).default;
  const { registerAttendanceRoutes } = await import('../server/routes/admin/attendance.js');
  const { registerOrgRoutes } = await import('../server/routes/admin/org.js');
  const reportRoutes = (await import('../server/routes/reports.js')).default;
  const otReg = await import('../server/routes/admin/ot-reg.js');
  const s2 = Number(db.prepare("INSERT INTO shifts(name, code, start_time, end_time, break_minutes, work_unit_value, late_grace_min, no_out_credit) VALUES ('HC1','HC1','08:00','17:00',60,1,5,2)").run().lastInsertRowid);
  const s0 = Number(db.prepare("INSERT INTO shifts(name, code, start_time, end_time, break_minutes, work_unit_value, late_grace_min) VALUES ('HC0','HC0','08:00','17:00',60,1,5)").run().lastInsertRowid);
  const addEmp = (code, sid) => Number(db.prepare("INSERT INTO employees(code, username, password_hash, full_name, role, active, shift_id, device_pin, start_date) VALUES (?,?,'x',?,'employee',1,?,?,'2026-01-01')").run(code, code.toLowerCase(), 'NV ' + code, sid, code).lastInsertRowid);
  E2 = addEmp('A2', s2); E0 = addEmp('A0', s0);
  const adm = Number(db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash) VALUES ('ADM','Admin','admin','adm','x')").run().lastInsertRowid);
  tok = (await import('../server/auth.js')).signToken({ id: adm, code: 'ADM', role: 'admin', full_name: 'Admin' });
  const app = express(); app.use(express.json());
  app.use((q, s, n) => { q.user = { id: 1, full_name: 'QL', role: 'admin' }; n(); });
  const r = express.Router(); const need = () => (q, s, n) => n();
  registerAttendanceRoutes(r, { need }); registerOrgRoutes(r, { need });
  for (const k of Object.keys(otReg)) if (/^register/.test(k)) otReg[k](r, { need });
  app.use('/admin', r); app.use('/reports', reportRoutes);
  srv = app.listen(0); url = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { srv?.close(); try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} });

test('máy chấm công: quẹt 1 lần → kiểu 2 đủ công, kiểu 0 thiếu ra 0 công', async () => {
  const { rebuildDay } = await import('../server/device-sync.js');
  const pun = db.prepare("INSERT INTO device_punches(serial, pin, punch_at, work_date, status, verify, employee_id) VALUES ('MAY1',?,?,?,0,1,?)");
  pun.run('A2', iso(D, '08:25'), D, E2); pun.run('A0', iso(D, '08:25'), D, E0);
  rebuildDay(E2, D); rebuildDay(E0, D);
  const a2 = rowOf(E2), a0 = rowOf(E0);
  assert.deepEqual([a2.work_unit, a2.late_min, a2.day_status, a2.check_out_at], [1, 0, 'mot_lan', null]);
  assert.deepEqual([a0.work_unit, a0.late_min, a0.day_status], [0, 25, 'thieu_ra']);
});

test('báo cáo + danh sách bất thường: kiểu 2 hiện Đủ công (X), kiểu 0 vẫn Thiếu ra (O)', async () => {
  const q = `from=${D}&to=${D}`;
  const rep = async (type) => (await fetch(`${url}/reports/data?type=${type}&${q}`, { headers: { Authorization: 'Bearer ' + tok } })).json();
  const sym = await rep('symbol');
  const symOf = (code) => sym.rows.find((x) => x.code === code);
  assert.equal(symOf('A2')['d' + D], 'X');
  assert.equal(symOf('A0')['d' + D], 'O');
  const det = await rep('detail');
  const st = (name) => det.rows.find((x) => x.name === name).status;
  assert.equal(st('NV A2'), 'Đủ công'); assert.equal(st('NV A0'), 'Thiếu ra');
  const abn = (await call('GET', `/admin/abnormal?${q}`)).body;
  const noOut = abn.rows.filter((x) => x.kinds.includes('no_out')).map((x) => x.code);
  assert.deepEqual(noOut, ['A0']);
});

test('Tính lại: dòng cũ 0 công của ca kiểu 2 → thành đủ công; ca kiểu 0 giữ nguyên', async () => {
  const D2 = '2026-09-08';
  const ins = db.prepare("INSERT INTO attendance(employee_id, work_date, check_in_at, late_min, work_unit, work_minutes, day_status) VALUES (?,?,?,25,0,0,'thieu_ra')");
  ins.run(E2, D2, iso(D2, '08:25')); ins.run(E0, D2, iso(D2, '08:25'));
  assert.equal((await call('POST', `/admin/recompute?month=2026-09`)).status, 200);
  const a2 = rowOf(E2, D2), a0 = rowOf(E0, D2);
  assert.deepEqual([a2.work_unit, a2.late_min, a2.day_status], [1, 0, 'mot_lan']);
  assert.deepEqual([a0.work_unit, a0.late_min, a0.day_status], [0, 25, 'thieu_ra']);
});

test('sửa tay chỉ nhập giờ ra → kiểu 2 đủ công', async () => {
  const D3 = '2026-09-09';
  assert.equal((await call('POST', '/admin/attendance', { employee_id: E2, work_date: D3, check_out: '17:05' })).status, 200);
  const a = rowOf(E2, D3);
  assert.deepEqual([a.work_unit, a.day_status, a.check_in_at], [1, 'mot_lan', null]);
});

test('form Ca: lưu được 3 lựa chọn 0 / 1 / 2 (bản giao diện cũ gửi true/false vẫn đúng)', async () => {
  const s = db.prepare("SELECT * FROM shifts WHERE code='HC0'").get();
  const save = async (v) => { assert.equal((await call('PUT', '/admin/shifts/' + s.id, { ...s, no_out_credit: v })).status, 200); return db.prepare('SELECT no_out_credit v FROM shifts WHERE id=?').get(s.id).v; };
  assert.equal(await save(2), 2); assert.equal(await save(1), 1); assert.equal(await save(0), 0);
  assert.equal(await save(true), 1); assert.equal(await save(false), 0);
});
