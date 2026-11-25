// QUẢN LÝ BỘ PHẬN (Anh 25/11/2026, khách thefifty: 12 cửa hàng = 12 bộ phận, mỗi cửa hàng 1 quản lý).
// Tài khoản Quản lý có tích "Chỉ quản lý bộ phận" (employees.dept_scope) chỉ XEM và chỉ thấy NV thuộc bộ phận của mình:
// danh sách NV, Tính công, Tổng quan, Báo cáo / Xuất Excel. Mọi thao tác ghi bị chặn. Quản lý thường + admin không đổi.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { moCong } from './_cong.mjs';

const dir = mkdtempSync(join(tmpdir(), 'dgp-qlbp-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema } = await import('../server/db.js');
const { signToken } = await import('../server/auth.js');
const express = (await import('express')).default;

const vn = (d, hm) => new Date(`${d}T${hm}:00+07:00`).toISOString();
const WD = '2026-11-24';
let server, base, ADM, QL, QLX, A1, A2, B1, CON1;
const tok = (id) => 'Bearer ' + signToken(db.prepare('SELECT * FROM employees WHERE id=?').get(id));
const call = async (id, method, path, body) => {
  const r = await fetch(base + path, { method, headers: { Authorization: tok(id), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};

before(async () => {
  initSchema();
  db.prepare("INSERT OR IGNORE INTO departments(name) VALUES ('Thảo Điền'),('Quận 4')").run();
  const td = db.prepare("SELECT id FROM departments WHERE name='Thảo Điền'").get().id;
  db.prepare("INSERT OR IGNORE INTO departments(name, parent_id) VALUES ('Thảo Điền - Bếp', ?)").run(td);   // bộ phận con
  const ins = db.prepare("INSERT INTO employees(code, full_name, department, role, username, password_hash, permissions, dept_scope, start_date) VALUES (?,?,?,?,?,'x',?,?,'2026-01-01')");
  const add = (code, dept, role = 'employee', perms = null, scope = null) => Number(ins.run(code, 'NV ' + code, dept, role, code.toLowerCase(), perms, scope).lastInsertRowid);
  ADM = add('ADM', null, 'admin');
  QL = add('QL001', null, 'manager', JSON.stringify(['reports', 'employees']), JSON.stringify(['Thảo Điền']));
  QLX = add('QLX', null, 'manager', JSON.stringify(['reports', 'employees']));   // quản lý thường
  A1 = add('A1', 'Thảo Điền'); A2 = add('A2', 'Thảo Điền'); CON1 = add('C1', 'Thảo Điền - Bếp'); B1 = add('B1', 'Quận 4');
  const att = db.prepare('INSERT INTO attendance(employee_id, work_date, check_in_at, check_out_at, work_unit, work_minutes) VALUES (?,?,?,?,1,480)');
  for (const id of [A1, A2, CON1, B1]) att.run(id, WD, vn(WD, '08:00'), vn(WD, '17:00'));

  const app = express(); app.use(express.json());
  app.use('/api/admin', (await import('../server/routes/admin.js')).default);
  app.use('/api/reports', (await import('../server/routes/reports.js')).default);
  app.use('/api/auth', (await import('../server/routes/auth.js')).default);
  app.use((err, req, res, next) => { res.status(500).json({ error: 'LOI 500: ' + err.message }); });   // eslint-disable-line no-unused-vars
  server = await moCong(app);
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server?.close(); try { db.close(); } catch {} try { rmSync(dir, { recursive: true, force: true }); } catch {} });

const codes = (arr) => [...new Set(arr.map((x) => x.code))].filter(Boolean).sort();

test('Danh sách NV: chỉ NV bộ phận mình (gồm bộ phận con); quản lý thường + admin thấy hết', async () => {
  const r = await call(QL, 'GET', '/admin/employees');
  assert.equal(r.status, 200);
  assert.deepEqual(codes(r.body.rows), ['A1', 'A2', 'C1']);
  const x = await call(QLX, 'GET', '/admin/employees');
  assert.ok(codes(x.body.rows).includes('B1'));
  const a = await call(ADM, 'GET', '/admin/employees');
  assert.ok(codes(a.body.rows).includes('B1') && codes(a.body.rows).includes('A1'));
});

test('Danh sách bộ phận: chỉ bộ phận mình', async () => {
  const r = await call(QL, 'GET', '/admin/departments');
  assert.equal(r.status, 200);
  const names = r.body.rows.map((d) => d.name).sort();
  assert.ok(names.includes('Thảo Điền'));
  assert.ok(!names.includes('Quận 4'));
});

test('Tính công (grid): không lọc → cả bộ phận mình; chọn bộ phận khác / NV khác → không ra ai', async () => {
  const g = async (q) => (await call(QL, 'GET', `/admin/attendance/grid?from=${WD}&to=${WD}&mode=detail${q}`)).body;
  assert.deepEqual(codes((await g('')).rows), ['A1', 'A2', 'C1']);
  assert.deepEqual(codes((await g('&depts=' + encodeURIComponent('Quận 4'))).rows), []);
  assert.deepEqual(codes((await g(`&ids=${B1}`)).rows), []);
  assert.deepEqual(codes((await g(`&ids=${A1},${B1}`)).rows), ['A1']);
  assert.deepEqual(codes((await g('&depts=' + encodeURIComponent('Thảo Điền,Quận 4'))).rows), ['A1', 'A2', 'C1']);
  // admin vẫn thấy cả Quận 4
  const a = (await call(ADM, 'GET', `/admin/attendance/grid?from=${WD}&to=${WD}&mode=detail`)).body;
  assert.ok(codes(a.rows).includes('B1'));
});

test('Chấm công bất thường: chỉ NV bộ phận mình', async () => {
  db.prepare('UPDATE attendance SET late_min=15 WHERE work_date=?').run(WD);
  const r = await call(QL, 'GET', `/admin/abnormal?from=${WD}&to=${WD}&late=1`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const ids = new Set(JSON.stringify(r.body).match(/"id":\d+/g)?.map((x) => +x.slice(5)) || []);
  assert.ok(!ids.has(B1), 'không được thấy NV Quận 4');
  const a = await call(ADM, 'GET', `/admin/abnormal?from=${WD}&to=${WD}&late=1`);
  assert.equal(a.status, 200);
  db.prepare('UPDATE attendance SET late_min=0 WHERE work_date=?').run(WD);
});

test('Báo cáo: chỉ NV bộ phận mình', async () => {
  const r = await call(QL, 'GET', `/reports/data?type=detaillist&from=${WD}&to=${WD}&mode=shift`);
  assert.equal(r.status, 200);
  assert.deepEqual(codes(r.body.rows), ['A1', 'A2', 'C1']);
  const r2 = await call(QL, 'GET', `/reports/data?type=detaillist&from=${WD}&to=${WD}&mode=shift&depts=` + encodeURIComponent('Quận 4'));
  assert.deepEqual(codes(r2.body.rows || []), []);
});

test('Tổng quan: đếm theo bộ phận mình', async () => {
  const r = await call(QL, 'GET', `/reports/dashboard?date=${WD}`);
  assert.equal(r.status, 200);
  const a = await call(ADM, 'GET', `/reports/dashboard?date=${WD}`);
  assert.equal(r.body.totalEmp, 3);          // A1, A2, C1
  assert.equal(r.body.checkedIn, 3);
  assert.ok(a.body.totalEmp >= 4);
  const att = await call(QL, 'GET', `/reports/attendance?from=${WD}&to=${WD}`);
  assert.equal(att.status, 200);
  const rows = Array.isArray(att.body) ? att.body : (att.body.rows || []);
  assert.ok(rows.every((x) => x.employee_id == null || [A1, A2, CON1].includes(Number(x.employee_id))));
});

test('Chỉ xem: thêm / sửa / xoá đều 403; NV ngoài bộ phận theo employee_id → 403', async () => {
  for (const [m, p, b] of [
    ['POST', '/admin/employees', { code: 'N1', full_name: 'Mới' }],
    ['PUT', `/admin/employees/${A1}`, { full_name: 'Đổi' }],
    ['DELETE', `/admin/employees/${A1}`],
    ['POST', '/admin/departments', { name: 'Mới' }],
    ['POST', '/admin/attendance/punch', { employee_id: A1 }],
  ]) {
    const r = await call(QL, m, p, b);
    assert.equal(r.status, 403, `${m} ${p} phải bị chặn`);
  }
  assert.equal(db.prepare('SELECT full_name FROM employees WHERE id=?').get(A1).full_name, 'NV A1');
  const r = await call(QL, 'GET', `/reports/attendance?from=${WD}&to=${WD}&employee_id=${B1}`);
  assert.equal(r.status, 403);
  // chức năng không được mở (VD máy chấm công) → 403
  assert.equal((await call(QL, 'GET', '/admin/devices')).status, 403);
});

test('Quản lý thường không bị chặn ghi bởi phạm vi bộ phận', async () => {
  const r = await call(QLX, 'GET', `/admin/attendance/grid?from=${WD}&to=${WD}&mode=detail`);
  assert.ok(codes(r.body.rows).includes('B1'));
});

test('Lưu "Chỉ quản lý bộ phận": admin lưu dept_scope + ép vai trò quản lý; bỏ tích → null', async () => {
  const id = Number(db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash) VALUES ('QL002','QL 2','employee','ql002','x')").run().lastInsertRowid);
  const e = db.prepare('SELECT * FROM employees WHERE id=?').get(id);
  let r = await call(ADM, 'PUT', `/admin/employees/${id}`, { ...e, role: 'manager', permissions: ['reports'], dept_scope: ['Quận 4'] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  let row = db.prepare('SELECT role, dept_scope FROM employees WHERE id=?').get(id);
  assert.equal(row.role, 'manager');
  assert.deepEqual(JSON.parse(row.dept_scope), ['Quận 4']);
  const me = await call(id, 'GET', '/auth/me');
  assert.equal(me.status, 200);
  assert.deepEqual((me.body.user || me.body).dept_scope, ['Quận 4']);
  assert.deepEqual([...(me.body.user || me.body).permissions].sort(), ['attendance_edit', 'employees', 'reports']);   // quyền cố định, bỏ qua ô chọn quyền
  r = await call(ADM, 'PUT', `/admin/employees/${id}`, { ...e, role: 'manager', permissions: ['reports'], dept_scope: [] });
  assert.equal(r.status, 200);
  row = db.prepare('SELECT dept_scope FROM employees WHERE id=?').get(id);
  assert.equal(row.dept_scope, null);
});
