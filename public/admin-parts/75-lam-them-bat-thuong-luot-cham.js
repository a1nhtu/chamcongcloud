/* ---------- ĐĂNG KÝ LÀM THÊM ----------
 * Trái: cây phòng ban · Phải: lưới NV × ngày, mỗi ô = số phút ĐĂNG KÝ làm thêm (số nhỏ bên cạnh = làm thêm THỰC TẾ).
 * Làm quá đăng ký → chỉ tính theo đăng ký; làm thiếu → tính thực tế. Lưu xong áp ngay vào công, không cần "Tính lại".
 * Sửa: bấm ô gõ số (Enter lưu, để trống = xoá đăng ký) · dán cả khối số copy từ Excel · áp nhanh nhiều NV × nhiều ngày. */
const _or = { dept: '', q: '', from: null, to: null, picked: new Set(), bulk: null };
async function pageOtReg() {
  const T = '⏰ Đăng ký làm thêm';
  setMain(head(T), loading());
  if (!DEPARTMENTS.length) { try { DEPARTMENTS = (await api('/admin/departments')).rows || []; } catch {} }
  const today = todayVN();
  const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const nDays = (f, t) => Math.round((Date.parse(t) - Date.parse(f)) / 86400000) + 1;
  const WDS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const wdOf = (d) => new Date(d + 'T12:00:00Z').getUTCDay();
  if (!_or.from) { _or.from = addDays(today, -((wdOf(today) + 6) % 7)); _or.to = addDays(_or.from, 6); }   // mặc định: tuần này (T2 → CN)
  let data;
  try { data = await api(`/admin/ot-reg?from=${_or.from}&to=${_or.to}`); }
  catch (e) { return setMain(head(T), el('div', { class: 'empty' }, e.message)); }
  const reg = new Map(data.cells.map(([e, d, m]) => [e + '|' + d, m]));
  const act = new Map(data.actual.map(([e, d, m]) => [e + '|' + d, m]));
  const emps = data.emps;

  // ----- cây phòng ban (gồm bộ phận con) -----
  const NONE = '\u0000none';
  const kids = new Map();
  for (const d of DEPARTMENTS) { const k = d.parent_id || 0; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(d); }
  const namesUnder = (d) => [d.name, ...(kids.get(d.id) || []).flatMap(namesUnder)];
  const cntBy = new Map(); for (const e of emps) { const k = e.department || NONE; cntBy.set(k, (cntBy.get(k) || 0) + 1); }
  const groups = new Map([['', null]]);
  const tree = el('div', { class: 'ft-tree' });
  const treeItem = (key, label, depth, n) => {
    const b = el('button', { class: 'ft-node' + (_or.dept === key ? ' on' : ''), style: `padding-left:${10 + depth * 14}px` }, el('span', {}, label), el('small', {}, String(n)));
    b.onclick = () => { _or.dept = key; tree.querySelectorAll('.ft-node').forEach((x) => x.classList.toggle('on', x === b)); draw(); };
    tree.append(b); return b;
  };
  treeItem('', '🏢 Tất cả nhân viên', 0, emps.length);
  const tItems = [];
  for (const d of deptOrdered()) { const names = namesUnder(d); const n = names.reduce((a, x) => a + (cntBy.get(x) || 0), 0); if (!n) continue; groups.set('d' + d.id, new Set(names)); tItems.push({ key: d.name, depth: d.depth, el: treeItem('d' + d.id, d.name, d.depth + 1, n) }); }
  collapseTree(tItems, [(DEPARTMENTS.find((x) => 'd' + x.id === _or.dept) || {}).name]);
  const known = new Set(DEPARTMENTS.map((d) => d.name));
  for (const k of [...cntBy.keys()].filter((k) => k !== NONE && !known.has(k))) { groups.set('o' + k, new Set([k])); treeItem('o' + k, k, 1, cntBy.get(k)); }
  if (cntBy.has(NONE)) { groups.set('none', new Set([NONE])); treeItem('none', 'Chưa có phòng ban', 1, cntBy.get(NONE)); }

  // ----- khoảng ngày (tối đa 31 ngày) -----
  const fromI = el('input', { type: 'date', value: _or.from, style: 'width:auto;margin:0' });
  const toI = el('input', { type: 'date', value: _or.to, style: 'width:auto;margin:0' });
  const setRange = (f, t) => {
    if (t < f) t = f;
    if (nDays(f, t) > 31) { t = addDays(f, 30); toast('Xem tối đa 31 ngày một lần', 'err'); }
    _or.from = f; _or.to = t; if (_or.bulk) { _or.bulk.from = f; _or.bulk.to = t; }
    pageOtReg();
  };
  const dApply = dateApply(fromI, toI, () => setRange(fromI.value, toI.value));
  const span = nDays(_or.from, _or.to);
  const prev = el('button', { class: 'btn ghost sm', title: 'Lùi' }, '◀'), next = el('button', { class: 'btn ghost sm', title: 'Tới' }, '▶');
  prev.onclick = () => setRange(addDays(_or.from, -span), addDays(_or.to, -span));
  next.onclick = () => setRange(addDays(_or.from, span), addDays(_or.to, span));
  const weekB = el('button', { class: 'btn ghost sm' }, 'Tuần này'), monthB = el('button', { class: 'btn ghost sm' }, 'Cả tháng');
  weekB.onclick = () => { const f = addDays(today, -((wdOf(today) + 6) % 7)); setRange(f, addDays(f, 6)); };
  monthB.onclick = () => { const ds = monthDaysArr(_or.from.slice(0, 7)); setRange(ds[0], ds[ds.length - 1]); };
  const q = el('input', { placeholder: 'Tìm tên / mã NV', value: _or.q, style: 'margin:0;width:180px' });
  q.oninput = () => { _or.q = q.value; draw(); };

  // ----- quy tắc: ngày không đăng ký -----
  const reqCb = el('input', { type: 'checkbox', style: 'width:auto;margin:0', ...(data.required ? { checked: '' } : {}), ...(hasPerm('settings') ? {} : { disabled: '' }) });
  reqCb.onchange = async () => {
    const on = reqCb.checked;
    if (!confirm(on ? 'BẬT "Phải đăng ký mới tính tăng ca"?\nNgày nào KHÔNG đăng ký làm thêm thì tăng ca = 0 (áp cho cả dữ liệu đã có).'
      : 'TẮT "Phải đăng ký mới tính tăng ca"?\nNgày không đăng ký sẽ tính tăng ca theo thực tế như trước.')) { reqCb.checked = !on; return; }
    try { const r = await api('/admin/ot-reg/settings', { method: 'PUT', body: { required: on } }); toast(`Đã ${on ? 'bật' : 'tắt'} — cập nhật ${r.changed.toLocaleString('vi')} dòng công`, 'ok'); pageOtReg(); }
    catch (e) { reqCb.checked = !on; toast(e.message, 'err'); }
  };
  const rulePanel = el('div', { class: 'panel al-def or-rule' },
    el('label', { title: hasPerm('settings') ? '' : 'Cần quyền Cài đặt để đổi' }, reqCb, 'Phải đăng ký mới tính tăng ca (ngày không đăng ký → tăng ca = 0)'),
    el('div', { class: 'map-hint', style: 'flex-basis:100%;margin:0' }, 'Quy tắc: làm thêm NHIỀU hơn số phút đăng ký → chỉ tính đúng số phút đăng ký · làm ÍT hơn → tính theo thực tế · đăng ký 0 = không cho làm thêm ngày đó. '
      + 'Không tích ô trên: ngày chưa đăng ký vẫn tính tăng ca thực tế. Lưu đăng ký là áp ngay vào công, không cần bấm Tính lại. Ai làm quá đăng ký xem ở menu "🚨 Chấm công bất thường".'));

  // ----- áp nhanh -----
  const B = _or.bulk || { min: '', from: _or.from, to: _or.to, sun: true, sat: false };
  const bMin = el('input', { type: 'number', min: 0, max: 1440, step: 5, placeholder: 'số phút', title: 'Để trống = xoá đăng ký', value: B.min, style: 'width:100px;margin:0' });
  const bFrom = el('input', { type: 'date', value: B.from, style: 'width:auto;margin:0' }), bTo = el('input', { type: 'date', value: B.to, style: 'width:auto;margin:0' });
  const bSun = el('input', { type: 'checkbox', style: 'width:auto;margin:0', ...(B.sun ? { checked: '' } : {}) }), bSat = el('input', { type: 'checkbox', style: 'width:auto;margin:0', ...(B.sat ? { checked: '' } : {}) });
  const saveBulk = () => { _or.bulk = { min: bMin.value, from: bFrom.value, to: bTo.value, sun: bSun.checked, sat: bSat.checked }; };
  for (const x of [bMin, bFrom, bTo, bSun, bSat]) { x.addEventListener('change', saveBulk); x.addEventListener('input', saveBulk); }
  const bScope = el('select', { style: 'width:auto;margin:0' }, el('option', { value: 'list' }, 'Tất cả NV đang lọc'), el('option', { value: 'picked' }, 'Chỉ NV đã tích'));
  const bGo = el('button', { class: 'btn sm' }, 'Áp đăng ký');
  bGo.onclick = async () => {
    const ids = bScope.value === 'picked' ? [..._or.picked] : visible().map((e) => e.id);
    if (!ids.length) return toast(bScope.value === 'picked' ? 'Tích chọn nhân viên ở lưới trước' : 'Không có nhân viên nào', 'err');
    if (!bFrom.value || !bTo.value || bTo.value < bFrom.value) return toast('Khoảng ngày áp không hợp lệ', 'err');
    const what = bMin.value === '' ? 'XOÁ đăng ký làm thêm' : `Đăng ký làm thêm ${bMin.value} phút / ngày`;
    if (!confirm(`${what}\nTừ ${bFrom.value} đến ${bTo.value} cho ${ids.length} nhân viên?`)) return;
    try {
      const r = await api('/admin/ot-reg/apply', { method: 'POST', body: { minutes: bMin.value, employee_ids: ids, from: bFrom.value, to: bTo.value, skip_sun: bSun.checked, skip_sat: bSat.checked } });
      toast(`Đã cập nhật ${r.cells.toLocaleString('vi')} ô (${r.people} NV × ${r.days} ngày)`, 'ok'); pageOtReg();
    } catch (e) { toast(e.message, 'err'); }
  };
  const applyPanel = el('div', { class: 'panel al-apply' },
    bMin, el('span', { class: 'muted' }, 'phút (trống = xoá đăng ký) · từ'), bFrom, el('span', { class: 'muted' }, 'đến'), bTo,
    el('label', {}, bSun, 'Bỏ qua chủ nhật'), el('label', {}, bSat, 'Bỏ qua thứ 7'), bScope, bGo);
  for (const k of ['fold_or_rule', 'fold_or_apply']) { try { if (localStorage.getItem(k) == null) localStorage.setItem(k, '1'); } catch {} }   // 2 khung trên mặc định GỌN
  foldPanel(rulePanel, 'or_rule', 'Quy tắc tính', () => (data.required ? 'Phải đăng ký mới tính tăng ca' : 'Ngày không đăng ký: tính tăng ca thực tế') + ' · làm quá đăng ký chỉ tính theo đăng ký');
  foldPanel(applyPanel, 'or_apply', 'Áp nhanh', () => 'Đăng ký 1 số phút cho nhiều NV × nhiều ngày — bấm để mở');

  // ----- lưới NV × ngày -----
  const visible = () => {
    const g = groups.get(_or.dept), s = _or.q.trim().toLowerCase();
    return emps.filter((e) => (!g || g.has(e.department || NONE)) && (!s || (e.full_name || '').toLowerCase().includes(s) || String(e.code || '').toLowerCase().includes(s)));
  };
  const days = []; for (let d = _or.from; d <= _or.to; d = addDays(d, 1)) days.push(d);
  const allChk = el('input', { type: 'checkbox', style: 'width:auto;margin:0' });
  const thead = el('thead', {}, el('tr', {}, el('th', {}, allChk), el('th', {}, 'Mã NV'), el('th', {}, 'Họ tên'), el('th', {}, 'Bộ phận'),
    ...days.map((d) => el('th', { class: 'al-h' + (wdOf(d) === 0 ? ' sun' : '') + (d === today ? ' today' : '') }, d.slice(8) + '/' + d.slice(5, 7), el('br'), el('small', {}, WDS[wdOf(d)]))), el('th', { title: 'Tổng số phút đăng ký trong khoảng đang xem' }, 'Tổng ĐK')));
  const tbody = el('tbody');
  const tbl = el('table', { class: 'data al-grid or-grid' }, thead, tbody);
  const total = el('span', { class: 'muted' });
  let list = [];
  // vẽ 1 ô: số đăng ký (đậm) + số thực tế (nhỏ); đỏ = làm quá đăng ký, vàng = làm thiếu, xám = có làm thêm mà chưa đăng ký
  const paint = (td) => {
    const { e, d } = td._k, k = e.id + '|' + d, r = reg.get(k), a = act.get(k) || 0;
    let cls = 'al-c or-c' + (wdOf(d) === 0 ? ' sun' : ''), tip = '';
    if (r != null) {
      cls += ' has';
      if (a > r) { cls += ' over'; tip = `Đăng ký ${r}' · thực tế ${a}' → vượt ${a - r}', chỉ tính ${r}'`; }
      else if (a < r && d < today) { cls += ' under'; tip = `Đăng ký ${r}' · thực tế ${a}' → tính ${a}'`; }
      else tip = `Đăng ký ${r}'` + (a ? ` · thực tế ${a}'` : '');
    } else if (a) { cls += ' noreg'; tip = `Chưa đăng ký · làm thêm thực tế ${a}'` + (data.required ? ' → KHÔNG được tính' : ' → tính thực tế'); }
    td.className = cls; td.title = tip;
    td.replaceChildren(r != null ? el('b', {}, String(r)) : '', a ? el('small', {}, String(a)) : '');
  };
  const sumOf = (e) => { let s = 0; for (const d of days) s += reg.get(e.id + '|' + d) || 0; return s; };
  const mkRow = (e) => {
    const cb = el('input', { type: 'checkbox', style: 'width:auto;margin:0', ...(_or.picked.has(e.id) ? { checked: '' } : {}) });
    cb.onchange = () => { cb.checked ? _or.picked.add(e.id) : _or.picked.delete(e.id); updTotal(); };
    const tr = el('tr', {}, el('td', {}, cb), el('td', {}, e.code || ''), el('td', {}, el('b', {}, e.full_name)), el('td', { class: 'muted al-dept', title: e.department || '' }, e.department || '—'));
    for (const d of days) { const td = el('td', { tabindex: 0 }); td._k = { e, d }; paint(td); tr.append(td); }
    const s = sumOf(e); tr.append(el('td', { class: 'or-sum' }, s ? String(s) : ''));
    tr._e = e;
    return tr;
  };
  const draw = () => {
    list = visible();
    tbody.replaceChildren();
    if (!list.length) tbody.append(el('tr', {}, el('td', { colspan: 5 + days.length }, el('div', { class: 'empty' }, 'Không có nhân viên.'))));
    const start = lazyRows(tbody, list, mkRow, 5 + days.length);
    if (tbl.isConnected) start(tbl.parentElement);
    updTotal();
  };
  function updTotal() {
    const n = list.filter((e) => _or.picked.has(e.id)).length;
    allChk.checked = list.length > 0 && n === list.length;
    allChk.indeterminate = n > 0 && n < list.length;
    let mins = 0, cells = 0; for (const e of list) for (const d of days) { const v = reg.get(e.id + '|' + d); if (v != null) { cells++; mins += v; } }
    total.textContent = `${list.length.toLocaleString('vi')} nhân viên · ${n} đã tích` + (_or.picked.size > n ? ` (thêm ${_or.picked.size - n} ở bộ phận khác)` : '') + ` · đã đăng ký ${cells.toLocaleString('vi')} ô = ${(Math.round(mins / 6) / 10).toLocaleString('vi')} giờ`;
    bScope.value = _or.picked.size ? 'picked' : 'list';
  }
  allChk.onchange = () => { for (const e of list) allChk.checked ? _or.picked.add(e.id) : _or.picked.delete(e.id); draw(); };
  // lưu nhiều ô 1 lần rồi vẽ lại đúng các ô đó (không vẽ lại cả lưới → không mất chỗ đang cuộn)
  const rowOf = (e) => [...tbody.children].find((tr) => tr._e === e);
  const repaint = (ids) => {
    for (const tr of tbody.children) {
      if (!tr._e || !ids.has(tr._e.id)) continue;
      for (const td of tr.children) if (td._k) paint(td);
      const s = sumOf(tr._e); tr.lastElementChild.textContent = s ? String(s) : '';
    }
    updTotal();
  };
  const saveCells = async (changes) => {
    if (!changes.length) return;
    try {
      await api('/admin/ot-reg/cells', { method: 'POST', body: { cells: changes } });
      for (const c of changes) { const k = c.employee_id + '|' + c.date; if (c.minutes === '' || c.minutes == null) reg.delete(k); else reg.set(k, +c.minutes); }
      repaint(new Set(changes.map((c) => c.employee_id)));
      toast(changes.length > 1 ? `Đã lưu ${changes.length} ô` : 'Đã lưu', 'ok');
    } catch (e) { toast(e.message, 'err'); repaint(new Set(changes.map((c) => c.employee_id))); }
  };
  const posOf = (td) => [list.indexOf(td._k.e), days.indexOf(td._k.d)];
  const focusAt = (r, c) => { const tr = rowOf(list[r]); const td = tr && tr.children[4 + c]; if (td && td._k) td.focus(); };
  const edit = (td) => {
    const { e, d } = td._k; const cur = reg.get(e.id + '|' + d);
    const inp = el('input', { type: 'number', min: 0, max: 1440, value: cur ?? '', class: 'al-inp' });
    td.replaceChildren(inp); inp.focus(); inp.select();
    let done = false;
    const finish = (save) => {
      if (done) return; done = true;
      if (save && String(inp.value) !== String(cur ?? '')) saveCells([{ employee_id: e.id, date: d, minutes: inp.value }]);
      else paint(td);
    };
    inp.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); const [r, ci] = posOf(td); finish(true); setTimeout(() => focusAt(r + 1, ci), 60); } else if (ev.key === 'Escape') finish(false); };
    inp.onblur = () => finish(true);
  };
  tbody.addEventListener('click', (ev) => { const td = ev.target.closest('td.or-c'); if (td && !td.querySelector('input')) edit(td); });
  tbody.addEventListener('keydown', (ev) => {
    const td = ev.target.closest && ev.target.closest('td.or-c'); if (!td || ev.target.tagName === 'INPUT') return;
    const [r, c] = posOf(td);
    const mv = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[ev.key];
    if (mv) { ev.preventDefault(); focusAt(r + mv[0], c + mv[1]); }
    else if (ev.key === 'Enter' || ev.key === 'F2') { ev.preventDefault(); edit(td); }
    else if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); if (reg.has(td._k.e.id + '|' + td._k.d)) saveCells([{ employee_id: td._k.e.id, date: td._k.d, minutes: '' }]); }
    else if (/^[0-9]$/.test(ev.key)) { edit(td); }
  });
  // dán khối số copy từ Excel: ô đang chọn là góc trên-trái
  tbody.addEventListener('paste', (ev) => {
    const td = ev.target.closest && ev.target.closest('td.or-c'); if (!td) return;
    const txt = (ev.clipboardData || window.clipboardData).getData('text'); if (!txt) return;
    ev.preventDefault();
    const [r0, c0] = posOf(td); const changes = [];
    txt.replace(/\r/g, '').replace(/\n$/, '').split('\n').forEach((line, i) => line.split('\t').forEach((v, j) => {
      const e = list[r0 + i], d = days[c0 + j]; if (!e || !d) return;
      const s = v.trim(); if (s !== '' && !/^\d+$/.test(s)) return;
      changes.push({ employee_id: e.id, date: d, minutes: s });
    }));
    saveCells(changes);
  });

  // ----- Excel: xuất mẫu (NV đang lọc × khoảng ngày đang xem) / nhập lại -----
  const xlOut = el('button', { class: 'btn ghost sm', title: 'Xuất file Excel: mỗi dòng 1 nhân viên đang lọc, mỗi cột 1 ngày trong khoảng đang xem — điền số phút rồi nhập lại' }, '⬇ Xuất mẫu Excel');
  xlOut.onclick = async () => {
    const vis = visible(); if (!vis.length) return toast('Không có nhân viên nào để xuất', 'err');
    xlOut.disabled = true;
    try {
      const res = await api('/admin/ot-reg/export.xlsx', { method: 'POST', raw: true, body: { from: _or.from, to: _or.to, ids: vis.length === emps.length ? [] : vis.map((e) => e.id) } });
      if (!res.ok) { let m = 'Máy chủ trả lỗi ' + res.status; try { m = (await res.json()).error || m; } catch {} toast(m, 'err'); return; }
      const url = URL.createObjectURL(await res.blob());
      const a = el('a', { href: url, download: `dang_ky_lam_them_${_or.from}_${_or.to}.xlsx` });
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast(`Đã xuất mẫu ${vis.length.toLocaleString('vi')} nhân viên × ${days.length} ngày`, 'ok');
    } catch (e) { toast('Không xuất được file (mất kết nối máy chủ, thử lại)', 'err'); }
    finally { xlOut.disabled = false; }
  };
  const xlIn = el('button', { class: 'btn ghost sm', title: 'Nhập file Excel đã điền số phút đăng ký (theo mẫu xuất từ nút bên cạnh)' }, '⬆ Nhập Excel');
  xlIn.onclick = () => {
    const file = el('input', { type: 'file', accept: '.xlsx' });
    const clr = el('input', { type: 'checkbox', style: 'width:auto;margin:0' });
    const out = el('div', { style: 'margin-top:12px' });
    const go = el('button', { class: 'btn' }, '⬆ Nhập');
    go.onclick = () => {
      const f = file.files[0]; if (!f) return toast('Chọn file Excel trước', 'err');
      if (clr.checked && !confirm('Ô để TRỐNG trong file sẽ XOÁ đăng ký của ngày đó. Tiếp tục?')) return;
      go.disabled = true; go.textContent = 'Đang nhập…';
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const r = await api('/admin/ot-reg/import', { method: 'POST', body: { fileBase64: reader.result, clear_blank: clr.checked } });
          const dm = (d) => d.slice(8) + '/' + d.slice(5, 7);
          out.replaceChildren(
            el('div', { style: 'font-weight:700;color:#15803d' }, `✅ Đã nhập ${r.saved.toLocaleString('vi')} ô đăng ký của ${r.people.toLocaleString('vi')} nhân viên (${r.days} ngày, ${dm(r.from)} → ${dm(r.to)})` + (r.cleared ? ` · xoá ${r.cleared.toLocaleString('vi')} ô` : '')),
            r.unknown.length ? el('div', { class: 'dv-warn', style: 'margin-top:8px' }, `Mã NV không có trong phần mềm (bỏ qua): ${r.unknown.join(', ')}${r.unknown.length >= 30 ? '…' : ''}`) : '',
            r.badCells.length ? el('div', { class: 'dv-warn', style: 'margin-top:8px' }, `Ô không phải số phút 0–1440 (bỏ qua): ${r.badCells.join(' · ')}${r.badCells.length >= 30 ? '…' : ''}`) : '');
          go.style.display = 'none'; closeB.textContent = 'Đóng'; closeB.onclick = () => { closeModal(); _or.from = r.from; _or.to = nDays(r.from, r.to) > 31 ? addDays(r.from, 30) : r.to; pageOtReg(); };
        } catch (e) { toast(e.message, 'err'); go.disabled = false; go.textContent = '⬆ Nhập'; }
      };
      reader.readAsDataURL(f);
    };
    const closeB = el('button', { class: 'btn ghost', onclick: closeModal }, 'Huỷ');
    openModal('Nhập đăng ký làm thêm từ Excel', [
      el('div', { class: 'map-hint' }, 'Dùng file xuất từ nút "⬇ Xuất mẫu Excel": cột A = Mã NV, dòng tiêu đề = các ngày, ô = số PHÚT đăng ký (0 = không cho làm thêm). Nhập xong áp ngay vào công, không cần bấm Tính lại.'),
      el('div', { style: 'margin-top:12px' }, file),
      el('label', { style: 'display:flex;gap:8px;align-items:center;margin-top:12px;cursor:pointer' }, clr, 'Ô để trống = XOÁ đăng ký ngày đó (không tích: ô trống giữ nguyên như đang có)'),
      out,
    ], [closeB, go]);
  };
  setMain(head(T, fromI, toI, dApply.btn, prev, next, weekB, monthB, xlOut, xlIn),
    rulePanel, applyPanel,
    el('div', { class: 'ft-wrap' }, el('div', { class: 'panel ft-left' }, tree),
      el('div', { class: 'panel', style: 'padding:10px;min-width:0' },
        el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px' }, q, total,
          el('span', { class: 'map-hint', style: 'margin:0' }, 'Bấm ô để gõ số phút đăng ký · Enter lưu · Delete xoá · dán cả khối số từ Excel (Ctrl+V). Số đậm = đăng ký, số nhỏ = làm thêm thực tế. ',
            el('span', { class: 'or-lg over' }, 'đỏ: làm quá đăng ký'), ' ', el('span', { class: 'or-lg under' }, 'vàng: làm thiếu'), ' ', el('span', { class: 'or-lg noreg' }, 'xám: chưa đăng ký'))),
        el('div', { class: 'al-scroll' }, tbl))));
  draw();
}

/* ---------- CHẤM CÔNG BẤT THƯỜNG ----------
 * Ai đi muộn / về sớm so với ca được phân, ai làm thêm quá (hoặc thiếu, hoặc không) đăng ký, ai thiếu giờ ra.
 * Tải 1 lần theo khoảng ngày; lọc phòng ban / loại / ngưỡng phút / tìm tên đều tức thì trên máy. */
const _ab = { from: null, to: null, depts: new Set(), kinds: new Set(['late', 'early', 'ot_over', 'no_out']), minLate: 1, minEarly: 1, minOt: 1, q: '', view: 'detail' };
async function pageAbnormal() {
  const T = '🚨 Chấm công bất thường';
  const today = todayVN();
  const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  if (!_ab.from) { _ab.from = addDays(today, -6); _ab.to = today; }
  if (!DEPARTMENTS.length) { try { DEPARTMENTS = (await api('/admin/departments')).rows || []; } catch {} }
  const WDS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const dmy = (d) => `${WDS[new Date(d + 'T12:00:00Z').getUTCDay()]} ${d.slice(8)}/${d.slice(5, 7)}`;
  const fromI = el('input', { type: 'date', value: _ab.from, style: 'width:auto;margin:0' });
  const toI = el('input', { type: 'date', value: _ab.to, style: 'width:auto;margin:0' });
  const box = el('div', {}, loading());
  const chipBox = el('div', { class: 'ab-chips' });
  const info = el('span', { class: 'muted' });
  let data = { rows: [], kinds: [], counts: {} };
  const LABEL = {};

  // ----- lọc trên máy -----
  const kindsOf = (r) => r.kinds.filter((k) => (k === 'late' ? r.late >= _ab.minLate : k === 'early' ? r.early >= _ab.minEarly
    : k === 'ot_over' ? r.raw - r.reg >= _ab.minOt : k === 'ot_noreg' ? r.raw >= _ab.minOt : k === 'ot_under' ? r.reg - r.raw >= _ab.minOt : true));
  const scoped = () => {
    const ex = _ab.depts.size ? deptExpand(_ab.depts) : null, s = _ab.q.trim().toLowerCase();
    const out = [];
    for (const r of data.rows) {
      if (ex && !ex.has(r.dept)) continue;
      if (s && !r.name.toLowerCase().includes(s) && !String(r.code).toLowerCase().includes(s)) continue;
      const ks = kindsOf(r); if (ks.length) out.push({ ...r, ks });
    }
    return out;
  };
  const badge = (k) => el('span', { class: 'ab-b ' + k }, LABEL[k] || k);
  const num = (v, cls) => el('td', { class: 'ab-n' + (v ? ' ' + cls : '') }, v ? String(v) : '');
  const draw = () => {
    const base = scoped();
    const counts = {}; for (const r of base) for (const k of r.ks) counts[k] = (counts[k] || 0) + 1;
    chipBox.replaceChildren(...data.kinds.map(([k, label]) => {
      const b = el('button', { type: 'button', class: 'ab-chip ' + k + (_ab.kinds.has(k) ? ' on' : '') }, label, el('b', {}, (counts[k] || 0).toLocaleString('vi')));
      b.onclick = () => { _ab.kinds.has(k) ? _ab.kinds.delete(k) : _ab.kinds.add(k); draw(); };
      return b;
    }));
    const rows = base.filter((r) => r.ks.some((k) => _ab.kinds.has(k)));
    const people = new Set(rows.map((r) => r.id)).size;
    info.textContent = `${rows.length.toLocaleString('vi')} dòng · ${people.toLocaleString('vi')} nhân viên`;
    if (!rows.length) { box.replaceChildren(el('div', { class: 'empty' }, data.rows.length ? 'Không có dòng nào khớp các loại / bộ lọc đang chọn.' : 'Không có bất thường nào trong khoảng ngày này. 🎉')); return; }
    const tb = el('tbody');
    let tbl, start;
    if (_ab.view === 'sum') {
      // tổng hợp theo nhân viên: số lần + tổng phút từng loại
      const by = new Map();
      for (const r of rows) {
        let g = by.get(r.id); if (!g) by.set(r.id, g = { code: r.code, name: r.name, dept: r.dept, lateN: 0, lateM: 0, earlyN: 0, earlyM: 0, overN: 0, overM: 0, noregN: 0, noregM: 0, underN: 0, noOut: 0, days: new Set() });
        g.days.add(r.date);
        for (const k of r.ks) {
          if (!_ab.kinds.has(k)) continue;
          if (k === 'late') { g.lateN++; g.lateM += r.late; } else if (k === 'early') { g.earlyN++; g.earlyM += r.early; }
          else if (k === 'ot_over') { g.overN++; g.overM += r.raw - r.reg; } else if (k === 'ot_noreg') { g.noregN++; g.noregM += r.raw; }
          else if (k === 'ot_under') g.underN++; else if (k === 'no_out') g.noOut++;
        }
      }
      const list = [...by.values()].sort((a, b) => (b.lateN + b.earlyN + b.overN + b.noOut + b.noregN + b.underN) - (a.lateN + a.earlyN + a.overN + a.noOut + a.noregN + a.underN));
      tbl = el('table', { class: 'data ab-tbl' });
      tbl.innerHTML = '<thead><tr><th>#</th><th>Mã NV</th><th>Họ tên</th><th>Bộ phận</th><th>Số ngày</th><th>Đi muộn (lần)</th><th>Tổng muộn (phút)</th><th>Về sớm (lần)</th><th>Tổng sớm (phút)</th><th>Quá đăng ký (lần)</th><th>Tổng vượt (phút)</th><th>Không đăng ký (lần)</th><th>Thiếu so ĐK (lần)</th><th>Thiếu giờ ra</th></tr></thead>';
      let i = 0;
      start = lazyRows(tb, list, (g) => el('tr', {}, el('td', { class: 'muted' }, String(++i)), el('td', {}, g.code), el('td', {}, el('b', {}, g.name)), el('td', { class: 'muted ab-dept', title: g.dept || '' }, g.dept || '—'), el('td', { class: 'ab-n' }, String(g.days.size)),
        num(g.lateN, 'late'), num(g.lateM, 'late'), num(g.earlyN, 'early'), num(g.earlyM, 'early'), num(g.overN, 'ot_over'), num(g.overM, 'ot_over'), num(g.noregN, 'ot_noreg'), num(g.underN, 'ot_under'), num(g.noOut, 'no_out')), 14);
    } else {
      tbl = el('table', { class: 'data ab-tbl' });
      tbl.innerHTML = '<thead><tr><th>Ngày</th><th>Mã NV</th><th>Họ tên</th><th>Bộ phận</th><th>Ca</th><th>Vào</th><th>Ra</th><th>Đi muộn</th><th>Về sớm</th><th title="Số phút đăng ký làm thêm">ĐK làm thêm</th><th title="Số phút làm thêm thực tế">Thực tế</th><th title="Số phút làm thêm được tính công">Được tính</th><th>Vượt ĐK</th><th>Bất thường</th></tr></thead>';
      start = lazyRows(tb, rows, (r) => el('tr', {}, el('td', { style: 'white-space:nowrap' }, dmy(r.date)), el('td', {}, r.code), el('td', {}, el('b', {}, r.name)), el('td', { class: 'muted ab-dept', title: r.dept || '' }, r.dept || '—'),
        el('td', { class: 'muted ab-dept', title: r.shift || '' }, (r.shift || '—').replace(/\s*\(.*\)$/, '')), el('td', {}, r.in || (r.absent ? '' : '—')), el('td', {}, r.out || (r.absent ? '' : '—')),
        // chỉ hiện số của loại ĐANG BẬT (tắt "Đi muộn" thì dòng hiện vì lý do khác không còn số đi muộn gây rối)
        num(_ab.kinds.has('late') && r.ks.includes('late') ? r.late : 0, 'late'), num(_ab.kinds.has('early') && r.ks.includes('early') ? r.early : 0, 'early'),
        el('td', { class: 'ab-n' }, r.reg == null ? '' : String(r.reg)), el('td', { class: 'ab-n' }, r.raw ? String(r.raw) : ''), el('td', { class: 'ab-n' }, r.ot ? String(r.ot) : ''),
        num(_ab.kinds.has('ot_over') && r.ks.includes('ot_over') ? r.raw - r.reg : 0, 'ot_over'),
        el('td', {}, ...r.ks.filter((k) => _ab.kinds.has(k)).map(badge), r.absent ? el('span', { class: 'muted', style: 'font-size:12px' }, ' không đi làm') : '')), 14);
    }
    tbl.append(tb);
    const wrap = el('div', { class: 'ab-scroll' }, tbl);
    box.replaceChildren(wrap);
    start(wrap);
  };
  const load = async () => {
    _ab.from = fromI.value; _ab.to = toI.value;
    box.replaceChildren(loading());
    try { data = await api(`/admin/abnormal?from=${_ab.from}&to=${_ab.to}`); }
    catch (e) { box.replaceChildren(el('div', { class: 'empty' }, e.message)); return; }
    for (const [k, l] of data.kinds) LABEL[k] = l;
    dApply.synced(); deptCl.sync(); draw();
  };
  const dApply = dateApply(fromI, toI, load);
  const quick = (label, f, t) => { const b = el('button', { class: 'btn ghost sm' }, label); b.onclick = () => { fromI.value = f; toI.value = t; load(); }; return b; };
  const deptCl = makeChecklist('🏢', 'Tất cả phòng ban', () => deptTreeItems([...new Set(data.rows.map((r) => r.dept).filter(Boolean))]), _ab.depts, draw);
  const q = el('input', { placeholder: 'Tìm tên / mã NV', value: _ab.q, style: 'margin:0;width:170px' });
  q.oninput = () => { _ab.q = q.value; draw(); };
  const minI = (key, tip) => { const i = el('input', { type: 'number', min: 1, max: 600, value: _ab[key], title: tip, style: 'width:64px;margin:0' }); i.oninput = () => { _ab[key] = Math.max(1, parseInt(i.value, 10) || 1); draw(); }; return i; };
  const viewSeg = el('div', { class: 'al-tabs' }, ...[['detail', 'Chi tiết từng ngày'], ['sum', 'Tổng hợp theo NV']].map(([k, t]) => {
    const b = el('button', { class: 'btn sm' + (_ab.view === k ? '' : ' ghost') }, t);
    b.onclick = () => { _ab.view = k; viewSeg.querySelectorAll('button').forEach((x) => x.classList.toggle('ghost', x !== b)); draw(); };
    return b;
  }));
  const xls = el('button', { class: 'btn ghost sm' }, '⬇ Xuất Excel');
  xls.onclick = async () => {
    if (!_ab.kinds.size) return toast('Chọn ít nhất 1 loại bất thường', 'err');
    xls.disabled = true;
    try {
      const qs = `from=${_ab.from}&to=${_ab.to}&kinds=${[..._ab.kinds].join(',')}&min_late=${_ab.minLate}&min_early=${_ab.minEarly}&min_ot=${_ab.minOt}` + (_ab.depts.size ? '&depts=' + encodeURIComponent([..._ab.depts].join(',')) : '');
      const res = await api('/admin/abnormal.xlsx?' + qs, { raw: true });
      if (!res.ok) { toast('Máy chủ trả lỗi ' + res.status + ' khi xuất', 'err'); return; }
      const url = URL.createObjectURL(await res.blob());
      const a = el('a', { href: url, download: `cham_cong_bat_thuong_${_ab.from}_${_ab.to}.xlsx` });
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('Đã xuất Excel', 'ok');
    } catch (e) { toast('Không xuất được file (mất kết nối máy chủ, thử lại)', 'err'); }
    finally { xls.disabled = false; }
  };
  const filt = el('div', { class: 'panel ab-filt' },
    el('label', {}, 'Đi muộn từ', minI('minLate', 'Chỉ tính đi muộn từ số phút này trở lên'), 'phút'),
    el('label', {}, 'Về sớm từ', minI('minEarly', 'Chỉ tính về sớm từ số phút này trở lên'), 'phút'),
    el('label', {}, 'Làm thêm lệch từ', minI('minOt', 'Chỉ tính khi làm thêm lệch so với đăng ký từ số phút này trở lên'), 'phút'),
    q, viewSeg, info);
  setMain(head(T, fromI, toI, dApply.btn, quick('Hôm qua', addDays(today, -1), addDays(today, -1)), quick('7 ngày', addDays(today, -6), today), quick('Tháng này', today.slice(0, 8) + '01', today), deptCl.btn, xls),
    el('div', { class: 'map-hint', style: 'margin:-6px 0 10px;max-width:900px' }, 'So giờ chấm với ca được phân và với số phút đăng ký làm thêm (khai ở menu "⏰ Đăng ký làm thêm"). Bấm các ô loại bên dưới để bật / tắt; con số là số dòng của loại đó trong phạm vi đang lọc.'),
    chipBox, filt, box);
  load();
}

/* ---------- LƯỢT CHẤM (như "Sửa giờ chấm công" của Wise Eye): xem / thêm / sửa / xoá từng lượt chấm của 1 NV trong 1 ngày ---------- */
// Lưu xong phần mềm tự tính lại công ngày đó theo đúng ca + quy tắc ghép cặp (giống lượt quẹt từ máy).
async function punchModal(emp, date, reload) {
  let cur = date;
  const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const dateI = el('input', { type: 'date', value: cur, style: 'width:auto;margin:0' });
  const prev = el('button', { class: 'btn ghost sm', title: 'Ngày trước' }, '◀'), next = el('button', { class: 'btn ghost sm', title: 'Ngày sau' }, '▶');
  const listBox = el('div', {}, loading());
  const tIn = time24('pm-time', ''); tIn.style.width = '96px'; tIn.style.margin = '0';
  const kindSel = el('select', { style: 'width:auto;margin:0' }, el('option', { value: 'in' }, 'Vào'), el('option', { value: 'out' }, 'Ra'));
  const addBtn = el('button', { class: 'btn sm' }, '+ Thêm lượt');
  const after = () => { reload && reload(); draw(); };
  const draw = async () => {
    dateI.value = cur;
    let d;
    try { d = await api(`/admin/attendance/punches?employee_id=${emp.id}&date=${cur}`); } catch (e) { listBox.replaceChildren(el('div', { class: 'empty' }, e.message)); return; }
    const tbl = el('table', { class: 'data' });
    tbl.innerHTML = '<thead><tr><th>#</th><th>Giờ chấm</th><th>Loại</th><th>Nguồn</th><th></th></tr></thead>';
    const tb = el('tbody'); tbl.append(tb);
    const ph = (d.phone && d.phone.length) ? d.phone : [];
    if (!d.rows.length && !ph.length) tb.append(el('tr', {}, el('td', { colspan: 5 }, el('div', { class: 'empty' }, 'Chưa có lượt chấm nào trong ngày này. Thêm ở bên dưới.'))));
    d.rows.forEach((p, i) => {
      const tdT = el('td', {}, el('b', {}, p.time), p.date !== cur ? el('span', { class: 'muted', style: 'font-size:12px' }, ' (' + p.date.slice(8) + '/' + p.date.slice(5, 7) + ')') : '');
      const edit = btnSm('Sửa', () => {
        const i2 = time24('', p.time); i2.className = 'att-inl-in';
        const ok = btnSm('Lưu', async () => {
          try { await api('/admin/attendance/punches/' + p.id, { method: 'PUT', body: { time: i2.value } }); toast('Đã sửa lượt chấm', 'ok'); after(); } catch (e) { toast(e.message, 'err'); }
        });
        i2.addEventListener('keydown', (e) => { if (e.key === 'Enter') { i2.blur(); setTimeout(() => ok.click(), 0); } if (e.key === 'Escape') draw(); });
        tdT.replaceChildren(el('div', { style: 'display:flex;gap:6px;align-items:center' }, i2, ok, btnSm('Huỷ', draw, 'ghost')));
        i2.focus(); i2.select();
      }, 'ghost');
      const del = btnSm('Xoá', async () => {
        if (!confirm(`Xoá lượt chấm ${p.time} ngày ${cur.slice(8)}/${cur.slice(5, 7)} của ${emp.name}?`)) return;
        try { await api('/admin/attendance/punches/' + p.id, { method: 'DELETE' }); toast('Đã xoá lượt chấm', 'ok'); after(); } catch (e) { toast(e.message, 'err'); }
      }, 'ghost');
      del.style.color = '#c0392b';
      tb.append(el('tr', {}, el('td', {}, String(i + 1)), tdT,
        el('td', {}, p.kind ? el('span', { class: 'pill' + (p.kind === 'Ra' ? ' muted' : '') }, p.kind) : el('span', { class: 'muted' }, 'theo máy')),
        el('td', {}, p.manual ? el('span', { style: 'color:#e67e22;font-weight:600' }, '✎ Thêm tay') : p.source),
        el('td', {}, el('div', { style: 'display:flex;gap:6px' }, edit, del))));
    });
    // Phiên vào–ra chấm điện thoại / nhập tay (ngày không quẹt máy): sửa / xoá ngay tại đây
    const dmy = (x) => x.slice(8) + '/' + x.slice(5, 7);
    let phoneBox = '';
    if (ph.length && d.phoneLocked) {
      const pt = el('table', { class: 'data' });
      pt.innerHTML = '<thead><tr><th>#</th><th>Vào</th><th>Ra</th><th>Nguồn</th><th></th></tr></thead>';
      const pb = el('tbody'); pt.append(pb);
      ph.forEach((p, i) => {
        const nextDay = p.out_date && p.out_date > cur;
        const outTxt = p.out ? el('span', {}, punchTime(p.out, p.out_photo), nextDay ? el('b', { style: 'color:#c0392b;font-size:12px' }, ' (' + dmy(p.out_date) + ')') : '') : el('span', { class: 'pill muted' }, 'chưa ra');
        const tdIn = el('td', {}, punchTime(p.in || '--:--', p.in_photo)), tdOut = el('td', {}, outTxt);
        const edit = btnSm('Sửa', () => {
          const iI = time24('', p.in); iI.className = 'att-inl-in';
          const iO = time24('', nextDay && d.noOvernight ? '' : p.out); iO.className = 'att-inl-in'; iO.placeholder = 'chưa ra';
          const ok = btnSm('Lưu', async () => {
            if (!iI.value) return toast('Nhập giờ vào (muốn bỏ cả phiên thì bấm Xoá)', 'err');
            try { await api('/admin/attendance/' + p.id, { method: 'PUT', body: { check_in: iI.value, check_out: iO.value } }); toast('Đã sửa phiên', 'ok'); after(); } catch (e) { toast(e.message, 'err'); }
          });
          for (const x of [iI, iO]) x.addEventListener('keydown', (e) => { if (e.key === 'Enter') { x.blur(); setTimeout(() => ok.click(), 0); } if (e.key === 'Escape') draw(); });
          tdIn.replaceChildren(iI);
          tdOut.replaceChildren(el('div', { style: 'display:flex;gap:6px;align-items:center' }, iO, ok, btnSm('Huỷ', draw, 'ghost')));
          iI.focus(); iI.select();
        }, 'ghost');
        const del = btnSm('Xoá', async () => {
          if (!confirm(`Xoá phiên ${p.in || '--:--'} → ${p.out || 'chưa ra'} ngày ${dmy(cur)} của ${emp.name}?`)) return;
          try { await api('/admin/attendance/' + p.id, { method: 'DELETE' }); toast('Đã xoá phiên', 'ok'); after(); } catch (e) { toast(e.message, 'err'); }
        }, 'ghost');
        del.style.color = '#c0392b';
        const acts = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, edit, del);
        if (nextDay) {
          const mv = btnSm(`↪ Chuyển ${p.out} sang ${dmy(p.out_date)}`, async () => {
            if (!confirm(`Phiên ${p.in} ngày ${dmy(cur)} có giờ ra ${p.out} của ngày ${dmy(p.out_date)} (thường do quên chấm ra, sáng hôm sau chấm vào bị lấy làm giờ ra).\n\n`
              + `→ Bỏ giờ ra khỏi ngày ${dmy(cur)} (phiên ${p.in} thành CHƯA RA, quản lý nhập giờ ra đúng nếu biết)\n→ Chuyển ${p.out} thành giờ VÀO ngày ${dmy(p.out_date)} (giữ ảnh chấm; ngày đó đã có giờ vào sát giờ này thì không thêm lần nữa)\n\nĐồng ý?`)) return;
            try {
              const r = await api('/admin/attendance/' + p.id + '/split-out', { method: 'POST' });
              toast(r.moved ? `Đã chuyển ${p.out} sang ngày ${dmy(r.next_date)}` : `Đã bỏ giờ ra khỏi ngày ${dmy(cur)}; ngày ${dmy(r.next_date)} đã có giờ vào lúc ${p.out} nên không thêm lần nữa`, 'ok'); after();
            } catch (e) { toast(e.message, 'err'); }
          });
          mv.title = 'Bỏ giờ ra sang ngày sau khỏi phiên này, chuyển thành giờ vào của ngày sau';
          acts.prepend(mv);
        }
        pb.append(el('tr', nextDay ? { style: 'background:#fdecea' } : {}, el('td', {}, String(i + 1)), tdIn, tdOut,
          el('td', {}, p.manual ? el('span', { style: 'color:#e67e22;font-weight:600' }, '✎ Sửa tay') : '📱 Điện thoại'), el('td', {}, acts)));
      });
      const warn = ph.some((p) => p.out_date && p.out_date > cur) && d.noOvernight
        ? el('div', { class: 'map-hint', style: 'margin-top:6px;color:#c0392b' }, 'Dòng tô đỏ: giờ ra rơi sang ngày hôm sau — dữ liệu chấm từ trước khi có ô "Qua đêm". Đang TẮT qua đêm nên bấm "↪ Chuyển … sang …" để tách cho đúng.') : '';
      phoneBox = el('div', { style: 'margin-bottom:10px' },
        el('div', { class: 'map-hint', style: 'margin-bottom:6px' }, '📱 Phiên vào–ra (chấm điện thoại / nhập tay) — sửa giờ, xoá ngay ở đây. Thêm ở dưới = thêm 1 phiên MỚI (nhập "Vào" trước, rồi "Ra").'),
        el('div', { class: 'tbl-scroll' }, pt), warn);
    }
    listBox.replaceChildren(
      phoneBox || (ph.length ? el('div', { class: 'map-hint', style: 'margin-bottom:8px;color:#b45309' },
        '📱 Các phiên vào–ra (chấm điện thoại / nhập tay): ' + ph.map((p) => (p.in || '--:--') + ' → ' + (p.out || 'chưa ra')).join(' · ') + '.') : ''),
      (d.rows.length || !ph.length) ? el('div', { class: 'tbl-scroll' }, tbl) : '',
      (d.manualRow && !d.phoneLocked) ? el('div', { class: 'map-hint', style: 'margin-top:6px;color:#b45309' }, 'Ngày này đang có giờ sửa tay ở bảng công — thêm / sửa / xoá lượt chấm sẽ tính lại theo các lượt chấm ở đây.') : '');
  };
  prev.onclick = () => { cur = addDays(cur, -1); draw(); };
  next.onclick = () => { cur = addDays(cur, 1); draw(); };
  dateI.onchange = () => { if (dateI.value) { cur = dateI.value; draw(); } };
  addBtn.onclick = async () => {
    if (!tIn.value) return toast('Nhập giờ (VD 0800)', 'err');
    const body = { employee_ids: [emp.id], date: cur, [kindSel.value]: tIn.value };
    try { await api('/admin/attendance/punches', { method: 'POST', body }); tIn.value = ''; toast('Đã thêm lượt chấm', 'ok'); after(); } catch (e) { toast(e.message, 'err'); }
  };
  tIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { tIn.blur(); setTimeout(() => addBtn.click(), 0); } });
  openModal(`Lượt chấm — ${emp.name}${emp.code ? ' (' + emp.code + ')' : ''}`, [
    el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, el('label', { style: 'margin:0' }, 'Ngày'), prev, dateI, next),
    listBox,
    el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding-top:10px;border-top:1px solid var(--line)' },
      el('label', { style: 'margin:0' }, 'Thêm lượt chấm'), tIn, kindSel, addBtn),
    el('div', { class: 'map-hint' }, 'Mỗi lần thêm / sửa / xoá, công ngày đó được tính lại ngay theo ca và quy tắc ghép vào–ra (như lượt quẹt máy). "Vào / Ra" dùng cho quy tắc theo ID máy hoặc chọn từ máy; quy tắc đầu–cuối thì lượt sớm nhất là vào, muộn nhất là ra.'),
  ], [el('button', { class: 'btn', onclick: closeModal }, 'Xong')]);
  draw();
}

/* ---------- THÊM GIỜ HÀNG LOẠT: nhiều NV × nhiều ngày trong tháng, giờ vào / ra + khoảng chạy ---------- */
async function bulkPunchModal(emps, month0, reload) {
  const pick = await empMultiPicker(emps, 230);
  const [y0, m0] = (month0 || todayVN()).slice(0, 7).split('-').map(Number);
  const yI = el('select', { style: 'width:auto;margin:0' }, ...[y0 - 1, y0, y0 + 1].map((y) => el('option', { value: y, ...(y === y0 ? { selected: '' } : {}) }, 'Năm ' + y)));
  const mI = el('select', { style: 'width:auto;margin:0' }, ...Array.from({ length: 12 }, (_, i) => el('option', { value: i + 1, ...(i + 1 === m0 ? { selected: '' } : {}) }, 'Tháng ' + (i + 1))));
  const days = el('div', { class: 'bp-days' });
  const picked = new Set();
  const WDS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const dayList = () => { const y = +yI.value, m = +mI.value, n = new Date(Date.UTC(y, m, 0)).getUTCDate(); return Array.from({ length: n }, (_, i) => `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`); };
  const wd = (d) => new Date(d + 'T12:00:00Z').getUTCDay();
  const cnt = el('b', {});
  const drawDays = () => {
    days.replaceChildren();
    for (const d of dayList()) {
      const cb = el('input', { type: 'checkbox', ...(picked.has(d) ? { checked: '' } : {}) });
      cb.onchange = () => { cb.checked ? picked.add(d) : picked.delete(d); cnt.textContent = `${picked.size} ngày`; };
      days.append(el('label', { class: 'bp-day' + (wd(d) === 0 ? ' sun' : wd(d) === 6 ? ' sat' : '') }, cb, `${+d.slice(8)}`, el('small', {}, WDS[wd(d)])));
    }
    cnt.textContent = `${picked.size} ngày`;
  };
  const quick = (label, fn) => { const b = el('button', { class: 'btn ghost sm', type: 'button' }, label); b.onclick = () => { picked.clear(); for (const d of dayList()) if (fn(wd(d))) picked.add(d); drawDays(); }; return b; };
  yI.onchange = mI.onchange = () => { picked.clear(); drawDays(); };
  drawDays();
  const chkIn = el('input', { type: 'checkbox', checked: '', style: 'width:auto' }), chkOut = el('input', { type: 'checkbox', checked: '', style: 'width:auto' });
  const tIn = time24('bp-in', '07:30'), tOut = time24('bp-out', '17:00');
  const jIn = el('input', { type: 'number', min: 0, max: 120, value: 10 }), jOut = el('input', { type: 'number', min: 0, max: 120, value: 10 });
  const skip = el('input', { type: 'checkbox', checked: '', style: 'width:auto' });
  const timeRow = (chk, label, t, j) => el('div', { class: 'bp-time' }, el('label', { class: 'lv-chk' }, chk, el('b', {}, label)),
    t, el('span', {}, 'khoảng chạy'), j, el('span', {}, 'phút'));
  const run = el('button', { class: 'btn' }, 'Thực hiện');
  run.onclick = async () => {
    if (!pick.picked.size) return toast('Chọn nhân viên', 'err');
    if (!picked.size) return toast('Tích chọn ngày', 'err');
    if (!chkIn.checked && !chkOut.checked) return toast('Tích "Giờ vào" và/hoặc "Giờ ra"', 'err');
    const body = { employee_ids: [...pick.picked], dates: [...picked], skip_existing: skip.checked,
      in: chkIn.checked ? { time: tIn.value, jitter: jIn.value } : null, out: chkOut.checked ? { time: tOut.value, jitter: jOut.value } : null };
    if (!confirm(`Thêm giờ cho ${pick.picked.size} nhân viên × ${picked.size} ngày${chkIn.checked ? ', vào ' + tIn.value : ''}${chkOut.checked ? ', ra ' + tOut.value : ''}?`)) return;
    run.disabled = true; run.textContent = 'Đang thực hiện…';
    try {
      const r = await api('/admin/attendance/punches/bulk', { method: 'POST', body });
      toast(`Đã thêm giờ ${r.added} lượt người × ngày` + (r.skipped ? `, bỏ qua ${r.skipped} ngày đã có giờ` : '') + (r.skippedPhone ? `, bỏ qua ${r.skippedPhone} ngày chấm bằng điện thoại (sửa ở ô Vào / Ra)` : ''), 'ok'); closeModal(); reload && reload();
    } catch (e) { toast(e.message, 'err'); run.disabled = false; run.textContent = 'Thực hiện'; }
  };
  openModal('Thêm giờ hàng loạt', [
    pick.node,
    el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, yI, mI,
      quick('Cả tháng', () => true), quick('T2 → T6', (w) => w >= 1 && w <= 5), quick('T2 → T7', (w) => w >= 1), quick('Bỏ chọn', () => false), el('span', { style: 'margin-left:auto' }, 'Đã chọn ', cnt)),
    days,
    el('div', { style: 'display:flex;flex-direction:column;gap:8px' }, timeRow(chkIn, 'Giờ vào', tIn, jIn), timeRow(chkOut, 'Giờ ra', tOut, jOut)),
    el('label', { class: 'lv-chk' }, skip, el('span', {}, 'Bỏ qua ngày nhân viên đã có giờ chấm (không chèn thêm vào ngày đã quẹt máy)')),
    el('div', { class: 'map-hint' }, 'Khoảng chạy = giờ lệch ngẫu nhiên 0…N phút cho tự nhiên (VD vào 07:30, khoảng chạy 10 → 07:30–07:40). Giờ ra nhỏ hơn giờ vào hiểu là sáng hôm sau. Lượt thêm hiện dấu ✎ ở "Lượt chấm", xoá được từng lượt hoặc bằng "Xoá dữ liệu chấm công".'),
  ], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Huỷ'), run]);
}

/* ---------- XOÁ DỮ LIỆU CHẤM CÔNG theo nhân viên + khoảng ngày ---------- */
async function clearAttModal(emps, from, to, reload) {
  const pick = await empMultiPicker(emps, 230);
  const fI = el('input', { type: 'date', value: from }), tI = el('input', { type: 'date', value: to });
  const raw = el('input', { type: 'checkbox', style: 'width:auto' });
  const run = el('button', { class: 'btn', style: 'background:#c0392b;border-color:#c0392b' }, '🗑 Xoá');
  run.onclick = async () => {
    if (!pick.picked.size) return toast('Chọn nhân viên', 'err');
    if (!fI.value || !tI.value || tI.value < fI.value) return toast('Chọn từ ngày / đến ngày', 'err');
    if (!confirm(`XOÁ dữ liệu chấm công của ${pick.picked.size} nhân viên từ ${fI.value.split('-').reverse().join('/')} đến ${tI.value.split('-').reverse().join('/')}${raw.checked ? ' — XOÁ CẢ GIỜ GỐC (lượt quẹt máy), tính lại sẽ không còn giờ' : ''}?\nKhông hoàn tác được.`)) return;
    run.disabled = true;
    try {
      const r = await api('/admin/attendance/clear', { method: 'POST', body: { employee_ids: [...pick.picked], from: fI.value, to: tI.value, raw: raw.checked } });
      toast(`Đã xoá ${r.attendance} ngày công` + (raw.checked ? ` + ${r.punches} lượt chấm gốc` : ''), 'ok'); closeModal(); reload && reload();
    } catch (e) { toast(e.message, 'err'); run.disabled = false; }
  };
  openModal('Xoá dữ liệu chấm công', [
    el('div', { style: 'color:#c0392b;font-weight:700' }, 'Chọn đúng ngày và nhân viên trước khi xoá!'),
    pick.node,
    el('div', { class: 'two-col' }, field('Từ ngày', fI), field('Đến ngày', tI)),
    el('label', { class: 'lv-chk' }, raw, el('span', {}, el('b', {}, 'Xoá cả giờ gốc'), ' (lượt quẹt máy / lượt thêm tay) — bấm Tính lại cũng không còn giờ. Không tích: chỉ xoá bảng công, bấm "↻ Tính lại" sẽ dựng lại từ lượt quẹt máy.')),
  ], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Huỷ'), run]);
}

/* ---------- DUYỆT ĐỔI THIẾT BỊ (chống chấm hộ) ---------- */
async function pageDevReq() {
  setMain(head('Duyệt đổi thiết bị'), loading());
  let d;
  try { d = await api('/admin/device-requests'); } catch (e) { setMain(head('Duyệt đổi thiết bị'), el('div', { class: 'empty' }, e.message)); return; }
  const tbl = el('table', { class: 'data' });
  tbl.innerHTML = `<thead><tr><th>Nhân viên</th><th>Thiết bị đang xin dùng</th><th>Trạng thái</th><th></th></tr></thead>`;
  const tb = el('tbody');
  if (!d.rows.length) tb.append(el('tr', {}, el('td', { colspan: 4 }, el('div', { class: 'empty' }, 'Không có yêu cầu đổi thiết bị nào.'))));
  for (const r of d.rows) {
    const approve = btnSm('✅ Duyệt', async () => { await api('/admin/employees/' + r.id + '/approve-device', { method: 'POST' }); toast('Đã duyệt đổi thiết bị', 'ok'); pageDevReq(); });
    const reset = btnSm('Gỡ thiết bị', async () => { if (confirm('Gỡ thiết bị đã gắn của ' + r.full_name + '? Lần chấm tới nhân viên sẽ tự gắn điện thoại đang cầm.')) { await api('/admin/employees/' + r.id + '/reset-device', { method: 'POST' }); toast('Đã gỡ thiết bị', 'ok'); pageDevReq(); } }, 'ghost');
    tb.append(el('tr', {},
      el('td', {}, el('b', {}, r.full_name), el('div', { style: 'color:#999;font-size:12px' }, r.code)),
      el('td', {}, el('div', { style: 'font-size:12px;color:var(--muted);max-width:320px;word-break:break-word' }, r.device_label || '(không rõ máy)'),
        r.device_id ? el('div', { style: 'font-size:11px;color:#c0392b' }, 'Đang gắn máy khác — duyệt sẽ thay thế') : el('div', { style: 'font-size:11px;color:#0a7' }, 'Chưa gắn máy nào')),
      el('td', {}, el('span', { class: 'pill warn' }, 'Chờ duyệt')),
      el('td', {}, el('div', { style: 'display:flex;gap:6px' }, approve, reset)),
    ));
  }
  tbl.append(tb);
  setMain(head('Duyệt đổi thiết bị (' + d.rows.length + ')'),
    el('div', { class: 'panel', style: 'padding:14px 16px;margin-bottom:12px;max-width:640px;font-size:13px;color:var(--muted)' },
      'Khi bật “Chống chấm hộ”, mỗi tài khoản chỉ chấm được trên 1 điện thoại. Nhân viên đổi/mất máy sẽ gửi yêu cầu về đây — Anh bấm Duyệt để gán điện thoại mới, hoặc Gỡ thiết bị để nhân viên gắn lại từ đầu.'),
    el('div', { class: 'panel tbl-scroll' }, tbl));
}

