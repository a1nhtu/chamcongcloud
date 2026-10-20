// ĐỊNH LƯỢNG NGUYÊN LIỆU + KHO BẾP (menu Suất ăn › Nguyên liệu & kho) — phần dùng CSDL (quy tắc thuần ở meal-inv-rules.js).
//   · công tắc `meal_ingredient` (Cài đặt › Cấu hình hiển thị, mặc định TẮT, chỉ tài khoản tổng bật): tắt → API /admin/meal/inv/* trả 403, menu ẩn
//   · chỉ ĐỌC số suất của phân hệ suất ăn (meal.js); ghi vào bảng riêng meal_ingredients / meal_recipes / meal_stock_*
//   · 1 kho chung; phiếu xuất ghi theo bữa + bếp nhận; đơn giá nguyên liệu = giá nhập gần nhất
import { db, getSetting } from './db.js';
import { userError } from './util.js';
import { listShifts, needShift, needDate, needRange, listKitchens, empKitchenMap, dishChoiceOn, mealShiftReport, mealSignupReport, vnNow } from './meal.js';
import { addDaysIso } from './meal-rules.js';
import {
  roundQ, roundMoney, recipeUnit, parseQty, parseMoney, dishKey, checkIngredient, pickRecipe, splitByKitchen, buildNeeds, stockBalance, stockState, buildStockReport,
} from './meal-inv-rules.js';

export const invEnabled = () => getSetting('meal_ingredient', '0') === '1';
export function mealInvGate(req, res, next) {
  if (invEnabled()) return next();
  res.status(403).json({ error: 'Chức năng Định lượng nguyên liệu chưa được bật (tài khoản tổng bật trong Cài đặt › Cấu hình hiển thị).' });
}
export const PLAN_DAYS = 3;   // cảnh báo "không đủ cho kế hoạch": hôm nay + 2 ngày tới (bữa chưa xuất kho)

/* ---------------------------- nguyên liệu ---------------------------- */
const needIng = (id) => { const i = db.prepare('SELECT * FROM meal_ingredients WHERE id = ?').get(Number(id)); if (!i) throw userError('Không tìm thấy nguyên liệu', 404); return i; };
const ingMap = () => new Map(db.prepare('SELECT * FROM meal_ingredients').all().map((i) => [i.id, i]));
const withUnit = (i) => ({ ...i, recipe_unit: recipeUnit(i.unit).unit, recipe_factor: recipeUnit(i.unit).factor });

// Số dư mọi nguyên liệu tới hết ngày asOf (null = mọi phiếu)
export function balances(asOf = null) {
  const rows = db.prepare(`SELECT l.ingredient_id, d.kind, l.qty FROM meal_stock_lines l JOIN meal_stock_docs d ON d.id = l.doc_id ${asOf ? 'WHERE d.doc_date <= ?' : ''}`).all(...(asOf ? [asOf] : []));
  return stockBalance(rows);
}

// Danh mục + tồn hiện tại + nhu cầu kế hoạch (PLAN_DAYS ngày tới, bữa chưa xuất kho) + trạng thái cảnh báo
export function listIngredients(now = new Date()) {
  const bal = balances();
  const plan = planNeeds(now);
  return db.prepare('SELECT * FROM meal_ingredients ORDER BY active DESC, name COLLATE NOCASE').all().map((i) => {
    const b = bal.get(i.id) || { in: 0, out: 0, adj: 0, stock: 0 };
    const need = plan.get(i.id) || 0;
    return { ...withUnit(i), stock: b.stock, value: roundMoney(b.stock * i.price), plan_need: need, short: roundQ(Math.max(0, need - b.stock)), state: stockState(b.stock, i.min_stock, need),
      used: db.prepare('SELECT (SELECT COUNT(*) FROM meal_recipes WHERE ingredient_id = ?) + (SELECT COUNT(*) FROM meal_stock_lines WHERE ingredient_id = ?) n').get(i.id, i.id).n > 0 };
  });
}
export function saveIngredient(id, body) {
  const c = checkIngredient(body);
  if (!c.ok) throw userError(c.error);
  const v = c.value;
  if (db.prepare('SELECT id FROM meal_ingredients WHERE lower(name) = lower(?) AND id <> ?').get(v.name, Number(id) || 0)) throw userError(`Đã có nguyên liệu "${v.name}"`);
  if (id) {
    const old = needIng(id);
    if (old.unit.toLowerCase() !== v.unit.toLowerCase()
      && db.prepare('SELECT (SELECT COUNT(*) FROM meal_recipes WHERE ingredient_id = ?) + (SELECT COUNT(*) FROM meal_stock_lines WHERE ingredient_id = ?) n').get(old.id, old.id).n)
      throw userError(`"${old.name}" đã có định lượng / phiếu kho theo đơn vị "${old.unit}" — không đổi đơn vị được (tạo nguyên liệu mới nếu cần)`);
    db.prepare('UPDATE meal_ingredients SET name = ?, unit = ?, price = ?, min_stock = ?, note = ?, active = ? WHERE id = ?').run(v.name, v.unit, v.price, v.min_stock, v.note, v.active, old.id);
    return needIng(old.id);
  }
  if (db.prepare('SELECT COUNT(*) n FROM meal_ingredients').get().n >= 2000) throw userError('Tối đa 2.000 nguyên liệu');
  return needIng(db.prepare('INSERT INTO meal_ingredients(name, unit, price, min_stock, note, active) VALUES (?,?,?,?,?,?)').run(v.name, v.unit, v.price, v.min_stock, v.note, v.active).lastInsertRowid);
}
// Xoá nguyên liệu chưa dùng ở đâu; đã có định lượng / phiếu kho → chỉ "ngừng dùng" (giữ lịch sử)
export function deleteIngredient(id) {
  const i = needIng(id);
  const used = db.prepare('SELECT (SELECT COUNT(*) FROM meal_recipes WHERE ingredient_id = ?) + (SELECT COUNT(*) FROM meal_stock_lines WHERE ingredient_id = ?) n').get(i.id, i.id).n;
  if (used) { db.prepare('UPDATE meal_ingredients SET active = 0 WHERE id = ?').run(i.id); return { deleted: false, inactive: true }; }
  db.prepare('DELETE FROM meal_ingredients WHERE id = ?').run(i.id);
  return { deleted: true };
}

/* ---------------------------- định lượng món ---------------------------- */
// Map(`${dishKey}|${shift}` → [{ ingredient_id, qty }]) — mọi định lượng
export function recipeMap() {
  const m = new Map();
  for (const r of db.prepare('SELECT dish_key, shift, ingredient_id, qty FROM meal_recipes').all()) {
    const k = r.dish_key + '|' + r.shift;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push({ ingredient_id: r.ingredient_id, qty: r.qty });
  }
  return m;
}
const recipeLines = (key, shift, ing) => db.prepare('SELECT ingredient_id, qty FROM meal_recipes WHERE dish_key = ? AND shift = ?').all(key, shift)
  .map((r) => { const i = ing.get(r.ingredient_id); const u = recipeUnit(i?.unit); return { ingredient_id: r.ingredient_id, name: i?.name || '?', unit: i?.unit || '', qty: r.qty,
    amount: roundQ(r.qty * u.factor), recipe_unit: u.unit, cost: roundMoney(r.qty * (i?.price || 0)), active: i?.active ?? 0 }; })
  .sort((a, b) => a.name.localeCompare(b.name, 'vi'));

// Danh sách món để đặt định lượng: suất chung của từng bữa + món có trong thực đơn (60 ngày qua → 30 ngày tới) + món đã có định lượng
export function recipeDishes(now = new Date()) {
  const today = vnNow(now).date, ing = ingMap();
  const shifts = listShifts();
  const out = [];
  for (const s of shifts.filter((x) => x.enabled)) {
    const lines = recipeLines('', s.code, ing);
    out.push({ dish: '', shift: s.code, shift_name: s.name, label: `Suất chung — ${s.name}`, lines, cost: lines.reduce((t, l) => t + l.cost, 0), in_menu: 0 });
  }
  const names = new Map();
  for (const r of db.prepare('SELECT name, COUNT(*) n, MAX(work_date) last FROM meal_menu WHERE work_date >= ? AND work_date <= ? GROUP BY name').all(addDaysIso(today, -60), addDaysIso(today, 30))) {
    const k = dishKey(r.name); const o = names.get(k) || { dish: r.name, n: 0, last: '' }; o.n += r.n; if (r.last > o.last) o.last = r.last; names.set(k, o);
  }
  for (const r of db.prepare("SELECT DISTINCT dish_key, dish FROM meal_recipes WHERE dish_key <> ''").all()) if (!names.has(r.dish_key)) names.set(r.dish_key, { dish: r.dish || r.dish_key, n: 0, last: '' });
  for (const [k, o] of [...names].sort((a, b) => a[1].dish.localeCompare(b[1].dish, 'vi'))) {
    const lines = recipeLines(k, '', ing);
    out.push({ dish: o.dish, shift: '', label: o.dish, lines, cost: lines.reduce((t, l) => t + l.cost, 0), in_menu: o.n, last_menu: o.last });
  }
  return out;
}
// Ghi định lượng 1 món (dish có tên, shift bỏ qua) hoặc suất chung của 1 bữa (dish '', shift = mã bữa).
// lines: [{ ingredient_id, amount }] — amount theo đơn vị định lượng (g / ml / quả…); amount rỗng / 0 = bỏ dòng. Danh sách gửi lên THAY toàn bộ.
export function saveRecipe({ dish, shift, lines }) {
  const name = String(dish ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const key = dishKey(name);
  const sh = key ? '' : needShift(shift).code;
  const ing = ingMap(), clean = new Map();
  for (const l of Array.isArray(lines) ? lines : []) {
    const i = ing.get(Number(l?.ingredient_id));
    if (!i) throw userError('Có dòng chưa chọn nguyên liệu');
    const a = parseQty(l.amount, { max: 1e7, allowEmpty: true });
    const u = recipeUnit(i.unit);
    if (a === undefined) throw userError(`Lượng "${i.name}" phải là số ≥ 0 (${u.unit} / 1 suất)`);
    if (!a) continue;
    if (clean.has(i.id)) throw userError(`"${i.name}" bị nhập 2 lần`);
    clean.set(i.id, a / u.factor);
  }
  if (clean.size > 60) throw userError('Tối đa 60 nguyên liệu cho 1 món');
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM meal_recipes WHERE dish_key = ? AND shift = ?').run(key, sh);
    const ins = db.prepare('INSERT INTO meal_recipes(dish_key, shift, dish, ingredient_id, qty) VALUES (?,?,?,?,?)');
    for (const [id, q] of clean) ins.run(key, sh, name, id, q);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { dish: name, shift: sh, lines: recipeLines(key, sh, ingMap()) };
}

/* ---------------------------- số suất phải nấu (chỉ ĐỌC phân hệ suất ăn) ---------------------------- */
// 1 bữa của 1 ngày → [{ kitchen_id, dish, qty }] — đúng số "Tổng phải nấu" ở trang Tổng hợp (chọn món) / Đăng ký ăn (chỉ đăng ký ăn)
export function mealPortions(workDate, shift, now = new Date()) {
  if (!dishChoiceOn()) {
    return mealSignupReport(workDate, shift, now).rows.filter((r) => r.total > 0).map((r) => ({ kitchen_id: r.kitchen_id, dish: '', qty: r.total }));
  }
  const rep = mealShiftReport(workDate, shift, now);
  const known = new Set(listKitchens().map((k) => k.id)), km = empKitchenMap();
  const counts = new Map();   // dishKey → Map(kitchen → số người)
  for (const o of db.prepare('SELECT employee_id, dish, kitchen_id FROM meal_orders WHERE work_date = ? AND shift = ?').all(workDate, shift.code)) {
    const x = o.kitchen_id ?? km.get(o.employee_id) ?? 0, kid = known.has(x) ? x : 0, k = dishKey(o.dish);
    if (!counts.has(k)) counts.set(k, new Map());
    counts.get(k).set(kid, (counts.get(k).get(kid) || 0) + 1);
  }
  const out = [];
  for (const r of rep.rows) if (r.total > 0) for (const p of splitByKitchen(r.total, counts.get(dishKey(r.dish)))) out.push({ ...p, dish: r.dish });
  if (rep.default.total > 0) for (const p of splitByKitchen(rep.default.total, counts.get(''))) out.push({ ...p, dish: '' });
  return out;
}
// Phiếu xuất theo nhu cầu đã lập: `${ngày}|${bữa}|${bếp}` → phiếu
function cookDocs(from, to) {
  const m = new Map();
  for (const d of db.prepare("SELECT * FROM meal_stock_docs WHERE kind = 'out' AND source = 'cook' AND doc_date >= ? AND doc_date <= ?").all(from, to)) m.set(`${d.doc_date}|${d.shift}|${d.kitchen_id}`, d);
  return m;
}

// NHU CẦU NGUYÊN LIỆU cho [from, to] (kitchen: null = mọi bếp, số = 1 bếp) + tồn hiện tại + phiếu xuất đã lập của từng bữa
export function needsRange(from, to, { kitchen = null, now = new Date() } = {}) {
  needRange(from, to, 62);
  const shifts = listShifts({ onlyEnabled: true });
  const portions = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) for (const s of shifts)
    for (const p of mealPortions(d, s, now)) if (kitchen == null || p.kitchen_id === kitchen) portions.push({ ...p, date: d, shift: s.code, shift_name: s.name });
  const ing = ingMap();
  const r = buildNeeds({ portions, recipes: recipeMap(), ing });
  const bal = balances(), docs = cookDocs(from, to);
  const kName = new Map(listKitchens().map((k) => [k.id, k.name]));
  const info = (l) => { const i = ing.get(l.ingredient_id); const st = bal.get(l.ingredient_id)?.stock || 0; return { ...l, name: i.name, unit: i.unit, price: i.price, stock: st, short: roundQ(Math.max(0, l.qty - st)) }; };
  return {
    from, to, kitchen, kitchens: listKitchens(), portions: r.portions, cost: r.cost, missing: r.missing, lines: r.lines.map(info),
    meals: r.meals.map((m) => {
      const doc = docs.get(`${m.date}|${m.shift}|${m.kitchen_id}`);
      return { ...m, kitchen_name: m.kitchen_id ? kName.get(m.kitchen_id) || `Bếp #${m.kitchen_id}` : '', lines: m.lines.map(info),
        issued: doc ? { id: doc.id, at: doc.updated_at, by: doc.created_by } : null };
    }),
  };
}
// Nhu cầu cho kế hoạch: PLAN_DAYS ngày từ hôm nay, bỏ bữa đã xuất kho → Map(ingredient_id → số lượng)
export function planNeeds(now = new Date(), days = PLAN_DAYS) {
  const out = new Map();
  if (!db.prepare('SELECT 1 FROM meal_recipes LIMIT 1').get()) return out;
  const from = vnNow(now).date, to = addDaysIso(from, days - 1);
  const r = needsRange(from, to, { now });
  for (const m of r.meals) if (!m.issued) for (const l of m.lines) out.set(l.ingredient_id, roundQ((out.get(l.ingredient_id) || 0) + l.qty));
  return out;
}

/* ---------------------------- phiếu kho ---------------------------- */
const KIND_TXT = { in: 'Nhập kho', out: 'Xuất kho', count: 'Kiểm kê' };
// Ghi 1 phiếu (mới, hoặc thay phiếu `replaceId`). lines:
//   in    [{ ingredient_id, qty, price }]   — giá rỗng = đơn giá đang có; giá > 0 → cập nhật đơn giá nguyên liệu (giá nhập gần nhất)
//   out   [{ ingredient_id, qty, need? }]   — giá vốn = đơn giá lúc xuất
//   count [{ ingredient_id, counted }]      — chênh = số đếm − số sổ sách tới hết ngày kiểm (không tính phiếu đang sửa)
export function saveDoc({ kind, date, shift = '', kitchenId = 0, supplier = '', note = '', lines, source = '', by = '', replaceId = null }) {
  if (!KIND_TXT[kind]) throw userError('Loại phiếu không hợp lệ');
  needDate(date);
  const sh = shift ? needShift(shift).code : '';
  const kid = Number(kitchenId) || 0;
  if (kid && !listKitchens().some((k) => k.id === kid)) throw userError('Không tìm thấy bếp');
  const ing = ingMap();
  const old = replaceId ? db.prepare('SELECT * FROM meal_stock_docs WHERE id = ?').get(Number(replaceId)) : null;
  if (replaceId && (!old || old.kind !== kind)) throw userError('Không tìm thấy phiếu cần sửa', 404);
  let book = null;
  if (kind === 'count') {   // số sổ sách tới hết ngày kiểm, không tính chính phiếu đang sửa
    const rows = db.prepare('SELECT l.ingredient_id, d.kind, l.qty FROM meal_stock_lines l JOIN meal_stock_docs d ON d.id = l.doc_id WHERE d.doc_date <= ? AND d.id <> ?').all(date, old?.id || 0);
    book = stockBalance(rows);
  }
  const clean = [], seen = new Set();
  for (const l of Array.isArray(lines) ? lines : []) {
    const i = ing.get(Number(l?.ingredient_id));
    if (!i) throw userError('Có dòng chưa chọn nguyên liệu');
    if (seen.has(i.id)) throw userError(`"${i.name}" bị nhập 2 lần trong phiếu`);
    if (kind === 'count') {
      const c = parseQty(l.counted, { max: 1e9, allowEmpty: true });
      if (c === undefined) throw userError(`Số đếm thực tế của "${i.name}" phải là số ≥ 0`);
      if (c == null) continue;
      const b = book.get(i.id)?.stock || 0;
      seen.add(i.id); clean.push({ id: i.id, qty: roundQ(c - b), price: i.price, counted: c, book: b, need: null });
      continue;
    }
    const q = parseQty(l.qty, { max: 1e9, allowEmpty: true });
    if (q === undefined) throw userError(`Số lượng "${i.name}" phải là số ≥ 0 (${i.unit})`);
    const need = l.need == null || l.need === '' ? null : parseQty(l.need, { max: 1e9 }) ?? null;
    if (!q && need == null) continue;
    let price = i.price;
    if (kind === 'in') {
      const p = parseMoney(l.price, { allowEmpty: true });
      if (p === undefined) throw userError(`Đơn giá "${i.name}" phải là số ≥ 0`);
      if (p != null) price = p;
    }
    seen.add(i.id); clean.push({ id: i.id, qty: q || 0, price, need, counted: null, book: null });
  }
  if (!clean.length) throw userError(kind === 'count' ? 'Nhập số đếm thực tế của ít nhất 1 nguyên liệu' : 'Phiếu chưa có dòng nào có số lượng');
  if (clean.length > 500) throw userError('Tối đa 500 dòng mỗi phiếu');
  let id;
  db.exec('BEGIN');
  try {
    const vals = [kind, date, sh, kid, source, String(supplier || '').trim().slice(0, 120), String(note || '').trim().slice(0, 300)];
    if (old) {
      db.prepare("UPDATE meal_stock_docs SET kind = ?, doc_date = ?, shift = ?, kitchen_id = ?, source = ?, supplier = ?, note = ?, created_by = ?, updated_at = datetime('now') WHERE id = ?").run(...vals, by || '', old.id);
      db.prepare('DELETE FROM meal_stock_lines WHERE doc_id = ?').run(old.id);
      id = old.id;
    } else id = Number(db.prepare('INSERT INTO meal_stock_docs(kind, doc_date, shift, kitchen_id, source, supplier, note, created_by) VALUES (?,?,?,?,?,?,?,?)').run(...vals, by || '').lastInsertRowid);
    const ins = db.prepare('INSERT INTO meal_stock_lines(doc_id, ingredient_id, qty, price, need, counted, book) VALUES (?,?,?,?,?,?,?)');
    for (const c of clean) ins.run(id, c.id, c.qty, c.price, c.need, c.counted, c.book);
    // giá nhập gần nhất → đơn giá nguyên liệu (chỉ khi phiếu này là lần nhập mới nhất của nguyên liệu đó)
    if (kind === 'in') for (const c of clean) {
      if (!(c.price > 0)) continue;
      const later = db.prepare("SELECT 1 FROM meal_stock_lines l JOIN meal_stock_docs d ON d.id = l.doc_id WHERE d.kind = 'in' AND l.ingredient_id = ? AND l.price > 0 AND (d.doc_date > ? OR (d.doc_date = ? AND d.id > ?)) LIMIT 1").get(c.id, date, date, id);
      if (!later) db.prepare('UPDATE meal_ingredients SET price = ? WHERE id = ?').run(c.price, c.id);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return getDoc(id);
}
// XUẤT KHO THEO NHU CẦU của 1 bữa (1 bếp): mỗi (ngày, bữa, bếp) 1 phiếu — xuất lại = sửa phiếu đó.
// lines gửi lên [{ ingredient_id, qty }] (HR sửa tay được); need = số máy tính lúc xuất để lưu vết chênh.
export function cookIssue({ date, shift, kitchenId = 0, lines, note = '', by = '', now = new Date() }) {
  needDate(date);
  const s = needShift(shift), kid = Number(kitchenId) || 0;
  const meal = needsRange(date, date, { kitchen: kid, now }).meals.find((m) => m.shift === s.code && m.kitchen_id === kid);
  const need = new Map((meal?.lines || []).map((l) => [l.ingredient_id, l.qty]));
  const old = db.prepare("SELECT id FROM meal_stock_docs WHERE kind = 'out' AND source = 'cook' AND doc_date = ? AND shift = ? AND kitchen_id = ?").get(date, s.code, kid);
  const sent = (Array.isArray(lines) ? lines : []).map((l) => ({ ...l, need: need.get(Number(l?.ingredient_id)) ?? null }));
  const autoNote = `Xuất nấu ${s.name.toLowerCase()} ${date.slice(8, 10)}/${date.slice(5, 7)}${meal ? ` — ${meal.portions} suất` : ''}`;
  return saveDoc({ kind: 'out', date, shift: s.code, kitchenId: kid, source: 'cook', note: String(note || '').trim() || autoNote, lines: sent, by, replaceId: old?.id || null });
}
export function getDoc(id) {
  const d = db.prepare('SELECT * FROM meal_stock_docs WHERE id = ?').get(Number(id));
  if (!d) throw userError('Không tìm thấy phiếu', 404);
  const ing = ingMap();
  const lines = db.prepare('SELECT * FROM meal_stock_lines WHERE doc_id = ? ORDER BY id').all(d.id).map((l) => {
    const i = ing.get(l.ingredient_id);
    return { ...l, name: i?.name || '?', unit: i?.unit || '', value: roundMoney(Math.abs(l.qty) * l.price) * (l.qty < 0 ? -1 : 1) };
  });
  return { ...d, kind_txt: KIND_TXT[d.kind], lines, value: lines.reduce((t, l) => t + l.value, 0) };
}
export function listDocs(from, to, kind = '') {
  needRange(from, to, 370);
  const sh = new Map(listShifts().map((s) => [s.code, s.name])), kn = new Map(listKitchens().map((k) => [k.id, k.name]));
  return db.prepare(`SELECT d.*, COUNT(l.id) n, IFNULL(SUM(ABS(l.qty) * l.price * (CASE WHEN l.qty < 0 THEN -1 ELSE 1 END)), 0) value FROM meal_stock_docs d
      LEFT JOIN meal_stock_lines l ON l.doc_id = d.id WHERE d.doc_date >= ? AND d.doc_date <= ? ${KIND_TXT[kind] ? 'AND d.kind = ?' : ''} GROUP BY d.id ORDER BY d.doc_date DESC, d.id DESC`)
    .all(from, to, ...(KIND_TXT[kind] ? [kind] : []))
    .map((d) => ({ ...d, value: roundMoney(d.value), kind_txt: KIND_TXT[d.kind], shift_name: sh.get(d.shift) || '', kitchen_name: d.kitchen_id ? kn.get(d.kitchen_id) || `Bếp #${d.kitchen_id}` : '' }));
}
export function deleteDoc(id) {
  const d = db.prepare('SELECT id FROM meal_stock_docs WHERE id = ?').get(Number(id));
  if (!d) throw userError('Không tìm thấy phiếu', 404);
  db.exec('BEGIN');
  try { db.prepare('DELETE FROM meal_stock_lines WHERE doc_id = ?').run(d.id); db.prepare('DELETE FROM meal_stock_docs WHERE id = ?').run(d.id); db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

/* ---------------------------- báo cáo ---------------------------- */
// NHẬP – XUẤT – TỒN theo kỳ
export function stockReport(from, to) {
  needRange(from, to, 370);
  const ingredients = db.prepare('SELECT * FROM meal_ingredients ORDER BY name COLLATE NOCASE').all();
  const moves = db.prepare('SELECT l.ingredient_id, d.kind, l.qty, l.price, d.doc_date date FROM meal_stock_lines l JOIN meal_stock_docs d ON d.id = l.doc_id WHERE d.doc_date <= ?').all(to);
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const rows = buildStockReport({ ingredients, moves, from, to })
    .filter((r) => byId.get(r.ingredient_id).active || r.opening || r.in_qty || r.out_qty || r.adj || r.closing)
    .map((r) => { const i = byId.get(r.ingredient_id); return { ...r, name: i.name, unit: i.unit, price: i.price, min_stock: i.min_stock, active: i.active }; });
  const sum = (f) => rows.reduce((t, r) => t + r[f], 0);
  return { from, to, rows, totals: { in_value: sum('in_value'), out_value: sum('out_value'), closing_value: sum('closing_value') } };
}
// CHI PHÍ NGUYÊN LIỆU TRÊN MỖI SUẤT: mỗi ngày × bữa × bếp: số suất · chi phí dự tính (định lượng × đơn giá) · chi phí thực xuất (phiếu xuất của bữa)
export function costReport(from, to, { kitchen = null, now = new Date() } = {}) {
  const N = needsRange(from, to, { kitchen, now });
  const out = new Map();
  for (const m of N.meals) out.set(`${m.date}|${m.shift}|${m.kitchen_id}`, { date: m.date, shift: m.shift, shift_name: m.shift_name, kitchen_id: m.kitchen_id, kitchen_name: m.kitchen_name,
    portions: m.portions, est_cost: m.cost, actual_cost: null, missing: m.dishes.some((d) => !d.has_recipe) });
  const sh = new Map(listShifts().map((s) => [s.code, s.name])), kn = new Map(listKitchens().map((k) => [k.id, k.name]));
  let other = 0;
  for (const d of db.prepare(`SELECT d.doc_date, d.shift, d.kitchen_id, SUM(l.qty * l.price) v FROM meal_stock_docs d JOIN meal_stock_lines l ON l.doc_id = d.id
      WHERE d.kind = 'out' AND d.doc_date >= ? AND d.doc_date <= ? ${kitchen == null ? '' : 'AND d.kitchen_id = ?'} GROUP BY d.doc_date, d.shift, d.kitchen_id`).all(from, to, ...(kitchen == null ? [] : [kitchen]))) {
    if (!d.shift) { other += d.v; continue; }   // xuất khác (hư hỏng, dùng chung) — không gắn bữa
    const k = `${d.doc_date}|${d.shift}|${d.kitchen_id}`;
    if (!out.has(k)) out.set(k, { date: d.doc_date, shift: d.shift, shift_name: sh.get(d.shift) || d.shift, kitchen_id: d.kitchen_id, kitchen_name: d.kitchen_id ? kn.get(d.kitchen_id) || '' : '', portions: 0, est_cost: 0, actual_cost: null, missing: false });
    out.get(k).actual_cost = roundMoney((out.get(k).actual_cost || 0) + d.v);
  }
  const order = new Map(listShifts().map((s, i) => [s.code, i]));
  const rows = [...out.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (order.get(a.shift) ?? 99) - (order.get(b.shift) ?? 99) || a.kitchen_id - b.kitchen_id))
    .map((r) => { const c = r.actual_cost ?? r.est_cost; return { ...r, cost: c, per_portion: r.portions ? roundMoney(c / r.portions) : null }; });
  const portions = rows.reduce((t, r) => t + r.portions, 0), cost = rows.reduce((t, r) => t + r.cost, 0);
  return { from, to, kitchen, kitchens: N.kitchens, rows, other: roundMoney(other),
    totals: { portions, est_cost: rows.reduce((t, r) => t + r.est_cost, 0), cost, per_portion: portions ? roundMoney(cost / portions) : null, per_portion_all: portions ? roundMoney((cost + other) / portions) : null } };
}
