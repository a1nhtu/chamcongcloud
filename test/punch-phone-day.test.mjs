// Test "LƯỢT CHẤM" với ngày nhân viên chấm bằng ĐIỆN THOẠI: giờ chấm điện thoại chỉ nằm ở bảng công (không có lượt chấm gốc),
// nên thêm lượt chấm tay rồi dựng lại ngày từ lượt chấm sẽ ghi đè / làm mất các lần chấm điện thoại → phải CHẶN.
// Dùng CSDL tạm (DB_PATH) + gọi thật các route quản trị.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'dgp-phone-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema, setSetting } = await import('../server/db.js');
const { registerAttendanceRoutes } = await import('../server/routes/admin/attendance.js');
const express = (await import('express')).default;

const D = '2026-10-08';
const iso = (t, d = D) => new Date(`${d}T${t}:00+07:00`).toISOString();
const hm = (i) => (i ? new Date(Date.parse(i) + 7 * 3600000).toISOString().slice(11, 16) : null);
let srv, base, phoneEmp, devEmp;
const call = async (m, p, b) => {
  const x = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  return { status: x.status, body: await x.json() };
};
const dayRows = (eid) => db.prepare('SELECT check_in_at i, check_out_at o FROM attendance WHERE employee_id=? AND work_date=? ORDER BY check_in_at').all(eid, D).map((a) => [hm(a.i), hm(a.o)]);

before(() => {
  initSchema();
  setSetting('attendance_mode', 'hourly');
  const addEmp = (code) => db.prepare("INSERT INTO employees(code, username, password_hash, full_name, role, active) VALUES (?,?,'x',?,'employee',1)").run(code, code.toLowerCase(), 'NV ' + code).lastInsertRowid;
  phoneEmp = addEmp('PH1'); devEmp = addEmp('DV1');
  // NV chấm điện thoại 2 phiên trong ngày (có ảnh chấm)
  const ins = db.prepare("INSERT INTO attendance(employee_id, work_date, check_in_at, check_out_at, check_in_photo, check_out_photo, work_minutes, work_unit, day_status, shift_source) VALUES (?,?,?,?,'/uploads/a.jpg','/uploads/b.jpg',?,?, 'lam_viec', 'hourly')");
  ins.run(phoneEmp, D, iso('08:24'), iso('12:33'), 249, 0.51);
  ins.run(phoneEmp, D, iso('14:31'), iso('19:32'), 301, 0.62);
  const app = express(); app.use(express.json());
  app.use((q, s, n) => { q.user = { id: 1, full_name: 'QL', role: 'admin' }; n(); });
  const r = express.Router(); registerAttendanceRoutes(r, { need: () => (q, s, n) => n() }); app.use('/admin', r);
  srv = app.listen(0); base = `http://127.0.0.1:${srv.address().port}/admin`;
});
after(() => { srv.close(); try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} });

test('thêm giờ trùng phiên điện thoại đã có → bị chặn, giờ chấm điện thoại giữ nguyên', async () => {
  const r = await call('POST', '/attendance/punches', { employee_ids: [phoneEmp], date: D, in: '08:30' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /trùng với phiên/);
  assert.equal((await call('POST', '/attendance/punches', { employee_ids: [phoneEmp], date: D, out: '20:00' })).status, 400);   // không có phiên mở
  assert.deepEqual(dayRows(phoneEmp), [['08:24', '12:33'], ['14:31', '19:32']]);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM device_punches WHERE employee_id=?').get(phoneEmp).c, 0);
});

test('sửa ô Vào 1 dòng rồi thêm PHIÊN MỚI (vào trước, ra sau) → thành phiên thứ 3, không mất dòng nào', async () => {
  const first = db.prepare('SELECT id FROM attendance WHERE employee_id=? AND work_date=? ORDER BY check_in_at').get(phoneEmp, D).id;
  assert.equal((await call('PUT', '/attendance/' + first, { check_in: '08:00' })).status, 200);
  assert.equal((await call('POST', '/attendance/punches', { employee_ids: [phoneEmp], date: D, in: '20:00' })).status, 200);
  assert.equal((await call('POST', '/attendance/punches', { employee_ids: [phoneEmp], date: D, in: '21:00' })).status, 400);   // đang có phiên chưa ra
  assert.equal((await call('POST', '/attendance/punches', { employee_ids: [phoneEmp], date: D, out: '22:00' })).status, 200);
  assert.deepEqual(dayRows(phoneEmp), [['08:00', '12:33'], ['14:31', '19:32'], ['20:00', '22:00']]);
  const last = db.prepare('SELECT work_minutes wm, manual FROM attendance WHERE employee_id=? AND work_date=? ORDER BY check_in_at DESC').get(phoneEmp, D);
  assert.equal(last.wm, 120); assert.equal(last.manual, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM device_punches WHERE employee_id=?').get(phoneEmp).c, 0);
  db.prepare('DELETE FROM attendance WHERE employee_id=? AND work_date=? AND check_in_at=?').run(phoneEmp, D, iso('20:00'));
});

test('thêm nhiều người: người chấm điện thoại trùng phiên bị bỏ qua, người khác vẫn thêm; hàng loạt bỏ qua ngày điện thoại', async () => {
  const r = await call('POST', '/attendance/punches', { employee_ids: [phoneEmp, devEmp], date: D, in: '08:00', out: '17:00' });
  assert.equal(r.status, 200);
  assert.equal(r.body.count, 1); assert.equal(r.body.skippedPhone, 1);
  assert.deepEqual(dayRows(devEmp), [['08:00', '17:00']]);
  const b = await call('POST', '/attendance/punches/bulk', { employee_ids: [phoneEmp], dates: [D], in: { time: '07:00' }, out: { time: '18:00' } });
  assert.equal(b.body.added, 0); assert.equal(b.body.skippedPhone, 1);
  assert.deepEqual(dayRows(phoneEmp), [['08:00', '12:33'], ['14:31', '19:32']]);
});

test('lưới Tính công + cửa sổ Lượt chấm hiện các lần chấm điện thoại', async () => {
  const g = await call('GET', `/attendance/grid?mode=detail&from=${D}&to=${D}&ids=${phoneEmp}`);
  assert.deepEqual(g.body.rows.map((x) => x.punches).sort(), [['08:00📱', '12:33📱'], ['14:31📱', '19:32📱']]);
  const p = await call('GET', `/attendance/punches?employee_id=${phoneEmp}&date=${D}`);
  assert.equal(p.body.phoneLocked, true);
  assert.deepEqual(p.body.phone.map((x) => [x.in, x.out]), [['08:00', '12:33'], ['14:31', '19:32']]);
  const q = await call('GET', `/attendance/punches?employee_id=${devEmp}&date=${D}`);
  assert.equal(q.body.phoneLocked, false); assert.equal(q.body.rows.length, 2);
});

test('ngày chấm điện thoại đã lỡ có lượt thêm tay (bản cũ): xoá lượt đó KHÔNG làm mất dòng công', async () => {
  const id = db.prepare("INSERT INTO device_punches(serial, pin, punch_at, work_date, status, verify, employee_id) VALUES ('TAY_VAO','PH1',?,?,0,0,?)").run(iso('08:00'), D, phoneEmp).lastInsertRowid;
  assert.equal((await call('DELETE', '/attendance/punches/' + id)).status, 200);
  assert.deepEqual(dayRows(phoneEmp), [['08:00', '12:33'], ['14:31', '19:32']]);
});
