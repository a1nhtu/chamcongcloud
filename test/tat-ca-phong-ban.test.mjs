// Test GÁN CA CHO PHÒNG BAN → "Tất cả phòng ban" (dòng department = '*'):
//   · áp cho mọi phòng ban, kể cả phòng ban THÊM SAU và nhân viên chưa xếp phòng ban
//   · lịch mới thắng: phòng ban đã có lịch trong khoảng ngày đó bị cắt / thay
//   · sau đó gán riêng 1 phòng ban thì phòng đó theo lịch riêng
//   · không chọn "Tất cả" thì mọi thứ như cũ
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'dgp-allpb-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema } = await import('../server/db.js');
const { registerAssignmentRoutes } = await import('../server/routes/admin/assignments.js');
const { rangedShiftAssignment } = await import('../server/shift-resolver.js');
const express = (await import('express')).default;

let srv, url, HC, CA2, CA3, A, B, C;
const call = async (m, p, b) => {
  const x = await fetch(url + p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  return { status: x.status, body: await x.json() };
};
const shiftOf = (eid, d) => rangedShiftAssignment(eid, d)?.shift_id ?? null;
const addEmp = (code, dept) => Number(db.prepare("INSERT INTO employees(code, username, password_hash, full_name, role, active, department) VALUES (?,?,'x',?,'employee',1,?)").run(code, code.toLowerCase(), 'NV ' + code, dept).lastInsertRowid);
const assign = (departments, shift_id, from_date, to_date = '') => call('POST', '/admin/dept-shift-assignments', { departments, mode: 'shift', shift_id, from_date, to_date });

before(() => {
  initSchema();
  const sh = db.prepare("INSERT INTO shifts(name, code, start_time, end_time) VALUES (?,?,'08:00','17:00')");
  HC = Number(sh.run('HC', 'HC').lastInsertRowid); CA2 = Number(sh.run('CA2', 'CA2').lastInsertRowid); CA3 = Number(sh.run('CA3', 'CA3').lastInsertRowid);
  for (const n of ['Kế toán', 'Xưởng']) db.prepare('INSERT INTO departments(name) VALUES (?)').run(n);
  A = addEmp('A', 'Kế toán'); B = addEmp('B', 'Xưởng'); C = addEmp('C', null);
  const app = express(); app.use(express.json());
  app.use((q, s, n) => { q.user = { id: 1, full_name: 'QL', role: 'admin' }; n(); });
  const r = express.Router(); registerAssignmentRoutes(r, { need: () => (q, s, n) => n() }); app.use('/admin', r);
  srv = app.listen(0); url = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { srv.close(); try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} });

test('chưa chọn "Tất cả": gán riêng phòng ban như cũ, NV chưa có phòng ban không theo lịch nào', async () => {
  assert.equal((await assign(['Kế toán'], CA2, '2026-10-01')).status, 200);
  assert.equal(shiftOf(A, '2026-10-05'), CA2);
  assert.equal(shiftOf(B, '2026-10-05'), null);
  assert.equal(shiftOf(C, '2026-10-05'), null);
});

test('chọn "Tất cả phòng ban": mọi phòng + NV chưa có phòng ban theo; phòng đã có lịch bị lịch mới đè từ ngày bắt đầu', async () => {
  const r = await assign(['*', 'Xưởng'], HC, '2026-10-10');   // lẫn tên phòng ban thì vẫn chỉ lưu 1 dòng "tất cả"
  assert.equal(r.status, 200); assert.equal(r.body.count, 1);
  assert.deepEqual(db.prepare("SELECT department, to_date FROM dept_shift_assignments WHERE active=1 ORDER BY id").all().map((x) => [x.department, x.to_date]),
    [['Kế toán', '2026-10-09'], ['*', null]]);
  assert.equal(shiftOf(A, '2026-10-05'), CA2);   // trước ngày bắt đầu: giữ lịch cũ
  for (const e of [A, B, C]) assert.equal(shiftOf(e, '2026-10-10'), HC);
});

test('phòng ban + nhân viên THÊM SAU cũng theo lịch "Tất cả phòng ban"', () => {
  db.prepare("INSERT INTO departments(name) VALUES ('Phòng mới')").run();
  const D = addEmp('D', 'Phòng mới');
  assert.equal(shiftOf(D, '2026-11-02'), HC);
});

test('sau đó gán riêng 1 phòng ban → phòng đó theo lịch riêng, phòng khác vẫn theo "Tất cả"', async () => {
  assert.equal((await assign(['Xưởng'], CA3, '2026-10-20')).status, 200);
  assert.equal(shiftOf(B, '2026-10-19'), HC);
  assert.equal(shiftOf(B, '2026-10-20'), CA3);
  assert.equal(shiftOf(A, '2026-10-20'), HC);
  assert.equal(shiftOf(C, '2026-10-20'), HC);
  // lịch riêng của NV vẫn ưu tiên hơn lịch phòng ban
  db.prepare("INSERT INTO shift_assignments(employee_id, shift_id, from_date, mode) VALUES (?,?,?, 'shift')").run(C, CA2, '2026-10-25');
  assert.equal(shiftOf(C, '2026-10-25'), CA2);
});

test('danh sách lịch trình phòng ban trả về dòng "*" để giao diện hiện "Tất cả phòng ban"', async () => {
  const rows = (await call('GET', '/admin/dept-shift-assignments')).body.rows;
  assert.ok(rows.some((x) => x.department === '*' && x.shift_id === HC));
});
