// MÁY NỐI LẠI → TỰ TẢI BÙ LOG: mất mạng / máy chủ tắt một lúc thì máy (mốc ATTLOGStamp kẹt 9999) không tự gửi bù
// lượt quẹt trong quãng đó → phần mềm tự ra lệnh DATA QUERY ATTLOG từ ngày mất liên lạc. Giả lập máy ADMS. Chạy: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-tai-bu-log-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, setSetting, H, vnDateStr;
const resObj = () => ({ out: '', type() { return this; }, send(x) { this.out = String(x); return this; } });
const getreq = (sn) => { const r = resObj(); H.handleGetRequest({ query: { SN: sn }, headers: {}, socket: {} }, r); return r.out; };
const post = (sn, table, body) => H.handleCData({ method: 'POST', query: { SN: sn, table, Stamp: '9999' }, body, headers: {}, socket: {} }, resObj());
const attQueries = (sn) => db.prepare("SELECT content FROM push_device_commands WHERE serial=? AND content LIKE 'DATA QUERY ATTLOG%'").all(sn).map((r) => r.content);
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const addDev = (sn, active, lastSeen) => db.prepare("INSERT INTO push_devices(serial,name,active,att_stamp,oper_stamp,last_seen) VALUES(?,?,?,'9999','9999',?)").run(sn, sn, active, lastSeen);

before(async () => {
  const D = await import('../server/db.js');
  db = D.db; setSetting = D.setSetting; D.initSchema();
  H = await import('../server/routes/iclock.js');
  ({ vnDateStr } = await import('../server/util.js'));
  setSetting('device_enabled', '1');
});

test('máy vẫn kết nối đều (cách lần trước < 5 phút) → KHÔNG tải bù', () => {
  addDev('SN_DEU', 1, ago(0.5));
  assert.equal(getreq('SN_DEU'), 'OK');
  assert.deepEqual(attQueries('SN_DEU'), []);
});

test('máy nối lại sau 40 phút mất liên lạc → ngay lần hỏi lệnh đầu nhận lệnh tải log từ ngày mất liên lạc tới hôm nay, chỉ 1 lần', () => {
  addDev('SN_ROT', 1, ago(40));
  const from = vnDateStr(new Date(Date.now() - 40 * 60000)), to = vnDateStr();
  const out = getreq('SN_ROT');
  assert.match(out, /^C:\d+:DATA QUERY ATTLOG StartTime=/);
  assert.ok(out.includes(`StartTime=${from} 00:00:00\tEndTime=${to} 23:59:59`), out);
  // lần hỏi tiếp theo (đã cập nhật last_seen) không xếp thêm lệnh
  getreq('SN_ROT'); getreq('SN_ROT');
  assert.equal(attQueries('SN_ROT').length, 1);
});

test('mất liên lạc lâu (90 ngày) → chỉ tải bù tối đa 31 ngày', () => {
  addDev('SN_LAU', 1, ago(90 * 1440));
  const out = getreq('SN_LAU');
  const want = vnDateStr(new Date(Date.now() - 31 * 86400e3));
  assert.ok(out.includes(`StartTime=${want} 00:00:00`), out);
});

test('máy chưa duyệt / tắt "Dùng máy chấm công" / máy mới lần đầu → không tải bù', () => {
  addDev('SN_CHO', 0, ago(60));
  getreq('SN_CHO');
  assert.deepEqual(attQueries('SN_CHO'), []);
  getreq('SN_MOI');   // máy lạ lần đầu (chưa có last_seen)
  assert.deepEqual(attQueries('SN_MOI'), []);
  setSetting('device_enabled', '0');
  addDev('SN_TAT', 1, ago(60));
  getreq('SN_TAT');
  assert.deepEqual(attQueries('SN_TAT'), []);
  setSetting('device_enabled', '1');
});

// Lệnh tải bù đã gửi nhưng máy không báo nhận (máy tính vừa ngủ dậy, mạng chập — minhphu 22/10/2026: lệnh lạc mất,
// cả chiều 21/10 không về) → gửi lại sau 5 phút, tối đa 3 lần; máy báo nhận rồi thì thôi.
const ack = (id) => H.handleDeviceCmd({ body: `ID=${id}&Return=0&CMD=DATA`, query: {} }, resObj());
const aged = (sn, min) => db.prepare(`UPDATE push_device_commands SET trans_time=datetime('now','-${min} minutes')
  WHERE serial=? AND trans_time IS NOT NULL`).run(sn);
const cmdId = (out) => Number(/^C:(\d+):/.exec(out)?.[1]);

test('lệnh tải log máy không báo nhận → sau 5 phút gửi lại đúng lệnh đó; máy báo nhận rồi thì không gửi nữa', () => {
  addDev('SN_LAC', 1, ago(600));
  const id = cmdId(getreq('SN_LAC'));
  assert.ok(id, 'đã gửi lệnh tải log');
  assert.equal(getreq('SN_LAC'), 'OK', 'chưa quá 5 phút: chờ máy trả lời, không gửi lại');
  aged('SN_LAC', 6);
  assert.equal(cmdId(getreq('SN_LAC')), id, 'quá 5 phút không báo nhận: gửi lại');
  ack(id);
  aged('SN_LAC', 6);
  assert.equal(getreq('SN_LAC'), 'OK', 'đã báo nhận: không gửi lại');
  assert.equal(attQueries('SN_LAC').length, 1);
});

test('máy không bao giờ báo nhận → gửi lại tối đa 3 lần rồi thôi; lệnh cũ hơn 1 ngày không gửi lại', () => {
  addDev('SN_CAM', 1, ago(600));
  const id = cmdId(getreq('SN_CAM'));
  let resent = 0;
  for (let i = 0; i < 5; i++) { aged('SN_CAM', 6); if (cmdId(getreq('SN_CAM')) === id) resent++; }
  assert.equal(resent, 3);
  addDev('SN_CU', 1, ago(0.5));
  db.prepare(`INSERT INTO push_device_commands(serial, content, trans_time) VALUES('SN_CU', 'DATA QUERY ATTLOG StartTime=x', datetime('now','-2 days'))`).run();
  assert.equal(getreq('SN_CU'), 'OK');
});

test('máy báo nhận MUỘN sau khi lệnh đã vào hàng chờ gửi lại → không gửi lại; lần mất liên lạc sau vẫn xếp lệnh mới', () => {
  addDev('SN_MUON', 1, ago(600));
  const id = cmdId(getreq('SN_MUON'));
  db.prepare("UPDATE push_device_commands SET trans_time=NULL, resend=1 WHERE id=?").run(id);   // vừa đưa về hàng chờ gửi lại
  ack(id);                                                                                         // thì máy báo kết quả lần gửi trước
  assert.equal(getreq('SN_MUON'), 'OK');
  db.prepare('UPDATE push_devices SET last_seen=? WHERE serial=?').run(ago(600), 'SN_MUON');
  const out = getreq('SN_MUON');
  assert.match(out, /^C:\d+:DATA QUERY ATTLOG/);
  assert.notEqual(cmdId(out), id, 'lệnh mới, không bị lệnh cũ chặn trùng');
});

test('máy trả log bù → lượt quẹt đầu giờ bị sót được ghi, giờ VÀO lấy lượt sớm nhất, lượt đã có không nhân đôi', () => {
  db.prepare(`INSERT INTO employees(code, full_name, role, username, password_hash, device_pin, active)
    VALUES ('NV15','Lưu Mạnh Dũng','employee','u15','x','15',1)`).run();
  const day = vnDateStr();
  // Lượt quẹt lại lúc 08:54 đã về (khi có mạng), lượt 08:00 bị sót lúc mất mạng
  post('SN_ROT', 'ATTLOG', `15\t${day} 08:54:37\t0\t15`);
  post('SN_ROT', 'ATTLOG', `15\t${day} 08:00:23\t0\t15\n15\t${day} 08:54:37\t0\t15`);   // máy trả log bù cả ngày
  const n = db.prepare("SELECT COUNT(*) c FROM device_punches WHERE serial='SN_ROT' AND pin='15' AND work_date=?").get(day).c;
  assert.equal(n, 2);
  const a = db.prepare("SELECT a.check_in_at FROM attendance a JOIN employees e ON e.id=a.employee_id WHERE e.code='NV15' AND a.work_date=? ORDER BY a.check_in_at LIMIT 1").get(day);
  assert.ok(a, 'có bản ghi công');
  assert.equal(a.check_in_at, new Date(`${day}T08:00:23+07:00`).toISOString());
});
