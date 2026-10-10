// Ghi NHẬT KÝ THAO TÁC của admin/quản lý trên phần mềm.
// Middleware tự động ghi mọi thao tác thay đổi (POST/PUT/DELETE/PATCH) trên router admin.
import { db } from './db.js';
import { describeAction } from './audit-describe.js';

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
  'POST /assignments/bulk': 'Lịch trình tạm thời',
  'POST /assignments/cells': 'Sửa bảng phân ca (Excel)',
  'POST /assignments/clear': 'Xóa lịch theo ngày',
  'POST /dept-shift-assignments': 'Gán ca cho phòng ban',
  'POST /dept-shift-assignments/delete': 'Xóa gán ca phòng ban',
  'POST /inout-schedules': 'Thêm lịch trình vào ra',
  'PUT /inout-schedules/:id': 'Sửa lịch trình vào ra',
  'DELETE /inout-schedules/:id': 'Xóa lịch trình vào ra',
  'POST /shifts/:id/clear-merge-rule': 'Bỏ cách ghép giờ riêng của ca',
  'POST /employees/import': 'Nhập nhân viên từ Excel',
  'POST /employees/att-mode': 'Đổi kiểu chấm công nhân viên',
  'POST /assignments/import': 'Nhập phân ca từ Excel',
  'POST /shift-assignments': 'Gán ca cho nhân viên',
  'DELETE /shift-assignments/:id': 'Xóa gán ca nhân viên',
  'POST /shift-assignments/delete': 'Xóa gán ca nhân viên',
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
  // Ghi dạng chữ "nhãn: giá trị · …" (không ghi mã JSON) cho thao tác chưa có câu mô tả riêng
  const KEY_VI = { id: 'Mã', name: 'Tên', code: 'Mã', full_name: 'Họ tên', department: 'Bộ phận', from: 'Từ ngày', to: 'Đến ngày',
    from_date: 'Từ ngày', to_date: 'Đến ngày', date: 'Ngày', work_date: 'Ngày', ids: 'Các mục', employee_ids: 'Nhân viên', employee_id: 'Nhân viên',
    shift_id: 'Ca', mode: 'Kiểu', note: 'Ghi chú', serial: 'Số máy', month: 'Tháng', active: 'Đang dùng', value: 'Giá trị' };
  const parts = [];
  if (out.id != null) parts.push(`Mã: ${out.id}`);
  for (const [k, v] of Object.entries(out.data || {})) {
    const val = v === 'true' ? 'Có' : v === 'false' ? 'Không' : /^\[.*\]$/.test(v) ? (() => { try { const a = JSON.parse(v); return Array.isArray(a) ? a.length + ' mục' : v; } catch { return v; } })() : v;
    parts.push(`${KEY_VI[k] || k}: ${val}`);
  }
  const s = parts.join(' · ');
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
  // Câu mô tả tiếng Việt tính TRƯỚC khi thao tác chạy (thao tác xoá vẫn còn đọc được tên thứ bị xoá)
  let desc = null;
  try { desc = describeAction(req); } catch {}
  res.on('finish', () => {
    try {
      if (res.statusCode >= 400) return;               // thao tác lỗi → không ghi là đã làm
      const u = req.user || {};
      stmt().run(
        (u.id ?? null), u.username || '', u.full_name || '', u.role || '',
        labelFor(req), m, (req.baseUrl || '') + p, desc != null ? desc : summarize(req), res.statusCode, clientIp(req)
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
