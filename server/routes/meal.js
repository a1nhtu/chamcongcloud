// QUẢN LÝ SUẤT ĂN — phần dành cho NHÂN VIÊN / TRƯỞNG BỘ PHẬN trên app (/api/meal) + màn hình bếp (/api/meal/kitchen/feed, dùng khoá riêng).
// Công tắc meal_enabled TẮT → mọi đường dẫn (trừ /config báo "chưa bật") trả 403. Không đụng dữ liệu chấm công.
import { Router } from 'express';
import { authRequired } from '../auth.js';
import { sendCaughtError, userError } from '../util.js';
import {
  mealEnabled, selfOrderOn, dishChoiceOn, deptHeadOn, machineSignupOn, mealGate, listShifts, needShift, needDate, loadBoard, saveRegistrations, closingOf, headDeptList,
  myMealPlan, setMyOrder, setMySignup, kitchenScope, kitchenFeed, empKitchenId, listKitchens,
} from '../meal.js';
import { vnNow, addDaysIso, isIsoDate } from '../meal-rules.js';

const r = Router();
// Chặn dò mã màn hình bếp: mỗi IP sai quá 10 lần trong 5 phút thì bị từ chối (429) tới hết 5 phút
const fails = new Map();   // ip → { n, since }
const clientIp = (req) => String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
function tooManyFails(ip, now = Date.now()) {
  const f = fails.get(ip);
  if (!f) return false;
  if (now - f.since > 5 * 60000) { fails.delete(ip); return false; }
  return f.n >= 10;
}
function noteFail(ip, now = Date.now()) {
  const f = fails.get(ip);
  if (!f || now - f.since > 5 * 60000) fails.set(ip, { n: 1, since: now }); else f.n++;
  if (fails.size > 2000) fails.clear();
}
const wrap = (name, fn) => (req, res) => { try { fn(req, res); } catch (e) { sendCaughtError(res, name, e); } };

// Màn hình bếp: không đăng nhập, chỉ cần khoá do HR cấp (Suất ăn › Cấu hình). Đặt TRƯỚC authRequired.
r.get('/kitchen/feed', mealGate, wrap('GET /meal/kitchen/feed', (req, res) => {
  const ip = clientIp(req);
  if (tooManyFails(ip)) return res.status(429).json({ error: 'Nhập sai mã quá nhiều lần — thử lại sau vài phút' });
  const scope = kitchenScope(String(req.query.key || ''));   // mã chung (mọi bếp) hoặc mã riêng của 1 bếp
  if (!scope) { noteFail(ip); return res.status(401).json({ error: 'Mã màn hình bếp không đúng hoặc đã bị đổi' }); }
  res.setHeader('Cache-Control', 'no-store');
  res.json(kitchenFeed(parseInt(req.query.since, 10) || 0, new Date(), scope));
}));

r.use(authRequired);
// App hỏi xem phân hệ có bật không (tắt → ẩn tab Suất ăn). self_order TẮT → tab chỉ hiện cho trưởng bộ phận (head).
// dish_choice TẮT = chế độ chỉ đăng ký ăn (tab đổi tên "Đăng ký ăn"); dept_head TẮT = không ai là trưởng bộ phận nhập số.
r.get('/config', (req, res) => {
  const enabled = mealEnabled();
  let head = false;
  try { head = enabled && deptHeadOn() && !req.user.master && headDeptList(req.user.id).list.length > 0; } catch { /* chưa có bảng suất ăn */ }
  res.json({ enabled, self_order: selfOrderOn(), dish_choice: dishChoiceOn(), dept_head: deptHeadOn(), machine_signup: enabled && machineSignupOn(), head });
});
r.use(mealGate);

// Thông tin của tôi: các ca ăn đang bật + bộ phận tôi làm trưởng
r.get('/me', wrap('GET /meal/me', (req, res) => {
  const h = req.user.master || !deptHeadOn() ? { roots: [], list: [] } : headDeptList(req.user.id);
  const kid = req.user.master ? null : empKitchenId(req.user.id);
  const kitchen = kid ? listKitchens().find((k) => k.id === kid)?.name || '' : '';
  res.json({ today: vnNow().date, shifts: listShifts({ onlyEnabled: true }), head_of: h.list, self_order: selfOrderOn(), dish_choice: dishChoiceOn(), machine_signup: machineSignupOn(), kitchen });
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
// Đăng ký ăn (chế độ không chọn món): { date, shift, on: true = Có ăn / false = Không ăn }
r.put('/signup', wrap('PUT /meal/signup', (req, res) => {
  if (req.user.master) throw userError('Tài khoản tổng không đăng ký suất ăn');
  const b = req.body || {};
  res.json({ ok: true, ...setMySignup(req.user.id, needDate(b.date), b.shift, !!b.on) });
}));

// Trưởng bộ phận: số đã đăng ký của các bộ phận mình phụ trách cho 1 ngày + 1 ca
r.get('/dept', wrap('GET /meal/dept', (req, res) => {
  if (!deptHeadOn()) return res.status(403).json({ error: 'Công ty không dùng trưởng bộ phận báo số suất ăn' });
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
  if (!deptHeadOn()) return res.status(403).json({ error: 'Công ty không dùng trưởng bộ phận báo số suất ăn' });
  const b = req.body || {};
  const h = headDeptList(req.user.id);
  if (!h.list.length) return res.status(403).json({ error: 'Bạn chưa được HR chỉ định làm trưởng bộ phận' });
  const date = needDate(b.date);
  if (date < vnNow().date) return res.status(400).json({ error: 'Ngày đã qua — liên hệ HR để sửa' });
  const n = saveRegistrations({ workDate: date, code: b.shift, items: b.items, by: req.user.full_name || req.user.username || '', allowed: h.allowed });
  res.json({ ok: true, saved: n });
}));

export default r;
