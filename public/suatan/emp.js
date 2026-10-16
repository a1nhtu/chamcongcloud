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
  root.append(orderBox);
  if (me.head_of.length) root.append(headBox);
  drawOrders(orderBox, me);
  if (me.head_of.length) drawHead(headBox, me);
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
