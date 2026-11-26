// MÁY HIK DO NỀN TẢNG QUẢN LÝ — NGƯỜI ĐÃ NGHỈ VẪN CÒN TRÊN MÁY (Hualida 26/11/2026): Số ID 32 ký tự, mã thật TB… ở "Code=".
// Trước đây mã TB… trùng NV ĐÃ KHOÁ thì phần mềm tạo NV nháp "TB…_1" (232 NV nháp sau lần tải NV đầu tiên).
// Giờ: gán Số ID cho chính NV đã khoá, NV vẫn khoá, không tạo NV nháp. Mã không có trong phần mềm thì vẫn tạo NV nháp như cũ.
// Chạy: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-hik-ma-da-khoa-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, S;
const PIN_NGHI = 'aba44e36ee6f4a3793524ebb838c8439', PIN_LAM = 'ee88ec26894d4e52a794685e182b4cad', PIN_LA = '2acb858646e04f07814569eab937e62e';
const line = (pin, name, code) => `USER PIN=${pin}\tName=${name}\tCode=${code}`;

before(async () => {
  const D = await import('../server/db.js');
  db = D.db; D.initSchema();
  S = await import('../server/device-sync.js');
  D.setSetting('device_autocreate', '1');
  const ins = db.prepare("INSERT INTO employees (code, full_name, department, role, username, password_hash, active) VALUES (?,?,?,?,?,?,?)");
  ins.run('TB035111', 'Phan Văn Chinh', 'Tổ mẫu - giặt', 'employee', 'TB035111', 'x', 0);   // đã nghỉ (khoá)
  ins.run('TB049916', 'Lê Thị Thu Hoà', 'BP làm rập', 'employee', 'TB049916', 'x', 1);     // đang làm
});

test('mã trùng NV đã khoá → gán Số ID cho NV đó, không tạo NV nháp _1', () => {
  const before = db.prepare('SELECT COUNT(*) c FROM employees').get().c;
  S.ingestUserData('HIK1', 'USER', [line(PIN_NGHI, '潘文正', 'TB035111'), line(PIN_LAM, '黎氏秋和', 'TB049916')].join('\n'), null, { maxPin: 32 });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM employees').get().c, before, 'không thêm NV nào');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM employees WHERE code LIKE 'TB035111_%'").get().c, 0);
  const nghi = db.prepare("SELECT device_pin, active, full_name FROM employees WHERE code='TB035111'").get();
  assert.equal(nghi.device_pin, PIN_NGHI);
  assert.equal(nghi.active, 0, 'NV đã nghỉ vẫn khoá');
  assert.equal(nghi.full_name, 'Phan Văn Chinh', 'không đổi tên');
  assert.equal(db.prepare("SELECT device_pin FROM employees WHERE code='TB049916'").get().device_pin, PIN_LAM);
});

test('tải lại lần 2 vẫn không tạo NV nháp', () => {
  const before = db.prepare('SELECT COUNT(*) c FROM employees').get().c;
  S.ingestUserData('HIK2', 'USER', line(PIN_NGHI, '潘文正', 'TB035111'), null, { maxPin: 32 });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM employees').get().c, before);
});

test('mã không có trong phần mềm → vẫn tạo NV nháp mang mã thật', () => {
  S.ingestUserData('HIK1', 'USER', line(PIN_LA, '阮氏红', 'TB027890'), null, { maxPin: 32 });
  const e = db.prepare("SELECT code, from_device, active FROM employees WHERE device_pin=?").get(PIN_LA);
  assert.equal(e.code, 'TB027890');
  assert.equal(e.from_device, 1);
  assert.equal(e.active, 1);
});
