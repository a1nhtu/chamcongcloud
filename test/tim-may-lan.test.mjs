// Tìm máy chấm công trong mạng LAN + trỏ máy Push về tên miền qua SDK (cổng 4370).
// Máy giả lập: 1 cổng TCP mở (cho bước dò) + script PowerShell giả thay zk-tcp.ps1 (đọc / ghi cài đặt Cloud Server vào file trạng thái).
// Chạy: npm test (chỉ trên Windows — SDK chạy qua PowerShell)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, writeFileSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import dgram from 'node:dgram';

const WIN = process.platform === 'win32';
const DBP = join(tmpdir(), `dgp-lan-test-${process.pid}.db`);
const FAKE = join(tmpdir(), `dgp-lan-fake-${process.pid}.ps1`);
const STATE = join(tmpdir(), `dgp-lan-state-${process.pid}.json`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;
process.env.ZK_TCP_SCRIPT = FAKE;
process.env.FAKE_ZK_STATE = STATE;
process.env.ZK_RECHECK_MS = '400';   // hỏi lại máy chưa thấy cổng: chờ ngắn cho test nhanh
process.env.ZK_RETRY_MS = '50';

// Máy giả: Comm Key sai / máy bận → lỗi CONNECT như SDK thật; 'svr' in cài đặt; 'set-svr' ghi lại + đếm số lần khởi động lại + giao thức (-Proto)
writeFileSync(FAKE, '﻿' + `param([string]$Ip, [int]$Port = 4370, [int]$Key = 0, [string]$Action = 'info', [string]$From = '', [string]$To = '', [int]$Machine = 1, [string]$Proto = '')
function Out($s) { [Console]::Out.WriteLine($s) }
$st = Get-Content $env:FAKE_ZK_STATE -Raw | ConvertFrom-Json
if ($env:FAKE_ZK_DEAD_PORT -and $Port -eq [int]$env:FAKE_ZK_DEAD_PORT) { Out "ERR\`tCONNECT-1\`tKhong ket noi duoc may $Ip"; exit 1 }
if ($st.busy) { Out "ERR\`tCONNECT-201\`tKhong ket noi duoc may $Ip"; exit 1 }
if ([int]$st.key -ne $Key) { Out "ERR\`tCONNECT-6\`tKhong ket noi duoc may $Ip"; exit 1 }
switch ($Action) {
  'svr' { foreach ($k in 'serial','model','firmware','svr_fun','svr_mode','svr_url','svr_port') { Out ("I\`t$k\`t" + $st.$k) }; Out "OK\`tsvr" }
  'set-svr' {
    $st.svr_fun = '1'; $st.svr_mode = '1'; $st.svr_url = $From; if ($To) { $st.svr_port = $To }
    $st.restarted = [int]$st.restarted + 1; $st.proto = $Proto
    $st | ConvertTo-Json | Set-Content $env:FAKE_ZK_STATE
    Out "I\`tsvr_url\`t$From"; Out "I\`tsvr_port\`t$($st.svr_port)"; Out "OK\`tset-svr"
  }
  default { Out "ERR\`tBADACTION\`t$Action"; exit 1 }
}
`);
const setDev = (o) => writeFileSync(STATE, JSON.stringify({ key: 0, busy: false, proto: '', serial: 'ZK0001', model: 'Ronald Jack 3315', firmware: 'Ver 6.60', svr_fun: '0', svr_mode: '0', svr_url: '', svr_port: '8081', restarted: 0, ...o }));
const dev = () => JSON.parse(readFileSync(STATE, 'utf8'));

// Máy giả nói giao thức ZK như máy thật (Ronald Jack 3315 FW 6.60 đo 28/10): CMD_CONNECT (1000) → LUÔN 2005 "cần xác thực";
// CMD_AUTH (1102) kèm mật khẩu mã hoá → 2000 nếu đúng Comm Key (kể cả 0), sai → 2005; đang bận → im lặng; CMD_EXIT → 2000
let ZKM;
const zkAnswer = (p) => {
  if (dev().busy) return null;
  const cmd = p.readUInt16LE(0), h = Buffer.alloc(8);
  const code = cmd === 1000 ? 2005 : cmd === 1102 ? (p.subarray(8, 12).equals(ZKM.zkCommKey(dev().key, 77)) ? 2000 : 2005) : 2000;
  h.writeUInt16LE(code, 0); h.writeUInt16LE(77, 4); return h;
};
const zkTcp = () => createServer((s) => {
  s.on('error', () => {});
  s.on('data', (d) => {
    if (d.length < 16 || d.readUInt16LE(0) !== 0x5050) return s.end();
    const h = zkAnswer(d.subarray(8)); if (!h) return;
    const t = Buffer.alloc(8); t.writeUInt16LE(0x5050, 0); t.writeUInt16LE(0x7d82, 2); t.writeUInt32LE(8, 4);
    s.write(Buffer.concat([t, h]));
  });
});
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
  devSrv = zkTcp();
  await new Promise((ok) => devSrv.listen(0, '127.0.0.1', ok));
  devPort = devSrv.address().port;
  process.env.ZK_SCAN_HOSTS = `127.0.0.1:${devPort}`;
  ZKM = await import('../server/zk-tcp.js');
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

test('máy đặt Comm Key: dò báo RÕ "cần mật khẩu kết nối", nhập sai báo "sai mật khẩu", đúng mật khẩu thì trỏ được', { skip: !WIN }, async () => {
  withDomain('abc1'); setDev({ key: 1234 });
  const scan = await call('POST /devices/lan-scan');
  assert.equal(scan.out.rows[0].code, 'NEEDKEY');
  assert.match(scan.out.rows[0].error, /mật khẩu kết nối \(Comm Key\)/);
  assert.equal(scan.out.rows[0].serial, undefined);
  const bad = await call('POST /devices/lan-point', { ip: '127.0.0.1', port: devPort });
  assert.equal(bad.code, 400); assert.equal(bad.out.code, 'NEEDKEY'); assert.equal(dev().restarted, 0);
  const wrong = await call('POST /devices/lan-point', { ip: '127.0.0.1', port: devPort, key: '999' });
  assert.equal(wrong.code, 400); assert.equal(wrong.out.code, 'WRONGKEY'); assert.match(wrong.out.error, /Sai mật khẩu kết nối/);
  assert.equal(dev().restarted, 0);
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

test('đọc bảng ARP: lấy IP + MAC, nhận máy ZKTeco theo MAC 00:17', async () => {
  const { parseArp, isZkMac } = await import('../server/zk-tcp.js');
  const a = parseArp(`Interface: 192.168.1.218 --- 0x7
  Internet Address      Physical Address      Type
  192.168.1.1           a4-91-b1-22-33-44     dynamic
  192.168.1.244         00-17-61-12-ab-cd     dynamic
  192.168.1.255         ff-ff-ff-ff-ff-ff     static`);
  assert.deepEqual(a[1], { ip: '192.168.1.244', mac: '00:17:61:12:AB:CD' });
  assert.equal(a.length, 3);
  assert.deepEqual(a.map((x) => isZkMac(x.mac)), [false, true, false]);
});

// máy giả chỉ mở cổng "8818" (cổng ngẫu nhiên thay cho 8818) ở 127.0.0.2, cổng 4370 đóng
const with8818 = async (fn) => {
  const extra = createServer((s) => s.end());
  await new Promise((ok) => extra.listen(0, '127.0.0.2', ok));
  const keep = process.env.ZK_SCAN_HOSTS, p = extra.address().port;
  process.env.ZK_SCAN_EXTRA_PORT = String(p);
  process.env.ZK_SCAN_HOSTS = `${keep},127.0.0.2:1`;
  try { await fn(p); } finally { process.env.ZK_SCAN_HOSTS = keep; delete process.env.ZK_SCAN_EXTRA_PORT; delete process.env.FAKE_ZK_DEAD_PORT; extra.close(); }
};

test('máy đóng cổng 4370, cổng 8818 nhận SDK: đọc được + trỏ tự động qua 8818', { skip: !WIN }, async () => {
  withDomain('abc1'); setDev({ svr_port: '8081' });
  await with8818(async (p) => {
    const { out } = await call('POST /devices/lan-scan');
    const r = out.rows.find((x) => x.ip === '127.0.0.2');
    assert.equal(r.no_sdk, undefined); assert.equal(r.port, p); assert.equal(r.serial, 'ZK0001');
    assert.equal(dev().restarted, 0, 'chỉ dò thì KHÔNG được đụng vào máy');
    const pt = await call('POST /devices/lan-point', { ip: '127.0.0.2', port: p });
    assert.equal(pt.code, 200, JSON.stringify(pt.out));
    assert.equal(dev().svr_url, 'abc1.maychamcongcloud.com'); assert.equal(dev().svr_port, '80'); assert.equal(dev().restarted, 1);
  });
});

test('máy đóng cổng 4370, cổng 8818 KHÔNG nhận SDK: vẫn hiện, báo cài tay, không trỏ', { skip: !WIN }, async () => {
  withDomain('abc1'); setDev({});
  await with8818(async (p) => {
    process.env.FAKE_ZK_DEAD_PORT = String(p);
    const { out } = await call('POST /devices/lan-scan');
    assert.equal(out.rows.length, 2);
    const r = out.rows.find((x) => x.ip === '127.0.0.2');
    assert.equal(r.no_sdk, true); assert.equal(r.sdk_tried, p);
    assert.deepEqual(r.ports, [p]);
    assert.equal(r.serial, undefined);
    assert.equal(out.rows.find((x) => x.ip === '127.0.0.1').serial, 'ZK0001', 'máy mở 4370 vẫn đọc như cũ');
    assert.equal(dev().restarted, 0);
  });
});

test('gói bắt tay ZK giống hệt thư viện pyzk (CMD_CONNECT qua TCP = 5050827d08000000e80317fc00000000)', async () => {
  const { zkPacket, zkReply } = await import('../server/zk-tcp.js');
  assert.equal(zkPacket(1000, 0, 65534, true).toString('hex'), '5050827d08000000e80317fc00000000');
  assert.equal(zkPacket(1000).toString('hex'), 'e80317fc00000000');
  assert.deepEqual(zkReply(Buffer.from('5050827d08000000d007000004d20100', 'hex'), true), { cmd: 2000, session: 0xd204, reply: 1, size: 16 });
  assert.equal(zkReply(Buffer.from('d007', 'hex')), null);
  // mã hoá mật khẩu kết nối cho CMD_AUTH (pyzk make_commkey): Comm Key 0, phiên 0x1234 → 617d326b (đã đối chiếu máy thật 172.16.1.42: key 0 vào được, key sai bị từ chối)
  const { zkCommKey } = await import('../server/zk-tcp.js');
  assert.equal(zkCommKey(0, 0x1234).toString('hex'), '617d326b');
  assert.notEqual(zkCommKey(1234, 0x1234).toString('hex'), '617d326b');
});

test('máy đang bận (kết nối được mà không trả lời): thử lại rồi báo "máy đang bận", không nói nhầm là đóng cổng', { skip: !WIN }, async () => {
  withDomain('abc1'); setDev({ busy: true });
  const { out } = await call('POST /devices/lan-scan');
  const r = out.rows[0];
  assert.equal(r.code, 'BUSY'); assert.match(r.error, /không trả lời/); assert.equal(r.no_sdk, undefined);
  setDev({});   // phần mềm kia nhả máy → bấm Trỏ là được
  const pt = await call('POST /devices/lan-point', { ip: '127.0.0.1', port: devPort });
  assert.equal(pt.code, 200, JSON.stringify(pt.out));
});

// máy giả CHỈ nói UDP: không có cổng TCP nào mở, chỉ socket UDP trả lời bắt tay ZK
test('máy đời cũ chỉ trả lời UDP 4370: dò ra (không báo đóng cổng), đọc + trỏ qua SDK với -Proto udp', { skip: !WIN }, async () => {
  withDomain('abc1'); setDev({});
  const u = dgram.createSocket('udp4');
  u.on('message', (m, from) => { const h = zkAnswer(m); if (h) u.send(h, from.port, from.address); });
  await new Promise((ok) => u.bind(0, '127.0.0.3', ok));
  const p = u.address().port, keep = process.env.ZK_SCAN_HOSTS;
  process.env.ZK_SCAN_HOSTS = `127.0.0.3:${p}`;
  try {
    const { out } = await call('POST /devices/lan-scan');
    const r = out.rows[0];
    assert.equal(r.udp, true); assert.equal(r.no_sdk, undefined); assert.equal(r.port, p); assert.equal(r.serial, 'ZK0001');
    const pt = await call('POST /devices/lan-point', { ip: '127.0.0.3', port: p, udp: true });
    assert.equal(pt.code, 200, JSON.stringify(pt.out));
    assert.equal(dev().proto, 'udp'); assert.equal(dev().svr_url, 'abc1.maychamcongcloud.com');
  } finally { process.env.ZK_SCAN_HOSTS = keep; u.close(); }
});

// bảng ARP giả: chỉ thấy MAC ZKTeco, không thấy cổng nào trong lượt dò nhanh
const withArp = async (arp, fn) => {
  const keep = process.env.ZK_SCAN_HOSTS;
  process.env.ZK_SCAN_HOSTS = '127.0.0.9:1'; process.env.ZK_SCAN_ARP = arp;
  try { await fn(); } finally { process.env.ZK_SCAN_HOSTS = keep; delete process.env.ZK_SCAN_ARP; }
};

test('MAC 00:17 chỉ còn trong bộ nhớ ARP (máy đã tắt / đổi IP): báo "máy không trả lời", KHÔNG báo đóng cổng 4370', { skip: !WIN }, async () => {
  withDomain('abc1'); setDev({});
  await withArp('192.0.2.7 00-17-61-11-54-00', async () => {
    const { out } = await call('POST /devices/lan-scan');
    const r = out.rows.find((x) => x.ip === '192.0.2.7');
    assert.ok(r, JSON.stringify(out.rows));
    assert.equal(r.offline, true); assert.equal(r.no_sdk, true); assert.equal(r.closed, undefined);
    assert.equal(r.mac, '00:17:61:11:54:00');
  });
});

test('máy đang bật nhưng TỪ CHỐI cổng 4370 (cổng SDK tắt trên máy): báo đúng "từ chối", khác với máy tắt', { skip: !WIN }, async () => {
  withDomain('abc1'); setDev({});
  await withArp('127.0.0.4 00-17-61-aa-bb-cc', async () => {
    const { out } = await call('POST /devices/lan-scan');
    const r = out.rows.find((x) => x.ip === '127.0.0.4');
    assert.ok(r, JSON.stringify(out.rows));
    assert.equal(r.no_sdk, true); assert.equal(r.closed, true); assert.equal(r.offline, undefined);
  });
  const pt = await call('POST /devices/lan-point', { ip: '127.0.0.4', port: 4370 });
  assert.equal(pt.code, 400); assert.equal(pt.out.code, 'CLOSED');
  assert.equal(dev().restarted, 0);
});

test('máy lỡ trả lời ở lượt dò nhanh (chỉ thấy MAC): hỏi lại thấy cổng 4370 mở → đọc + trỏ tự động bình thường', { skip: !WIN }, async () => {
  withDomain('abc1'); setDev({});
  const srv = zkTcp();
  const bound = await new Promise((ok) => { srv.once('error', () => ok(false)); srv.listen(4370, '127.0.0.5', () => ok(true)); });
  if (!bound) return;   // cổng 4370 trên máy chạy test đang bận → bỏ qua
  try {
    await withArp('127.0.0.5 00-17-61-12-34-56', async () => {
      const { out } = await call('POST /devices/lan-scan');
      const r = out.rows.find((x) => x.ip === '127.0.0.5');
      assert.equal(r.no_sdk, undefined); assert.equal(r.port, 4370); assert.equal(r.serial, 'ZK0001');
    });
  } finally { srv.close(); }
});

test('nhận MAC ZKTeco cả các dải khác 00:17 (như tool Tìm máy chấm công)', async () => {
  const { isZkMac } = await import('../server/zk-tcp.js');
  assert.equal(isZkMac('00:17:61:11:54:00'), true);
  assert.equal(isZkMac('68:17:5A:01:02:03'), true);
  assert.equal(isZkMac('14:49:BC:8C:02:38'), false);
});
