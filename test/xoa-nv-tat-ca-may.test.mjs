// Xoá NV nghỉ việc trên TẤT CẢ máy + Khoá → không bị đồng bộ lại xuống máy. 2 máy ADMS giả lập cùng nhóm đồng bộ. Chạy: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-xoa-nv-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;
process.env.UNION_BRIDGE = 'node ' + new URL('../tools/sim-union.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');   // bật công tắc Union trong test → cầu nối giả, không mở cổng thật

let db, S;
const routes = {};
const ADMIN = { id: 999999, role: 'admin', full_name: 'Admin' };
const call = async (key, body = {}, user = ADMIN) => {
  let out = null, code = 200;
  const res = { status(c) { code = c; return this; }, json(o) { out = o; return this; } };
  await routes[key]({ body, params: {}, query: {}, user }, res);
  return { code, out };
};
const FP = (pin, idx, tmp) => `FP PIN=${pin}\tFID=${idx}\tSize=${tmp.length}\tValid=1\tTMP=${tmp}`;
const pending = (serial, pin) => db.prepare("SELECT content FROM push_device_commands WHERE serial=? AND pin=? AND trans_time IS NULL").all(serial, pin).map((r) => r.content);
const pendingAll = (serial) => db.prepare('SELECT content FROM push_device_commands WHERE serial=? AND trans_time IS NULL').all(serial).map((r) => r.content);
const sendAll = () => db.prepare("UPDATE push_device_commands SET trans_time=datetime('now') WHERE trans_time IS NULL").run();

before(async () => {
  const D = await import('../server/db.js');
  db = D.db; D.initSchema();
  S = await import('../server/device-sync.js');
  const add = (m) => (p, ...h) => { routes[`${m} ${p}`] = h[h.length - 1]; };
  const R = { get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE') };
  (await import('../server/routes/admin/devices.js')).registerDeviceRoutes(R, { need: () => (q, s, n) => n() });
  (await import('../server/routes/admin/employees.js')).registerEmployeeRoutes(R, { need: () => (q, s, n) => n() });
  db.prepare("INSERT INTO push_devices(serial,name,active,sync_group) VALUES('SN_A','Máy cổng',1,'G'),('SN_B','Máy xưởng',1,'G')").run();
  // 3 NV đăng ký trên máy A → đồng bộ sang máy B (giống thực tế)
  for (const [pin, name] of [['5', 'Nguyen Van A'], ['6', 'Tran Thi B'], ['7', 'Le Van C']]) {
    S.syncPinsToGroup('SN_A', S.ingestUserData('SN_A', 'USER', `USER PIN=${pin}\tName=${name}\tPri=0`));
    S.syncPinsToGroup('SN_A', S.storeTemplates('SN_A', 'FP', FP(pin, 0, 'T' + pin + 'x'.repeat(40))));
  }
  // máy B xác nhận đã nhận → số đếm máy B có đủ 3 người
  for (const c of db.prepare("SELECT id FROM push_device_commands WHERE serial='SN_B'").all()) { S.nextCommand('SN_B'); S.ackCommand(c.id, '0'); }
  S.nextCommand('SN_A');
  sendAll();
});

test('chuẩn bị: 3 NV có trên cả 2 máy', () => {
  for (const s of ['SN_A', 'SN_B']) assert.equal(db.prepare('SELECT COUNT(*) c FROM device_users_serial WHERE serial=?').get(s).c, 3);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM employees WHERE device_pin IN ('5','6','7') AND active=1").get().c, 3);
});

test('danh sách Số ID trên tất cả máy: thấy người + các máy đang có', async () => {
  const { out } = await call('GET /devices/all-users');
  const u5 = out.rows.find((r) => r.pin === '5');
  assert.equal(u5.name, 'Nguyen Van A');
  assert.deepEqual(u5.devices.sort(), ['Máy cổng', 'Máy xưởng']);
  assert.equal(u5.active, true);
});

test('CŨ (chưa khoá): xoá trên 1 máy → máy kia đẩy lại khi kết nối lại', () => {
  S.deleteDeviceUsers('SN_A', ['7']);
  sendAll();
  S.syncFillDevice('SN_A');   // máy A khởi động / kết nối lại
  assert.ok(pending('SN_A', '7').some((c) => c.startsWith('DATA UPDATE USERINFO PIN=7')), 'NV chưa khoá vẫn được đồng bộ lại như trước');
  sendAll();
});

test('xoá trên TẤT CẢ máy 1 lần: mỗi máy nhận lệnh xoá, bỏ lệnh đồng bộ đang chờ', async () => {
  S.syncFillDevice('SN_B');   // tạo vài lệnh đồng bộ đang chờ
  const { code, out } = await call('POST /devices/delete-users-all', { pins: ['5', '6', 'bad pin!'] });
  assert.equal(code, 200);
  assert.equal(out.pins, 2);   // Số ID rác bị bỏ
  assert.deepEqual(out.push.sort(), ['Máy cổng', 'Máy xưởng']);
  for (const s of ['SN_A', 'SN_B']) for (const p of ['5', '6']) {
    assert.ok(pendingAll(s).includes(`DATA DELETE USERINFO\tPIN=${p}`), `${s} xoá ${p}`);
    assert.ok(!pending(s, p).some((c) => c.startsWith('DATA UPDATE')), `${s} không còn lệnh ghi lại ${p}`);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM device_users_serial WHERE serial=? AND pin=?').get(s, p).c, 0);
  }
  sendAll();
});

test('khoá hàng loạt theo Số ID (không khoá tài khoản đang đăng nhập)', async () => {
  const me = db.prepare("SELECT id FROM employees WHERE device_pin='6'").get().id;
  const { out } = await call('POST /employees/lock-by-pins', { pins: ['5', '6'] }, { id: me, role: 'admin' });
  assert.equal(out.locked, 1); assert.equal(out.self, true);
  const { out: o2 } = await call('POST /employees/lock-by-pins', { pins: ['6'] });
  assert.equal(o2.locked, 1);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM employees WHERE device_pin IN ('5','6') AND active=0").get().c, 2);
});

test('ĐÃ KHOÁ: máy kết nối lại / bấm Đồng bộ / ép đồng bộ → KHÔNG đẩy lại NV đã khoá', () => {
  S.syncFillDevice('SN_A'); S.syncFillDevice('SN_B');
  S.resyncNow(true);
  for (const s of ['SN_A', 'SN_B']) for (const p of ['5', '6']) assert.deepEqual(pending(s, p), [], `${s} không nhận lại ${p}`);
  sendAll();
});

test('ĐÃ KHOÁ: máy B (chưa kịp xoá) đẩy vân tay người đó lên → không lan sang máy A', () => {
  const pins = S.storeTemplates('SN_B', 'FP', FP('5', 1, 'Z'.repeat(40)));
  S.syncPinsToGroup('SN_B', pins);
  assert.deepEqual(pending('SN_A', '5'), []);
  // NV không bị tạo lại thành NV nháp mới
  assert.equal(db.prepare("SELECT COUNT(*) c FROM employees WHERE device_pin='5'").get().c, 1);
});

test('mở khoá lại → đồng bộ bình thường như cũ', async () => {
  db.prepare("UPDATE employees SET active=1 WHERE device_pin='5'").run();
  S.syncFillDevice('SN_A');
  assert.ok(pending('SN_A', '5').some((c) => c.startsWith('DATA UPDATE')));
});

test('admin (quyền Máy chấm công) bật/tắt được công tắc vận hành + máy TCP/IP + máy Union, KHÔNG đổi được Dùng máy chấm công / key', async () => {
  const { getSetting, setSetting } = await import('../server/db.js');
  setSetting('device_enabled', '1'); setSetting('device_key_required', '1');
  await call('PUT /device-options', { device_pin_guard: false, device_auto_push_emp: false, device_autocreate: false, device_name_ascii: false,
    device_enabled: false, device_key_required: false, tcp_device_enabled: true, union_device_enabled: true });
  assert.equal(getSetting('device_pin_guard', '1'), '0'); assert.equal(getSetting('device_auto_push_emp', '1'), '0');
  assert.equal(getSetting('device_autocreate', '1'), '0'); assert.equal(getSetting('device_name_ascii', '1'), '0');
  assert.equal(getSetting('device_enabled', '0'), '1'); assert.equal(getSetting('device_key_required', '0'), '1');
  assert.equal(getSetting('tcp_device_enabled', '0'), '1'); assert.equal(getSetting('union_device_enabled', '0'), '1');
  setSetting('union_device_enabled', '0'); (await import('../server/union.js')).syncUnion();   // không để cầu nối Union chạy trong lúc test
});

test('thêm NV: để trống tài khoản = mã NV, để trống mật khẩu = 123456; trùng tài khoản → báo rõ', async () => {
  const { verifyPassword } = await import('../server/auth.js');
  const { code, out } = await call('POST /employees', { code: 'NV900', full_name: 'Thử Mặc Định' });
  assert.equal(code, 200, JSON.stringify(out));
  const emp = db.prepare("SELECT * FROM employees WHERE code='NV900'").get();
  assert.equal(emp.username, 'NV900');
  assert.ok(verifyPassword('123456', emp.password_hash));
  const r2 = await call('POST /employees', { code: 'NV901', full_name: 'Trùng TK', username: 'NV900' });
  assert.equal(r2.code, 400); assert.match(r2.out.error, /Tài khoản đăng nhập "NV900" đã có/);
  const r3 = await call('POST /employees', { code: 'NV902', full_name: 'Tự đặt', username: 'tudat', password: 'abc999' });
  assert.equal(r3.code, 200);
  assert.ok(verifyPassword('abc999', db.prepare("SELECT password_hash FROM employees WHERE code='NV902'").get().password_hash));
});

test('xuất danh sách NV ra Excel: cùng thứ tự cột với file nhập, có Số ID + trạng thái, mật khẩu để trống', async () => {
  const ExcelJS = (await import('exceljs')).default;
  const headers = {};
  const { PassThrough } = await import('node:stream');
  const pt = new PassThrough(); const chunks = []; pt.on('data', (c) => chunks.push(c));
  Object.assign(pt, { setHeader(k, v) { headers[k] = v; } });
  db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash, device_pin, active) VALUES ('NV950','Xuất Thử','employee','nv950','x','950',1)").run();
  await routes['GET /employees/export.xlsx']({ user: ADMIN, query: {} }, pt);
  await new Promise((r) => setImmediate(r));
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.concat(chunks));
  const ws = wb.worksheets[0];
  assert.equal(ws.getRow(1).getCell(1).value, 'Mã NV *'); assert.equal(ws.getRow(1).getCell(7).value, 'Số ID máy chấm công');
  assert.equal(ws.getRow(1).getCell(11).value, 'Trạng thái');
  let found = null;
  ws.eachRow((r, i) => { if (i > 1 && r.getCell(1).value === 'NV950') found = r; });
  assert.ok(found); assert.equal(String(found.getCell(7).value), '950'); assert.equal(found.getCell(9).value, 'nv950'); assert.ok(!found.getCell(10).value, 'mật khẩu để trống'); assert.equal(found.getCell(11).value, 'Đang làm');
  assert.match(headers['Content-Disposition'], /danh_sach_nhan_vien_/);
});
