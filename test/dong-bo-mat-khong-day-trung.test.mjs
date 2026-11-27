// ĐỒNG BỘ KHUÔN MẶT CHẬM (30/10/2026): từ v1.25.0 phần mềm nhận câu trả lời DATA QUERY qua /querydata. Mỗi lần máy
// bắt tay, máy gửi lại TOÀN BỘ vân tay/khuôn mặt → trước đây đẩy hết sang máy cùng nhóm → máy kia bị xếp hàng trăm
// lệnh trùng, khuôn mặt mới đăng ký phải chờ sau. Giờ chỉ đẩy cái thực sự mới/đổi. Giả lập máy ADMS. Chạy: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-dong-bo-mat-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, setSetting, H, S;
const resObj = () => ({ out: '', type() { return this; }, send(x) { this.out = String(x); return this; } });
const post = (sn, table, body) => H.handleCData({ method: 'POST', query: { SN: sn, table, Stamp: '5' }, body, headers: {}, socket: {} }, resObj());
const queryData = (sn, tablename, body) => H.handleQueryData({ query: { SN: sn, type: 'tabledata', tablename, cmdid: '1' }, body, headers: {}, socket: {} }, resObj());
const pending = (sn) => db.prepare('SELECT content FROM push_device_commands WHERE serial=? AND trans_time IS NULL ORDER BY id').all(sn).map((r) => r.content);
const sendAll = (sn) => db.prepare("UPDATE push_device_commands SET trans_time=datetime('now'), response_at=datetime('now'), return_value='0' WHERE serial=?").run(sn);
const addDev = (sn) => db.prepare("INSERT INTO push_devices(serial,name,active,sync_group,last_seen,lan_ip) VALUES(?,?,1,'1',?,'192.168.1.9')").run(sn, sn, new Date().toISOString());
const face = (pin, tmp) => `BIODATA Pin=${pin}\tNo=0\tIndex=0\tValid=1\tDuress=0\tType=9\tMajorVer=5\tMinorVer=8\tFormat=0\tTmp=${tmp}`;
const qdFace = (pin, tmp) => `biodata pin=${pin}\tno=0\tindex=0\tvalid=1\tduress=0\ttype=9\tmajorver=5\tminorver=8\tformat=0\ttmp=${tmp}`;

before(async () => {
  const D = await import('../server/db.js');
  db = D.db; setSetting = D.setSetting; D.initSchema();
  H = await import('../server/routes/iclock.js');
  S = await import('../server/device-sync.js');
  setSetting('device_enabled', '1');
  setSetting('device_auto_create', '1');
  addDev('M1'); addDev('M2');
});

test('đăng ký khuôn mặt mới trên máy 1 → đẩy ngay sang máy 2', () => {
  post('M1', 'USERINFO', 'PIN=11\tName=Nguyen Van A\tPri=0');
  post('M1', 'BIODATA', face('11', 'F'.repeat(200)));
  const q = pending('M2');
  assert.ok(q.some((c) => c.startsWith('DATA UPDATE USERINFO PIN=11')), 'có lệnh NV');
  assert.ok(q.some((c) => c.startsWith('DATA UPDATE BIODATA Pin=11') && c.includes('Type=9')), 'có lệnh khuôn mặt');
  sendAll('M2');
});

test('máy 1 trả lời DATA QUERY (gửi lại toàn bộ) → KHÔNG xếp lệnh trùng cho máy 2', () => {
  queryData('M1', 'user', 'user uid=1\tcardno=\tpin=11\tpassword=\tgroup=1\tname=Nguyen Van A\tprivilege=0');
  queryData('M1', 'biodata', qdFace('11', 'F'.repeat(200)));
  assert.deepEqual(pending('M2'), []);
});

test('máy 1 gửi lại toàn bộ qua OPERLOG (mốc về 0) với dữ liệu không đổi → không xếp lệnh trùng', () => {
  post('M1', 'OPERLOG', ['USER PIN=11\tName=Nguyen Van A\tPri=0', face('11', 'F'.repeat(200))].join('\n'));
  assert.deepEqual(pending('M2'), []);
});

test('DATA QUERY lộ ra người phần mềm chưa từng có → vẫn đẩy sang máy 2', () => {
  queryData('M1', 'biodata', qdFace('12', 'G'.repeat(200)));
  assert.ok(pending('M2').some((c) => c.startsWith('DATA UPDATE BIODATA Pin=12')));
  sendAll('M2');
});

test('đăng ký lại khuôn mặt (template khác) hoặc thêm thẻ trên máy → vẫn đẩy real-time', () => {
  post('M1', 'BIODATA', face('11', 'H'.repeat(200)));
  assert.ok(pending('M2').some((c) => c.startsWith('DATA UPDATE BIODATA Pin=11') && c.includes('H'.repeat(50))));
  sendAll('M2');
  post('M1', 'USERINFO', 'PIN=11\tName=Nguyen Van A\tPri=0\tCard=556677');
  assert.ok(pending('M2').some((c) => c.startsWith('DATA UPDATE USERINFO PIN=11') && c.includes('556677')));
});

// Máy mới thêm vào nhóm: phải nhận hàng trăm lệnh → máy đời mới nhận nhiều lệnh/lượt hỏi, báo kết quả nhiều dòng.
const getreq = (sn) => { const r = resObj(); H.handleGetRequest({ query: { SN: sn }, headers: {}, socket: {} }, r); return r.out; };
const devcmd = (sn, body) => H.handleDeviceCmd({ query: { SN: sn }, body, headers: {}, socket: {} }, resObj());

test('máy đời mới: 1 lượt hỏi nhận nhiều lệnh ghi dữ liệu; lệnh điều khiển đi riêng; báo nhiều dòng → ghi nhận đủ', () => {
  addDev('M3');
  db.prepare("UPDATE push_devices SET push_ver='2.4.1' WHERE serial='M3'").run();
  for (let i = 0; i < 14; i++) S.queueCmd('M3', `DATA UPDATE USERINFO PIN=${100 + i}\tName=NV${i}`);
  S.queueCmd('M3', 'REBOOT');
  S.queueCmd('M3', 'DATA UPDATE USERINFO PIN=999\tName=Sau');
  const a = getreq('M3').split('\n');
  assert.equal(a.length, 10, 'tối đa 10 lệnh/lượt');
  assert.ok(a.every((l) => /^C:\d+:DATA UPDATE USERINFO /.test(l)));
  devcmd('M3', a.map((l) => `ID=${l.split(':')[1]}&Return=0&CMD=DATA`).join('\n'));
  const acked = db.prepare("SELECT COUNT(*) c FROM push_device_commands WHERE serial='M3' AND return_value='0'").get().c;
  assert.equal(acked, 10);
  const b = getreq('M3').split('\n');
  assert.equal(b.length, 4, 'dừng trước REBOOT');
  assert.match(getreq('M3'), /^C:\d+:REBOOT$/);
  assert.match(getreq('M3'), /^C:\d+:DATA UPDATE USERINFO PIN=999/);
});

test('máy chưa rõ đời / đời cũ: vẫn 1 lệnh/lượt như trước', () => {
  addDev('M4');
  S.queueCmd('M4', 'DATA UPDATE USERINFO PIN=1\tName=A'); S.queueCmd('M4', 'DATA UPDATE USERINFO PIN=2\tName=B');
  assert.equal(getreq('M4').split('\n').length, 1);
  db.prepare("UPDATE push_devices SET push_ver='-' WHERE serial='M4'").run();
  assert.equal(getreq('M4').split('\n').length, 1);
});

// Ảnh mặt/ảnh NV (~45KB/ảnh): trước đây mỗi lần máy bắt tay đều đẩy lại ảnh của mọi người dù máy đã có.
const handshake = (sn) => H.handleCData({ method: 'GET', query: { SN: sn, options: 'all', pushver: '2.4.1' }, headers: {}, socket: {} }, resObj());
const ackAll = (sn) => {
  const out = getreq(sn); if (!out || out === 'OK') return 0;
  const lines = out.split('\n');
  devcmd(sn, lines.map((l) => `ID=${l.split(':')[1]}&Return=0&CMD=DATA`).join('\n'));
  return lines.length;
};
const drain = (sn) => { for (let i = 0; i < 50 && ackAll(sn); i++); };
const photoCmds = (sn) => pending(sn).filter((c) => /^DATA UPDATE (USERPIC|BIOPHOTO) /.test(c));

test('ảnh: máy đã nhận ảnh rồi thì bắt tay lại KHÔNG đẩy lại; ảnh đổi thì đẩy', () => {
  for (const sn of ['M2', 'M3', 'M4']) drain(sn);
  post('M1', 'USERPIC', `USERPIC PIN=11\tSize=300\tContent=${'A'.repeat(300)}`);
  assert.equal(photoCmds('M2').length, 1, 'ảnh mới → đẩy sang máy 2');
  drain('M2');
  handshake('M2');
  assert.deepEqual(photoCmds('M2'), [], 'máy 2 đã có đúng ảnh → bắt tay không đẩy lại');
  handshake('M1');
  assert.deepEqual(photoCmds('M1'), [], 'máy nguồn (gửi ảnh lên) cũng coi là đã có');
  post('M1', 'USERPIC', `USERPIC PIN=11\tSize=300\tContent=${'B'.repeat(300)}`);
  assert.equal(photoCmds('M2').length, 1, 'ảnh đổi → đẩy lại');
  drain('M2');
  db.prepare("DELETE FROM device_users_serial WHERE serial='M2' AND pin='11'").run();   // VD xoá NV trên máy / đọc lại thông tin
  handshake('M2');
  assert.equal(photoCmds('M2').length, 1, 'máy mất người này → bắt tay đẩy lại ảnh');
});

// Thanh tiến trình nút bấm (tải NV / xoá NV / đẩy NV / đồng bộ): đếm lệnh máy đã báo nhận trong mốc id nút bấm trả về.
test('tiến trình lệnh: đếm đúng lệnh trong mốc, máy báo nhận dần → done tăng; lệnh xếp trước tính là "chờ trước"', () => {
  addDev('M5');
  db.prepare("UPDATE push_devices SET push_ver='2.4.1' WHERE serial='M5'").run();
  S.queueCmd('M5', 'DATA UPDATE USERINFO PIN=1\tName=Truoc');   // lệnh có sẵn từ trước khi bấm
  const from = S.cmdMark();
  for (let i = 0; i < 3; i++) S.queueCmd('M5', `DATA DELETE USERINFO PIN=${50 + i}`);
  const to = S.cmdMark();
  S.queueCmd('M5', 'DATA UPDATE USERINFO PIN=2\tName=Sau');     // lệnh xếp sau, không thuộc nút bấm này
  let p = S.cmdProgress(from, to, ['M5']).devices[0];
  assert.deepEqual([p.total, p.done, p.ahead, p.online], [3, 0, 1, true]);
  ackAll('M5');
  p = S.cmdProgress(from, to, ['M5']).devices[0];
  assert.deepEqual([p.total, p.done, p.ahead], [3, 3, 0]);
  assert.equal(S.cmdProgress(from, 0, ['M5']).devices[0].total, 4, 'theo dõi mở (đồng bộ) tính cả lệnh xếp thêm');
});

// BBQ DC 27/11/2026: "chờ 52 lệnh xếp trước". Lệnh đã gửi mà máy không báo lại quá 5 phút (lạc) không chặn hàng → không đếm là
// "xếp trước". Huỷ lệnh chờ: bỏ lệnh chưa gửi + lệnh lạc, giữ lệnh vừa gửi và lệnh máy bếp; up_to chỉ huỷ lệnh trước mốc.
test('lệnh chờ: lệnh lạc không tính "xếp trước"; huỷ lệnh xếp trước giữ lệnh vừa bấm, lệnh đang gửi, lệnh máy bếp', () => {
  addDev('M6');
  const ids = (sn) => db.prepare('SELECT id FROM push_device_commands WHERE serial=? ORDER BY id').all(sn).map((r) => r.id);
  const setSent = (id, ago) => db.prepare(`UPDATE push_device_commands SET trans_time=datetime('now','-${ago} minutes') WHERE id=?`).run(id);
  S.queueCmd('M6', 'DATA UPDATE USERINFO PIN=71\tName=Lac', { pin: '71', mkind: 'user' });   // gửi 2 ngày trước, máy không báo
  S.queueCmd('M6', 'DATA UPDATE USERINFO PIN=72\tName=DangGui', { pin: '72', mkind: 'user' }); // vừa gửi 1 phút
  S.queueCmd('M6', 'DATA UPDATE USERINFO PIN=73\tName=Bep', { pin: '73', mkind: 'mguard' });  // lệnh máy bếp
  S.queueCmd('M6', 'DATA UPDATE USERINFO PIN=74\tName=Cho', { pin: '74', mkind: 'user' });    // chưa gửi
  S.queueCmd('M6', 'DATA DELETE USERINFO\tPIN=75');                                           // chưa gửi
  const [lost, sending] = ids('M6');
  setSent(lost, 2 * 24 * 60); setSent(sending, 1);
  db.prepare("INSERT INTO device_pin_conflicts(serial,pin,since,status,new_pin) VALUES('M6','5',datetime('now'),'moving','74')").run();
  const from = S.cmdMark();
  S.queueCmd('M6', 'DATA QUERY USERINFO');   // lệnh vừa bấm
  const to = S.cmdMark();
  let p = S.cmdProgress(from, to, ['M6']).devices[0];
  assert.equal(p.ahead, 4, 'đang gửi + máy bếp + 2 chưa gửi; lệnh lạc không tính');
  const q = S.cmdQueue('M6');
  assert.deepEqual([q.total, q.wait, q.sending, q.lost, q.kitchen, q.cancellable], [6, 4, 1, 1, 1, 4]);
  assert.equal(q.groups[0].state, 'wait');
  assert.ok(q.groups.some((g) => g.state === 'lost' && g.what === 'Đẩy NV' && g.pins.includes('71')));
  assert.equal(S.cancelCmds('M6', from), 3, 'huỷ lạc + 2 chưa gửi');
  const left = db.prepare('SELECT pin, content FROM push_device_commands WHERE serial=? ORDER BY id').all('M6');
  assert.deepEqual(left.map((r) => r.pin || r.content), ['72', '73', 'DATA QUERY USERINFO'], 'giữ lệnh đang gửi, máy bếp, lệnh vừa bấm');
  const c = db.prepare("SELECT status FROM device_pin_conflicts WHERE serial='M6' AND new_pin='74'").get();
  assert.equal(c.status, 'failed', 'đổi Số ID mất lệnh tạo số mới → chờ "Gửi lại"');
  p = S.cmdProgress(from, to, ['M6']).devices[0];
  assert.equal(p.ahead, 2);
  assert.equal(S.cancelCmds('M6'), 1, 'huỷ hết: còn lệnh vừa bấm (chưa gửi)');
  assert.equal(S.cmdQueue('M6').cancellable, 0);
});
