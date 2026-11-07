// XOÁ NV TRÊN MÁY RỒI KHÔNG QUAY LẠI (Norah 07/11/2026): xoá từng máy, máy bắt tay giữa chừng, lệnh xoá mất, 1 máy chưa xoá thật
// đều không được tạo lại NV "NV <số>" hay lan sang máy đã xoá; người mới dùng lại đúng Số ID đó vẫn được nhận.
// Giả lập 4 máy ADMS qua các hàm /iclock. Chạy: npm test
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-xoa-nv-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, setSetting, H, S;
const SN = ['CN1', 'CN2', 'CN3', 'CN4'];
const PINS = ['6', '11', '26'];
const TMP = (p) => 'A'.repeat(200) + p;        // mẫu của người cũ
const NEW = (p) => 'B'.repeat(200) + p;        // mẫu của người mới dùng lại Số ID
const resObj = () => ({ out: '', type() { return this; }, send(x) { this.out = String(x); return this; } });
const machines = {};
const post = (sn, table, body, stamp = '1') => H.handleCData({ method: 'POST', query: { SN: sn, table, Stamp: stamp }, body, headers: {}, socket: {} }, resObj());
const handshake = (sn) => H.handleCData({ method: 'GET', query: { SN: sn, options: 'all', pushver: '2.4.1' }, headers: {}, socket: {} }, resObj());
const vn = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');

// Máy thật: hỏi lệnh, chạy, báo kết quả, trả lời DATA QUERY qua /querydata. onlyFirst = firmware chỉ chạy dòng đầu mỗi lượt.
function run(sn, { onlyFirst = false, skipDelete = false } = {}) {
  const m = machines[sn]; const ran = [];
  for (let i = 0; i < 300; i++) {
    const r = resObj();
    H.handleGetRequest({ query: { SN: sn }, headers: {}, socket: {} }, r);
    if (r.out === 'OK') break;
    r.out.split('\n').forEach((ln, idx) => {
      const x = /^C:(\d+):([\s\S]*)$/.exec(ln); if (!x) return;
      const [, id, c] = x; ran.push(c);
      if (onlyFirst && idx > 0) return;   // không chạy, không báo
      const pin = (/PIN=([^\t]+)/i.exec(c) || [])[1];
      if (/^DATA DELETE USERINFO/.test(c)) { if (!skipDelete) m.users.delete(pin); }
      else if (/^DATA DELETE FINGERTMP/.test(c)) { const u = m.users.get(pin); if (u) delete u.oldTmp; }
      else if (/^CLEAR DATA/.test(c)) m.users.clear();
      else if (/^DATA UPDATE USERINFO/.test(c)) { const u = m.users.get(pin) || {}; m.users.set(pin, { ...u, name: (/Name=([^\t]*)/.exec(c) || [])[1] }); }
      else if (/^DATA UPDATE FINGERTMP/.test(c)) { const u = m.users.get(pin) || {}; m.users.set(pin, { ...u, tmp: (/TMP=(.*)$/.exec(c) || [])[1] }); }
      else if (/^DATA QUERY FINGERTMP/.test(c)) {
        const body = [...m.users].filter(([, u]) => u.tmp).map(([p, u]) => `fingertmp pin=${p}\tfingerid=0\tsize=200\tvalid=1\ttemplate=${u.tmp}`).join('\n');
        if (body) H.handleQueryData({ query: { SN: sn, tablename: 'fingertmp' }, body, headers: {}, socket: {} }, resObj());
      }
      H.handleDeviceCmd({ body: `ID=${id}&Return=0&CMD=DATA`, query: {} }, resObj());
    });
  }
  return ran;
}
const runAll = (o) => SN.forEach((s) => run(s, o));
const nextDay = () => { for (let i = 0; i < 2; i++) { SN.forEach(handshake); runAll(); } };
// Thời gian trôi: lệnh đã gửi quá 5 phút mới gửi lại, lệnh xoá lại cách nhau ít nhất 1 giờ
const later = () => db.exec("UPDATE push_device_commands SET created_at=datetime(created_at,'-2 hours'), trans_time=datetime(trans_time,'-2 hours')");
const purge = () => db.exec('DELETE FROM employees');    // đúng như xoá NV trên phần mềm: device_users giữ nguyên
const emps = () => db.prepare('SELECT device_pin FROM employees ORDER BY CAST(device_pin AS INT)').all().map((r) => r.device_pin);
const onDev = (sn) => [...machines[sn].users.keys()];
const allEmpty = () => SN.forEach((s) => assert.deepEqual(onDev(s), [], `${s} phải trống`));

before(async () => {
  const D = await import('../server/db.js'); D.initSchema();
  db = D.db; setSetting = D.setSetting;
  H = await import('../server/routes/iclock.js');
  S = await import('../server/device-sync.js');
  setSetting('device_enabled', '1');
});

beforeEach(() => {
  for (const t of ['employees', 'device_users', 'device_users_serial', 'device_bio_templates', 'push_device_commands', 'push_devices', 'device_user_photos', 'device_deleted_pins', 'device_deleted_tmps', 'device_pending_deletes']) db.exec(`DELETE FROM ${t}`);
  setSetting('device_autocreate', '1');
  for (const sn of SN) {
    db.prepare("INSERT INTO push_devices(serial,name,active,sync_group,push_ver,last_seen) VALUES(?,?,1,'1','2.4.1',?)").run(sn, sn, new Date().toISOString());
    machines[sn] = { users: new Map() };
  }
  for (const sn of SN) for (const p of PINS) {
    machines[sn].users.set(p, { name: 'Ten' + p, tmp: TMP(p) });
    post(sn, 'USERINFO', `USER PIN=${p}\tName=Ten${p}\tPri=0`);
    post(sn, 'FINGERTMP', `FP PIN=${p}\tFID=0\tSize=200\tValid=1\tTMP=${TMP(p)}`);
  }
  db.exec('DELETE FROM push_device_commands');
});

test('xoá cả 4 máy cùng lúc: sạch, ngày sau vẫn sạch', () => {
  SN.forEach((s) => S.deleteDeviceUsers(s, PINS)); runAll(); purge();
  nextDay();
  allEmpty(); assert.deepEqual(emps(), []);
});

test('xoá từng máy, CN1 bắt tay giữa chừng: không lan lại, không tạo NV', () => {
  S.deleteDeviceUsers('CN1', PINS); run('CN1');
  handshake('CN1'); run('CN1');
  assert.deepEqual(onDev('CN1'), [], 'CN2-4 còn mẫu nhưng không được đẩy về CN1 đã xoá');
  for (const s of ['CN2', 'CN3', 'CN4']) { S.deleteDeviceUsers(s, PINS); run(s); }
  purge(); nextDay();
  allEmpty(); assert.deepEqual(emps(), []);
});

test('"Xóa sạch máy" từng máy, CN1 khởi động lại giữa chừng: như trên', () => {
  S.clearDeviceAll('CN1'); run('CN1'); handshake('CN1'); run('CN1');
  assert.deepEqual(onDev('CN1'), []);
  for (const s of ['CN2', 'CN3', 'CN4']) { S.clearDeviceAll(s); run(s); }
  purge(); nextDay();
  allEmpty(); assert.deepEqual(emps(), []);
});

test('CN4 chưa xoá thật: dữ liệu sót không tạo NV, không lan, và bị xoá lại trên CN4', () => {
  SN.forEach((s) => S.deleteDeviceUsers(s, PINS));
  ['CN1', 'CN2', 'CN3'].forEach((s) => run(s)); run('CN4', { skipDelete: true }); purge();
  assert.deepEqual(onDev('CN4'), PINS);
  later(); handshake('CN4'); run('CN4');
  assert.deepEqual(emps(), []);
  assert.deepEqual(onDev('CN4'), [], 'lệnh xoá lại đã chạy');
  ['CN1', 'CN2', 'CN3'].forEach((s) => { run(s); assert.deepEqual(onDev(s), []); });
});

test('máy chỉ chạy dòng đầu mỗi lượt: lệnh xoá mất được gửi lại từng lệnh, ngày sau hết sạch', () => {
  SN.forEach((s) => S.deleteDeviceUsers(s, PINS)); runAll({ onlyFirst: true }); purge();
  assert.deepEqual(onDev('CN1'), ['11', '26']);
  // đúng firmware đó: gửi lại phải đi TỪNG lệnh, gộp lượt là lại mất
  for (let i = 0; i < 3; i++) { later(); SN.forEach(handshake); runAll({ onlyFirst: true }); }
  allEmpty(); assert.deepEqual(emps(), []);
});

test('lệnh gửi lại không gộp lượt với lệnh khác', () => {
  S.deleteDeviceUsers('CN1', PINS);
  const r = resObj(); H.handleGetRequest({ query: { SN: 'CN1' }, headers: {}, socket: {} }, r);
  assert.equal(r.out.trim().split('\n').length, 3, 'lần đầu vẫn gộp lượt như cũ');
  later();
  assert.equal(S.resendLostAttlogQueries('CN1'), 3);
  const r2 = resObj(); H.handleGetRequest({ query: { SN: 'CN1' }, headers: {}, socket: {} }, r2);
  assert.equal(r2.out.trim().split('\n').length, 1);
});

test('NGƯỜI MỚI dùng lại Số ID đăng ký trên máy: nhận, tạo NV đúng tên, đồng bộ sang máy khác', () => {
  SN.forEach((s) => S.deleteDeviceUsers(s, PINS)); runAll(); purge();
  // đăng ký vân tay trên CN2: mẫu khác hẳn, máy gửi OPERLOG gồm cả dòng USER + FP
  machines.CN2.users.set('6', { name: 'Moi', tmp: NEW('6') });
  post('CN2', 'OPERLOG', `OPLOG 6\t0\t${vn()}\t6\t0\t0\t0\nUSER PIN=6\tName=Moi\tPri=0\nFP PIN=6\tFID=0\tSize=200\tValid=1\tTMP=${NEW('6')}`, '100');
  assert.deepEqual(emps(), ['6']);
  assert.equal(db.prepare("SELECT full_name n FROM employees WHERE device_pin='6'").get().n, 'Moi');
  runAll();
  SN.forEach((s) => assert.deepEqual(onDev(s), ['6'], `${s} phải có người mới`));
  assert.equal(machines.CN4.users.get('6').tmp, NEW('6'));
  assert.equal(machines.CN4.users.get('6').name, 'Moi');
});

test('người mới chỉ có thẻ/tên, chưa có vân tay: thẻ khác hoặc tên khác lúc vừa đăng ký là người mới', () => {
  SN.forEach((s) => S.deleteDeviceUsers(s, PINS)); runAll(); purge();
  post('CN2', 'OPERLOG', 'USER PIN=6\tName=Ten6\tPri=0\tCard=777', '100');     // cùng tên nhưng thẻ khác
  assert.deepEqual(emps(), ['6']);
  post('CN2', 'OPERLOG', 'USER PIN=11\tName=Nguoi Khac\tPri=0', '101');        // vừa đăng ký, tên khác
  assert.deepEqual(emps(), ['6', '11']);
});

test('dòng người dùng cũ máy gửi lại (mốc về 0, trùng tên/không tên) không tạo NV', () => {
  SN.forEach((s) => S.deleteDeviceUsers(s, PINS)); runAll(); purge();
  db.prepare("UPDATE push_devices SET oper_stamp='0' WHERE serial='CN1'").run();
  post('CN1', 'OPERLOG', 'USER PIN=6\tName=Ten6\tPri=0\nUSER PIN=11\tName=\tPri=0\nUSER PIN=26\tName=TEN26\tPri=0', '50');
  assert.deepEqual(emps(), []);
});

test('Số ID đã về tay người mới (khai trên phần mềm): mẫu cũ còn sót chỉ bị xoá đúng mẫu, không xoá người mới', () => {
  SN.forEach((s) => S.deleteDeviceUsers(s, PINS));
  ['CN1', 'CN2', 'CN3'].forEach((s) => run(s)); run('CN4', { skipDelete: true }); purge();
  db.prepare("INSERT INTO employees(code, username, password_hash, full_name, device_pin, active) VALUES('6','6','x','Nguoi Moi Khai','6',1)").run();
  later(); handshake('CN4');
  const ran = run('CN4');
  assert.ok(ran.some((c) => /^DATA DELETE FINGERTMP PIN=6\tFID=0/.test(c)), 'xoá đúng mẫu cũ của số 6');
  assert.ok(!ran.some((c) => /^DATA DELETE USERINFO\tPIN=6$/.test(c)), 'không xoá cả Số ID 6');
  assert.ok(ran.some((c) => /^DATA DELETE USERINFO\tPIN=11$/.test(c)), 'số 11 chưa có NV thì vẫn xoá cả Số ID');
  assert.equal(db.prepare("SELECT full_name n FROM employees WHERE device_pin='6'").get().n, 'Nguoi Moi Khai');
});

test('xoá 1 máy rồi bấm Đẩy NV về lại máy đó: gỡ ghi nhớ, đồng bộ bình thường', () => {
  S.deleteDeviceUsers('CN1', ['6']); run('CN1');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM device_deleted_pins WHERE serial='CN1'").get().c, 1);
  S.clearDeletedMarks(['CN1'], ['6']);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM device_deleted_pins').get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM device_deleted_tmps').get().c, 0, 'máy cuối hết ghi nhớ thì bỏ luôn hash');
  handshake('CN1'); run('CN1');
  assert.ok(onDev('CN1').includes('6'), 'đồng bộ về lại như cũ');
});

test('xoá trên 1 máy, các máy khác vẫn còn người đó: NV còn, máy kia không bị ảnh hưởng', () => {
  S.deleteDeviceUsers('CN1', ['6']); run('CN1');
  handshake('CN1'); run('CN1');
  assert.deepEqual(onDev('CN1'), ['11', '26'], 'người đã xoá không bị đồng bộ về CN1');
  assert.ok(emps().includes('6'));
  SN.slice(1).forEach((s) => assert.ok(onDev(s).includes('6')));
});

test('"Chỉ xóa trên phần mềm" không ghi nhớ gì: máy gửi lên vẫn nhận như cũ', () => {
  purge();
  assert.equal(db.prepare('SELECT COUNT(*) c FROM device_deleted_pins').get().c, 0);
  post('CN1', 'OPERLOG', `USER PIN=6\tName=Ten6\tPri=0\nFP PIN=6\tFID=1\tSize=200\tValid=1\tTMP=${NEW('6')}`, '100');
  assert.deepEqual(emps(), ['6']);
});

test('máy TCP/IP: dữ liệu sót xếp vào danh sách xoá chờ, không gửi lệnh Push', () => {
  db.prepare("UPDATE push_devices SET conn_type='tcp' WHERE serial='CN4'").run();
  S.rememberDeleted('CN4', PINS); purge();
  S.storeTemplates('CN4', 'FP', PINS.map((p) => `FP PIN=${p}\tFID=0\tSize=200\tValid=1\tTMP=${TMP(p)}`).join('\n'));
  assert.equal(db.prepare("SELECT COUNT(*) c FROM device_pending_deletes WHERE serial='CN4'").get().c, 3);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM push_device_commands WHERE serial='CN4' AND content LIKE 'DATA DELETE%'").get().c, 0);
});

test('máy không có ghi nhớ nào: đường nhận dữ liệu không đụng bảng hash', () => {
  assert.equal(db.prepare('SELECT COUNT(*) c FROM device_deleted_pins').get().c, 0);
  post('CN1', 'FINGERTMP', `FP PIN=99\tFID=0\tSize=200\tValid=1\tTMP=${NEW('99')}`);
  assert.ok(emps().includes('99'));
});

test.after?.(() => { for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} } });
