// PHÂN HỆ QUẢN LÝ SUẤT ĂN — phần dùng CSDL (quy tắc thuần ở meal-rules.js). MODULE ĐỘC LẬP:
//   · chỉ ĐỌC chấm công (device_punches) + đăng ký làm thêm (ot_registrations); KHÔNG ghi / sửa bảng chấm công, KHÔNG đụng công thức tính công
//   · ghi vào các bảng meal_* riêng (db.js › initSchema)
//   · công tắc `meal_enabled` (Cài đặt, mặc định TẮT, chỉ tài khoản tổng bật): tắt → mọi API suất ăn trả 403, trang /bep + /suatan trả 404, menu ẩn
import { randomInt, timingSafeEqual } from 'node:crypto';
import { db, getSetting, setSetting, adminAttWhere, deptWithChildren } from './db.js';
import { hasPerm } from './auth.js';
import { userError } from './util.js';
import {
  DEFAULT_MEAL_SHIFTS, NON_MACHINE_SERIALS, windowBoundsUtc, countValidPunches, buildBoard, shiftForPunch, vnNow,
  isIsoDate, parseCount, cleanDishes, canOrderMeal, orderDeadlineVn, addDaysIso, inWindow, buildDishReport, parseAdjust,
  orderOpenVn, orderState, mealEnded, buildSignupReport, cleanReason,
} from './meal-rules.js';

/* ---------------------------- công tắc + quyền ---------------------------- */
export const mealEnabled = () => getSetting('meal_enabled', '0') === '1';
// Công tắc "Nhân viên tự chọn món trên app" — mặc định BẬT (như cũ). TẮT = công ty chỉ dùng quy trình trưởng bộ phận báo số → HR duyệt/chốt:
// app ẩn phần chọn món (chỉ trưởng BP thấy tab Suất ăn để nhập số), API chọn món trả 403, màn hình bếp hiện "Có suất ăn" thay cho tên món.
export const selfOrderOn = () => getSetting('meal_self_order', '1') !== '0';
// Công tắc "Có chọn món" — mặc định BẬT (như cũ). TẮT = chế độ CHỈ ĐĂNG KÝ ĂN: NV bấm Có ăn / Không ăn cho từng bữa, không có thực đơn.
export const dishChoiceOn = () => getSetting('meal_dish_choice', '1') !== '0';
// Công tắc "Trưởng bộ phận báo số" — mặc định BẬT (như cũ). TẮT = ẩn trang Đối chiếu & chốt + phần trưởng BP nhập số trên app.
export const deptHeadOn = () => getSetting('meal_dept_head', '1') !== '0';
export const mealOptions = () => ({ self_order: selfOrderOn(), dish_choice: dishChoiceOn(), dept_head: deptHeadOn() });
// Người dùng có được quản lý suất ăn (đối chiếu / chốt / thực đơn / cấu hình) không: phân hệ đã bật + admin / tài khoản tổng / có quyền 'meal'
export function mealAllowed(user) {
  if (!mealEnabled() || !user) return false;
  return hasPerm(user, 'meal');
}
// API suất ăn: tắt → 403 (giống hrGate)
export function mealGate(req, res, next) {
  if (mealEnabled()) return next();
  res.status(403).json({ error: 'Phân hệ Quản lý suất ăn chưa được bật (chỉ tài khoản tổng bật được trong Cài đặt).' });
}
// Trang tĩnh /bep + /suatan/*: tắt → 404 như chưa từng có
export function mealStaticGate(req, res, next) {
  if (mealEnabled()) return next();
  res.status(404).type('text/plain').send('Not found');
}
// Quản lý suất ăn (HR): chặn người không có quyền 'meal'
export function mealManagerOnly(req, res, next) {
  if (mealAllowed(req.user)) return next();
  res.status(403).json({ error: 'Không có quyền dùng chức năng này' });
}

/* ---------------------------- ca ăn ---------------------------- */
// Tạo 3 ca mặc định khi phân hệ được dùng lần đầu (chưa bật thì bảng để trống — DB cũ nguyên vẹn)
export function ensureMealSeed() {
  if (db.prepare('SELECT COUNT(*) n FROM meal_shifts').get().n > 0) return;
  const ins = db.prepare('INSERT OR IGNORE INTO meal_shifts(code, name, from_time, to_time, mode, enabled, sort_order) VALUES (?,?,?,?,?,?,?)');
  for (const s of DEFAULT_MEAL_SHIFTS) ins.run(s.code, s.name, s.from_time, s.to_time, s.mode, s.enabled, s.sort_order);
}
export function listShifts({ onlyEnabled = false } = {}) {
  ensureMealSeed();
  return db.prepare(`SELECT * FROM meal_shifts ${onlyEnabled ? 'WHERE enabled = 1' : ''} ORDER BY sort_order, code`).all();
}
export const getMealShift = (code) => { ensureMealSeed(); return db.prepare('SELECT * FROM meal_shifts WHERE code = ?').get(String(code || '')) || null; };
export function needShift(code) {
  const s = getMealShift(code);
  if (!s) throw userError('Ca ăn không tồn tại', 404);
  return s;
}
export function needDate(d) {
  if (!isIsoDate(d)) throw userError('Ngày không hợp lệ (dạng YYYY-MM-DD)');
  return String(d);
}
// HR THÊM BỮA ĂN mới (VD bữa sáng, bữa phụ ca gãy): mã tự sinh b1, b2…; value đã qua checkShiftConfig
export function createShift(v) {
  ensureMealSeed();
  const used = new Set(db.prepare('SELECT code FROM meal_shifts').all().map((r) => r.code));
  if (used.size >= 12) throw userError('Tối đa 12 bữa ăn');
  let n = 1; while (used.has('b' + n)) n++;
  const code = 'b' + n;
  const so = (db.prepare('SELECT MAX(sort_order) m FROM meal_shifts').get().m || 0) + 1;
  db.prepare(`INSERT INTO meal_shifts(code, name, from_time, to_time, mode, enabled, sort_order, lock_before_min, lock_at, open_at, custom)
    VALUES (?,?,?,?,?,?,?,?,?,?,1)`).run(code, v.name, v.from_time, v.to_time, v.mode, v.enabled, so, v.lock_before_min ?? 0, v.lock_at ?? '', v.open_at ?? '');
  return getMealShift(code);
}
// Xoá bữa HR tự thêm — chỉ khi chưa có dữ liệu (có rồi thì bỏ tích "Bật" để ẩn, giữ lịch sử)
export function deleteShift(code) {
  const s = needShift(code);
  if (!s.custom) throw userError('Bữa mặc định không xoá được — bỏ tích "Bật bữa này" để ẩn');
  const n = ['meal_orders', 'meal_registrations', 'meal_menu', 'meal_extra', 'meal_closings', 'meal_adjust']
    .reduce((t, tb) => t + db.prepare(`SELECT COUNT(*) n FROM ${tb} WHERE shift = ?`).get(s.code).n, 0);
  if (n) throw userError('Bữa này đã có dữ liệu đăng ký / thực đơn — không xoá được, hãy bỏ tích "Bật bữa này" để ẩn', 409);
  db.prepare('DELETE FROM meal_shifts WHERE code = ?').run(s.code);
}

/* ---------------------------- số liệu đối chiếu (chỉ ĐỌC chấm công + đăng ký làm thêm) ---------------------------- */
const serialFilter = () => String(getSetting('meal_serials', '')).split(',').map((s) => s.trim()).filter(Boolean);

// Lượt quẹt thật tại máy chấm công trong khung giờ chốt của ca (loại lượt thêm tay / chấm điện thoại)
function punchRows(workDate, shift) {
  const [a, b] = windowBoundsUtc(workDate, shift);
  const only = serialFilter();
  const notIn = NON_MACHINE_SERIALS.map(() => '?').join(',');
  // lấy RỘNG hơn khung 1 tiếng hai đầu để đếm cả số lượt bị loại (ngoài giờ chốt) cho HR thấy
  const lo = new Date(Date.parse(a) - 3600000).toISOString(), hi = new Date(Date.parse(b) + 3600000).toISOString();
  return db.prepare(`SELECT p.employee_id, p.punch_at, IFNULL(e.department, '') department, e.code, e.full_name FROM device_punches p JOIN employees e ON e.id = p.employee_id
      WHERE p.punch_at >= ? AND p.punch_at <= ? AND p.employee_id IS NOT NULL AND p.serial NOT IN (${notIn})
      ${only.length ? `AND p.serial IN (${only.map(() => '?').join(',')})` : ''}${adminAttWhere('e.role')}`)
    .all(lo, hi, ...NON_MACHINE_SERIALS, ...only);
}
// Đăng ký làm thêm trong ngày, cộng theo bộ phận: số người (phút > 0) + tổng phút
function otByDept(workDate) {
  const out = {};
  for (const r of db.prepare(`SELECT IFNULL(e.department, '') department, COUNT(*) people, SUM(g.minutes) minutes FROM ot_registrations g
      JOIN employees e ON e.id = g.employee_id WHERE g.work_date = ? AND g.minutes > 0${adminAttWhere('e.role')} GROUP BY IFNULL(e.department, '')`).all(workDate))
    out[r.department] = { people: r.people, minutes: r.minutes || 0 };
  return out;
}
function regsOf(workDate, code) {
  const out = {};
  for (const r of db.prepare('SELECT * FROM meal_registrations WHERE work_date = ? AND shift = ?').all(workDate, code)) out[r.department] = r;
  return out;
}
export const closingOf = (workDate, code) => db.prepare('SELECT * FROM meal_closings WHERE work_date = ? AND shift = ?').get(workDate, code) || null;

// Danh sách bộ phận để hiện trên bảng: bộ phận có nhân viên đang làm + bộ phận có số liệu hôm đó
function boardDepts(extra) {
  const set = new Set(db.prepare(`SELECT DISTINCT IFNULL(department, '') d FROM employees WHERE active = 1${adminAttWhere('role')}`).all().map((r) => r.d));
  for (const d of extra) set.add(d);
  return [...set].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'vi')));
}

// Bảng đối chiếu của 1 ngày + 1 ca (HR)
export function loadBoard(workDate, code) {
  const shift = needShift(code);
  const reg = regsOf(workDate, code);
  let punch = {}, ot = {}, outside = 0, totalPeople = 0;
  if (shift.mode === 'punch') {
    const c = countValidPunches(punchRows(workDate, shift), workDate, shift);
    punch = c.byDept; outside = c.outside; totalPeople = c.people;
  } else ot = otByDept(workDate);
  const depts = boardDepts([...Object.keys(reg), ...Object.keys(punch), ...Object.keys(ot)]);
  const board = buildBoard({ mode: shift.mode, depts, punch, ot, reg });
  const closing = closingOf(workDate, code);
  return { date: workDate, shift, board, outside, people: totalPeople, closed: closing ? { by: closing.closed_by, at: closing.closed_at, total: closing.total } : null };
}

/* ---------------------------- đăng ký của bộ phận ---------------------------- */
// Các bộ phận (gồm bộ phận con) mà nhân viên là trưởng
export function headDepartments(empId) {
  const names = db.prepare('SELECT department FROM meal_dept_heads WHERE employee_id = ?').all(empId).map((r) => r.department);
  return { roots: names, all: deptWithChildren(names) };
}

// Danh sách bộ phận hiện cho trưởng bộ phận nhập (gốc + bộ phận con đang có nhân viên), không trùng dạng chữ có dấu NFC / NFD
export function headDeptList(empId) {
  const { roots, all } = headDepartments(empId);
  const allow = new Set(all);
  const seen = new Set(), out = [];
  const add = (n) => { const k = String(n).normalize('NFC'); if (seen.has(k)) return; seen.add(k); out.push(n); };
  for (const n of roots) add(n);
  for (const r of db.prepare("SELECT DISTINCT department d FROM employees WHERE active = 1 AND IFNULL(department, '') <> ''").all()) if (allow.has(r.d)) add(r.d);
  return { roots, allowed: allow, list: out.sort((a, b) => a.localeCompare(b, 'vi')) };
}

// Ghi số đăng ký. items: [{ department, count (rỗng = xoá), note }]. allowed = null (HR: mọi bộ phận) hoặc Set tên bộ phận được phép.
export function saveRegistrations({ workDate, code, items, by, allowed = null }) {
  needDate(workDate); needShift(code);
  if (closingOf(workDate, code)) throw userError('Ca này đã được HR chốt số — HR mở lại mới sửa được', 409);
  const up = db.prepare(`INSERT INTO meal_registrations(department, work_date, shift, count, note, updated_by, updated_at) VALUES (?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(department, work_date, shift) DO UPDATE SET count = excluded.count, note = excluded.note, updated_by = excluded.updated_by, updated_at = excluded.updated_at`);
  const del = db.prepare('DELETE FROM meal_registrations WHERE department = ? AND work_date = ? AND shift = ?');
  const clean = [];
  for (const it of Array.isArray(items) ? items : []) {
    const department = String(it?.department ?? '');
    if (allowed && !allowed.has(department)) throw userError(`Bạn không phải trưởng bộ phận "${department || '(chưa có bộ phận)'}"`, 403);
    const count = parseCount(it.count);
    if (count === undefined) throw userError(`Số suất của "${department || '(chưa có bộ phận)'}" phải là số nguyên từ 0 đến 99999`);
    clean.push({ department, count, note: String(it.note ?? '').slice(0, 200) });
  }
  db.exec('BEGIN');
  try {
    for (const c of clean) { if (c.count == null) del.run(c.department, workDate, code); else up.run(c.department, workDate, code, c.count, c.note, by || ''); }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return clean.length;
}

// HR chốt: lưu ảnh chụp bảng đối chiếu; chốt xong khoá mọi chỉnh sửa số đăng ký của ca đó
export function closeMeal(workDate, code, by) {
  const b = loadBoard(workDate, code);
  if (b.closed) throw userError('Ca này đã được chốt rồi', 409);
  const snap = JSON.stringify({ mode: b.shift.mode, rows: b.board.rows.map((r) => ({ department: r.department, ref: r.ref, registered: r.registered, total: r.total })), totals: b.board.totals });
  db.prepare('INSERT INTO meal_closings(work_date, shift, total, snapshot, closed_by) VALUES (?,?,?,?,?)').run(workDate, code, b.board.totals.total, snap, by || '');
  return loadBoard(workDate, code);
}
export function reopenMeal(workDate, code) {
  db.prepare('DELETE FROM meal_closings WHERE work_date = ? AND shift = ?').run(workDate, code);
}

/* ---------------------------- thực đơn + chọn món ---------------------------- */
export function getMenu(workDate) {
  const out = {};
  for (const r of db.prepare('SELECT id, shift, name FROM meal_menu WHERE work_date = ? ORDER BY sort_order, id').all(workDate)) (out[r.shift] ||= []).push({ id: r.id, name: r.name });
  return out;
}
// Thay danh sách món của 1 ca / 1 ngày. Món giữ nguyên tên thì giữ id (đơn đã chọn vẫn khớp); món bị xoá thì đơn đã chọn giữ tên món nhưng mất liên kết.
export function saveMenu(workDate, code, names) {
  needDate(workDate); needShift(code);
  const want = cleanDishes(names);
  const have = db.prepare('SELECT id, name FROM meal_menu WHERE work_date = ? AND shift = ?').all(workDate, code);
  db.exec('BEGIN');
  try {
    const keep = new Set(want.map((n) => n.toLocaleLowerCase('vi')));
    for (const h of have) if (!keep.has(h.name.toLocaleLowerCase('vi'))) {
      db.prepare('DELETE FROM meal_menu WHERE id = ?').run(h.id);
      db.prepare('UPDATE meal_orders SET menu_id = NULL WHERE menu_id = ?').run(h.id);
    }
    const byName = new Map(have.map((h) => [h.name.toLocaleLowerCase('vi'), h.id]));
    want.forEach((n, i) => {
      const id = byName.get(n.toLocaleLowerCase('vi'));
      if (id) db.prepare('UPDATE meal_menu SET sort_order = ?, name = ? WHERE id = ?').run(i, n, id);
      else db.prepare('INSERT INTO meal_menu(work_date, shift, name, sort_order) VALUES (?,?,?,?)').run(workDate, code, n, i);
    });
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return want.length;
}
// Sao chép thực đơn từ ngày này sang ngày khác (cả 3 ca hoặc 1 ca) — chỉ chép ca ở ngày đích còn TRỐNG
export function copyMenu(fromDate, toDate, code = null) {
  needDate(fromDate); needDate(toDate);
  let n = 0;
  for (const sh of listShifts()) {
    if (code && sh.code !== code) continue;
    const src = db.prepare('SELECT name FROM meal_menu WHERE work_date = ? AND shift = ? ORDER BY sort_order, id').all(fromDate, sh.code).map((r) => r.name);
    const has = db.prepare('SELECT COUNT(*) n FROM meal_menu WHERE work_date = ? AND shift = ?').get(toDate, sh.code).n;
    if (src.length && !has) n += saveMenu(toDate, sh.code, src);
  }
  return n;
}

// Món NV đã chọn + thực đơn cho các ngày [from, to] (app nhân viên)
export function myMealPlan(empId, from, to, now = new Date()) {
  const shifts = listShifts({ onlyEnabled: true });
  const days = [];
  const orders = new Map(db.prepare('SELECT work_date, shift, menu_id, dish, set_by FROM meal_orders WHERE employee_id = ? AND work_date >= ? AND work_date <= ?').all(empId, from, to)
    .map((o) => [o.work_date + '|' + o.shift, o]));
  const menu = new Map();
  for (const r of db.prepare('SELECT id, work_date, shift, name FROM meal_menu WHERE work_date >= ? AND work_date <= ? ORDER BY sort_order, id').all(from, to)) {
    const k = r.work_date + '|' + r.shift; if (!menu.has(k)) menu.set(k, []); menu.get(k).push({ id: r.id, name: r.name });
  }
  for (let d = from; d <= to; d = addDaysIso(d, 1)) {
    days.push({
      date: d,
      shifts: shifts.map((s) => {
        const o = orders.get(d + '|' + s.code);
        const state = orderState(d, s, now);
        return { code: s.code, name: s.name, from_time: s.from_time, to_time: s.to_time, dishes: menu.get(d + '|' + s.code) || [],
          chosen: o ? { menu_id: o.menu_id, dish: o.dish } : null, editable: state === 'open', deadline: orderDeadlineVn(d, s),
          open: orderOpenVn(d, s), state, registered: !!o, set_by: o ? o.set_by : '' };
      }),
    });
  }
  return days;
}
// Chọn (hoặc bỏ chọn khi menuId rỗng) món cho 1 bữa
export function setMyOrder(empId, workDate, code, menuId, now = new Date()) {
  if (!selfOrderOn()) throw userError('Công ty không dùng chức năng nhân viên tự chọn món — trưởng bộ phận đăng ký suất ăn cho bộ phận', 403);
  if (!dishChoiceOn()) throw userError('Công ty không dùng chọn món — chỉ cần bấm "Có ăn" cho từng bữa', 403);
  needDate(workDate);
  const shift = needShift(code);
  if (!shift.enabled) throw userError('Ca ăn này đang tắt');
  if (orderState(workDate, shift, now) === 'wait') throw userError(`Chưa tới giờ mở chọn món cho bữa này (mở lúc ${whenTxt(orderOpenVn(workDate, shift))})`);
  if (!canOrderMeal(workDate, shift, now)) {
    const dl = orderDeadlineVn(workDate, shift);   // 'YYYY-MM-DD HH:MM'
    throw userError(`Đã hết hạn chọn món cho bữa này (hạn ${dl.slice(11)} ngày ${dl.slice(8, 10)}/${dl.slice(5, 7)}) — bếp cần thời gian chuẩn bị`);
  }
  if (menuId == null || menuId === '') { db.prepare('DELETE FROM meal_orders WHERE employee_id = ? AND work_date = ? AND shift = ?').run(empId, workDate, code); return null; }
  const m = db.prepare('SELECT id, name FROM meal_menu WHERE id = ? AND work_date = ? AND shift = ?').get(Number(menuId), workDate, code);
  if (!m) throw userError('Món này không có trong thực đơn của bữa đã chọn');
  db.prepare(`INSERT INTO meal_orders(employee_id, work_date, shift, menu_id, dish, set_by, kitchen_id, created_at, updated_at) VALUES (?,?,?,?,?,'',?,datetime('now'),datetime('now'))
    ON CONFLICT(employee_id, work_date, shift) DO UPDATE SET menu_id = excluded.menu_id, dish = excluded.dish, set_by = '', updated_at = excluded.updated_at`).run(empId, workDate, code, m.id, m.name, empKitchenId(empId));
  return { menu_id: m.id, dish: m.name };
}
// Tổng hợp món theo ca + bộ phận (để bếp chuẩn bị)
export function orderSummary(workDate, code) {
  const rows = db.prepare(`SELECT o.dish, IFNULL(e.department, '') department, COUNT(*) n FROM meal_orders o JOIN employees e ON e.id = o.employee_id
    WHERE o.work_date = ? AND o.shift = ? GROUP BY o.dish, IFNULL(e.department, '') ORDER BY o.dish`).all(workDate, code);
  const dishes = new Map();
  for (const r of rows) { const d = dishes.get(r.dish) || { dish: r.dish, total: 0, byDept: [] }; d.total += r.n; d.byDept.push({ department: r.department, n: r.n }); dishes.set(r.dish, d); }
  return { total: rows.reduce((s, r) => s + r.n, 0), dishes: [...dishes.values()].sort((a, b) => b.total - a.total) };
}

/* ---------------------------- BÁO CÁO SUẤT ĂN + HR CHỈNH TAY (có lưu vết) ---------------------------- */
// Người đã quẹt máy chấm công trong khung giờ chốt (thực tế đã đến ăn): employee_id → { code, full_name, department, at (lượt đầu) }
function punchersOf(workDate, shift) {
  const out = new Map();
  for (const p of punchRows(workDate, shift)) {
    if (!inWindow(p.punch_at, workDate, shift)) continue;
    const o = out.get(p.employee_id);
    if (!o || p.punch_at < o.at) out.set(p.employee_id, { code: p.code, full_name: p.full_name, department: p.department, at: p.punch_at });
  }
  return out;
}
const menuNames = (workDate, code) => db.prepare('SELECT name FROM meal_menu WHERE work_date = ? AND shift = ? ORDER BY sort_order, id').all(workDate, code).map((r) => r.name);
const ordersOf = (workDate, code) => db.prepare(`SELECT o.employee_id, o.dish, o.set_by, o.updated_at, e.code, e.full_name, IFNULL(e.department, '') department
    FROM meal_orders o JOIN employees e ON e.id = o.employee_id WHERE o.work_date = ? AND o.shift = ? ORDER BY e.department, e.code`).all(workDate, code);
const adjustOf = (workDate, code) => db.prepare('SELECT dish, qty, note, updated_by, updated_at FROM meal_adjust WHERE work_date = ? AND shift = ?').all(workDate, code);

// Báo cáo 1 ca của 1 ngày: theo món (NV chọn / HR chọn hộ / HR điều chỉnh / tổng phải nấu / thực tế đã quẹt) + hạn chọn món + trạng thái chốt.
// detail = true → kèm danh sách từng NV (orders) + người đã quẹt (punchers) cho file Excel chi tiết.
export function mealShiftReport(workDate, shift, now = new Date(), { detail = false } = {}) {
  const regs = Object.values(regsOf(workDate, shift.code));
  const registered = regs.length ? regs.reduce((s, r) => s + (r.count || 0), 0) : null;
  const orders = ordersOf(workDate, shift.code), adj = adjustOf(workDate, shift.code), punchers = punchersOf(workDate, shift);
  const rep = buildDishReport({
    menu: menuNames(workDate, shift.code), orders, punchers: new Set(punchers.keys()), registered,
    adjust: Object.fromEntries(adj.map((a) => [a.dish, a.qty])),
  });
  const closing = closingOf(workDate, shift.code);
  return {
    code: shift.code, name: shift.name, from_time: shift.from_time, to_time: shift.to_time, mode: shift.mode,
    deadline: orderDeadlineVn(workDate, shift), locked: !canOrderMeal(workDate, shift, now),
    closed: closing ? { by: closing.closed_by, at: closing.closed_at, total: closing.total } : null,
    adjust_notes: Object.fromEntries(adj.map((a) => [a.dish, { note: a.note, by: a.updated_by, at: a.updated_at }])),
    ...rep, ...(detail ? { orders, punchers } : {}),
  };
}
export const adjustLog = (from, to) => db.prepare('SELECT * FROM meal_adjust_log WHERE work_date >= ? AND work_date <= ? ORDER BY id DESC').all(from, to);
export function mealReport(workDate, now = new Date()) {
  needDate(workDate);
  return { date: workDate, shifts: listShifts({ onlyEnabled: true }).map((s) => mealShiftReport(workDate, s, now)), log: adjustLog(workDate, workDate) };
}

const needReason = (r) => {
  const s = cleanReason(r);
  if (!s) throw userError('Nhập lý do chỉnh sửa (VD: anh A quên đăng ký, điện thoại hỏng…) để lưu vết');
  return s;
};
const logAdjust = (x) => db.prepare(`INSERT INTO meal_adjust_log(by_name, work_date, shift, kind, dish, employee_id, emp_label, old_value, new_value, reason)
  VALUES (?,?,?,?,?,?,?,?,?,?)`).run(x.by || '', x.workDate, x.code, x.kind, x.dish || '', x.employeeId ?? null, x.empLabel || '', String(x.oldValue ?? ''), String(x.newValue ?? ''), x.reason);

// HR điều chỉnh SỐ SUẤT của 1 món (qty = +thêm / −bớt so với số NV chọn; 0 = bỏ điều chỉnh). dish '' = suất không chọn món.
export function setMealAdjust({ workDate, code, dish, qty, reason, by }) {
  needDate(workDate); needShift(code);
  const n = parseAdjust(qty);
  if (n === undefined) throw userError('Số điều chỉnh phải là số nguyên từ −9999 đến 9999 (VD +3 hoặc -2)');
  const why = needReason(reason);
  let d = String(dish ?? '').trim();
  if (d) {
    const known = [...menuNames(workDate, code), ...db.prepare('SELECT DISTINCT dish FROM meal_orders WHERE work_date = ? AND shift = ?').all(workDate, code).map((r) => r.dish),
      ...adjustOf(workDate, code).map((a) => a.dish)];
    const hit = known.find((k) => k && k.toLocaleLowerCase('vi') === d.toLocaleLowerCase('vi'));
    if (!hit) throw userError(`Món "${d}" không có trong thực đơn của bữa này`);
    d = hit;
  }
  const old = db.prepare('SELECT qty FROM meal_adjust WHERE work_date = ? AND shift = ? AND dish = ?').get(workDate, code, d)?.qty || 0;
  if (old === n) throw userError('Số điều chỉnh không đổi');
  db.exec('BEGIN');
  try {
    if (n === 0) db.prepare('DELETE FROM meal_adjust WHERE work_date = ? AND shift = ? AND dish = ?').run(workDate, code, d);
    else db.prepare(`INSERT INTO meal_adjust(work_date, shift, dish, qty, note, updated_by, updated_at) VALUES (?,?,?,?,?,?,datetime('now'))
      ON CONFLICT(work_date, shift, dish) DO UPDATE SET qty = excluded.qty, note = excluded.note, updated_by = excluded.updated_by, updated_at = excluded.updated_at`).run(workDate, code, d, n, why, by || '');
    logAdjust({ by, workDate, code, kind: 'adjust', dish: d, oldValue: old, newValue: n, reason: why });
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { dish: d, qty: n };
}

// HR chọn món HỘ 1 nhân viên (không bị hạn chọn món chặn) — menuId rỗng = bỏ món của NV đó. Màn hình bếp hiện món này khi NV quẹt.
export function hrSetOrder({ workDate, code, employeeId, menuId, reason, by }) {
  needDate(workDate);
  const shift = needShift(code);
  if (!shift.enabled) throw userError('Ca ăn này đang tắt');
  const emp = db.prepare('SELECT id, code, full_name FROM employees WHERE id = ?').get(Number(employeeId));
  if (!emp) throw userError('Không tìm thấy nhân viên');
  const why = needReason(reason);
  const label = emp.code ? `${emp.code} - ${emp.full_name}` : emp.full_name;
  const old = db.prepare('SELECT dish FROM meal_orders WHERE employee_id = ? AND work_date = ? AND shift = ?').get(emp.id, workDate, code)?.dish || '';
  let m = null;
  if (menuId != null && menuId !== '') {
    m = db.prepare('SELECT id, name FROM meal_menu WHERE id = ? AND work_date = ? AND shift = ?').get(Number(menuId), workDate, code);
    if (!m) throw userError('Món này không có trong thực đơn của bữa đã chọn');
  }
  if ((m?.name || '') === old) throw userError(m ? 'Nhân viên này đã chọn đúng món đó rồi' : 'Nhân viên này chưa chọn món nào');
  db.exec('BEGIN');
  try {
    if (!m) db.prepare('DELETE FROM meal_orders WHERE employee_id = ? AND work_date = ? AND shift = ?').run(emp.id, workDate, code);
    else db.prepare(`INSERT INTO meal_orders(employee_id, work_date, shift, menu_id, dish, set_by, kitchen_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,datetime('now'),datetime('now'))
      ON CONFLICT(employee_id, work_date, shift) DO UPDATE SET menu_id = excluded.menu_id, dish = excluded.dish, set_by = excluded.set_by, updated_at = excluded.updated_at`)
      .run(emp.id, workDate, code, m.id, m.name, by || 'HR', empKitchenId(emp.id));
    logAdjust({ by, workDate, code, kind: 'order', dish: m?.name || old, employeeId: emp.id, empLabel: label, oldValue: old, newValue: m?.name || '', reason: why });
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { employee: label, dish: m?.name || null };
}

// Tìm nhân viên (mã / tên, không phân biệt dấu) để HR chọn món hộ; kèm món NV đang chọn của ngày + ca đó
const noAccent = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
// all = true: ô tìm để trống → trả CẢ danh sách NV (bấm vào ô là hiện danh sách, giao diện tự lọc khi gõ)
export function mealEmpSearch(q, workDate, code, { all = false } = {}) {
  const k = noAccent(q).trim();
  if (!k && !all) return [];
  const cur = new Map(db.prepare('SELECT employee_id, dish, set_by FROM meal_orders WHERE work_date = ? AND shift = ?').all(workDate, code).map((o) => [o.employee_id, o]));
  const km = empKitchenMap();
  return db.prepare(`SELECT id, code, full_name, IFNULL(department, '') department FROM employees WHERE active = 1${adminAttWhere('role')} ORDER BY code`).all()
    .filter((e) => !k || noAccent(e.code).includes(k) || noAccent(e.full_name).includes(k)).slice(0, k ? 20 : Infinity)
    .map((e) => ({ ...e, dish: cur.get(e.id)?.dish || null, set_by: cur.get(e.id)?.set_by || '', registered: cur.has(e.id), kitchen_id: km.get(e.id) ?? null }));
}

/* ---------------------------- màn hình bếp ---------------------------- */
// Mã riêng của màn hình bếp (trình duyệt bếp không đăng nhập; HR đổi mã được → mã cũ vô hiệu).
// Mã NGẮN 6 ký tự dễ gõ (bỏ chữ dễ nhầm O/0, I/1, L); không phân biệt hoa thường. Dò mã bị chặn theo IP ở routes/meal.js.
// Mã CHUNG (meal_kitchen_key) = mọi bếp; mỗi bếp (meal_kitchens.screen_key) có mã RIÊNG chỉ hiện người của bếp đó.
const KEY_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const randKey = () => Array.from({ length: 6 }, () => KEY_CHARS[randomInt(KEY_CHARS.length)]).join('');
export function kitchenKey({ renew = false } = {}) {
  let k = getSetting('meal_kitchen_key', '');
  if (!k || renew) {
    const used = new Set(db.prepare('SELECT screen_key FROM meal_kitchens').all().map((r) => r.screen_key.toUpperCase()));
    do k = randKey(); while (used.has(k));
    setSetting('meal_kitchen_key', k);
  }
  return k;
}
// Màn hình bếp mở bằng mã nào → { kitchen: null } (mã chung, mọi bếp) · { kitchen: <bếp> } (mã riêng) · null (sai mã)
export function kitchenScope(given) {
  if (typeof given !== 'string' || !given.trim()) return null;
  const b = Buffer.from(given.trim().toUpperCase());
  const same = (k) => { const a = Buffer.from(String(k || '').toUpperCase()); return a.length > 0 && a.length === b.length && timingSafeEqual(a, b); };
  if (same(getSetting('meal_kitchen_key', ''))) return { kitchen: null };
  for (const k of db.prepare("SELECT * FROM meal_kitchens WHERE screen_key <> ''").all()) if (same(k.screen_key)) return { kitchen: k };
  return null;
}
export const kitchenKeyOk = (given) => kitchenScope(given) != null;

// Lượt quẹt mới (id > sinceId) trong 3 giờ qua, mỗi lượt gắn tên NV + món đã chọn (hoặc "có đăng ký ăn") của đúng bữa ăn lượt quẹt đó thuộc về.
// Lượt quẹt ngoài mọi khung giờ chốt không phải bữa ăn → bỏ qua (nhưng vẫn đẩy `last_id` lên để lần sau không quét lại).
// Màn hình của 1 bếp: bếp có gán máy → chỉ lượt quẹt ở máy đó; chưa gán máy → chỉ người được phân vào bếp đó.
// Quẹt ở máy của bếp A mà NV thuộc bếp B → wrong_kitchen (màn hình cảnh báo).
export function kitchenFeed(sinceId = 0, now = new Date(), scope = { kitchen: null }) {
  const shifts = listShifts({ onlyEnabled: true });
  const since = new Date(now.getTime() - 3 * 3600000).toISOString();
  const notIn = NON_MACHINE_SERIALS.map(() => '?').join(',');
  const kit = scope?.kitchen || null;
  const kitSerials = kit ? String(kit.serials || '').split(',').map((s) => s.trim()).filter(Boolean) : [];
  const only = kitSerials.length ? kitSerials : serialFilter();
  const byEmp = !!kit && !kitSerials.length;
  const rows = db.prepare(`SELECT p.id, p.punch_at, p.serial, p.employee_id, e.code, e.full_name, IFNULL(e.department, '') department
      FROM device_punches p JOIN employees e ON e.id = p.employee_id
      WHERE p.id > ? AND p.punch_at >= ? AND p.punch_at <= ? AND p.serial NOT IN (${notIn})${only.length ? ` AND p.serial IN (${only.map(() => '?').join(',')})` : ''}
      ${byEmp ? 'AND p.employee_id IN (SELECT employee_id FROM meal_emp_kitchen WHERE kitchen_id = ?)' : ''}
      ORDER BY p.id DESC LIMIT 80`).all(Number(sinceId) || 0, since, new Date(now.getTime() + 5 * 60000).toISOString(), ...NON_MACHINE_SERIALS, ...only, ...(byEmp ? [kit.id] : []));
  const kitchens = listKitchens();
  const kName = new Map(kitchens.map((k) => [k.id, k.name]));
  const serialK = new Map();
  for (const k of kitchens) for (const s of String(k.serials || '').split(',').map((x) => x.trim()).filter(Boolean)) serialK.set(s, k.id);
  const km = kitchens.length ? empKitchenMap() : new Map();
  const events = [];
  for (const r of rows) {
    const hit = shiftForPunch(r.punch_at, shifts);
    if (!hit) continue;
    const [a, b] = windowBoundsUtc(hit.workDate, hit.shift);
    const times = db.prepare(`SELECT COUNT(*) n FROM device_punches WHERE employee_id = ? AND punch_at >= ? AND punch_at <= ? AND id <= ? AND serial NOT IN (${notIn})`)
      .get(r.employee_id, a, b, r.id, ...NON_MACHINE_SERIALS).n;
    const o = db.prepare('SELECT dish FROM meal_orders WHERE employee_id = ? AND work_date = ? AND shift = ?').get(r.employee_id, hit.workDate, hit.shift.code);
    const empK = km.get(r.employee_id) ?? null, machK = serialK.get(r.serial) ?? null;
    events.push({ id: r.id, at: r.punch_at, code: r.code, name: r.full_name, department: r.department, shift: hit.shift.code, shift_name: hit.shift.name, work_date: hit.workDate,
      dish: o ? o.dish : null, registered: !!o, times, kitchen_name: empK ? kName.get(empK) || '' : '', wrong_kitchen: !!(empK && machK && empK !== machK) });
    if (events.length >= 25) break;
  }
  return { now: now.toISOString(), last_id: rows.length ? rows[0].id : Number(sinceId) || 0, events, self_order: selfOrderOn(), dish_choice: dishChoiceOn(),
    kitchen: kit ? { id: kit.id, name: kit.name } : null, board: kitchenBoard(scope, now) };
}

// SỐ SUẤT CHO BẾP (ô trên đầu màn hình bếp): tối đa 3 bữa sắp tới / đang ăn — tổng phải nấu của bếp này (hoặc mọi bếp),
// trạng thái đăng ký (đang mở / đã khoá lúc…), số HR đã "Gửi bếp" + giờ gửi. Chỉ khi NV tự đăng ký trên app (tắt = như cũ, không có ô này).
export function kitchenBoard(scope = { kitchen: null }, now = new Date()) {
  if (!selfOrderOn()) return [];
  const kid = scope?.kitchen ? scope.kitchen.id : null;
  const shifts = listShifts({ onlyEnabled: true });
  const today = vnNow(now).date, nowIso = now.toISOString();
  const cands = [];
  for (const d of [addDaysIso(today, -1), today, addDaysIso(today, 1)]) for (const s of shifts) {
    const [a, b] = windowBoundsUtc(d, s);
    if (b >= nowIso) cands.push({ d, s, a });
  }
  cands.sort((x, y) => (x.a < y.a ? -1 : x.a > y.a ? 1 : 0));
  const dish = dishChoiceOn();
  const kf = kid != null ? ' AND COALESCE(o.kitchen_id, m.kitchen_id) = ?' : '';
  const kp = kid != null ? [kid] : [];
  return cands.slice(0, 3).map(({ d, s }) => {
    const from = 'FROM meal_orders o LEFT JOIN meal_emp_kitchen m ON m.employee_id = o.employee_id WHERE o.work_date = ? AND o.shift = ?' + kf;
    const signed = db.prepare(`SELECT COUNT(*) n ${from}`).get(d, s.code, ...kp).n;
    let extra = db.prepare(`SELECT IFNULL(SUM(qty), 0) q FROM meal_extra WHERE work_date = ? AND shift = ?${kid != null ? ' AND kitchen_id = ?' : ''}`).get(d, s.code, ...kp).q;
    if (dish && kid == null) extra += db.prepare('SELECT IFNULL(SUM(qty), 0) q FROM meal_adjust WHERE work_date = ? AND shift = ?').get(d, s.code).q;
    const dishes = dish ? db.prepare(`SELECT o.dish, COUNT(*) n ${from} GROUP BY o.dish ORDER BY n DESC LIMIT 8`).all(d, s.code, ...kp).map((r) => ({ dish: r.dish || 'Không chọn món', n: r.n })) : [];
    const disp = dispatchOf(d, s.code);
    return { date: d, code: s.code, name: s.name, from_time: s.from_time, to_time: s.to_time, state: orderState(d, s, now), open: orderOpenVn(d, s), deadline: orderDeadlineVn(d, s),
      total: Math.max(0, signed + extra), signed, extra, dishes, sent: disp ? (kid != null ? disp.detail[kid] ?? null : disp.total) : null, sent_at: disp ? disp.sent_at : '' };
  });
}

/* ---------------------------- BẾP (nhiều bếp) + phân nhân viên vào bếp ---------------------------- */
export const listKitchens = () => db.prepare(`SELECT k.*, (SELECT COUNT(*) FROM meal_emp_kitchen m JOIN employees e ON e.id = m.employee_id
    WHERE m.kitchen_id = k.id AND e.active = 1) people FROM meal_kitchens k ORDER BY k.sort_order, k.id`).all();
export const empKitchenMap = () => new Map(db.prepare('SELECT employee_id, kitchen_id FROM meal_emp_kitchen').all().map((r) => [r.employee_id, r.kitchen_id]));
export const empKitchenId = (empId) => db.prepare('SELECT kitchen_id FROM meal_emp_kitchen WHERE employee_id = ?').get(empId)?.kitchen_id ?? null;
const needKitchen = (id) => { const k = db.prepare('SELECT * FROM meal_kitchens WHERE id = ?').get(Number(id)); if (!k) throw userError('Không tìm thấy bếp', 404); return k; };
const kitchenName = (id) => (id ? db.prepare('SELECT name FROM meal_kitchens WHERE id = ?').get(id)?.name || `Bếp #${id}` : '');
const cleanSerials = (list) => [...new Set((Array.isArray(list) ? list : String(list || '').split(',')).map((x) => String(x).trim()).filter(Boolean))].slice(0, 50).join(',');
function newScreenKey() {
  const used = new Set([getSetting('meal_kitchen_key', '').toUpperCase(), ...db.prepare('SELECT screen_key FROM meal_kitchens').all().map((r) => r.screen_key.toUpperCase())]);
  let k; do k = randKey(); while (used.has(k));
  return k;
}
// Thêm (không có id) / sửa bếp: tên + máy chấm ăn đặt ở bếp (serials null = giữ nguyên)
export function saveKitchen({ id, name, serials }) {
  const n = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!n) throw userError('Tên bếp không được để trống');
  if (db.prepare('SELECT id FROM meal_kitchens WHERE lower(name) = lower(?) AND id <> ?').get(n, Number(id) || 0)) throw userError(`Đã có bếp tên "${n}"`);
  const ser = serials == null ? null : cleanSerials(serials);
  if (id) {
    const k = needKitchen(id);
    db.prepare('UPDATE meal_kitchens SET name = ?, serials = ? WHERE id = ?').run(n, ser ?? k.serials, k.id);
    return needKitchen(k.id);
  }
  if (db.prepare('SELECT COUNT(*) n FROM meal_kitchens').get().n >= 20) throw userError('Tối đa 20 bếp');
  const so = (db.prepare('SELECT MAX(sort_order) m FROM meal_kitchens').get().m || 0) + 1;
  return needKitchen(db.prepare('INSERT INTO meal_kitchens(name, serials, screen_key, sort_order) VALUES (?,?,?,?)').run(n, ser ?? '', newScreenKey(), so).lastInsertRowid);
}
// Xoá bếp: NV của bếp đó thành "chưa phân bếp"; đơn từ hôm nay trở đi bỏ gắn bếp (ngày đã qua giữ nguyên)
export function deleteKitchen(id) {
  const k = needKitchen(id);
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM meal_emp_kitchen WHERE kitchen_id = ?').run(k.id);
    db.prepare('UPDATE meal_orders SET kitchen_id = NULL WHERE kitchen_id = ? AND work_date >= ?').run(k.id, vnNow().date);
    db.prepare('DELETE FROM meal_kitchens WHERE id = ?').run(k.id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
export function renewKitchenKey(id) {
  const k = needKitchen(id);
  db.prepare('UPDATE meal_kitchens SET screen_key = ? WHERE id = ?').run(newScreenKey(), k.id);
  return needKitchen(k.id);
}
// Danh sách NV (id) = cả bộ phận `department` (gồm bộ phận con, chỉ NV đang làm)
//   ∪ các bộ phận trong `departments` (đúng tên, không tự lấy con; '' = chưa có bộ phận) ∪ danh sách id gửi lên (chỉ giữ id có thật)
function pickEmployees(employeeIds, department, departments) {
  const out = new Set();
  const names = department != null && String(department) !== '' ? deptWithChildren([String(department)]) : [];
  let none = false;
  for (const d of Array.isArray(departments) ? departments : []) {
    const s = String(d ?? '').trim();
    if (!s) none = true; else names.push(s.normalize('NFC'), s.normalize('NFD'));
  }
  if (names.length || none) {
    const cond = [names.length ? `IFNULL(department, '') IN (${names.map(() => '?').join(',')})` : '', none ? `IFNULL(department, '') = ''` : ''].filter(Boolean).join(' OR ');
    for (const r of db.prepare(`SELECT id FROM employees WHERE active = 1${adminAttWhere('role')} AND (${cond}) ORDER BY code`).all(...names)) out.add(r.id);
  }
  const want = [...new Set((Array.isArray(employeeIds) ? employeeIds : []).map(Number).filter((x) => Number.isInteger(x) && x > 0))];
  for (let i = 0; i < want.length; i += 500) {
    const part = want.slice(i, i + 500);
    for (const r of db.prepare(`SELECT id FROM employees WHERE id IN (${part.map(() => '?').join(',')})`).all(...part)) out.add(r.id);
  }
  return [...out];
}
// Phân NV vào bếp (kitchenId 0 = bỏ phân bếp) theo danh sách người và/hoặc bộ phận.
// Đơn đăng ký từ HÔM NAY trở đi của những NV này đổi theo bếp mới (ngày đã qua giữ nguyên để báo cáo cũ không đổi).
export function assignKitchen({ kitchenId, employeeIds, department, departments }) {
  const kid = Number(kitchenId) || 0;
  if (kid) needKitchen(kid);
  const ids = pickEmployees(employeeIds, department, departments);
  if (!ids.length) throw userError('Chưa chọn nhân viên nào');
  const today = vnNow().date;
  db.exec('BEGIN');
  try {
    for (const id of ids) {
      if (kid) db.prepare('INSERT INTO meal_emp_kitchen(employee_id, kitchen_id) VALUES (?,?) ON CONFLICT(employee_id) DO UPDATE SET kitchen_id = excluded.kitchen_id').run(id, kid);
      else db.prepare('DELETE FROM meal_emp_kitchen WHERE employee_id = ?').run(id);
      db.prepare('UPDATE meal_orders SET kitchen_id = ? WHERE employee_id = ? AND work_date >= ?').run(kid || null, id, today);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return ids.length;
}
// Số NV đang làm theo bộ phận × bếp (để HR nhìn bộ phận nào đã phân bếp): [{ department, total, by: { <kitchen_id | 0>: số người } }]
export function kitchenDeptMap() {
  const out = new Map();
  for (const r of db.prepare(`SELECT IFNULL(e.department, '') department, IFNULL(m.kitchen_id, 0) k, COUNT(*) n FROM employees e
      LEFT JOIN meal_emp_kitchen m ON m.employee_id = e.id WHERE e.active = 1${adminAttWhere('e.role')} GROUP BY 1, 2`).all()) {
    const d = out.get(r.department) || { department: r.department, total: 0, by: {} };
    d.total += r.n; d.by[r.k] = (d.by[r.k] || 0) + r.n; out.set(r.department, d);
  }
  return [...out.values()].sort((a, b) => (a.department === '' ? 1 : b.department === '' ? -1 : a.department.localeCompare(b.department, 'vi')));
}
// NV đang làm của 1 bộ phận (không gồm bộ phận con) + bếp đang phân
export const kitchenDeptEmployees = (department) => db.prepare(`SELECT e.id, e.code, e.full_name, IFNULL(m.kitchen_id, 0) kitchen_id FROM employees e
    LEFT JOIN meal_emp_kitchen m ON m.employee_id = e.id WHERE e.active = 1${adminAttWhere('e.role')} AND IFNULL(e.department, '') = ? ORDER BY e.code`).all(String(department ?? ''));
// Mọi NV đang làm (bộ phận + bếp đang phân) + danh mục bộ phận cha–con — cho màn "Phân nhân viên vào bếp" kiểu xếp lịch trình ca
export const kitchenAllEmployees = () => ({
  rows: db.prepare(`SELECT e.id, e.code, e.full_name, IFNULL(e.department, '') department, IFNULL(m.kitchen_id, 0) kitchen_id FROM employees e
    LEFT JOIN meal_emp_kitchen m ON m.employee_id = e.id WHERE e.active = 1${adminAttWhere('e.role')} ORDER BY e.code`).all(),
  departments: db.prepare('SELECT id, name, parent_id FROM departments').all(),
});

/* ---------------------------- ĐĂNG KÝ ĂN (không chọn món) ---------------------------- */
// 'YYYY-MM-DD HH:MM' → 'HH:MM ngày dd/mm'
const whenTxt = (v) => (v ? `${v.slice(11)} ngày ${v.slice(8, 10)}/${v.slice(5, 7)}` : '');
const orderRow = (empId, d, code) => db.prepare('SELECT * FROM meal_orders WHERE employee_id = ? AND work_date = ? AND shift = ?').get(empId, d, code);
const insSignup = (empId, d, code, by) => db.prepare(`INSERT INTO meal_orders(employee_id, work_date, shift, menu_id, dish, set_by, kitchen_id, created_at, updated_at)
  VALUES (?,?,?,NULL,'',?,?,datetime('now'),datetime('now')) ON CONFLICT(employee_id, work_date, shift) DO NOTHING`).run(empId, d, code, by || '', empKitchenId(empId));

// NV tự bấm Có ăn (on) / Không ăn cho 1 bữa — chỉ trong giờ mở đăng ký, trước giờ khoá
export function setMySignup(empId, workDate, code, on, now = new Date()) {
  if (!selfOrderOn()) throw userError('Công ty không cho nhân viên tự đăng ký suất ăn trên app — trưởng bộ phận / HR đăng ký giúp', 403);
  if (dishChoiceOn()) throw userError('Công ty đang dùng chọn món — chọn món để đăng ký suất ăn');
  needDate(workDate);
  const shift = needShift(code);
  if (!shift.enabled) throw userError('Bữa ăn này đang tắt');
  const st = orderState(workDate, shift, now);
  if (st === 'wait') throw userError(`Chưa tới giờ mở đăng ký bữa ${shift.name.toLowerCase()} (mở lúc ${whenTxt(orderOpenVn(workDate, shift))})`);
  if (st === 'locked') throw userError(`Đã khoá đăng ký bữa ${shift.name.toLowerCase()} (hạn ${whenTxt(orderDeadlineVn(workDate, shift))}) — cần đăng ký / huỷ thì báo HR`);
  if (on) insSignup(empId, workDate, code, '');
  else db.prepare('DELETE FROM meal_orders WHERE employee_id = ? AND work_date = ? AND shift = ?').run(empId, workDate, code);
  return { registered: !!orderRow(empId, workDate, code) };
}

// HR ĐĂNG KÝ / HUỶ HỘ (quên báo, điện thoại hỏng…) — không bị giờ mở / khoá chặn, bắt buộc lý do, lưu vết từng người.
// employeeIds hoặc department (cả bộ phận). Người đã đăng ký rồi (khi on) / chưa đăng ký (khi off) thì bỏ qua.
export function hrSetSignup({ workDate, code, employeeIds, department, on, reason, by }) {
  needDate(workDate);
  const shift = needShift(code);
  if (!shift.enabled) throw userError('Bữa ăn này đang tắt');
  const why = needReason(reason);
  const ids = pickEmployees(employeeIds, department);
  if (!ids.length) throw userError('Chưa chọn nhân viên nào');
  if (ids.length > 5000) throw userError('Tối đa 5.000 nhân viên mỗi lần');
  let changed = 0, skipped = 0;
  db.exec('BEGIN');
  try {
    for (const id of ids) {
      const emp = db.prepare('SELECT id, code, full_name FROM employees WHERE id = ?').get(id);
      const cur = orderRow(emp.id, workDate, shift.code);
      if (on ? cur : !cur) { skipped++; continue; }
      if (on) insSignup(emp.id, workDate, shift.code, by || 'HR');
      else db.prepare('DELETE FROM meal_orders WHERE employee_id = ? AND work_date = ? AND shift = ?').run(emp.id, workDate, shift.code);
      logAdjust({ by, workDate, code: shift.code, kind: 'signup', dish: cur?.dish || '', employeeId: emp.id, empLabel: emp.code ? `${emp.code} - ${emp.full_name}` : emp.full_name,
        oldValue: on ? '' : 'Có ăn', newValue: on ? 'Có ăn' : '', reason: why });
      changed++;
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { changed, skipped };
}

// HR THÊM / BỚT SUẤT bằng tay theo bếp (qty = +thêm / −bớt; 0 = bỏ) — bắt buộc lý do, lưu vết
export function setMealExtra({ workDate, code, kitchenId, qty, reason, by }) {
  needDate(workDate); needShift(code);
  const n = parseAdjust(qty);
  if (n === undefined) throw userError('Số suất thêm / bớt phải là số nguyên từ −9999 đến 9999 (VD 5 hoặc -2)');
  const why = needReason(reason);
  const kid = Number(kitchenId) || 0;
  if (kid) needKitchen(kid);
  const old = db.prepare('SELECT qty FROM meal_extra WHERE work_date = ? AND shift = ? AND kitchen_id = ?').get(workDate, code, kid)?.qty || 0;
  if (old === n) throw userError('Số suất thêm / bớt không đổi');
  db.exec('BEGIN');
  try {
    if (n === 0) db.prepare('DELETE FROM meal_extra WHERE work_date = ? AND shift = ? AND kitchen_id = ?').run(workDate, code, kid);
    else db.prepare(`INSERT INTO meal_extra(work_date, shift, kitchen_id, qty, note, updated_by, updated_at) VALUES (?,?,?,?,?,?,datetime('now'))
      ON CONFLICT(work_date, shift, kitchen_id) DO UPDATE SET qty = excluded.qty, note = excluded.note, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .run(workDate, code, kid, n, why, by || '');
    logAdjust({ by, workDate, code, kind: 'extra', dish: kitchenName(kid), oldValue: old, newValue: n, reason: why });
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { kitchen_id: kid, qty: n };
}

/* ---------------------------- tổng hợp đăng ký ăn theo bếp (1 ngày) + GỬI BẾP ---------------------------- */
const ordersFull = (workDate, code) => db.prepare(`SELECT o.employee_id, o.dish, o.set_by, o.kitchen_id, o.created_at, o.updated_at, e.code, e.full_name, IFNULL(e.department, '') department
    FROM meal_orders o JOIN employees e ON e.id = o.employee_id WHERE o.work_date = ? AND o.shift = ? ORDER BY e.department, e.code`).all(workDate, code);
const extraOf = (workDate, code) => db.prepare('SELECT kitchen_id, qty, note, updated_by, updated_at FROM meal_extra WHERE work_date = ? AND shift = ?').all(workDate, code);
export function dispatchOf(workDate, code) {
  const r = db.prepare('SELECT * FROM meal_dispatch WHERE work_date = ? AND shift = ?').get(workDate, code);
  if (!r) return null;
  let detail = {}; try { detail = JSON.parse(r.detail) || {}; } catch { /* hỏng thì coi như trống */ }
  return { total: r.total, detail, first_at: r.first_at, sent_at: r.sent_at, sent_by: r.sent_by };
}

// 1 bữa của 1 ngày: số đăng ký theo bếp (NV tự / HR hộ / HR thêm tay / tổng / đã quẹt / ĐK mà không quẹt / quẹt mà không ĐK) + giờ mở, khoá, gửi bếp.
// detail = true → kèm danh sách người đăng ký (giờ đăng ký, ai đăng ký, đã quẹt lúc) + người quẹt mà không đăng ký.
export function mealSignupReport(workDate, shift, now = new Date(), { detail = false } = {}) {
  const kitchens = listKitchens(), km = empKitchenMap();
  const orders = ordersFull(workDate, shift.code), punchers = punchersOf(workDate, shift), ex = extraOf(workDate, shift.code);
  const rep = buildSignupReport({ orders, punchers: new Set(punchers.keys()), extra: Object.fromEntries(ex.map((x) => [x.kitchen_id, x.qty])), kitchens, kitchenOf: (id) => km.get(id) ?? 0 });
  const out = {
    code: shift.code, name: shift.name, from_time: shift.from_time, to_time: shift.to_time, enabled: shift.enabled,
    open: orderOpenVn(workDate, shift), deadline: orderDeadlineVn(workDate, shift), state: orderState(workDate, shift, now), ended: mealEnded(workDate, shift, now),
    dispatch: dispatchOf(workDate, shift.code), extra_notes: Object.fromEntries(ex.map((x) => [x.kitchen_id, { qty: x.qty, note: x.note, by: x.updated_by, at: x.updated_at }])), ...rep,
  };
  if (detail) {
    const known = new Set(kitchens.map((k) => k.id));
    const kOf = (empId, v) => { const x = v ?? km.get(empId) ?? 0; return known.has(x) ? x : 0; };
    const signed = new Set(orders.map((o) => o.employee_id));
    out.list = orders.map((o) => ({ employee_id: o.employee_id, code: o.code, full_name: o.full_name, department: o.department, kitchen_id: kOf(o.employee_id, o.kitchen_id),
      dish: o.dish, set_by: o.set_by, at: o.created_at || o.updated_at, punched: punchers.get(o.employee_id)?.at || '' }));
    out.walk_in = [...punchers].filter(([id]) => !signed.has(id)).map(([id, p]) => ({ employee_id: id, code: p.code, full_name: p.full_name, department: p.department, kitchen_id: kOf(id, null), punched: p.at }));
  }
  return out;
}
// Trang "Đăng ký ăn" (HR): mọi bữa đang bật của 1 ngày (bữa đang xem kèm danh sách) + lịch sử chỉnh tay trong ngày
export function signupDay(workDate, code, now = new Date()) {
  needDate(workDate);
  const shifts = listShifts({ onlyEnabled: true });
  const cur = shifts.find((s) => s.code === code) || shifts[0] || null;
  return {
    date: workDate, kitchens: listKitchens(), options: mealOptions(), current: cur ? cur.code : null, log: adjustLog(workDate, workDate),
    shifts: shifts.map((s) => mealSignupReport(workDate, s, now, { detail: s === cur })),
  };
}

const WD_VN = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
const dmyTxt = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
// datetime('now') của SQLite (UTC) → 'HH:MM dd/mm' giờ VN
const stampVn = (s) => { if (!s) return ''; const t = new Date(Date.parse(s.replace(' ', 'T') + 'Z') + 7 * 3600000).toISOString(); return `${t.slice(11, 16)} ${t.slice(8, 10)}/${t.slice(5, 7)}`; };
// GỬI BẾP: chụp số suất của bữa (tổng + từng bếp) → màn hình bếp hiện "HR đã gửi … lúc …"; trả kèm tin nhắn để HR dán Zalo cho bếp.
// Gửi lại được (số mới đè số cũ, giữ giờ gửi lần đầu). preview = true: chỉ tính + soạn tin nhắn để HR xem trước, KHÔNG ghi gì.
export function sendToKitchen({ workDate, code, by, now = new Date(), preview = false }) {
  needDate(workDate);
  const shift = needShift(code);
  const rep = mealSignupReport(workDate, shift, now);
  const detail = Object.fromEntries(rep.rows.map((r) => [r.kitchen_id, r.total]));
  let total = rep.totals.total;
  const dishLines = [];
  if (dishChoiceOn()) {   // chế độ chọn món: tổng theo trang Tổng hợp (gồm số trưởng BP báo + HR điều chỉnh) + số theo món
    const d = mealShiftReport(workDate, shift, now);
    total = d.totals.total;
    for (const x of d.rows) if (x.total) dishLines.push(`${x.dish}: ${x.total}`);
    if (d.default.total) dishLines.push(`Không chọn món: ${d.default.total}`);
  }
  const prev = dispatchOf(workDate, shift.code);   // lần gửi trước (nếu có) — bản xem trước hiện để HR so
  if (!preview) db.prepare(`INSERT INTO meal_dispatch(work_date, shift, total, detail, sent_by) VALUES (?,?,?,?,?)
    ON CONFLICT(work_date, shift) DO UPDATE SET total = excluded.total, detail = excluded.detail, sent_by = excluded.sent_by, sent_at = datetime('now')`)
    .run(workDate, shift.code, total, JSON.stringify(detail), by || '');
  const disp = preview ? prev : dispatchOf(workDate, shift.code);
  const kitchenRows = rep.rows.some((r) => r.kitchen_id) ? rep.rows.filter((r) => r.total || r.kitchen_id).map((r) => ({ kitchen_id: r.kitchen_id, name: r.name, total: r.total })) : [];
  const lines = [`BÁO SUẤT ĂN — Bữa ${shift.name.toLowerCase()} ${WD_VN[new Date(workDate + 'T12:00:00Z').getUTCDay()]} ${dmyTxt(workDate)}`];
  for (const r of kitchenRows) lines.push(`• ${r.name}: ${r.total} suất`);
  if (dishLines.length) lines.push('Theo món: ' + dishLines.join(' · '));
  lines.push(`TỔNG: ${total} suất`);
  lines.push(`${rep.state === 'locked' ? 'Đã khoá đăng ký lúc' : 'Số tạm — đăng ký còn mở đến'} ${whenTxt(rep.deadline)} · ${preview ? 'bản xem trước, chưa gửi' : 'gửi lúc ' + stampVn(disp.sent_at) + (by ? ' (' + by + ')' : '')}`);
  return { preview, total, detail, kitchens: kitchenRows, dishes: dishLines, state: rep.state, deadline: rep.deadline,
    prev: prev ? { total: prev.total, sent_at: prev.sent_at } : null,
    sent_at: preview ? null : disp.sent_at, first_at: disp?.first_at || null, message: lines.join('\n') };
}

/* ---------------------------- BÁO CÁO theo khoảng ngày ---------------------------- */
const groupBy = (rows, f) => { const m = new Map(); for (const r of rows) { const k = f(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
export function needRange(from, to, max) {
  needDate(from); needDate(to);
  if (to < from) throw userError('"Đến ngày" phải sau "Từ ngày"');
  if (Date.parse(to) - Date.parse(from) > (max - 1) * 86400000) throw userError(`Tối đa ${max} ngày mỗi lần`);
}
// Người đã quẹt máy chấm ăn theo từng (ngày, bữa) trong khoảng — 1 truy vấn cho cả khoảng: `${ngày}|${mã bữa}` → Map(employee_id → { code, full_name, department, at })
function punchersRange(from, to, shifts) {
  const out = new Map();
  if (!shifts.length) return out;
  let lo = null, hi = null;
  for (const s of shifts) { const a = windowBoundsUtc(from, s)[0], b = windowBoundsUtc(to, s)[1]; if (!lo || a < lo) lo = a; if (!hi || b > hi) hi = b; }
  const only = serialFilter();
  const notIn = NON_MACHINE_SERIALS.map(() => '?').join(',');
  const rows = db.prepare(`SELECT p.employee_id, p.punch_at, IFNULL(e.department, '') department, e.code, e.full_name FROM device_punches p JOIN employees e ON e.id = p.employee_id
      WHERE p.punch_at >= ? AND p.punch_at <= ? AND p.serial NOT IN (${notIn})${only.length ? ` AND p.serial IN (${only.map(() => '?').join(',')})` : ''}${adminAttWhere('e.role')}`)
    .all(lo, hi, ...NON_MACHINE_SERIALS, ...only);
  for (const p of rows) {
    const vnDay = new Date(Date.parse(p.punch_at) + 7 * 3600000).toISOString().slice(0, 10);
    for (const d of [vnDay, addDaysIso(vnDay, -1)]) {
      if (d < from || d > to) continue;
      for (const s of shifts) {
        if (!inWindow(p.punch_at, d, s)) continue;
        const k = d + '|' + s.code;
        if (!out.has(k)) out.set(k, new Map());
        const m = out.get(k), o = m.get(p.employee_id);
        if (!o || p.punch_at < o.at) m.set(p.employee_id, { code: p.code, full_name: p.full_name, department: p.department, at: p.punch_at });
      }
    }
  }
  return out;
}
// Dữ liệu chung của các báo cáo theo khoảng ngày (bữa đang bật + bữa đã tắt nhưng còn đơn trong khoảng)
function rangeData(from, to) {
  const ordRows = db.prepare(`SELECT o.employee_id, o.work_date, o.shift, o.dish, o.set_by, o.kitchen_id, o.created_at, o.updated_at, e.code, e.full_name, IFNULL(e.department, '') department
      FROM meal_orders o JOIN employees e ON e.id = o.employee_id WHERE o.work_date >= ? AND o.work_date <= ? ORDER BY e.department, e.code`).all(from, to);
  const extraRows = db.prepare('SELECT * FROM meal_extra WHERE work_date >= ? AND work_date <= ?').all(from, to);
  const has = new Set([...ordRows, ...extraRows].map((r) => r.shift));
  const shifts = listShifts().filter((s) => s.enabled || has.has(s.code));
  const kitchens = listKitchens(), km = empKitchenMap(), known = new Set(kitchens.map((k) => k.id));
  return {
    shifts, kitchens, km,
    kOf: (empId, v) => { const x = v ?? km.get(empId) ?? 0; return known.has(x) ? x : 0; },
    orders: groupBy(ordRows, (o) => o.work_date + '|' + o.shift),
    extras: groupBy(extraRows, (x) => x.work_date + '|' + x.shift),
    adjs: groupBy(db.prepare('SELECT * FROM meal_adjust WHERE work_date >= ? AND work_date <= ?').all(from, to), (x) => x.work_date + '|' + x.shift),
    disp: new Map(db.prepare('SELECT * FROM meal_dispatch WHERE work_date >= ? AND work_date <= ?').all(from, to).map((r) => [r.work_date + '|' + r.shift, r])),
    P: punchersRange(from, to, shifts),
  };
}

// BÁO CÁO 1 — TỔNG SỐ SUẤT ĂN & GIỜ ĐĂNG KÝ: mỗi ngày × bữa: giờ mở / khoá đăng ký, người đăng ký sớm nhất / muộn nhất,
// từng bếp (NV tự ĐK / HR ĐK hộ / thêm tay / tổng phải nấu / đã quẹt / ĐK mà không quẹt / quẹt mà không ĐK) + giờ gửi bếp.
// detail = true → kèm từng lượt đăng ký (giờ bấm, ai đăng ký, đã quẹt lúc) cho file Excel.
export function mealRangeSummary(from, to, now = new Date(), { detail = false } = {}) {
  needRange(from, to, 62);
  const R = rangeData(from, to);
  const rows = [], list = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) for (const s of R.shifts) {
    const k = d + '|' + s.code;
    const os = R.orders.get(k) || [], ex = R.extras.get(k) || [], ps = R.P.get(k) || new Map(), ad = R.adjs.get(k) || [];
    if (!os.length && !ex.length && !ps.size && !ad.length && !R.disp.has(k)) continue;   // bữa không có ai đăng ký / quẹt → bỏ dòng trống
    const extra = {};
    for (const x of ex) extra[x.kitchen_id] = (extra[x.kitchen_id] || 0) + x.qty;
    const adj = ad.reduce((t, a) => t + a.qty, 0);
    if (adj) extra[0] = (extra[0] || 0) + adj;   // HR điều chỉnh theo món (chế độ chọn món) → dòng chung
    const rep = buildSignupReport({ orders: os, punchers: new Set(ps.keys()), extra, kitchens: R.kitchens, kitchenOf: (id) => R.km.get(id) ?? 0 });
    const times = os.map((o) => o.created_at || o.updated_at).filter(Boolean).sort();
    const dp = R.disp.get(k);
    const used = rep.rows.filter((r) => r.app || r.hr || r.extra || r.ate || r.no_show || r.walk_in);   // bếp không có số liệu bữa đó → bỏ dòng
    rows.push({ date: d, shift: s.code, shift_name: s.name, open: orderOpenVn(d, s), deadline: orderDeadlineVn(d, s), ended: mealEnded(d, s, now),
      first_signup: times[0] || '', last_signup: times[times.length - 1] || '', sent_at: dp ? dp.sent_at : '', sent_total: dp ? dp.total : null, kitchens: used, totals: rep.totals });
    if (detail) for (const o of os) list.push({ date: d, shift_name: s.name, code: o.code, full_name: o.full_name, department: o.department, kitchen_id: R.kOf(o.employee_id, o.kitchen_id),
      dish: o.dish, set_by: o.set_by, at: o.created_at || o.updated_at, punched: ps.get(o.employee_id)?.at || '', ended: mealEnded(d, s, now) });
  }
  return { from, to, kitchens: R.kitchens, rows, ...(detail ? { list } : {}) };
}

// BÁO CÁO 2 — SỐ LẦN BÁO ĂN MÀ KHÔNG ĂN theo nhân viên (chỉ tính bữa ĐÃ KẾT THÚC): số lần đăng ký, đã ăn, không ăn (+ các ngày), tỉ lệ,
// số lần quẹt mà không đăng ký. Người bỏ nhiều nhất lên đầu.
export function mealNoShow(from, to, now = new Date()) {
  needRange(from, to, 92);
  const R = rangeData(from, to);
  const by = new Map();
  const get = (id, o) => {
    if (!by.has(id)) by.set(id, { employee_id: id, code: o.code, full_name: o.full_name, department: o.department, kitchen_id: R.kOf(id, null), registered: 0, ate: 0, no_show: 0, walk_in: 0, items: [] });
    return by.get(id);
  };
  let meals = 0;
  for (let d = from; d <= to; d = addDaysIso(d, 1)) for (const s of R.shifts) {
    if (!mealEnded(d, s, now)) continue;
    const k = d + '|' + s.code;
    const os = R.orders.get(k) || [], ps = R.P.get(k) || new Map();
    if (!os.length && !ps.size) continue;
    meals++;
    const signed = new Set();
    for (const o of os) {
      signed.add(o.employee_id);
      const r = get(o.employee_id, o);
      r.registered++;
      if (ps.has(o.employee_id)) r.ate++; else { r.no_show++; r.items.push({ date: d, shift: s.code, shift_name: s.name, set_by: o.set_by }); }
    }
    for (const [id, p] of ps) if (!signed.has(id)) get(id, p).walk_in++;
  }
  const rows = [...by.values()].map((r) => ({ ...r, rate: r.registered ? Math.round((r.no_show / r.registered) * 1000) / 10 : 0 }))
    .sort((a, b) => b.no_show - a.no_show || b.rate - a.rate || b.walk_in - a.walk_in || String(a.code).localeCompare(String(b.code)));
  return { from, to, meals, kitchens: R.kitchens, rows };
}

// BÁO CÁO 3 — NGOẠI LỆ: đăng ký mà không quẹt (bữa đã kết thúc) · quẹt máy chấm ăn mà không đăng ký
export function mealExceptions(from, to, now = new Date()) {
  needRange(from, to, 31);
  const R = rangeData(from, to);
  const noShow = [], walkIn = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) for (const s of R.shifts) {
    const k = d + '|' + s.code;
    const os = R.orders.get(k) || [], ps = R.P.get(k) || new Map();
    if (!os.length && !ps.size) continue;
    const signed = new Set(os.map((o) => o.employee_id));
    if (mealEnded(d, s, now)) for (const o of os) if (!ps.has(o.employee_id)) noShow.push({ date: d, shift: s.code, shift_name: s.name, employee_id: o.employee_id, code: o.code,
      full_name: o.full_name, department: o.department, kitchen_id: R.kOf(o.employee_id, o.kitchen_id), dish: o.dish, set_by: o.set_by, at: o.created_at || o.updated_at });
    for (const [id, p] of ps) if (!signed.has(id)) walkIn.push({ date: d, shift: s.code, shift_name: s.name, employee_id: id, code: p.code, full_name: p.full_name,
      department: p.department, kitchen_id: R.kOf(id, null), punched: p.at });
  }
  return { from, to, kitchens: R.kitchens, no_show: noShow, walk_in: walkIn };
}

export { vnNow };
