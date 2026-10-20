// ĐỊNH LƯỢNG NGUYÊN LIỆU + KHO BẾP (menu Suất ăn › Nguyên liệu & kho) — 5 tab:
//   Nhu cầu nấu · Định lượng món · Nguyên liệu & tồn kho · Phiếu kho · Báo cáo
// Chỉ có menu khi tài khoản tổng bật công tắc "Định lượng nguyên liệu" (Cài đặt › Cấu hình hiển thị). API: /admin/meal/inv/*
import { api, toast, el } from '/common.js';

let C = null;
const vnToday = () => new Date().toLocaleDateString('sv', { timeZone: 'Asia/Ho_Chi_Minh' });
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const dmy = (s) => (/^\d{4}-\d{2}-\d{2}/.test(s || '') ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '');
const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const wdmy = (s) => `${WD[new Date(s + 'T12:00:00Z').getUTCDay()]} ${dmy(s)}`;
const nf = (n) => (n == null ? '—' : Number(n).toLocaleString('vi-VN'));
const qf = (n) => (n == null ? '—' : Number(n).toLocaleString('vi-VN', { maximumFractionDigits: 3 }));
const money = (n) => (n == null ? '—' : Number(Math.round(n)).toLocaleString('vi-VN') + ' đ');
const noAcc = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
// datetime('now') của SQLite (UTC) → 'HH:MM dd/mm' giờ VN
const stamp = (s) => { if (!s) return ''; const t = new Date(Date.parse(s.replace(' ', 'T') + 'Z') + 7 * 3600000).toISOString(); return `${t.slice(11, 16)} ${t.slice(8, 10)}/${t.slice(5, 7)}`; };
const docNo = (id) => 'PK' + String(id).padStart(5, '0');
const STATE = { out: ['red', 'Hết hàng'], short: ['red', 'Không đủ cho kế hoạch'], low: ['warn', 'Sắp hết'], ok: ['ok', 'Đủ'] };
const KIND = { in: ['ok', '📥 Nhập kho'], out: ['warn', '📤 Xuất kho'], count: ['muted', '📋 Kiểm kê'] };
const UNITS = ['kg', 'g', 'lít', 'ml', 'quả', 'gói', 'hộp', 'chai', 'lon', 'bó', 'con', 'cái', 'túi', 'thùng', 'bao'];
const S = { tab: 'need', from: '', to: '', kitchen: '', docFrom: '', docTo: '', docKind: '', rpt: 'need', showOff: false, dish: null };
let ING = [], KITCHENS = [], SHIFTS = [];

function css() { if (!document.getElementById('sa-css')) document.head.append(el('link', { id: 'sa-css', rel: 'stylesheet', href: '/suatan/suatan.css' })); }
const wide = (px = 860) => { const m = document.getElementById('modal'); if (m) m.style.maxWidth = px + 'px'; };
const kName = (id) => (id ? KITCHENS.find((k) => k.id === id)?.name || `Bếp #${id}` : KITCHENS.length ? 'Chung / chưa phân bếp' : 'Bếp chung');
const pill = (cls, txt) => el('span', { class: 'sa-pill ' + cls }, txt);
const btn = (label, fn, cls = 'ghost') => { const b = el('button', { class: 'sa-btn ' + cls, type: 'button' }, label); b.onclick = fn; return b; };
const kpi = (k, v, sub) => el('div', { class: 'sa-kpi' }, el('div', { class: 'k' }, k), el('div', { class: 'v' }, v), sub ? el('div', { class: 'sa-hint' }, sub) : null);
const table = (heads, rows, foot = null) => el('div', { class: 'sa-wrap' }, el('table', { class: 'sa-tbl' },
  el('thead', {}, el('tr', {}, ...heads.map((h) => (Array.isArray(h) ? el('th', { class: 'num' }, h[0]) : el('th', {}, h))))),
  el('tbody', {}, ...rows), foot ? el('tfoot', {}, foot) : null));
const ingSelect = (value, { all = false } = {}) => {
  const s = el('select', { class: 'sa-ing-sel' }, el('option', { value: '' }, '— chọn nguyên liệu —'),
    ...ING.filter((i) => all || i.active || i.id === value).map((i) => el('option', { value: String(i.id), ...(i.id === value ? { selected: '' } : {}) }, `${i.name} (${i.unit})`)));
  return s;
};
const ingOf = (id) => ING.find((i) => i.id === Number(id));
async function refreshRefs() {
  const [a, b, c] = await Promise.all([api('/admin/meal/inv/ingredients'), api('/admin/meal/kitchens'), api('/admin/meal/shifts')]);
  ING = a.rows; KITCHENS = b.kitchens; SHIFTS = c.shifts;
  return a;
}
async function download(path, fallback) {
  try {
    const res = await api(path, { raw: true });
    if (!res.ok) { let m = 'Không xuất được báo cáo'; try { m = (await res.json()).error || m; } catch {} return toast(m, 'err'); }
    const name = (/filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '') || [])[1] || fallback;
    const url = URL.createObjectURL(await res.blob());
    const a = el('a', { href: url, download: name }); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Đã xuất Excel', 'ok');
  } catch { toast('Không xuất được báo cáo', 'err'); }
}
// ô chọn khoảng ngày + nút nhanh (gắn vào S[fk], S[tk])
function rangeBar(fk, tk, onGo, quicks) {
  const fI = el('input', { type: 'date', value: S[fk] }), tI = el('input', { type: 'date', value: S[tk] });
  const go = () => { if (!fI.value) return; S[fk] = fI.value; S[tk] = tI.value && tI.value >= fI.value ? tI.value : fI.value; tI.value = S[tk]; onGo(); };
  fI.onchange = () => { if (tI.value < fI.value) tI.value = fI.value; };
  const q = quicks.map(([label, f, t]) => btn(label, () => { S[fk] = f(); S[tk] = t(); fI.value = S[fk]; tI.value = S[tk]; onGo(); }));
  return { nodes: [el('span', {}, 'Từ'), fI, el('span', {}, 'đến'), tI, btn('Xem', go, ''), ...q], get from() { return fI.value; }, get to() { return tI.value; } };
}
const kitchenSel = (onChange) => {
  if (!KITCHENS.length) return null;
  const s = el('select', { style: 'width:auto' }, el('option', { value: '' }, 'Mọi bếp'), el('option', { value: '0' }, 'Chung / chưa phân bếp'),
    ...KITCHENS.map((k) => el('option', { value: String(k.id) }, k.name)));
  s.value = S.kitchen; s.onchange = () => { S.kitchen = s.value; onChange(); };
  return s;
};

/* =========================================== TRANG =========================================== */
export async function pageMealInv(ctx) {
  C = ctx; css();
  const main = el('div', { class: 'sa' });
  C.setMain(C.head('🥕 Suất ăn — định lượng nguyên liệu & kho bếp'), main);
  main.append(C.loading());
  try { await refreshRefs(); } catch (e) { main.innerHTML = ''; main.append(el('div', { class: 'empty' }, e.message)); return; }
  if (!S.from) { S.from = S.to = vnToday(); }
  if (!S.docTo) { S.docTo = vnToday(); S.docFrom = addDays(S.docTo, -29); }
  const TABS = [['need', '📊 Nhu cầu nấu'], ['recipe', '🍲 Định lượng món'], ['stock', '🥕 Nguyên liệu & tồn kho'], ['docs', '📄 Phiếu kho'], ['rpt', '📈 Báo cáo']];
  const tabs = el('div', { class: 'sa-seg sa-tabs' });
  const body = el('div');
  const drawTabs = () => {
    tabs.innerHTML = '';
    for (const [k, label] of TABS) { const b = el('button', { type: 'button', class: k === S.tab ? 'on' : '' }, label); b.onclick = () => { S.tab = k; drawTabs(); show(); }; tabs.append(b); }
  };
  const show = () => { body.innerHTML = ''; ({ need: tabNeed, recipe: tabRecipe, stock: tabStock, docs: tabDocs, rpt: tabRpt })[S.tab](body, go); };
  const go = (tab, extra = {}) => { Object.assign(S, extra); S.tab = tab; drawTabs(); show(); };
  drawTabs();
  main.innerHTML = '';
  main.append(tabs, body);
  show();
}

/* ------------------------------------------- 1. NHU CẦU NẤU ------------------------------------------- */
function tabNeed(box, go) {
  const res = el('div');
  const rb = rangeBar('from', 'to', load, [
    ['Hôm nay', vnToday, vnToday], ['Ngày mai', () => addDays(vnToday(), 1), () => addDays(vnToday(), 1)], ['7 ngày tới', vnToday, () => addDays(vnToday(), 6)]]);
  const ks = kitchenSel(load);
  box.append(el('div', { class: 'sa-bar' }, ...rb.nodes, ks,
    btn('⬇ Xuất Excel', () => download(`/admin/meal/inv/rpt.xlsx?type=need&from=${S.from}&to=${S.to}&kitchen=${S.kitchen}`, 'nhu_cau_nguyen_lieu.xlsx'))), res);
  async function load() {
    res.innerHTML = ''; res.append(C.loading());
    let r;
    try { r = await api(`/admin/meal/inv/needs?from=${S.from}&to=${S.to}&kitchen=${S.kitchen}`); } catch (e) { res.innerHTML = ''; res.append(el('div', { class: 'empty' }, e.message)); return; }
    res.innerHTML = '';
    const shortN = r.lines.filter((l) => l.short > 0).length;
    res.append(el('div', { class: 'sa-kpis' },
      kpi('Số suất phải nấu', nf(r.portions), S.from === S.to ? wdmy(S.from) : `${dmy(S.from)} → ${dmy(S.to)}`),
      kpi('Chi phí nguyên liệu (dự tính)', money(r.cost)),
      kpi('Chi phí / suất', r.portions ? money(r.cost / r.portions) : '—'),
      kpi('Nguyên liệu thiếu so với tồn', nf(shortN), shortN ? 'cần nhập thêm' : 'đủ hàng')));
    if (r.missing.length) {
      const miss = r.missing.reduce((t, x) => t + x.portions, 0);
      res.append(el('div', { class: 'sa-info sa-closed', style: 'margin-top:12px' },
        el('span', {}, el('b', {}, `⚠ ${r.missing.length} món chưa có định lượng`), ` — ${nf(miss)} suất chưa được tính nguyên liệu:`),
        ...r.missing.slice(0, 12).map((x) => { const b = el('button', { class: 'sa-btn ghost', type: 'button', style: 'padding:3px 10px;font-size:12.5px' }, `${x.dish || 'Suất chung — ' + x.shift_name} (${x.portions})`);
          b.onclick = () => go('recipe', { dish: { dish: x.dish, shift: x.dish ? '' : x.shift } }); return b; })));
    }
    if (!r.meals.length) { res.append(el('div', { class: 'sa-empty', style: 'margin-top:12px' }, 'Không có suất ăn nào phải nấu trong khoảng này (chưa ai đăng ký / chưa có thực đơn).')); return; }
    res.append(el('h4', { class: 'sa-h' }, '🧾 Tổng nguyên liệu cần'));
    res.append(table(['Nguyên liệu', ['Lượng cần'], 'ĐVT', ['Tồn hiện tại'], ['Thiếu'], ['Đơn giá'], ['Thành tiền']],
      r.lines.map((l) => el('tr', { class: l.short > 0 ? 'sa-row-red' : '' }, el('td', { class: 'dept' }, l.name), el('td', { class: 'num sa-total' }, qf(l.qty)), el('td', {}, l.unit),
        el('td', { class: 'num' }, qf(l.stock)), el('td', { class: 'num' }, l.short > 0 ? el('b', { style: 'color:var(--sa-red)' }, qf(l.short)) : '—'),
        el('td', { class: 'num' }, nf(l.price)), el('td', { class: 'num' }, nf(l.cost)))),
      el('tr', {}, el('td', { colspan: '6' }, 'Cộng'), el('td', { class: 'num' }, nf(r.cost)))));
    res.append(el('h4', { class: 'sa-h' }, '🍳 Theo từng bữa — xuất kho khi nấu'));
    for (const m of r.meals) {
      const st = m.issued ? pill('ok', `✓ Đã xuất kho ${stamp(m.issued.at)}${m.issued.by ? ' · ' + m.issued.by : ''}`) : pill('warn', 'Chưa xuất kho');
      const head = el('div', { class: 'sa-meal-head' },
        el('b', {}, `${wdmy(m.date)} · ${m.shift_name}`), r.kitchens.length ? el('span', { class: 'sa-pill muted' }, m.kitchen_name || kName(0)) : null,
        el('span', {}, el('b', { class: 'sa-total' }, nf(m.portions)), ' suất'), el('span', {}, money(m.cost), m.portions ? el('span', { class: 'sa-hint' }, ` (${money(m.cost / m.portions)}/suất)`) : null), st,
        btn(m.issued ? '✏️ Sửa phiếu xuất' : '📤 Xuất kho bữa này', () => cookDlg(m, load), m.issued ? 'ghost' : ''));
      const dishes = el('div', { class: 'sa-chips' }, ...m.dishes.map((d) => el('span', { class: 'sa-chip' + (d.has_recipe ? '' : ' bad'), title: d.has_recipe ? '' : 'Chưa có định lượng — chưa tính nguyên liệu' },
        `${d.dish || 'Suất chung'}: ${nf(d.qty)}${d.has_recipe ? '' : ' ⚠'}`)));
      const lines = m.lines.length ? table(['Nguyên liệu', ['Lượng cần'], 'ĐVT', ['Thành tiền']],
        m.lines.map((l) => el('tr', {}, el('td', {}, l.name), el('td', { class: 'num' }, qf(l.qty)), el('td', {}, l.unit), el('td', { class: 'num' }, nf(l.cost))))) : el('div', { class: 'sa-hint' }, 'Chưa có định lượng cho các món của bữa này.');
      res.append(el('div', { class: 'sa-card', style: 'margin-top:10px' }, head, dishes, lines));
    }
    res.append(el('div', { class: 'sa-hint', style: 'margin-top:8px' }, 'Số suất phải nấu lấy đúng số "Tổng phải nấu" của phân hệ suất ăn (gồm HR chọn hộ, điều chỉnh, thêm tay). Lượng cần = số suất × định lượng 1 suất. Bấm "Xuất kho bữa này" để trừ kho theo số đã tính (sửa tay được).'));
  }
  load();
}

// Hộp XUẤT KHO THEO NHU CẦU của 1 bữa: điền sẵn số đã tính, HR sửa / thêm nguyên liệu khác
async function cookDlg(m, done) {
  let cur = new Map();
  if (m.issued) { try { const d = await api(`/admin/meal/inv/docs/${m.issued.id}`); cur = new Map(d.lines.map((l) => [l.ingredient_id, l.qty])); } catch (e) { return toast(e.message, 'err'); } }
  const need = new Map(m.lines.map((l) => [l.ingredient_id, l.qty]));
  const ids = [...new Set([...need.keys(), ...cur.keys()])];
  const tb = el('tbody');
  const rows = [];
  const addRow = (id, isExtra = false) => {
    const i = ingOf(id);
    const sel = isExtra ? ingSelect(id) : null;
    const inp = el('input', { type: 'text', inputmode: 'decimal', class: 'sa-in', value: id && cur.has(id) ? String(cur.get(id)) : id && need.has(id) ? String(need.get(id)) : '' });
    const unit = el('td', {}, i?.unit || ''), stock = el('td', { class: 'num' }, i ? qf(i.stock) : '');
    if (sel) sel.onchange = () => { const x = ingOf(sel.value); unit.textContent = x?.unit || ''; stock.textContent = x ? qf(x.stock) : ''; };
    const rm = btn('✕', () => { tr.remove(); rows.splice(rows.indexOf(r), 1); });
    const tr = el('tr', {}, el('td', {}, sel || i?.name || '?'), el('td', { class: 'num' }, need.has(id) ? qf(need.get(id)) : '—'), el('td', { class: 'num' }, inp), unit, stock, el('td', {}, isExtra ? rm : null));
    const r = { get id() { return sel ? Number(sel.value) : id; }, inp };
    rows.push(r); tb.append(tr);
  };
  for (const id of ids) addRow(id);
  const note = el('input', { type: 'text', placeholder: 'Ghi chú (không bắt buộc)', maxlength: '300' });
  const save = el('button', { class: 'sa-btn' }, m.issued ? 'Lưu phiếu xuất' : 'Xuất kho');
  save.onclick = async () => {
    save.disabled = true;
    try {
      const lines = rows.filter((r) => r.id).map((r) => ({ ingredient_id: r.id, qty: r.inp.value }));
      await api('/admin/meal/inv/cook', { method: 'POST', body: { date: m.date, shift: m.shift, kitchen_id: m.kitchen_id, lines, note: note.value } });
      toast('Đã xuất kho', 'ok'); C.closeModal(); await refreshRefs(); done();
    } catch (e) { toast(e.message, 'err'); save.disabled = false; }
  };
  C.openModal(`📤 Xuất kho nấu — ${m.shift_name} ${wdmy(m.date)}${KITCHENS.length ? ' · ' + (m.kitchen_name || kName(0)) : ''}`, [el('div', { class: 'sa' },
    el('div', { class: 'sa-hint', style: 'margin-bottom:8px' }, `${nf(m.portions)} suất. Cột "Xuất thực tế" điền sẵn theo định lượng — sửa nếu bếp lấy nhiều / ít hơn. Xuất lại bữa này = sửa đúng phiếu này (không cộng dồn).`),
    el('div', { class: 'sa-wrap' }, el('table', { class: 'sa-tbl' }, el('thead', {}, el('tr', {}, el('th', {}, 'Nguyên liệu'), el('th', { class: 'num' }, 'Cần (tính)'), el('th', { class: 'num' }, 'Xuất thực tế'), el('th', {}, 'ĐVT'), el('th', { class: 'num' }, 'Tồn hiện tại'), el('th', {}))), tb)),
    el('div', { class: 'sa-actions' }, btn('+ Thêm nguyên liệu khác', () => addRow(null, true)), note))], [save]);
  wide(820);
}

/* ------------------------------------------- 2. ĐỊNH LƯỢNG MÓN ------------------------------------------- */
async function tabRecipe(box) {
  box.append(C.loading());
  let dishes;
  try { dishes = (await api('/admin/meal/inv/recipes')).dishes; } catch (e) { box.innerHTML = ''; box.append(el('div', { class: 'empty' }, e.message)); return; }
  box.innerHTML = '';
  if (!ING.some((i) => i.active)) {
    box.append(el('div', { class: 'sa-empty' }, 'Chưa có nguyên liệu nào — vào tab "Nguyên liệu & tồn kho" để thêm nguyên liệu trước (gạo, thịt, rau…).'));
    return;
  }
  const keyOf = (d) => (d.dish ? 'd:' + d.dish.toLocaleLowerCase('vi') : 's:' + d.shift);
  let cur = S.dish ? dishes.find((d) => keyOf(d) === keyOf(S.dish)) || (S.dish.dish ? { dish: S.dish.dish, shift: '', label: S.dish.dish, lines: [], cost: 0, in_menu: 0 } : null) : null;
  if (cur && !dishes.includes(cur)) dishes.push(cur);
  const q = el('input', { type: 'search', placeholder: 'Tìm món…' });
  const list = el('div', { class: 'sa-dish-list' });
  const editor = el('div', { class: 'sa-card' });
  const newI = el('input', { type: 'text', placeholder: 'Món khác chưa có trong thực đơn…', maxlength: '80' });
  const addNew = btn('+ Thêm', () => {
    const n = newI.value.replace(/\s+/g, ' ').trim(); if (!n) return;
    let d = dishes.find((x) => x.dish && x.dish.toLocaleLowerCase('vi') === n.toLocaleLowerCase('vi'));
    if (!d) { d = { dish: n, shift: '', label: n, lines: [], cost: 0, in_menu: 0 }; dishes.push(d); }
    newI.value = ''; pick(d);
  });
  box.append(el('div', { class: 'sa-recipe' }, el('div', {}, el('div', { class: 'sa-bar', style: 'margin-bottom:8px' }, q), list,
    el('div', { class: 'sa-bar', style: 'margin-top:8px' }, newI, addNew)), editor),
  el('div', { class: 'sa-hint', style: 'margin-top:8px' }, 'Định lượng = lượng nguyên liệu cho 1 suất. Món có tên dùng chung cho mọi ngày, mọi bữa (theo tên món trong thực đơn). "Suất chung" của từng bữa dùng cho suất không chọn món (chế độ chỉ đăng ký ăn, hoặc trưởng bộ phận báo thêm số).'));
  const drawList = () => {
    const k = noAcc(q.value.trim());
    list.innerHTML = '';
    for (const d of dishes.filter((x) => !k || noAcc(x.label).includes(k))) {
      const it = el('button', { type: 'button', class: 'sa-dish' + (cur && keyOf(cur) === keyOf(d) ? ' on' : '') },
        el('span', { class: 'n' }, d.label), d.lines.length ? el('span', { class: 'sa-pill ok' }, `${d.lines.length} NL · ${money(d.cost)}`) : el('span', { class: 'sa-pill warn' }, 'chưa có'),
        d.in_menu ? el('span', { class: 'sa-hint' }, ` · ${d.in_menu} lần trong thực đơn`) : null);
      it.onclick = () => pick(d);
      list.append(it);
    }
  };
  q.oninput = drawList;
  function pick(d) { cur = d; S.dish = { dish: d.dish, shift: d.shift }; drawList(); drawEditor(); }
  function drawEditor() {
    editor.innerHTML = '';
    if (!cur) { editor.append(el('div', { class: 'sa-empty' }, '← Chọn 1 món để nhập định lượng')); return; }
    const d = cur, tb = el('tbody'), rows = [];
    const total = el('b', { class: 'sa-total' });
    const recalc = () => { let t = 0; for (const r of rows) { const i = ingOf(r.sel.value); const a = parseFloat(String(r.inp.value).replace(',', '.')) || 0; const c = i ? (a / i.recipe_factor) * i.price : 0; r.cost.textContent = i ? money(c) : ''; r.unit.textContent = i ? i.recipe_unit : ''; t += c; } total.textContent = money(t); };
    const addRow = (l) => {
      const sel = ingSelect(l?.ingredient_id ?? null);
      const inp = el('input', { type: 'text', inputmode: 'decimal', class: 'sa-in', value: l ? String(l.amount).replace('.', ',') : '', placeholder: '0' });
      const unit = el('td', {}), cost = el('td', { class: 'num' });
      const tr = el('tr', {}, el('td', {}, sel), el('td', { class: 'num' }, inp), unit, cost, el('td', {}, btn('✕', () => { tr.remove(); rows.splice(rows.indexOf(r), 1); recalc(); })));
      const r = { sel, inp, unit, cost };
      sel.onchange = recalc; inp.oninput = recalc;
      rows.push(r); tb.append(tr);
    };
    for (const l of d.lines) addRow(l);
    if (!d.lines.length) addRow(null);
    const save = btn('💾 Lưu định lượng', async () => {
      try {
        const lines = rows.filter((r) => r.sel.value).map((r) => ({ ingredient_id: Number(r.sel.value), amount: r.inp.value }));
        const x = await api('/admin/meal/inv/recipes', { method: 'PUT', body: { dish: d.dish, shift: d.shift, lines } });
        d.lines = x.lines; d.cost = x.lines.reduce((t, l) => t + l.cost, 0);
        toast('Đã lưu định lượng', 'ok'); drawList(); drawEditor();
      } catch (e) { toast(e.message, 'err'); }
    }, '');
    editor.append(el('h4', {}, d.dish ? '🍲 ' + d.dish : '🍚 ' + d.label),
      el('div', { class: 'sa-hint', style: 'margin-bottom:8px' }, d.dish ? 'Lượng cho 1 suất. Áp dụng mọi ngày có món này trong thực đơn.' : 'Lượng cho 1 suất của bữa này khi không chọn món.'),
      el('div', { class: 'sa-wrap' }, el('table', { class: 'sa-tbl' }, el('thead', {}, el('tr', {}, el('th', {}, 'Nguyên liệu'), el('th', { class: 'num' }, 'Lượng / 1 suất'), el('th', {}, 'Đơn vị'), el('th', { class: 'num' }, 'Chi phí / suất'), el('th', {}))), tb)),
      el('div', { class: 'sa-actions' }, btn('+ Thêm nguyên liệu', () => { addRow(null); }), el('span', { style: 'margin-left:auto' }, 'Chi phí nguyên liệu / suất: ', total), save));
    recalc();
  }
  drawList(); drawEditor();
}

/* ------------------------------------------- 3. NGUYÊN LIỆU & TỒN KHO ------------------------------------------- */
async function tabStock(box) {
  let r;
  box.append(C.loading());
  try { r = await refreshRefs(); } catch (e) { box.innerHTML = ''; box.append(el('div', { class: 'empty' }, e.message)); return; }
  box.innerHTML = '';
  const reload = () => { box.innerHTML = ''; tabStock(box); };
  const q = el('input', { type: 'search', placeholder: 'Tìm nguyên liệu…', style: 'width:200px' });
  const off = el('input', { type: 'checkbox', style: 'width:auto', ...(S.showOff ? { checked: '' } : {}) });
  const act = ING.filter((i) => i.active);
  const cnt = (s) => act.filter((i) => i.state === s).length;
  box.append(el('div', { class: 'sa-bar' },
    btn('+ Thêm nguyên liệu', () => ingDlg(null, reload), ''), btn('📥 Nhập kho', () => docDlg('in', null, reload)), btn('📤 Xuất kho khác', () => docDlg('out', null, reload)),
    btn('📋 Kiểm kê', () => docDlg('count', null, reload)), q, el('label', { class: 'sa-chk' }, off, 'Hiện cả nguyên liệu ngừng dùng')),
  el('div', { class: 'sa-kpis' }, kpi('Nguyên liệu đang dùng', nf(act.length)), kpi('Giá trị tồn kho', money(act.reduce((t, i) => t + Math.max(0, i.value), 0))),
    kpi('Hết / không đủ kế hoạch', nf(cnt('out') + cnt('short')), `kế hoạch = ${r.plan_days} ngày từ hôm nay, bữa chưa xuất kho`), kpi('Sắp hết (≤ tồn tối thiểu)', nf(cnt('low')))));
  const wrap = el('div', { style: 'margin-top:12px' });
  box.append(wrap, el('div', { class: 'sa-hint', style: 'margin-top:8px' }, 'Tồn hiện tại = nhập − xuất ± kiểm kê. Đơn giá = giá nhập gần nhất (tự cập nhật khi nhập kho). "Cần cho kế hoạch" = nhu cầu các bữa từ hôm nay đến hết ngày thứ ' + r.plan_days + ' chưa xuất kho.'));
  const draw = () => {
    const k = noAcc(q.value.trim());
    const rows = ING.filter((i) => (S.showOff || i.active) && (!k || noAcc(i.name).includes(k)));
    wrap.innerHTML = '';
    if (!rows.length) { wrap.append(el('div', { class: 'sa-empty' }, ING.length ? 'Không có nguyên liệu khớp.' : 'Chưa có nguyên liệu nào. Bấm "+ Thêm nguyên liệu".')); return; }
    wrap.append(table(['Nguyên liệu', 'ĐVT', ['Đơn giá'], ['Tồn hiện tại'], ['Tồn tối thiểu'], [`Cần ${r.plan_days} ngày tới`], ['Thiếu'], ['Giá trị tồn'], 'Trạng thái', ''],
      rows.map((i) => {
        const [cls, txt] = STATE[i.state] || STATE.ok;
        return el('tr', { class: i.active ? (i.state === 'out' || i.state === 'short' ? 'sa-row-red' : i.state === 'low' ? 'sa-row-warn' : '') : 'sa-row-off' },
          el('td', { class: 'dept' }, i.name, i.note ? el('span', { class: 'sa-sub' }, i.note) : null), el('td', {}, i.unit), el('td', { class: 'num' }, nf(i.price)),
          el('td', { class: 'num sa-total' }, qf(i.stock)), el('td', { class: 'num' }, i.min_stock ? qf(i.min_stock) : '—'), el('td', { class: 'num' }, i.plan_need ? qf(i.plan_need) : '—'),
          el('td', { class: 'num' }, i.short ? el('b', { style: 'color:var(--sa-red)' }, qf(i.short)) : '—'), el('td', { class: 'num' }, nf(i.value)),
          el('td', {}, i.active ? pill(cls, txt) : pill('muted', 'Ngừng dùng')),
          el('td', { style: 'white-space:nowrap' }, btn('Sửa', () => ingDlg(i, reload)), ' ', btn('Xoá', async () => {
            if (!confirm(`Xoá nguyên liệu "${i.name}"?${i.used ? '\nĐã có định lượng / phiếu kho → chỉ chuyển sang "ngừng dùng", giữ lịch sử.' : ''}`)) return;
            try { const x = await api(`/admin/meal/inv/ingredients/${i.id}`, { method: 'DELETE' }); toast(x.deleted ? 'Đã xoá' : 'Đã chuyển sang ngừng dùng', 'ok'); reload(); } catch (e) { toast(e.message, 'err'); }
          })));
      })));
  };
  q.oninput = draw; off.onchange = () => { S.showOff = off.checked; draw(); };
  draw();
}

function ingDlg(i, done) {
  const name = el('input', { type: 'text', value: i?.name || '', maxlength: '60', placeholder: 'VD: Gạo tẻ, Thịt gà, Trứng vịt' });
  const unit = el('input', { type: 'text', value: i?.unit || 'kg', maxlength: '12', list: 'sa-units' });
  const price = el('input', { type: 'text', inputmode: 'decimal', value: i ? String(i.price) : '', placeholder: 'đồng / 1 đơn vị' });
  const min = el('input', { type: 'text', inputmode: 'decimal', value: i?.min_stock ? String(i.min_stock).replace('.', ',') : '', placeholder: 'để trống = không cảnh báo' });
  const note = el('input', { type: 'text', value: i?.note || '', maxlength: '200', placeholder: 'Quy cách, nhà cung cấp quen…' });
  const active = el('input', { type: 'checkbox', style: 'width:auto', ...(i && !i.active ? {} : { checked: '' }) });
  const hint = el('div', { class: 'sa-hint' });
  const syncHint = () => { const u = unit.value.trim().toLowerCase(); hint.textContent = u === 'kg' ? 'Định lượng món nhập theo gam (g), kho tính theo kg.' : u === 'lít' || u === 'l' ? 'Định lượng món nhập theo ml, kho tính theo lít.' : `Định lượng món nhập theo ${unit.value || 'đơn vị này'}.`; };
  unit.oninput = syncHint; syncHint();
  const save = el('button', { class: 'sa-btn' }, 'Lưu');
  save.onclick = async () => {
    try {
      await api(i ? `/admin/meal/inv/ingredients/${i.id}` : '/admin/meal/inv/ingredients', { method: i ? 'PUT' : 'POST',
        body: { name: name.value, unit: unit.value, price: price.value || 0, min_stock: min.value || 0, note: note.value, active: active.checked } });
      toast('Đã lưu', 'ok'); C.closeModal(); done();
    } catch (e) { toast(e.message, 'err'); }
  };
  C.openModal(i ? `Sửa nguyên liệu — ${i.name}` : '+ Thêm nguyên liệu', [el('div', { class: 'sa sa-form' },
    el('datalist', { id: 'sa-units' }, ...UNITS.map((u) => el('option', { value: u }))),
    el('label', {}, 'Tên nguyên liệu'), name, el('label', {}, 'Đơn vị tính (kho)'), unit, hint,
    el('label', {}, 'Đơn giá (đồng / 1 đơn vị) — tự cập nhật theo giá nhập gần nhất'), price,
    el('label', {}, 'Mức tồn tối thiểu (cảnh báo "sắp hết" khi tồn ≤ mức này)'), min, el('label', {}, 'Ghi chú'), note,
    el('label', { class: 'sa-chk', style: 'margin-top:10px' }, active, 'Đang dùng'))], [save]);
  setTimeout(() => name.focus(), 50);
}

// Hộp PHIẾU KHO: nhập (NCC, SL, giá) · xuất khác (bữa / bếp, SL) · kiểm kê (đếm thực tế từng nguyên liệu). doc = phiếu cũ để sửa
async function docDlg(kind, doc, done) {
  if (!ING.some((i) => i.active)) return toast('Chưa có nguyên liệu nào — thêm nguyên liệu trước', 'err');
  const date = el('input', { type: 'date', value: doc?.doc_date || vnToday() });
  const supplier = el('input', { type: 'text', value: doc?.supplier || '', maxlength: '120', placeholder: 'Nhà cung cấp' });
  const note = el('input', { type: 'text', value: doc?.note || '', maxlength: '300', placeholder: kind === 'out' ? 'Lý do: hư hỏng, dùng chung, nấu thêm…' : 'Ghi chú' });
  const shiftS = el('select', {}, el('option', { value: '' }, '— không gắn bữa —'), ...SHIFTS.filter((s) => s.enabled || s.code === doc?.shift).map((s) => el('option', { value: s.code }, s.name)));
  shiftS.value = doc?.shift || '';
  const kitS = el('select', {}, el('option', { value: '0' }, KITCHENS.length ? 'Chung / chưa phân bếp' : 'Bếp chung'), ...KITCHENS.map((k) => el('option', { value: String(k.id) }, k.name)));
  kitS.value = String(doc?.kitchen_id || 0);
  const tb = el('tbody'), rows = [];
  const totalEl = el('b', { class: 'sa-total' });
  const num = (v) => parseFloat(String(v ?? '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')) || 0;
  const recalc = () => {
    let t = 0;
    for (const r of rows) {
      const i = ingOf(r.id);
      if (kind === 'count') { const c = r.inp.value.trim(); const d = c === '' ? null : num(c) - (i?.stock || 0); r.diff.textContent = d == null ? '' : (d > 0 ? '+' : '') + qf(Math.round(d * 1000) / 1000); r.diff.style.color = d < 0 ? 'var(--sa-red)' : d > 0 ? 'var(--sa-ok)' : ''; if (d) t += d * (i?.price || 0); continue; }
      const v = num(r.inp.value) * (kind === 'in' ? num(r.price.value) : i?.price || 0);
      r.val.textContent = r.id ? nf(Math.round(v)) : ''; t += v;
    }
    totalEl.textContent = money(t);
  };
  const addRow = (l) => {
    const sel = kind === 'count' ? null : ingSelect(l?.ingredient_id ?? null);
    const i0 = ingOf(l?.ingredient_id);
    const inp = el('input', { type: 'text', inputmode: 'decimal', class: 'sa-in', value: kind === 'count' ? (l?.counted != null ? String(l.counted) : '') : l ? String(l.qty) : '' });
    const price = kind === 'in' ? el('input', { type: 'text', inputmode: 'decimal', class: 'sa-in', style: 'width:110px', value: l ? String(l.price) : '' }) : null;
    const unit = el('td', {}, i0?.unit || ''), stock = el('td', { class: 'num' }, i0 ? qf(i0.stock) : ''), val = el('td', { class: 'num' }), diff = el('td', { class: 'num' });
    const r = { get id() { return sel ? Number(sel.value) || null : l.ingredient_id; }, inp, price, val, diff };
    if (sel) sel.onchange = () => { const x = ingOf(sel.value); unit.textContent = x?.unit || ''; stock.textContent = x ? qf(x.stock) : ''; if (price && !price.value && x) price.value = String(x.price); recalc(); };
    inp.oninput = recalc; if (price) price.oninput = recalc;
    const rm = btn('✕', () => { tr.remove(); rows.splice(rows.indexOf(r), 1); recalc(); });
    const tr = kind === 'count'
      ? el('tr', {}, el('td', { class: 'dept' }, i0?.name || ''), unit, el('td', { class: 'num' }, i0 ? qf(i0.stock) : ''), el('td', { class: 'num' }, inp), diff)
      : el('tr', {}, el('td', {}, sel), el('td', { class: 'num' }, inp), unit, price ? el('td', { class: 'num' }, price) : stock, val, el('td', {}, rm));
    rows.push(r); tb.append(tr);
  };
  if (kind === 'count') {
    const cur = new Map((doc?.lines || []).map((l) => [l.ingredient_id, l]));
    for (const i of ING.filter((x) => x.active || cur.has(x.id))) addRow({ ingredient_id: i.id, counted: cur.get(i.id)?.counted ?? null });
  } else { for (const l of doc?.lines || []) addRow(l); if (!doc) { addRow(null); addRow(null); addRow(null); } }
  const heads = kind === 'count' ? ['Nguyên liệu', 'ĐVT', ['Sổ sách hiện tại'], ['Đếm thực tế'], ['Chênh lệch']]
    : kind === 'in' ? ['Nguyên liệu', ['Số lượng'], 'ĐVT', ['Đơn giá'], ['Thành tiền'], ''] : ['Nguyên liệu', ['Số lượng'], 'ĐVT', ['Tồn hiện tại'], ['Giá trị'], ''];
  const save = el('button', { class: 'sa-btn' }, doc ? 'Lưu phiếu' : kind === 'in' ? 'Nhập kho' : kind === 'out' ? 'Xuất kho' : 'Lưu kiểm kê');
  save.onclick = async () => {
    save.disabled = true;
    const lines = rows.filter((r) => r.id).map((r) => (kind === 'count' ? { ingredient_id: r.id, counted: r.inp.value } : { ingredient_id: r.id, qty: r.inp.value, ...(r.price ? { price: r.price.value } : {}) }));
    try {
      await api(doc ? `/admin/meal/inv/docs/${doc.id}` : '/admin/meal/inv/docs', { method: doc ? 'PUT' : 'POST',
        body: { kind, date: date.value, supplier: supplier.value, note: note.value, shift: shiftS.value, kitchen_id: Number(kitS.value) || 0, lines } });
      toast('Đã lưu phiếu', 'ok'); C.closeModal(); await refreshRefs(); done();
    } catch (e) { toast(e.message, 'err'); save.disabled = false; }
  };
  const title = { in: '📥 Phiếu nhập kho', out: '📤 Phiếu xuất kho (khác)', count: '📋 Phiếu kiểm kê' }[kind] + (doc ? ' ' + docNo(doc.id) : '');
  C.openModal(title, [el('div', { class: 'sa' },
    el('div', { class: 'sa-bar' }, el('span', {}, 'Ngày'), date, kind === 'in' ? supplier : null, kind === 'out' ? shiftS : null, kind === 'out' && KITCHENS.length ? kitS : null, note),
    kind === 'count' ? el('div', { class: 'sa-hint', style: 'margin-bottom:8px' }, 'Nhập số ĐẾM THỰC TẾ của nguyên liệu đã kiểm (bỏ trống = không kiểm). Chênh lệch = đếm thực tế − sổ sách; lưu xong tồn kho = số đếm.') : null,
    kind === 'out' ? el('div', { class: 'sa-hint', style: 'margin-bottom:8px' }, 'Xuất nấu theo bữa làm ở tab "Nhu cầu nấu" (điền sẵn số). Phiếu này dùng cho xuất khác: hư hỏng, dùng chung, nấu thêm ngoài kế hoạch…') : null,
    el('div', { class: 'sa-wrap', style: 'max-height:52vh;overflow:auto' }, el('table', { class: 'sa-tbl' }, el('thead', {}, el('tr', {}, ...heads.map((h) => (Array.isArray(h) ? el('th', { class: 'num' }, h[0]) : el('th', {}, h))))), tb)),
    el('div', { class: 'sa-actions' }, kind === 'count' ? null : btn('+ Thêm dòng', () => addRow(null)), el('span', { style: 'margin-left:auto' }, kind === 'count' ? 'Giá trị chênh lệch: ' : 'Tổng giá trị: ', totalEl)))], [save]);
  wide(kind === 'count' ? 760 : 820);
  recalc();
}

/* ------------------------------------------- 4. PHIẾU KHO ------------------------------------------- */
function tabDocs(box) {
  const res = el('div');
  const kindS = el('select', { style: 'width:auto' }, el('option', { value: '' }, 'Mọi loại phiếu'), el('option', { value: 'in' }, 'Nhập kho'), el('option', { value: 'out' }, 'Xuất kho'), el('option', { value: 'count' }, 'Kiểm kê'));
  kindS.value = S.docKind; kindS.onchange = () => { S.docKind = kindS.value; load(); };
  const rb = rangeBar('docFrom', 'docTo', load, [['30 ngày', () => addDays(vnToday(), -29), vnToday], ['Tháng này', () => vnToday().slice(0, 8) + '01', vnToday]]);
  box.append(el('div', { class: 'sa-bar' }, ...rb.nodes, kindS, btn('📥 Nhập kho', () => docDlg('in', null, load)), btn('📋 Kiểm kê', () => docDlg('count', null, load))), res);
  async function load() {
    res.innerHTML = ''; res.append(C.loading());
    let r;
    try { r = await api(`/admin/meal/inv/docs?from=${S.docFrom}&to=${S.docTo}&kind=${S.docKind}`); } catch (e) { res.innerHTML = ''; res.append(el('div', { class: 'empty' }, e.message)); return; }
    res.innerHTML = '';
    if (!r.rows.length) { res.append(el('div', { class: 'sa-empty' }, 'Chưa có phiếu kho nào trong khoảng này.')); return; }
    res.append(table(['Ngày', 'Số phiếu', 'Loại', 'Bữa / bếp', 'Nhà cung cấp / ghi chú', ['Số dòng'], ['Giá trị'], 'Người lập', ''],
      r.rows.map((d) => el('tr', {}, el('td', { style: 'white-space:nowrap' }, dmy(d.doc_date)), el('td', {}, docNo(d.id)), el('td', {}, pill(KIND[d.kind][0], KIND[d.kind][1] + (d.source === 'cook' ? ' nấu' : ''))),
        el('td', {}, [d.shift_name, d.kitchen_name].filter(Boolean).join(' · ') || '—'), el('td', { class: 'sa-hint' }, [d.supplier, d.note].filter(Boolean).join(' · ')),
        el('td', { class: 'num' }, nf(d.n)), el('td', { class: 'num' }, nf(d.value)), el('td', {}, d.created_by, el('span', { class: 'sa-sub' }, stamp(d.updated_at))),
        el('td', { style: 'white-space:nowrap' }, btn(d.source === 'cook' ? 'Xem' : 'Xem / sửa', () => viewDoc(d.id, load)), ' ', btn('Xoá', async () => {
          if (!confirm(`Xoá phiếu ${docNo(d.id)} (${KIND[d.kind][1]} ${dmy(d.doc_date)})? Tồn kho sẽ tính lại như chưa có phiếu này.`)) return;
          try { await api(`/admin/meal/inv/docs/${d.id}`, { method: 'DELETE' }); toast('Đã xoá phiếu', 'ok'); await refreshRefs(); load(); } catch (e) { toast(e.message, 'err'); }
        }))))));
  }
  load();
}
async function viewDoc(id, done) {
  let d;
  try { d = await api(`/admin/meal/inv/docs/${id}`); } catch (e) { return toast(e.message, 'err'); }
  if (d.source !== 'cook') return docDlg(d.kind, d, done);
  C.openModal(`📤 ${docNo(d.id)} — xuất nấu ${dmy(d.doc_date)}`, [el('div', { class: 'sa' },
    el('div', { class: 'sa-hint', style: 'margin-bottom:8px' }, `${d.note} · lập bởi ${d.created_by || '—'} lúc ${stamp(d.updated_at)}. Sửa phiếu này ở tab "Nhu cầu nấu" (nút "Sửa phiếu xuất" của bữa).`),
    table(['Nguyên liệu', ['Cần (tính)'], ['Đã xuất'], 'ĐVT', ['Giá vốn'], ['Giá trị']], d.lines.map((l) => el('tr', {}, el('td', {}, l.name), el('td', { class: 'num' }, l.need == null ? '—' : qf(l.need)),
      el('td', { class: 'num sa-total' }, qf(l.qty)), el('td', {}, l.unit), el('td', { class: 'num' }, nf(l.price)), el('td', { class: 'num' }, nf(l.value))))),
    el('div', { class: 'sa-actions' }, el('span', { style: 'margin-left:auto' }, 'Tổng: ', el('b', { class: 'sa-total' }, money(d.value)))))]);
  wide(720);
}

/* ------------------------------------------- 5. BÁO CÁO ------------------------------------------- */
function tabRpt(box) {
  const TYPES = [['need', '1. Nhu cầu nguyên liệu theo ngày / bữa'], ['stock', '2. Nhập – xuất – tồn theo kỳ'], ['cost', '3. Chi phí nguyên liệu / suất']];
  const seg = el('div', { class: 'sa-seg', style: 'margin-bottom:10px;flex-wrap:wrap' });
  const res = el('div');
  if (!S.rptFrom) { S.rptTo = vnToday(); S.rptFrom = vnToday().slice(0, 8) + '01'; }
  const drawSeg = () => { seg.innerHTML = ''; for (const [k, l] of TYPES) { const b = el('button', { type: 'button', class: k === S.rpt ? 'on' : '' }, l); b.onclick = () => { S.rpt = k; drawSeg(); load(); }; seg.append(b); } };
  drawSeg();
  const rb = rangeBar('rptFrom', 'rptTo', load, [['Hôm nay', vnToday, vnToday], ['7 ngày', () => addDays(vnToday(), -6), vnToday], ['Tháng này', () => vnToday().slice(0, 8) + '01', vnToday],
    ['Tháng trước', () => { const d = new Date(vnToday().slice(0, 8) + '01T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); }, () => addDays(vnToday().slice(0, 8) + '01', -1)]]);
  const ks = kitchenSel(load);
  box.append(seg, el('div', { class: 'sa-bar' }, ...rb.nodes, ks,
    btn('⬇ Xuất Excel', () => download(`/admin/meal/inv/rpt.xlsx?type=${S.rpt}&from=${S.rptFrom}&to=${S.rptTo}&kitchen=${S.kitchen}`, 'bao_cao_nguyen_lieu.xlsx'))), res);
  async function load() {
    if (ks) ks.style.display = S.rpt === 'stock' ? 'none' : '';
    res.innerHTML = ''; res.append(C.loading());
    let r;
    const url = S.rpt === 'need' ? `/admin/meal/inv/needs?from=${S.rptFrom}&to=${S.rptTo}&kitchen=${S.kitchen}` : `/admin/meal/inv/rpt/${S.rpt}?from=${S.rptFrom}&to=${S.rptTo}&kitchen=${S.kitchen}`;
    try { r = await api(url); } catch (e) { res.innerHTML = ''; res.append(el('div', { class: 'empty' }, e.message)); return; }
    res.innerHTML = '';
    ({ need: rptNeed, stock: rptStock, cost: rptCost })[S.rpt](r);
  }
  function rptNeed(r) {
    if (!r.meals.length) { res.append(el('div', { class: 'sa-empty' }, 'Không có suất ăn nào trong khoảng này.')); return; }
    res.append(el('div', { class: 'sa-kpis' }, kpi('Số suất', nf(r.portions)), kpi('Chi phí dự tính', money(r.cost)), kpi('Chi phí / suất', r.portions ? money(r.cost / r.portions) : '—'), kpi('Món chưa có định lượng', nf(r.missing.length))));
    const tb = [];
    for (const m of r.meals) {
      tb.push(el('tr', { style: 'background:var(--sa-soft)' }, el('td', { class: 'dept', style: 'white-space:nowrap' }, wdmy(m.date)), el('td', { class: 'dept' }, m.shift_name), r.kitchens.length ? el('td', {}, m.kitchen_name || kName(0)) : null,
        el('td', { class: 'num sa-total' }, nf(m.portions)), el('td', { class: 'sa-hint' }, m.dishes.map((d) => `${d.dish || 'Suất chung'}: ${d.qty}${d.has_recipe ? '' : ' ⚠'}`).join(' · ')),
        el('td', {}), el('td', {}), el('td', { class: 'num sa-total' }, nf(m.cost)), el('td', {}, m.issued ? pill('ok', 'Đã xuất') : '')));
      for (const l of m.lines) tb.push(el('tr', {}, el('td', {}), el('td', {}), r.kitchens.length ? el('td', {}) : null, el('td', {}), el('td', { style: 'padding-left:24px' }, '↳ ' + l.name),
        el('td', { class: 'num' }, qf(l.qty)), el('td', {}, l.unit), el('td', { class: 'num' }, nf(l.cost)), el('td', {})));
    }
    res.append(el('div', { style: 'margin-top:12px' }, table(['Ngày', 'Bữa', ...(r.kitchens.length ? ['Bếp'] : []), ['Số suất'], 'Món / nguyên liệu', ['Lượng'], 'ĐVT', ['Thành tiền'], ''], tb)));
  }
  function rptStock(r) {
    res.append(el('div', { class: 'sa-kpis' }, kpi('Tiền nhập trong kỳ', money(r.totals.in_value)), kpi('Tiền xuất trong kỳ', money(r.totals.out_value)), kpi('Giá trị tồn cuối kỳ', money(r.totals.closing_value))));
    if (!r.rows.length) { res.append(el('div', { class: 'sa-empty' }, 'Chưa có nguyên liệu.')); return; }
    res.append(el('div', { style: 'margin-top:12px' }, table(['Nguyên liệu', 'ĐVT', ['Tồn đầu kỳ'], ['Nhập'], ['Tiền nhập'], ['Xuất'], ['Tiền xuất'], ['Kiểm kê ±'], ['Tồn cuối kỳ'], ['Giá trị tồn']],
      r.rows.map((x) => el('tr', { class: x.closing <= 0 ? 'sa-row-red' : x.min_stock > 0 && x.closing <= x.min_stock ? 'sa-row-warn' : '' },
        el('td', { class: 'dept' }, x.name + (x.active ? '' : ' (ngừng dùng)')), el('td', {}, x.unit), el('td', { class: 'num' }, qf(x.opening)), el('td', { class: 'num' }, x.in_qty ? qf(x.in_qty) : '—'),
        el('td', { class: 'num' }, x.in_value ? nf(x.in_value) : '—'), el('td', { class: 'num' }, x.out_qty ? qf(x.out_qty) : '—'), el('td', { class: 'num' }, x.out_value ? nf(x.out_value) : '—'),
        el('td', { class: 'num' }, x.adj ? (x.adj > 0 ? '+' : '') + qf(x.adj) : '—'), el('td', { class: 'num sa-total' }, qf(x.closing)), el('td', { class: 'num' }, nf(x.closing_value)))),
      el('tr', {}, el('td', { colspan: '4' }, 'Cộng'), el('td', { class: 'num' }, nf(r.totals.in_value)), el('td', {}), el('td', { class: 'num' }, nf(r.totals.out_value)), el('td', {}), el('td', {}), el('td', { class: 'num' }, nf(r.totals.closing_value))))),
    el('div', { class: 'sa-hint', style: 'margin-top:8px' }, 'Tồn cuối = tồn đầu + nhập − xuất ± kiểm kê. Giá trị tồn tính theo đơn giá hiện tại (giá nhập gần nhất). Chi tiết từng phiếu có trong file Excel.'));
  }
  function rptCost(r) {
    const t = r.totals;
    res.append(el('div', { class: 'sa-kpis' }, kpi('Số suất', nf(t.portions)), kpi('Chi phí nguyên liệu', money(t.cost)), kpi('Chi phí / suất', t.per_portion == null ? '—' : money(t.per_portion)),
      r.other ? kpi('Xuất khác (không gắn bữa)', money(r.other), `tính cả phần này: ${money(t.per_portion_all)}/suất`) : null));
    if (!r.rows.length) { res.append(el('div', { class: 'sa-empty' }, 'Không có dữ liệu trong khoảng này.')); return; }
    res.append(el('div', { style: 'margin-top:12px' }, table(['Ngày', 'Bữa', ...(r.kitchens.length ? ['Bếp'] : []), ['Số suất'], ['Dự tính'], ['Thực xuất kho'], ['Chi phí / suất'], 'Ghi chú'],
      r.rows.map((x) => el('tr', {}, el('td', { style: 'white-space:nowrap' }, wdmy(x.date)), el('td', { class: 'dept' }, x.shift_name), r.kitchens.length ? el('td', {}, x.kitchen_name || kName(0)) : null,
        el('td', { class: 'num' }, nf(x.portions)), el('td', { class: 'num' }, nf(x.est_cost)), el('td', { class: 'num' }, x.actual_cost == null ? '—' : nf(x.actual_cost)),
        el('td', { class: 'num sa-total' }, x.per_portion == null ? '—' : nf(x.per_portion)),
        el('td', { class: 'sa-hint' }, [x.actual_cost == null ? 'chưa xuất kho — theo dự tính' : '', x.missing ? 'có món chưa có định lượng' : ''].filter(Boolean).join(' · ')))))),
    el('div', { class: 'sa-hint', style: 'margin-top:8px' }, 'Dự tính = định lượng × đơn giá hiện tại. Thực xuất = giá trị phiếu xuất kho của bữa (giá vốn lúc xuất). Chi phí / suất dùng số thực xuất nếu bữa đã xuất kho.'));
  }
  load();
}
