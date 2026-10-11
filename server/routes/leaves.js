import { Router } from 'express';
import { db } from '../db.js';
import { authRequired, permRequired } from '../auth.js';
import { nowIso } from '../util.js';

const r = Router();
r.use(authRequired);

// Nhân viên gửi đơn
r.post('/', (req, res) => {
  const { type, from_date, to_date, reason } = req.body || {};
  if (!type || !from_date || !to_date) return res.status(400).json({ error: 'Thiếu thông tin đơn' });
  if (to_date < from_date) return res.status(400).json({ error: 'Đến ngày phải sau từ ngày' });
  const info = db.prepare(
    `INSERT INTO leave_requests(employee_id, type, from_date, to_date, reason)
     VALUES (?,?,?,?,?)`
  ).run(req.user.id, type, from_date, to_date, reason || '');
  const row = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(info.lastInsertRowid);
  res.json({ ok: true, leave: row });
});

// Đơn của tôi
r.get('/mine', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM leave_requests WHERE employee_id = ? ORDER BY created_at DESC'
  ).all(req.user.id);
  res.json({ rows });
});

r.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(req.params.id);
  if (!row || row.employee_id !== req.user.id) return res.status(404).json({ error: 'Không tìm thấy đơn' });
  if (row.status !== 'pending') return res.status(400).json({ error: 'Đơn đã xử lý, không thể xoá' });
  db.prepare('DELETE FROM leave_requests WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

// Quản lý: danh sách đơn (?status=pending)
r.get('/', permRequired('leaves'), (req, res) => {
  const { status } = req.query;
  const base = `SELECT l.*, e.full_name, e.code, e.department
               FROM leave_requests l JOIN employees e ON e.id = l.employee_id`;
  const rows = status
    ? db.prepare(base + ' WHERE l.status = ? ORDER BY l.created_at DESC').all(status)
    : db.prepare(base + ' ORDER BY l.created_at DESC').all();
  res.json({ rows });
});

// Quản lý THÊM ĐƠN TRỰC TIẾP cho 1 hoặc nhiều nhân viên → đã duyệt luôn (không cần duyệt)
const LEAVE_TYPES = ['Nghỉ phép', 'Nghỉ không lương', 'Công tác', 'Khác'];
r.post('/admin', permRequired('leaves'), (req, res) => {
  const { type, from_date, to_date, reason } = req.body || {};
  const ids = [...new Set((Array.isArray(req.body?.employee_ids) ? req.body.employee_ids : []).map(Number).filter(Boolean))];
  if (!ids.length) return res.status(400).json({ error: 'Chưa chọn nhân viên' });
  if (!LEAVE_TYPES.includes(type)) return res.status(400).json({ error: 'Loại đơn không hợp lệ' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from_date || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to_date || '')) return res.status(400).json({ error: 'Chọn từ ngày / đến ngày' });
  if (to_date < from_date) return res.status(400).json({ error: 'Đến ngày phải sau từ ngày' });
  const ins = db.prepare(`INSERT INTO leave_requests(employee_id, type, from_date, to_date, reason, status, reviewed_by, reviewed_at, review_note)
    VALUES (?,?,?,?,?, 'approved', ?, ?, 'Quản lý thêm trực tiếp')`);
  const ok = db.prepare('SELECT 1 FROM employees WHERE id = ? AND active = 1');
  let n = 0;
  db.exec('BEGIN');
  try { for (const id of ids) if (ok.get(id)) { ins.run(id, type, from_date, to_date, String(reason || '').slice(0, 500), req.user.id || null, nowIso()); n++; } db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); throw e; }
  res.json({ ok: true, count: n });
});

// Quản lý xoá đơn bất kỳ (kể cả đã duyệt — VD nhập nhầm)
r.delete('/admin/:id', permRequired('leaves'), (req, res) => {
  const n = db.prepare('DELETE FROM leave_requests WHERE id = ?').run(req.params.id).changes;
  if (!n) return res.status(404).json({ error: 'Không tìm thấy đơn' });
  res.json({ ok: true });
});

// Quản lý: duyệt / từ chối
r.post('/:id/review', permRequired('leaves'), (req, res) => {
  const { action, note } = req.body || {};
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'Hành động không hợp lệ' });
  const row = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy đơn' });
  db.prepare(
    'UPDATE leave_requests SET status=?, reviewed_by=?, reviewed_at=?, review_note=? WHERE id=?'
  ).run(action === 'approve' ? 'approved' : 'rejected', req.user.id, nowIso(), note || '', row.id);
  res.json({ ok: true });
});

export default r;
