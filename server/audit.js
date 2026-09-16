// Ghi NHẬT KÝ THAO TÁC của admin/quản lý trên phần mềm.
// Middleware tự động ghi mọi thao tác thay đổi (POST/PUT/DELETE/PATCH) trên router admin.
import { db } from './db.js';

const clientIp = (req) =>
  (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim();

// Nhãn tiếng Việt cho từng route (KEY = 'METHOD /route/:pattern').
const LABELS = {
  'POST /employees': 'Thêm nhân viên',
  'PUT /employees/:id': 'Sửa nhân viên',
  'DELETE /employees/:id': 'Khoá nhân viên',
  'DELETE /employees/:id/purge': 'Xóa vĩnh viễn nhân viên',
  'POST /employees/:id/approve-device': 'Duyệt đổi thiết bị nhân viên',
  'POST /employees/:id/reset-device': 'Đặt lại thiết bị nhân viên',
  'POST /schedules': 'Thêm lịch trình ca',
  'PUT /schedules/:id': 'Sửa lịch trình ca',
  'DELETE /schedules/:id': 'Xóa lịch trình ca',
  'POST /departments': 'Thêm bộ phận',
  'PUT /departments/:id': 'Sửa bộ phận',
  'DELETE /departments/:id': 'Xóa bộ phận',
  'POST /positions': 'Thêm chức danh',
  'DELETE /positions/:id': 'Xóa chức danh',
  'POST /offices': 'Thêm chi nhánh',
  'PUT /offices/:id': 'Sửa chi nhánh',
  'DELETE /offices/:id': 'Xóa chi nhánh',
  'POST /offices/:id/employees': 'Gán nhân viên vào chi nhánh',
  'POST /shifts': 'Thêm ca làm',
  'PUT /shifts/:id': 'Sửa ca làm',
  'DELETE /shifts/:id': 'Xóa ca làm',
  'PUT /settings': 'Đổi cài đặt hệ thống',
  'POST /branding': 'Đổi logo / thương hiệu',
  'POST /update/apply': 'Cập nhật phần mềm',
  'PUT /salary/:empId': 'Sửa cấu hình lương',
  'POST /holidays': 'Thêm ngày lễ',
  'DELETE /holidays/:id': 'Xóa ngày lễ',
  'POST /assignments': 'Phân ca (theo ngày)',
  'POST /assignments/bulk': 'Phân ca hàng loạt',
  'POST /assignments/import': 'Nhập phân ca từ Excel',
  'POST /shift-assignments': 'Thêm phân ca theo khoảng',
  'DELETE /shift-assignments/:id': 'Xóa phân ca theo khoảng',
  'POST /shift-assignments/delete': 'Xóa phân ca theo khoảng',
  'POST /recompute': 'Tính lại công',
  'POST /attendance': 'Thêm giờ chấm (tay)',
  'PUT /attendance/:id': 'Sửa giờ chấm',
  'DELETE /attendance/:id': 'Xóa giờ chấm',
  'POST /attendance/clear-range': 'Xóa giờ chấm theo khoảng',
  'PUT /backup/config': 'Đổi cấu hình sao lưu',
  'POST /backup/now': 'Tạo bản sao lưu',
  'DELETE /backup': 'Xóa bản sao lưu',
  'POST /backup/restore': 'Phục hồi dữ liệu',
  'POST /backup/full': 'Sao lưu toàn bộ',
  'POST /backup/full-restore': 'Phục hồi toàn bộ',
  'POST /devices/resync': 'Đồng bộ máy chấm công',
  'PUT /devices/:id': 'Sửa máy chấm công',
  'POST /devices/:id/open-door': 'Mở cửa từ xa',
  'DELETE /devices/:id': 'Xóa máy chấm công khỏi danh sách',
  'POST /devices/rebuild': 'Dựng lại ngày công từ máy',
  'POST /devices/import-usb': 'Nhập dữ liệu chấm công từ USB',
  'POST /devices/:id/query-users': 'Tải nhân viên từ máy',
  'POST /devices/:id/query-attlog': 'Tải lại log chấm công từ máy',
  'POST /devices/:id/clear-log': 'Xóa log chấm công trên máy',
  'POST /devices/:id/clear-admins': 'Xóa quyền admin trên máy',
  'POST /devices/:id/clear-all': 'Xóa TOÀN BỘ dữ liệu trên máy',
  'POST /devices/:id/delete-users': 'Xóa nhân viên trên máy',
};

// Không ghi các thao tác nhiễu (đăng ký nhận thông báo trình duyệt).
const SKIP = [/^\/push\//];

function labelFor(req) {
  const key = req.method + ' ' + (req.route?.path || req.path || '');
  if (LABELS[key]) return LABELS[key];
  const seg = (req.path || '').split('/').filter(Boolean)[0] || '';
  const verb = { POST: 'Thêm/Tạo', PUT: 'Cập nhật', PATCH: 'Cập nhật', DELETE: 'Xóa' }[req.method] || req.method;
  return `${verb} ${seg}`.trim();
}

// Tóm tắt tham số (bỏ mật khẩu, dữ liệu lớn base64...), cắt ngắn.
function summarize(req) {
  const drop = /pass|hash|logo|license|photo|tmp|content|base64|buf|file|token|subscription|endpoint|p256dh|\bauth\b/i;
  const out = {};
  if (req.params && Object.keys(req.params).length) out.id = req.params.id || req.params.empId || Object.values(req.params)[0];
  const b = req.body;
  if (b && typeof b === 'object' && !Buffer.isBuffer(b) && !Array.isArray(b)) {
    const f = {};
    for (const [k, v] of Object.entries(b)) {
      if (drop.test(k) || v == null || v === '') continue;
      let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      if (s.length > 80) s = s.slice(0, 80) + '…';
      f[k] = s;
    }
    if (Object.keys(f).length) out.data = f;
  }
  let s = '';
  try { s = JSON.stringify(out); } catch {}
  return s.length > 500 ? s.slice(0, 500) + '…' : s;
}

const stmt = () => db.prepare(`INSERT INTO audit_logs
  (user_id, username, user_name, role, action, method, path, detail, status, ip)
  VALUES (?,?,?,?,?,?,?,?,?,?)`);

// Middleware: gắn vào router admin SAU authRequired. Ghi khi request hoàn tất & thành công.
export function auditMiddleware(req, res, next) {
  const m = req.method;
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return next();
  const p = req.path || '';
  if (SKIP.some((re) => re.test(p))) return next();
  res.on('finish', () => {
    try {
      if (res.statusCode >= 400) return;               // thao tác lỗi → không ghi là đã làm
      const u = req.user || {};
      stmt().run(
        (u.id ?? null), u.username || '', u.full_name || '', u.role || '',
        labelFor(req), m, (req.baseUrl || '') + p, summarize(req), res.statusCode, clientIp(req)
      );
    } catch { /* không để việc ghi log làm hỏng request */ }
  });
  next();
}

// Ghi riêng sự kiện đăng nhập (login nằm ở router auth, không qua middleware admin).
export function logLogin(req, user) {
  try {
    stmt().run(
      (user.id ?? null), user.username || '', user.full_name || '', user.role || '',
      'Đăng nhập', 'POST', '/api/auth/login', '', 200, clientIp(req)
    );
  } catch {}
}
