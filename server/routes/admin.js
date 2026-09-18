// Router QUẢN TRỊ — chỉ lắp ráp: middleware chung + đăng ký các nhóm route con trong ./admin/*.js.
// Mỗi nhóm là registerXxxRoutes(r, {need[, adminOnly]}) — dùng chung router r (đã gắn auth + audit).
import { Router } from 'express';
import { authRequired, roleRequired, permRequired } from '../auth.js';
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

const r = Router();
r.use(authRequired, roleRequired('admin', 'manager'));
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
registerLogRoutes(r, { need });          // nhật ký thao tác

export default r;
