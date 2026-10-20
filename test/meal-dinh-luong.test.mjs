// Test SUẤT ĂN › ĐỊNH LƯỢNG NGUYÊN LIỆU + KHO BẾP:
//   · quy tắc thuần: đổi đơn vị định lượng (kg ↔ g), đọc số có dấu phẩy, chia suất theo bếp, tính nhu cầu, tồn kho, nhập–xuất–tồn
//   · đầu-cuối qua router thật + CSDL tạm: công tắc mặc định TẮT (403, menu như cũ), chỉ tài khoản tổng bật;
//     nhu cầu theo món × bếp (chế độ chọn món) và suất chung (chế độ chỉ đăng ký ăn), nhập kho cập nhật giá, xuất theo nhu cầu (sửa tay),
//     kiểm kê, tồn = nhập − xuất ± kiểm kê, cảnh báo sắp hết / không đủ cho kế hoạch, báo cáo + Excel
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import {
  recipeUnit, parseQty, parseMoney, splitByKitchen, buildNeeds, stockBalance, stockState, buildStockReport, pickRecipe, dishKey,
} from '../server/meal-inv-rules.js';

const DBP = join(tmpdir(), `dgp-meal-inv-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, initSchema, getSetting, server, base;
const tok = {}, E = {}, ING = {};
const F = '2099-03-03';   // ngày tương lai: còn nhận chọn món
const G = '2099-03-04';
const TODAY = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) { try { json = await res.json(); } catch {} } else await res.arrayBuffer();
  return { status: res.status, body: json, type: ct };
}
const ok = (r) => { assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
const addEmp = (code, name, dept, role = 'employee', perms = null) => {
  E[code] = Number(db.prepare(`INSERT INTO employees(code, full_name, department, role, username, password_hash, permissions) VALUES (?,?,?,?,?,?,?)`)
    .run(code, name, dept, role, code.toLowerCase(), 'x', perms).lastInsertRowid);
  return E[code];
};
const line = (r, name) => r.lines.find((l) => l.name === name);

/* ============================ quy tắc thuần ============================ */
test('đơn vị định lượng: kg → g, lít → ml (÷1000), đơn vị đếm giữ nguyên', () => {
  assert.deepEqual(recipeUnit('kg'), { unit: 'g', factor: 1000 });
  assert.deepEqual(recipeUnit('Lít'), { unit: 'ml', factor: 1000 });
  assert.deepEqual(recipeUnit('quả'), { unit: 'quả', factor: 1 });
});
test('đọc số lượng: dấu phẩy thập phân, kiểu 1.250,5, số âm / chữ bị từ chối', () => {
  assert.equal(parseQty('0,15'), 0.15);
  assert.equal(parseQty('1.250,5'), 1250.5);
  assert.equal(parseQty('12.5'), 12.5);
  assert.equal(parseQty('-1'), undefined);
  assert.equal(parseQty('abc'), undefined);
  assert.equal(parseQty(''), undefined);
  assert.equal(parseQty('', { allowEmpty: true }), null);
  assert.equal(parseQty('-2', { min: -10 }), -2);
  // tiền: dấu chấm / phẩy nhóm nghìn kiểu Việt
  assert.equal(parseMoney('95.000'), 95000);
  assert.equal(parseMoney('1.250.000'), 1250000);
  assert.equal(parseMoney('95,000'), 95000);
  assert.equal(parseMoney('20000'), 20000);
  assert.equal(parseMoney('12500.4'), 12500);
  assert.equal(parseMoney('', { allowEmpty: true }), null);
  assert.equal(parseMoney('x'), undefined);
});
test('chia suất theo bếp: dư vào bếp chung, thiếu thì bớt bếp chung trước rồi bếp đông nhất', () => {
  assert.deepEqual(splitByKitchen(5, new Map([[1, 2], [2, 1]])), [{ kitchen_id: 0, qty: 2 }, { kitchen_id: 1, qty: 2 }, { kitchen_id: 2, qty: 1 }]);
  assert.deepEqual(splitByKitchen(3, new Map([[1, 2], [2, 1]])), [{ kitchen_id: 1, qty: 2 }, { kitchen_id: 2, qty: 1 }]);
  assert.deepEqual(splitByKitchen(2, new Map([[0, 1], [1, 3]])), [{ kitchen_id: 1, qty: 2 }]);   // bớt 1 ở bếp chung, 1 ở bếp 1
  assert.deepEqual(splitByKitchen(4, undefined), [{ kitchen_id: 0, qty: 4 }]);
  assert.deepEqual(splitByKitchen(0, new Map([[1, 2]])), []);
});
test('định lượng: món có tên dùng chung mọi bữa, suất không chọn món lấy suất chung của đúng bữa', () => {
  const rec = new Map([['cơm gà|', [{ ingredient_id: 1, qty: 0.15 }]], ['|trua', [{ ingredient_id: 1, qty: 0.2 }]]]);
  assert.equal(pickRecipe(rec, 'CƠM  Gà', 'dem')[0].qty, 0.15);
  assert.equal(pickRecipe(rec, '', 'trua')[0].qty, 0.2);
  assert.equal(pickRecipe(rec, '', 'dem'), null);
  assert.equal(dishKey(' Cơm   GÀ '.normalize('NFD')), 'cơm gà');
});
test('tính nhu cầu: số suất × định lượng, cộng theo bữa + cả khoảng, chi phí theo đơn giá, món thiếu định lượng', () => {
  const ing = new Map([[1, { id: 1, name: 'Gạo', unit: 'kg', price: 20000 }], [2, { id: 2, name: 'Gà', unit: 'kg', price: 90000 }]]);
  const rec = new Map([['cơm gà|', [{ ingredient_id: 1, qty: 0.15 }, { ingredient_id: 2, qty: 0.12 }]], ['|trua', [{ ingredient_id: 1, qty: 0.2 }]]]);
  const r = buildNeeds({ ing, recipes: rec, portions: [
    { date: F, shift: 'trua', kitchen_id: 0, dish: 'Cơm gà', qty: 10 },
    { date: F, shift: 'trua', kitchen_id: 0, dish: '', qty: 5 },
    { date: F, shift: 'trua', kitchen_id: 0, dish: 'Phở', qty: 3 },
    { date: G, shift: 'trua', kitchen_id: 1, dish: 'cơm gà', qty: 1 },
  ] });
  assert.equal(r.portions, 19);
  assert.deepEqual(r.lines, [{ ingredient_id: 2, qty: 1.32, cost: 118800 }, { ingredient_id: 1, qty: 2.65, cost: 53000 }]);   // xếp theo tên: Gà, Gạo
  assert.equal(r.cost, 171800);
  assert.deepEqual(r.missing, [{ dish: 'Phở', shift: '', shift_name: '', portions: 3 }]);
  const m = r.meals.find((x) => x.date === F);
  assert.equal(m.portions, 18);
  assert.equal(m.lines.find((l) => l.ingredient_id === 1).qty, 2.5);   // 10 × 0,15 + 5 × 0,2
  assert.equal(m.dishes.find((d) => d.dish === 'Phở').has_recipe, false);
});
test('tồn kho = nhập − xuất ± kiểm kê; trạng thái hết / sắp hết / không đủ cho kế hoạch', () => {
  const b = stockBalance([{ ingredient_id: 1, kind: 'in', qty: 10 }, { ingredient_id: 1, kind: 'out', qty: 2.5 }, { ingredient_id: 1, kind: 'count', qty: -0.3 }, { ingredient_id: 2, kind: 'out', qty: 1 }]);
  assert.deepEqual(b.get(1), { in: 10, out: 2.5, adj: -0.3, stock: 7.2 });
  assert.equal(b.get(2).stock, -1);
  assert.equal(stockState(0, 0), 'out');
  assert.equal(stockState(-1, 5), 'out');
  assert.equal(stockState(3, 5), 'low');
  assert.equal(stockState(8, 5, 10), 'short');
  assert.equal(stockState(8, 5, 2), 'ok');
});
test('nhập – xuất – tồn theo kỳ: tồn đầu từ phiếu trước kỳ, phiếu sau kỳ không tính', () => {
  const rows = buildStockReport({ from: '2026-10-10', to: '2026-10-20', ingredients: [{ id: 1, price: 21000 }], moves: [
    { ingredient_id: 1, kind: 'in', qty: 5, price: 20000, date: '2026-10-01' },
    { ingredient_id: 1, kind: 'out', qty: 1, price: 20000, date: '2026-10-05' },
    { ingredient_id: 1, kind: 'in', qty: 10, price: 21000, date: '2026-10-12' },
    { ingredient_id: 1, kind: 'out', qty: 3.5, price: 21000, date: '2026-10-15' },
    { ingredient_id: 1, kind: 'count', qty: -0.5, price: 21000, date: '2026-10-20' },
    { ingredient_id: 1, kind: 'in', qty: 99, price: 1, date: '2026-10-21' },
  ] });
  assert.deepEqual(rows[0], { ingredient_id: 1, opening: 4, in_qty: 10, in_value: 210000, out_qty: 3.5, out_value: 73500, adj: -0.5, closing: 10, closing_value: 210000 });
});

/* ============================ đầu-cuối ============================ */
before(async () => {
  ({ db, initSchema, getSetting } = await import('../server/db.js'));
  const { signToken, signMaster } = await import('../server/auth.js');
  const adminRoutes = (await import('../server/routes/admin.js')).default;
  const mealRoutes = (await import('../server/routes/meal.js')).default;
  const express = (await import('express')).default;
  initSchema();
  for (const [c, n, d] of [['A1', 'Nguyễn An', 'May'], ['A2', 'Trần Bình', 'May'], ['B1', 'Lê Cường', 'Cắt'], ['B2', 'Phạm Dũng', 'Cắt']]) addEmp(c, n, d);
  addEmp('ADM', 'Admin', '', 'admin');
  addEmp('HR1', 'Lan HR', 'Văn phòng', 'manager', JSON.stringify(['meal']));
  addEmp('MG2', 'Quản lý khác', 'Văn phòng', 'manager', JSON.stringify(['employees']));
  for (const c of ['A1', 'A2', 'B1', 'B2', 'ADM', 'HR1', 'MG2']) {
    const e = db.prepare('SELECT role, full_name FROM employees WHERE id=?').get(E[c]);
    tok[c] = signToken({ id: E[c], code: c, role: e.role, full_name: e.full_name });
  }
  tok.master = signMaster('sadmin');
  const app = express(); app.use(express.json());
  app.use('/api/admin', adminRoutes); app.use('/api/meal', mealRoutes);
  await new Promise((res) => { server = app.listen(0, '127.0.0.1', res); });
  base = `http://127.0.0.1:${server.address().port}/api`;
  ok(await call('PUT', '/admin/settings', { token: tok.master, body: { meal_enabled: true } }));
});
after(() => { server?.close(); for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} } });

test('công tắc Định lượng nguyên liệu: mặc định TẮT (không ghi cài đặt, API 403), admin công ty không bật được, tài khoản tổng bật', async () => {
  assert.equal(getSetting('meal_ingredient'), null);
  assert.equal(ok(await call('GET', '/admin/settings', { token: tok.ADM })).meal_ingredient, '0');
  assert.equal((await call('GET', '/admin/meal/inv/ingredients', { token: tok.HR1 })).status, 403);
  // các trang suất ăn cũ vẫn chạy như cũ
  ok(await call('GET', `/admin/meal/report?date=${F}`, { token: tok.HR1 }));
  await call('PUT', '/admin/settings', { token: tok.ADM, body: { meal_ingredient: true } });
  assert.equal(getSetting('meal_ingredient', '0'), '0');
  ok(await call('PUT', '/admin/settings', { token: tok.master, body: { meal_ingredient: true } }));
  assert.equal(getSetting('meal_ingredient'), '1');
  ok(await call('GET', '/admin/meal/inv/ingredients', { token: tok.HR1 }));
  // không có quyền suất ăn → 403
  assert.equal((await call('GET', '/admin/meal/inv/ingredients', { token: tok.MG2 })).status, 403);
});

test('danh mục nguyên liệu: kiểm tra dữ liệu, trùng tên, không đổi đơn vị khi đã dùng, xoá = ngừng dùng khi đã có dữ liệu', async () => {
  assert.equal((await call('POST', '/admin/meal/inv/ingredients', { token: tok.HR1, body: { name: 'Gạo', unit: '' } })).status, 400);
  assert.equal((await call('POST', '/admin/meal/inv/ingredients', { token: tok.HR1, body: { name: 'Gạo', unit: 'kg', price: 'abc' } })).status, 400);
  for (const [name, unit, price, min_stock] of [['Gạo', 'kg', 20000, 5], ['Thịt gà', 'kg', 90000, 1], ['Bún', 'kg', 15000, 0], ['Thịt bò', 'kg', 250000, 1], ['Trứng', 'quả', '3.000', 0], ['Muối', 'kg', 8000, 0]]) {
    ING[name] = ok(await call('POST', '/admin/meal/inv/ingredients', { token: tok.HR1, body: { name, unit, price, min_stock } })).ingredient.id;
  }
  assert.equal((await call('POST', '/admin/meal/inv/ingredients', { token: tok.HR1, body: { name: 'gạo', unit: 'kg' } })).status, 400);
  const r = ok(await call('GET', '/admin/meal/inv/ingredients', { token: tok.HR1 }));
  assert.equal(r.rows.find((x) => x.name === 'Trứng').price, 3000);
  assert.equal(r.rows.find((x) => x.name === 'Gạo').recipe_unit, 'g');
  assert.equal(r.rows.find((x) => x.name === 'Gạo').state, 'out');   // chưa nhập kho
  // chưa dùng → xoá hẳn
  assert.deepEqual(ok(await call('DELETE', `/admin/meal/inv/ingredients/${ING['Muối']}`, { token: tok.HR1 })), { ok: true, deleted: true });
});

test('định lượng món (g / 1 suất) + suất chung của bữa; nhập 2 lần cùng nguyên liệu bị chặn', async () => {
  const bad = await call('PUT', '/admin/meal/inv/recipes', { token: tok.HR1, body: { dish: 'Cơm gà', lines: [{ ingredient_id: ING['Gạo'], amount: 150 }, { ingredient_id: ING['Gạo'], amount: 10 }] } });
  assert.equal(bad.status, 400);
  const r = ok(await call('PUT', '/admin/meal/inv/recipes', { token: tok.HR1, body: { dish: 'Cơm gà', lines: [{ ingredient_id: ING['Gạo'], amount: '150' }, { ingredient_id: ING['Thịt gà'], amount: '120' }, { ingredient_id: ING['Trứng'], amount: '' }] } }));
  assert.deepEqual(r.lines.map((l) => [l.name, l.qty, l.amount, l.recipe_unit, l.cost]), [['Gạo', 0.15, 150, 'g', 3000], ['Thịt gà', 0.12, 120, 'g', 10800]]);
  ok(await call('PUT', '/admin/meal/inv/recipes', { token: tok.HR1, body: { dish: 'bún bò', lines: [{ ingredient_id: ING['Bún'], amount: 200 }, { ingredient_id: ING['Thịt bò'], amount: '100' }] } }));
  ok(await call('PUT', '/admin/meal/inv/recipes', { token: tok.HR1, body: { dish: '', shift: 'trua', lines: [{ ingredient_id: ING['Gạo'], amount: 160 }, { ingredient_id: ING['Trứng'], amount: 1 }] } }));
  assert.equal((await call('PUT', '/admin/meal/inv/recipes', { token: tok.HR1, body: { dish: '', shift: 'khong-co', lines: [] } })).status, 404);
  const d = ok(await call('GET', '/admin/meal/inv/recipes', { token: tok.HR1 })).dishes;
  assert.ok(d.find((x) => x.label === 'Suất chung — Trưa' || (x.dish === '' && x.shift === 'trua')).lines.length === 2);
  assert.equal(d.find((x) => x.dish === 'bún bò').cost, 28000);
  // đã có định lượng → không đổi đơn vị; xoá → ngừng dùng
  assert.equal((await call('PUT', `/admin/meal/inv/ingredients/${ING['Gạo']}`, { token: tok.HR1, body: { name: 'Gạo', unit: 'bao', price: 20000 } })).status, 400);
});

test('NHU CẦU (chế độ chọn món): số suất phải nấu theo món × bếp (gồm HR điều chỉnh) × định lượng; món thiếu định lượng', async () => {
  const K1 = ok(await call('POST', '/admin/meal/kitchens', { token: tok.HR1, body: { name: 'Bếp 1' } })).kitchen.id;
  ok(await call('PUT', '/admin/meal/kitchen-assign', { token: tok.HR1, body: { kitchen_id: K1, employee_ids: [E.A1] } }));
  const menu = ok(await call('PUT', '/admin/meal/menu', { token: tok.HR1, body: { date: F, shift: 'trua', dishes: ['Cơm gà', 'Bún bò', 'Phở'] } })).menu.trua;
  const id = (n) => menu.find((m) => m.name === n).id;
  for (const [c, dish] of [['A1', 'Cơm gà'], ['A2', 'Cơm gà'], ['B1', 'Bún bò'], ['B2', 'Phở']]) ok(await call('PUT', '/meal/order', { token: tok[c], body: { date: F, shift: 'trua', menu_id: id(dish) } }));
  ok(await call('PUT', '/admin/meal/adjust', { token: tok.HR1, body: { date: F, shift: 'trua', dish: 'Cơm gà', qty: 2, reason: 'khách đối tác' } }));
  const r = ok(await call('GET', `/admin/meal/inv/needs?from=${F}&to=${F}`, { token: tok.HR1 }));
  assert.equal(r.portions, 6);   // cơm gà 4 + bún bò 1 + phở 1
  assert.deepEqual([line(r, 'Gạo').qty, line(r, 'Thịt gà').qty, line(r, 'Bún').qty, line(r, 'Thịt bò').qty], [0.6, 0.48, 0.2, 0.1]);
  assert.equal(r.cost, 0.6 * 20000 + 0.48 * 90000 + 0.2 * 15000 + 0.1 * 250000);
  assert.equal(line(r, 'Gạo').short, 0.6);   // chưa nhập kho
  assert.deepEqual(r.missing, [{ dish: 'Phở', shift: '', shift_name: '', portions: 1 }]);
  // theo bếp: Bếp 1 = A1 (1 cơm gà); chung = A2 + 2 suất HR điều chỉnh + bún bò + phở
  const k1 = r.meals.find((m) => m.kitchen_id === K1), k0 = r.meals.find((m) => m.kitchen_id === 0);
  assert.equal(k1.portions, 1); assert.equal(k1.kitchen_name, 'Bếp 1');
  assert.equal(k0.portions, 5);
  assert.equal(line(k0, 'Thịt gà').qty, 0.36);
  const only1 = ok(await call('GET', `/admin/meal/inv/needs?from=${F}&to=${F}&kitchen=${K1}`, { token: tok.HR1 }));
  assert.equal(only1.portions, 1); assert.equal(line(only1, 'Gạo').qty, 0.15);
});

test('KHO: nhập (cập nhật giá nhập gần nhất) · xuất theo nhu cầu sửa tay (xuất lại = sửa phiếu) · kiểm kê · tồn = nhập − xuất ± kiểm kê', async () => {
  const imp = ok(await call('POST', '/admin/meal/inv/docs', { token: tok.HR1, body: { kind: 'in', date: '2099-03-01', supplier: 'Đại lý gạo Minh', lines: [
    { ingredient_id: ING['Gạo'], qty: '10', price: '' }, { ingredient_id: ING['Thịt gà'], qty: '5', price: '95.000' }, { ingredient_id: ING['Bún'], qty: '0,1', price: 15000 }] } })).doc;
  assert.equal(imp.value, 10 * 20000 + 5 * 95000 + 1500);
  let list = ok(await call('GET', '/admin/meal/inv/ingredients', { token: tok.HR1 })).rows;
  assert.equal(list.find((x) => x.name === 'Thịt gà').price, 95000);   // giá nhập mới
  assert.equal(list.find((x) => x.name === 'Gạo').stock, 10);
  // nhập lùi ngày với giá khác → KHÔNG đè giá của lần nhập mới hơn
  ok(await call('POST', '/admin/meal/inv/docs', { token: tok.HR1, body: { kind: 'in', date: '2099-02-01', lines: [{ ingredient_id: ING['Thịt gà'], qty: 1, price: 80000 }] } }));
  assert.equal(ok(await call('GET', '/admin/meal/inv/ingredients', { token: tok.HR1 })).rows.find((x) => x.name === 'Thịt gà').price, 95000);
  // xuất nấu bữa trưa F, bếp chung: máy tính gạo 0,45 kg, HR sửa thành 0,5
  const need = ok(await call('GET', `/admin/meal/inv/needs?from=${F}&to=${F}&kitchen=0`, { token: tok.HR1 })).meals[0];
  const lines = need.lines.map((l) => ({ ingredient_id: l.ingredient_id, qty: l.name === 'Gạo' ? '0,5' : l.qty }));
  const out1 = ok(await call('POST', '/admin/meal/inv/cook', { token: tok.HR1, body: { date: F, shift: 'trua', kitchen_id: 0, lines } })).doc;
  assert.equal(out1.source, 'cook');
  assert.deepEqual(out1.lines.find((l) => l.name === 'Gạo') && [out1.lines.find((l) => l.name === 'Gạo').qty, out1.lines.find((l) => l.name === 'Gạo').need], [0.5, 0.45]);
  assert.equal(out1.lines.find((l) => l.name === 'Thịt gà').price, 95000);   // giá vốn lúc xuất
  // xuất lại cùng bữa = sửa đúng phiếu đó (không cộng dồn)
  const out2 = ok(await call('POST', '/admin/meal/inv/cook', { token: tok.HR1, body: { date: F, shift: 'trua', kitchen_id: 0, lines } })).doc;
  assert.equal(out2.id, out1.id);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM meal_stock_docs WHERE source = 'cook'").get().n, 1);
  const n2 = ok(await call('GET', `/admin/meal/inv/needs?from=${F}&to=${F}`, { token: tok.HR1 }));
  assert.ok(n2.meals.find((m) => m.kitchen_id === 0).issued);
  assert.equal(n2.meals.find((m) => m.kitchen_id !== 0).issued, null);
  // phiếu xuất theo nhu cầu không sửa ở danh sách phiếu
  assert.equal((await call('PUT', `/admin/meal/inv/docs/${out1.id}`, { token: tok.HR1, body: { kind: 'out', date: F, lines } })).status, 400);
  list = ok(await call('GET', '/admin/meal/inv/ingredients', { token: tok.HR1 })).rows;
  assert.equal(list.find((x) => x.name === 'Gạo').stock, 9.5);
  assert.equal(list.find((x) => x.name === 'Bún').stock, -0.1);   // xuất quá tồn → âm, cảnh báo hết
  assert.equal(list.find((x) => x.name === 'Bún').state, 'out');
  // kiểm kê gạo: đếm thực tế 9,2 kg → chênh −0,3; tồn còn 9,2
  const cnt = ok(await call('POST', '/admin/meal/inv/docs', { token: tok.HR1, body: { kind: 'count', date: F, lines: [{ ingredient_id: ING['Gạo'], counted: '9,2' }, { ingredient_id: ING['Thịt gà'], counted: '' }] } })).doc;
  assert.deepEqual(cnt.lines.map((l) => [l.name, l.book, l.counted, l.qty]), [['Gạo', 9.5, 9.2, -0.3]]);
  // sửa phiếu kiểm kê: số sổ sách không tính chính phiếu đó
  const cnt2 = ok(await call('PUT', `/admin/meal/inv/docs/${cnt.id}`, { token: tok.HR1, body: { date: F, lines: [{ ingredient_id: ING['Gạo'], counted: 9 }] } })).doc;
  assert.deepEqual([cnt2.lines[0].book, cnt2.lines[0].qty], [9.5, -0.5]);
  list = ok(await call('GET', '/admin/meal/inv/ingredients', { token: tok.HR1 })).rows;
  assert.equal(list.find((x) => x.name === 'Gạo').stock, 9);
  assert.equal(list.find((x) => x.name === 'Gạo').value, 9 * 20000);
  // xoá phiếu kiểm kê → tồn về 9,5
  ok(await call('DELETE', `/admin/meal/inv/docs/${cnt.id}`, { token: tok.HR1 }));
  assert.equal(ok(await call('GET', '/admin/meal/inv/ingredients', { token: tok.HR1 })).rows.find((x) => x.name === 'Gạo').stock, 9.5);
  const docs = ok(await call('GET', '/admin/meal/inv/docs?from=2099-01-01&to=2099-12-31', { token: tok.HR1 })).rows;
  assert.deepEqual(docs.map((d) => d.kind), ['out', 'in', 'in']);
});

test('cảnh báo KẾ HOẠCH: tồn không đủ cho nhu cầu hôm nay + 2 ngày tới (bữa chưa xuất kho); sắp hết theo mức tối thiểu', async () => {
  // hôm nay có 3 suất cơm gà (ghi thẳng vào CSDL vì giờ chọn món của hôm nay có thể đã khoá)
  const mid = Number(db.prepare("INSERT INTO meal_menu(work_date, shift, name) VALUES (?, 'trua', 'Cơm gà')").run(TODAY).lastInsertRowid);
  for (const c of ['A2', 'B1', 'B2']) db.prepare("INSERT INTO meal_orders(employee_id, work_date, shift, menu_id, dish) VALUES (?,?, 'trua', ?, 'Cơm gà')").run(E[c], TODAY, mid);
  ok(await call('POST', '/admin/meal/inv/docs', { token: tok.HR1, body: { kind: 'in', date: TODAY, lines: [{ ingredient_id: ING['Thịt bò'], qty: 0.5, price: 250000 }] } }));
  const rows = ok(await call('GET', '/admin/meal/inv/ingredients', { token: tok.HR1 })).rows;
  const ga = rows.find((x) => x.name === 'Thịt gà'), gao = rows.find((x) => x.name === 'Gạo'), bo = rows.find((x) => x.name === 'Thịt bò');
  assert.equal(ga.plan_need, 0.36); assert.equal(gao.plan_need, 0.45);
  assert.equal(gao.state, 'ok');                    // 9,5 kg đủ
  assert.equal(bo.state, 'low');                    // 0,5 ≤ mức tối thiểu 1 kg
  // HR điều chỉnh thêm 60 suất cơm gà hôm nay: kế hoạch cần 63 × 120 g = 7,56 kg mà thịt gà chỉ còn 5,64 kg → không đủ
  db.prepare("INSERT OR REPLACE INTO meal_adjust(work_date, shift, dish, qty) VALUES (?, 'trua', 'Cơm gà', 60)").run(TODAY);
  const ga2 = ok(await call('GET', '/admin/meal/inv/ingredients', { token: tok.HR1 })).rows.find((x) => x.name === 'Thịt gà');
  assert.equal(ga2.stock, 5.64);
  assert.equal(ga2.plan_need, roundTo(63 * 0.12));
  assert.equal(ga2.state, 'short');
  assert.equal(ga2.short, roundTo(63 * 0.12 - 5.64));
  db.prepare('DELETE FROM meal_adjust WHERE work_date = ?').run(TODAY);
});
const roundTo = (x) => Math.round(x * 1000) / 1000;

test('BÁO CÁO: nhập–xuất–tồn theo kỳ · chi phí nguyên liệu / suất (thực xuất nếu đã xuất, chưa xuất thì dự tính) · 3 file Excel', async () => {
  const s = ok(await call('GET', '/admin/meal/inv/rpt/stock?from=2099-03-01&to=2099-03-31', { token: tok.HR1 }));
  const ga = s.rows.find((r) => r.name === 'Thịt gà');
  assert.deepEqual([ga.opening, ga.in_qty, ga.out_qty, ga.closing], [1, 5, 0.36, 5.64]);   // 1 kg nhập 01/02 là tồn đầu
  const c = ok(await call('GET', `/admin/meal/inv/rpt/cost?from=${F}&to=${F}`, { token: tok.HR1 }));
  const k0 = c.rows.find((r) => r.kitchen_id === 0), k1 = c.rows.find((r) => r.kitchen_id !== 0);
  assert.equal(k0.portions, 5);
  assert.equal(k0.actual_cost, 0.5 * 20000 + 0.36 * 95000 + 0.2 * 15000 + 0.1 * 250000);   // theo phiếu xuất (giá vốn lúc xuất)
  assert.equal(k0.per_portion, Math.round(k0.actual_cost / 5));
  assert.equal(k0.missing, true);   // có suất Phở chưa định lượng
  assert.equal(k1.actual_cost, null);
  assert.equal(k1.per_portion, 0.15 * 20000 + 0.12 * 95000);    // chưa xuất → dự tính
  for (const type of ['need', 'stock', 'cost']) {
    const x = await call('GET', `/admin/meal/inv/rpt.xlsx?type=${type}&from=${F}&to=${F}`, { token: tok.HR1 });
    assert.equal(x.status, 200, type); assert.match(x.type, /spreadsheetml/);
  }
  assert.equal((await call('GET', `/admin/meal/inv/rpt.xlsx?type=xx&from=${F}&to=${F}`, { token: tok.HR1 })).status, 400);
});

test('chế độ CHỈ ĐĂNG KÝ ĂN: nhu cầu = số đăng ký từng bếp (+ thêm tay) × suất chung của bữa; thiếu suất chung → báo món thiếu', async () => {
  ok(await call('PUT', '/admin/settings', { token: tok.master, body: { meal_dish_choice: false } }));
  ok(await call('PUT', '/admin/meal/signup-for', { token: tok.HR1, body: { date: G, shift: 'trua', employee_ids: [E.A1, E.A2, E.B1], on: true, reason: 'đăng ký hộ test' } }));
  ok(await call('PUT', '/admin/meal/extra', { token: tok.HR1, body: { date: G, shift: 'trua', kitchen_id: 0, qty: 2, reason: 'khách' } }));
  ok(await call('PUT', '/admin/meal/signup-for', { token: tok.HR1, body: { date: G, shift: 'chieu', employee_ids: [E.B2], on: true, reason: 'đăng ký hộ test' } }));
  const r = ok(await call('GET', `/admin/meal/inv/needs?from=${G}&to=${G}`, { token: tok.HR1 }));
  assert.equal(r.portions, 6);   // trưa 3 + 2 thêm tay, chiều 1
  assert.equal(line(r, 'Gạo').qty, roundTo(5 * 0.16));
  assert.equal(line(r, 'Trứng').qty, 5);
  assert.deepEqual(r.missing.map((x) => [x.dish, x.shift, x.portions]), [['', 'chieu', 1]]);
  assert.equal(r.meals.find((m) => m.shift === 'trua' && m.kitchen_id !== 0).portions, 1);   // A1 ở Bếp 1
  ok(await call('PUT', '/admin/settings', { token: tok.master, body: { meal_dish_choice: true } }));
});

test('tắt công tắc → API 403, dữ liệu kho giữ nguyên, phân hệ suất ăn chạy như cũ', async () => {
  ok(await call('PUT', '/admin/settings', { token: tok.master, body: { meal_ingredient: false } }));
  assert.equal((await call('GET', '/admin/meal/inv/ingredients', { token: tok.HR1 })).status, 403);
  assert.equal((await call('POST', '/admin/meal/inv/docs', { token: tok.HR1, body: { kind: 'in', date: F, lines: [] } })).status, 403);
  ok(await call('GET', `/admin/meal/report?date=${F}`, { token: tok.HR1 }));
  ok(await call('GET', `/admin/meal/rpt/summary?from=${F}&to=${F}`, { token: tok.HR1 }));
  assert.ok(db.prepare('SELECT COUNT(*) n FROM meal_stock_docs').get().n >= 3);
});
