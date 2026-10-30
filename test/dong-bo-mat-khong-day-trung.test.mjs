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
const addDev = (sn) => db.prepare("INSERT INTO push_devices(serial,name,active,sync_group,last_seen) VALUES(?,?,1,'1',?)").run(sn, sn, new Date().toISOString());
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
