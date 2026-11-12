/* ---------- 6) BÁO CÁO ---------- */
/* ---------- SỬA CÔNG (thêm / sửa / xoá giờ chấm bằng tay) ---------- */
const WD_VN = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const wdName = (d) => WD_VN[new Date(d + 'T12:00:00Z').getUTCDay()];
let EDITATT_EMP = null;
const shiftName = (id) => { const s = SHIFTS.find(x => x.id === id); return s ? s.name : null; };
const minCell = (v) => (v && v > 0) ? String(v) : '—';
async function pageEditAtt() {
  setMain(head('Tính công'), loading());
  if (!SHIFTS.length) { try { await loadRefs(); } catch {} }
  let emps;
  try { emps = (await api('/admin/employees')).rows.filter(e => e.active); }
  catch (e) { setMain(head('Tính công'), el('div', { class: 'empty' }, e.message)); return; }
  let depts = [];
  try { depts = (await api('/reports/departments')).rows || []; } catch {}
  if (!DEPARTMENTS.length) { try { DEPARTMENTS = (await api('/admin/departments')).rows || []; } catch {} }   // cây cha–con cho ô chọn phòng ban

  // nút "chọn NHIỀU" dùng hàm chung makeChecklist (có ô tìm, gõ không dấu)
  // Phòng ban (chọn nhiều) + Nhân viên (chọn nhiều, lọc theo phòng ban đã chọn)
  const deptPick = new Set(), empPick = new Set();
  const deptCl = makeChecklist('🏢', 'Cả công ty', () => deptTreeItems(depts), deptPick, () => { empPick.clear(); empCl.sync(); load(); });
  const empCl = makeChecklist('👥', 'Tất cả NV', () => { const ex = deptExpand(deptPick); return emps.filter(e => !deptPick.size || ex.has(e.department || '')).map(e => ({ value: e.id, text: `${e.full_name} (${e.code})` })); }, empPick, () => load());
  // ngày theo giờ VN (toISOString là giờ UTC → lùi 1 ngày)
  const fromI = el('input', { type: 'date', value: todayVN().slice(0, 8) + '01', style: 'width:auto' });
  const toI = el('input', { type: 'date', value: todayVN(), style: 'width:auto' });

  let view = 'detail';
  const viewBar = el('div', { style: 'display:inline-flex;gap:6px' });
  const renderViewBar = () => viewBar.replaceChildren(
    (() => { const b = el('button', { class: 'btn sm' + (view === 'detail' ? '' : ' ghost') }, '📋 Chi tiết'); b.onclick = () => { view = 'detail'; renderViewBar(); load(); }; return b; })(),
    (() => { const b = el('button', { class: 'btn sm' + (view === 'summary' ? '' : ' ghost') }, 'Σ Tổng hợp'); b.onclick = () => { view = 'summary'; renderViewBar(); load(); }; return b; })());
  renderViewBar();

  const recalcBtn = el('button', { class: 'btn ghost sm' }, '↻ Tính lại');
  // Tích để hiện CẢ CÔNG TY (kể cả ngày chưa chấm) — chỉ áp cho tab Chi tiết
  const allChkInput = el('input', { type: 'checkbox', style: 'width:auto' });
  allChkInput.onchange = () => load();
  const allChk = el('label', { style: 'display:inline-flex;align-items:center;gap:5px;font-size:13px;font-weight:600;color:var(--ink);cursor:pointer', title: 'Hiện tất cả nhân viên, kể cả ngày làm việc chưa chấm công' }, allChkInput, 'Cả công ty (kể cả chưa chấm)');
  // Tích để hiện dấu (*) ở dòng giờ sửa/thêm bằng tay (mặc định BẬT)
  const markChkInput = el('input', { type: 'checkbox', style: 'width:auto', checked: '' });
  markChkInput.onchange = () => load();
  const markChk = el('label', { style: 'display:inline-flex;align-items:center;gap:5px;font-size:13px;font-weight:600;color:var(--ink);cursor:pointer', title: 'Đánh dấu (*) các dòng giờ được sửa/thêm bằng tay' }, markChkInput, 'Dấu (*) sửa tay');
  // SẮP XẾP tab Chi tiết: theo NHÂN VIÊN (1 người hết các ngày rồi mới sang người khác — mặc định) hoặc theo NGÀY (mỗi ngày đủ mọi người).
  // Mỗi công ty quen 1 kiểu → nhớ lựa chọn trên trình duyệt.
  let sortBy = 'emp';
  try { if (localStorage.getItem('editatt_sort') === 'date') sortBy = 'date'; } catch {}
  const sortSel = el('select', { style: 'width:auto;padding:4px 8px', title: 'Thứ tự các dòng ở tab Chi tiết' },
    el('option', { value: 'emp' }, '👤 Xếp theo nhân viên'), el('option', { value: 'date' }, '📅 Xếp theo ngày'));
  sortSel.value = sortBy;
  sortSel.onchange = () => { sortBy = sortSel.value; try { localStorage.setItem('editatt_sort', sortBy); } catch {} load(); };
  const wrap = el('div');

  const scope = () => {
    let p = `from=${fromI.value}&to=${toI.value}`;
    if (empPick.size) p += '&ids=' + [...empPick].join(',');
    else if (deptPick.size) p += '&depts=' + encodeURIComponent([...deptPick].join(','));
    if (allChkInput.checked) p += '&all=1';
    if (_virt && auditOn()) p += '&virt=' + _virt;
    return p;
  };
  const mkIso = (date, hm) => hm ? new Date(`${date}T${hm}:00+07:00`).toISOString() : null;
  const openEdit = (r) => attEditModal({ id: r.att_id, work_date: r.date, check_in_at: mkIso(r.date, r.in), check_out_at: mkIso(r.date, r.out), note: '' }, r.employee_id, load);
  const canEdit = hasPerm('attendance_edit');
  // SỬA NGAY TRÊN BẢNG: bấm ô Vào / Ra → gõ giờ (VD 0800) → Enter hoặc bấm ra ngoài = lưu, Esc = huỷ.
  // Dòng chưa có giờ (ngày chưa chấm / ngày nghỉ) gõ giờ vào là thêm mới cho đúng người, đúng ngày đó.
  const inlineCell = (r, field, content) => {
    const td = el('td', {}, ...content);
    if (!canEdit || _virt) return td;   // công ảo: chỉ xem
    td.className = 'att-inl';
    td.title = 'Bấm để sửa giờ ' + (field === 'in' ? 'vào' : 'ra');
    td.onclick = () => {
      if (td.querySelector('input')) return;
      const old = r[field] || '';
      const i = time24('', old);
      i.className = 'att-inl-in';
      td.replaceChildren(i); i.focus(); i.select();
      let done = false;
      const back = () => td.replaceChildren(...content);
      const finish = async (save) => {
        if (done) return; done = true;
        const v = i.value.trim();
        if (!save || v === old) return back();
        if (!v && field === 'in') { toast('Muốn bỏ hẳn giờ chấm ngày này thì bấm "Sửa" → "🗑 Xoá giờ"', 'err'); return back(); }
        if (!r.att_id && field === 'out' && !r.in) { toast('Nhập giờ vào trước', 'err'); return back(); }
        i.disabled = true;
        try {
          if (r.att_id) await api('/admin/attendance/' + r.att_id, { method: 'PUT', body: { [field === 'in' ? 'check_in' : 'check_out']: v } });
          else await api('/admin/attendance', { method: 'POST', body: { employee_id: r.employee_id, work_date: r.date, check_in: v, check_out: '' } });
          toast(`Đã lưu giờ ${field === 'in' ? 'vào' : 'ra'} ${v || '(trống)'} — ${r.name || ''} ${r.date.slice(8)}/${r.date.slice(5, 7)}`, 'ok');
          load();
        } catch (e) { toast(e.message, 'err'); done = false; i.disabled = false; i.focus(); }
      };
      i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); i.blur(); } else if (e.key === 'Escape') finish(false); });
      i.addEventListener('blur', () => setTimeout(() => finish(true), 0));   // sau khi time24 chuẩn hoá giờ
      i.onclick = (e) => e.stopPropagation();
    };
    return td;
  };

  // Lưới CHI TIẾT: từng ngày, giờ vào/ra, ca, các lần chấm, nghỉ
  const loadDetail = async () => {
    wrap.innerHTML = ''; wrap.append(loading());
    let d;
    try { d = await api(`/admin/attendance/grid?mode=detail&${scope()}`); }
    catch (e) { wrap.innerHTML = ''; wrap.append(el('div', { class: 'empty' }, e.message)); return; }
    const rows = d.rows || [];
    const showNV = empPick.size !== 1;   // hiện cột NV trừ khi chọn đúng 1 người
    sortDetailRows(rows, sortBy);
    const hrly = hourlyMode();
    // Chế độ tính theo GIỜ: bỏ Trễ/Sớm/OT/Công, hiện Tổng giờ + Tổng phút
    const metricHeads = hrly ? ['Tổng giờ', 'Tổng phút'] : ['Trễ(p)', 'Sớm(p)', 'OT(p)', 'Công'];
    const heads = ['Ngày', 'Thứ', ...(showNV ? ['Mã', 'Họ tên', 'Bộ phận'] : []), 'Ca', 'Vào', 'Ra', 'Các lần chấm', ...metricHeads, 'Nghỉ', 'Trạng thái', ''];
    const tbl = el('table', { class: 'data' });
    tbl.innerHTML = '<thead><tr>' + heads.map(h => `<th>${h}</th>`).join('') + '</tr></thead>';
    const tb = el('tbody');
    const mkRow = (r) => {
      const cells = [
        el('td', {}, r.date.slice(8) + '/' + r.date.slice(5, 7)),
        el('td', {}, r.wd),
        ...(showNV ? [el('td', {}, r.code), el('td', {}, el('b', {}, r.name)), el('td', {}, r.dept || '—')] : []),
        el('td', {}, r.shift ? el('span', { class: 'pill' }, r.shift) : el('span', { class: 'muted' }, '—')),
        inlineCell(r, 'in', [r.in || '—', (r.manual && markChkInput.checked) ? el('span', { style: 'color:#e67e22;font-weight:800;margin-left:2px', title: 'Giờ sửa/thêm bằng tay' }, '*') : '']),
        inlineCell(r, 'out', [r.out || (r.in ? el('span', { class: 'pill muted' }, 'chưa ra') : '—')]),
        (() => {
          const td = el('td', {}, (r.punches && r.punches.length) ? el('span', { style: 'font-size:12px;color:var(--muted)' }, r.punches.join(' · ')) : el('span', { class: 'muted' }, canEdit ? '+ lượt chấm' : '—'));
          if (canEdit && !_virt) { td.className = 'att-inl'; td.title = 'Bấm để xem / thêm / sửa / xoá từng lượt chấm'; td.onclick = () => punchModal({ id: r.employee_id, name: r.name, code: r.code }, r.date, load); }
          return td;
        })(),
        ...(hrly ? [
          el('td', { style: 'text-align:center;font-weight:600' }, r.mins ? (Math.round(r.mins / 60 * 100) / 100) + ' giờ' : '—'),
          el('td', { style: 'text-align:center' }, r.mins ? (r.mins + ' phút') : '—'),
        ] : [
          el('td', {}, r.late > 0 ? el('span', { style: 'color:#c0392b;font-weight:600' }, String(r.late)) : '—'),
          el('td', {}, r.early > 0 ? el('span', { style: 'color:#c0392b;font-weight:600' }, String(r.early)) : '—'),
          // tăng ca bị chặn theo ĐĂNG KÝ LÀM THÊM: gạch chân chấm + mũi tên nhỏ, rê chuột xem thực tế / đăng ký
          el('td', {}, r.otRaw ? el('span', { class: 'ot-cap', title: `Làm thêm thực tế ${r.otRaw}' · ${r.otReg == null ? 'chưa đăng ký làm thêm' : `đăng ký ${r.otReg}'`} → chỉ tính ${r.ot}'` }, String(r.ot), el('small', {}, `/${r.otRaw}`))
            : r.ot > 0 ? el('span', { style: 'color:#0a7;font-weight:600' }, String(r.ot)) : '—'),
          el('td', { style: 'text-align:center;font-weight:600' }, String(r.cong ?? 0)),
        ]),
        el('td', { style: 'text-align:center' }, r.leave ? el('span', { class: 'pill warn' }, r.leave) : '—'),
        el('td', {}, r.status || '—'),
        el('td', {}, !canEdit || _virt ? '' : r.att_id ? btnSm('Sửa', () => openEdit(r)) : (() => { const t = btnSm('+ Thêm', () => attEditModal(null, r.employee_id, load, { date: r.date }), 'ghost'); t.style.whiteSpace = 'nowrap'; return t; })()),
      ];
      // xếp theo nhân viên: kẻ vạch đậm ở dòng đầu mỗi người cho dễ nhìn ranh giới
      return el('tr', r._first && showNV ? { class: 'emp-first' } : {}, ...cells);
    };
    keepPage();
    const pager = pagedRows(tb, rows, mkRow, heads.length, pageSt.detail, 'editatt_page_size');   // 20 / 50 / 100 dòng mỗi trang
    tbl.append(tb);
    wrap.innerHTML = '';
    wrap.append(
      ...[lockNote(d.locks)].filter(Boolean),
      el('div', { class: 'map-hint', style: 'margin-bottom:10px' }, (isInspector() ? '' : 'Bấm thẳng vào ô Vào / Ra để gõ giờ (VD 0800), Enter để lưu, Esc để huỷ. Bấm ô "Các lần chấm" để xem / sửa từng lượt. Thêm giờ, thêm hàng loạt, xoá dữ liệu: menu "✏️ Thêm / sửa / xóa giờ chấm". ') + 'Ký hiệu Nghỉ: P = phép · R = nghỉ có lương · KL = không lương · CT = công tác · TS = thai sản · K = khác. "Các lần chấm" liệt kê mọi lượt quẹt trong ngày.'),
      el('div', { class: 'panel' }, el('div', { class: 'tbl-scroll' }, tbl), pager));
  };
  // Giữ trang đang xem khi tải lại sau khi sửa giờ; đổi phạm vi (ngày / phòng ban / NV / tab) thì về trang 1
  const pageSt = { detail: { page: 1 }, summary: { page: 1 } };
  let lastScope = '';
  const keepPage = () => { const s = view + '|' + scope() + '|' + markChkInput.checked + '|' + sortBy; if (s !== lastScope) { pageSt.detail.page = 1; pageSt.summary.page = 1; lastScope = s; } };

  // Lưới TỔNG HỢP: mỗi NV 1 dòng + tick chọn để tính lại vài người
  const loadSummary = async () => {
    wrap.innerHTML = ''; wrap.append(loading());
    let d;
    try { d = await api(`/admin/attendance/grid?mode=summary&${scope()}`); }
    catch (e) { wrap.innerHTML = ''; wrap.append(el('div', { class: 'empty' }, e.message)); return; }
    const rows = d.rows || [];
    const tbl = el('table', { class: 'data' });
    tbl.innerHTML = '<thead><tr><th>Mã</th><th>Họ tên</th><th>Bộ phận</th><th>Ngày công</th><th>Tổng công</th><th>Tổng giờ</th><th>OT(g)</th><th>Trễ</th><th>Sớm</th><th>Nghỉ</th><th></th></tr></thead>';
    const tb = el('tbody');
    const mkRow = (r) => el('tr', {},
      el('td', {}, r.code),
      el('td', {}, el('b', {}, r.name)),
      el('td', {}, r.dept || '—'),
      el('td', { style: 'text-align:center' }, String(r.days ?? 0)),
      el('td', { style: 'text-align:center;font-weight:700' }, String(r.cong ?? 0)),
      el('td', { style: 'text-align:center' }, String(r.gio ?? 0)),
      el('td', { style: 'text-align:center' }, r.ot ? String(r.ot) : '—'),
      el('td', { style: 'text-align:center' }, r.lateN ? `${r.lateN} (${r.lateM}p)` : '—'),
      el('td', { style: 'text-align:center' }, r.earlyN ? `${r.earlyN} (${r.earlyM}p)` : '—'),
      el('td', { style: 'text-align:center' }, r.leaveN ? String(r.leaveN) : '—'),
      el('td', {}, btnSm('Chi tiết', () => { empPick.clear(); empPick.add(r.id); empCl.sync(); view = 'detail'; renderViewBar(); load(); })),
    );
    keepPage();
    const pager = pagedRows(tb, rows, mkRow, 11, pageSt.summary, 'editatt_page_size');
    tbl.append(tb);
    wrap.innerHTML = '';
    wrap.append(
      ...[lockNote(d.locks)].filter(Boolean),
      el('div', { class: 'map-hint', style: 'margin-bottom:10px' }, `Đang xem ${rows.length} nhân viên. Chọn phòng ban / nhân viên (nút 🏢 / 👥) rồi bấm "↻ Tính lại" để tính lại đúng phạm vi. Bấm "Chi tiết" để xem/sửa 1 người.`),
      el('div', { class: 'panel' }, el('div', { class: 'tbl-scroll' }, tbl), pager));
  };

  // Đổi Từ / Đến ngày KHÔNG tự tải → bấm "✓ Áp dụng" hoặc Enter
  const dApply = dateApply(fromI, toI, () => load());
  const applyB = dApply.btn;
  const load = () => {
    dApply.synced();
    sortSel.style.display = view === 'detail' ? '' : 'none';   // ô Sắp xếp chỉ dùng cho tab Chi tiết
    view === 'summary' ? loadSummary() : loadDetail();
  };
  recalcBtn.onclick = async () => {
    let scopeTxt;
    if (empPick.size) scopeTxt = empPick.size + ' nhân viên đã chọn';
    else if (deptPick.size) scopeTxt = deptPick.size + ' phòng ban đã chọn';
    else scopeTxt = 'CẢ CÔNG TY';
    if (!confirm(`Tính lại công từ ${fromI.value} đến ${toI.value} cho ${scopeTxt}?\nDò lại ca theo giờ vào/ra và tính lại Muộn/Sớm/OT/Công.`)) return;
    recalcBtn.disabled = true; recalcBtn.textContent = 'Đang tính…';
    try { const rs = await api('/admin/recompute?' + scope(), { method: 'POST' }); toast(`Đã tính lại ${rs.updated} bản ghi`, 'ok'); load(); }
    catch (e) { toast(e.message, 'err'); }
    finally { recalcBtn.disabled = false; recalcBtn.textContent = '↻ Tính lại'; }
  };

  const bar = el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' },
    viewBar, deptCl.btn, empCl.btn,
    el('span', { style: 'color:var(--muted);font-size:13px' }, 'Từ'), fromI,
    el('span', { style: 'color:var(--muted);font-size:13px' }, 'đến'), toI, applyB,
    allChk, isInspector() ? null : markChk, isInspector() ? null : recalcBtn, virtToggle(() => load()));
  bar.insertBefore(sortSel, allChk);
  setMain(head('Tính công'), bar, el('div', { style: 'height:10px' }), wrap);
  load();
}

async function attEditModal(row, employeeId, reload, opts = {}) {
  const pick = !row && !employeeId ? await empMultiPicker(opts.emps || [], 220) : null;   // chưa chọn NV → chọn trong form
  const date0 = row ? row.work_date : (opts.date || new Date().toLocaleDateString('sv', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const dateI = input('att-date', { type: 'date', value: date0, ...(row ? { disabled: '' } : {}) });
  const inI = time24('att-in', row?.check_in_at ? isoToHM(row.check_in_at) : '');
  const outI = time24('att-out', row?.check_out_at ? isoToHM(row.check_out_at) : '');
  const noteI = input('att-note', { placeholder: 'VD: Quên chấm, Đi công tác…', value: row?.note || '' });
  // XOÁ RIÊNG 1 GIỜ (vào hoặc ra): giờ đó là lượt quẹt → xoá lượt quẹt, công tính lại theo các lượt còn lại;
  // giờ nhập tay / chấm điện thoại → bỏ giờ ra (thành "Thiếu ra"), bỏ giờ vào thì giờ ra còn lại thành lượt duy nhất (giống máy: 1 lượt = vào, thiếu ra)
  const addD = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  let punches = [];
  if (row) { try { punches = (await api(`/admin/attendance/punches?employee_id=${employeeId}&from=${row.work_date}&to=${addD(row.work_date, 1)}`)).rows || []; } catch {} }
  const delOne = async (which) => {
    const t = which === 'in' ? isoToHM(row.check_in_at) : isoToHM(row.check_out_at);
    const other = which === 'in' && row.check_out_at ? isoToHM(row.check_out_at) : '';
    const same = punches.filter((x) => x.time === t);
    const p = which === 'in' ? same.find((x) => x.date === row.work_date) : same[same.length - 1];
    const what = which === 'in' ? 'giờ VÀO' : 'giờ RA';
    if (!confirm(`Xoá ${what} ${t} ngày ${row.work_date.slice(8)}/${row.work_date.slice(5, 7)}?
` + (p ? 'Đây là lượt quẹt — công ngày này sẽ tính lại theo các lượt còn lại.'
      : which === 'out' ? 'Ngày này thành "Thiếu ra".' : other ? `Còn lại 1 giờ ${other} → thành giờ vào, ngày này "Thiếu ra".` : 'Đây là giờ duy nhất → xoá giờ chấm cả ngày.'))) return;
    try {
      if (p) await api('/admin/attendance/punches/' + p.id, { method: 'DELETE' });
      else if (which === 'out') await api('/admin/attendance/' + row.id, { method: 'PUT', body: { check_out: '' } });
      else if (other) await api('/admin/attendance/' + row.id, { method: 'PUT', body: { check_in: other, check_out: '' } });
      else await api('/admin/attendance/' + row.id, { method: 'DELETE' });
      toast(`Đã xoá ${what} ${t}`, 'ok'); closeModal(); reload();
    } catch (e) { toast(e.message, 'err'); }
  };
  const delLink = (which, has) => {
    if (!has) return '';
    const b = el('button', { class: 'btn ghost sm', type: 'button', style: 'color:#c0392b;margin-top:6px' }, which === 'in' ? '✕ Xoá giờ vào' : '✕ Xoá giờ ra');
    b.onclick = () => delOne(which);
    return b;
  };
  const body = row ? [
    field('Ngày', dateI),
    el('div', { class: 'two-col' },
      el('div', {}, field('Giờ vào', inI), delLink('in', row.check_in_at)),
      el('div', {}, field('Giờ ra (để trống nếu chưa ra)', outI), delLink('out', row.check_out_at))),
    field('Lý do / ghi chú', noteI),
    el('div', { class: 'map-hint' }, 'Giờ ra nhỏ hơn giờ vào sẽ được hiểu là ca qua đêm (sáng hôm sau).'),
  ] : [
    ...(pick ? [pick.node] : []),
    field('Ngày', dateI),
    el('div', { class: 'two-col' }, field('Giờ vào (để trống nếu chỉ thêm giờ ra)', inI), field('Giờ ra (để trống nếu chưa ra)', outI)),
    el('div', { class: 'map-hint' }, 'Thêm thành LƯỢT CHẤM (như quẹt máy) — công ngày đó tự tính lại theo ca. Giờ ra nhỏ hơn giờ vào hiểu là sáng hôm sau. Xem / sửa / xoá từng lượt ở ô "Các lần chấm".'),
  ];
  const save = el('button', { class: 'btn' }, row ? 'Lưu thay đổi' : 'Thêm giờ');
  save.onclick = async () => {
    const b = { check_in: inI.value || '', check_out: outI.value || '', note: noteI.value };
    try {
      if (row) await api('/admin/attendance/' + row.id, { method: 'PUT', body: b });
      else {
        // thêm LƯỢT CHẤM vào / ra (như Wise Eye) → công ngày đó tính lại theo ca + quy tắc ghép vào–ra
        const ids = pick ? [...pick.picked] : [employeeId];
        if (!ids.length) return toast('Chọn ít nhất 1 nhân viên', 'err');
        if (!b.check_in && !b.check_out) return toast('Nhập giờ vào và/hoặc giờ ra', 'err');
        save.disabled = true;
        const r = await api('/admin/attendance/punches', { method: 'POST', body: { employee_ids: ids, date: dateI.value, in: b.check_in, out: b.check_out } });
        toast(`Đã thêm giờ cho ${r.count} người` + (r.skippedPhone ? ` · bỏ qua ${r.skippedPhone} người chấm bằng điện thoại (trùng phiên đã có / đang có phiên chưa ra)` : ''), r.count ? 'ok' : 'err'); closeModal(); reload(); return;
      }
      toast('Đã lưu', 'ok'); closeModal(); reload();
    } catch (e) { toast(e.message, 'err'); save.disabled = false; }
  };
  const footer = [el('button', { class: 'btn ghost', onclick: closeModal }, 'Huỷ')];
  if (row) {
    // xoá CẢ NGÀY: bỏ dòng công + các lượt quẹt của ngày (không thì bấm "Tính lại" sẽ dựng lại từ lượt quẹt)
    const del = el('button', { class: 'btn ghost', style: 'color:#c0392b' }, '🗑 Xoá cả ngày');
    del.onclick = async () => {
      if (!confirm('XOÁ hẳn giờ chấm CẢ NGÀY ' + (row.work_date || '').split('-').reverse().join('/') + ' của người này (cả các lượt quẹt)?\nDùng khi chấm nhầm / nghịch. Không hoàn tác.')) return;
      try {
        if (punches.some((x) => x.date === row.work_date)) await api('/admin/attendance/clear', { method: 'POST', body: { employee_ids: [employeeId], from: row.work_date, to: row.work_date, raw: true } });
        else await api('/admin/attendance/' + row.id, { method: 'DELETE' });
        toast('Đã xoá giờ chấm cả ngày', 'ok'); closeModal(); reload();
      } catch (e) { toast(e.message, 'err'); }
    };
    footer.push(del);
  }
  footer.push(save);
  openModal(row ? 'Sửa giờ chấm' : 'Thêm giờ chấm', body, footer);
}

/* ---------- SỬA GIỜ CHẤM CÔNG (menu riêng, bố cục như Wise Eye) ----------
 * Trái: cây phòng ban · Giữa: danh sách nhân viên · Dưới: các LƯỢT CHẤM của NV đang chọn theo ngày, thanh Thêm / Sửa / Xoá.
 * Trên cùng: Thêm giờ hàng loạt · Xoá dữ liệu chấm công. Mọi thay đổi tự tính lại công ngày đó theo ca. */
const _ft = { dept: '', empId: null, q: '', from: null, to: null, sel: null };
async function pageFixTime() {
  setMain(head('Thêm / sửa / xóa giờ chấm'), loading());
  if (!DEPARTMENTS.length) { try { DEPARTMENTS = (await api('/admin/departments')).rows || []; } catch {} }
  let emps;
  try { emps = ((await api('/admin/employees')).rows || []).filter((e) => e.active !== 0 && e.role !== 'admin'); }
  catch (e) { return setMain(head('Thêm / sửa / xóa giờ chấm'), el('div', { class: 'empty' }, e.message)); }
  const today = todayVN();
  if (!_ft.from) _ft.from = _ft.to = today;
  const fmtD = (d) => d.slice(8) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4);
  const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const WDS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const wdOf = (d) => WDS[new Date(d + 'T12:00:00Z').getUTCDay()];

  // ----- cây phòng ban (gồm bộ phận con) -----
  const NONE = '\u0000none';
  const kids = new Map();
  for (const d of DEPARTMENTS) { const k = d.parent_id || 0; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(d); }
  const namesUnder = (d) => [d.name, ...(kids.get(d.id) || []).flatMap(namesUnder)];
  const cntBy = new Map(); for (const e of emps) { const k = e.department || NONE; cntBy.set(k, (cntBy.get(k) || 0) + 1); }
  const groups = new Map([['', null]]);
  const tree = el('div', { class: 'ft-tree' });
  const treeItem = (key, label, depth, n) => {
    const b = el('button', { class: 'ft-node' + (_ft.dept === key ? ' on' : ''), style: `padding-left:${10 + depth * 14}px` }, el('span', {}, label), el('small', {}, String(n)));
    b.onclick = () => { _ft.dept = key; tree.querySelectorAll('.ft-node').forEach((x) => x.classList.toggle('on', x === b)); drawEmps(); };
    tree.append(b); return b;
  };
  treeItem('', '🏢 Tất cả nhân viên', 0, emps.length);
  const tItems = [];
  for (const d of deptOrdered()) { const names = namesUnder(d); groups.set('d' + d.id, new Set(names)); tItems.push({ key: d.name, depth: d.depth, el: treeItem('d' + d.id, d.name, d.depth + 1, names.reduce((a, x) => a + (cntBy.get(x) || 0), 0)) }); }
  collapseTree(tItems, [(DEPARTMENTS.find((x) => 'd' + x.id === _ft.dept) || {}).name]);
  const known = new Set(DEPARTMENTS.map((d) => d.name));
  for (const k of [...cntBy.keys()].filter((k) => k !== NONE && !known.has(k))) { groups.set('o' + k, new Set([k])); treeItem('o' + k, k, 1, cntBy.get(k)); }
  if (cntBy.has(NONE)) { groups.set('none', new Set([NONE])); treeItem('none', 'Chưa có phòng ban', 1, cntBy.get(NONE)); }

  // ----- danh sách nhân viên -----
  const q = el('input', { placeholder: 'Tìm tên / mã nhân viên', value: _ft.q, style: 'margin:0' });
  const empTb = el('tbody');
  const empTbl = el('table', { class: 'data ft-emps' }, el('thead', {}, el('tr', {}, el('th', {}, 'Mã NV'), el('th', {}, 'Số ID máy'), el('th', {}, 'Tên nhân viên'), el('th', {}, 'Bộ phận'))), empTb);
  const empTotal = el('span', { class: 'muted' });
  const drawEmps = () => {
    const s = q.value.trim().toLowerCase(); _ft.q = q.value;
    const g = groups.get(_ft.dept);
    const list = emps.filter((e) => (!g || g.has(e.department || NONE)) && (!s || (e.full_name || '').toLowerCase().includes(s) || String(e.code || '').toLowerCase().includes(s) || String(e.device_pin || '').toLowerCase().includes(s)));
    empTb.replaceChildren();
    for (const e of list) {
      const tr = el('tr', { class: e.id === _ft.empId ? 'sel' : '' }, el('td', {}, e.code || ''), el('td', {}, e.device_pin || '—'), el('td', {}, el('b', {}, e.full_name)), el('td', {}, e.department || '—'));
      tr.onclick = () => { _ft.empId = e.id; _ft.sel = null; empTb.querySelectorAll('tr').forEach((x) => x.classList.toggle('sel', x === tr)); loadPunches(); };
      empTb.append(tr);
    }
    if (!list.length) empTb.append(el('tr', {}, el('td', { colspan: 4 }, el('div', { class: 'empty' }, 'Không có nhân viên.'))));
    empTotal.textContent = `Tổng: ${list.length}`;
  };
  q.oninput = drawEmps;

  // ----- lượt chấm của NV đang chọn -----
  const fromI = el('input', { type: 'date', value: _ft.from, style: 'width:auto;margin:0' });
  const toI = el('input', { type: 'date', value: _ft.to, style: 'width:auto;margin:0' });
  const prev = el('button', { class: 'btn ghost sm', title: 'Ngày trước' }, '◀'), next = el('button', { class: 'btn ghost sm', title: 'Ngày sau' }, '▶');
  const addB = el('button', { class: 'btn sm' }, '+ Thêm'), editB = el('button', { class: 'btn ghost sm' }, '✎ Sửa'), delB = el('button', { class: 'btn ghost sm', style: 'color:#c0392b' }, '✕ Xoá');
  const pTb = el('tbody');
  const pTbl = el('table', { class: 'data ft-punch' }, el('thead', {}, el('tr', {}, ...['Mã chấm công', 'Ngày', 'Thứ', 'Giờ chấm', 'Loại', 'Máy / nguồn'].map((h) => el('th', {}, h)))), pTb);
  const resBox = el('div', { class: 'ft-res' });
  const empOf = () => emps.find((e) => e.id === _ft.empId);
  let rows = [];
  const setDates = (f, t) => { _ft.from = f; _ft.to = t < f ? f : t; fromI.value = _ft.from; toI.value = _ft.to; loadPunches(); };
  fromI.onchange = () => setDates(fromI.value || today, toI.value < fromI.value ? fromI.value : toI.value);
  toI.onchange = () => setDates(fromI.value, toI.value || fromI.value);
  prev.onclick = () => setDates(addDays(_ft.from, -1), _ft.from === _ft.to ? addDays(_ft.from, -1) : addDays(_ft.to, -1));
  next.onclick = () => setDates(addDays(_ft.from, 1), _ft.from === _ft.to ? addDays(_ft.from, 1) : addDays(_ft.to, 1));
  const loadPunches = async () => {
    const e = empOf();
    pTb.replaceChildren(); resBox.replaceChildren();
    if (!e) { pTb.append(el('tr', {}, el('td', { colspan: 6 }, el('div', { class: 'empty' }, 'Chọn 1 nhân viên ở danh sách bên trên.')))); return; }
    pTb.append(el('tr', {}, el('td', { colspan: 6 }, loading())));
    let d, g;
    try { [d, g] = await Promise.all([api(`/admin/attendance/punches?employee_id=${e.id}&from=${_ft.from}&to=${_ft.to}`), api(`/admin/attendance/grid?mode=detail&ids=${e.id}&from=${_ft.from}&to=${_ft.to}`)]); }
    catch (err) { pTb.replaceChildren(el('tr', {}, el('td', { colspan: 6 }, el('div', { class: 'empty' }, err.message)))); return; }
    rows = d.rows || [];
    pTb.replaceChildren();
    for (const p of rows) {
      const tr = el('tr', { class: p.id === _ft.sel ? 'sel' : '' },
        el('td', {}, e.device_pin || e.code), el('td', {}, fmtD(p.date)), el('td', {}, wdOf(p.date)), el('td', {}, el('b', {}, p.time)),
        el('td', {}, p.kind ? el('span', { class: 'pill' + (p.kind === 'Ra' ? ' muted' : '') }, p.kind) : el('span', { class: 'muted' }, 'theo máy')),
        el('td', {}, p.manual ? el('span', { style: 'color:#e67e22;font-weight:600' }, '✎ Thêm tay') : p.source));
      tr.onclick = () => { _ft.sel = p.id; pTb.querySelectorAll('tr').forEach((x) => x.classList.toggle('sel', x === tr)); };
      tr.ondblclick = () => { _ft.sel = p.id; editPunch(); };
      pTb.append(tr);
    }
    if (!rows.length) pTb.append(el('tr', {}, el('td', { colspan: 6 }, el('div', { class: 'empty' }, `${e.full_name} chưa có lượt chấm ${_ft.from === _ft.to ? 'ngày ' + fmtD(_ft.from) : 'trong khoảng này'}. Bấm "+ Thêm".`))));
    // kết quả tính công của các ngày đang xem (sau khi thêm / sửa / xoá tự cập nhật)
    const res = (g.rows || []).filter((r) => r.in || r.leave);
    if (res.length) resBox.append(el('div', { class: 'map-hint', style: 'margin:0 0 4px' }, 'Kết quả tính công:'),
      ...res.map((r) => el('div', { class: 'ft-res-row' }, el('b', {}, `${r.date.slice(8)}/${r.date.slice(5, 7)} ${r.wd}`), r.shift ? el('span', { class: 'pill' }, r.shift) : '',
        r.in ? `Vào ${r.in} · Ra ${r.out || '—'}` : '', r.leave ? el('span', { class: 'pill warn' }, r.leave) : '',
        r.late ? el('span', { style: 'color:#c0392b' }, `trễ ${r.late}'`) : '', r.early ? el('span', { style: 'color:#c0392b' }, `sớm ${r.early}'`) : '',
        r.otRaw ? el('span', { style: 'color:#0a7', title: `Làm thêm thực tế ${r.otRaw}' · ${r.otReg == null ? 'chưa đăng ký' : `đăng ký ${r.otReg}'`}` }, `TC ${r.ot}'`, el('span', { class: 'muted' }, ` (thực tế ${r.otRaw}')`)) : r.ot ? el('span', { style: 'color:#0a7' }, `TC ${r.ot}'`) : '', el('b', {}, `${r.cong ?? 0} công`), el('span', { class: 'muted' }, r.status || ''))));
  };

  // Thêm (như Wise Eye: tích Ngày giờ vào / Ngày giờ ra)
  addB.onclick = () => {
    const e = empOf(); if (!e) return toast('Chọn 1 nhân viên trước', 'err');
    const ciChk = el('input', { type: 'checkbox', checked: '', style: 'width:auto' }), coChk = el('input', { type: 'checkbox', style: 'width:auto' });
    const ciD = el('input', { type: 'date', value: _ft.from, style: 'margin:0' }), coD = el('input', { type: 'date', value: _ft.from, style: 'margin:0' });
    const ciT = time24('ft-in', '07:30'), coT = time24('ft-out', '17:00');
    for (const t of [ciT, coT]) { t.style.width = '96px'; t.style.margin = '0'; }
    const line = (chk, label, dI, tI) => el('div', { class: 'ft-addrow' }, el('label', { class: 'lv-chk' }, chk, el('b', {}, label)), dI, tI);
    const ok = el('button', { class: 'btn' }, 'Đồng ý');
    ok.onclick = async () => {
      if (!ciChk.checked && !coChk.checked) return toast('Tích "Ngày giờ vào" và/hoặc "Ngày giờ ra"', 'err');
      try {
        if (ciChk.checked) await api('/admin/attendance/punches', { method: 'POST', body: { employee_ids: [e.id], date: ciD.value, in: ciT.value } });
        if (coChk.checked) await api('/admin/attendance/punches', { method: 'POST', body: { employee_ids: [e.id], date: coD.value, out: coT.value, out_date: coD.value } });
        toast('Đã thêm giờ', 'ok'); closeModal(); loadPunches();
      } catch (err) { toast(err.message, 'err'); }
    };
    openModal('Thêm giờ', [
      el('div', { class: 'two-col' }, field('Mã chấm công', el('input', { value: e.device_pin || e.code, disabled: '' })), field('Tên nhân viên', el('input', { value: e.full_name, disabled: '' }))),
      line(ciChk, 'Ngày giờ vào', ciD, ciT), line(coChk, 'Ngày giờ ra', coD, coT),
      el('div', { class: 'map-hint' }, 'Thêm thành lượt chấm (như quẹt máy), công ngày đó tự tính lại theo ca. Ra sáng hôm sau thì chọn ngày ra là hôm sau.'),
    ], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Huỷ bỏ'), ok]);
  };
  // Sửa lượt đang chọn
  const editPunch = () => {
    const p = rows.find((x) => x.id === _ft.sel); if (!p) return toast('Bấm chọn 1 dòng giờ chấm ở bảng dưới trước', 'err');
    const dI = el('input', { type: 'date', value: p.date, style: 'margin:0' }), tI = time24('ft-edit', p.time);
    const ok = el('button', { class: 'btn' }, 'Lưu');
    ok.onclick = async () => {
      try { await api('/admin/attendance/punches/' + p.id, { method: 'PUT', body: { date: dI.value, time: tI.value } }); toast('Đã sửa giờ chấm', 'ok'); closeModal(); loadPunches(); }
      catch (err) { toast(err.message, 'err'); }
    };
    openModal('Sửa giờ chấm', [el('div', { class: 'two-col' }, field('Ngày', dI), field('Giờ', tI)),
      el('div', { class: 'map-hint' }, `Đang sửa lượt ${p.time} ngày ${fmtD(p.date)} (${p.manual ? 'thêm tay' : p.source}).`)],
    [el('button', { class: 'btn ghost', onclick: closeModal }, 'Huỷ'), ok]);
  };
  editB.onclick = editPunch;
  delB.onclick = async () => {
    const p = rows.find((x) => x.id === _ft.sel); if (!p) return toast('Bấm chọn 1 dòng giờ chấm ở bảng dưới trước', 'err');
    if (!confirm(`Xoá giờ chấm ${p.time} ngày ${fmtD(p.date)} của ${empOf()?.full_name || ''}?`)) return;
    try { await api('/admin/attendance/punches/' + p.id, { method: 'DELETE' }); _ft.sel = null; toast('Đã xoá giờ chấm', 'ok'); loadPunches(); } catch (err) { toast(err.message, 'err'); }
  };

  // ----- thanh công cụ trên cùng (như ribbon Wise Eye) -----
  const scopeEmps = () => { const g = groups.get(_ft.dept); return emps.filter((e) => !g || g.has(e.department || NONE)); };
  const bulkBtn = el('button', { class: 'btn ghost' }, '📅 Thêm giờ hàng loạt');
  bulkBtn.onclick = () => bulkPunchModal(scopeEmps(), _ft.from, loadPunches);
  const clearBtn = el('button', { class: 'btn ghost', style: 'color:#c0392b' }, '🗑 Xoá dữ liệu chấm công');
  clearBtn.onclick = () => clearAttModal(scopeEmps(), _ft.from, _ft.to, loadPunches);

  const empPanel = el('div', { class: 'panel ft-panel' },
    el('div', { class: 'ft-bar' }, q, empTotal),
    el('div', { class: 'ft-scroll' }, empTbl));
  const punchPanel = el('div', { class: 'panel ft-panel' },
    el('div', { class: 'ft-bar ft-tools' }, addB, editB, delB, el('span', { class: 'ft-sep' }),
      el('span', { class: 'muted' }, 'Chọn ngày'), prev, fromI, el('span', { class: 'muted' }, 'đến'), toI, next),
    el('div', { class: 'tbl-scroll' }, pTbl), resBox);
  setMain(head('Thêm / sửa / xóa giờ chấm', bulkBtn, clearBtn),
    el('div', { class: 'map-hint', style: 'margin:-6px 0 10px' }, 'Chọn phòng ban → bấm 1 nhân viên → các lượt chấm hiện ở bảng dưới. "+ Thêm" giờ vào / ra, bấm chọn 1 dòng rồi "✎ Sửa" (hoặc bấm đúp) / "✕ Xoá". Công ngày đó tự tính lại theo ca và quy tắc ghép vào–ra.'),
    el('div', { class: 'ft-wrap' }, el('div', { class: 'panel ft-left' }, tree), el('div', { class: 'ft-right' }, empPanel, punchPanel)));
  drawEmps(); loadPunches();
}

// Khung cài hạn mức CÔNG ẢO (dùng ở Cài đặt và trang "Công ảo / lương ảo")
function auditPanelEl(s) {
  const lvRow = (label, ...ctl) => {
    const hint = typeof ctl[ctl.length - 1] === 'string' && ctl[ctl.length - 1].length > 24 ? ctl.pop() : '';
    return el('div', { class: 'lv-row' }, el('span', { class: 'lv-lab' }, label),
      el('div', {}, el('div', { class: 'lv-ctl' }, ...ctl.map((c) => (typeof c === 'string' ? el('span', {}, c) : c))), hint ? el('div', { class: 'map-hint', style: 'margin-top:3px' }, hint) : ''));
  };
  const num = (v, step = '0.5') => el('input', { type: 'number', min: 0, step, value: v });
  const auWeek = num(s.audit_ot_week_h ?? 0), auMonth = num(s.audit_ot_month_h ?? 0), auYear = num(s.audit_ot_year_h ?? 0);
  // Ô tích "Áp cho: Ảo 1 / Ảo 2 / Ảo 3" — hạn mức tuần / tháng / năm và khống chế giờ chấm chọn riêng từng mức
  const lvPick = (csv, def) => {
    const on = new Set(String(csv ?? def).split(',').map((x) => x.trim()));
    const cbs = [1, 2, 3].map((i) => el('input', { type: 'checkbox', ...(on.has(String(i)) ? { checked: '' } : {}) }));
    return { node: el('span', { class: 'lv-pick' }, el('span', {}, 'Áp cho:'), ...cbs.map((c, i) => el('label', {}, c, `Ảo ${i + 1}`))), val: () => cbs.map((c, i) => (c.checked ? i + 1 : 0)).filter(Boolean).join(',') };
  };
  const pkWeek = lvPick(s.audit_week_lv, '1,2,3'), pkMonth = lvPick(s.audit_month_lv, '1,2,3'), pkYear = lvPick(s.audit_year_lv, '1,2,3'), pkClamp = lvPick(s.audit_clamp_lv, '');
  const clIn = num(s.audit_clamp_in_min ?? 14, '1'), clOut = num(s.audit_clamp_out_min ?? 14, '1');
  // Giờ trưa & đi trễ kiểu "công khách K" của HR-ERP (khách chấm 4 lần / ngày) — mặc định không mức nào = TẮT
  const pkK = lvPick(s.audit_k_lv, '');
  const kEarly = num(s.audit_k_early_min ?? 15, '1'), kLate = num(s.audit_k_late_max ?? 60, '1'), kOut = num(s.audit_k_out_gap ?? 15, '1'), kIn = num(s.audit_k_in_gap ?? 5, '1');
  // chủ nhật (ngày nghỉ hằng tuần) đi làm tối đa / tháng — mỗi mức ảo 1 ô, để trống = không giới hạn
  const sunI = [1, 2, 3].map((l) => el('input', { type: 'number', min: 0, max: 6, step: 1, placeholder: '—', value: s['audit_sun_l' + l] ?? '' }));
  const sunBox = el('span', { class: 'lv-pick' }, ...sunI.map((x, i) => el('label', {}, `Ảo ${i + 1}`, x)));
  // TỔNG giờ làm (công + TC) tối đa / ngày · / tuần — mỗi mức ảo một ô giờ, để trống = không giới hạn
  const totDayI = [1, 2, 3].map((l) => el('input', { type: 'number', min: 0, max: 24, step: '0.5', placeholder: '—', value: s['audit_totday_l' + l] ?? '' }));
  const totWeekI = [1, 2, 3].map((l) => el('input', { type: 'number', min: 0, max: 168, step: '0.5', placeholder: '—', value: s['audit_totweek_l' + l] ?? '' }));
  const totDayBox = el('span', { class: 'lv-pick' }, ...totDayI.map((x, i) => el('label', {}, `Ảo ${i + 1}`, x)));
  const totWeekBox = el('span', { class: 'lv-pick' }, ...totWeekI.map((x, i) => el('label', {}, `Ảo ${i + 1}`, x)));
  // số ngày làm LIÊN TỤC tối đa — mỗi mức ảo một ô, để trống = không giới hạn
  const streakI = [1, 2, 3].map((l) => el('input', { type: 'number', min: 1, max: 31, step: 1, placeholder: '—', value: s['audit_streak_l' + l] ?? '' }));
  const streakBox = el('span', { class: 'lv-pick' }, ...streakI.map((x, i) => el('label', {}, `Ảo ${i + 1}`, x)));
  const auWk = el('input', { type: 'checkbox', ...(s.audit_incl_weekend !== '0' ? { checked: '' } : {}) });
  const auHol = el('input', { type: 'checkbox', ...(s.audit_incl_holiday !== '0' ? { checked: '' } : {}) });
  // Chú thích đổi THEO Ô TÍCH (chỉ nói trạng thái đang chọn) + ghi chú hạn mức tuần
  const wkName = String(s.weekend_days ?? '7').split(',').map((x) => ({ 1: 'thứ 2', 2: 'thứ 3', 3: 'thứ 4', 4: 'thứ 5', 5: 'thứ 6', 6: 'thứ 7', 7: 'chủ nhật' }[x.trim()])).filter(Boolean).join(', ') || 'cuối tuần';
  const wkHint = el('div', { class: 'map-hint', style: 'margin-top:2px' }), holHint = el('div', { class: 'map-hint', style: 'margin-top:2px' });
  const wkNote = el('span', { style: 'font-size:12.5px;color:var(--muted)' });
  const syncHints = () => {
    wkHint.textContent = auWk.checked ? `✔ Đang bật: tăng ca ngày ${wkName} được cộng vào hạn mức và cũng bị cắt.` : `✘ Đang tắt: tăng ca ngày ${wkName} giữ nguyên như thật, không cộng vào hạn mức.`;
    holHint.textContent = auHol.checked ? '✔ Đang bật: tăng ca ngày lễ được cộng vào hạn mức và cũng bị cắt.' : '✘ Đang tắt: tăng ca ngày lễ giữ nguyên như thật, không cộng vào hạn mức.';
    wkNote.textContent = auWk.checked ? `(thứ 2 → chủ nhật, gồm cả tăng ca ngày ${wkName})` : `(thứ 2 → chủ nhật, KHÔNG tính tăng ca ngày ${wkName})`;
  };
  auWk.onchange = syncHints; auHol.onchange = syncHints; syncHints();
  const auMethod = el('select', { style: 'width:auto;max-width:100%' }, el('option', { value: 'ratio' }, 'Chia đều theo tỷ lệ'), el('option', { value: 'days' }, 'Gỡ bớt nguyên ngày'));
  auMethod.value = s.audit_method === 'days' ? 'days' : 'ratio';
  const auBlock = el('select', {}, ...[[0, 'Không làm tròn (từng phút)'], [15, 'Khối 15 phút'], [30, 'Khối 30 phút'], [60, 'Khối 1 giờ']].map(([v, t]) => el('option', { value: v }, t)));
  auBlock.value = String(s.audit_block ?? 15);
  const save = el('button', { class: 'btn' }, 'Lưu hạn mức công ảo');
  save.onclick = async () => {
    try {
      if (String(auYear.value) !== String(s.audit_ot_year_h ?? 0)) {
        let locked = [];
        try { locked = (await api('/admin/audit-locks')).locked || []; } catch {}
        if (locked.length && !confirm(`Đang có ${locked.length} tháng đã chốt công ảo. Đổi hạn mức NĂM chỉ áp cho các tháng CHƯA chốt (tháng đã chốt giữ nguyên số cũ, phần năm còn lại tính tiếp từ số đã chốt).\nVẫn đổi?`)) return;
      }
      await api('/admin/settings', { method: 'PUT', body: { audit_ot_week_h: auWeek.value, audit_ot_month_h: auMonth.value, audit_ot_year_h: auYear.value,
        audit_incl_weekend: auWk.checked, audit_incl_holiday: auHol.checked, audit_method: auMethod.value, audit_block: auBlock.value,
        audit_week_lv: pkWeek.val(), audit_month_lv: pkMonth.val(), audit_year_lv: pkYear.val(),
        audit_sun_l1: sunI[0].value, audit_sun_l2: sunI[1].value, audit_sun_l3: sunI[2].value,
        audit_totday_l1: totDayI[0].value, audit_totday_l2: totDayI[1].value, audit_totday_l3: totDayI[2].value,
        audit_totweek_l1: totWeekI[0].value, audit_totweek_l2: totWeekI[1].value, audit_totweek_l3: totWeekI[2].value,
        audit_streak_l1: streakI[0].value, audit_streak_l2: streakI[1].value, audit_streak_l3: streakI[2].value,
        audit_clamp_lv: pkClamp.val(), audit_clamp_in_min: clIn.value, audit_clamp_out_min: clOut.value,
        audit_k_lv: pkK.val(), audit_k_early_min: kEarly.value, audit_k_late_max: kLate.value, audit_k_out_gap: kOut.value, audit_k_in_gap: kIn.value } });
      SETTINGS = await api('/admin/settings'); toast('Đã lưu hạn mức công ảo', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };
  return el('div', { class: 'panel', style: 'padding:20px;max-width:640px;margin-bottom:16px;border:1px dashed #f59e0b' },
    el('h3', { style: 'margin-top:0' }, '🎭 Công ảo / lương ảo (audit)'),
    el('div', { class: 'map-hint', style: 'margin:-4px 0 12px' }, 'Công ảo dùng để in bảng công / bảng lương nộp kiểm tra: tăng ca vượt hạn mức bị cắt bớt, giờ ra (hoặc giờ vào khi tăng ca trước ca) lùi lại cho khớp, ngày chỉ toàn tăng ca bị cắt hết thì coi như không đi làm. Công THẬT không đổi. Xem bằng thanh "Thật · Ảo 1 · Ảo 2 · Ảo 3" ở Tính công / Báo cáo / Lương. Hạn mức tuần / tháng / năm dưới đây áp cho mức nào thì tích mức đó (Ảo 1 / 2 / 3). Luật hiện hành: tối đa 4 giờ/ngày (50% giờ làm), 40 giờ/tháng, 200 giờ/năm (300 giờ với một số ngành). Để 0 = không giới hạn.'),
    el('div', { class: 'lv-form' },
      lvRow('Tăng ca tối đa mỗi ngày', (() => { const b = el('button', { class: 'btn ghost sm', type: 'button' }, '⏱️ Khai theo 3 mức →'); b.onclick = () => go('auditlimits'); return b; })(), 'Mỗi mức Ảo 1 / 2 / 3 một số phút riêng, đặt được theo từng NV, từng ngày.'),
      lvRow('Tăng ca tối đa mỗi tuần', auWeek, 'giờ', pkWeek.node, wkNote),
      lvRow('Tăng ca tối đa mỗi tháng', auMonth, 'giờ', pkMonth.node, '(theo kỳ lương ở Cài đặt › Lương)'),
      lvRow('Tăng ca tối đa mỗi năm', auYear, 'giờ', pkYear.node, '(cộng dồn từ kỳ lương tháng 1)'),
      lvRow('Tổng giờ làm tối đa / ngày', totDayBox, 'giờ', 'Giờ công + tăng ca của cả ngày. Mỗi mức một số (để trống = không giới hạn). Vượt thì cắt bớt tăng ca cho tổng không quá số này (giờ công thật giữ nguyên).'),
      lvRow('Tổng giờ làm tối đa / tuần', totWeekBox, 'giờ', 'Giờ công + tăng ca cả tuần (thứ 2 → chủ nhật). Mỗi mức một số (để trống = không giới hạn). Vượt thì cắt bớt tăng ca trong tuần.'),
      lvRow('Số ngày làm liên tục tối đa', streakBox, 'ngày', 'Mỗi mức một số (để trống = không giới hạn). Chuỗi ngày đi làm liền nhau dài hơn số này thì công ảo tự gỡ bớt ngày (coi như nghỉ, kể cả tăng ca ngày đó) để không chuỗi nào vượt — ưu tiên gỡ ngày ít giờ công, cố định theo từng nhân viên.'),
      lvRow(`Đi làm ${wkName} tối đa / tháng`, sunBox, 'ngày',
        `Mỗi mức một số ngày (để trống = không giới hạn). Tháng lương có nhiều ngày ${wkName} đi làm hơn thì các ngày thừa bị gỡ hẳn khỏi công ảo (như không đi làm, kể cả tăng ca ngày đó). Ngày được giữ chọn ngẫu nhiên nhưng cố định theo từng nhân viên. Ngày làm bù và ngày lễ không tính vào số này.`),
      lvRow('Khống chế giờ chấm ảo', pkClamp.node,
        'Ở mức được tích, giờ vào / ra ảo luôn nằm sát giờ ca theo 2 số phút dưới đây. Ngày chia ca sáng / chiều thì giờ ra giữa ca và giờ vào chiều cũng theo luật này. Giờ nằm ngoài khoảng được đổi thành một giờ ngẫu nhiên trong khoảng (xem lại vẫn ra đúng giờ đó); đi trễ / về sớm thật giữ nguyên; công và tăng ca không đổi. Không tích mức nào = tắt.'),
      lvRow('· Vào sớm tối đa', clIn, 'phút trước giờ vào ca'),
      lvRow('· Ra trễ tối đa', clOut, 'phút sau giờ tan ca', '(đã cộng tăng ca ảo của ngày đó)'),
      lvRow('Giờ trưa & đi trễ kiểu K', pkK.node,
        'Dành cho công ty chấm 4 lần / ngày (Đến – Ra trưa – Vào lại – Về) như khách dùng HR-ERP "công khách K". Ở mức được tích: giờ ĐẾN sớm hoặc trễ trong khoảng cho phép hiện thành 1–14 phút trước giờ vào ca (đi trễ được che thì trả đủ giờ công, phút trễ = 0); giờ RA / VÀO trưa hiện sát giờ nghỉ của ca (cần ca có "Nghỉ giữa ca bắt đầu lúc"). Số phút ngẫu nhiên cố định theo từng nhân viên + ngày. Không tích mức nào = TẮT, công ty khác không bị ảnh hưởng.'),
      lvRow('· Đến sớm từ', kEarly, 'phút → hiện 1–14 phút trước giờ vào ca', '(0 = không đổi giờ đến sớm)'),
      lvRow('· Đi trễ tối đa được che', kLate, 'phút', '(trễ quá số này giữ giờ thật; 0 = không che)'),
      lvRow('· Ra trưa muộn từ', kOut, 'phút sau giờ bắt đầu nghỉ → hiện 0–11 phút sau giờ nghỉ'),
      lvRow('· Vào lại sớm hơn', kIn, 'phút trước giờ hết nghỉ → hiện trong chừng đó phút cuối của giờ nghỉ'),
      lvRow('Cách cắt khi vượt', auMethod, 'Chia đều: mọi ngày có tăng ca đều giảm theo cùng tỷ lệ. Gỡ nguyên ngày: bỏ hẳn tăng ca của một số ngày (chọn ngẫu nhiên nhưng cố định, ngày thường trước, ngày nghỉ / lễ sau) như HR-ERP.'),
      lvRow('Làm tròn tăng ca ảo', auBlock),
      el('label', { class: 'lv-chk' }, auWk, el('div', {}, el('b', {}, `Cộng cả tăng ca ngày nghỉ hằng tuần (${wkName})`), wkHint)),
      el('label', { class: 'lv-chk' }, auHol, el('div', {}, el('b', {}, 'Cộng cả tăng ca ngày lễ'), holHint))),
    el('div', { style: 'margin-top:14px' }, save));
}

/* ---------- CHỐT KỲ công ảo: chốt / mở chốt từng tháng lương (xem theo năm) ---------- */
let _lockYear = null;   // năm đang xem ở khung chốt kỳ (null = năm hiện tại)
function lockPanelEl() {
  const box = el('div', {}, loading());
  const panel = el('div', { class: 'panel', style: 'padding:20px;max-width:760px;margin-bottom:16px' },
    el('h3', { style: 'margin-top:0' }, '🔒 Chốt kỳ công ảo'),
    el('div', { class: 'map-hint', style: 'margin:-4px 0 12px' }, 'Chốt 1 tháng lương = giữ nguyên công ảo / lương ảo CẢ 3 MỨC của tháng đó đúng như lúc chốt: xem lại, in lại, tài khoản kiểm tra xem đều ra cùng số — kể cả khi sau này sửa giờ, tính lại công hay đổi hạn mức. Hạn mức NĂM của các tháng sau tính tiếp từ số đã chốt. Muốn tính lại tháng đó: bấm "Mở chốt".'),
    box);
  const dm = (d) => d.slice(8) + '/' + d.slice(5, 7);
  const draw = async () => {
    let d;
    try { d = await api('/admin/audit-locks' + (_lockYear ? '?year=' + _lockYear : '')); } catch (e) { box.replaceChildren(el('div', { class: 'empty' }, e.message)); return; }
    _lockYear = d.year;
    const tb = el('tbody');
    for (const m of d.rows) {
      const L = m.lock, lbl = `${m.month.slice(5)}/${m.month.slice(0, 4)}`;
      const st = L ? el('span', { class: 'pill ok' }, `🔒 Đã chốt ${L.locked_at.slice(8, 10)}/${L.locked_at.slice(5, 7)} ${L.locked_at.slice(11, 16)}` + (L.locked_by ? ' · ' + L.locked_by : ''))
        : el('span', { class: 'pill ' + (m.ended || m.future ? 'muted' : 'warn') }, m.future ? 'Chưa tới' : m.ended ? 'Chưa chốt' : 'Đang trong kỳ');
      const btn = el('button', { class: 'btn sm' + (L ? ' ghost' : ''), ...(m.future && !L ? { disabled: '', style: 'opacity:.35' } : {}) }, L ? 'Mở chốt' : '🔒 Chốt');
      btn.onclick = async () => {
        const ask = L ? `Mở chốt công ảo tháng ${lbl}?\nCông ảo tháng này sẽ tính lại theo dữ liệu và hạn mức hiện tại (có thể khác bản đã in).`
          : `Chốt công ảo tháng ${lbl} (${dm(m.from)} → ${dm(m.to)})?\nTừ nay công ảo / lương ảo cả 3 mức của tháng này giữ nguyên như hiện tại.` + (m.ended ? '' : '\n\n⚠ Tháng này CHƯA KẾT THÚC — ngày công phát sinh sau khi chốt sẽ KHÔNG có trong công ảo.');
        if (!confirm(ask)) return;
        btn.disabled = true; btn.textContent = L ? 'Đang mở…' : 'Đang chốt…';
        try {
          if (L) { await api('/admin/audit-locks/' + m.month, { method: 'DELETE' }); toast('Đã mở chốt tháng ' + lbl, 'ok'); }
          else { const r = await api('/admin/audit-locks', { method: 'POST', body: { month: m.month } }); toast(`Đã chốt tháng ${lbl}: ${r.rows.toLocaleString('vi')} dòng công, ${r.people} nhân viên`, 'ok'); }
          draw();
        } catch (e) { toast(e.message, 'err'); btn.disabled = false; btn.textContent = L ? 'Mở chốt' : '🔒 Chốt'; }
      };
      tb.append(el('tr', {}, el('td', {}, el('b', {}, 'Tháng ' + lbl)), el('td', { class: 'muted' }, `${dm(m.from)} → ${dm(m.to)}`), el('td', {}, st), el('td', {}, btn)));
    }
    // nút chọn NĂM bên dưới: mỗi lần chỉ hiện 12 tháng của 1 năm (số trong ngoặc = số tháng đã chốt của năm đó)
    const yearBar = el('div', { class: 'lock-years' }, el('span', { class: 'muted' }, 'Năm:'), ...d.years.map((y) => {
      const n = d.locked.filter((k) => +k.slice(0, 4) === y).length;
      const b = el('button', { type: 'button', class: 'btn sm' + (y === d.year ? '' : ' ghost') }, String(y) + (n ? ` (🔒${n})` : ''));
      b.onclick = () => { if (y === _lockYear) return; _lockYear = y; draw(); };
      return b;
    }));
    box.replaceChildren(el('div', { class: 'tbl-scroll' }, el('table', { class: 'data' }, el('thead', {}, el('tr', {}, ...['Tháng lương', 'Kỳ', 'Trạng thái', ''].map((h) => el('th', {}, h)))), tb)), yearBar);
  };
  draw();
  return panel;
}
// Dòng báo "tháng đã chốt" khi đang xem công ảo (Tính công / Báo cáo)
const lockNote = (locks) => (locks && locks.length && _virt ? el('div', { class: 'pill ok', style: 'display:inline-block;margin:0 0 8px' },
  `🔒 Đã chốt công ảo: tháng ${locks.map((m) => m.slice(5) + '/' + m.slice(0, 4)).join(', ')} — số ảo giữ nguyên như lúc chốt`) : null);

/* ---------- TRANG "CÔNG ẢO / LƯƠNG ẢO" (menu riêng, chỉ hiện khi tài khoản tổng bật) ---------- */
async function pageAudit() {
  setMain(head('🎭 Công ảo / lương ảo'), loading());
  try { SETTINGS = await api('/admin/settings'); } catch {}
  const card = (ic, title, desc, key) => {
    const b = el('button', { class: 'au-card', type: 'button' }, el('div', { class: 'au-ic' }, ic), el('div', {}, el('b', {}, title), el('div', { class: 'map-hint', style: 'margin:3px 0 0' }, desc)));
    b.onclick = () => { if (key !== 'auditlimits' && !_virt) _virt = 1; if (key === 'salary') _salTab = 'payroll'; go(key); };
    return b;
  };
  const auPanel = hasPerm('settings') ? auditPanelEl(SETTINGS) : null;
  const lkPanel = lockPanelEl();
  setMain(head('🎭 Công ảo / lương ảo'),
    el('div', { class: 'map-hint', style: 'margin:-6px 0 12px;max-width:820px' }, 'Có 3 mức công ảo (Ảo 1 / Ảo 2 / Ảo 3), mỗi mức có tăng ca tối đa / ngày riêng — khai ở "⏱️ Tăng ca tối đa". Trên Tính công / Báo cáo / Lương có thanh vàng "Thật · Ảo 1 · Ảo 2 · Ảo 3" để chuyển. Công thật không bao giờ bị thay đổi.'),
    el('div', { class: 'au-cards' },
      card('⏱️', 'Tăng ca tối đa / ngày (3 mức)', 'Khai số phút tăng ca tối đa cho Ảo 1 / 2 / 3 theo từng NV, từng ngày; đặt mặc định công ty', 'auditlimits'),
      card('🧮', 'Bảng công ảo', 'Tính công theo ngày: giờ vào / ra, tăng ca ảo (chỉ xem)', 'editatt'),
      card('📅', 'Báo cáo công ảo', 'Mọi báo cáo theo Ảo 1 / 2 / 3 + 2 mẫu so sánh 3 mức (nhóm "Công ảo 3 mức")', 'report'),
      hasPerm('salary') ? card('💰', 'Bảng lương ảo', 'Bảng lương / phiếu lương với tiền tăng ca theo công ảo', 'salary') : null),
    lkPanel,
    auPanel || el('div', { class: 'map-hint' }, 'Hạn mức tăng ca do người có quyền Cài đặt chỉnh.'));
  foldSettings($('#main'), { only: [lkPanel, auPanel] });   // khung chốt kỳ + khung hạn mức: mặc định gọn, bấm ▶ để mở
}

/* ---------- TĂNG CA TỐI ĐA / NGÀY — 3 MỨC CÔNG ẢO (như "TGLT tối đa / tối đa 2 / tối đa 3" của HR-ERP) ----------
 * Trái: cây phòng ban · Phải: lưới NV × ngày, mỗi ô = số phút tăng ca tối đa của mức đó.
 * Ô đậm = đã khai riêng cho ngày đó; ô xám = đang theo mức riêng NV / mặc định công ty; "—" = không giới hạn.
 * Sửa: bấm ô gõ số (Enter lưu, để trống = theo mặc định) · dán cả khối số copy từ Excel · áp nhanh nhiều NV × nhiều ngày. */
const _al = { dept: '', q: '', from: null, to: null, tab: 'all', picked: new Set(), bulk: null };   // bulk: ô "Áp nhanh" (giữ khi lưới tải lại)
async function pageAuditLimits() {
  const T = '⏱️ Tăng ca tối đa (công ảo)';
  setMain(head(T), loading());
  if (!DEPARTMENTS.length) { try { DEPARTMENTS = (await api('/admin/departments')).rows || []; } catch {} }
  const today = todayVN();
  if (!_al.from) _al.from = _al.to = today;
  const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const nDays = (f, t) => Math.round((Date.parse(t) - Date.parse(f)) / 86400000) + 1;
  const WDS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const wdOf = (d) => new Date(d + 'T12:00:00Z').getUTCDay();
  const LV = ['', 'Mức 1', 'Mức 2', 'Mức 3'];
  let data;
  try { data = await api(`/admin/audit-limits?from=${_al.from}&to=${_al.to}`); }
  catch (e) { return setMain(head(T), el('div', { class: 'empty' }, e.message)); }
  let cell = new Map();
  const index = () => { cell = new Map(); for (const [e, d, l, m] of data.cells) cell.set(`${e}|${d}|${l}`, m); };
  index();
  // giá trị đang áp cho 1 ô + nguồn: day = khai riêng ngày · emp = mức riêng NV · def = mặc định công ty
  const eff = (eid, d, lv) => {
    const k = `${eid}|${d}|${lv}`;
    if (cell.has(k)) return { v: cell.get(k), src: d === '*' ? 'emp' : 'day' };
    if (d !== '*' && cell.has(`${eid}|*|${lv}`)) return { v: cell.get(`${eid}|*|${lv}`), src: 'emp' };
    const dv = data.defaults[lv];
    return { v: dv == null ? null : dv, src: 'def' };
  };
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
    const b = el('button', { class: 'ft-node' + (_al.dept === key ? ' on' : ''), style: `padding-left:${10 + depth * 14}px` }, el('span', {}, label), el('small', {}, String(n)));
    b.onclick = () => { _al.dept = key; tree.querySelectorAll('.ft-node').forEach((x) => x.classList.toggle('on', x === b)); draw(); };
    tree.append(b); return b;
  };
  treeItem('', '🏢 Tất cả nhân viên', 0, emps.length);
  const tItems = [];
  for (const d of deptOrdered()) { const names = namesUnder(d); const n = names.reduce((a, x) => a + (cntBy.get(x) || 0), 0); if (!n) continue; groups.set('d' + d.id, new Set(names)); tItems.push({ key: d.name, depth: d.depth, el: treeItem('d' + d.id, d.name, d.depth + 1, n) }); }
  collapseTree(tItems, [(DEPARTMENTS.find((x) => 'd' + x.id === _al.dept) || {}).name]);
  const known = new Set(DEPARTMENTS.map((d) => d.name));
  for (const k of [...cntBy.keys()].filter((k) => k !== NONE && !known.has(k))) { groups.set('o' + k, new Set([k])); treeItem('o' + k, k, 1, cntBy.get(k)); }
  if (cntBy.has(NONE)) { groups.set('none', new Set([NONE])); treeItem('none', 'Chưa có phòng ban', 1, cntBy.get(NONE)); }

  // ----- mặc định công ty -----
  const defI = [0, 1, 2, 3].map((lv) => (lv ? el('input', { type: 'number', min: 0, max: 1440, step: 5, placeholder: 'không giới hạn', value: data.defaults[lv] ?? '', style: 'width:120px;margin:0' }) : null));
  const saveDef = el('button', { class: 'btn sm' }, 'Lưu mặc định');
  saveDef.onclick = async () => {
    try {
      const r = await api('/admin/audit-limits/defaults', { method: 'PUT', body: { 1: defI[1].value, 2: defI[2].value, 3: defI[3].value } });
      data.defaults = r.defaults; toast('Đã lưu mặc định', 'ok'); draw(); defFold.refresh();
    } catch (e) { toast(e.message, 'err'); }
  };
  const defPanel = el('div', { class: 'panel al-def' },
    ...[1, 2, 3].map((lv) => el('label', {}, LV[lv], defI[lv])),
    saveDef,
    el('div', { class: 'map-hint', style: 'flex-basis:100%;margin:0' }, 'NV / ngày nào chưa khai thì lấy mức riêng của NV, chưa có nữa thì lấy mặc định này. Để trống = không giới hạn; 0 = không cho tăng ca. Công ảo tính ngay lúc xem, không cần bấm Tính lại. Tài khoản kiểm tra xem mức nào: chọn ở Nhân viên › sửa tài khoản › "Tài khoản kiểm tra".'));

  // ----- khoảng ngày + mức đang xem -----
  const fromI = el('input', { type: 'date', value: _al.from, style: 'width:auto;margin:0' });
  const toI = el('input', { type: 'date', value: _al.to, style: 'width:auto;margin:0' });
  const prev = el('button', { class: 'btn ghost sm', title: 'Lùi' }, '◀'), next = el('button', { class: 'btn ghost sm', title: 'Tới' }, '▶');
  const monthB = el('button', { class: 'btn ghost sm' }, 'Cả tháng');
  // fromBulk: đổi ngày ở "Áp nhanh" → lưới chuyển theo để thấy chỗ sắp áp (lưới tối đa 31 ngày; khoảng áp vẫn giữ đủ)
  const setRange = async (f, t, fromBulk = false) => {
    if (t < f) t = f;
    if (fromBulk && _al.tab === 'all' && nDays(f, t) > 7) _al.tab = String(bLv.value);   // cả 3 mức chỉ xem được 7 ngày → xem đúng mức đang áp
    const maxN = _al.tab === 'all' ? 7 : 31;
    if (nDays(f, t) > maxN) {
      t = addDays(f, maxN - 1);
      if (fromBulk) toast(`Lưới hiện ${maxN} ngày đầu; "Áp nhanh" vẫn áp đủ khoảng đã chọn`, 'ok');
      else toast(_al.tab === 'all' ? 'Xem cả 3 mức: tối đa 7 ngày (chọn 1 mức để xem cả tháng)' : 'Xem tối đa 31 ngày', 'err');
    }
    if (!fromBulk && _al.bulk) { _al.bulk.from = f; _al.bulk.to = t; }   // đổi ngày xem ở trên → khoảng áp nhanh theo
    _al.from = f; _al.to = t; pageAuditLimits();
  };
  fromI.onchange = () => setRange(fromI.value || today, toI.value < fromI.value ? fromI.value : toI.value);
  toI.onchange = () => setRange(fromI.value, toI.value || fromI.value);
  const span = nDays(_al.from, _al.to);
  prev.onclick = () => setRange(addDays(_al.from, -span), addDays(_al.to, -span));
  next.onclick = () => setRange(addDays(_al.from, span), addDays(_al.to, span));
  monthB.onclick = () => { if (_al.tab === 'all') _al.tab = '1'; const m = _al.from.slice(0, 7); const ds = monthDaysArr(m); setRange(ds[0], ds[ds.length - 1]); };
  const tabs = el('div', { class: 'al-tabs' }, ...[['all', 'Cả 3 mức'], ['1', LV[1]], ['2', LV[2]], ['3', LV[3]]].map(([k, t]) => {
    const b = el('button', { class: 'btn sm' + (_al.tab === k ? '' : ' ghost') }, t);
    b.onclick = () => { _al.tab = k; if (k === 'all' && span > 7) setRange(_al.from, addDays(_al.from, 6)); else pageAuditLimits(); };
    return b;
  }));
  const q = el('input', { placeholder: 'Tìm tên / mã NV', value: _al.q, style: 'margin:0;width:180px' });
  q.oninput = () => { _al.q = q.value; draw(); };

  // ----- áp nhanh -----
  const bLv = el('select', { style: 'width:auto;margin:0' }, ...[1, 2, 3].map((lv) => el('option', { value: lv }, LV[lv])));
  const B = _al.bulk || { lv: _al.tab !== 'all' ? _al.tab : '1', min: '', from: _al.from, to: _al.to, sun: true, sat: false };
  bLv.value = B.lv;
  const bMin = el('input', { type: 'number', min: 0, max: 1440, step: 5, placeholder: 'số phút', title: 'Để trống = xoá ô đã khai (về mặc định)', value: B.min, style: 'width:100px;margin:0' });
  const bFrom = el('input', { type: 'date', value: B.from, style: 'width:auto;margin:0' }), bTo = el('input', { type: 'date', value: B.to, style: 'width:auto;margin:0' });
  const bSun = el('input', { type: 'checkbox', style: 'width:auto;margin:0', ...(B.sun ? { checked: '' } : {}) }), bSat = el('input', { type: 'checkbox', style: 'width:auto;margin:0', ...(B.sat ? { checked: '' } : {}) });
  const saveBulk = () => { _al.bulk = { lv: bLv.value, min: bMin.value, from: bFrom.value, to: bTo.value, sun: bSun.checked, sat: bSat.checked }; };
  for (const x of [bLv, bMin, bSun, bSat]) x.addEventListener('change', saveBulk);
  bMin.addEventListener('input', saveBulk);
  // đổi khoảng áp → lưới chuyển sang đúng khoảng đó (để thấy trước chỗ sắp áp)
  const bulkRange = () => {
    if (!bFrom.value || !bTo.value) return;
    if (bTo.value < bFrom.value) bTo.value = bFrom.value;
    saveBulk(); setRange(bFrom.value, bTo.value, true);
  };
  let brT = null; const bulkRangeSoon = () => { saveBulk(); clearTimeout(brT); brT = setTimeout(bulkRange, 700); };   // gõ tay từng số năm → chỉ tải 1 lần khi gõ xong
  bFrom.addEventListener('change', bulkRangeSoon); bTo.addEventListener('change', bulkRangeSoon);
  const bScope = el('select', { style: 'width:auto;margin:0' }, el('option', { value: 'list' }, 'Tất cả NV đang lọc'), el('option', { value: 'picked' }, 'Chỉ NV đã tích'));
  const bDays = el('button', { class: 'btn sm' }, 'Áp cho các ngày'), bEmp = el('button', { class: 'btn ghost sm', title: 'Ghi làm mức riêng của NV — áp cho mọi ngày chưa khai riêng' }, 'Đặt làm mức riêng NV');
  const doApply = async (target) => {
    const ids = bScope.value === 'picked' ? [..._al.picked] : visible().map((e) => e.id);
    if (!ids.length) return toast(bScope.value === 'picked' ? 'Tích chọn nhân viên ở lưới trước' : 'Không có nhân viên nào', 'err');
    const what = `${LV[bLv.value]} = ${bMin.value === '' ? 'theo mặc định (xoá ô đã khai)' : bMin.value + ' phút'}`;
    if (!confirm(`${what}\n${target === 'default' ? 'Đặt làm MỨC RIÊNG' : `Từ ${bFrom.value} đến ${bTo.value}`} cho ${ids.length} nhân viên?`)) return;
    try {
      const r = await api('/admin/audit-limits/apply', { method: 'POST', body: { level: +bLv.value, minutes: bMin.value, employee_ids: ids, target, from: bFrom.value, to: bTo.value, skip_sun: bSun.checked, skip_sat: bSat.checked } });
      toast(`Đã cập nhật ${r.cells} ô (${r.people} NV)`, 'ok'); pageAuditLimits();
    } catch (e) { toast(e.message, 'err'); }
  };
  bDays.onclick = () => doApply('days'); bEmp.onclick = () => doApply('default');
  const applyPanel = el('div', { class: 'panel al-apply' },
    bLv, bMin, el('span', { class: 'muted' }, 'phút (trống = về mặc định) · từ'), bFrom, el('span', { class: 'muted' }, 'đến'), bTo,
    el('label', {}, bSun, 'Bỏ qua chủ nhật'), el('label', {}, bSat, 'Bỏ qua thứ 7'), bScope, bDays, bEmp);

  // 2 khung trên thu gọn được (nút ▼/▶) để lấy chỗ cho lưới
  const showDef = (lv) => (data.defaults[lv] == null ? 'không giới hạn' : data.defaults[lv] + "'");
  const defFold = foldPanel(defPanel, 'al_def', 'Mặc định công ty (phút / ngày)', () => `Mức 1: ${showDef(1)} · Mức 2: ${showDef(2)} · Mức 3: ${showDef(3)}`);
  foldPanel(applyPanel, 'al_apply', 'Áp nhanh', () => 'Áp 1 số phút cho nhiều NV × nhiều ngày, hoặc đặt mức riêng NV — bấm để mở');

  // ----- lưới NV × ngày -----
  const visible = () => {
    const g = groups.get(_al.dept), s = _al.q.trim().toLowerCase();
    return emps.filter((e) => (!g || g.has(e.department || NONE)) && (!s || (e.full_name || '').toLowerCase().includes(s) || String(e.code || '').toLowerCase().includes(s)));
  };
  const levels = _al.tab === 'all' ? [1, 2, 3] : [+_al.tab];
  const days = []; for (let d = _al.from; d <= _al.to; d = addDays(d, 1)) days.push(d);
  const cols = [...levels.map((lv) => ({ d: '*', lv })), ...days.flatMap((d) => levels.map((lv) => ({ d, lv })))];
  const allChk = el('input', { type: 'checkbox', style: 'width:auto;margin:0' });
  const thead = el('thead', {}, el('tr', {}, el('th', {}, allChk), el('th', {}, 'Mã NV'), el('th', {}, 'Họ tên'), el('th', {}, 'Bộ phận'),
    ...cols.map((c) => el('th', { class: 'al-h' + (c.d === '*' ? ' emp' : wdOf(c.d) === 0 ? ' sun' : '') },
      c.d === '*' ? 'Riêng NV' : c.d.slice(8) + '/' + c.d.slice(5, 7), el('br'), el('small', {}, c.d === '*' ? LV[c.lv] : (levels.length > 1 ? LV[c.lv] : WDS[wdOf(c.d)]))))));
  const tbody = el('tbody');
  const tbl = el('table', { class: 'data al-grid' }, thead, tbody);
  const total = el('span', { class: 'muted' });
  let list = [];
  const tdFor = (e, c) => {
    const f = eff(e.id, c.d, c.lv);
    const empCol = c.d === '*', unset = empCol && f.src === 'def';   // cột "Riêng NV" chưa đặt → để trống (đang theo mặc định công ty)
    const td = el('td', { class: 'al-c ' + f.src + (c.d !== '*' && wdOf(c.d) === 0 ? ' sun' : ''), tabindex: 0,
      title: unset ? 'Chưa đặt mức riêng — theo mặc định công ty' : f.src === 'day' ? 'Khai riêng ngày này' : f.src === 'emp' ? 'Mức riêng của NV' : 'Mặc định công ty' }, unset ? '' : f.v == null ? '—' : String(f.v));
    td._k = { e, c };
    return td;
  };
  const draw = () => {
    list = visible();
    tbody.replaceChildren();
    const frag = document.createDocumentFragment();
    for (const e of list) {
      const cb = el('input', { type: 'checkbox', style: 'width:auto;margin:0', ...(_al.picked.has(e.id) ? { checked: '' } : {}) });
      cb.onchange = () => { cb.checked ? _al.picked.add(e.id) : _al.picked.delete(e.id); updTotal(); };
      frag.append(el('tr', {}, el('td', {}, cb), el('td', {}, e.code || ''), el('td', {}, el('b', {}, e.full_name)), el('td', { class: 'muted al-dept', title: e.department || '' }, e.department || '—'), ...cols.map((c) => tdFor(e, c))));
    }
    if (!list.length) frag.append(el('tr', {}, el('td', { colspan: 4 + cols.length }, el('div', { class: 'empty' }, 'Không có nhân viên.'))));
    tbody.append(frag);
    updTotal();
  };
  // số NV đã tích (tính trên danh sách đang lọc) — cập nhật ngay mỗi lần tích / bỏ tích
  function updTotal() {
    const n = list.filter((e) => _al.picked.has(e.id)).length;
    allChk.checked = list.length > 0 && n === list.length;
    allChk.indeterminate = n > 0 && n < list.length;
    total.textContent = `${list.length} nhân viên · ${n} đã tích` + (_al.picked.size > n ? ` (thêm ${_al.picked.size - n} ở bộ phận khác)` : '');
    bScope.value = _al.picked.size ? 'picked' : 'list';   // đã tích ai → "Áp nhanh" tự chỉ áp cho người đã tích
  }
  allChk.onchange = () => { for (const e of list) allChk.checked ? _al.picked.add(e.id) : _al.picked.delete(e.id); draw(); };
  // lưu nhiều ô 1 lần rồi vẽ lại
  const saveCells = async (changes) => {
    if (!changes.length) return;
    try {
      await api('/admin/audit-limits/cells', { method: 'POST', body: { cells: changes } });
      for (const c of changes) { const k = `${c.employee_id}|${c.date}|${c.level}`; if (c.minutes === '' || c.minutes == null) cell.delete(k); else cell.set(k, +c.minutes); }
      draw(); toast(changes.length > 1 ? `Đã lưu ${changes.length} ô` : 'Đã lưu', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };
  const posOf = (td) => [list.indexOf(td._k.e), cols.indexOf(td._k.c)];
  const focusAt = (r, c) => { const tr = tbody.children[r]; const td = tr && tr.children[4 + c]; if (td) td.focus(); };
  const edit = (td) => {
    const { e, c } = td._k; const cur = cell.get(`${e.id}|${c.d}|${c.lv}`);
    const inp = el('input', { type: 'number', min: 0, max: 1440, value: cur ?? '', class: 'al-inp' });
    td.replaceChildren(inp); inp.focus(); inp.select();
    let done = false;
    const finish = (save) => {
      if (done) return; done = true;
      if (save && String(inp.value) !== String(cur ?? '')) saveCells([{ employee_id: e.id, date: c.d, level: c.lv, minutes: inp.value }]);
      else draw();
    };
    inp.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); const [r, ci] = posOf(td); finish(true); setTimeout(() => focusAt(r + 1, ci), 60); } else if (ev.key === 'Escape') finish(false); };
    inp.onblur = () => finish(true);
  };
  tbody.addEventListener('click', (ev) => { const td = ev.target.closest('td.al-c'); if (td && !td.querySelector('input')) edit(td); });
  tbody.addEventListener('keydown', (ev) => {
    const td = ev.target.closest && ev.target.closest('td.al-c'); if (!td || ev.target.tagName === 'INPUT') return;
    const [r, c] = posOf(td);
    const mv = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[ev.key];
    if (mv) { ev.preventDefault(); focusAt(r + mv[0], c + mv[1]); }
    else if (ev.key === 'Enter' || ev.key === 'F2') { ev.preventDefault(); edit(td); }
    else if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); saveCells([{ employee_id: td._k.e.id, date: td._k.c.d, level: td._k.c.lv, minutes: '' }]); }
    else if (/^[0-9]$/.test(ev.key)) { edit(td); }
  });
  // dán khối số copy từ Excel: ô đang chọn là góc trên-trái
  tbody.addEventListener('paste', (ev) => {
    const td = ev.target.closest && ev.target.closest('td.al-c'); if (!td) return;
    const txt = (ev.clipboardData || window.clipboardData).getData('text'); if (!txt) return;
    ev.preventDefault();
    const [r0, c0] = posOf(td); const changes = [];
    txt.replace(/\r/g, '').replace(/\n$/, '').split('\n').forEach((line, i) => line.split('\t').forEach((v, j) => {
      const e = list[r0 + i], c = cols[c0 + j]; if (!e || !c) return;
      const s = v.trim(); if (s !== '' && !/^\d+$/.test(s)) return;
      changes.push({ employee_id: e.id, date: c.d, level: c.lv, minutes: s });
    }));
    saveCells(changes);
  });
  draw();

  setMain(head(T, fromI, toI, prev, next, monthB, tabs),
    defPanel, applyPanel,
    el('div', { class: 'ft-wrap' }, el('div', { class: 'panel ft-left' }, tree),
      el('div', { class: 'panel', style: 'padding:10px;min-width:0' },
        el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px' }, q, total,
          el('span', { class: 'map-hint', style: 'margin:0' }, 'Bấm ô để sửa · Enter lưu · Delete xoá · mũi tên di chuyển · copy cả khối số từ Excel rồi Ctrl+V vào ô góc trên-trái. Ô đậm = khai riêng ngày; ô xám = theo mức riêng / mặc định; — = không giới hạn.')),
        el('div', { class: 'al-scroll' }, tbl))));
}

