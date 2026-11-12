// Máy TCP/IP đang tắt lúc xoá NV trên tất cả máy: nhớ lại, máy bật lên tự xoá; lúc chờ không đọc NV đó về. Chạy: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { moCong } from './_cong.mjs';   // cổng ngẫu nhiên an toàn (tránh cổng fetch cấm / cổng test khác đang dò)

const WIN = process.platform === 'win32';
const opt = { skip: !WIN && 'cần PowerShell (Windows)' };
const DBP = join(tmpdir(), `dgp-xoa-cho-tcp-${process.pid}.db`);
const FAKE = join(tmpdir(), `dgp-xoa-cho-tcp-fake-${process.pid}.ps1`);
const LOG = join(tmpdir(), `dgp-xoa-cho-tcp-log-${process.pid}.txt`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;
process.env.ZK_TCP_SCRIPT = FAKE;
process.env.ZK_RETRY_MS = '50';

let db, S, Z, srv, port;
const routes = {};
const call = async (key, { body = {}, params = {} } = {}) => {
  let out = null, code = 200;
  const res = { status(c) { code = c; return this; }, json(o) { out = o; return this; } };
  await routes[key]({ body, params, query: {}, user: { id: 999999, role: 'admin' } }, res);
  return { code, out };
};
const waitJob = async (id) => {
  for (let i = 0; i < 400; i++) {
    const { out } = await call('GET /devices/tcp-jobs/:job', { params: { job: id } });
    if (out.state !== 'run') return out;
    await new Promise((ok) => setTimeout(ok, 50));
  }
  throw new Error('job không xong');
};
const pending = () => db.prepare("SELECT pin FROM device_pending_deletes WHERE serial='TCP001' ORDER BY pin").all().map((r) => r.pin);
const seed = (...pins) => { for (const p of pins) S.upsertDeviceUserSerial('TCP001', p, 'NV ' + p, ''); };
const setPort = (p) => db.prepare("UPDATE push_devices SET tcp_port=? WHERE serial='TCP001'").run(p);
const closedPort = async () => {
  const s = createServer(); await moCong(s);
  const p = s.address().port; await new Promise((ok) => s.close(ok)); return p;
};
const purgeOnAll = async (pins) => {
  const { out } = await call('POST /devices/delete-users-all', { body: { pins } });
  return waitJob(out.job);
};

before(async () => {
  // máy giả: xoá được mọi số trừ 66 (máy từ chối) và 77 (lệnh lỗi); đọc NV luôn trả 11, 12; ghi lại các lần xoá vào LOG
  writeFileSync(FAKE, '﻿' + `param([string]$Ip, [int]$Port = 4370, [int]$Key = 0, [string]$Action = 'info', [string]$From = '', [string]$To = '', [int]$Machine = 1, [string]$Proto = '')
function Out($s) { [Console]::Out.WriteLine($s) }
switch ($Action) {
  'info' { Out "I\`tserial\`tTCP001"; Out "I\`tusers\`t2"; Out "OK\`tinfo" }
  'users' { Out "U\`t11\`tNV 11\`t0\`t1\`t\`t"; Out "U\`t12\`tNV 12\`t0\`t1\`t\`t"; Out "OK\`tusers" }
  'delete-users' { if ($From -match '77') { Out "ERR\`tFAIL\`tloi"; exit 1 }; Add-Content -Path '${LOG.replace(/\\/g, '\\\\')}' -Value $From; foreach ($p in ($From -split ',')) { Out ("D\`t$p\`t" + $(if ($p -eq '66') { '0' } else { '1' })) }; Out "OK\`tdelete-users" }
  default { Out "ERR\`tBADACTION\`t$Action"; exit 1 }
}
`);
  srv = createServer((s) => s.destroy());
  await moCong(srv);
  port = srv.address().port;
  const D = await import('../server/db.js');
  db = D.db; D.initSchema();
  D.setSetting('device_enabled', '1'); D.setSetting('tcp_device_enabled', '1');
  S = await import('../server/device-sync.js');
  Z = await import('../server/zk-tcp.js');
  const add = (m) => (p, ...h) => { routes[`${m} ${p}`] = h[h.length - 1]; };
  (await import('../server/routes/admin/devices.js')).registerDeviceRoutes({ get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE') }, { need: () => (q, s, n) => n() });
  db.prepare("INSERT INTO push_devices(serial,name,active,conn_type,tcp_ip,tcp_port) VALUES('TCP001','Máy quầy',1,'tcp','127.0.0.1',?)").run(port);
});
after(() => { srv?.close(); for (const f of [FAKE, LOG]) { try { rmSync(f); } catch {} } });

test('máy tắt lúc xoá: nhớ lại Số ID, báo sẽ tự xoá, danh sách máy hiện số chờ', opt, async () => {
  seed('11', '12');
  setPort(await closedPort());
  const j = await purgeOnAll(['11']);
  assert.equal(j.result.devices[0].ok, false);
  assert.equal(j.result.devices[0].waiting, true);
  assert.deepEqual(pending(), ['11']);
  const { out } = await call('GET /devices');
  assert.equal(out.rows.find((d) => d.serial === 'TCP001').pending_del, 1);
});

test('máy vẫn tắt: dò không xoá gì, giữ nguyên hàng chờ', opt, async () => {
  assert.deepEqual(await Z.pendingCycle(true), []);
  assert.deepEqual(pending(), ['11']);
});

test('lúc chờ mà máy chưa xoá được: tải NV không đọc số đó về, không tạo lại NV', opt, async () => {
  db.prepare('DELETE FROM device_pending_deletes').run();
  db.prepare("INSERT INTO device_pending_deletes(serial,pin) VALUES('TCP001','11'),('TCP001','77')").run();   // 77: lệnh xoá lỗi
  const dev = db.prepare("SELECT * FROM push_devices WHERE serial='TCP001'").get();
  const r = await Z.tcpUsers(dev);
  assert.equal(r.read, 1);   // máy có 11 + 12, chỉ đọc 12
  assert.deepEqual(pending(), ['11', '77']);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM employees WHERE device_pin='11'").get().c, 0);
  db.prepare('DELETE FROM device_pending_deletes').run();
});

test('máy bật lại: tự xoá, hết hàng chờ, không còn trong danh sách máy', opt, async () => {
  seed('21', '22');
  setPort(await closedPort());
  await purgeOnAll(['21', '22']);
  assert.deepEqual(pending(), ['21', '22']);
  setPort(port);
  const out = await Z.pendingCycle(true);
  assert.deepEqual(out, [{ device: 'Máy quầy', deleted: 2 }]);
  assert.deepEqual(pending(), []);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM device_users_serial WHERE serial='TCP001' AND pin IN ('21','22')").get().c, 0);
});

test('Số ID đã cấp cho người khác trong lúc chờ: không xoá nhầm họ', opt, async () => {
  seed('31');
  setPort(await closedPort());
  await purgeOnAll(['31']);
  db.prepare("INSERT INTO employees(code,full_name,department,role,username,password_hash,device_pin) VALUES('M31','Nguoi moi','','employee','m31','x','31')").run();
  setPort(port);
  await Z.pendingCycle(true);
  assert.deepEqual(pending(), []);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM device_users_serial WHERE serial='TCP001' AND pin='31'").get().c, 1);
});

test('NV vẫn đang làm mà người dùng chủ động xoá trên máy: máy lên vẫn xoá', opt, async () => {
  db.prepare("INSERT INTO employees(code,full_name,department,role,username,password_hash,device_pin) VALUES('M41','Dang lam','','employee','m41','x','41')").run();
  seed('41');
  setPort(await closedPort());
  await purgeOnAll(['41']);
  setPort(port);
  const out = await Z.pendingCycle(true);
  assert.deepEqual(out, [{ device: 'Máy quầy', deleted: 1 }]);
});

test('máy từ chối xoá: thôi không thử lại (khỏi khoá máy liên tục)', opt, async () => {
  seed('66');
  setPort(await closedPort());
  await purgeOnAll(['66']);
  setPort(port);
  await Z.pendingCycle(true);
  assert.deepEqual(pending(), []);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM device_users_serial WHERE serial='TCP001' AND pin='66'").get().c, 1);
});

test('máy TCP/IP đang tạm dừng: nhớ lại, báo chờ, không vào danh sách "chưa xoá"', async () => {
  db.prepare("INSERT INTO push_devices(serial,name,active,conn_type,tcp_ip,tcp_port) VALUES('TCP002','Máy kho',0,'tcp','127.0.0.1',1)").run();
  S.upsertDeviceUserSerial('TCP002', '51', 'NV 51', '');
  const { out } = await call('POST /devices/delete-users-all', { body: { pins: ['51'] } });
  if (out.job) await waitJob(out.job);
  assert.deepEqual(out.waiting, ['Máy kho']);
  assert.deepEqual(out.idle, []);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM device_pending_deletes WHERE serial='TCP002' AND pin='51'").get().c, 1);
});

test('không có hàng chờ: không đụng tới máy', opt, async () => {
  db.prepare('DELETE FROM device_pending_deletes').run();
  const seen = readFileSync(LOG, 'utf8');
  assert.deepEqual(await Z.pendingCycle(true), []);
  assert.equal(readFileSync(LOG, 'utf8'), seen);
});
