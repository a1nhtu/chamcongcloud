// Xác thực JWT + middleware phân quyền
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db, getSetting, setSetting } from './db.js';

function getSecret() {
  let s = getSetting('jwt_secret');
  if (!s) {
    s = 'digiplus_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    setSetting('jwt_secret', s);
  }
  return s;
}

export function hashPassword(pw) {
  return bcrypt.hashSync(pw, 10);
}

export function verifyPassword(pw, hash) {
  return bcrypt.compareSync(pw, hash);
}

export function signToken(employee) {
  return jwt.sign(
    { id: employee.id, code: employee.code, role: employee.role, name: employee.full_name },
    getSecret(),
    { expiresIn: '30d' }
  );
}

export function authRequired(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' });
  try {
    const payload = jwt.verify(token, getSecret());
    const emp = db.prepare('SELECT * FROM employees WHERE id = ? AND active = 1').get(payload.id);
    if (!emp) return res.status(401).json({ error: 'Tài khoản không hợp lệ' });
    req.user = emp;
    next();
  } catch {
    return res.status(401).json({ error: 'Phiên đăng nhập hết hạn' });
  }
}

export function roleRequired(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Không có quyền truy cập' });
    }
    next();
  };
}

/* ---------------- Phân quyền chi tiết theo chức năng ---------------- */
// Danh mục quyền (key + nhãn hiển thị). Dùng chung cho server & giao diện.
export const PERMISSIONS = [
  ['reports',     'Tổng quan & Báo cáo'],
  ['employees',   'Quản lý nhân viên'],
  ['shifts',      'Quản lý ca & lịch trình'],
  ['assignments', 'Phân ca'],
  ['shift_requests', 'Duyệt nhân viên chọn ca'],
  ['offices',     'Quản lý chi nhánh'],
  ['departments', 'Quản lý bộ phận'],
  ['leaves',          'Duyệt đơn từ'],
  ['attendance_edit', 'Sửa / thêm giờ chấm'],
  ['devices',         'Máy chấm công'],
  ['salary',          'Bảng lương'],
  ['holidays',        'Ngày lễ'],
  ['recompute',       'Tính lại công'],
  ['backup',          'Sao lưu & phục hồi'],
  ['settings',        'Cài đặt hệ thống'],
];
export const ALL_PERMS = PERMISSIONS.map(([k]) => k);
// Quyền mặc định của "Quản lý" khi chưa cấu hình riêng (không gồm lương, backup & cài đặt)
const MANAGER_DEFAULT = ['reports', 'employees', 'shifts', 'assignments', 'shift_requests', 'offices', 'departments', 'leaves', 'attendance_edit', 'devices', 'holidays', 'recompute'];

// Quyền hiệu lực của một nhân viên. admin = toàn quyền.
export function effectivePermissions(emp) {
  if (!emp) return [];
  if (emp.role === 'admin') return ALL_PERMS.slice();
  if (emp.permissions != null && emp.permissions !== '') {
    try { const p = JSON.parse(emp.permissions); if (Array.isArray(p)) return p.filter((k) => ALL_PERMS.includes(k)); } catch {}
  }
  return emp.role === 'manager' ? MANAGER_DEFAULT.slice() : [];
}

export function hasPerm(emp, key) {
  return emp?.role === 'admin' || effectivePermissions(emp).includes(key);
}

// Middleware: yêu cầu 1 quyền cụ thể (admin luôn qua).
export function permRequired(key) {
  return (req, res, next) => {
    if (hasPerm(req.user, key)) return next();
    return res.status(403).json({ error: 'Không có quyền dùng chức năng này' });
  };
}
