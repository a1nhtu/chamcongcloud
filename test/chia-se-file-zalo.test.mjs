// GỬI FILE EXCEL QUA ZALO / MAIL từ điện thoại (Anh 16/11/2026). Chrome Android không cho trang web chia sẻ thẳng file .xlsx →
// trang quản lý gửi file lên máy chủ, máy chủ giữ dưới link mã ngẫu nhiên 3 ngày (server/share-file.js). Chạy: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { moCong } from './_cong.mjs';

const DBP = join(tmpdir(), `dgp-chia-se-file-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;
let S, server, base, tok;
const made = [];   // thư mục link tạo trong lúc test (nằm ở data/chia-se của app) → dọn khi xong

before(async () => {
  const { db, initSchema } = await import('../server/db.js');
  const { signToken } = await import('../server/auth.js');
  S = await import('../server/share-file.js');
  const adminRoutes = (await import('../server/routes/admin.js')).default;
  const express = (await import('express')).default;
  initSchema();
  const adm = Number(db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash) VALUES ('ADM','Admin','admin','adm','x')").run().lastInsertRowid);
  tok = signToken({ id: adm, code: 'ADM', role: 'admin', full_name: 'Admin' });
  const app = express(); app.use(express.json());
  app.get('/api/f/:tok/:name', S.shareDownload);
  app.use('/api/admin', adminRoutes);
  server = await moCong(app);
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => {
  server?.close();
  const { dataDir } = await import('../server/db.js');
  for (const t of made) { try { rmSync(join(dataDir(), 'chia-se', t), { recursive: true, force: true }); } catch {} }
  for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
});

const post = (name, body, auth = true) => fetch(`${base}/admin/share-file?name=${encodeURIComponent(name)}`, {
  method: 'POST', body, headers: { 'Content-Type': 'application/octet-stream', ...(auth ? { Authorization: 'Bearer ' + tok } : {}) },
});
const tokOf = (url) => /^\/api\/f\/([A-Za-z0-9_-]{24})\//.exec(url)[1];

test('tên file: giữ chữ tiếng Việt, bỏ ký tự đường dẫn; chỉ nhận Excel / Word / PDF / CSV', () => {
  assert.equal(S.safeShareName('Báo cáo tháng 11.xlsx'), 'Báo cáo tháng 11.xlsx');
  assert.equal(S.safeShareName('../../a/b\\c:d.xlsx'), '_.._a_b_c_d.xlsx');   // không thoát ra ngoài thư mục link
  assert.equal(S.safeShareName('bang_luong.XLSX'), 'bang_luong.XLSX');
  for (const bad of ['x.exe', 'x.html', 'x.js', 'x.svg', 'khong-duoi', '.xlsx', '', null]) assert.equal(S.safeShareName(bad), null, String(bad));
});

test('tạo link → người nhận (không đăng nhập) tải về đúng file; máy chủ trung gian không được giữ bản sao', async () => {
  const data = Buffer.from('PK\u0003\u0004 noi dung excel gia ' + 'x'.repeat(5000));
  const res = await post('baocao_attendance_2026-11-01_2026-11-30.xlsx', data);
  assert.equal(res.status, 200);
  const j = await res.json();
  made.push(tokOf(j.url));
  assert.match(j.url, /^\/api\/f\/[A-Za-z0-9_-]{24}\/baocao_attendance_2026-11-01_2026-11-30\.xlsx$/);
  assert.ok(j.expires > Date.now() + 2.9 * 24 * 3600e3 && j.expires <= Date.now() + 3 * 24 * 3600e3 + 1000, 'hết hạn sau 3 ngày');
  const dl = await fetch(base.replace(/\/api$/, '') + j.url);   // không kèm mã đăng nhập
  assert.equal(dl.status, 200);
  assert.deepEqual(Buffer.from(await dl.arrayBuffer()), data);
  assert.match(dl.headers.get('cache-control') || '', /no-store/);
  assert.match(dl.headers.get('content-disposition') || '', /attachment/);
  // 2 lần xuất cùng tên → 2 link khác nhau
  const j2 = await (await post('baocao_attendance_2026-11-01_2026-11-30.xlsx', data)).json();
  made.push(tokOf(j2.url));
  assert.notEqual(j2.url, j.url);
});

test('tên file tiếng Việt trên link vẫn tải được', async () => {
  const j = await (await post('Bảng lương T11.xlsx', Buffer.from('abc'))).json();
  made.push(tokOf(j.url));
  const dl = await fetch(base.replace(/\/api$/, '') + j.url);
  assert.equal(dl.status, 200);
  assert.equal(Buffer.from(await dl.arrayBuffer()).toString(), 'abc');
});

test('phải đăng nhập trang quản lý mới tạo được link; file lạ / rỗng bị từ chối', async () => {
  assert.equal((await post('a.xlsx', Buffer.from('abc'), false)).status, 401);
  const exe = await post('virus.exe', Buffer.from('MZ'));
  assert.equal(exe.status, 400);
  assert.match((await exe.json()).error, /Excel, Word, PDF/);
  assert.equal((await post('a.xlsx', Buffer.alloc(0))).status, 400);
});

test('link sai mã / đã hết hạn → trang báo hết hạn (404), file hết hạn bị xoá khỏi máy', async () => {
  const bad = await fetch(`${base}/f/khong-co-ma-nay-1234567890/a.xlsx`);
  assert.equal(bad.status, 404);
  assert.match(await bad.text(), /hết hạn/);
  const j = await (await post('het_han.xlsx', Buffer.from('abc'))).json();
  const t = tokOf(j.url); made.push(t);
  assert.ok(S.shareFilePath(t), 'còn hạn');
  assert.equal(S.shareFilePath(t, Date.now() + S.SHARE_TTL_MS + 60000), null, 'quá 3 ngày');
  const { dataDir } = await import('../server/db.js');
  assert.equal(existsSync(join(dataDir(), 'chia-se', t)), false, 'đã xoá thư mục link hết hạn');
  assert.equal((await fetch(base.replace(/\/api$/, '') + j.url)).status, 404);
});
