// Test SUẤT ĂN — màn "Phân nhân viên vào bếp" kiểu xếp lịch trình ca + ô chọn NV hiện cả danh sách + GỬI BẾP có xem trước.
//   · GET /admin/meal/kitchen-emps?all=1: mọi NV đang làm + bếp đang phân + danh mục bộ phận cha–con
//   · PUT /admin/meal/kitchen-assign: departments (đúng tên, '' = chưa có bộ phận) ∪ employee_ids; department (cũ) vẫn gồm bộ phận con
//   · GET /admin/meal/emp-search?all=1&q=: trả cả danh sách; không có all thì ô trống vẫn trả rỗng (như cũ)
//   · POST /admin/meal/dispatch {preview:true}: chỉ tính + soạn tin nhắn, KHÔNG ghi; gửi thật xong bản xem trước sau có "lần gửi trước"
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-meal-phan-bep-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, server, base, K1, K2;
const tok = {}, E = {};
const F = '2099-03-03';

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}
const addEmp = (code, name, dept, role = 'employee', perms = null) => {
  E[code] = Number(db.prepare('INSERT INTO employees(code, full_name, department, role, username, password_hash, permissions) VALUES (?,?,?,?,?,?,?)')
    .run(code, name, dept, role, code.toLowerCase(), 'x', perms).lastInsertRowid);
  return E[code];
};
const kitchenOf = async () => Object.fromEntries((await call('GET', '/admin/meal/kitchen-emps?all=1', { token: tok.HR1 })).body.rows.map((r) => [r.code, r.kitchen_id]));

before(async () => {
  let initSchema;
  ({ db, initSchema } = await import('../server/db.js'));
  const { signToken, signMaster } = await import('../server/auth.js');
  const adminRoutes = (await import('../server/routes/admin.js')).default;
  const express = (await import('express')).default;
  initSchema();
  // Xưởng (cha) → May, Cắt (con)
  const x = Number(db.prepare("INSERT INTO departments(name) VALUES ('Xưởng')").run().lastInsertRowid);
  db.prepare("INSERT INTO departments(name, parent_id) VALUES ('May', ?), ('Cắt', ?)").run(x, x);
  for (const [c, n, d] of [['A1', 'Nguyễn An', 'May'], ['A2', 'Trần Bình', 'May'], ['B1', 'Lê Cường', 'Cắt'], ['B2', 'Phạm Dũng', 'Cắt'], ['X1', 'Đỗ Xuân', 'Xưởng'], ['N1', 'Vũ Nam', '']]) addEmp(c, n, d);
  addEmp('HR1', 'Lan HR', 'Văn phòng', 'manager', JSON.stringify(['meal']));
  tok.HR1 = signToken({ id: E.HR1, code: 'HR1', role: 'manager', full_name: 'Lan HR' });
  const app = express(); app.use(express.json());
  app.use('/api/admin', adminRoutes);
  await new Promise((ok) => { server = app.listen(0, '127.0.0.1', ok); });
  base = `http://127.0.0.1:${server.address().port}/api`;
  await call('PUT', '/admin/settings', { token: signMaster('sadmin'), body: { meal_enabled: true } });
  K1 = (await call('POST', '/admin/meal/kitchens', { token: tok.HR1, body: { name: 'Bếp 1' } })).body.kitchen;
  K2 = (await call('POST', '/admin/meal/kitchens', { token: tok.HR1, body: { name: 'Bếp 2' } })).body.kitchen;
});
after(() => { server?.close(); for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} } });

test('kitchen-emps?all=1: mọi NV đang làm (chưa phân = 0) + danh mục bộ phận cha–con', async () => {
  const r = await call('GET', '/admin/meal/kitchen-emps?all=1', { token: tok.HR1 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.rows.map((x) => x.code).sort(), ['A1', 'A2', 'B1', 'B2', 'HR1', 'N1', 'X1']);
  assert.ok(r.body.rows.every((x) => x.kitchen_id === 0));
  assert.equal(r.body.rows.find((x) => x.code === 'N1').department, '');
  const deps = Object.fromEntries(r.body.departments.map((d) => [d.name, d]));
  assert.equal(deps.May.parent_id, deps['Xưởng'].id);
  // không có all → như cũ: NV của đúng 1 bộ phận
  assert.deepEqual((await call('GET', '/admin/meal/kitchen-emps?department=May', { token: tok.HR1 })).body.rows.map((x) => x.code), ['A1', 'A2']);
});

test('kitchen-assign: nhiều bộ phận + từng người trong 1 lần lưu; "departments" đúng tên (không tự lấy con); "" = chưa có bộ phận', async () => {
  let r = await call('PUT', '/admin/meal/kitchen-assign', { token: tok.HR1, body: { kitchen_id: K1.id, departments: ['May', ''], employee_ids: [E.B1, 99999] } });
  assert.equal(r.status, 200);
  assert.equal(r.body.count, 4);   // A1, A2 (May) + N1 (chưa có BP) + B1
  let k = await kitchenOf();
  assert.deepEqual([k.A1, k.A2, k.N1, k.B1, k.B2, k.X1], [K1.id, K1.id, K1.id, K1.id, 0, 0]);
  // tick "Xưởng" ở giao diện mà KHÔNG gồm con → chỉ người đứng tên Xưởng
  r = await call('PUT', '/admin/meal/kitchen-assign', { token: tok.HR1, body: { kitchen_id: K2.id, departments: ['Xưởng'] } });
  assert.equal(r.body.count, 1);
  k = await kitchenOf();
  assert.deepEqual([k.X1, k.A1, k.B2], [K2.id, K1.id, 0]);
  // cách gửi cũ "department" vẫn gồm bộ phận con
  r = await call('PUT', '/admin/meal/kitchen-assign', { token: tok.HR1, body: { kitchen_id: K2.id, department: 'Xưởng' } });
  assert.equal(r.body.count, 5);
  k = await kitchenOf();
  assert.deepEqual([k.A1, k.A2, k.B1, k.B2, k.X1, k.N1], [K2.id, K2.id, K2.id, K2.id, K2.id, K1.id]);
  // bỏ phân bếp
  r = await call('PUT', '/admin/meal/kitchen-assign', { token: tok.HR1, body: { kitchen_id: 0, employee_ids: [E.N1] } });
  assert.equal((await kitchenOf()).N1, 0);
  // không chọn gì → báo lỗi
  assert.equal((await call('PUT', '/admin/meal/kitchen-assign', { token: tok.HR1, body: { kitchen_id: K1.id, departments: [], employee_ids: [] } })).status, 400);
});

test('emp-search?all=1: ô trống trả cả danh sách (bấm vào là hiện); không có all thì vẫn rỗng như cũ', async () => {
  const all = (await call('GET', `/admin/meal/emp-search?date=${F}&shift=chieu&all=1&q=`, { token: tok.HR1 })).body.rows;
  assert.equal(all.length, 7);
  assert.ok(all.every((x) => 'registered' in x && 'department' in x));
  assert.deepEqual((await call('GET', `/admin/meal/emp-search?date=${F}&shift=chieu&q=`, { token: tok.HR1 })).body.rows, []);
  assert.deepEqual((await call('GET', `/admin/meal/emp-search?date=${F}&shift=chieu&q=cuong`, { token: tok.HR1 })).body.rows.map((x) => x.code), ['B1']);
});

test('GỬI BẾP xem trước: không ghi gì; gửi thật mới ghi; lần xem trước sau có "lần gửi trước"', async () => {
  const sent = () => db.prepare("SELECT COUNT(*) n FROM meal_dispatch WHERE work_date = ? AND shift = 'chieu'").get(F).n;
  let r = await call('POST', '/admin/meal/dispatch', { token: tok.HR1, body: { date: F, shift: 'chieu', preview: true } });
  assert.equal(r.status, 200);
  assert.equal(r.body.preview, true);
  assert.equal(sent(), 0, 'xem trước không được ghi');
  assert.equal(r.body.prev, null);
  assert.equal(r.body.sent_at, null);
  assert.deepEqual(r.body.kitchens.map((x) => x.name), ['Bếp 1', 'Bếp 2']);
  assert.match(r.body.message, /bản xem trước, chưa gửi$/);
  r = await call('POST', '/admin/meal/dispatch', { token: tok.HR1, body: { date: F, shift: 'chieu' } });
  assert.equal(r.body.preview, false);
  assert.equal(sent(), 1);
  assert.match(r.body.message, /\(Lan HR\)$/);
  r = await call('POST', '/admin/meal/dispatch', { token: tok.HR1, body: { date: F, shift: 'chieu', preview: true } });
  assert.equal(r.body.prev.total, 0);
  assert.ok(r.body.prev.sent_at);
});
