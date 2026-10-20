// ĐỊNH LƯỢNG NGUYÊN LIỆU + KHO BẾP — quy tắc THUẦN (không đụng CSDL), phần dùng CSDL ở meal-inv.js.
//   · nguyên liệu tính theo ĐƠN VỊ KHO (kg, lít, quả, gói…); định lượng 1 suất nhập theo đơn vị nhỏ cho dễ (kg → g, lít → ml)
//   · nhu cầu = số suất phải nấu (từng ngày × bữa × bếp × món) × định lượng 1 suất của món
//   · tồn kho = nhập − xuất ± kiểm kê (phiếu kiểm kê lưu phần chênh = số đếm thực tế − số sổ sách lúc kiểm)

// Làm tròn số lượng 3 số lẻ (tránh 0.1 + 0.2 = 0.30000000000000004), tiền làm tròn đồng
export const roundQ = (x) => Math.round((Number(x) || 0) * 1000) / 1000;
export const roundMoney = (x) => Math.round(Number(x) || 0);

// Đơn vị nhập định lượng của 1 suất: kg → g, lít → ml (chia 1000 khi đổi về đơn vị kho); đơn vị khác giữ nguyên
export function recipeUnit(unit) {
  const u = String(unit || '').trim().toLowerCase();
  if (u === 'kg') return { unit: 'g', factor: 1000 };
  if (u === 'lít' || u === 'lit' || u === 'l') return { unit: 'ml', factor: 1000 };
  return { unit: String(unit || '').trim(), factor: 1 };
}

// Số lượng HR gõ: chấp nhận dấu phẩy thập phân (0,15) và dấu chấm; undefined = không hợp lệ
export function parseQty(v, { min = 0, max = 1e9, allowEmpty = false } = {}) {
  if (v === '' || v == null) return allowEmpty ? null : undefined;
  let s = String(v).trim().replace(/\s/g, '');
  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, '');   // 1.250,5 kiểu Việt
  s = s.replace(',', '.');
  if (!/^-?\d*(\.\d+)?$/.test(s) || s === '' || s === '-') return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n >= min && n <= max ? roundQ(n) : undefined;
}

// Số TIỀN HR gõ: dấu chấm / phẩy chia nhóm nghìn kiểu Việt (95.000 · 1.250.000 · 95,000) → số nguyên đồng; còn lại đọc như parseQty
export function parseMoney(v, { allowEmpty = false } = {}) {
  if (v === '' || v == null) return allowEmpty ? null : undefined;
  const s = String(v).trim().replace(/\s|đ$/gi, '');
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ''));
  const n = parseQty(s, { max: 1e11 });
  return n === undefined ? undefined : roundMoney(n);
}

// Khoá so khớp tên món (không phân biệt hoa thường, dạng chữ NFC / NFD, khoảng trắng thừa)
export const dishKey = (name) => String(name ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('vi');

// Kiểm tra dữ liệu 1 nguyên liệu HR gửi lên → { ok, error?, value? }
export function checkIngredient(b) {
  const name = String(b?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!name) return { ok: false, error: 'Nhập tên nguyên liệu' };
  const unit = String(b?.unit ?? '').replace(/\s+/g, ' ').trim().slice(0, 12);
  if (!unit) return { ok: false, error: 'Nhập đơn vị tính (kg, lít, quả, gói…)' };
  const price = parseMoney(b?.price ?? 0);
  if (price === undefined) return { ok: false, error: 'Đơn giá phải là số ≥ 0' };
  const min = parseQty(b?.min_stock ?? 0, { max: 1e9 });
  if (min === undefined) return { ok: false, error: 'Mức tồn tối thiểu phải là số ≥ 0' };
  return { ok: true, value: { name, unit, price, min_stock: min, note: String(b?.note ?? '').trim().slice(0, 200), active: b?.active === false || b?.active === 0 ? 0 : 1 } };
}

// Định lượng dùng cho 1 phần (món + bữa): món có tên → định lượng của món (dùng cho mọi bữa);
// suất không chọn món (dish '') → "suất chung" của đúng bữa đó. recipes: Map(`${dishKey}|${shift}` → [{ ingredient_id, qty }])
export function pickRecipe(recipes, dish, shift) {
  const k = dishKey(dish);
  if (k) return recipes.get(k + '|') || null;
  return recipes.get('|' + shift) || null;
}

// Chia tổng số suất của 1 món cho các bếp theo số người đăng ký ở từng bếp.
// counts: Map(kitchen_id → số người). Phần dư (HR điều chỉnh +, trưởng BP báo thêm) vào bếp 0 = chung / chưa phân bếp;
// tổng nhỏ hơn số người (HR điều chỉnh −) → bớt ở bếp chung trước, rồi bếp đông nhất. Trả [{ kitchen_id, qty }] (bỏ dòng 0).
export function splitByKitchen(total, counts = new Map()) {
  const m = new Map([...counts].map(([k, n]) => [Number(k) || 0, Math.max(0, Number(n) || 0)]));
  const sum = [...m.values()].reduce((s, n) => s + n, 0);
  let t = Math.max(0, Number(total) || 0);
  if (t >= sum) m.set(0, (m.get(0) || 0) + (t - sum));
  else {
    let cut = sum - t;
    const order = [...m.keys()].sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : m.get(b) - m.get(a) || a - b));
    for (const k of order) { if (!cut) break; const d = Math.min(cut, m.get(k)); m.set(k, m.get(k) - d); cut -= d; }
  }
  return [...m].filter(([, n]) => n > 0).map(([kitchen_id, qty]) => ({ kitchen_id, qty })).sort((a, b) => a.kitchen_id - b.kitchen_id);
}

// NHU CẦU NGUYÊN LIỆU. portions: [{ date, shift, shift_name, kitchen_id, dish, qty }] (số suất phải nấu)
// recipes: như pickRecipe · ing: Map(id → { id, name, unit, price })
// → { meals: [{ date, shift, shift_name, kitchen_id, portions, dishes: [{ dish, qty, has_recipe, cost }], lines: [{ ingredient_id, qty, cost }], cost }],
//     lines (cộng cả khoảng theo nguyên liệu), missing (món chưa có định lượng + số suất), portions, cost }
export function buildNeeds({ portions = [], recipes = new Map(), ing = new Map() }) {
  const meals = new Map(), total = new Map(), missing = new Map();
  const addLine = (map, id, q) => { const it = ing.get(id); if (!it) return; const l = map.get(id) || { ingredient_id: id, qty: 0, cost: 0 }; l.qty += q; l.cost += q * (it.price || 0); map.set(id, l); };
  for (const p of portions) {
    const n = Math.max(0, Number(p.qty) || 0);
    if (!n) continue;
    const key = `${p.date}|${p.shift}|${p.kitchen_id || 0}`;
    if (!meals.has(key)) meals.set(key, { date: p.date, shift: p.shift, shift_name: p.shift_name || p.shift, kitchen_id: p.kitchen_id || 0, portions: 0, dishes: new Map(), lines: new Map() });
    const m = meals.get(key);
    m.portions += n;
    const rec = pickRecipe(recipes, p.dish, p.shift);
    const dk = dishKey(p.dish);
    const d = m.dishes.get(dk) || { dish: p.dish || '', qty: 0, has_recipe: !!(rec && rec.length), cost: 0 };
    d.qty += n;
    if (rec && rec.length) {
      for (const r of rec) {
        const q = n * r.qty, it = ing.get(r.ingredient_id);
        if (!it) continue;
        addLine(m.lines, r.ingredient_id, q); addLine(total, r.ingredient_id, q);
        d.cost += q * (it.price || 0);
      }
    } else {
      const mk = p.dish ? 'd|' + dk : 's|' + p.shift;
      const x = missing.get(mk) || { dish: p.dish || '', shift: p.dish ? '' : p.shift, shift_name: p.dish ? '' : (p.shift_name || p.shift), portions: 0 };
      x.portions += n; missing.set(mk, x);
    }
    m.dishes.set(dk, d);
  }
  const fin = (map) => [...map.values()].map((l) => ({ ingredient_id: l.ingredient_id, qty: roundQ(l.qty), cost: roundMoney(l.cost) }))
    .sort((a, b) => String(ing.get(a.ingredient_id)?.name || '').localeCompare(String(ing.get(b.ingredient_id)?.name || ''), 'vi'));
  const mealList = [...meals.values()].map((m) => {
    const lines = fin(m.lines);
    return { date: m.date, shift: m.shift, shift_name: m.shift_name, kitchen_id: m.kitchen_id, portions: m.portions,
      dishes: [...m.dishes.values()].map((d) => ({ ...d, cost: roundMoney(d.cost) })).sort((a, b) => b.qty - a.qty),
      lines, cost: lines.reduce((s, l) => s + l.cost, 0) };
  });
  const lines = fin(total);
  return { meals: mealList, lines, missing: [...missing.values()].sort((a, b) => b.portions - a.portions),
    portions: mealList.reduce((s, m) => s + m.portions, 0), cost: lines.reduce((s, l) => s + l.cost, 0) };
}

// Số dư theo nguyên liệu từ các dòng phiếu kho: moves [{ ingredient_id, kind: 'in'|'out'|'count', qty }]
// → Map(id → { in, out, adj, stock }) — stock = nhập − xuất ± kiểm kê
export function stockBalance(moves = []) {
  const out = new Map();
  for (const m of moves) {
    const b = out.get(m.ingredient_id) || { in: 0, out: 0, adj: 0, stock: 0 };
    const q = Number(m.qty) || 0;
    if (m.kind === 'in') b.in += q; else if (m.kind === 'out') b.out += q; else if (m.kind === 'count') b.adj += q;
    out.set(m.ingredient_id, b);
  }
  for (const b of out.values()) { b.in = roundQ(b.in); b.out = roundQ(b.out); b.adj = roundQ(b.adj); b.stock = roundQ(b.in - b.out + b.adj); }
  return out;
}

// Trạng thái tồn: 'out' hết / âm · 'low' ≤ mức tối thiểu · 'short' không đủ cho kế hoạch · 'ok'
export function stockState(stock, minStock, planNeed = 0) {
  if (stock <= 0) return 'out';
  if (planNeed > 0 && stock < planNeed) return 'short';
  if (minStock > 0 && stock <= minStock) return 'low';
  return 'ok';
}

// BÁO CÁO NHẬP – XUẤT – TỒN theo kỳ [from, to]. moves: [{ ingredient_id, kind, qty, price, date }] (đủ mọi ngày ≤ to)
// → [{ ingredient_id, opening, in_qty, in_value, out_qty, out_value, adj, closing, closing_value }] — giá trị tồn tính theo đơn giá hiện tại
export function buildStockReport({ ingredients = [], moves = [], from, to }) {
  const rows = new Map(ingredients.map((i) => [i.id, { ingredient_id: i.id, opening: 0, in_qty: 0, in_value: 0, out_qty: 0, out_value: 0, adj: 0, closing: 0, closing_value: 0 }]));
  for (const m of moves) {
    const r = rows.get(m.ingredient_id);
    if (!r || m.date > to) continue;
    const q = Number(m.qty) || 0, sign = m.kind === 'out' ? -1 : 1;
    if (m.date < from) { r.opening += sign * q; continue; }
    if (m.kind === 'in') { r.in_qty += q; r.in_value += q * (Number(m.price) || 0); }
    else if (m.kind === 'out') { r.out_qty += q; r.out_value += q * (Number(m.price) || 0); }
    else r.adj += q;
  }
  const price = new Map(ingredients.map((i) => [i.id, Number(i.price) || 0]));
  return [...rows.values()].map((r) => {
    const closing = roundQ(r.opening + r.in_qty - r.out_qty + r.adj);
    return { ...r, opening: roundQ(r.opening), in_qty: roundQ(r.in_qty), in_value: roundMoney(r.in_value), out_qty: roundQ(r.out_qty), out_value: roundMoney(r.out_value),
      adj: roundQ(r.adj), closing, closing_value: roundMoney(closing * price.get(r.ingredient_id)) };
  });
}
