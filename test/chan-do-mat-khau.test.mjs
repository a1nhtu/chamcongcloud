// Chặn dò mật khẩu đăng nhập (server/login-guard.js + /api/auth/login) — Anh duyệt 21/11/2026.
// 10 lần sai cùng tài khoản / 5 phút / IP → tạm khoá tài khoản đó từ IP đó; 30 lần sai tổng / 5 phút / IP → khoá cả IP.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { moCong } from './_cong.mjs';

const DBP = join(tmpdir(), `dgp-chandomk-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let G, server, base;
const fake = (ip, headers = {}) => ({ socket: { remoteAddress: ip }, headers });

before(async () => {
  G = await import('../server/login-guard.js');
  const { db, initSchema } = await import('../server/db.js');
  const { hashPassword } = await import('../server/auth.js');
  const authRoutes = (await import('../server/routes/auth.js')).default;
  const express = (await import('express')).default;
  initSchema();
  const ins = db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash) VALUES (?,?,?,?,?)");
  ins.run('NV1', 'Nhân viên 1', 'admin', 'nv1', hashPassword('482915'));
  ins.run('NV2', 'Nhân viên 2', 'employee', 'nv2', hashPassword('111222'));
  const app = express(); app.use(express.json());
  app.use('/api/auth', authRoutes);
  server = await moCong(app);
  base = `http://127.0.0.1:${server.address().port}/api/auth/login`;
});
after(() => { server?.close(); for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} } });
beforeEach(() => G.resetLoginGuard());

const login = (username, password, ip = '203.0.113.5') => fetch(base, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify({ username, password }),
});

test('IP: qua đường hầm (nối từ 127.0.0.1) lấy CF-Connecting-IP; kết nối thẳng KHÔNG tin header (chống giả IP để né)', () => {
  assert.equal(G.loginIp(fake('127.0.0.1', { 'cf-connecting-ip': '1.2.3.4' })), '1.2.3.4');
  assert.equal(G.loginIp(fake('::ffff:127.0.0.1', { 'x-forwarded-for': '5.6.7.8, 10.0.0.1' })), '5.6.7.8');
  assert.equal(G.loginIp(fake('192.168.1.50', { 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' })), '192.168.1.50');
  assert.equal(G.loginIp(fake('127.0.0.1')), '127.0.0.1');
});

test('sai 10 lần cùng tài khoản → khoá tài khoản đó từ IP đó; tài khoản khác cùng IP vẫn thử được; hết 5 phút thì mở', () => {
  const r = fake('10.0.0.9'), t0 = 1_000_000;
  for (let i = 0; i < 9; i++) G.noteLoginFail(r, 'admin', t0 + i);
  assert.equal(G.loginBlocked(r, 'admin', t0 + 10), 0, '9 lần sai chưa khoá');
  G.noteLoginFail(r, 'admin', t0 + 10);
  const wait = G.loginBlocked(r, 'admin', t0 + 20);
  assert.ok(wait > 4 * 60000 && wait <= G.WINDOW_MS, 'lần 10 → khoá gần đủ 5 phút');
  assert.equal(G.loginBlocked(r, ' ADMIN ', t0 + 20) > 0, true, 'tên viết hoa / khoảng trắng vẫn là cùng tài khoản');
  assert.equal(G.loginBlocked(r, 'nv2', t0 + 20), 0, 'nhân viên khác cùng mạng không bị khoá lây');
  assert.equal(G.loginBlocked(fake('10.0.0.10'), 'admin', t0 + 20), 0, 'IP khác chưa bị khoá');
  assert.equal(G.loginBlocked(r, 'admin', t0 + G.WINDOW_MS), 0, 'hết 5 phút kể từ lần sai đầu → mở');
});

test('sai tổng 30 lần (thử nhiều tài khoản) từ 1 IP → khoá cả IP, kể cả tài khoản chưa thử', () => {
  const r = fake('10.0.0.11'), t0 = 2_000_000;
  for (let i = 0; i < 30; i++) G.noteLoginFail(r, 'user' + (i % 6), t0 + i);   // mỗi tài khoản 5 lần (chưa tới 10)
  assert.equal(G.loginBlocked(r, 'user0', t0 + 40) > 0, true);
  assert.equal(G.loginBlocked(r, 'nguoimoi', t0 + 40) > 0, true);
  assert.equal(G.loginBlocked(fake('10.0.0.12'), 'nguoimoi', t0 + 40), 0);
});

test('đăng nhập đúng xoá số lần sai của tài khoản đó', () => {
  const r = fake('10.0.0.13'), t0 = 3_000_000;
  for (let i = 0; i < 9; i++) G.noteLoginFail(r, 'admin', t0 + i);
  G.noteLoginOk(r, 'admin');
  G.noteLoginFail(r, 'admin', t0 + 20);
  assert.equal(G.loginBlocked(r, 'admin', t0 + 30), 0, 'đếm lại từ 1 sau khi đăng nhập đúng');
});

test('API /api/auth/login: sai 10 lần → lần 11 trả 429 dù mật khẩu ĐÚNG; IP khác / tài khoản khác vẫn đăng nhập được', async () => {
  for (let i = 0; i < 10; i++) {
    const r = await login('nv1', '000000');
    assert.equal(r.status, 401, 'lần sai thứ ' + (i + 1));
  }
  const bl = await login('nv1', '482915');
  assert.equal(bl.status, 429);
  assert.ok(Number(bl.headers.get('retry-after')) > 0);
  assert.match((await bl.json()).error, /quá nhiều lần.*phút/);
  assert.equal((await login('nv1', '482915', '198.51.100.7')).status, 200, 'IP khác không bị ảnh hưởng');
  assert.equal((await login('nv2', '111222')).status, 200, 'tài khoản khác cùng IP vẫn vào được');
});

test('API: đăng nhập đúng bình thường không bị ảnh hưởng (không sai lần nào)', async () => {
  const r = await login('nv1', '482915');
  assert.equal(r.status, 200);
  assert.ok((await r.json()).token);
});
