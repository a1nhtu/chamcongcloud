// XOÁ NV NGAY TRÊN MENU MÁY (Norah 09/11/2026): khách xoá người nghỉ việc trên từng máy (máy chỉ báo dòng OPLOG mã 9),
// phần mềm vẫn tưởng máy còn người đó → đồng bộ nhóm / đồng bộ lại toàn bộ / lưu NV đẩy người đó về lại máy vừa xoá.
// Giả lập 4 máy ADMS qua các hàm /iclock. Chạy: npm test
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-xoa-menu-test-${process.pid}.db`);
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
  for (const t of ['employees', 'device_users', 'device_users_serial', 'device_bio_templates', 'push_device_commands', 'push_devices', 'device_user_photos', 'device_deleted_pins', 'device_deleted_tmps', 'device_pending_deletes', 'device_oplogs', 'device_pin_conflicts', 'device_pin_remaps']) db.exec(`DELETE FROM ${t}`);
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


// Xoá trên menu máy: máy xoá trong bộ nhớ của nó rồi đẩy OPERLOG có dòng "OPLOG 9 <admin> <giờ> <Số ID>"
let stamp = 100;
const vnAt = (min) => new Date(Date.now() + 7 * 3600e3 + min * 60e3).toISOString().slice(0, 19).replace('T', ' ');
function menuDelete(sn, pins, min = 0) {
  for (const p of pins) machines[sn].users.delete(p);
  post(sn, 'OPERLOG', pins.map((p) => `OPLOG 9\t0\t${vnAt(min)}\t${p}\t0\t0\t0`).join('\n'), String(++stamp));
}
const mark = (sn, p) => !!db.prepare('SELECT 1 FROM device_deleted_pins WHERE serial=? AND pin=?').get(sn, p);

test('xoá trên menu CN2: máy bắt tay lại không được đẩy người đó về', () => {
  menuDelete('CN2', ['6']);
  assert.ok(mark('CN2', '6'), 'ghi nhớ đã xoá trên CN2');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM device_users_serial WHERE serial='CN2' AND pin='6'").get().c, 0, 'phần mềm biết CN2 không còn số 6');
  nextDay();
  assert.deepEqual(onDev('CN2'), ['11', '26']);
  SN.filter((s) => s !== 'CN2').forEach((s) => assert.ok(onDev(s).includes('6'), `${s} không bị đụng`));
});

test('xoá trên menu CN2: bấm Đồng bộ lại toàn bộ cũng không đẩy về', () => {
  menuDelete('CN2', ['6']);
  S.resyncNow(true); runAll();
  assert.ok(!onDev('CN2').includes('6'));
});

test('xoá trên menu CN2: sửa NV trên phần mềm (tự đẩy NV xuống máy) không ghi lại lên CN2', async () => {
  const P = await import('../server/pin-guard.js');
  setSetting('device_auto_push_emp', '1');
  menuDelete('CN2', ['6']);
  P.onEmployeesSaved(['6']); runAll();
  assert.ok(!onDev('CN2').includes('6'), 'CN2 đã xoá thì không ghi lại');
  assert.equal(machines.CN1.users.get('6').name !== undefined, true, 'máy khác vẫn nhận tên mới');
});

test('xoá trên menu CN2: máy khác gửi lại vân tay người đó (đăng ký thêm ngón cũ) không lan về CN2', () => {
  menuDelete('CN2', ['6']);
  db.prepare("UPDATE push_devices SET oper_stamp='0' WHERE serial='CN1'").run();
  post('CN1', 'OPERLOG', `USER PIN=6\tName=Ten6\tPri=0\nFP PIN=6\tFID=0\tSize=200\tValid=1\tTMP=${TMP('6')}`, '0');
  runAll();
  assert.ok(!onDev('CN2').includes('6'));
});

test('xoá trên menu lần lượt cả 4 máy, giữa chừng có bắt tay: cuối cùng sạch trên mọi máy', () => {
  for (const s of SN) { menuDelete(s, PINS); nextDay(); }
  allEmpty();
  for (const s of SN) assert.equal(db.prepare('SELECT COUNT(*) c FROM device_users_serial WHERE serial=?').get(s).c, 0);
});

test('xoá trên menu rồi đăng ký NGƯỜI MỚI đúng số đó trên máy (cùng lô hoặc sau): nhận người mới, không ghi nhớ xoá', () => {
  // cùng lô: máy gửi dòng xoá rồi đến dòng đăng ký mới
  machines.CN2.users.set('6', { name: 'Moi', tmp: NEW('6') });
  post('CN2', 'OPERLOG', `OPLOG 9\t0\t${vnAt(0)}\t6\t0\t0\t0\nOPLOG 30\t0\t${vnAt(1)}\t6\t0\t0\t0\nOPLOG 6\t0\t${vnAt(1)}\t6\t0\t0\t0\nUSER PIN=6\tName=Moi\tPri=0\nFP PIN=6\tFID=0\tSize=200\tValid=1\tTMP=${NEW('6')}`, String(++stamp));
  assert.ok(!mark('CN2', '6'));
  assert.ok(db.prepare("SELECT 1 FROM device_bio_templates WHERE serial='CN2' AND pin='6'").get(), 'mẫu người mới vẫn lưu');
  // lô sau: xoá số 11 trên cả 4 máy rồi đăng ký người mới trên CN2 (máy khác còn số 11 thì Cảnh báo trùng giữ lại, như cũ)
  SN.forEach((s) => menuDelete(s, ['11'])); db.exec("DELETE FROM employees WHERE device_pin='11'");
  assert.ok(mark('CN2', '11'));
  machines.CN2.users.set('11', { name: 'Moi11', tmp: NEW('11') });
  post('CN2', 'OPERLOG', `OPLOG 6\t0\t${vnAt(2)}\t11\t0\t0\t0\nUSER PIN=11\tName=Moi11\tPri=0\nFP PIN=11\tFID=0\tSize=200\tValid=1\tTMP=${NEW('11')}`, String(++stamp));
  assert.ok(!mark('CN2', '11'), 'mẫu mới = người mới, gỡ ghi nhớ');
});

test('máy gửi lại dòng xoá cũ (mốc về 0) sau khi đã đăng ký lại: không xoá nhầm người đang dùng', () => {
  SN.forEach((s) => menuDelete(s, ['6'], -60)); db.exec("DELETE FROM employees WHERE device_pin='6'");
  machines.CN2.users.set('6', { name: 'Moi', tmp: NEW('6') });
  post('CN2', 'OPERLOG', `OPLOG 6\t0\t${vnAt(-30)}\t6\t0\t0\t0\nUSER PIN=6\tName=Moi\tPri=0\nFP PIN=6\tFID=0\tSize=200\tValid=1\tTMP=${NEW('6')}`, String(++stamp));
  assert.ok(!mark('CN2', '6'));
  db.prepare("UPDATE push_devices SET oper_stamp='0' WHERE serial='CN2'").run();
  post('CN2', 'OPERLOG', `OPLOG 9\t0\t${vnAt(-60)}\t6\t0\t0\t0\nOPLOG 6\t0\t${vnAt(-30)}\t6\t0\t0\t0`, '0');
  assert.ok(!mark('CN2', '6'));
  assert.ok(db.prepare("SELECT 1 FROM device_users_serial WHERE serial='CN2' AND pin='6'").get());
});

test('phần mềm đã ghi nhớ (Xóa trên tất cả máy) rồi máy báo dòng xoá: giữ nguyên tên/thẻ đã nhớ', () => {
  S.deleteDeviceUsers('CN2', ['6']); run('CN2');
  const before = db.prepare("SELECT name FROM device_deleted_pins WHERE serial='CN2' AND pin='6'").get().name;
  assert.equal(before, 'Ten6');
  menuDelete('CN2', ['6']);
  assert.equal(db.prepare("SELECT name FROM device_deleted_pins WHERE serial='CN2' AND pin='6'").get().name, 'Ten6');
});

test.after?.(() => { for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} } });
