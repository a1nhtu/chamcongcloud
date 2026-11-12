// Chấm ĐIỆN THOẠI theo CA, hôm qua quên chấm ra (Anh chốt "Sửa luôn" 04/11/2026):
// trước đây ca NGÀY 08–17 vào 14:29 quên ra → sáng hôm sau mở app thấy RA CA → giờ đó thành giờ ra hôm trước
// (thử: tăng ca 1.629 phút). Giờ: chỉ cho chấm RA ca hôm qua khi còn trong khung giờ RA của ca đó (giống máy chấm công).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { moCong } from './_cong.mjs';   // cổng ngẫu nhiên an toàn (tránh cổng fetch cấm / cổng test khác đang dò)

const dir = mkdtempSync(join(tmpdir(), 'dgp-ca-dt-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema, setSetting } = await import('../server/db.js');
const { signToken } = await import('../server/auth.js');
const { vnDateStr } = await import('../server/util.js');
const attMod = await import('../server/routes/attendance.js');
const express = (await import('express')).default;

const TODAY = vnDateStr();
const YDAY = (() => { const d = new Date(TODAY + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })();
const iso = (d, t) => new Date(`${d}T${t}:00+07:00`).toISOString();
const hm = (i) => (i ? new Date(Date.parse(i) + 7 * 3600000).toISOString().slice(11, 16) : null);
let srv, base;
const S = {}, E = {};
const call = async (m, p, who, b) => {
  const x = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + signToken(db.prepare('SELECT * FROM employees WHERE id=?').get(who)) }, body: b ? JSON.stringify(b) : undefined });
  return { status: x.status, body: await x.json() };
};
const rowsOf = (eid, d) => db.prepare('SELECT check_in_at i, check_out_at o FROM attendance WHERE employee_id=? AND work_date=? ORDER BY check_in_at').all(eid, d).map((a) => [hm(a.i), hm(a.o)]);
const PUNCH = { lat: 21.0, lng: 105.8, photo: 'khong-phai-anh' };

before(async () => {
  initSchema();
  setSetting('attendance_mode', 'shift');
  setSetting('punch_dedup_min', '15');
  const sh = (name, st, et, extra = '') => Number(db.prepare(`INSERT INTO shifts(name,start_time,end_time,break_minutes,allow_ot,ot_start_after_min${extra ? ',check_out_end' : ''}) VALUES (?,?,?,60,1,30${extra ? ',?' : ''})`)
    .run(...[name, st, et, ...(extra ? [extra] : [])]).lastInsertRowid);
  S.HC = sh('HC', '08:00', '17:00'); S.Chieu = sh('Chiều', '14:00', '22:00'); S.Dem = sh('Đêm', '22:00', '06:00'); S.Khai = sh('HC khai ra', '08:00', '17:00', '09:00');
  const emp = (code, sid) => Number(db.prepare("INSERT INTO employees(code, username, password_hash, full_name, role, active, shift_id, att_mode) VALUES (?,?,'x',?,'employee',1,?,'shift')").run(code, code.toLowerCase(), 'NV ' + code, sid).lastInsertRowid);
  E.HC = emp('HC', S.HC); E.DEM = emp('DEM', S.Dem);
  const app = express(); app.use(express.json());
  app.use('/api/attendance', attMod.default);
  srv = await moCong(app); base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { srv.close(); try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} });

test('ca NGÀY 08–17 hôm qua vào 14:29 quên ra → hôm nay app hiện VÀO CA + nhắc; không đóng ca hôm qua', async () => {
  db.prepare("INSERT INTO attendance(employee_id, work_date, check_in_at, check_in_photo, day_status, shift_id, shift_source) VALUES (?,?,?,'/a.jpg','thieu_ra',?,'default')")
    .run(E.HC, YDAY, iso(YDAY, '14:29'), S.HC);
  const t = await call('GET', '/api/attendance/today', E.HC);
  assert.equal(t.status, 200);
  assert.equal(t.body.state, 'can_in');
  assert.equal(t.body.forgotOut?.date, YDAY);
  const out = await call('POST', '/api/attendance/check-out', E.HC, PUNCH);
  assert.equal(out.status, 400);
  assert.match(out.body.error, /chưa chấm VÀO/);
  assert.deepEqual(rowsOf(E.HC, YDAY), [['14:29', null]]);
  const inn = await call('POST', '/api/attendance/check-in', E.HC, PUNCH);
  assert.equal(inn.status, 200, JSON.stringify(inn.body));
  assert.equal(rowsOf(E.HC, TODAY).length, 1);
  assert.deepEqual(rowsOf(E.HC, YDAY), [['14:29', null]]);
});

test('khung giờ RA của ca hôm qua: ca đêm / ca chiều về muộn vẫn chấm ra được, quá khung thì không', () => {
  const D0 = '2026-10-04', D1 = '2026-10-05';
  const ok = (sid, inT, nowT) => attMod.yesterdayOutOk(E.HC, { work_date: D0, check_in_at: iso(D0, inT), shift_id: sid }, Date.parse(iso(D1, nowT)));
  // ca đêm 22:00–06:00: ra sáng hôm sau tới 10:00 (4 tiếng sau giờ kết thúc)
  assert.equal(ok(S.Dem, '21:55', '06:05'), true);
  assert.equal(ok(S.Dem, '21:55', '09:59'), true);
  assert.equal(ok(S.Dem, '21:55', '10:30'), false);
  // ca chiều 14:00–22:00 làm quá nửa đêm: ra 00:30 được (tới 02:00), sáng 07:59 thì không
  assert.equal(ok(S.Chieu, '13:55', '00:30'), true);
  assert.equal(ok(S.Chieu, '13:55', '07:59'), false);
  // ca ngày 08–17: qua nửa đêm là không còn ra cho hôm qua
  assert.equal(ok(S.HC, '14:29', '00:10'), false);
  assert.equal(ok(S.HC, '14:29', '07:59'), false);
  // ca có khai "Kết thúc ra" 09:00 (qua đêm) → theo đúng giờ đã khai
  assert.equal(ok(S.Khai, '08:00', '08:30'), true);
  assert.equal(ok(S.Khai, '08:00', '09:30'), false);
});

test('ca ĐÊM: route chấm RA vẫn đóng đúng ca hôm qua khi còn trong khung', async () => {
  // vào 21:55 hôm qua; lúc chạy test bất kỳ giờ nào hôm nay — chỉ kiểm khi đang trong khung (trước 10:00)
  db.prepare("INSERT INTO attendance(employee_id, work_date, check_in_at, check_in_photo, day_status, shift_id, shift_source) VALUES (?,?,?,'/a.jpg','thieu_ra',?,'default')")
    .run(E.DEM, YDAY, iso(YDAY, '21:55'), S.Dem);
  const inWin = Date.now() <= Date.parse(iso(TODAY, '10:00'));
  const t = await call('GET', '/api/attendance/today', E.DEM);
  assert.equal(t.body.state, inWin ? 'can_out' : 'can_in');
  if (!inWin) return;
  const out = await call('POST', '/api/attendance/check-out', E.DEM, PUNCH);
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(out.body.attendance.work_date, YDAY);
});
