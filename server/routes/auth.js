import { Router } from 'express';
import { db } from '../db.js';
import { signToken, verifyPassword, hashPassword, authRequired, effectivePermissions, masterLogin, signMaster, masterUser } from '../auth.js';
import { logLogin } from '../audit.js';
import { loginBlocked, noteLoginFail, noteLoginOk } from '../login-guard.js';

const r = Router();

r.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Nhập tài khoản và mật khẩu' });
  // Chặn dò mật khẩu: sai nhiều lần trong 5 phút → tạm từ chối, KHÔNG kiểm mật khẩu (kể cả mật khẩu đúng)
  const wait = loginBlocked(req, username);
  if (wait) {
    res.setHeader('Retry-After', String(Math.ceil(wait / 1000)));
    return res.status(429).json({ error: `Nhập sai mật khẩu quá nhiều lần — thử lại sau ${Math.max(1, Math.ceil(wait / 60000))} phút` });
  }
  // Tài khoản tổng (Anh) — dùng chung mọi bản cài, không nằm trong DB
  if (masterLogin(username, password)) {
    noteLoginOk(req, username);
    const mu = masterUser(String(username).trim());
    logLogin(req, mu);
    return res.json({ token: signMaster(mu.username), user: publicUser(mu) });
  }
  const emp = db.prepare('SELECT * FROM employees WHERE username = ? AND active = 1').get(String(username).trim());
  if (!emp || !verifyPassword(password, emp.password_hash)) {
    noteLoginFail(req, username);
    return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu' });
  }
  noteLoginOk(req, username);
  const token = signToken(emp);
  if (emp.role === 'admin' || emp.role === 'manager') logLogin(req, emp);   // chỉ ghi đăng nhập quản trị
  res.json({ token, user: publicUser(emp) });
});

r.get('/me', authRequired, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

r.post('/change-password', authRequired, (req, res) => {
  if (req.user.master) return res.status(400).json({ error: 'Tài khoản tổng đổi mật khẩu trong file config.txt (MASTER_HASH), không đổi tại đây.' });
  const { oldPassword, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 4)
    return res.status(400).json({ error: 'Mật khẩu mới tối thiểu 4 ký tự' });
  if (!verifyPassword(oldPassword || '', req.user.password_hash))
    return res.status(400).json({ error: 'Mật khẩu cũ không đúng' });
  db.prepare('UPDATE employees SET password_hash = ?, pw_ver = IFNULL(pw_ver, 0) + 1 WHERE id = ?').run(hashPassword(newPassword), req.user.id);
  // phiên cũ (kể cả trên máy khác) hết hiệu lực; trả phiên mới để chính người vừa đổi không bị đăng xuất
  const me = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.user.id);
  res.json({ ok: true, token: signToken(me) });
});

export function publicUser(emp) {
  const office = emp.office_id ? db.prepare('SELECT id,name,lat,lng,radius_m,address FROM offices WHERE id = ?').get(emp.office_id) : null;
  const shift = emp.shift_id ? db.prepare('SELECT id,name,start_time,end_time,late_grace_min FROM shifts WHERE id = ?').get(emp.shift_id) : null;
  return {
    id: emp.id, code: emp.code, full_name: emp.full_name, audit_only: [1, 2, 3].includes(+emp.audit_only) ? +emp.audit_only : emp.audit_only ? 1 : 0,   // 1/2/3 = tài khoản kiểm tra xem công ảo mức đó
    department: emp.department, position: emp.position, phone: emp.phone,
    role: emp.role, username: emp.username, office, shift,
    permissions: effectivePermissions(emp),
  };
}

export default r;
