// QUẢN LÝ SUẤT ĂN (giao diện HR trong /admin) — Đối chiếu & chốt · Tổng hợp & điều chỉnh theo món · Thực đơn · Cấu hình · Suất ăn của tôi.
// Chỉ nạp khi mở menu "Suất ăn" (admin.js gọi import('/suatan/admin.js')), và chỉ khi tài khoản tổng đã bật phân hệ.
import { api, toast, el } from '/common.js';
import { renderMealTab } from '/suatan/emp.js';

let C = null;   // { head, setMain, openModal, closeModal, loading, hasPerm, go }
const ST = { date: '', shift: '' };   // nhớ ngày + ca đang xem giữa các lần mở trang

function css() {
  if (!document.getElementById('sa-css')) document.head.append(el('link', { id: 'sa-css', rel: 'stylesheet', href: '/suatan/suatan.css' }));
}
const vnToday = () => new Date().toLocaleDateString('sv', { timeZone: 'Asia/Ho_Chi_Minh' });
const dmy = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '');
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const nf = (n) => (n == null ? '—' : Number(n).toLocaleString('vi-VN'));
// bỏ dấu + chữ thường để tìm tên không cần gõ dấu
const noAcc = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
const MODE_TXT = {
  punch: 'Đối chiếu LƯỢT CHẤM CÔNG hợp lệ (quẹt ngoài giờ chốt bị loại) với số trưởng bộ phận đăng ký',
  ot: 'KHÔNG đếm chấm công — đối chiếu số ĐĂNG KÝ LÀM THÊM (từ Đăng ký làm thêm) với số trưởng bộ phận đăng ký',
};
const hhmm = (iso) => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' });

/* ===================== ĐỐI CHIẾU & CHỐT ===================== */
export async function pageMealBoard(ctx) {
  C = ctx; css();
  const main = el('div', { class: 'sa' });
  C.setMain(C.head('🍱 Suất ăn — đối chiếu & chốt số'), main);
  main.append(C.loading());
  let shifts = [];
  try { shifts = (await api('/admin/meal/shifts')).shifts; } catch (e) { main.innerHTML = ''; main.append(el('div', { class: 'empty' }, e.message)); return; }
  const on = shifts.filter((s) => s.enabled);
  if (!on.length) { main.innerHTML = ''; main.append(el('div', { class: 'empty' }, 'Chưa bật ca ăn nào — vào Suất ăn › Cấu hình để bật.')); return; }
  if (!ST.date) ST.date = vnToday();
  if (!on.some((s) => s.code === ST.shift)) ST.shift = on[0].code;

  const dateI = el('input', { type: 'date', value: ST.date });
  const seg = el('div', { class: 'sa-seg' });
  for (const s of on) {
    const b = el('button', { type: 'button', class: s.code === ST.shift ? 'on' : '' }, s.name);
    b.onclick = () => { ST.shift = s.code; seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); load(); };
    seg.append(b);
  }
  const prev = el('button', { class: 'sa-btn ghost', type: 'button', title: 'Hôm trước' }, '‹');
  const next = el('button', { class: 'sa-btn ghost', type: 'button', title: 'Hôm sau' }, '›');
  const reload = el('button', { class: 'sa-btn ghost', type: 'button' }, '⟳ Làm mới');
  const dishBtn = el('button', { class: 'sa-btn ghost', type: 'button' }, '🍽️ Tổng hợp món');
  dateI.onchange = () => { if (dateI.value) { ST.date = dateI.value; load(); } };
  prev.onclick = () => { ST.date = addDays(ST.date, -1); dateI.value = ST.date; load(); };
  next.onclick = () => { ST.date = addDays(ST.date, 1); dateI.value = ST.date; load(); };
  reload.onclick = () => load();
  dishBtn.onclick = () => showDishes();
  const body = el('div');
  main.innerHTML = '';
  main.append(el('div', { class: 'sa-bar' }, prev, dateI, next, seg, reload, dishBtn), body);

  async function showDishes() {
    try {
      const r = await api(`/admin/meal/orders?date=${ST.date}&shift=${ST.shift}`);
      const nodes = r.dishes.length
        ? [el('div', { class: 'sa-hint', style: 'margin-bottom:8px' }, `${r.total} nhân viên đã chọn món cho ${dmy(ST.date)}.`),
          el('table', { class: 'sa-tbl' },
            el('thead', {}, el('tr', {}, el('th', {}, 'Món'), el('th', { class: 'num' }, 'Số suất'), el('th', {}, 'Theo bộ phận'))),
            el('tbody', {}, ...r.dishes.map((d) => el('tr', {}, el('td', { class: 'dept' }, d.dish), el('td', { class: 'num sa-total' }, nf(d.total)),
              el('td', { class: 'sa-hint' }, d.byDept.map((x) => `${x.department || '(chưa có BP)'}: ${x.n}`).join(' · '))))))]
        : [el('div', { class: 'sa-empty' }, 'Chưa có nhân viên nào chọn món cho ca này.')];
      C.openModal('🍽️ Tổng hợp món đã chọn', nodes);
    } catch (e) { toast(e.message, 'err'); }
  }

  async function load() {
    body.innerHTML = ''; body.append(C.loading());
    let d;
    try { d = await api(`/admin/meal/board?date=${ST.date}&shift=${ST.shift}`); }
    catch (e) { body.innerHTML = ''; body.append(el('div', { class: 'empty' }, e.message)); return; }
    draw(d);
  }

  function draw(d) {
    body.innerHTML = '';
    const sh = d.shift, isOt = sh.mode === 'ot', closed = !!d.closed;
    const info = el('div', { class: 'sa-info' + (closed ? ' sa-closed' : '') },
      el('span', {}, el('b', {}, sh.name), ` · ngày ${dmy(d.date)}`),
      el('span', {}, '⏱ Giờ chốt: ', el('b', {}, `${sh.from_time} → ${sh.to_time}`)),
      el('span', { class: 'sa-hint' }, MODE_TXT[sh.mode]),
      !isOt ? el('span', { title: 'Lượt quẹt máy chấm công nằm sát khung giờ chốt (trong vòng 1 giờ trước / sau) nhưng ngoài khung → không tính suất ăn' }, 'Quẹt sát giờ nhưng ngoài khung (bị loại): ', el('b', { class: 'num' }, nf(d.outside))) : null,
      closed ? el('span', { class: 'sa-pill red' }, `🔒 Đã chốt ${nf(d.closed.total)} suất — ${d.closed.by || ''} lúc ${d.closed.at || ''}`) : el('span', { class: 'sa-pill warn' }, 'Chưa chốt'));
    const inputs = [];
    const rowsEl = d.board.rows.map((r) => {
      const inp = el('input', { type: 'number', min: '0', max: '99999', step: '1', class: 'sa-in', value: r.registered == null ? '' : String(r.registered), placeholder: '—', ...(closed ? { disabled: '' } : {}) });
      const note = el('input', { type: 'text', class: 'sa-note', value: r.note || '', placeholder: 'Ghi chú', maxlength: '200', ...(closed ? { disabled: '' } : {}) });
      const mark = () => { const dirty = inp.value !== (r.registered == null ? '' : String(r.registered)) || note.value !== (r.note || ''); inp.classList.toggle('dirty', dirty); r._dirty = dirty; saveBtn.disabled = !inputs.some((x) => x.r._dirty); };
      inp.oninput = mark; note.oninput = mark;
      inp.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); const i = inputs.findIndex((x) => x.inp === inp); inputs[i + 1]?.inp.focus(); inputs[i + 1]?.inp.select(); } };
      inputs.push({ r, inp, note });
      const diffCls = r.diff == null ? '' : r.diff > 0 ? 'pos' : r.diff < 0 ? 'neg' : 'zero';
      const tr = el('tr', { class: r.missing ? 'miss' : '' },
        el('td', { class: 'dept' }, r.department || '(Chưa có bộ phận)'),
        isOt ? el('td', { class: 'num' }, nf(r.ot_people), el('span', { class: 'sa-sub' }, `${nf(Math.round(r.ot_minutes / 6) / 10)} giờ`))
          : el('td', { class: 'num' }, nf(r.punch_people), r.punch_swipes !== r.punch_people ? el('span', { class: 'sa-sub' }, `${nf(r.punch_swipes)} lượt quẹt`) : null),
        el('td', { class: 'num' }, inp),
        el('td', { class: 'num' }, el('span', { class: 'sa-diff ' + diffCls }, r.diff == null ? '—' : (r.diff > 0 ? '+' : r.diff < 0 ? '−' : '') + nf(Math.abs(r.diff)))),
        el('td', { class: 'num sa-total' }, nf(r.total)),
        el('td', {}, note));
      return tr;
    });
    const t = d.board.totals;
    const tbl = el('table', { class: 'sa-tbl' },
      el('thead', {}, el('tr', {},
        el('th', {}, 'Bộ phận'),
        el('th', { class: 'num', title: isOt ? 'Số người có đăng ký làm thêm trong ngày' : 'Số người có lượt quẹt máy chấm công trong giờ chốt (mỗi người 1 suất)' }, isOt ? 'Đăng ký tăng ca' : 'Lượt chấm hợp lệ'),
        el('th', { class: 'num' }, 'Trưởng BP đăng ký'),
        el('th', { class: 'num', title: 'Trưởng BP đăng ký − số tham chiếu' }, 'Chênh lệch'),
        el('th', { class: 'num' }, 'Tổng suất'),
        el('th', {}, 'Ghi chú'))),
      el('tbody', {}, ...(rowsEl.length ? rowsEl : [el('tr', {}, el('td', { colspan: '6', class: 'sa-empty' }, 'Chưa có bộ phận nào.'))])),
      el('tfoot', {}, el('tr', {},
        el('td', {}, 'Tổng cộng'),
        el('td', { class: 'num' }, nf(isOt ? t.ot_people : t.punch_people)),
        el('td', { class: 'num' }, nf(t.registered)),
        el('td', { class: 'num' }, el('span', { class: 'sa-diff ' + (t.diff > 0 ? 'pos' : t.diff < 0 ? 'neg' : 'zero') }, (t.diff > 0 ? '+' : t.diff < 0 ? '−' : '') + nf(Math.abs(t.diff)))),
        el('td', { class: 'num sa-total', style: 'font-size:17px' }, nf(t.total)),
        el('td', {}, t.missing ? el('span', { class: 'sa-pill red' }, `${t.missing} bộ phận chưa đăng ký`) : el('span', { class: 'sa-pill ok' }, 'Đủ bộ phận')))));

    const saveBtn = el('button', { class: 'sa-btn', type: 'button', disabled: '' }, '💾 Lưu số đăng ký');
    saveBtn.onclick = async () => {
      const items = inputs.filter((x) => x.r._dirty).map((x) => ({ department: x.r.department, count: x.inp.value.trim(), note: x.note.value }));
      if (!items.length) return;
      saveBtn.disabled = true;
      try { await api('/admin/meal/registrations', { method: 'PUT', body: { date: ST.date, shift: ST.shift, items } }); toast(`Đã lưu ${items.length} bộ phận`, 'ok'); load(); }
      catch (e) { toast(e.message, 'err'); saveBtn.disabled = false; }
    };
    const closeBtn = el('button', { class: 'sa-btn red', type: 'button' }, `✔ Chốt số suất (${nf(t.total)})`);
    closeBtn.onclick = async () => {
      if (inputs.some((x) => x.r._dirty)) return toast('Còn thay đổi chưa lưu — bấm "Lưu số đăng ký" trước', 'err');
      if (t.missing && !confirm(`Còn ${t.missing} bộ phận CHƯA đăng ký (tính 0 suất). Vẫn chốt ${nf(t.total)} suất ${sh.name} ngày ${dmy(d.date)}?`)) return;
      else if (!t.missing && !confirm(`Chốt ${nf(t.total)} suất ${sh.name} ngày ${dmy(d.date)}? Chốt xong trưởng bộ phận không sửa được nữa.`)) return;
      try { await api('/admin/meal/close', { method: 'POST', body: { date: ST.date, shift: ST.shift } }); toast('Đã chốt', 'ok'); load(); } catch (e) { toast(e.message, 'err'); }
    };
    const reopenBtn = el('button', { class: 'sa-btn ghost', type: 'button' }, '🔓 Mở lại để sửa');
    reopenBtn.onclick = async () => {
      if (!confirm('Mở lại ca này để sửa số đăng ký?')) return;
      try { await api('/admin/meal/reopen', { method: 'POST', body: { date: ST.date, shift: ST.shift } }); load(); } catch (e) { toast(e.message, 'err'); }
    };
    body.append(info, el('div', { class: 'sa-wrap' }, tbl),
      el('div', { class: 'sa-actions' }, ...(closed ? [reopenBtn] : [saveBtn, closeBtn]),
        el('span', { class: 'sa-hint' }, isOt
          ? 'Ca chiều không đếm chấm công. HR so số trưởng bộ phận gửi với số đăng ký làm thêm của bộ phận trong ngày.'
          : 'Mỗi người chỉ tính 1 suất/ca dù quẹt nhiều lần trong giờ chốt. Số "Tổng suất" lấy theo số trưởng bộ phận đăng ký.')));
  }
  load();
}

/* ===================== THỰC ĐƠN ===================== */
export async function pageMealMenu(ctx) {
  C = ctx; css();
  const main = el('div', { class: 'sa' });
  C.setMain(C.head('🍽️ Suất ăn — thực đơn các bữa'), main);
  main.append(C.loading());
  if (!ST.date) ST.date = vnToday();
  const dateI = el('input', { type: 'date', value: ST.date });
  const copyBtn = el('button', { class: 'sa-btn ghost', type: 'button', title: 'Chép thực đơn hôm trước sang ngày này (chỉ ca đang trống)' }, '⧉ Chép từ hôm trước');
  const grid = el('div', { class: 'sa-grid' });
  main.innerHTML = '';
  main.append(el('div', { class: 'sa-bar' }, dateI, copyBtn), el('div', { class: 'sa-hint', style: 'margin-bottom:10px' }, 'Mỗi dòng là một món. Nhân viên chọn món trên app (tab Suất ăn) cho từng bữa; khi quẹt máy chấm công, màn hình bếp hiện tên + món đã chọn.'), grid);
  dateI.onchange = () => { if (dateI.value) { ST.date = dateI.value; load(); } };
  copyBtn.onclick = async () => {
    try { const r = await api('/admin/meal/menu/copy', { method: 'POST', body: { from: addDays(ST.date, -1), to: ST.date } }); toast(r.copied ? `Đã chép ${r.copied} món` : 'Ngày này đã có thực đơn / hôm trước chưa có thực đơn', r.copied ? 'ok' : ''); load(); }
    catch (e) { toast(e.message, 'err'); }
  };
  async function load() {
    let r;
    try { r = await api('/admin/meal/menu?date=' + ST.date); } catch (e) { grid.innerHTML = ''; grid.append(el('div', { class: 'empty' }, e.message)); return; }
    grid.innerHTML = '';
    for (const s of r.shifts.filter((x) => x.enabled)) {
      const ta = el('textarea', { placeholder: 'VD:\nCơm gà xối mỡ\nCơm sườn nướng\nBún bò Huế' });
      ta.value = (r.menu[s.code] || []).map((m) => m.name).join('\n');
      const save = el('button', { class: 'sa-btn', type: 'button', style: 'margin-top:8px' }, '💾 Lưu');
      save.onclick = async () => {
        try { const x = await api('/admin/meal/menu', { method: 'PUT', body: { date: ST.date, shift: s.code, dishes: ta.value.split('\n') } }); toast(`Đã lưu ${x.saved} món — ${s.name}`, 'ok'); }
        catch (e) { toast(e.message, 'err'); }
      };
      grid.append(el('div', { class: 'sa-card' }, el('h4', {}, `${s.name} `, el('span', { class: 'sa-pill muted' }, `${s.from_time} → ${s.to_time}`)), ta, save));
    }
  }
  load();
}

/* ===================== dùng chung: bếp, giờ, gửi bếp ===================== */
const kitchenNamer = (kitchens) => { const m = new Map(kitchens.map((k) => [k.id, k.name])); return (id) => m.get(id) || (kitchens.length ? 'Chưa phân bếp' : '—'); };
// 'YYYY-MM-DD HH:MM' (giờ VN) → 'HH:MM' nếu cùng ngày `day`, khác ngày thì thêm 'dd/mm'
const atTxt = (v, day) => (v ? v.slice(11) + (v.slice(0, 10) === day ? '' : ' ' + dmy(v.slice(0, 10)).slice(0, 5)) : '');
// datetime('now') của SQLite (UTC) hoặc ISO → 'HH:MM dd/mm' giờ VN
const stamp = (s) => { if (!s) return ''; const t = new Date(Date.parse(s.includes('T') ? s : s.replace(' ', 'T') + 'Z') + 7 * 3600000).toISOString(); return `${t.slice(11, 16)} ${t.slice(8, 10)}/${t.slice(5, 7)}`; };
const STATE = { wait: ['muted', '⏳ Chưa mở đăng ký'], open: ['warn', '🟢 Đang nhận đăng ký'], locked: ['ok', '🔒 Đã khoá đăng ký'] };
const statePill = (st) => el('span', { class: 'sa-pill ' + (STATE[st] || STATE.open)[0] }, (STATE[st] || STATE.open)[1]);
// gốc liên kết màn hình bếp: tên miền HR đã lưu > tên miền tunnel (khi đang mở bằng localhost/IP) > địa chỉ đang mở
const isLocalHost = () => /^(localhost|127\.|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);
const kitchenUrl = (kit, key) => `${kit.base || (isLocalHost() && kit.domain ? 'https://' + kit.domain : location.origin)}/bep/${String(key).toUpperCase()}`;
const copyText = async (t) => { try { await navigator.clipboard.writeText(t); toast('Đã sao chép', 'ok'); } catch { toast('Không sao chép được — bôi đen rồi Ctrl+C', 'err'); } };

// Ô chọn nhân viên trong hộp thoại: BẤM VÀO là hiện cả danh sách (tải 1 lần / bữa), gõ để lọc (không cần dấu).
// Bấm 1 dòng = chọn / bỏ chọn (onToggle); multi = có nút "Chọn tất cả đang lọc". info(e) = chữ phụ sau tên.
const PICK_MAX = 400;   // vẽ tối đa ngần này dòng — đông hơn thì gõ để lọc
function empPicker({ date, getShift, info, isOn, onToggle, onAll = null }) {
  const q = el('input', { type: 'search', placeholder: 'Bấm để xem danh sách · gõ mã hoặc tên để lọc (không cần dấu)…', autocomplete: 'off' });
  const list = el('div', { class: 'sa-picklist', style: 'display:none' });
  let rows = null, loadedFor = '', loading = false, lastK = null;
  const draw = () => {
    const k = noAcc(q.value.trim());
    const hit = rows.filter((e) => !k || noAcc(e.code).includes(k) || noAcc(e.full_name).includes(k));
    const keep = k === lastK ? list.scrollTop : 0;   // chọn / bỏ chọn → giữ chỗ đang cuộn; gõ lọc mới → về đầu
    lastK = k;
    list.innerHTML = '';
    const top = el('div', { style: 'display:flex;gap:8px;align-items:center;justify-content:space-between' }, el('span', { class: 'sa-hint' }, `${nf(hit.length)} nhân viên${k ? ' khớp' : ''}`));
    if (onAll && hit.length) {
      const allOn = hit.every(isOn);
      const b = el('button', { type: 'button', class: 'sa-btn ghost', style: 'padding:3px 10px;font-size:12.5px' }, allOn ? '☐ Bỏ chọn tất cả' : `☑ Chọn tất cả ${nf(hit.length)} người`);
      b.onclick = () => { onAll(hit, !allOn); draw(); };
      top.append(b);
    }
    list.append(top);
    for (const e of hit.slice(0, PICK_MAX)) {
      const on = isOn(e);
      const b = el('button', { type: 'button', class: 'sa-pick' + (on ? ' on' : '') }, el('span', { class: 'sa-tick' }, on ? '☑' : '☐'), el('b', {}, `${e.code || ''} ${e.full_name}`), el('span', { class: 'sa-hint' }, ' · ' + info(e)));
      b.onclick = () => { onToggle(e); draw(); };
      list.append(b);
    }
    if (hit.length > PICK_MAX) list.append(el('div', { class: 'sa-hint' }, `… còn ${nf(hit.length - PICK_MAX)} người — gõ mã / tên để lọc.`));
    list.scrollTop = keep;
  };
  const open = async () => {
    const sh = getShift();
    if (rows && loadedFor === sh) { list.style.display = ''; draw(); return; }
    if (loading) return;
    loading = true;
    try { rows = (await api(`/admin/meal/emp-search?date=${date}&shift=${sh}&all=1&q=`)).rows; loadedFor = sh; list.style.display = ''; draw(); }
    catch (e) { toast(e.message, 'err'); }
    loading = false;
  };
  q.onfocus = open; q.onclick = open; q.oninput = open;
  return { input: q, list, show: open, redraw: () => { if (rows && list.style.display !== 'none') draw(); }, reload: () => { rows = null; if (list.style.display !== 'none') open(); } };
}

// GỬI BẾP: bước 1 XEM TRƯỚC số suất (từng bếp, theo món, so với lần gửi trước, tin nhắn) — chưa gửi gì;
// bước 2 bấm "Gửi bếp" mới chụp số → màn hình bếp hiện "HR đã gửi"; hiện tin nhắn để dán Zalo cho bếp
async function dispatchDlg(date, shift, onDone) {
  let p;
  try { p = await api('/admin/meal/dispatch', { method: 'POST', body: { date, shift, preview: true } }); } catch (e) { return toast(e.message, 'err'); }
  const msgBox = (txt) => { const ta = el('textarea', { style: 'width:100%;min-height:150px;font:inherit;font-size:14px;border:1px solid #c5cfdf;border-radius:8px;padding:8px 10px' }); ta.value = txt; return ta; };
  const when = (v) => (v ? `${v.slice(11, 16)} ngày ${dmy(v.slice(0, 10))}` : '');
  const tbl = el('table', { class: 'sa-tbl', style: 'margin-bottom:10px' },
    el('thead', {}, el('tr', {}, el('th', {}, p.kitchens.length ? 'Bếp' : 'Số suất gửi bếp'), el('th', { class: 'num' }, 'Số suất'))),
    el('tbody', {}, ...p.kitchens.map((k) => el('tr', {}, el('td', {}, k.name), el('td', { class: 'num' }, nf(k.total))))),
    el('tfoot', {}, el('tr', {}, el('td', {}, 'TỔNG'), el('td', { class: 'num' }, nf(p.total)))));
  const diff = p.prev ? p.total - p.prev.total : 0;
  const send = el('button', { class: 'sa-btn red', type: 'button' }, p.prev ? '📤 Gửi bếp lại' : '📤 Gửi bếp');
  const cancel = el('button', { class: 'sa-btn ghost', type: 'button' }, 'Huỷ');
  cancel.onclick = () => C.closeModal();
  send.onclick = async () => {
    send.disabled = true;
    let r;
    try { r = await api('/admin/meal/dispatch', { method: 'POST', body: { date, shift } }); } catch (e) { send.disabled = false; return toast(e.message, 'err'); }
    const ta = msgBox(r.message);
    const copy = el('button', { class: 'sa-btn', type: 'button' }, '📋 Sao chép tin nhắn');
    copy.onclick = () => copyText(ta.value);
    C.openModal('📤 Đã gửi số suất cho bếp', [el('div', { class: 'sa' },
      el('div', { class: 'sa-hint', style: 'margin-bottom:8px' }, `Màn hình bếp đã hiện ${nf(r.total)} suất (gửi lúc ${stamp(r.sent_at)}). Muốn báo thêm qua Zalo thì sao chép tin nhắn dưới đây.`), ta)], [copy]);
    if (onDone) onDone();
  };
  C.openModal('📤 Xem trước — gửi số suất cho bếp', [el('div', { class: 'sa' },
    el('div', { class: 'sa-hint', style: 'margin-bottom:8px' }, 'Kiểm tra số dưới đây rồi bấm "Gửi bếp". Chưa bấm thì bếp CHƯA nhận gì.'),
    tbl,
    p.dishes.length ? el('div', { style: 'margin-bottom:8px' }, el('b', {}, 'Theo món: '), p.dishes.join(' · ')) : null,
    el('div', { class: 'sa-hint', style: 'margin-bottom:6px' + (p.state === 'locked' ? '' : ';color:var(--sa-red);font-weight:600') },
      p.state === 'locked' ? `✔ Đã khoá đăng ký lúc ${when(p.deadline)} — số đã chốt.` : `⚠ Số tạm — đăng ký còn mở đến ${when(p.deadline)}, có thể còn thay đổi.`),
    p.prev ? el('div', { class: 'sa-hint', style: 'margin-bottom:6px' }, `Lần gửi trước: ${nf(p.prev.total)} suất lúc ${stamp(p.prev.sent_at)}` + (diff ? ` → nay ${nf(p.total)} (${diff > 0 ? '+' : ''}${nf(diff)}).` : ' — không đổi.')) : null,
    el('label', { style: 'display:block;margin-top:8px' }, 'Tin nhắn (dán Zalo cho bếp)'), msgBox(p.message))], [cancel, send]);
}

/* ===================== PHÂN NHÂN VIÊN VÀO BẾP — bố cục như "xếp lịch trình ca" của chấm công =====================
 * Trái: cây bộ phận (tick = chọn cả bộ phận; bấm tên = xem người). Giữa: nhân viên (tick từng người / Chọn tất cả).
 * Kế: "Đã chọn N mục". Phải: chọn 1 bếp → Lưu. Lưu xong ở lại màn này để phân tiếp nhóm khác. startDept: '*' | '!none' | tên bộ phận */
async function kitchenAssignPage(startDept, onBack) {
  const title = '👥 Phân nhân viên vào bếp';
  C.setMain(C.head(title), C.loading());
  let data, kitchens;
  const load = async () => { [data, { kitchens }] = await Promise.all([api('/admin/meal/kitchen-emps?all=1'), api('/admin/meal/kitchens')]); };
  try { await load(); } catch (e) { C.setMain(C.head(title), el('div', { class: 'empty' }, e.message)); return; }

  // cây bộ phận cha–con (gồm cả tên bộ phận chỉ có trong hồ sơ NV)
  let nodes = [], descOf = () => new Set(), kOf = () => 0;
  const build = () => {
    const known = new Set(kitchens.map((k) => k.id));
    kOf = (e) => (known.has(e.kitchen_id) ? e.kitchen_id : 0);
    const master = data.departments, ids = new Set(master.map((d) => d.id)), kids = new Map();
    for (const d of master) { const k = d.parent_id && ids.has(d.parent_id) ? d.parent_id : 0; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(d); }
    nodes = []; const seen = new Set();
    const walk = (pid, depth) => { for (const d of (kids.get(pid) || []).sort((a, b) => a.name.localeCompare(b.name, 'vi'))) { if (seen.has(d.id)) continue; seen.add(d.id); nodes.push({ name: d.name, depth }); walk(d.id, depth + 1); } };
    walk(0, 0);
    for (const n of [...new Set(data.rows.map((e) => e.department))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'vi'))) if (!nodes.some((o) => o.name === n)) nodes.push({ name: n, depth: 0 });
    if (data.rows.some((e) => !e.department)) nodes.push({ name: '', depth: 0 });
    descOf = (name) => { const i = nodes.findIndex((n) => n.name === name); const out = new Set([name]); if (i >= 0 && name) for (let j = i + 1; j < nodes.length && nodes[j].depth > nodes[i].depth; j++) out.add(nodes[j].name); return out; };
  };
  build();
  const kName = (id) => kitchens.find((k) => k.id === id)?.name || '';
  const lab = (e) => `${e.full_name} (${e.code || ''})`;
  const deptTxt = (n) => n || '(Chưa có bộ phận)';

  let curDept = startDept === '!none' || startDept === '*' || nodes.some((n) => n.name === startDept) ? startDept : '*';
  const sel = new Map();   // id NV (số) → nhãn · 'd:<tên bộ phận>' → tên
  let pickK = null;        // bếp đích (0 = bỏ phân bếp)

  const searchI = el('input', { type: 'search', placeholder: 'Tìm tên hoặc mã nhân viên', style: 'margin-bottom:8px' });
  const incl = el('input', { type: 'checkbox', style: 'width:auto', checked: '' });
  const treeBox = el('div', { class: 'emp-tree', style: 'padding:0' });
  const listHead = el('label', { style: 'display:flex;align-items:center;gap:8px;font-weight:700;color:var(--ink);margin-bottom:6px' });
  const listBox = el('div', { class: 'as-sel-list' });
  const selHead = el('b', {}, 'Đã chọn 0 mục');
  const selBox = el('div', { class: 'as-sel-list' });
  const kBox = el('div');
  const saveBtn = el('button', { class: 'btn green', style: 'width:100%;margin-top:12px' }, '💾 Lưu');

  // số người sẽ đổi = NV thuộc các bộ phận đã tick ∪ NV tick lẻ
  const affected = () => {
    const ds = new Set([...sel.keys()].filter((k) => typeof k === 'string').map((k) => k.slice(2)));
    return data.rows.filter((e) => sel.has(e.id) || ds.has(e.department)).length;
  };
  const drawSave = () => {
    const n = affected();
    saveBtn.textContent = !n ? '💾 Lưu' : pickK == null ? `💾 Lưu — ${n} người (chọn bếp ở trên)` : `💾 Lưu — ${n} người → ${pickK ? kName(pickK) : 'bỏ phân bếp'}`;
  };
  const drawSel = () => {
    selHead.textContent = `Đã chọn ${sel.size} mục`;
    selBox.innerHTML = '';
    for (const [k, v] of sel) {
      const x = el('span', { class: 'as-x', title: 'Bỏ chọn' }, '✕');
      x.onclick = () => { sel.delete(k); drawAll(); };
      selBox.append(el('div', { class: 'as-sel-item' }, el('span', {}, typeof k === 'string' ? '📁 ' + deptTxt(v) : '👤 ' + v), x));
    }
    if (!sel.size) selBox.append(el('div', { class: 'sa-hint', style: 'padding:10px 4px' }, 'Tick bộ phận ở cây bên trái hoặc tick từng nhân viên.'));
    drawSave();
  };
  const shown = () => {
    const q = noAcc(searchI.value.trim());
    if (q) return data.rows.filter((e) => noAcc(e.full_name).includes(q) || noAcc(e.code).includes(q));   // tìm trên toàn công ty
    if (curDept === '*') return data.rows;
    if (curDept === '!none') return data.rows.filter((e) => !kOf(e));
    const set = descOf(curDept);
    return data.rows.filter((e) => set.has(e.department));
  };
  const drawTree = () => {
    treeBox.innerHTML = '';
    const q = searchI.value.trim();
    const special = (key, text, n) => { const d = el('div', { class: 'tn' + (curDept === key && !q ? ' on' : ''), style: 'padding-left:6px;font-weight:700' }, el('span', { class: 'nm' }, text), el('span', { class: 'ct' }, nf(n))); d.onclick = () => { curDept = key; searchI.value = ''; drawAll(); }; return d; };
    treeBox.append(special('*', '👥 Tất cả nhân viên', data.rows.length));
    const noneN = data.rows.filter((e) => !kOf(e)).length;
    if (noneN) treeBox.append(special('!none', '⚠️ Chưa phân bếp', noneN));
    for (const n of nodes) {
      const set = descOf(n.name), emps = data.rows.filter((e) => set.has(e.department));
      const miss = emps.filter((e) => !kOf(e)).length;
      const cb = el('input', { type: 'checkbox', style: 'width:auto', title: 'Tick = chọn cả bộ phận', ...(sel.has('d:' + n.name) ? { checked: '' } : {}) });
      cb.onclick = (ev) => ev.stopPropagation();
      cb.onchange = () => { for (const nm of incl.checked ? set : [n.name]) { if (cb.checked) sel.set('d:' + nm, nm); else sel.delete('d:' + nm); } drawAll(); };
      // 1 ô số: tổng người; tô đỏ khi còn người chưa phân bếp
      const row = el('div', { class: 'tn' + (curDept === n.name && !q ? ' on' : ''), style: 'padding-left:' + (6 + n.depth * 14) + 'px;gap:6px', title: deptTxt(n.name) + (miss ? ` — còn ${miss} người chưa phân bếp` : '') },
        cb, el('span', { class: 'nm' }, '📁 ' + deptTxt(n.name)),
        el('span', { class: 'ct', ...(miss ? { style: 'background:#fde8e8;color:#b91c1c' } : {}) }, nf(emps.length)));
      row.onclick = () => { curDept = n.name; searchI.value = ''; drawAll(); };
      treeBox.append(row);
    }
  };
  const drawList = () => {
    const list = shown();
    const all = el('input', { type: 'checkbox', style: 'width:auto', ...(list.length && list.every((e) => sel.has(e.id)) ? { checked: '' } : {}) });
    all.onchange = () => { for (const e of list) { if (all.checked) sel.set(e.id, lab(e)); else sel.delete(e.id); } drawAll(); };
    listHead.innerHTML = ''; listHead.append(all, `Chọn tất cả (${nf(list.length)})`);
    listBox.innerHTML = '';
    if (!list.length) listBox.append(el('div', { class: 'empty', style: 'padding:14px 4px' }, 'Không có nhân viên.'));
    for (const e of list) {
      const cb = el('input', { type: 'checkbox', style: 'width:auto', ...(sel.has(e.id) ? { checked: '' } : {}) });
      // tick 1 người: chỉ vẽ lại ô "Chọn tất cả" + cột Đã chọn (không vẽ lại cả danh sách → không nhảy thanh cuộn)
      cb.onchange = () => { if (cb.checked) sel.set(e.id, lab(e)); else sel.delete(e.id); all.checked = list.every((x) => sel.has(x.id)); drawSel(); };
      const k = kOf(e);
      listBox.append(el('label', { class: 'as-sel-item', style: 'justify-content:flex-start;gap:8px;cursor:pointer' }, cb,
        el('span', { style: 'flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis', title: `${e.full_name} · ${e.code || ''} · ${deptTxt(e.department)}` }, e.full_name, el('span', { style: 'color:#9ca3af;font-size:12px;margin-left:6px' }, e.code || '')),
        el('span', { class: 'sa-pill ' + (k ? 'muted' : 'red'), style: 'white-space:nowrap' }, k ? kName(k) : 'chưa phân')));
    }
  };
  const drawKitchens = () => {
    kBox.innerHTML = '';
    const cnt = new Map(); for (const e of data.rows) { const k = kOf(e); cnt.set(k, (cnt.get(k) || 0) + 1); }
    for (const k of [...kitchens.map((x) => ({ id: x.id, name: x.name })), { id: 0, name: '— Bỏ phân bếp —' }]) {
      const rd = el('input', { type: 'radio', name: 'sa-kpick', style: 'width:auto', ...(pickK === k.id ? { checked: '' } : {}) });
      const row = el('label', { class: 'as-sel-item', style: 'justify-content:flex-start;gap:10px;cursor:pointer;padding:9px 8px;border:1px solid var(--line);margin-bottom:6px' + (pickK === k.id ? ';background:#f0fdf4;border-color:#16a34a' : '') },
        rd, el('b', { style: 'flex:1' }, k.name), el('span', { class: 'sa-hint' }, k.id ? `${nf(cnt.get(k.id) || 0)} người` : `${nf(cnt.get(0) || 0)} chưa phân`));
      rd.onchange = () => { pickK = k.id; drawKitchens(); drawSave(); };
      kBox.append(row);
    }
  };
  const drawAll = () => { drawTree(); drawList(); drawSel(); };
  searchI.oninput = () => { drawTree(); drawList(); };
  incl.onchange = drawTree;

  saveBtn.onclick = async () => {
    if (!sel.size) return toast('Chưa tick bộ phận / nhân viên nào', 'err');
    if (pickK == null) return toast('Chọn 1 bếp ở bảng bên phải', 'err');
    const keys = [...sel.keys()];
    saveBtn.disabled = true;
    try {
      const r = await api('/admin/meal/kitchen-assign', { method: 'PUT', body: { kitchen_id: pickK, employee_ids: keys.filter((k) => typeof k === 'number'), departments: keys.filter((k) => typeof k === 'string').map((k) => k.slice(2)) } });
      toast(`Đã phân ${nf(r.count)} nhân viên → ${pickK ? kName(pickK) : 'chưa phân bếp'}`, 'ok');
      sel.clear();
      await load(); build();
      if (curDept === '!none' && !data.rows.some((e) => !kOf(e))) curDept = '*';
      drawAll(); drawKitchens();
    } catch (e) { toast(e.message, 'err'); }
    saveBtn.disabled = false;
  };

  const clearBtn = el('span', { class: 'as-x', title: 'Bỏ chọn tất cả', style: 'font-size:15px' }, '🗑');
  clearBtn.onclick = () => { sel.clear(); drawAll(); };
  const back = el('button', { class: 'btn sm ghost' }, '‹ Quay lại');
  back.onclick = onBack;
  const bar = el('div', { class: 'panel', style: 'padding:10px 16px;display:flex;align-items:center;gap:14px;margin-bottom:14px;flex-wrap:wrap' },
    back, el('span', { style: 'color:#d1d5db' }, '|'), el('b', {}, 'Phân nhân viên vào bếp'),
    el('span', { class: 'sa-hint', style: 'flex:1' }, 'Tick bộ phận / nhân viên → chọn bếp bên phải → Lưu. Lưu xong ở lại đây để phân tiếp nhóm khác.'));
  const right = el('div', { class: 'panel', style: 'padding:16px' }, el('label', { style: 'font-weight:700;display:block;margin-bottom:8px' }, 'Phân vào bếp'), kBox, saveBtn,
    el('div', { class: 'sa-hint', style: 'margin-top:10px' }, 'Đơn đăng ký ăn từ hôm nay trở đi của những người này chuyển theo bếp mới; ngày đã qua giữ nguyên.'));
  drawAll(); drawKitchens();
  // 3 cột trái rộng hơn (tên bộ phận / nhân viên dài), cột chọn bếp gọn bên phải
  C.setMain(C.head(title), bar, el('div', { class: 'as-add', style: 'grid-template-columns:minmax(0,3fr) minmax(250px,1fr)' }, el('div', { class: 'panel as-add-left' },
    el('div', { class: 'as-col', style: 'flex:1.25' }, searchI, el('label', { style: 'display:flex;align-items:center;gap:8px;font-weight:600;color:var(--ink);margin-bottom:8px' }, incl, 'Tick bộ phận gồm cả bộ phận con'), treeBox),
    el('div', { class: 'as-col', style: 'flex:1.25' }, listHead, listBox),
    el('div', { class: 'as-col', style: 'flex:0.9' }, el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px' }, selHead, clearBtn), selBox)), right));
}

/* ===================== CẤU HÌNH ===================== */
export async function pageMealCfg(ctx) {
  C = ctx; css();
  const main = el('div', { class: 'sa' });
  C.setMain(C.head('⚙️ Suất ăn — cấu hình'), main);
  main.append(C.loading());
  let shifts, devs, kit, opt, kits, heads = null;
  try {
    [shifts, devs, kit, opt, kits] = await Promise.all([api('/admin/meal/shifts'), api('/admin/meal/devices'), api('/admin/meal/kitchen'), api('/admin/meal/options'), api('/admin/meal/kitchens')]);
    if (opt.dept_head) heads = await api('/admin/meal/heads');
  } catch (e) { main.innerHTML = ''; main.append(el('div', { class: 'empty' }, e.message)); return; }
  main.innerHTML = '';
  const W = opt.dish_choice ? 'chọn món' : 'đăng ký';
  let secN = 0;
  const sec = (t) => el('div', { class: 'sa-sec' }, `${++secN}. ${t}`);

  /* --- cách đăng ký: tài khoản tổng đổi ở Cài đặt › Cấu hình hiển thị --- */
  const way = !opt.self_order && !opt.dept_head ? 'HR tự nhập số suất'
    : [opt.self_order ? (opt.dish_choice ? 'Nhân viên tự chọn món trên app' : 'Nhân viên tự bấm "Có ăn / Không ăn" trên app (không chọn món)') : null,
      opt.dept_head ? 'trưởng bộ phận báo số → HR đối chiếu & chốt' : null].filter(Boolean).join(' + ');
  main.append(el('div', { class: 'sa-info' }, el('span', {}, 'Cách đăng ký suất ăn: ', el('b', {}, way)), el('span', { class: 'sa-hint' }, 'Tài khoản tổng đổi ở Cài đặt › Cấu hình hiển thị.')));

  /* --- các bữa ăn: giờ ăn + giờ mở / khoá đăng ký; thêm / xoá bữa --- */
  main.append(sec(`Các bữa ăn — giờ ăn, giờ mở & khoá ${W}`),
    el('div', { class: 'sa-hint', style: 'margin-bottom:8px' }, `Giờ ăn = khung quẹt thẻ ở máy chấm ăn (quẹt ngoài khung không tính suất; qua nửa đêm được, VD 23:00 → 02:00). Giờ mở ${W} để trống = luôn mở. Hết giờ khoá, nhân viên không ${W} được nữa — HR ${W} hộ ở trang ${opt.dish_choice ? '"Tổng hợp & điều chỉnh"' : '"Đăng ký ăn"'} (bắt buộc ghi lý do).`));
  const g1 = el('div', { class: 'sa-grid' });
  const addBtn = el('button', { class: 'sa-btn ghost', type: 'button' }, '+ Thêm bữa ăn');
  const addCard = el('div', { class: 'sa-card', style: 'display:flex;align-items:center;justify-content:center;min-height:120px;border-style:dashed' }, addBtn);
  addBtn.onclick = () => { const c = shiftCard(null); g1.insertBefore(c, addCard); c.querySelector('input')?.focus(); };
  for (const s of shifts.shifts) g1.append(shiftCard(s));
  g1.append(addCard);
  main.append(g1);

  function shiftCard(s0) {
    const isNew = !s0;
    const s = s0 || { code: '', name: '', from_time: '06:00', to_time: '08:00', mode: 'punch', enabled: 1, lock_before_min: 60, lock_at: '', open_at: '', custom: 1 };
    const nameI = el('input', { type: 'text', value: s.name, maxlength: '40', placeholder: 'VD: Bữa sáng' });
    const fromI = el('input', { type: 'time', value: s.from_time });
    const toI = el('input', { type: 'time', value: s.to_time });
    const modeS = el('select', {}, el('option', { value: 'punch' }, 'Đếm lượt chấm công'), el('option', { value: 'ot' }, 'Đối chiếu đăng ký làm thêm (không đếm chấm công)'));
    modeS.value = s.mode;
    const enI = el('input', { type: 'checkbox', style: 'width:auto', ...(s.enabled ? { checked: '' } : {}) });
    // giờ mở + hạn khoá (server/meal-rules.js orderOpenMs / orderDeadlineMs)
    const openI = el('input', { type: 'time', value: s.open_at || '', style: 'flex:1' });
    const openClr = el('button', { class: 'sa-btn ghost', type: 'button', style: 'padding:6px 10px;white-space:nowrap' }, 'Luôn mở');
    const lockS = el('select', {}, el('option', { value: 'start' }, 'Khi bắt đầu giờ ăn'), el('option', { value: 'before' }, 'Trước giờ ăn … tiếng'), el('option', { value: 'at' }, 'Lúc giờ cố định'));
    lockS.value = s.lock_at ? 'at' : s.lock_before_min > 0 ? 'before' : 'start';
    const lockH = el('input', { type: 'number', min: '0.5', max: '48', step: '0.5', value: s.lock_before_min > 0 ? String(s.lock_before_min / 60) : '2', style: 'width:90px' });
    const lockAt = el('input', { type: 'time', value: s.lock_at || '' });
    const lockHint = el('div', { class: 'sa-hint', style: 'margin-top:6px;font-weight:600' });
    const lockBox = el('div', { style: 'display:flex;gap:8px;align-items:center;margin-top:6px' });
    const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const toMin = (v) => { const [h, m] = String(v || '').split(':').map(Number); return h * 60 + m; };
    const dayTxt = (n) => (n === 0 ? 'cùng ngày ăn' : n === -1 ? 'hôm trước' : `${-n} ngày trước`);
    const at = (t) => { const d = Math.floor(t / 1440); return `${hm(t - d * 1440)} ${dayTxt(d)}`; };
    const drawLock = () => {
      lockBox.innerHTML = '';
      if (lockS.value === 'before') lockBox.append(lockH, el('span', {}, 'tiếng trước giờ bắt đầu ăn'));
      if (lockS.value === 'at') lockBox.append(lockAt, el('span', {}, '(muộn hơn giờ ăn = của hôm trước)'));
      const f = toMin(fromI.value);
      let dl = NaN;
      if (lockS.value === 'start') dl = f;
      else if (lockS.value === 'before') dl = f - Math.round(Number(lockH.value) * 60);
      else if (lockAt.value) { const l = toMin(lockAt.value); dl = l > f ? l - 1440 : l; }
      if (Number.isNaN(dl)) { lockHint.textContent = ''; return; }
      let openTxt = `Mở ${W}: luôn mở (7 ngày tới)`;
      if (openI.value) { let t = Math.floor(dl / 1440) * 1440 + toMin(openI.value); if (t >= dl) t -= 1440; openTxt = `Mở ${W} lúc ${at(t)}`; }
      lockHint.textContent = `→ ${openTxt} · khoá lúc ${at(dl)}.`;
    };
    openClr.onclick = () => { openI.value = ''; drawLock(); };
    lockS.onchange = drawLock; lockH.oninput = drawLock; lockAt.oninput = drawLock; openI.oninput = drawLock; fromI.addEventListener('input', drawLock);
    drawLock();
    const save = el('button', { class: 'sa-btn', type: 'button' }, isNew ? '💾 Thêm bữa' : '💾 Lưu bữa');
    save.onclick = async () => {
      const body = { name: nameI.value, from_time: fromI.value, to_time: toI.value, mode: opt.dept_head ? modeS.value : s.mode, enabled: enI.checked,
        lock_mode: lockS.value, lock_hours: lockH.value, lock_at: lockAt.value, open_at: openI.value };
      try {
        if (isNew) { await api('/admin/meal/shifts', { method: 'POST', body }); toast('Đã thêm ' + nameI.value, 'ok'); pageMealCfg(C); }
        else { await api('/admin/meal/shifts/' + s.code, { method: 'PUT', body }); toast('Đã lưu ' + nameI.value, 'ok'); }
      } catch (e) { toast(e.message, 'err'); }
    };
    const card = el('div', { class: 'sa-card' });
    const del = el('button', { class: 'sa-btn ghost', type: 'button', title: isNew ? 'Bỏ bữa đang thêm' : 'Xoá bữa tự thêm (chỉ khi chưa có dữ liệu)' }, isNew ? 'Bỏ' : '🗑 Xoá');
    del.onclick = async () => {
      if (isNew) return card.remove();
      if (!confirm(`Xoá bữa "${s.name}"?`)) return;
      try { await api('/admin/meal/shifts/' + s.code, { method: 'DELETE' }); card.remove(); toast('Đã xoá', 'ok'); } catch (e) { toast(e.message, 'err'); }
    };
    card.append(...[el('h4', {}, isNew ? 'Bữa mới' : s.name, s.custom && !isNew ? el('span', { class: 'sa-pill muted' }, 'tự thêm') : null),
      el('label', {}, 'Tên bữa'), nameI,
      el('div', { class: 'sa-row2' }, el('div', {}, el('label', {}, 'Giờ ăn từ'), fromI), el('div', {}, el('label', {}, 'đến (giờ chốt)'), toI)),
      el('label', {}, `Mở ${W} lúc (để trống = luôn mở)`), el('div', { style: 'display:flex;gap:8px;align-items:center' }, openI, openClr),
      el('label', {}, `Khoá ${W}`), lockS, lockBox, lockHint,
      opt.dept_head ? el('label', {}, 'Cách đối chiếu (trang Đối chiếu & chốt)') : null, opt.dept_head ? modeS : null,
      el('label', { style: 'display:flex;gap:8px;align-items:center;margin-top:10px;color:inherit' }, enI, 'Bật bữa này'),
      el('div', { class: 'sa-actions', style: 'margin-top:10px' }, save, s.custom || isNew ? del : null)].filter(Boolean));   // append gốc in null thành chữ
    return card;
  }

  /* --- bếp + phân nhân viên vào bếp --- */
  main.append(sec('Bếp & phân nhân viên vào bếp'),
    el('div', { class: 'sa-hint', style: 'margin-bottom:8px' }, 'Có nhiều bếp (VD Bếp 1, Bếp 2): thêm bếp, tích máy chấm ăn đặt ở bếp đó, rồi phân nhân viên theo bộ phận hoặc từng người. Mỗi bếp có màn hình riêng — chỉ hiện người của bếp + tổng số suất bếp phải nấu; quẹt nhầm máy bếp khác sẽ báo "Sai bếp". Chỉ có 1 bếp thì không cần thêm.'));
  const kBox = el('div');
  main.append(kBox);
  const reloadKits = async () => { try { kits = await api('/admin/meal/kitchens'); drawKitchens(); } catch (e) { toast(e.message, 'err'); } };
  function drawKitchens() {
    kBox.innerHTML = '';
    const grid = el('div', { class: 'sa-grid' });
    for (const k of kits.kitchens) grid.append(kitchenCard(k));
    const nameI = el('input', { type: 'text', placeholder: 'VD: Bếp 1 — Nhà ăn xưởng A', maxlength: '40' });
    const add = el('button', { class: 'sa-btn', type: 'button', style: 'margin-top:10px' }, '+ Thêm bếp');
    add.onclick = async () => { try { await api('/admin/meal/kitchens', { method: 'POST', body: { name: nameI.value } }); toast('Đã thêm bếp', 'ok'); reloadKits(); } catch (e) { toast(e.message, 'err'); } };
    nameI.onkeydown = (ev) => { if (ev.key === 'Enter') add.click(); };
    grid.append(el('div', { class: 'sa-card', style: 'border-style:dashed' }, el('h4', {}, 'Thêm bếp'), el('label', {}, 'Tên bếp'), nameI, add));
    kBox.append(grid);
    if (kits.kitchens.length) kBox.append(assignBox());
  }
  function kitchenCard(k) {
    const nameI = el('input', { type: 'text', value: k.name, maxlength: '40' });
    const picked = new Set(String(k.serials || '').split(',').filter(Boolean));
    const devList = devs.devices.length ? devs.devices.map((d) => {
      const c = el('input', { type: 'checkbox', style: 'width:auto', ...(picked.has(d.serial) ? { checked: '' } : {}) });
      c.onchange = () => { c.checked ? picked.add(d.serial) : picked.delete(d.serial); };
      return el('label', { style: 'display:flex;gap:8px;align-items:center;margin:4px 0;color:inherit;font-size:13.5px' }, c, `${d.name || d.serial} (${d.serial})`);
    }) : [el('div', { class: 'sa-hint' }, 'Chưa có máy chấm công nào được duyệt.')];
    const url = kitchenUrl(kit, k.screen_key);
    const save = el('button', { class: 'sa-btn', type: 'button' }, '💾 Lưu');
    save.onclick = async () => { try { await api('/admin/meal/kitchens/' + k.id, { method: 'PUT', body: { name: nameI.value, serials: [...picked] } }); toast('Đã lưu bếp', 'ok'); reloadKits(); } catch (e) { toast(e.message, 'err'); } };
    const open = el('button', { class: 'sa-btn ghost', type: 'button' }, '↗ Mở màn hình');
    open.onclick = () => window.open(url, '_blank');
    const cp = el('button', { class: 'sa-btn ghost', type: 'button' }, '📋 Sao chép');
    cp.onclick = () => copyText(url);
    const renew = el('button', { class: 'sa-btn ghost', type: 'button' }, '🔑 Đổi mã');
    renew.onclick = async () => { if (!confirm('Đổi mã? Màn hình bếp này đang mở sẽ phải mở lại bằng liên kết mới.')) return; try { await api(`/admin/meal/kitchens/${k.id}/renew`, { method: 'POST' }); reloadKits(); } catch (e) { toast(e.message, 'err'); } };
    const del = el('button', { class: 'sa-btn ghost', type: 'button', style: 'color:var(--sa-red);border-color:var(--sa-red)' }, '🗑 Xoá bếp');
    del.onclick = async () => { if (!confirm(`Xoá "${k.name}"? ${k.people} nhân viên của bếp này sẽ thành "chưa phân bếp".`)) return; try { await api('/admin/meal/kitchens/' + k.id, { method: 'DELETE' }); toast('Đã xoá bếp', 'ok'); reloadKits(); } catch (e) { toast(e.message, 'err'); } };
    return el('div', { class: 'sa-card' }, el('h4', {}, k.name, el('span', { class: 'sa-pill muted' }, `${nf(k.people)} nhân viên`)),
      el('label', {}, 'Tên bếp'), nameI,
      el('label', {}, 'Máy chấm ăn đặt ở bếp này'), ...devList,
      el('div', { class: 'sa-hint' }, 'Không tích máy nào = màn hình bếp hiện người được phân vào bếp, quẹt ở máy nào cũng hiện.'),
      el('label', {}, `Màn hình bếp riêng — mã ${k.screen_key}`), el('div', { class: 'sa-key' }, url),
      el('div', { class: 'sa-actions' }, save, open, cp, renew, del));
  }
  // Tổng quan bộ phận × bếp (chỉ xem) + nút mở màn "Phân nhân viên vào bếp" kiểu xếp lịch trình ca; bấm 1 dòng = mở sẵn bộ phận đó
  function assignBox() {
    const open = (dept) => kitchenAssignPage(dept, () => { C.setMain(C.head('⚙️ Suất ăn — cấu hình'), main); reloadKits().then(() => kBox.scrollIntoView({ block: 'start' })); });
    const tb = el('tbody');
    for (const d of kits.depts) {
      const none = d.by[0] || 0;
      const tr = el('tr', { style: 'cursor:pointer', title: 'Bấm để phân nhân viên bộ phận này' }, el('td', { class: 'dept' }, d.department || '(Chưa có bộ phận)'), el('td', { class: 'num' }, nf(d.total)),
        ...kits.kitchens.map((k) => el('td', { class: 'num' }, d.by[k.id] ? nf(d.by[k.id]) : '—')),
        el('td', { class: 'num' }, none ? el('span', { class: 'sa-pill red' }, nf(none)) : '—'));
      tr.onclick = () => open(d.department);
      tb.append(tr);
    }
    const unassigned = kits.depts.reduce((t, d) => t + (d.by[0] || 0), 0);
    const go = el('button', { class: 'sa-btn', type: 'button' }, '👥 Phân nhân viên vào bếp');
    go.onclick = () => open(unassigned ? '!none' : '*');
    return el('div', { style: 'margin-top:14px' },
      el('div', { style: 'display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:8px' }, go,
        el('span', { class: 'sa-hint' }, unassigned ? `Còn ${nf(unassigned)} nhân viên CHƯA phân bếp (tính vào dòng "Chưa phân bếp" ở báo cáo).` : '✔ Mọi nhân viên đều đã được phân bếp.')),
      el('div', { class: 'sa-wrap' }, el('table', { class: 'sa-tbl' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Bộ phận'), el('th', { class: 'num' }, 'Số NV'), ...kits.kitchens.map((k) => el('th', { class: 'num' }, k.name)), el('th', { class: 'num' }, 'Chưa phân'))),
        tb)));
  }
  drawKitchens();

  /* --- trưởng bộ phận (chỉ khi dùng trưởng bộ phận báo số) --- */
  if (heads) {
    main.append(sec('Trưởng bộ phận (được nhập số đăng ký ăn cho bộ phận mình & bộ phận con)'));
    const headBox = el('div', { class: 'sa-card' });
    const drawHeads = () => {
      headBox.innerHTML = '';
      const by = new Map();
      for (const h of heads.heads) { if (!by.has(h.department)) by.set(h.department, []); by.get(h.department).push(h); }
      if (!by.size) headBox.append(el('div', { class: 'sa-empty' }, 'Chưa chỉ định trưởng bộ phận nào.'));
      for (const [dep, list] of by) {
        headBox.append(el('div', { style: 'margin:6px 0' }, el('b', {}, dep + ': '), ...list.map((h) => {
          const x = el('button', { type: 'button', title: 'Bỏ' }, '×');
          x.onclick = async () => { try { await api(`/admin/meal/heads?department=${encodeURIComponent(h.department)}&employee_id=${h.employee_id}`, { method: 'DELETE' }); heads.heads = heads.heads.filter((y) => y !== h); drawHeads(); } catch (e) { toast(e.message, 'err'); } };
          return el('span', { class: 'sa-chip' }, `${h.code} · ${h.full_name}`, x);
        })));
      }
      const depS = el('select', {}, el('option', { value: '' }, '— Bộ phận —'), ...heads.departments.map((d) => el('option', { value: d }, d)));
      const empS = el('select', {}, el('option', { value: '' }, '— Nhân viên —'), ...heads.employees.map((e) => el('option', { value: String(e.id) }, `${e.code} · ${e.full_name}${e.department ? ' (' + e.department + ')' : ''}`)));
      const add = el('button', { class: 'sa-btn', type: 'button' }, '+ Chỉ định');
      add.onclick = async () => {
        if (!depS.value || !empS.value) return toast('Chọn bộ phận và nhân viên', 'err');
        try {
          await api('/admin/meal/heads', { method: 'POST', body: { department: depS.value, employee_id: Number(empS.value) } });
          const e = heads.employees.find((x) => String(x.id) === empS.value);
          if (!heads.heads.some((h) => h.department === depS.value && h.employee_id === e.id)) heads.heads.push({ department: depS.value, employee_id: e.id, code: e.code, full_name: e.full_name });
          drawHeads();
        } catch (er) { toast(er.message, 'err'); }
      };
      headBox.append(el('div', { class: 'sa-row2', style: 'margin-top:10px;grid-template-columns:1fr 1fr auto;align-items:end' }, depS, empS, add));
    };
    drawHeads();
    main.append(headBox, el('div', { class: 'sa-hint', style: 'margin-top:6px' }, 'Trưởng bộ phận mở app nhân viên (hoặc menu "Suất ăn của tôi") › nhập số đăng ký cho từng ca. HR vẫn sửa / nhập hộ được ở trang Đối chiếu.'));
  }

  /* --- máy chấm công --- */
  main.append(sec('Máy chấm công dùng để đếm suất ăn'));
  const picked = new Set(devs.serials);
  const devBox = el('div', { class: 'sa-card' });
  if (!devs.devices.length) devBox.append(el('div', { class: 'sa-empty' }, 'Chưa có máy chấm công nào được duyệt — mặc định tính mọi máy thật.'));
  for (const d of devs.devices) {
    const c = el('input', { type: 'checkbox', style: 'width:auto', ...(picked.has(d.serial) ? { checked: '' } : {}) });
    c.onchange = () => { c.checked ? picked.add(d.serial) : picked.delete(d.serial); };
    devBox.append(el('label', { style: 'display:flex;gap:8px;align-items:center;margin:5px 0;color:inherit;font-size:14px' }, c, `${d.name || d.serial} (${d.serial})`));
  }
  const saveDev = el('button', { class: 'sa-btn', type: 'button', style: 'margin-top:8px' }, '💾 Lưu');
  saveDev.onclick = async () => { try { await api('/admin/meal/devices', { method: 'PUT', body: { serials: [...picked] } }); toast('Đã lưu', 'ok'); } catch (e) { toast(e.message, 'err'); } };
  devBox.append(saveDev, el('div', { class: 'sa-hint', style: 'margin-top:6px' }, 'Không chọn máy nào = tính mọi máy chấm công thật. Lượt thêm tay và lượt chấm bằng điện thoại không bao giờ tính suất ăn.'));
  main.append(devBox);

  /* --- màn hình bếp chung (mọi bếp) --- */
  main.append(sec(kits.kitchens.length ? 'Màn hình bếp CHUNG (hiện mọi bếp)' : 'Màn hình bếp'));
  const kBox2 = el('div', { class: 'sa-card' });
  const codeEl = el('div', { style: 'font-size:34px;font-weight:900;letter-spacing:8px;color:var(--sa-navy);margin:2px 0 8px' }, kit.key.toUpperCase());
  const keyEl = el('div', { class: 'sa-key' }, kitchenUrl(kit, kit.key));
  const copy = el('button', { class: 'sa-btn ghost', type: 'button' }, '📋 Sao chép liên kết');
  copy.onclick = () => copyText(keyEl.textContent);
  const open = el('button', { class: 'sa-btn', type: 'button' }, '↗ Mở màn hình bếp');
  open.onclick = () => window.open(keyEl.textContent, '_blank');
  const renew = el('button', { class: 'sa-btn ghost', type: 'button' }, '🔑 Đổi mã');
  renew.onclick = async () => {
    if (!confirm('Đổi mã? Màn hình bếp đang mở sẽ ngừng hoạt động cho tới khi mở lại bằng mã / liên kết mới.')) return;
    try { kit = await api('/admin/meal/kitchen/renew', { method: 'POST' }); keyEl.textContent = kitchenUrl(kit, kit.key); codeEl.textContent = kit.key.toUpperCase(); toast('Đã đổi mã', 'ok'); } catch (e) { toast(e.message, 'err'); }
  };
  const baseIn = el('input', { value: kit.base || '', placeholder: kit.domain || 'VD: app.maychamcongcloud.com', style: 'flex:1;min-width:220px' });
  const saveBase = el('button', { class: 'sa-btn ghost', type: 'button' }, '💾 Lưu tên miền');
  saveBase.onclick = async () => {
    try { kit = { ...kit, ...(await api('/admin/meal/kitchen/base', { method: 'PUT', body: { base: baseIn.value } })) }; baseIn.value = kit.base; keyEl.textContent = kitchenUrl(kit, kit.key); drawKitchens(); toast('Đã lưu', 'ok'); } catch (e) { toast(e.message, 'err'); }
  };
  kBox2.append(el('div', { class: 'sa-hint', style: 'margin-bottom:6px' }, 'Trên máy tính / tivi ở khu nhà bếp (không cần đăng nhập): mở trình duyệt, gõ địa chỉ máy chủ + /bep rồi nhập MÃ dưới đây (hoặc mở thẳng liên kết). Khi nhân viên quẹt máy chấm công trong giờ ăn, màn hình hiện tên + ' + (opt.dish_choice ? 'món đã chọn.' : 'có đăng ký ăn hay không.') + ' Phía trên màn hình hiện tổng số suất các bữa sắp tới.'),
    el('div', { class: 'sa-hint' }, 'Mã màn hình bếp (không phân biệt hoa thường):'), codeEl,
    keyEl, el('div', { class: 'sa-actions' }, open, copy, renew),
    el('div', { class: 'sa-hint', style: 'margin-top:10px' }, 'Tên miền in trên liên kết (để trống = theo địa chỉ đang mở trang này; gõ ngắn "abc" = abc.maychamcongcloud.com):'),
    el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, baseIn, saveBase));
  main.append(kBox2);
}

/* ===================== ĐĂNG KÝ ĂN (chế độ không chọn món): danh sách + số lượng từng bữa / bếp, đăng ký hộ, thêm suất, gửi bếp ===================== */
export async function pageMealReg(ctx) {
  C = ctx; css();
  const main = el('div', { class: 'sa' });
  C.setMain(C.head('📝 Suất ăn — đăng ký ăn'), main);
  if (!ST.date) ST.date = vnToday();
  const dateI = el('input', { type: 'date', value: ST.date });
  const prev = el('button', { class: 'sa-btn ghost', type: 'button', title: 'Hôm trước' }, '‹');
  const next = el('button', { class: 'sa-btn ghost', type: 'button', title: 'Hôm sau' }, '›');
  const today = el('button', { class: 'sa-btn ghost', type: 'button' }, 'Hôm nay');
  const reload = el('button', { class: 'sa-btn ghost', type: 'button' }, '⟳ Làm mới');
  const xls = el('button', { class: 'sa-btn ghost', type: 'button', title: 'Tổng số suất + giờ đăng ký từng người của ngày này' }, '⬇ Excel ngày này');
  const seg = el('div', { class: 'sa-seg' });
  const body = el('div');
  const go = (d) => { ST.date = d; dateI.value = d; load(); };
  dateI.onchange = () => { if (dateI.value) go(dateI.value); };
  prev.onclick = () => go(addDays(ST.date, -1)); next.onclick = () => go(addDays(ST.date, 1)); today.onclick = () => go(vnToday());
  reload.onclick = () => load();
  xls.onclick = () => downloadRpt('summary', ST.date, ST.date);
  main.append(el('div', { class: 'sa-bar' }, prev, dateI, next, today, seg, reload, xls), body);
  let R = null;
  const F = { k: 'all', dept: '', st: 'all', q: '' };   // bộ lọc danh sách

  async function load() {
    body.innerHTML = ''; body.append(C.loading());
    try { R = await api(`/admin/meal/signups?date=${ST.date}&shift=${encodeURIComponent(ST.shift || '')}`); }
    catch (e) { body.innerHTML = ''; body.append(el('div', { class: 'empty' }, e.message)); return; }
    ST.shift = R.current;
    draw();
  }
  const pick = (code) => { ST.shift = code; load(); };

  function draw() {
    seg.innerHTML = '';
    for (const s of R.shifts) {
      const b = el('button', { type: 'button', class: s.code === R.current ? 'on' : '' }, s.name);
      b.onclick = () => pick(s.code);
      seg.append(b);
    }
    body.innerHTML = '';
    if (!R.shifts.length) { body.append(el('div', { class: 'empty' }, 'Chưa bật bữa ăn nào — vào Suất ăn › Cấu hình suất ăn để bật.')); return; }
    body.append(el('div', { class: 'sa-kpis' }, ...R.shifts.map((s) => {
      const k = el('button', { type: 'button', class: 'sa-kpi', style: s.code === R.current ? 'border-color:var(--sa-navy);box-shadow:0 0 0 2px var(--sa-navy) inset' : '' },
        el('div', { class: 'k' }, s.name), el('div', { class: 'v' }, nf(s.totals.total)),
        el('div', { class: 'sa-hint' }, `suất phải nấu · đã quẹt ${nf(s.totals.ate)}`), statePill(s.state));
      k.onclick = () => pick(s.code);
      return k;
    })));
    const s = R.shifts.find((x) => x.code === R.current);
    const kn = kitchenNamer(R.kitchens);
    const t = s.totals, d = s.dispatch;
    const changed = d && d.total !== t.total;
    body.append(el('div', { class: 'sa-info' },
      el('span', {}, el('b', {}, s.name), ` · ăn ${s.from_time} → ${s.to_time}`),
      el('span', {}, 'Mở ĐK: ', el('b', {}, s.open ? atTxt(s.open, R.date) : 'luôn mở')),
      el('span', {}, 'Khoá ĐK: ', el('b', {}, atTxt(s.deadline, R.date))),
      statePill(s.state),
      d ? el('span', { class: 'sa-pill ' + (changed ? 'red' : 'ok') }, `📤 Đã gửi bếp ${nf(d.total)} suất lúc ${stamp(d.sent_at)}${changed ? ` — nay ${nf(t.total)}, nên gửi lại` : ''}`)
        : el('span', { class: 'sa-pill muted' }, 'Chưa gửi bếp')));
    // bảng theo bếp
    const ns = (n) => (s.ended ? nf(n) : '—');
    const adjBtn = (k) => {
      const b = el('button', { type: 'button', class: 'sa-adj' + (k.extra ? (k.extra > 0 ? ' pos' : ' neg') : ''), title: 'HR thêm / bớt suất bằng tay (khách, đối tác…) — bắt buộc lý do' }, k.extra ? (k.extra > 0 ? '+' : '−') + nf(Math.abs(k.extra)) : '✎');
      b.onclick = () => extraDlg(s, k);
      const n = s.extra_notes[k.kitchen_id];
      return el('td', { class: 'num' }, b, n ? el('span', { class: 'sa-sub', title: n.note }, n.note.length > 26 ? n.note.slice(0, 25) + '…' : n.note) : null);
    };
    body.append(el('div', { class: 'sa-wrap' }, el('table', { class: 'sa-tbl' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Bếp'), el('th', { class: 'num' }, 'NV tự ĐK'), el('th', { class: 'num' }, 'HR ĐK hộ'), el('th', { class: 'num' }, 'Thêm tay'),
        el('th', { class: 'num' }, 'Tổng phải nấu'), el('th', { class: 'num' }, 'Đã quẹt'), el('th', { class: 'num', title: 'Có đăng ký nhưng không quẹt thẻ (tính khi bữa đã kết thúc)' }, 'ĐK mà không quẹt'),
        el('th', { class: 'num' }, 'Quẹt mà không ĐK'))),
      el('tbody', {}, ...s.rows.map((k) => el('tr', {}, el('td', { class: 'dept' }, k.name), el('td', { class: 'num' }, nf(k.app)), el('td', { class: 'num' }, k.hr ? nf(k.hr) : '—'),
        adjBtn(k), el('td', { class: 'num sa-total' }, nf(k.total)), el('td', { class: 'num' }, nf(k.ate)), el('td', { class: 'num' }, ns(k.no_show)), el('td', { class: 'num' }, nf(k.walk_in))))),
      s.rows.length > 1 ? el('tfoot', {}, el('tr', {}, el('td', {}, 'Tổng cộng'), el('td', { class: 'num' }, nf(t.app)), el('td', { class: 'num' }, nf(t.hr)),
        el('td', { class: 'num' }, t.extra ? (t.extra > 0 ? '+' : '−') + nf(Math.abs(t.extra)) : '—'), el('td', { class: 'num sa-total', style: 'font-size:17px' }, nf(t.total)),
        el('td', { class: 'num' }, nf(t.ate)), el('td', { class: 'num' }, ns(t.no_show)), el('td', { class: 'num' }, nf(t.walk_in)))) : null)));
    const regBtn = el('button', { class: 'sa-btn', type: 'button' }, '➕ Đăng ký hộ');
    regBtn.onclick = () => signupDlg(true);
    const unBtn = el('button', { class: 'sa-btn ghost', type: 'button' }, '➖ Huỷ đăng ký hộ');
    unBtn.onclick = () => signupDlg(false);
    const sendBtn = el('button', { class: 'sa-btn red', type: 'button' }, d ? '📤 Gửi bếp lại' : '📤 Gửi bếp');
    sendBtn.onclick = () => dispatchDlg(R.date, s.code, load);
    body.append(el('div', { class: 'sa-actions' }, regBtn, unBtn, sendBtn,
      el('span', { class: 'sa-hint' }, 'Đăng ký / huỷ hộ dùng khi nhân viên quên báo, điện thoại hỏng — không bị giờ khoá chặn, bắt buộc lý do, có lưu vết. Màn hình bếp luôn hiện số mới nhất; "Gửi bếp" để chốt số + lấy tin nhắn Zalo.')));
    body.append(listBox(s, kn));
    body.append(logBox());
  }

  // danh sách người đăng ký + người quẹt mà không đăng ký, lọc theo bếp / bộ phận / trạng thái / tên
  function listBox(s, kn) {
    const box = el('div', { class: 'sa-card', style: 'margin-top:14px' });
    const all = [...s.list.map((x) => ({ ...x, reg: true })), ...s.walk_in.map((x) => ({ ...x, reg: false }))];
    const depts = [...new Set(all.map((x) => x.department))].sort((a, b) => a.localeCompare(b, 'vi'));
    const kS = el('select', { style: 'width:auto' }, el('option', { value: 'all' }, 'Mọi bếp'), ...R.kitchens.map((k) => el('option', { value: String(k.id) }, k.name)), R.kitchens.length ? el('option', { value: '0' }, 'Chưa phân bếp') : null);
    const dS = el('select', { style: 'width:auto' }, el('option', { value: '' }, 'Mọi bộ phận'), ...depts.map((d) => el('option', { value: d }, d || '(chưa có bộ phận)')));
    const sS = el('select', { style: 'width:auto' }, el('option', { value: 'all' }, 'Tất cả người đăng ký'), el('option', { value: 'ate' }, 'Đã quẹt'), el('option', { value: 'not' }, s.ended ? 'Đăng ký mà KHÔNG quẹt' : 'Chưa quẹt'),
      el('option', { value: 'hr' }, 'HR đăng ký hộ'), el('option', { value: 'walk' }, 'Quẹt mà KHÔNG đăng ký'));
    const q = el('input', { type: 'search', placeholder: 'Tìm mã / tên…', style: 'width:180px' });
    kS.value = F.k; dS.value = F.dept; sS.value = F.st; q.value = F.q;
    if (kS.value !== F.k) kS.value = 'all'; if (dS.value !== F.dept) dS.value = '';
    const cnt = el('span', { class: 'sa-hint' });
    const wrap = el('div', { class: 'sa-wrap', style: 'margin-top:8px' });
    const noA = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
    let limit = 300;
    const draw = () => {
      Object.assign(F, { k: kS.value, dept: dS.value, st: sS.value, q: q.value });
      const kq = noA(q.value.trim());
      const rows = all.filter((x) => (F.k === 'all' || String(x.kitchen_id) === F.k) && (!F.dept || x.department === F.dept) && (!kq || noA(x.code).includes(kq) || noA(x.full_name).includes(kq))
        && (F.st === 'walk' ? !x.reg : x.reg && (F.st === 'all' || (F.st === 'ate' && x.punched) || (F.st === 'not' && !x.punched) || (F.st === 'hr' && x.set_by))));
      cnt.textContent = `${nf(rows.length)} người`;
      wrap.innerHTML = '';
      if (!rows.length) { wrap.append(el('div', { class: 'sa-empty', style: 'padding:12px' }, 'Không có ai.')); return; }
      const tb = el('tbody', {}, ...rows.slice(0, limit).map((x, i) => {
        const act = el('button', { type: 'button', class: 'sa-btn ghost', style: 'padding:3px 10px;font-size:12.5px' }, x.reg ? 'Huỷ' : 'Đăng ký hộ');
        act.onclick = () => signupDlg(!x.reg, x);
        return el('tr', {}, el('td', { class: 'num sa-hint' }, String(i + 1)), el('td', {}, x.code || ''), el('td', { class: 'dept' }, x.full_name), el('td', {}, x.department || ''),
          R.kitchens.length ? el('td', {}, kn(x.kitchen_id)) : null,
          el('td', {}, x.reg ? stamp(x.at) : el('span', { class: 'sa-pill red' }, 'không đăng ký')),
          el('td', {}, x.reg ? (x.set_by ? el('span', { class: 'sa-pill warn' }, `HR hộ: ${x.set_by}`) : 'NV tự ĐK') : ''),
          el('td', {}, x.punched ? hhmm(x.punched) : x.reg && s.ended ? el('span', { class: 'sa-pill red' }, 'không ăn') : '—'), el('td', {}, act));
      }));
      wrap.append(el('table', { class: 'sa-tbl' }, el('thead', {}, el('tr', {}, el('th', { class: 'num' }, '#'), el('th', {}, 'Mã NV'), el('th', {}, 'Họ tên'), el('th', {}, 'Bộ phận'),
        R.kitchens.length ? el('th', {}, 'Bếp') : null, el('th', {}, 'Giờ đăng ký'), el('th', {}, 'Người đăng ký'), el('th', {}, 'Quẹt thẻ'), el('th', {}, ''))), tb));
      if (rows.length > limit) { const more = el('button', { class: 'sa-btn ghost', type: 'button', style: 'margin:8px' }, `Hiện thêm (${nf(rows.length - limit)} người)`); more.onclick = () => { limit += 500; draw(); }; wrap.append(more); }
    };
    kS.onchange = draw; dS.onchange = draw; sS.onchange = draw;
    let tm = 0; q.oninput = () => { clearTimeout(tm); tm = setTimeout(draw, 200); };
    box.append(el('b', { class: 'sa-fold-h' }, `👥 Danh sách — ${s.name} ${dmy(R.date)}`), el('div', { class: 'sa-bar', style: 'margin:8px 0 0' }, R.kitchens.length ? kS : null, dS, sS, q, cnt), wrap);
    draw();
    return box;
  }

  function logBox() {
    const KIND = { adjust: 'Điều chỉnh số suất', order: 'Chọn món hộ NV', signup: 'Đăng ký / huỷ hộ', extra: 'Thêm / bớt suất tay' };
    const name = Object.fromEntries(R.shifts.map((s) => [s.code, s.name]));
    const log = R.log;
    return foldCard('reglog', false, [el('b', { class: 'sa-fold-h' }, '📝 Lịch sử HR chỉnh tay trong ngày')],
      [log.length ? el('span', { class: 'sa-pill warn' }, `${nf(log.length)} lần sửa`) : el('span', { class: 'sa-pill muted' }, 'chưa có')], [
        log.length ? el('div', { class: 'sa-wrap' }, el('table', { class: 'sa-tbl' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Lúc'), el('th', {}, 'Người sửa'), el('th', {}, 'Bữa'), el('th', {}, 'Loại'), el('th', {}, 'Nhân viên / Bếp'), el('th', {}, 'Cũ → Mới'), el('th', {}, 'Lý do'))),
          el('tbody', {}, ...log.map((l) => el('tr', {}, el('td', {}, stamp(l.at)), el('td', {}, l.by_name), el('td', {}, name[l.shift] || l.shift), el('td', {}, KIND[l.kind] || l.kind),
            el('td', {}, l.emp_label || l.dish || (l.kind === 'extra' ? '(chung)' : '')),
            el('td', { style: 'white-space:nowrap' }, `${l.old_value || '—'} → ${l.new_value || (l.kind === 'signup' ? 'huỷ' : '—')}`), el('td', {}, l.reason))))))
          : el('div', { class: 'sa-empty' }, 'Chưa có chỉnh sửa nào.')]);
  }

  // HR thêm / bớt suất tay cho 1 bếp
  function extraDlg(s, k) {
    const qtyI = el('input', { type: 'number', step: '1', min: '-9999', max: '9999', value: k.extra ? String(k.extra) : '', placeholder: 'VD 5 hoặc -2', style: 'width:140px;font-weight:700' });
    const why = el('input', { type: 'text', maxlength: '200', placeholder: 'VD: 5 khách đối tác · 3 NV mới chưa có app…' });
    const base = k.app + k.hr;
    const pv = el('div', { class: 'sa-hint', style: 'margin-top:6px' });
    const upd = () => { const n = Number(qtyI.value || 0); pv.textContent = Number.isInteger(n) ? `Tổng phải nấu ${k.name} sẽ là: ${nf(Math.max(0, base + n))} suất (${nf(base)} đăng ký ${n >= 0 ? '+' : '−'} ${nf(Math.abs(n))})` : ''; };
    qtyI.oninput = upd; upd();
    const save = el('button', { class: 'sa-btn', type: 'button' }, '💾 Lưu');
    save.onclick = async () => {
      try { await api('/admin/meal/extra', { method: 'PUT', body: { date: R.date, shift: s.code, kitchen_id: k.kitchen_id, qty: qtyI.value.trim(), reason: why.value } }); C.closeModal(); toast('Đã lưu — có ghi lịch sử', 'ok'); load(); }
      catch (e) { toast(e.message, 'err'); }
    };
    C.openModal(`✎ Thêm / bớt suất — ${s.name} ${dmy(R.date)} · ${k.name}`, [el('div', { class: 'sa' },
      el('div', { class: 'sa-hint', style: 'margin-bottom:10px' }, `Theo đăng ký: ${nf(base)} suất. Nhập số THÊM (+) hoặc BỚT (−); để trống / 0 = bỏ. Mỗi lần sửa đều được lưu vết.`),
      el('label', {}, 'Thêm / bớt (+/−)'), qtyI, pv, el('label', { style: 'margin-top:10px;display:block' }, 'Lý do (bắt buộc)'), why)], [save]);
    setTimeout(() => qtyI.focus(), 50);
  }

  // HR đăng ký (on) / huỷ (off) hộ: từng người (tìm mã / tên) hoặc cả bộ phận
  async function signupDlg(on, preset = null) {
    let depts = [];
    if (!preset) { try { depts = (await api('/admin/meal/kitchens')).depts.map((d) => d.department).filter(Boolean); } catch { /* không có danh sách bộ phận vẫn chọn từng người được */ } }
    let shift = R.current;
    const picked = new Map();
    if (preset) picked.set(preset.employee_id, preset);
    const shSel = el('select', {}, ...R.shifts.map((s) => el('option', { value: s.code }, s.name)));
    const modeS = el('select', {}, el('option', { value: 'emp' }, 'Từng người'), el('option', { value: 'dept' }, 'Cả bộ phận (gồm bộ phận con)'));
    const depS = el('select', {}, el('option', { value: '' }, '— Chọn bộ phận —'), ...depts.map((d) => el('option', { value: d }, d)));
    const chips = el('div', { style: 'margin:6px 0' });
    const drawChips = () => {
      chips.innerHTML = '';
      if (!picked.size) { chips.append(el('span', { class: 'sa-hint' }, 'Chưa chọn nhân viên nào.')); return; }
      chips.append(el('span', { class: 'sa-hint', style: 'margin-right:6px' }, `Đã chọn ${nf(picked.size)}:`));
      for (const [id, e] of picked) { const x = el('button', { type: 'button', title: 'Bỏ' }, '×'); x.onclick = () => { picked.delete(id); drawChips(); pk.redraw(); }; chips.append(el('span', { class: 'sa-chip' }, `${e.code || ''} ${e.full_name}`, preset ? null : x)); }
    };
    const setPick = (e, on) => { if (on) picked.set(e.id, { employee_id: e.id, code: e.code, full_name: e.full_name }); else picked.delete(e.id); };
    const pk = empPicker({
      date: R.date, getShift: () => shift,
      info: (e) => `${e.department || '(chưa có BP)'} · ${e.registered ? 'ĐÃ đăng ký' : 'chưa đăng ký'}`,
      isOn: (e) => picked.has(e.id),
      onToggle: (e) => { setPick(e, !picked.has(e.id)); drawChips(); },
      onAll: (list, on) => { for (const e of list) setPick(e, on); drawChips(); },
    });
    const q = pk.input;
    shSel.value = shift; shSel.onchange = () => { shift = shSel.value; pk.reload(); };   // đổi bữa → trạng thái "đã đăng ký" đổi theo
    const empBox = el('div', {}, el('label', {}, 'Nhân viên'), q, pk.list, chips);
    const depBox = el('div', { style: 'display:none' }, el('label', {}, 'Bộ phận'), depS);
    modeS.onchange = () => { empBox.style.display = modeS.value === 'emp' ? '' : 'none'; depBox.style.display = modeS.value === 'dept' ? '' : 'none'; };
    const why = el('input', { type: 'text', maxlength: '200', placeholder: on ? 'VD: quên đăng ký · điện thoại hỏng · tăng ca đột xuất…' : 'VD: nghỉ đột xuất · đi công tác…' });
    drawChips();
    const save = el('button', { class: 'sa-btn' + (on ? '' : ' red'), type: 'button' }, on ? '💾 Đăng ký hộ' : '💾 Huỷ đăng ký');
    save.onclick = async () => {
      const body = { date: R.date, shift, on, reason: why.value };
      if (modeS.value === 'dept') { if (!depS.value) return toast('Chọn bộ phận', 'err'); body.department = depS.value; }
      else { if (!picked.size) return toast('Chọn nhân viên', 'err'); body.employee_ids = [...picked.keys()]; }
      try {
        const r = await api('/admin/meal/signup-for', { method: 'PUT', body });
        C.closeModal();
        toast(`Đã ${on ? 'đăng ký' : 'huỷ'} ${nf(r.changed)} người${r.skipped ? ` · bỏ qua ${nf(r.skipped)} người ${on ? 'đã đăng ký' : 'chưa đăng ký'} sẵn` : ''}`, 'ok');
        load();
      } catch (e) { toast(e.message, 'err'); }
    };
    C.openModal(`${on ? '➕ Đăng ký ăn hộ' : '➖ Huỷ đăng ký ăn hộ'} — ${dmy(R.date)}`, [el('div', { class: 'sa' },
      el('div', { class: 'sa-hint', style: 'margin-bottom:8px' }, on ? 'Dùng khi nhân viên quên đăng ký, điện thoại hỏng, tăng ca đột xuất… Không bị giờ khoá chặn; mỗi người đều được lưu vết.' : 'Huỷ suất của người không ăn (nghỉ đột xuất…). Không bị giờ khoá chặn; mỗi người đều được lưu vết.'),
      el('label', {}, 'Bữa'), shSel, preset ? null : el('label', {}, 'Chọn theo'), preset ? null : modeS, preset ? chips : empBox, preset ? null : depBox,
      el('label', { style: 'display:block;margin-top:8px' }, 'Lý do (bắt buộc)'), why)], [save]);
    setTimeout(() => { if (preset) why.focus(); else { q.focus(); pk.show(); } }, 50);   // mở hộp là hiện luôn danh sách NV
  }
  load();
}

/* ===================== BÁO CÁO SUẤT ĂN theo khoảng ngày ===================== */
async function downloadRpt(type, from, to) {
  try {
    const res = await api(`/admin/meal/rpt.xlsx?type=${type}&from=${from}&to=${to}`, { raw: true });
    if (!res.ok) { let m = 'Không xuất được báo cáo'; try { m = (await res.json()).error || m; } catch {} return toast(m, 'err'); }
    const name = (/filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '') || [])[1] || `bao_cao_suat_an_${from}_${to}.xlsx`;
    const url = URL.createObjectURL(await res.blob());
    const a = el('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Đã xuất Excel', 'ok');
  } catch { toast('Không xuất được báo cáo', 'err'); }
}
const RPT = { tab: 'summary', from: '', to: '' };
export async function pageMealRpt(ctx) {
  C = ctx; css();
  const main = el('div', { class: 'sa' });
  C.setMain(C.head('📊 Suất ăn — báo cáo'), main);
  if (!RPT.to) { RPT.to = vnToday(); RPT.from = addDays(RPT.to, -6); }
  const TABS = [['summary', '1. Tổng số suất ăn & giờ đăng ký'], ['noshow', '2. Báo ăn mà không ăn (theo NV)'], ['except', '3. Ngoại lệ: quẹt ↔ đăng ký']];
  const tabs = el('div', { class: 'sa-seg', style: 'margin-bottom:10px;flex-wrap:wrap' });
  const fI = el('input', { type: 'date', value: RPT.from }), tI = el('input', { type: 'date', value: RPT.to });
  const quick = (label, fn) => { const b = el('button', { class: 'sa-btn ghost', type: 'button' }, label); b.onclick = () => { fn(); fI.value = RPT.from; tI.value = RPT.to; load(); }; return b; };
  const view = el('button', { class: 'sa-btn', type: 'button' }, 'Xem');
  const xls = el('button', { class: 'sa-btn ghost', type: 'button' }, '⬇ Xuất Excel');
  const body = el('div');
  view.onclick = () => { RPT.from = fI.value; RPT.to = tI.value; load(); };
  xls.onclick = () => downloadRpt(RPT.tab, fI.value, tI.value);
  const drawTabs = () => {
    tabs.innerHTML = '';
    for (const [k, label] of TABS) { const b = el('button', { type: 'button', class: k === RPT.tab ? 'on' : '' }, label); b.onclick = () => { RPT.tab = k; drawTabs(); load(); }; tabs.append(b); }
  };
  drawTabs();
  main.append(tabs, el('div', { class: 'sa-bar' }, el('span', {}, 'Từ'), fI, el('span', {}, 'đến'), tI, view,
    quick('Hôm nay', () => { RPT.from = RPT.to = vnToday(); }), quick('7 ngày', () => { RPT.to = vnToday(); RPT.from = addDays(RPT.to, -6); }),
    quick('Tháng này', () => { const d = vnToday(); RPT.from = d.slice(0, 8) + '01'; RPT.to = d; }), xls), body);

  async function load() {
    body.innerHTML = ''; body.append(C.loading());
    let r;
    try { r = await api(`/admin/meal/rpt/${RPT.tab}?from=${RPT.from}&to=${RPT.to}`); } catch (e) { body.innerHTML = ''; body.append(el('div', { class: 'empty' }, e.message)); return; }
    body.innerHTML = '';
    ({ summary: drawSummary, noshow: drawNoShow, except: drawExcept })[RPT.tab](r);
  }

  // 1. tổng số suất ăn & giờ đăng ký: mỗi ngày × bữa 1 dòng cộng + từng bếp (khi có nhiều bếp)
  function drawSummary(r) {
    if (!r.rows.length) { body.append(el('div', { class: 'sa-empty' }, 'Không có dữ liệu trong khoảng này.')); return; }
    const multi = r.kitchens.length > 0;
    const sum = (f) => r.rows.reduce((t, x) => t + x.totals[f], 0);
    body.append(el('div', { class: 'sa-kpis' },
      el('div', { class: 'sa-kpi' }, el('div', { class: 'k' }, 'Tổng suất phải nấu'), el('div', { class: 'v' }, nf(sum('total')))),
      el('div', { class: 'sa-kpi' }, el('div', { class: 'k' }, 'Đã quẹt (đã ăn)'), el('div', { class: 'v' }, nf(sum('ate')))),
      el('div', { class: 'sa-kpi' }, el('div', { class: 'k' }, 'Đăng ký mà không quẹt'), el('div', { class: 'v' }, nf(r.rows.filter((x) => x.ended).reduce((t, x) => t + x.totals.no_show, 0)))),
      el('div', { class: 'sa-kpi' }, el('div', { class: 'k' }, 'Quẹt mà không đăng ký'), el('div', { class: 'v' }, nf(sum('walk_in'))))));
    const tb = el('tbody');
    for (const x of r.rows) {
      const t = x.totals;
      tb.append(el('tr', { style: 'background:var(--sa-soft)' }, el('td', { class: 'dept', style: 'white-space:nowrap' }, dmy(x.date)), el('td', { class: 'dept' }, x.shift_name),
        el('td', { style: 'white-space:nowrap' }, x.open ? atTxt(x.open, x.date) : 'luôn mở'), el('td', { style: 'white-space:nowrap' }, atTxt(x.deadline, x.date)),
        el('td', { style: 'white-space:nowrap' }, x.first_signup ? `${stamp(x.first_signup)} → ${stamp(x.last_signup)}` : '—'),
        el('td', { class: 'num' }, nf(t.app)), el('td', { class: 'num' }, t.hr ? nf(t.hr) : '—'), el('td', { class: 'num' }, t.extra ? (t.extra > 0 ? '+' : '−') + nf(Math.abs(t.extra)) : '—'),
        el('td', { class: 'num sa-total' }, nf(t.total)), el('td', { class: 'num' }, nf(t.ate)), el('td', { class: 'num' }, x.ended ? nf(t.no_show) : '—'), el('td', { class: 'num' }, nf(t.walk_in)),
        el('td', {}, x.sent_at ? `${stamp(x.sent_at)} (${nf(x.sent_total)})` : el('span', { class: 'sa-hint' }, 'chưa gửi'))));
      if (multi) for (const k of x.kitchens) tb.append(el('tr', {}, el('td', {}), el('td', { class: 'sa-hint', colspan: '4', style: 'padding-left:24px' }, '↳ ' + k.name),
        el('td', { class: 'num' }, nf(k.app)), el('td', { class: 'num' }, k.hr ? nf(k.hr) : '—'), el('td', { class: 'num' }, k.extra ? (k.extra > 0 ? '+' : '−') + nf(Math.abs(k.extra)) : '—'),
        el('td', { class: 'num' }, nf(k.total)), el('td', { class: 'num' }, nf(k.ate)), el('td', { class: 'num' }, x.ended ? nf(k.no_show) : '—'), el('td', { class: 'num' }, nf(k.walk_in)), el('td', {})));
    }
    body.append(el('div', { class: 'sa-wrap' }, el('table', { class: 'sa-tbl' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Ngày'), el('th', {}, 'Bữa'), el('th', {}, 'Mở ĐK'), el('th', {}, 'Khoá ĐK'), el('th', {}, 'Giờ đăng ký (sớm → muộn)'),
        el('th', { class: 'num' }, 'NV tự ĐK'), el('th', { class: 'num' }, 'HR ĐK hộ'), el('th', { class: 'num' }, 'Thêm tay'), el('th', { class: 'num' }, 'Tổng phải nấu'),
        el('th', { class: 'num' }, 'Đã quẹt'), el('th', { class: 'num' }, 'ĐK không quẹt'), el('th', { class: 'num' }, 'Quẹt không ĐK'), el('th', {}, 'Gửi bếp lúc'))), tb)),
      el('div', { class: 'sa-hint', style: 'margin-top:8px' }, 'Giờ đăng ký từng người (lúc bấm đăng ký, ai đăng ký) có trong file Excel, sheet "Chi tiết đăng ký". "ĐK không quẹt" chỉ tính bữa đã kết thúc.'));
  }

  // 2. số lần báo ăn mà không ăn theo nhân viên
  function drawNoShow(r) {
    const kn = kitchenNamer(r.kitchens);
    const onlyNo = el('input', { type: 'checkbox', style: 'width:auto', checked: '' });
    const q = el('input', { type: 'search', placeholder: 'Tìm mã / tên / bộ phận…', style: 'width:220px' });
    const wrap = el('div', { class: 'sa-wrap', style: 'margin-top:8px' });
    const cnt = el('span', { class: 'sa-hint' });
    const noA = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
    const draw = () => {
      const k = noA(q.value.trim());
      const rows = r.rows.filter((x) => (!onlyNo.checked || x.no_show > 0) && (!k || noA(x.code).includes(k) || noA(x.full_name).includes(k) || noA(x.department).includes(k)));
      cnt.textContent = `${nf(rows.length)} nhân viên · ${nf(r.meals)} bữa đã kết thúc có dữ liệu`;
      wrap.innerHTML = '';
      if (!rows.length) { wrap.append(el('div', { class: 'sa-empty', style: 'padding:12px' }, 'Không có ai.')); return; }
      wrap.append(el('table', { class: 'sa-tbl' },
        el('thead', {}, el('tr', {}, el('th', { class: 'num' }, '#'), el('th', {}, 'Mã NV'), el('th', {}, 'Họ tên'), el('th', {}, 'Bộ phận'), r.kitchens.length ? el('th', {}, 'Bếp') : null,
          el('th', { class: 'num' }, 'Số lần ĐK'), el('th', { class: 'num' }, 'Đã ăn'), el('th', { class: 'num' }, 'Báo mà không ăn'), el('th', { class: 'num' }, 'Tỉ lệ'), el('th', { class: 'num' }, 'Quẹt không ĐK'), el('th', {}, 'Các bữa không ăn'))),
        el('tbody', {}, ...rows.slice(0, 1000).map((x, i) => el('tr', {}, el('td', { class: 'num sa-hint' }, String(i + 1)), el('td', {}, x.code || ''), el('td', { class: 'dept' }, x.full_name), el('td', {}, x.department),
          r.kitchens.length ? el('td', {}, kn(x.kitchen_id)) : null, el('td', { class: 'num' }, nf(x.registered)), el('td', { class: 'num' }, nf(x.ate)),
          el('td', { class: 'num' }, x.no_show ? el('span', { class: 'sa-total', style: 'color:var(--sa-red)' }, nf(x.no_show)) : '0'), el('td', { class: 'num' }, x.registered ? `${String(x.rate).replace('.', ',')}%` : '—'),
          el('td', { class: 'num' }, x.walk_in ? nf(x.walk_in) : '—'),
          el('td', { class: 'sa-hint' }, x.items.slice(0, 8).map((it) => `${dmy(it.date).slice(0, 5)} ${it.shift_name}${it.set_by ? ' (HR hộ)' : ''}`).join(', ') + (x.items.length > 8 ? ` … +${x.items.length - 8}` : '')))))));
    };
    onlyNo.onchange = draw; let tm = 0; q.oninput = () => { clearTimeout(tm); tm = setTimeout(draw, 200); };
    body.append(el('div', { class: 'sa-bar' }, el('label', { style: 'display:flex;gap:6px;align-items:center;margin:0;color:inherit;font-size:14px' }, onlyNo, 'Chỉ người có báo mà không ăn'), q, cnt), wrap,
      el('div', { class: 'sa-hint', style: 'margin-top:8px' }, 'Báo mà không ăn = có đăng ký (tự đăng ký hoặc HR đăng ký hộ) nhưng không quẹt máy chấm ăn trong giờ ăn. Chỉ tính bữa đã kết thúc. Người bỏ nhiều nhất lên đầu.'));
    draw();
  }

  // 3. ngoại lệ: đăng ký mà không quẹt · quẹt mà không đăng ký
  function drawExcept(r) {
    const kn = kitchenNamer(r.kitchens);
    const tbl = (rows, cols) => (rows.length ? el('div', { class: 'sa-wrap' }, el('table', { class: 'sa-tbl' },
      el('thead', {}, el('tr', {}, ...cols.map(([h]) => el('th', {}, h)))), el('tbody', {}, ...rows.slice(0, 2000).map((x) => el('tr', {}, ...cols.map(([, f]) => el('td', {}, f(x))))))))
      : el('div', { class: 'sa-empty' }, 'Không có.'));
    const base = [['Ngày', (x) => dmy(x.date)], ['Bữa', (x) => x.shift_name], ['Mã NV', (x) => x.code || ''], ['Họ tên', (x) => x.full_name], ['Bộ phận', (x) => x.department],
      ...(r.kitchens.length ? [['Bếp', (x) => kn(x.kitchen_id)]] : [])];
    body.append(
      foldCard('ex_no', true, [el('b', { class: 'sa-fold-h' }, '🚫 Đăng ký mà KHÔNG quẹt thẻ')], [el('span', { class: 'sa-sum-n' }, nf(r.no_show.length)), el('span', { class: 'sa-hint' }, ' lượt')],
        [tbl(r.no_show, [...base, ['Giờ đăng ký', (x) => stamp(x.at)], ['Người đăng ký', (x) => (x.set_by ? `HR hộ: ${x.set_by}` : 'NV tự ĐK')]])]),
      foldCard('ex_walk', true, [el('b', { class: 'sa-fold-h' }, '⚠ Quẹt máy chấm ăn mà KHÔNG đăng ký')], [el('span', { class: 'sa-sum-n' }, nf(r.walk_in.length)), el('span', { class: 'sa-hint' }, ' lượt')],
        [tbl(r.walk_in, [...base, ['Quẹt lúc', (x) => hhmm(x.punched)]])]),
      el('div', { class: 'sa-hint' }, '"Đăng ký mà không quẹt" chỉ tính bữa đã kết thúc. Tối đa 31 ngày mỗi lần xem.'));
  }
  load();
}

/* ===================== TỔNG HỢP & ĐIỀU CHỈNH SUẤT ĂN (theo món · HR chỉnh số suất / chọn món hộ có lưu vết · xuất Excel) ===================== */
// Thu gọn / mở rộng từng khung (mỗi bữa + lịch sử); nhớ trên máy này. Mặc định: bữa mở, lịch sử thu gọn.
const FOLD_LS = 'sa_rep_fold';
const FOLD = (() => { try { return JSON.parse(localStorage.getItem(FOLD_LS) || '{}') || {}; } catch { return {}; } })();
const foldSave = () => { try { localStorage.setItem(FOLD_LS, JSON.stringify(FOLD)); } catch { /* trình duyệt chặn lưu trữ */ } };
// head: nút tiêu đề (bấm để đóng/mở) · sum: tóm tắt luôn hiện bên phải · body: phần thu gọn được
function foldCard(key, defOpen, headNodes, sumNodes, bodyNodes) {
  const card = el('div', { class: 'sa-card sa-fold', 'data-fold': key });
  const chev = el('span', { class: 'sa-chev' }, '❯');
  const head = el('div', { class: 'sa-fold-head', role: 'button', tabindex: '0', title: 'Bấm để thu gọn / mở rộng' }, chev, el('div', { class: 'sa-fold-title' }, ...headNodes), el('div', { class: 'sa-fold-sum' }, ...sumNodes));
  const body = el('div', { class: 'sa-fold-body' }, ...bodyNodes);
  const set = (open, save = true) => { card.classList.toggle('open', open); if (save) { FOLD[key] = open; foldSave(); } };
  head.onclick = (ev) => { if (ev.target.closest('button, a, input, select')) return; set(!card.classList.contains('open')); };
  head.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); set(!card.classList.contains('open')); } };
  card._set = set;
  set(FOLD[key] ?? defOpen, false);
  card.append(head, body);
  return card;
}

export async function pageMealReport(ctx) {
  C = ctx; css();
  const main = el('div', { class: 'sa' });
  C.setMain(C.head('📋 Suất ăn — tổng hợp & điều chỉnh theo món'), main);
  if (!ST.date) ST.date = vnToday();
  const dateI = el('input', { type: 'date', value: ST.date });
  const prev = el('button', { class: 'sa-btn ghost', type: 'button', title: 'Hôm trước' }, '‹');
  const next = el('button', { class: 'sa-btn ghost', type: 'button', title: 'Hôm sau' }, '›');
  const reload = el('button', { class: 'sa-btn ghost', type: 'button' }, '⟳ Làm mới');
  const xlsBtn = el('button', { class: 'sa-btn', type: 'button' }, '⬇ Xuất Excel');
  const forBtn = el('button', { class: 'sa-btn ghost', type: 'button' }, '➕ Chọn món hộ nhân viên');
  const openAll = el('button', { class: 'sa-btn ghost', type: 'button', title: 'Mở rộng mọi khung' }, '⊞ Mở hết');
  const closeAll = el('button', { class: 'sa-btn ghost', type: 'button', title: 'Thu gọn mọi khung' }, '⊟ Thu gọn hết');
  openAll.onclick = () => body.querySelectorAll('.sa-fold').forEach((c) => c._set(true));
  closeAll.onclick = () => body.querySelectorAll('.sa-fold').forEach((c) => c._set(false));
  dateI.onchange = () => { if (dateI.value) { ST.date = dateI.value; load(); } };
  prev.onclick = () => { ST.date = addDays(ST.date, -1); dateI.value = ST.date; load(); };
  next.onclick = () => { ST.date = addDays(ST.date, 1); dateI.value = ST.date; load(); };
  reload.onclick = () => load();
  xlsBtn.onclick = () => exportDlg();
  const body = el('div');
  main.append(el('div', { class: 'sa-bar' }, prev, dateI, next, reload, forBtn, xlsBtn, el('span', { style: 'flex:1' }), openAll, closeAll), body);
  let R = null;
  forBtn.onclick = () => orderForDlg(R?.shifts?.[0]?.code);

  async function load() {
    body.innerHTML = ''; body.append(C.loading());
    try { R = await api('/admin/meal/report?date=' + ST.date); } catch (e) { body.innerHTML = ''; body.append(el('div', { class: 'empty' }, e.message)); return; }
    draw();
  }

  function draw() {
    body.innerHTML = '';
    if (!R.shifts.length) { body.append(el('div', { class: 'empty' }, 'Chưa bật ca ăn nào — vào Suất ăn › Cấu hình để bật.')); return; }
    // dải tổng nhanh: mỗi bữa bao nhiêu suất phải nấu
    body.append(el('div', { class: 'sa-kpis' }, ...R.shifts.map((s) => {
      const k = el('button', { type: 'button', class: 'sa-kpi', title: 'Bấm để mở bữa này' },
        el('div', { class: 'k' }, s.name), el('div', { class: 'v' }, nf(s.totals.total)), el('div', { class: 'sa-hint' }, `suất phải nấu · đã quẹt ${nf(s.totals.ate)}`));
      k.onclick = () => { const c = body.querySelector(`.sa-fold[data-fold="shift:${s.code}"]`); if (c) { c._set(true); c.scrollIntoView({ behavior: 'smooth', block: 'start' }); } };
      return k;
    })));
    for (const s of R.shifts) body.append(shiftCard(s));
    body.append(logBox(R.log));
  }

  function shiftCard(s) {
    const t = s.totals;
    const dl = `${s.deadline.slice(11)}${s.deadline.slice(0, 10) === R.date ? '' : ' ngày ' + dmy(s.deadline.slice(0, 10)).slice(0, 5)}`;
    const info = el('div', { class: 'sa-info sa-info-in' },
      el('span', {}, el('b', {}, s.name), ` · quẹt thẻ ${s.from_time} → ${s.to_time}`),
      s.locked ? el('span', { class: 'sa-pill muted' }, `🔒 Đã khoá chọn món lúc ${dl}`) : el('span', { class: 'sa-pill warn' }, `Còn mở chọn món đến ${dl} — số còn thay đổi`),
      el('span', {}, 'Trưởng BP đăng ký: ', el('b', {}, t.registered == null ? 'chưa' : nf(t.registered))),
      el('span', {}, 'Đã chọn món: ', el('b', {}, nf(t.chosen)), ' người'),
      s.closed ? el('span', { class: 'sa-pill red' }, `✔ HR đã chốt ${nf(s.closed.total)} suất (${s.closed.by || ''})`) : el('span', { class: 'sa-pill muted' }, 'HR chưa chốt số'));
    const adjCell = (dish, val) => {
      const b = el('button', { type: 'button', class: 'sa-adj' + (val ? (val > 0 ? ' pos' : ' neg') : ''), title: 'Bấm để HR chỉnh số suất (có lưu vết)' }, val ? (val > 0 ? '+' : '−') + nf(Math.abs(val)) : '✎');
      b.onclick = () => adjustDlg(s, dish, val);
      const n = s.adjust_notes[dish];
      return el('td', { class: 'num' }, b, n ? el('span', { class: 'sa-sub', title: n.note }, n.note.length > 28 ? n.note.slice(0, 27) + '…' : n.note) : null);
    };
    const rows = s.rows.map((x) => el('tr', {},
      el('td', { class: 'dept' }, x.dish), el('td', { class: 'num' }, nf(x.app)), el('td', { class: 'num' }, x.hr ? nf(x.hr) : '—'),
      adjCell(x.dish, x.adjust), el('td', { class: 'num sa-total' }, nf(x.total)), el('td', { class: 'num' }, nf(x.ate))));
    const d = s.default;
    rows.push(el('tr', { class: 'sa-defrow' },
      el('td', { class: 'dept', title: 'Người ăn mà không chọn món: số trưởng bộ phận đăng ký vượt số người đã chọn món, cộng điều chỉnh của HR' }, 'Không chọn món (suất mặc định)'),
      el('td', { class: 'num' }, d.base ? nf(d.base) : '—', d.base ? el('span', { class: 'sa-sub' }, 'theo trưởng BP') : null), el('td', { class: 'num' }, '—'),
      adjCell('', d.adjust), el('td', { class: 'num sa-total' }, nf(d.total)), el('td', { class: 'num' }, nf(d.ate))));
    const tbl = el('table', { class: 'sa-tbl' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Món'), el('th', { class: 'num' }, 'NV tự chọn'), el('th', { class: 'num' }, 'HR chọn hộ'),
        el('th', { class: 'num', title: 'HR thêm / bớt suất bằng tay — bấm để sửa, bắt buộc ghi lý do' }, 'HR điều chỉnh'), el('th', { class: 'num' }, 'Tổng phải nấu'),
        el('th', { class: 'num', title: 'Số người đã quẹt máy chấm công trong giờ ăn' }, 'Thực tế đã quẹt'))),
      el('tbody', {}, ...rows),
      el('tfoot', {}, el('tr', {}, el('td', {}, 'Tổng cộng'), el('td', { class: 'num' }, nf(t.app)), el('td', { class: 'num' }, nf(t.hr)),
        el('td', { class: 'num' }, t.adjust ? (t.adjust > 0 ? '+' : '−') + nf(Math.abs(t.adjust)) : '—'),
        el('td', { class: 'num sa-total', style: 'font-size:17px' }, nf(t.total)), el('td', { class: 'num' }, nf(t.ate)))));
    const forOne = el('button', { class: 'sa-btn ghost', type: 'button' }, '➕ Chọn món hộ nhân viên');
    forOne.onclick = () => orderForDlg(s.code);
    const send = el('button', { class: 'sa-btn red', type: 'button', title: 'Chốt số gửi màn hình bếp + lấy tin nhắn dán Zalo' }, '📤 Gửi bếp');
    send.onclick = () => dispatchDlg(R.date, s.code);
    return foldCard('shift:' + s.code, true, [info],
      [el('span', { class: 'sa-sum-n' }, nf(t.total)), el('span', { class: 'sa-hint' }, ` phải nấu · đã quẹt ${nf(t.ate)}`)],
      [s.rows.length ? null : el('div', { class: 'sa-hint', style: 'margin-bottom:6px' }, 'Chưa có thực đơn cho bữa này (Suất ăn › Thực đơn các bữa).'),
        el('div', { class: 'sa-wrap' }, tbl),
        el('div', { class: 'sa-actions' }, forOne, send, el('span', { class: 'sa-hint' }, `Đã chọn món nhưng chưa quẹt: ${nf(t.not_yet)} người. Tổng phải nấu = NV tự chọn + HR chọn hộ + HR điều chỉnh.`))]);
  }

  function logBox(log) {
    const KIND = { adjust: 'Điều chỉnh số suất', order: 'Chọn món hộ NV' };
    const name = Object.fromEntries(R.shifts.map((s) => [s.code, s.name]));
    // datetime('now') UTC 'YYYY-MM-DD HH:MM:SS' → 'dd/mm HH:MM' giờ VN
    const stamp = (s) => { const t = new Date(Date.parse(s.replace(' ', 'T') + 'Z') + 7 * 3600000).toISOString(); return `${t.slice(8, 10)}/${t.slice(5, 7)} ${t.slice(11, 16)}`; };
    const val = (l, v) => (l.kind === 'adjust' ? (Number(v) > 0 ? '+' : '') + v : v || (l.kind === 'order' ? '(chưa chọn)' : ''));
    return foldCard('log', false, [el('b', { class: 'sa-fold-h' }, '📝 Lịch sử HR chỉnh tay trong ngày')],
      [log.length ? el('span', { class: 'sa-pill warn' }, `${nf(log.length)} lần sửa`) : el('span', { class: 'sa-pill muted' }, 'chưa có')], [
      log.length ? el('div', { class: 'sa-wrap' }, el('table', { class: 'sa-tbl' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Lúc'), el('th', {}, 'Người sửa'), el('th', {}, 'Bữa'), el('th', {}, 'Loại'), el('th', {}, 'Nhân viên / Món'), el('th', {}, 'Cũ → Mới'), el('th', {}, 'Lý do'))),
        el('tbody', {}, ...log.map((l) => el('tr', {}, el('td', {}, stamp(l.at)), el('td', {}, l.by_name), el('td', {}, name[l.shift] || l.shift), el('td', {}, KIND[l.kind] || l.kind),
          el('td', {}, l.emp_label ? `${l.emp_label}` : '', l.emp_label ? el('span', { class: 'sa-sub' }, l.dish) : (l.dish || 'Không chọn món (mặc định)')),
          el('td', { style: 'white-space:nowrap' }, `${val(l, l.old_value)} → ${l.kind === 'order' && !l.new_value ? '(bỏ món)' : val(l, l.new_value)}`), el('td', {}, l.reason))))))
        : el('div', { class: 'sa-empty' }, 'Chưa có chỉnh sửa nào.')]);
  }

  // HR thêm / bớt suất của 1 món (dish '' = suất không chọn món)
  function adjustDlg(s, dish, cur) {
    const row = dish ? s.rows.find((x) => x.dish === dish) : null;
    const baseN = dish ? row.app + row.hr : s.default.base;
    const qtyI = el('input', { type: 'number', step: '1', min: '-9999', max: '9999', value: cur ? String(cur) : '', placeholder: 'VD 3 hoặc -2', style: 'width:140px;font-weight:700' });
    const why = el('input', { type: 'text', maxlength: '200', placeholder: 'VD: 3 khách đối tác ăn cùng · anh A quên đăng ký…', value: '' });
    const prevw = el('div', { class: 'sa-hint', style: 'margin-top:6px' });
    const upd = () => { const n = Number(qtyI.value || 0); prevw.textContent = Number.isInteger(n) ? `Tổng phải nấu món này sẽ là: ${nf(Math.max(0, baseN + n))} suất (${nf(baseN)} theo đăng ký ${n >= 0 ? '+' : '−'} ${nf(Math.abs(n))})` : ''; };
    qtyI.oninput = upd; upd();
    const save = el('button', { class: 'sa-btn', type: 'button' }, '💾 Lưu điều chỉnh');
    save.onclick = async () => {
      try { await api('/admin/meal/adjust', { method: 'PUT', body: { date: R.date, shift: s.code, dish, qty: qtyI.value.trim(), reason: why.value } }); C.closeModal(); toast('Đã lưu — có ghi lịch sử', 'ok'); load(); }
      catch (e) { toast(e.message, 'err'); }
    };
    C.openModal(`✎ HR điều chỉnh — ${s.name} ${dmy(R.date)}`, [el('div', { class: 'sa' },
      el('div', { style: 'font-weight:700;color:#1e3a68;margin-bottom:6px' }, dish || 'Không chọn món (suất mặc định)'),
      el('div', { class: 'sa-hint', style: 'margin-bottom:10px' }, `Theo đăng ký hiện có: ${nf(baseN)} suất. Nhập số THÊM (+) hoặc BỚT (−) so với đăng ký; để trống / 0 = bỏ điều chỉnh. Mỗi lần sửa đều được lưu vết.`),
      el('label', {}, 'Điều chỉnh (+/−)'), qtyI, prevw, el('label', { style: 'margin-top:10px;display:block' }, 'Lý do (bắt buộc)'), why)], [save]);
    setTimeout(() => qtyI.focus(), 50);
  }

  // HR chọn món hộ 1 nhân viên (quên đăng ký / điện thoại hỏng…) — bỏ qua hạn chọn món; bếp thấy món khi NV quẹt
  async function orderForDlg(code) {
    if (!R) return;
    let menu;
    try { menu = (await api('/admin/meal/menu?date=' + R.date)).menu || {}; } catch (e) { return toast(e.message, 'err'); }
    let shift = code || R.shifts[0].code, emp = null, dishId = '';
    const shSel = el('select', {}, ...R.shifts.map((s) => el('option', { value: s.code }, s.name)));
    shSel.value = shift;
    const picked = el('div', { class: 'sa-hint', style: 'margin:6px 0' }, 'Chưa chọn nhân viên.');
    const pk = empPicker({
      date: R.date, getShift: () => shift,
      info: (e) => `${e.department || '(chưa có BP)'} · ${e.dish ? 'đang chọn: ' + e.dish + (e.set_by ? ' (HR chọn hộ)' : '') : 'chưa chọn món'}`,
      isOn: (e) => emp?.id === e.id,
      onToggle: (e) => { emp = emp?.id === e.id ? null : e; picked.textContent = emp ? `✔ ${e.code || ''} ${e.full_name} — ${e.dish ? 'đang chọn ' + e.dish : 'chưa chọn món'}` : 'Chưa chọn nhân viên.'; },
    });
    const q = pk.input, results = pk.list;
    const dishBox = el('div', { class: 'sa-dishes' });
    const why = el('input', { type: 'text', maxlength: '200', placeholder: 'VD: quên đăng ký · điện thoại hỏng · không vào được mạng…' });
    const drawDishes = () => {
      dishBox.innerHTML = '';
      const list = menu[shift] || [];
      if (!list.length) { dishBox.append(el('div', { class: 'sa-hint' }, 'Bữa này chưa có thực đơn.')); return; }
      for (const m of [...list, { id: '', name: '✕ Bỏ món của nhân viên này' }]) {
        const b = el('button', { type: 'button', class: 'sa-dish' + (String(m.id) === String(dishId) && dishId !== null ? ' on' : '') }, el('span', { class: 'dot' }), m.name);
        b.onclick = () => { dishId = m.id; dishBox.querySelectorAll('.sa-dish').forEach((x) => x.classList.toggle('on', x === b)); };
        dishBox.append(b);
      }
    };
    shSel.onchange = () => { shift = shSel.value; dishId = null; emp = null; picked.textContent = 'Chưa chọn nhân viên.'; drawDishes(); pk.reload(); };
    dishId = null; drawDishes();
    const save = el('button', { class: 'sa-btn', type: 'button' }, '💾 Lưu món cho nhân viên');
    save.onclick = async () => {
      if (!emp) return toast('Chọn nhân viên trước', 'err');
      if (dishId === null) return toast('Chọn món', 'err');
      try { const r = await api('/admin/meal/order-for', { method: 'PUT', body: { date: R.date, shift, employee_id: emp.id, menu_id: dishId, reason: why.value } }); C.closeModal(); toast(r.dish ? `Đã chọn ${r.dish} cho ${r.employee}` : `Đã bỏ món của ${r.employee}`, 'ok'); load(); }
      catch (e) { toast(e.message, 'err'); }
    };
    C.openModal(`➕ Chọn món hộ nhân viên — ${dmy(R.date)}`, [el('div', { class: 'sa' },
      el('div', { class: 'sa-hint', style: 'margin-bottom:8px' }, 'Dùng khi nhân viên quên đăng ký, điện thoại hỏng / không vào mạng được. Không bị hạn chọn món chặn; màn hình bếp hiện món này khi nhân viên quẹt thẻ. Mỗi lần chọn hộ đều được lưu vết.'),
      el('label', {}, 'Bữa'), shSel, el('label', { style: 'display:block;margin-top:8px' }, 'Nhân viên'), q, results, picked,
      el('label', {}, 'Món'), dishBox, el('label', { style: 'display:block;margin-top:8px' }, 'Lý do (bắt buộc)'), why)], [save]);
    setTimeout(() => { q.focus(); pk.show(); }, 50);   // mở hộp là hiện luôn danh sách NV
  }

  function exportDlg() {
    const f = el('input', { type: 'date', value: ST.date }), t = el('input', { type: 'date', value: ST.date });
    const month = el('button', { class: 'sa-btn ghost', type: 'button' }, 'Cả tháng này');
    month.onclick = () => { const d = ST.date; f.value = d.slice(0, 8) + '01'; const last = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7), 0)).toISOString().slice(0, 10); t.value = last; };
    const go = el('button', { class: 'sa-btn', type: 'button' }, '⬇ Tải file Excel');
    go.onclick = async () => {
      try {
        const res = await api(`/admin/meal/report.xlsx?from=${f.value}&to=${t.value}`, { raw: true });
        if (!res.ok) { let m = 'Không xuất được báo cáo'; try { m = (await res.json()).error || m; } catch {} return toast(m, 'err'); }
        const url = URL.createObjectURL(await res.blob());
        const a = el('a', { href: url, download: `bao_cao_suat_an_${f.value}_${t.value}.xlsx` });
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
        C.closeModal(); toast('Đã xuất báo cáo', 'ok');
      } catch { toast('Không xuất được báo cáo', 'err'); }
    };
    C.openModal('⬇ Xuất báo cáo suất ăn ra Excel', [el('div', { class: 'sa' },
      el('div', { class: 'sa-hint', style: 'margin-bottom:8px' }, 'File gồm 3 sheet: Tổng hợp theo ngày/bữa/món · Chi tiết từng nhân viên · Lịch sử HR chỉnh sửa. Tối đa 62 ngày.'),
      el('div', { style: 'display:flex;gap:10px;align-items:end;flex-wrap:wrap' }, el('div', {}, el('label', {}, 'Từ ngày'), f), el('div', {}, el('label', {}, 'Đến ngày'), t), month))], [go]);
  }
  load();
}

/* ===================== SUẤT ĂN CỦA TÔI (chọn món + trưởng BP nhập số) ===================== */
export function pageMealMe(ctx) {
  C = ctx; css();
  const main = el('div', { class: 'sa', style: 'max-width:640px' });
  C.setMain(C.head('🍱 Suất ăn của tôi'), main);
  renderMealTab(main);
}
