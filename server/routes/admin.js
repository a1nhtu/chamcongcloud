// Router QUẢN TRỊ — chỉ lắp ráp: middleware chung + đăng ký các nhóm route con trong ./admin/*.js.
// Mỗi nhóm là registerXxxRoutes(r, {need[, adminOnly]}) — dùng chung router r (đã gắn auth + audit).
import { Router } from 'express';
import { authRequired, roleRequired, permRequired, inspectorGuard } from '../auth.js';
import { auditMiddleware } from '../audit.js';
import { registerEmployeeRoutes } from './admin/employees.js';
import { registerOrgRoutes } from './admin/org.js';
import { registerSettingsRoutes } from './admin/settings.js';
import { registerPayrollRoutes } from './admin/payroll.js';
import { registerAssignmentRoutes } from './admin/assignments.js';
import { registerAttendanceRoutes } from './admin/attendance.js';
import { registerBackupRoutes } from './admin/backup.js';
import { registerDeviceRoutes } from './admin/devices.js';
import { registerPushRoutes } from './admin/push.js';
import { registerLogRoutes } from './admin/logs.js';
import { registerAuditLimitRoutes } from './admin/audit-limits.js';
import { registerOtRegRoutes } from './admin/ot-reg.js';

const r = Router();
r.use(authRequired, roleRequired('admin', 'manager'));
// tài khoản kiểm tra: chỉ xem danh mục + lưới Tính công / bảng lương (đều ép công ảo)
r.use(inspectorGuard([/^\/settings$/, /^\/departments$/, /^\/positions$/, /^\/offices$/, /^\/shifts$/, /^\/schedules$/, /^\/inout-schedules$/,
  /^\/employees$/, /^\/shift-assignments$/, /^\/dept-shift-assignments$/, /^\/assignments$/, /^\/attendance\/grid$/, /^\/payroll$/,
  /^\/salary$/, /^\/holidays$/, /^\/perm-catalog$/]));
r.use(auditMiddleware);   // ghi nhật ký mọi thao tác thay đổi (POST/PUT/DELETE) của admin/quản lý

const adminOnly = roleRequired('admin');
const need = (key) => permRequired(key); // yêu cầu quyền chi tiết (admin luôn qua)

registerEmployeeRoutes(r, { need });     // nhân viên + phân quyền + khoá thiết bị
registerOrgRoutes(r, { need });          // lịch trình, bộ phận, chức danh, chi nhánh, ca
registerSettingsRoutes(r, { need, adminOnly }); // cài đặt, logo, cập nhật phần mềm
registerPayrollRoutes(r, { need });      // lương, bảng lương, ngày lễ
registerAssignmentRoutes(r, { need });   // phân ca (ngày/khoảng/Excel)
registerAttendanceRoutes(r, { need });   // tính lại công, lưới, sửa giờ, xoá khoảng
registerBackupRoutes(r, { need });       // sao lưu / phục hồi
registerDeviceRoutes(r, { need });       // máy chấm công
registerPushRoutes(r);                   // thông báo đẩy
registerLogRoutes(r, { need, adminOnly });          // nhật ký thao tác
registerAuditLimitRoutes(r, { need });   // công ảo: tăng ca tối đa / ngày 3 mức
registerOtRegRoutes(r, { need });        // đăng ký làm thêm + chấm công bất thường

export default r;
