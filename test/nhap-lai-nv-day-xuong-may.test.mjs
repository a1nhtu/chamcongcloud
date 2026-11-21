// NHẬP LẠI NV ĐÃ XOÁ + Ô EXCEL ĐỊNH DẠNG (mythuatlt 21/11/2026):
//  1) Ô Số ID là chữ định dạng / công thức / liên kết → đọc đúng chữ (trước ra "[object Object]" rồi đẩy số rác xuống máy).
//  2) Xoá NV kèm "Xóa trên tất cả máy" rồi THÊM LẠI đúng Số ID (nhập Excel / thêm tay / gắn Số ID lần đầu) → tự đẩy xuống máy
//     (trước bỏ qua vì ghi nhớ "đã xoá trên máy"). Sửa NV đang có (đổi tên) vẫn KHÔNG đưa về máy đã xoá — như cũ.
//  3) "Xóa trên tất cả máy" nhận Số ID lạ mà máy đang báo có (trước bị lọc bỏ im lặng, người đó nằm mãi trên máy).
// Giả lập 2 máy ADMS cùng nhóm qua các hàm /iclock. Chạy: npm test
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import ExcelJS from 'exceljs';

const DBP = join(tmpdir(), `dgp-nhap-lai-nv-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, setSetting, H;
const routes = {};
const ADMIN = { id: 999999, role: 'admin', full_name: 'Admin' };
const SN = ['M332', 'M087'];
const resObj = () => ({ out: '', type() { return this; }, send(x) { this.out = String(x); return this; } });
const call = async (key, { body = {}, params = {} } = {}) => {
  let out = null, code = 200;
  const res = { status(c) { code = c; return this; }, json(o) { out = o; return this; }, setHeader() {} };
  await routes[key]({ body, params, query: {}, user: ADMIN }, res);
  return { code, out };
};
// Máy hỏi lệnh, chạy, báo OK (máy nhận lệnh xong)
function deviceRun(sn) {
  for (let i = 0; i < 500; i++) {
    const r = resObj();
    H.handleGetRequest({ query: { SN: sn }, headers: {}, socket: {} }, r);
    if (r.out === 'OK') break;
    for (const ln of r.out.split('\n')) {
      const m = /^C:(\d+):/.exec(ln); if (m) H.handleDeviceCmd({ body: `ID=${m[1]}&Return=0&CMD=DATA`, query: {} }, resObj());
    }
  }
}
const runAll = () => SN.forEach(deviceRun);
const pendingUser = (sn) => db.prepare("SELECT pin FROM push_device_commands WHERE serial=? AND trans_time IS NULL AND content LIKE 'DATA UPDATE USERINFO %' ORDER BY id")
  .all(sn).map((r) => r.pin);
const marks = (pin) => db.prepare('SELECT serial FROM device_deleted_pins WHERE pin=? ORDER BY serial').all(pin).map((r) => r.serial);
const onDev = (sn) => db.prepare('SELECT pin FROM device_users_serial WHERE serial=? ORDER BY pin').all(sn).map((r) => r.pin);
const empId = (pin) => db.prepare('SELECT id FROM employees WHERE device_pin=?').get(pin)?.id;

// File Excel nhân viên (10 cột như File mẫu). pinCell(ws, row) đặt ô Số ID theo kiểu muốn thử.
async function importRows(rows, mode = 'add') {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('NhanVien');
  ws.addRow(['Mã NV', 'Họ tên', 'Bộ phận', 'Chức danh', 'SĐT', 'Vai trò', 'Số ID máy', 'Lương CB', 'Tài khoản', 'Mật khẩu']);
  rows.forEach(([code, name, pin], i) => { ws.addRow([code, name, 'Xưởng', '', '', 'Nhân viên', null]); ws.getCell(i + 2, 7).value = pin; });
  const b64 = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
  return call('POST /employees/import', { body: { mode, fileBase64: b64 } });
}
// Xoá NV trên phần mềm + "Xóa trên tất cả máy" (đúng luồng giao diện askDelWhere → delPinsOnDevices)
async function purgeAll(pins) {
  const out = [];
  for (const p of pins) out.push(...((await call('DELETE /employees/:id/purge', { params: { id: empId(p) } })).out.pins || []));
  return call('POST /devices/delete-users-all', { body: { pins: out } });
}

before(async () => {
  const D = await import('../server/db.js');
  db = D.db; setSetting = D.setSetting; D.initSchema();
  H = await import('../server/routes/iclock.js');
  const add = (m) => (p, ...h) => { routes[`${m} ${p}`] = h[h.length - 1]; };
  const R = { get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE') };
  const need = () => (q, s, n) => n();
  (await import('../server/routes/admin/employees.js')).registerEmployeeRoutes(R, { need });
  (await import('../server/routes/admin/devices.js')).registerDeviceRoutes(R, { need });
  setSetting('device_enabled', '1');   // các công tắc khác để MẶC ĐỊNH (tự đẩy NV xuống máy: BẬT)
});

beforeEach(() => {
  for (const t of ['employees', 'device_users', 'device_users_serial', 'device_bio_templates', 'push_device_commands', 'push_devices', 'device_user_photos', 'device_deleted_pins', 'device_deleted_tmps', 'device_pending_deletes'])
    db.exec(`DELETE FROM ${t}`);
  for (const sn of SN) db.prepare("INSERT INTO push_devices(serial,name,active,sync_group,oper_stamp,recv_new) VALUES(?,?,1,'1','100',1)").run(sn, sn);
});

test('ô Số ID là chữ định dạng / công thức / liên kết → lưu đúng số, đẩy đúng số xuống máy (không còn "[object Object]")', async () => {
  const r = await importRows([
    ['A201', 'Phạm Văn Hòa', { richText: [{ text: '20' }, { text: '1', font: { bold: true } }] }],
    ['A202', 'Phạm Bảo Trung', { formula: '200+2', result: 202 }],
    ['A203', 'Phạm Quang Ánh', { text: '203', hyperlink: 'https://example.com' }],
    ['A204', 'Phạm Văn Khánh', 204],
  ]);
  assert.equal(r.code, 200, JSON.stringify(r.out));
  assert.equal(r.out.added, 4);
  assert.deepEqual(db.prepare('SELECT device_pin FROM employees ORDER BY code').all().map((e) => e.device_pin), ['201', '202', '203', '204']);
  for (const sn of SN) assert.deepEqual(pendingUser(sn), ['201', '202', '203', '204'], sn);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM push_device_commands WHERE content LIKE '%object Object%'").get().c, 0);
});

test('xoá NV + "Xóa trên tất cả máy" rồi NHẬP LẠI đúng Số ID → tự đẩy xuống cả 2 máy, gỡ ghi nhớ đã xoá', async () => {
  await importRows([['A201', 'Phạm Văn Hòa', '201'], ['A202', 'Phạm Bảo Trung', '202']]);
  runAll();
  for (const sn of SN) assert.deepEqual(onDev(sn), ['201', '202'], sn);
  const d = await purgeAll(['201', '202']);
  assert.equal(d.code, 200);
  runAll();
  for (const sn of SN) assert.deepEqual(onDev(sn), [], sn);
  assert.deepEqual(marks('201'), SN.slice().sort(), 'phần mềm nhớ đã xoá trên 2 máy');

  const r = await importRows([['A201', 'Phạm Văn Hòa', '201'], ['A202', 'Phạm Bảo Trung', '202']]);
  assert.equal(r.out.added, 2);
  for (const sn of SN) assert.deepEqual(pendingUser(sn), ['201', '202'], `${sn}: NV nhập lại phải xuống máy`);
  assert.deepEqual(marks('201'), []);
  runAll();
  for (const sn of SN) assert.deepEqual(onDev(sn), ['201', '202'], sn);
});

test('thêm tay NV mới / gắn Số ID lần đầu cho NV cũ, đúng Số ID đã xoá → tự đẩy xuống máy', async () => {
  await importRows([['A301', 'Trần Văn Ba', '301'], ['A302', 'Lê Văn Hai', '302']]);
  runAll();
  await purgeAll(['301', '302']);
  runAll();
  // thêm tay (form Thêm NV)
  const a = await call('POST /employees', { body: { code: 'B301', full_name: 'Trần Văn Ba', device_pin: '301' } });
  assert.equal(a.code, 200, JSON.stringify(a.out));
  for (const sn of SN) assert.deepEqual(pendingUser(sn), ['301'], sn);
  // NV đang có, chưa có Số ID → sửa NV điền Số ID 302 (lần đầu)
  db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash, device_pin, active) VALUES('B302','Lê Văn Hai','employee','b302','x','',1)").run();
  const id = db.prepare("SELECT id FROM employees WHERE code='B302'").get().id;
  const u = await call('PUT /employees/:id', { params: { id }, body: { device_pin: '302' } });
  assert.equal(u.code, 200, JSON.stringify(u.out));
  for (const sn of SN) assert.deepEqual(pendingUser(sn), ['301', '302'], sn);
});

test('NHƯ CŨ: NV đang có đổi tên (Số ID không đổi) → không đưa về máy đã xoá người đó', async () => {
  await importRows([['A401', 'Đỗ Văn Bốn', '401']]);
  runAll();
  // máy M087 xoá riêng người này (VD xoá trên menu máy / nút xoá trên 1 máy), phần mềm vẫn giữ NV
  await call('POST /devices/delete-users-all', { body: { pins: ['401'], serials: ['M087'] } });
  runAll();
  assert.deepEqual(onDev('M087'), []);
  const u = await call('PUT /employees/:id', { params: { id: empId('401') }, body: { full_name: 'Đỗ Văn Bốn Mới' } });
  assert.equal(u.code, 200);
  assert.deepEqual(pendingUser('M332'), ['401'], 'máy còn người này: ghi tên mới');
  assert.deepEqual(pendingUser('M087'), [], 'máy đã xoá: không đưa về');
  // nhập Excel kiểu Cập nhật (chỉ đổi tên) cũng vậy
  db.exec('UPDATE push_device_commands SET trans_time=datetime(\'now\') WHERE trans_time IS NULL');
  const r = await importRows([['A401', 'Đỗ Văn Bốn Hai', '']], 'update');
  assert.equal(r.code, 200, JSON.stringify(r.out));
  assert.deepEqual(pendingUser('M332'), ['401']);
  assert.deepEqual(pendingUser('M087'), []);
  assert.deepEqual(marks('401'), ['M087']);
});

test('"Xóa trên tất cả máy" xoá được Số ID lạ mà máy đang báo có; Số ID lạ không có trên máy vẫn bị loại', async () => {
  // như thật: lệnh ghi NV mang số rác được máy báo OK → phần mềm ghi nhận máy có người này (ackCommand)
  for (const sn of SN) {
    const id = db.prepare("INSERT INTO push_device_commands(serial,content,pin,mkind,trans_time) VALUES(?,?,?,'user',datetime('now'))")
      .run(sn, 'DATA UPDATE USERINFO PIN=[object Object]\tName=x', '[object Object]').lastInsertRowid;
    H.handleDeviceCmd({ body: `ID=${id}&Return=0&CMD=DATA`, query: {} }, resObj());
  }
  for (const sn of SN) assert.deepEqual(onDev(sn), ['[object Object]'], sn);
  db.exec('DELETE FROM push_device_commands');
  const r = await call('POST /devices/delete-users-all', { body: { pins: ['[object Object]', 'a b c'] } });
  assert.equal(r.code, 200, JSON.stringify(r.out));
  assert.equal(r.out.pins, 1);
  for (const sn of SN) {
    assert.deepEqual(db.prepare('SELECT content FROM push_device_commands WHERE serial=?').all(sn).map((x) => x.content), ['DATA DELETE USERINFO\tPIN=[object Object]'], sn);
    assert.deepEqual(onDev(sn), []);
  }
  const bad = await call('POST /devices/delete-users-all', { body: { pins: ['a b c'] } });
  assert.equal(bad.code, 400);
});
