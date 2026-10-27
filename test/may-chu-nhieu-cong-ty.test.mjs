// MÁY CHỦ NHIỀU CÔNG TY (MULTI_TENANT=1): dữ liệu các công ty phải TÁCH RỜI hoàn toàn.
// Phần 1 (trong tiến trình): gọi thẳng hàm trong ngữ cảnh từng công ty — CSDL, sao lưu, bản quyền, hẹn giờ.
// Phần 2 (chạy server/index.js thật ở tiến trình riêng): tra công ty theo tên miền, API /_host cần mã, khoá công ty,
// khởi động lại vẫn mở đủ công ty, và không có lỗi "thiếu ngữ cảnh" nào trong nhật ký.
// node --test chạy mỗi file ở tiến trình RIÊNG → đặt biến môi trường ở đây không ảnh hưởng test khác.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { rmSync, existsSync, readdirSync, readFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer, request } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = mkdtempSync(join(tmpdir(), 'dgp-multi-'));
const TOKEN = 'thu-nghiem-ma-may-chu-1234567890';
process.env.MULTI_TENANT = '1';
process.env.TENANTS_DIR = join(TMP, 'p1');
process.env.HOST_TOKEN = TOKEN;
delete process.env.DB_PATH;

let H, T, D, B, L;
before(async () => {
  H = await import('../server/host.js');
  T = await import('../server/tenant.js');
  D = await import('../server/db.js');
  B = await import('../server/backup.js');
  L = await import('../server/license.js');
});
after(async () => {
  await stopServer();
  for (const t of T.openTenants()) try { t.db.close(); } catch {}
  try { rmSync(TMP, { recursive: true, force: true }); } catch {}
});

const as = (slug, fn) => T.runAsTenant(T.tenantBySlug(slug), fn);

/* ------------------------------ PHẦN 1: TRONG TIẾN TRÌNH ------------------------------ */
test('đọc CSDL khi KHÔNG có ngữ cảnh công ty → báo lỗi, không đoán sang công ty nào', () => {
  assert.throws(() => D.db.prepare('SELECT 1').get(), /Không xác định được công ty/);
  assert.throws(() => D.getSetting('company_name', ''), /Không xác định được công ty/);
  assert.throws(() => T.dataDir(), /Không xác định được công ty/);
});

test('tạo công ty: mã sai / mã dành riêng → 400, trùng → 409', () => {
  const a = H.createTenant({ slug: 'cta', name: 'Công ty A' });
  assert.equal(a.slug, 'cta');
  assert.equal(a.admin_user, 'admin');
  assert.match(a.admin_pass, /^[a-z2-9]{8}$/);
  H.createTenant({ slug: 'ctb', name: 'Công ty B' });
  for (const slug of ['', 'A B', '-abc', 'abc-', 'www', 'huongdan', 'x'.repeat(41), '../ctb'])
    assert.throws(() => H.createTenant({ slug }), (e) => e.status === 400, `mã "${slug}" phải bị từ chối`);
  assert.throws(() => H.createTenant({ slug: 'cta' }), (e) => e.status === 409);
  assert.throws(() => H.createTenant({ slug: 'CTA' }), (e) => e.status === 409);
});

test('mỗi công ty 1 thư mục + CSDL riêng', () => {
  for (const s of ['cta', 'ctb']) assert.ok(existsSync(join(TMP, 'p1', s, 'data', 'digiplus.db')));
  assert.equal(as('cta', () => D.getSetting('company_name')), 'Công ty A');
  assert.equal(as('ctb', () => D.getSetting('company_name')), 'Công ty B');
  assert.equal(as('cta', () => D.dbPath()), join(TMP, 'p1', 'cta', 'data', 'digiplus.db'));
});

test('nhân viên thêm ở công ty A không hiện ở công ty B', () => {
  as('cta', () => D.db.prepare("INSERT INTO employees(code,full_name,username,password_hash,role,active) VALUES('A001','Nhân viên A','a001','x','employee',1)").run());
  const cnt = (s) => as(s, () => D.db.prepare("SELECT COUNT(*) c FROM employees WHERE code='A001'").get().c);
  assert.equal(cnt('cta'), 1);
  assert.equal(cnt('ctb'), 0);
});

test('mật khẩu admin ban đầu riêng từng công ty (không còn admin123)', async () => {
  const { verifyPassword } = await import('../server/auth.js');
  const h = (s) => as(s, () => D.db.prepare("SELECT password_hash FROM employees WHERE username='admin'").get().password_hash);
  assert.notEqual(h('cta'), h('ctb'));
  assert.equal(verifyPassword('admin123', h('cta')), false);
});

test('Mã máy (bản quyền) khác nhau giữa các công ty, file bản quyền nằm trong thư mục công ty', () => {
  const ma = as('cta', () => L.licenseState().machineId), mb = as('ctb', () => L.licenseState().machineId);
  assert.ok(ma && mb);
  assert.notEqual(ma, mb);
  assert.equal(as('cta', () => L.licenseState().activated), false);
  assert.equal(as('cta', () => T.dataDir()), join(TMP, 'p1', 'cta', 'data'));
});

test('sao lưu của công ty A nằm trong thư mục A, công ty B không thấy', () => {
  const r = as('cta', () => B.doBackup('manual'));
  assert.ok(existsSync(join(TMP, 'p1', 'cta', 'data', 'backups', r.name)));
  assert.equal(as('ctb', () => B.listBackups()).length, 0);
  assert.equal(as('ctb', () => B.backupPath(r.name)), null);
});

test('sao lưu TOÀN BỘ (.zip) của A phục hồi vào công ty mới C (đường chuyển khách cũ vào máy chủ)', async () => {
  const z = as('cta', () => B.doFullBackup());
  const buf = readFileSync(join(TMP, 'p1', 'cta', 'data', 'backups', z.name));
  H.createTenant({ slug: 'ctc', name: 'Công ty C' });
  as('ctc', () => B.stageFullRestore(buf));
  assert.equal(await H.reloadTenant('ctc'), true);
  assert.equal(as('ctc', () => D.db.prepare("SELECT COUNT(*) c FROM employees WHERE code='A001'").get().c), 1);
  assert.equal(as('cta', () => D.db.prepare("SELECT COUNT(*) c FROM employees WHERE code='A001'").get().c), 1);
  assert.equal(as('ctb', () => D.db.prepare("SELECT COUNT(*) c FROM employees WHERE code='A001'").get().c), 0);
});

test('hẹn giờ chạy lần lượt từng công ty, bỏ qua công ty đang khoá; lỗi 1 công ty không chặn công ty khác', async () => {
  const seen = [];
  await T.eachTenant(() => { seen.push(T.tenantKey()); if (T.tenantKey() === 'cta') throw new Error('thử lỗi'); });
  assert.deepEqual(seen.sort(), ['cta', 'ctb', 'ctc']);
  assert.equal(H.setTenantDisabled('ctb', true), true);
  const seen2 = [];
  await T.eachTenant(() => { seen2.push(T.tenantKey()); });
  assert.deepEqual(seen2.sort(), ['cta', 'ctc']);
  H.setTenantDisabled('ctb', false);
});

test('cờ "đang bận" riêng từng công ty', () => {
  const f = T.busyFlag();
  assert.equal(as('cta', () => f.take()), true);
  assert.equal(as('cta', () => f.take()), false);
  assert.equal(as('ctb', () => f.take()), true);
  as('cta', () => f.done());
  assert.equal(as('cta', () => f.take()), true);
});

test('tra công ty theo tên miền: không nhận tên miền lạ / thiếu mã', () => {
  const r = (host) => H.resolveTenant({ headers: { host }, socket: {} })?.slug || null;
  assert.equal(r('cta.maychamcongcloud.com'), 'cta');
  assert.equal(r('CTB.maychamcongcloud.com:443'), 'ctb');
  assert.equal(r('cta.localhost:8080'), 'cta');
  assert.equal(r('maychamcongcloud.com'), null);
  assert.equal(r('cta.maychamcongcloud.com.evil.vn'), null);
  assert.equal(r('khongco.maychamcongcloud.com'), null);
  assert.equal(r('a.b.maychamcongcloud.com'), null);
  assert.equal(r(''), null);
});

/* ------------------------------ PHẦN 2: CHẠY server/index.js THẬT ------------------------------ */
const freePort = () => new Promise((ok) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
let PORT, child, out = '';
function startServer() {
  out = '';
  return new Promise((ok, fail) => {
    child = spawn(process.execPath, ['--no-warnings', join(__dirname, '..', 'server', 'index.js')], {
      env: { ...process.env, PORT: String(PORT), TENANTS_DIR: join(TMP, 'p2'), MULTI_TENANT: '1', HOST_TOKEN: TOKEN },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const on = (d) => { out += d; if (/HTTP\s+\(máy này\)/.test(out)) ok(); };
    child.stdout.on('data', on); child.stderr.on('data', on);
    child.on('exit', (c) => fail(new Error('server thoát ' + c + '\n' + out)));
    setTimeout(() => fail(new Error('server không lên\n' + out)), 20000);
  });
}
const stopServer = () => new Promise((ok) => { if (!child || child.exitCode !== null) return ok(); child.removeAllListeners('exit'); child.on('exit', ok); child.kill(); });
function call(method, path, { host = 'localhost', body, token, headers = {} } = {}) {
  return new Promise((ok, fail) => {
    const data = body ? JSON.stringify(body) : null;
    const req = request({ host: '127.0.0.1', port: PORT, method, path, headers: {
      host: `${host}:${PORT}`, ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}),
      ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers,
    } }, (res) => {
      let s = ''; res.setEncoding('utf8'); res.on('data', (d) => (s += d));
      res.on('end', () => { let j = null; try { j = JSON.parse(s); } catch {} ok({ status: res.statusCode, json: j, text: s }); });
    });
    req.on('error', fail);
    if (data) req.write(data);
    req.end();
  });
}

test('máy chủ thật: API /_host bắt buộc đúng mã', { timeout: 60000 }, async () => {
  PORT = await freePort();
  await startServer();
  assert.equal((await call('GET', '/_host/ping')).status, 401);
  assert.equal((await call('GET', '/_host/ping', { token: 'sai-ma-may-chu-0000000000000000' })).status, 401);
  assert.equal((await call('GET', '/_host/ping', { token: TOKEN.slice(0, -1) })).status, 401);
  const p = await call('GET', '/_host/ping', { token: TOKEN });
  assert.equal(p.status, 200);
  assert.equal(p.json.tenants, 0);
});

test('máy chủ thật: tạo 2 công ty qua API, mỗi tên miền ra đúng công ty', async () => {
  const a = await call('POST', '/_host/tenants', { token: TOKEN, body: { slug: 'aa', name: 'Công ty AA' } });
  assert.equal(a.status, 200, a.text);
  assert.ok(a.json.admin_pass && a.json.machine_id);
  const b = await call('POST', '/_host/tenants', { token: TOKEN, body: { slug: 'bb', name: 'Công ty BB' } });
  assert.equal(b.status, 200, b.text);
  assert.notEqual(a.json.machine_id, b.json.machine_id);
  assert.equal((await call('POST', '/_host/tenants', { token: TOKEN, body: { slug: 'aa' } })).status, 409);
  assert.equal((await call('GET', '/api/brand', { host: 'aa.localhost' })).json.company_name, 'Công ty AA');
  assert.equal((await call('GET', '/api/brand', { host: 'bb.localhost' })).json.company_name, 'Công ty BB');
  assert.equal((await call('GET', '/api/brand', { host: 'bb.maychamcongcloud.com' })).json.company_name, 'Công ty BB');
  // Giả tên miền qua x-forwarded-host không được tính
  assert.equal((await call('GET', '/api/brand', { host: 'aa.localhost', headers: { 'x-forwarded-host': 'bb.localhost' } })).json.company_name, 'Công ty AA');
  const la = await call('GET', '/api/license/status', { host: 'aa.localhost' });
  const lb = await call('GET', '/api/license/status', { host: 'bb.localhost' });
  assert.notEqual(la.json.machineId, lb.json.machineId);
  assert.equal(la.json.machineIdFmt, a.json.machine_id);
});

test('máy chủ thật: tên miền không có công ty → 404, không trả dữ liệu', async () => {
  for (const host of ['localhost', 'khongco.localhost', '127.0.0.1', 'maychamcongcloud.com']) {
    const r = await call('GET', '/api/brand', { host });
    assert.equal(r.status, 404, host);
    assert.ok(!/Công ty AA|Công ty BB/.test(r.text), host);
  }
});

test('máy chủ thật: chưa kích hoạt bản quyền → khoá API (riêng từng công ty)', async () => {
  const r = await call('POST', '/api/auth/login', { host: 'aa.localhost', body: { username: 'admin', password: 'x' } });
  assert.equal(r.status, 403);
  assert.equal(r.json.needLicense, true);
  const k = await call('POST', '/_host/tenants/aa/license', { token: TOKEN, body: { key: 'khong-hop-le' } });
  assert.equal(k.status, 400);
});

test('máy chủ thật: khoá công ty → 403, mở lại → chạy lại; công ty khác không ảnh hưởng', async () => {
  assert.equal((await call('POST', '/_host/tenants/bb/disable', { token: TOKEN })).json.ok, true);
  assert.equal((await call('GET', '/api/brand', { host: 'bb.localhost' })).status, 403);
  assert.equal((await call('GET', '/api/brand', { host: 'aa.localhost' })).status, 200);
  const list = await call('GET', '/_host/tenants', { token: TOKEN });
  assert.deepEqual(list.json.tenants.map((t) => [t.slug, t.disabled]).sort(), [['aa', false], ['bb', true]]);
  assert.equal((await call('POST', '/_host/tenants/bb/enable', { token: TOKEN })).json.ok, true);
  assert.equal((await call('GET', '/api/brand', { host: 'bb.localhost' })).status, 200);
});

test('máy chủ thật: cập nhật phần mềm từ trang công ty bị chặn (chỉ máy chủ cập nhật)', async () => {
  const r = await call('GET', '/_host/update', { host: 'aa.localhost' });
  assert.equal(r.status, 401);
});

test('máy chủ thật: khởi động lại vẫn mở đủ công ty, không lỗi "thiếu ngữ cảnh"', { timeout: 60000 }, async () => {
  await stopServer();
  await startServer();
  assert.match(out, /Đã mở 2 công ty/);
  assert.equal((await call('GET', '/api/brand', { host: 'aa.localhost' })).json.company_name, 'Công ty AA');
  assert.equal((await call('GET', '/api/brand', { host: 'bb.localhost' })).json.company_name, 'Công ty BB');
  assert.deepEqual(readdirSync(join(TMP, 'p2')).sort(), ['aa', 'bb']);
  await new Promise((r) => setTimeout(r, 1500));   // để các hẹn giờ lúc khởi động chạy 1 lượt
  assert.ok(!/thiếu ngữ cảnh|Không xác định được công ty/.test(out), out);
});
