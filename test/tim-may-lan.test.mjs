// Tìm máy chấm công trong mạng LAN + trỏ máy Push về tên miền qua SDK (cổng 4370).
// Máy giả lập: 1 cổng TCP mở (cho bước dò) + script PowerShell giả thay zk-tcp.ps1 (đọc / ghi cài đặt Cloud Server vào file trạng thái).
// Chạy: npm test (chỉ trên Windows — SDK chạy qua PowerShell)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, writeFileSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';

const WIN = process.platform === 'win32';
const DBP = join(tmpdir(), `dgp-lan-test-${process.pid}.db`);
const FAKE = join(tmpdir(), `dgp-lan-fake-${process.pid}.ps1`);
const STATE = join(tmpdir(), `dgp-lan-state-${process.pid}.json`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;
process.env.ZK_TCP_SCRIPT = FAKE;
process.env.FAKE_ZK_STATE = STATE;

// Máy giả: Comm Key sai → lỗi CONNECT như SDK thật; 'svr' in cài đặt; 'set-svr' ghi lại + đếm số lần khởi động lại
writeFileSync(FAKE, '﻿' + `param([string]$Ip, [int]$Port = 4370, [int]$Key = 0, [string]$Action = 'info', [string]$From = '', [string]$To = '', [int]$Machine = 1)
function Out($s) { [Console]::Out.WriteLine($s) }
$st = Get-Content $env:FAKE_ZK_STATE -Raw | ConvertFrom-Json
if ([int]$st.key -ne $Key) { Out "ERR\`tCONNECT-6\`tKhong ket noi duoc may $Ip"; exit 1 }
switch ($Action) {
  'svr' { foreach ($k in 'serial','model','firmware','svr_fun','svr_mode','svr_url','svr_port') { Out ("I\`t$k\`t" + $st.$k) }; Out "OK\`tsvr" }
  'set-svr' {
    $st.svr_fun = '1'; $st.svr_mode = '1'; $st.svr_url = $From; if ($To) { $st.svr_port = $To }
    $st.restarted = [int]$st.restarted + 1
    $st | ConvertTo-Json | Set-Content $env:FAKE_ZK_STATE
    Out "I\`tsvr_url\`t$From"; Out "I\`tsvr_port\`t$($st.svr_port)"; Out "OK\`tset-svr"
  }
  default { Out "ERR\`tBADACTION\`t$Action"; exit 1 }
}
`);
const setDev = (o) => writeFileSync(STATE, JSON.stringify({ key: 0, serial: 'ZK0001', model: 'Ronald Jack 3315', firmware: 'Ver 6.60', svr_fun: '0', svr_mode: '0', svr_url: '', svr_port: '8081', restarted: 0, ...o }));
const dev = () => JSON.parse(readFileSync(STATE, 'utf8'));

let db, devPort, devSrv;
const routes = {};
const call = async (key, body = {}) => {
  const hs = routes[key]; assert.ok(hs, 'thiếu route ' + key);
  let out = null, code = 200, i = 0;
  const res = { status(c) { code = c; return this; }, json(o) { out = o; return this; } };
  const req = { body, params: {}, query: {}, user: { id: 1, role: 'admin', master: true } };
  const next = async () => { const h = hs[i++]; if (h) await h(req, res, next); };
  await next();
  return { code, out };
};

before(async () => {
  devSrv = createServer((s) => s.end());
  await new Promise((ok) => devSrv.listen(0, '127.0.0.1', ok));
  devPort = devSrv.address().port;
  process.env.ZK_SCAN_HOSTS = `127.0.0.1:${devPort}`;
  const D = await import('../server/db.js');
  db = D.db; D.initSchema(); D.setSetting('device_enabled', '1');
  const add = (m) => (p, ...h) => { routes[`${m} ${p}`] = h; };
  (await import('../server/routes/admin/devices.js')).registerDeviceRoutes({ get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE') }, { need: () => (q, s, n) => n() });
});
after(() => { devSrv?.close(); for (const f of [FAKE, STATE]) { try { rmSync(f); } catch {} } });

const withDomain = (slug) => { process.env.CUSTOMER = slug; process.env.TUNNEL_TOKEN = slug ? 'tok' : ''; };

test('dò LAN thấy máy, đọc được máy đang trỏ về đâu (chưa trỏ về phần mềm này)', { skip: !WIN }, async () => {
  withDomain('abc1'); setDev({ svr_fun: '1', svr_mode: '1', svr_url: 'phanmemcu.example.com' });
  const { code, out } = await call('POST /devices/lan-scan');
  assert.equal(code, 200);
  assert.equal(out.domain, 'abc1.maychamcongcloud.com');
  assert.equal(out.enabled, true);
  assert.equal(out.rows.length, 1);
  const r = out.rows[0];
  assert.equal(r.ip, '127.0.0.1'); assert.equal(r.port, devPort);
  assert.equal(r.serial, 'ZK0001'); assert.equal(r.model, 'Ronald Jack 3315');
  assert.equal(r.svr_url, 'phanmemcu.example.com');
  assert.equal(r.points_here, false);
  assert.equal(r.known, undefined);
  assert.equal(dev().restarted, 0, 'chỉ dò thì KHÔNG được đụng vào máy');
});

test('trỏ về tên miền: ghi đủ 3 khoá, cổng 8081 (Cloudflare không nhận) đổi về 80, máy khởi động lại', { skip: !WIN }, async () => {
  withDomain('abc1'); setDev({ svr_port: '8081' });
  const { code, out } = await call('POST /devices/lan-point', { ip: '127.0.0.1', port: devPort });
  assert.equal(code, 200, JSON.stringify(out));
  assert.equal(out.domain, 'abc1.maychamcongcloud.com');
  assert.equal(out.serial, 'ZK0001');
  const s = dev();
  assert.deepEqual([s.svr_fun, s.svr_mode, s.svr_url, s.svr_port], ['1', '1', 'abc1.maychamcongcloud.com', '80']);
  assert.equal(s.restarted, 1);
  // dò lại: đã trỏ về đây; máy đã gọi về (có trong danh sách, chờ duyệt) → hiện "Đã về · Chờ duyệt"
  db.prepare("INSERT INTO push_devices(serial, name, active) VALUES('ZK0001','',0)").run();
  const again = await call('POST /devices/lan-scan');
  assert.equal(again.out.rows[0].points_here, true);
  assert.deepEqual({ ...again.out.rows[0].known, id: 0, last_seen: null }, { id: 0, name: '', active: false, last_seen: null });
});

test('cổng Cloudflare nhận (443) thì giữ nguyên', { skip: !WIN }, async () => {
  withDomain('abc1'); setDev({ svr_port: '443' });
  const { code } = await call('POST /devices/lan-point', { ip: '127.0.0.1', port: devPort });
  assert.equal(code, 200);
  assert.equal(dev().svr_port, '443');
});

test('máy đặt Comm Key: dò báo lỗi kết nối, trỏ kèm đúng mật mã thì được', { skip: !WIN }, async () => {
  withDomain('abc1'); setDev({ key: 1234 });
  const scan = await call('POST /devices/lan-scan');
  assert.match(scan.out.rows[0].code, /^CONNECT/);
  assert.equal(scan.out.rows[0].serial, undefined);
  const bad = await call('POST /devices/lan-point', { ip: '127.0.0.1', port: devPort });
  assert.equal(bad.code, 400); assert.equal(dev().restarted, 0);
  const ok = await call('POST /devices/lan-point', { ip: '127.0.0.1', port: devPort, key: '1234' });
  assert.equal(ok.code, 200, JSON.stringify(ok.out));
  assert.equal(dev().svr_url, 'abc1.maychamcongcloud.com');
});

test('chặn: bản LAN (không tên miền) không trỏ được; IP ngoài mạng nội bộ bị từ chối — máy không bị ghi', { skip: !WIN }, async () => {
  setDev({});
  withDomain('');
  const scan = await call('POST /devices/lan-scan');
  assert.equal(scan.out.domain, ''); assert.equal(scan.out.rows[0].points_here, false);
  const noDomain = await call('POST /devices/lan-point', { ip: '127.0.0.1', port: devPort });
  assert.equal(noDomain.code, 400); assert.match(noDomain.out.error, /chưa có tên miền/);
  withDomain('abc1');
  const pub = await call('POST /devices/lan-point', { ip: '8.8.8.8', port: devPort });
  assert.equal(pub.code, 400); assert.match(pub.out.error, /mạng nội bộ/);
  const badIp = await call('POST /devices/lan-point', { ip: '999.1.1.1' });
  assert.equal(badIp.code, 400);
  assert.equal(dev().restarted, 0);
});
