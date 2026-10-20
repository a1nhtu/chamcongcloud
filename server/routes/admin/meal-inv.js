// ĐỊNH LƯỢNG NGUYÊN LIỆU + KHO BẾP (Suất ăn › Nguyên liệu & kho) — API /admin/meal/inv/*.
// Đi sau mealGate + mealManagerOnly của /meal (routes/admin/meal.js) + công tắc riêng meal_ingredient (mặc định TẮT → 403).
import { sendCaughtError } from '../../util.js';
import { needDate } from '../../meal.js';
import {
  mealInvGate, listIngredients, saveIngredient, deleteIngredient, recipeDishes, saveRecipe, needsRange, cookIssue,
  saveDoc, getDoc, listDocs, deleteDoc, stockReport, costReport, PLAN_DAYS,
} from '../../meal-inv.js';
import { writeInvXlsx } from '../../meal-inv-xlsx.js';

const who = (req) => req.user.full_name || req.user.username || '';
const wrap = (name, fn) => (req, res) => { try { fn(req, res); } catch (e) { sendCaughtError(res, name, e); } };
const kitchenQ = (v) => (v == null || v === '' || v === 'all' ? null : Number(v) || 0);

export function registerMealInvRoutes(r) {
  r.use('/meal/inv', mealInvGate);

  // ---------- danh mục nguyên liệu (kèm tồn hiện tại + cảnh báo) ----------
  r.get('/meal/inv/ingredients', wrap('GET /admin/meal/inv/ingredients', (req, res) => res.json({ rows: listIngredients(), plan_days: PLAN_DAYS })));
  r.post('/meal/inv/ingredients', wrap('POST /admin/meal/inv/ingredients', (req, res) => res.json({ ok: true, ingredient: saveIngredient(null, req.body || {}) })));
  r.put('/meal/inv/ingredients/:id', wrap('PUT /admin/meal/inv/ingredients', (req, res) => res.json({ ok: true, ingredient: saveIngredient(Number(req.params.id) || -1, req.body || {}) })));
  r.delete('/meal/inv/ingredients/:id', wrap('DELETE /admin/meal/inv/ingredients', (req, res) => res.json({ ok: true, ...deleteIngredient(req.params.id) })));

  // ---------- định lượng 1 suất của từng món / suất chung từng bữa ----------
  r.get('/meal/inv/recipes', wrap('GET /admin/meal/inv/recipes', (req, res) => res.json({ dishes: recipeDishes() })));
  r.put('/meal/inv/recipes', wrap('PUT /admin/meal/inv/recipes', (req, res) => {
    const b = req.body || {};
    res.json({ ok: true, ...saveRecipe({ dish: b.dish, shift: b.shift, lines: b.lines }) });
  }));

  // ---------- nhu cầu nấu theo ngày / khoảng ngày + xuất kho theo nhu cầu ----------
  r.get('/meal/inv/needs', wrap('GET /admin/meal/inv/needs', (req, res) => {
    const from = needDate(req.query.from), to = needDate(req.query.to || req.query.from);
    res.json(needsRange(from, to, { kitchen: kitchenQ(req.query.kitchen) }));
  }));
  r.post('/meal/inv/cook', wrap('POST /admin/meal/inv/cook', (req, res) => {
    const b = req.body || {};
    res.json({ ok: true, doc: cookIssue({ date: b.date, shift: b.shift, kitchenId: b.kitchen_id, lines: b.lines, note: b.note, by: who(req) }) });
  }));

  // ---------- phiếu kho: nhập · xuất khác · kiểm kê ----------
  r.get('/meal/inv/docs', wrap('GET /admin/meal/inv/docs', (req, res) => {
    const from = needDate(req.query.from), to = needDate(req.query.to || req.query.from);
    res.json({ rows: listDocs(from, to, String(req.query.kind || '')) });
  }));
  r.get('/meal/inv/docs/:id', wrap('GET /admin/meal/inv/docs/:id', (req, res) => res.json(getDoc(req.params.id))));
  const docBody = (req, replaceId = null) => {
    const b = req.body || {};
    return { kind: String(b.kind || ''), date: b.date, shift: b.shift || '', kitchenId: b.kitchen_id, supplier: b.supplier, note: b.note, lines: b.lines, by: who(req), replaceId };
  };
  r.post('/meal/inv/docs', wrap('POST /admin/meal/inv/docs', (req, res) => res.json({ ok: true, doc: saveDoc(docBody(req)) })));
  r.put('/meal/inv/docs/:id', wrap('PUT /admin/meal/inv/docs', (req, res) => {
    const old = getDoc(req.params.id);
    if (old.source === 'cook') return res.status(400).json({ error: 'Phiếu xuất theo nhu cầu sửa ở trang Nhu cầu nấu (bấm "Sửa phiếu xuất" của bữa đó)' });
    res.json({ ok: true, doc: saveDoc({ ...docBody(req, old.id), kind: old.kind, source: old.source }) });
  }));
  r.delete('/meal/inv/docs/:id', wrap('DELETE /admin/meal/inv/docs', (req, res) => { deleteDoc(req.params.id); res.json({ ok: true }); }));

  // ---------- báo cáo + Excel ----------
  r.get('/meal/inv/rpt/stock', wrap('GET /admin/meal/inv/rpt/stock', (req, res) => res.json(stockReport(needDate(req.query.from), needDate(req.query.to || req.query.from)))));
  r.get('/meal/inv/rpt/cost', wrap('GET /admin/meal/inv/rpt/cost', (req, res) =>
    res.json(costReport(needDate(req.query.from), needDate(req.query.to || req.query.from), { kitchen: kitchenQ(req.query.kitchen) }))));
  r.get('/meal/inv/rpt.xlsx', async (req, res) => {
    try { await writeInvXlsx(res, String(req.query.type || ''), needDate(req.query.from), needDate(req.query.to || req.query.from), { kitchen: kitchenQ(req.query.kitchen) }); }
    catch (e) { if (!res.headersSent) sendCaughtError(res, 'GET /admin/meal/inv/rpt.xlsx', e); else res.end(); }
  });
}
