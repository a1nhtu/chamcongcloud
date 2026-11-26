// Máy Hikvision: LẦN ĐẦU tự tải chỉ lấy lượt chấm từ ngày cài đặt (hik_first_from), thử lại trang khi máy chậm / rớt kết nối,
// và ảnh khuôn mặt chỉ tải SAU KHI xong lượt chấm (không chen song song trên cùng 1 máy).
// Hualida 26/11/2026: 15 máy DS-K1T671M ~4.000 người, lần đầu đọc TOÀN BỘ lịch sử ~20 phút / máy rồi hỏng ở 1 trang (quá thời gian chờ)
// = 0 lượt chấm; máy kế báo nhầm "sai mật khẩu" vì đang bị tải ảnh mặt dồn dập. Anh: "tải bắt đầu từ tháng 10 thôi, không tải hết".
// Chạy: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { moCong } from './_cong.mjs';

const DBP = join(tmpdir(), `dgp-hik-first-from-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

const USER = 'admin', PASS = 'Abc12345', SERIAL = 'HIKFIRST-1';
const md5 = (s) => createHash('md5').update(s).digest('hex');
const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7), Buffer.from([0xff, 0xd9])]);
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

// sự kiện trên máy: cả tháng 9 lẫn tháng 10–11
const EVENTS = [
  ['501', '2026-09-15T08:00:00+07:00'], ['501', '2026-09-30T08:00:00+07:00'],
  ['501', '2026-10-01T07:55:00+07:00'], ['502', '2026-10-20T08:01:00+07:00'], ['502', '2026-11-25T17:30:00+07:00'],
];
const M = { log: [], conds: [], dropFirstEvent: true, srv: null, port: 0 };
const realm = 'DS-' + SERIAL, nonce = 'n-first';
const digestOk = (h, method, uri) => {
  if (!String(h || '').startsWith('Digest ')) return false;
  const p = {}; for (const x of h.slice(7).matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g)) p[x[1]] = x[2] ?? x[3];
  if (p.username !== USER || p.uri !== uri || p.nonce !== nonce) return false;
  return p.response === md5(`${md5(`${USER}:${realm}:${PASS}`)}:${p.nonce}:${p.nc}:${p.cnonce}:${p.qop}:${md5(`${method}:${uri}`)}`);
};
M.srv = createServer((req, res) => {
  const chunks = []; req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    if (!digestOk(req.headers.authorization, req.method, req.url)) {
      res.writeHead(401, { 'WWW-Authenticate': `Digest qop="auth", realm="${realm}", nonce="${nonce}", stale="FALSE"` }); return res.end();
    }
    const u = req.url, txt = Buffer.concat(chunks).toString('utf8');
    const json = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u === '/ISAPI/System/deviceInfo') { res.writeHead(200, { 'Content-Type': 'application/xml' }); return res.end(`<DeviceInfo><deviceName>${SERIAL}</deviceName><model>DS-K1T671M</model><serialNumber>${SERIAL}</serialNumber></DeviceInfo>`); }
    if (u.startsWith('/ISAPI/AccessControl/UserInfo/Count')) return json({ UserInfoCount: { userNumber: 2 } });
    if (u.startsWith('/ISAPI/AccessControl/AcsEventTotalNum')) return json({ AcsEventTotalNum: { totalNum: EVENTS.length } });
    if (u.startsWith('/ISAPI/AccessControl/UserInfo/Search')) {
      const c = JSON.parse(txt).UserInfoSearchCond;
      const all = [{ employeeNo: '501', name: 'Nguyen Van A', userType: 'normal', numOfFace: 1 }, { employeeNo: '502', name: 'Tran Thi B', userType: 'normal', numOfFace: 1 }];
      const page = all.slice(c.searchResultPosition, c.searchResultPosition + 30);
      return json({ UserInfoSearch: { searchID: c.searchID, responseStatusStrg: 'OK', numOfMatches: page.length, totalMatches: all.length, UserInfo: page } });
    }
    if (u.startsWith('/ISAPI/AccessControl/AcsEvent')) {
      M.log.push('event');
      if (M.dropFirstEvent) { M.dropFirstEvent = false; req.socket.destroy(); return; }   // máy rớt kết nối giữa chừng → phải thử lại
      const c = JSON.parse(txt).AcsEventCond; M.conds.push(c);
      const from = c.startTime ? c.startTime.slice(0, 10) : '', to = c.endTime ? c.endTime.slice(0, 10) : '9999';
      const list = EVENTS.filter(([, t]) => (!from || t.slice(0, 10) >= from) && t.slice(0, 10) <= to)
        .map(([pin, time]) => ({ employeeNoString: pin, major: 5, minor: 0x4b, time, attendanceStatus: 'checkIn' }));
      const page = list.slice(c.searchResultPosition, c.searchResultPosition + 2);   // 2 sự kiện / trang → có phân trang
      const more = c.searchResultPosition + page.length < list.length;
      return json({ AcsEvent: { searchID: c.searchID, responseStatusStrg: more ? 'MORE' : 'OK', numOfMatches: page.length, totalMatches: list.length, InfoList: page } });
    }
    if (u === '/ISAPI/Intelligent/FDLib?format=json') { M.log.push('face'); return json({ statusCode: 1, FDLib: [{ FDID: '1', faceLibType: 'blackFD', name: 'Face' }] }); }
    if (u.startsWith('/ISAPI/Intelligent/FDLib/FDSearch')) {
      M.log.push('face');
      const pin = String(JSON.parse(txt).FPID);
      return json({ statusCode: 1, responseStatusStrg: 'OK', numOfMatches: 1, MatchList: [{ FPID: pin, faceURL: `http://127.0.0.1:${M.port}/LOCALS/pic/enrlFace/0/${pin}.jpg` }] });
    }
    if (u.startsWith('/LOCALS/pic/')) { M.log.push('face'); res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(jpg); }
    json({ statusCode: 4, statusString: 'Invalid Operation', subStatusCode: 'notSupport' }, 404);
  });
});

let db, setSetting, H, devId;
before(async () => {
  const D = await import('../server/db.js');
  db = D.db; setSetting = D.setSetting; D.initSchema();
  H = await import('../server/hik-isapi.js');
  await moCong(M.srv); M.port = M.srv.address().port;
  setSetting('device_enabled', '1'); setSetting('hik_device_enabled', '1'); setSetting('hik_auto_min', '60');
  H.HIK_RETRY_WAIT.splice(0, H.HIK_RETRY_WAIT.length, 20, 20);   // test: chờ ngắn trước khi thử lại
  devId = db.prepare("INSERT INTO push_devices(serial, name, active, conn_type, tcp_ip, tcp_port, dev_user, dev_pass, tcp_auto) VALUES(?,?,1,'hik','127.0.0.1',?,?,?,1)")
    .run(SERIAL, 'CC thử', M.port, USER, PASS).lastInsertRowid;
  for (const [code, pin, name] of [['NV501', '501', 'Nguyen Van A'], ['NV502', '502', 'Tran Thi B']])
    db.prepare("INSERT INTO employees(code, full_name, username, password_hash, device_pin, active) VALUES(?,?,?,'x',?,1)").run(code, name, code.toLowerCase(), pin);
});
after(() => { M.srv?.closeAllConnections?.(); M.srv?.close(); });

test('ngày "lần đầu tải từ" sai định dạng → coi như trống (tải hết như cũ)', () => {
  setSetting('hik_first_from', '1/10/2026');
  assert.equal(H.hikFirstFrom(), '');
  setSetting('hik_first_from', '2026-10-01');
  assert.equal(H.hikFirstFrom(), '2026-10-01');
});

test('lần đầu tự tải: chỉ lấy từ 01/10, thử lại khi máy rớt kết nối, ảnh mặt tải SAU lượt chấm', async () => {
  const out = await H.hikAutoCycle(true);
  assert.ok(out && out.length === 1, JSON.stringify(out));
  const dv = db.prepare('SELECT * FROM push_devices WHERE id=?').get(devId);
  assert.equal(dv.tcp_auto_ok, 1, dv.tcp_auto_msg);
  // máy được hỏi theo khoảng ngày (nới 1 ngày đầu), KHÔNG hỏi toàn bộ lịch sử
  assert.ok(M.conds.length >= 1 && M.conds.every((c) => c.startTime && c.startTime.startsWith('2026-09-30')), JSON.stringify(M.conds));
  // trang đầu rớt kết nối 1 lần → thử lại được, không mất lượt tải
  assert.equal(M.dropFirstEvent, false);
  const days = db.prepare('SELECT work_date FROM device_punches WHERE serial=? ORDER BY work_date').all(SERIAL).map((r) => r.work_date);
  assert.deepEqual(days, ['2026-10-01', '2026-10-20', '2026-11-25'], 'chỉ lượt từ 01/10 trở đi (30/09 do nới ngày cũng bị lọc bỏ)');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM device_punches WHERE serial=? AND employee_id IS NULL').get(SERIAL).c, 0, 'lượt chấm khớp đúng NV');
  assert.ok(dv.tcp_sync_at, 'đã ghi lần tải → lượt sau chỉ tải phần mới');
  // ảnh khuôn mặt (chạy nền) đến SAU mọi lệnh đọc lượt chấm
  for (let i = 0; i < 100 && db.prepare('SELECT COUNT(*) c FROM device_user_photos').get().c < 2; i++) await sleep(20);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM device_user_photos').get().c, 2, 'ảnh mặt vẫn được tải về');
  const firstFace = M.log.indexOf('face'), lastEvent = M.log.lastIndexOf('event');
  assert.ok(firstFace > lastEvent, 'thứ tự gọi máy: ' + M.log.join(','));
});

test('đã tải 1 lần rồi: lượt sau tải từ hôm trước lần tải gần nhất, không quay lại 01/10', async () => {
  M.conds.length = 0;
  db.prepare('UPDATE push_devices SET tcp_auto_logs=-1 WHERE id=?').run(devId);   // giả như máy có lượt mới
  await H.hikAutoCycle(true);
  assert.ok(M.conds.length >= 1);
  assert.ok(M.conds.every((c) => c.startTime && c.startTime.slice(0, 10) > '2026-10-01'), JSON.stringify(M.conds.map((c) => c.startTime)));
  assert.equal(db.prepare('SELECT COUNT(*) c FROM device_punches WHERE serial=?').get(SERIAL).c, 3, 'không trùng lượt');
});
