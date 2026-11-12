/* ---------- 3) CA LÀM ---------- */
let _shSel = null;   // ca đang chọn ở danh sách bên trái (id | 'new')
async function pageShifts() {
  document.querySelectorAll('#nav-sub-sh .nav-sub-btn').forEach((x) => x.classList.toggle('active', x.dataset.as === _shView));
  if (_shView === 'schedules') return pageSchedules();
  if (_shView === 'inout') return pageInOut();
  const can = hasPerm('shifts');
  // Màn hình hẹp (không có menu con): nút sang 2 mục còn lại
  const schedBtn = el('span', { class: 'as-tabs', style: 'margin:0' }, btnSm('Lịch trình vào ra', () => { _shView = 'inout'; pageShifts(); }, 'ghost'), btnSm('Lịch trình ca làm việc', () => { _shView = 'schedules'; _schEdit = null; pageShifts(); }, 'ghost'));
  const addBtn = can ? el('button', { class: 'btn' }, '+ Thêm mới') : null;
  const saveBtn = can ? el('button', { class: 'btn' }, '💾 Lưu') : null;
  const delBtn = can ? el('button', { class: 'btn ghost' }, '🗑 Xoá') : null;
  const tools = [schedBtn, addBtn, saveBtn, delBtn];
  setMain(head('Ca làm việc', ...tools), loading());
  const { rows } = await api('/admin/shifts');
  SHIFTS = rows;
  // Kiểu Ronald Jack: danh sách ca bên TRÁI, bấm 1 ca → khai báo hiện bên PHẢI
  if (_shSel !== 'new' && !rows.some((r) => r.id === _shSel)) _shSel = rows.length ? rows[0].id : 'new';
  const cur = _shSel === 'new' ? null : rows.find((r) => r.id === _shSel);
  const tbl = el('table', { class: 'data sh-list' });
  tbl.innerHTML = '<thead><tr><th>Ca làm việc</th><th>Giờ vào</th><th>Giờ ra</th></tr></thead>';
  const tb = el('tbody');
  for (const r of rows) {
    const tr = el('tr', { class: r.id === _shSel ? 'on' : '' },
      el('td', {}, el('b', {}, r.name), r.code ? el('span', { class: 'pill muted', style: 'margin-left:6px' }, r.code) : '', r.end_time <= r.start_time ? el('span', { title: 'Ca qua đêm' }, ' 🌙') : '',
        r.active ? '' : el('span', { class: 'pill bad', style: 'margin-left:6px' }, 'Tắt')),
      el('td', {}, r.start_time), el('td', {}, r.end_time));
    tr.onclick = () => { _shSel = r.id; pageShifts(); };
    tb.append(tr);
  }
  if (_shSel === 'new') tb.append(el('tr', { class: 'on' }, el('td', { colspan: 3, style: 'color:var(--brand);font-weight:700' }, '＋ Ca mới (đang khai báo)')));
  if (!rows.length && _shSel !== 'new') tb.append(el('tr', {}, el('td', { colspan: 3, style: 'color:var(--muted)' }, 'Chưa có ca nào.')));
  tbl.append(tb);
  const form = shiftForm(cur, can);
  if (addBtn) addBtn.onclick = () => { _shSel = 'new'; pageShifts(); };
  if (saveBtn) saveBtn.onclick = form.save;
  if (delBtn) delBtn.onclick = () => { if (cur) deleteShift(cur); else { _shSel = null; pageShifts(); } };
  setMain(head('Ca làm việc', ...tools), el('div', { class: 'sh-wrap' },
    el('div', { class: 'panel sh-left' }, el('div', { class: 'sh-cap' }, 'Danh sách ca làm việc'), el('div', { class: 'tbl-scroll' }, tbl)),
    el('div', { class: 'panel sh-right' }, form.node)));
}

/* ---------- LỊCH TRÌNH VÀO RA (kiểu Ronald Jack) ----------
 * Khai báo RIÊNG cách xác định lượt quẹt nào là VÀO, lượt nào là RA (không còn nằm trong ca). Gán kèm khi Gán ca cho nhân viên / phòng ban. */
const IO_RULES = [
  ['filo', 'Giờ đầu là vào, giờ cuối là ra', 'Lần chấm công đầu tiên được xem là giờ VÀO, lần chấm công cuối cùng được xem là giờ RA, bỏ qua tất cả các giờ chấm ở giữa. Tính trong khung giờ của ca: ca ngày lấy trong ngày; ca qua đêm lấy lượt VÀO buổi tối và lượt RA sáng hôm sau.'],
  ['pairs', 'Tự động - không qua đêm (không qua 12h)', 'Lần chấm đầu là VÀO, lần chấm kế tiếp là RA, rồi lại VÀO… Giờ làm = tổng các cặp vào–ra (thời gian ra ngoài giữa chừng bị trừ). Việc chọn lượt phụ thuộc ba thông số bên dưới. Cặp chỉ ghép trong khung giờ của ca: ca ngày trong ngày, ca đêm (giờ ra nhỏ hơn giờ vào) thì sang sáng hôm sau. Lượt VÀO lẻ cuối ngày là thiếu giờ ra.'],
  ['tdqd', 'Tự động - qua đêm (qua 12h)', 'Như "Tự động - không qua đêm" (tính theo từng cặp, trừ thời gian ra ngoài), thêm: lượt VÀO lẻ cuối ngày được ghép với lượt chấm đầu tiên sáng hôm sau làm giờ RA, nếu cách nhau không quá "Thời gian lớn nhất" và lượt đó không phải giờ vào ca hôm sau. Dùng khi ca ngày hay tăng ca quá nửa đêm. Ca đêm 19h–7h không cần trừ giờ ra ngoài thì dùng "Giờ đầu là vào, giờ cuối là ra" là đủ.'],
  ['idm', 'Theo ID máy', 'Khi chấm công ở máy có số máy lẻ (1, 3, 5, 7, 9) sẽ là VÀO. Khi chấm ở máy có số máy chẵn (2, 4, 6, 8, 10) sẽ là RA. Ra/vào nhiều lần qua 2 cửa thì cộng từng cặp VÀO → RA (trừ thời gian ra ngoài, như Wise Eye On39); vào lại khi chưa ra = lượt vào trước quên chấm ra, ra mà chưa vào = quên chấm vào (dòng chỉ có giờ RA). Máy vào là giờ vào, máy ra là giờ ra BẤT KỂ NGÀY ĐÊM: vào tối, ra sáng hôm sau (cách không quá "Thời gian lớn nhất") vẫn ghép thành 1 cặp, không cần chọn qua đêm; ca đêm quên chấm vào thì giờ RA sáng hôm sau gắn về đêm hôm trước. Đặt "ID máy" cho từng máy ở cột ID máy của mục Máy chấm công.'],
  ['state', 'Chọn từ máy', 'Giờ VÀO hay giờ RA nhận từ máy chấm công: bấm phím Check In trước khi chấm là VÀO, bấm Check Out trước khi chấm là RA. Ghép cặp như "Theo ID máy": cộng từng cặp VÀO → RA, qua nửa đêm vẫn ghép (không quá "Thời gian lớn nhất"), không cần chọn qua đêm.'],
  ['tdhc', 'Phân theo giờ', 'Giờ chấm nằm trong khung "Bắt đầu vào – Kết thúc vào" của ca là VÀO; nằm trong khung "Bắt đầu ra – Kết thúc ra" là RA (khai ở Ca làm việc).'],
];
const IO_RULE_NAME = Object.fromEntries(IO_RULES.map(([k, t]) => [k, t]));

async function pageInOut() {
  const canEdit = hasPerm('shifts');
  setMain(head('Lịch trình vào ra'), loading());
  let rows = [];
  try { rows = (await api('/admin/inout-schedules')).rows || []; } catch (e) { setMain(head('Lịch trình vào ra'), el('div', { class: 'empty' }, e.message)); return; }
  const addBtn = canEdit ? el('button', { class: 'btn' }, '+ Thêm mới') : null;
  if (addBtn) addBtn.onclick = () => inOutModal(null);
  const tbl = el('table', { class: 'data' });
  tbl.append(el('thead', {}, el('tr', {}, el('th', {}, 'Mã'), el('th', {}, 'Tên lịch trình'), el('th', {}, 'Cách xác định VÀO / RA'), el('th', {}, 'Nhỏ nhất'), el('th', {}, 'Lớn nhất'), el('th', {}, 'Giữa 2 cặp'), el('th', {}, ''), el('th', {}, 'Thao tác'))));
  const tb = el('tbody'); tbl.append(tb);
  if (!rows.length) tb.append(el('tr', {}, el('td', { colspan: 8 }, el('div', { class: 'empty' }, '📭 Chưa có lịch trình vào ra nào. Khi chưa khai, hệ thống dùng "Giờ đầu là vào, giờ cuối là ra". Bấm "+ Thêm mới".'))));
  for (const r of rows) {
    tb.append(el('tr', {}, el('td', {}, r.code || '—'), el('td', {}, el('b', {}, r.name)), el('td', {}, IO_RULE_NAME[r.rule] || r.rule),
      el('td', {}, r.min_minutes + ' phút'), el('td', {}, r.max_minutes + ' phút'), el('td', {}, r.gap_minutes + ' phút'),
      el('td', {}, r.is_default ? el('span', { class: 'pill ok' }, 'Mặc định') : ''),
      el('td', {}, canEdit ? el('div', { style: 'display:flex;gap:6px' }, btnSm('Sửa', () => inOutModal(r)),
        btnSm('Xoá', async () => { if (!confirm(`Xoá lịch trình vào ra "${r.name}"?`)) return; try { await api('/admin/inout-schedules/' + r.id, { method: 'DELETE' }); toast('Đã xoá', 'ok'); pageInOut(); } catch (e) { toast(e.message, 'err'); } }, 'ghost')) : '')));
  }
  setMain(head('Lịch trình vào ra', addBtn),
    el('div', { class: 'map-hint', style: 'margin-bottom:10px' }, 'Lịch trình vào ra = cách phần mềm hiểu lượt quẹt nào là VÀO, lượt nào là RA. Khai ở đây một lần rồi chọn khi Gán ca cho nhân viên / phòng ban. Nhân viên chưa được gán lịch trình vào ra nào thì dùng dòng có nhãn "Mặc định".'),
    el('div', { class: 'panel tbl-scroll' }, tbl));
}

function inOutModal(r) {
  const codeI = el('input', { value: r?.code || '', placeholder: 'VD: LTVR01' });
  const nameI = el('input', { value: r?.name || '', placeholder: 'VD: Hành chính' });
  let rule = r?.rule || 'filo';
  const descT = el('b', {}), descB = el('div', { style: 'font-size:13.5px;color:var(--ink);line-height:1.55;margin-top:4px' });
  const radios = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px 16px' });
  const sync = () => { const it = IO_RULES.find(([k]) => k === rule); descT.textContent = it[1]; descB.textContent = it[2]; };
  for (const [k, t] of IO_RULES) {
    const rd = el('input', { type: 'radio', name: 'io-rule', style: 'width:auto', ...(rule === k ? { checked: '' } : {}) });
    rd.onchange = () => { rule = k; sync(); };
    radios.append(el('label', { style: 'display:flex;align-items:center;gap:8px;font-weight:600;color:var(--ink);cursor:pointer' }, rd, t));
  }
  const minI = el('input', { type: 'number', min: '0', value: r?.min_minutes ?? 30, style: 'width:90px' });
  const maxI = el('input', { type: 'number', min: '0', value: r?.max_minutes ?? 960, style: 'width:90px' });
  const gapI = el('input', { type: 'number', min: '0', value: r?.gap_minutes ?? 30, style: 'width:90px' });
  const defC = el('input', { type: 'checkbox', style: 'width:auto', ...(r?.is_default ? { checked: '' } : {}) });
  const row = (label, inp, hint) => el('div', { style: 'display:flex;align-items:center;gap:10px' }, el('span', { style: 'width:210px;font-weight:600' }, label), inp, el('span', {}, 'phút'), el('span', { style: 'color:var(--muted);font-size:12.5px' }, hint));
  const save = el('button', { class: 'btn' }, 'Lưu');
  save.onclick = async () => {
    if (!nameI.value.trim()) return toast('Nhập tên lịch trình', 'err');
    const body = { code: codeI.value.trim(), name: nameI.value.trim(), rule, min_minutes: minI.value, max_minutes: maxI.value, gap_minutes: gapI.value, is_default: defC.checked };
    try { if (r) await api('/admin/inout-schedules/' + r.id, { method: 'PUT', body }); else await api('/admin/inout-schedules', { method: 'POST', body }); toast('Đã lưu', 'ok'); closeModal(); pageInOut(); }
    catch (e) { toast(e.message, 'err'); }
  };
  sync();
  openModal(r ? 'Sửa lịch trình vào ra' : 'Thêm lịch trình vào ra', [
    el('div', { class: 'two-col' }, field('Mã lịch trình', codeI), field('Tên lịch trình *', nameI)),
    radios,
    row('Thời gian nhỏ nhất', minI, 'RA cách VÀO dưới mức này = quẹt lặp, bỏ'),
    row('Thời gian lớn nhất', maxI, 'cặp vào–ra dài hơn mức này = quên quẹt ra'),
    row('Khoảng cách giữa 2 cặp vào ra', gapI, 'VÀO mới cách RA trước dưới mức này = quẹt lặp'),
    el('div', { style: 'border:1px solid var(--line);border-radius:10px;padding:12px;background:#faf7f5' }, descT, descB),
    el('label', { style: 'display:flex;align-items:center;gap:8px;font-weight:600;color:var(--ink)' }, defC, 'Dùng làm MẶC ĐỊNH cho nhân viên chưa được gán lịch trình vào ra'),
  ], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Huỷ'), save]);
  const m = document.querySelector('#modal-bg .modal'); if (m) m.style.maxWidth = '680px';
}

/* ---------- LỊCH TRÌNH CA LÀM VIỆC (theo chu kỳ, kiểu "Ca làm việc" của ZKBio) ----------
 * Một lịch trình = thứ nào / ngày nào làm ca nào, lặp theo chu kỳ (tuần · ngày · tháng). Ô trống = ngày nghỉ.
 * Kiểu "tự dò" (cũ): chỉ là nhóm ca, hệ thống tự chọn ca theo giờ chấm. Lịch trình được chọn khi gán Lịch trình nhân viên / phòng ban. */
let _shView = 'shifts';     // mục con đang xem của "Ca làm": shifts | schedules
let _shNavOpen = false;
let _schEdit = null;        // null = danh sách · { } = thêm mới · { id… } = đang sửa
const SH_TABS = [['shifts', '1. Ca làm việc'], ['inout', '2. Lịch trình vào ra'], ['schedules', '3. Lịch trình ca làm việc']];
const SCH_UNIT = { week: 'Tuần', day: 'Ngày', month: 'Tháng', auto: 'Tự dò theo giờ chấm' };
const SCH_WD = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ Nhật'];

async function pageSchedules() {
  const canEdit = hasPerm('shifts');
  let shifts = [], rows = [];
  setMain(head('Lịch trình ca làm việc'), loading());
  try { shifts = ((await api('/admin/shifts')).rows || []).filter((s) => s.active); SHIFTS = shifts; rows = (await api('/admin/schedules')).rows || []; SCHEDULES = rows; }
  catch (e) { setMain(head('Lịch trình ca làm việc'), el('div', { class: 'empty' }, e.message)); return; }
  const sName = new Map(shifts.map((s) => [s.id, (s.code || '').trim() || s.name]));

  /* ===== Danh sách ===== */
  if (!_schEdit) {
    const addBtn = canEdit ? el('button', { class: 'btn' }, '+ Thêm lịch trình') : null;
    if (addBtn) addBtn.onclick = () => { _schEdit = {}; pageSchedules(); };
    const tbl = el('table', { class: 'data' });
    tbl.append(el('thead', {}, el('tr', {}, el('th', {}, 'Tên'), el('th', {}, 'Đơn vị'), el('th', {}, 'Chu kỳ'), el('th', {}, 'Các ca trong lịch trình'), el('th', {}, 'Thao tác'))));
    const tb = el('tbody'); tbl.append(tb);
    if (!rows.length) tb.append(el('tr', {}, el('td', { colspan: 5 }, el('div', { class: 'empty' }, '📭 Chưa có lịch trình nào. Bấm "+ Thêm lịch trình".'))));
    for (const w of rows) {
      const unit = w.unit || 'auto';
      tb.append(el('tr', {}, el('td', {}, el('b', {}, w.name)), el('td', {}, SCH_UNIT[unit] || unit), el('td', {}, unit === 'auto' ? '—' : String(w.cycle || 1)),
        el('td', { style: 'color:var(--muted)' }, (w.shifts || []).map((x) => x.name).join(', ') || '—'),
        el('td', {}, canEdit ? el('div', { style: 'display:flex;gap:6px' }, btnSm('Chỉnh sửa', () => { _schEdit = w; pageSchedules(); }),
          btnSm('Xoá', async () => { if (!confirm(`Xoá lịch trình "${w.name}"?`)) return; try { await api('/admin/schedules/' + w.id, { method: 'DELETE' }); toast('Đã xoá', 'ok'); pageSchedules(); } catch (e) { toast(e.message, 'err'); } }, 'ghost')) : '')));
    }
    setMain(head('Lịch trình ca làm việc', addBtn),
      el('div', { class: 'map-hint', style: 'margin-bottom:10px' }, 'Lịch trình làm việc = thứ nào làm ca nào, lặp theo chu kỳ (VD Thứ Hai → Thứ Sáu ca Hành chính, Thứ Bảy ca Sáng, Chủ Nhật nghỉ). Tạo ở đây rồi gán cho nhân viên / phòng ban ở mục Phân ca.'),
      el('div', { class: 'panel tbl-scroll' }, tbl));
    return;
  }

  /* ===== Thêm / sửa (trái: tick ca · phải: tên, đơn vị, chu kỳ + bảng ngày) ===== */
  const w = _schEdit;
  const back = () => { _schEdit = null; pageSchedules(); };
  const ticked = new Set();
  const cells = new Map();   // idx → Set(shift_id)
  for (const d of (w.days || [])) { if (!cells.has(d.idx)) cells.set(d.idx, new Set()); cells.get(d.idx).add(d.shift_id); }
  const nameI = el('input', { value: w.name || '', placeholder: 'VD: Hành chính T2–T7', style: 'width:220px' });
  const unitSel = el('select', { style: 'width:auto' }, ...['week', 'day', 'month', 'auto'].map((u) => el('option', { value: u, ...((w.unit || 'week') === u ? { selected: '' } : {}) }, SCH_UNIT[u])));
  const cycI = el('input', { type: 'number', min: '1', max: '62', value: w.cycle || 1, style: 'width:80px' });
  if (w.id && (w.unit || 'auto') === 'auto') for (const x of (w.shifts || [])) ticked.add(x.shift_id);

  // Trái: danh sách ca để tick
  const shSearch = el('input', { placeholder: 'Tên ca', style: 'margin-bottom:8px' });
  const shTb = el('tbody');
  const drawShifts = () => {
    shTb.innerHTML = '';
    const q = shSearch.value.trim().toLowerCase();
    for (const s of shifts.filter((x) => !q || x.name.toLowerCase().includes(q))) {
      const cb = el('input', { type: 'checkbox', style: 'width:auto', ...(ticked.has(s.id) ? { checked: '' } : {}) });
      const tr = el('tr', { style: 'cursor:pointer' + (ticked.has(s.id) ? ';background:#f0fdf4' : '') }, el('td', {}, cb), el('td', {}, el('b', {}, s.name), s.code ? el('span', { class: 'pill muted', style: 'margin-left:6px' }, s.code) : ''), el('td', {}, s.start_time), el('td', {}, s.end_time), el('td', {}, String(s.break_minutes || 0)));
      tr.onclick = (ev) => { if (ev.target !== cb) cb.checked = !cb.checked; if (cb.checked) ticked.add(s.id); else ticked.delete(s.id); drawShifts(); drawGrid(); };
      shTb.append(tr);
    }
    if (!shifts.length) shTb.append(el('tr', {}, el('td', { colspan: 5 }, el('div', { class: 'empty' }, 'Chưa có ca nào. Tạo ca ở mục Ca làm việc trước.'))));
  };
  shSearch.oninput = drawShifts;
  const left = el('div', { class: 'panel', style: 'padding:14px' }, shSearch,
    el('div', { class: 'tbl-scroll', style: 'max-height:calc(100vh - 300px);overflow:auto' }, el('table', { class: 'data emp-compact' },
      el('thead', {}, el('tr', {}, el('th', {}, ''), el('th', {}, 'Tên ca'), el('th', {}, 'Giờ vào'), el('th', {}, 'Giờ ra'), el('th', {}, 'Nghỉ (phút)'))), shTb)));

  // Phải: bảng ngày × chu kỳ
  const gridBox = el('div', {});
  const setCell = (idx) => {
    if (!ticked.size) { cells.delete(idx); return; }
    const cur = cells.get(idx);
    const same = cur && cur.size === ticked.size && [...ticked].every((x) => cur.has(x));
    if (same) cells.delete(idx); else cells.set(idx, new Set(ticked));   // bấm lại ô đã có đúng các ca đó = xoá
  };
  const drawGrid = () => {
    gridBox.innerHTML = '';
    const unit = unitSel.value;
    cycI.parentElement.style.display = unit === 'auto' ? 'none' : '';
    if (unit === 'auto') {
      gridBox.append(el('div', { class: 'map-hint' }, `Kiểu "Tự dò theo giờ chấm": chỉ cần tick các ca ở bảng bên trái (đang tick ${ticked.size} ca). Mỗi ngày hệ thống tự chọn ca khớp giờ chấm vào/ra của nhân viên — nên đặt "cửa sổ nhận diện" cho từng ca.`));
      return;
    }
    const cyc = Math.max(1, Math.min(unit === 'day' ? 62 : 12, parseInt(cycI.value, 10) || 1));
    const rowsN = unit === 'week' ? 7 : unit === 'month' ? 31 : cyc;
    const colsN = unit === 'day' ? 1 : cyc;
    const per = unit === 'week' ? 7 : unit === 'month' ? 31 : 1;
    const idxOf = (r, c) => (unit === 'day' ? r : c * per + r);
    const tbl = el('table', { class: 'data sch-grid' });
    const hr = el('tr', {}, el('th', {}, ''));
    for (let c = 0; c < colsN; c++) { const th = el('th', { title: 'Bấm để gán ca đang tick cho cả cột', style: 'cursor:pointer;text-align:center' }, unit === 'day' ? 'Ca' : 'Chu kỳ-' + (c + 1)); th.onclick = () => { for (let r = 0; r < rowsN; r++) { if (ticked.size) cells.set(idxOf(r, c), new Set(ticked)); else cells.delete(idxOf(r, c)); } drawGrid(); }; hr.append(th); }
    tbl.append(el('thead', {}, hr));
    const tb = el('tbody'); tbl.append(tb);
    for (let r = 0; r < rowsN; r++) {
      const lab = unit === 'week' ? SCH_WD[r] : 'Ngày ' + (r + 1);
      const rh = el('td', { class: 'rh', title: 'Bấm để gán ca đang tick cho cả dòng' }, lab);
      rh.onclick = () => { for (let c = 0; c < colsN; c++) { if (ticked.size) cells.set(idxOf(r, c), new Set(ticked)); else cells.delete(idxOf(r, c)); } drawGrid(); };
      const tr = el('tr', {}, rh);
      for (let c = 0; c < colsN; c++) {
        const idx = idxOf(r, c), cur = cells.get(idx);
        const td = el('td', { class: 'cell' + (cur && cur.size ? ' on' : ''), title: cur && cur.size ? 'Bấm để đổi / xoá' : 'Bấm để gán ca đang tick (để trống = ngày nghỉ)' }, cur && cur.size ? [...cur].map((id) => sName.get(id) || '?').join(' + ') : '');
        td.onclick = () => { setCell(idx); drawGrid(); };
        tr.append(td);
      }
      tb.append(tr);
    }
    gridBox.append(
      el('div', { class: 'map-hint', style: 'margin-bottom:8px' }, ticked.size ? `Đang tick ${ticked.size} ca: bấm vào ô (hoặc tên thứ / tên cột) để gán. Ô để trống = ngày nghỉ.` : 'Tick 1 ca ở bảng bên trái, rồi bấm vào các ô ngày để gán. Không tick ca nào mà bấm ô = xoá ô đó.'),
      el('div', { class: 'tbl-scroll', style: 'max-height:calc(100vh - 380px);overflow:auto' }, tbl),
      el('div', { style: 'margin-top:8px;display:flex;gap:8px' }, btnSm('Gán ca đang tick cho mọi ô', () => { if (!ticked.size) return toast('Tick ca trước', 'err'); for (let r = 0; r < rowsN; r++) for (let c = 0; c < colsN; c++) cells.set(idxOf(r, c), new Set(ticked)); drawGrid(); }, 'ghost'), btnSm('Xoá hết ô', () => { cells.clear(); drawGrid(); }, 'ghost')));
  };
  unitSel.onchange = drawGrid; cycI.oninput = drawGrid;
  const right = el('div', { class: 'panel', style: 'padding:14px' },
    el('div', { style: 'display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px' },
      el('div', {}, el('label', {}, el('span', { style: 'color:#dc2626' }, '* '), 'Tên'), nameI),
      el('div', {}, el('label', {}, el('span', { style: 'color:#dc2626' }, '* '), 'Đơn vị'), unitSel),
      el('div', {}, el('label', {}, el('span', { style: 'color:#dc2626' }, '* '), 'Chu kỳ'), cycI)),
    gridBox);

  const saveBtn = el('button', { class: 'btn green' }, 'Lưu');
  saveBtn.onclick = async () => {
    if (!nameI.value.trim()) return toast('Nhập tên lịch trình', 'err');
    const unit = unitSel.value;
    const body = { name: nameI.value.trim(), code: w.code || '', unit, cycle: parseInt(cycI.value, 10) || 1 };
    if (unit === 'auto') { if (!ticked.size) return toast('Tick ít nhất 1 ca', 'err'); body.shift_ids = [...ticked]; }
    else { body.days = [...cells].filter(([, set]) => set.size).map(([idx, set]) => ({ idx, shift_ids: [...set] })); if (!body.days.length) return toast('Chưa gán ca vào ô ngày nào', 'err'); }
    saveBtn.disabled = true;
    try {
      if (w.id) await api('/admin/schedules/' + w.id, { method: 'PUT', body }); else await api('/admin/schedules', { method: 'POST', body });
      toast('Đã lưu lịch trình', 'ok'); back();
    } catch (e) { toast(e.message, 'err'); saveBtn.disabled = false; }
  };
  drawShifts(); drawGrid();
  setMain(head('Lịch trình ca làm việc'),
    el('div', { class: 'panel', style: 'padding:10px 16px;display:flex;align-items:center;gap:14px;margin-bottom:14px' },
      btnSm('‹ Quay lại', back, 'ghost'), el('span', { style: 'color:#d1d5db' }, '|'), el('b', {}, w.id ? 'Chỉnh sửa' : 'Thêm'), el('span', { style: 'flex:1' }), canEdit ? saveBtn : ''),
    el('div', { class: 'as-add', style: 'grid-template-columns:minmax(300px,1fr) minmax(0,1.5fr)' }, left, right));
}

/* ---------- Lịch trình ca (hộp thoại kiểu cũ, giữ lại để tương thích) ---------- */
async function scheduleManageModal() {
  try { SHIFTS = (await api('/admin/shifts')).rows || SHIFTS; } catch {}   // luôn nạp danh sách ca mới nhất để form có ca mà tick
  const listBox = el('div', {}, loading());
  const addBtn = el('button', { class: 'btn' }, '+ Thêm lịch trình');
  addBtn.onclick = () => scheduleFormModal(null, reload);
  const reload = async () => {
    const { rows } = await api('/admin/schedules');
    SCHEDULES = rows;
    listBox.innerHTML = '';
    if (!rows.length) { listBox.append(el('div', { class: 'map-hint' }, 'Chưa có lịch trình nào. Bấm "+ Thêm lịch trình".')); return; }
    for (const w of rows) {
      const chips = el('div', { style: 'display:flex;gap:5px;flex-wrap:wrap;margin-top:5px' },
        ...w.shifts.map(s => el('span', { class: 'pill muted' }, `${s.name} (${s.start_time}-${s.end_time})`)));
      const edit = btnSm('Sửa', () => scheduleFormModal(w, reload));
      const del = btnSm('Xoá', async () => { try { await api('/admin/schedules/' + w.id, { method: 'DELETE' }); reload(); toast('Đã xoá', 'ok'); } catch (e) { toast(e.message, 'err'); } }, 'ghost');
      listBox.append(el('div', { style: 'padding:10px 2px;border-bottom:1px solid #f1efec' },
        el('div', { style: 'display:flex;align-items:center;gap:10px' }, el('b', { style: 'flex:1' }, '📋 ' + w.name), edit, del),
        chips));
    }
  };
  openModal('Lịch trình ca', [
    el('div', { class: 'map-hint' }, 'Lịch trình = 1 nhóm ca. Gán lịch trình cho nhân viên → hệ thống tự chọn ca trong nhóm theo giờ chấm. Hợp cho NV làm ca xoay (nay ca này, mai ca khác).'),
    addBtn, listBox,
  ], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Đóng')]);
  reload();
}
function scheduleFormModal(w, onSaved) {
  const nameI = input('ws-name', { value: w?.name || '', placeholder: 'VD: Ca xoay 2 kíp' });
  const codeI = input('ws-code', { value: w?.code || '', placeholder: 'VD: XOAY (tuỳ chọn)' });
  const chosen = new Set((w?.shifts || []).map(s => s.shift_id ?? s.id));
  const boxes = SHIFTS.filter(s => s.active).map(s => el('label', { style: 'display:flex;align-items:center;gap:8px;padding:6px 0;font-weight:600;color:var(--ink)' },
    el('input', { type: 'checkbox', class: 'ws-shift', value: s.id, style: 'width:auto', ...(chosen.has(s.id) ? { checked: '' } : {}) }),
    `${s.name} (${s.start_time}-${s.end_time})${s.check_in_start ? ' · nhận diện ' + s.check_in_start + '-' + s.check_in_end : ' · CHƯA đặt cửa sổ giờ'}`));
  const save = el('button', { class: 'btn' }, 'Lưu lịch trình');
  save.onclick = async () => {
    const shift_ids = [...document.querySelectorAll('.ws-shift:checked')].map(x => +x.value);
    if (!nameI.value.trim()) return toast('Nhập tên lịch trình', 'err');
    if (!shift_ids.length) return toast('Chọn ít nhất 1 ca', 'err');
    const body = { name: nameI.value.trim(), code: codeI.value.trim(), shift_ids };
    try {
      if (w) await api('/admin/schedules/' + w.id, { method: 'PUT', body });
      else await api('/admin/schedules', { method: 'POST', body });
      toast('Đã lưu', 'ok'); closeModal(); if (onSaved) setTimeout(scheduleManageModal, 100);
    } catch (e) { toast(e.message, 'err'); }
  };
  openModal(w ? 'Sửa lịch trình' : 'Thêm lịch trình', [
    el('div', { class: 'two-col' }, field('Tên lịch trình *', nameI), field('Mã (tuỳ chọn)', codeI)),
    el('div', {}, el('label', {}, 'Chọn các ca trong lịch trình'), el('div', {}, ...boxes),
      el('div', { class: 'map-hint' }, 'Nên đặt "cửa sổ nhận diện giờ vào" cho từng ca (trong Ca làm) để tự chọn ca chính xác theo giờ chấm.')),
  ], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Huỷ'), save]);
}
// Ô tick nhỏ dùng trong form ca
const chk = (id, on) => el('input', { type: 'checkbox', id, style: 'width:auto', ...(on ? { checked: '' } : {}) });
// Form khai báo ca (hiện bên phải danh sách) — bố cục kiểu Ronald Jack: nhãn bên trái, ô nhập bên phải, 2 tab.
// Trả { node, save }. Mọi ô đều nằm trong DOM (tab chỉ ẩn/hiện) nên bấm Lưu là lưu cả 2 tab.
function shiftForm(s, can) {
  const hm2m = (v) => (/^\d{2}:\d{2}$/.test(v || '') ? (+v.slice(0, 2)) * 60 + (+v.slice(3)) : null);
  const m2hm = (m) => { const x = ((m % 1440) + 1440) % 1440; return String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0'); };
  const num = (id, v, attrs = {}) => input(id, { type: 'number', min: 0, value: v, ...attrs });
  // 1 hàng: nhãn trái – ô nhập phải (– đơn vị / ghi chú)
  // (ghi chú của ô hiện khi rê chuột — không in ra hàng để các hàng đều nhau)
  const R = (label, ctl, unit, hint) => { if (hint) ctl.title = hint; return el('div', { class: 'frow', ...(hint ? { title: hint } : {}) }, el('label', { for: ctl.id || '' }, label),
    el('div', { class: 'fin' }, ctl, unit ? el('span', { class: 'funit' }, unit) : '')); };
  const ph = (i, t) => { i.placeholder = t; return i; };
  const C = (id, on, text, hint) => el('label', { class: 'fchk' }, chk(id, on), el('span', {}, text, hint ? el('span', { class: 'fhint2' }, ' ' + hint) : ''));
  const box = (title, ...kids) => el('fieldset', { class: 'fbox' }, el('legend', {}, title), ...kids);

  const nameI = input('s-name', { value: s?.name || '', placeholder: 'VD: Hành chính' });
  const codeI = input('s-code', { value: s?.code || '', placeholder: 'VD: HC, S, C, DEM' });
  const startI = time24('s-start', s?.start_time || '08:00'), endI = time24('s-end', s?.end_time || '17:00');
  const totalI = el('input', { id: 's-total', readonly: '', tabindex: -1, class: 'ro' });
  const bStartI = time24('s-breakStart', s?.break_start || '');
  const bEndI = time24('s-breakEnd', (s?.break_start && s?.break_minutes) ? m2hm(hm2m(s.break_start) + s.break_minutes) : '');
  const bMinI = num('s-break', s?.break_minutes ?? 0);
  const unitI = num('s-unit', s?.work_unit_value ?? 1.0, { step: '0.1' });
  const breakWarn = el('div', { class: 'fwarn' });
  // Tổng giờ trong ca = (ra − vào) − nghỉ; nghỉ: nhập giờ bắt đầu + kết thúc → tự ra số phút (hoặc chỉ nhập số phút = không cố định giờ)
  const recalc = () => {
    const a = hm2m(startI.value), b = hm2m(endI.value);
    if (a == null || b == null) { totalI.value = ''; return; }
    const len = ((b - a + 1440) % 1440) || 1440;
    const bad = breakError();
    const w = Math.max(0, len - (bad ? 0 : (+bMinI.value || 0)));
    totalI.value = (Math.round(w / 6) / 10).toString().replace('.', ',') + ' giờ' + (b <= a ? '  (ca qua đêm 🌙)' : '');
    for (const i of [bStartI, bEndI, bMinI]) i.style.borderColor = bad ? '#dc2626' : '';
    breakWarn.textContent = bad;
  };
  // Nghỉ giữa ca: 3 ô (bắt đầu, kết thúc, tổng phút) luôn khớp nhau
  //  - đủ 2 giờ → tự ra số phút;  có 1 giờ + số phút → tự ra giờ còn lại;  xoá hết giờ → số phút (do máy tự tính) về 0
  //  - chỉ nhập số phút, không nhập giờ = nghỉ KHÔNG cố định giờ
  let autoMin = !!(s?.break_start && s?.break_minutes);   // số phút đang là số tự tính từ 2 ô giờ
  const syncBreak = (from, who) => {
    // vừa XOÁ 1 ô giờ → bỏ giờ nghỉ cố định: xoá luôn ô giờ kia; số phút do máy tự tính thì về 0 (tự gõ thì giữ = nghỉ không cố định giờ)
    if (from === 'time' && who && !who.value.trim() && (bStartI.value || bEndI.value)) {
      bStartI.value = ''; bEndI.value = '';
      if (autoMin) { bMinI.value = 0; autoMin = false; }
      recalc(); return;
    }
    const bs = hm2m(bStartI.value), be = hm2m(bEndI.value), mn = +bMinI.value || 0;
    if (from === 'min') {
      autoMin = false;
      if (bs != null && mn > 0) bEndI.value = m2hm(bs + mn);
      else if (be != null && mn > 0) bStartI.value = m2hm(be - mn);
      else if (!mn) { bStartI.value = ''; bEndI.value = ''; }
    } else if (bs != null && be != null) { bMinI.value = (be - bs + 1440) % 1440; autoMin = true; }
    else if (bs != null && mn > 0) bEndI.value = m2hm(bs + mn);
    else if (be != null && mn > 0) bStartI.value = m2hm(be - mn);
    else if (bs == null && be == null && autoMin) { bMinI.value = 0; autoMin = false; }
    recalc();
  };
  // Giờ nghỉ phải nằm TRONG giờ ca (VD ca 13:00–17:30 thì nghỉ 12:00–13:00 là sai). Trả câu báo lỗi hoặc ''.
  const breakError = () => {
    const a = hm2m(startI.value), b = hm2m(endI.value), bs = hm2m(bStartI.value), be = hm2m(bEndI.value), mn = +bMinI.value || 0;
    if (a == null || b == null) return '';
    const len = ((b - a + 1440) % 1440) || 1440;
    if ((bs == null) !== (be == null)) return 'Nghỉ giữa ca: nhập cả giờ bắt đầu và giờ kết thúc, hoặc để trống cả hai (chỉ nhập số phút = nghỉ không cố định giờ).';
    if (mn >= len) return 'Thời gian nghỉ phải ngắn hơn thời gian của ca.';
    if (bs != null && mn > 0) { const rel = (bs - a + 1440) % 1440; if (rel + mn > len) return `Giờ nghỉ ${bStartI.value}–${bEndI.value} nằm ngoài giờ ca ${startI.value}–${endI.value}. Nghỉ giữa ca phải nằm trong giờ làm việc của ca.`; }
    return '';
  };
  for (const i of [startI, endI]) { i.addEventListener('blur', recalc); i.addEventListener('input', recalc); }
  for (const i of [bStartI, bEndI]) i.addEventListener('blur', () => syncBreak('time', i));
  bMinI.addEventListener('input', () => syncBreak('min'));
  recalc();

  const actChk = chk('s-active', s ? !!s.active : true);
  const tabCa = el('div', { class: 'sh-form' },
    el('div', { class: 'sh-col' },
      R('Ca làm việc *', nameI),
      R('Mã ca (dùng trong Excel)', codeI),
      R('Giờ vào làm việc *', startI),
      R('Giờ kết thúc làm việc *', endI, '', 'Giờ ra nhỏ hơn giờ vào = ca qua đêm'),
      R('Tổng giờ trong ca làm việc', totalI),
      R('Giờ bắt đầu nghỉ giữa ca', ph(bStartI, '(không cố định)'), '', 'Để trống = không cố định giờ'),
      R('Giờ kết thúc nghỉ giữa ca', ph(bEndI, '')),
      R('Tổng thời gian nghỉ', bMinI, 'phút'),
      breakWarn,
      R('Công tính', unitI, 'công', 'Cả ngày = 1, nửa ngày = 0,5'),
      R('Bắt đầu vào', ph(time24('s-ciStart', s?.check_in_start || ''), '(tự động)'), '', 'Khung giờ nhận lượt chấm VÀO'),
      R('Kết thúc vào', ph(time24('s-ciEnd', s?.check_in_end || ''), '(tự động)')),
      R('Bắt đầu ra', ph(time24('s-coStart', s?.check_out_start || ''), '(tự động)'), '', 'Khung giờ nhận lượt chấm RA'),
      R('Kết thúc ra', ph(time24('s-coEnd', s?.check_out_end || ''), '(tự động)')),
      R('Chấm thiếu / có mặt', el('select', { id: 's-noout' },
        el('option', { value: '0', ...(!s?.no_out_credit ? { selected: '' } : {}) }, 'Thiếu giờ ra: không tính công'),
        el('option', { value: '1', ...(+s?.no_out_credit === 1 ? { selected: '' } : {}) }, 'Thiếu giờ ra: đủ công, trừ phần đi trễ'),
        el('option', { value: '2', ...(+s?.no_out_credit === 2 ? { selected: '' } : {}) }, 'Có mặt là tính đủ công')), '',
        'Có mặt là tính đủ công: có chấm (1 hay nhiều lần) là đủ công của ca, không trừ đi muộn / về sớm. Chỉ chấm 1 lần thì không tính tăng ca'),
      C('s-comp', s?.compensate_late, 'Tính bù trừ cho ca này', '(đi làm trễ thì về trễ bù lại để không bị trừ giờ; phần bù không tính tăng ca)'),
      el('label', { class: 'fchk' }, actChk, el('span', {}, 'Đang dùng ca này', el('span', { class: 'fhint2' }, ' (bỏ tích = tắt ca, ẩn khỏi danh sách chọn)')))),
    el('div', { class: 'sh-col' },
      box('Đi trễ, về sớm',
        R('Cho phép đi làm trễ', num('s-grace', s?.late_grace_min ?? 5), 'phút'),
        R('Cho phép đi về sớm', num('s-early', s?.early_grace_min ?? 15), 'phút'),
        C('s-gracededuct', s?.grace_deduct, 'Chỉ tính phần VƯỢT số phút cho phép', '(cho phép 5 phút, trễ 12 phút → ghi 7 phút; không tích → ghi đủ 12 phút)'),
        el('div', { class: 'fhint' }, 'Trong số phút cho phép thì không tính trễ / sớm và không trừ giờ công. Làm tròn trễ / sớm theo khối phút: đặt ở Cài đặt › Quy tắc tính công.')),
      box('Ghi chú',
        el('div', { class: 'fhint' }, 'Ca qua đêm: đặt giờ kết thúc NHỎ HƠN giờ vào (VD 22:00 → 06:00). Công tính: cả ngày = 1, nửa ngày = 0,5.'),
        el('div', { class: 'fhint' }, 'Để trống khung "Bắt đầu vào / Kết thúc ra" thì phần mềm tự nhận lượt chấm quanh giờ ca. Khai khung khi cần phân biệt các ca gần giờ nhau (VD ca Sáng 8:00 ra 11:30–13:00, ca Hành chính 8:00 ra 16:00–19:00) hoặc ca đêm vào sớm nhiều giờ (VD ca 22:00, bắt đầu vào 17:00).'),
        el('div', { class: 'fhint' }, 'Nghỉ giữa ca có giờ cố định (VD 12:00–13:00): vào 12:19 vẫn đủ buổi chiều, đi trễ không tính thời gian nghỉ.'),
        el('div', { class: 'fhint' }, 'Ngày nghỉ cuối tuần đặt chung cho cả công ty ở Cài đặt › Quy tắc tính công.'))));

  const otChk = chk('s-allowot', s?.allow_ot);
  const tabOt = el('div', { class: 'sh-form' },
    el('div', { class: 'sh-col' },
      el('label', { class: 'fchk' }, otChk, el('span', {}, 'Cho phép tính tăng ca cho ca này')),
      R('Ở lại sau giờ ra tối thiểu', num('s-otafter', s?.ot_start_after_min ?? 30), 'phút', 'Ở lại ít hơn số này thì không tính tăng ca'),
      C('s-otbefore', s?.ot_before, 'Tính cả tăng ca TRƯỚC giờ vào ca', '(đến sớm)'),
      R('Đến sớm tối thiểu', num('s-otbeforemin', s?.ot_before_min ?? 30), 'phút'),
      C('s-holidayot', s?.holiday_as_ot, 'Làm ca này vào NGÀY LỄ: cả ca là tăng ca', '(không tính công, toàn bộ giờ làm thành tăng ca ngày lễ)'),
      C('s-shiftot', s?.shift_as_ot, 'Ca này là CA TĂNG CA', '(ngày nào làm ca này cũng không tính công, toàn bộ giờ làm thành tăng ca)'),
      el('div', { class: 'fhint' }, 'Ở lại (hoặc đến sớm) ít hơn số phút tối thiểu thì không tính tăng ca. Làm tròn tăng ca và "đi làm cuối tuần = tăng ca": đặt chung cho cả công ty ở Cài đặt › Quy tắc tính công.')),
    el('div', { class: 'sh-col' },
      box('Chia mức tăng ca ngày thường (TC1 → TC4)',
        R('TC1 tối đa', num('s-t1', s?.ot_tier1_min ?? 0), 'phút'),
        R('TC2 tối đa', num('s-t2', s?.ot_tier2_min ?? 0), 'phút'),
        R('TC3 tối đa', num('s-t3', s?.ot_tier3_min ?? 0), 'phút'),
        R('Hệ số lương TC2', num('s-r2', s?.ot_tier2_rate ?? 0, { step: '0.1' })),
        R('Hệ số lương TC3', num('s-r3', s?.ot_tier3_rate ?? 0, { step: '0.1' })),
        R('Hệ số lương TC4', num('s-r4', s?.ot_tier4_rate ?? 0, { step: '0.1' })),
        el('div', { class: 'fhint' }, 'Để 0 = không chia (tất cả là TC1). VD TC1 = 120, TC2 = 120: tăng ca 5 tiếng → 2h TC1, 2h TC2, 1h TC3. Hệ số để 0 = như tăng ca ngày thường.'))));

  const TABS = [['Ca làm việc', tabCa], ['Tăng ca', tabOt]];
  const tabBtns = TABS.map(([t], k) => { const b = el('button', { type: 'button', class: 'tab-btn' }, t); b.onclick = () => showTab(k); return b; });
  const showTab = (k) => { TABS.forEach(([, pane], n) => { pane.style.display = n === k ? '' : 'none'; }); tabBtns.forEach((b, n) => b.classList.toggle('on', n === k)); };
  showTab(0);
  // Ca còn lưu cách ghép giờ riêng kiểu cũ → nhắc + cho bỏ
  const oldRule = (s && s.merge_rule && s.merge_rule !== 'filo' && s.merge_rule !== 'default')
    ? el('div', { style: 'font-size:12.5px;color:#b45309;margin-bottom:8px' }, `Ca này còn lưu cách ghép giờ riêng (kiểu cũ): ${(RULE_LABEL[s.merge_rule] || s.merge_rule).split(' —')[0]} `,
      can ? el('a', { href: '#', style: 'color:#dc2626;font-weight:700', onclick: async (ev) => { ev.preventDefault(); if (!confirm(`Bỏ cách ghép giờ riêng của ca "${s.name}"? Sau đó ca này ghép giờ theo Lịch trình vào ra.`)) return; try { await api('/admin/shifts/' + s.id + '/clear-merge-rule', { method: 'POST' }); toast('Đã bỏ', 'ok'); pageShifts(); } catch (e) { toast(e.message, 'err'); } } }, 'Bỏ') : '')
    : '';
  const node = el('div', {}, oldRule, el('div', { class: 'tab-bar' }, ...tabBtns), tabCa, tabOt);
  if (!can) node.querySelectorAll('input,select').forEach((x) => { x.disabled = true; });

  const save = async () => {
    const b = {
      name: nameI.value.trim(), code: codeI.value.trim(),
      start_time: startI.value, end_time: endI.value,
      check_in_start: $('#s-ciStart').value || '', check_in_end: $('#s-ciEnd').value || '',
      check_out_start: $('#s-coStart').value || '', check_out_end: $('#s-coEnd').value || '',
      late_grace_min: +$('#s-grace').value || 0, early_grace_min: +$('#s-early').value || 0,
      break_minutes: +bMinI.value || 0, break_start: (+bMinI.value || 0) > 0 ? (bStartI.value || '') : '',
      work_unit_value: +unitI.value || 1, active: actChk.checked,
      allow_ot: otChk.checked, ot_start_after_min: +$('#s-otafter').value || 0,
      ot_before: $('#s-otbefore').checked, ot_before_min: +$('#s-otbeforemin').value || 0,
      ot_tier1_min: +$('#s-t1').value || 0, ot_tier2_min: +$('#s-t2').value || 0, ot_tier3_min: +$('#s-t3').value || 0,
      ot_tier2_rate: +$('#s-r2').value || 0, ot_tier3_rate: +$('#s-r3').value || 0, ot_tier4_rate: +$('#s-r4').value || 0,
      holiday_as_ot: $('#s-holidayot').checked, shift_as_ot: $('#s-shiftot').checked,
      compensate_late: $('#s-comp').checked, no_out_credit: +$('#s-noout').value,
      grace_deduct: $('#s-gracededuct').checked,
    };
    if (!b.name) { toast('Nhập tên ca', 'err'); showTab(0); nameI.focus(); return; }
    if (hm2m(b.start_time) == null || hm2m(b.end_time) == null) { toast('Nhập giờ vào / giờ ra dạng HH:mm (VD 08:00)', 'err'); showTab(0); return; }
    syncBreak('time');
    const bErr = breakError();
    if (bErr) { toast(bErr, 'err'); showTab(0); bStartI.focus(); return; }
    b.break_minutes = +bMinI.value || 0; b.break_start = b.break_minutes > 0 ? (bStartI.value || '') : '';
    try {
      if (s) await api('/admin/shifts/' + s.id, { method: 'PUT', body: b });
      else { const r = await api('/admin/shifts', { method: 'POST', body: b }); _shSel = r.id || null; }
      toast('Đã lưu', 'ok'); pageShifts();
    } catch (err) { toast(err.message, 'err'); }
  };
  return { node, save };
}

