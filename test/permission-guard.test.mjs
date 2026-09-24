// Test chặn tự nâng quyền / vượt quyền (server/permission-guard.js).
// node --test chạy mỗi file test trong tiến trình RIÊNG → set DB_PATH tạm ở đây không đụng DB khác
// (permission-guard.js không đụng DB, nhưng nó import auth.js → auth.js import db.js sẽ mở CSDL).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-permguard-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let guardRoleAndPermissions, resolveImportRole, guardUpdateTarget;

before(async () => {
  ({ guardRoleAndPermissions, resolveImportRole, guardUpdateTarget } = await import('../server/permission-guard.js'));
});

const admin = { id: 1, role: 'admin' };
const master = { id: 0, role: 'master', master: true };
const manager = { id: 2, role: 'manager', permissions: JSON.stringify(['employees', 'reports']) };
const managerNoPerms = { id: 3, role: 'manager', permissions: JSON.stringify([]) };

// --- (e) admin và master: hành vi giữ nguyên hoàn toàn như cũ ---
test('admin có thể tạo/đổi người khác thành admin, không bị giới hạn quyền', () => {
  const r = guardRoleAndPermissions(admin, { role: 'admin', permissions: ['salary', 'backup'] });
  assert.equal(r.error, undefined);
  assert.equal(r.role, 'admin');
  assert.deepEqual(r.permissions, ['salary', 'backup']);
});

test('master có thể tạo/đổi người khác thành admin, không bị giới hạn quyền', () => {
  const r = guardRoleAndPermissions(master, { role: 'admin', permissions: ['salary', 'backup'] });
  assert.equal(r.error, undefined);
  assert.equal(r.role, 'admin');
  assert.deepEqual(r.permissions, ['salary', 'backup']);
});

// --- (a) chỉ admin/master mới được tạo/đổi ai đó thành admin ---
test('quản lý (manager) không được đổi người khác thành admin', () => {
  const r = guardRoleAndPermissions(manager, { role: 'admin', permissions: [] });
  assert.ok(r.error, 'phải trả lỗi');
  assert.equal(r.role, undefined);
});

test('nhập Excel: dòng ghi Admin bị hạ xuống employee khi người nhập không phải admin', () => {
  const r = resolveImportRole(manager, 'admin');
  assert.equal(r.role, 'employee');
  assert.equal(r.downgraded, true);
});

test('nhập Excel: admin nhập dòng ghi Admin thì giữ nguyên admin', () => {
  const r = resolveImportRole(admin, 'admin');
  assert.equal(r.role, 'admin');
  assert.equal(r.downgraded, undefined);
});

// --- (c) manager không được sửa tài khoản admin ---
test('quản lý không được sửa tài khoản admin (kể cả chỉ đổi mật khẩu/thông tin)', () => {
  const targetAdmin = { id: 99, role: 'admin' };
  const r = guardUpdateTarget(manager, targetAdmin, { password: '123456' });
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

test('admin vẫn sửa được tài khoản admin khác như cũ', () => {
  const targetAdmin = { id: 99, role: 'admin' };
  const r = guardUpdateTarget(admin, targetAdmin, { role: 'admin', permissions: [] });
  assert.equal(r.ok, true);
});

// --- (b) manager không được tự sửa role/permissions của chính mình ---
test('quản lý không được tự nâng vai trò hoặc quyền của chính mình', () => {
  const selfAsTarget = { id: 2, role: 'manager' };
  const r1 = guardUpdateTarget(manager, selfAsTarget, { role: 'admin' });
  assert.equal(r1.ok, false);
  const r2 = guardUpdateTarget(manager, selfAsTarget, { permissions: ['salary'] });
  assert.equal(r2.ok, false);
});

test('quản lý tự sửa thông tin khác của mình (không đụng role/permissions) vẫn được', () => {
  const selfAsTarget = { id: 2, role: 'manager' };
  const r = guardUpdateTarget(manager, selfAsTarget, { full_name: 'Tên mới', phone: '0900000000' });
  assert.equal(r.ok, true);
});

// --- (d) manager chỉ được cấp quyền mình đang có ---
test('quản lý chỉ cấp được cho người khác những quyền mình đang có', () => {
  const r = guardRoleAndPermissions(manager, { role: 'manager', permissions: ['employees', 'salary', 'backup'] });
  assert.equal(r.error, undefined);
  assert.deepEqual(r.permissions, ['employees']); // 'salary' và 'backup' bị lọc bỏ vì manager không có
});

test('quản lý không có quyền nào thì không cấp được quyền nào cho người khác', () => {
  const r = guardRoleAndPermissions(managerNoPerms, { role: 'employee', permissions: ['employees', 'reports'] });
  assert.equal(r.error, undefined);
  assert.deepEqual(r.permissions, []);
});
