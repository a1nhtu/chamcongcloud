// Nhân viên tự đăng ký ca làm việc → tự áp dụng hoặc chờ admin/quản lý duyệt.
// Bật/tắt bằng setting self_shift_enabled; cần duyệt hay không bằng self_shift_approve.
import { Router } from 'express';
import { db, getSetting } from '../db.js';
import { authRequired, permRequired } from '../auth.js';
import { nowIso } from '../util.js';

const r = Router();
r.use(authRequired);

const enabled = () => getSetting('self_shift_enabled', '0') === '1';
const needApprove = () => getSetting('self_shift_approve', '1') === '1';
const isShiftMode = () => getSetting('attendance_mode', 'shift') !== 'hourly';

// Áp một đăng ký đã duyệt vào bảng phân ca theo ngày.
// Xin nghỉ → xoá hết ca của ngày rồi đặt nghỉ. Đăng ký ca → CỘNG THÊM ca (cho phép nhiều ca gãy/ngày).
function applyToAssignment(employeeId, workDate, shiftId, isOff) {
  if (isOff) {
    db.prepare('DELETE FROM daily_shift_assignments WHERE employee_id=? AND work_date=?').run(employeeId, workDate);
    db.prepare('INSERT INTO daily_shift_assignments(employee_id, work_date, shift_id, is_off) VALUES (?,?,NULL,1)').run(employeeId, workDate);
    return;
  }
  db.prepare('DELETE FROM daily_shift_assignments WHERE employee_id=? AND work_date=? AND is_off=1').run(employeeId, workDate); // bỏ "xin nghỉ" nếu có
  if (!db.prepare('SELECT 1 FROM daily_shift_assignments WHERE employee_id=? AND work_date=? AND COALESCE(shift_id,0)=?').get(employeeId, workDate, shiftId || 0))
    db.prepare('INSERT INTO daily_shift_assignments(employee_id, work_date, shift_id, is_off) VALUES (?,?,?,0)').run(employeeId, workDate, shiftId);
}

/* ---------------- Phía nhân viên ---------------- */

// Danh sách ca đang hoạt động để nhân viên chọn
r.get('/shifts', (req, res) => {
  if (!enabled() || !isShiftMode()) return res.json({ enabled: false, shifts: [] });
  const shifts = db.prepare('SELECT id, name, start_time, end_time FROM shifts WHERE active = 1 ORDER BY start_time, name').all();
  res.json({ enabled: true, needApprove: needApprove(), shifts });
});

// Đăng ký ca cho một ngày
r.post('/', (req, res) => {
  if (!enabled() || !isShiftMode()) return res.status(403).json({ error: 'Chức năng tự chọn ca đang tắt' });
  const b = req.body || {};
  const workDate = String(b.work_date || '').slice(0, 10);
  const isOff = b.is_off ? 1 : 0;
  const shiftId = isOff ? null : (+b.shift_id || null);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return res.status(400).json({ error: 'Thiếu ngày hợp lệ' });
  if (!isOff && !shiftId) return res.status(400).json({ error: 'Hãy chọn ca hoặc chọn xin nghỉ' });
  if (shiftId && !db.prepare('SELECT 1 FROM shifts WHERE id=? AND active=1').get(shiftId))
    return res.status(400).json({ error: 'Ca không hợp lệ' });

  // Chỉ thay đơn chờ duyệt TRÙNG ca cùng ngày (khác ca → cho đăng ký thêm để làm 2-3 ca gãy)
  const pending = db.prepare("SELECT id FROM shift_requests WHERE employee_id=? AND work_date=? AND status='pending' AND COALESCE(shift_id,0)=? AND is_off=?").get(req.user.id, workDate, shiftId || 0, isOff);
  if (pending) db.prepare('DELETE FROM shift_requests WHERE id=?').run(pending.id); // thay đơn cũ chờ duyệt

  const auto = !needApprove();
  const status = auto ? 'approved' : 'pending';
  const info = db.prepare(`INSERT INTO shift_requests(employee_id, work_date, shift_id, is_off, status, reviewed_by, reviewed_at)
    VALUES (?,?,?,?,?,?,?)`)
    .run(req.user.id, workDate, shiftId, isOff, status, auto ? req.user.id : null, auto ? nowIso() : null);
  if (auto) applyToAssignment(req.user.id, workDate, shiftId, isOff);
  const row = db.prepare('SELECT * FROM shift_requests WHERE id=?').get(info.lastInsertRowid);
  res.json({ ok: true, auto, request: row });
});

// Đăng ký của tôi (mới nhất trước)
r.get('/mine', (req, res) => {
  const rows = db.prepare(`SELECT sr.*, s.name AS shift_name, s.start_time, s.end_time
    FROM shift_requests sr LEFT JOIN shifts s ON s.id = sr.shift_id
    WHERE sr.employee_id = ? ORDER BY sr.work_date DESC, sr.created_at DESC`).all(req.user.id);
  res.json({ rows });
});

// Nhân viên xoá đơn của mình khi còn chờ duyệt
r.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM shift_requests WHERE id=?').get(req.params.id);
  if (!row || row.employee_id !== req.user.id) return res.status(404).json({ error: 'Không tìm thấy đăng ký' });
  if (row.status !== 'pending') return res.status(400).json({ error: 'Đăng ký đã xử lý, không thể xoá' });
  db.prepare('DELETE FROM shift_requests WHERE id=?').run(row.id);
  res.json({ ok: true });
});

/* ---------------- Phía quản lý ---------------- */

// Danh sách đăng ký (?status=pending)
r.get('/', permRequired('shift_requests'), (req, res) => {
  const { status } = req.query;
  const base = `SELECT sr.*, e.full_name, e.code, e.department, s.name AS shift_name, s.start_time, s.end_time
    FROM shift_requests sr JOIN employees e ON e.id = sr.employee_id
    LEFT JOIN shifts s ON s.id = sr.shift_id`;
  const rows = status
    ? db.prepare(base + ' WHERE sr.status = ? ORDER BY sr.created_at DESC').all(status)
    : db.prepare(base + ' ORDER BY sr.created_at DESC').all();
  res.json({ rows });
});

// Duyệt / từ chối
r.post('/:id/review', permRequired('shift_requests'), (req, res) => {
  const { action, note } = req.body || {};
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'Hành động không hợp lệ' });
  const row = db.prepare('SELECT * FROM shift_requests WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy đăng ký' });
  db.prepare('UPDATE shift_requests SET status=?, reviewed_by=?, reviewed_at=?, review_note=? WHERE id=?')
    .run(action === 'approve' ? 'approved' : 'rejected', req.user.id, nowIso(), note || '', row.id);
  if (action === 'approve') applyToAssignment(row.employee_id, row.work_date, row.shift_id, row.is_off);
  res.json({ ok: true });
});

export default r;
