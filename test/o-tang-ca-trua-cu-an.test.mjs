// Ô CŨ "Tính TĂNG CA TRƯA" trong form ca (break_ot) — Anh 22/11/2026: ẩn cho đỡ rối, tăng ca trưa dùng
// "Đăng ký tăng ca trưa theo giờ" ở menu Đăng ký làm thêm. Công tắc break_ot_ui (mặc định TẮT, chỉ tài khoản tổng bật)
// chỉ đổi GIAO DIỆN: ca đang tích ô cũ vẫn hiện + vẫn tính như trước. Chạy: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, readFileSync } from 'node:fs';
import { moCong } from './_cong.mjs';

const DBP = join(tmpdir(), `dgp-o-tang-ca-trua-cu-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;
let getSetting, server, base;
let user = { role: 'admin', master: false };
const call = async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json() };
};

before(async () => {
  let initSchema;
  ({ initSchema, getSetting } = await import('../server/db.js'));
  const { registerSettingsRoutes } = await import('../server/routes/admin/settings.js');
  const express = (await import('express')).default;
  initSchema();
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { req.user = user; next(); });
  const r = express.Router();
  const pass = (req, res, next) => next();
  registerSettingsRoutes(r, { need: () => pass, adminOnly: pass });
  app.use('/api/admin', r);
  server = await moCong(app);
  base = `http://127.0.0.1:${server.address().port}/api/admin`;
});
after(() => { server?.close(); for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} } });

test('mặc định TẮT: GET /settings trả break_ot_ui = 0', async () => {
  const { status, json } = await call('GET', '/settings');
  assert.equal(status, 200);
  assert.equal(json.break_ot_ui, '0');
});

test('admin công ty gửi break_ot_ui → không đổi (chỉ tài khoản tổng bật được)', async () => {
  user = { role: 'admin', master: false };
  assert.equal((await call('PUT', '/settings', { break_ot_ui: true })).status, 200);
  assert.equal(getSetting('break_ot_ui', '0'), '0');
});

test('tài khoản tổng bật / tắt được', async () => {
  user = { role: 'master', master: true };
  await call('PUT', '/settings', { break_ot_ui: true });
  assert.equal((await call('GET', '/settings')).json.break_ot_ui, '1');
  await call('PUT', '/settings', { break_ot_ui: false });
  assert.equal((await call('GET', '/settings')).json.break_ot_ui, '0');
});

test('form ca: ô s-breakot ẩn khi công tắc tắt, trừ ca đang tích; Lưu vẫn đọc được ô (ô nằm trong DOM)', () => {
  const src = readFileSync(new URL('../public/admin-parts/30-ca-lich-trinh.js', import.meta.url), 'utf8');
  assert.match(src, /showIf\(SETTINGS\.break_ot_ui === '1' \|\| !!s\?\.break_ot, C\('s-breakot'/);
  assert.match(src, /const showIf = \(on, node\) => \{ if \(!on\) node\.style\.display = 'none'; return node; \}/);
  assert.match(src, /break_ot: \$\('#s-breakot'\)\.checked/);
});
