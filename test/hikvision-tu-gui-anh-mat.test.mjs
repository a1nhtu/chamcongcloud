// Máy Hikvision ĐỢT 2: máy TỰ GỬI lượt chấm tức thì (HTTP Listening → POST /hik/event/<mã>) + đẩy ẢNH KHUÔN MẶT xuống máy (FDLib).
// Máy Hikvision giả lập = máy chủ ISAPI có Digest; khi phần mềm bấm "gửi thử", máy giả lập POST thật về địa chỉ vừa cài.
// Kèm phần chứng minh tắt công tắc hik_device_enabled = như cũ (route /hik/event 404, không nhận lượt chấm, không gọi ảnh mặt).
// Chạy: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { createHash } from 'node:crypto';

const DBP = join(tmpdir(), `dgp-hik2-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, getSetting, setSetting, HIK, ZK;
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
const md5 = (s) => createHash('md5').update(s).digest('hex');
const punches = (serial) => db.prepare('SELECT pin, punch_at, status, verify, employee_id FROM device_punches WHERE serial=? ORDER BY punch_at, pin').all(serial).map((r) => ({ ...r }));

// gửi HTTP thô tới app (như máy chấm công gửi)
function post(port, path, body, contentType) {
  return new Promise((ok, no) => {
    const data = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const r = request({ host: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': contentType || 'application/json', 'Content-Length': data.length } }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => ok({ status: res.statusCode, text: t }));
    });
    r.on('error', no); r.end(data);
  });
}
// sự kiện AccessControllerEvent đúng mẫu tài liệu (F.98)
const alert = (ace, extra = {}) => ({ ipAddress: '127.0.0.1', portNo: 80, protocol: 'HTTP', macAddress: 'aa:bb:cc:dd:ee:ff', channelID: 1,
  dateTime: '2026-10-16T08:00:00+07:00', activePostCount: 1, eventType: 'AccessControllerEvent', eventState: 'active', eventDescription: 'Access Controller Event',
  AccessControllerEvent: { deviceName: 'Access Controller', majorEventType: 5, subEventType: 75, cardReaderNo: 1, verifyNo: 1, serialNo: 1, currentVerifyMode: 'cardOrFace', ...ace }, ...extra });
// máy gửi kèm ảnh chụp: multipart (JSON + ảnh)
function multipartAlert(a) {
  const b = 'MIME_boundary';
  const body = Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="event_log"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(a)}\r\n`),
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="Picture"; filename="Picture.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), Buffer.from([0xff, 0xd8, 0x7b, 0x7d, 0x00, 0x01]), Buffer.from(`\r\n--${b}--\r\n`),
  ]);
  return { body, type: `multipart/form-data; boundary=${b}` };
}

/* ---------- máy Hikvision giả lập (ISAPI + Digest) ---------- */
const H = { user: 'admin', pass: 'Abc12345', realm: 'DS-K1T342', nonce: 'n2', serial: 'DS-K1T342MFX20230101V030200ENG87654321',
  hosts: [{ id: '1', ip: '10.0.0.5', port: '9000', url: '/khac' }, { id: '2', ip: '0.0.0.0', port: '80', url: '' }], put: [], tested: [],
  users: { 556: 'Le Hoi' }, faces: [], faceRecord: [], noSetUp: false, faceCalls: 0, events: [] };
let hikSrv, hikPort, appSrv, appPort;
function checkDigest(h, method, uri) {
  if (!String(h || '').startsWith('Digest ')) return false;
  const p = {}; for (const x of h.slice(7).matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g)) p[x[1]] = x[2] ?? x[3];
  if (p.username !== H.user || p.uri !== uri || p.nonce !== H.nonce) return false;
  return p.response === md5(`${md5(`${H.user}:${H.realm}:${H.pass}`)}:${p.nonce}:${p.nc}:${p.cnonce}:${p.qop}:${md5(`${method}:${uri}`)}`);
}
const tagOf = (x, t) => ((new RegExp(`<${t}>([^<]*)</${t}>`).exec(x) || [])[1] || '');
const hostsXml = () => `<?xml version="1.0"?><HttpHostNotificationList version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">${H.hosts.map((h) =>
  `<HttpHostNotification><id>${h.id}</id><url>${h.url}</url><protocolType>HTTP</protocolType><parameterFormatType>XML</parameterFormatType><addressingFormatType>ipaddress</addressingFormatType><ipAddress>${h.ip}</ipAddress><portNo>${h.port}</portNo><httpAuthenticationMethod>none</httpAuthenticationMethod></HttpHostNotification>`).join('')}</HttpHostNotificationList>`;
// tách multipart của phần mềm gửi (đẩy ảnh mặt)
function parts(buf, ct) {
  const b = /boundary=(.+)$/.exec(ct)[1], out = {};
  const s = buf.toString('latin1');
  for (const p of s.split('--' + b).slice(1)) {
    if (p.startsWith('--')) break;
    const i = p.indexOf('\r\n\r\n'); const name = /name="([^"]+)"/.exec(p.slice(0, i))[1];
    out[name] = Buffer.from(p.slice(i + 4, p.length - 2), 'latin1');
  }
  return out;
}
function hikHandler(req, res) {
  const chunks = []; req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    if (!checkDigest(req.headers.authorization, req.method, req.url)) {
      res.writeHead(401, { 'WWW-Authenticate': `Digest qop="auth", realm="${H.realm}", nonce="${H.nonce}", stale="FALSE"` }); return res.end();
    }
    const raw = Buffer.concat(chunks), txt = raw.toString('utf8'), u = req.url, ct = req.headers['content-type'] || '';
    const json = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    const xml = (x, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/xml' }); res.end(x); };
    if (u === '/ISAPI/System/deviceInfo') return xml(`<DeviceInfo><deviceName>Cong sau</deviceName><model>DS-K1T342MFX</model><serialNumber>${H.serial}</serialNumber><macAddress>aa:bb:cc:dd:ee:ff</macAddress><firmwareVersion>V3.3.0</firmwareVersion></DeviceInfo>`);
    if (u.startsWith('/ISAPI/AccessControl/UserInfo/Count')) return json({ UserInfoCount: { userNumber: 1 } });
    if (u.startsWith('/ISAPI/AccessControl/AcsEventTotalNum')) return json({ AcsEventTotalNum: { totalNum: H.events.length } });
    if (u.startsWith('/ISAPI/AccessControl/UserInfo/Search')) {
      const c = JSON.parse(txt).UserInfoSearchCond;
      if (c.EmployeeNoList) {   // hỏi tên Số ID lạ
        const list = c.EmployeeNoList.map((x) => x.employeeNo).filter((p) => H.users[p]).map((p) => ({ employeeNo: p, name: H.users[p], userType: 'normal' }));
        return json({ UserInfoSearch: { searchID: c.searchID, responseStatusStrg: 'OK', numOfMatches: list.length, totalMatches: list.length, UserInfo: list } });
      }
      return json({ UserInfoSearch: { searchID: c.searchID, responseStatusStrg: 'OK', numOfMatches: 1, totalMatches: 1, UserInfo: [{ employeeNo: '101', name: 'Pham Van Hik', userType: 'normal' }] } });
    }
    if (u.startsWith('/ISAPI/AccessControl/AcsEvent?')) {
      const c = JSON.parse(txt).AcsEventCond;
      return json({ AcsEvent: { searchID: c.searchID, responseStatusStrg: 'OK', numOfMatches: H.events.length, totalMatches: H.events.length, InfoList: H.events } });
    }
    if (u.startsWith('/ISAPI/AccessControl/UserInfo/SetUp')) return json({ statusCode: 1, statusString: 'OK' });
    // ----- địa chỉ nhận sự kiện (HTTP Listening) -----
    if (u === '/ISAPI/Event/notification/httpHosts' && req.method === 'GET') return xml(hostsXml());
    const hm = /^\/ISAPI\/Event\/notification\/httpHosts\/(\w+)(\/test)?$/.exec(u);
    if (hm && req.method === 'PUT') {
      H.put.push(txt);
      const h = H.hosts.find((x) => x.id === hm[1]);
      Object.assign(h, { ip: tagOf(txt, 'ipAddress') || tagOf(txt, 'hostName'), port: tagOf(txt, 'portNo'), url: tagOf(txt, 'url'), fmt: tagOf(txt, 'parameterFormatType') });
      return xml('<ResponseStatus><statusCode>1</statusCode></ResponseStatus>');
    }
    if (hm && hm[2] && req.method === 'POST') {   // gửi thử: máy POST nhịp tim thật về địa chỉ đang cài
      const h = H.hosts.find((x) => x.id === hm[1]);
      H.tested.push(h.id);
      const r = await post(+h.port, h.url, { ipAddress: '127.0.0.1', macAddress: 'aa:bb:cc:dd:ee:ff', dateTime: '2026-10-16T07:00:00+07:00', activePostCount: 1, eventType: 'heartBeat', eventState: 'inactive', eventDescription: 'test' }).catch(() => ({ status: 0 }));
      return xml(`<HttpHostTestResult><errorDescription>${r.status === 200 ? 'ok' : 'HTTP ' + r.status}</errorDescription></HttpHostTestResult>`);
    }
    // ----- ảnh khuôn mặt -----
    if (u === '/ISAPI/Intelligent/FDLib?format=json') return json({ statusCode: 1, FDLib: [{ FDID: '1', faceLibType: 'blackFD', name: 'Face' }] });
    if (u.startsWith('/ISAPI/Intelligent/FDLib/FDSetUp') && req.method === 'PUT') {
      H.faceCalls++;
      if (H.noSetUp) return json({ statusCode: 4, statusString: 'Invalid Operation', subStatusCode: 'notSupport' }, 404);
      const p = parts(raw, ct); H.faces.push({ rec: JSON.parse(p.FaceDataRecord.toString()), img: p.FaceImage });
      return json({ statusCode: 1, statusString: 'OK' });
    }
    if (u.startsWith('/ISAPI/Intelligent/FDLib/FaceDataRecord') && req.method === 'POST') {
      H.faceCalls++;
      const p = parts(raw, ct); H.faceRecord.push({ rec: JSON.parse(p.FaceDataRecord.toString()), img: p.FaceImage });
      return json({ statusCode: 1, statusString: 'OK', FPID: H.faceRecord.at(-1).rec.FPID });
    }
    json({ statusCode: 4, statusString: 'Invalid Operation', subStatusCode: 'notSupport' }, 404);
  });
}

before(async () => {
  const D = await import('../server/db.js');
  db = D.db; getSetting = D.getSetting; setSetting = D.setSetting; D.initSchema();
  HIK = await import('../server/hik-isapi.js');
  ZK = await import('../server/zk-tcp.js');
  const add = (m) => (p, ...h) => { routes[`${m} ${p}`] = h; };
  (await import('../server/routes/admin/devices.js')).registerDeviceRoutes({ get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE') }, { need: () => (q, s, n) => n() });
  const express = (await import('express')).default;
  const app = express();
  app.use('/', (await import('../server/routes/hik-event.js')).default);   // gắn y như server/index.js (trước cổng bản quyền)
  appSrv = createServer(app);
  await new Promise((ok) => appSrv.listen(0, '127.0.0.1', ok));
  appPort = appSrv.address().port;
  hikSrv = createServer(hikHandler);
  await new Promise((ok) => hikSrv.listen(0, '127.0.0.1', ok));
  hikPort = hikSrv.address().port;
});
after(() => { appSrv?.closeAllConnections?.(); appSrv?.close(); hikSrv?.closeAllConnections?.(); hikSrv?.close(); });

let id;
/* ======================= TẮT = NHƯ CŨ ======================= */
test('mặc định TẮT: /hik/event trả 404 như chưa có route, không lưu gì; nút cài máy tự gửi báo chưa bật', async () => {
  assert.equal(getSetting('hik_device_enabled', '0'), '0');
  setSetting('device_enabled', '1');
  db.prepare("INSERT INTO push_devices(serial,name,active,conn_type,tcp_ip,tcp_port,dev_user,dev_pass,hik_push_token) VALUES(?,?,1,'hik','127.0.0.1',?,?,?,'tok0')").run('HIKOFF', 'Tat', hikPort, H.user, H.pass);
  for (const path of ['/hik/event', '/hik/event/tok0']) {
    const r = await post(appPort, path, alert({ employeeNoString: '7' }));
    assert.equal(r.status, 404, path);
  }
  assert.equal(punches('HIKOFF').length, 0);
  assert.equal(db.prepare("SELECT hik_push_at FROM push_devices WHERE serial='HIKOFF'").get().hik_push_at, '', 'tắt thì không ghi nhận gì từ máy');
  const r = await call('POST /devices/:id/hik-push', { params: { id: db.prepare("SELECT id FROM push_devices WHERE serial='HIKOFF'").get().id }, body: { host: '127.0.0.1', port: appPort } });
  assert.equal(r.code, 400);
  db.prepare("DELETE FROM push_devices WHERE serial='HIKOFF'").run();
});

/* ======================= MÁY TỰ GỬI LƯỢT CHẤM ======================= */
test('máy CHỜ DUYỆT tự gửi (điền tay, không mã): khớp theo IP + MAC, ghi nhận máy có gọi về nhưng KHÔNG nhận lượt chấm', async () => {
  setSetting('hik_device_enabled', '1');
  const ok = await call('POST /devices/hik', { body: { ip: '127.0.0.1', port: hikPort, user: H.user, pass: H.pass, name: 'Cong sau' } });
  assert.equal(ok.code, 200, JSON.stringify(ok.out)); id = ok.out.id;
  assert.equal((await call('POST /devices/:id/hik-push', { params: { id }, body: { host: '127.0.0.1', port: appPort } })).code, 400, 'chưa duyệt thì chưa cài');
  const r = await post(appPort, '/hik/event', alert({ employeeNoString: '101' }));
  assert.equal(r.status, 200);
  assert.equal(punches(H.serial).length, 0);
  assert.ok(db.prepare('SELECT hik_push_at FROM push_devices WHERE id=?').get(id).hik_push_at);
  // MAC khác (IP trùng nhưng là máy khác) → không nhận
  assert.equal((await post(appPort, '/hik/event', alert({ employeeNoString: '101' }, { macAddress: '11:22:33:44:55:66' }))).status, 404);
});
let token;
test('duyệt → bấm "Cài máy tự gửi": dùng ô còn trống, không đụng ô của phần mềm khác, máy gửi thử về được', async () => {
  await call('PUT /devices/:id', { params: { id }, body: { active: true } });
  const r = await call('POST /devices/:id/hik-push', { params: { id }, body: { host: '127.0.0.1', port: appPort } });
  assert.equal(r.code, 200, JSON.stringify(r.out));
  assert.equal(r.out.slot, '2');
  assert.equal(r.out.test, 'ok', 'máy giả lập đã POST thử về /hik/event/<mã> và nhận 200');
  token = db.prepare('SELECT hik_push_token t FROM push_devices WHERE id=?').get(id).t;
  assert.match(token, /^[0-9a-f]{32}$/);
  assert.equal(r.out.url, `http://127.0.0.1:${appPort}/hik/event/${token}`);
  assert.deepEqual(H.hosts[0], { id: '1', ip: '10.0.0.5', port: '9000', url: '/khac' }, 'ô của phần mềm khác giữ nguyên');
  assert.deepEqual([H.hosts[1].ip, H.hosts[1].port, H.hosts[1].url, H.hosts[1].fmt], ['127.0.0.1', String(appPort), '/hik/event/' + token, 'JSON']);
  assert.match(H.put[0], /<addressingFormatType>ipaddress<\/addressingFormatType>/);
  // cài lại: vẫn ô 2, vẫn mã cũ (máy khỏi phải đổi)
  const r2 = await call('POST /devices/:id/hik-push', { params: { id }, body: { host: '127.0.0.1', port: appPort } });
  assert.equal(r2.out.slot, '2'); assert.equal(db.prepare('SELECT hik_push_token t FROM push_devices WHERE id=?').get(id).t, token);
  const row = (await call('GET /devices')).out.rows.find((x) => x.id === id);
  assert.equal(row.hik_push_token, undefined, 'không trả mã ra danh sách');
  assert.equal(row.hik_push_url, r.out.url);
});
test('hết ô địa chỉ nhận (đều của phần mềm khác) → báo rõ, KHÔNG ghi đè', async () => {
  const keep = H.hosts.map((h) => ({ ...h }));
  H.hosts = [{ id: '1', ip: '10.0.0.5', port: '9000', url: '/khac' }, { id: '2', ip: '10.0.0.6', port: '9001', url: '/khac2' }];
  const n = H.put.length;
  const r = await call('POST /devices/:id/hik-push', { params: { id }, body: { host: '127.0.0.1', port: appPort } });
  assert.equal(r.code, 400); assert.equal(r.out.code, 'FULL'); assert.match(r.out.error, /10\.0\.0\.5:9000, 10\.0\.0\.6:9001/);
  assert.equal(H.put.length, n);
  H.hosts = keep;
  assert.equal((await call('POST /devices/:id/hik-push', { params: { id }, body: { host: 'x y', port: 80 } })).out.code, 'INPUT');
});
test('máy tự gửi lượt chấm (multipart kèm ảnh) → lưu ngay + tính công; giờ theo đồng hồ máy', async () => {
  const m = multipartAlert(alert({ employeeNoString: '101', name: 'Pham Van Hik', attendanceStatus: 'checkIn' }));
  assert.equal((await post(appPort, '/hik/event/' + token, m.body, m.type)).status, 200);
  const e = db.prepare("SELECT id, full_name FROM employees WHERE device_pin='101'").get();
  assert.equal(e.full_name, 'Pham Van Hik', 'Số ID lạ + sự kiện có tên → tự tạo NV');
  assert.deepEqual(punches(H.serial), [{ pin: '101', punch_at: '2026-10-16T01:00:00.000Z', status: 0, verify: 15, employee_id: e.id }]);
  // giờ ra: JSON thuần, giờ máy gửi dạng UTC (Z) → đổi về giờ Việt Nam
  assert.equal((await post(appPort, '/hik/event/' + token, alert({ employeeNoString: '101', subEventType: 38, attendanceStatus: 'checkOut' }, { dateTime: '2026-10-16T10:30:00Z' }))).status, 200);
  const att = db.prepare("SELECT check_in_at, check_out_at FROM attendance WHERE employee_id=? AND work_date='2026-10-16'").get(e.id);
  assert.deepEqual([att?.check_in_at, att?.check_out_at], ['2026-10-16T01:00:00.000Z', '2026-10-16T10:30:00.000Z']);
  assert.equal(punches(H.serial)[1].status, 1); assert.equal(punches(H.serial)[1].verify, 1);
});
test('chỉ nhận lượt xác thực THÀNH CÔNG; gửi lại không trùng; mã sai → 404', async () => {
  const n = punches(H.serial).length;
  const send = (a) => post(appPort, '/hik/event/' + token, a);
  assert.equal((await send(alert({ employeeNoString: '101', subEventType: 76 }, { dateTime: '2026-10-16T12:00:00+07:00' }))).status, 200);   // mặt không khớp
  assert.equal((await send(alert({ subEventType: 21, majorEventType: 2 }, { dateTime: '2026-10-16T12:05:00+07:00' }))).status, 200);         // sự kiện cửa
  assert.equal((await send({ ipAddress: '127.0.0.1', dateTime: '2026-10-16T12:06:00+07:00', eventType: 'heartBeat', eventState: 'inactive' })).status, 200);
  assert.equal((await send(alert({ employeeNoString: '101' }, { activePostCount: 2 }))).status, 200);   // máy gửi lại lượt 08:00
  assert.equal(punches(H.serial).length, n);
  assert.equal((await post(appPort, '/hik/event/' + 'f'.repeat(32), alert({ employeeNoString: '101', subEventType: 1 }, { dateTime: '2026-10-16T13:00:00+07:00' }))).status, 404);
  assert.equal(punches(H.serial).length, n);
});
test('Số ID lạ không kèm tên → phần mềm hỏi máy (chạy nền) → tạo NV + gán lượt chấm; máy để định dạng XML cũng nhận', async () => {
  const xmlAlert = `<?xml version="1.0" encoding="UTF-8"?><EventNotificationAlert version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"><ipAddress>127.0.0.1</ipAddress><macAddress>aa:bb:cc:dd:ee:ff</macAddress><dateTime>2026-10-16T09:15:00+07:00</dateTime><eventType>AccessControllerEvent</eventType><eventState>active</eventState><AccessControllerEvent><majorEventType>5</majorEventType><subEventType>75</subEventType><employeeNoString>556</employeeNoString></AccessControllerEvent></EventNotificationAlert>`;
  assert.equal((await post(appPort, '/hik/event/' + token, xmlAlert, 'application/xml')).status, 200);
  const e = await waitFor(() => db.prepare("SELECT id, full_name FROM employees WHERE device_pin='556'").get());
  assert.equal(e.full_name, 'Le Hoi');
  await waitFor(() => db.prepare("SELECT 1 FROM device_punches WHERE pin='556' AND employee_id=?").get(e.id));
  assert.ok(db.prepare("SELECT 1 FROM attendance WHERE employee_id=? AND work_date='2026-10-16'").get(e.id), 'đã dựng công sau khi gán');
});
test('lượt máy đã tự gửi rồi, lúc tải chấm công theo nút / lịch không bị trùng', async () => {
  H.events = [{ major: 5, minor: 75, time: '2026-10-16T08:00:00+07:00', employeeNoString: '101', attendanceStatus: 'checkIn' }];
  const j = await waitJob((await call('POST /devices/:id/hik/:action', { params: { id, action: 'logs' }, body: { from: '2026-10-16', to: '2026-10-16' } })).out.job);
  assert.equal(j.state, 'done', j.msg);
  assert.equal(j.result.read, 1); assert.equal(j.result.added, 0);
});

/* ======================= ĐẨY ẢNH KHUÔN MẶT ======================= */
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3000, 7), Buffer.from([0xff, 0xd9])]);
test('đẩy NV kèm ảnh khuôn mặt: ghi người trước rồi ghi ảnh (FDSetUp multipart, FPID = Số ID); ảnh > 200 KB báo lỗi; chưa có ảnh thì bỏ qua', async () => {
  const big = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(210 * 1024, 1)]);
  db.prepare("INSERT INTO device_user_photos(pin,kind,face_type,photo) VALUES('101','face',9,?),('556','user',0,?)").run(JPG.toString('base64'), big.toString('base64'));
  db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash, device_pin, active) VALUES('NV900','Khong Anh','employee','nv900','x','900',1)").run();
  const r = await call('POST /devices/push-employees', { body: { pins: ['101', '556', '900'], serials: [H.serial], with_bio: true } });
  const j = await waitJob(r.out.job);
  assert.equal(j.state, 'done', j.msg);
  const x = j.result.devices[0];
  assert.deepEqual([x.ok, x.pushed, x.faces, x.face_failed], [true, 3, 1, 1]);
  assert.match(x.errors.join(' '), /556 \(ảnh mặt\).*200 KB/);
  assert.equal(H.faces.length, 1);
  assert.deepEqual(H.faces[0].rec, { faceLibType: 'blackFD', FDID: '1', FPID: '101', name: 'Pham Van Hik' });
  assert.ok(H.faces[0].img.equals(JPG), 'ảnh gửi xuống đúng từng byte');
});
test('máy đời cũ chưa có FDSetUp → tự dùng FaceDataRecord; không tích "kèm" thì không gửi ảnh nào (như cũ)', async () => {
  H.noSetUp = true;
  let j = await waitJob((await call('POST /devices/push-employees', { body: { pins: ['101'], serials: [H.serial], with_bio: true } })).out.job);
  assert.equal(j.result.devices[0].faces, 1);
  assert.equal(H.faceRecord.length, 1); assert.equal(H.faceRecord[0].rec.FPID, '101'); assert.ok(H.faceRecord[0].img.equals(JPG));
  const calls = H.faceCalls;
  j = await waitJob((await call('POST /devices/push-employees', { body: { pins: ['101', '556'], serials: [H.serial], with_bio: false } })).out.job);
  assert.deepEqual([j.result.devices[0].pushed, j.result.devices[0].faces], [2, 0]);
  assert.equal(H.faceCalls, calls, 'không gọi lệnh ảnh mặt nào');
});

/* ======================= TẮT LẠI = NHƯ CŨ ======================= */
test('tắt công tắc Hikvision: máy vẫn gửi nhưng phần mềm trả 404, không nhận thêm lượt chấm', async () => {
  setSetting('hik_device_enabled', '0');
  const n = punches(H.serial).length;
  assert.equal((await post(appPort, '/hik/event/' + token, alert({ employeeNoString: '101' }, { dateTime: '2026-10-17T08:00:00+07:00' }))).status, 404);
  assert.equal(punches(H.serial).length, n);
  assert.equal((await call('POST /devices/:id/hik-push', { params: { id }, body: { host: '127.0.0.1', port: appPort } })).code, 400);
});
test('tách sự kiện: multipart chỉ xuống dòng LF, nhiều khối JSON; dòng ATTLOG đúng mã', () => {
  const b = 'zz';
  const body = Buffer.from(`--${b}\nContent-Type: application/json\n\n${JSON.stringify(alert({ employeeNoString: '9' }))}\n--${b}\nContent-Type: application/json\n\n${JSON.stringify(alert({ employeeNoString: '10', subEventType: 1 }))}\n--${b}--\n`);
  const a = HIK.parseHikAlerts('multipart/form-data; boundary="zz"', body);
  assert.deepEqual(a.map(HIK.hikAlertLine), ['9\t2026-10-16 08:00:00\t0\t15', '10\t2026-10-16 08:00:00\t0\t4']);
  assert.equal(HIK.hikAlertLine({ eventType: 'heartBeat' }), null);
  assert.deepEqual(HIK.parseHikAlerts('application/json', Buffer.from('rác')), []);
});
