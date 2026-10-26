// QUẢN LÝ SUẤT ĂN — phần cho NHÂN VIÊN trên app (tab "Suất ăn") và cho "Suất ăn của tôi" trong /admin:
//   · CHỌN MÓN cho từng bữa (trưa / chiều / đêm) theo thực đơn HR đã nhập
//   · TRƯỞNG BỘ PHẬN: nhập số suất ăn đăng ký của bộ phận mình cho từng ca (HR sửa / nhập hộ được ở /admin)
import { api, toast, el } from '/common.js';

const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const vnToday = () => new Date().toLocaleDateString('sv', { timeZone: 'Asia/Ho_Chi_Minh' });
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const dmy = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;

function css() {
  if (!document.getElementById('sa-css')) document.head.append(el('link', { id: 'sa-css', rel: 'stylesheet', href: '/suatan/suatan.css' }));
}

export async function renderMealTab(root) {
  css();
  root.classList.add('sa');
  root.innerHTML = '';
  root.append(el('div', { class: 'sa-empty' }, 'Đang tải…'));
  let me;
  try { me = await api('/meal/me'); } catch (e) { root.innerHTML = ''; root.append(el('div', { class: 'sa-empty' }, e.message)); return; }
  root.innerHTML = '';
  const orderBox = el('div'), headBox = el('div');
  // công ty tắt "Nhân viên tự chọn món" → bỏ phần chọn món, chỉ còn phần trưởng bộ phận nhập số
  // công ty tắt "Có chọn món" → chế độ CHỈ ĐĂNG KÝ ĂN: mỗi bữa 1 cặp nút Có ăn / Không ăn
  // chỉ báo cơm bằng quẹt máy (tắt tự đăng ký trên app) → NV vẫn xem được bữa nào đã báo, không bấm được
  if (me.self_order !== false) { root.append(orderBox); if (me.dish_choice === false) drawSignups(orderBox, me); else drawOrders(orderBox, me); }
  else if (me.machine_signup) { root.append(orderBox); drawSignups(orderBox, me, { readOnly: true }); }
  else if (!me.head_of.length) root.append(el('div', { class: 'sa-empty' }, 'Công ty đăng ký suất ăn theo bộ phận — trưởng bộ phận / HR báo số giúp bạn, bạn không cần đăng ký.'));
  if (me.head_of.length) { root.append(headBox); drawHead(headBox, me); }
}

/* ---------- chọn món ---------- */
async function drawOrders(box, me) {
  const today = me.today || vnToday();
  let sel = today;
  const strip = el('div', { class: 'sa-days' });
  const list = el('div');
  box.append(el('div', { class: 'sa-sec', style: 'margin-top:4px' }, '🍽️ Chọn món'), strip, list);
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const redrawStrip = () => {
    strip.innerHTML = '';
    for (const d of days) {
      const w = WD[new Date(d + 'T12:00:00Z').getUTCDay()];
      const b = el('button', { type: 'button', class: 'sa-day' + (d === sel ? ' on' : '') }, w, el('b', {}, d.slice(8)), dmy(d));
      b.onclick = () => { sel = d; redrawStrip(); load(); };
      strip.append(b);
    }
  };
  async function load() {
    list.innerHTML = ''; list.append(el('div', { class: 'sa-empty' }, 'Đang tải…'));
    let r;
    try { r = await api(`/meal/plan?from=${sel}&to=${sel}`); } catch (e) { list.innerHTML = ''; list.append(el('div', { class: 'sa-empty' }, e.message)); return; }
    list.innerHTML = '';
    const day = r.days[0];
    if (!day || !day.shifts.length) { list.append(el('div', { class: 'sa-empty' }, 'Chưa có ca ăn nào được bật.')); return; }
    for (const s of day.shifts) {
      // hạn chọn món 'YYYY-MM-DD HH:MM' (giờ VN): cùng ngày ăn chỉ ghi giờ, khác ngày ghi thêm ngày
      const dl = s.deadline ? s.deadline.slice(11) + (s.deadline.slice(0, 10) === sel ? '' : ' ngày ' + dmy(s.deadline.slice(0, 10))) : '';
      const card = el('div', { class: 'sa-meal' }, el('h4', {}, 'Bữa ' + s.name.toLowerCase()), el('div', { class: 'when' }, `Quẹt thẻ khoảng ${s.from_time} → ${s.to_time}` + (s.editable ? (dl ? ` · chọn món trước ${dl}` : '') : ' · đã khoá chọn món' + (dl ? ` (hạn ${dl})` : ''))));
      if (!s.dishes.length) card.append(el('div', { class: 'sa-empty' }, 'Chưa có thực đơn cho bữa này.'));
      for (const m of s.dishes) {
        const on = s.chosen && s.chosen.menu_id === m.id;
        const b = el('button', { type: 'button', class: 'sa-dish' + (on ? ' on' : ''), ...(s.editable ? {} : { disabled: '' }) }, el('span', { class: 'dot' }), m.name);
        b.onclick = async () => {
          try { await api('/meal/order', { method: 'PUT', body: { date: sel, shift: s.code, menu_id: on ? null : m.id } }); toast(on ? 'Đã bỏ chọn' : `Đã chọn: ${m.name}`, 'ok'); load(); }
          catch (e) { toast(e.message, 'err'); }
        };
        card.append(b);
      }
      if (s.chosen && !s.dishes.some((m) => m.id === s.chosen.menu_id)) card.append(el('div', { class: 'sa-hint', style: 'margin-top:6px' }, `Món đã chọn: ${s.chosen.dish} (món đã bị gỡ khỏi thực đơn)`));
      list.append(card);
    }
  }
  redrawStrip(); load();
}

/* ---------- đăng ký ăn (không chọn món): Có ăn / Không ăn cho từng bữa, 7 ngày tới ---------- */
// 'YYYY-MM-DD HH:MM' → 'HH:MM' (cùng ngày `day`) hoặc 'HH:MM ngày dd/mm'
const atTxt = (v, day) => (v ? v.slice(11) + (v.slice(0, 10) === day ? '' : ' ngày ' + dmy(v.slice(0, 10))) : '');
async function drawSignups(box, me, { readOnly = false } = {}) {
  const today = me.today || vnToday();
  let sel = today, days = [];
  const strip = el('div', { class: 'sa-days' });
  const list = el('div');
  box.append(el('div', { class: 'sa-sec', style: 'margin-top:4px;display:flex;align-items:center;gap:8px;flex-wrap:wrap' }, '📝 Đăng ký ăn', me.kitchen ? el('span', { class: 'sa-pill muted' }, '🍳 ' + me.kitchen) : null),
    el('div', { class: 'sa-hint', style: 'margin-bottom:8px' }, readOnly
      ? 'Báo ăn bằng cách QUẸT MÁY CHẤM CÔNG trong giờ đăng ký của từng bữa (xem giờ bên dưới). Cần huỷ / đổi thì báo HR.'
      : me.machine_signup ? 'Bấm "Có ăn" — hoặc QUẸT MÁY CHẤM CÔNG trong giờ đăng ký — cho bữa bạn sẽ ăn; chưa báo là KHÔNG ăn. Hết giờ khoá muốn đổi thì báo HR.'
        : 'Bấm "Có ăn" cho bữa bạn sẽ ăn — chưa bấm là KHÔNG ăn. Hết giờ khoá muốn đổi thì báo HR.'), strip, list);
  const drawStrip = () => {
    strip.innerHTML = '';
    for (const d of days) {
      const n = d.shifts.filter((s) => s.registered).length;
      const b = el('button', { type: 'button', class: 'sa-day' + (d.date === sel ? ' on' : '') }, WD[new Date(d.date + 'T12:00:00Z').getUTCDay()], el('b', {}, d.date.slice(8)), dmy(d.date),
        el('i', { class: 'sa-day-n' }, n ? `✔ ${n} bữa` : '—'));
      b.onclick = () => { sel = d.date; drawStrip(); drawDay(); };
      strip.append(b);
    }
  };
  const drawDay = () => {
    list.innerHTML = '';
    const day = days.find((d) => d.date === sel);
    if (!day || !day.shifts.length) { list.append(el('div', { class: 'sa-empty' }, 'Chưa có bữa ăn nào được bật.')); return; }
    for (const s of day.shifts) {
      // chỉ quẹt máy mà bữa chưa đặt giờ mở đăng ký → quẹt không báo được bữa này
      const when = readOnly && !s.open && s.state !== 'locked' ? 'không nhận báo bằng quẹt máy — cần ăn thì báo HR'
        : s.state === 'wait' ? `⏳ Mở đăng ký lúc ${atTxt(s.open, sel)}` : s.state === 'open' ? `🟢 Đăng ký đến ${atTxt(s.deadline, sel)}` : `🔒 Đã khoá lúc ${atTxt(s.deadline, sel)}`;
      const set = (on) => async () => {
        if (on === s.registered) return;
        try { await api('/meal/signup', { method: 'PUT', body: { date: sel, shift: s.code, on } }); toast(on ? `Đã đăng ký ăn ${s.name.toLowerCase()} ${dmy(sel)}` : `Đã huỷ bữa ${s.name.toLowerCase()} ${dmy(sel)}`, 'ok'); load(); }
        catch (e) { toast(e.message, 'err'); }
      };
      const dis = s.editable && !readOnly ? {} : { disabled: '' };
      const yes = el('button', { type: 'button', class: 'yes' + (s.registered ? ' on' : ''), ...dis }, '✔ Có ăn');
      const no = el('button', { type: 'button', class: 'no' + (s.registered ? '' : ' on'), ...dis }, '✕ Không ăn');
      yes.onclick = set(true); no.onclick = set(false);
      list.append(el('div', { class: 'sa-meal' + (s.registered ? ' sa-meal-on' : '') }, el('h4', {}, 'Bữa ' + s.name.toLowerCase()),
        el('div', { class: 'when' }, `Ăn khoảng ${s.from_time} → ${s.to_time} · ${when}`),
        readOnly ? el('div', { class: 'sa-hint', style: 'font-weight:600' }, s.registered ? '✔ Đã báo ăn' : '— Chưa báo ăn') : el('div', { class: 'sa-yn' }, yes, no),
        s.registered && s.set_by ? el('div', { class: 'sa-hint', style: 'margin-top:6px' }, 'HR đã đăng ký giúp bạn bữa này.')
          : s.registered && s.source === 'may' ? el('div', { class: 'sa-hint', style: 'margin-top:6px' }, 'Bạn đã báo bữa này bằng quẹt máy chấm công.') : null));
    }
  };
  async function load() {
    try { days = (await api(`/meal/plan?from=${today}&to=${addDays(today, 6)}`)).days; }
    catch (e) { list.innerHTML = ''; list.append(el('div', { class: 'sa-empty' }, e.message)); return; }
    drawStrip(); drawDay();
  }
  list.append(el('div', { class: 'sa-empty' }, 'Đang tải…'));
  load();
}

/* ---------- trưởng bộ phận nhập số ---------- */
async function drawHead(box, me) {
  const today = me.today || vnToday();
  let date = today, shift = me.shifts[0]?.code || '';
  const dateI = el('input', { type: 'date', value: date, min: today, style: 'width:auto' });
  const seg = el('div', { class: 'sa-seg' });
  for (const s of me.shifts) {
    const b = el('button', { type: 'button', class: s.code === shift ? 'on' : '' }, s.name);
    b.onclick = () => { shift = s.code; seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); load(); };
    seg.append(b);
  }
  const body = el('div');
  box.append(el('div', { class: 'sa-sec' }, '📋 Đăng ký suất ăn của bộ phận'),
    el('div', { class: 'sa-hint', style: 'margin-bottom:6px' }, 'Bạn là trưởng: ' + me.head_of.join(', ') + '. Nhập số suất ăn THỰC TẾ cần nấu cho từng ca; HR đối chiếu rồi chốt.'),
    el('div', { class: 'sa-bar' }, dateI, seg), body);
  dateI.onchange = () => { if (dateI.value) { date = dateI.value; load(); } };
  async function load() {
    if (!shift) { body.innerHTML = ''; return; }
    body.innerHTML = ''; body.append(el('div', { class: 'sa-empty' }, 'Đang tải…'));
    let r;
    try { r = await api(`/meal/dept?date=${date}&shift=${shift}`); } catch (e) { body.innerHTML = ''; body.append(el('div', { class: 'sa-empty' }, e.message)); return; }
    body.innerHTML = '';
    const locked = r.closed || r.past;
    if (r.closed) body.append(el('div', { class: 'sa-lock' }, '🔒 HR đã chốt số ca này — liên hệ HR nếu cần sửa.'));
    else if (r.past) body.append(el('div', { class: 'sa-lock' }, 'Ngày đã qua — liên hệ HR nếu cần sửa.'));
    const rows = r.departments.map((d) => {
      const n = el('input', { type: 'number', min: '0', max: '99999', step: '1', inputmode: 'numeric', placeholder: '—', value: d.count == null ? '' : String(d.count), ...(locked ? { disabled: '' } : {}) });
      const note = el('input', { type: 'text', class: 'sa-note2', maxlength: '200', placeholder: 'Ghi chú (không bắt buộc)', value: d.note || '', ...(locked ? { disabled: '' } : {}) });
      body.append(el('div', { class: 'sa-head-row' }, el('b', {}, d.department), n, note));
      return { d, n, note };
    });
    if (!locked) {
      const save = el('button', { class: 'sa-btn', type: 'button', style: 'margin-top:10px;width:100%' }, '💾 Gửi số đăng ký lên HR');
      save.onclick = async () => {
        const items = rows.map((x) => ({ department: x.d.department, count: x.n.value.trim(), note: x.note.value }));
        save.disabled = true;
        try { await api('/meal/dept', { method: 'PUT', body: { date, shift, items } }); toast('Đã gửi số đăng ký', 'ok'); load(); }
        catch (e) { toast(e.message, 'err'); save.disabled = false; }
      };
      body.append(save);
    }
  }
  load();
}
