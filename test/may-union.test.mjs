// Máy Union / Virdi (server/union.js) chạy với cầu nối GIẢ LẬP tools/sim-union.mjs (không cần máy thật / SDK):
// công tắc tắt = không mở cổng · máy kết nối → Chờ duyệt · chưa duyệt bỏ lượt chấm · duyệt rồi: tải NV / chấm công / thông tin,
// lượt chấm real-time vào ngay, lượt không hợp lệ (máy từ chối / Số ID 0) bị bỏ · admin bật được máy TCP/IP + Union.
// Chạy: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DBP = join(tmpdir(), `dgp-union-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;
process.env.UNION_BRIDGE = 'node ' + fileURLToPath(new URL('../tools/sim-union.mjs', import.meta.url));
process.env.SIM_UNION_RT_MS = '1500';   // máy giả gửi lượt chấm real-time mỗi 1,5 giây

let db, setSetting, getSetting, U;
const routes = {};
const call = async (key, params, body, user = { id: 1, role: 'admin', master: true }) => {
  let out = null, code = 200, i = 0;
  const res = { status(c) { code = c; return this; }, json(o) { out = o; return this; } };
  const req = { body, params, query: {}, user };
  const hs = routes[key]; const next = async () => { const h = hs[i++]; if (h) await h(req, res, next); };
  await next();
  return { code, out };
};
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const until = async (fn, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await sleep(50); } return fn(); };
const job = async (id) => { for (;;) { const r = await call('GET /devices/tcp-jobs/:job', { job: id }); if (r.out.state !== 'run') return r.out; await sleep(50); } };
const dev = () => db.prepare("SELECT * FROM push_devices WHERE serial='UNION-0001'").get();
const punches = () => db.prepare("SELECT pin, punch_at, status, verify FROM device_punches WHERE serial='UNION-0001' ORDER BY punch_at").all();

before(async () => {
  const D = await import('../server/db.js');
  db = D.db; setSetting = D.setSetting; getSetting = D.getSetting; D.initSchema();
  U = await import('../server/union.js');
  const add = (m) => (p, ...h) => { routes[`${m} ${p}`] = h; };
  const r = { get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE') };
  (await import('../server/routes/admin/devices.js')).registerDeviceRoutes(r, { need: () => (q, s, n) => n() });
  setSetting('device_enabled', '1');
});
after(() => { setSetting('union_device_enabled', '0'); U.syncUnion(); });

test('công tắc tắt: không chạy cầu nối, thao tác báo chưa bật', async () => {
  U.syncUnion();
  assert.equal(U.unionStatus().running, false);
  const r = await call('POST /devices/:id/union/:action', { id: 1, action: 'users' }, {});
  assert.equal(r.code, 400);
  assert.match(r.out.error, /Chưa bật "Dùng máy Union"/);
});

test('admin (không phải tài khoản tổng) bật được máy TCP/IP + máy Union', async () => {
  const r = await call('PUT /device-options', {}, { tcp_device_enabled: true, union_device_enabled: true, union_port: '9871' }, { id: 2, role: 'admin', master: false });
  assert.equal(r.code, 200);
  assert.equal(getSetting('tcp_device_enabled'), '1');
  assert.equal(getSetting('union_device_enabled'), '1');
  assert.equal(U.unionPort(), 9871);
  assert.equal((await call('PUT /device-options', {}, { union_port: '99999' })).code, 400);
});

test('máy kết nối → Chờ duyệt, Online; chưa duyệt thì bỏ lượt chấm real-time', async () => {
  assert.ok(await until(() => U.unionStatus().running), 'cầu nối chưa chạy');
  const d = await until(dev);
  assert.ok(d, 'máy chưa hiện trong danh sách');
  assert.equal(d.active, 0);
  assert.equal(d.conn_type, 'union');
  assert.equal(d.last_ip, '192.168.1.50');
  assert.equal(U.unionOnline('UNION-0001'), true);
  const r = await call('POST /devices/:id/union/:action', { id: d.id, action: 'users' }, {});
  assert.equal(r.code, 400);
  assert.match(r.out.error, /chưa được duyệt/);
  assert.equal(punches().length, 0);
});

test('duyệt rồi: thông tin máy, tải NV (tự tạo NV), tải chấm công (bỏ lượt không hợp lệ, không trùng khi tải lại)', async () => {
  const d = dev();
  await call('PUT /devices/:id', { id: d.id }, { active: true });
  const info = await job((await call('POST /devices/:id/union/:action', { id: d.id, action: 'info' }, {})).out.job);
  assert.equal(info.state, 'done', info.msg);
  assert.equal(info.result.info.users, 3);
  assert.equal(info.result.info.user_cap, 3000);
  assert.equal(info.result.info.firmware, 'AC-2200 v1.2.3');
  assert.equal(JSON.parse(dev().tcp_info).fps, 4);

  const us = await job((await call('POST /devices/:id/union/:action', { id: d.id, action: 'users' }, {})).out.job);
  assert.equal(us.state, 'done', us.msg);
  assert.equal(us.result.read, 3);
  assert.ok(db.prepare("SELECT 1 FROM device_users_serial WHERE serial='UNION-0001' AND pin='1001'").get());

  const lg = await job((await call('POST /devices/:id/union/:action', { id: d.id, action: 'logs' }, {})).out.job);
  assert.equal(lg.state, 'done', lg.msg);
  assert.equal(lg.result.read, 4);    // 6 dòng trên máy: 1 bị máy từ chối + 1 Số ID 0 → bỏ
  assert.equal(lg.result.added, 4);
  const p = punches();
  // (máy giả còn gửi lượt real-time của 1001 mỗi 1,5 giây nên chỉ đếm 1002 cho chắc)
  assert.equal(p.filter((x) => x.pin === '1002').length, 2);
  assert.ok(p.filter((x) => x.pin === '1001').length >= 2);
  assert.ok(!p.some((x) => x.pin === '9999' || x.pin === '0'), 'lượt máy từ chối / Số ID 0 phải bị bỏ');
  assert.deepEqual([...new Set(p.filter((x) => x.pin === '1002').map((x) => x.verify))].sort((a, b) => a - b), [4, 15]);   // thẻ · khuôn mặt
  assert.ok(p.some((x) => x.status === 1), 'AuthMode 2 (tan ca) → trạng thái ra');
  const again = await job((await call('POST /devices/:id/union/:action', { id: d.id, action: 'logs' }, {})).out.job);
  assert.equal(again.result.added, 0);
});

test('lượt chấm real-time của máy đã duyệt vào ngay; tắt công tắc đóng cầu nối', async () => {
  const n0 = punches().length;
  await until(() => punches().length > n0, 6000);
  assert.ok(punches().length > n0, 'chưa nhận lượt chấm real-time');
  setSetting('union_device_enabled', '0'); U.syncUnion();
  assert.equal(U.unionStatus().running, false);
  assert.equal(U.unionOnline('UNION-0001'), false);
});
