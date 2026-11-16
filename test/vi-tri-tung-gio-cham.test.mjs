// VỊ TRÍ TỪNG GIỜ CHẤM ở Tổng quan (Anh yêu cầu 16/11/2026): trước đây cột "Vị trí" chỉ là vị trí lúc chấm VÀO — không biết giờ RA
// (hay Vào 2 / Ra 2) trong hay ngoài định vị. Nay:
//   · chấm RA điện thoại lưu luôn định vị đã so + trong / ngoài (check_out_office_id / check_out_outside)
//   · lượt RA của bản cũ (chỉ có toạ độ) được tính bù khi xem Tổng quan
//   · API /reports/attendance trả in_geo / out_geo / punch_geos (ngày vừa chấm điện thoại vừa quẹt máy: vị trí theo từng lượt)
//   · thẻ "Chấm ngoài VP" đếm dòng có giờ vào HOẶC giờ ra ngoài định vị
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { moCong } from './_cong.mjs';   // cổng ngẫu nhiên an toàn

const dir = mkdtempSync(join(tmpdir(), 'dgp-vitri-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema, setSetting } = await import('../server/db.js');
const { signToken } = await import('../server/auth.js');
const { ingestAttlog } = await import('../server/device-sync.js');
const attRoutes = (await import('../server/routes/attendance.js')).default;
const reportRoutes = (await import('../server/routes/reports.js')).default;
const express = (await import('express')).default;

const D = '2026-11-16';
const iso = (t, d = D) => new Date(`${d}T${t}:00+07:00`).toISOString();
const TRONG = { lat: 21.0005, lng: 105.8 };   // cách VP Chính ~55 m (bán kính 200 m)
const NGOAI = { lat: 21.019, lng: 105.8 };    // cách VP Chính ~2,1 km
let srv, base, adminTok, office;
const mk = (code) => Number(db.prepare("INSERT INTO employees(code, username, password_hash, full_name, role, active, device_pin) VALUES (?,?,'x',?,'employee',1,?)").run(code, code.toLowerCase(), 'NV ' + code, code).lastInsertRowid);
const machine = (code, t, d = D) => ingestAttlog('MAY1', `${code}\t${d} ${t}:00\t0\t1\t0`, { ask: () => {} });
// chấm qua route thật, giờ máy chủ giả đúng lúc chấm
async function cham(eid, kind, t, pos) {
  mock.timers.enable({ apis: ['Date'], now: new Date(iso(t)) });
  try {
    const x = await fetch(`${base}/api/attendance/${kind === 'vào' ? 'check-in' : 'check-out'}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + signToken(db.prepare('SELECT * FROM employees WHERE id=?').get(eid)) },
      body: JSON.stringify({ ...pos, photo: 'khong-phai-anh' }),
    });
    const body = await x.json();
    assert.equal(x.status, 200, `${kind} ${t}: ${JSON.stringify(body)}`);
    return body;
  } finally { mock.timers.reset(); }
}
const get = async (path) => {
  const x = await fetch(base + path, { headers: { Authorization: 'Bearer ' + adminTok } });
  assert.equal(x.status, 200);
  return x.json();
};
const overview = async (eid) => (await get(`/api/reports/attendance?date=${D}`)).rows.filter((r) => r.employee_id === eid);

before(async () => {
  initSchema();
  setSetting('attendance_mode', 'hourly'); setSetting('hourly_merge_rule', 'pairs'); setSetting('punch_dedup_min', '15');
  db.prepare('DELETE FROM offices').run();
  office = Number(db.prepare("INSERT INTO offices(name, lat, lng, radius_m, active) VALUES ('VP Chính', 21.0, 105.8, 200, 1)").run().lastInsertRowid);
  const adm = Number(db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash) VALUES ('ADM','Admin','admin','adm','x')").run().lastInsertRowid);
  adminTok = signToken({ id: adm, code: 'ADM', role: 'admin', full_name: 'Admin' });
  const app = express(); app.use(express.json());
  app.use('/api/attendance', attRoutes);
  app.use('/api/reports', reportRoutes);
  srv = await moCong(app); base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { srv.close(); try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} });

test('vào trong VP, ra ngoài 2,1 km: giờ RA lưu ngoài định vị + định vị đã so; Tổng quan trả vị trí riêng từng giờ', async () => {
  const A = mk('A');
  await cham(A, 'vào', '08:00', TRONG);
  await cham(A, 'ra', '12:00', NGOAI);
  const row = db.prepare('SELECT * FROM attendance WHERE employee_id=?').get(A);
  assert.equal(row.check_in_outside, 0);
  assert.equal(row.check_out_outside, 1);
  assert.equal(row.check_out_office_id, office);
  const [o] = await overview(A);
  assert.equal(o.in_geo.out, 0);
  assert.equal(o.in_geo.office, 'VP Chính');
  assert.equal(o.out_geo.out, 1);
  assert.equal(o.out_geo.office, 'VP Chính');
  assert.ok(o.out_geo.dist > 2000 && o.out_geo.dist < 2200, 'cách ~2,1 km: ' + o.out_geo.dist);
  assert.deepEqual([o.out_geo.lat, o.out_geo.lng], [NGOAI.lat, NGOAI.lng]);
  // thẻ "Chấm ngoài VP": giờ vào trong VP nhưng giờ ra ngoài → vẫn tính
  assert.equal((await get(`/api/reports/dashboard?date=${D}`)).outside, 1);
});

test('lượt RA của bản cũ (chỉ có toạ độ + khoảng cách): xem Tổng quan thì tính bù trong / ngoài và lưu lại', async () => {
  const B = mk('B');
  db.prepare(`INSERT INTO attendance(employee_id, work_date, check_in_at, check_in_lat, check_in_lng, check_in_office_id, check_in_distance_m, check_in_outside,
    check_out_at, check_out_lat, check_out_lng, check_out_distance_m, day_status, shift_source) VALUES (?,?,?,?,?,?,?,0,?,?,?,?,'lam_viec','hourly')`)
    .run(B, D, iso('13:00'), TRONG.lat, TRONG.lng, office, 56, iso('17:00'), NGOAI.lat, NGOAI.lng, 2113);
  const [o] = await overview(B);
  assert.equal(o.out_geo.out, 1);
  assert.equal(o.out_geo.office, 'VP Chính');
  assert.equal(o.out_geo.dist, 2113);   // khoảng cách đã lưu lúc chấm giữ nguyên
  const row = db.prepare('SELECT check_out_outside, check_out_office_id FROM attendance WHERE employee_id=?').get(B);
  assert.deepEqual({ ...row }, { check_out_outside: 1, check_out_office_id: office });
});

test('vào bằng MÁY, ra bằng ĐIỆN THOẠI ngoài VP, chiều quẹt máy: chỉ lượt 12:00 có vị trí (ngoài), lượt máy không có', async () => {
  const C = mk('C');
  machine('C', '08:00');
  await cham(C, 'ra', '12:00', NGOAI);
  machine('C', '13:00'); machine('C', '17:00');
  const [o] = await overview(C);
  assert.deepEqual(o.punches_hm, ['08:00', '12:00', '13:00', '17:00']);
  assert.equal(o.punch_geos.length, 4);
  assert.equal(o.punch_geos[0], null);
  assert.equal(o.punch_geos[1].out, 1);
  assert.equal(o.punch_geos[1].office, 'VP Chính');
  assert.equal(o.punch_geos[2], null);
  assert.equal(o.punch_geos[3], null);
  const dt = db.prepare("SELECT lat, lng, office_id, outside FROM device_punches WHERE employee_id=? AND serial='DT_RA'").get(C);
  assert.deepEqual({ ...dt }, { lat: NGOAI.lat, lng: NGOAI.lng, office_id: office, outside: 1 });
});

test('sáng chấm điện thoại (vào trong VP, ra ngoài VP), chiều quẹt máy: gộp 1 dòng vẫn giữ vị trí từng lượt điện thoại', async () => {
  const E = mk('E');
  // dòng chấm điện thoại thật luôn có ảnh (test không lưu ảnh vào thư mục app → chèn thẳng như lúc route chấm xong)
  db.prepare(`INSERT INTO attendance(employee_id, work_date, check_in_at, check_in_lat, check_in_lng, check_in_photo, check_in_office_id, check_in_distance_m, check_in_outside,
    check_out_at, check_out_lat, check_out_lng, check_out_photo, check_out_office_id, check_out_distance_m, check_out_outside, day_status, shift_source)
    VALUES (?,?,?,?,?,'/uploads/E_vao.jpg',?,56,0,?,?,?,'/uploads/E_ra.jpg',?,2113,1,'lam_viec','hourly')`)
    .run(E, D, iso('07:30'), TRONG.lat, TRONG.lng, office, iso('11:30'), NGOAI.lat, NGOAI.lng, office);
  machine('E', '13:00'); machine('E', '17:00');
  const [o, ...rest] = await overview(E);
  assert.equal(rest.length, 0, 'gộp còn 1 dòng');
  assert.deepEqual(o.punches_hm, ['07:30', '11:30', '13:00', '17:00']);
  assert.deepEqual(o.punch_geos.map((g) => (g ? g.out : null)), [0, 1, null, null]);
});

test('máy chấm công thuần (không GPS): không có vị trí, không bị đếm là ngoài VP', async () => {
  const F = mk('F');
  machine('F', '08:00'); machine('F', '17:00');
  const [o] = await overview(F);
  assert.equal(o.in_geo, null);
  assert.equal(o.out_geo, null);
});
