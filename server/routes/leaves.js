import { Router } from 'express';
import { db } from '../db.js';
import { authRequired, permRequired, inspectorGuard } from '../auth.js';
import { nowIso } from '../util.js';
import { LEAVE_TYPES, leaveTypes, customLeaveTypes, leaveBalance, overQuotaMsg, leaveSettings } from '../leave-quota.js';
import { PRIV_KINDS } from '../privilege.js';
const normHalf = (h, f, t) => (f === t && (h === 'sang' || h === 'chieu') ? h : '');

const r = Router();
r.use(authRequired);
r.use(inspectorGuard([/^\/$/, /^\/types$/, /^\/balances$/, /^\/privileges$/]));   // tài khoản kiểm tra: chỉ xem

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
r.get('/types', (req, res) => res.json({ rows: leaveTypes() }));

/* ---------- LÝ DO NGHỈ TỰ KHAI BÁO: tên + ký hiệu bảng công + có lương / trừ phép năm ---------- */
function typeBody(b, selfId = 0) {
  const name = String(b.name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  const sym = String(b.sym || '').trim().toUpperCase().slice(0, 4);
  if (!name) return { error: 'Nhập tên lý do nghỉ' };
  if (!/^[A-ZĐ0-9]{1,4}$/.test(sym)) return { error: 'Ký hiệu gồm 1–4 chữ / số, viết liền (VD: NO, VR, H1)' };
  const low = name.toLowerCase();
  if (LEAVE_TYPES.some((x) => x.type.toLowerCase() === low)) return { error: `"${name}" là loại có sẵn, đặt tên khác` };
  const others = customLeaveTypes(true).filter((x) => x.id !== selfId);
  if (others.some((x) => x.type.toLowerCase() === low)) return { error: `Đã có lý do nghỉ "${name}"` };
  const usedSym = [...LEAVE_TYPES, ...others.filter((x) => x.active)].find((x) => x.sym === sym) || (['X', 'V', 'L', 'O', 'T', 'NN'].includes(sym) ? { type: 'ký hiệu chấm công' } : null);
  if (usedSym) return { error: `Ký hiệu "${sym}" đang dùng cho "${usedSym.type}", chọn ký hiệu khác` };
  return { name, sym, paid: b.paid ? 1 : 0, quota: b.quota ? 1 : 0 };
}
r.get('/types/all', permRequired('leaves'), (req, res) => {
  const used = new Map(db.prepare('SELECT type, COUNT(*) c FROM leave_requests GROUP BY type').all().map((x) => [x.type, x.c]));
  res.json({ builtin: LEAVE_TYPES, custom: customLeaveTypes(true).map((x) => ({ ...x, used: used.get(x.type) || 0 })) });
});
r.post('/types', permRequired('leaves'), (req, res) => {
  const b = typeBody(req.body || {});
  if (b.error) return res.status(400).json({ error: b.error });
  const id = db.prepare('INSERT INTO leave_types(name, sym, paid, quota) VALUES (?,?,?,?)').run(b.name, b.sym, b.paid, b.quota).lastInsertRowid;
  res.json({ ok: true, id });
});
r.put('/types/:id', permRequired('leaves'), (req, res) => {
  const row = db.prepare('SELECT * FROM leave_types WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy lý do nghỉ' });
  const b = typeBody(req.body || {}, row.id);
  if (b.error) return res.status(400).json({ error: b.error });
  const active = req.body.active == null ? row.active : (req.body.active ? 1 : 0);
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE leave_types SET name=?, sym=?, paid=?, quota=?, active=? WHERE id=?').run(b.name, b.sym, b.paid, b.quota, active, row.id);
    if (b.name !== row.name) db.prepare('UPDATE leave_requests SET type=? WHERE type=?').run(b.name, row.name);   // đổi tên → đơn cũ đổi theo
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  res.json({ ok: true });
});
// Xoá: lý do đã có đơn dùng thì chỉ ẨN (đơn cũ vẫn giữ ký hiệu / có lương như đã khai)
r.delete('/types/:id', permRequired('leaves'), (req, res) => {
  const row = db.prepare('SELECT * FROM leave_types WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy lý do nghỉ' });
  const used = db.prepare('SELECT COUNT(*) c FROM leave_requests WHERE type=?').get(row.name).c;
  if (used) db.prepare('UPDATE leave_types SET active=0 WHERE id=?').run(row.id);
  else db.prepare('DELETE FROM leave_types WHERE id=?').run(row.id);
  res.json({ ok: true, hidden: used > 0, used });
});
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
  if (!leaveTypes().some((x) => x.type === type)) return res.status(400).json({ error: 'Loại đơn không hợp lệ' });
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
  const row = db.prepare('SELECT swap_id FROM leave_requests WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy đơn' });
  if (row.swap_id) return res.status(400).json({ error: 'Đơn "Nghỉ bù" này sinh từ Đăng ký làm bù — vào menu Đăng ký làm bù để xoá.' });
  db.prepare('DELETE FROM leave_requests WHERE id = ?').run(req.params.id);
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
