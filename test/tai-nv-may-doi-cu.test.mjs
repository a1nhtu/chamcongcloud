// TẢI NHÂN VIÊN TỪ MÁY ĐỜI CŨ (nhahanggiadinh 29/10/2026): bấm "Tải nhân viên từ máy" báo đã gửi mà không ra NV —
// máy ADMS đời cũ không hiểu lệnh DATA QUERY USERINFO. Phần mềm nhận đời máy lúc bắt tay (pushver), máy đời cũ thì
// đặt mốc OPERLOGStamp=0 + lệnh CHECK để máy gửi lại toàn bộ người dùng. Giả lập máy ADMS. Chạy: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-tai-nv-doi-cu-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, setSetting, H, S;
const resObj = () => ({ out: '', type() { return this; }, send(x) { this.out = String(x); return this; } });
const handshake = (sn, extra = {}) => { const r = resObj(); H.handleCData({ method: 'GET', query: { SN: sn, options: 'all', ...extra }, headers: {}, socket: {} }, r); return r.out; };
const getreq = (sn, extra = {}) => { const r = resObj(); H.handleGetRequest({ query: { SN: sn, ...extra }, headers: {}, socket: {} }, r); return r.out; };
const post = (sn, table, body) => H.handleCData({ method: 'POST', query: { SN: sn, table, Stamp: '5' }, body, headers: {}, socket: {} }, resObj());
const queryData = (sn, tablename, body) => { const r = resObj(); H.handleQueryData({ query: { SN: sn, type: 'tabledata', tablename, cmdid: '1' }, body, headers: {}, socket: {} }, r); return r.out; };
const dev = (sn) => db.prepare('SELECT * FROM push_devices WHERE serial=?').get(sn);
const cmds = (sn) => db.prepare('SELECT content FROM push_device_commands WHERE serial=? AND trans_time IS NULL ORDER BY id').all(sn).map((r) => r.content);
const emp = (pin) => db.prepare('SELECT full_name FROM employees WHERE device_pin=?').get(pin);
const addDev = (sn) => db.prepare("INSERT INTO push_devices(serial,name,active,att_stamp,oper_stamp,last_seen) VALUES(?,?,1,'777','888',?)").run(sn, sn, new Date().toISOString());

before(async () => {
  const D = await import('../server/db.js');
  db = D.db; setSetting = D.setSetting; D.initSchema();
  H = await import('../server/routes/iclock.js');
  S = await import('../server/device-sync.js');
  setSetting('device_enabled', '1');
});

test('bắt tay: máy khai pushver → đời mới; không khai → đời cũ; INFO lúc hỏi lệnh → giữ phiên bản firmware', () => {
  addDev('SN_MOI'); addDev('SN_CU');
  handshake('SN_MOI', { pushver: '2.4.1', language: '83' });
  handshake('SN_CU');
  assert.equal(dev('SN_MOI').push_ver, '2.4.1');
  assert.equal(dev('SN_CU').push_ver, '-');
  getreq('SN_CU', { INFO: 'Ver 6.60 Apr 28 2016,12,10,345,192.168.1.201' });
  assert.equal(dev('SN_CU').firmware, 'Ver 6.60 Apr 28 2016');
  addDev('SN_PV'); handshake('SN_PV', { PushVersion: '2.2.14' });
  assert.equal(dev('SN_PV').push_ver, '2.2.14', 'firmware khai PushVersion (viết hoa) cũng nhận');
});

test('máy đời cũ: tải NV = mốc OPERLOGStamp về 0 + lệnh CHECK (không gửi DATA QUERY), mốc chấm công giữ nguyên', () => {
  assert.equal(S.queryDeviceUsers('SN_CU'), 'old');
  assert.deepEqual(cmds('SN_CU'), ['CHECK']);
  assert.match(getreq('SN_CU'), /^C:\d+:CHECK$/);
  const info = handshake('SN_CU');   // máy nhận CHECK → hỏi lại cấu hình
  assert.match(info, /OPERLOGStamp=0\n/);
  assert.match(info, /ATTLOGStamp=777\n/, 'không tải lại log chấm công');
});

test('máy đời mới: tải NV = DATA QUERY như cũ, không đụng mốc', () => {
  assert.equal(S.queryDeviceUsers('SN_MOI'), 'new');
  assert.deepEqual(cmds('SN_MOI'), ['DATA QUERY USERINFO', 'DATA QUERY FINGERTMP', 'DATA QUERY BIODATA']);
  assert.equal(dev('SN_MOI').oper_stamp, '888');
});

test('chưa rõ đời (chưa bắt tay lại từ khi cập nhật) → làm cả hai cách; bấm lại không xếp trùng lệnh', () => {
  addDev('SN_CHUARO');
  assert.equal(S.queryDeviceUsers('SN_CHUARO'), 'unknown');
  S.queryDeviceUsers('SN_CHUARO');
  assert.deepEqual(cmds('SN_CHUARO'), ['CHECK', 'DATA QUERY USERINFO', 'DATA QUERY FINGERTMP', 'DATA QUERY BIODATA']);
  assert.equal(dev('SN_CHUARO').oper_stamp, '0');
});

test('tắt "Tự tạo NV": máy tự gửi NV thì không tạo; vừa bấm Tải NV thì NV máy gửi lại (OPERLOG) được tạo', () => {
  setSetting('device_autocreate', '0');
  addDev('SN_TAT');
  post('SN_TAT', 'OPERLOG', 'USER PIN=501\tName=Lan\tPri=0\tPasswd=\tCard=\tGrp=1');
  assert.equal(emp('501'), undefined, 'chưa bấm tải: giữ như cũ, không tự tạo');
  handshake('SN_TAT');
  S.queryDeviceUsers('SN_TAT');
  post('SN_TAT', 'OPERLOG', 'USER PIN=501\tName=Lan\tPri=0\nUSER PIN=502\tName=Huong\tPri=0\nFP PIN=502\tFID=6\tSize=8\tValid=1\tTMP=QUJDRA==');
  assert.equal(emp('501').full_name, 'Lan');
  assert.equal(emp('502').full_name, 'Huong');
  setSetting('device_autocreate', '1');
});

test('"Đọc lại thông tin từ máy" dùng cùng cách theo đời máy nhưng KHÔNG mở khoá tạo NV khi tắt tự tạo', () => {
  setSetting('device_autocreate', '0');
  addDev('SN_DOCLAI');
  handshake('SN_DOCLAI');
  S.relearnDevice('SN_DOCLAI');
  assert.deepEqual(cmds('SN_DOCLAI'), ['CHECK']);
  post('SN_DOCLAI', 'OPERLOG', 'USER PIN=601\tName=Mai\tPri=0');
  assert.equal(emp('601'), undefined);
  setSetting('device_autocreate', '1');
});

test('máy đời mới trả lời qua /iclock/querydata (tablename=user, khoá chữ thường) → tạo NV, lưu thẻ + quyền', () => {
  addDev('SN_QD');
  const out = queryData('SN_QD', 'user', 'user uid=1\tcardno=12345\tpin=701\tpassword=\tgroup=1\tname=Tuan\tprivilege=14\n'
    + 'user uid=2\tcardno=\tpin=702\tpassword=\tgroup=1\tname=Nga\tprivilege=0');
  assert.equal(out, 'user=2');
  assert.equal(emp('701').full_name, 'Tuan');
  assert.equal(emp('702').full_name, 'Nga');
  const u = db.prepare('SELECT card, privilege FROM device_users WHERE pin=?').get('701');
  assert.equal(u.card, '12345');
  assert.equal(u.privilege, 14);
  queryData('SN_QD', 'templatev10', 'templatev10 size=8\tuid=1\tpin=701\tfingerid=3\tvalid=1\ttemplate=QUJDRA==');
  const t = db.prepare('SELECT bio_type, idx, major_ver FROM device_bio_templates WHERE serial=? AND pin=?').get('SN_QD', '701');
  assert.deepEqual({ ...t }, { bio_type: 1, idx: 3, major_ver: 10 });
});

test('máy chưa duyệt gửi querydata → không ghi gì', () => {
  db.prepare("INSERT INTO push_devices(serial,name,active) VALUES('SN_CHO','',0)").run();
  queryData('SN_CHO', 'user', 'user uid=1\tpin=801\tname=X\tprivilege=0');
  assert.equal(emp('801'), undefined);
});
