// Test ngày VỪA chấm ĐIỆN THOẠI VỪA quẹt MÁY (theo giờ, "Theo cặp vào / ra") — Anh chốt 04/11/2026:
//   · Tổng quan gộp 1 dòng Vào 1 · Ra 1 · Vào 2 · Ra 2; lượt chấm điện thoại có ẢNH ngay cạnh giờ (punch_photos)
//   · Gộp ngày không làm mất ảnh của từng lượt chấm điện thoại (lưu vào lượt máy ảo DT_VAO / DT_RA)
//   · Lỗi cũ: vào bằng MÁY 08:00, ra bằng ĐIỆN THOẠI 12:00, chiều quẹt máy 13:00 + 17:00 → mất giờ ra 12:00, tính 5 giờ thay vì 8
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'dgp-mix-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema, setSetting } = await import('../server/db.js');
const { signToken } = await import('../server/auth.js');
const { vnDateStr } = await import('../server/util.js');
const { ingestAttlog, recordPhonePunch, rebuildDay } = await import('../server/device-sync.js');
const attRoutes = (await import('../server/routes/attendance.js')).default;
const reportRoutes = (await import('../server/routes/reports.js')).default;
const express = (await import('express')).default;

const D = '2026-11-04';
const iso = (t, d = D) => new Date(`${d}T${t}:00+07:00`).toISOString();
const hm = (i) => (i ? new Date(Date.parse(i) + 7 * 3600000).toISOString().slice(11, 16) : null);
let srv, base, adminTok;
const mk = (code) => Number(db.prepare("INSERT INTO employees(code, username, password_hash, full_name, role, active, device_pin) VALUES (?,?,'x',?,'employee',1,?)").run(code, code.toLowerCase(), 'NV ' + code, code).lastInsertRowid);
const machine = (code, t, d = D) => ingestAttlog('MAY1', `${code}\t${d} ${t}:00\t0\t1\t0`, { ask: () => {} });
const phoneRow = (eid, i, o, pi, po) => db.prepare("INSERT INTO attendance(employee_id, work_date, check_in_at, check_out_at, check_in_photo, check_out_photo, day_status, shift_source) VALUES (?,?,?,?,?,?,'lam_viec','hourly')").run(eid, D, iso(i), o && iso(o), pi, po);
const rows = (eid, d = D) => db.prepare('SELECT * FROM attendance WHERE employee_id=? AND work_date=? ORDER BY check_in_at').all(eid, d);
const overview = async (eid) => {
  const x = await fetch(`${base}/api/reports/attendance?date=${D}`, { headers: { Authorization: 'Bearer ' + adminTok } });
  assert.equal(x.status, 200);
  return (await x.json()).rows.filter((r) => r.employee_id === eid);
};

before(() => {
  initSchema();
  setSetting('attendance_mode', 'hourly'); setSetting('hourly_merge_rule', 'pairs'); setSetting('punch_dedup_min', '15');
  const adm = Number(db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash) VALUES ('ADM','Admin','admin','adm','x')").run().lastInsertRowid);
  adminTok = signToken({ id: adm, code: 'ADM', role: 'admin', full_name: 'Admin' });
  const app = express(); app.use(express.json());
  app.use('/api/attendance', attRoutes);
  app.use('/api/reports', reportRoutes);
  srv = app.listen(0); base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { srv.close(); try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} });

test('sáng chấm điện thoại 08–12, chiều quẹt máy 13–17: 1 dòng 8 giờ, ảnh nằm cạnh đúng giờ 08:00 và 12:00', async () => {
  const A = mk('A');
  phoneRow(A, '08:00', '12:00', '/uploads/A_vao.jpg', '/uploads/A_ra.jpg');
  machine('A', '13:00'); machine('A', '17:00');
  const r = rows(A);
  assert.equal(r.length, 1);
  assert.equal(r[0].work_minutes, 480);
  const [o] = await overview(A);
  assert.deepEqual(o.punches_hm, ['08:00', '12:00', '13:00', '17:00']);
  assert.deepEqual(o.punch_photos, ['/uploads/A_vao.jpg', '/uploads/A_ra.jpg', null, null]);
  // bản cũ đã gộp (lượt DT chưa có ảnh): vẫn gắn ảnh vào → 08:00, ảnh ra → lượt ra điện thoại cuối (12:00)
  db.prepare("UPDATE device_punches SET photo=NULL WHERE employee_id=?").run(A);
  const [o2] = await overview(A);
  assert.deepEqual(o2.punch_photos, ['/uploads/A_vao.jpg', '/uploads/A_ra.jpg', null, null]);
});

test('vào bằng MÁY, ra bằng ĐIỆN THOẠI, chiều quẹt máy: không mất giờ ra điện thoại → 8 giờ, ảnh cạnh 12:00', async () => {
  const B = mk('B');
  machine('B', '08:00');
  // như route chấm RA điện thoại: đóng dòng công của máy + ghi lượt DT_RA kèm ảnh
  db.prepare("UPDATE attendance SET check_out_at=?, check_out_photo='/uploads/B_ra.jpg' WHERE employee_id=? AND work_date=?").run(iso('12:00'), B, D);
  recordPhonePunch(B, 'out', iso('12:00'), '/uploads/B_ra.jpg');
  machine('B', '13:00'); machine('B', '17:00');
  const r = rows(B);
  assert.equal(r.length, 1);
  assert.equal(r[0].work_minutes, 480);   // trước: 300 (08:00 → 13:00)
  const [o] = await overview(B);
  assert.deepEqual(o.punches_hm, ['08:00', '12:00', '13:00', '17:00']);
  assert.deepEqual(o.punch_photos, [null, '/uploads/B_ra.jpg', null, null]);
});

test('dữ liệu bản cũ (ra điện thoại chưa ghi lượt DT_RA, chưa bị đè): lần dựng lại sau cứu được giờ ra 12:00', () => {
  const C = mk('C');
  machine('C', '08:00');
  db.prepare("UPDATE attendance SET check_out_at=?, check_out_photo='/uploads/C_ra.jpg' WHERE employee_id=? AND work_date=?").run(iso('12:00'), C, D);
  machine('C', '13:00'); machine('C', '17:00');
  assert.equal(rows(C)[0].work_minutes, 480);
  // Tính lại nhiều lần vẫn giữ nguyên
  rebuildDay(C, D); rebuildDay(C, D);
  assert.equal(rows(C)[0].work_minutes, 480);
});

test('chỉ chấm điện thoại (không quẹt máy): vẫn mỗi phiên 1 dòng như cũ, không ghi lượt DT', async () => {
  const P = mk('P');
  phoneRow(P, '08:00', '12:00', '/uploads/P1.jpg', '/uploads/P2.jpg');
  phoneRow(P, '13:00', '17:00', '/uploads/P3.jpg', '/uploads/P4.jpg');
  assert.equal(rows(P).length, 2);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM device_punches WHERE employee_id=?').get(P).c, 0);
  const o = await overview(P);
  assert.equal(o.length, 2);
  assert.ok(o.every((x) => x.punch_photos === undefined));
});

test('route chấm RA điện thoại vào dòng công của máy → ghi lượt DT_RA đúng giờ ra', async () => {
  const today = vnDateStr();
  const M = mk('M');
  const inAt = new Date(Date.now() - 30 * 60000).toISOString();
  db.prepare("INSERT INTO attendance(employee_id, work_date, check_in_at, day_status, shift_source) VALUES (?,?,?,'thieu_ra','device')").run(M, today, inAt);
  const tok = signToken(db.prepare('SELECT * FROM employees WHERE id=?').get(M));
  const x = await fetch(`${base}/api/attendance/check-out`, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ lat: 21, lng: 105.8, photo: 'khong-phai-anh' }) });
  assert.equal(x.status, 200, await x.clone().text());
  const out = (await x.json()).attendance.check_out_at;
  const p = db.prepare("SELECT serial, punch_at FROM device_punches WHERE employee_id=?").all(M).map((r) => [r.serial, r.punch_at]);
  assert.deepEqual(p, [['DT_RA', out]]);
});
