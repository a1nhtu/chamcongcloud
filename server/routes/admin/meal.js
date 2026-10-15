// QUẢN LÝ SUẤT ĂN — phần dành cho HR / quản trị (menu "Suất ăn" trong /admin). Cần: công tắc meal_enabled BẬT + quyền 'meal'.
// Tắt công tắc → mealGate trả 403 cho mọi đường dẫn /meal/*. Module chỉ ĐỌC chấm công + đăng ký làm thêm (xem server/meal.js).
import { db, getSetting, setSetting } from '../../db.js';
import { sendCaughtError } from '../../util.js';
import {
  mealGate, mealManagerOnly, listShifts, needShift, needDate, loadBoard, saveRegistrations, closeMeal, reopenMeal,
  getMenu, saveMenu, copyMenu, orderSummary, kitchenKey, headDepartments,
} from '../../meal.js';
import { checkShiftConfig } from '../../meal-rules.js';

const who = (req) => req.user.full_name || req.user.username || '';
// Chạy 1 handler, lỗi nghiệp vụ (userError) trả nguyên văn, lỗi khác che lại
const wrap = (name, fn) => (req, res) => { try { fn(req, res); } catch (e) { sendCaughtError(res, name, e); } };

export function registerMealRoutes(r) {
  r.use('/meal', mealGate, mealManagerOnly);   // tắt công tắc → 403; không có quyền 'meal' → 403

  // ---------- ca ăn + giờ chốt ----------
  r.get('/meal/shifts', wrap('GET /admin/meal/shifts', (req, res) => res.json({ shifts: listShifts() })));
  r.put('/meal/shifts/:code', wrap('PUT /admin/meal/shifts', (req, res) => {
    needShift(req.params.code);
    const c = checkShiftConfig(req.body || {});
    if (!c.ok) return res.status(400).json({ error: c.error });
    const v = c.value;
    db.prepare('UPDATE meal_shifts SET name = ?, from_time = ?, to_time = ?, mode = ?, enabled = ? WHERE code = ?').run(v.name, v.from_time, v.to_time, v.mode, v.enabled, req.params.code);
    res.json({ ok: true, shifts: listShifts() });
  }));

  // ---------- bảng đối chiếu: ngày + ca → mỗi bộ phận 1 dòng ----------
  r.get('/meal/board', wrap('GET /admin/meal/board', (req, res) => {
    res.json(loadBoard(needDate(req.query.date), req.query.shift));
  }));
  // HR nhập hộ / sửa số đăng ký của bất kỳ bộ phận: { date, shift, items: [{ department, count, note }] }
  r.put('/meal/registrations', wrap('PUT /admin/meal/registrations', (req, res) => {
    const b = req.body || {};
    const n = saveRegistrations({ workDate: needDate(b.date), code: b.shift, items: b.items, by: who(req) });
    res.json({ ok: true, saved: n, ...loadBoard(b.date, b.shift) });
  }));
  r.post('/meal/close', wrap('POST /admin/meal/close', (req, res) => {
    const b = req.body || {};
    res.json({ ok: true, ...closeMeal(needDate(b.date), (needShift(b.shift), b.shift), who(req)) });
  }));
  r.post('/meal/reopen', wrap('POST /admin/meal/reopen', (req, res) => {
    const b = req.body || {};
    reopenMeal(needDate(b.date), (needShift(b.shift), b.shift));
    res.json({ ok: true, ...loadBoard(b.date, b.shift) });
  }));

  // ---------- trưởng bộ phận ----------
  r.get('/meal/heads', wrap('GET /admin/meal/heads', (req, res) => {
    const depts = db.prepare("SELECT DISTINCT IFNULL(department, '') d FROM employees WHERE active = 1 AND IFNULL(department, '') <> '' ORDER BY d").all().map((x) => x.d);
    const heads = db.prepare(`SELECT h.department, h.employee_id, e.code, e.full_name FROM meal_dept_heads h JOIN employees e ON e.id = h.employee_id ORDER BY h.department, e.code`).all();
    const emps = db.prepare("SELECT id, code, full_name, IFNULL(department, '') department FROM employees WHERE active = 1 AND role <> 'admin' ORDER BY code").all();
    res.json({ departments: depts, heads, employees: emps });
  }));
  r.post('/meal/heads', wrap('POST /admin/meal/heads', (req, res) => {
    const department = String(req.body?.department ?? '').trim(), eid = Number(req.body?.employee_id);
    if (!department) return res.status(400).json({ error: 'Chọn bộ phận' });
    if (!db.prepare('SELECT 1 FROM employees WHERE id = ? AND active = 1').get(eid)) return res.status(400).json({ error: 'Chọn nhân viên' });
    db.prepare('INSERT OR IGNORE INTO meal_dept_heads(department, employee_id) VALUES (?,?)').run(department, eid);
    res.json({ ok: true, roots: headDepartments(eid).roots });
  }));
  r.delete('/meal/heads', wrap('DELETE /admin/meal/heads', (req, res) => {
    db.prepare('DELETE FROM meal_dept_heads WHERE department = ? AND employee_id = ?').run(String(req.query.department ?? ''), Number(req.query.employee_id));
    res.json({ ok: true });
  }));

  // ---------- thực đơn + tổng hợp món ----------
  r.get('/meal/menu', wrap('GET /admin/meal/menu', (req, res) => res.json({ date: needDate(req.query.date), shifts: listShifts(), menu: getMenu(req.query.date) })));
  r.put('/meal/menu', wrap('PUT /admin/meal/menu', (req, res) => {
    const b = req.body || {};
    const n = saveMenu(needDate(b.date), b.shift, b.dishes);
    res.json({ ok: true, saved: n, menu: getMenu(b.date) });
  }));
  r.post('/meal/menu/copy', wrap('POST /admin/meal/menu/copy', (req, res) => {
    const b = req.body || {};
    const n = copyMenu(needDate(b.from), needDate(b.to), b.shift ? (needShift(b.shift), b.shift) : null);
    res.json({ ok: true, copied: n, menu: getMenu(b.to) });
  }));
  r.get('/meal/orders', wrap('GET /admin/meal/orders', (req, res) => {
    res.json(orderSummary(needDate(req.query.date), (needShift(req.query.shift), req.query.shift)));
  }));

  // ---------- máy chấm công nào được tính suất ăn (rỗng = mọi máy thật; lượt thêm tay / chấm điện thoại không bao giờ tính) ----------
  r.get('/meal/devices', wrap('GET /admin/meal/devices', (req, res) => {
    const devices = db.prepare("SELECT serial, name FROM push_devices WHERE active = 1 ORDER BY name, serial").all();
    res.json({ devices, serials: getSetting('meal_serials', '').split(',').map((x) => x.trim()).filter(Boolean) });
  }));
  r.put('/meal/devices', wrap('PUT /admin/meal/devices', (req, res) => {
    const known = new Set(db.prepare('SELECT serial FROM push_devices').all().map((d) => d.serial));
    const list = [...new Set((Array.isArray(req.body?.serials) ? req.body.serials : []).map((x) => String(x).trim()).filter((x) => known.has(x)))];
    setSetting('meal_serials', list.join(','));
    res.json({ ok: true, serials: list });
  }));

  // ---------- màn hình bếp ----------
  r.get('/meal/kitchen', wrap('GET /admin/meal/kitchen', (req, res) => res.json({ key: kitchenKey(), path: '/bep' })));
  r.post('/meal/kitchen/renew', wrap('POST /admin/meal/kitchen/renew', (req, res) => res.json({ key: kitchenKey({ renew: true }), path: '/bep' })));
}
