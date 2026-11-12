/* ---------- 2) NHÂN VIÊN ---------- */
let OFFICES = [], SHIFTS = [], DEPARTMENTS = [], SCHEDULES = [], PERM_CATALOG = [], POSITIONS = [];
async function loadRefs() {
  [OFFICES, SHIFTS, DEPARTMENTS, SCHEDULES, POSITIONS] = await Promise.all([
    api('/admin/offices').then(r => r.rows),
    api('/admin/shifts').then(r => r.rows),
    api('/admin/departments').then(r => r.rows),
    api('/admin/schedules').then(r => r.rows),
    api('/admin/positions').then(r => r.rows).catch(() => []),
  ]);
}
// CÂY PHÒNG BAN THU GỌN (mặc định chỉ hiện cấp cao nhất, bấm ▸ để xổ cấp con). Phòng nào đã mở thì nhớ chung mọi màn.
// items: [{ key, depth, el }] theo đúng thứ tự cây (con nằm ngay sau cha). keep: các key cần thấy (đang chọn) → tự mở các cấp cha.
// Trả hàm apply() để vẽ lại phần ẩn / hiện (VD sau khi xoá ô tìm).
const _deptOpen = new Set();
function collapseTree(items, keep = []) {
  items.forEach((it, i) => { it.kids = i + 1 < items.length && items[i + 1].depth > it.depth; it.d0 = it.el.style.display === 'none' ? '' : it.el.style.display; });
  for (const k of keep) {
    const i = items.findIndex((x) => x.key === k); if (i < 0) continue;
    let d = items[i].depth;
    for (let j = i - 1; j >= 0 && d > 0; j--) if (items[j].depth < d) { _deptOpen.add(items[j].key); d = items[j].depth; }
  }
  const apply = () => {
    let cut = Infinity;   // đang trong nhánh bị gọn: ẩn mọi mục sâu hơn `cut`
    for (const it of items) {
      if (it.depth <= cut) cut = Infinity;
      const hide = it.depth > cut;
      it.el.style.display = hide ? 'none' : it.d0;   // giữ kiểu hiển thị gốc (VD flex) khi hiện lại
      if (it.tg) it.tg.textContent = it.kids ? (_deptOpen.has(it.key) ? '▼' : '▶') : '';
      if (!hide && it.kids && !_deptOpen.has(it.key)) cut = it.depth;
    }
  };
  for (const it of items) {
    it.tg = el('span', { class: 'dt-tg' + (it.kids ? ' has' : ''), title: it.kids ? 'Xổ / thu bộ phận con' : '' });
    if (it.kids) it.tg.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); _deptOpen.has(it.key) ? _deptOpen.delete(it.key) : _deptOpen.add(it.key); apply(); });
    (it.at || it.el).prepend(it.tg);   // at: chỗ gắn nút (mặc định đầu dòng)
  }
  apply();
  return apply;
}
// Ô chọn nhiều phòng ban: theo cây cha → con (thụt lề); tên đang gán ở NV mà chưa có trong danh mục để cuối
function deptTreeItems(names) {
  const seen = new Set();
  const out = deptOrdered().map((d) => { seen.add(d.name); return { value: d.name, depth: d.depth, text: '\u2003'.repeat(d.depth) + (d.depth ? '└ ' : '') + d.name }; });
  for (const n of names) if (!seen.has(n)) out.push({ value: n, text: n });
  return out;
}
// Các phòng ban đã chọn + MỌI bộ phận con của chúng (chọn phòng cha là gồm cả con)
function deptExpand(picked) {
  const out = new Set(picked);
  const kids = new Map(); for (const d of DEPARTMENTS) { const k = d.parent_id || 0; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(d); }
  const walk = (id, depth) => { if (depth > 20) return; for (const c of kids.get(id) || []) { out.add(c.name); walk(c.id, depth + 1); } };
  for (const d of DEPARTMENTS) if (picked.has(d.name)) walk(d.id, 0);
  return out;
}
// Xếp bộ phận theo cây cha→con, trả [{id,name,parent_id,depth}] để đổ vào dropdown/quản lý
function deptOrdered(list = DEPARTMENTS) {
  const byParent = new Map();
  for (const d of list) { const k = d.parent_id || 0; if (!byParent.has(k)) byParent.set(k, []); byParent.get(k).push(d); }
  for (const arr of byParent.values()) arr.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  const out = [];
  const walk = (pid, depth) => { for (const d of (byParent.get(pid) || [])) { out.push({ ...d, depth }); walk(d.id, depth + 1); } };
  walk(0, 0);
  return out;
}
// Trang Nhân viên: bộ phận đang chọn trên cây ('*' = tất cả), các nhánh đang gọn, ô tìm — giữ khi làm mới/sửa
let empDeptSel = '*', empSearch = '';
const EMP_NONE = '\u0000none';                    // khoá cây cho NV chưa có bộ phận
const empPicked = new Set();                      // id NV đang tích chọn (xoá hàng loạt) — giữ khi đổi bộ phận/tìm kiếm
let empSort = null;   // { key, dir: 1 tăng | -1 giảm } — null = mặc định: nhóm theo bộ phận
const empDeptClosed = new Set(); let _empTreeInit = false;   // mặc định THU GỌN mọi bộ phận có cấp con
// Cột sắp xếp được ở bảng Nhân viên: [khoá, nhãn, gợi ý]
const EMP_SORT_COLS = [['code', 'Mã'], ['device_pin', 'Số ID', 'Số ID trên máy chấm công'], ['full_name', 'Họ tên'], ['department', 'Bộ phận', 'Bộ phận nhân viên đang thuộc'], ['position', 'Chức danh'],
  ['username', 'Tài khoản'], ['role', 'Quyền'], ['active', 'TT']];
// So sánh 2 NV theo cột: số so như số (2 < 10), chữ so tiếng Việt; ô trống luôn nằm CUỐI dù tăng hay giảm
function empCompare({ key, dir }) {
  const RANK = { employee: 1, manager: 2, admin: 3 };
  const val = (e) => key === 'role' ? (e.audit_only ? 2.5 : RANK[e.role] || 0) : key === 'active' ? (e.active ? 1 : 0) : String(e[key] ?? '').trim();
  return (a, b) => {
    const x = val(a), y = val(b);
    if (x === '' || y === '') return x === y ? 0 : x === '' ? 1 : -1;
    const c = typeof x === 'number' ? x - y : x.localeCompare(y, 'vi', { numeric: true, sensitivity: 'base' });
    return c * dir || a.full_name.localeCompare(b.full_name, 'vi');
  };
}
async function pageEmployees() {
  const addBtn = hasPerm('employees') ? el('button', { class: 'btn' }, '+ Thêm nhân viên') : null;
  const canEdit = hasPerm('employees');
  // Thanh nút GỌN: các việc Excel và máy chấm công gom vào 2 menu thả xuống
  const excelMenu = canEdit ? rowMenu([
    { label: '⬇ Xuất danh sách nhân viên', hint: 'Xuất bộ phận đang chọn bên trái (chọn "Tất cả nhân viên" = cả công ty) — cùng mẫu cột file nhập', fn: downloadEmpExport },
    { label: '📄 Tải file mẫu', fn: downloadEmpTemplate },
    { label: '⬆ Nhập nhân viên mới từ Excel', fn: () => importEmployees('add') },
    { label: '🔄 Cập nhật nhân viên từ Excel', fn: () => importEmployees('update') },
  ], '📊 Excel ▾') : null;
  // Làm mới danh sách (NV tải từ máy chấm công về không tự hiện, trước đây phải F5 cả trang)
  const refreshBtn = el('button', { class: 'btn ghost sm', title: 'Làm mới danh sách nhân viên' }, '↻');
  refreshBtn.onclick = () => pageEmployees();
  const devMenu = (hasPerm('devices') && deviceEnabled()) ? rowMenu([
    { label: '⬇ Đẩy NV xuống máy…', hint: 'Số ID + tên, kèm vân tay/mặt nếu có', fn: async () => { try { pushEmpModal((await api('/admin/devices')).rows, pageEmployees); } catch (e) { toast(e.message, 'err'); } } },
    { label: '📸 Tải ảnh khuôn mặt + đẩy xuống máy…', hint: 'Chọn ảnh chân dung (tên file = Mã NV) → máy chấm mặt được', fn: async () => { try { pushEmpModal((await api('/admin/devices')).rows, pageEmployees, { face: true }); } catch (e) { toast(e.message, 'err'); } } },
    { label: '🗑 Xóa NV trên máy…', hint: 'NV nghỉ việc: xoá trên tất cả máy 1 lần rồi hỏi khoá luôn', fn: () => deleteUsersAllModal(pageEmployees) },
  ], '🔌 Máy chấm công ▾') : null;
  const headArgs = ['Nhân viên', refreshBtn, addBtn, excelMenu, devMenu].filter(Boolean);
  setMain(head(...headArgs), loading());
  try {
    await loadRefs();
    const { rows } = await api('/admin/employees');
    if (addBtn) addBtn.onclick = () => empModal(null);
    const headArgs2 = ['Nhân viên (' + rows.length + ')', refreshBtn, addBtn, excelMenu, devMenu].filter(Boolean);

    // ===== Cây BỘ PHẬN bên trái (bấm để lọc) + bảng nhân viên GỌN bên phải, xếp theo bộ phận =====
    const NONE = EMP_NONE;                           // khoá cho NV chưa có bộ phận
    { const ids = new Set(rows.map((e) => e.id)); for (const id of [...empPicked]) if (!ids.has(id)) empPicked.delete(id); }
    const kids = new Map();                          // id bộ phận → các bộ phận con trực tiếp
    for (const d of DEPARTMENTS) { const k = d.parent_id || 0; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(d); }
    const namesUnder = (d) => [d.name, ...(kids.get(d.id) || []).flatMap(namesUnder)];   // tên bộ phận + mọi cấp con
    const cnt = new Map();
    for (const e of rows) { const k = e.department || NONE; cnt.set(k, (cnt.get(k) || 0) + 1); }
    const known = new Set(DEPARTMENTS.map((d) => d.name));
    const nodes = deptOrdered().map((d) => {
      const names = namesUnder(d);
      return { key: d.name, label: d.name, depth: d.depth, id: d.id, parent: d.parent_id || 0, names, hasKids: (kids.get(d.id) || []).length > 0,
        count: names.reduce((n, x) => n + (cnt.get(x) || 0), 0) };
    });
    // Bộ phận NV đang mang nhưng không còn trong danh mục + nhóm "Chưa có bộ phận"
    for (const k of [...cnt.keys()].filter((k) => k !== NONE && !known.has(k)).sort((x, y) => x.localeCompare(y, 'vi')))
      nodes.push({ key: k, label: k + ' (cũ)', depth: 0, id: 0, parent: 0, names: [k], hasKids: false, count: cnt.get(k) });
    if (cnt.has(NONE)) nodes.push({ key: NONE, label: 'Chưa có bộ phận', depth: 0, id: 0, parent: 0, names: [NONE], hasKids: false, count: cnt.get(NONE) });
    if (empDeptSel !== '*' && !nodes.some((n) => n.key === empDeptSel)) empDeptSel = '*';
    if (!_empTreeInit) { for (const n of nodes) if (n.hasKids) empDeptClosed.add(n.key); _empTreeInit = true; }
    const orderOf = new Map(nodes.map((n, i) => [n.key, i]));

    const tree = el('div', { class: 'emp-tree' });
    const listBox = el('div', { class: 'panel tbl-scroll' });
    const searchI = el('input', { type: 'search', placeholder: '🔍 Tìm mã, tên, tài khoản…', value: empSearch, style: 'max-width:280px' });
    const countLbl = el('span', { style: 'font-size:12.5px;color:var(--muted)' });
    const bulkBar = el('span', { style: 'display:flex;gap:6px;align-items:center;margin-left:auto' });
    let allCb = null, visList = [];
    // Thanh "Đã chọn N" + nút Xoá hàng loạt; ô tích tiêu đề: tích hết / một phần / chưa tích
    const renderBulk = () => {
      bulkBar.innerHTML = '';
      if (allCb) { const n = visList.filter((e) => empPicked.has(e.id)).length; allCb.checked = n > 0 && n === visList.length; allCb.indeterminate = n > 0 && n < visList.length; }
      if (!empPicked.size) return;
      const picked = rows.filter((e) => empPicked.has(e.id));
      const delB = btnSm('🗑 Xóa ' + picked.length + ' nhân viên', () => delEmpBulk(picked)); delB.style.background = '#c0392b'; delB.style.borderColor = '#c0392b';
      const nOn = picked.filter((e) => e.active).length, nOff = picked.length - nOn;
      bulkBar.append(el('b', { style: 'font-size:13px' }, 'Đã chọn ' + picked.length), btnSm('🏢 Chuyển bộ phận', () => moveDeptBulk(picked)),
        ...(nOn ? [btnSm('🔒 Khoá ' + nOn + ' nhân viên', () => lockEmpBulk(picked, true), 'ghost')] : []),
        ...(nOff ? [btnSm('🔓 Mở khoá ' + nOff, () => lockEmpBulk(picked, false), 'ghost')] : []),
        delB, btnSm('Bỏ chọn', () => { empPicked.clear(); renderList(); }, 'ghost'));
    };

    const renderTree = () => {
      tree.innerHTML = '';
      const row = (key, label, count, depth, node) => {
        const tog = node && node.hasKids
          ? el('span', { class: 'tg', title: 'Mở/gọn', onclick: (ev) => { ev.stopPropagation(); empDeptClosed.has(key) ? empDeptClosed.delete(key) : empDeptClosed.add(key); renderTree(); } }, empDeptClosed.has(key) ? '▸' : '▾')
          : el('span', { class: 'tg' }, '');
        tree.append(el('div', { class: 'tn' + (empDeptSel === key ? ' on' : ''), style: 'padding-left:' + (6 + depth * 14) + 'px', onclick: () => { empDeptSel = key; renderTree(); renderList(); } },
          tog, el('span', { class: 'nm' }, label), el('span', { class: 'ct' }, String(count))));
      };
      row('*', 'Tất cả nhân viên', rows.length, 0, null);
      const hidden = new Set();   // id bộ phận đang bị gọn (ẩn toàn bộ cấp con)
      for (const n of nodes) {
        if (n.parent && hidden.has(n.parent)) { if (n.id) hidden.add(n.id); continue; }
        if (n.id && empDeptClosed.has(n.key)) hidden.add(n.id);
        row(n.key, n.label, n.count, n.depth, n);
      }
    };

    const renderList = () => {
      const sel = nodes.find((n) => n.key === empDeptSel);
      const allow = sel ? new Set(sel.names) : null;
      const q = empSearch.trim().toLowerCase();
      // Cột Số ID máy chấm công: chỉ hiện khi đang dùng máy chấm công (chỉ chấm định vị/điện thoại thì ẩn)
      const showPin = deviceEnabled(), NCOL = (showPin ? 9 : 8) + (canEdit ? 1 : 0);
      if (empSort && empSort.key === 'device_pin' && !showPin) empSort = null;
      const list = rows.filter((e) => (!allow || allow.has(e.department || NONE))
        && (!q || [e.code, e.full_name, e.username, e.device_pin, e.position, e.department].some((v) => String(v || '').toLowerCase().includes(q))))
        .sort(empSort ? empCompare(empSort) : (x, y) => (orderOf.get(x.department || NONE) ?? 9999) - (orderOf.get(y.department || NONE) ?? 9999) || x.full_name.localeCompare(y.full_name, 'vi'));
      countLbl.innerHTML = '';
      countLbl.append(list.length + ' nhân viên' + (sel ? ' · ' + sel.label : ''));
      if (empSort) {
        const lb = EMP_SORT_COLS.find((c) => c[0] === empSort.key)?.[1] || '';
        countLbl.append(' · ', el('span', { class: 'pill', style: 'cursor:pointer', title: 'Bỏ sắp xếp — về nhóm theo bộ phận', onclick: () => { empSort = null; renderList(); } },
          `Sắp theo ${lb} ${empSort.dir > 0 ? '▲' : '▼'}  ✕`));
      }
      const tbl = el('table', { class: 'data emp-compact' });
      // Tiêu đề cột bấm được: lần 1 thấp → cao, lần 2 cao → thấp
      const hrow = el('tr');
      visList = list; allCb = null;
      if (canEdit) {
        allCb = el('input', { type: 'checkbox', title: 'Chọn / bỏ chọn tất cả nhân viên đang hiện trong bảng' });
        allCb.onchange = () => { for (const e of list) allCb.checked ? empPicked.add(e.id) : empPicked.delete(e.id); renderList(); };
        hrow.append(el('th', { style: 'width:30px' }, allCb));
      }
      for (const [key, label, tip] of EMP_SORT_COLS) {
        if (key === 'device_pin' && !showPin) continue;
        const on = empSort && empSort.key === key;
        hrow.append(el('th', { class: 'sortable' + (on ? ' on' : ''), title: (tip ? tip + ' — ' : '') + 'Bấm để sắp xếp (lần 1 thấp → cao, lần 2 cao → thấp)',
          onclick: () => { empSort = on && empSort.dir > 0 ? { key, dir: -1 } : { key, dir: 1 }; renderList(); } },
          label, el('span', { class: 'sort-ic' }, on ? (empSort.dir > 0 ? ' ▲' : ' ▼') : ' ⇅')));
      }
      hrow.append(el('th'));
      tbl.append(el('thead', {}, hrow));
      const tb = el('tbody');
      let lastDept = null;
      for (const e of list) {
        const dk = e.department || NONE;
        if (!empSort && dk !== lastDept) {   // dòng tiêu đề nhóm bộ phận (chỉ khi không sắp xếp theo cột)
          lastDept = dk;
          const n = list.filter((x) => (x.department || NONE) === dk).length;
          tb.append(el('tr', { class: 'grp' }, el('td', { colspan: NCOL }, (dk === NONE ? 'Chưa có bộ phận' : dk) + ' (' + n + ')')));
        }
        const delBtn = btnSm('🗑', () => delEmp(e), 'ghost'); delBtn.style.color = '#c0392b'; delBtn.title = 'Xóa nhân viên';
        const actions = hasPerm('employees') ? el('div', { style: 'display:flex;gap:4px;justify-content:flex-end' },
          btnSm('Sửa', () => empModal(e)),
          e.active ? btnSm('Khoá', () => toggleEmp(e), 'ghost') : btnSm('Mở khoá', () => unlockEmp(e), 'ghost'),
          delBtn) : '';
        let cb = '';
        if (canEdit) {
          cb = el('input', { type: 'checkbox' }); cb.checked = empPicked.has(e.id);
          cb.onchange = () => { cb.checked ? empPicked.add(e.id) : empPicked.delete(e.id); renderBulk(); };
        }
        tb.append(el('tr', {},
          canEdit ? el('td', {}, cb) : '',
          el('td', {}, e.code),
          showPin ? el('td', {}, e.device_pin ? el('b', { style: 'color:#0a7' }, e.device_pin) : el('span', { class: 'muted' }, '—')) : '',
          el('td', {}, el('b', {}, e.full_name),
            e.from_device ? el('span', { class: 'pill warn', style: 'margin-left:6px', title: 'Tự tạo khi đăng ký vân tay trên máy — bổ sung thông tin rồi lưu' }, 'nháp từ máy') : '',
            (e.device_admin_on || []).length ? el('span', { class: 'pill', style: 'margin-left:6px;background:#fdf0df;color:#a25a08', title: 'Quản trị MÁY chấm công (vào được menu máy) tại: ' + e.device_admin_on.join(', ') }, '👑 QT máy') : ''),
          el('td', {}, e.department || el('span', { class: 'muted' }, '—')),   // cột Bộ phận (Anh 11/11/2026)
          el('td', {}, e.position || '—'),
          el('td', {}, e.username),
          el('td', {}, e.audit_only && !isInspector() ? el('span', { class: 'pill', style: 'background:#fef3c7;color:#92400e' }, '🔍 Kiểm tra · Ảo ' + (+e.audit_only || 1)) : roleLabel(e.role)),
          el('td', {}, e.active ? el('span', { class: 'pill ok' }, 'Hoạt động') : el('span', { class: 'pill bad' }, 'Khoá')),
          el('td', {}, actions),
        ));
      }
      if (!list.length) tb.append(el('tr', {}, el('td', { colspan: NCOL }, el('div', { class: 'empty' }, 'Không có nhân viên nào.'))));
      tbl.append(tb);
      listBox.innerHTML = ''; listBox.append(tbl);
      renderBulk();
    };
    searchI.oninput = () => { empSearch = searchI.value; renderList(); };
    renderTree(); renderList();
    let pcCount = 0;
    if (hasPerm('devices') && deviceEnabled()) { try { pcCount = (await api('/admin/devices/pin-conflicts?count=1')).count; } catch {} }
    setMain(head(...headArgs2), pinConflictBar(pcCount, pageEmployees),
      el('div', { class: 'emp-wrap' },
        el('div', { class: 'panel emp-side' }, el('div', { class: 'emp-side-h' }, 'Bộ phận'), tree),
        el('div', { class: 'emp-main' }, el('div', { style: 'display:flex;gap:10px;align-items:center;margin-bottom:8px;flex-wrap:wrap' }, searchI, countLbl, bulkBar), listBox)));
  } catch (e) { setMain(head('Nhân viên'), el('div', { class: 'empty' }, e.message)); }
}
// Xuất danh sách nhân viên ra Excel (cùng mẫu cột với file nhập) — theo bộ phận đang chọn trên cây (gồm bộ phận con)
async function downloadEmpExport() {
  const dept = empDeptSel === '*' ? '' : empDeptSel === EMP_NONE ? '__none__' : empDeptSel;
  try {
    const res = await api('/admin/employees/export.xlsx' + (dept ? '?dept=' + encodeURIComponent(dept) : ''), { raw: true });
    if (!res.ok) { toast('Không xuất được danh sách', 'err'); return; }
    const name = (/filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '') || [])[1] || 'danh_sach_nhan_vien.xlsx';
    const url = URL.createObjectURL(await res.blob());
    const a = el('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Đã xuất danh sách nhân viên ' + (dept === '__none__' ? '· Chưa có bộ phận' : dept ? '· ' + dept : 'cả công ty'), 'ok');
  } catch { toast('Không xuất được danh sách', 'err'); }
}
// Tải file Excel mẫu nhập nhân viên
async function downloadEmpTemplate() {
  try {
    const res = await api('/admin/employees/template.xlsx', { raw: true });
    if (!res.ok) { toast('Không tải được file mẫu', 'err'); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = el('a', { href: url, download: 'mau_nhan_vien.xlsx' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Đã tải file mẫu', 'ok');
  } catch { toast('Không tải được file mẫu', 'err'); }
}
// Nhập nhân viên bằng Excel (mode 'add' = thêm mới, 'update' = cập nhật)
function importEmployees(mode) {
  const fileI = el('input', { type: 'file', accept: '.xlsx', style: 'display:none' });
  document.body.appendChild(fileI);
  fileI.onchange = () => {
    const f = fileI.files[0]; if (!f) { fileI.remove(); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const r = await api('/admin/employees/import', { method: 'POST', body: { mode, fileBase64: reader.result } });
        const lines = [
          mode === 'add' ? `✅ Đã thêm mới: ${r.added} nhân viên` : `✅ Đã cập nhật: ${r.updated} nhân viên`,
          r.skipped ? `⏭️ Bỏ qua: ${r.skipped}` : '',
          r.newDepts ? `🏢 Tạo mới bộ phận: ${r.newDepts}` : '',
          r.newPos ? `🏷️ Tạo mới chức danh: ${r.newPos}` : '',
        ].filter(Boolean);
        if (r.errors && r.errors.length) lines.push('', '⚠️ Chi tiết bỏ qua:', ...r.errors);
        alert(lines.join('\n'));
        pageEmployees();
      } catch (e) { toast(e.message || 'Lỗi nhập Excel', 'err'); }
      fileI.remove();
    };
    reader.readAsDataURL(f);
  };
  fileI.click();
}
function roleLabel(r) { return el('span', { class: 'pill ' + (r === 'admin' ? 'bad' : r === 'manager' ? 'warn' : 'muted') }, { admin: 'Admin', manager: 'Quản lý', employee: 'Nhân viên' }[r]); }
function btnSm(t, fn, cls = '') { const b = el('button', { class: 'btn sm ' + cls }, t); b.onclick = fn; return b; }

// Menu "⋯ Thêm" gọn gàng cho các dòng nhiều nút — dùng 1 dropdown dùng chung (khỏi rối, khỏi rò DOM)
let _rowDD;
function rowMenu(items, label = '⋯ Thêm') {
  const list = items.filter(Boolean);
  const btn = el('button', { class: 'btn sm ghost' }, label);
  btn.onclick = (e) => {
    e.stopPropagation();
    if (!_rowDD) {
      _rowDD = el('div', { class: 'rm-dd', style: 'display:none' });
      document.body.append(_rowDD);
      // Bấm ra ngoài (trừ chính nút đang mở — nút tự xử lý bật/tắt) hoặc Esc / cuộn trang → đóng menu
      document.addEventListener('click', (ev) => { if (_rowDD && _rowDD.style.display !== 'none' && !_rowDD.contains(ev.target) && !(_rowDD._owner && _rowDD._owner.contains(ev.target))) _rowDD.style.display = 'none'; }, true);
      document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && _rowDD) _rowDD.style.display = 'none'; });
      window.addEventListener('scroll', (ev) => { if (_rowDD && !_rowDD.contains(ev.target)) _rowDD.style.display = 'none'; }, true);
    }
    if (_rowDD.style.display !== 'none' && _rowDD._owner === btn) { _rowDD.style.display = 'none'; return; }
    _rowDD._owner = btn; _rowDD.innerHTML = '';
    const groups = [];
    for (const it of list) {
      const g = it.group || '';
      let grp = groups.find((x) => x.name === g);
      if (!grp) { grp = { name: g, items: [] }; groups.push(grp); }
      grp.items.push(it);
    }
    const twoCol = groups.length >= 3 && innerWidth >= 620;
    _rowDD.className = 'rm-dd' + (twoCol ? ' two' : '');
    for (const grp of groups) {
      const box = el('div', { class: 'rm-grp' }, grp.name ? el('div', { class: 'rm-h' }, grp.name) : '');
      for (const it of grp.items) {
        const mi = el('button', { class: 'rm-it' + (it.danger ? ' danger' : ''), title: it.hint || '' }, it.label);
        mi.onclick = () => { _rowDD.style.display = 'none'; it.fn(); };
        box.append(mi);
      }
      _rowDD.append(box);
    }
    const r = btn.getBoundingClientRect();
    _rowDD.style.display = twoCol ? 'grid' : 'flex';   // hiện/ẩn chỉ bằng style.display (CSS không được ép display)
    const mw = _rowDD.offsetWidth || 180;
    if (_rowDD.offsetHeight > innerHeight - 16) _rowDD.style.maxHeight = (innerHeight - 16) + 'px';
    let left = Math.min(r.right - mw, innerWidth - mw - 8); if (left < 8) left = 8;   // nút nằm khuất (bảng cuộn ngang) → vẫn hiện trong màn hình
    let top = r.bottom + 4; if (top + _rowDD.offsetHeight > innerHeight - 8) top = Math.max(8, r.top - _rowDD.offsetHeight - 4);
    _rowDD.style.left = left + 'px'; _rowDD.style.top = top + 'px';
  };
  return btn;
}

// Khung THU GỌN trong form: tiêu đề + dòng tóm tắt (khi gọn); bấm để mở/đóng. Trả node có .refresh() / .setOpen(o)
function formSection(title, summary, nodes, open = false) {
  const tg = el('span', { class: 'tg' });
  const sum = el('span', { class: 'sum' });
  const head = el('button', { type: 'button', class: 'f-sec-h' }, tg, el('b', {}, title), sum);
  const sec = el('div', { class: 'f-sec' }, head, el('div', { class: 'f-sec-b' }, ...nodes));
  const refresh = () => { tg.textContent = open ? '▾' : '▸'; sec.classList.toggle('open', open); sum.textContent = open ? '' : (summary ? '— ' + summary() : ''); };
  sec.setOpen = (o) => { open = o; refresh(); };
  sec.refresh = refresh;
  head.onclick = () => sec.setOpen(!open);
  sec.addEventListener('change', refresh); sec.addEventListener('input', refresh);
  refresh();
  return sec;
}
function empModal(e) {
  const f = {};
  const mk = (id, ph, val = '') => (f[id] = input('e-' + id, { placeholder: ph, value: val }));
  const roleSel = el('select', { id: 'e-role' },
    ...['employee', 'manager', 'admin'].map(v => el('option', { value: v, ...(e?.role === v ? { selected: '' } : {}) }, { employee: 'Nhân viên', manager: 'Quản lý', admin: 'Admin' }[v])));
  // Định vị được phép chấm quản lý từ CHI NHÁNH; phân công ca quản lý từ màn PHÂN CA
  // → bỏ cả 2 khỏi form NV. Không gửi office_ids/shift_id/work_schedule_id → giữ nguyên gán sẵn.

  // Bộ phận: dropdown phân cấp cha-con (khai báo ở tab "Bộ phận")
  const deptSel = el('select', { id: 'e-department' },
    el('option', { value: '' }, '— Chọn bộ phận —'),
    ...deptOrdered().map(d => el('option', { value: d.name, ...(e?.department === d.name ? { selected: '' } : {}) },
      ' '.repeat(d.depth * 3) + (d.depth ? '↳ ' : '') + d.name)));
  if (e?.department && !DEPARTMENTS.some(d => d.name === e.department))
    deptSel.append(el('option', { value: e.department, selected: '' }, e.department + ' (cũ)'));
  // Thêm nhanh bộ phận/chức danh NGAY trong form NV (khỏi phải ra tab "Bộ phận"); tab cũ vẫn giữ nguyên.
  // Bộ phận thêm ở đây là cấp gốc — muốn xếp cha-con thì chỉnh ở tab "Bộ phận".
  const quickAdd = (kind, sel) => {
    if (!hasPerm('departments')) return '';
    const label = kind === 'dept' ? 'bộ phận' : 'chức danh';
    const btn = el('button', { type: 'button', class: 'btn ghost sm', title: 'Thêm ' + label + ' mới', style: 'white-space:nowrap' }, '+ Thêm');
    btn.onclick = async () => {
      const name = (prompt('Tên ' + label + ' mới:', '') || '').trim();
      if (!name) return;
      const list = kind === 'dept' ? DEPARTMENTS : POSITIONS;
      const has = list.find(x => x.name.trim().toLowerCase() === name.toLowerCase());
      try {
        if (!has) {
          if (kind === 'dept') { await api('/admin/departments', { method: 'POST', body: { name, parent_id: null } }); DEPARTMENTS = (await api('/admin/departments')).rows; }
          else { await api('/admin/positions', { method: 'POST', body: { name } }); POSITIONS = (await api('/admin/positions')).rows; }
          toast('Đã thêm ' + label + ' "' + name + '"', 'ok');
        }
        const val = has ? has.name : name;
        if (![...sel.options].some(o => o.value === val)) sel.append(el('option', { value: val }, val));
        sel.value = val;
      } catch (err) { toast(err.message, 'err'); }
    };
    return btn;
  };
  const withAdd = (sel, kind) => el('div', { style: 'display:flex;gap:6px;align-items:center' }, sel, quickAdd(kind, sel));
  const deptField = el('div', {}, el('label', {}, 'Bộ phận'), withAdd(deptSel, 'dept'));

  // Chức danh: chọn từ danh mục đã khai báo (menu Tổ chức → Chức danh)
  const posSel = el('select', { id: 'e-position' },
    el('option', { value: '' }, '— Chọn chức danh —'),
    ...POSITIONS.map(p => el('option', { value: p.name, ...(e?.position === p.name ? { selected: '' } : {}) }, p.name)));
  if (e?.position && !POSITIONS.some(p => p.name === e.position))
    posSel.append(el('option', { value: e.position, selected: '' }, e.position + ' (cũ)'));
  const posField = el('div', {}, el('label', {}, 'Chức danh'), withAdd(posSel, 'pos'));

  // ----- Phân quyền chi tiết (chỉ áp cho Quản lý / Nhân viên; Admin toàn quyền) -----
  const permWrap = el('div', { id: 'e-perm-wrap', style: 'margin-top:4px' });
  const initialPerms = () => {
    if (e && e.permissions) { try { const p = JSON.parse(e.permissions); if (Array.isArray(p)) return p; } catch {} }
    return (e?.role === 'manager') ? MANAGER_DEFAULT.slice() : [];
  };
  let permState = new Set(initialPerms());
  const renderPerms = (role) => {
    permWrap.innerHTML = '';
    // Nhân viên (dùng app điện thoại) → không cần phân quyền quản trị: ẩn hẳn cho gọn form.
    if (role === 'employee') return;
    if (role === 'admin') { permWrap.append(el('div', { class: 'map-hint' }, '👑 Admin có toàn quyền mọi chức năng — không cần phân quyền.')); return; }
    // Quản lý: gói danh sách quyền vào nút mũi tên (mặc định thu gọn) cho đỡ vướng.
    const grid = el('div', { style: 'display:none;grid-template-columns:1fr 1fr;gap:6px 12px;margin-top:8px;padding:10px;border:1px solid var(--line,#eee);border-radius:10px' });
    for (const [k, label] of PERM_CATALOG) {
      const cb = el('input', { type: 'checkbox', class: 'e-perm', value: k, style: 'width:auto', ...(permState.has(k) ? { checked: '' } : {}) });
      cb.addEventListener('change', () => { cb.checked ? permState.add(k) : permState.delete(k); updateToggle(); });
      grid.append(el('label', { style: 'display:flex;align-items:center;gap:6px;font-weight:500;color:var(--ink)' }, cb, label));
    }
    let open = false;
    const toggle = el('button', { type: 'button', class: 'btn ghost sm', style: 'width:100%;text-align:left;margin-top:2px' });
    const updateToggle = () => { toggle.textContent = `${open ? '▾' : '▸'} Cho phép dùng chức năng (đã chọn ${permState.size})`; };
    toggle.onclick = () => { open = !open; grid.style.display = open ? 'grid' : 'none'; updateToggle(); };
    updateToggle();
    permWrap.append(toggle, grid);
  };
  roleSel.addEventListener('change', () => {
    // Đổi vai trò → gợi ý bộ quyền mặc định của vai trò đó
    permState = new Set(roleSel.value === 'manager' ? MANAGER_DEFAULT : (roleSel.value === 'admin' ? [] : []));
    renderPerms(roleSel.value);
  });
  renderPerms(e?.role || 'employee');

  // Số ID máy chấm công: chỉ ĐẶT được khi đang TRỐNG (chưa có). Đã có rồi thì KHÓA, không đổi.
  const pinLocked = !!(e && (e.device_pin || '').trim());
  const pinInput = input('e-device_pin', { placeholder: 'VD: 1 (số ID trên máy)', value: e?.device_pin || '',
    ...(pinLocked ? { readonly: '', style: 'background:#f2f0ee;color:#777;cursor:not-allowed' } : {}) });
  f.device_pin = pinInput;
  const pinHint = pinLocked
    ? (e.from_device ? 'Lấy từ máy chấm công — không sửa được.' : 'Đã có số ID — không sửa được.')
    : (e ? 'Nhân viên này chưa có số ID. Nhập rồi bấm Lưu — sau khi lưu sẽ khóa.'
         : 'Nhập số ID trùng với số ID trên máy. Sau khi tạo sẽ không sửa được.');
  const pinField = el('div', {}, el('label', {}, 'Số ID máy chấm công' + (pinLocked ? ' 🔒' : '')),
    pinInput, el('div', { class: 'map-hint', style: 'margin-top:3px' }, pinHint));

  // ẢNH KHUÔN MẶT ngay khi khai NV (như nền tảng Hikvision: thêm người kèm ảnh rồi phát xuống cửa).
  // Lưu NV xong: gắn ảnh cho Số ID → (tích sẵn khi vừa chọn ảnh) đẩy NV + ảnh xuống các máy đã chọn.
  const faceOn = deviceEnabled();
  const canPush = faceOn && hasPerm('devices');
  let faceB64 = null, devChks = [];
  const faceImg = el('img', { alt: '', style: 'width:72px;height:72px;object-fit:cover;border-radius:12px;border:2px solid var(--brand,#E8541E);display:none' });
  const faceFile = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  const faceBtn = btnSm('📷 Chọn ảnh…', () => faceFile.click(), 'ghost');
  faceBtn.type = 'button';
  const pushChk = el('input', { type: 'checkbox', style: 'width:auto;margin:0' });
  const devWrap = el('div', { style: 'display:flex;gap:4px 14px;flex-wrap:wrap;margin:4px 0 0 22px' });
  faceFile.onchange = async () => {
    const fl = faceFile.files[0]; faceFile.value = ''; if (!fl) return;
    try {
      faceB64 = await faceJpeg(fl);
      faceImg.src = 'data:image/jpeg;base64,' + faceB64; faceImg.style.display = '';
      faceBtn.textContent = '📷 Đổi ảnh…'; pushChk.checked = true;
    } catch (err) { toast(err.message, 'err'); }
  };
  if (canPush) api('/admin/devices').then((d) => {
    const devs = (d.rows || []).filter((m) => m.active && m.conn_type !== 'union');
    devChks = devs.map((m) => {
      const c = el('input', { type: 'checkbox', value: m.serial, checked: '', style: 'width:auto;margin:0' });
      devWrap.append(el('label', { style: 'display:flex;gap:5px;align-items:center;font-weight:500;color:var(--ink)' }, c, m.name || m.serial));
      return c;
    });
    if (!devs.length) devWrap.append(el('span', { class: 'map-hint' }, 'Chưa có máy chấm công nào đang dùng.'));
  }).catch(() => {});
  if (faceOn && e && (e.device_pin || '').trim()) api('/admin/employees/' + e.id + '/biometrics').then((d) => {
    if (d.photoData && !faceB64) { faceImg.src = d.photoData; faceImg.style.display = ''; faceBtn.textContent = '📷 Đổi ảnh…'; }
  }).catch(() => {});
  const faceField = faceOn ? el('div', { style: 'margin-top:4px;padding:10px 12px;border:1px solid var(--line,#eee);border-radius:12px' },
    el('label', {}, '📸 Ảnh khuôn mặt (để chấm công bằng khuôn mặt)'),
    el('div', { style: 'display:flex;gap:10px;align-items:center' }, faceImg, faceBtn, faceFile),
    el('div', { class: 'map-hint', style: 'margin-top:4px' }, 'Ảnh chân dung chính diện, rõ mặt, lấy từ vai trở lên. Chụp bằng điện thoại được (ảnh iPhone gửi qua Zalo/Gmail sang máy tính để thành JPG). Phần mềm tự thu nhỏ ảnh. Cần có Số ID máy chấm công.'),
    canPush ? el('label', { style: 'display:flex;gap:6px;align-items:center;margin-top:8px;font-weight:600;color:var(--ink)' }, pushChk, 'Lưu xong đẩy NV + ảnh khuôn mặt xuống máy:') : '',
    canPush ? devWrap : '') : null;

  const codeRow = el('div', { class: 'two-col' }, field('Mã NV *', mk('code', 'VD: NV002', e?.code)), field('Họ tên *', mk('full_name', 'Nguyễn Văn A', e?.full_name)));
  // ----- Các mục ít dùng: gom vào khung THU GỌN (mặc định gọn, có dòng tóm tắt) -----
  const attSel = el('select', { id: 'e-attmode' }, ...['', 'shift', 'hourly'].map((v) => el('option', { value: v, ...((e?.att_mode || '') === v ? { selected: '' } : {}) },
    v === '' ? `Theo cài đặt chung (hiện là: ${SETTINGS.attendance_mode === 'hourly' ? 'theo giờ' : 'theo ca'})` : ATT_MODE_LABEL[v])));
  const startI = input('e-start', { type: 'date', value: e?.start_date || '' });
  const leaveI = input('e-leaveyear', { type: 'number', min: 0, step: 0.5, value: e?.leave_days_year ?? '', placeholder: 'theo Cài đặt' });
  const pwI = input('e-password', { type: 'text', placeholder: e ? 'Để trống = giữ nguyên' : 'Để trống = 123456' });
  const userI = mk('username', e ? '' : 'Để trống = mã NV', e?.username);
  const auditSel = (isAdmin() && (SETTINGS.audit_enabled === '1' || e?.audit_only))
    ? (() => { const sel = el('select', { id: 'e-auditonly', style: 'width:auto;margin:0' }, ...[['0', 'Không'], ['1', 'Chỉ xem Công ảo 1'], ['2', 'Chỉ xem Công ảo 2'], ['3', 'Chỉ xem Công ảo 3']].map(([v, t]) => el('option', { value: v }, t))); sel.value = String(e?.audit_only || 0); return sel; })()
    : null;
  const ROLE_TXT = { employee: 'Nhân viên', manager: 'Quản lý', admin: 'Admin' };
  const dmy = (iso) => iso ? iso.split('-').reverse().join('/') : '';
  const accSec = formSection('🔑 Tài khoản đăng nhập', () => {
    const u = userI.value.trim() || f.code.value.trim() || 'mã NV';
    const pw = pwI.value ? 'mật khẩu mới' : (e ? 'giữ mật khẩu' : 'mật khẩu 123456');
    return `${u} · ${ROLE_TXT[roleSel.value] || ''} · ${pw}`;
  }, [
    el('div', { class: 'two-col' }, field('Tài khoản', userI), field(e ? 'Mật khẩu mới' : 'Mật khẩu', pwI)),
    field('Vai trò', roleSel), permWrap,
  ]);
  const advSec = formSection('⚙️ Nâng cao', () => {
    const parts = [attSel.value ? '⚠ chấm ' + (ATT_MODE_LABEL[attSel.value] || attSel.value).toLowerCase() : 'Chấm công theo cài đặt chung'];
    if (startI.value) parts.push('vào làm ' + dmy(startI.value));
    if (leaveI.value !== '') parts.push('phép riêng ' + leaveI.value + ' ngày');
    return parts.join(' · ');
  }, [
    field('Kiểu chấm công (chỉ đổi khi NV này ngoại lệ)', attSel),
    el('div', { class: 'two-col' }, field('Ngày vào làm (tính phép năm, thâm niên)', startI),
      field('Phép năm riêng, chưa gồm thâm niên (trống = mức chung)', leaveI)),
    ...(e && deviceLockEnabled() ? [(() => {
      const status = e.device_id ? 'Đã gắn 1 điện thoại' : (e.pending_device ? 'Đang chờ duyệt đổi máy' : 'Chưa gắn điện thoại nào');
      const wrap = el('div', { style: 'margin-top:4px' }, el('label', {}, '📱 Thiết bị chấm công'),
        el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' },
          el('span', { class: 'pill ' + (e.device_id ? 'ok' : 'muted') }, status)));
      if (e.device_id || e.pending_device) {
        const rb = el('button', { class: 'btn ghost sm', type: 'button' }, 'Gỡ thiết bị (cho gắn máy mới)');
        rb.onclick = async () => { if (confirm('Gỡ thiết bị của ' + e.full_name + '? Lần chấm tới sẽ tự gắn điện thoại nhân viên đang cầm.')) { try { await api('/admin/employees/' + e.id + '/reset-device', { method: 'POST' }); toast('Đã gỡ thiết bị', 'ok'); closeModal(); pageEmployees(); } catch (err) { toast(err.message, 'err'); } } };
        wrap.querySelector('div').append(rb);
      }
      return wrap;
    })()] : []),
  ]);
  const auditSec = auditSel ? formSection('🔍 Quyền công ảo', () => auditSel.value === '0' ? 'Không' : auditSel.options[auditSel.selectedIndex].text, [
    el('label', { class: 'lv-chk', style: 'padding:10px;border:1px dashed #f59e0b;border-radius:10px;background:#fffbeb;margin:0' }, auditSel,
      el('div', {}, el('b', {}, 'Tài khoản kiểm tra — chỉ xem công ảo của 1 mức'),
        el('div', { class: 'map-hint', style: 'margin-top:2px' }, 'Dùng khi có đoàn kiểm tra: đăng nhập tài khoản này chỉ thấy công / lương ẢO ở mọi màn (không có nút bật/tắt, không thấy lượt quẹt thật, sửa giờ, nhật ký, máy chấm công), chỉ được xem, không sửa gì. Tự đặt vai trò Quản lý. Tài khoản này không hiện trong bảng công / bảng lương.'))),
  ]) : null;
  f.code.addEventListener('input', () => accSec.refresh());   // tóm tắt tài khoản = mã NV khi để trống

  const body = [
    codeRow,
    el('div', { class: 'two-col' }, deptField, posField),
    el('div', { class: 'two-col' }, field('Số điện thoại', mk('phone', '', e?.phone)), pinField),
    faceField,
    accSec, advSec, auditSec,
  ].filter(Boolean);
  const save = el('button', { class: 'btn' }, e ? 'Lưu thay đổi' : 'Tạo nhân viên');
  save.onclick = async () => {
    const body = {
      code: f.code.value.trim(), full_name: f.full_name.value.trim(), department: deptSel.value,
      position: posSel.value, phone: f.phone.value, role: roleSel.value,
      username: f.username.value.trim() || undefined,   // trống: tạo mới = mã NV, sửa = giữ nguyên
      password: pwI.value || undefined,
      att_mode: attSel.value,
      start_date: startI.value,
      leave_days_year: leaveI.value,
      audit_only: auditSel ? +auditSel.value : undefined,
    };
    if (body.audit_only && body.role === 'admin') body.role = 'manager';   // tài khoản kiểm tra luôn là Quản lý
    // Số ID chỉ gửi khi CHƯA khóa (tạo mới, hoặc NV cũ chưa có ID); backend cũng chặn đổi ID đã có
    if (!pinLocked) body.device_pin = f.device_pin.value.trim();
    // Không gửi shift_id/work_schedule_id/office_ids → giữ nguyên phân ca & định vị đã gán ở màn riêng
    if (body.role !== 'admin') body.permissions = [...permState];
    const pinNow = pinLocked ? String(e.device_pin).trim() : body.device_pin;
    if (faceB64 && !pinNow) { toast('Nhập Số ID máy chấm công để gắn ảnh khuôn mặt cho nhân viên', 'err'); f.device_pin.focus(); return; }
    const serials = devChks.filter((c) => c.checked).map((c) => c.value);
    const doPush = canPush && pushChk.checked && !!pinNow;
    if (doPush && !serials.length) { toast('Chọn ít nhất 1 máy để đẩy xuống, hoặc bỏ tích "Lưu xong đẩy…"', 'err'); return; }
    let r;
    try {
      r = e ? await api('/admin/employees/' + e.id, { method: 'PUT', body }) : await api('/admin/employees', { method: 'POST', body });
    } catch (err) { if (/tài khoản/i.test(err.message)) accSec.setOpen(true); toast(err.message, 'err'); return; }
    const saved = r && r.relinked ? `Đã lưu — gán ${r.relinked} lượt quẹt cũ của Số ID máy và tính lại công` : 'Đã lưu';
    const empId = e ? e.id : r.id;
    save.disabled = true;
    if (faceB64) {
      try { await api('/admin/employees/' + empId + '/face-photo', { method: 'PUT', body: { photo: faceB64 } }); }
      catch (err) { toast('Đã lưu nhân viên nhưng chưa lưu được ảnh: ' + err.message, 'err'); closeModal(); pageEmployees(); return; }
    }
    if (doPush) {
      try {
        const p = await api('/admin/devices/push-employees', { method: 'POST', body: { pins: [pinNow], serials, with_bio: true } });
        if (p.users) cmdTrack(`Đẩy NV ${body.full_name}${faceB64 ? ' + ảnh khuôn mặt' : ''} xuống máy`, p.track);
        if (p.job) { toast(saved + (faceB64 ? ' + ảnh khuôn mặt' : '') + '. Đang ghi xuống máy…', 'ok'); closeModal(); hikPushJobModal(p.job, true, pageEmployees); return; }
        toast(saved + '. ' + p.msg, p.users ? 'ok' : 'err');
      } catch (err) { toast('Đã lưu nhân viên nhưng chưa đẩy được xuống máy: ' + err.message, 'err'); }
      closeModal(); pageEmployees(); return;
    }
    toast(saved + (faceB64 ? ' + ảnh khuôn mặt. Đẩy xuống máy: Máy chấm công ▾ → Đẩy NV xuống máy.' : ''), 'ok');
    closeModal(); pageEmployees();
  };
  // ----- 2 tab: Thông tin | Sinh trắc/Máy (chỉ khi sửa NV đã có) -----
  let modalBody = body;
  if (e) {
    const tabInfo = el('div', {}, ...body);
    const tabBio = el('div', { hidden: true }, loading());
    let bioLoaded = false;
    const mkTab = (label) => el('button', { class: 'btn sm ghost', type: 'button', style: 'border:none;border-radius:0;border-bottom:2px solid transparent' }, label);
    const tI = mkTab('📋 Thông tin'), tB = mkTab('🖐 Sinh trắc / Máy');
    const sel = (t) => {
      const info = t === 'info';
      tabInfo.hidden = !info; tabBio.hidden = info;
      tI.style.borderBottomColor = info ? 'var(--brand,#E8541E)' : 'transparent';
      tI.style.color = info ? 'var(--brand-dark,#c0410f)' : ''; tI.style.fontWeight = info ? '700' : '';
      tB.style.borderBottomColor = info ? 'transparent' : 'var(--brand,#E8541E)';
      tB.style.color = info ? '' : 'var(--brand-dark,#c0410f)'; tB.style.fontWeight = info ? '' : '700';
      if (!info && !bioLoaded) { bioLoaded = true; loadEmpBio(e, tabBio); }
    };
    tI.onclick = () => sel('info'); tB.onclick = () => sel('bio');
    const tabBar = el('div', { style: 'display:flex;gap:4px;margin-bottom:14px;border-bottom:1px solid var(--line,#eee)' }, tI, tB);
    sel('info');
    modalBody = [tabBar, tabInfo, tabBio];
  }
  openModal(e ? 'Sửa nhân viên' : 'Thêm nhân viên', modalBody, [el('button', { class: 'btn ghost' , onclick: closeModal }, 'Huỷ'), save]);
}
// Tab Sinh trắc: đếm vân tay/khuôn mặt/thẻ/mật mã của NV (theo Số ID máy)
async function loadEmpBio(e, box) {
  box.innerHTML = '';
  if (!(e.device_pin || '').trim()) { box.append(el('div', { class: 'map-hint' }, 'Nhân viên chưa gắn Số ID máy chấm công nên chưa có dữ liệu sinh trắc.')); return; }
  let d; try { d = await api('/admin/employees/' + e.id + '/biometrics'); } catch (err) { box.append(el('div', { class: 'map-hint' }, err.message)); return; }
  // ảnh khuôn mặt: tải từ máy tính (thay ảnh cũ) → đẩy xuống máy ở "Đẩy NV xuống máy · kèm khuôn mặt"
  const fI = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  const upB = btnSm(d.photoData ? '📷 Đổi ảnh khuôn mặt…' : '📷 Tải ảnh khuôn mặt lên…', () => fI.click(), 'ghost');
  fI.onchange = async () => {
    const f = fI.files[0]; fI.value = ''; if (!f) return;
    upB.disabled = true;
    try { await api('/admin/employees/' + e.id + '/face-photo', { method: 'PUT', body: { photo: await faceJpeg(f) } }); toast('Đã lưu ảnh khuôn mặt. Đẩy xuống máy: Máy chấm công ▾ → Đẩy NV xuống máy (tích kèm khuôn mặt).', 'ok'); loadEmpBio(e, box); }
    catch (err) { upB.disabled = false; toast(err.message, 'err'); }
  };
  const delB = d.photoData ? btnSm('Xoá ảnh', async () => {
    if (!confirm('Xoá ảnh khuôn mặt của nhân viên này trong phần mềm? (Không xoá ảnh đã có trên máy chấm công.)')) return;
    try { await api('/admin/employees/' + e.id + '/face-photo', { method: 'DELETE' }); loadEmpBio(e, box); } catch (err) { toast(err.message, 'err'); }
  }, 'ghost') : null;
  box.append(el('div', { style: 'text-align:center;margin-bottom:14px' },
    d.photoData ? el('img', { src: d.photoData, alt: 'Ảnh NV', style: 'width:120px;height:120px;object-fit:cover;border-radius:14px;border:2px solid var(--brand,#E8541E)' }) : '',
    d.photoData ? el('div', { style: 'font-size:12px;color:var(--muted);margin-top:4px' }, d.photo === 'face' ? '📸 Ảnh khuôn mặt (đẩy kèm xuống máy chấm mặt)' : '📸 Ảnh người dùng từ máy') : '',
    el('div', { style: 'display:flex;gap:6px;justify-content:center;margin-top:6px' }, upB, delB || '', fI)));
  const stat = (icon, label, val) => el('div', { style: 'flex:1;min-width:110px;background:var(--soft,#fff3ec);border:1px solid #f2cdb8;border-radius:12px;padding:14px;text-align:center' },
    el('div', { style: 'font-size:24px;line-height:1' }, icon),
    el('div', { style: 'font-size:22px;font-weight:800;color:var(--brand-dark,#c0410f);margin-top:4px' }, String(val)),
    el('div', { style: 'font-size:12px;color:var(--muted)' }, label));
  box.append(el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' },
    stat('👉', 'Vân tay', d.fp), stat('😊', 'Khuôn mặt', d.face), stat('💳', 'Thẻ', d.card), stat('🔑', 'Mật mã', d.password)));
  if (d.byDevice && d.byDevice.length) {
    box.append(el('div', { style: 'font-weight:700;margin:16px 0 6px' }, 'Đã đăng ký trên máy:'));
    for (const dv of d.byDevice)
      box.append(el('div', { style: 'display:flex;gap:10px;padding:7px 2px;border-bottom:1px solid #f1efec;font-size:14px' },
        el('span', { style: 'flex:1' }, dv.name || dv.serial),
        el('span', { style: 'color:var(--muted)' }, `👉 ${dv.fp} · 😊 ${dv.face}`)));
  } else {
    box.append(el('div', { class: 'map-hint', style: 'margin-top:12px' }, 'Chưa thấy đăng ký trên máy nào (Số ID máy: ' + d.pin + ').'));
  }
  box.append(el('div', { class: 'map-hint', style: 'margin-top:12px' }, 'Dữ liệu lấy từ máy chấm công đã đồng bộ về. Đăng ký thêm vân tay/khuôn mặt trực tiếp trên máy.'));
  box.append(await empDeviceRoles(e));
}
// Quyền trên TỪNG máy chấm công: Nhân viên / Quản trị máy (vào được menu máy). Đổi → phần mềm gửi lệnh xuống máy.
async function empDeviceRoles(e) {
  const wrap = el('div', { style: 'margin-top:18px;border-top:1px solid var(--line);padding-top:14px' },
    el('div', { style: 'font-weight:700' }, '👑 Quyền trên máy chấm công'),
    el('div', { style: 'font-size:12.5px;color:var(--muted);margin:2px 0 8px' }, 'Quản trị máy = vào được menu trên máy chấm công. Khác với quyền Admin của phần mềm. Quản trị ở máy này không tự lan sang máy khác.'));
  let d; try { d = await api('/admin/employees/' + e.id + '/device-roles'); } catch (err) { wrap.append(el('div', { class: 'map-hint' }, err.message)); return wrap; }
  if (!d.devices.length) { wrap.append(el('div', { class: 'map-hint' }, 'Chưa có máy chấm công nào đang hoạt động.')); return wrap; }
  const sels = [];
  for (const dv of d.devices) {
    const sel = el('select', { style: 'width:auto;padding:4px 8px' },
      el('option', { value: '0' }, 'Nhân viên'), el('option', { value: '1', ...(dv.admin ? { selected: '' } : {}) }, 'Quản trị máy'));
    sels.push([dv, sel]);
    wrap.append(el('div', { style: 'display:flex;gap:10px;align-items:center;padding:6px 2px;border-bottom:1px solid #f1efec;font-size:14px' },
      el('span', { style: 'flex:1' }, dv.name,
        el('span', { style: 'font-size:12px;color:var(--muted);margin-left:6px' }, (dv.online ? '🟢 online' : '⚪ offline') + (dv.onDevice ? '' : ' · chưa có trên máy'))),
      sel));
  }
  // Chọn nhanh: quản trị TẤT CẢ máy (quản trị tổng chuỗi) / đưa về nhân viên ở tất cả máy — bấm xong vẫn phải Lưu
  const setAll = (v) => { for (const [, s] of sels) s.value = v; };
  const allAdm = el('button', { class: 'btn ghost sm', style: 'margin-top:10px' }, '👑 Quản trị tất cả máy');
  allAdm.onclick = () => { setAll('1'); toast('Đã chọn quản trị ở tất cả máy — bấm "Lưu quyền trên máy" để gửi', 'ok'); };
  const allEmp = el('button', { class: 'btn ghost sm', style: 'margin-top:10px' }, 'Nhân viên tất cả máy');
  allEmp.onclick = () => setAll('0');
  const save = el('button', { class: 'btn sm', style: 'margin-top:10px' }, 'Lưu quyền trên máy');
  save.onclick = async () => {
    const admins = sels.filter(([, s]) => s.value === '1').map(([dv]) => dv.serial);
    if (!confirm('Lưu và gửi quyền xuống máy chấm công?\nMáy đang offline sẽ nhận khi kết nối lại.')) return;
    save.disabled = true;
    try { const r = await api('/admin/employees/' + e.id + '/device-roles', { method: 'PUT', body: { admins } }); toast(r.changed ? `Đã gửi lệnh đổi quyền tới ${r.changed} máy` : 'Không có thay đổi', 'ok'); }
    catch (err) { toast(err.message, 'err'); }
    save.disabled = false;
  };
  if (hasPerm('devices')) wrap.append(el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, allAdm, allEmp, save));
  return wrap;
}
async function toggleEmp(e) {
  if (!confirm(`Khoá nhân viên ${e.full_name}?`)) return;
  await api('/admin/employees/' + e.id, { method: 'DELETE' });
  // CHỈ khoá — không hỏi xoá trên máy nữa (Anh 29/10/2026: dễ bấm nhầm xoá luôn trên máy). Muốn xoá: Máy chấm công → 🗑 Xóa NV trên máy
  toast('Đã khoá', 'ok');
  pageEmployees();
}
// Khoá / mở khoá NHIỀU NV đã tích chọn (1 lần cho cả lô). Chỉ khoá, không đụng máy chấm công (như khoá từng người)
async function lockEmpBulk(list, lock) {
  const todo = list.filter((e) => !!e.active === lock);
  if (!todo.length) return;
  const names = todo.slice(0, 5).map((e) => e.full_name).join(', ') + (todo.length > 5 ? ` … và ${todo.length - 5} người nữa` : '');
  if (!confirm(`${lock ? 'Khoá' : 'Mở khoá'} ${todo.length} nhân viên?\n\n${names}`)) return;
  try {
    const r = await api('/admin/employees/lock-bulk', { method: 'POST', body: { ids: todo.map((e) => e.id), lock } });
    const skip = [r.self ? 'bỏ qua tài khoản đang đăng nhập' : '', r.admins ? `bỏ qua ${r.admins} tài khoản Admin` : '',
      r.overLimit ? `${r.overLimit} người chưa mở được vì bản quyền giới hạn ${r.max} nhân viên` : ''].filter(Boolean).join(', ');
    toast(`Đã ${lock ? 'khoá' : 'mở khoá'} ${r.changed} nhân viên` + (skip ? ' (' + skip + ')' : ''), 'ok');
    empPicked.clear();
  } catch (err) { toast(err.message, 'err'); }
  pageEmployees();
}
async function unlockEmp(e) { try { await api('/admin/employees/' + e.id, { method: 'PUT', body: { active: true } }); toast('Đã mở khoá', 'ok'); pageEmployees(); } catch (err) { toast(err.message, 'err'); } }
// Xoá HẲN nhiều NV đã tích chọn. Từ 5 người trở lên phải gõ đúng số người để xác nhận; server tự sao lưu trước khi xoá.
// Chuyển bộ phận cho các NV đã tích chọn (1 lần cho cả lô)
function moveDeptBulk(list) {
  const n = list.length; if (!n) return;
  const sel = el('select', {},
    el('option', { value: '', disabled: '', selected: '' }, '— Chọn bộ phận mới —'),
    ...deptOrdered().map((d) => el('option', { value: d.name }, '  '.repeat(d.depth) + d.name)),
    el('option', { value: '__none__' }, '(Bỏ bộ phận — Chưa có bộ phận)'));
  const names = list.slice(0, 8).map((e) => `${e.full_name} (${e.code})${e.department ? ' · ' + e.department : ''}`);
  const ok = el('button', { class: 'btn' }, 'Chuyển ' + n + ' nhân viên');
  ok.onclick = async () => {
    if (!sel.value) return toast('Chọn bộ phận mới', 'err');
    const dept = sel.value === '__none__' ? '' : sel.value;
    ok.disabled = true;
    try {
      const r = await api('/admin/employees/move-dept', { method: 'POST', body: { ids: list.map((e) => e.id), department: dept } });
      empPicked.clear(); closeModal();
      toast(`Đã chuyển ${r.moved} nhân viên sang "${dept || 'Chưa có bộ phận'}"` + (r.same ? ` · ${r.same} người đã ở bộ phận này` : '') + (r.admins ? ` · bỏ qua ${r.admins} tài khoản Admin (không đủ quyền)` : ''), 'ok');
      pageEmployees();
    } catch (err) { ok.disabled = false; toast(err.message, 'err'); }
  };
  openModal(`🏢 Chuyển bộ phận cho ${n} nhân viên`, [
    el('label', {}, 'Bộ phận mới'), sel,
    el('div', { class: 'map-hint', style: 'margin-top:10px' }, 'Nhân viên đã chọn: ', ...names.flatMap((t) => [el('br'), '• ' + t]), n > 8 ? el('span', {}, el('br'), `… và ${n - 8} người khác`) : ''),
  ], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Huỷ'), ok]);
}
async function delEmpBulk(list) {
  const n = list.length; if (!n) return;
  const names = list.slice(0, 10).map((e) => `• ${e.full_name} (${e.code})`).join('\n') + (n > 10 ? `\n… và ${n - 10} người khác` : '');
  const where = await askDelWhere(list, `XÓA HẲN ${n} nhân viên đã chọn?`, names,
    `TOÀN BỘ dữ liệu công/chấm công/phân ca/lương của những người này sẽ bị xóa.\n${n > 1 ? 'Phần mềm tự sao lưu trước khi xoá (phục hồi ở Cài đặt › Sao lưu).' : 'KHÔNG hoàn tác được.'}`);
  if (!where) return;
  if (n >= 5 && String(prompt(`Gõ số ${n} để xác nhận xoá ${n} nhân viên:`) ?? '').trim() !== String(n)) { toast('Đã huỷ — số xác nhận không khớp', 'err'); return; }
  try {
    const r = await api('/admin/employees/purge-bulk', { method: 'POST', body: { ids: list.map((e) => e.id) } });
    empPicked.clear();
    toast(`Đã xóa ${r.deleted} nhân viên` + (r.self ? ' · bỏ qua tài khoản đang đăng nhập' : '') + (r.admins ? ` · bỏ qua ${r.admins} tài khoản Admin (không đủ quyền)` : ''), 'ok');
    pageEmployees();
    if (where === 'all') await delPinsOnDevices(r.pins);
  } catch (err) { toast(err.message, 'err'); }
}
async function delEmp(e) {
  const where = await askDelWhere([e], `XÓA HẲN nhân viên "${e.full_name}" (${e.code})?`, '', 'TOÀN BỘ dữ liệu công/chấm công/phân ca/lương của người này sẽ bị xóa, KHÔNG hoàn tác được.');
  if (!where) return;
  try {
    const r = await api('/admin/employees/' + e.id + '/purge', { method: 'DELETE' });
    toast('Đã xóa nhân viên', 'ok'); pageEmployees();
    if (where === 'all') await delPinsOnDevices(r.pins);
  } catch (err) { toast(err.message, 'err'); }
}
// Xác nhận xoá NV. Xoá trong phần mềm mà họ còn trên máy thì lần đồng bộ sau họ lại về → hỏi xoá luôn trên mọi máy NGAY Ở HỘP NÀY.
// Không dùng máy / không ai có Số ID thì chỉ cần xác nhận như thường.
// Trả 'all' (xoá cả trên máy) · 'soft' (chỉ phần mềm) · null (huỷ, kể cả đóng hộp bằng ×).
function askDelWhere(list, title, names, warn) {
  const keep = '(Chỉ muốn cho nghỉ việc mà GIỮ lịch sử → bấm "Khoá" thay vì Xóa.)';
  const withPin = list.filter((e) => String(e.device_pin || '').trim());
  if (!deviceEnabled() || !withPin.length) return Promise.resolve(confirm(`${title}\n\n${names ? names + '\n\n' : ''}${warn}\n\n${keep}`) ? 'soft' : null);
  return new Promise((done) => {
    const pick = (v) => () => { closeModal(); done(v); };
    const allB = el('button', { class: 'btn', style: 'background:#c0392b;border-color:#c0392b', onclick: pick('all') }, '🗑 Xóa trên tất cả máy');
    const softB = el('button', { class: 'btn ghost', onclick: pick('soft') }, 'Chỉ xóa trên phần mềm');
    const pinNames = withPin.slice(0, 8).map((e) => `🔌${e.device_pin} · ${e.full_name}`);
    openModal(title, [
      el('div', { style: 'white-space:pre-line' }, warn),
      el('div', { class: 'map-hint', style: 'margin:6px 0 14px' }, keep),
      el('div', { style: 'font-weight:700' }, 'Xóa luôn trên tất cả máy chấm công?'),
      el('div', { style: 'margin-top:4px' }, withPin.length === 1 ? 'Có Số ID trên máy chấm công:' : `${withPin.length} người có Số ID trên máy chấm công:`),
      el('div', { class: 'map-hint', style: 'margin:6px 0 10px' }, ...pinNames.flatMap((t, i) => [i ? el('br') : '', '• ' + t]), withPin.length > 8 ? el('span', {}, el('br'), `… và ${withPin.length - 8} người khác`) : ''),
      el('div', { class: 'dv-warn', style: 'font-size:13px' }, 'Nếu không xoá trên máy: họ vẫn còn trên máy nên sẽ tự đồng bộ về lại phần mềm.'),
    ], [allB, softB, el('button', { class: 'btn ghost', onclick: pick(null) }, 'Huỷ')]);
  });
}
// Xoá các Số ID (của NV vừa xoá trong phần mềm) trên mọi máy. Có máy kết nối trực tiếp hoặc máy chưa xoá được thì mở hộp báo kết quả.
async function delPinsOnDevices(pins) {
  if (!pins || !pins.length) return;
  let r;
  try { r = await api('/admin/devices/delete-users-all', { method: 'POST', body: { pins } }); }
  catch (e) { return toast('Đã xóa trong phần mềm nhưng chưa xoá được trên máy: ' + e.message, 'err'); }
  const box = el('div');
  devDelSummary(r, box, pins.length);
  if (!r.job && !r.tcpNote && !r.idle?.length && !r.waiting?.length && r.push.length) return toast(`Đã gửi lệnh xoá ${pins.length} người xuống ${r.push.length} máy`, 'ok');
  const closeB = el('button', { class: 'btn', onclick: closeModal }, 'Đóng');
  openModal('Xóa nhân viên trên máy chấm công', [box], [closeB]);
  const res = await devDelWatchJob(r, box);
  if (res?.devices?.some((x) => !x.ok && !x.waiting)) box.append(el('div', { class: 'dv-warn' }, 'Máy chưa xoá được thì họ có thể tự về lại phần mềm. Bật máy lên rồi vào Máy chấm công › Xóa NV trên máy để xoá nốt.'));
}

// Trang "Bộ phận & Chức danh" — khai báo bộ phận CHA-CON + danh mục chức danh
const _orgClosed = new Set();   // các nút cây Bộ phận đang thu gọn (mặc định mở hết như Wise Eye)
// view: 'dept' = trang Bộ phận, 'pos' = trang Chức danh (2 mục riêng trong menu Tổ chức)
async function pageOrg(view = 'dept') {
  const title = view === 'pos' ? 'Chức danh' : 'Bộ phận';
  setMain(head(title), loading());
  const ro = !hasPerm('departments');   // chỉ xem
  const deptPanel = el('div', { class: 'panel', style: 'padding:18px 20px;max-width:760px' });
  const posPanel = el('div', { class: 'panel', style: 'padding:18px 20px;max-width:760px' });
  setMain(head(title), view === 'pos' ? posPanel : deptPanel);

  // ---------- BỘ PHẬN (cây cha-con, kiểu Wise Eye: chọn nút rồi bấm Thêm / Sửa tên / Xóa, kéo-thả để đổi bộ phận cha) ----------
  let company = 'Công ty';
  try { company = (await api('/config')).company_name || company; } catch {}
  let sel = 0;   // id bộ phận đang chọn; 0 = gốc (tên công ty)
  const reload = async (selId) => { DEPARTMENTS = (await api('/admin/departments')).rows; if (selId !== undefined) sel = selId; renderDept(); };
  const byId = (id) => DEPARTMENTS.find((x) => x.id === id);
  const isUnder = (id, anc) => { for (let cur = id, n = 0; cur && n < 100; cur = (byId(cur) || {}).parent_id, n++) if (cur === anc) return true; return false; };
  const askName = (title, hint, val, onOk) => {
    const nameI = input('org-dname', { value: val || '', placeholder: 'Tên bộ phận' });
    const ok = el('button', { class: 'btn' }, 'Lưu');
    ok.onclick = async () => { const name = nameI.value.trim(); if (!name) return toast('Nhập tên bộ phận', 'err'); try { await onOk(name); closeModal(); } catch (e) { toast(e.message, 'err'); } };
    nameI.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok.click(); });
    openModal(title, [el('div', { class: 'map-hint', style: 'margin-bottom:8px' }, hint), nameI], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Đóng'), ok]);
    setTimeout(() => { nameI.focus(); nameI.select(); }, 30);
  };
  const doAdd = () => {
    const par = byId(sel);
    askName('Thêm bộ phận', 'Bộ phận mới sẽ nằm trong: ' + (par ? par.name : company + ' (cấp trên cùng)'), '', async (name) => {
      const r = await api('/admin/departments', { method: 'POST', body: { name, parent_id: par ? par.id : null } });
      if (par) _orgClosed.delete(par.id);
      await reload(r.id); toast('Đã thêm bộ phận', 'ok');
    });
  };
  const doRename = () => {
    const d = byId(sel); if (!d) return toast('Chọn bộ phận cần sửa tên', 'err');
    deptEditModal(d, () => reload(d.id));
  };
  const doDel = async () => {
    const d = byId(sel); if (!d) return toast('Chọn bộ phận cần xóa', 'err');
    if (!confirm(`Xóa bộ phận "${d.name}"?`)) return;
    try {
      const r = await api('/admin/departments/' + d.id, { method: 'DELETE' });
      await reload(d.parent_id || 0);
      toast(r.moved_admins ? `Đã xóa — ${r.moved_admins} tài khoản Admin chuyển sang bộ phận "${r.to}"` : 'Đã xóa', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };
  const doMove = async (id, parentId) => {
    const d = byId(id); if (!d || (d.parent_id || 0) === parentId) return;
    if (parentId && (parentId === id || isUnder(parentId, id))) return toast('Không chuyển được vào bộ phận con của chính nó', 'err');
    try {
      await api('/admin/departments/' + id, { method: 'PUT', body: { parent_id: parentId || null } });
      if (parentId) _orgClosed.delete(parentId);
      await reload(id); toast(`Đã chuyển "${d.name}" vào ${parentId ? '"' + byId(parentId).name + '"' : 'cấp trên cùng'}`, 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };

  const renderDept = () => {
    deptPanel.innerHTML = '';
    deptPanel.style.maxWidth = '1100px'; deptPanel.style.padding = '0';
    if (sel && !byId(sel)) sel = 0;
    const tb = el('div', { class: 'org-tb' });
    if (!ro) tb.append(btnSm('＋ Thêm', doAdd, 'org-tbb'), btnSm('✎ Sửa tên', doRename, 'org-tbb'), btnSm('✖ Xóa', doDel, 'org-tbb'));
    else tb.append(el('span', { style: 'font-weight:600' }, 'Chỉ xem'));
    const tree = el('div', { class: 'org-tree', tabindex: '0' });
    const kids = new Map(); for (const d of DEPARTMENTS) { const k = d.parent_id || 0; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(d); }
    for (const a of kids.values()) a.sort((x, y) => x.name.localeCompare(y.name, 'vi'));
    let dragId = 0;
    const node = (d, depth) => {
      const id = d ? d.id : 0, has = (kids.get(id) || []).length > 0, open = !_orgClosed.has(id);
      const tg = el('span', { class: 'org-tg' }, has ? (open ? '⊟' : '⊞') : '');
      if (has) tg.onclick = (e) => { e.stopPropagation(); open ? _orgClosed.add(id) : _orgClosed.delete(id); renderDept(); };
      const row = el('div', { class: 'org-row' + (sel === id ? ' sel' : ''), style: 'padding-left:' + (6 + depth * 20) + 'px' },
        tg, el('span', { class: 'org-ic' }, d ? '📁' : '🏢'), el('span', { class: 'org-nm' }, d ? d.name : company),
        d && d.emp_count ? el('span', { class: 'org-cnt', title: 'Số nhân viên đang thuộc bộ phận này' }, d.emp_count + ' NV') : '');
      row.onclick = () => { sel = id; tree.querySelectorAll('.org-row.sel').forEach((x) => x.classList.remove('sel')); row.classList.add('sel'); };
      if (!ro) {
        if (d) row.ondblclick = () => { sel = id; doRename(); };
        if (d) { row.draggable = true; row.addEventListener('dragstart', (e) => { dragId = id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(id)); }); }
        row.addEventListener('dragover', (e) => { if (!dragId || dragId === id || isUnder(id, dragId)) return; e.preventDefault(); row.classList.add('drop'); });
        row.addEventListener('dragleave', () => row.classList.remove('drop'));
        row.addEventListener('drop', (e) => { e.preventDefault(); row.classList.remove('drop'); const from = dragId; dragId = 0; if (from) doMove(from, id); });
        row.addEventListener('dragend', () => { dragId = 0; });
      }
      tree.append(row);
      if (has && open) for (const c of kids.get(id)) node(c, depth + 1);
    };
    node(null, 0);
    tree.addEventListener('keydown', (e) => {
      if (ro || e.target !== tree) return;
      if (e.key === 'F2') { e.preventDefault(); doRename(); } else if (e.key === 'Delete') { e.preventDefault(); doDel(); } else if (e.key === 'Insert') { e.preventDefault(); doAdd(); }
    });
    const help = el('div', { class: 'org-help' },
      el('div', {}, '• Cần thêm bộ phận mới: chọn bộ phận cha (hoặc tên công ty để thêm cấp trên cùng) rồi bấm ', el('b', {}, 'Thêm'), '.'),
      el('div', {}, '• Cần đổi tên bộ phận: chọn bộ phận rồi bấm ', el('b', {}, 'Sửa tên'), ' (hoặc nhấp đúp vào bộ phận).'),
      el('div', {}, '• Muốn đổi bộ phận cha của một bộ phận: chọn bộ phận đó, nhấp chuột trái và giữ, rê đến bộ phận cần đổi rồi thả. Rê vào tên công ty = đưa lên cấp trên cùng.'),
      el('div', {}, '• Không xóa được bộ phận còn nhân viên hoặc còn bộ phận con. Bộ phận chỉ còn tài khoản Admin thì Admin tự chuyển sang bộ phận "Quản trị".'),
      el('div', { style: 'color:var(--muted);font-size:12.5px' }, 'Phím tắt khi đang ở cây: Insert = Thêm · F2 = Sửa tên · Delete = Xóa.'));
    deptPanel.append(tb, el('div', { class: 'org-body' }, tree, help));
  };

  // ---------- CHỨC DANH ----------
  const renderPos = () => {
    posPanel.innerHTML = '';
    posPanel.append(el('h3', { style: 'margin:0 0 4px' }, '💼 Chức danh'),
      el('div', { class: 'map-hint', style: 'margin-bottom:12px' }, 'Khai báo sẵn chức danh để CHỌN khi thêm nhân viên (thay vì gõ tay). Không xoá được chức danh còn nhân viên.'));
    if (!ro) {
      const nameI = input('org-pname', { placeholder: 'VD: Trưởng phòng, Nhân viên Sale…' });
      const addBtn = el('button', { class: 'btn' }, 'Thêm');
      addBtn.onclick = async () => {
        const name = nameI.value.trim(); if (!name) return toast('Nhập tên chức danh', 'err');
        try { await api('/admin/positions', { method: 'POST', body: { name } }); nameI.value = ''; POSITIONS = (await api('/admin/positions')).rows; renderPos(); toast('Đã thêm chức danh', 'ok'); }
        catch (e) { toast(e.message, 'err'); }
      };
      posPanel.append(el('div', { style: 'display:flex;gap:8px;margin-bottom:6px' }, nameI, addBtn));
    }
    if (!POSITIONS.length) { posPanel.append(el('div', { class: 'map-hint' }, 'Chưa có chức danh nào.')); return; }
    const list = el('div', { style: 'margin-top:8px' });
    for (const p of POSITIONS) {
      const del = ro ? '' : btnSm('Xoá', async () => { if (!confirm(`Xoá chức danh "${p.name}"?`)) return; try { await api('/admin/positions/' + p.id, { method: 'DELETE' }); POSITIONS = (await api('/admin/positions')).rows; renderPos(); toast('Đã xoá', 'ok'); } catch (e) { toast(e.message, 'err'); } }, 'ghost');
      list.append(el('div', { style: 'display:flex;align-items:center;gap:10px;padding:8px 2px;border-bottom:1px solid #f1efec' },
        el('b', { style: 'flex:1' }, p.name), del));
    }
    posPanel.append(list);
  };

  DEPARTMENTS = (await api('/admin/departments')).rows;
  try { POSITIONS = (await api('/admin/positions')).rows; } catch { POSITIONS = []; }
  if (view === 'pos') renderPos(); else renderDept();
}

// Sửa 1 bộ phận: đổi tên + chọn bộ phận cha (không cho chọn chính nó)
function deptEditModal(d, after) {
  const nameI = input('de-name', { value: d.name });
  const under = (id) => { for (let cur = id, n = 0; cur && n < 100; cur = (DEPARTMENTS.find((x) => x.id === cur) || {}).parent_id, n++) if (cur === d.id) return true; return false; };
  const parentSel = el('select', {}, el('option', { value: '' }, '— Không có (cấp trên cùng) —'),
    ...deptOrdered().filter(x => !under(x.id)).map(x => el('option', { value: x.id, ...((d.parent_id || '') == x.id ? { selected: '' } : {}) },
      ' '.repeat(x.depth * 3) + (x.depth ? '↳ ' : '') + x.name)));
  const save = el('button', { class: 'btn' }, 'Lưu');
  save.onclick = async () => {
    const name = nameI.value.trim(); if (!name) return toast('Nhập tên bộ phận', 'err');
    try { await api('/admin/departments/' + d.id, { method: 'PUT', body: { name, parent_id: parentSel.value || null } }); DEPARTMENTS = (await api('/admin/departments')).rows; closeModal(); after && after(); toast('Đã lưu', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  };
  nameI.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });
  openModal('Sửa tên bộ phận', [
    el('div', {}, el('label', {}, 'Tên bộ phận'), nameI),
    el('div', { class: 'map-hint', style: 'margin-top:4px' }, 'Nhân viên đang thuộc bộ phận này tự đổi theo tên mới.'),
    el('div', { style: 'margin-top:10px' }, el('label', {}, 'Thuộc bộ phận cha'), parentSel),
  ], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Đóng'), save]);
  setTimeout(() => { nameI.focus(); nameI.select(); }, 30);
}

