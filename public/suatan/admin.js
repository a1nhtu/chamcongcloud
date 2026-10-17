// QUẢN LÝ SUẤT ĂN (giao diện HR trong /admin) — Đối chiếu & chốt · Báo cáo theo món · Thực đơn · Cấu hình · Suất ăn của tôi.
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

/* ===================== CẤU HÌNH ===================== */
export async function pageMealCfg(ctx) {
  C = ctx; css();
  const main = el('div', { class: 'sa' });
  C.setMain(C.head('⚙️ Suất ăn — cấu hình'), main);
  main.append(C.loading());
  let shifts, heads, devs, kit;
  try {
    [shifts, heads, devs, kit] = await Promise.all([api('/admin/meal/shifts'), api('/admin/meal/heads'), api('/admin/meal/devices'), api('/admin/meal/kitchen')]);
  } catch (e) { main.innerHTML = ''; main.append(el('div', { class: 'empty' }, e.message)); return; }
  main.innerHTML = '';

  /* --- ca ăn + giờ chốt --- */
  main.append(el('div', { class: 'sa-sec' }, '1. Ba ca ăn & giờ chốt'),
    el('div', { class: 'sa-hint', style: 'margin-bottom:8px' }, 'Giờ chốt: lượt quẹt máy chấm công nằm NGOÀI khung giờ này không được tính vào suất của ca. Khung qua nửa đêm được (VD Đêm 23:00 → 02:00 tính cho ngày bắt đầu).'));
  const g1 = el('div', { class: 'sa-grid' });
  for (const s of shifts.shifts) {
    const nameI = el('input', { type: 'text', value: s.name, maxlength: '40' });
    const fromI = el('input', { type: 'time', value: s.from_time });
    const toI = el('input', { type: 'time', value: s.to_time });
    const modeS = el('select', {}, el('option', { value: 'punch' }, 'Đếm lượt chấm công'), el('option', { value: 'ot' }, 'Đối chiếu đăng ký làm thêm (không đếm chấm công)'));
    modeS.value = s.mode;
    const enI = el('input', { type: 'checkbox', style: 'width:auto', ...(s.enabled ? { checked: '' } : {}) });
    // hạn chọn món: để bếp có thời gian chuẩn bị (server/meal-rules.js orderDeadlineMs)
    const lockS = el('select', {}, el('option', { value: 'start' }, 'Khi bắt đầu giờ ăn'), el('option', { value: 'before' }, 'Trước giờ ăn … tiếng'), el('option', { value: 'at' }, 'Lúc giờ cố định'));
    lockS.value = s.lock_at ? 'at' : s.lock_before_min > 0 ? 'before' : 'start';
    const lockH = el('input', { type: 'number', min: '0.5', max: '48', step: '0.5', value: s.lock_before_min > 0 ? String(s.lock_before_min / 60) : '2', style: 'width:90px' });
    const lockAt = el('input', { type: 'time', value: s.lock_at || '' });
    const lockHint = el('div', { class: 'sa-hint', style: 'margin-top:4px' });
    const lockBox = el('div', { style: 'display:flex;gap:8px;align-items:center;margin-top:6px' });
    const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const toMin = (v) => { const [h, m] = String(v || '').split(':').map(Number); return h * 60 + m; };
    const drawLock = () => {
      lockBox.innerHTML = '';
      if (lockS.value === 'before') lockBox.append(lockH, el('span', {}, 'tiếng trước giờ bắt đầu'));
      if (lockS.value === 'at') lockBox.append(lockAt, el('span', {}, '(muộn hơn giờ bắt đầu = của hôm trước)'));
      const f = toMin(fromI.value);
      let dl = NaN;
      if (lockS.value === 'start') dl = f;
      else if (lockS.value === 'before') dl = f - Math.round(Number(lockH.value) * 60);
      else if (lockAt.value) { const l = toMin(lockAt.value); dl = l > f ? l - 1440 : l; }
      if (Number.isNaN(dl)) { lockHint.textContent = ''; return; }
      const days = Math.floor(dl / 1440), at = hm(dl - days * 1440);
      lockHint.textContent = `→ Nhân viên chọn / đổi món đến ${at} ${days === 0 ? 'cùng ngày ăn' : days === -1 ? 'hôm trước' : -days + ' ngày trước'}; sau đó khoá.`;
    };
    lockS.onchange = drawLock; lockH.oninput = drawLock; lockAt.oninput = drawLock; fromI.addEventListener('input', drawLock);
    drawLock();
    const save = el('button', { class: 'sa-btn', type: 'button', style: 'margin-top:10px' }, '💾 Lưu ca');
    save.onclick = async () => {
      try { await api('/admin/meal/shifts/' + s.code, { method: 'PUT', body: { name: nameI.value, from_time: fromI.value, to_time: toI.value, mode: modeS.value, enabled: enI.checked, lock_mode: lockS.value, lock_hours: lockH.value, lock_at: lockAt.value } }); toast('Đã lưu ' + nameI.value, 'ok'); }
      catch (e) { toast(e.message, 'err'); }
    };
    g1.append(el('div', { class: 'sa-card' }, el('h4', {}, s.name), el('label', {}, 'Tên ca'), nameI,
      el('div', { class: 'sa-row2' }, el('div', {}, el('label', {}, 'Bắt đầu'), fromI), el('div', {}, el('label', {}, 'Giờ chốt'), toI)),
      el('label', {}, 'Khoá chọn món'), lockS, lockBox, lockHint,
      el('label', {}, 'Cách đối chiếu'), modeS,
      el('label', { style: 'display:flex;gap:8px;align-items:center;margin-top:10px;color:inherit' }, enI, 'Bật ca này'), save));
  }
  main.append(g1);

  /* --- trưởng bộ phận --- */
  main.append(el('div', { class: 'sa-sec' }, '2. Trưởng bộ phận (được nhập số đăng ký ăn cho bộ phận mình & bộ phận con)'));
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

  /* --- máy chấm công --- */
  main.append(el('div', { class: 'sa-sec' }, '3. Máy chấm công dùng để đếm suất ăn'));
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

  /* --- màn hình bếp --- */
  main.append(el('div', { class: 'sa-sec' }, '4. Màn hình bếp'));
  const kBox = el('div', { class: 'sa-card' });
  // gốc liên kết: tên miền HR đã lưu > tên miền tunnel (khi đang mở bằng localhost/IP) > địa chỉ đang mở
  const isLocal = /^(localhost|127\.|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);
  const baseOf = () => kit.base || (isLocal && kit.domain ? 'https://' + kit.domain : location.origin);
  const urlOf = (k) => `${baseOf()}/bep/${k}`;
  const codeEl = el('div', { style: 'font-size:34px;font-weight:900;letter-spacing:8px;color:var(--sa-navy);margin:2px 0 8px' }, kit.key.toUpperCase());
  const keyEl = el('div', { class: 'sa-key' }, urlOf(kit.key.toUpperCase()));
  const copy = el('button', { class: 'sa-btn ghost', type: 'button' }, '📋 Sao chép liên kết');
  copy.onclick = async () => { try { await navigator.clipboard.writeText(keyEl.textContent); toast('Đã sao chép', 'ok'); } catch { toast('Không sao chép được — bôi đen rồi Ctrl+C', 'err'); } };
  const open = el('button', { class: 'sa-btn', type: 'button' }, '↗ Mở màn hình bếp');
  open.onclick = () => window.open(keyEl.textContent, '_blank');
  const renew = el('button', { class: 'sa-btn ghost', type: 'button' }, '🔑 Đổi mã');
  renew.onclick = async () => {
    if (!confirm('Đổi mã? Màn hình bếp đang mở sẽ ngừng hoạt động cho tới khi mở lại bằng mã / liên kết mới.')) return;
    try { kit = await api('/admin/meal/kitchen/renew', { method: 'POST' }); keyEl.textContent = urlOf(kit.key.toUpperCase()); codeEl.textContent = kit.key.toUpperCase(); toast('Đã đổi mã', 'ok'); } catch (e) { toast(e.message, 'err'); }
  };
  const baseIn = el('input', { value: kit.base || '', placeholder: kit.domain || 'VD: app.maychamcongcloud.com', style: 'flex:1;min-width:220px' });
  const saveBase = el('button', { class: 'sa-btn ghost', type: 'button' }, '💾 Lưu tên miền');
  saveBase.onclick = async () => {
    try { kit = { ...kit, ...(await api('/admin/meal/kitchen/base', { method: 'PUT', body: { base: baseIn.value } })) }; baseIn.value = kit.base; keyEl.textContent = urlOf(kit.key.toUpperCase()); toast('Đã lưu', 'ok'); } catch (e) { toast(e.message, 'err'); }
  };
  kBox.append(el('div', { class: 'sa-hint', style: 'margin-bottom:6px' }, 'Trên máy tính / tivi ở khu nhà bếp (không cần đăng nhập): mở trình duyệt, gõ địa chỉ máy chủ + /bep rồi nhập MÃ dưới đây (hoặc mở thẳng liên kết ngắn bên dưới). Khi nhân viên quẹt máy chấm công trong giờ ăn, màn hình hiện tên + món đã chọn.'),
    el('div', { class: 'sa-hint' }, 'Mã màn hình bếp (không phân biệt hoa thường):'), codeEl,
    keyEl, el('div', { class: 'sa-actions' }, open, copy, renew),
    el('div', { class: 'sa-hint', style: 'margin-top:10px' }, 'Tên miền in trên liên kết (để trống = theo địa chỉ đang mở trang này; gõ ngắn "abc" = abc.maychamcongcloud.com):'),
    el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, baseIn, saveBase));
  main.append(kBox);
}

/* ===================== BÁO CÁO SUẤT ĂN (theo món · HR chỉnh tay có lưu vết · xuất Excel) ===================== */
export async function pageMealReport(ctx) {
  C = ctx; css();
  const main = el('div', { class: 'sa' });
  C.setMain(C.head('📊 Suất ăn — báo cáo theo món'), main);
  if (!ST.date) ST.date = vnToday();
  const dateI = el('input', { type: 'date', value: ST.date });
  const prev = el('button', { class: 'sa-btn ghost', type: 'button', title: 'Hôm trước' }, '‹');
  const next = el('button', { class: 'sa-btn ghost', type: 'button', title: 'Hôm sau' }, '›');
  const reload = el('button', { class: 'sa-btn ghost', type: 'button' }, '⟳ Làm mới');
  const xlsBtn = el('button', { class: 'sa-btn', type: 'button' }, '⬇ Xuất Excel');
  const forBtn = el('button', { class: 'sa-btn ghost', type: 'button' }, '➕ Chọn món hộ nhân viên');
  dateI.onchange = () => { if (dateI.value) { ST.date = dateI.value; load(); } };
  prev.onclick = () => { ST.date = addDays(ST.date, -1); dateI.value = ST.date; load(); };
  next.onclick = () => { ST.date = addDays(ST.date, 1); dateI.value = ST.date; load(); };
  reload.onclick = () => load();
  xlsBtn.onclick = () => exportDlg();
  const body = el('div');
  main.append(el('div', { class: 'sa-bar' }, prev, dateI, next, reload, forBtn, xlsBtn), body);
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
    body.append(el('div', { class: 'sa-kpis' }, ...R.shifts.map((s) => el('div', { class: 'sa-kpi' },
      el('div', { class: 'k' }, s.name), el('div', { class: 'v' }, nf(s.totals.total)), el('div', { class: 'sa-hint' }, `suất phải nấu · đã quẹt ${nf(s.totals.ate)}`)))));
    for (const s of R.shifts) body.append(shiftCard(s));
    body.append(logBox(R.log));
  }

  function shiftCard(s) {
    const t = s.totals;
    const dl = `${s.deadline.slice(11)}${s.deadline.slice(0, 10) === R.date ? '' : ' ngày ' + dmy(s.deadline.slice(0, 10)).slice(0, 5)}`;
    const info = el('div', { class: 'sa-info' },
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
    return el('div', { class: 'sa-card', style: 'margin-bottom:14px' }, info, s.rows.length ? null : el('div', { class: 'sa-hint', style: 'margin-bottom:6px' }, 'Chưa có thực đơn cho bữa này (Suất ăn › Thực đơn các bữa).'),
      el('div', { class: 'sa-wrap' }, tbl),
      el('div', { class: 'sa-actions' }, forOne, el('span', { class: 'sa-hint' }, `Đã chọn món nhưng chưa quẹt: ${nf(t.not_yet)} người. Tổng phải nấu = NV tự chọn + HR chọn hộ + HR điều chỉnh.`)));
  }

  function logBox(log) {
    const KIND = { adjust: 'Điều chỉnh số suất', order: 'Chọn món hộ NV' };
    const name = Object.fromEntries(R.shifts.map((s) => [s.code, s.name]));
    // datetime('now') UTC 'YYYY-MM-DD HH:MM:SS' → 'dd/mm HH:MM' giờ VN
    const stamp = (s) => { const t = new Date(Date.parse(s.replace(' ', 'T') + 'Z') + 7 * 3600000).toISOString(); return `${t.slice(8, 10)}/${t.slice(5, 7)} ${t.slice(11, 16)}`; };
    const val = (l, v) => (l.kind === 'adjust' ? (Number(v) > 0 ? '+' : '') + v : v || (l.kind === 'order' ? '(chưa chọn)' : ''));
    return el('div', { class: 'sa-card' }, el('h4', {}, '📝 Lịch sử HR chỉnh tay trong ngày'),
      log.length ? el('div', { class: 'sa-wrap' }, el('table', { class: 'sa-tbl' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Lúc'), el('th', {}, 'Người sửa'), el('th', {}, 'Bữa'), el('th', {}, 'Loại'), el('th', {}, 'Nhân viên / Món'), el('th', {}, 'Cũ → Mới'), el('th', {}, 'Lý do'))),
        el('tbody', {}, ...log.map((l) => el('tr', {}, el('td', {}, stamp(l.at)), el('td', {}, l.by_name), el('td', {}, name[l.shift] || l.shift), el('td', {}, KIND[l.kind] || l.kind),
          el('td', {}, l.emp_label ? `${l.emp_label}` : '', l.emp_label ? el('span', { class: 'sa-sub' }, l.dish) : (l.dish || 'Không chọn món (mặc định)')),
          el('td', { style: 'white-space:nowrap' }, `${val(l, l.old_value)} → ${l.kind === 'order' && !l.new_value ? '(bỏ món)' : val(l, l.new_value)}`), el('td', {}, l.reason))))))
        : el('div', { class: 'sa-empty' }, 'Chưa có chỉnh sửa nào.'));
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
    const q = el('input', { type: 'search', placeholder: 'Gõ mã hoặc tên nhân viên (không cần dấu)…', autocomplete: 'off' });
    const results = el('div', { class: 'sa-picklist' });
    const picked = el('div', { class: 'sa-hint', style: 'margin:6px 0' }, 'Chưa chọn nhân viên.');
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
    let timer = 0;
    const search = async () => {
      if (!q.value.trim()) { results.innerHTML = ''; return; }
      try {
        const r = await api(`/admin/meal/emp-search?date=${R.date}&shift=${shift}&q=${encodeURIComponent(q.value)}`);
        results.innerHTML = '';
        if (!r.rows.length) results.append(el('div', { class: 'sa-hint' }, 'Không tìm thấy.'));
        for (const e of r.rows) {
          const b = el('button', { type: 'button', class: 'sa-pick' }, el('b', {}, `${e.code || ''} ${e.full_name}`), el('span', { class: 'sa-hint' }, ` · ${e.department || '(chưa có BP)'} · ${e.dish ? 'đang chọn: ' + e.dish + (e.set_by ? ' (HR chọn hộ)' : '') : 'chưa chọn món'}`));
          b.onclick = () => { emp = e; picked.textContent = `✔ ${e.code || ''} ${e.full_name} — ${e.dish ? 'đang chọn ' + e.dish : 'chưa chọn món'}`; results.innerHTML = ''; q.value = ''; };
          results.append(b);
        }
      } catch (e) { toast(e.message, 'err'); }
    };
    q.oninput = () => { clearTimeout(timer); timer = setTimeout(search, 250); };
    shSel.onchange = () => { shift = shSel.value; dishId = null; emp = null; picked.textContent = 'Chưa chọn nhân viên.'; drawDishes(); };
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
    setTimeout(() => q.focus(), 50);
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
