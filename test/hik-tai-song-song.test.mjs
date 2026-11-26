// Máy Hikvision: tự tải SONG SONG nhiều máy (cài đặt hik_parallel, mặc định 4) — mỗi máy vẫn chỉ 1 việc 1 lúc.
// Hualida 26/11/2026: 15 máy × ~48.000 sự kiện, mỗi máy ~30 phút → tuần tự ~7 giờ. Anh: "Cho tải song song".
// Chứng minh: 6 máy, cùng lúc có tới 4 máy đang được hỏi (không quá 4), không máy nào bị hỏi 2 lệnh 1 lúc, đủ lượt chấm cả 6 máy,
// tiến độ ghép theo tên máy; hik_parallel=1 → tuần tự như trước.
// Chạy: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { moCong } from './_cong.mjs';

const DBP = join(tmpdir(), `dgp-hik-parallel-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

const USER = 'admin', PASS = 'Abc12345';
const md5 = (s) => createHash('md5').update(s).digest('hex');
const G = { busy: 0, maxBusy: 0, perDevMax: 0 };
function makeDev(serial, idx) {
  const M = { serial, busy: 0, srv: null, port: 0 }, realm = 'DS-' + serial, nonce = 'n-' + serial;
  const events = [1, 2, 3, 4].map((k) => ({ employeeNoString: String(600 + idx), major: 5, minor: 0x4b, time: `2026-11-2${k}T08:0${idx}:00+07:00`, attendanceStatus: 'checkIn' }));
  const ok = (h, method, uri) => {
    if (!String(h || '').startsWith('Digest ')) return false;
    const p = {}; for (const x of h.slice(7).matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g)) p[x[1]] = x[2] ?? x[3];
    return p.username === USER && p.uri === uri && p.nonce === nonce
      && p.response === md5(`${md5(`${USER}:${realm}:${PASS}`)}:${p.nonce}:${p.nc}:${p.cnonce}:${p.qop}:${md5(`${method}:${uri}`)}`);
  };
  M.srv = createServer((req, res) => {
    const chunks = []; req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      if (!ok(req.headers.authorization, req.method, req.url)) {
        res.writeHead(401, { 'WWW-Authenticate': `Digest qop="auth", realm="${realm}", nonce="${nonce}", stale="FALSE"` }); return res.end();
      }
      // đếm số lệnh ĐÃ ĐĂNG NHẬP đang xử lý: theo từng máy và cả hệ thống
      M.busy++; G.busy++; G.perDevMax = Math.max(G.perDevMax, M.busy); G.maxBusy = Math.max(G.maxBusy, G.busy);
      await new Promise((r) => setTimeout(r, 25));   // máy chậm
      M.busy--; G.busy--;
      const u = req.url, txt = Buffer.concat(chunks).toString('utf8');
      const json = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (u === '/ISAPI/System/deviceInfo') { res.writeHead(200, { 'Content-Type': 'application/xml' }); return res.end(`<DeviceInfo><serialNumber>${serial}</serialNumber></DeviceInfo>`); }
      if (u.startsWith('/ISAPI/AccessControl/UserInfo/Count')) return json({ UserInfoCount: { userNumber: 0 } });
      if (u.startsWith('/ISAPI/AccessControl/AcsEventTotalNum')) return json({ AcsEventTotalNum: { totalNum: events.length } });
      if (u.startsWith('/ISAPI/AccessControl/UserInfo/Search')) return json({ UserInfoSearch: { responseStatusStrg: 'OK', numOfMatches: 0, totalMatches: 0, UserInfo: [] } });
      if (u.startsWith('/ISAPI/AccessControl/AcsEvent')) {
        const c = JSON.parse(txt).AcsEventCond, page = events.slice(c.searchResultPosition, c.searchResultPosition + 1);   // 1 sự kiện / trang
        return json({ AcsEvent: { searchID: c.searchID, responseStatusStrg: c.searchResultPosition + 1 < events.length ? 'MORE' : 'OK', numOfMatches: page.length, totalMatches: events.length, InfoList: page } });
      }
      json({ statusCode: 4, subStatusCode: 'notSupport' }, 404);
    });
  });
  return M;
}
const DEVS = [1, 2, 3, 4, 5, 6].map((i) => makeDev('HIKPAR-' + i, i));
let db, setSetting, H;
before(async () => {
  const D = await import('../server/db.js');
  db = D.db; setSetting = D.setSetting; D.initSchema();
  H = await import('../server/hik-isapi.js');
  setSetting('device_enabled', '1'); setSetting('hik_device_enabled', '1'); setSetting('hik_auto_min', '60'); setSetting('hik_first_from', '2026-11-01');
  for (const [i, M] of DEVS.entries()) {
    await moCong(M.srv); M.port = M.srv.address().port;
    db.prepare("INSERT INTO push_devices(serial, name, active, conn_type, tcp_ip, tcp_port, dev_user, dev_pass, tcp_auto) VALUES(?,?,1,'hik','127.0.0.1',?,?,?,1)")
      .run(M.serial, 'CC' + (i + 1), M.port, USER, PASS);
    db.prepare("INSERT INTO employees(code, full_name, username, password_hash, device_pin, active) VALUES(?,?,?,'x',?,1)").run('NV' + (601 + i), 'NV ' + (i + 1), 'nv' + (601 + i), String(601 + i));
  }
});
after(() => { for (const M of DEVS) { M.srv?.closeAllConnections?.(); M.srv?.close(); } });

test('mặc định tải cùng lúc 4 máy; cài đặt sai → 4; tối đa 8', () => {
  assert.equal(H.hikParallel(), 4);
  setSetting('hik_parallel', 'abc'); assert.equal(H.hikParallel(), 4);
  setSetting('hik_parallel', '50'); assert.equal(H.hikParallel(), 8);
  setSetting('hik_parallel', '4');
});

test('6 máy: cùng lúc tối đa 4 máy, mỗi máy 1 lệnh 1 lúc, đủ lượt chấm cả 6 máy, tiến độ có tên máy', async () => {
  const progs = [];
  const t0 = Date.now();
  const out = await H.hikAutoCycle(true, (m) => progs.push(m));
  const ms = Date.now() - t0;
  assert.equal(out.length, 6, JSON.stringify(out));
  assert.deepEqual(out.map((o) => o.device), ['CC1', 'CC2', 'CC3', 'CC4', 'CC5', 'CC6'], 'kết quả giữ đúng thứ tự máy');
  assert.ok(out.every((o) => /Thêm 4 lượt chấm mới/.test(o.msg)), JSON.stringify(out));
  assert.equal(G.maxBusy, 4, 'cùng lúc đúng 4 máy được hỏi');
  assert.equal(G.perDevMax, 1, 'không máy nào bị hỏi 2 lệnh cùng lúc');
  for (const M of DEVS) assert.equal(db.prepare('SELECT COUNT(*) c FROM device_punches WHERE serial=?').get(M.serial).c, 4, M.serial);
  assert.ok(progs.some((m) => /CC1: .*·.*CC2: /.test(m)), 'tiến độ ghép nhiều máy: ' + progs.slice(0, 5).join(' | '));
  G.par = ms;
});

test('hik_parallel = 1 → tuần tự như trước (mỗi lúc chỉ 1 máy)', async () => {
  setSetting('hik_parallel', '1');
  G.maxBusy = 0;
  db.prepare('UPDATE push_devices SET tcp_auto_logs=-1').run();   // giả như máy có lượt mới
  const out = await H.hikAutoCycle(true);
  assert.equal(out.length, 6);
  assert.equal(G.maxBusy, 1);
  for (const M of DEVS) assert.equal(db.prepare('SELECT COUNT(*) c FROM device_punches WHERE serial=?').get(M.serial).c, 4, 'không trùng lượt ' + M.serial);
});
