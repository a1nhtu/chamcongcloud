// BỘ PHẬN MẶC ĐỊNH CỦA MÁY (Anh 25/11/2026, khách thefifty: 1 máy = 1 cửa hàng = 1 bộ phận).
// NV phần mềm tự tạo từ máy trước đây không có bộ phận → lọc theo cửa hàng / tài khoản "Chỉ quản lý bộ phận" không thấy
// (304 Linh, 305 Huynh ở máy 3-2). Máy có "Bộ phận mặc định" → NV tự tạo từ máy đó vào luôn bộ phận đó.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { moCong } from './_cong.mjs';

const dir = mkdtempSync(join(tmpdir(), 'dgp-bpmd-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema, setSetting } = await import('../server/db.js');
const { signToken } = await import('../server/auth.js');
const H = await import('../server/routes/iclock.js');
const express = (await import('express')).default;

const resObj = () => ({ out: '', type() { return this; }, send(x) { this.out = String(x); return this; }, status() { return this; }, json(o) { this.out = o; return this; } });
const post = (sn, table, body) => H.handleCData({ method: 'POST', query: { SN: sn, table, Stamp: '9999' }, body, headers: {}, socket: {} }, resObj());
const vn = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
const enroll = (pin, name) => `OPLOG 29\t0\t${vn()}\t${pin}\t0\t0\t0\nUSER PIN=${pin}\tName=${name}\tPri=0\tPasswd=\tCard=\nFP PIN=${pin}\tFID=0\tSize=48\tValid=1\tTMP=${'k'.repeat(48)}`;
const dept = (pin) => db.prepare('SELECT department FROM employees WHERE device_pin=?').get(pin)?.department;
let server, base, tok, idQ10;

before(async () => {
  initSchema();
  setSetting('device_enabled', '1'); setSetting('device_autocreate', '1'); setSetting('device_pin_guard', '1');
  db.prepare("INSERT INTO departments(name) VALUES ('3/2 Quận 10'),('Quận 4')").run();
  idQ10 = Number(db.prepare("INSERT INTO push_devices(serial,name,active,oper_stamp,default_dept) VALUES('SN_Q10','3-2',1,'100','3/2 Quận 10')").run().lastInsertRowid);
  db.prepare("INSERT INTO push_devices(serial,name,active,oper_stamp) VALUES('SN_X','Máy chưa gán',1,'100')").run();
  db.prepare("INSERT INTO push_devices(serial,name,active,oper_stamp,default_dept) VALUES('SN_OLD','Máy bộ phận đã xoá',1,'100','Đã xoá')").run();
  const adm = Number(db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash) VALUES ('ADM','Admin','admin','adm','x')").run().lastInsertRowid);
  tok = 'Bearer ' + signToken(db.prepare('SELECT * FROM employees WHERE id=?').get(adm));
  const app = express(); app.use(express.json());
  app.use('/api/admin', (await import('../server/routes/admin.js')).default);
  server = await moCong(app);
  base = `http://127.0.0.1:${server.address().port}/api/admin`;
});
after(() => { server?.close(); try { db.close(); } catch {} try { rmSync(dir, { recursive: true, force: true }); } catch {} });

test('NV tự tạo từ máy có bộ phận mặc định → vào luôn bộ phận đó', () => {
  post('SN_Q10', 'OPERLOG', enroll('304', 'Linh'));
  assert.equal(dept('304'), '3/2 Quận 10');
});

test('máy chưa gán / bộ phận đã bị xoá → để trống như cũ', () => {
  post('SN_X', 'OPERLOG', enroll('500', 'An'));
  assert.equal(dept('500'), '');
  post('SN_OLD', 'OPERLOG', enroll('501', 'Binh'));
  assert.equal(dept('501'), '');
});

test('NV đã có (đã có bộ phận khác) → không bị đổi bộ phận', () => {
  db.prepare("INSERT INTO employees(code, full_name, department, role, username, password_hash, device_pin) VALUES ('NV9','Chín','Quận 4','employee','nv9','x','909')").run();
  post('SN_Q10', 'OPERLOG', enroll('909', 'Chin'));
  assert.equal(dept('909'), 'Quận 4');
});

test('API: lưu / bỏ bộ phận mặc định; bộ phận không có → 400', async () => {
  const put = (b) => fetch(`${base}/devices/${idQ10}`, { method: 'PUT', headers: { Authorization: tok, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  assert.equal((await put({ default_dept: 'Không có' })).status, 400);
  assert.equal(db.prepare('SELECT default_dept FROM push_devices WHERE id=?').get(idQ10).default_dept, '3/2 Quận 10');
  assert.equal((await put({ default_dept: 'Quận 4' })).status, 200);
  assert.equal(db.prepare('SELECT default_dept FROM push_devices WHERE id=?').get(idQ10).default_dept, 'Quận 4');
  assert.equal((await put({ default_dept: '' })).status, 200);
  assert.equal(db.prepare('SELECT default_dept FROM push_devices WHERE id=?').get(idQ10).default_dept, '');
  const list = await (await fetch(`${base}/devices`, { headers: { Authorization: tok } })).json();
  assert.ok((list.rows || list).every((d) => 'default_dept' in d));
});
