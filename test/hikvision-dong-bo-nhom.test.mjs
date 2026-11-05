// Máy Hikvision: ĐỒNG BỘ NHÓM — người + thẻ + ảnh khuôn mặt + vân tay ở máy này tự chép sang máy cùng nhóm còn thiếu.
// 3 máy Hikvision giả lập (ISAPI + Digest): A (vân tay đầu đọc 1), B (vân tay đầu đọc 2, như DS-K1T671M), C (không có vân tay).
// Chứng minh: chỉ THÊM không xoá; bỏ NV đang khoá; vân tay ghi vào đúng đầu đọc của máy nhận; máy không có vân tay → báo, phần khác vẫn chép;
// chạy lại = không ghi gì; lọc theo Số ID; máy chưa có nhóm → 400; nhóm 1 máy → báo cần 2 máy; máy mất kết nối không dừng cả nhóm.
// Chạy: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const DBP = join(tmpdir(), `dgp-hik-sync-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, setSetting, ZK;
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
const waitJob = async (id) => { for (;;) { const j = ZK.getJob(id); if (j.state !== 'run') return j; await sleep(20); } };
const md5 = (s) => createHash('md5').update(s).digest('hex');
const jpg = (tag) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, tag), Buffer.from([0xff, 0xd9])]);

/* ---------- máy Hikvision giả lập ---------- */
const USER = 'admin', PASS = 'Abc12345';
function makeDev(serial, { reader = 1, noFP = false } = {}) {
  const M = { serial, realm: 'DS-' + serial, nonce: 'n-' + serial, reader, noFP, users: new Map(), faces: new Map(), fps: new Map(), cards: new Map(),
    fpWrites: [], down: false, srv: null, port: 0 };
  const digestOk = (h, method, uri) => {
    if (!String(h || '').startsWith('Digest ')) return false;
    const p = {}; for (const x of h.slice(7).matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g)) p[x[1]] = x[2] ?? x[3];
    if (p.username !== USER || p.uri !== uri || p.nonce !== M.nonce) return false;
    return p.response === md5(`${md5(`${USER}:${M.realm}:${PASS}`)}:${p.nonce}:${p.nc}:${p.cnonce}:${p.qop}:${md5(`${method}:${uri}`)}`);
  };
  const parts = (buf, ct) => {
    const b = /boundary=(.+)$/.exec(ct)[1], out = {};
    for (const p of buf.toString('latin1').split('--' + b).slice(1)) {
      if (p.startsWith('--')) break;
      const i = p.indexOf('\r\n\r\n'); out[/name="([^"]+)"/.exec(p.slice(0, i))[1]] = Buffer.from(p.slice(i + 4, p.length - 2), 'latin1');
    }
    return out;
  };
  const info = (pin) => ({ employeeNo: pin, name: M.users.get(pin), userType: 'normal', numOfFace: M.faces.has(pin) ? 1 : 0,
    numOfFP: (M.fps.get(pin) || []).length, numOfCard: (M.cards.get(pin) || []).length });
  M.srv = createServer((req, res) => {
    if (M.down) { req.socket.destroy(); return; }
    const chunks = []; req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (!digestOk(req.headers.authorization, req.method, req.url)) {
        res.writeHead(401, { 'WWW-Authenticate': `Digest qop="auth", realm="${M.realm}", nonce="${M.nonce}", stale="FALSE"` }); return res.end();
      }
      const raw = Buffer.concat(chunks), txt = raw.toString('utf8'), u = req.url, ct = req.headers['content-type'] || '';
      const body = () => JSON.parse(txt);
      const json = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      const no = () => json({ statusCode: 4, statusString: 'Invalid Operation', subStatusCode: 'notSupport' }, 404);
      if (u === '/ISAPI/System/deviceInfo') { res.writeHead(200, { 'Content-Type': 'application/xml' }); return res.end(`<DeviceInfo><deviceName>${serial}</deviceName><model>DS-K1T671M</model><serialNumber>${serial}</serialNumber><macAddress>aa:bb:cc:00:00:0${reader}</macAddress><firmwareVersion>V3.2.30</firmwareVersion></DeviceInfo>`); }
      if (u.startsWith('/ISAPI/AccessControl/UserInfo/capabilities')) return M.max ? json({ UserInfo: { maxRecordNum: M.max } }) : no();
      if (u.startsWith('/ISAPI/AccessControl/UserInfo/Count')) return json({ UserInfoCount: { userNumber: M.users.size } });
      if (u.startsWith('/ISAPI/AccessControl/AcsEventTotalNum')) return json({ AcsEventTotalNum: { totalNum: 0 } });
      if (u.startsWith('/ISAPI/AccessControl/UserInfo/Search')) {
        const c = body().UserInfoSearchCond;
        let pins = [...M.users.keys()];
        if (c.EmployeeNoList) pins = c.EmployeeNoList.map((x) => x.employeeNo).filter((p) => M.users.has(p));
        const page = pins.slice(c.searchResultPosition, c.searchResultPosition + Math.min(c.maxResults, 2));   // 2 người / trang → thử phân trang
        const more = c.searchResultPosition + page.length < pins.length;
        return json({ UserInfoSearch: { searchID: c.searchID, responseStatusStrg: more ? 'MORE' : 'OK', numOfMatches: page.length, totalMatches: pins.length, UserInfo: page.map(info) } });
      }
      if (u.startsWith('/ISAPI/AccessControl/UserInfo/SetUp') && req.method === 'PUT') {
        const x = body().UserInfo; M.users.set(String(x.employeeNo), x.name); return json({ statusCode: 1, statusString: 'OK' });
      }
      // ----- thẻ -----
      if (u.startsWith('/ISAPI/AccessControl/CardInfo/Search')) {
        const c = body().CardInfoSearchCond, pin = c.EmployeeNoList[0].employeeNo, list = (M.cards.get(pin) || []).map((no) => ({ employeeNo: pin, cardNo: no, cardType: 'normalCard' }));
        return json({ CardInfoSearch: { searchID: c.searchID, responseStatusStrg: 'OK', numOfMatches: list.length, totalMatches: list.length, CardInfo: list } });
      }
      if (u.startsWith('/ISAPI/AccessControl/CardInfo/SetUp') && req.method === 'PUT') {
        const x = body().CardInfo, l = M.cards.get(x.employeeNo) || []; if (!l.includes(x.cardNo)) l.push(x.cardNo); M.cards.set(x.employeeNo, l);
        return json({ statusCode: 1, statusString: 'OK' });
      }
      // ----- ảnh khuôn mặt -----
      if (u === '/ISAPI/Intelligent/FDLib?format=json') return json({ statusCode: 1, FDLib: [{ FDID: '1', faceLibType: 'blackFD', name: 'Face' }] });
      if (u.startsWith('/ISAPI/Intelligent/FDLib/FDSearch')) {
        const c = body(), pin = String(c.FPID);
        return json({ statusCode: 1, responseStatusStrg: 'OK', numOfMatches: M.faces.has(pin) ? 1 : 0,
          MatchList: M.faces.has(pin) ? [{ FPID: pin, faceURL: `http://127.0.0.1:${M.port}/LOCALS/pic/enrlFace/0/${pin}.jpg@WEB000000000001` }] : [] });
      }
      const fm = /^\/LOCALS\/pic\/enrlFace\/0\/(\w+)\.jpg/.exec(u);
      if (fm && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(M.faces.get(fm[1])); }
      if (u.startsWith('/ISAPI/Intelligent/FDLib/FDSetUp') && req.method === 'PUT') {
        const p = parts(raw, ct), rec = JSON.parse(p.FaceDataRecord.toString()); M.faces.set(String(rec.FPID), p.FaceImage);
        return json({ statusCode: 1, statusString: 'OK' });
      }
      // ----- vân tay -----
      // như máy thật: MT05WE báo đầu đọc 1…1 (vân tay + mặt); DS-K1T671M (không vân tay) vẫn báo 2…2 nhưng đầu đọc 2 là cổng Wiegand trống
      if (u.startsWith('/ISAPI/AccessControl/FingerPrintCfg/capabilities')) return json({ FingerPrintCfg: { enableCardReader: M.noFP ? { '@min': 2, '@max': 2 } : { '@min': 1, '@max': M.reader } } });
      const cr = /^\/ISAPI\/AccessControl\/CardReaderCfg\/(\d+)/.exec(u);
      if (cr) {
        const n = +cr[1];
        if (n > Math.max(M.reader, 2)) return json({ statusCode: 4, statusString: 'Invalid Operation', subStatusCode: 'invalidID' }, 400);
        return json({ CardReaderCfg: { enable: true, cardReaderFunction: M.noFP ? (n === 1 ? ['face'] : []) : (n === M.reader ? ['fingerPrint', 'face'] : ['face']) } });
      }
      if (u.startsWith('/ISAPI/AccessControl/FingerPrintUpload')) {
        if (M.noFP) return json({ FingerPrintInfo: { searchID: body().FingerPrintCond.searchID, status: 'NoFP' } });
        const c = body().FingerPrintCond, list = M.fps.get(c.employeeNo) || [];
        return json({ FingerPrintInfo: { searchID: c.searchID, status: list.length ? 'OK' : 'NoFP',
          FingerPrintList: list.map((f) => ({ cardReaderNo: M.reader, fingerPrintID: f.id, fingerType: 'normalFP', fingerData: f.data })) } });
      }
      if (u.startsWith('/ISAPI/AccessControl/FingerPrint/SetUp') && req.method === 'POST') {
        if (M.noFP) { M.fpWrites.push('x'); return json({ FingerPrintStatus: { status: 'failed', StatusList: [{ id: 2, cardReaderRecvStatus: 8 }] } }); }   // máy thật DS-K1T671M trả mã 8
        const x = body().FingerPrintCfg; M.fpWrites.push({ pin: x.employeeNo, readers: x.enableCardReader, id: x.fingerPrintID });
        const ok = x.enableCardReader.length === 1 && x.enableCardReader[0] === M.reader;   // sai đầu đọc → máy báo 0 (mất kết nối) như máy thật
        if (ok) { const l = (M.fps.get(x.employeeNo) || []).filter((f) => f.id !== x.fingerPrintID); l.push({ id: x.fingerPrintID, data: x.fingerData }); M.fps.set(x.employeeNo, l); }
        return json({ FingerPrintStatus: { status: ok ? 'success' : 'failed', StatusList: [{ id: x.enableCardReader[0], cardReaderRecvStatus: ok ? 1 : 0 }] } });
      }
      no();
    });
  });
  return M;
}
const A = makeDev('HIKSYNC-A', { reader: 1 }), B = makeDev('HIKSYNC-B', { reader: 2 }), C = makeDev('HIKSYNC-C', { noFP: true });
const ids = {};

before(async () => {
  const D = await import('../server/db.js');
  db = D.db; setSetting = D.setSetting; D.initSchema();
  ZK = await import('../server/zk-tcp.js');
  const add = (m) => (p, ...h) => { routes[`${m} ${p}`] = h; };
  (await import('../server/routes/admin/devices.js')).registerDeviceRoutes({ get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE') }, { need: () => (q, s, n) => n() });
  for (const M of [A, B, C]) { await new Promise((ok) => M.srv.listen(0, '127.0.0.1', ok)); M.port = M.srv.address().port; }
  setSetting('device_enabled', '1'); setSetting('hik_device_enabled', '1');
  // dữ liệu đăng ký sẵn trên từng máy
  A.users.set('7001', 'Nguyen Van An'); A.faces.set('7001', jpg(1)); A.fps.set('7001', [{ id: 1, data: 'FP-AN-1' }, { id: 6, data: 'FP-AN-6' }]); A.cards.set('7001', ['111']);
  A.users.set('7002', 'Tran Thi Binh'); A.faces.set('7002', jpg(2));
  A.users.set('7003', 'Da nghi viec'); A.fps.set('7003', [{ id: 1, data: 'FP-NGHI' }]);
  B.users.set('7001', 'Nguyen Van An');   // B có người nhưng chưa có mặt / vân tay / thẻ
  B.users.set('7004', 'Le Van Cuong'); B.cards.set('7004', ['222']); B.fps.set('7004', [{ id: 2, data: 'FP-CUONG-2' }]);
  // 7003 là NV đã KHOÁ trong phần mềm → không chép đi đâu
  db.prepare("INSERT INTO employees(code, full_name, username, password_hash, device_pin, active) VALUES('NV7003','Da nghi viec','nv7003','x','7003',0)").run();
});
after(() => { for (const M of [A, B, C]) { M.srv?.closeAllConnections?.(); M.srv?.close(); } });

const sync = async (id, body = {}) => {
  const r = await call('POST /devices/:id/hik/:action', { params: { id, action: 'sync' }, body });
  if (r.code !== 200) return r;
  const j = await waitJob(r.out.job);
  return { code: 200, job: j, out: j.result };
};

test('thêm 3 máy Hikvision; máy chưa có Nhóm đồng bộ → 400, nhóm mới 1 máy → báo cần 2 máy, không ghi gì', async () => {
  for (const M of [A, B, C]) {
    const r = await call('POST /devices/hik', { body: { ip: '127.0.0.1', port: M.port, user: USER, pass: PASS, name: M.serial } });
    assert.equal(r.code, 200, JSON.stringify(r.out)); ids[M.serial] = r.out.id;
    assert.equal((await call('PUT /devices/:id', { params: { id: r.out.id }, body: { active: true } })).code, 200);
  }
  const r0 = await call('POST /devices/:id/hik/:action', { params: { id: ids[A.serial], action: 'sync' } });
  assert.equal(r0.code, 400); assert.match(r0.out.error, /Nhóm đồng bộ/);
  await call('PUT /devices/:id', { params: { id: ids[A.serial] }, body: { sync_group: 'KHO' } });
  const r1 = await sync(ids[A.serial]);
  assert.equal(r1.job.state, 'done', JSON.stringify(r1.job));
  assert.equal(r1.out.devices, 1); assert.match(r1.out.note, /ít nhất 2 máy/);
  assert.equal(B.users.size, 2, 'không đụng máy ngoài nhóm');
});

test('đồng bộ nhóm 3 máy: chép người + thẻ + mặt + vân tay còn thiếu, vân tay vào ĐÚNG đầu đọc máy nhận, bỏ NV đã khoá, máy không vân tay vẫn nhận phần khác', async () => {
  await call('PUT /devices/:id', { params: { id: ids[B.serial] }, body: { sync_group: 'KHO' } });
  await call('PUT /devices/:id', { params: { id: ids[C.serial] }, body: { sync_group: 'KHO' } });
  const r = await sync(ids[B.serial]);
  assert.equal(r.job.state, 'done', JSON.stringify(r.job));
  const o = r.out;
  assert.equal(o.devices, 3); assert.equal(o.people, 4);
  assert.deepEqual([o.users, o.faces, o.fps, o.cards, o.nofp, o.failed], [5, 4, 3, 4, 2, 0], JSON.stringify(o));
  assert.deepEqual(o.errors, []);
  // B: thêm 7002 (+mặt), 7001 có thêm mặt + 2 ngón + thẻ
  assert.deepEqual([...B.users.keys()].sort(), ['7001', '7002', '7004']);
  assert.ok(B.faces.get('7001').equals(A.faces.get('7001')), 'ảnh mặt chép nguyên ảnh JPG');
  assert.ok(B.faces.get('7002').equals(A.faces.get('7002')));
  assert.deepEqual(B.fps.get('7001').map((f) => [f.id, f.data]), [[1, 'FP-AN-1'], [6, 'FP-AN-6']]);
  assert.deepEqual(B.cards.get('7001'), ['111']);
  assert.ok(B.fpWrites.every((w) => w.readers.join() === '2'), 'máy B ghi vân tay vào đầu đọc 2');
  // A: thêm 7004 + thẻ + vân tay (đầu đọc 1)
  assert.equal(A.users.get('7004'), 'Le Van Cuong');
  assert.deepEqual(A.cards.get('7004'), ['222']);
  assert.deepEqual(A.fps.get('7004').map((f) => [f.id, f.data]), [[2, 'FP-CUONG-2']]);
  assert.ok(A.fpWrites.every((w) => w.readers.join() === '1'));
  // C (không vân tay): có người + mặt + thẻ, không vân tay
  assert.deepEqual([...C.users.keys()].sort(), ['7001', '7002', '7004']);
  assert.equal(C.faces.size, 2); assert.deepEqual(C.cards.get('7001'), ['111']); assert.deepEqual(C.cards.get('7004'), ['222']);
  assert.equal(C.fps.size, 0);
  assert.equal(C.fpWrites.length, 0, 'máy không có đầu đọc vân tay → không gửi vân tay xuống');
  // NV đã khoá không đi đâu
  for (const M of [B, C]) assert.ok(!M.users.has('7003'), 'NV khoá 7003 không chép sang ' + M.serial);
  // không xoá gì trên máy nguồn
  assert.deepEqual([...A.users.keys()].sort(), ['7001', '7002', '7003', '7004']);
  // phần mềm biết người mới trên từng máy (Tải NV / khớp lượt chấm)
  const per = Object.fromEntries(o.per.map((x) => [x.device, x]));
  assert.equal(per[B.serial].users, 1); assert.equal(per[A.serial].users, 1); assert.equal(per[C.serial].users, 3);
});

test('bấm lại khi các máy đã giống nhau: không ghi người / mặt / thẻ / vân tay nào nữa', async () => {
  const before = [A, B, C].map((M) => M.fpWrites.length);
  const r = await sync(ids[C.serial]);
  assert.equal(r.job.state, 'done', JSON.stringify(r.job));
  assert.deepEqual([r.out.users, r.out.faces, r.out.fps, r.out.cards, r.out.failed], [0, 0, 0, 0, 0], JSON.stringify(r.out));
  assert.deepEqual([A, B].map((M) => M.fpWrites.length), before.slice(0, 2));
});

test('lọc theo Số ID: chỉ chép đúng người được chọn', async () => {
  A.users.set('7005', 'Moi A'); A.users.set('7006', 'Moi A 2'); A.faces.set('7006', jpg(6));
  const r = await sync(ids[A.serial], { pins: ['7006'] });
  assert.equal(r.job.state, 'done', JSON.stringify(r.job));
  assert.equal(r.out.people, 1);
  assert.ok(B.users.has('7006') && C.users.has('7006')); assert.ok(B.faces.has('7006'));
  assert.ok(!B.users.has('7005') && !C.users.has('7005'), '7005 không được chọn → chưa chép');
});

test('1 máy trong nhóm mất kết nối: báo máy đó, 2 máy còn lại vẫn đồng bộ', async () => {
  C.down = true;
  try {
    const r = await sync(ids[A.serial]);
    assert.equal(r.job.state, 'done', JSON.stringify(r.job));
    assert.equal(r.out.devices, 2);
    assert.equal(r.out.offline.length, 1); assert.match(r.out.offline[0], /HIKSYNC-C/);
    assert.ok(B.users.has('7005'), 'B vẫn nhận 7005 từ A');
  } finally { C.down = false; }
});

test('máy nhận nhỏ (đầy): chép tới khi đủ sức chứa rồi dừng, báo rõ còn bao nhiêu người chưa chép, NV phần mềm được ưu tiên', async () => {
  for (let k = 0; k < 4; k++) A.users.set('80' + k, 'Khach ' + k);
  db.prepare("INSERT INTO employees(code, full_name, username, password_hash, device_pin, active) VALUES('NV803','NV phan mem 803','nv803','x','803',1)").run();
  C.max = C.users.size + 2;   // C chỉ còn chỗ cho 2 người
  try {
    const r = await sync(ids[A.serial]);
    assert.equal(r.job.state, 'done', JSON.stringify(r.job));
    const pc = r.out.per.find((x) => x.device === C.serial);
    assert.equal(pc.users, 2); assert.equal(pc.full, 3); assert.equal(r.out.full, 3);   // C còn thiếu 7005 + 800…803 = 5 người, chỉ chứa thêm 2
    assert.ok(C.users.has('803'), 'NV có trong phần mềm được chép trước');
    assert.match(r.out.errors[0], /HIKSYNC-C ĐẦY: máy chỉ chứa \d+ người — còn 3 người/);
    assert.ok(['800', '801', '802', '803'].every((p) => B.users.has(p)), 'máy B không giới hạn vẫn nhận đủ');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM employees WHERE device_pin IN ('7001','7002','7004','7005','7006','800','801','802')").get().n, 0, 'đồng bộ máy↔máy không tự tạo NV nháp');
    const r2 = await sync(ids[A.serial]);   // bấm lại: không cố ghi vào máy đầy
    assert.equal(r2.out.per.find((x) => x.device === C.serial).users, 0); assert.equal(r2.out.full, 3);
  } finally { delete C.max; }
});

test('ảnh khuôn mặt đăng ký: Tải NV máy Hikvision → NV chưa có ảnh được tải ảnh mặt về phần mềm (chạy nền), người không có mặt thì không', async () => {
  const photo = (pin) => db.prepare('SELECT kind, photo FROM device_user_photos WHERE pin=?').get(pin);
  assert.equal(photo('7002'), undefined, 'đồng bộ máy↔máy không lưu ảnh người lạ');
  const r = await call('POST /devices/:id/hik/:action', { params: { id: ids[B.serial], action: 'users' } });
  const j = await waitJob(r.out.job);
  assert.equal(j.state, 'done', JSON.stringify(j));
  assert.ok(j.result.photos >= 3, JSON.stringify(j.result));   // 7001, 7002, 7006 có mặt trên B
  for (let k = 0; k < 200 && !(photo('7001') && photo('7002') && photo('7006')); k++) await sleep(20);
  for (const pin of ['7001', '7002', '7006']) {
    const ph = photo(pin); assert.ok(ph, 'có ảnh ' + pin); assert.equal(ph.kind, 'face');
    assert.ok(Buffer.from(ph.photo, 'base64').equals(B.faces.get(pin)), 'đúng ảnh đã đăng ký trên máy ' + pin);
  }
  assert.equal(photo('7004'), undefined, '7004 không có mặt trên máy → không có ảnh');
  const r2 = await call('POST /devices/:id/hik/:action', { params: { id: ids[B.serial], action: 'users' } });
  assert.equal((await waitJob(r2.out.job)).result.photos, 0, 'tải lại: NV đã có ảnh thì không tải nữa');
});

test('tắt tính năng máy Hikvision → không đồng bộ được (như cũ)', async () => {
  setSetting('hik_device_enabled', '0');
  try {
    const r = await call('POST /devices/:id/hik/:action', { params: { id: ids[A.serial], action: 'sync' } });
    assert.notEqual(r.code, 200);
  } finally { setSetting('hik_device_enabled', '1'); }
});
