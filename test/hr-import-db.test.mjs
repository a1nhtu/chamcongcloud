// Test NHẬP EXCEL phân hệ Nhân sự trên CSDL tạm: gọi thẳng route /hr/import/* với file .xlsx dựng bằng ExcelJS.
// Hồ sơ: thêm mới (tạo NV + hồ sơ) / cập nhật (ô trống giữ nguyên). Hợp đồng: kiểm luật từng dòng, tự nối "tái ký",
// trùng số HĐ / NV chưa có → bỏ qua, cập nhật theo số HĐ.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import ExcelJS from 'exceljs';

const DBP = join(tmpdir(), `dgp-hr-import-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, loadContracts;
const routes = {};
const MASTER = { id: 0, master: true, role: 'master', full_name: 'Tài khoản tổng' };
before(async () => {
  const D = await import('../server/db.js');
  db = D.db; D.initSchema();
  ({ loadContracts } = await import('../server/hr.js'));
  const { registerHrImportRoutes } = await import('../server/routes/admin/hr-import.js');
  const add = (m) => (p, ...h) => { routes[`${m} ${p}`] = h[h.length - 1]; };
  registerHrImportRoutes({ get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE') }, { need: () => (q, s, n) => n() });
});

function call(path, body, user = MASTER) {
  return new Promise((resolve, reject) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(o) { resolve({ status: this.statusCode, ...o }); }, setHeader() {}, end() { resolve({ status: this.statusCode }); } };
    Promise.resolve(routes[`POST ${path}`]({ body, user, params: {}, query: {} }, res)).catch(reject);
  });
}
async function xlsx(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('x');
  for (const r of rows) ws.addRow(r);
  return 'data:application/octet-stream;base64,' + Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
}
function addEmp(code, extra = {}) {
  return Number(db.prepare(`INSERT INTO employees (code, full_name, department, position, role, username, password_hash, active) VALUES (?, ?, ?, ?, ?, ?, 'x', 1)`)
    .run(code, 'NV ' + code, extra.department || 'Sản xuất', extra.position || 'Công nhân', extra.role || 'employee', code.toLowerCase()).lastInsertRowid);
}
const prof = (id) => db.prepare('SELECT * FROM hr_profiles WHERE employee_id = ?').get(id) || {};

test('hồ sơ — Thêm mới: tạo nhân viên + hồ sơ, mã đã có thì bỏ qua, ô sai thì bỏ ô đó và báo', async () => {
  addEmp('OLD1');
  const file = await xlsx([
    ['Mã NV *', 'Họ tên', 'Bộ phận', 'Giới tính', 'Ngày sinh', 'Số CCCD / CMND', 'Trình độ'],
    ['NEW1', 'Trần Thị Bình', 'Kế toán', 'nữ', '20/05/1995', 11950123456, 'Đại học'],
    ['NEW2', 'Lê Văn An', '', 'Nam', '31/02/1990', '', 'Kỹ sư'],
    ['OLD1', 'Ai đó', '', '', '', '', ''],
    ['', '', '', '', '', '', ''],
  ]);
  const r = await call('/hr/import/profiles', { mode: 'add', fileBase64: file });
  assert.equal(r.status, 200);
  assert.equal(r.added, 2);
  assert.equal(r.skipped, 1);
  const e = db.prepare("SELECT * FROM employees WHERE code = 'NEW1'").get();
  assert.equal(e.full_name, 'Trần Thị Bình');
  assert.equal(e.department, 'Kế toán');
  assert.equal(e.username, 'NEW1');
  assert.equal(e.active, 1);
  assert.ok(db.prepare("SELECT 1 FROM departments WHERE name = 'Kế toán'").get(), 'bộ phận mới tự tạo');
  const p = prof(e.id);
  assert.equal(p.gender, 'Nữ');
  assert.equal(p.birth_date, '1995-05-20');
  assert.equal(p.id_number, '011950123456');
  assert.equal(p.education_level, 'Đại học');
  const p2 = prof(db.prepare("SELECT id FROM employees WHERE code = 'NEW2'").get().id);
  assert.equal(p2.birth_date, '');
  assert.equal(p2.education_level, '');
  assert.ok(r.messages.some((m) => m.row === 3 && /Ngày sinh/.test(m.msg)));
  assert.ok(r.messages.some((m) => m.row === 3 && /Trình độ/.test(m.msg)));
  assert.ok(r.messages.some((m) => m.row === 4 && m.type === 'err'));
});

test('hồ sơ — Cập nhật: ô trống giữ nguyên, quản lý theo mã NV, bộ phận KHÔNG đổi (đổi qua Thuyên chuyển); Thêm mới cần quyền Nhân viên', async () => {
  const id = addEmp('UP1'), boss = addEmp('BOSS');
  db.prepare("INSERT INTO hr_profiles (employee_id, gender, tax_code) VALUES (?, 'Nam', '111')").run(id);
  const file = await xlsx([['Ghi chú: file nhân sự'], ['Mã NV', 'Mã số thuế cá nhân', 'Giới tính', 'Quản lý trực tiếp (mã NV)', 'Bộ phận', 'Ngày vào làm'],
    ['up1', '8123456789', '', 'BOSS', 'Kho', '01/03/2026'], ['KHONGCO', '1', '', '', '', '']]);
  const r = await call('/hr/import/profiles', { mode: 'update', fileBase64: file });
  assert.equal(r.updated, 1);
  assert.equal(r.skipped, 1);
  const p = prof(id);
  assert.equal(p.tax_code, '8123456789');
  assert.equal(p.gender, 'Nam');
  assert.equal(p.manager_id, String(boss));
  const e = db.prepare('SELECT department, start_date FROM employees WHERE id = ?').get(id);
  assert.equal(e.department, 'Sản xuất');
  assert.equal(e.start_date, '2026-03-01');
  // quản lý chỉ có quyền Nhân sự → không được tạo NV mới; cũng không sửa được hồ sơ Admin
  const hrOnly = { id: 99, role: 'manager', permissions: '["hr"]', full_name: 'HR' };
  assert.equal((await call('/hr/import/profiles', { mode: 'add', fileBase64: file }, hrOnly)).status, 403);
  addEmp('ADM1', { role: 'admin' });
  const r2 = await call('/hr/import/profiles', { mode: 'update', fileBase64: await xlsx([['Mã NV *', 'Dân tộc'], ['ADM1', 'Kinh']]) }, hrOnly);
  assert.equal(r2.updated, 0);
  assert.ok(/Admin/.test(r2.messages[0].msg));
});

test('hợp đồng — Thêm mới: kiểm luật từng dòng, tự nối tái ký, trùng số HĐ / NV chưa có bỏ qua', async () => {
  const id = addEmp('HD1', { department: 'Kế toán', position: 'Kế toán viên' });
  addEmp('HD2');
  const file = await xlsx([
    ['Mã NV *', 'Số HĐ', 'Loại HĐ *', 'Ngày ký', 'Hiệu lực từ *', 'Đến ngày', 'Thời hạn (tháng)', 'Lương thoả thuận'],
    ['HD1', 'X/2026', 'Xác định thời hạn', '28/04/2026', '30/04/2026', '', 12, '9.000.000'],   // xếp sau HĐ thử việc dù đứng trước
    ['HD1', 'TV/2026', 'Thử việc', '27/02/2026', '01/03/2026', '29/04/2026', '', 7650000],
    ['HD2', 'Y/2026', 'Xác định thời hạn', '', '01/01/2026', '', 48, 5000000],              // 48 tháng → sai luật
    ['HD2', 'TV/2026', 'Thử việc', '', '01/01/2026', '15/01/2026', '', 5000000],            // trùng số HĐ
    ['KHONGCO', 'Z/2026', 'Thử việc', '', '01/01/2026', '15/01/2026', '', 0],
    ['HD2', 'W/2026', 'Hợp đồng gì đó', '', '01/01/2026', '', '', 0],
  ]);
  const r = await call('/hr/import/contracts', { mode: 'add', fileBase64: file });
  assert.equal(r.added, 2);
  assert.equal(r.linked, 1);
  assert.equal(r.skipped, 4);
  const tv = db.prepare("SELECT * FROM hr_contracts WHERE contract_no = 'TV/2026'").get();
  const x = db.prepare("SELECT * FROM hr_contracts WHERE contract_no = 'X/2026'").get();
  assert.equal(tv.employee_id, id);
  assert.equal(x.parent_id, tv.id);                         // nối tái ký
  assert.equal(x.end_date, '2027-04-29');                    // 12 tháng tự tính
  assert.equal(x.salary, 9000000);
  assert.equal(x.department, 'Kế toán');                     // để trống → lấy bộ phận hiện tại
  assert.equal(loadContracts([id]).find((c) => c.id === tv.id).status, 'da_tai_ky');
  assert.ok(r.messages.some((m) => m.row === 4 && /36 tháng/.test(m.msg)));
  assert.ok(r.messages.some((m) => m.row === 5 && /đã có/.test(m.msg)));
  assert.ok(r.messages.some((m) => m.row === 6 && /chưa có/.test(m.msg)));
  assert.ok(r.messages.some((m) => m.row === 7 && /Loại HĐ/.test(m.msg)));
  assert.equal(db.prepare("SELECT probation_date FROM hr_profiles WHERE employee_id = ?").get(id).probation_date, '2026-03-01');
});

test('hợp đồng — Cập nhật theo số HĐ: ô trống giữ nguyên, đổi số tháng thì tính lại ngày hết hạn, HĐ của người khác bỏ qua', async () => {
  const file = await xlsx([['Mã NV *', 'Số HĐ', 'Thời hạn (tháng)', 'Lương thoả thuận', 'Phụ cấp'],
    ['HD1', 'X/2026', 24, '', 'Ăn trưa'], ['HD2', 'X/2026', '', 1, ''], ['HD1', 'KHONG/CO', '', 1, '']]);
  const r = await call('/hr/import/contracts', { mode: 'update', fileBase64: file });
  assert.equal(r.updated, 1);
  assert.equal(r.skipped, 2);
  const x = db.prepare("SELECT * FROM hr_contracts WHERE contract_no = 'X/2026'").get();
  assert.equal(x.term_months, 24);
  assert.equal(x.end_date, '2028-04-29');
  assert.equal(x.salary, 9000000);
  assert.equal(x.allowance, 'Ăn trưa');
  assert.ok(x.parent_id, 'giữ liên kết tái ký');
});

test('file không đúng: thiếu cột Mã NV / không phải Excel → báo lỗi rõ', async () => {
  const r1 = await call('/hr/import/contracts', { mode: 'add', fileBase64: await xlsx([['Tên', 'Tuổi'], ['A', 1]]) });
  assert.equal(r1.status, 400);
  assert.match(r1.error, /Mã NV/);
  const r2 = await call('/hr/import/profiles', { mode: 'update', fileBase64: 'data:x;base64,' + Buffer.from('abc').toString('base64') });
  assert.equal(r2.status, 400);
  assert.match(r2.error, /Excel/);
});
