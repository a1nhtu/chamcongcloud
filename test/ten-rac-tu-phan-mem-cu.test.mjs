// TÊN RÁC từ phần mềm cũ (trankimxuyen 10/11/2026): Ronald Jack Pro đọc hỏng tên dài trên máy ZK → tên = 20 ký tự NUL + "〲1"
// (Số ID 201 đọc nhầm UTF-16). Máy vẫn có tên thật ("AN NGUYEN TRUONG NGUYEN") và gửi lên qua USERINFO, nhưng phần mềm chỉ thay
// tên tạm "NV <Số ID>" nên tên rác ở mãi. Nay: máy gửi tên thật → thay tên rác; máy gửi tên rác → bỏ qua; khởi động tự dọn tên rác.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'dgp-tenrac-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema } = await import('../server/db.js');
const { ingestUserData } = await import('../server/device-sync.js');
const { isJunkName, cleanName } = await import('../server/ten-nv.js');

const RAC = '\u0000'.repeat(20) + '〲' + '1\u0000';
const nv = (code, name, pin) => db.prepare("INSERT INTO employees(code,full_name,username,password_hash,role,device_pin) VALUES(?,?,?,'x','employee',?)").run(code, name, 'u' + code, pin).lastInsertRowid;
const ten = (id) => db.prepare('SELECT full_name FROM employees WHERE id=?').get(id).full_name;

before(() => initSchema());
after(() => { try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} });

test('nhận diện tên rác', () => {
  assert.equal(isJunkName(RAC), true);
  assert.equal(isJunkName('\u0000'.repeat(20)), true);
  assert.equal(isJunkName('Nguyễn Văn A'), false);
  assert.equal(cleanName('  AN NGUYEN TRUONG NGUYEN '), 'AN NGUYEN TRUONG NGUYEN');
  assert.equal(cleanName(RAC), '');
});

test('máy gửi tên thật → thay tên rác; tên đã gõ đúng thì giữ', () => {
  const a = nv('00201', RAC, '201');
  const b = nv('00016', 'Trần Kim Chi', '16');
  ingestUserData('SN1', 'USERINFO', 'USER PIN=201\tName=AN NGUYEN TRUONG NGUYEN\tPri=0\nUSER PIN=16\tName=CSKH Chi\tPri=0');
  assert.equal(ten(a), 'AN NGUYEN TRUONG NGUYEN');
  assert.equal(ten(b), 'Trần Kim Chi');
});

test('máy gửi tên rác → không ghi đè tên đang có, không lưu tên rác vào bảng người dùng trên máy', () => {
  const c = nv('00300', 'Lê Thị B', '300');
  ingestUserData('SN1', 'USERINFO', `USER PIN=300\tName=${RAC}\tPri=0`);
  assert.equal(ten(c), 'Lê Thị B');
  assert.equal(db.prepare("SELECT name FROM device_users_serial WHERE serial='SN1' AND pin='300'").get().name, '');
});

test('tên tạm "NV <Số ID>" (chuyển dữ liệu không có tên) → máy gửi tên thật thì thay', () => {
  const d = nv('00057', 'NV 57', '57');
  ingestUserData('SN1', 'USERINFO', 'USER PIN=57\tName=PHAM VAN C\tPri=0');
  assert.equal(ten(d), 'PHAM VAN C');
});

test('khởi động: tên rác → tên máy đã gửi (nếu có), không thì "NV <Số ID>"', () => {
  const e = nv('00210', RAC, '210');
  const f = nv('00065', RAC, '65');
  db.prepare("INSERT OR REPLACE INTO device_users(pin,name) VALUES('210','VS TRUONG THI THUY LINH')").run();
  db.prepare('INSERT OR REPLACE INTO device_users(pin,name) VALUES(?,?)').run('65', RAC);
  initSchema();
  assert.equal(ten(e), 'VS TRUONG THI THUY LINH');
  assert.equal(ten(f), 'NV 65');
  assert.equal(db.prepare("SELECT name FROM device_users WHERE pin='65'").get().name, '');
});
