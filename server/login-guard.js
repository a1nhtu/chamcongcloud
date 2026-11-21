// CHẶN DÒ MẬT KHẨU ĐĂNG NHẬP (/api/auth/login) — Anh duyệt 21/11/2026.
// - Cùng 1 IP sai 10 lần với CÙNG 1 tài khoản trong 5 phút → tài khoản đó tạm bị từ chối từ IP đó tới hết 5 phút.
//   (đếm theo IP + tài khoản: nhân viên khác cùng mạng văn phòng không bị khoá lây)
// - Cùng 1 IP sai TỔNG 30 lần (mọi tài khoản) trong 5 phút → IP đó tạm bị từ chối mọi đăng nhập tới hết 5 phút
//   (chặn kiểu thử 1 mật khẩu dễ cho nhiều tài khoản).
// - Đăng nhập đúng xoá số lần sai của (IP, tài khoản) đó. Máy chủ nhiều công ty: đếm riêng từng công ty.
// - Chỉ giữ trong RAM (khởi động lại = đếm lại từ đầu), không ghi CSDL.
import { tenantKey } from './tenant.js';

export const WINDOW_MS = 5 * 60000;
export const MAX_PER_USER = 10;
export const MAX_PER_IP = 30;
const fails = new Map();   // khoá → { n, since }

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
// IP người đăng nhập. Qua Cloudflare Tunnel, cloudflared nối vào từ 127.0.0.1 → IP thật ở CF-Connecting-IP / X-Forwarded-For.
// Kết nối thẳng (LAN, IP:cổng) thì lấy IP của kết nối, KHÔNG tin header (tránh giả header để né chặn).
export function loginIp(req) {
  const sock = String(req.socket?.remoteAddress || '');
  if (LOOPBACK.has(sock)) {
    const h = String(req.headers?.['cf-connecting-ip'] || req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    if (h) return h;
  }
  return sock || '?';
}

function scope() { try { return tenantKey(); } catch { return ''; } }
const keysOf = (req, username) => {
  const base = scope() + '|' + loginIp(req);
  return { user: base + '|u|' + String(username || '').trim().toLowerCase(), ip: base + '|ip' };
};
function live(key, now) {
  const f = fails.get(key);
  if (!f) return null;
  if (now - f.since >= WINDOW_MS) { fails.delete(key); return null; }
  return f;
}

// Còn bị chặn? Trả số mili-giây phải chờ (0 = được thử đăng nhập).
export function loginBlocked(req, username, now = Date.now()) {
  const k = keysOf(req, username);
  let wait = 0;
  for (const [key, max] of [[k.user, MAX_PER_USER], [k.ip, MAX_PER_IP]]) {
    const f = live(key, now);
    if (f && f.n >= max) wait = Math.max(wait, f.since + WINDOW_MS - now);
  }
  return wait;
}

export function noteLoginFail(req, username, now = Date.now()) {
  const k = keysOf(req, username);
  for (const key of [k.user, k.ip]) {
    const f = live(key, now);
    if (f) f.n++; else fails.set(key, { n: 1, since: now });
  }
  if (fails.size > 5000) {   // dọn bản ghi đã hết hạn; vẫn quá nhiều thì xoá hết (không để RAM phình)
    for (const [key, f] of fails) if (now - f.since >= WINDOW_MS) fails.delete(key);
    if (fails.size > 5000) fails.clear();
  }
}

export function noteLoginOk(req, username) {
  fails.delete(keysOf(req, username).user);
}

export function resetLoginGuard() { fails.clear(); }   // cho test
