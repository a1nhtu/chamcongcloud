// Xoá NV trong phần mềm kèm xoá trên tất cả máy: không xoá trên máy thì NV tự đồng bộ về lại. Chạy: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, readdirSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-xoa-nv-hoi-may-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, S, backupDir, backupsBefore;
const routes = {};
const ADMIN = { id: 999999, role: 'admin', full_name: 'Admin' };
// Chạy cả chuỗi middleware của route (để kiểm quyền thật)
const call = async (key, { body = {}, params = {} } = {}, user = ADMIN) => {
  let out = null, code = 200;
  const res = { status(c) { code = c; return this; }, json(o) { out = o; return this; } };
  const req = { body, params, query: {}, user };
  const run = async (i) => { if (routes[key][i]) await routes[key][i](req, res, () => run(i + 1)); };
  await run(0);
  return { code, out };
};
const addEmp = (code, pin) => Number(db.prepare('INSERT INTO employees(code, full_name, department, role, username, password_hash, device_pin) VALUES(?,?,?,?,?,?,?)')
  .run(code, 'NV ' + code, '', 'employee', code.toLowerCase(), 'x', pin).lastInsertRowid);
const onDevice = (pin) => {
  for (const s of ['SN_A', 'SN_B']) S.ingestUserData(s, 'USER', `USER PIN=${pin}\tName=NV ${pin}\tPri=0`);
};
const empByPin = (pin) => db.prepare('SELECT id FROM employees WHERE device_pin=?').get(pin);
const pendingAll = (serial) => db.prepare('SELECT content FROM push_device_commands WHERE serial=? AND trans_time IS NULL').all(serial).map((r) => r.content);
const sendAll = () => db.prepare("UPDATE push_device_commands SET trans_time=datetime('now') WHERE trans_time IS NULL").run();

before(async () => {
  const D = await import('../server/db.js');
  db = D.db; D.initSchema();
  S = await import('../server/device-sync.js');
  const { permRequired } = await import('../server/auth.js');
  const add = (m) => (p, ...h) => { routes[`${m} ${p}`] = h; };
  const R = { get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE') };
  (await import('../server/routes/admin/devices.js')).registerDeviceRoutes(R, { need: permRequired });
  (await import('../server/routes/admin/employees.js')).registerEmployeeRoutes(R, { need: permRequired });
  db.prepare("INSERT INTO push_devices(serial,name,active,sync_group) VALUES('SN_A','Máy cổng',1,'G'),('SN_B','Máy xưởng',1,'G')").run();
  // purge-bulk ≥2 người tự sao lưu vào data/backups thật → ghi nhận để dọn sau
  backupDir = new URL('../data/backups/', import.meta.url);
  try { backupsBefore = new Set(readdirSync(backupDir)); } catch { backupsBefore = new Set(); }
});
after(() => {
  try { for (const f of readdirSync(backupDir)) if (!backupsBefore.has(f)) rmSync(new URL(f, backupDir)); } catch {}
});

test('xoá nhiều NV: trả Số ID của người đã xoá để xoá tiếp trên máy', async () => {
  const a = addEmp('A1', '11'), b = addEmp('B1', '12'), c = addEmp('C1', '');
  const { code, out } = await call('POST /employees/purge-bulk', { body: { ids: [a, b, c] } });
  assert.equal(code, 200);
  assert.equal(out.deleted, 3);
  assert.deepEqual(out.pins.sort(), ['11', '12']);
});

test('xoá 1 NV: cũng trả Số ID', async () => {
  const a = addEmp('A2', '21');
  const { out } = await call('DELETE /employees/:id/purge', { params: { id: String(a) } });
  assert.deepEqual(out.pins, ['21']);
});

test('Số ID NV khác còn mang thì không trả về (khỏi xoá nhầm họ trên máy)', async () => {
  const a = addEmp('A3', '31'); addEmp('B3', '31');
  const { out } = await call('DELETE /employees/:id/purge', { params: { id: String(a) } });
  assert.deepEqual(out.pins, []);
});

test('chỉ xoá phần mềm: máy gửi lại thì NV tự về lại', async () => {
  onDevice('41');
  const id = empByPin('41').id;
  await call('DELETE /employees/:id/purge', { params: { id: String(id) } });
  assert.equal(empByPin('41'), undefined);
  onDevice('41');
  assert.ok(empByPin('41'), 'NV về lại vì còn trên máy');
});

test('xoá cả trên máy: mọi máy nhận lệnh xoá, đồng bộ không đẩy lại', async () => {
  onDevice('51');
  S.storeTemplates('SN_A', 'FP', `FP PIN=51\tFID=0\tSize=40\tValid=1\tTMP=${'x'.repeat(40)}`);
  sendAll();
  const id = empByPin('51').id;
  const { out } = await call('DELETE /employees/:id/purge', { params: { id: String(id) } });
  const r = await call('POST /devices/delete-users-all', { body: { pins: out.pins } });
  assert.equal(r.code, 200);
  assert.deepEqual(r.out.push.sort(), ['Máy cổng', 'Máy xưởng']);
  for (const s of ['SN_A', 'SN_B']) assert.ok(pendingAll(s).includes('DATA DELETE USERINFO\tPIN=51'), s);
  sendAll();
  S.syncFillDevice('SN_B');
  assert.ok(!pendingAll('SN_B').some((c) => /USERINFO PIN=51\b/.test(c)), 'không đẩy lại người vừa xoá');
  assert.equal(empByPin('51'), undefined);
});

test('quyền: có quyền Nhân viên là xoá được trên máy; không quyền nào thì bị chặn', async () => {
  const pins = ['51'];
  const onlyEmp = { id: 5001, role: 'manager', permissions: JSON.stringify(['employees']) };
  const onlyDev = { id: 5002, role: 'manager', permissions: JSON.stringify(['devices']) };
  const none = { id: 5003, role: 'manager', permissions: JSON.stringify(['reports']) };
  assert.equal((await call('POST /devices/delete-users-all', { body: { pins } }, onlyEmp)).code, 200);
  assert.equal((await call('POST /devices/delete-users-all', { body: { pins } }, onlyDev)).code, 200);
  assert.equal((await call('POST /devices/delete-users-all', { body: { pins } }, none)).code, 403);
  assert.equal((await call('GET /devices/cmd-progress', {}, none)).code, 403);
  assert.equal((await call('GET /devices/tcp-jobs/:job', { params: { job: 'x' } }, none)).code, 403);
});
