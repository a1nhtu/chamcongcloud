// QUẢN LÝ SUẤT ĂN (giao diện HR trong /admin) — Đối chiếu & chốt · Thực đơn · Cấu hình · Suất ăn của tôi.
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
    const save = el('button', { class: 'sa-btn', type: 'button', style: 'margin-top:10px' }, '💾 Lưu ca');
    save.onclick = async () => {
      try { await api('/admin/meal/shifts/' + s.code, { method: 'PUT', body: { name: nameI.value, from_time: fromI.value, to_time: toI.value, mode: modeS.value, enabled: enI.checked } }); toast('Đã lưu ' + nameI.value, 'ok'); }
      catch (e) { toast(e.message, 'err'); }
    };
    g1.append(el('div', { class: 'sa-card' }, el('h4', {}, s.name), el('label', {}, 'Tên ca'), nameI,
      el('div', { class: 'sa-row2' }, el('div', {}, el('label', {}, 'Bắt đầu'), fromI), el('div', {}, el('label', {}, 'Giờ chốt'), toI)),
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

/* ===================== SUẤT ĂN CỦA TÔI (chọn món + trưởng BP nhập số) ===================== */
export function pageMealMe(ctx) {
  C = ctx; css();
  const main = el('div', { class: 'sa', style: 'max-width:640px' });
  C.setMain(C.head('🍱 Suất ăn của tôi'), main);
  renderMealTab(main);
}
