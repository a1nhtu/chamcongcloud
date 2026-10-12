// TĂNG CA TỐI ĐA / NGÀY cho 3 mức CÔNG ẢO (như "TGLT tối đa / tối đa 2 / tối đa 3" của HR-ERP).
// Mỗi NV mỗi ngày mỗi mức 1 số phút (bảng audit_ot_max; work_date='*' = mức riêng của NV, áp mọi ngày chưa khai).
// Thứ tự áp: ô ngày → mức riêng NV → mặc định công ty (Cài đặt audit_l{n}_day; để trống = không giới hạn).
// Công ảo tính lúc xem (virtual-att.js) nên lưu xong không cần "Tính lại".
import { db, setSetting, adminAttWhere } from '../../db.js';
import { auditAllowed, levelDefaults, payPeriod, payMonthOf, lockMonth, unlockMonth } from '../../virtual-att.js';
import { vnDateStr } from '../../util.js';
import { sendCaughtError } from '../../util.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86400000;
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
// phút: '' / null → null (xoá ô = theo mức mặc định); số 0..1440
const minutesOf = (v) => {
  if (v === '' || v == null) return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= 1440 ? n : undefined;
};

export function registerAuditLimitRoutes(r, { need }) {
  const guard = (req, res, next) => (auditAllowed(req.user) ? next() : res.status(403).json({ error: 'Chức năng công ảo chưa được bật cho tài khoản này' }));

  // Bảng hạn mức trong [from, to] cho mọi NV (cả 3 mức, để chuyển mức không phải tải lại)
  r.get('/audit-limits', need('audit'), guard, (req, res) => {
    const { from, to } = req.query;
    if (!ISO.test(from || '') || !ISO.test(to || '') || to < from) return res.status(400).json({ error: 'Khoảng ngày không hợp lệ' });
    if ((Date.parse(to) - Date.parse(from)) / DAY > 92) return res.status(400).json({ error: 'Xem tối đa 3 tháng một lần' });
    const emps = db.prepare(`SELECT id, code, full_name, department, device_pin FROM employees WHERE active=1${adminAttWhere('role')} ORDER BY department, code`).all();
    const cells = db.prepare("SELECT employee_id, work_date, level, minutes FROM audit_ot_max WHERE (work_date >= ? AND work_date <= ?) OR work_date = '*'").all(from, to)
      .map((c) => [c.employee_id, c.work_date, c.level, c.minutes]);
    res.json({ defaults: levelDefaults(), emps, cells });
  });

  // Mặc định công ty của 3 mức (để trống = không giới hạn)
  r.put('/audit-limits/defaults', need('audit'), guard, (req, res) => {
    const b = req.body || {};
    for (const lv of [1, 2, 3]) {
      if (!(lv in b)) continue;
      const m = minutesOf(b[lv]);
      if (m === undefined) return res.status(400).json({ error: `Mức ${lv}: số phút phải từ 0 đến 1440` });
      setSetting(`audit_l${lv}_day`, m == null ? '' : String(m));
    }
    res.json({ ok: true, defaults: levelDefaults() });
  });

  // Áp hàng loạt: nhiều NV × khoảng ngày × 1 mức (minutes rỗng = xoá → theo mặc định).
  // target='default' → ghi MỨC RIÊNG của NV (không theo ngày). skip_sun / skip_sat: bỏ qua chủ nhật / thứ 7.
  r.post('/audit-limits/apply', need('audit'), guard, (req, res) => {
    const b = req.body || {};
    const level = +b.level;
    if (![1, 2, 3].includes(level)) return res.status(400).json({ error: 'Chọn mức 1, 2 hoặc 3' });
    const ids = [...new Set((b.employee_ids || []).map(Number).filter(Boolean))];
    if (!ids.length) return res.status(400).json({ error: 'Chọn ít nhất 1 nhân viên' });
    const m = minutesOf(b.minutes);
    if (m === undefined) return res.status(400).json({ error: 'Số phút phải từ 0 đến 1440 (để trống = theo mặc định)' });
    let days = ['*'];
    if (b.target !== 'default') {
      if (!ISO.test(b.from || '') || !ISO.test(b.to || '') || b.to < b.from) return res.status(400).json({ error: 'Khoảng ngày không hợp lệ' });
      if ((Date.parse(b.to) - Date.parse(b.from)) / DAY > 366) return res.status(400).json({ error: 'Tối đa 1 năm một lần' });
      days = [];
      for (let d = b.from; d <= b.to; d = addDays(d, 1)) {
        const wd = new Date(d + 'T12:00:00Z').getUTCDay();
        if ((b.skip_sun && wd === 0) || (b.skip_sat && wd === 6)) continue;
        days.push(d);
      }
    }
    const up = db.prepare('INSERT INTO audit_ot_max(employee_id, work_date, level, minutes) VALUES (?,?,?,?) ON CONFLICT(employee_id, work_date, level) DO UPDATE SET minutes=excluded.minutes');
    const del = db.prepare('DELETE FROM audit_ot_max WHERE employee_id=? AND work_date=? AND level=?');
    let n = 0;
    db.exec('BEGIN');
    try {
      for (const id of ids) for (const d of days) { if (m == null) del.run(id, d, level); else up.run(id, d, level, m); n++; }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); return sendCaughtError(res, 'POST /admin/audit-limits/apply', e); }
    res.json({ ok: true, cells: n, people: ids.length, days: days.length });
  });

  // ---------- CHỐT KỲ công ảo: 12 tháng lương gần nhất + các tháng đã chốt ----------
  r.get('/audit-locks', need('audit'), guard, (req, res) => {
    const locks = new Map(db.prepare('SELECT month, from_date, to_date, locked_at, locked_by, rows FROM audit_locks').all().map((l) => [l.month, l]));
    const today = vnDateStr(), cur = payMonthOf(today);
    const months = [];
    let y = +cur.slice(0, 4), m = +cur.slice(5, 7);
    for (let i = 0; i < 13; i++) { months.push(`${y}-${String(m).padStart(2, '0')}`); m--; if (!m) { m = 12; y--; } }
    for (const k of locks.keys()) if (!months.includes(k)) months.push(k);
    months.sort().reverse();
    res.json({ today, rows: months.map((k) => { const p = payPeriod(k); return { month: k, from: p.from, to: p.to, ended: p.to < today, lock: locks.get(k) || null }; }) });
  });
  r.post('/audit-locks', need('audit'), guard, (req, res) => {
    try { res.json({ ok: true, ...lockMonth(String(req.body?.month || ''), req.user.full_name || req.user.username || '') }); }
    catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); return sendCaughtError(res, 'POST /admin/audit-locks', e); }
  });
  r.delete('/audit-locks/:month', need('audit'), guard, (req, res) => {
    try { unlockMonth(req.params.month); res.json({ ok: true }); } catch (e) { return sendCaughtError(res, 'DELETE /admin/audit-locks', e); }
  });

  // Sửa từng ô (sửa trực tiếp trên lưới / dán từ Excel): [{ employee_id, date ('*' = mức riêng NV), level, minutes }]
  r.post('/audit-limits/cells', need('audit'), guard, (req, res) => {
    const list = Array.isArray(req.body?.cells) ? req.body.cells : [];
    if (!list.length) return res.json({ ok: true, saved: 0 });
    if (list.length > 50000) return res.status(400).json({ error: 'Quá nhiều ô một lần (tối đa 50.000)' });
    const empOk = new Set(db.prepare('SELECT id FROM employees').all().map((e) => e.id));
    const up = db.prepare('INSERT INTO audit_ot_max(employee_id, work_date, level, minutes) VALUES (?,?,?,?) ON CONFLICT(employee_id, work_date, level) DO UPDATE SET minutes=excluded.minutes');
    const del = db.prepare('DELETE FROM audit_ot_max WHERE employee_id=? AND work_date=? AND level=?');
    let saved = 0; const errors = [];
    db.exec('BEGIN');
    try {
      for (const c of list) {
        const id = +c.employee_id, d = String(c.date || ''), lv = +c.level, m = minutesOf(c.minutes);
        if (!empOk.has(id) || !(d === '*' || ISO.test(d)) || ![1, 2, 3].includes(lv) || m === undefined) { errors.push(c); continue; }
        if (m == null) del.run(id, d, lv); else up.run(id, d, lv, m);
        saved++;
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); return sendCaughtError(res, 'POST /admin/audit-limits/cells', e); }
    res.json({ ok: true, saved, errorCount: errors.length });
  });
}

