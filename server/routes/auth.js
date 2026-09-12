import { Router } from 'express';
import { db } from '../db.js';
import { signToken, verifyPassword, hashPassword, authRequired, effectivePermissions, masterLogin, signMaster, masterUser } from '../auth.js';

const r = Router();

r.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Nhập tài khoản và mật khẩu' });
  // Tài khoản tổng (Anh) — dùng chung mọi bản cài, không nằm trong DB
  if (masterLogin(username, password)) {
    const mu = masterUser(String(username).trim());
    return res.json({ token: signMaster(mu.username), user: publicUser(mu) });
  }
  const emp = db.prepare('SELECT * FROM employees WHERE username = ? AND active = 1').get(String(username).trim());
  if (!emp || !verifyPassword(password, emp.password_hash)) {
    return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu' });
  }
  const token = signToken(emp);
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
  db.prepare('UPDATE employees SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), req.user.id);
  res.json({ ok: true });
});

export function publicUser(emp) {
  const office = emp.office_id ? db.prepare('SELECT id,name,lat,lng,radius_m,address FROM offices WHERE id = ?').get(emp.office_id) : null;
  const shift = emp.shift_id ? db.prepare('SELECT id,name,start_time,end_time,late_grace_min FROM shifts WHERE id = ?').get(emp.shift_id) : null;
  return {
    id: emp.id, code: emp.code, full_name: emp.full_name,
    department: emp.department, position: emp.position, phone: emp.phone,
    role: emp.role, username: emp.username, office, shift,
    permissions: effectivePermissions(emp),
  };
}

export default r;
