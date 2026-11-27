// MỞ KHOÁ NV → gán lại các lượt quẹt về lúc NV còn khoá (Anh 27/11/2026, khách trankimxuyen).
// 3 bảo vệ bị khoá nhầm khi chuyển dữ liệu Ronald Jack; máy đẩy bù ~110 lượt / người lúc họ đang khoá → lượt "chưa khớp"
// (employee_id NULL). Khách mở khoá (Sửa NV → Đang làm) nhưng không có ngày công nào, phải bấm Tính lại mới có.
// Giờ mở khoá (Sửa NV, nút Mở khoá, Mở khoá hàng loạt) là gán lượt cũ + dựng công những ngày đó ngay.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { moCong } from './_cong.mjs';

const dir = mkdtempSync(join(tmpdir(), 'dgp-mokhoa-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema } = await import('../server/db.js');
const { signToken } = await import('../server/auth.js');
const { ingestAttlog } = await import('../server/device-sync.js');
const express = (await import('express')).default;

const SN = 'SN-MOKHOA';
let server, base, ADM;
const tok = (id) => 'Bearer ' + signToken(db.prepare('SELECT * FROM employees WHERE id=?').get(id));
const call = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { Authorization: tok(ADM), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};
const add = (code, pin, active) => Number(db.prepare(`INSERT INTO employees(code, full_name, role, username, password_hash, device_pin, active)
  VALUES (?,?, 'employee', ?, 'x', ?, ?)`).run(code, 'NV ' + code, code.toLowerCase(), pin, active ? 1 : 0).lastInsertRowid);
const orphans = (pin) => db.prepare('SELECT COUNT(*) n FROM device_punches WHERE pin=? AND employee_id IS NULL').get(pin).n;
const days = (id) => db.prepare('SELECT work_date, check_in_at, check_out_at FROM attendance WHERE employee_id=? ORDER BY work_date').all(id);
// 2 ngày quẹt vào 07:00 + ra 19:00 (bảo vệ ca ngày)
const punch = (pin) => ingestAttlog(SN, [`${pin}\t2026-09-01 07:00:00\t0\t15`, `${pin}\t2026-09-01 19:00:00\t1\t15`,
  `${pin}\t2026-09-02 07:01:00\t0\t15`, `${pin}\t2026-09-02 19:02:00\t1\t15`].join('\n'), { ask: () => {} });

before(async () => {
  initSchema();
  db.prepare("INSERT INTO push_devices(serial, active, conn_type) VALUES (?, 1, 'push')").run(SN);
  ADM = Number(db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash) VALUES ('ADM','Admin','admin','adm','x')").run().lastInsertRowid);
  const app = express(); app.use(express.json());
  app.use('/api/admin', (await import('../server/routes/admin.js')).default);
  app.use((err, req, res, next) => { res.status(500).json({ error: 'LOI 500: ' + err.message }); });   // eslint-disable-line no-unused-vars
  server = await moCong(app);
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server?.close(); try { db.close(); } catch {} try { rmSync(dir, { recursive: true, force: true }); } catch {} });

test('NV đang khoá quẹt → lượt chưa khớp, không có công (như cũ)', () => {
  const id = add('00004', '4', false);
  punch('4');
  assert.equal(orphans('4'), 4);
  assert.equal(days(id).length, 0);
});

test('Sửa NV → Đang làm (PUT active) → gán 4 lượt cũ + có công 2 ngày', async () => {
  const id = db.prepare("SELECT id FROM employees WHERE code='00004'").get().id;
  const r = await call('PUT', '/admin/employees/' + id, { active: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.relinked, 4);
  assert.equal(orphans('4'), 0);
  const d = days(id);
  assert.deepEqual(d.map((x) => x.work_date), ['2026-09-01', '2026-09-02']);
  assert.ok(d.every((x) => x.check_in_at && x.check_out_at));
});

test('Mở khoá hàng loạt (lock-bulk lock:false) → gán lượt cũ cho từng người', async () => {
  const a = add('00012', '12', false), b = add('00015', '15', false);
  punch('12'); punch('15');
  const r = await call('POST', '/admin/employees/lock-bulk', { ids: [a, b], lock: false });
  assert.equal(r.status, 200);
  assert.equal(r.body.changed, 2);
  assert.equal(r.body.relinked, 8);
  assert.equal(orphans('12') + orphans('15'), 0);
  assert.equal(days(a).length, 2);
  assert.equal(days(b).length, 2);
});

test('Sửa NV đang làm (không đổi khoá) → không đụng lượt chưa khớp', async () => {
  const id = add('00020', '20', true);
  db.prepare("INSERT INTO device_punches(serial,pin,punch_at,work_date,status,verify,employee_id) VALUES (?, '20', '2026-09-03T00:00:00.000Z', '2026-09-03', 0, 15, NULL)").run(SN);
  const r = await call('PUT', '/admin/employees/' + id, { full_name: 'NV 20 sửa tên' });
  assert.equal(r.status, 200);
  assert.equal(r.body.relinked, 0);
  assert.equal(orphans('20'), 1);
});

test('Khoá hàng loạt → không gán gì', async () => {
  const id = add('00030', '30', true);
  const r = await call('POST', '/admin/employees/lock-bulk', { ids: [id], lock: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.relinked, 0);
});

test('NV không có Số ID máy: mở khoá gán theo mã NV, trừ khi mã đó là Số ID máy của NV khác', async () => {
  const a = add('77', '', false);
  ingestAttlog(SN, '77\t2026-09-05 07:00:00\t0\t15\n77\t2026-09-05 19:00:00\t1\t15', { ask: () => {} });
  assert.equal(orphans('77'), 2);
  assert.equal((await call('PUT', '/admin/employees/' + a, { active: true })).body.relinked, 2);
  // mã "88" trùng Số ID máy của NV khác (đang khoá) → lượt của Số ID 88 là của người kia, không gán
  add('X88', '88', false);
  const c = add('88', '', false);
  ingestAttlog(SN, '88\t2026-09-06 07:00:00\t0\t15', { ask: () => {} });
  assert.equal((await call('PUT', '/admin/employees/' + c, { active: true })).body.relinked, 0);
  assert.equal(orphans('88'), 1);
});
