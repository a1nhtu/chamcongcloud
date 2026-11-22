// Test ô CA "Quy đổi giờ công (%)" (shifts.work_pct) — khách thephongai:
// ca Sáng CN 07:30–11:30 (0,5 công) đặt 115% → làm đủ 4 giờ ghi 4,6 giờ (276 phút), công 0,5 × 1,15.
// Giờ trong ca đổi thành tăng ca (cuối tuần / ca tăng ca) cũng theo số đã nhân; tăng ca NGOÀI giờ ca giữ nguyên.
// Để 100 (mặc định) / không có cột = tính y như cũ.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeDayMetrics } from '../server/day-metrics.js';
import { workPctFactor } from '../server/attendance-calc.js';
import { moCong } from './_cong.mjs';

const iso = (d, hm) => new Date(`${d}T${hm}:00+07:00`).toISOString();
const SUN = '2026-11-22';   // Chủ Nhật
const MON = '2026-11-23';
const SCN = {
  id: 5, start_time: '07:30', end_time: '11:30', break_minutes: 0,
  late_grace_min: 0, early_grace_min: 0, work_unit_value: 0.5, allow_ot: 0, work_pct: 115,
};
const ctx = (over = {}) => ({ weekend: '7', roundingDecimals: 2, roundingMode: 0, hourly: false, isHoliday: () => false, ...over });
const pick = (m) => ({ wm: m.work_minutes, wu: m.work_unit, ot: m.ot_min, type: m.ot_type });

test('hệ số: 100 / trống / sai = 1 (như cũ), 115 = 1,15', () => {
  for (const v of [100, undefined, null, '', 0, -5, 'abc']) assert.equal(workPctFactor({ work_pct: v }), 1, String(v));
  assert.equal(workPctFactor({ work_pct: 115 }), 1.15);
  assert.equal(workPctFactor(null), 1);
});

test('CN tính như ngày thường: làm đủ 4 giờ → 4,6 giờ công, công 0,5 × 1,15', () => {
  const m = computeDayMetrics(ctx({ weekendOt: false }), SCN, SUN, iso(SUN, '07:30'), iso(SUN, '11:30'));
  assert.deepEqual(pick(m), { wm: 276, wu: 0.57, ot: 0, type: 'cuoi_tuan' });   // 0,575 làm tròn lùi 2 số lẻ (Cài đặt mặc định)
  assert.equal(computeDayMetrics(ctx({ weekendOt: false, roundingDecimals: 3 }), SCN, SUN, iso(SUN, '07:30'), iso(SUN, '11:30')).work_unit, 0.575);
  assert.equal(computeDayMetrics(ctx({ weekendOt: false, roundingMode: 2 }), SCN, SUN, iso(SUN, '07:30'), iso(SUN, '11:30')).work_unit, 0.58);
});

test('CN tính là tăng ca (mặc định): 4 giờ → 4,6 giờ tăng ca cuối tuần, 0 công', () => {
  const m = computeDayMetrics(ctx({ weekendOt: true }), SCN, SUN, iso(SUN, '07:30'), iso(SUN, '11:30'));
  assert.deepEqual(pick(m), { wm: 0, wu: 0, ot: 276, type: 'cuoi_tuan' });
});

test('đi trễ / về sớm: nhân trên phần thực làm, đi trễ vẫn ghi đúng số phút', () => {
  const m = computeDayMetrics(ctx({ weekendOt: false }), SCN, SUN, iso(SUN, '07:45'), iso(SUN, '11:30'));
  assert.equal(m.late, 15);
  assert.equal(m.work_minutes, 259);   // 225 × 1,15 = 258,75
  const e = computeDayMetrics(ctx({ weekendOt: false }), SCN, SUN, iso(SUN, '07:30'), iso(SUN, '10:30'));
  assert.deepEqual([e.early_min, e.work_minutes], [60, 207]);   // 180 × 1,15
});

test('tăng ca SAU ca không nhân, giờ trong ca vẫn nhân', () => {
  const sh = { ...SCN, allow_ot: 1, ot_start_after_min: 30 };
  const m = computeDayMetrics(ctx({ weekendOt: false }), sh, MON, iso(MON, '07:30'), iso(MON, '12:30'));
  assert.deepEqual([m.work_minutes, m.ot_min], [276, 60]);
});

test('ca tăng ca (cả ca là tăng ca) cũng theo số đã nhân', () => {
  const m = computeDayMetrics(ctx({ weekendOt: false }), { ...SCN, shift_as_ot: 1 }, MON, iso(MON, '07:30'), iso(MON, '11:30'));
  assert.deepEqual([m.work_minutes, m.work_unit, m.ot_min], [0, 0, 276]);
});

test('"Có mặt là tính đủ công" và "thiếu giờ ra vẫn tính công" cũng nhân', () => {
  const one = computeDayMetrics(ctx({ weekendOt: false }), { ...SCN, no_out_credit: 2 }, MON, iso(MON, '07:40'), null);
  assert.deepEqual([one.work_minutes, one.work_unit, one.day_status], [276, 0.57, 'mot_lan']);
  const full = computeDayMetrics(ctx({ weekendOt: false }), { ...SCN, no_out_credit: 2 }, MON, iso(MON, '07:40'), iso(MON, '11:00'));
  assert.deepEqual([full.work_minutes, full.work_unit], [276, 0.57]);
  const noOut = computeDayMetrics(ctx({ weekendOt: false }), { ...SCN, no_out_credit: 1 }, MON, iso(MON, '07:30'), null);
  assert.deepEqual([noOut.work_minutes, noOut.day_status], [276, 'thieu_ra']);
});

test('để 100 hoặc ca cũ không có cột: y như trước', () => {
  for (const sh of [{ ...SCN, work_pct: 100 }, (({ work_pct, ...x }) => x)(SCN)]) {
    assert.deepEqual(pick(computeDayMetrics(ctx({ weekendOt: false }), sh, MON, iso(MON, '07:30'), iso(MON, '11:30'))), { wm: 240, wu: 0.5, ot: 0, type: 'thuong' });
    assert.deepEqual(pick(computeDayMetrics(ctx({ weekendOt: true }), sh, SUN, iso(SUN, '07:30'), iso(SUN, '11:30'))), { wm: 0, wu: 0, ot: 240, type: 'cuoi_tuan' });
  }
});

/* ============ Qua CSDL thật: lưu ca, máy chấm công, báo cáo ============ */
const dir = mkdtempSync(join(tmpdir(), 'dgp-quydoi-'));
let db, srv, url, tok, E, SID, setSetting;
const call = async (m, p, b) => {
  const x = await fetch(url + p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  return { status: x.status, body: await x.json() };
};
const rowOf = (d) => db.prepare('SELECT * FROM attendance WHERE employee_id=? AND work_date=?').get(E, d);

before(async () => {
  process.env.DB_PATH = join(dir, 'test.db');
  let initSchema;
  ({ db, initSchema, setSetting } = await import('../server/db.js'));
  initSchema();
  const express = (await import('express')).default;
  const { registerAttendanceRoutes } = await import('../server/routes/admin/attendance.js');
  const { registerOrgRoutes } = await import('../server/routes/admin/org.js');
  const reportRoutes = (await import('../server/routes/reports.js')).default;
  const adm = Number(db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash) VALUES ('ADM','Admin','admin','adm','x')").run().lastInsertRowid);
  tok = (await import('../server/auth.js')).signToken({ id: adm, code: 'ADM', role: 'admin', full_name: 'Admin' });
  const app = express(); app.use(express.json());
  app.use((q, s, n) => { q.user = { id: 1, full_name: 'QL', role: 'admin' }; n(); });
  const r = express.Router(); const need = () => (q, s, n) => n();
  registerAttendanceRoutes(r, { need }); registerOrgRoutes(r, { need });
  app.use('/admin', r); app.use('/reports', reportRoutes);
  srv = await moCong(app); url = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { srv?.close(); try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} });

test('form Ca: thêm ca có 115%, sửa trống / sai → 100, ca cũ mặc định 100', async () => {
  const c = await call('POST', '/admin/shifts', { name: 'Sáng CN', code: 'SCN', start_time: '07:30', end_time: '11:30', work_unit_value: 0.5, late_grace_min: 0, early_grace_min: 0, work_days: '7', work_pct: 115 });
  assert.equal(c.status, 200);
  SID = c.body.id;
  const pct = () => db.prepare('SELECT work_pct v FROM shifts WHERE id=?').get(SID).v;
  assert.equal(pct(), 115);
  const s = db.prepare('SELECT * FROM shifts WHERE id=?').get(SID);
  for (const [v, want] of [['', 100], ['abc', 100], [0, 100], [120.5, 120.5], [115, 115]]) {
    assert.equal((await call('PUT', '/admin/shifts/' + SID, { ...s, work_pct: v })).status, 200);
    assert.equal(pct(), want, String(v));
  }
  const old = Number(db.prepare("INSERT INTO shifts(name, start_time, end_time) VALUES ('Cũ','08:00','17:00')").run().lastInsertRowid);
  assert.equal(db.prepare('SELECT work_pct v FROM shifts WHERE id=?').get(old).v, 100);
});

test('máy chấm công ngày CN + báo cáo: hiện 4,6 giờ (CN tính thường) / 4,6 giờ tăng ca (CN tính tăng ca)', async () => {
  E = Number(db.prepare("INSERT INTO employees(code, username, password_hash, full_name, role, active, shift_id, device_pin, start_date) VALUES ('N1','n1','x','NV N1','employee',1,?,'N1','2026-01-01')").run(SID).lastInsertRowid);
  const { rebuildDay } = await import('../server/device-sync.js');
  const pun = db.prepare("INSERT INTO device_punches(serial, pin, punch_at, work_date, status, verify, employee_id) VALUES ('MAY1','N1',?,?,0,1,?)");
  pun.run(iso(SUN, '07:28'), SUN, E); pun.run(iso(SUN, '11:31'), SUN, E);
  const rep = async (type) => (await fetch(`${url}/reports/data?type=${type}&from=${SUN}&to=${SUN}`, { headers: { Authorization: 'Bearer ' + tok } })).json();

  setSetting('weekend_work_as_ot', '0');
  rebuildDay(E, SUN);
  let a = rowOf(SUN);
  assert.deepEqual([a.work_minutes, a.work_unit, a.ot_min], [276, 0.57, 0]);
  const hs = (await rep('hourstat')).rows.find((x) => x.code === 'N1');
  assert.equal(hs['d' + SUN], 4.6); assert.equal(hs.gio, 4.6);

  setSetting('weekend_work_as_ot', '1');
  rebuildDay(E, SUN);
  a = rowOf(SUN);
  assert.deepEqual([a.work_minutes, a.work_unit, a.ot_min, a.ot_type], [0, 0, 276, 'cuoi_tuan']);
});
