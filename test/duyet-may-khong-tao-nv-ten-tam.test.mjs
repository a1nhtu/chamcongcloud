// DUYỆT MÁY RA NV TÊN TẠM "NV 1, NV 2…" (micayseoul 20/11/2026): máy có sẵn 7 NV đăng ký từ trước, Anh trỏ máy về phần mềm
// rồi bấm Duyệt → phần mềm tự tạo 7 NV tên "NV <Số ID>", phải bấm Tải NV mới có tên thật. Nguyên nhân: máy có Nhóm đồng bộ,
// mỗi lần máy bắt tay phần mềm hỏi máy TOÀN BỘ vân tay / khuôn mặt để đồng bộ (syncFillDevice), mà mẫu không kèm tên lại tạo NV
// nháp. Quy tắc (Anh chốt 07/10/2026, v1.15.59): duyệt máy KHÔNG tự tải NV — NV về khi họ quẹt hoặc khi bấm Tải NV.
// Giả lập máy ADMS đời mới. Chạy: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-duyet-may-ten-tam-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, setSetting, H, S;
const resObj = () => ({ out: '', type() { return this; }, send(x) { this.out = String(x); return this; } });
const handshake = (sn) => { const r = resObj(); H.handleCData({ method: 'GET', query: { SN: sn, options: 'all', pushver: '2.4.1' }, headers: {}, socket: {} }, r); return r.out; };
const getreq = (sn) => { const r = resObj(); H.handleGetRequest({ query: { SN: sn }, headers: {}, socket: {} }, r); return r.out; };
const post = (sn, table, body, Stamp = '5') => H.handleCData({ method: 'POST', query: { SN: sn, table, Stamp }, body, headers: {}, socket: {} }, resObj());
const queryData = (sn, tablename, body) => { const r = resObj(); H.handleQueryData({ query: { SN: sn, type: 'tabledata', tablename, cmdid: '1' }, body, headers: {}, socket: {} }, r); return r.out; };
const emp = (pin) => db.prepare('SELECT full_name FROM employees WHERE device_pin=?').get(pin)?.full_name;
const empCount = () => db.prepare("SELECT COUNT(*) c FROM employees WHERE device_pin<>''").get().c;
const pending = (sn) => db.prepare('SELECT content FROM push_device_commands WHERE serial=? AND trans_time IS NULL ORDER BY id').all(sn).map((r) => r.content);
const drain = (sn) => { const out = []; for (let i = 0; i < 50; i++) { const c = getreq(sn); if (c === 'OK') break; out.push(c); } return out; };
const fpLines = (pins) => pins.map((p) => `fingertmp pin=${p}\tfingerid=6\tsize=8\tvalid=1\ttemplate=QUJDRA${p}==`).join('\n');
const faceLines = (pins) => pins.map((p) => `biodata pin=${p}\tno=0\tindex=0\tvalid=1\tduress=0\ttype=9\tmajorver=5\tminorver=8\tformat=0\ttmp=RkFDRQ${p}==`).join('\n');
const photo = (p) => `BIOPHOTO PIN=${p}\tFileName=${p}.jpg\tType=9\tSize=200\tContent=${'A'.repeat(200)}`;

// Máy mới trỏ về → chờ duyệt → Anh bấm Duyệt (như route PUT /devices/:id active=1) → máy khởi động lại, bắt tay đầy đủ
function newApprovedDevice(sn, group = '1') {
  handshake(sn);
  db.prepare('UPDATE push_devices SET active=1, sync_group=? WHERE serial=?').run(group, sn);
  S.rebootDevice(sn);
  drain(sn);
  handshake(sn);
}

before(async () => {
  const D = await import('../server/db.js');
  db = D.db; setSetting = D.setSetting; D.initSchema();
  H = await import('../server/routes/iclock.js');
  S = await import('../server/device-sync.js');
  setSetting('device_enabled', '1');
});

test('máy có nhóm đồng bộ vừa duyệt: phần mềm học vân tay / khuôn mặt để đồng bộ nhưng KHÔNG tạo NV tên tạm', () => {
  newApprovedDevice('SN_SEOUL');
  const sent = drain('SN_SEOUL');
  assert.ok(sent.some((c) => /DATA QUERY FINGERTMP$/.test(c)), 'vẫn hỏi vân tay để đồng bộ nhóm như cũ');
  const pins = ['1', '2', '3', '4', '5', '6', '7'];
  queryData('SN_SEOUL', 'fingertmp', fpLines(pins));
  queryData('SN_SEOUL', 'biodata', faceLines(pins));
  post('SN_SEOUL', 'BIOPHOTO', photo('1'));
  assert.equal(empCount(), 0, 'không còn 7 NV "NV 1…NV 7"');
  const tmps = db.prepare("SELECT COUNT(*) c FROM device_bio_templates WHERE serial='SN_SEOUL'").get().c;
  assert.equal(tmps, 14, 'mẫu vẫn lưu theo máy để đồng bộ sang máy cùng nhóm');
  assert.deepEqual(pending('SN_SEOUL'), [], 'không tự hỏi danh sách NV (duyệt máy không tự tải NV)');
});

test('máy khuôn mặt 1 máy, KHÔNG nhóm: duyệt xong máy tự gửi lên bảng khuôn mặt + ảnh (không có dòng người dùng) → không tạo NV tên tạm; giờ chấm cũ → hỏi tên từng người', () => {
  newApprovedDevice('SN_1MAY', '');
  assert.deepEqual(drain('SN_1MAY').filter((c) => /DATA QUERY/.test(c)), [], 'không nhóm → phần mềm không hỏi máy gì');
  // máy giữ mốc OPERLOG 9999 từ lúc chờ duyệt (như máy thật 647) nên không gửi dòng USER; bảng khuôn mặt / ảnh thì gửi hết
  const pins = ['11', '12', '13', '14', '15', '16', '17'];
  post('SN_1MAY', 'BIODATA', pins.map((p) => `BIODATA Pin=${p}\tNo=0\tIndex=0\tValid=1\tDuress=0\tType=9\tMajorVer=5\tMinorVer=8\tFormat=0\tTmp=RkFDRQ${p}==`).join('\n'), '9999');
  post('SN_1MAY', 'BIOPHOTO', pins.map(photo).join('\n'), '9999');
  assert.equal(pins.filter((p) => emp(p)).length, 0, 'trước bản 1.37.2: 7 NV "NV 11…NV 17"');
  // giờ chấm của 7 người về (lượt mới hoặc máy gửi bù) → không khớp NV → hỏi máy tên từng người
  post('SN_1MAY', 'ATTLOG', pins.map((p) => `${p}\t2026-11-20 07:5${p.slice(1)}:00\t0\t15\t0`).join('\n'));
  const asks = pending('SN_1MAY');
  assert.equal(asks.filter((c) => /^DATA QUERY USERINFO PIN=/.test(c)).length, 7);
  drain('SN_1MAY');
  for (const p of pins) queryData('SN_1MAY', 'user', `user uid=${p}\tcardno=\tpin=${p}\tpassword=\tgroup=1\tname=Nhân viên ${p}\tprivilege=0`);
  for (const p of pins) assert.equal(emp(p), `Nhân viên ${p}`);
});

test('NV quẹt mà chưa khớp → hỏi máy đúng người đó → NV về với TÊN THẬT; máy trả vân tay trước tên thì tên tạm được thay', () => {
  post('SN_SEOUL', 'ATTLOG', '3\t2026-11-20 08:01:00\t0\t1\t0');
  assert.deepEqual(pending('SN_SEOUL'), ['DATA QUERY USERINFO PIN=3', 'DATA QUERY FINGERTMP PIN=3']);
  drain('SN_SEOUL');
  queryData('SN_SEOUL', 'user', 'user uid=3\tcardno=\tpin=3\tpassword=\tgroup=1\tname=Nguyen Thi Lan\tprivilege=0');
  assert.equal(emp('3'), 'Nguyen Thi Lan');
  const p = db.prepare("SELECT e.full_name FROM device_punches d JOIN employees e ON e.id=d.employee_id WHERE d.pin='3'").get();
  assert.equal(p.full_name, 'Nguyen Thi Lan', 'lượt quẹt có trước được gán cho NV vừa tạo');

  // máy trả lời vân tay TRƯỚC tên (người vừa được hỏi): vẫn tạo NV như trước để không mất công, tên thật về sau thay tên tạm
  post('SN_SEOUL', 'ATTLOG', '5\t2026-11-20 08:03:00\t0\t1\t0');
  drain('SN_SEOUL');
  queryData('SN_SEOUL', 'fingertmp', fpLines(['5']));
  assert.equal(emp('5'), 'NV 5');
  queryData('SN_SEOUL', 'user', 'user uid=5\tcardno=\tpin=5\tpassword=\tgroup=1\tname=Tran Van Binh\tprivilege=0');
  assert.equal(emp('5'), 'Tran Van Binh');
  assert.equal(emp('4'), undefined, 'người chưa quẹt vẫn chưa về');
});

test('bấm "Tải nhân viên từ máy" → tạo đủ NV, tên thật về cùng lượt', () => {
  S.queryDeviceUsers('SN_SEOUL');
  drain('SN_SEOUL');
  queryData('SN_SEOUL', 'fingertmp', fpLines(['1', '2']));   // máy trả vân tay trước cũng được
  queryData('SN_SEOUL', 'user', ['1', '2', '4', '6', '7'].map((p) => `user uid=${p}\tpin=${p}\tname=Ten ${p}\tprivilege=0`).join('\n'));
  for (const p of ['1', '2', '4', '6', '7']) assert.equal(emp(p), `Ten ${p}`);
});

test('đăng ký ngay trên máy (real-time): khối có dòng người dùng → NV tên thật, không hỏi thêm; chỉ có vân tay → hỏi máy tên', () => {
  newApprovedDevice('SN_RT', '');
  db.prepare("UPDATE push_devices SET oper_stamp='100' WHERE serial='SN_RT'").run();
  drain('SN_RT');
  post('SN_RT', 'OPERLOG', 'OPLOG 6\t0\t2026-11-20 09:00:00\t801\t0\t0\t0\nFP PIN=801\tFID=1\tSize=8\tValid=1\tTMP=QUJDRDgwMQ==\nUSER PIN=801\tName=Le Hoa\tPri=0', '101');
  assert.equal(emp('801'), 'Le Hoa');
  assert.deepEqual(pending('SN_RT'), [], 'tên đã có trong khối → không hỏi lại máy');
  // người có sẵn trên máy (đăng ký trước khi nối phần mềm) đăng ký thêm ngón: máy chỉ gửi vân tay
  post('SN_RT', 'OPERLOG', 'OPLOG 6\t0\t2026-11-20 09:05:00\t802\t0\t0\t0\nFP PIN=802\tFID=2\tSize=8\tValid=1\tTMP=QUJDRDgwMg==', '102');
  assert.equal(emp('802'), undefined, 'không tạo NV tên tạm "NV 802"');
  assert.deepEqual(pending('SN_RT'), ['DATA QUERY USERINFO PIN=802', 'DATA QUERY FINGERTMP PIN=802']);
  drain('SN_RT');
  queryData('SN_RT', 'user', 'user uid=802\tpin=802\tname=Pham Minh\tprivilege=0');
  assert.equal(emp('802'), 'Pham Minh');
});

test('NV tên tạm có từ trước (bản cũ) → máy bắt tay thì hỏi máy tên thật, mỗi người 1 lần / 24 giờ', () => {
  newApprovedDevice('SN_CU', '');
  drain('SN_CU');
  for (const p of ['901', '902']) {
    S.upsertDeviceUserSerial('SN_CU', p, '', '');
    S.createDraftEmployee(p, '');
  }
  db.prepare("UPDATE employees SET full_name='Da Sua Tay' WHERE device_pin='902'").run();   // tên sửa tay thì thôi
  handshake('SN_CU');
  assert.deepEqual(pending('SN_CU'), ['DATA QUERY USERINFO PIN=901']);
  drain('SN_CU');
  handshake('SN_CU');
  assert.deepEqual(pending('SN_CU'), [], 'đã hỏi trong 24 giờ → không hỏi lại');
  queryData('SN_CU', 'user', 'user uid=901\tpin=901\tname=Vo Thi Mai\tprivilege=0');
  assert.equal(emp('901'), 'Vo Thi Mai');
  assert.equal(emp('902'), 'Da Sua Tay');
});

test('tắt "Tự tạo NV": máy gửi vân tay / người quẹt chưa khớp → không tạo, không hỏi máy', () => {
  setSetting('device_autocreate', '0');
  newApprovedDevice('SN_TAT', '');
  db.prepare("UPDATE push_devices SET oper_stamp='100' WHERE serial='SN_TAT'").run();
  drain('SN_TAT');
  post('SN_TAT', 'OPERLOG', 'FP PIN=951\tFID=1\tSize=8\tValid=1\tTMP=QUJDRDk1MQ==', '101');
  post('SN_TAT', 'ATTLOG', '951\t2026-11-20 08:00:00\t0\t1\t0');
  assert.equal(emp('951'), undefined);
  assert.deepEqual(pending('SN_TAT'), []);
  setSetting('device_autocreate', '1');
});
