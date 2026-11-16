// IP LAN của máy chấm công tự đẩy: máy khai trong INFO khi hỏi lệnh (mục thứ 5) hoặc IPAddress= trong bảng OPTIONS.
// Máy đẩy qua tên miền thì phần mềm chỉ thấy IP Internet nhà khách → cần IP LAN để biết máy đang ở đâu (tungphong 16/11/2026).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-ip-lan-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, H;
const resObj = () => ({ out: '', type() { return this; }, send(x) { this.out = String(x); return this; } });
const lanOf = (sn) => db.prepare('SELECT lan_ip FROM push_devices WHERE serial=?').get(sn)?.lan_ip;

before(async () => {
  const D = await import('../server/db.js');
  db = D.db; D.initSchema(); D.setSetting('device_enabled', '1');
  H = await import('../server/routes/iclock.js');
});

test('đọc IP từ INFO / OPTIONS, bỏ giá trị không phải IP', () => {
  assert.equal(H.lanIpOf('Ver 6.60 Apr 13 2022,12,30,5825,192.168.1.210,10,7,0,0,1', true), '192.168.1.210');
  assert.equal(H.lanIpOf('Ver 6.60,12,30,5825', true), '');
  assert.equal(H.lanIpOf('Ver 6.60,12,30,5825,0.0.0.0', true), '');
  assert.equal(H.lanIpOf('Ver 6.60,12,30,5825,999.1.1.1', true), '');
  assert.equal(H.lanIpOf('~DeviceName=X,MAC=00:17:61:12:14:C7,IPAddress=192.168.1.37,Platform=ZLM60_TFT'), '192.168.1.37');
  assert.equal(H.lanIpOf('GATEIPAddress=192.168.1.1'), '', 'không nhầm Gateway thành IP máy');
});

test('máy hỏi lệnh kèm INFO → lưu IP LAN; lần sau không kèm INFO thì giữ IP cũ', () => {
  H.handleGetRequest({ query: { SN: 'SN_IP', INFO: 'Ver 6.60 Apr 13 2022,1,2,3,192.168.1.210,10' }, headers: {}, socket: {} }, resObj());
  assert.equal(lanOf('SN_IP'), '192.168.1.210');
  H.handleGetRequest({ query: { SN: 'SN_IP' }, headers: {}, socket: {} }, resObj());
  assert.equal(lanOf('SN_IP'), '192.168.1.210');
  H.handleCData({ method: 'POST', query: { SN: 'SN_IP', table: 'OPTIONS', Stamp: '0' }, body: 'IPAddress=192.168.1.50,MAC=00:17:61:00:00:01', headers: {}, socket: {} }, resObj());
  assert.equal(lanOf('SN_IP'), '192.168.1.50');
});

test('máy không tự khai IP → phần mềm hỏi lệnh INFO (1 lần / ngày), máy trả IPAddress= thì lưu', () => {
  db.prepare("INSERT INTO push_devices(serial,name,active,last_seen) VALUES('SN_HOI','',1,?)").run(new Date().toISOString());
  const q = () => db.prepare("SELECT id FROM push_device_commands WHERE serial='SN_HOI' AND content='INFO'").all();
  const out = resObj(); H.handleGetRequest({ query: { SN: 'SN_HOI' }, headers: {}, socket: {} }, out);
  assert.match(out.out, /^C:\d+:INFO$/);
  assert.equal(q().length, 1);
  H.handleGetRequest({ query: { SN: 'SN_HOI' }, headers: {}, socket: {} }, resObj());
  assert.equal(q().length, 1, 'không hỏi lặp trong ngày');
  const id = q()[0].id;
  H.handleDeviceCmd({ body: `ID=${id}&Return=0&CMD=INFO
~DeviceName=ZLM60_TFT
MAC=00:17:61:12:14:C7
GATEIPAddress=192.168.1.1
IPAddress=192.168.1.37
`, query: { SN: 'SN_HOI' } }, resObj());
  assert.equal(lanOf('SN_HOI'), '192.168.1.37');
  H.handleGetRequest({ query: { SN: 'SN_HOI' }, headers: {}, socket: {} }, resObj());
  assert.equal(q().length, 1, 'đã biết IP thì không hỏi nữa');
});

test('máy chưa duyệt → không gửi lệnh INFO', () => {
  db.prepare("INSERT INTO push_devices(serial,name,active,last_seen) VALUES('SN_CHO2','',0,?)").run(new Date().toISOString());
  H.handleGetRequest({ query: { SN: 'SN_CHO2' }, headers: {}, socket: {} }, resObj());
  assert.equal(db.prepare("SELECT COUNT(*) c FROM push_device_commands WHERE serial='SN_CHO2'").get().c, 0);
});
