// QUẢN LÝ SUẤT ĂN — phần dành cho NHÂN VIÊN / TRƯỞNG BỘ PHẬN trên app (/api/meal) + màn hình bếp (/api/meal/kitchen/feed, dùng khoá riêng).
// Công tắc meal_enabled TẮT → mọi đường dẫn (trừ /config báo "chưa bật") trả 403. Không đụng dữ liệu chấm công.
import { Router } from 'express';
import { authRequired } from '../auth.js';
import { sendCaughtError, userError } from '../util.js';
import {
  mealEnabled, mealGate, listShifts, needShift, needDate, loadBoard, saveRegistrations, closingOf, headDeptList,
  getMenu, myMealPlan, setMyOrder, kitchenKeyOk, kitchenFeed,
} from '../meal.js';
import { vnNow, addDaysIso, isIsoDate } from '../meal-rules.js';

const r = Router();
const wrap = (name, fn) => (req, res) => { try { fn(req, res); } catch (e) { sendCaughtError(res, name, e); } };

// Màn hình bếp: không đăng nhập, chỉ cần khoá do HR cấp (Suất ăn › Cấu hình). Đặt TRƯỚC authRequired.
r.get('/kitchen/feed', mealGate, wrap('GET /meal/kitchen/feed', (req, res) => {
  if (!kitchenKeyOk(String(req.query.key || ''))) return res.status(401).json({ error: 'Khoá màn hình bếp không đúng hoặc đã bị đổi' });
  res.setHeader('Cache-Control', 'no-store');
  res.json(kitchenFeed(parseInt(req.query.since, 10) || 0));
}));

r.use(authRequired);
// App hỏi xem phân hệ có bật không (tắt → ẩn tab Suất ăn)
r.get('/config', (req, res) => res.json({ enabled: mealEnabled() }));
r.use(mealGate);

// Thông tin của tôi: các ca ăn đang bật + bộ phận tôi làm trưởng
r.get('/me', wrap('GET /meal/me', (req, res) => {
  const h = req.user.master ? { roots: [], list: [] } : headDeptList(req.user.id);
  res.json({ today: vnNow().date, shifts: listShifts({ onlyEnabled: true }), head_of: h.list });
}));

// Thực đơn + món tôi đã chọn trong khoảng ngày (tối đa 14 ngày)
r.get('/plan', wrap('GET /meal/plan', (req, res) => {
  if (req.user.master) throw userError('Tài khoản tổng không chọn món');
  const from = isIsoDate(req.query.from) ? req.query.from : vnNow().date;
  const to = isIsoDate(req.query.to) ? req.query.to : addDaysIso(from, 6);
  if (to < from || Date.parse(to) - Date.parse(from) > 13 * 86400000) throw userError('Khoảng ngày tối đa 14 ngày');
  res.json({ days: myMealPlan(req.user.id, from, to) });
}));
// Chọn món: { date, shift, menu_id } (menu_id rỗng = bỏ chọn)
r.put('/order', wrap('PUT /meal/order', (req, res) => {
  if (req.user.master) throw userError('Tài khoản tổng không chọn món');
  const b = req.body || {};
  res.json({ ok: true, chosen: setMyOrder(req.user.id, needDate(b.date), b.shift, b.menu_id) });
}));

// Trưởng bộ phận: số đã đăng ký của các bộ phận mình phụ trách cho 1 ngày + 1 ca
r.get('/dept', wrap('GET /meal/dept', (req, res) => {
  const h = headDeptList(req.user.id);
  if (!h.list.length) return res.json({ departments: [], head_of: [] });
  const date = needDate(req.query.date), shift = needShift(req.query.shift);
  const b = loadBoard(date, shift.code);
  const have = new Map(b.board.rows.map((x) => [x.department, x]));
  const closed = !!closingOf(date, shift.code);
  const rows = h.list.map((d) => { const x = have.get(d); return { department: d, count: x ? x.registered : null, note: x ? x.note : '' }; });
  res.json({ date, shift, closed, past: date < vnNow().date, departments: rows, head_of: h.list });
}));
r.put('/dept', wrap('PUT /meal/dept', (req, res) => {
  const b = req.body || {};
  const h = headDeptList(req.user.id);
  if (!h.list.length) return res.status(403).json({ error: 'Bạn chưa được HR chỉ định làm trưởng bộ phận' });
  const date = needDate(b.date);
  if (date < vnNow().date) return res.status(400).json({ error: 'Ngày đã qua — liên hệ HR để sửa' });
  const n = saveRegistrations({ workDate: date, code: b.shift, items: b.items, by: req.user.full_name || req.user.username || '', allowed: h.allowed });
  res.json({ ok: true, saved: n });
}));

export default r;
