// VÂN TAY LỆCH GIỮA CÁC MÁY CÙNG NHÓM (lienminh 05/11/2026): máy xô viết 40 vân tay, 3 máy kia 31 — 9 vân tay đăng ký trên
// xô viết bị 3 máy kia TỪ CHỐI (trả -30 / -3) mỗi lần đồng bộ. Máy ZAM70 gửi dòng FP không ghi MajorVer → phần mềm lưu ZK9 và
// đẩy kiểu FINGERTMP, dù mẫu thật là ZKFinger 10 (đầu mẫu "SS21"). Giờ máy từ chối thì gửi lại 1 lần theo kiểu còn lại
// (FINGERTMP ↔ BIODATA Type=1 MajorVer=10); kiểu khác OK thì số vân tay của máy được cộng, thanh tiến trình không báo lỗi.
// Giả lập máy ADMS. Chạy: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-van-tay-kieu-khac-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, H, S;
const resObj = () => ({ out: '', type() { return this; }, send(x) { this.out = String(x); return this; } });
const post = (sn, table, body) => H.handleCData({ method: 'POST', query: { SN: sn, table, Stamp: '5' }, body, headers: {}, socket: {} }, resObj());
const getreq = (sn) => { const r = resObj(); H.handleGetRequest({ query: { SN: sn }, headers: {}, socket: {} }, r); return r.out; };
const devcmd = (sn, body) => H.handleDeviceCmd({ query: { SN: sn }, body, headers: {}, socket: {} }, resObj());
// máy lấy hết lệnh, trả mã theo nội dung lệnh; trả về danh sách lệnh máy đã nhận
const answer = (sn, codeOf) => {
  const seen = [];
  for (let i = 0; i < 50; i++) {
    const out = getreq(sn); if (!out || out === 'OK') break;
    devcmd(sn, out.split('\n').map((l) => { const [, id, ...c] = l.split(':'); seen.push(c.join(':')); return `ID=${id}&Return=${codeOf(c.join(':'))}&CMD=DATA`; }).join('\n'));
  }
  return seen;
};
const addDev = (sn) => db.prepare("INSERT INTO push_devices(serial,name,active,sync_group,push_ver,last_seen) VALUES(?,?,1,'1','2.4.1',?)").run(sn, sn, new Date().toISOString());
const fpCount = (sn) => db.prepare('SELECT COUNT(*) c FROM device_bio_templates WHERE serial=? AND bio_type=1').get(sn).c;
// mẫu ZKFinger 10 thật bắt đầu "Ss1TUzIx…" (= "JÍSS21"); mẫu ZK9 thì không
const V10 = 'Ss1TUzIxAAADjo0E' + 'A'.repeat(1200);
const V9 = 'ocoSgQAAAAAAAAAA' + 'B'.repeat(600);
const fpLine = (pin, fid, tmp) => `FP PIN=${pin}\tFID=${fid}\tSize=${tmp.length}\tValid=1\tTMP=${tmp}`;
const isFingertmp = (c) => c.startsWith('DATA UPDATE FINGERTMP');
const isBioFp = (c) => c.startsWith('DATA UPDATE BIODATA') && c.includes('\tType=1\t');

before(async () => {
  const D = await import('../server/db.js');
  db = D.db; D.initSchema();
  D.setSetting('device_enabled', '1');
  D.setSetting('device_auto_create', '1');
  H = await import('../server/routes/iclock.js');
  S = await import('../server/device-sync.js');
  addDev('XV'); addDev('BTX');
  answer('XV', () => '0'); answer('BTX', () => '0');
});

test('nhận ra mẫu ZKFinger 10 theo nội dung', () => {
  assert.equal(S.isFpV10(V10), true);
  assert.equal(S.isFpV10(V9), false);
  assert.equal(S.isFpV10(''), false);
});

test('máy chỉ nhận BIODATA: FINGERTMP bị -30 → tự gửi lại BIODATA MajorVer=10, máy nhận, số vân tay khớp', () => {
  const from = S.cmdMark();
  post('XV', 'OPERLOG', ['USER PIN=3000\tName=Thu\tPri=0', fpLine('3000', 6, V10)].join('\n'));
  const to = S.cmdMark();
  const seen = answer('BTX', (c) => (isFingertmp(c) ? '-30' : '0'));
  assert.ok(seen.some(isFingertmp), 'lần đầu vẫn gửi kiểu cũ như trước');
  const alt = seen.find(isBioFp);
  assert.ok(alt, 'có lệnh gửi lại kiểu BIODATA');
  assert.match(alt, /Pin=3000\tNo=6\tIndex=6\tValid=1\t.*MajorVer=10\t/);
  assert.ok(alt.endsWith('Tmp=' + V10), 'đúng mẫu gốc');
  assert.equal(fpCount('BTX'), fpCount('XV'), 'máy nhận đủ vân tay');
  const p = S.cmdProgress(from, to, ['BTX']).devices[0];
  assert.equal(p.failed, 0, 'không báo lỗi khi kiểu khác đã nhận');
  assert.deepEqual(p.errors, []);
  assert.ok(p.skipped.some((s) => /kiểu khác/.test(s.what)));
});

test('kiểu khác cũng bị từ chối → không gửi lại mãi, vẫn báo lỗi', () => {
  post('XV', 'OPERLOG', fpLine('3001', 5, V10));
  const seen = answer('BTX', (c) => (c.startsWith('DATA UPDATE USERINFO') ? '0' : '-30'));
  assert.equal(seen.filter(isFingertmp).length, 1);
  assert.equal(seen.filter(isBioFp).length, 1, 'chỉ gửi lại đúng 1 lần');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM device_bio_templates WHERE serial='BTX' AND pin='3001'").get().c, 0);
});

test('mẫu ZK9 thật bị từ chối → không đổi sang BIODATA ZK10', () => {
  post('XV', 'OPERLOG', fpLine('3002', 1, V9));
  const seen = answer('BTX', (c) => (isFingertmp(c) ? '-11' : '0'));
  assert.equal(seen.filter(isBioFp).length, 0);
});

test('máy hết dung lượng (-1001) → không gửi lại', () => {
  post('XV', 'OPERLOG', fpLine('3003', 2, V10));
  const seen = answer('BTX', (c) => (isFingertmp(c) ? '-1001' : '0'));
  assert.equal(seen.filter(isBioFp).length, 0);
});

test('máy chỉ nhận FINGERTMP: BIODATA vân tay bị từ chối → gửi lại FINGERTMP', () => {
  post('XV', 'BIODATA', `BIODATA Pin=3004\tNo=3\tIndex=3\tValid=1\tDuress=0\tType=1\tMajorVer=10\tMinorVer=0\tFormat=0\tTmp=${V10}`);
  const seen = answer('BTX', (c) => (isBioFp(c) ? '-1002' : '0'));
  const alt = seen.find(isFingertmp);
  assert.ok(alt, 'có lệnh gửi lại kiểu FINGERTMP');
  assert.match(alt, /^DATA UPDATE FINGERTMP PIN=3004\tFID=3\t/);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM device_bio_templates WHERE serial='BTX' AND pin='3004'").get().c, 1);
});

test('khuôn mặt bị từ chối → không có kiểu thay thế, không gửi lại', () => {
  post('XV', 'BIODATA', `BIODATA Pin=3005\tNo=0\tIndex=0\tValid=1\tDuress=0\tType=9\tMajorVer=40\tMinorVer=1\tFormat=0\tTmp=${'F'.repeat(700)}`);
  const seen = answer('BTX', (c) => (c.includes('\tType=9\t') ? '-3' : '0'));
  assert.equal(seen.filter((c) => c.includes('\tType=9\t')).length, 1);
});
