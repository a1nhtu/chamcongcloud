// Nhóm route CẤU HÌNH LƯƠNG + bảng lương + ngày lễ.
import { db, getSetting } from '../../db.js';
import { computePayrollTable } from '../../payroll-calc.js';
import { sendCaughtError } from '../../util.js';

export function registerPayrollRoutes(r, { need }) {
  /* ----------------------------- CẤU HÌNH LƯƠNG ----------------------------- */
  r.get('/salary', need('salary'), (req, res) => {
    const rows = db.prepare(`
      SELECT e.id AS employee_id, e.code, e.full_name, e.department,
             c.basic_salary, c.daily_rate, c.working_days_per_month,
             c.ot_rate_weekday, c.ot_rate_weekend, c.ot_rate_holiday, c.allowance, c.hourly_rate
      FROM employees e LEFT JOIN salary_configs c ON c.employee_id = e.id
      WHERE e.active = 1 AND e.role != 'admin'
      ORDER BY e.department, e.full_name`).all();
    res.json({ rows });
  });
  r.put('/salary/:empId', need('salary'), (req, res) => {
    const b = req.body || {};
    const eid = +req.params.empId;
    const emp = db.prepare('SELECT id FROM employees WHERE id = ?').get(eid);
    if (!emp) return res.status(404).json({ error: 'Không tìm thấy nhân viên' });
    db.prepare(`INSERT INTO salary_configs
        (employee_id, basic_salary, daily_rate, working_days_per_month, ot_rate_weekday, ot_rate_weekend, ot_rate_holiday, allowance, hourly_rate, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?, datetime('now'))
      ON CONFLICT(employee_id) DO UPDATE SET
        basic_salary=excluded.basic_salary, daily_rate=excluded.daily_rate,
        working_days_per_month=excluded.working_days_per_month,
        ot_rate_weekday=excluded.ot_rate_weekday, ot_rate_weekend=excluded.ot_rate_weekend,
        ot_rate_holiday=excluded.ot_rate_holiday, allowance=excluded.allowance,
        hourly_rate=excluded.hourly_rate, updated_at=datetime('now')`)
      .run(eid, +b.basic_salary || 0, b.daily_rate ? +b.daily_rate : null, +b.working_days_per_month || 26,
        +b.ot_rate_weekday || 1.5, +b.ot_rate_weekend || 2.0, +b.ot_rate_holiday || 3.0, +b.allowance || 0, +b.hourly_rate || 0);
    res.json({ ok: true });
  });

  // Bảng lương tính sẵn cho 1 tháng (kèm chi tiết từng NV để in phiếu lương)
  r.get('/payroll', need('salary'), (req, res) => {
    const month = (req.query.month || '').slice(0, 7);
    const dept = req.query.dept || null;
    const m = /^(\d{4})-(\d{2})$/.exec(month);
    if (!m) return res.status(400).json({ error: 'Thiếu tháng (YYYY-MM)' });
    const data = computePayrollTable(+m[1], +m[2], dept);
    res.json({ ...data, month, mode: getSetting('attendance_mode', 'shift'), company: getSetting('company_name', 'Digiplus') });
  });

  /* ----------------------------- NGÀY LỄ ----------------------------- */
  r.get('/holidays', (req, res) => {
    res.json({ rows: db.prepare('SELECT * FROM public_holidays ORDER BY holiday_date DESC').all() });
  });
  r.post('/holidays', need('holidays'), (req, res) => {
    const b = req.body || {};
    if (!b.holiday_date) return res.status(400).json({ error: 'Thiếu ngày' });
    try {
      db.prepare('INSERT INTO public_holidays(holiday_date, name) VALUES (?,?)').run(b.holiday_date, b.name || '');
      res.json({ ok: true });
    } catch (e) {
      if (/UNIQUE/.test(e.message)) return res.status(400).json({ error: 'Ngày lễ đã tồn tại' });
      sendCaughtError(res, 'POST /admin/holidays', e, { status: 400 });
    }
  });
  r.delete('/holidays/:id', need('holidays'), (req, res) => {
    db.prepare('DELETE FROM public_holidays WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });
}
