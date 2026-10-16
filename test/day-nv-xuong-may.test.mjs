// ĐẨY NV TỪ PHẦN MỀM XUỐNG MÁY: khai NV có Số ID → tự đẩy Số ID + tên xuống máy; đăng ký vân tay ở 1 máy → sang máy cùng nhóm
// + về phần mềm, giữ tên khai báo; không báo nhầm "trùng Số ID". Giả lập máy ADMS qua các hàm /iclock. Chạy: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-day-nv-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, setSetting, H, G;
const resObj = () => ({ out: '', type() { return this; }, send(x) { this.out = String(x); return this; } });
const post = (sn, table, body) => H.handleCData({ method: 'POST', query: { SN: sn, table, Stamp: '9999' }, body, headers: {}, socket: {} }, resObj());
function deviceRun(sn) {
  const ran = [];
  for (let i = 0; i < 500; i++) {
    const r = resObj();
    H.handleGetRequest({ query: { SN: sn }, headers: {}, socket: {} }, r);
    if (r.out === 'OK') break;
    const m = /^C:(\d+):([\s\S]*)$/.exec(r.out);
    ran.push(m[2]);
    H.handleDeviceCmd({ body: `ID=${m[1]}&Return=0&CMD=DATA`, query: {} }, resObj());
  }
  return ran;
}
const pending = (sn, pin) => db.prepare('SELECT content FROM push_device_commands WHERE serial=? AND pin=? AND trans_time IS NULL').all(sn, pin).map((r) => r.content);
const vn = (ms = 0) => new Date(Date.now() + ms + 7 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
const TMP = (c) => c.repeat(48);
const addEmp = (pin, name, active = 1) => db.prepare(`INSERT INTO employees(code, full_name, role, username, password_hash, device_pin, active)
  VALUES (?,?,'employee',?,'x',?,?)`).run('NV' + pin, name, 'u' + pin, pin, active);
const conflicts = () => db.prepare('SELECT * FROM device_pin_conflicts').all();

before(async () => {
  const D = await import('../server/db.js');
  db = D.db; setSetting = D.setSetting; D.initSchema();
  H = await import('../server/routes/iclock.js');
  G = await import('../server/pin-guard.js');
  setSetting('device_enabled', '1');   // các công tắc khác để MẶC ĐỊNH (bật)
  // Cơ sở 1: máy cổng + máy xưởng (nhóm G1). Cơ sở 2: máy kho (nhóm G2). Máy VP: không nhận NV mới từ phần mềm.
  for (const [sn, name, grp, recv] of [['SN_A', 'Máy cổng', 'G1', 1], ['SN_B', 'Máy xưởng', 'G1', 1], ['SN_C', 'Máy kho', 'G2', 1], ['SN_D', 'Máy VP', '', 0]])
    db.prepare("INSERT INTO push_devices(serial,name,active,sync_group,oper_stamp,recv_new) VALUES(?,?,1,?,'100',?)").run(sn, name, grp, recv);
});

test('mặc định BẬT tự đẩy NV xuống máy', () => { assert.equal(G.autoPushOn(), true); });

test('khai NV mới có Số ID → đẩy Số ID + tên (không dấu) xuống mọi máy nhận NV mới; máy tắt "nhận NV mới" thì không', () => {
  addEmp('50', 'Nguyễn Văn Năm');
  assert.ok(G.onEmployeesSaved(['50']) >= 3);
  for (const sn of ['SN_A', 'SN_B', 'SN_C']) assert.ok(pending(sn, '50').some((x) => x.startsWith('DATA UPDATE USERINFO PIN=50\tName=Nguyen Van Nam\t')), sn);
  assert.deepEqual(pending('SN_D', '50'), []);
  // chỉ có tên — chưa có sinh trắc
  assert.ok(!pending('SN_A', '50').some((x) => /FINGERTMP|BIODATA/.test(x)));
});

test('đăng ký vân tay ở máy cổng → sang máy xưởng (cùng nhóm) + về phần mềm, giữ tên khai báo, KHÔNG báo trùng', () => {
  for (const sn of ['SN_A', 'SN_B', 'SN_C']) deviceRun(sn);
  post('SN_A', 'OPERLOG', `OPLOG 6\t0\t${vn()}\t50\t0\t0\t0\nUSER PIN=50\tName=Nguyen Van Nam\tPri=0\nFP PIN=50\tFID=0\tSize=48\tValid=1\tTMP=${TMP('n')}`);
  assert.equal(conflicts().length, 0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM device_bio_templates WHERE serial='SN_A' AND pin='50'").get().c, 1, 'vân tay về phần mềm');
  assert.ok(pending('SN_B', '50').some((x) => x.includes(TMP('n'))), 'sang máy cùng nhóm');
  assert.ok(pending('SN_B', '50').some((x) => x.startsWith('DATA UPDATE USERINFO PIN=50\tName=Nguyen Van Nam\t')), 'tên phần mềm');
  assert.ok(!pending('SN_C', '50').some((x) => x.includes(TMP('n'))), 'máy cơ sở khác (nhóm khác) không tự nhận vân tay');
  assert.equal(db.prepare("SELECT full_name FROM employees WHERE device_pin='50'").get().full_name, 'Nguyễn Văn Năm');
});

test('người đã có trên máy, đổi tên trên phần mềm → ghi tên mới xuống máy đó + máy cùng nhóm, không sang nhóm khác', () => {
  db.prepare("UPDATE push_device_commands SET trans_time=datetime('now') WHERE trans_time IS NULL").run();
  addEmp('60', 'Trần Thị Sáu');
  post('SN_A', 'OPERLOG', `OPLOG 29\t0\t${vn()}\t60\t0\t0\t0\nUSER PIN=60\tName=Sau\tPri=0\nFP PIN=60\tFID=1\tSize=48\tValid=1\tTMP=${TMP('s')}`);
  db.prepare("UPDATE push_device_commands SET trans_time=datetime('now') WHERE trans_time IS NULL").run();
  db.prepare("UPDATE employees SET full_name='Trần Thị Sáu Mới' WHERE device_pin='60'").run();
  G.onEmployeesSaved(['60']);
  for (const sn of ['SN_A', 'SN_B']) assert.ok(pending(sn, '60').some((x) => x.includes('Name=Tran Thi Sau Moi\t')), sn);
  assert.deepEqual(pending('SN_C', '60'), []);
});

test('đẩy bằng tay xuống máy chọn (kèm sinh trắc phần mềm đang có)', () => {
  db.prepare("UPDATE push_device_commands SET trans_time=datetime('now') WHERE trans_time IS NULL").run();
  const r = G.pushEmployees(['50', '60'], { serials: ['SN_C', 'SN_D'], withBio: true });
  assert.equal(r.users, 4); assert.equal(r.devices, 2); assert.equal(r.bios, 4);
  assert.ok(pending('SN_D', '50').some((x) => x.includes(TMP('n'))));
  const r2 = G.pushEmployees(['50'], { serials: ['SN_C'], withBio: false });
  assert.equal(r2.bios, 0);
});

test('NV đã khoá không bị đẩy; TẮT đồng bộ NV xuống máy → lưu NV không đẩy gì, máy giữ tên gõ trên máy', () => {
  db.prepare("UPDATE push_device_commands SET trans_time=datetime('now') WHERE trans_time IS NULL").run();
  addEmp('70', 'Lê Văn Bảy', 0);
  assert.equal(G.pushEmployees(['70']).users, 0);
  setSetting('device_auto_push_emp', '0');
  addEmp('80', 'Phạm Văn Tám');
  assert.equal(G.onEmployeesSaved(['80', '50']), 0);
  assert.deepEqual(pending('SN_A', '50'), []);
  assert.equal(G.pmNameFor('50'), null);   // đồng bộ máy↔máy dùng tên trên máy
  setSetting('device_auto_push_emp', '1');
});

test('vẫn báo trùng khi máy khác đã có SINH TRẮC của người khác dưới Số ID đó', () => {
  db.prepare("INSERT INTO push_devices(serial,name,active,sync_group,oper_stamp) VALUES('SN_E','Máy E',1,'G1','100')").run();
  post('SN_E', 'OPERLOG', `OPLOG 29\t0\t${vn()}\t50\t0\t0\t0\nUSER PIN=50\tName=Hoang Van Muoi\tPri=0\nFP PIN=50\tFID=0\tSize=48\tValid=1\tTMP=${TMP('m')}`);
  const c = conflicts().at(-1);
  assert.ok(c); assert.equal(c.serial, 'SN_E'); assert.equal(c.pin, '50');
});
