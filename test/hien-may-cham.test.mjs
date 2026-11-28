// CÔNG TẮC "Hiện máy chấm cạnh giờ vào / ra" (show_punch_device, Anh 28/11/2026 — Đài PT-TH Hưng Yên muốn thấy giờ đó NV chấm ở máy nào).
// Tắt (mặc định): Tính công → Chi tiết / Giờ nguồn / báo cáo Chi tiết chấm công / Excel Giờ nguồn y như cũ (không trường, không cột mới).
// Bật: Chi tiết có in_dev / out_dev = tên máy đã quẹt đúng phút đó (ca đêm: giờ ra hôm sau vẫn ra đúng máy; chấm điện thoại → 'Điện thoại';
// giờ gõ tay không có lượt quẹt → trống); báo cáo 'detail' thêm cột Máy vào / Máy ra; Excel Giờ nguồn ghi "08:00 · Cổng chính (máy 1)".
// Chỉ hiển thị — công không đổi.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { moCong } from './_cong.mjs';

const dir = mkdtempSync(join(tmpdir(), 'dgp-may-cham-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema, setSetting } = await import('../server/db.js');
const { registerAttendanceRoutes } = await import('../server/routes/admin/attendance.js');
const reportRoutes = (await import('../server/routes/reports.js')).default;
const { signToken } = await import('../server/auth.js');
const express = (await import('express')).default;

const iso = (d, t) => new Date(`2026-11-${d}T${t}+07:00`).toISOString();
let srv, base, tok, E, F;
const ids = {};

before(async () => {
  initSchema();
  const emp = (code, role = 'employee') => Number(db.prepare("INSERT INTO employees(code, username, password_hash, full_name, department, role, active) VALUES (?,?,'x',?,'Thời sự',?,1)").run(code, code.toLowerCase(), 'NV ' + code, role).lastInsertRowid);
  const adm = emp('ADM', 'admin');
  tok = signToken({ id: adm, code: 'ADM', role: 'admin', full_name: 'Admin' });
  E = emp('PT1'); F = emp('PT2');
  db.prepare("INSERT INTO push_devices(serial, name, active, machine_number) VALUES ('SNCONG','Cổng chính',1,1), ('SNTANG3','Tầng 3',1,2), ('SNMOI','',1,0)").run();
  const att = db.prepare('INSERT INTO attendance(employee_id, work_date, check_in_at, check_out_at, check_in_photo, work_unit, work_minutes) VALUES (?,?,?,?,?,1,480)');
  const pu = db.prepare('INSERT INTO device_punches(serial, pin, punch_at, work_date, status, verify, employee_id) VALUES (?,?,?,?,0,1,?)');
  const punch = (eid, d, t, serial) => pu.run(serial, String(eid), iso(d, t), '2026-11-' + d, eid);
  // 02/11: vào Cổng chính 07:58:20, ra Tầng 3 17:05
  ids.d02 = Number(att.run(E, '2026-11-02', iso('02', '07:58:20'), iso('02', '17:05:00'), null).lastInsertRowid);
  punch(E, '02', '07:58:20', 'SNCONG'); punch(E, '02', '17:05:00', 'SNTANG3');
  // 03/11: máy chưa đặt tên → hiện serial; giờ ra gõ tay (không có lượt quẹt) → trống
  ids.d03 = Number(att.run(E, '2026-11-03', iso('03', '08:01:00'), iso('03', '17:00:00'), null).lastInsertRowid);
  punch(E, '03', '08:01:00', 'SNMOI');
  // 04/11: chấm điện thoại (có ảnh, không có lượt máy) → 'Điện thoại'
  ids.d04 = Number(att.run(E, '2026-11-04', iso('04', '08:00:00'), null, 'anh.jpg').lastInsertRowid);
  // ca đêm 05/11 22:00 Tầng 3 → 06/11 06:00 Cổng chính
  ids.d05 = Number(att.run(F, '2026-11-05', iso('05', '22:00:00'), iso('06', '06:00:00'), null).lastInsertRowid);
  punch(F, '05', '22:00:00', 'SNTANG3'); punch(F, '06', '06:00:00', 'SNCONG');

  const app = express(); app.use(express.json());
  const r = express.Router();
  r.use((q, s, n) => { q.user = { id: adm, full_name: 'QL', role: 'admin' }; n(); });
  registerAttendanceRoutes(r, { need: () => (q, s, n) => n() });
  app.use('/admin', r);
  app.use('/api/reports', reportRoutes);
  srv = await moCong(app); base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { srv?.close(); try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} });

const get = async (p) => {
  const x = await fetch(base + p, { headers: { Authorization: 'Bearer ' + tok } });
  assert.equal(x.status, 200, p);
  return x.json();
};
const Q = () => `from=2026-11-01&to=2026-11-07&ids=${E},${F}`;

test('TẮT (mặc định): Chi tiết / Giờ nguồn / báo cáo y như cũ — không có tên máy', async () => {
  const g = await get(`/admin/attendance/grid?mode=detail&${Q()}`);
  assert.equal(g.dev, undefined);
  assert.ok(g.rows.every((x) => !('in_dev' in x) && !('out_dev' in x)));
  const raw = await get(`/admin/attendance/grid?mode=raw&${Q()}`);
  assert.equal(raw.dev, undefined);
  const rep = await get(`/api/reports/data?type=detail&${Q()}`);
  assert.ok(!rep.columns.some((c) => c.key === 'devIn' || c.key === 'devOut'));
  const rp = await get(`/api/reports/data?type=rawpunch&${Q()}`);
  const d02 = rp.rows.find((x) => x.code === 'PT1' && x.date.startsWith('02'));
  assert.deepEqual([d02.l1, d02.l2], ['07:58', '17:05']);
});

test('BẬT: Tính công → Chi tiết ghi đúng máy dưới giờ vào / ra (ca đêm, máy chưa tên, điện thoại, giờ gõ tay); công không đổi', async () => {
  const before = await get(`/admin/attendance/grid?mode=detail&${Q()}`);
  setSetting('show_punch_device', '1');
  try {
    const g = await get(`/admin/attendance/grid?mode=detail&${Q()}`);
    assert.equal(g.dev, 1);
    const row = (id) => g.rows.find((x) => x.att_id === id);
    assert.deepEqual([row(ids.d02).in_dev, row(ids.d02).out_dev], ['Cổng chính', 'Tầng 3']);
    assert.deepEqual([row(ids.d03).in_dev, row(ids.d03).out_dev], ['SNMOI', '']);
    assert.deepEqual([row(ids.d04).in_dev, row(ids.d04).out_dev], ['Điện thoại', '']);
    assert.deepEqual([row(ids.d05).in_dev, row(ids.d05).out_dev], ['Tầng 3', 'Cổng chính']);
    // ngoài tên máy, mọi trường khác giữ nguyên
    const strip = (rs) => rs.map(({ in_dev, out_dev, ...x }) => x);   // eslint-disable-line no-unused-vars
    assert.deepEqual(strip(g.rows), strip(before.rows));
    const raw = await get(`/admin/attendance/grid?mode=raw&${Q()}`);
    assert.equal(raw.dev, 1);
    assert.deepEqual(raw.rows.find((x) => x.employee_id === E && x.date === '2026-11-02').srcs, ['Cổng chính (máy 1)', 'Tầng 3 (máy 2)']);
  } finally { setSetting('show_punch_device', '0'); }
});

test('BẬT: báo cáo Chi tiết chấm công có cột Máy vào / Máy ra; Excel Giờ nguồn ghi "giờ · máy"', async () => {
  setSetting('show_punch_device', '1');
  try {
    const rep = await get(`/api/reports/data?type=detail&${Q()}`);
    const keys = rep.columns.map((c) => c.key);
    assert.equal(keys.indexOf('devIn'), keys.indexOf('outReal') + 1);
    assert.equal(keys.indexOf('devOut'), keys.indexOf('devIn') + 1);
    const r02 = rep.rows.find((x) => x.code === 'PT1' && x.date.startsWith('02'));
    assert.deepEqual([r02.devIn, r02.devOut], ['Cổng chính', 'Tầng 3']);
    const r05 = rep.rows.find((x) => x.code === 'PT2' && x.date.startsWith('05'));
    assert.deepEqual([r05.devIn, r05.devOut], ['Tầng 3', 'Cổng chính']);
    const rp = await get(`/api/reports/data?type=rawpunch&${Q()}`);
    const d02 = rp.rows.find((x) => x.code === 'PT1' && x.date.startsWith('02'));
    assert.deepEqual([d02.l1, d02.l2], ['07:58 · Cổng chính (máy 1)', '17:05 · Tầng 3 (máy 2)']);
    const d04 = rp.rows.find((x) => x.code === 'PT1' && x.date.startsWith('04'));
    assert.equal(d04.l1, '08:00📱');   // điện thoại giữ dấu 📱, không thêm chữ
  } finally { setSetting('show_punch_device', '0'); }
});
