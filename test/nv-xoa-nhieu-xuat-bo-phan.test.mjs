// Trang Nhân viên: tích chọn nhiều NV để XÓA HẲN 1 lần + Xuất Excel theo bộ phận đang chọn (gồm bộ phận con). Chạy: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import ExcelJS from 'exceljs';

const DBP = join(tmpdir(), `dgp-nv-xoa-nhieu-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, BACKUP_DIR;
const routes = {};
const ADMIN = { id: 999999, role: 'admin', full_name: 'Admin' };
const call = async (key, body = {}, user = ADMIN) => {
  let out = null, code = 200;
  const res = { status(c) { code = c; return this; }, json(o) { out = o; return this; } };
  await routes[key]({ body, params: {}, query: {}, user }, res);
  return { code, out };
};
const ids = {};
const addEmp = (code, dept, role = 'employee') => {
  const r = db.prepare('INSERT INTO employees(code, full_name, department, role, username, password_hash) VALUES(?,?,?,?,?,?)')
    .run(code, 'NV ' + code, dept, role, code.toLowerCase(), 'x');
  ids[code] = Number(r.lastInsertRowid);
  return ids[code];
};
const exists = (code) => !!db.prepare('SELECT 1 FROM employees WHERE code=?').get(code);
// Gọi route xuất Excel với res giả (stream) rồi đọc lại file: trả danh sách Mã NV + tên file
const exportXlsx = async (query) => {
  const res = new PassThrough(); const chunks = []; const headers = {};
  res.setHeader = (k, v) => { headers[k.toLowerCase()] = v; };
  res.on('data', (c) => chunks.push(c));
  const ended = new Promise((ok) => res.on('end', ok));
  await routes['GET /employees/export.xlsx']({ query, params: {}, body: {}, user: ADMIN }, res);
  await ended;
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.concat(chunks));
  const codes = []; wb.worksheets[0].eachRow((row, i) => { if (i > 1) codes.push(String(row.getCell(1).value)); });
  return { codes: codes.sort(), file: headers['content-disposition'] || '' };
};

before(async () => {
  const D = await import('../server/db.js');
  db = D.db; D.initSchema();
  BACKUP_DIR = (await import('../server/backup.js')).backupDir();
  const add = (m) => (p, ...h) => { routes[`${m} ${p}`] = h[h.length - 1]; };
  const R = { get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE') };
  (await import('../server/routes/admin/employees.js')).registerEmployeeRoutes(R, { need: () => (q, s, n) => n() });
  // Cây bộ phận: Sản xuất ⊃ Tổ May 1 ⊃ Chuyền A; Văn phòng riêng
  const dep = (name, parent) => Number(db.prepare('INSERT INTO departments(name, parent_id) VALUES(?,?)').run(name, parent).lastInsertRowid);
  const sx = dep('Sản xuất', null), tm = dep('Tổ May 1', sx); dep('Chuyền A', tm); dep('Văn phòng', null);
  addEmp('SX1', 'Sản xuất'); addEmp('TM1', 'Tổ May 1'); addEmp('CA1', 'Chuyền A'); addEmp('VP1', 'Văn phòng');
  addEmp('NB1', '');
  db.prepare("INSERT INTO employees(code, full_name, department, role, username, password_hash) VALUES('NB2','NV NB2',NULL,'employee','nb2','x')").run();
});

test('xuất Excel cả công ty (không chọn bộ phận) = mọi NV', async () => {
  const { codes, file } = await exportXlsx({});
  const all = db.prepare('SELECT code FROM employees').all().map((r) => String(r.code)).sort();
  assert.deepEqual(codes, all);
  assert.match(file, /filename="danh_sach_nhan_vien_\d{4}-\d{2}-\d{2}\.xlsx"/);
});

test('xuất Excel theo bộ phận CHA: gồm mọi cấp con, tên file có tên bộ phận bỏ dấu', async () => {
  const { codes, file } = await exportXlsx({ dept: 'Sản xuất' });
  assert.deepEqual(codes, ['CA1', 'SX1', 'TM1']);
  assert.match(file, /filename="danh_sach_nhan_vien_San_xuat_\d{4}-\d{2}-\d{2}\.xlsx"/);
  assert.deepEqual((await exportXlsx({ dept: 'Tổ May 1' })).codes, ['CA1', 'TM1']);
  assert.deepEqual((await exportXlsx({ dept: 'Văn phòng' })).codes, ['VP1']);
});

test('xuất Excel "Chưa có bộ phận": NV bộ phận trống hoặc NULL', async () => {
  const { codes, file } = await exportXlsx({ dept: '__none__' });
  assert.deepEqual(codes, ['NB1', 'NB2']);
  assert.match(file, /danh_sach_nhan_vien_chua_co_bo_phan_/);
});

test('xoá nhiều: chưa chọn ai → báo lỗi', async () => {
  const { code, out } = await call('POST /employees/purge-bulk', { ids: [] });
  assert.equal(code, 400);
  assert.match(out.error, /Chưa chọn/);
});

test('xoá nhiều: NV có làm bù + đã DUYỆT đơn của người khác vẫn xoá được, đơn người kia giữ lại', async () => {
  const a = addEmp('XA1', 'Văn phòng'), b = addEmp('XB1', 'Văn phòng'), keep = addEmp('GIU1', 'Văn phòng');
  db.prepare("INSERT INTO swap_days(employee_id, work_date, off_date) VALUES(?, '2026-10-04', '2026-10-06')").run(a);
  const lr = Number(db.prepare("INSERT INTO leave_requests(employee_id, type, from_date, to_date, status, reviewed_by) VALUES(?, 'Nghỉ phép', '2026-10-10', '2026-10-10', 'approved', ?)").run(keep, a).lastInsertRowid);
  const sr = Number(db.prepare("INSERT INTO shift_requests(employee_id, work_date, is_off, status, reviewed_by) VALUES(?, '2026-10-11', 1, 'approved', ?)").run(keep, b).lastInsertRowid);
  db.prepare("INSERT INTO attendance(employee_id, work_date) VALUES(?, '2026-10-01')").run(b);
  const { code, out } = await call('POST /employees/purge-bulk', { ids: [a, b, 'rác', -3] });
  assert.equal(code, 200, JSON.stringify(out));
  assert.equal(out.deleted, 2);
  assert.ok(!exists('XA1') && !exists('XB1') && exists('GIU1'));
  assert.equal(db.prepare('SELECT COUNT(*) c FROM swap_days WHERE employee_id=?').get(a).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM attendance WHERE employee_id=?').get(b).c, 0);
  const l = db.prepare('SELECT status, reviewed_by FROM leave_requests WHERE id=?').get(lr);
  assert.equal(l.status, 'approved'); assert.equal(l.reviewed_by, null);
  assert.equal(db.prepare('SELECT reviewed_by FROM shift_requests WHERE id=?').get(sr).reviewed_by, null);
  // xoá từ 2 người → có bản sao lưu trước khi xoá (dọn ngay để không lẫn vào thư mục sao lưu thật)
  assert.match(out.backup, /_predelete\.db$/);
  const bp = join(BACKUP_DIR, out.backup);
  assert.ok(existsSync(bp));
  rmSync(bp);
});

test('xoá nhiều: bỏ qua tài khoản đang đăng nhập; quản lý không xoá được Admin', async () => {
  const boss = addEmp('AD9', 'Văn phòng', 'admin');
  const mgr = addEmp('QL9', 'Văn phòng', 'manager');
  const nv = addEmp('NV9', 'Văn phòng');
  const manager = { id: mgr, role: 'manager', permissions: JSON.stringify(['employees']) };
  const { code, out } = await call('POST /employees/purge-bulk', { ids: [boss, mgr, nv] }, manager);
  assert.equal(code, 200);
  assert.equal(out.deleted, 1);
  assert.equal(out.self, true);
  assert.equal(out.admins, 1);
  assert.ok(exists('AD9') && exists('QL9') && !exists('NV9'));
  if (out.backup) rmSync(join(BACKUP_DIR, out.backup), { force: true });
  // admin thì xoá được admin khác; xoá 1 người → không tạo bản sao lưu
  const r2 = await call('POST /employees/purge-bulk', { ids: [boss] });
  assert.equal(r2.out.deleted, 1);
  assert.equal(r2.out.backup, '');
  assert.ok(!exists('AD9'));
});

test('xoá 1 NV (nút 🗑 từng dòng) cũng không vướng khoá ngoại làm bù / người duyệt', async () => {
  const a = addEmp('XC1', 'Văn phòng'), keep = ids.GIU1;
  db.prepare("INSERT INTO swap_days(employee_id, work_date, off_date) VALUES(?, '2026-10-18', '2026-10-20')").run(a);
  db.prepare("INSERT INTO leave_requests(employee_id, type, from_date, to_date, status, reviewed_by) VALUES(?, 'Nghỉ phép', '2026-10-12', '2026-10-12', 'approved', ?)").run(keep, a);
  let out = null, code = 200;
  const res = { status(c) { code = c; return this; }, json(o) { out = o; return this; } };
  await routes['DELETE /employees/:id/purge']({ params: { id: String(a) }, body: {}, query: {}, user: ADMIN }, res);
  assert.equal(code, 200, JSON.stringify(out));
  assert.ok(!exists('XC1'));
});
