// THANH TIẾN TRÌNH BÁO LỆNH LỖI (bactrungnamsolar 03/11/2026): "Tải NV từ máy" báo "1 lệnh máy báo lỗi" mà không nói lệnh nào —
// thật ra máy chỉ hiểu 1 trong 2 bảng vân tay (FINGERTMP / BIODATA), bảng kia trả lỗi là bình thường, dữ liệu vẫn về đủ.
// Giờ: lỗi bình thường đó không đếm là lỗi; lỗi thật ghi rõ lệnh gì + mã máy trả + Số ID. Giả lập máy ADMS. Chạy: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-tien-trinh-loi-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, H, S;
const resObj = () => ({ out: '', type() { return this; }, send(x) { this.out = String(x); return this; } });
const getreq = (sn) => { const r = resObj(); H.handleGetRequest({ query: { SN: sn }, headers: {}, socket: {} }, r); return r.out; };
const devcmd = (sn, body) => H.handleDeviceCmd({ query: { SN: sn }, body, headers: {}, socket: {} }, resObj());
// máy nhận hết lệnh, trả mã theo nội dung lệnh (mặc định 0)
const answer = (sn, codeOf) => {
  for (let i = 0; i < 50; i++) {
    const out = getreq(sn); if (!out || out === 'OK') return;
    devcmd(sn, out.split('\n').map((l) => { const [, id, ...c] = l.split(':'); return `ID=${id}&Return=${codeOf(c.join(':'))}&CMD=DATA`; }).join('\n'));
  }
};
const addDev = (sn) => db.prepare("INSERT INTO push_devices(serial,name,active,push_ver,last_seen) VALUES(?,?,1,'2.4.1',?)").run(sn, sn, new Date().toISOString());
const track = (sn, fn) => { const from = S.cmdMark(); fn(); return { from, to: S.cmdMark(), sn }; };
const prog = (t) => S.cmdProgress(t.from, t.to, [t.sn]).devices[0];

before(async () => {
  const D = await import('../server/db.js');
  db = D.db; D.initSchema();
  D.setSetting('device_enabled', '1');
  H = await import('../server/routes/iclock.js');
  S = await import('../server/device-sync.js');
});

test('Tải NV: máy không dùng bảng BIODATA (FINGERTMP OK) → không báo lỗi, ghi chú bình thường', () => {
  addDev('A1');
  const t = track('A1', () => S.queryDeviceUsers('A1'));
  answer('A1', (c) => (c === 'DATA QUERY BIODATA' ? '-1002' : '0'));
  const p = prog(t);
  assert.deepEqual([p.total, p.done, p.failed, p.errors.length], [3, 3, 0, 0]);
  assert.equal(p.skipped.length, 1);
  assert.match(p.skipped[0].what, /BIODATA/);
  assert.equal(p.skipped[0].code, '-1002');
});

test('ngược lại: máy vân tay đời mới không dùng FINGERTMP (BIODATA OK) → cũng không báo lỗi', () => {
  addDev('A2');
  const t = track('A2', () => S.queryDeviceUsers('A2'));
  answer('A2', (c) => (c === 'DATA QUERY FINGERTMP' ? '-1' : '0'));
  const p = prog(t);
  assert.deepEqual([p.failed, p.errors.length, p.skipped.length], [0, 0, 1]);
  assert.match(p.skipped[0].what, /FINGERTMP/);
});

test('cả 2 bảng vân tay đều lỗi → báo lỗi thật, ghi rõ lệnh + mã + nghĩa', () => {
  addDev('A3');
  const t = track('A3', () => S.queryDeviceUsers('A3'));
  answer('A3', (c) => (c === 'DATA QUERY USERINFO' ? '0' : '-1002'));
  const p = prog(t);
  assert.equal(p.failed, 2);
  assert.deepEqual(p.skipped, []);
  assert.deepEqual(p.errors.map((e) => [e.code, e.msg, e.n]), [['-1002', 'máy không hỗ trợ lệnh này', 1], ['-1002', 'máy không hỗ trợ lệnh này', 1]]);
  assert.ok(p.errors.some((e) => /FINGERTMP/.test(e.what)) && p.errors.some((e) => /BIODATA/.test(e.what)));
});

test('đẩy NV/vân tay lỗi: gộp theo loại + mã, kèm tối đa 5 Số ID', () => {
  addDev('A4');
  const fp = (pin) => `DATA UPDATE BIODATA Pin=${pin}\tNo=0\tIndex=0\tValid=1\tDuress=0\tType=1\tMajorVer=10\tMinorVer=0\tFormat=0\tTmp=${'X'.repeat(500)}`;
  const t = track('A4', () => {
    for (let i = 1; i <= 7; i++) S.queueCmd('A4', fp(i));
    S.queueCmd('A4', 'DATA UPDATE USERINFO PIN=20\tName=B');
    S.queueCmd('A4', 'DATA UPDATE USERINFO PIN=21\tName=C');
  });
  answer('A4', (c) => (c.startsWith('DATA UPDATE BIODATA') ? '-11' : c.includes('PIN=21') ? '-1001' : '0'));
  const p = prog(t);
  assert.deepEqual([p.total, p.done, p.failed], [9, 9, 8]);
  const v = p.errors.find((e) => e.what === 'Đẩy vân tay');
  assert.deepEqual([v.code, v.msg, v.n, v.pins], ['-11', 'sai định dạng vân tay', 7, ['1', '2', '3', '4', '5']]);
  const u = p.errors.find((e) => e.what === 'Đẩy NV');
  assert.deepEqual([u.code, u.msg, u.n, u.pins], ['-1001', 'máy hết dung lượng', 1, ['21']]);
});

test('không có lệnh lỗi → errors/skipped rỗng như trước', () => {
  addDev('A5');
  const t = track('A5', () => S.queryDeviceUsers('A5'));
  answer('A5', () => '0');
  const p = prog(t);
  assert.deepEqual([p.failed, p.errors, p.skipped], [0, [], []]);
});

test('tên lệnh dễ hiểu + mã lạ', () => {
  assert.deepEqual(S.cmdLabel('DATA DELETE USERINFO\tPIN=33'), { what: 'Xoá NV', pin: '33' });
  assert.deepEqual(S.cmdLabel('DATA UPDATE BIODATA Pin=9\tNo=0\tIndex=0\tValid=1\tDuress=0\tType=9'), { what: 'Đẩy khuôn mặt', pin: '9' });
  assert.equal(S.cmdLabel('REBOOT').what, 'Khởi động lại máy');
  assert.equal(S.cmdErrText('-77'), 'lỗi không rõ');
});
