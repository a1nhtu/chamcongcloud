// ĐĂNG KÝ LÀM BÙ (hoán đổi ngày làm việc): quản lý khai NV đi làm ngày nghỉ (VD chủ nhật) để nghỉ 1 ngày khác (VD thứ 2).
// Quy tắc tính: xem server/swap.js. Ngày nghỉ bù = 1 đơn nghỉ "Nghỉ bù" (đã duyệt) tự sinh, gắn leave_requests.swap_id.
// Lưu / xoá xong trang quản lý gọi /admin/recompute cho ngày làm bù để công ngày đó tính lại theo quy tắc mới.
import { db, adminAttWhere, deptWithChildren } from '../../db.js';
import { nowIso, sendCaughtError } from '../../util.js';
import { SWAP_LEAVE } from '../../swap.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function registerSwapRoutes(r, { need }) {
  // Danh sách đăng ký có ngày làm bù HOẶC ngày nghỉ bù nằm trong [from, to]
  r.get('/swap-days', need('attendance_edit'), (req, res) => {
    const from = String(req.query.from || '').slice(0, 10), to = String(req.query.to || '').slice(0, 10);
    if (!ISO.test(from) || !ISO.test(to) || to < from) return res.status(400).json({ error: 'Khoảng ngày không hợp lệ' });
    const depts = deptWithChildren(String(req.query.depts || '').split(',').map((s) => s.trim()).filter(Boolean));
    let w = `1=1${adminAttWhere('e.role')}`; const args = [];
    if (depts.length) { w += ` AND e.department IN (${depts.map(() => '?').join(',')})`; args.push(...depts); }
    const rows = db.prepare(`SELECT w.id, w.employee_id, w.work_date, w.off_date, w.note, w.created_by, w.created_at, e.code, e.full_name name, e.department dept,
        (SELECT ROUND(SUM(a.work_unit), 2) FROM attendance a WHERE a.employee_id=w.employee_id AND a.work_date=w.work_date) cong,
        (SELECT COUNT(*) FROM attendance a WHERE a.employee_id=w.employee_id AND a.work_date=w.work_date AND a.check_in_at IS NOT NULL) worked,
        (SELECT COUNT(*) FROM attendance a WHERE a.employee_id=w.employee_id AND a.work_date=w.off_date AND a.check_in_at IS NOT NULL) off_worked
      FROM swap_days w JOIN employees e ON e.id=w.employee_id
      WHERE ((w.work_date>=? AND w.work_date<=?) OR (w.off_date>=? AND w.off_date<=?)) AND ${w}
      ORDER BY w.work_date DESC, e.department, e.code`).all(from, to, from, to, ...args);
    res.json({ rows });
  });

  // Khai cho 1 hoặc nhiều NV: { employee_ids, work_date, off_date, note }
  r.post('/swap-days', need('attendance_edit'), (req, res) => {
    const b = req.body || {};
    const ids = [...new Set((Array.isArray(b.employee_ids) ? b.employee_ids : []).map(Number).filter(Boolean))];
    const work = String(b.work_date || '').slice(0, 10), off = String(b.off_date || '').slice(0, 10);
    const note = String(b.note || '').slice(0, 300);
    if (!ids.length) return res.status(400).json({ error: 'Chưa chọn nhân viên' });
    if (!ISO.test(work) || !ISO.test(off)) return res.status(400).json({ error: 'Chọn ngày làm bù và ngày nghỉ bù' });
    if (work === off) return res.status(400).json({ error: 'Ngày làm bù và ngày nghỉ bù phải khác nhau' });
    const emp = db.prepare('SELECT id, full_name FROM employees WHERE id=? AND active=1');
    const dupW = db.prepare('SELECT 1 FROM swap_days WHERE employee_id=? AND (work_date=? OR off_date=? OR work_date=? OR off_date=?)');
    const hasLeave = db.prepare("SELECT type FROM leave_requests WHERE employee_id=? AND status='approved' AND from_date<=? AND to_date>=?");
    const insW = db.prepare('INSERT INTO swap_days(employee_id, work_date, off_date, note, created_by) VALUES (?,?,?,?,?)');
    const insL = db.prepare(`INSERT INTO leave_requests(employee_id, type, from_date, to_date, reason, status, reviewed_by, reviewed_at, review_note, half, swap_id)
      VALUES (?,?,?,?,?, 'approved', ?, ?, 'Tự sinh từ đăng ký làm bù', '', ?)`);
    const by = req.user.full_name || req.user.username || '';
    const dmy = (d) => `${d.slice(8)}/${d.slice(5, 7)}`;
    const done = [], skipped = [];
    db.exec('BEGIN');
    try {
      for (const id of ids) {
        const e = emp.get(id); if (!e) continue;
        if (dupW.get(id, work, work, off, off)) { skipped.push(`${e.full_name}: đã có đăng ký làm bù trùng ngày ${dmy(work)} hoặc ${dmy(off)}`); continue; }
        const lv = hasLeave.get(id, off, off);
        if (lv) { skipped.push(`${e.full_name}: ngày ${dmy(off)} đã có đơn "${lv.type}"`); continue; }
        const sid = insW.run(id, work, off, note, by).lastInsertRowid;
        insL.run(id, SWAP_LEAVE, off, off, `Nghỉ bù cho ngày làm bù ${dmy(work)}/${work.slice(0, 4)}${note ? ' — ' + note : ''}`, req.user.id || null, nowIso(), sid);
        done.push(id);
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); return sendCaughtError(res, 'POST /admin/swap-days', e); }
    res.json({ ok: true, count: done.length, employee_ids: done, skipped });
  });

  // Xoá 1 hoặc nhiều đăng ký (kèm đơn "Nghỉ bù" tự sinh): { ids }
  r.post('/swap-days/delete', need('attendance_edit'), (req, res) => {
    const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Boolean))];
    if (!ids.length) return res.status(400).json({ error: 'Chưa chọn dòng nào' });
    const get = db.prepare('SELECT * FROM swap_days WHERE id=?');
    const rows = [];
    db.exec('BEGIN');
    try {
      for (const id of ids) {
        const w = get.get(id); if (!w) continue;
        db.prepare('DELETE FROM leave_requests WHERE swap_id=?').run(id);
        db.prepare('DELETE FROM swap_days WHERE id=?').run(id);
        rows.push({ employee_id: w.employee_id, work_date: w.work_date, off_date: w.off_date });
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); return sendCaughtError(res, 'POST /admin/swap-days/delete', e); }
    res.json({ ok: true, count: rows.length, rows });
  });
}
