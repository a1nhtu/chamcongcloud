// CÔNG TẮC "Số ID máy chấm công = Mã NV" (emp_pin_is_code, Anh 28/11/2026, khách Hualida — máy Hikvision nhận Số ID dạng chữ).
// Bật: thêm / sửa NV chưa có Số ID mà để trống ô Số ID → Số ID = mã NV (khỏi khai). Có gõ Số ID thì giữ số đã gõ; NV đã có Số ID không đổi.
// Tắt (mặc định): y như cũ — để trống là chưa có Số ID.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { moCong } from './_cong.mjs';

const dir = mkdtempSync(join(tmpdir(), 'dgp-pinma-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema, setSetting } = await import('../server/db.js');
const { signToken } = await import('../server/auth.js');
const express = (await import('express')).default;

let server, base, ADM;
const tok = (id) => 'Bearer ' + signToken(db.prepare('SELECT * FROM employees WHERE id=?').get(id));
const call = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { Authorization: tok(ADM), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};
const pinOf = (code) => db.prepare('SELECT device_pin FROM employees WHERE code=?').get(code)?.device_pin ?? null;

before(async () => {
  initSchema();
  ADM = Number(db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash) VALUES ('ADM','Quản trị','admin','adm','x')").run().lastInsertRowid);
  const app = express(); app.use(express.json());
  app.use('/api/admin', (await import('../server/routes/admin.js')).default);
  app.use((err, req, res, next) => { res.status(500).json({ error: 'LOI 500: ' + err.message }); });   // eslint-disable-line no-unused-vars
  server = await moCong(app);
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server?.close(); try { db.close(); } catch {} try { rmSync(dir, { recursive: true, force: true }); } catch {} });

test('TẮT (mặc định): để trống Số ID → NV chưa có Số ID, như cũ', async () => {
  const r = await call('POST', '/admin/employees', { code: 'TB070001', full_name: 'Tắt công tắc', device_pin: '' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(pinOf('TB070001'), '');
  const s = await call('GET', '/admin/settings');
  assert.equal(s.body.emp_pin_is_code, '0');
});

test('BẬT: thêm NV để trống Số ID → Số ID = mã NV; gõ Số ID thì giữ số đã gõ', async () => {
  setSetting('emp_pin_is_code', '1');
  const r = await call('POST', '/admin/employees', { code: 'TB060123', full_name: 'Nguyễn Thị Mới', device_pin: '' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(pinOf('TB060123'), 'TB060123');
  const r2 = await call('POST', '/admin/employees', { code: 'TB060124', full_name: 'Có gõ số', device_pin: '77' });
  assert.equal(r2.status, 200);
  assert.equal(pinOf('TB060124'), '77');
});

test('BẬT: sửa NV chưa có Số ID → lấy mã NV; NV đã có Số ID giữ nguyên', async () => {
  const id = db.prepare("SELECT id FROM employees WHERE code='TB070001'").get().id;
  const r = await call('PUT', '/admin/employees/' + id, { full_name: 'Tắt công tắc', device_pin: '' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(pinOf('TB070001'), 'TB070001');
  const id2 = db.prepare("SELECT id FROM employees WHERE code='TB060124'").get().id;
  await call('PUT', '/admin/employees/' + id2, { full_name: 'Có gõ số', device_pin: '' });
  assert.equal(pinOf('TB060124'), '77');
});

test('BẬT: mã NV trùng Số ID người khác đang dùng → báo lỗi, không tạo', async () => {
  db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash, device_pin) VALUES ('X1','Người cũ','employee','x1','x','TB099999')").run();
  const r = await call('POST', '/admin/employees', { code: 'TB099999', full_name: 'Trùng', device_pin: '' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /đã có nhân viên dùng/);
  setSetting('emp_pin_is_code', '0');
});
