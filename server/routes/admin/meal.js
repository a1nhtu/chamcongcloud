// QUẢN LÝ SUẤT ĂN — phần dành cho HR / quản trị (menu "Suất ăn" trong /admin). Cần: công tắc meal_enabled BẬT + quyền 'meal'.
// Tắt công tắc → mealGate trả 403 cho mọi đường dẫn /meal/*. Module chỉ ĐỌC chấm công + đăng ký làm thêm (xem server/meal.js).
import { db, getSetting, setSetting } from '../../db.js';
import { sendCaughtError } from '../../util.js';
import {
  mealGate, mealManagerOnly, listShifts, needShift, needDate, loadBoard, saveRegistrations, closeMeal, reopenMeal,
  getMenu, saveMenu, copyMenu, orderSummary, kitchenKey, headDepartments, mealReport, mealOptions, setMealAdjust, hrSetOrder, mealEmpSearch,
  createShift, deleteShift, listKitchens, saveKitchen, deleteKitchen, renewKitchenKey, assignKitchen, kitchenDeptMap, kitchenDeptEmployees, kitchenAllEmployees,
  hrSetSignup, setMealExtra, signupDay, sendToKitchen, mealRangeSummary, mealNoShow, mealExceptions,
} from '../../meal.js';
import { writeMealReportXlsx, writeMealRptXlsx } from '../../meal-xlsx.js';
import { checkShiftConfig } from '../../meal-rules.js';

const who = (req) => req.user.full_name || req.user.username || '';
// Chạy 1 handler, lỗi nghiệp vụ (userError) trả nguyên văn, lỗi khác che lại
const wrap = (name, fn) => (req, res) => { try { fn(req, res); } catch (e) { sendCaughtError(res, name, e); } };
// Tên miền đã lưu cho liên kết bếp + tên miền tunnel của bản cài (nếu có) để gợi ý khi HR mở bằng localhost/IP
const kitchenBase = () => {
  const c = (process.env.CUSTOMER || '').trim().toLowerCase();
  return { base: getSetting('meal_kitchen_base', ''), domain: c && process.env.TUNNEL_TOKEN ? c + '.maychamcongcloud.com' : '' };
};

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
    if (v.lock_before_min != null) db.prepare('UPDATE meal_shifts SET lock_before_min = ?, lock_at = ? WHERE code = ?').run(v.lock_before_min, v.lock_at, req.params.code);
    if (v.open_at != null) db.prepare('UPDATE meal_shifts SET open_at = ? WHERE code = ?').run(v.open_at, req.params.code);
    res.json({ ok: true, shifts: listShifts() });
  }));
  // Thêm bữa ăn mới (VD bữa sáng / bữa phụ) — cùng các ô như sửa bữa
  r.post('/meal/shifts', wrap('POST /admin/meal/shifts', (req, res) => {
    const c = checkShiftConfig({ mode: 'punch', enabled: true, ...(req.body || {}) });
    if (!c.ok) return res.status(400).json({ error: c.error });
    res.json({ ok: true, shift: createShift(c.value), shifts: listShifts() });
  }));
  r.delete('/meal/shifts/:code', wrap('DELETE /admin/meal/shifts', (req, res) => {
    deleteShift(req.params.code);
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

  // ---------- BÁO CÁO suất ăn + HR chỉnh tay (lưu vết ở meal_adjust_log) ----------
  r.get('/meal/report', wrap('GET /admin/meal/report', (req, res) => res.json(mealReport(needDate(req.query.date)))));
  r.put('/meal/adjust', wrap('PUT /admin/meal/adjust', (req, res) => {
    const b = req.body || {};
    res.json({ ok: true, ...setMealAdjust({ workDate: needDate(b.date), code: b.shift, dish: b.dish, qty: b.qty, reason: b.reason, by: who(req) }) });
  }));
  r.put('/meal/order-for', wrap('PUT /admin/meal/order-for', (req, res) => {
    const b = req.body || {};
    res.json({ ok: true, ...hrSetOrder({ workDate: needDate(b.date), code: b.shift, employeeId: b.employee_id, menuId: b.menu_id, reason: b.reason, by: who(req) }) });
  }));
  r.get('/meal/emp-search', wrap('GET /admin/meal/emp-search', (req, res) => {
    needShift(req.query.shift);
    res.json({ rows: mealEmpSearch(req.query.q, needDate(req.query.date), req.query.shift, { all: req.query.all === '1' }) });
  }));
  r.get('/meal/report.xlsx', async (req, res) => {
    try {
      const from = needDate(req.query.from), to = needDate(req.query.to || req.query.from);
      if (to < from) return res.status(400).json({ error: 'Ngày kết thúc phải sau ngày bắt đầu' });
      if ((Date.parse(to) - Date.parse(from)) / 86400000 > 62) return res.status(400).json({ error: 'Xuất tối đa 62 ngày một lần' });
      await writeMealReportXlsx(res, from, to);
    } catch (e) { if (!res.headersSent) sendCaughtError(res, 'GET /admin/meal/report.xlsx', e); else res.end(); }
  });

  // ---------- cách đăng ký: 3 công tắc (mặc định đều BẬT = như cũ) — CHỈ tài khoản tổng đổi (Cài đặt › Cấu hình hiển thị) ----------
  r.get('/meal/options', wrap('GET /admin/meal/options', (req, res) => res.json(mealOptions())));
  r.put('/meal/options', wrap('PUT /admin/meal/options', (req, res) => {
    if (!req.user.master) return res.status(403).json({ error: 'Chỉ tài khoản tổng đổi được cách đăng ký suất ăn (Cài đặt › Cấu hình hiển thị)' });
    for (const [k, key] of [['self_order', 'meal_self_order'], ['dish_choice', 'meal_dish_choice'], ['dept_head', 'meal_dept_head']])
      if (req.body?.[k] != null) setSetting(key, req.body[k] ? '1' : '0');
    res.json({ ok: true, ...mealOptions() });
  }));

  // ---------- ĐĂNG KÝ ĂN (không chọn món): xem theo ngày, HR đăng ký / huỷ hộ, thêm suất tay, gửi bếp ----------
  r.get('/meal/signups', wrap('GET /admin/meal/signups', (req, res) => res.json(signupDay(needDate(req.query.date), req.query.shift))));
  // { date, shift, employee_ids | department, on, reason }
  r.put('/meal/signup-for', wrap('PUT /admin/meal/signup-for', (req, res) => {
    const b = req.body || {};
    res.json({ ok: true, ...hrSetSignup({ workDate: needDate(b.date), code: b.shift, employeeIds: b.employee_ids, department: b.department, on: !!b.on, reason: b.reason, by: who(req) }) });
  }));
  r.put('/meal/extra', wrap('PUT /admin/meal/extra', (req, res) => {
    const b = req.body || {};
    res.json({ ok: true, ...setMealExtra({ workDate: needDate(b.date), code: b.shift, kitchenId: b.kitchen_id, qty: b.qty, reason: b.reason, by: who(req) }) });
  }));
  r.post('/meal/dispatch', wrap('POST /admin/meal/dispatch', (req, res) => {
    const b = req.body || {};
    res.json({ ok: true, ...sendToKitchen({ workDate: needDate(b.date), code: b.shift, by: who(req), preview: !!b.preview }) });
  }));

  // ---------- BẾP: danh mục + máy chấm ăn của bếp + mã màn hình riêng + phân NV vào bếp ----------
  r.get('/meal/kitchens', wrap('GET /admin/meal/kitchens', (req, res) => res.json({ kitchens: listKitchens(), depts: kitchenDeptMap() })));
  r.post('/meal/kitchens', wrap('POST /admin/meal/kitchens', (req, res) => res.json({ ok: true, kitchen: saveKitchen({ name: req.body?.name, serials: req.body?.serials }) })));
  r.put('/meal/kitchens/:id', wrap('PUT /admin/meal/kitchens', (req, res) => res.json({ ok: true, kitchen: saveKitchen({ id: Number(req.params.id) || -1, name: req.body?.name, serials: req.body?.serials }) })));
  r.delete('/meal/kitchens/:id', wrap('DELETE /admin/meal/kitchens', (req, res) => { deleteKitchen(req.params.id); res.json({ ok: true }); }));
  r.post('/meal/kitchens/:id/renew', wrap('POST /admin/meal/kitchens/renew', (req, res) => res.json({ ok: true, kitchen: renewKitchenKey(req.params.id) })));
  // ?all=1 → mọi NV + danh mục bộ phận (màn Phân nhân viên vào bếp); không có = NV của 1 bộ phận
  r.get('/meal/kitchen-emps', wrap('GET /admin/meal/kitchen-emps', (req, res) => res.json(req.query.all === '1' ? kitchenAllEmployees() : { rows: kitchenDeptEmployees(req.query.department) })));
  // { kitchen_id (0 = bỏ), employee_ids, department (gồm con), departments (đúng tên, '' = chưa có bộ phận) }
  r.put('/meal/kitchen-assign', wrap('PUT /admin/meal/kitchen-assign', (req, res) => {
    const b = req.body || {};
    res.json({ ok: true, count: assignKitchen({ kitchenId: b.kitchen_id, employeeIds: b.employee_ids, department: b.department, departments: b.departments }), depts: kitchenDeptMap(), kitchens: listKitchens() });
  }));

  // ---------- BÁO CÁO theo khoảng ngày: tổng số & giờ đăng ký · báo ăn mà không ăn · ngoại lệ ----------
  r.get('/meal/rpt/summary', wrap('GET /admin/meal/rpt/summary', (req, res) => res.json(mealRangeSummary(needDate(req.query.from), needDate(req.query.to || req.query.from)))));
  r.get('/meal/rpt/noshow', wrap('GET /admin/meal/rpt/noshow', (req, res) => res.json(mealNoShow(needDate(req.query.from), needDate(req.query.to || req.query.from)))));
  r.get('/meal/rpt/except', wrap('GET /admin/meal/rpt/except', (req, res) => res.json(mealExceptions(needDate(req.query.from), needDate(req.query.to || req.query.from)))));
  r.get('/meal/rpt.xlsx', async (req, res) => {
    try { await writeMealRptXlsx(res, String(req.query.type || ''), needDate(req.query.from), needDate(req.query.to || req.query.from)); }
    catch (e) { if (!res.headersSent) sendCaughtError(res, 'GET /admin/meal/rpt.xlsx', e); else res.end(); }
  });

  // ---------- màn hình bếp ----------
  r.get('/meal/kitchen', wrap('GET /admin/meal/kitchen', (req, res) => res.json({ key: kitchenKey(), path: '/bep', ...kitchenBase() })));
  r.post('/meal/kitchen/renew', wrap('POST /admin/meal/kitchen/renew', (req, res) => res.json({ key: kitchenKey({ renew: true }), path: '/bep', ...kitchenBase() })));
  // Tên miền in trên liên kết bếp (VD https://app.maychamcongcloud.com) — để trống = theo địa chỉ HR đang mở
  r.put('/meal/kitchen/base', wrap('PUT /admin/meal/kitchen/base', (req, res) => {
    let v = String(req.body?.base || '').trim().replace(/\/bep(\/.*)?$/i, '').replace(/\/+$/, '');
    if (v && !/^https?:\/\//i.test(v)) v = (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?$/i.test(v) ? 'http://' : 'https://') + v;   // IP / localhost chạy http
    // gõ ngắn "abc" (không có dấu chấm, không phải localhost) = tên miền con abc.maychamcongcloud.com
    v = v.replace(/^(https?:\/\/)([^/:.]+)(:\d+)?$/i, (m, s, h, p) => (h.toLowerCase() === 'localhost' ? m : s + h + '.maychamcongcloud.com' + (p || '')));
    if (v && !/^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i.test(v)) return res.status(400).json({ error: 'Tên miền không hợp lệ — VD: app.maychamcongcloud.com' });
    setSetting('meal_kitchen_base', v.toLowerCase());
    res.json({ ok: true, ...kitchenBase() });
  }));
}
