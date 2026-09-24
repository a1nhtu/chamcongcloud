// Chặn tự nâng quyền / vượt quyền khi tạo, nhập Excel hoặc sửa nhân viên.
// Hàm thuần (không đụng DB) để dễ viết test — gọi từ server/routes/admin/employees.js.
import { effectivePermissions, hasPerm } from './auth.js';

function isSuperUser(caller) {
  return !!(caller && (caller.master || caller.role === 'admin'));
}

// Dùng cho POST /employees và PUT /employees/:id.
// - Không phải admin/master thì không được đặt role='admin'.
// - Không phải admin/master thì chỉ được cấp những quyền mình đang có (effectivePermissions).
// admin/master: giữ nguyên hành vi cũ, không giới hạn gì.
export function guardRoleAndPermissions(caller, { role, permissions }) {
  if (isSuperUser(caller)) return { role, permissions };
  if (role === 'admin') {
    return { error: 'Bạn không có quyền cấp vai trò Admin cho người khác' };
  }
  const perms = Array.isArray(permissions)
    ? permissions.filter((k) => effectivePermissions(caller).includes(k))
    : permissions;
  return { role, permissions: perms };
}

// Dùng khi nhập Excel: không chặn cả file, chỉ hạ vai trò dòng đó xuống 'employee'
// nếu người nhập không phải admin/master mà file ghi Admin.
export function resolveImportRole(caller, role) {
  if (isSuperUser(caller) || role !== 'admin') return { role };
  return { role: 'employee', downgraded: true };
}

// Dùng cho PUT /employees/:id (và dòng "update" khi nhập Excel).
// - Không phải admin/master thì không được sửa tài khoản đang có role 'admin'.
// - Không phải admin/master thì không được tự sửa role/permissions của chính mình.
export function guardUpdateTarget(caller, targetEmp, body) {
  if (isSuperUser(caller)) return { ok: true };
  if (targetEmp.role === 'admin') {
    return { ok: false, error: 'Bạn không có quyền sửa tài khoản Admin' };
  }
  const isSelf = caller?.id != null && Number(caller.id) === Number(targetEmp.id);
  if (isSelf && (body.role !== undefined || body.permissions !== undefined)) {
    return { ok: false, error: 'Bạn không thể tự sửa vai trò hoặc phân quyền của chính mình' };
  }
  return { ok: true };
}

// Các trường "khoá thiết bị chấm công" + tài khoản/quyền — chỉ ai có quyền "employees" mới được xem
// qua GET /employees. Dùng cho GET /employees vì route này còn được các màn KHÔNG có quyền "employees"
// gọi để đổ dropdown/bộ lọc NV (Tổng quan, Báo cáo, Tính công) — không thể chặn cả route bằng need('employees')
// vì sẽ làm vỡ các màn đó, nên chỉ bớt trường nhạy cảm thay vì chặn hẳn.
const EMP_SENSITIVE_FIELDS = ['username', 'permissions', 'device_pin', 'device_id', 'pending_device', 'device_label'];

export function filterEmployeeFields(caller, rows) {
  if (hasPerm(caller, 'employees')) return rows;
  for (const row of rows) {
    for (const f of EMP_SENSITIVE_FIELDS) delete row[f];
  }
  return rows;
}
