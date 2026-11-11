// ĐẨY NV XUỐNG MÁY — trường TZ (khoảng thời gian ra vào) phải đúng định dạng 16 chữ số của hãng.
// Trước v1.33.0 gửi "TZ=1": máy SenseFace 4B (NF43VA, có kiểm soát cửa) hiểu thành "dùng khoảng thời gian riêng, để trống"
// → người vừa được đẩy xuống quẹt báo "Khoảng thời gian không hợp lệ" (aac, trankimxuyen 11/11/2026). Chạy: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-day-nv-tz-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, D, G, S;
const TZ_OK = '0000000100000000';   // 0000 = dùng khoảng thời gian của nhóm · 0001 = khoảng thời gian riêng 1 là khung số 1 (cả ngày)
const userCmds = (sn) => db.prepare("SELECT content FROM push_device_commands WHERE serial=? AND content LIKE 'DATA UPDATE USERINFO %' ORDER BY id").all(sn).map((r) => r.content);
const fields = (c) => Object.fromEntries(c.replace(/^DATA UPDATE USERINFO /, '').split('\t').map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]));

before(async () => {
  D = await import('../server/db.js');
  db = D.db; D.initSchema();
  G = await import('../server/pin-guard.js');
  S = await import('../server/device-sync.js');
  D.setSetting('device_enabled', '1');
  db.prepare("INSERT INTO push_devices(serial,name,active,sync_group,oper_stamp,recv_new) VALUES('SN_4B','SenseFace 4B',1,'','100',1)").run();
  db.prepare(`INSERT INTO employees(code, full_name, role, username, password_hash, device_pin, active)
    VALUES ('NV19','Nguyễn Thị Phượng','employee','u19','x','19',1)`).run();
});

test('hằng số TZ đúng 16 chữ số, 4 số đầu 0000 (dùng khoảng thời gian của nhóm)', () => {
  assert.equal(D.USER_TZ, TZ_OK);
  assert.match(D.USER_TZ, /^0000\d{12}$/);
});

test('sửa NV trên phần mềm → lệnh đẩy xuống máy mang TZ 16 chữ số, không còn "TZ=1"', () => {
  assert.ok(G.onEmployeesSaved(['19']) >= 1);
  const cmds = userCmds('SN_4B');
  assert.equal(cmds.length, 1);
  const f = fields(cmds[0]);
  assert.equal(f.PIN, '19');
  assert.equal(f.Grp, '1');
  assert.equal(f.TZ, TZ_OK);
  assert.ok(!/\tTZ=1(\t|$)/.test(cmds[0]));
});

test('mọi đường dựng lệnh đẩy NV (đặt quản trị, đồng bộ nhóm…) đều dùng chung TZ đúng', () => {
  for (const pri of [null, 0, 14]) assert.equal(fields(S.buildUserCommand('19', 'SN_4B', pri)).TZ, TZ_OK);
  assert.equal(fields(S.buildUserCommand('19', 'SN_4B', null, true)).TZ, TZ_OK);
});

test('lệnh đẩy NV còn CHỜ GỬI mang TZ=1 được sửa khi khởi động; lệnh đã gửi giữ nguyên', () => {
  const bad = (pin) => `DATA UPDATE USERINFO PIN=${pin}\tName=Nguoi ${pin}\tPasswd=\tPri=0\tGrp=1\tTZ=1\tVerify=0`;
  const ins = db.prepare('INSERT INTO push_device_commands(serial,content,pin,mkind,trans_time) VALUES(?,?,?,?,?)');
  ins.run('SN_4B', bad('201'), '201', 'user', null);                       // chờ gửi
  ins.run('SN_4B', bad('202'), '202', 'user', '2026-11-10 09:00:00');      // đã gửi
  ins.run('SN_4B', 'DATA QUERY USERINFO', '', '', null);                   // lệnh khác: không đụng
  D.initSchema();
  const by = (pin) => db.prepare("SELECT content FROM push_device_commands WHERE serial='SN_4B' AND pin=? AND content LIKE '%Nguoi%'").get(pin).content;
  assert.equal(fields(by('201')).TZ, TZ_OK);
  assert.equal(fields(by('201')).Name, 'Nguoi 201');
  assert.equal(fields(by('201')).Verify, '0');
  assert.equal(by('202'), bad('202'));
  assert.equal(db.prepare("SELECT COUNT(*) c FROM push_device_commands WHERE content='DATA QUERY USERINFO'").get().c, 1);
});

test('máy đã nhận lệnh sửa: không còn lệnh đẩy NV nào chờ gửi mang TZ=1', () => {
  const left = db.prepare("SELECT COUNT(*) c FROM push_device_commands WHERE trans_time IS NULL AND content LIKE 'DATA UPDATE USERINFO %' AND instr(content, char(9)||'TZ=1'||char(9))>0").get().c;
  assert.equal(left, 0);
});
