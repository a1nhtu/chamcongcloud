// XEM QUẸT (Máy chấm công → Xem quẹt) — Anh 23/11/2026: trước chỉ hiện 100 lượt mới nhất, không tìm được Số ID, không sắp xếp.
//  - GET /devices/:id/punches: q (Số ID đúng/chứa · mã / tên NV không dấu), unmatched=1, sort time|pin|name + dir, limit, trả total
//  - POST /devices/:id/punches/delete {ids}: xoá nhiều lượt, chỉ lượt của đúng máy đó
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { moCong } from './_cong.mjs';

const dir = mkdtempSync(join(tmpdir(), 'dgp-xem-quet-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema } = await import('../server/db.js');
const { registerDeviceRoutes } = await import('../server/routes/admin/devices.js');
const { describeAction } = await import('../server/audit-describe.js');
const express = (await import('express')).default;

const iso = (d, t) => new Date(`2026-11-${d}T${t}+07:00`).toISOString();
let srv, base, M1, M2;

before(async () => {
  initSchema();
  const emp = (code, name, pin) => Number(db.prepare("INSERT INTO employees(code, username, password_hash, full_name, device_pin, role, active) VALUES (?,?,'x',?,?,'employee',1)").run(code, code.toLowerCase(), name, pin).lastInsertRowid);
  const A = emp('NV01', 'Nguyễn Hoàng Đức', '12'), B = emp('NV02', 'Trần Thị Ánh', '3');
  M1 = Number(db.prepare("INSERT INTO push_devices(serial, name) VALUES ('MAY1','Cổng')").run().lastInsertRowid);
  M2 = Number(db.prepare("INSERT INTO push_devices(serial, name) VALUES ('MAY2','Xưởng')").run().lastInsertRowid);
  const pu = db.prepare('INSERT INTO device_punches(serial, pin, punch_at, work_date, status, verify, employee_id) VALUES (?,?,?,?,0,1,?)');
  const p = (serial, pin, d, t, eid = null) => pu.run(serial, pin, iso(d, t), '2026-11-' + d, eid);
  p('MAY1', '12', '20', '07:30:00', A); p('MAY1', '12', '20', '17:00:00', A);
  p('MAY1', '3', '21', '07:31:00', B);
  p('MAY1', '9999', '22', '11:08:25'); p('MAY1', '9999', '22', '11:09:00');
  p('MAY1', '199', '19', '08:00:00');
  p('MAY2', '9999', '22', '11:10:24');
  const app = express(); app.use(express.json());
  const r = express.Router();
  r.use((q, s, n) => { q.user = { id: 1, role: 'admin' }; n(); });
  registerDeviceRoutes(r, { need: () => (q, s, n) => n() });
  app.use('/admin', r);
  srv = await moCong(app); base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { srv?.close(); try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} });

const list = async (id, qs = '') => {
  const x = await fetch(`${base}/admin/devices/${id}/punches${qs}`);
  assert.equal(x.status, 200);
  return x.json();
};
const pins = (r) => r.rows.map((x) => x.pin);

test('mặc định: mới nhất trước, có tổng số, chỉ lượt của đúng máy', async () => {
  const r = await list(M1);
  assert.equal(r.total, 6);
  assert.deepEqual(pins(r), ['9999', '9999', '3', '12', '12', '199']);
  assert.equal(r.rows[2].full_name, 'Trần Thị Ánh');
  const r2 = await list(M2);
  assert.equal(r2.total, 1);
});

test('tìm theo Số ID: đúng số và số có chứa; theo tên không dấu / mã NV', async () => {
  assert.deepEqual(pins(await list(M1, '?q=9999')), ['9999', '9999']);
  assert.deepEqual(pins(await list(M1, '?q=99')).sort(), ['199', '9999', '9999']);
  assert.deepEqual(pins(await list(M1, '?q=' + encodeURIComponent('hoang duc'))), ['12', '12']);
  assert.deepEqual(pins(await list(M1, '?q=' + encodeURIComponent('ÁNH'))), ['3']);
  assert.deepEqual(pins(await list(M1, '?q=nv02')), ['3']);
  assert.equal((await list(M1, '?q=' + encodeURIComponent('%'))).total, 0);   // ký tự đặc biệt của LIKE không thành "khớp tất cả"
});

test('chỉ lượt chưa khớp + sắp xếp Số ID (theo số), tên, thời gian tăng dần', async () => {
  assert.deepEqual(pins(await list(M1, '?unmatched=1&sort=pin&dir=asc')), ['199', '9999', '9999']);
  assert.deepEqual(pins(await list(M1, '?sort=pin&dir=asc')), ['3', '12', '12', '199', '9999', '9999']);
  assert.deepEqual(pins(await list(M1, '?sort=pin&dir=desc')).slice(0, 2), ['9999', '9999']);
  const byName = (await list(M1, '?sort=name&dir=asc')).rows.map((x) => x.full_name);
  assert.deepEqual(byName.slice(0, 3), ['Nguyễn Hoàng Đức', 'Nguyễn Hoàng Đức', 'Trần Thị Ánh']);   // chưa khớp xuống cuối
  assert.deepEqual(pins(await list(M1, '?sort=time&dir=asc')), ['199', '12', '12', '3', '9999', '9999']);
  const lim = await list(M1, '?limit=2');
  assert.equal(lim.rows.length, 2); assert.equal(lim.total, 6);
});

test('xoá nhiều lượt: chỉ xoá lượt của đúng máy, nhật ký ghi Số ID + giờ', async () => {
  const mine = (await list(M1, '?q=9999')).rows.map((x) => x.id);
  const other = (await list(M2)).rows[0].id;
  const desc = describeAction({ method: 'POST', path: `/devices/${M1}/punches/delete`, body: { ids: [...mine, other] } });
  assert.match(desc, /Máy Cổng: xoá 2 lượt quẹt — Số ID 9999 lúc 11:08 22\/11\/2026/);
  const x = await fetch(`${base}/admin/devices/${M1}/punches/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [...mine, other] }) });
  assert.equal(x.status, 200);
  assert.equal((await x.json()).deleted, 2);
  assert.equal((await list(M1, '?q=9999')).total, 0);
  assert.equal((await list(M2)).total, 1);   // lượt của máy khác không bị xoá dù gửi kèm id
  const bad = await fetch(`${base}/admin/devices/${M1}/punches/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [] }) });
  assert.equal(bad.status, 400);
});
