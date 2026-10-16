// CẢNH BÁO TRÙNG SỐ ID giữa các máy + ĐẨY TÊN NV xuống máy. Giả lập máy ADMS gọi thẳng các hàm nhận dữ liệu của /iclock
// (cdata / getrequest / devicecmd) như máy thật. Chạy: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-so-id-trung-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, setSetting, H, G, S;
const resObj = () => ({ out: '', type() { return this; }, send(x) { this.out = String(x); return this; }, status() { return this; }, json(o) { this.out = o; return this; } });
const post = (sn, table, body) => H.handleCData({ method: 'POST', query: { SN: sn, table, Stamp: '9999' }, body, headers: {}, socket: {} }, resObj());
// Máy lấy LẦN LƯỢT mọi lệnh đang chờ và báo kết quả (ret) — giống máy thật đang online. Trả danh sách lệnh đã chạy.
function deviceRun(sn, ret = '0') {
  const ran = [];
  for (let i = 0; i < 500; i++) {
    const r = resObj();
    H.handleGetRequest({ query: { SN: sn }, headers: {}, socket: {} }, r);
    if (r.out === 'OK') break;
    const m = /^C:(\d+):([\s\S]*)$/.exec(r.out);
    ran.push(m[2]);
    H.handleDeviceCmd({ body: `ID=${m[1]}&Return=${ret}&CMD=DATA`, query: {} }, resObj());
  }
  return ran;
}
const pending = (sn, pin) => db.prepare('SELECT content FROM push_device_commands WHERE serial=? AND pin=? AND trans_time IS NULL').all(sn, pin).map((r) => r.content);
// giờ VN dạng máy gửi (lệch ms so với bây giờ)
const vn = (ms = 0) => new Date(Date.now() + ms + 7 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
const TMP = (c) => c.repeat(48);
const enroll = (pin, name, fid, tmpChar, card = '') =>
  `OPLOG 29\t0\t${vn()}\t${pin}\t0\t0\t0\nUSER PIN=${pin}\tName=${name}\tPri=0\tPasswd=\tCard=${card}\nFP PIN=${pin}\tFID=${fid}\tSize=48\tValid=1\tTMP=${TMP(tmpChar)}`;
const conflicts = () => db.prepare('SELECT * FROM device_pin_conflicts ORDER BY id').all();
const empByPin = (pin) => db.prepare('SELECT * FROM employees WHERE device_pin=?').get(pin);

before(async () => {
  const D = await import('../server/db.js');
  db = D.db; setSetting = D.setSetting; D.initSchema();
  H = await import('../server/routes/iclock.js');
  G = await import('../server/pin-guard.js');
  S = await import('../server/device-sync.js');
  setSetting('device_enabled', '1'); setSetting('device_autocreate', '1'); setSetting('device_pin_guard', '1');
  // 4 máy cùng nhóm, đã qua lần tải đầu (oper_stamp ≠ 0 → dữ liệu đăng ký gửi lên là real-time)
  for (const [sn, name] of [['SN_A', 'Máy cổng'], ['SN_B', 'Máy xưởng'], ['SN_C', 'Máy kho'], ['SN_D', 'Máy văn phòng']])
    db.prepare("INSERT INTO push_devices(serial,name,active,sync_group,oper_stamp) VALUES(?,?,1,'G','100')").run(sn, name);
  // Máy cổng đăng ký An (ID 1) + Hoa (ID 2) → máy xưởng nhận đồng bộ (máy kho, máy VP chưa lấy lệnh)
  post('SN_A', 'OPERLOG', enroll('1', 'Nguyen Van An', 0, 'a'));
  post('SN_A', 'OPERLOG', enroll('2', 'Tran Thu Hoa', 0, 'h'));
  deviceRun('SN_B');
  db.prepare("UPDATE employees SET full_name='Nguyễn Văn An' WHERE device_pin='1'").run();
});

test('so tên: bỏ dấu, viết tắt, tên gọi trùng → cùng người; tên gọi khác → khác người', () => {
  assert.equal(G.namesDiffer('Nguyen V An', 'Nguyễn Văn An'), false);
  assert.equal(G.namesDiffer('Huong KT', 'Trần Thị Hương'), false);
  assert.equal(G.namesDiffer('NGUYEN VAN AN', 'Nguyễn Văn An'), false);
  assert.equal(G.namesDiffer('Tran Thi Binh', 'Nguyễn Văn An'), true);
  assert.equal(G.namesDiffer('', 'Nguyễn Văn An'), false);   // thiếu tên → không đủ căn cứ
});

let cid;
test('máy kho đăng ký NGƯỜI KHÁC vào Số ID 1 → cảnh báo, giữ dữ liệu, không đồng bộ đi', () => {
  post('SN_C', 'OPERLOG', enroll('1', 'Tran Thi Binh', 0, 'b', '555'));
  const c = conflicts().find((x) => x.serial === 'SN_C' && x.pin === '1');
  assert.ok(c, 'phải có cảnh báo'); cid = c.id;
  assert.equal(c.reason, 'enroll'); assert.equal(c.status, 'open');
  assert.equal(c.dev_name, 'Tran Thi Binh'); assert.equal(c.dev_card, '555');
  // dữ liệu chung của Số ID 1 không bị đè
  const u = db.prepare("SELECT * FROM device_users WHERE pin='1'").get();
  assert.equal(u.name, 'Nguyen Van An'); assert.notEqual(u.card, '555');
  assert.equal(empByPin('1').full_name, 'Nguyễn Văn An');
  // vân tay người lạ không đi sang máy khác, máy kho không bị đẩy An xuống (ghi đè)
  for (const sn of ['SN_A', 'SN_B', 'SN_D']) assert.ok(!pending(sn, '1').some((x) => x.includes(TMP('b'))), sn);
  S.syncFillDevice('SN_C'); S.resyncNow(true);
  assert.ok(!pending('SN_C', '1').some((x) => x.startsWith('DATA UPDATE')), 'không đẩy An đè lên máy kho');
  for (const sn of ['SN_A', 'SN_B', 'SN_D']) assert.ok(!pending(sn, '1').some((x) => x.includes(TMP('b'))), sn + ' (sau ép đồng bộ)');
});

let tHeld;
test('lượt quẹt Số ID 1 ở máy kho bị GIỮ (không tính cho An); ở máy cổng vẫn tính cho An', () => {
  tHeld = vn(60e3);
  post('SN_C', 'ATTLOG', `1\t${tHeld}\t0\t1`);
  post('SN_A', 'ATTLOG', `1\t${vn(90e3)}\t0\t1`);
  const held = db.prepare("SELECT * FROM device_punches WHERE serial='SN_C'").all();
  assert.equal(held.length, 1); assert.equal(held[0].pin, '1#' + cid); assert.equal(held[0].employee_id, null);
  assert.equal(db.prepare("SELECT employee_id FROM device_punches WHERE serial='SN_A'").get().employee_id, empByPin('1').id);
  // gán lại lượt quẹt chưa khớp theo Số ID (khai NV, dựng lại công…) cũng không vơ lượt bị giữ
  S.relinkPunchesForPin(empByPin('1').id, '1');
  assert.equal(db.prepare("SELECT employee_id FROM device_punches WHERE serial='SN_C'").get().employee_id, null);
});

test('danh sách cảnh báo: 2 bên đủ thông tin + gợi ý Số ID trống', () => {
  const r = G.listConflicts().find((x) => x.id === cid);
  assert.equal(r.ref.name, 'Nguyễn Văn An'); assert.deepEqual(r.ref.devices.sort(), ['Máy cổng', 'Máy xưởng']);
  assert.equal(r.dev.name, 'Tran Thi Binh'); assert.equal(r.dev.fp, 1); assert.equal(r.dev.card, true); assert.equal(r.dev.held, 1);
  assert.match(r.suggest_pin, /^\d+$/);
  assert.equal(G.countConflicts(), 1);
});

test('NGƯỜI KHÁC → cấp Số ID 1001: tạo NV nháp, chuyển vân tay + thẻ + lượt quẹt; máy OK mới xoá số cũ rồi trả An về', () => {
  assert.throws(() => G.resolveOther(cid, '2'), /đã có người dùng/);
  const r = G.resolveOther(cid, '1001', 'Admin');
  assert.equal(r.moved, 1);
  const binh = empByPin('1001');
  assert.equal(binh.full_name, 'Tran Thi Binh'); assert.equal(binh.from_device, 1);
  const p = db.prepare("SELECT * FROM device_punches WHERE serial='SN_C'").get();
  assert.equal(p.pin, '1001'); assert.equal(p.employee_id, binh.id);
  assert.equal(db.prepare("SELECT card FROM device_users WHERE pin='1001'").get().card, '555');
  assert.equal(conflicts().find((x) => x.id === cid).status, 'moving');
  // máy kho chạy lệnh: tạo 1001 trước, xác nhận OK → xoá 1 → nhận lại An (Số ID 1)
  const ran = deviceRun('SN_C');
  const iNew = ran.findIndex((x) => x.startsWith('DATA UPDATE USERINFO PIN=1001\tName=Tran Thi Binh') && x.includes('Card=555'));
  const iBio = ran.findIndex((x) => x.includes('1001') && x.includes(TMP('b')));
  const iDel = ran.indexOf('DATA DELETE USERINFO\tPIN=1');
  const iAn = ran.findIndex((x) => x.startsWith('DATA UPDATE USERINFO PIN=1\tName=Nguyen Van An'));
  assert.ok(iNew >= 0 && iBio > iNew && iDel > iBio && iAn > iDel, JSON.stringify({ iNew, iBio, iDel, iAn }));
  assert.equal(conflicts().find((x) => x.id === cid).status, 'moved');
  // Bình (1001) được đồng bộ sang các máy cùng nhóm
  assert.ok(pending('SN_A', '1001').some((x) => x.includes(TMP('b'))));
  assert.equal(G.countConflicts(), 0);
});

test('sau khi đổi: tải lại log cũ của máy kho không cộng nhầm cho An; quẹt mới Số ID 1 ở máy kho = An', () => {
  post('SN_C', 'ATTLOG', `1\t${tHeld}\t0\t1`);   // máy gửi lại log cũ
  assert.equal(db.prepare("SELECT COUNT(*) c FROM device_punches WHERE serial='SN_C' AND pin='1'").get().c, 0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM device_punches WHERE serial='SN_C' AND pin='1001'").get().c, 1);
  post('SN_C', 'ATTLOG', `1\t${vn(3600e3)}\t0\t1`);
  assert.equal(db.prepare("SELECT employee_id FROM device_punches WHERE serial='SN_C' AND pin='1'").get().employee_id, empByPin('1').id);
});

test('CÙNG 1 NGƯỜI: máy VP tự đăng ký thêm cho Số ID 2 (không tên) → cảnh báo; xác nhận → tính công + đồng bộ lại', () => {
  db.prepare("DELETE FROM push_device_commands WHERE serial='SN_D'").run();   // máy VP chưa từng nhận Hoa
  post('SN_D', 'OPERLOG', `OPLOG 6\t0\t${vn()}\t2\t5\t0\t0\nFP PIN=2\tFID=5\tSize=48\tValid=1\tTMP=${TMP('k')}`);
  const c = conflicts().find((x) => x.serial === 'SN_D' && x.pin === '2');
  assert.ok(c); assert.equal(c.reason, 'enroll');
  post('SN_D', 'ATTLOG', `2\t${vn(120e3)}\t0\t1`);
  assert.equal(db.prepare("SELECT employee_id FROM device_punches WHERE serial='SN_D'").get().employee_id, null);
  G.resolveSame(c.id, 'Admin');
  const p = db.prepare("SELECT * FROM device_punches WHERE serial='SN_D'").get();
  assert.equal(p.pin, '2'); assert.equal(p.employee_id, empByPin('2').id);
  assert.ok(pending('SN_A', '2').some((x) => x.includes(TMP('k'))), 'ngón mới ở máy VP đồng bộ sang máy cổng');
  // đã xác nhận → máy VP gửi thêm dữ liệu Số ID 2 không cảnh báo lại
  post('SN_D', 'OPERLOG', `OPLOG 6\t0\t${vn()}\t2\t6\t0\t0\nFP PIN=2\tFID=6\tSize=48\tValid=1\tTMP=${TMP('m')}`);
  assert.equal(conflicts().filter((x) => x.serial === 'SN_D' && x.pin === '2').length, 1);
});

test('tên khác hẳn khi tải NV từ máy (TCP/IP, tải lại danh sách) → cảnh báo; tên khớp → không', () => {
  const before = conflicts().length;
  G.guardIncoming('SN_B', 'USER', 'USER PIN=1\tName=NGUYEN VAN AN', { realtime: false });
  assert.equal(conflicts().length, before);
  G.guardIncoming('SN_B', 'USER', 'USER PIN=2\tName=Le Van Tam', { realtime: false });
  const c = conflicts().at(-1);
  assert.equal(c.serial, 'SN_B'); assert.equal(c.pin, '2'); assert.equal(c.reason, 'name');
  G.resolveSame(c.id);
});

test('lần kết nối đầu (máy gửi cả danh sách cũ) → không báo trùng hàng loạt', () => {
  db.prepare("INSERT INTO push_devices(serial,name,active,sync_group,oper_stamp) VALUES('SN_E','Máy mới',1,'G','0')").run();
  const before = conflicts().length;
  post('SN_E', 'OPERLOG', `USER PIN=1\tName=\tPri=0\nFP PIN=1\tFID=3\tSize=48\tValid=1\tTMP=${TMP('e')}`);
  assert.equal(conflicts().length, before);
});

test('dải Số ID: máy kho khai 1000-1999 mà đăng ký Số ID 7 → cảnh báo "ngoài dải"', () => {
  db.prepare("UPDATE push_devices SET pin_range='1000-1999' WHERE serial='SN_C'").run();
  post('SN_C', 'OPERLOG', enroll('7', 'Pham Van Bay', 0, 'p'));
  const c = conflicts().at(-1);
  assert.equal(c.pin, '7'); assert.equal(c.reason, 'range');
  assert.equal(G.suggestPin('SN_C'), '1000');
  G.resolveOther(c.id, '1000');
  assert.equal(empByPin('1000').full_name, 'Pham Van Bay');
});

test('xoá Số ID đang cảnh báo trên máy → tự đóng cảnh báo', () => {
  post('SN_C', 'OPERLOG', enroll('2', 'Do Van Tu', 0, 'q'));
  const c = conflicts().at(-1);
  assert.equal(c.status, 'open');
  G.dropConflicts('SN_C', ['2']);
  assert.equal(conflicts().at(-1).status, 'dropped');
});

test('TẮT công tắc = như cũ: máy đăng ký người khác vào Số ID có chủ vẫn đồng bộ đi, không cảnh báo', () => {
  setSetting('device_pin_guard', '0');
  db.prepare("INSERT INTO push_devices(serial,name,active,sync_group,oper_stamp) VALUES('SN_F','Máy F',1,'G','100')").run();
  const before = conflicts().length;
  post('SN_F', 'OPERLOG', enroll('1', 'Vo Van Sau', 0, 'f'));
  assert.equal(conflicts().length, before);
  assert.ok(pending('SN_A', '1').some((x) => x.includes(TMP('f'))), 'đồng bộ như trước');
  assert.equal(db.prepare("SELECT name FROM device_users WHERE pin='1'").get().name, 'Vo Van Sau');
  setSetting('device_pin_guard', '1');
});

test('đẩy tên NV xuống máy: tắt = dùng tên trên máy; bật = tên phần mềm bỏ dấu, tối đa 24 ký tự', () => {
  db.prepare("UPDATE employees SET full_name='Nguyễn Thị Phương Hoa Thanh Hương' WHERE device_pin='2'").run();
  assert.match(S.buildUserCommand('2', 'SN_A'), /Name=Tran Thu Hoa\t/);
  setSetting('device_push_names', '1');
  assert.match(S.buildUserCommand('2', 'SN_A'), /Name=Nguyen Thi Phuong Hoa Th\t/);
  setSetting('device_name_ascii', '0');
  assert.match(S.buildUserCommand('2', 'SN_A'), /Name=Nguyễn Thị Phương Hoa Th\t/);
  setSetting('device_name_ascii', '1');
  db.prepare("UPDATE push_device_commands SET trans_time=datetime('now') WHERE trans_time IS NULL").run();
  const n = G.pushNames(['2']);
  assert.ok(n >= 2);
  assert.ok(pending('SN_B', '2').some((x) => x.includes('Name=Nguyen Thi Phuong Hoa Th')));
  setSetting('device_push_names', '0');
  assert.equal(G.pushNames(['2']), 0);   // tắt → không tự đẩy
});
