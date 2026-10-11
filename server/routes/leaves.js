import { Router } from 'express';
import { db } from '../db.js';
import { authRequired, permRequired } from '../auth.js';
import { nowIso } from '../util.js';
import { LEAVE_TYPES, leaveBalance, overQuotaMsg, leaveSettings } from '../leave-quota.js';
import { PRIV_KINDS } from '../privilege.js';
const normHalf = (h, f, t) => (f === t && (h === 'sang' || h === 'chieu') ? h : '');

const r = Router();
r.use(authRequired);

// Nhân viên gửi đơn
r.post('/', (req, res) => {
  const { type, from_date, to_date, reason } = req.body || {};
  if (!type || !from_date || !to_date) return res.status(400).json({ error: 'Thiếu thông tin đơn' });
  if (to_date < from_date) return res.status(400).json({ error: 'Đến ngày phải sau từ ngày' });
  const half = normHalf(req.body?.half, from_date, to_date);
  // phép năm: không cho xin vượt số phép còn lại (trừ khi Cài đặt cho phép)
  const over = overQuotaMsg(req.user.id, { type, from_date, to_date, half });
  if (over && !leaveSettings().allowOver) return res.status(400).json({ error: over + ' Chọn "Nghỉ không lương" hoặc liên hệ quản lý.' });
  const info = db.prepare(
    `INSERT INTO leave_requests(employee_id, type, from_date, to_date, reason, half)
     VALUES (?,?,?,?,?,?)`
  ).run(req.user.id, type, from_date, to_date, reason || '', half);
  const row = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(info.lastInsertRowid);
  res.json({ ok: true, leave: row });
});

// Danh mục loại đơn
r.get('/types', (req, res) => res.json({ rows: LEAVE_TYPES }));
// Quỹ phép năm của tôi
r.get('/balance', (req, res) => {
  const y = parseInt(req.query.year, 10) || +new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 4);
  res.json(leaveBalance(req.user.id, y) || {});
});
// Quản lý: quỹ phép năm của mọi nhân viên
r.get('/balances', permRequired('leaves'), (req, res) => {
  const y = parseInt(req.query.year, 10) || +new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 4);
  const emps = db.prepare("SELECT id, code, full_name, department FROM employees WHERE active=1 AND role != 'admin' ORDER BY department, full_name").all();
  res.json({ year: y, settings: leaveSettings(), rows: emps.map((e) => ({ id: e.id, code: e.code, name: e.full_name, dept: e.department || '', ...leaveBalance(e.id, y) })) });
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
r.post('/admin', permRequired('leaves'), (req, res) => {
  const { type, from_date, to_date, reason } = req.body || {};
  const ids = [...new Set((Array.isArray(req.body?.employee_ids) ? req.body.employee_ids : []).map(Number).filter(Boolean))];
  if (!ids.length) return res.status(400).json({ error: 'Chưa chọn nhân viên' });
  if (!LEAVE_TYPES.some((x) => x.type === type)) return res.status(400).json({ error: 'Loại đơn không hợp lệ' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from_date || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to_date || '')) return res.status(400).json({ error: 'Chọn từ ngày / đến ngày' });
  if (to_date < from_date) return res.status(400).json({ error: 'Đến ngày phải sau từ ngày' });
  const half = normHalf(req.body?.half, from_date, to_date);
  const ok = db.prepare('SELECT id, full_name FROM employees WHERE id = ? AND active = 1');
  // phép năm vượt số còn lại → báo danh sách, quản lý xác nhận (force) mới lưu
  if (!req.body?.force) {
    const over = ids.map((id) => { const e = ok.get(id); const m = e && overQuotaMsg(id, { type, from_date, to_date, half }); return m ? `${e.full_name}: ${m}` : ''; }).filter(Boolean);
    if (over.length) return res.status(409).json({ error: 'Vượt số phép năm còn lại:\n' + over.slice(0, 15).join('\n') + (over.length > 15 ? `\n… và ${over.length - 15} người khác` : ''), canForce: true });
  }
  const ins = db.prepare(`INSERT INTO leave_requests(employee_id, type, from_date, to_date, reason, status, reviewed_by, reviewed_at, review_note, half)
    VALUES (?,?,?,?,?, 'approved', ?, ?, 'Quản lý thêm trực tiếp', ?)`);
  let n = 0;
  db.exec('BEGIN');
  try { for (const id of ids) if (ok.get(id)) { ins.run(id, type, from_date, to_date, String(reason || '').slice(0, 500), req.user.id || null, nowIso(), half); n++; } db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); throw e; }
  res.json({ ok: true, count: n });
});

// Quản lý xoá đơn bất kỳ (kể cả đã duyệt — VD nhập nhầm)
r.delete('/admin/:id', permRequired('leaves'), (req, res) => {
  const n = db.prepare('DELETE FROM leave_requests WHERE id = ?').run(req.params.id).changes;
  if (!n) return res.status(404).json({ error: 'Không tìm thấy đơn' });
  res.json({ ok: true });
});

/* ---------- CHẾ ĐỘ ƯU ĐÃI (thai sản, nuôi con nhỏ…): được đến muộn / về sớm, không trừ công ---------- */
const PRIV_SQL = `SELECT p.*, e.full_name, e.code, e.department FROM employee_privileges p JOIN employees e ON e.id = p.employee_id`;
function privBody(b) {
  const m = (v) => Math.max(0, Math.min(480, parseInt(v, 10) || 0));
  const out = {
    kind: PRIV_KINDS.includes(b.kind) ? b.kind : 'Khác',
    from_date: String(b.from_date || '').slice(0, 10), to_date: String(b.to_date || '').slice(0, 10),
    late_min: m(b.late_min), mid_out_min: m(b.mid_out_min), mid_in_min: m(b.mid_in_min), early_min: m(b.early_min),
    note: String(b.note || '').slice(0, 300),
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.from_date)) return { error: 'Chọn từ ngày' };
  if (out.to_date && !/^\d{4}-\d{2}-\d{2}$/.test(out.to_date)) return { error: 'Đến ngày không hợp lệ' };
  if (out.to_date && out.to_date < out.from_date) return { error: 'Đến ngày phải sau từ ngày' };
  if (!(out.late_min + out.mid_out_min + out.mid_in_min + out.early_min)) return { error: 'Nhập số phút được ưu đãi (ít nhất 1 ô)' };
  return out;
}
// Ưu đãi của tôi (app nhân viên)
r.get('/privileges/mine', (req, res) => {
  res.json({ rows: db.prepare('SELECT * FROM employee_privileges WHERE employee_id = ? ORDER BY from_date DESC').all(req.user.id) });
});
r.get('/privileges', permRequired('leaves'), (req, res) => {
  res.json({ rows: db.prepare(PRIV_SQL + ' ORDER BY p.from_date DESC, e.full_name').all(), kinds: PRIV_KINDS });
});
r.post('/privileges', permRequired('leaves'), (req, res) => {
  const ids = [...new Set((Array.isArray(req.body?.employee_ids) ? req.body.employee_ids : []).map(Number).filter(Boolean))];
  if (!ids.length) return res.status(400).json({ error: 'Chưa chọn nhân viên' });
  const b = privBody(req.body || {});
  if (b.error) return res.status(400).json({ error: b.error });
  const ok = db.prepare('SELECT 1 FROM employees WHERE id = ? AND active = 1');
  const ins = db.prepare(`INSERT INTO employee_privileges(employee_id, kind, from_date, to_date, late_min, mid_out_min, mid_in_min, early_min, note)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  let n = 0;
  db.exec('BEGIN');
  try { for (const id of ids) if (ok.get(id)) { ins.run(id, b.kind, b.from_date, b.to_date, b.late_min, b.mid_out_min, b.mid_in_min, b.early_min, b.note); n++; } db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); throw e; }
  res.json({ ok: true, count: n });
});
r.put('/privileges/:id', permRequired('leaves'), (req, res) => {
  const row = db.prepare('SELECT * FROM employee_privileges WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy' });
  const b = privBody(req.body || {});
  if (b.error) return res.status(400).json({ error: b.error });
  db.prepare(`UPDATE employee_privileges SET kind=?, from_date=?, to_date=?, late_min=?, mid_out_min=?, mid_in_min=?, early_min=?, note=? WHERE id=?`)
    .run(b.kind, b.from_date, b.to_date, b.late_min, b.mid_out_min, b.mid_in_min, b.early_min, b.note, row.id);
  // trả khoảng ngày CŨ để trang quản lý tính lại cả phần ngày vừa bỏ khỏi ưu đãi
  res.json({ ok: true, old: { from_date: row.from_date, to_date: row.to_date } });
});
r.delete('/privileges/:id', permRequired('leaves'), (req, res) => {
  const row = db.prepare('SELECT * FROM employee_privileges WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy' });
  db.prepare('DELETE FROM employee_privileges WHERE id = ?').run(row.id);
  res.json({ ok: true, row });
});

// Quản lý: duyệt / từ chối
r.post('/:id/review', permRequired('leaves'), (req, res) => {
  const { action, note } = req.body || {};
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'Hành động không hợp lệ' });
  const row = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy đơn' });
  if (action === 'approve' && !req.body?.force) {
    const over = overQuotaMsg(row.employee_id, row, row.id);
    if (over) return res.status(409).json({ error: over, canForce: true });
  }
  db.prepare(
    'UPDATE leave_requests SET status=?, reviewed_by=?, reviewed_at=?, review_note=? WHERE id=?'
  ).run(action === 'approve' ? 'approved' : 'rejected', req.user.id || null, nowIso(), note || '', row.id);
  res.json({ ok: true });
});

export default r;
