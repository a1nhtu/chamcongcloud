// Test 2 lỗ hổng "thiếu kiểm tra quyền chi tiết" ở route chỉ đọc (BAO-CAO-RA-SOAT.md mục 4, 5):
// - GET /admin/employees: không thể chặn bằng need('employees') vì Tổng quan/Báo cáo/Tính công
//   cũng gọi route này để đổ dropdown NV mà không có quyền "employees" → phải bớt trường nhạy cảm
//   (filterEmployeeFields, server/permission-guard.js) thay vì chặn cả route.
// - GET /admin/assignments, /shift-assignments, /assignments/export.xlsx: không màn nào khác cần
//   gọi khi thiếu quyền "assignments" → chặn thẳng bằng need('assignments') (kiểm tra tĩnh mã nguồn
//   vì cần dựng cả app Express + DB thật mới gọi HTTP được, ngoài phạm vi test đơn vị hiện có).
// node --test chạy mỗi file test trong tiến trình RIÊNG → set DB_PATH tạm ở đây không đụng DB khác
// (permission-guard.js import auth.js → auth.js import db.js sẽ mở CSDL).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { rmSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DBP = join(tmpdir(), `dgp-routeperm-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

const __dirname = dirname(fileURLToPath(import.meta.url));

let filterEmployeeFields;

before(async () => {
  ({ filterEmployeeFields } = await import('../server/permission-guard.js'));
});

const admin = { id: 1, role: 'admin' };
const master = { id: 0, role: 'master', master: true };
const managerWithEmployees = { id: 2, role: 'manager', permissions: JSON.stringify(['employees', 'reports']) };
const managerNoEmployees = { id: 3, role: 'manager', permissions: JSON.stringify(['reports', 'attendance_edit']) };
const managerDefault = { id: 4, role: 'manager' }; // chưa cấu hình permissions riêng → dùng MANAGER_DEFAULT (đã có 'employees')

const sampleRows = () => [
  { id: 10, code: 'NV001', full_name: 'Nguyễn Văn A', department: 'Kinh doanh', role: 'employee',
    active: 1, username: 'nv001', permissions: '[]', device_pin: '123', device_id: 'dev-abc',
    pending_device: '', device_label: '' },
];

test('GET /admin/employees — admin: không bớt trường nào (giữ nguyên hành vi cũ)', () => {
  const rows = filterEmployeeFields(admin, sampleRows());
  assert.equal(rows[0].username, 'nv001');
  assert.equal(rows[0].device_pin, '123');
  assert.equal(rows[0].device_id, 'dev-abc');
});

test('GET /admin/employees — tài khoản tổng (master): không bớt trường nào', () => {
  const rows = filterEmployeeFields(master, sampleRows());
  assert.equal(rows[0].username, 'nv001');
  assert.equal(rows[0].permissions, '[]');
});

test('GET /admin/employees — quản lý CÓ quyền "employees": không bớt trường nào', () => {
  const rows = filterEmployeeFields(managerWithEmployees, sampleRows());
  assert.equal(rows[0].username, 'nv001');
  assert.equal(rows[0].device_id, 'dev-abc');
});

test('GET /admin/employees — quản lý mặc định (chưa cấu hình quyền riêng) vẫn có "employees" theo MANAGER_DEFAULT', () => {
  const rows = filterEmployeeFields(managerDefault, sampleRows());
  assert.equal(rows[0].username, 'nv001');
});

test('GET /admin/employees — quản lý BỊ THU HỒI quyền "employees": bớt username/permissions/device_pin/device_id, vẫn giữ id/mã/tên/bộ phận để đổ dropdown', () => {
  const rows = filterEmployeeFields(managerNoEmployees, sampleRows());
  const e = rows[0];
  assert.equal(e.username, undefined);
  assert.equal(e.permissions, undefined);
  assert.equal(e.device_pin, undefined);
  assert.equal(e.device_id, undefined);
  assert.equal(e.pending_device, undefined);
  assert.equal(e.device_label, undefined);
  // Vẫn còn đủ để Tổng quan/Báo cáo/Tính công đổ dropdown/bộ lọc NV
  assert.equal(e.id, 10);
  assert.equal(e.code, 'NV001');
  assert.equal(e.full_name, 'Nguyễn Văn A');
  assert.equal(e.department, 'Kinh doanh');
  assert.equal(e.role, 'employee');
  assert.equal(e.active, 1);
});

// --- Kiểm tra tĩnh mã nguồn: 3 route đọc phân ca phải có need('assignments') ---
// (Không dựng app Express + DB thật để gọi HTTP trong phạm vi test đơn vị này — xem ghi chú đầu file.)
test('GET /admin/assignments, /shift-assignments, /assignments/export.xlsx đều có need(\'assignments\')', () => {
  const src = readFileSync(join(__dirname, '../server/routes/admin/assignments.js'), 'utf8');
  assert.match(src, /r\.get\('\/assignments',\s*need\('assignments'\)/, 'GET /assignments phải có need(\'assignments\')');
  assert.match(src, /r\.get\('\/shift-assignments',\s*need\('assignments'\)/, 'GET /shift-assignments phải có need(\'assignments\')');
  assert.match(src, /r\.get\('\/assignments\/export\.xlsx',\s*need\('assignments'\)/, 'GET /assignments/export.xlsx phải có need(\'assignments\')');
});

test('GET /admin/employees KHÔNG chặn bằng need(\'employees\') (để không vỡ Tổng quan/Báo cáo/Tính công) mà dùng filterEmployeeFields', () => {
  const src = readFileSync(join(__dirname, '../server/routes/admin/employees.js'), 'utf8');
  assert.doesNotMatch(src, /r\.get\('\/employees',\s*need\('employees'\)/, 'GET /employees không được gọi need(\'employees\') trực tiếp');
  assert.match(src, /filterEmployeeFields\(req\.user, rows\)/);
});
