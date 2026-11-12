/* ---------- 4b) PHÂN CA THEO NGÀY ---------- */
const WD = { 1: 'T2', 2: 'T3', 3: 'T4', 4: 'T5', 5: 'T6', 6: 'T7', 7: 'CN' };
const ymd = (d) => d.toISOString().slice(0, 10);
function addDays(dateStr, n) { const d = new Date(dateStr + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return ymd(d); }
function weekdayVN(dateStr) { const dow = new Date(dateStr + 'T12:00:00Z').getUTCDay(); return dow === 0 ? 7 : dow; }
function mondayOf(dateStr) { const d = new Date(dateStr + 'T12:00:00Z'); const dow = d.getUTCDay(); d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow)); return ymd(d); }
function todayVN() { return new Date().toLocaleDateString('sv', { timeZone: 'Asia/Ho_Chi_Minh' }); }
function addMonths(dateStr, n) { const d = new Date(dateStr.slice(0, 7) + '-01T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return ymd(d); }
function monthDaysArr(month) { const [y, m] = month.split('-').map(Number); const n = new Date(Date.UTC(y, m, 0)).getUTCDate(); return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`); }

let _asStart = null;         // ngày mốc đang xem
let _asRange = null;         // Bảng Excel: khoảng ngày tự chọn { from, to } (null = cả tháng của _asStart)
let _asMode = 'week';        // 'week' = theo tuần | 'month' = theo tháng
function daysBetween(from, to) { const out = []; let d = from; for (let i = 0; i < 366 && d <= to; i++) { out.push(d); d = addDays(d, 1); } return out.length ? out : [from]; }

/* Trang PHÂN CA — bố cục kiểu "Lịch trình" của ZKBio: cây phòng ban bên trái + 3 thẻ bên phải
 *   list  = Lịch phân ca    : ai đang theo ca/lịch trình nào, từ ngày – đến ngày (gán theo khoảng ngày)
 *   sheet = Bảng phân ca    : lưới tháng NV × ngày kiểu Excel — gõ mã ca vào ô, quét vùng, copy/dán, Xuất/Nhập Excel
 *   temp  = Đổi ca tạm thời : đổi ca / cho nghỉ hàng loạt theo khoảng ngày + danh sách các ngày đã đổi */
let _asTab = 'list';
let _asDept = '*';          // phòng ban đang chọn trên cây ('*' = tất cả, '' = chưa có phòng ban)
let _asSearch = '';
let _asTreeHidden = (() => { try { return localStorage.getItem('as_tree_hidden') === '1'; } catch { return false; } })();   // ẩn cây phòng ban cho rộng màn hình
const AS_TABS = [['list', '4. Gán ca cho nhân viên'], ['dept', '5. Gán ca cho phòng ban'], ['sheet', 'Xem lịch trình (kiểu Excel)'], ['temp', 'Lịch trình tạm thời']];
let _asAdd = null;          // đang mở trang "Thêm": 'emp' (gán ca nhân viên) | 'dept' (gán ca phòng ban) | 'temp' (lịch trình tạm thời)
let _asTmpSrc = '';
// Bảng Excel: chế độ TOÀN MÀN HÌNH (ẩn menu trái + cây phòng ban, bảng chiếm gần hết màn hình) — nhớ theo máy
let _asSheetResize = false;
let _asSheetQ = '';
let _asFocusSearch = false;          // Bảng Excel: ô tìm nhân viên (tên / mã)
let _asReuse = false, _asLast = null;   // gõ ô tìm → vẽ lại bảng bằng dữ liệu đã tải, không gọi lại máy chủ
let _asFull = (() => { try { return localStorage.getItem('as_full') === '1'; } catch { return false; } })();
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && document.body.classList.contains('as-full') && !document.querySelector('#modal-bg.show')) {
    _asFull = false; try { localStorage.setItem('as_full', '0'); } catch {} document.body.classList.remove('as-full'); pageAssignments();
  }
});         // lọc nguồn ở Lịch trình tạm thời: '' | 'temp' | 'sheet'
// Cây phòng ban có cấp cha–con: [{ name, depth }], gồm cả tên phòng ban chỉ có ở hồ sơ nhân viên
function asDeptNodes(master, extraNames) {
  const byName = (a, b) => a.name.localeCompare(b.name, 'vi');
  const kids = new Map(); const ids = new Set(master.map((d) => d.id));
  for (const d of master) { const k = d.parent_id && ids.has(d.parent_id) ? d.parent_id : 0; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(d); }
  const out = [], seen = new Set();
  const walk = (pid, depth) => { for (const d of (kids.get(pid) || []).sort(byName)) { if (seen.has(d.id)) continue; seen.add(d.id); out.push({ name: d.name, depth }); walk(d.id, depth + 1); } };
  walk(0, 0);
  for (const n of [...new Set(extraNames)].filter(Boolean).sort((a, b) => a.localeCompare(b, 'vi'))) if (!out.some((o) => o.name === n)) out.push({ name: n, depth: 0 });
  return out;
}
let _asNavOpen = false;     // menu con của mục Phân ca ở menu trái: mặc định THU GỌN, bấm mục Phân ca mới xổ ra
let _asStopDrag = null;
document.addEventListener('mouseup', () => { if (_asStopDrag) _asStopDrag(); });
const _asDirty = new Map();   // ô đang sửa chưa lưu trên Bảng phân ca: 'idNV|ngày' → giá trị mới ('' = bỏ ca ngày đó)
// Rời bảng khi còn ô chưa lưu → hỏi lại
function asLeaveOk() { if (!_asDirty.size) return true; if (!confirm(`Có ${_asDirty.size} ô đang sửa chưa lưu. Bỏ các thay đổi này?`)) return false; _asDirty.clear(); return true; }

async function pageAssignments() {
  if (!_asStart) _asStart = todayVN();
  const canEdit = hasPerm('assignments');
  const curMonth = _asStart.slice(0, 7);
  // Bảng Excel xem được 1 khoảng ngày tự chọn (≤ 62 ngày) — để xuất / nhập Excel 1 khoảng nhỏ cho nhanh
  const days = _asTab === 'sheet' && _asRange ? (() => { const out = []; for (let d = new Date(_asRange.from + 'T12:00:00Z'); d <= new Date(_asRange.to + 'T12:00:00Z') && out.length < 62; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10)); return out; })() : monthDaysArr(curMonth);
  const from = days[0], to = days[days.length - 1];
  const fmtD = (d) => (d ? d.slice(8) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : '');

  // Đánh dấu mục con đang xem ở menu trái; thanh thẻ trong trang chỉ hiện trên màn hình hẹp (menu trái nằm ngang, không có menu con)
  document.querySelectorAll('#nav-sub-as .nav-sub-btn').forEach((x) => x.classList.toggle('active', x.dataset.as === _asTab));
  const pageTitle = (AS_TABS.find(([k]) => k === _asTab) || AS_TABS[0])[1];
  const tabBar = el('div', { class: 'as-tabs' },
    ...AS_TABS.map(([k, t]) => { const b = el('button', { class: 'btn sm ' + (_asTab === k ? '' : 'ghost') }, t); b.onclick = () => { if (!asLeaveOk()) return; _asTab = k; _asAdd = null; pageAssignments(); }; return b; }));
  setMain(head(pageTitle), tabBar, loading());

  // Dữ liệu chung: NV (+ ca gốc) + ca; thẻ Xem lịch lấy thêm lưới ca thực tế cả tháng
  let data, ranged = [], deptRows = [];
  try {
    const dKey = `${_asTab}|${from}|${to}`;
    if (_asReuse && _asLast && _asLast.key === dKey) data = _asLast.data;
    else { data = await api(`/admin/assignments?from=${from}&to=${to}${_asTab === 'sheet' ? '&grid=1' : ''}`); _asLast = { key: dKey, data }; }
    _asReuse = false;
    if (_asTab === 'list') ranged = (await api('/admin/shift-assignments')).rows || [];
    if (_asTab === 'dept') deptRows = (await api('/admin/dept-shift-assignments')).rows || [];
  } catch (e) { setMain(head(pageTitle), tabBar, el('div', { class: 'empty' }, e.message)); return; }
  const shiftName = new Map(data.shifts.map((s) => [s.id, s.name]));

  // ----- Cây phòng ban (trái), có cấp cha–con; bấm phòng cha thì gồm cả các phòng cấp dưới -----
  let deptMaster = [];
  try { deptMaster = (await api('/admin/departments')).rows || []; } catch {}
  const nodes = asDeptNodes(deptMaster, data.employees.map((e) => e.department || ''));
  const depts = nodes.map((n) => n.name);
  const descOf = (name) => { const i = nodes.findIndex((n) => n.name === name); const out = new Set([name]); if (i >= 0) for (let j = i + 1; j < nodes.length && nodes[j].depth > nodes[i].depth; j++) out.add(nodes[j].name); return out; };
  const countOf = (d) => { if (d === '*') return data.employees.length; const set = descOf(d); return data.employees.filter((e) => set.has(e.department || '')).length; };
  if (_asDept !== '*' && _asDept !== '' && !depts.includes(_asDept)) _asDept = '*';
  const tree = el('div', { class: 'emp-tree' });
  const node = (key, label, depth) => el('div', { class: 'tn' + (_asDept === key ? ' on' : ''), style: 'padding-left:' + (6 + depth * 14) + 'px', onclick: () => { if (!asLeaveOk()) return; _asDept = key; pageAssignments(); } },
    el('span', { class: 'nm', title: label }, label), el('span', { class: 'ct' }, String(countOf(key))));
  tree.append(node('*', 'Tất cả phòng ban', 0));
  const tItems = nodes.map((n) => { const r = node(n.name, n.name, 1 + n.depth); tree.append(r); return { key: n.name, depth: n.depth, el: r }; });
  collapseTree(tItems, [_asDept]);
  if (countOf('') > 0) tree.append(node('', '(Chưa có phòng ban)', 1));
  const setTreeHidden = (h) => { _asTreeHidden = h; try { localStorage.setItem('as_tree_hidden', h ? '1' : '0'); } catch {} pageAssignments(); };
  const hideBtn = el('span', { title: 'Ẩn cây phòng ban cho rộng màn hình', style: 'float:right;cursor:pointer;font-weight:700;color:#6b7280' }, '◀ Ẩn');
  hideBtn.onclick = () => setTreeHidden(true);
  let side, deptBar = null;
  if (!_asTreeHidden) side = el('div', { class: 'panel emp-side' }, el('div', { class: 'emp-side-h' }, 'Phòng ban', hideBtn), tree);
  else {
    // Cây đang ẩn → dải hẹp ĐÚNG CHỖ cây cũ, có nút ▶ Hiện; thêm ô chọn phòng ban gọn phía trên bảng
    const showBtn = el('div', { class: 'as-mini-btn', title: 'Hiện lại cây phòng ban' }, '▶', el('span', {}, 'Hiện'));
    side = el('div', { class: 'panel as-side-mini', title: 'Hiện lại cây phòng ban' }, showBtn, el('div', { class: 'as-mini-v' }, 'Phòng ban'));
    side.onclick = () => setTreeHidden(false);
    const dSel = el('select', { style: 'width:auto;min-width:170px;padding:6px 10px' },
      el('option', { value: '*' }, `Tất cả phòng ban (${countOf('*')})`), ...depts.map((d) => el('option', { value: d }, `${d} (${countOf(d)})`)),
      ...(countOf('') > 0 ? [el('option', { value: '' }, `(Chưa có phòng ban) (${countOf('')})`)] : []));
    dSel.value = _asDept;
    dSel.onchange = () => { if (!asLeaveOk()) { dSel.value = _asDept; return; } _asDept = dSel.value; pageAssignments(); };
    deptBar = el('div', { style: 'display:flex;gap:8px;align-items:center;margin-bottom:10px' }, el('span', { style: 'font-size:13px;color:var(--muted)' }, 'Phòng ban:'), dSel);
  }

  const selSet = _asDept === '*' ? null : descOf(_asDept);   // phòng đang chọn + các phòng cấp dưới
  const inDept = (e) => !selSet || selSet.has(e.department || '');
  const emps = data.employees.filter(inDept);
  const deptLabel = _asDept === '*' ? 'tất cả phòng ban' : _asDept === '' ? 'nhóm chưa có phòng ban' : `phòng "${_asDept}"`;
  const main = el('div', { class: 'emp-main' }, deptBar);
  const headTools = [];   // nút đặt ngay trên dòng tiêu đề (bảng Excel: tiết kiệm chiều cao)

  /* ================= TRANG "THÊM" (kiểu ZKBio) =================
   * Trái: chọn đối tượng — nhân viên (bấm phòng ban → tick người, cộng dồn qua nhiều phòng) hoặc phòng ban (tick trên cây).
   * Giữa: danh sách "Đã chọn N mục" (bỏ từng mục bằng ×). Phải: ngày bắt đầu/kết thúc + chọn 1 ca hoặc 1 lịch trình. */
  if (_asAdd && canEdit) {
    const isDept = _asAdd === 'dept', isTemp = _asAdd === 'temp';
    let schedules = [], ios = [];
    try { schedules = (await api('/admin/schedules')).rows || []; } catch {}
    try { ios = (await api('/admin/inout-schedules')).rows || []; } catch {}
    const back = () => { _asAdd = null; pageAssignments(); };
    const ioDef = ios.find((x) => x.is_default);
    const ioSel = el('select', { style: 'width:100%' }, el('option', { value: '' }, ioDef ? `Mặc định — ${ioDef.name} (${IO_RULE_NAME[ioDef.rule] || ioDef.rule})` : 'Mặc định — giờ đầu là vào, giờ cuối là ra'),
      ...ios.map((x) => el('option', { value: String(x.id) }, `${x.name} — ${IO_RULE_NAME[x.rule] || x.rule}`)));

    // ----- Phải: ngày + chọn ca / lịch trình -----
    const fromI = el('input', { type: 'date', value: todayVN() });
    const toI = el('input', { type: 'date', value: isTemp ? todayVN() : '' });
    const skipOff = el('input', { type: 'checkbox', style: 'width:auto', checked: '' });
    const pickSearch = el('input', { placeholder: isTemp ? 'Tên ca / lịch trình' : 'Tên lịch trình' });
    let picked = null;   // 'shift:ID' | 'schedule:ID'
    const items = [
      // Gán cho NV / phòng ban: CHỈ chọn lịch trình ca làm việc (lịch trình đã chứa ca). Lịch tạm thời vẫn chọn được 1 ca lẻ.
      ...(isTemp ? data.shifts.map((s) => ({ key: 'shift:' + s.id, name: s.name, kind: 'Ca làm việc', info: `${s.start_time} – ${s.end_time}` })) : []),
      ...schedules.map((w) => ({ key: 'schedule:' + w.id, name: w.name, kind: (w.unit || 'auto') === 'auto' ? 'Lịch trình · tự dò theo giờ' : `Lịch trình · ${SCH_UNIT[w.unit]} · chu kỳ ${w.cycle || 1}`, info: (w.shifts || []).map((x) => x.name).join(', ') || 'chưa có ca' })),
    ];
    if (isTemp) items.push({ key: 'off:0', name: '🛌 Nghỉ', kind: 'Ngày nghỉ', info: 'cho nghỉ các ngày đã chọn' });
    const pickTb = el('tbody');
    const renderPick = () => {
      pickTb.innerHTML = '';
      const q = pickSearch.value.trim().toLowerCase();
      const list = items.filter((it) => !q || it.name.toLowerCase().includes(q));
      if (!list.length) pickTb.append(el('tr', {}, el('td', { colspan: 4 }, el('div', { class: 'empty' }, items.length ? 'Không tìm thấy.' : (isTemp ? 'Chưa có ca làm việc nào. Khai báo ở mục Ca làm trước.' : 'Chưa có lịch trình ca làm việc nào. Tạo ở Ca làm › 3. Lịch trình ca làm việc (lịch trình có thể chỉ gồm 1 ca).')))));
      for (const it of list) {
        const rd = el('input', { type: 'radio', name: 'as-pick', style: 'width:auto', ...(picked === it.key ? { checked: '' } : {}) });
        const tr = el('tr', { style: 'cursor:pointer' + (picked === it.key ? ';background:#f0fdf4' : '') }, el('td', {}, rd), el('td', {}, el('b', {}, it.name)), el('td', {}, it.kind), el('td', { style: 'color:var(--muted)' }, it.info));
        tr.onclick = () => { picked = it.key; renderPick(); };
        pickTb.append(tr);
      }
    };
    pickSearch.oninput = renderPick; renderPick();
    const pickTbl = el('table', { class: 'data emp-compact' }, el('thead', {}, el('tr', {}, el('th', {}, ''), el('th', {}, 'Tên'), el('th', {}, 'Loại'), el('th', {}, 'Giờ / các ca'))), pickTb);
    const right = el('div', { class: 'panel', style: 'padding:16px' },
      ...(isTemp ? [
        el('div', { class: 'as-form-row' }, el('label', {}, el('span', { style: 'color:#dc2626' }, '* '), 'Từ ngày:'), fromI),
        el('div', { class: 'as-form-row' }, el('label', {}, el('span', { style: 'color:#dc2626' }, '* '), 'Đến ngày:'), toI),
        el('label', { style: 'display:flex;align-items:center;gap:8px;font-weight:600;color:var(--ink);margin:0 0 6px 130px' }, skipOff, 'Bỏ qua ngày nghỉ'),
        el('div', { class: 'map-hint', style: 'margin:0 0 12px' }, 'Bỏ qua ngày nghỉ: không tạo lịch tạm thời vào ngày cuối tuần, ngày lễ, và ngày để trống trong lịch trình ca đã chọn.'),
        el('label', {}, 'Ca làm việc / Lịch trình ca làm việc áp dụng tạm thời'),
      ] : [
        el('div', { class: 'as-form-row' }, el('label', {}, el('span', { style: 'color:#dc2626' }, '* '), 'Ngày bắt đầu:'), fromI),
        el('div', { class: 'as-form-row' }, el('label', {}, 'Ngày kết thúc:'), toI),
        el('div', { class: 'map-hint', style: 'margin:0 0 12px' }, 'Để trống ngày kết thúc = áp dụng không thời hạn.'),
        el('div', { style: 'margin-bottom:12px' }, el('label', {}, 'Lịch trình vào ra (cách xác định VÀO / RA)'), ioSel,
          ios.length ? '' : el('div', { class: 'map-hint', style: 'margin-top:4px' }, 'Chưa khai lịch trình vào ra nào (mục 2. Lịch trình vào ra) → dùng "giờ đầu là vào, giờ cuối là ra".')),
        el('label', {}, 'Lịch trình ca làm việc'),
      ]),
      el('div', { style: 'display:flex;gap:8px;margin-bottom:10px' }, pickSearch),
      el('div', { class: 'tbl-scroll', style: 'max-height:calc(100vh - 430px);overflow:auto' }, pickTbl));

    // ----- Giữa: danh sách đã chọn -----
    const sel = new Map();   // key → nhãn (NV: id → "Tên (mã)"; phòng ban: tên → tên)
    const selHead = el('b', {}, 'Đã chọn 0 mục');
    const selBox = el('div', { class: 'as-sel-list' });
    let syncLeft = () => {};
    const renderSel = () => {
      selHead.textContent = `Đã chọn ${sel.size} mục`;
      selBox.innerHTML = '';
      for (const [k, lab] of sel) {
        const x = el('span', { class: 'as-x', title: 'Bỏ chọn' }, '✕');
        x.onclick = () => { sel.delete(k); renderSel(); syncLeft(); };
        selBox.append(el('div', { class: 'as-sel-item' }, el('span', {}, (isDept || (typeof k === 'string' && k.startsWith('d:')) ? '📁 ' : '👤 ') + lab), x));
      }
    };
    const clearBtn = el('span', { class: 'as-x', title: 'Bỏ chọn tất cả', style: 'font-size:15px' }, '🗑');
    clearBtn.onclick = () => { sel.clear(); renderSel(); syncLeft(); };
    const selCol = el('div', { class: 'as-col' }, el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px' }, selHead, clearBtn), selBox);

    // ----- Trái: cây phòng ban (+ danh sách nhân viên của phòng đang bấm) -----
    let leftCols;
    if (isTemp) {
      // Lịch tạm thời: tick được CẢ phòng ban (ô tick trên cây) lẫn TỪNG nhân viên (bấm tên phòng → tick người)
      const incl = el('input', { type: 'checkbox', style: 'width:auto', checked: '' });
      let curDept = nodes[0] ? nodes[0].name : '';
      const empSearch = el('input', { placeholder: 'Tên hoặc mã nhân viên', style: 'margin-bottom:8px' });
      const treeBox = el('div', { class: 'emp-tree', style: 'padding:0' });
      const listHead = el('label', { style: 'display:flex;align-items:center;gap:8px;font-weight:700;color:var(--ink);margin-bottom:6px' });
      const listBox = el('div', { class: 'as-sel-list' });
      const lab = (e) => `${e.full_name} (${e.code})`;
      const shown = () => {
        const q = empSearch.value.trim().toLowerCase();
        if (q) return data.employees.filter((e) => e.full_name.toLowerCase().includes(q) || String(e.code).toLowerCase().includes(q));
        if (curDept === '*') return data.employees;   // "Tất cả nhân viên"
        const set = descOf(curDept);
        return data.employees.filter((e) => set.has(e.department || ''));
      };
      const draw = () => {
        treeBox.innerHTML = '';
        { const allRow = el('div', { class: 'tn' + (curDept === '*' && !empSearch.value.trim() ? ' on' : ''), style: 'padding-left:6px;gap:8px;font-weight:700', title: 'Xem toàn bộ nhân viên rồi tích "Chọn tất cả"' }, el('span', { class: 'nm' }, '👥 Tất cả nhân viên'), el('span', { class: 'ct' }, String(data.employees.length)));
          allRow.onclick = () => { curDept = '*'; empSearch.value = ''; draw(); }; treeBox.append(allRow); }
        for (const n of nodes) {
          const cb = el('input', { type: 'checkbox', style: 'width:auto', title: 'Tick = chọn cả phòng ban', ...(sel.has('d:' + n.name) ? { checked: '' } : {}) });
          cb.onclick = (ev) => ev.stopPropagation();
          cb.onchange = () => { const names = incl.checked ? [...descOf(n.name)] : [n.name]; for (const nm of names) { if (cb.checked) sel.set('d:' + nm, nm); else sel.delete('d:' + nm); } renderSel(); draw(); };
          const row = el('div', { class: 'tn' + (curDept === n.name && !empSearch.value.trim() ? ' on' : ''), style: 'padding-left:' + (6 + n.depth * 16) + 'px;gap:8px', title: 'Bấm tên để xem nhân viên của phòng' }, cb, el('span', { class: 'nm' }, '📁 ' + n.name), el('span', { class: 'ct' }, String(countOf(n.name))));
          row.onclick = () => { curDept = n.name; empSearch.value = ''; draw(); };
          treeBox.append(row);
        }
        const list = shown();
        const all = el('input', { type: 'checkbox', style: 'width:auto', ...(list.length && list.every((e) => sel.has(e.id)) ? { checked: '' } : {}) });
        all.onchange = () => { for (const e of list) { if (all.checked) sel.set(e.id, lab(e)); else sel.delete(e.id); } renderSel(); draw(); };
        listHead.innerHTML = ''; listHead.append(all, `Chọn tất cả (${list.length})`);
        listBox.innerHTML = '';
        if (!list.length) listBox.append(el('div', { class: 'empty', style: 'padding:14px 4px' }, 'Không có nhân viên.'));
        for (const e of list) {
          const cb = el('input', { type: 'checkbox', style: 'width:auto', ...(sel.has(e.id) ? { checked: '' } : {}) });
          cb.onchange = () => { if (cb.checked) sel.set(e.id, lab(e)); else sel.delete(e.id); renderSel(); draw(); };
          listBox.append(el('label', { class: 'as-sel-item', style: 'justify-content:flex-start;gap:8px;cursor:pointer' }, cb, el('span', {}, '👤 ' + e.full_name), el('span', { style: 'color:#9ca3af;font-size:12px' }, e.code)));
        }
      };
      empSearch.oninput = draw;
      syncLeft = draw; draw();
      leftCols = [el('div', { class: 'as-col' }, empSearch, el('label', { style: 'display:flex;align-items:center;gap:8px;font-weight:600;color:var(--ink);margin-bottom:8px' }, incl, 'Bao gồm cấp dưới'), treeBox),
        el('div', { class: 'as-col' }, listHead, listBox), selCol];
      var getBody = () => ({ url: '/admin/assignments/bulk', body: { employee_ids: [...sel.keys()].filter((k) => typeof k === 'number'), departments: [...sel.keys()].filter((k) => typeof k === 'string').map((k) => k.slice(2)), include_children: incl.checked } });
    } else if (isDept) {
      const incl = el('input', { type: 'checkbox', style: 'width:auto', checked: '' });
      // TẤT CẢ PHÒNG BAN = cả công ty: kể cả phòng ban thêm sau này và nhân viên chưa xếp phòng ban (lưu là '*')
      const allCb = el('input', { type: 'checkbox', style: 'width:auto', ...(sel.has('*') ? { checked: '' } : {}) });
      allCb.onchange = () => { sel.clear(); if (allCb.checked) sel.set('*', 'Tất cả phòng ban (kể cả phòng ban thêm sau)'); renderSel(); drawTree(); };
      const treeBox = el('div', { class: 'emp-tree', style: 'padding:0' });
      const drawTree = () => {
        treeBox.innerHTML = '';
        allCb.checked = sel.has('*');
        treeBox.style.opacity = sel.has('*') ? '.45' : '';
        for (const n of nodes) {
          const cb = el('input', { type: 'checkbox', style: 'width:auto', ...(sel.has(n.name) ? { checked: '' } : {}), ...(sel.has('*') ? { disabled: '' } : {}) });
          cb.onchange = () => {
            const names = incl.checked ? [...descOf(n.name)] : [n.name];
            for (const nm of names) { if (cb.checked) sel.set(nm, nm); else sel.delete(nm); }
            renderSel(); drawTree();
          };
          treeBox.append(el('label', { class: 'tn', style: 'padding-left:' + (6 + n.depth * 18) + 'px;gap:8px' }, cb, el('span', { class: 'nm' }, '📁 ' + n.name), el('span', { class: 'ct' }, String(countOf(n.name)))));
        }
        if (!nodes.length) treeBox.append(el('div', { class: 'empty' }, 'Chưa có phòng ban. Khai báo ở mục Bộ phận.'));
      };
      syncLeft = drawTree; drawTree();
      leftCols = [el('div', { class: 'as-col', style: 'flex:1.4' },
        el('label', { style: 'display:flex;align-items:center;gap:8px;font-weight:700;color:var(--ink);margin-bottom:4px', title: 'Áp cho cả công ty: mọi phòng ban, kể cả phòng ban thêm sau này và nhân viên chưa xếp phòng ban. Phòng ban đã có lịch trình trong khoảng ngày này sẽ theo lịch mới.' }, allCb, '🏢 Tất cả phòng ban', el('span', { class: 'fhint2' }, ' (kể cả phòng ban thêm sau)')),
        el('label', { style: 'display:flex;align-items:center;gap:8px;font-weight:600;color:var(--ink);margin-bottom:8px' }, incl, 'Bao gồm cấp dưới'),
        treeBox), selCol];
      var getBody = () => ({ url: '/admin/dept-shift-assignments', body: { departments: [...sel.keys()], include_children: incl.checked } });
    } else {
      let curDept = _asDept;   // đang xem "Tất cả phòng ban" → mở sẵn "Tất cả nhân viên"
      const empSearch = el('input', { placeholder: 'Tên hoặc mã nhân viên', style: 'margin-bottom:8px' });
      const treeBox = el('div', { class: 'emp-tree', style: 'padding:0' });
      const listHead = el('label', { style: 'display:flex;align-items:center;gap:8px;font-weight:700;color:var(--ink);margin-bottom:6px' });
      const listBox = el('div', { class: 'as-sel-list' });
      const shown = () => {
        const q = empSearch.value.trim().toLowerCase();
        if (q) return data.employees.filter((e) => e.full_name.toLowerCase().includes(q) || String(e.code).toLowerCase().includes(q));   // tìm trên toàn công ty
        if (curDept === '*') return data.employees;   // "Tất cả nhân viên"
        const set = descOf(curDept);
        return data.employees.filter((e) => set.has(e.department || ''));
      };
      const lab = (e) => `${e.full_name} (${e.code})`;
      const draw = () => {
        treeBox.innerHTML = '';
        const tn = (key, text, depth) => { const d = el('div', { class: 'tn' + (curDept === key && !empSearch.value.trim() ? ' on' : ''), style: 'padding-left:' + (6 + depth * 16) + 'px' + (key === '*' ? ';font-weight:700' : '') }, el('span', { class: 'nm' }, (key === '*' ? '👥 ' : '📁 ') + text), el('span', { class: 'ct' }, String(key === '*' ? data.employees.length : countOf(key)))); d.onclick = () => { curDept = key; empSearch.value = ''; draw(); }; return d; };
        treeBox.append(tn('*', 'Tất cả nhân viên', 0));   // chọn cả công ty 1 lần: bấm dòng này rồi tích "Chọn tất cả"
        for (const n of nodes) treeBox.append(tn(n.name, n.name, n.depth));
        if (data.employees.some((e) => !(e.department || ''))) treeBox.append(tn('', '(Chưa có phòng ban)', 0));
        const list = shown();
        const all = el('input', { type: 'checkbox', style: 'width:auto', ...(list.length && list.every((e) => sel.has(e.id)) ? { checked: '' } : {}) });
        all.onchange = () => { for (const e of list) { if (all.checked) sel.set(e.id, lab(e)); else sel.delete(e.id); } renderSel(); draw(); };
        listHead.innerHTML = ''; listHead.append(all, `Chọn tất cả (${list.length})`);
        listBox.innerHTML = '';
        if (!list.length) listBox.append(el('div', { class: 'empty', style: 'padding:14px 4px' }, 'Không có nhân viên.'));
        for (const e of list) {
          const cb = el('input', { type: 'checkbox', style: 'width:auto', ...(sel.has(e.id) ? { checked: '' } : {}) });
          cb.onchange = () => { if (cb.checked) sel.set(e.id, lab(e)); else sel.delete(e.id); renderSel(); draw(); };
          listBox.append(el('label', { class: 'as-sel-item', style: 'justify-content:flex-start;gap:8px;cursor:pointer' }, cb, el('span', {}, '👤 ' + e.full_name), el('span', { style: 'color:#9ca3af;font-size:12px' }, e.code)));
        }
      };
      empSearch.oninput = draw;
      syncLeft = draw; draw();
      leftCols = [el('div', { class: 'as-col' }, empSearch, treeBox), el('div', { class: 'as-col' }, listHead, listBox), selCol];
      var getBody = () => ({ url: '/admin/shift-assignments', body: { scope: 'emp', employee_ids: [...sel.keys()], shift_type: 'fixed' } });
    }
    renderSel();

    const saveBtn = el('button', { class: 'btn green' }, 'Lưu');
    saveBtn.onclick = async () => {
      if (!sel.size) return toast(isTemp ? 'Chưa tick phòng ban / nhân viên nào' : isDept ? 'Chưa tick phòng ban nào' : 'Chưa tick nhân viên nào', 'err');
      if (!fromI.value) return toast('Chọn ngày bắt đầu', 'err');
      if (isTemp && !toI.value) return toast('Chọn đến ngày', 'err');
      if (toI.value && toI.value < fromI.value) return toast('Ngày kết thúc phải sau ngày bắt đầu', 'err');
      if (!picked) return toast(isTemp ? 'Chọn 1 ca hoặc 1 lịch trình ở bảng bên phải' : 'Chọn 1 lịch trình ở bảng bên phải', 'err');
      const [kind, id] = picked.split(':');
      const g = getBody();
      let body;
      if (isTemp) {
        body = { ...g.body, from: fromI.value, to: toI.value, skip_off: skipOff.checked };
        if (kind === 'off') body.is_off = true; else if (kind === 'shift') body.shift_id = +id; else body.work_schedule_id = +id;
      } else {
        body = { ...g.body, mode: kind, from_date: fromI.value, to_date: toI.value || null, merge_rule: 'default', inout_schedule_id: ioSel.value ? +ioSel.value : null };
        if (kind === 'shift') body.shift_id = +id; else body.work_schedule_id = +id;
      }
      saveBtn.disabled = true;
      try {
        const r = await api(g.url, { method: 'POST', body });
        if (isTemp) {
          toast(`Đã tạo ${r.count} dòng lịch tạm thời cho ${r.employees} nhân viên` + (r.skippedOff ? ` · bỏ qua ${r.skippedOff} ngày nghỉ` : '') + (r.keptSheet ? ` · ${r.keptSheet} ngày đã nhập ở bảng Excel vẫn được ưu tiên` : ''), r.count ? 'ok' : 'err');
          _asStart = fromI.value;
        } else toast(`Đã lưu cho ${r.count} ${isDept ? 'phòng ban' : 'nhân viên'}`, 'ok');
        back();
      } catch (e) { toast(e.message, 'err'); saveBtn.disabled = false; }
    };
    const bar = el('div', { class: 'panel', style: 'padding:10px 16px;display:flex;align-items:center;gap:14px;margin-bottom:14px' },
      btnSm('‹ Quay lại', back, 'ghost'), el('span', { style: 'color:#d1d5db' }, '|'), el('b', {}, isTemp ? 'Thêm lịch trình tạm thời' : isDept ? 'Gán ca cho phòng ban' : 'Gán ca cho nhân viên'), el('span', { style: 'flex:1' }), saveBtn);
    setMain(head(pageTitle), tabBar, bar, el('div', { class: 'as-add' }, el('div', { class: 'panel as-add-left' }, ...leftCols), right));
    return;
  }


  // Thanh chuyển tháng (dùng cho Xem lịch / Đổi ca tạm thời / Excel)
  const monthNav = () => {
    const mI = el('input', { type: 'month', value: curMonth, style: 'width:150px' });
    const go = (d) => { if (!asLeaveOk()) return; _asStart = d; pageAssignments(); };
    mI.onchange = () => { if (mI.value) go(mI.value + '-01'); };
    return el('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' },
      btnSm('‹', () => go(addMonths(_asStart, -1)), 'ghost'), mI,
      btnSm('›', () => go(addMonths(_asStart, 1)), 'ghost'),
      btnSm('Tháng này', () => go(todayVN()), 'ghost'));
  };
  // Chọn khoảng ngày cho Bảng Excel: ‹ [từ ngày] → [đến ngày] › · Tháng này
  const rangeNav = () => {
    const f0 = days[0], t0 = days[days.length - 1];
    const fI = el('input', { type: 'date', value: f0, style: 'width:126px', title: 'Từ ngày' });
    const tI = el('input', { type: 'date', value: t0, style: 'width:126px', title: 'Đến ngày' });
    const reset = () => { fI.value = f0; tI.value = t0; };
    const apply = (which) => {
      let f = fI.value, t = tI.value;
      if (!f || !t) return;
      // chọn Từ ngày sau Đến ngày → Đến ngày dời về cuối tháng của Từ ngày; chọn Đến ngày trước Từ ngày → Từ ngày về đầu tháng
      if (t < f) { if (which === 'from') t = monthDaysArr(f.slice(0, 7)).slice(-1)[0]; else f = t.slice(0, 8) + '01'; }
      if (Math.round((Date.parse(t) - Date.parse(f)) / 86400000) + 1 > 62) { toast('Chọn tối đa 62 ngày', 'err'); reset(); return; }
      if (!asLeaveOk()) { reset(); return; }
      const wholeMonth = f.slice(8) === '01' && t === monthDaysArr(f.slice(0, 7)).slice(-1)[0];
      _asRange = wholeMonth ? null : { from: f, to: t }; _asStart = f; pageAssignments();
    };
    fI.onchange = () => apply('from'); tI.onchange = () => apply('to');
    const go = (n) => { if (!asLeaveOk()) return; _asRange = null; _asStart = addMonths(f0, n); pageAssignments(); };
    const prev = btnSm('‹', () => go(-1), 'ghost'); prev.title = 'Tháng trước';
    const next = btnSm('›', () => go(1), 'ghost'); next.title = 'Tháng sau';
    return el('div', { style: 'display:flex;gap:6px;align-items:center' }, prev, fI, el('span', { style: 'color:var(--muted)' }, '→'), tI, next,
      btnSm('Tháng này', () => { if (!asLeaveOk()) return; _asRange = null; _asStart = todayVN(); pageAssignments(); }, 'ghost'));
  };
  const shiftOpts = (sel, autoLabel) => [
    el('option', { value: '', ...(sel === '' ? { selected: '' } : {}) }, autoLabel),
    ...data.shifts.map((s) => el('option', { value: String(s.id), ...(String(sel) === String(s.id) ? { selected: '' } : {}) }, `${s.name} (${s.start_time}-${s.end_time})`)),
    el('option', { value: 'off', ...(sel === 'off' ? { selected: '' } : {}) }, '🛌 Nghỉ'),
  ];

  /* ================= 1) LỊCH TRÌNH NHÂN VIÊN ================= */
  if (_asTab === 'list') {
    const today = todayVN();
    const empById = new Map(emps.map((e) => [e.id, e]));
    const searchI = el('input', { placeholder: 'Tên nhân viên, mã nhân viên', value: _asSearch, style: 'width:240px' });
    const tbl = el('table', { class: 'data' });
    const selAll = el('input', { type: 'checkbox', style: 'width:auto', title: 'Chọn / bỏ tất cả' });
    tbl.append(el('thead', {}, el('tr', {}, el('th', {}, selAll), el('th', {}, 'Phòng ban'), el('th', {}, 'Mã nhân viên'), el('th', {}, 'Tên nhân viên'),
      el('th', {}, 'Ca / lịch trình ca làm việc'), el('th', {}, 'Lịch trình vào ra'), el('th', {}, 'Ngày bắt đầu'), el('th', {}, 'Ngày kết thúc'), el('th', {}, 'Thao tác'))));
    const tb = el('tbody'); tbl.append(tb);
    const renderRows = () => {
      tb.innerHTML = '';
      const q = _asSearch.trim().toLowerCase();
      const rows = ranged.filter((r) => empById.has(r.employee_id) && (!q || (r.emp_name || '').toLowerCase().includes(q) || String(r.emp_code || '').toLowerCase().includes(q)))
        .sort((a, b) => (a.department || '').localeCompare(b.department || '', 'vi') || (a.emp_name || '').localeCompare(b.emp_name || '', 'vi') || (a.from_date < b.from_date ? 1 : -1));
      if (!rows.length) tb.append(el('tr', {}, el('td', { colspan: 9 }, el('div', { class: 'empty' }, '📭 Trống — chưa nhân viên nào ở đây được gán ca riêng. Bấm "+ Thêm" để gán.'))));
      for (const r of rows) {
        const expired = r.to_date && r.to_date < today, future = r.from_date > today;
        tb.append(el('tr', {}, el('td', {}, el('input', { type: 'checkbox', class: 'as-pick', style: 'width:auto', 'data-sa': r.id })),
          el('td', {}, r.department || ''), el('td', {}, r.emp_code || ''), el('td', {}, el('b', {}, r.emp_name || '')),
          el('td', {}, el('span', { style: expired ? 'color:#9ca3af' : 'color:#0f766e;font-weight:700' }, r.mode === 'schedule' ? '📋 ' + (r.schedule_name || 'Lịch trình') : (r.shift_name || 'Ca')),
            expired ? el('span', { class: 'chip', style: 'margin-left:6px' }, 'đã hết hạn') : future ? el('span', { class: 'chip', style: 'margin-left:6px;background:#eff6ff;color:#1d4ed8' }, 'sắp áp dụng') : ''),
          el('td', { style: 'color:var(--muted)' }, r.inout_name || 'Mặc định'),
          el('td', {}, fmtD(r.from_date)), el('td', {}, r.to_date ? fmtD(r.to_date) : '—'),
          el('td', {}, canEdit ? btnSm('Sửa', () => editAssignModal('emp', r, data.shifts)) : '')));
      }
      selAll.checked = false;
    };
    searchI.oninput = () => { _asSearch = searchI.value; renderRows(); };
    selAll.onchange = () => { tb.querySelectorAll('.as-pick').forEach((c) => { c.checked = selAll.checked; }); };
    const addBtn = canEdit ? el('button', { class: 'btn' }, '+ Thêm') : null;
    if (addBtn) addBtn.onclick = () => { _asAdd = 'emp'; pageAssignments(); };
    const delBtn = canEdit ? btnSm('🗑 Xoá', async () => {
      const ids = [...tb.querySelectorAll('.as-pick:checked')].map((c) => +c.dataset.sa);
      if (!ids.length) return toast('Chưa tick dòng nào để xoá', 'err');
      if (!confirm(`Xoá ${ids.length} lịch trình đã chọn?`)) return;
      try { const r = await api('/admin/shift-assignments/delete', { method: 'POST', body: { ids } }); toast(`Đã xoá ${r.count} lịch trình`, 'ok'); pageAssignments(); } catch (e) { toast(e.message, 'err'); }
    }, 'ghost') : null;
    renderRows();
    const noOwn = emps.filter((e) => !ranged.some((r) => r.employee_id === e.id && r.from_date <= today && (!r.to_date || r.to_date >= today))).length;
    main.append(
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px' }, searchI, el('span', { style: 'flex:1' }), addBtn, delBtn, btnSm('⟳', () => pageAssignments(), 'ghost')),
      el('div', { class: 'panel tbl-scroll' }, tbl),
      el('div', { class: 'map-hint', style: 'margin-top:10px' }, `${emps.length} nhân viên thuộc ${deptLabel}, trong đó ${noOwn} người không có lịch trình riêng đang hiệu lực — những người này theo Lịch trình phòng ban (nếu phòng có), không thì theo ca mặc định ở hồ sơ hoặc tự dò ca theo giờ chấm. Thứ tự ưu tiên: Lịch trình tạm thời → Lịch trình nhân viên → Lịch trình phòng ban.`));
  }

  /* ================= 2) BẢNG PHÂN CA (kiểu Excel) =================
   * Lưới NV × ngày: gõ mã ca thẳng vào ô, quét chọn nhiều ô rồi gõ để điền cả vùng, copy/dán với Excel,
   * Delete = bỏ ca đã nhập (về lịch đã phân), Ctrl+Z = hoàn tác. Ô sửa chưa lưu tô vàng → bấm Lưu.
   * Chữ đậm = ca nhập riêng cho ngày đó; chữ xám = ca đang theo lịch đã phân (không cần nhập lại). */
  if (_asTab === 'sheet') {
    // Ô tìm nhân viên (tên / mã) — lọc dòng ngay trên dữ liệu đã tải (công ty đông người)
    const sq = _asSheetQ.trim().toLowerCase();
    const sheetEmps = sq ? emps.filter((e) => (e.full_name || '').toLowerCase().includes(sq) || String(e.code || '').toLowerCase().includes(sq)) : emps;
    const searchS = el('input', { placeholder: '🔍 Tìm NV (tên / mã)', value: _asSheetQ, style: 'width:140px', title: 'Gõ tên hoặc mã nhân viên để lọc' });
    let sqT = null;
    searchS.oninput = () => { clearTimeout(sqT); sqT = setTimeout(() => { _asSheetQ = searchS.value; _asReuse = true; _asFocusSearch = true; pageAssignments(); }, 250); };
    const codeOfShift = new Map(data.shifts.map((s) => [s.id, (s.code || '').trim() || s.name]));
    const canon = new Map();   // CHỮ HOA (mã hoặc tên ca) → mã chuẩn để hiển thị
    for (const s of data.shifts) { const c = (s.code || '').trim() || s.name; canon.set(s.name.trim().toUpperCase(), c); }
    for (const s of data.shifts) { const c = (s.code || '').trim(); if (c) canon.set(c.toUpperCase(), c); }
    const OFF_WORDS = ['NGHỈ', 'NGHI', 'OFF', 'N', 'X'], CLEAR_WORDS = ['-', 'AUTO', 'TĐ', 'TU DONG', 'TỰ ĐỘNG'];
    // Chuẩn hoá chữ người dùng gõ → { v: giá trị lưu ('' = bỏ ca ngày đó), bad: true nếu sai mã ca }
    const norm = (raw) => {
      const t = String(raw ?? '').trim(); const T = t.toUpperCase();
      if (!t || CLEAR_WORDS.includes(T)) return { v: '' };
      if (OFF_WORDS.includes(T)) return { v: 'NGHỈ' };
      if (canon.has(T)) return { v: canon.get(T) };
      const parts = T.split(/[+,/;]/).map((x) => x.trim()).filter(Boolean);
      if (parts.length && parts.every((p) => canon.has(p))) return { v: [...new Set(parts.map((p) => canon.get(p)))].join('+') };
      return { v: t, bad: true };
    };
    // Giá trị ĐÃ NHẬP ở bảng này (lớp ưu tiên cao nhất). Lịch trình tạm thời / ca phần mềm tự tìm nằm bên dưới (sheetEmps[r].grid).
    const saved = new Map();
    for (const a of data.assignments) {
      if (a.source === 'temp') continue;
      const k = a.employee_id + '|' + a.work_date;
      if (a.is_off) saved.set(k, 'NGHỈ');
      else if (saved.get(k) !== 'NGHỈ') { const c = codeOfShift.get(a.shift_id); if (c) saved.set(k, saved.has(k) ? saved.get(k) + '+' + c : c); }
    }
    const R = sheetEmps.length, C = days.length;
    const keyOf = (r, c) => sheetEmps[r].id + '|' + days[c];
    const cellEls = [];   // [r][c] → td
    const curVal = (r, c) => { const k = keyOf(r, c); return _asDirty.has(k) ? _asDirty.get(k) : (saved.get(k) || ''); };
    const paint = (r, c) => {
      const td = cellEls[r][c], k = keyOf(r, c), dirty = _asDirty.has(k);
      const v = curVal(r, c), g = (sheetEmps[r].grid || [])[c] || {};
      td.textContent = v || g.l || '';   // chưa nhập ở bảng này → hiện (chữ mờ) ca phần mềm tự tìm: lịch tạm thời / lịch đã gán / ca dò theo giờ chấm
      // Công tắc "hỗ trợ nhiều ca/ngày" (Cài đặt) bật: ô gán ≥ 2 ca có dấu ✓ đủ ca · ✗ thiếu ca · ⚠ chồng giờ + chú thích từng ca khi rê chuột
      const mi = data.multiAssist && !dirty && data.multi ? data.multi[k] : null;
      if (mi && mi.mark) td.dataset.mk = mi.mark; else delete td.dataset.mk;
      td.className = 'c' + (dirty ? ' dirty' : '') + (v ? (v === 'NGHỈ' ? ' off' : ' ex') : ' ph' + (g.k === 'temp' ? ' tmp' : g.k === 'found' ? ' fnd' : '')) + (dirty && norm(v).bad ? ' bad' : '') + (weekdayVN(days[c]) === 7 ? ' sun' : weekdayVN(days[c]) === 6 ? ' sat' : '') + (mi && mi.mark ? ' mk' + ({ '✓': 'ok', '✗': 'no', '⚠': 'wn' }[mi.mark]) : '');
      const under = g.k === 'none' ? 'tự động theo giờ chấm' : g.k === 'temp' ? (g.t || g.l) : g.k === 'found' ? g.t : 'theo lịch đã gán: ' + (g.t || g.l || '');
      td.title = `${sheetEmps[r].full_name} — ${fmtD(days[c])}: ` + (v ? (v === 'NGHỈ' ? 'Nghỉ' : 'ca ' + v) + (dirty ? ' (chưa lưu)' : ' (nhập ở bảng này — ưu tiên cao nhất)') + `\nBấm "↺ Về tự động" để bỏ → ${under}` : (dirty ? '↺ về tự động (chưa lưu) → ' : '') + under)
        + (mi ? '\n' + mi.shifts.map((x) => `• ${x.code} ${x.start}-${x.end}: ${x.status === 'ok' ? '✓ đã có công' : x.status === 'missing' ? '✗ chưa có công (không quẹt trong ca này)' : 'chưa có dữ liệu chấm'}`).join('\n')
          + (mi.overlap.length ? '\n⚠ Chồng giờ: ' + mi.overlap.map((o) => o.join(' & ')).join(', ') + ' — khi tính công chỉ 1 trong 2 ca được chọn' : '')
          + (mi.twoPunch ? '\n‼ Chỉ có 1 dòng công mà giờ vào–ra phủ cả ca kia: có thể nhân viên chỉ quẹt 2 lần (thiếu quẹt giữa ngày), công vẫn tính như 1 ca' : '') : '');
    };

    // ----- vùng chọn -----
    let sel = { ar: 0, ac: 0, r: 0, c: 0 };   // (ar,ac) = ô neo; (r,c) = góc còn lại
    let painted = [];
    const rect = () => ({ r1: Math.min(sel.ar, sel.r), r2: Math.max(sel.ar, sel.r), c1: Math.min(sel.ac, sel.c), c2: Math.max(sel.ac, sel.c) });
    const drawSel = () => {
      for (const td of painted) td.classList.remove('sel', 'anchor');
      painted = [];
      if (!R) return;
      const q = rect();
      for (let r = q.r1; r <= q.r2; r++) for (let c = q.c1; c <= q.c2; c++) { cellEls[r][c].classList.add('sel'); painted.push(cellEls[r][c]); }
      cellEls[sel.ar][sel.ac].classList.add('anchor');
      const n = (q.r2 - q.r1 + 1) * (q.c2 - q.c1 + 1);
      selInfo.textContent = n > 1 ? `Đang chọn ${n} ô (${q.r2 - q.r1 + 1} nhân viên × ${q.c2 - q.c1 + 1} ngày)` : `${sheetEmps[sel.ar].full_name} · ${fmtD(days[sel.ac])}`;
    };
    const setSel = (r, c, extend) => {
      r = Math.max(0, Math.min(R - 1, r)); c = Math.max(0, Math.min(C - 1, c));
      if (extend) { sel.r = r; sel.c = c; } else sel = { ar: r, ac: c, r, c };
      drawSel();
      cellEls[r][c].scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };

    // ----- sửa + hoàn tác -----
    const undo = [];
    const syncBar = () => {
      const bad = [..._asDirty.values()].filter((v) => norm(v).bad).length;
      // chữ ngắn + độ rộng cố định → thanh nút không nhảy dòng khi số ô sửa thay đổi
      saveBtn.textContent = _asDirty.size ? `💾 Lưu (${_asDirty.size})` : '💾 Lưu';
      saveBtn.title = _asDirty.size ? `Lưu ${_asDirty.size} ô đã sửa (Ctrl+S)` : 'Chưa có ô nào sửa';
      saveBtn.disabled = !_asDirty.size;
      undoBtn.disabled = !undo.length;
      warn.textContent = bad ? `⚠ ${bad} ô sai mã ca (chữ đỏ) — sửa lại rồi mới lưu được` : '';
    };
    // changes: [[r, c, rawText]]
    const applyChanges = (changes) => {
      const batch = [];
      for (const [r, c, raw] of changes) {
        if (r < 0 || r >= R || c < 0 || c >= C) continue;
        const k = keyOf(r, c), n = norm(raw);
        batch.push([r, c, _asDirty.has(k), _asDirty.get(k)]);
        if (n.v === (saved.get(k) || '')) _asDirty.delete(k); else _asDirty.set(k, n.v);
        paint(r, c);
      }
      if (batch.length) undo.push(batch);
      drawSel(); syncBar();
    };
    const fillSel = (raw) => { const q = rect(); const ch = []; for (let r = q.r1; r <= q.r2; r++) for (let c = q.c1; c <= q.c2; c++) ch.push([r, c, raw]); applyChanges(ch); };
    const doUndo = () => {
      const batch = undo.pop(); if (!batch) return;
      for (const [r, c, had, val] of batch) { const k = keyOf(r, c); if (had) _asDirty.set(k, val); else _asDirty.delete(k); paint(r, c); }
      drawSel(); syncBar();
    };

    // ----- ô nhập nổi -----
    const editor = el('input', { class: 'as-editor', spellcheck: 'false', autocomplete: 'off' });
    let editing = false;
    const startEdit = (initial) => {
      if (!canEdit || !R) return;
      const td = cellEls[sel.ar][sel.ac];
      editor.style.left = td.offsetLeft + 'px'; editor.style.top = td.offsetTop + 'px';
      editor.style.width = Math.max(70, td.offsetWidth) + 'px'; editor.style.height = td.offsetHeight + 'px';
      editor.value = initial != null ? initial : curVal(sel.ar, sel.ac);
      editor.style.display = 'block'; editing = true; editor.focus();
      if (initial == null) editor.select();
    };
    const endEdit = (commit) => {
      if (!editing) return;
      editing = false; editor.style.display = 'none';
      if (commit) fillSel(editor.value);
      box.focus({ preventScroll: true });
    };
    editor.onkeydown = (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); endEdit(true); setSel(Math.max(sel.ar, sel.r) + 1 < R ? Math.min(sel.ar, sel.r) + 1 : sel.ar, sel.ac); }
      else if (ev.key === 'Tab') { ev.preventDefault(); endEdit(true); setSel(sel.ar, sel.ac + 1); }
      else if (ev.key === 'Escape') { ev.preventDefault(); endEdit(false); }
      ev.stopPropagation();
    };
    editor.onblur = () => endEdit(true);

    // ----- dựng bảng -----
    const tbl = el('table', { class: 'as-sheet' });
    const hr = el('tr', {}, el('th', { class: 'pin p0' }, 'STT'), el('th', { class: 'pin p1' }, 'Mã NV'), el('th', { class: 'pin p2' }, 'Họ tên'), el('th', { class: 'dept' }, 'Bộ phận'));
    days.forEach((d, c) => {
      const wd = weekdayVN(d);
      const th = el('th', { class: 'd' + (wd === 7 ? ' sun' : wd === 6 ? ' sat' : ''), title: 'Bấm để chọn cả cột ngày ' + fmtD(d) }, el('div', {}, d.slice(8)), el('div', { class: 'wd' }, WD[wd]));
      th.onclick = () => { if (!R) return; sel = { ar: 0, ac: c, r: R - 1, c }; drawSel(); box.focus({ preventScroll: true }); };
      hr.append(th);
    });
    tbl.append(el('thead', {}, hr));
    const tb = el('tbody'); tbl.append(tb);
    sheetEmps.forEach((e, r) => {
      const rowHead = el('td', { class: 'pin p0 rh', title: 'Bấm để chọn cả dòng' }, String(r + 1));
      rowHead.onclick = () => { sel = { ar: r, ac: 0, r, c: C - 1 }; drawSel(); box.focus({ preventScroll: true }); };
      const tr = el('tr', {}, rowHead, el('td', { class: 'pin p1' }, e.code), el('td', { class: 'pin p2', title: e.full_name }, e.full_name), el('td', { class: 'dept' }, e.department || ''));
      cellEls[r] = [];
      for (let c = 0; c < C; c++) { const td = el('td', {}); td.dataset.r = r; td.dataset.c = c; cellEls[r][c] = td; tr.append(td); }
      tb.append(tr);
    });
    if (!R) tb.append(el('tr', {}, el('td', { colspan: C + 4 }, el('div', { class: 'empty' }, 'Không có nhân viên.'))));
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) paint(r, c);

    // chuột: bấm chọn, kéo để quét vùng, bấm đúp để sửa
    let dragging = false;
    const rc = (ev) => { const td = ev.target.closest('td[data-r]'); return td ? [+td.dataset.r, +td.dataset.c] : null; };
    tbl.onmousedown = (ev) => { const p = rc(ev); if (!p || ev.button !== 0) return; if (editing) endEdit(true); dragging = true; setSel(p[0], p[1], ev.shiftKey); ev.preventDefault(); box.focus({ preventScroll: true }); };
    tbl.onmouseover = (ev) => { if (!dragging) return; const p = rc(ev); if (p) { sel.r = p[0]; sel.c = p[1]; drawSel(); } };
    _asStopDrag = () => { dragging = false; };   // 1 trình nghe mouseup chung (đăng ký 1 lần ở ngoài) gọi hàm này
    tbl.ondblclick = (ev) => { if (rc(ev)) startEdit(null); };

    const box = el('div', { class: 'panel as-sheet-box', tabindex: '0' }, tbl, editor);
    box.onkeydown = (ev) => {
      if (editing || !R) return;
      const k = ev.key, ctrl = ev.ctrlKey || ev.metaKey;
      const move = (dr, dc) => { ev.preventDefault(); if (ev.shiftKey) setSel(sel.r + dr, sel.c + dc, true); else setSel(sel.ar + dr, sel.ac + dc); };
      if (k === 'ArrowUp') move(-1, 0); else if (k === 'ArrowDown') move(1, 0); else if (k === 'ArrowLeft') move(0, -1); else if (k === 'ArrowRight') move(0, 1);
      else if (k === 'Tab') { ev.preventDefault(); setSel(sel.ar, sel.ac + (ev.shiftKey ? -1 : 1)); }
      else if (k === 'Enter' || k === 'F2') { ev.preventDefault(); startEdit(null); }
      else if ((k === 'Delete' || k === 'Backspace') && canEdit) { ev.preventDefault(); fillSel(''); }
      else if (ctrl && k.toLowerCase() === 'z') { ev.preventDefault(); doUndo(); }
      else if (ctrl && k.toLowerCase() === 'a') { ev.preventDefault(); sel = { ar: 0, ac: 0, r: R - 1, c: C - 1 }; drawSel(); }
      else if (ctrl && k.toLowerCase() === 's') { ev.preventDefault(); if (_asDirty.size) saveBtn.click(); }
      else if (!ctrl && !ev.altKey && k.length === 1 && canEdit) { ev.preventDefault(); startEdit(k); }
    };
    // copy / dán với Excel (văn bản phân cách tab + xuống dòng)
    box.addEventListener('copy', (ev) => {
      if (editing || !R) return;
      const q = rect(); const lines = [];
      for (let r = q.r1; r <= q.r2; r++) { const row = []; for (let c = q.c1; c <= q.c2; c++) { const g = (sheetEmps[r].grid || [])[c] || {}; row.push(curVal(r, c) || (g.k !== 'none' && g.k !== 'schedule' ? g.l : '')); } lines.push(row.join('\t')); }
      ev.clipboardData.setData('text/plain', lines.join('\n')); ev.preventDefault();
      toast(`Đã copy ${lines.length} dòng × ${q.c2 - q.c1 + 1} cột`, 'ok');
    });
    box.addEventListener('paste', (ev) => {
      if (editing || !R || !canEdit) return;
      const text = (ev.clipboardData.getData('text/plain') || '').replace(/\r/g, '');
      if (!text) return;
      ev.preventDefault();
      const grid = text.replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
      const q = rect(); const ch = [];
      if (grid.length === 1 && grid[0].length === 1) { fillSel(grid[0][0]); return; }   // copy 1 ô → dán đầy vùng chọn
      // vùng chọn lớn hơn khối copy → lặp lại khối cho đầy vùng (như Excel); không thì dán đúng 1 khối từ ô neo
      const H = grid.length, W = Math.max(...grid.map((g) => g.length));
      const rows = Math.max(H, q.r2 - q.r1 + 1 >= H && (q.r2 - q.r1 + 1) % H === 0 ? q.r2 - q.r1 + 1 : H);
      const cols = Math.max(W, q.c2 - q.c1 + 1 >= W && (q.c2 - q.c1 + 1) % W === 0 ? q.c2 - q.c1 + 1 : W);
      for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) ch.push([q.r1 + i, q.c1 + j, (grid[i % H][j % W] ?? '')]);
      applyChanges(ch);
      sel = { ar: q.r1, ac: q.c1, r: Math.min(R - 1, q.r1 + rows - 1), c: Math.min(C - 1, q.c1 + cols - 1) }; drawSel();
    });

    // ----- thanh công cụ -----
    const selInfo = el('span', { style: 'color:var(--muted);font-size:12.5px' }, '');
    const warn = el('span', { style: 'color:#dc2626;font-size:13px;font-weight:600' }, '');
    const saveBtn = el('button', { class: 'btn green', style: 'min-width:104px' }, '💾 Lưu');
    const undoBtn = btnSm('↶ Hoàn tác', doUndo, 'ghost');
    const autoBtn = btnSm('↺ Về tự động', () => { fillSel(''); box.focus({ preventScroll: true }); }, 'ghost');
    autoBtn.title = 'Bỏ các ô đã nhập tay trong vùng đang chọn → phần mềm tự tìm ca lại (lịch trình tạm thời / lịch đã gán / dò theo giờ chấm). Bấm Lưu để áp dụng.';
    saveBtn.onclick = async () => {
      if ([..._asDirty.values()].some((v) => norm(v).bad)) return toast('Còn ô sai mã ca (chữ đỏ). Sửa lại trước khi lưu.', 'err');
      const cells = [..._asDirty].map(([k, v]) => { const [eid, date] = k.split('|'); return { employee_id: +eid, date, value: v }; });
      saveBtn.disabled = true; saveBtn.textContent = '⏳ Đang lưu…'; saveBtn.title = `Đang lưu ${cells.length} ô…`;
      try {
        const r = await api('/admin/assignments/cells', { method: 'POST', body: { cells } });
        if (r.errorCount) { toast(`Đã lưu ${r.saved} ô, ${r.errorCount} ô lỗi: ${r.errors[0].error}`, 'err'); }
        else toast(`Đã lưu ${r.saved} ô`, 'ok');
        if (r.overlapWarn && r.overlapWarn.length) alert('Cảnh báo ca chồng giờ (vẫn đã lưu):\n' + r.overlapWarn.join('\n'));
        _asDirty.clear(); pageAssignments();
      } catch (e) { toast(e.message, 'err'); saveBtn.disabled = false; }
    };
    const deptQS = (_asDept === '*' || _asDept === '') ? '' : _asDept;
    const fileI = el('input', { type: 'file', accept: '.xlsx', style: 'display:none' });
    const exBtn = btnSm('⬇ Xuất Excel', async () => {
      try {
        const res = await api(`/admin/assignments/export.xlsx?from=${days[0]}&to=${days[days.length - 1]}&dept=${encodeURIComponent(deptQS)}`, { raw: true });
        if (!res.ok) { toast('Máy chủ trả lỗi ' + res.status, 'err'); return; }
        const blob = await res.blob(); const url = URL.createObjectURL(blob);
        const a = el('a', { href: url, download: `phanca_${days[0]}_${days[days.length - 1]}.xlsx` });
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        if (_asDirty.size) toast('Lưu ý: file xuất chưa gồm các ô đang sửa chưa lưu', 'err');
      } catch (e) { toast('Không xuất được (mất kết nối, thử lại)', 'err'); }
    }, 'ghost');
    const imBtn = canEdit ? btnSm('⬆ Nhập Excel', () => { if (_asDirty.size && !confirm(`Có ${_asDirty.size} ô đang sửa chưa lưu sẽ bị bỏ khi nhập file. Tiếp tục?`)) return; fileI.click(); }, 'ghost') : null;
    fileI.onchange = () => {
      const f = fileI.files[0]; if (!f) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const r = await api('/admin/assignments/import', { method: 'POST', body: { from: days[0], to: days[days.length - 1], fileBase64: reader.result } });
          let msg = `Đã nhập ${fmtD(r.from)} → ${fmtD(r.to)}: ${r.updated} ô ca, ${r.off} ô nghỉ, ${r.cleared} ô bỏ ca` + (r.keptAuto ? ` · ${r.keptAuto} ô giữ nguyên ca tự tìm` : '');
          if (r.errorCount) msg += ` · ${r.errorCount} lỗi`;
          toast(msg, r.errorCount ? 'err' : 'ok');
          if (r.errorCount) alert('Một số dòng lỗi (các ô khác vẫn được nhập):\n' + r.errors.join('\n'));
          if (r.overlapWarn && r.overlapWarn.length) alert('Cảnh báo ca chồng giờ (vẫn đã nhập):\n' + r.overlapWarn.join('\n'));
          _asDirty.clear(); pageAssignments();
        } catch (e) { toast(e.message, 'err'); }
      };
      reader.readAsDataURL(f);
      fileI.value = '';
    };
    // Bảng mã ca: bấm 1 mã để điền vào vùng đang chọn (không cần gõ)
    // Công tắc "hỗ trợ nhiều ca/ngày" bật: Ctrl (hoặc ⌘) + bấm mã ca = CỘNG THÊM ca vào ô (ca gãy S+C); bấm thường vẫn là thay cả ô như cũ
    const addToSel = (value) => {
      const q = rect(); const ch = [];
      for (let r = q.r1; r <= q.r2; r++) for (let c = q.c1; c <= q.c2; c++) {
        const g = (sheetEmps[r].grid || [])[c] || {};
        const cur = curVal(r, c) || (g.k !== 'none' && g.k !== 'schedule' && g.l !== 'Nghỉ' ? g.l : '');
        const parts = cur && cur !== 'NGHỈ' ? cur.split('+').map((x) => x.trim()).filter(Boolean) : [];
        if (!parts.some((x) => x.toUpperCase() === value.toUpperCase())) parts.push(value);
        ch.push([r, c, parts.join('+')]);
      }
      applyChanges(ch);
    };
    const chipFor = (label, value, title, style) => { const b = el('button', { class: 'as-code', title, style: style || '' }, label); b.onclick = (ev) => { if (!canEdit) return; if (data.multiAssist && (ev.ctrlKey || ev.metaKey) && value && value !== 'NGHỈ') addToSel(value); else fillSel(value); box.focus({ preventScroll: true }); }; return b; };
    const codes = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:8px 0' }, el('span', { style: 'font-size:12.5px;color:var(--muted)', title: 'Bấm 1 mã để điền vào các ô đang chọn' }, 'Mã ca:'),
      ...data.shifts.map((s) => chipFor((s.code || '').trim() || s.name, (s.code || '').trim() || s.name, `${s.name} (${s.start_time}-${s.end_time})`)),
      chipFor('NGHỈ', 'NGHỈ', 'Ngày nghỉ', 'color:#b45309;border-color:#f5d0a9'), chipFor('↺ Tự động', '', 'Bỏ ca đã nhập tay ngày đó → phần mềm tự tìm ca lại', 'color:#6b7280'));
    const noCode = data.shifts.filter((s) => !(s.code || '').trim());
    // Gọn chiều cao: thanh công cụ lên dòng tiêu đề; mã ca + chú thích + ô đang chọn chung 1 dòng; hướng dẫn ẩn sau nút "?"
    let helpOn = false; try { helpOn = localStorage.getItem('as_help') === '1'; } catch {}
    const hint = el('div', { class: 'map-hint', style: 'margin:0 0 6px;' + (helpOn ? '' : 'display:none') }, 'Dùng như Excel: bấm 1 ô rồi gõ mã ca + Enter · kéo chuột (hoặc Shift + mũi tên) chọn nhiều ô rồi gõ để điền cả vùng · Ctrl+C / Ctrl+V copy–dán (dán được từ Excel) · Delete (hoặc nút ↺ Về tự động) = bỏ ô nhập tay, phần mềm tự tìm ca lại · Ctrl+Z hoàn tác · bấm số ngày / số thứ tự để chọn cả cột / cả dòng · Esc thoát toàn màn hình.'
      + (data.multiAssist ? ' · NHIỀU CA/NGÀY: gõ nối bằng dấu + (VD S+C) hoặc Ctrl + bấm mã ca để cộng thêm ca vào ô; dấu ✓ đủ ca · ✗ thiếu ca (ngày đã chấm mà không có công của ca đó) · ⚠ ca chồng giờ — rê chuột vào ô để xem chi tiết.' : '')
      + (noCode.length ? ` Ca chưa đặt mã (${noCode.map((s) => s.name).join(', ')}) đang dùng tên ca làm mã — nên đặt mã ngắn ở mục Ca làm.` : ''));
    const helpBtn = btnSm('?', () => { const on = hint.style.display === 'none'; hint.style.display = on ? '' : 'none'; try { localStorage.setItem('as_help', on ? '1' : '0'); } catch {} fitBox(); }, 'ghost');
    helpBtn.title = 'Hướng dẫn thao tác';
    const fullBtn = btnSm(_asFull ? '⤡' : '⛶', () => { _asFull = !_asFull; try { localStorage.setItem('as_full', _asFull ? '1' : '0'); } catch {} pageAssignments(); }, 'ghost');
    fullBtn.title = _asFull ? 'Hiện lại menu trái (phím Esc)' : 'Ẩn menu trái và cây phòng ban để bảng rộng nhất';
    if (deptBar) { deptBar.remove(); deptBar.style.marginBottom = '0'; deptBar.firstChild.remove(); }   // bỏ chữ "Phòng ban:" cho gọn
    undoBtn.textContent = '↶'; undoBtn.title = 'Hoàn tác (Ctrl+Z)';
    // 2 nhóm cố định: trái = bộ lọc (phòng ban, tìm NV, khoảng ngày) · phải = nút thao tác (luôn bám mép phải, đi liền 1 khối)
    headTools.push(el('div', { class: 'as-tb-left' }, deptBar, searchS, rangeNav()),
      el('div', { class: 'as-tb-right' }, canEdit ? saveBtn : '', canEdit ? undoBtn : '', canEdit ? autoBtn : '', exBtn, imBtn, fileI, fullBtn, helpBtn));
    codes.style.margin = '0';
    const fitBox = () => setTimeout(() => { box.style.maxHeight = Math.max(240, innerHeight - box.getBoundingClientRect().top - 14) + 'px'; });
    main.append(
      warn,
      el('div', { class: 'as-bar2' }, codes, el('div', { class: 'as-legend' },
        el('span', {}, el('i', { class: 'lg ex' }, 'HC'), 'nhập tay (ưu tiên cao nhất)'),
        el('span', {}, el('i', { class: 'lg ph' }, 'HC'), 'theo lịch đã gán'),
        el('span', {}, el('i', { class: 'lg tmp' }, 'HC'), 'theo lịch tạm thời'),
        el('span', {}, el('i', { class: 'lg fnd' }, 'HC'), 'ca đã dò theo giờ chấm'),
        el('span', {}, el('i', { class: 'lg dirty' }, 'HC'), 'chưa lưu')), el('span', { style: 'flex:1' }), selInfo),
      hint,
      box);
    syncBar();
    fitBox(); setTimeout(() => { if (R) drawSel(); });
    if (!_asSheetResize) { _asSheetResize = true; addEventListener('resize', () => { const b = document.querySelector('.as-sheet-box'); if (b) b.style.maxHeight = Math.max(240, innerHeight - b.getBoundingClientRect().top - 14) + 'px'; }); }
  }

  /* ================= LỊCH TRÌNH PHÒNG BAN =================
   * Gán ca / lịch trình cho CHÍNH phòng ban: mọi nhân viên của phòng (kể cả người vào sau) tự theo. */
  if (_asTab === 'dept') {
    const today = todayVN();
    const tbl = el('table', { class: 'data' });
    const selAll = el('input', { type: 'checkbox', style: 'width:auto' });
    tbl.append(el('thead', {}, el('tr', {}, el('th', {}, selAll), el('th', {}, 'Phòng ban'), el('th', {}, 'Ca / lịch trình ca làm việc'), el('th', {}, 'Lịch trình vào ra'), el('th', {}, 'Ngày bắt đầu'), el('th', {}, 'Ngày kết thúc'), el('th', {}, 'Áp dụng'), el('th', {}, 'Thao tác'))));
    const tb = el('tbody'); tbl.append(tb);
    const rows = deptRows.filter((r) => !selSet || r.department === '*' || selSet.has(r.department));   // '*' = tất cả phòng ban: hiện ở mọi phòng
    const dName = (d) => (d === '*' ? 'Tất cả phòng ban' : d);
    if (!rows.length) tb.append(el('tr', {}, el('td', { colspan: 8 }, el('div', { class: 'empty' }, '📭 Trống — chưa phòng ban nào ở đây được gán ca. Bấm "+ Thêm" để gán.'))));
    const delIds = async (ids, msg) => {
      if (!confirm(msg)) return;
      try { const r = await api('/admin/dept-shift-assignments/delete', { method: 'POST', body: { ids } }); toast(`Đã xoá ${r.count} lịch trình phòng ban`, 'ok'); pageAssignments(); } catch (e) { toast(e.message, 'err'); }
    };
    for (const r of rows) {
      const expired = r.to_date && r.to_date < today, future = r.from_date > today;
      tb.append(el('tr', {}, el('td', {}, el('input', { type: 'checkbox', class: 'as-pick', style: 'width:auto', 'data-id': r.id })),
        el('td', {}, el('b', {}, (r.department === '*' ? '🏢 ' : '📁 ') + dName(r.department))),
        el('td', {}, el('span', { style: expired ? 'color:#9ca3af' : 'color:#0f766e;font-weight:700' }, r.mode === 'schedule' ? '📋 ' + (r.schedule_name || 'Lịch trình') : (r.shift_name || 'Ca')),
          expired ? el('span', { class: 'chip', style: 'margin-left:6px' }, 'đã hết hạn') : future ? el('span', { class: 'chip', style: 'margin-left:6px;background:#eff6ff;color:#1d4ed8' }, 'sắp áp dụng') : ''),
        el('td', { style: 'color:var(--muted)' }, r.inout_name || 'Mặc định'),
        el('td', {}, fmtD(r.from_date)), el('td', {}, r.to_date ? fmtD(r.to_date) : '—'),
        el('td', { style: 'color:var(--muted);font-size:13px' }, r.department === '*' ? 'cả công ty, kể cả phòng ban thêm sau' : r.include_children ? 'cả phòng ban cấp dưới' : 'chỉ phòng này'),
        el('td', { style: 'white-space:nowrap' }, ...(canEdit ? [btnSm('Sửa', () => editAssignModal('dept', r, data.shifts)), ' ', btnSm('Xoá', () => delIds([r.id], `Xoá lịch trình "${r.mode === 'schedule' ? r.schedule_name : r.shift_name}" của "${dName(r.department)}"?`), 'ghost')] : []))));
    }
    selAll.onchange = () => { tb.querySelectorAll('.as-pick').forEach((c) => { c.checked = selAll.checked; }); };
    const addBtn = canEdit ? el('button', { class: 'btn' }, '+ Thêm') : null;
    if (addBtn) addBtn.onclick = () => { _asAdd = 'dept'; pageAssignments(); };
    const delBtn = canEdit ? btnSm('🗑 Xoá', () => {
      const ids = [...tb.querySelectorAll('.as-pick:checked')].map((c) => +c.dataset.id);
      if (!ids.length) return toast('Chưa tick dòng nào để xoá', 'err');
      delIds(ids, `Xoá ${ids.length} lịch trình phòng ban đã chọn?`);
    }, 'ghost') : null;
    main.append(
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px' }, el('span', { style: 'flex:1' }), addBtn, delBtn, btnSm('⟳', () => pageAssignments(), 'ghost')),
      el('div', { class: 'panel tbl-scroll' }, tbl),
      el('div', { class: 'map-hint', style: 'margin-top:10px' }, 'Lịch trình phòng ban áp cho mọi nhân viên của phòng, kể cả người mới thêm vào phòng sau này. Người nào có Lịch trình nhân viên riêng thì theo lịch riêng. Một phòng có nhiều dòng thì dòng mới nhất đang hiệu lực được dùng.'));
  }

  /* ================= LỊCH TRÌNH TẠM THỜI (kiểu ZKBio) =================
   * Mỗi dòng = 1 nhân viên × 1 ngày được đổi ca / cho nghỉ khác với lịch đã gán. Bấm "+ Thêm" để tạo cho nhiều người / phòng ban trong một khoảng ngày.
   * Ưu tiên: Xem lịch trình (kiểu Excel) → Lịch trình tạm thời → Gán ca nhân viên → Gán ca phòng ban → ca mặc định. */
  if (_asTab === 'temp') {
    const empById = new Map(data.employees.map((e) => [e.id, e]));
    const inSel = new Set(emps.map((e) => e.id));
    // gom các dòng cùng NV × ngày (ngày có nhiều ca) thành 1 dòng
    const byKey = new Map();
    for (const a of data.assignments) {
      if (!inSel.has(a.employee_id)) continue;
      const src = a.source === 'temp' ? 'temp' : 'sheet';
      const k = a.employee_id + '|' + a.work_date + '|' + src;
      const g = byKey.get(k) || { employee_id: a.employee_id, date: a.work_date, off: false, shifts: [], source: src };
      if (a.is_off) g.off = true; else g.shifts.push(shiftName.get(a.shift_id) || 'Ca đã xoá');
      byKey.set(k, g);
    }
    const hasSheet = (g) => byKey.has(g.employee_id + '|' + g.date + '|sheet');
    const searchI = el('input', { placeholder: 'Tên nhân viên, mã nhân viên', value: _asSearch, style: 'width:220px' });
    const srcSel = el('select', { style: 'width:auto' }, el('option', { value: '' }, 'Tất cả'), el('option', { value: 'temp' }, 'Lịch trình tạm thời'), el('option', { value: 'sheet' }, 'Nhập ở bảng Excel'));
    srcSel.value = _asTmpSrc;
    const tbl = el('table', { class: 'data' });
    const selAll = el('input', { type: 'checkbox', style: 'width:auto' });
    tbl.append(el('thead', {}, el('tr', {}, el('th', {}, selAll), el('th', {}, 'Mã nhân viên'), el('th', {}, 'Tên nhân viên'), el('th', {}, 'Ngày'), el('th', {}, 'Ngày nghỉ'), el('th', {}, 'Ca làm việc'), el('th', {}, 'Nguồn'), el('th', {}, 'Thao tác'))));
    const tb = el('tbody'); tbl.append(tb);
    const WDL = { 1: 'Thứ Hai', 2: 'Thứ Ba', 3: 'Thứ Tư', 4: 'Thứ Năm', 5: 'Thứ Sáu', 6: 'Thứ Bảy', 7: 'Chủ Nhật' };
    const info = el('span', { style: 'color:var(--muted);font-size:13px' }, '');
    const clearItems = async (items, msg) => {
      if (!confirm(msg)) return;
      try { const r = await api('/admin/assignments/clear', { method: 'POST', body: { items } }); toast(`Đã xoá ${r.count} dòng`, 'ok'); pageAssignments(); } catch (e) { toast(e.message, 'err'); }
    };
    const renderRows = () => {
      tb.innerHTML = '';
      const q = _asSearch.trim().toLowerCase();
      const rows = [...byKey.values()].filter((g) => { const e = empById.get(g.employee_id) || {}; return (!_asTmpSrc || g.source === _asTmpSrc) && (!q || (e.full_name || '').toLowerCase().includes(q) || String(e.code || '').toLowerCase().includes(q)); })
        .sort((a, b) => (a.date === b.date ? ((empById.get(a.employee_id)?.full_name || '').localeCompare(empById.get(b.employee_id)?.full_name || '', 'vi')) : a.date < b.date ? -1 : 1));
      const MAX = 500;
      info.textContent = rows.length > MAX ? `Hiện ${MAX} / ${rows.length} dòng — lọc theo phòng ban hoặc tên để xem phần còn lại` : `${rows.length} dòng`;
      if (!rows.length) tb.append(el('tr', {}, el('td', { colspan: 8 }, el('div', { class: 'empty' }, '📭 Trống — tháng này chưa có lịch trình tạm thời nào. Bấm "+ Thêm".'))));
      for (const g of rows.slice(0, MAX)) {
        const e = empById.get(g.employee_id) || {};
        tb.append(el('tr', {}, el('td', {}, el('input', { type: 'checkbox', class: 'tmp-pick', style: 'width:auto', 'data-emp': g.employee_id, 'data-date': g.date, 'data-src': g.source })),
          el('td', {}, e.code || ''), el('td', {}, el('b', {}, e.full_name || '')),
          el('td', {}, `${fmtD(g.date)} ${WDL[weekdayVN(g.date)]}`),
          el('td', {}, g.off ? el('span', { class: 'pill warn' }, 'Nghỉ') : '-'),
          el('td', { style: 'color:#0f766e;font-weight:700' }, g.off ? '-' : g.shifts.join(' + ')),
          el('td', {}, g.source === 'temp' ? el('span', { class: 'chip' }, 'Tạm thời') : el('span', { class: 'chip g' }, 'Bảng Excel'),
            g.source === 'temp' && hasSheet(g) ? el('div', { style: 'font-size:11.5px;color:#b45309;margin-top:2px' }, 'đang bị ô Excel đè') : ''),
          el('td', {}, canEdit ? el('a', { href: '#', style: 'color:#dc2626;font-weight:600', onclick: (ev) => { ev.preventDefault(); clearItems([{ employee_id: g.employee_id, date: g.date, source: g.source }], `Xoá ${g.source === 'temp' ? 'lịch trình tạm thời' : 'ô nhập ở bảng Excel'} ngày ${fmtD(g.date)} của ${e.full_name}?`); } }, 'Xoá') : '')));
      }
      selAll.checked = false;
    };
    searchI.oninput = () => { _asSearch = searchI.value; renderRows(); };
    srcSel.onchange = () => { _asTmpSrc = srcSel.value; renderRows(); };
    selAll.onchange = () => { tb.querySelectorAll('.tmp-pick').forEach((c) => { c.checked = selAll.checked; }); };
    const addBtn = canEdit ? el('button', { class: 'btn' }, '+ Thêm') : null;
    if (addBtn) addBtn.onclick = () => { _asAdd = 'temp'; pageAssignments(); };
    const delBtn = canEdit ? btnSm('🗑 Xoá', () => {
      const items = [...tb.querySelectorAll('.tmp-pick:checked')].map((c) => ({ employee_id: +c.dataset.emp, date: c.dataset.date, source: c.dataset.src }));
      if (!items.length) return toast('Chưa tick dòng nào', 'err');
      clearItems(items, `Xoá ${items.length} dòng đã chọn? Phần mềm sẽ tự tìm ca lại cho các ngày đó.`);
    }, 'ghost') : null;
    renderRows();
    main.append(
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px' }, searchI, monthNav(), srcSel, info, el('span', { style: 'flex:1' }), addBtn, delBtn, btnSm('⟳', () => pageAssignments(), 'ghost')),
      el('div', { class: 'panel tbl-scroll' }, tbl),
      el('div', { class: 'map-hint', style: 'margin-top:10px' }, 'Thứ tự ưu tiên khi tính ca của một ngày: ① ô nhập ở Xem lịch trình (kiểu Excel) → ② Lịch trình tạm thời → ③ Gán ca cho nhân viên → ④ Gán ca cho phòng ban → ⑤ ca mặc định ở hồ sơ. Ô nhập ở bảng Excel luôn đè lên lịch tạm thời; xoá ô Excel (nút ↺ Về tự động) thì lịch tạm thời hiện lại.'));
  }

  setMain(head(pageTitle, ...headTools), tabBar, el('div', { class: 'emp-wrap' + (_asTab === 'sheet' ? ' as-sheet-page' : '') }, _asTab === 'sheet' && _asFull ? null : side, main));
  if (_asTab === 'sheet') {
    $('#main .page-head').classList.add('as-head'); if (_asFull) document.body.classList.add('as-full');
    if (_asFocusSearch) { _asFocusSearch = false; const si = $('#main .page-head input[placeholder^="🔍"]'); if (si) { si.focus(); si.setSelectionRange(si.value.length, si.value.length); } }
  }
}

// Sửa 1 dòng gán ca (kind: 'emp' = của nhân viên, 'dept' = của phòng ban): đổi ca / lịch trình, lịch trình vào ra, ngày
async function editAssignModal(kind, r, shifts) {
  let schedules = [], ios = [];
  try { schedules = (await api('/admin/schedules')).rows || []; } catch {}
  try { ios = (await api('/admin/inout-schedules')).rows || []; } catch {}
  const cur = r.mode === 'schedule' ? 'schedule:' + r.work_schedule_id : 'shift:' + r.shift_id;
  const opt = (v, t) => el('option', { value: v, ...(v === cur ? { selected: '' } : {}) }, t);
  const pickSel = el('select', {},
    ...(r.mode !== 'schedule' ? [el('optgroup', { label: 'Đang gán ca lẻ (kiểu cũ)' }, opt(cur, (r.shift_name || 'Ca') + ' — đổi sang lịch trình bên dưới'))] : []),
    el('optgroup', { label: 'Lịch trình ca làm việc' }, ...schedules.map((w) => opt('schedule:' + w.id, '📋 ' + w.name))));
  const ioDef = ios.find((x) => x.is_default);
  const ioSel = el('select', {}, el('option', { value: '' }, ioDef ? `Mặc định — ${ioDef.name}` : 'Mặc định — giờ đầu là vào, giờ cuối là ra'),
    ...ios.map((x) => el('option', { value: String(x.id), ...(String(r.inout_schedule_id || '') === String(x.id) ? { selected: '' } : {}) }, `${x.name} — ${IO_RULE_NAME[x.rule] || x.rule}`)));
  const fromI = el('input', { type: 'date', value: r.from_date || todayVN() });
  const toI = el('input', { type: 'date', value: r.to_date || '' });
  const incl = kind === 'dept' ? el('input', { type: 'checkbox', style: 'width:auto', ...(r.include_children ? { checked: '' } : {}) }) : null;
  const who = kind === 'dept' ? (r.department === '*' ? '🏢 Tất cả phòng ban' : '📁 ' + r.department) : `${r.emp_name || ''} (${r.emp_code || ''})`;
  const save = el('button', { class: 'btn' }, 'Lưu');
  save.onclick = async () => {
    if (!pickSel.value) return toast('Chọn ca hoặc lịch trình', 'err');
    if (!fromI.value) return toast('Chọn ngày bắt đầu', 'err');
    if (toI.value && toI.value < fromI.value) return toast('Ngày kết thúc phải sau ngày bắt đầu', 'err');
    const [mode, id] = pickSel.value.split(':');
    const body = { mode, from_date: fromI.value, to_date: toI.value || null, inout_schedule_id: ioSel.value ? +ioSel.value : null };
    if (mode === 'shift') body.shift_id = +id; else body.work_schedule_id = +id;
    if (incl) body.include_children = incl.checked;
    save.disabled = true;
    try {
      await api(`/admin/${kind === 'dept' ? 'dept-shift-assignments' : 'shift-assignments'}/` + r.id, { method: 'PUT', body });
      toast('Đã lưu. Dữ liệu chấm công cũ muốn theo ca mới thì bấm "Tính lại" ở Tính công', 'ok'); closeModal(); pageAssignments();
    } catch (e) { toast(e.message, 'err'); save.disabled = false; }
  };
  openModal('Sửa gán ca — ' + who, [
    field('Lịch trình ca làm việc', pickSel),
    field('Lịch trình vào ra', ioSel),
    el('div', { class: 'two-col' }, field('Ngày bắt đầu', fromI), field('Ngày kết thúc (trống = mãi mãi)', toI)),
    ...(incl ? [el('label', { style: 'display:flex;align-items:center;gap:8px;font-weight:600;color:var(--ink)' }, incl, 'Áp dụng cả phòng ban cấp dưới')] : []),
  ], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Huỷ'), save]);
}

// Xoá ca: chưa dùng → xoá hẳn; đang được phân ca → hỏi lại rồi gỡ phân ca + xoá; đã có ngày công → chỉ tắt (giữ lịch sử)
async function deleteShift(s) {
  if (!confirm(`Xoá ca "${s.name}"?`)) return;
  const call = (q = '') => api('/admin/shifts/' + s.id + q, { method: 'DELETE' });
  try {
    await call();
    toast('Đã xoá ca', 'ok');
  } catch (e) {
    const d = e.data || {};
    if (d.canForce) {
      if (!confirm(e.message + '\n\nXoá ca sẽ GỠ luôn các phân ca / lịch trình này. Vẫn xoá?')) return;
      try { await call('?force=1'); toast('Đã xoá ca và gỡ các phân ca liên quan', 'ok'); } catch (e2) { toast(e2.message, 'err'); return; }
    } else if (d.canOff) {
      if (!confirm(e.message + '\n\nTắt ca này?')) return;
      try { await call('?off=1'); toast('Đã tắt ca', 'ok'); } catch (e2) { toast(e2.message, 'err'); return; }
    } else { toast(e.message, 'err'); return; }
  }
  pageShifts();
}

/* ---------- 4c) PHÂN CA LÀM VIỆC (gán ca/lịch trình theo khoảng ngày) ---------- */
const MERGE_RULES = [
  ['default', 'Mặc định (theo khai báo trong từng ca)'],
  ['filo', 'FILO — Vào trước, ra sau'],
  ['tdhc', 'TĐ-HC — Theo cửa sổ thời gian'],
  ['idm', 'IDM — Máy lẻ vào / máy chẵn ra (cộng từng cặp, qua đêm tự ghép)'],
  ['tdqd', 'TĐ-QĐ — Tự động qua đêm (theo cặp, ghép lượt ra sáng hôm sau)'],
  ['pairs', 'Nhiều lần vào/ra — cộng từng cặp, trừ thời gian ra ngoài'],
];
const RULE_LABEL = Object.fromEntries(MERGE_RULES);

async function shiftAssignManageModal() {
  const listBox = el('div', {}, loading());
  const addBtn = el('button', { class: 'btn' }, '+ Thêm phân ca');
  addBtn.onclick = () => shiftAssignFormModal(() => setTimeout(shiftAssignManageModal, 100));
  const deptSel = el('select', { style: 'min-width:170px' }, el('option', { value: '' }, '-- Tất cả phòng ban --'));
  const selAll = el('input', { type: 'checkbox', style: 'width:auto', title: 'Chọn / bỏ tất cả' });
  const delSelBtn = btnSm('🗑 Xoá đã chọn', () => doDelete('sel'), 'ghost');
  const delAllBtn = btnSm('🗑 Xoá tất cả', () => doDelete('all'), 'ghost');
  let ALL = [];

  async function doDelete(kind) {
    const dept = deptSel.value;
    let ids, msg;
    if (kind === 'all') {
      const target = ALL.filter((r) => !dept || r.department === dept);
      if (!target.length) return toast('Không có phân ca để xoá', 'err');
      ids = target.map((r) => r.id);
      msg = dept ? `Xoá TẤT CẢ ${ids.length} phân ca của phòng "${dept}"?` : `Xoá TẤT CẢ ${ids.length} phân ca?`;
    } else {
      ids = [...listBox.querySelectorAll('.sa-pick:checked')].map((x) => +x.value);
      if (!ids.length) return toast('Chưa tích chọn phân ca nào', 'err');
      msg = `Xoá ${ids.length} phân ca đã chọn?`;
    }
    if (!confirm(msg)) return;
    try { const r = await api('/admin/shift-assignments/delete', { method: 'POST', body: { ids } }); toast(`Đã xoá ${r.count} phân ca`, 'ok'); reload(); }
    catch (e) { toast(e.message, 'err'); }
  }

  const render = () => {
    const dept = deptSel.value;
    const rows = ALL.filter((r) => !dept || r.department === dept);
    listBox.innerHTML = '';
    if (!rows.length) { listBox.append(el('div', { class: 'map-hint' }, 'Chưa có phân ca nào. Bấm "+ Thêm phân ca".')); return; }
    for (const r of rows) {
      const target = r.mode === 'schedule' ? ('📋 ' + (r.schedule_name || 'Lịch trình')) : ('🕐 ' + (r.shift_name || 'Ca'));
      const range = r.from_date + (r.to_date ? ' → ' + r.to_date : ' → (mãi mãi)');
      const rule = (r.merge_rule && r.merge_rule !== 'default') ? (' · ' + (RULE_LABEL[r.merge_rule] || r.merge_rule).split(' —')[0]) : '';
      const cb = el('input', { type: 'checkbox', class: 'sa-pick', value: r.id, style: 'width:auto;margin-top:3px' });
      const del = btnSm('Xoá', async () => { if (!confirm(`Xoá phân ca của ${r.emp_name || 'NV này'}?`)) return; try { await api('/admin/shift-assignments/' + r.id, { method: 'DELETE' }); toast('Đã xoá', 'ok'); reload(); } catch (e) { toast(e.message, 'err'); } }, 'ghost');
      listBox.append(el('div', { style: 'padding:10px 2px;border-bottom:1px solid #f1efec;display:flex;align-items:flex-start;gap:10px' },
        cb,
        el('div', { style: 'flex:1' },
          el('div', {}, el('b', {}, r.emp_name || ''), el('span', { style: 'color:#999' }, ` · ${r.emp_code || ''}${r.department ? ' · ' + r.department : ''}`)),
          el('div', { style: 'font-size:13px;color:var(--muted)' }, `${target} · ${range}${r.shift_type === 'rotating' ? ' · xoay' : ''}${rule}`)),
        del));
    }
  };
  const reload = async () => {
    try { ALL = (await api('/admin/shift-assignments')).rows; }
    catch (e) { listBox.innerHTML = ''; listBox.append(el('div', { class: 'empty' }, e.message)); return; }
    // Dropdown phòng ban = danh mục Bộ phận (master) GỘP phòng ban đang có ở phân ca/NV
    let deptNames = ALL.map((r) => r.department).filter(Boolean);
    try { deptNames = deptNames.concat(((await api('/admin/departments')).rows || []).map((d) => d.name)); } catch {}
    const depts = [...new Set(deptNames.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));
    deptSel.innerHTML = ''; deptSel.append(el('option', { value: '' }, '-- Tất cả phòng ban --'));
    for (const d of depts) deptSel.append(el('option', { value: d }, d));
    selAll.checked = false;
    render();
  };
  deptSel.onchange = () => { selAll.checked = false; render(); };
  selAll.onchange = () => { listBox.querySelectorAll('.sa-pick').forEach((c) => { c.checked = selAll.checked; }); };

  openModal('Phân ca làm việc', [
    el('div', { class: 'map-hint' }, 'Gán ca/lịch trình cho NV theo khoảng ngày (áp cho cả phòng ban / nhiều NV). Phân ca theo ngày trên lịch tuần vẫn ưu tiên đè lên phân ca này.'),
    addBtn,
    el('div', { style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:12px 0 4px' },
      el('label', { style: 'display:flex;align-items:center;gap:6px;font-weight:600;color:var(--ink)' }, selAll, 'Chọn tất cả'),
      deptSel, delSelBtn, delAllBtn),
    listBox,
  ], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Đóng')]);
  reload();
}

async function shiftAssignFormModal(onSaved, preset = {}) {
  if (!SHIFTS.length || !DEPARTMENTS.length) { try { await loadRefs(); } catch {} }
  let employees = [];
  try { employees = (await api('/admin/employees')).rows || []; } catch {}
  employees = employees.filter(e => e.role !== 'admin' && e.active !== 0);

  // Áp dụng cho
  const scopeSel = el('select', {},
    el('option', { value: 'emp' }, 'Nhân viên cụ thể'),
    el('option', { value: 'dept' }, 'Toàn phòng ban'),
    el('option', { value: 'all' }, 'Toàn bộ nhân viên'));
  // Nhân viên cụ thể: tích chọn NHIỀU NV, có lọc phòng ban + chọn tất cả
  const empFilterDept = el('select', {}, el('option', { value: '' }, '-- Tất cả phòng ban --'),
    ...[...new Set(employees.map((e) => e.department).filter(Boolean))].sort().map((d) => el('option', { value: d }, d)));
  const empSelAll = el('input', { type: 'checkbox', style: 'width:auto' });
  const empListBox = el('div', { style: 'max-height:180px;overflow:auto;border:1px solid var(--line,#e5e5e5);border-radius:8px;padding:6px 10px' });
  const renderEmpList = () => {
    const dept = empFilterDept.value;
    empListBox.innerHTML = '';
    for (const e of employees.filter((x) => !dept || x.department === dept))
      empListBox.append(el('label', { style: 'display:flex;align-items:center;gap:8px;padding:3px 0;font-weight:500;color:var(--ink)' },
        el('input', { type: 'checkbox', class: 'saf-emp', value: e.id, style: 'width:auto' }), `${e.full_name} (${e.code})${e.department ? ' · ' + e.department : ''}`));
  };
  empFilterDept.onchange = () => { empSelAll.checked = false; renderEmpList(); };
  empSelAll.onchange = () => { empListBox.querySelectorAll('.saf-emp').forEach((c) => { c.checked = empSelAll.checked; }); };
  renderEmpList();
  const empField = el('div', {}, el('label', {}, 'Nhân viên * (tích chọn 1 hoặc nhiều)'),
    el('div', { style: 'display:flex;align-items:center;gap:10px;margin-bottom:6px' },
      el('label', { style: 'display:flex;align-items:center;gap:6px;font-weight:600;color:var(--ink)' }, empSelAll, 'Chọn tất cả'), empFilterDept),
    empListBox);
  const deptSel = el('select', {}, el('option', { value: '' }, '— Chọn phòng ban —'),
    ...DEPARTMENTS.map(d => el('option', { value: d.name }, d.name)));
  const deptField = field('Phòng ban *', deptSel);

  // Chế độ gán
  const modeSel = el('select', {},
    el('option', { value: 'shift' }, 'Gán ca trực tiếp'),
    el('option', { value: 'schedule' }, 'Gán lịch trình'));
  const shiftSel = el('select', {}, el('option', { value: '' }, '— Chọn ca —'),
    ...SHIFTS.filter(s => s.active).map(s => el('option', { value: String(s.id) }, `${s.name} (${s.start_time}-${s.end_time})`)));
  const schedSel = el('select', {}, el('option', { value: '' }, '— Chọn lịch trình —'),
    ...SCHEDULES.map(w => el('option', { value: String(w.id) }, `📋 ${w.name}`)));
  const shiftField = field('Ca làm việc *', shiftSel);
  const schedField = field('Lịch trình *', schedSel);

  const fromI = el('input', { type: 'date', value: todayVN() });
  const toI = el('input', { type: 'date', value: '' });
  const typeSel = el('select', {}, el('option', { value: 'fixed' }, 'Cố định (không xoay)'), el('option', { value: 'rotating' }, 'Xoay ca'));
  const ruleSel = el('select', {}, ...MERGE_RULES.map(([v, t]) => el('option', { value: v }, t)));
  const noteI = el('input', { placeholder: 'Ghi chú (tuỳ chọn)' });

  const syncScope = () => { empField.style.display = scopeSel.value === 'emp' ? '' : 'none'; deptField.style.display = scopeSel.value === 'dept' ? '' : 'none'; };
  const syncMode = () => { shiftField.style.display = modeSel.value === 'shift' ? '' : 'none'; schedField.style.display = modeSel.value === 'schedule' ? '' : 'none'; };
  // Mở từ trang Phân ca: đã tích NV → gán cho các NV đó; chưa tích mà đang chọn 1 phòng ban → gán cả phòng ban
  const preIds = new Set((preset.employeeIds || []).map(Number));
  if (preIds.size) { scopeSel.value = 'emp'; empListBox.querySelectorAll('.saf-emp').forEach((c) => { c.checked = preIds.has(+c.value); }); }
  else if (preset.dept && preset.dept !== '*') { scopeSel.value = 'dept'; if (![...deptSel.options].some((o) => o.value === preset.dept)) deptSel.append(el('option', { value: preset.dept }, preset.dept)); deptSel.value = preset.dept; }
  else if (preset.dept === '*') scopeSel.value = 'emp';
  scopeSel.onchange = syncScope; modeSel.onchange = syncMode; syncScope(); syncMode();

  const save = el('button', { class: 'btn' }, '💾 Lưu');
  save.onclick = async () => {
    const scope = scopeSel.value, mode = modeSel.value;
    const body = { scope, mode, from_date: fromI.value, to_date: toI.value || null, shift_type: typeSel.value, merge_rule: ruleSel.value, note: noteI.value };
    if (scope === 'emp') { const ids = [...empListBox.querySelectorAll('.saf-emp:checked')].map((x) => +x.value); if (!ids.length) return toast('Tích chọn ít nhất 1 nhân viên', 'err'); body.employee_ids = ids; }
    else if (scope === 'dept') { if (!deptSel.value) return toast('Chọn phòng ban', 'err'); body.department = deptSel.value; }
    if (mode === 'shift') { if (!shiftSel.value) return toast('Chọn ca làm việc', 'err'); body.shift_id = +shiftSel.value; }
    else { if (!schedSel.value) return toast('Chọn lịch trình', 'err'); body.work_schedule_id = +schedSel.value; }
    if (!fromI.value) return toast('Chọn ngày bắt đầu', 'err');
    save.disabled = true;
    try { const r = await api('/admin/shift-assignments', { method: 'POST', body }); toast(`Đã phân ca cho ${r.count} nhân viên`, 'ok'); closeModal(); if (typeof onSaved === 'function') onSaved(); }
    catch (e) { toast(e.message, 'err'); save.disabled = false; }
  };

  openModal('Thêm phân ca', [
    field('Áp dụng cho', scopeSel), empField, deptField,
    field('Chế độ gán', modeSel), shiftField, schedField,
    el('div', { class: 'two-col' }, field('Ngày bắt đầu *', fromI), field('Ngày kết thúc (trống = mãi mãi)', toI)),
    el('div', { class: 'two-col' }, field('Loại ca', typeSel), field('Quy tắc ghép log', ruleSel)),
    field('Ghi chú', noteI),
    el('div', { class: 'map-hint' }, 'Quy tắc ghép log = cách máy chấm công gộp nhiều lần quẹt thành giờ Vào/Ra. "Mặc định" = dùng quy tắc khai báo trong từng ca. IDM cần đặt "số máy" cho từng máy (lẻ = Vào, chẵn = Ra) ở mục Máy chấm công.'),
  ], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Huỷ'), save]);
}

