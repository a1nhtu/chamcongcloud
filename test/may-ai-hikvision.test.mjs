// Máy chấm công HÃNG KHÁC (v1.22.0): máy AI (tự nối về qua WebSocket) + máy Hikvision (phần mềm gọi ISAPI vào máy).
// Máy AI giả lập = client WebSocket thật nói đúng giao thức websocket+json 2.0; máy Hikvision giả lập = máy chủ ISAPI có Digest.
// Kèm phần chứng minh: 2 công tắc mặc định TẮT, tắt = như cũ (từ chối kết nối / route báo lỗi, lệnh ZKTeco không lọt sang máy hãng khác).
// Chạy: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { createHash } from 'node:crypto';

const DBP = join(tmpdir(), `dgp-ai-hik-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;
process.env.AI_TICK_MS = '100';    // nhịp gửi lệnh / kiểm tra kết nối nhanh cho test
process.env.AI_REPLY_MS = '4000';

let db, getSetting, setSetting, S, AI, WS, HIK, ZK;
const routes = {};
const ADMIN = { id: 999999, role: 'admin', full_name: 'Admin', master: true };
const call = async (key, { body = {}, params = {} } = {}) => {
  const hs = routes[key]; assert.ok(hs, 'thiếu route ' + key);
  let out = null, code = 200, i = 0;
  const res = { status(c) { code = c; return this; }, json(o) { out = o; return this; } };
  const req = { body, params, query: {}, user: ADMIN };
  const next = async () => { const h = hs[i++]; if (h) await h(req, res, next); };
  await next();
  return { code, out };
};
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('hết giờ chờ'); await sleep(25); } };
const waitJob = async (id) => { for (;;) { const j = ZK.getJob(id); if (j.state !== 'run') return j; await sleep(20); } };
const devId = (serial) => db.prepare('SELECT id FROM push_devices WHERE serial=?').get(serial).id;
const md5 = (s) => createHash('md5').update(s).digest('hex');

/* ---------- máy AI giả lập (client WebSocket) ---------- */
let appSrv, appPort;
function aiClient() {
  const ws = new WebSocket(`ws://127.0.0.1:${appPort}/`);
  const q = [], waiters = [];
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); const w = waiters.shift(); if (w) w(m); else q.push(m); });
  const open = new Promise((ok, no) => { ws.addEventListener('open', ok); ws.addEventListener('error', no); });
  const closed = new Promise((ok) => ws.addEventListener('close', ok));
  const next = (ms = 4000) => (q.length ? Promise.resolve(q.shift()) : new Promise((ok, no) => {
    const w = (m) => { clearTimeout(t); ok(m); };
    const t = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); no(new Error('máy AI giả lập: chờ tin quá lâu')); }, ms);
    waiters.push(w);
  }));
  return { ws, open, closed, next, send: (o) => ws.send(typeof o === 'string' ? o : JSON.stringify(o)), close: () => ws.close() };
}

/* ---------- máy Hikvision giả lập (ISAPI + Digest) ---------- */
const H = { user: 'admin', pass: 'Abc12345', realm: 'DS-K1T341', nonce: 'n0nce123', serial: 'DS-K1T341AMF20220101V010101ENG12345678', setup: [], deleted: [], attrAsked: 0 };
let hikSrv, hikPort;
function checkDigest(h, method, uri) {
  if (!String(h || '').startsWith('Digest ')) return false;
  const p = {}; for (const x of h.slice(7).matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g)) p[x[1]] = x[2] ?? x[3];
  if (p.username !== H.user || p.uri !== uri || p.nonce !== H.nonce) return false;
  const ha1 = md5(`${H.user}:${H.realm}:${H.pass}`), ha2 = md5(`${method}:${uri}`);
  return p.response === md5(`${ha1}:${p.nonce}:${p.nc}:${p.cnonce}:${p.qop}:${ha2}`);
}
const EVENTS = [
  { major: 5, minor: 75, time: '2026-10-15T08:00:05+08:00', employeeNoString: '101', attendanceStatus: 'checkIn' },   // khuôn mặt OK
  { major: 5, minor: 76, time: '2026-10-15T08:00:20+08:00', employeeNoString: '101' },                                // khuôn mặt KHÔNG khớp → bỏ
  { major: 5, minor: 38, time: '2026-10-15T17:30:00+08:00', employeeNoString: '101', attendanceStatus: 'checkOut' },  // vân tay OK, chấm RA
  { major: 5, minor: 75, time: '2026-10-18T08:00:00+08:00', employeeNoString: '102' },                                // ngoài khoảng ngày → bỏ
];
function hikHandler(req, res) {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (!checkDigest(req.headers.authorization, req.method, req.url)) {
      res.writeHead(401, { 'WWW-Authenticate': `Digest qop="auth", realm="${H.realm}", nonce="${H.nonce}", stale="FALSE"` }); return res.end();
    }
    const body = raw ? JSON.parse(raw.trimStart().startsWith('{') ? raw : '{}') : {};
    const json = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    const u = req.url;
    if (u === '/ISAPI/System/deviceInfo') {
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      return res.end(`<?xml version="1.0"?><DeviceInfo><deviceName>Cong chinh</deviceName><model>DS-K1T341AMF</model><serialNumber>${H.serial}</serialNumber><macAddress>aa:bb:cc</macAddress><firmwareVersion>V3.2.30</firmwareVersion><firmwareReleasedDate>build 220101</firmwareReleasedDate></DeviceInfo>`);
    }
    if (u.startsWith('/ISAPI/AccessControl/UserInfo/Count')) return json({ UserInfoCount: { userNumber: 2 } });
    if (u.startsWith('/ISAPI/AccessControl/AcsEventTotalNum')) return json({ AcsEventTotalNum: { totalNum: 4 } });
    if (u.startsWith('/ISAPI/AccessControl/UserInfo/Search')) {
      const pos = body.UserInfoSearchCond.searchResultPosition;
      if (pos === 0) return json({ UserInfoSearch: { searchID: 'x', responseStatusStrg: 'MORE', numOfMatches: 1, totalMatches: 3, UserInfo: [{ employeeNo: '101', name: 'Pham Van Hik', userType: 'normal', numOfFP: 1, numOfFace: 1, numOfCard: 0 }] } });
      return json({ UserInfoSearch: { searchID: 'x', responseStatusStrg: 'OK', numOfMatches: 2, totalMatches: 3, UserInfo: [{ employeeNo: '102', name: 'Do Thi Mat', userType: 'normal', numOfFace: 1 }, { employeeNo: '900', name: 'Khach', userType: 'visitor' }] } });
    }
    if (u.startsWith('/ISAPI/AccessControl/AcsEvent?')) {
      const c = body.AcsEventCond;
      if (c.eventAttribute) { H.attrAsked++; return json({ statusCode: 6, statusString: 'Invalid Content', subStatusCode: 'badParameters' }, 400); }   // firmware cũ
      const page = c.searchResultPosition === 0 ? EVENTS.slice(0, 2) : EVENTS.slice(2);
      return json({ AcsEvent: { searchID: c.searchID, responseStatusStrg: c.searchResultPosition === 0 ? 'MORE' : 'OK', numOfMatches: page.length, totalMatches: 4, InfoList: page } });
    }
    if (u.startsWith('/ISAPI/AccessControl/UserInfo/SetUp')) { H.setup.push(body.UserInfo); return json({ statusCode: 1, statusString: 'OK' }); }
    if (u.startsWith('/ISAPI/AccessControl/UserInfo/Delete')) { H.deleted.push(...body.UserInfoDelCond.EmployeeNoList.map((x) => x.employeeNo)); return json({ statusCode: 1, statusString: 'OK' }); }
    json({ statusCode: 4, statusString: 'Invalid Operation', subStatusCode: 'notSupport' }, 404);
  });
}

before(async () => {
  const D = await import('../server/db.js');
  db = D.db; getSetting = D.getSetting; setSetting = D.setSetting; D.initSchema();
  S = await import('../server/device-sync.js');
  AI = await import('../server/ai-device.js');
  WS = await import('../server/ai-ws.js');
  HIK = await import('../server/hik-isapi.js');
  ZK = await import('../server/zk-tcp.js');
  const add = (m) => (p, ...h) => { routes[`${m} ${p}`] = h; };
  (await import('../server/routes/admin/devices.js')).registerDeviceRoutes({ get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE') }, { need: () => (q, s, n) => n() });
  appSrv = createServer((req, res) => { res.writeHead(404); res.end(); });
  WS.attachAiWs(appSrv);
  await new Promise((ok) => appSrv.listen(0, '127.0.0.1', ok));
  appPort = appSrv.address().port;
  hikSrv = createServer(hikHandler);
  await new Promise((ok) => hikSrv.listen(0, '127.0.0.1', ok));
  hikPort = hikSrv.address().port;
});
after(() => { appSrv?.closeAllConnections?.(); appSrv?.close(); hikSrv?.close(); });

/* ======================= TẮT = NHƯ CŨ ======================= */
test('mặc định TẮT cả 2 công tắc: máy AI bị từ chối kết nối, route Hikvision / máy AI báo chưa bật', async () => {
  assert.equal(getSetting('ai_device_enabled', '0'), '0');
  assert.equal(getSetting('hik_device_enabled', '0'), '0');
  setSetting('device_enabled', '1');   // bật máy chấm công (ZKTeco) nhưng KHÔNG bật 2 hãng mới
  assert.equal(AI.aiEnabled(), false);
  assert.equal(HIK.hikEnabled(), false);
  const status = await new Promise((ok, no) => {
    const r = request({ host: '127.0.0.1', port: appPort, path: '/', headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version': '13' } });
    r.on('response', (res) => ok(res.statusCode)); r.on('upgrade', () => ok(101)); r.on('error', no); r.end();
  });
  assert.equal(status, 503);
  const r1 = await call('POST /devices/hik', { body: { ip: '127.0.0.1', port: hikPort, pass: H.pass } });
  assert.equal(r1.code, 400);
  const g = await call('GET /devices');
  assert.equal(g.out.ai_enabled, false); assert.equal(g.out.hik_enabled, false);
});

/* ======================= KHUNG WEBSOCKET + JSON MÁY AI ======================= */
test('khung WebSocket: mã hoá / giải mã đúng (có mask, 16-bit, 64-bit, tách khung dở)', () => {
  const mask = (buf) => { const m = Buffer.from([1, 2, 3, 4]); const f = WS.encodeFrame(buf, 1); const hl = f.length - buf.length;
    const out = Buffer.concat([f.subarray(0, hl), m, Buffer.from(buf.map((b, i) => b ^ m[i & 3]))]); out[1] |= 0x80; return out; };
  for (const n of [5, 300, 70000]) {
    const p = Buffer.alloc(n, 0x61);
    const { frames, rest } = WS.decodeFrames(mask(p));
    assert.equal(frames.length, 1); assert.equal(frames[0].payload.length, n); assert.equal(rest.length, 0);
  }
  const two = Buffer.concat([WS.encodeFrame(Buffer.from('{"a":1}')), WS.encodeFrame(Buffer.from('{"b":2}')).subarray(0, 4)]);
  const r = WS.decodeFrames(two);
  assert.equal(r.frames.length, 1); assert.equal(r.rest.length, 4);   // khung thứ 2 chưa đủ → để dành
});
test('JSON máy AI: chịu được dấu phẩy thừa + khoá có khoảng trắng', () => {
  const m = AI.parseMsg('{"ret":" getuserlist ","count ":1,"record ":[{"enrollid ":3,"backupnum ":0,},]}');
  assert.equal(m.count, 1); assert.equal(m.record[0].enrollid, 3);
});

/* ======================= MÁY AI ĐẦU-CUỐI ======================= */
let c1;
test('máy AI lạ kết nối → Chờ duyệt (máy nhận result:false, lượt chấm KHÔNG nhận)', async () => {
  setSetting('ai_device_enabled', '1');
  c1 = aiClient(); await c1.open;
  c1.send({ cmd: 'reg', sn: 'AI001', cpusn: 'c1', devinfo: { modelname: 'AI06F', usersize: 3000, firmware: 'ai v2' } });
  const r = await c1.next();
  assert.equal(r.ret, 'reg'); assert.equal(r.result, false);
  const d = db.prepare("SELECT * FROM push_devices WHERE serial='AI001'").get();
  assert.equal(d.conn_type, 'ai'); assert.equal(d.active, 0);
  c1.send({ cmd: 'sendlog', sn: 'AI001', count: 1, record: [{ enrollid: 5, time: '2026-10-15 08:01:00', mode: 0, inout: 0, event: 0 }] });
  assert.equal((await c1.next()).result, false);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM device_punches WHERE serial='AI001'").get().c, 0);
});
test('duyệt máy → phần mềm ngắt để máy đăng ký lại → result:true + giờ máy chủ', async () => {
  const r = await call('PUT /devices/:id', { params: { id: devId('AI001') }, body: { active: true } });
  assert.equal(r.out.ok, true); assert.equal(r.out.rebooting, false);   // máy AI không bị ra lệnh khởi động lại kiểu ZKTeco
  await c1.closed;
  assert.equal(db.prepare("SELECT COUNT(*) c FROM push_device_commands WHERE serial='AI001'").get().c, 0);   // không lọt lệnh REBOOT của ZKTeco
  c1 = aiClient(); await c1.open;
  c1.send({ cmd: 'reg', sn: 'AI001', devinfo: { modelname: 'AI06F' } });
  const ok = await c1.next();
  assert.equal(ok.result, true); assert.match(ok.cloudtime, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  await waitFor(() => WS.aiOnline('AI001'));
});
test('máy AI gửi lượt chấm → lưu + Số ID lạ thì hỏi tên → tự tạo NV + tính công', async () => {
  c1.send({ cmd: 'sendlog', sn: 'AI001', count: 3, logindex: 7, record: [
    { enrollid: 5, time: '2026-10-15 08:01:00', mode: 0, inout: 0, event: 0, temp: 3650 },
    { enrollid: 5, time: '2026-10-15 17:05:00', mode: 1, inout: 1, event: 0 },
    { enrollid: 0, time: '2026-10-15 17:06:00', mode: 0, inout: 1, event: 1 },   // sự kiện cửa → bỏ
  ] });
  const rep = await c1.next();
  assert.deepEqual([rep.ret, rep.result, rep.count, rep.logindex], ['sendlog', true, 3, 7]);
  const ask = await c1.next();
  assert.deepEqual([ask.cmd, ask.enrollid], ['getusername', 5]);
  const p = db.prepare("SELECT pin, punch_at, status, verify FROM device_punches WHERE serial='AI001' ORDER BY punch_at").all();
  assert.deepEqual(p.map((x) => [x.pin, x.punch_at, x.status, x.verify]), [['5', '2026-10-15T01:01:00.000Z', 0, 1], ['5', '2026-10-15T10:05:00.000Z', 1, 4]]);
  c1.send({ ret: 'getusername', sn: 'AI001', result: true, record: 'Nguyen Van Nam' });
  const emp = await waitFor(() => db.prepare("SELECT id, full_name FROM employees WHERE device_pin='5'").get());
  assert.equal(emp.full_name, 'Nguyen Van Nam');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM device_punches WHERE pin='5' AND employee_id=?").get(emp.id).c, 2);
  const att = db.prepare("SELECT check_in_at, check_out_at FROM attendance WHERE employee_id=? AND work_date='2026-10-15'").get(emp.id);
  assert.deepEqual([att?.check_in_at, att?.check_out_at], ['2026-10-15T01:01:00.000Z', '2026-10-15T10:05:00.000Z'], 'đã dựng ngày công từ lượt chấm máy AI');
});
let c2;
test('NV đăng ký vân tay ở máy AI → về phần mềm + tự sang máy AI cùng nhóm (không sang máy ZKTeco)', async () => {
  db.prepare("UPDATE push_devices SET sync_group='G' WHERE serial='AI001'").run();
  db.prepare("INSERT INTO push_devices(serial,name,active,conn_type,sync_group) VALUES('AI002','May xuong',1,'ai','G'),('ZK001','May ZK',1,'push','G')").run();
  c1.send({ cmd: 'senduser', sn: 'AI001', enrollid: 7, name: 'Le Thi Mai', backupnum: 0, admin: 0, record: 'FPDATA7' });
  assert.deepEqual([(await c1.next()).ret], ['senduser']);
  assert.equal(db.prepare("SELECT full_name FROM employees WHERE device_pin='7'").get().full_name, 'Le Thi Mai');
  assert.equal(db.prepare("SELECT record FROM ai_templates WHERE serial='AI001' AND pin='7' AND backupnum=0").get().record, 'FPDATA7');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM push_device_commands WHERE serial='ZK001'").get().c, 0, 'mẫu máy AI không được đẩy sang máy ZKTeco');
  c2 = aiClient(); await c2.open;
  c2.send({ cmd: 'reg', sn: 'AI002' });
  assert.equal((await c2.next()).result, true);
  const cmd = await c2.next();
  assert.deepEqual([cmd.cmd, cmd.enrollid, cmd.backupnum, cmd.record], ['setuserinfo', 7, 0, 'FPDATA7']);
  assert.ok(cmd.name);
  c2.send({ ret: 'setuserinfo', sn: 'AI002', result: true });
  await waitFor(() => db.prepare("SELECT 1 FROM ai_templates WHERE serial='AI002' AND pin='7' AND backupnum=0").get());
  assert.ok(db.prepare("SELECT 1 FROM device_users_serial WHERE serial='AI002' AND pin='7'").get());
});
test('máy ZKTeco cùng tên nhóm: lệnh đồng bộ ZKTeco không lọt sang máy AI', () => {
  const pins = S.ingestUserData('ZK001', 'USER', 'USER PIN=8\tName=Zk Man\tPri=0');
  S.syncPinsToGroup('ZK001', S.storeTemplates('ZK001', 'FP', `FP PIN=8\tFID=0\tSize=40\tValid=1\tTMP=${'Z'.repeat(40)}`));
  S.syncPinsToGroup('ZK001', pins);
  for (const s of ['AI001', 'AI002']) assert.equal(db.prepare("SELECT COUNT(*) c FROM push_device_commands WHERE serial=? AND content LIKE 'DATA%'").get(s).c, 0);
  assert.equal(S.resyncNow().devices, 0);   // nhóm G chỉ có 1 máy ZKTeco → không đồng bộ ZKTeco nào
});
test('Tải NV từ máy AI: getuserlist chia trang → hỏi từng mục → lưu tên / quyền / thẻ / mẫu', async () => {
  const r = await call('POST /devices/:id/ai/:action', { params: { id: devId('AI001'), action: 'users' } });
  assert.equal(r.out.ok, true); assert.equal(r.out.online, true);
  assert.deepEqual(await c1.next(), { cmd: 'getuserlist', stn: true });
  c1.send('{"ret":"getuserlist","sn":"AI001","result":true,"count ":2,"from":0,"to":1,"record ":[{"enrollid ":9,"admin ":1,"backupnum ":0},{"enrollid ":9,"admin ":1,"backupnum ":11},]}');
  assert.deepEqual(await c1.next(), { cmd: 'getuserlist', stn: false });
  c1.send({ ret: 'getuserlist', sn: 'AI001', result: true, count: 0, from: 0, to: 0, record: [] });
  const q1 = await c1.next();
  assert.deepEqual([q1.cmd, q1.enrollid, q1.backupnum], ['getuserinfo', 9, 0]);
  c1.send({ ret: 'getuserinfo', sn: 'AI001', result: true, enrollid: 9, name: 'Tran Quan Tri', backupnum: 0, admin: 1, record: 'FP9' });
  const q2 = await c1.next();
  assert.deepEqual([q2.cmd, q2.enrollid, q2.backupnum], ['getuserinfo', 9, 11]);
  c1.send({ ret: 'getuserinfo', sn: 'AI001', result: true, enrollid: 9, name: 'Tran Quan Tri', backupnum: 11, admin: 1, record: 123456 });
  await waitFor(() => db.prepare("SELECT card FROM device_users WHERE pin='9' AND card='123456'").get());
  assert.equal(db.prepare("SELECT full_name FROM employees WHERE device_pin='9'").get().full_name, 'Tran Quan Tri');
  assert.equal(db.prepare("SELECT privilege FROM device_users_serial WHERE serial='AI001' AND pin='9'").get().privilege, 14);
  assert.ok(db.prepare("SELECT 1 FROM ai_templates WHERE serial='AI001' AND pin='9' AND backupnum=0").get());
  const g = (await call('GET /devices')).out.rows.find((x) => x.serial === 'AI001');
  assert.equal(g.fp_count, 2); assert.equal(g.online, true);
});
test('Tải lượt chấm mới từ máy AI: getnewlog chia trang theo tổng số → dừng đúng lúc', async () => {
  const before = db.prepare("SELECT COUNT(*) c FROM device_punches WHERE serial='AI001'").get().c;
  await call('POST /devices/:id/ai/:action', { params: { id: devId('AI001'), action: 'new-logs' } });
  let m = await c1.next(); while (m.cmd !== 'getnewlog') m = await c1.next();
  assert.equal(m.stn, true);
  const rec = (h) => ({ enrollid: 9, time: `2026-10-16 ${h}:00:00`, mode: 0, inout: 0, event: 0 });
  c1.send({ ret: 'getnewlog', sn: 'AI001', result: true, count: 3, from: 0, to: 1, record: [rec('08'), rec('12')] });
  assert.deepEqual(await c1.next(), { cmd: 'getnewlog', stn: false });
  c1.send({ ret: 'getnewlog', sn: 'AI001', result: true, count: 3, from: 2, to: 2, record: [rec('17')] });
  await waitFor(() => db.prepare("SELECT COUNT(*) c FROM device_punches WHERE serial='AI001'").get().c === before + 3);
  await sleep(300);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM push_device_commands WHERE serial='AI001' AND content LIKE '%getnewlog%' AND response_at IS NULL").get().c, 0);
});
test('Xoá NV trên máy AI + khởi động lại (lệnh không chờ trả lời)', async () => {
  await call('POST /devices/:id/delete-users', { params: { id: devId('AI001') }, body: { pins: ['9'] } });
  let m = await c1.next(); while (m.cmd !== 'deleteuser') m = await c1.next();
  assert.deepEqual([m.enrollid, m.backupnum], [9, 13]);
  c1.send({ ret: 'deleteuser', sn: 'AI001', result: true });
  await waitFor(() => !db.prepare("SELECT 1 FROM device_users_serial WHERE serial='AI001' AND pin='9'").get());
  assert.equal(db.prepare("SELECT COUNT(*) c FROM ai_templates WHERE serial='AI001' AND pin='9'").get().c, 0);
  await call('POST /devices/:id/ai/:action', { params: { id: devId('AI001'), action: 'restart' } });
  m = await c1.next(); while (m.cmd !== 'reboot') m = await c1.next();
  await waitFor(() => db.prepare("SELECT 1 FROM push_device_commands WHERE serial='AI001' AND content LIKE '%reboot%' AND response_at IS NOT NULL").get());
});
test('tắt công tắc máy AI → ngắt kết nối đang có + từ chối kết nối mới', async () => {
  setSetting('ai_device_enabled', '0');
  await Promise.all([c1.closed, c2.closed]);
  assert.equal(WS.aiOnline('AI001'), false);
  const r = await call('POST /devices/:id/ai/:action', { params: { id: devId('AI001'), action: 'info' } });
  assert.equal(r.code, 400);
});

/* ======================= MÁY HIKVISION ĐẦU-CUỐI ======================= */
test('Hikvision: lệnh ISAPI gửi Digest đúng chuẩn, sai mật khẩu báo rõ', async () => {
  setSetting('hik_device_enabled', '1');
  const bad = await call('POST /devices/hik', { body: { ip: '127.0.0.1', port: hikPort, user: 'admin', pass: 'sai' } });
  assert.equal(bad.code, 400); assert.match(bad.out.error, /Sai tài khoản hoặc mật khẩu/);
  const ok = await call('POST /devices/hik', { body: { ip: '127.0.0.1', port: hikPort, user: 'admin', pass: H.pass, name: 'Cong Hik' } });
  assert.equal(ok.code, 200); assert.equal(ok.out.serial, H.serial); assert.equal(ok.out.active, false);
  assert.equal(ok.out.info.users, 2); assert.equal(ok.out.info.logs, 4);
  const row = (await call('GET /devices')).out.rows.find((x) => x.serial === H.serial);
  assert.equal(row.conn_type, 'hik'); assert.equal(row.has_pass, true); assert.equal(row.dev_pass, undefined, 'không lộ mật khẩu máy ra giao diện');
});
test('Hikvision: chưa duyệt thì không tải được; duyệt xong tải NV + lượt chấm (firmware cũ → tự lọc mã thành công)', async () => {
  const id = devId(H.serial);
  assert.equal((await call('POST /devices/:id/hik/:action', { params: { id, action: 'logs' }, body: { from: '2026-10-15', to: '2026-10-15' } })).code, 400);
  const ap = await call('PUT /devices/:id', { params: { id }, body: { active: true } });
  assert.equal(ap.out.rebooting, false);
  const r = await call('POST /devices/:id/hik/:action', { params: { id, action: 'logs' }, body: { from: '2026-10-15', to: '2026-10-15' } });
  const j = await waitJob(r.out.job);
  assert.equal(j.state, 'done', j.msg);
  assert.equal(H.attrAsked, 1);                // đã thử lọc "attendance" trước, máy báo không hỗ trợ → lọc tại phần mềm
  assert.equal(j.result.users, 2);             // khách (visitor) không thành NV
  assert.equal(j.result.added, 2);
  const p = db.prepare('SELECT pin, punch_at, status, verify, employee_id FROM device_punches WHERE serial=? ORDER BY punch_at').all(H.serial);
  // giờ lấy theo đồng hồ hiển thị trên máy (08:00:05), không bị lệch dù máy để múi giờ +08:00
  assert.deepEqual(p.map((x) => [x.pin, x.punch_at, x.status, x.verify]), [['101', '2026-10-15T01:00:05.000Z', 0, 15], ['101', '2026-10-15T10:30:00.000Z', 1, 1]]);
  const e = db.prepare("SELECT id, full_name FROM employees WHERE device_pin='101'").get();
  assert.equal(e.full_name, 'Pham Van Hik'); assert.equal(p[0].employee_id, e.id);
  assert.ok(!db.prepare("SELECT 1 FROM employees WHERE device_pin='900'").get());
  // tải lại lần nữa: không trùng
  const j2 = await waitJob((await call('POST /devices/:id/hik/:action', { params: { id, action: 'logs' }, body: { from: '2026-10-15', to: '2026-10-15' } })).out.job);
  assert.equal(j2.result.added, 0);
});
test('Hikvision: đẩy NV từ phần mềm xuống máy + xoá NV trên tất cả máy', async () => {
  const r = await call('POST /devices/push-employees', { body: { pins: ['5', '7'], serials: [H.serial] } });
  assert.ok(r.out.job);
  const j = await waitJob(r.out.job);
  assert.equal(j.state, 'done', j.msg);
  assert.deepEqual(H.setup.map((u) => u.employeeNo).sort(), ['5', '7']);
  assert.equal(H.setup.find((u) => u.employeeNo === '5').name, 'Nguyen Van Nam');
  const del = await call('POST /devices/delete-users-all', { body: { pins: ['101'] } });
  assert.deepEqual(del.out.hik, ['Cong Hik']);
  await waitJob(del.out.job);
  assert.deepEqual(H.deleted, ['101']);
  assert.ok(!db.prepare('SELECT 1 FROM device_users_serial WHERE serial=? AND pin=?').get(H.serial, '101'));
});
test('Hikvision: dòng sự kiện — chỉ nhận mã xác thực thành công khi lọc tại phần mềm', () => {
  assert.equal(HIK.hikEventLine({ major: 5, minor: 76, time: '2026-10-15T08:00:00+07:00', employeeNoString: '1' }, true), null);
  assert.equal(HIK.hikEventLine({ major: 5, minor: 1, time: '2026-10-15T08:00:00+07:00', employeeNoString: '1', attendanceStatus: 'breakOut' }, true), '1\t2026-10-15 08:00:00\t1\t4');
  assert.equal(HIK.hikEventLine({ major: 5, minor: 75, time: '2026-10-15T08:00:00+07:00', employeeNoString: '' }, false), null);
});
