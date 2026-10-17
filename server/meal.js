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
} from './meal-rules.js';

/* ---------------------------- công tắc + quyền ---------------------------- */
export const mealEnabled = () => getSetting('meal_enabled', '0') === '1';
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
  const orders = new Map(db.prepare('SELECT work_date, shift, menu_id, dish FROM meal_orders WHERE employee_id = ? AND work_date >= ? AND work_date <= ?').all(empId, from, to)
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
        return { code: s.code, name: s.name, from_time: s.from_time, to_time: s.to_time, dishes: menu.get(d + '|' + s.code) || [],
          chosen: o ? { menu_id: o.menu_id, dish: o.dish } : null, editable: canOrderMeal(d, s, now), deadline: orderDeadlineVn(d, s) };
      }),
    });
  }
  return days;
}
// Chọn (hoặc bỏ chọn khi menuId rỗng) món cho 1 bữa
export function setMyOrder(empId, workDate, code, menuId, now = new Date()) {
  needDate(workDate);
  const shift = needShift(code);
  if (!shift.enabled) throw userError('Ca ăn này đang tắt');
  if (!canOrderMeal(workDate, shift, now)) {
    const dl = orderDeadlineVn(workDate, shift);   // 'YYYY-MM-DD HH:MM'
    throw userError(`Đã hết hạn chọn món cho bữa này (hạn ${dl.slice(11)} ngày ${dl.slice(8, 10)}/${dl.slice(5, 7)}) — bếp cần thời gian chuẩn bị`);
  }
  if (menuId == null || menuId === '') { db.prepare('DELETE FROM meal_orders WHERE employee_id = ? AND work_date = ? AND shift = ?').run(empId, workDate, code); return null; }
  const m = db.prepare('SELECT id, name FROM meal_menu WHERE id = ? AND work_date = ? AND shift = ?').get(Number(menuId), workDate, code);
  if (!m) throw userError('Món này không có trong thực đơn của bữa đã chọn');
  db.prepare(`INSERT INTO meal_orders(employee_id, work_date, shift, menu_id, dish, set_by, updated_at) VALUES (?,?,?,?,?,'',datetime('now'))
    ON CONFLICT(employee_id, work_date, shift) DO UPDATE SET menu_id = excluded.menu_id, dish = excluded.dish, set_by = '', updated_at = excluded.updated_at`).run(empId, workDate, code, m.id, m.name);
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
  const s = String(r ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (s.length < 3) throw userError('Nhập lý do chỉnh sửa (VD: anh A quên đăng ký, điện thoại hỏng…) để lưu vết');
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
    else db.prepare(`INSERT INTO meal_orders(employee_id, work_date, shift, menu_id, dish, set_by, updated_at) VALUES (?,?,?,?,?,?,datetime('now'))
      ON CONFLICT(employee_id, work_date, shift) DO UPDATE SET menu_id = excluded.menu_id, dish = excluded.dish, set_by = excluded.set_by, updated_at = excluded.updated_at`)
      .run(emp.id, workDate, code, m.id, m.name, by || 'HR');
    logAdjust({ by, workDate, code, kind: 'order', dish: m?.name || old, employeeId: emp.id, empLabel: label, oldValue: old, newValue: m?.name || '', reason: why });
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { employee: label, dish: m?.name || null };
}

// Tìm nhân viên (mã / tên, không phân biệt dấu) để HR chọn món hộ; kèm món NV đang chọn của ngày + ca đó
const noAccent = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
export function mealEmpSearch(q, workDate, code) {
  const k = noAccent(q).trim();
  if (!k) return [];
  const cur = new Map(db.prepare('SELECT employee_id, dish, set_by FROM meal_orders WHERE work_date = ? AND shift = ?').all(workDate, code).map((o) => [o.employee_id, o]));
  return db.prepare(`SELECT id, code, full_name, IFNULL(department, '') department FROM employees WHERE active = 1${adminAttWhere('role')} ORDER BY code`).all()
    .filter((e) => noAccent(e.code).includes(k) || noAccent(e.full_name).includes(k)).slice(0, 20)
    .map((e) => ({ ...e, dish: cur.get(e.id)?.dish || null, set_by: cur.get(e.id)?.set_by || '' }));
}

/* ---------------------------- màn hình bếp ---------------------------- */
// Mã riêng của màn hình bếp (trình duyệt bếp không đăng nhập; HR đổi mã được → mã cũ vô hiệu).
// Mã NGẮN 6 ký tự dễ gõ (bỏ chữ dễ nhầm O/0, I/1, L); không phân biệt hoa thường. Dò mã bị chặn theo IP ở routes/meal.js.
const KEY_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function kitchenKey({ renew = false } = {}) {
  let k = getSetting('meal_kitchen_key', '');
  if (!k || renew) { k = Array.from({ length: 6 }, () => KEY_CHARS[randomInt(KEY_CHARS.length)]).join(''); setSetting('meal_kitchen_key', k); }
  return k;
}
export function kitchenKeyOk(given) {
  const k = getSetting('meal_kitchen_key', '').toUpperCase();
  if (!k || typeof given !== 'string' || !given) return false;
  const a = Buffer.from(k), b = Buffer.from(given.trim().toUpperCase());
  return a.length === b.length && timingSafeEqual(a, b);
}
// Lượt quẹt mới (id > sinceId) trong 3 giờ qua, mỗi lượt gắn tên NV + món đã chọn của đúng bữa ăn lượt quẹt đó thuộc về.
// Lượt quẹt ngoài mọi khung giờ chốt không phải bữa ăn → bỏ qua (nhưng vẫn đẩy `last_id` lên để lần sau không quét lại).
export function kitchenFeed(sinceId = 0, now = new Date()) {
  const shifts = listShifts({ onlyEnabled: true });
  const since = new Date(now.getTime() - 3 * 3600000).toISOString();
  const notIn = NON_MACHINE_SERIALS.map(() => '?').join(',');
  const only = serialFilter();
  const rows = db.prepare(`SELECT p.id, p.punch_at, p.employee_id, e.code, e.full_name, IFNULL(e.department, '') department
      FROM device_punches p JOIN employees e ON e.id = p.employee_id
      WHERE p.id > ? AND p.punch_at >= ? AND p.punch_at <= ? AND p.serial NOT IN (${notIn})${only.length ? ` AND p.serial IN (${only.map(() => '?').join(',')})` : ''}
      ORDER BY p.id DESC LIMIT 80`).all(Number(sinceId) || 0, since, new Date(now.getTime() + 5 * 60000).toISOString(), ...NON_MACHINE_SERIALS, ...only);
  const events = [];
  for (const r of rows) {
    const hit = shiftForPunch(r.punch_at, shifts);
    if (!hit) continue;
    const [a, b] = windowBoundsUtc(hit.workDate, hit.shift);
    const times = db.prepare(`SELECT COUNT(*) n FROM device_punches WHERE employee_id = ? AND punch_at >= ? AND punch_at <= ? AND id <= ? AND serial NOT IN (${notIn})`)
      .get(r.employee_id, a, b, r.id, ...NON_MACHINE_SERIALS).n;
    const o = db.prepare('SELECT dish FROM meal_orders WHERE employee_id = ? AND work_date = ? AND shift = ?').get(r.employee_id, hit.workDate, hit.shift.code);
    events.push({ id: r.id, at: r.punch_at, code: r.code, name: r.full_name, department: r.department, shift: hit.shift.code, shift_name: hit.shift.name, work_date: hit.workDate, dish: o ? o.dish : null, times });
    if (events.length >= 25) break;
  }
  return { now: now.toISOString(), last_id: rows.length ? rows[0].id : Number(sinceId) || 0, events };
}

export { vnNow };
