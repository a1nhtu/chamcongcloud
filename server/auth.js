// Xác thực JWT + middleware phân quyền
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { db, getSetting, setSetting } from './db.js';

// So sánh 2 chuỗi kiểu hằng thời gian (không lộ số ký tự trùng đầu chuỗi qua thời gian
// phản hồi). Giữ nguyên ngữ nghĩa của `===`: khác kiểu (không phải chuỗi) → luôn false.
// Luôn so 2 buffer cùng độ dài (pad chuỗi ngắn hơn) để bản thân phép so cũng không lộ
// chênh lệch độ dài qua thời gian, rồi đối lại độ dài thật để tránh false positive.
function timingSafeStringEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  const len = Math.max(bufA.length, bufB.length, 1);
  const padA = Buffer.alloc(len);
  const padB = Buffer.alloc(len);
  bufA.copy(padA);
  bufB.copy(padB);
  return timingSafeEqual(padA, padB) && bufA.length === bufB.length;
}

function getSecret() {
  let s = getSetting('jwt_secret');
  if (!s) {
    s = randomBytes(32).toString('hex');
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

/* ---------------- TÀI KHOẢN TỔNG (master) — dùng chung mọi bản cài ----------------
   Nhúng cứng trong code → LUÔN đăng nhập được ở mọi bản cài, không cần cấu hình.
   Mật khẩu là chuỗi NGẪU NHIÊN CỰC MẠNH (hash bcrypt công khai vẫn không dò ra được).
   Có thể ghi đè riêng cho 1 bản cài bằng biến môi trường trong config.txt:
     MASTER_USER=... , MASTER_HASH=<bcrypt>  (hoặc MASTER_PASS=<mật khẩu thô>).      */
const DEFAULT_MASTER_USER = 'sadmin';
const DEFAULT_MASTER_HASH = '$2a$10$6B/WPDau/884M7n0w0U6d.ag1yWwGQUC0ShlwTjfSyG9Eqzy.MKyO';
export function masterUsername() { return (process.env.MASTER_USER || DEFAULT_MASTER_USER).trim(); }
export function masterLogin(username, password) {
  const u = masterUsername();
  if (!u || String(username || '').trim() !== u) return false;
  const plain = process.env.MASTER_PASS;
  if (plain != null && plain !== '') return timingSafeStringEqual(password, plain);
  const hash = (process.env.MASTER_HASH || DEFAULT_MASTER_HASH).trim();
  try { return bcrypt.compareSync(password || '', hash); } catch { return false; }
}
export function signMaster(username) {
  return jwt.sign({ master: true, role: 'master', name: username }, getSecret(), { expiresIn: '30d' });
}
// Đối tượng user đại diện cho tài khoản tổng (không có trong DB)
export function masterUser(username) {
  return { id: 0, code: 'master', full_name: 'Tài khoản tổng', role: 'master', master: true, username: username || masterUsername() || 'master' };
}

export function authRequired(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' });
  try {
    const payload = jwt.verify(token, getSecret());
    if (payload.master) {           // tài khoản tổng — không tra DB
      req.user = masterUser(payload.name);
      return next();
    }
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
    if (req.user?.master) return next();     // tài khoản tổng qua mọi cửa
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
  ['door_open',       'Mở cửa từ xa (kiểm soát cửa)'],
  ['salary',          'Bảng lương'],
  ['holidays',        'Ngày lễ'],
  ['recompute',       'Tính lại công'],
  ['backup',          'Sao lưu & phục hồi'],
  ['logs',            'Nhật ký thao tác'],
  ['settings',        'Cài đặt hệ thống'],
];
export const ALL_PERMS = PERMISSIONS.map(([k]) => k);
// Quyền mặc định của "Quản lý" khi chưa cấu hình riêng (không gồm lương, backup & cài đặt)
const MANAGER_DEFAULT = ['reports', 'employees', 'shifts', 'assignments', 'shift_requests', 'offices', 'departments', 'leaves', 'attendance_edit', 'devices', 'holidays', 'recompute'];

// Quyền hiệu lực của một nhân viên. admin = toàn quyền.
export function effectivePermissions(emp) {
  if (!emp) return [];
  if (emp.master || emp.role === 'admin') return ALL_PERMS.slice();
  if (emp.permissions != null && emp.permissions !== '') {
    try { const p = JSON.parse(emp.permissions); if (Array.isArray(p)) return p.filter((k) => ALL_PERMS.includes(k)); } catch {}
  }
  return emp.role === 'manager' ? MANAGER_DEFAULT.slice() : [];
}

export function hasPerm(emp, key) {
  return emp?.master || emp?.role === 'admin' || effectivePermissions(emp).includes(key);
}

// Middleware: yêu cầu 1 quyền cụ thể (admin luôn qua).
export function permRequired(key) {
  return (req, res, next) => {
    if (hasPerm(req.user, key)) return next();
    return res.status(403).json({ error: 'Không có quyền dùng chức năng này' });
  };
}
