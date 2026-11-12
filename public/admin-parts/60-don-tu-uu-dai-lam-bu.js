/* ---------- 5) ĐƠN TỪ ---------- */
const HALF_TXT = { sang: 'nửa ngày sáng', chieu: 'nửa ngày chiều' };
let _lvTab = 'list';
async function pageLeaves() {
  if (_lvTab === 'quota') return pageLeaveQuota();
  if (_lvTab === 'priv') return pagePrivileges();
  const sel = el('select', { id: 'lv-filter' },
    el('option', { value: 'pending' }, 'Chờ duyệt'),
    el('option', { value: '' }, 'Tất cả'),
    el('option', { value: 'approved' }, 'Đã duyệt'),
    el('option', { value: 'rejected' }, 'Từ chối'));
  const addBtn = el('button', { class: 'btn' }, '+ Thêm đơn');
  addBtn.onclick = () => leaveAddModal();
  const quotaBtn = el('button', { class: 'btn ghost' }, '📅 Quỹ phép năm');
  quotaBtn.onclick = () => { _lvTab = 'quota'; pageLeaves(); };
  const privBtn = el('button', { class: 'btn ghost' }, '🤰 Chế độ ưu đãi');
  privBtn.onclick = () => { _lvTab = 'priv'; pageLeaves(); };
  const typeBtn = el('button', { class: 'btn ghost' }, '🏷️ Lý do nghỉ');
  typeBtn.onclick = () => leaveTypesModal();
  setMain(head('Đơn từ', sel, typeBtn, privBtn, quotaBtn, addBtn), loading());
  const load = async () => {
    const status = $('#lv-filter').value;
    const { rows } = await api('/leaves' + (status ? '?status=' + status : ''));
    const tbl = el('table', { class: 'data' });
    tbl.innerHTML = `<thead><tr><th>Nhân viên</th><th>Loại</th><th>Từ</th><th>Đến</th><th>Lý do</th><th>Trạng thái</th><th></th></tr></thead>`;
    const tb = el('tbody');
    if (!rows.length) tb.append(el('tr', {}, el('td', { colspan: 7 }, el('div', { class: 'empty' }, 'Không có đơn.'))));
    for (const r of rows) {
      const st = { pending: ['warn', 'Chờ duyệt'], approved: ['ok', 'Đã duyệt'], rejected: ['bad', 'Từ chối'] }[r.status];
      const delBtn = r.swap_id ? el('span', { style: 'color:#9ca3af;font-size:12px' }, 'xoá ở Đăng ký làm bù') : btnSm('Xoá', async () => {
        if (!confirm(`Xoá đơn "${r.type}" ${fmtD(r.from_date)}–${fmtD(r.to_date)} của ${r.full_name}?`)) return;
        try { await api('/leaves/admin/' + r.id, { method: 'DELETE' }); if (r.half && r.status === 'approved') await privRecompute([r.employee_id], r.from_date, r.to_date); toast('Đã xoá đơn', 'ok'); pageLeaves(); } catch (e) { toast(e.message, 'err'); }
      }, 'ghost');
      const act = r.status === 'pending' ? el('div', { style: 'display:flex;gap:6px' },
        btnSm('Duyệt', () => review(r, 'approve'), 'green'),
        btnSm('Từ chối', () => review(r, 'reject'), 'ghost')) : el('div', { style: 'display:flex;gap:8px;align-items:center' }, el('span', { style: 'color:var(--muted);font-size:13px' }, r.review_note || ''), delBtn);
      tb.append(el('tr', {},
        el('td', {}, el('b', {}, r.full_name), el('div', { style: 'color:#999;font-size:12px' }, r.code + ' · ' + (r.department || ''))),
        el('td', {}, r.type),
        el('td', {}, fmtD(r.from_date)), el('td', {}, fmtD(r.to_date), r.half ? el('div', { style: 'font-size:12px;color:#b45309' }, HALF_TXT[r.half] || '') : ''),
        el('td', {}, r.reason || '—'),
        el('td', {}, el('span', { class: 'pill ' + st[0] }, st[1])),
        el('td', {}, act),
      ));
    }
    tbl.append(tb);
    setMain(head('Đơn từ', sel, typeBtn, privBtn, quotaBtn, addBtn), el('div', { class: 'map-hint', style: 'margin:-6px 0 10px' }, 'Nhân viên gửi đơn trên app điện thoại (mục Đơn từ) → quản lý Duyệt / Từ chối ở đây. Hoặc quản lý bấm "+ Thêm đơn" để khai nghỉ trực tiếp cho nhân viên — đơn tự duyệt. Đơn đã duyệt hiện ở Tính công (P / R / KL / CT / TS / K) và báo cáo. Ưu đãi thai sản / nuôi con nhỏ (được đến muộn, về sớm) khai ở "🤰 Chế độ ưu đãi".'), el('div', { class: 'panel tbl-scroll' }, tbl));
    $('#lv-filter').value = status;
    $('#lv-filter').onchange = load;
  };
  sel.onchange = load; load();
}
// Quỹ phép năm của từng nhân viên: được hưởng, chuyển từ năm trước, đã nghỉ, chờ duyệt, còn lại
let _lvYear = null;
async function pageLeaveQuota() {
  const y0 = +todayVN().slice(0, 4);
  if (!_lvYear) _lvYear = y0;
  const back = el('button', { class: 'btn ghost' }, '‹ Đơn từ');
  back.onclick = () => { _lvTab = 'list'; pageLeaves(); };
  const ySel = el('select', {}, ...[y0 + 1, y0, y0 - 1, y0 - 2].map((y) => el('option', { value: y, ...(y === _lvYear ? { selected: '' } : {}) }, 'Năm ' + y)));
  ySel.onchange = () => { _lvYear = +ySel.value; pageLeaveQuota(); };
  setMain(head('Quỹ phép năm', ySel, back), loading());
  let d;
  try { d = await api('/leaves/balances?year=' + _lvYear); } catch (e) { return setMain(head('Quỹ phép năm', ySel, back), el('div', { class: 'empty' }, e.message)); }
  const S = d.settings || {};
  const q = el('input', { placeholder: 'Tìm tên / mã nhân viên', style: 'width:240px' });
  const tbl = el('table', { class: 'data' });
  tbl.innerHTML = '<thead><tr><th>Mã NV</th><th>Họ tên</th><th>Bộ phận</th><th>Ngày vào làm</th><th class="c">Phép cả năm</th><th class="c">Được hưởng đến nay</th><th class="c">Năm trước chuyển sang</th><th class="c">Đã nghỉ</th><th class="c">Chờ duyệt</th><th class="c">Còn lại</th></tr></thead>';
  const tb = el('tbody'); tbl.append(tb);
  const n1 = (v) => String(v ?? 0).replace('.', ',');
  const draw = () => {
    const s = q.value.trim().toLowerCase();
    tb.innerHTML = '';
    const rows = d.rows.filter((r) => !s || (r.name || '').toLowerCase().includes(s) || String(r.code || '').toLowerCase().includes(s));
    if (!rows.length) tb.append(el('tr', {}, el('td', { colspan: 10 }, el('div', { class: 'empty' }, 'Không có nhân viên.'))));
    for (const r of rows) tb.append(el('tr', {},
      el('td', {}, r.code || ''), el('td', {}, el('b', {}, r.name)), el('td', {}, r.dept || ''),
      el('td', {}, r.start_date ? fmtD(r.start_date) + '/' + r.start_date.slice(0, 4) : el('span', { style: 'color:#bbb' }, 'chưa khai')),
      el('td', { class: 'c' }, n1(r.full), r.own != null ? el('div', { style: 'font-size:11px;color:#b45309' }, 'mức riêng') : ''),
      el('td', { class: 'c' }, n1(r.accrued)), el('td', { class: 'c' }, r.carry ? n1(r.carry) : '—'),
      el('td', { class: 'c' }, n1(r.used)), el('td', { class: 'c' }, r.pending ? n1(r.pending) : '—'),
      el('td', { class: 'c' }, el('b', { style: 'color:' + (r.remaining < 0 ? '#dc2626' : '#15803d') }, n1(r.remaining)))));
  };
  q.oninput = draw; draw();
  const rule = `Đang áp: ${n1(S.perYear)} ngày/năm` + (S.senAdd > 0 && S.senYears > 0 ? `, cứ đủ ${S.senYears} năm làm việc +${n1(S.senAdd)} ngày` : '')
    + (S.accrual === 'month' ? ', cộng dồn theo tháng' : ', cấp đủ đầu năm') + (S.prorate ? ', năm đầu vào làm tính theo số tháng' : '')
    + (S.carryMax > 0 ? `, phép dư chuyển sang năm sau tối đa ${n1(S.carryMax)} ngày` + (S.carryUntil ? ` (dùng đến hết tháng ${S.carryUntil})` : '') : ', phép dư không chuyển sang năm sau') + '. Đổi ở Cài đặt › Phép năm; ngày vào làm / mức phép riêng khai ở hồ sơ nhân viên.';
  setMain(head('Quỹ phép năm', ySel, back), el('div', { class: 'map-hint', style: 'margin:-6px 0 10px' }, rule),
    el('div', { style: 'margin-bottom:10px' }, q), el('div', { class: 'panel tbl-scroll' }, tbl));
}

// Ô chọn NHIỀU nhân viên dùng chung: lọc theo phòng ban (gồm cả bộ phận con) + tìm tên / mã;
// "Chọn tất cả" chọn đúng danh sách đang lọc (chọn 1 phòng ban + Chọn tất cả = cả phòng ban đó)
async function empMultiPicker(emps, maxH = 260) {
  if (!DEPARTMENTS.length) { try { DEPARTMENTS = (await api('/admin/departments')).rows || []; } catch {} }
  const picked = new Set();
  const NONE = '\u0000none';
  const kids = new Map();
  for (const d of DEPARTMENTS) { const k = d.parent_id || 0; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(d); }
  const namesUnder = (d) => [d.name, ...(kids.get(d.id) || []).flatMap(namesUnder)];
  const cntBy = new Map();
  for (const e of emps) { const k = e.department || NONE; cntBy.set(k, (cntBy.get(k) || 0) + 1); }
  const groups = new Map();   // giá trị ô chọn → tập tên phòng ban
  const opts = [el('option', { value: '' }, `Tất cả phòng ban (${emps.length})`)];
  for (const d of deptOrdered()) {
    const names = namesUnder(d), n = names.reduce((a, x) => a + (cntBy.get(x) || 0), 0);
    groups.set('d' + d.id, new Set(names));
    opts.push(el('option', { value: 'd' + d.id }, '\u00a0\u00a0\u00a0'.repeat(d.depth) + d.name + ` (${n})`));
  }
  const known = new Set(DEPARTMENTS.map((d) => d.name));
  for (const k of [...cntBy.keys()].filter((k) => k !== NONE && !known.has(k)).sort((a, b) => a.localeCompare(b, 'vi'))) {
    groups.set('o' + k, new Set([k])); opts.push(el('option', { value: 'o' + k }, `${k} (${cntBy.get(k)})`));
  }
  if (cntBy.has(NONE)) { groups.set('none', new Set([NONE])); opts.push(el('option', { value: 'none' }, `Chưa có phòng ban (${cntBy.get(NONE)})`)); }
  const deptSel = el('select', {}, ...opts);
  const q = el('input', { placeholder: 'Tìm tên / mã nhân viên' });
  const listBox = el('div', { style: `max-height:${maxH}px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:6px 10px` });
  const cnt = el('b', {});
  const draw = () => {
    const s = q.value.trim().toLowerCase(), g = groups.get(deptSel.value);
    const list = emps.filter((e) => (!g || g.has(e.department || NONE)) && (!s || (e.full_name || '').toLowerCase().includes(s) || String(e.code || '').toLowerCase().includes(s)));
    listBox.innerHTML = '';
    const all = el('input', { type: 'checkbox', style: 'width:auto', ...(list.length && list.every((e) => picked.has(e.id)) ? { checked: '' } : {}) });
    all.onchange = () => { for (const e of list) all.checked ? picked.add(e.id) : picked.delete(e.id); draw(); };
    listBox.append(el('label', { style: 'display:flex;gap:8px;align-items:center;font-weight:700;padding:4px 0;border-bottom:1px solid var(--line)' }, all,
      `Chọn tất cả (${list.length})` + (g ? ' — ' + deptSel.selectedOptions[0].textContent.trim().replace(/\s*\(\d+\)$/, '') : '')));
    for (const e of list) {
      const cb = el('input', { type: 'checkbox', style: 'width:auto', ...(picked.has(e.id) ? { checked: '' } : {}) });
      cb.onchange = () => { cb.checked ? picked.add(e.id) : picked.delete(e.id); cnt.textContent = `Đã chọn ${picked.size} người`; all.checked = list.every((x) => picked.has(x.id)); };
      listBox.append(el('label', { style: 'display:flex;gap:8px;align-items:center;padding:4px 0;cursor:pointer' }, cb, el('span', {}, e.full_name), el('span', { style: 'color:#9ca3af;font-size:12px' }, (e.code || '') + (e.department ? ' · ' + e.department : ''))));
    }
    if (!list.length) listBox.append(el('div', { class: 'empty' }, 'Không có nhân viên.'));
    cnt.textContent = `Đã chọn ${picked.size} người`;
  };
  q.oninput = draw; deptSel.onchange = draw; draw();
  const node = el('div', {},
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px' }, el('label', { style: 'margin:0' }, 'Nhân viên'), cnt),
    el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px' }, deptSel, q),
    el('div', { style: 'height:6px' }), listBox);
  return { node, picked };
}

/* ---------- CHẾ ĐỘ ƯU ĐÃI (thai sản, nuôi con nhỏ…) ---------- */
// Trong khoảng ngày áp dụng, nhân viên được đến muộn / về sớm số phút đã khai — không tính trễ/sớm, không trừ công.
const PRIV_PRESETS = [
  ['Mang thai — về sớm 60 phút', 'Mang thai', { early_min: 60 }],
  ['Nuôi con dưới 12 tháng — 30 phút giữa giờ + 30 phút cuối ca', 'Nuôi con nhỏ', { mid_out_min: 30, early_min: 30 }],
  ['Nuôi con dưới 12 tháng — đến muộn 30 + về sớm 30', 'Nuôi con nhỏ', { late_min: 30, early_min: 30 }],
  ['Hành kinh — nghỉ 30 phút (về sớm cuối ca)', 'Hành kinh', { early_min: 30 }],
];
const privTxt = (p) => [['Đến muộn', p.late_min], ['Về sớm trước nghỉ trưa', p.mid_out_min], ['Đến muộn sau nghỉ trưa', p.mid_in_min], ['Về sớm cuối ca', p.early_min]]
  .filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}'`).join(' · ');
// Tính lại công những ngày ĐÃ QUA bị ảnh hưởng (số trễ/sớm/công đổi ngay, không phải vào Tính công bấm lại)
async function privRecompute(ids, from, to) {
  const today = todayVN();
  const t = !to || to > today ? today : to;
  if (!ids.length || !from || from > t) return;
  try { await api(`/admin/recompute?ids=${ids.join(',')}&from=${from}&to=${t}`, { method: 'POST' }); }
  catch (e) { toast('Đã lưu, nhưng chưa tính lại được công: ' + e.message + ' — vào Tính công bấm "Tính lại".', 'err'); }
}
async function pagePrivileges() {
  const back = el('button', { class: 'btn ghost' }, '‹ Đơn từ');
  back.onclick = () => { _lvTab = 'list'; pageLeaves(); };
  const addBtn = el('button', { class: 'btn' }, '+ Thêm ưu đãi');
  addBtn.onclick = () => privModal(null);
  setMain(head('Chế độ ưu đãi', back, addBtn), loading());
  let d;
  try { d = await api('/leaves/privileges'); } catch (e) { return setMain(head('Chế độ ưu đãi', back, addBtn), el('div', { class: 'empty' }, e.message)); }
  const today = todayVN();
  const tbl = el('table', { class: 'data' });
  tbl.innerHTML = '<thead><tr><th>Nhân viên</th><th>Chế độ</th><th>Từ ngày</th><th>Đến ngày</th><th>Được ưu đãi</th><th>Ghi chú</th><th></th></tr></thead>';
  const tb = el('tbody'); tbl.append(tb);
  if (!d.rows.length) tb.append(el('tr', {}, el('td', { colspan: 7 }, el('div', { class: 'empty' }, 'Chưa khai chế độ ưu đãi nào. Bấm "+ Thêm ưu đãi".'))));
  const fd = (s) => s ? s.slice(8) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '';
  for (const r of d.rows) {
    const on = r.from_date <= today && (!r.to_date || r.to_date >= today);
    const del = btnSm('Xoá', async () => {
      if (!confirm(`Xoá chế độ "${r.kind}" của ${r.full_name}? Công những ngày đã qua sẽ được tính lại (không còn ưu đãi).`)) return;
      try { await api('/leaves/privileges/' + r.id, { method: 'DELETE' }); await privRecompute([r.employee_id], r.from_date, r.to_date); toast('Đã xoá', 'ok'); pagePrivileges(); } catch (e) { toast(e.message, 'err'); }
    }, 'ghost');
    tb.append(el('tr', {},
      el('td', {}, el('b', {}, r.full_name), el('div', { style: 'color:#999;font-size:12px' }, (r.code || '') + (r.department ? ' · ' + r.department : ''))),
      el('td', {}, r.kind, on ? el('div', {}, el('span', { class: 'pill ok' }, 'Đang áp dụng')) : ''),
      el('td', {}, fd(r.from_date)), el('td', {}, r.to_date ? fd(r.to_date) : el('span', { style: 'color:#9ca3af' }, 'không hạn')),
      el('td', {}, privTxt(r)), el('td', {}, r.note || '—'),
      el('td', {}, el('div', { style: 'display:flex;gap:6px' }, btnSm('Sửa', () => privModal(r)), del))));
  }
  setMain(head('Chế độ ưu đãi', back, addBtn),
    el('div', { class: 'map-hint', style: 'margin:-6px 0 10px' }, 'Theo Điều 137 Bộ luật Lao động 2019 (đều hưởng đủ lương): lao động nữ làm việc nặng nhọc, độc hại khi mang thai được giảm 1 giờ làm việc mỗi ngày, tới khi con đủ 12 tháng · nuôi con dưới 12 tháng được nghỉ 60 phút mỗi ngày · thời gian hành kinh được nghỉ 30 phút mỗi ngày. (Mang thai từ tháng thứ 7 — tháng thứ 6 ở vùng cao, vùng sâu, vùng xa, biên giới, hải đảo — và nuôi con dưới 12 tháng: không xếp làm đêm, làm thêm giờ, đi công tác xa.) Khai số phút ở đúng vị trí: đến muộn đầu ca, về sớm trước nghỉ trưa, đến muộn sau nghỉ trưa, về sớm cuối ca — phần nằm trong số phút này không tính trễ/sớm và không trừ công. Nghỉ hẳn thai sản thì thêm đơn loại "Thai sản" ở Đơn từ.'),
    el('div', { class: 'panel tbl-scroll' }, tbl));
}
async function privModal(row) {
  const edit = !!row;
  let emps = [];
  if (!edit) { try { emps = ((await api('/admin/employees')).rows || []).filter((e) => e.active !== 0 && e.role !== 'admin'); } catch (e) { return toast(e.message, 'err'); } }
  const pick = edit ? null : await empMultiPicker(emps, 200);
  const picked = pick ? pick.picked : new Set();
  const kindSel = el('select', {}, ...['Mang thai', 'Nuôi con nhỏ', 'Hành kinh', 'Khác'].map((k) => el('option', { value: k, ...(row && row.kind === k ? { selected: '' } : {}) }, k)));
  const fromI = el('input', { type: 'date', value: row ? row.from_date : todayVN() });
  const toI = el('input', { type: 'date', value: row ? row.to_date || '' : '' });
  const num = (v) => el('input', { type: 'number', min: 0, max: 480, step: 5, value: v || 0 });
  const lateI = num(row?.late_min), midOutI = num(row?.mid_out_min), midInI = num(row?.mid_in_min), earlyI = num(row?.early_min);
  const noteI = el('input', { placeholder: 'VD: dự sinh 12/2026, con sinh 05/03/2026…', value: row?.note || '' });
  const total = el('div', { style: 'font-size:13px;font-weight:600' });
  const sumUp = () => {
    const t = [lateI, midOutI, midInI, earlyI].reduce((a, i) => a + (parseInt(i.value, 10) || 0), 0);
    total.textContent = `Tổng ưu đãi: ${t} phút/ngày` + (t > 60 ? ' — luật quy định 60 phút, kiểm tra lại nếu không phải chế độ riêng của công ty' : '');
    total.style.color = t > 60 ? '#b45309' : '#15803d';
  };
  for (const i of [lateI, midOutI, midInI, earlyI]) i.oninput = sumUp;
  sumUp();
  const presets = el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px' }, ...PRIV_PRESETS.map(([label, kind, v]) => {
    const b = el('button', { class: 'btn ghost sm', type: 'button' }, label);
    b.onclick = () => { kindSel.value = kind; lateI.value = v.late_min || 0; midOutI.value = v.mid_out_min || 0; midInI.value = v.mid_in_min || 0; earlyI.value = v.early_min || 0; sumUp(); };
    return b;
  }));
  const row4 = (label, inp, hint) => el('div', { class: 'lv-row' }, el('div', { class: 'lv-lab' }, label),
    el('div', {}, el('div', { class: 'lv-ctl' }, inp, el('span', {}, 'phút')), el('div', { class: 'map-hint', style: 'margin-top:2px' }, hint)));
  const save = el('button', { class: 'btn' }, 'Lưu');
  save.onclick = async () => {
    if (!edit && !picked.size) return toast('Chọn ít nhất 1 nhân viên', 'err');
    if (toI.value && toI.value < fromI.value) return toast('Đến ngày phải sau từ ngày', 'err');
    const body = { kind: kindSel.value, from_date: fromI.value, to_date: toI.value, late_min: lateI.value, mid_out_min: midOutI.value, mid_in_min: midInI.value, early_min: earlyI.value, note: noteI.value };
    save.disabled = true;
    try {
      if (edit) {
        const r = await api('/leaves/privileges/' + row.id, { method: 'PUT', body });
        // tính lại cả khoảng cũ lẫn khoảng mới (ngày vừa bỏ khỏi ưu đãi cũng phải về như thường)
        const f = [r.old.from_date, fromI.value].sort()[0];
        const t = !r.old.to_date || !toI.value ? '' : [r.old.to_date, toI.value].sort()[1];
        await privRecompute([row.employee_id], f, t);
        toast('Đã lưu, đã tính lại công', 'ok');
      } else {
        const r = await api('/leaves/privileges', { method: 'POST', body: { ...body, employee_ids: [...picked] } });
        await privRecompute([...picked], fromI.value, toI.value);
        toast(`Đã thêm ưu đãi cho ${r.count} người`, 'ok');
      }
      closeModal(); _lvTab = 'priv'; pagePrivileges();
    } catch (e) { toast(e.message, 'err'); save.disabled = false; }
  };
  openModal(edit ? `Sửa chế độ ưu đãi — ${row.full_name}` : 'Thêm chế độ ưu đãi', [
    edit ? '' : pick.node,
    el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px' }, field('Chế độ', kindSel), field('Từ ngày', fromI), field('Đến ngày', toI)),
    el('div', { class: 'map-hint', style: 'margin-top:-6px' }, 'Bỏ trống "Đến ngày" = áp dụng tới khi xoá / sửa. Mang thai: đến ngày nghỉ sinh; nuôi con nhỏ: đến ngày con đủ 12 tháng.'),
    el('div', {}, el('label', {}, 'Mẫu nhanh'), presets),
    el('div', { class: 'lv-form' },
      row4('Đầu ca được đến muộn', lateI, 'VD ca 8:00, được 30 phút → vào 8:30 vẫn đúng giờ'),
      row4('Trước nghỉ trưa được về sớm', midOutI, 'Áp khi ca có khai giờ nghỉ cố định, hoặc ca chấm nhiều lần vào/ra'),
      row4('Sau nghỉ trưa được đến muộn', midInI, 'Áp khi ca có khai giờ nghỉ cố định, hoặc ca chấm nhiều lần vào/ra'),
      row4('Cuối ca được về sớm', earlyI, 'VD ca 17:00, được 60 phút → ra 16:00 vẫn đủ công')),
    total,
    field('Ghi chú', noteI),
  ], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Huỷ'), save]);
}

/* ---------- ĐĂNG KÝ LÀM BÙ (hoán đổi ngày): đi làm ngày nghỉ (VD chủ nhật) để nghỉ 1 ngày khác (VD thứ 2) ---------- */
let _swMonth = null;
const swDay = (d) => (d ? `${WD_VN[new Date(d + 'T12:00:00Z').getUTCDay()]} ${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
async function swapRecompute(pairs) {   // [[employee_id, ngày]] → tính lại công từng ngày (gom NV theo ngày)
  const byDay = new Map();
  for (const [id, d] of pairs) { if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(id); }
  for (const [d, ids] of byDay) for (let i = 0; i < ids.length; i += 200) await privRecompute(ids.slice(i, i + 200), d, d);
}
async function pageSwap() {
  const mI = el('input', { type: 'month', value: _swMonth || todayVN().slice(0, 7), style: 'width:auto' });
  const addBtn = el('button', { class: 'btn' }, '+ Đăng ký làm bù');
  const delBtn = el('button', { class: 'btn ghost', disabled: '' }, '✕ Xoá đã chọn');
  const box = el('div', { class: 'panel tbl-scroll' }, loading());
  setMain(head('Đăng ký làm bù', mI, delBtn, addBtn),
    el('div', { class: 'map-hint', style: 'margin:-6px 0 10px' }, 'Hoán đổi ngày làm việc: nhân viên đi làm vào ngày nghỉ (VD chủ nhật) để nghỉ một ngày khác (VD thứ 2). Ngày LÀM bù tính như ngày thường — 1 công, lương 100%, chỉ phần làm quá giờ ca mới là tăng ca. Ngày NGHỈ bù hiện ký hiệu NB trên bảng công, không bị tính vắng và không cộng thêm công (công đã tính ở ngày làm bù).'),
    box);
  const sel = new Set();
  const syncDel = () => { delBtn.disabled = !sel.size; delBtn.textContent = sel.size ? `✕ Xoá đã chọn (${sel.size})` : '✕ Xoá đã chọn'; };
  let rows = [];
  const load = async () => {
    _swMonth = mI.value || todayVN().slice(0, 7);
    const y = +_swMonth.slice(0, 4), m = +_swMonth.slice(5, 7);
    const to = `${_swMonth}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
    sel.clear(); syncDel();
    try { rows = (await api(`/admin/swap-days?from=${_swMonth}-01&to=${to}`)).rows || []; } catch (e) { box.replaceChildren(el('div', { class: 'empty' }, e.message)); return; }
    const today = todayVN();
    const all = el('input', { type: 'checkbox' });
    const tbl = el('table', { class: 'data' });
    const tb = el('tbody');
    tbl.append(el('thead', {}, el('tr', {}, el('th', { style: 'width:34px' }, all), ...['Nhân viên', 'Ngày làm bù', 'Ngày nghỉ bù', 'Tình trạng', 'Ghi chú', ''].map((t) => el('th', {}, t)))), tb);
    if (!rows.length) tb.append(el('tr', {}, el('td', { colspan: 7 }, el('div', { class: 'empty' }, 'Tháng này chưa có đăng ký làm bù. Bấm "+ Đăng ký làm bù".'))));
    const cbs = [];
    for (const r of rows) {
      const cb = el('input', { type: 'checkbox' }); cbs.push(cb);
      cb.onchange = () => { cb.checked ? sel.add(r.id) : sel.delete(r.id); all.checked = sel.size === rows.length; syncDel(); };
      const st = [];
      if (r.work_date <= today) st.push(r.worked ? el('span', { class: 'pill ok' }, `Đã đi làm · ${r.cong || 0} công`) : el('span', { class: 'pill warn' }, 'Chưa có giờ chấm ngày làm bù'));
      else st.push(el('span', { class: 'pill' }, 'Sắp tới'));
      if (r.off_worked) st.push(el('span', { class: 'pill bad', style: 'margin-left:4px' }, 'Có giờ chấm ngày nghỉ bù'));
      const del = btnSm('Xoá', () => remove([r]), 'ghost');
      tb.append(el('tr', {}, el('td', {}, cb),
        el('td', {}, el('b', {}, r.name), el('div', { style: 'color:#999;font-size:12px' }, (r.code || '') + (r.dept ? ' · ' + r.dept : ''))),
        el('td', {}, swDay(r.work_date)), el('td', {}, swDay(r.off_date)), el('td', {}, ...st), el('td', {}, r.note || '—'), el('td', {}, del)));
    }
    all.onchange = () => { sel.clear(); cbs.forEach((c, i) => { c.checked = all.checked; if (all.checked) sel.add(rows[i].id); }); syncDel(); };
    box.replaceChildren(tbl);
  };
  const remove = async (list) => {
    if (!list.length) return;
    if (!confirm(list.length === 1 ? `Xoá đăng ký làm bù ${swDay(list[0].work_date)} của ${list[0].name}?\nNgày đó sẽ tính lại như ngày nghỉ (tăng ca ngày nghỉ), ngày nghỉ bù ${swDay(list[0].off_date)} không còn ký hiệu NB.` : `Xoá ${list.length} đăng ký làm bù đã chọn? Công các ngày làm bù sẽ được tính lại.`)) return;
    try {
      const r = await api('/admin/swap-days/delete', { method: 'POST', body: { ids: list.map((x) => x.id) } });
      await swapRecompute(r.rows.map((x) => [x.employee_id, x.work_date]));
      toast(`Đã xoá ${r.count} đăng ký`, 'ok'); load();
    } catch (e) { toast(e.message, 'err'); }
  };
  delBtn.onclick = () => remove(rows.filter((r) => sel.has(r.id)));
  addBtn.onclick = () => swapAddModal(load);
  mI.onchange = load;
  load();
}
async function swapAddModal(done) {
  let emps = [];
  try { emps = ((await api('/admin/employees')).rows || []).filter((e) => e.active !== 0 && e.role !== 'admin'); } catch (e) { return toast(e.message, 'err'); }
  const pick = await empMultiPicker(emps), picked = pick.picked;
  const workI = el('input', { type: 'date' }), offI = el('input', { type: 'date' });
  const noteI = el('input', { placeholder: 'Ghi chú (tuỳ chọn), VD: làm bù để nghỉ thứ 2 sau lễ' });
  const info = el('div', { class: 'map-hint' });
  const wkSet = new Set(String(SETTINGS.weekend_days ?? '7').split(',').map((x) => +x.trim()));
  const isWk = (d) => { const w = new Date(d + 'T12:00:00Z').getUTCDay(); return wkSet.has(w === 0 ? 7 : w); };
  const sync = () => {
    const a = workI.value, b = offI.value, parts = [];
    if (a) parts.push(`Làm bù: ${swDay(a)}` + (isWk(a) ? '' : ' — ngày này vốn là ngày làm việc bình thường, đăng ký không làm đổi cách tính công'));
    if (b) parts.push(`Nghỉ bù: ${swDay(b)}` + (isWk(b) ? ' — ngày này vốn đã là ngày nghỉ hằng tuần' : ''));
    info.textContent = parts.join('  ·  ');
  };
  workI.onchange = sync; offI.onchange = sync;
  const save = el('button', { class: 'btn' }, 'Lưu đăng ký');
  save.onclick = async () => {
    if (!picked.size) return toast('Chọn ít nhất 1 nhân viên', 'err');
    if (!workI.value || !offI.value) return toast('Chọn ngày làm bù và ngày nghỉ bù', 'err');
    if (workI.value === offI.value) return toast('Ngày làm bù và ngày nghỉ bù phải khác nhau', 'err');
    save.disabled = true;
    try {
      const r = await api('/admin/swap-days', { method: 'POST', body: { employee_ids: [...picked], work_date: workI.value, off_date: offI.value, note: noteI.value } });
      await swapRecompute(r.employee_ids.map((id) => [id, workI.value]));
      if (r.skipped.length) alert(`Đã đăng ký ${r.count} người. Bỏ qua ${r.skipped.length} người:\n` + r.skipped.slice(0, 20).join('\n') + (r.skipped.length > 20 ? `\n… và ${r.skipped.length - 20} người khác` : ''));
      else toast(`Đã đăng ký làm bù cho ${r.count} người`, 'ok');
      closeModal(); _swMonth = workI.value.slice(0, 7); pageSwap();
    } catch (e) { toast(e.message, 'err'); save.disabled = false; }
  };
  openModal('Đăng ký làm bù', [
    pick.node,
    el('div', { class: 'two-col' }, field('Ngày đi LÀM bù (tính như ngày thường)', workI), field('Ngày được NGHỈ bù (ký hiệu NB)', offI)),
    info,
    field('Ghi chú', noteI),
  ], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Huỷ'), save]);
}

/* ---------- LÝ DO NGHỈ tự khai báo (ngoài các loại có sẵn) ---------- */
async function leaveTypesModal() {
  const box = el('div', {}, loading());
  const nameI = el('input', { placeholder: 'VD: Nghỉ ốm, Nghỉ việc riêng, Nghỉ chờ việc…', maxlength: 60 });
  const symI = el('input', { placeholder: 'VD: NO', maxlength: 4, style: 'text-transform:uppercase' });
  const paidC = el('input', { type: 'checkbox' }), quotaC = el('input', { type: 'checkbox' });
  const addB = el('button', { class: 'btn' }, '+ Thêm lý do nghỉ');
  const cancelB = el('button', { class: 'btn ghost', style: 'display:none' }, 'Thôi sửa');
  let editing = null;
  const reset = () => { editing = null; nameI.value = ''; symI.value = ''; paidC.checked = false; quotaC.checked = false; addB.textContent = '+ Thêm lý do nghỉ'; cancelB.style.display = 'none'; };
  cancelB.onclick = reset;
  const yn = (v) => (v ? '✔' : '—');
  const draw = async () => {
    let d;
    try { d = await api('/leaves/types/all'); } catch (e) { box.replaceChildren(el('div', { class: 'empty' }, e.message)); return; }
    const tbl = el('table', { class: 'data', style: 'width:100%' }), tb = el('tbody');
    tbl.append(el('thead', {}, el('tr', {}, ...['Lý do nghỉ', 'Ký hiệu', 'Lương', 'Trừ phép', ''].map((t) => el('th', {}, t)))), tb);
    for (const t of d.builtin) tb.append(el('tr', {}, el('td', { style: 'white-space:nowrap' }, t.type, el('span', { style: 'color:#9ca3af;font-size:12px' }, t.system ? ' · tự sinh khi đăng ký làm bù' : ' · có sẵn')), el('td', {}, el('b', {}, t.sym)), el('td', {}, yn(t.paid)), el('td', {}, yn(t.quota)), el('td', {}, '')));
    for (const t of d.custom) {
      const edit = btnSm('Sửa', () => { editing = t; nameI.value = t.type; symI.value = t.sym; paidC.checked = t.paid; quotaC.checked = t.quota; addB.textContent = 'Lưu thay đổi'; cancelB.style.display = ''; nameI.focus(); });
      const tog = t.active ? null : btnSm('Dùng lại', async () => { try { await api('/leaves/types/' + t.id, { method: 'PUT', body: { name: t.type, sym: t.sym, paid: t.paid, quota: t.quota, active: true } }); draw(); } catch (e) { toast(e.message, 'err'); } }, 'ghost');
      const del = btnSm(t.used ? 'Ẩn' : 'Xoá', async () => {
        if (!confirm(t.used ? `"${t.type}" đã có ${t.used} đơn dùng nên chỉ ẨN (không chọn được nữa, đơn cũ giữ nguyên). Ẩn?` : `Xoá lý do nghỉ "${t.type}"?`)) return;
        try { await api('/leaves/types/' + t.id, { method: 'DELETE' }); if (editing && editing.id === t.id) reset(); draw(); } catch (e) { toast(e.message, 'err'); }
      }, 'ghost');
      tb.append(el('tr', { style: t.active ? '' : 'opacity:.55' }, el('td', { style: 'white-space:nowrap' }, el('b', {}, t.type), t.active ? '' : el('span', { class: 'pill', style: 'margin-left:6px' }, 'Đã ẩn'), t.used ? el('span', { style: 'color:#9ca3af;font-size:12px' }, ` · ${t.used} đơn`) : ''),
        el('td', {}, el('b', {}, t.sym)), el('td', {}, yn(t.paid)), el('td', {}, yn(t.quota)),
        el('td', {}, el('div', { style: 'display:flex;gap:6px;justify-content:flex-end' }, edit, tog, t.active ? del : null))));
    }
    box.replaceChildren(el('div', { class: 'tbl-scroll', style: 'max-height:300px;overflow:auto' }, tbl));
  };
  addB.onclick = async () => {
    const body = { name: nameI.value, sym: symI.value, paid: paidC.checked, quota: quotaC.checked };
    if (!body.name.trim()) return toast('Nhập tên lý do nghỉ', 'err');
    if (!body.sym.trim()) return toast('Nhập ký hiệu hiện trên bảng công', 'err');
    try {
      if (editing) await api('/leaves/types/' + editing.id, { method: 'PUT', body });
      else await api('/leaves/types', { method: 'POST', body });
      toast(editing ? 'Đã lưu' : 'Đã thêm lý do nghỉ', 'ok'); reset(); draw();
    } catch (e) { toast(e.message, 'err'); }
  };
  openModal('Lý do nghỉ', [
    el('div', { class: 'map-hint' }, 'Tự khai thêm lý do nghỉ của công ty. Lý do mới chọn được khi lập đơn (web + điện thoại), hiện đúng ký hiệu trên bảng công và có cột riêng trong báo cáo. "Có lương" = ngày nghỉ được trả lương như ngày công; "Trừ phép năm" = trừ vào quỹ phép năm của nhân viên.'),
    box,
    el('div', { style: 'display:grid;grid-template-columns:minmax(0,1fr) 110px;gap:12px;margin-top:6px' }, field('Tên lý do nghỉ', nameI), field('Ký hiệu', symI)),
    el('div', { style: 'display:flex;gap:22px;flex-wrap:wrap' }, el('label', { class: 'lv-chk' }, paidC, el('span', {}, 'Có lương')), el('label', { class: 'lv-chk' }, quotaC, el('span', {}, 'Trừ phép năm'))),
    el('div', { style: 'display:flex;gap:8px' }, addB, cancelB),
  ], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Đóng')]);
  draw();
}

// Quản lý khai nghỉ TRỰC TIẾP cho 1 hoặc nhiều nhân viên (đơn tự duyệt)
async function leaveAddModal() {
  let emps = [];
  try { emps = ((await api('/admin/employees')).rows || []).filter((e) => e.active !== 0 && e.role !== 'admin'); } catch (e) { return toast(e.message, 'err'); }
  const pick = await empMultiPicker(emps), picked = pick.picked;
  let types = [];
  try { types = (await api('/leaves/types')).rows || []; } catch {}
  const typeSel = el('select', {}, ...types.map((t) => el('option', { value: t.type }, t.label || t.type)));
  const fromI = el('input', { type: 'date', value: todayVN() }), toI = el('input', { type: 'date', value: todayVN() });
  const halfSel = el('select', {}, el('option', { value: '' }, 'Cả ngày'), el('option', { value: 'sang' }, 'Nửa ngày sáng'), el('option', { value: 'chieu' }, 'Nửa ngày chiều'));
  const syncHalf = () => { const one = fromI.value && fromI.value === toI.value; halfSel.disabled = !one; if (!one) halfSel.value = ''; };
  fromI.onchange = () => { if (!toI.value || toI.value < fromI.value) toI.value = fromI.value; syncHalf(); };
  toI.onchange = syncHalf;
  const reasonI = el('input', { placeholder: 'Lý do (tuỳ chọn)' });
  const save = el('button', { class: 'btn' }, 'Lưu (tự duyệt)');
  save.onclick = async () => {
    if (!picked.size) return toast('Chọn ít nhất 1 nhân viên', 'err');
    if (!fromI.value || !toI.value || toI.value < fromI.value) return toast('Chọn từ ngày / đến ngày (đến ngày không trước từ ngày)', 'err');
    save.disabled = true;
    const body = { employee_ids: [...picked], type: typeSel.value, from_date: fromI.value, to_date: toI.value, half: halfSel.value, reason: reasonI.value };
    try {
      let r;
      try { r = await api('/leaves/admin', { method: 'POST', body }); }
      catch (e) { if (!(e.data && e.data.canForce) || !confirm(e.message + '\n\nVẫn lưu (nghỉ vượt phép)?')) throw e; r = await api('/leaves/admin', { method: 'POST', body: { ...body, force: true } }); }
      if (body.half) await privRecompute(body.employee_ids, body.from_date, body.to_date);   // nửa ngày nghỉ: bỏ trễ / sớm của buổi nghỉ
      toast(`Đã thêm ${r.count} đơn (đã duyệt)`, 'ok'); closeModal(); pageLeaves();
    } catch (e) { toast(e.message, 'err'); save.disabled = false; }
  };
  openModal('Thêm đơn nghỉ cho nhân viên', [
    pick.node,
    el('div', { class: 'two-col' }, field('Loại đơn', typeSel), field('Lý do', reasonI)),
    el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px' }, field('Từ ngày', fromI), field('Đến ngày', toI), field('Thời gian', halfSel)),
    el('div', { class: 'map-hint' }, 'Đơn do quản lý thêm được duyệt luôn, hiện ngay ở Tính công và báo cáo. Nghỉ phép năm trừ vào quỹ phép; nghỉ nửa ngày chỉ chọn được khi từ ngày = đến ngày.'),
  ], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Huỷ'), save]);
}

async function review(r, action) {
  let note = '';
  if (action === 'reject') { note = prompt('Lý do từ chối (tuỳ chọn):') ?? ''; }
  const after = async () => { if (action === 'approve' && r.half) await privRecompute([r.employee_id], r.from_date, r.to_date); };   // nửa ngày nghỉ: bỏ trễ / sớm buổi nghỉ
  try { await api('/leaves/' + r.id + '/review', { method: 'POST', body: { action, note } }); await after(); toast('Đã cập nhật', 'ok'); pageLeaves(); }
  catch (e) {
    if (e.data && e.data.canForce && confirm(e.message + '\n\nVẫn duyệt (nghỉ vượt phép)?')) {
      try { await api('/leaves/' + r.id + '/review', { method: 'POST', body: { action, note, force: true } }); await after(); toast('Đã duyệt', 'ok'); pageLeaves(); } catch (e2) { toast(e2.message, 'err'); }
    } else toast(e.message, 'err');
  }
}
const fmtD = (d) => d ? d.slice(8) + '/' + d.slice(5, 7) : '—';

/* ---------- 4b) DUYỆT NHÂN VIÊN CHỌN CA ---------- */
async function pageShiftReq() {
  const sel = el('select', { id: 'sc-filter' },
    el('option', { value: 'pending' }, 'Chờ duyệt'),
    el('option', { value: '' }, 'Tất cả'),
    el('option', { value: 'approved' }, 'Đã duyệt'),
    el('option', { value: 'rejected' }, 'Từ chối'));
  const note = el('div', { class: 'map-hint', style: 'margin-bottom:10px' },
    SETTINGS.self_shift_approve === '0'
      ? 'Đang ở chế độ TỰ ÁP DỤNG: nhân viên chọn ca là vào lịch ngay (mục này chỉ để xem lại). Đổi ở Cài đặt nếu muốn phải duyệt.'
      : 'Duyệt để áp ca nhân viên đăng ký vào lịch phân ca ngày đó (đè phân ca cũ nếu có).');
  setMain(head('Duyệt chọn ca', sel), note, loading());
  const load = async () => {
    const status = $('#sc-filter').value;
    const { rows } = await api('/shift-requests' + (status ? '?status=' + status : ''));
    const tbl = el('table', { class: 'data' });
    tbl.innerHTML = `<thead><tr><th>Nhân viên</th><th>Ngày</th><th>Ca đăng ký</th><th>Trạng thái</th><th></th></tr></thead>`;
    const tb = el('tbody');
    if (!rows.length) tb.append(el('tr', {}, el('td', { colspan: 5 }, el('div', { class: 'empty' }, 'Không có đăng ký.'))));
    for (const r of rows) {
      const st = { pending: ['warn', 'Chờ duyệt'], approved: ['ok', 'Đã duyệt'], rejected: ['bad', 'Từ chối'] }[r.status];
      const ca = r.is_off ? '🛌 Xin nghỉ' : `${r.shift_name || 'Ca'}${r.start_time ? ` (${r.start_time}–${r.end_time})` : ''}`;
      const act = r.status === 'pending' ? el('div', { style: 'display:flex;gap:6px' },
        btnSm('Duyệt', () => reviewShiftReq(r, 'approve'), 'green'),
        btnSm('Từ chối', () => reviewShiftReq(r, 'reject'), 'ghost')) : (r.review_note || '—');
      tb.append(el('tr', {},
        el('td', {}, el('b', {}, r.full_name), el('div', { style: 'color:#999;font-size:12px' }, r.code + ' · ' + (r.department || ''))),
        el('td', {}, fmtD(r.work_date)),
        el('td', {}, ca),
        el('td', {}, el('span', { class: 'pill ' + st[0] }, st[1])),
        el('td', {}, act),
      ));
    }
    tbl.append(tb);
    setMain(head('Duyệt chọn ca', sel), note, el('div', { class: 'panel tbl-scroll' }, tbl));
    $('#sc-filter').value = status; $('#sc-filter').onchange = load;
  };
  sel.onchange = load; load();
}
async function reviewShiftReq(r, action) {
  let note = '';
  if (action === 'reject') { note = prompt('Lý do từ chối (tuỳ chọn):') ?? ''; }
  try {
    const x = await api('/shift-requests/' + r.id + '/review', { method: 'POST', body: { action, note } });
    // duyệt xong máy chủ tự tính lại công ngày đó theo ca mới; tính lại lỗi thì nhắc bấm tay
    if (x && x.recomputed === false) toast('Đã duyệt, nhưng chưa tính lại được công ngày ' + fmtD(r.work_date) + ' — vào Tính công bấm "Tính lại".', 'err');
    else toast('Đã cập nhật', 'ok');
    pageShiftReq();
  }
  catch (e) { toast(e.message, 'err'); pageShiftReq(); }
}

