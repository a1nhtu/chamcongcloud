// Nút "chọn nhiều" dùng chung (phòng ban / NV): bỏ hết tick = tất cả. Trả {btn, sync}.
function makeChecklist(icon, allLabel, getItems, picked, afterChange) {
  const btn = el('button', { class: 'btn ghost sm mc-btn', style: 'text-align:left;min-width:150px' });
  const clean = (t) => String(t).replace(/^[\s\u2003└]+/, '');   // bỏ thụt lề cây phòng ban
  const nameOf = () => { const m = new Map(getItems().map((it) => [it.value, clean(it.text)])); return [...picked].map((v) => m.get(v) ?? String(v)); };
  const sync = () => {
    if (!picked.size) { btn.textContent = `${icon} ${allLabel} ▾`; btn.title = ''; btn.classList.remove('on'); return; }
    const names = nameOf();
    btn.textContent = `${icon} ${names.slice(0, 2).join(', ')}${names.length > 2 ? ` +${names.length - 2}` : ''} ▾`;
    btn.title = `Đang chọn ${names.length}:\n` + names.join('\n'); btn.classList.add('on');
  };
  sync();
  let dd = null;
  const close = (reload) => { if (dd) { dd.remove(); dd = null; sync(); if (reload) afterChange(); } };
  btn.onclick = (ev) => {
    ev.stopPropagation();
    if (dd) { close(true); return; }
    dd = el('div', { class: 'mc-dd', style: 'position:fixed;z-index:1200;background:var(--surface,#fff);border:1px solid var(--line,#e5e5e5);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:8px;max-height:360px;overflow:auto;min-width:250px' });
    const selAll = el('input', { type: 'checkbox', style: 'width:auto' }); selAll.checked = picked.size === 0;
    selAll.onchange = () => { picked.clear(); dd.querySelectorAll('.mc-cb').forEach(c => c.checked = false); };
    const items = getItems();
    // ô TÌM (tên / mã, gõ không dấu cũng được) khi danh sách dài + nút tích hết các dòng đang hiện
    const fold = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
    const rows = []; let treeApply = null;
    const search = items.length > 8 ? el('input', { placeholder: '🔍 Tìm tên / mã…', style: 'margin:0 0 6px;width:100%' }) : null;
    const pickShown = search ? el('button', { type: 'button', class: 'btn ghost sm', style: 'width:100%;margin-bottom:4px;display:none' }) : null;
    if (search) {
      dd.append(el('div', { style: 'position:sticky;top:-8px;z-index:1;background:var(--surface,#fff);padding-top:8px;margin-top:-8px' }, search, pickShown));
      const filt = () => {
        const s = fold(search.value.trim()); let n = 0;
        if (!s && treeApply) { treeApply(); pickShown.style.display = 'none'; return; }   // hết tìm → về cây thu gọn
        for (const r of rows) { const show = !s || r.key.includes(s); r.lb.style.display = show ? 'flex' : 'none'; if (show) n++; }
        pickShown.style.display = s ? 'block' : 'none'; pickShown.textContent = `✓ Tích hết ${n} kết quả`;
      };
      search.oninput = filt;
      search.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); const vis = rows.filter((r) => r.lb.style.display !== 'none'); if (vis.length === 1) vis[0].cb.click(); } };
      pickShown.onclick = () => { for (const r of rows) if (r.lb.style.display !== 'none' && !r.cb.checked) { r.cb.checked = true; picked.add(r.value); } selAll.checked = picked.size === 0; drawChips(); };
      setTimeout(() => search.focus(), 0);
    }
    const chips = el('div', { class: 'mc-chips' });
    const drawChips = () => {
      chips.replaceChildren();
      if (!picked.size) { chips.style.display = 'none'; return; }
      chips.style.display = '';
      chips.append(el('span', { class: 'muted' }, `Đang chọn (${picked.size}):`));
      for (const r of rows.filter((r) => picked.has(r.value))) {
        const x = el('button', { type: 'button', title: 'Bỏ chọn' }, '×');
        x.onclick = (ev) => { ev.stopPropagation(); r.cb.checked = false; picked.delete(r.value); selAll.checked = picked.size === 0; drawChips(); };
        chips.append(el('span', { class: 'mc-chip' }, clean(r.lb.textContent), x));
      }
    };
    dd.append(chips);
    const oldSelAll = selAll.onchange; selAll.onchange = () => { oldSelAll(); drawChips(); };
    dd.append(el('label', { style: 'display:flex;gap:8px;align-items:center;font-weight:700;padding:5px 6px;border-bottom:1px solid var(--line,#eee);margin-bottom:4px;cursor:pointer' }, selAll, `${allLabel} (bỏ hết tick = tất cả)`));
    for (const it of items) {
      const cb = el('input', { type: 'checkbox', class: 'mc-cb', style: 'width:auto', ...(picked.has(it.value) ? { checked: '' } : {}) });
      cb.onchange = () => { cb.checked ? picked.add(it.value) : picked.delete(it.value); selAll.checked = picked.size === 0; drawChips(); };
      const lb = el('label', { style: 'display:flex;gap:8px;align-items:center;padding:4px 6px;cursor:pointer' }, cb, it.text);
      rows.push({ lb, cb, value: it.value, key: fold(it.text), depth: it.depth });
      dd.append(lb);
    }
    if (rows.some((r) => r.depth > 0)) treeApply = collapseTree(rows.map((r) => ({ key: r.value, depth: r.depth || 0, el: r.lb })), [...picked]);
    drawChips();
    const done = el('button', { class: 'btn sm', style: 'width:100%;margin-top:6px' }, 'Xong');
    done.onclick = () => close(true); dd.append(done);
    document.body.append(dd);
    const r = btn.getBoundingClientRect();
    dd.style.left = Math.max(8, Math.min(r.left, innerWidth - 270)) + 'px';
    dd.style.top = (r.bottom + 4) + 'px';
    setTimeout(() => document.addEventListener('click', function h(ev2) { if (dd && !dd.contains(ev2.target) && ev2.target !== btn) { close(true); document.removeEventListener('click', h, true); } }, true), 0);
  };
  return { btn, sync };
}

let _rpForm = '';      // mẫu báo cáo đang chọn: 'shift' | 'hourly'
let _rpOnly = true;    // công ty có cả 2 kiểu: chỉ lấy NV chấm đúng kiểu của mẫu
// Ô "Hiện cả ngày không đi làm" (Anh 03/11/2026): báo cáo danh sách thêm dòng để trống cho ngày NV không chấm → biết đi làm ngày nào,
// nghỉ ngày nào. Nhớ trên máy. Báo cáo ma trận (mỗi ngày 1 cột) vốn đã đủ ngày nên không có ô này.
let _rpAllDays = false; try { _rpAllDays = localStorage.getItem('rp_alldays') === '1'; } catch {}
const REPORT_ALLDAYS = ['attendance', 'firstlast', 'detail', 'detaillist', 'detailmulti', 'empsheet'];
async function pageReport() {
  // Mẫu báo cáo: theo ca (công, trễ/sớm, tăng ca) hay theo giờ (tổng giờ). Mặc định theo kiểu công ty đang dùng.
  if (!_rpForm) _rpForm = hourlyMode() ? 'hourly' : 'shift';
  const formSel = el('select', { title: 'Mẫu báo cáo: theo ca hay theo giờ', style: 'width:auto' },
    el('option', { value: 'shift', ...(_rpForm === 'shift' ? { selected: '' } : {}) }, '🕐 Mẫu theo ca (công)'),
    el('option', { value: 'hourly', ...(_rpForm === 'hourly' ? { selected: '' } : {}) }, '⏱️ Mẫu theo giờ'));
  const onlyChk = el('input', { type: 'checkbox', style: 'width:auto', ...(_rpOnly ? { checked: '' } : {}) });
  const onlyLbl = mixedMode() ? el('label', { style: 'display:flex;align-items:center;gap:6px;font-weight:600;color:var(--ink);font-size:13px', title: 'Công ty có cả nhân viên chấm theo ca và theo giờ: chỉ đưa vào báo cáo những người chấm đúng kiểu của mẫu đang chọn' }, onlyChk, 'Chỉ NV chấm kiểu này') : null;
  const monthI = el('input', { type: 'month', id: 'rp-month', value: todayMonth(), title: 'Chọn nhanh trọn 1 tháng' });
  const md0 = monthDaysArr(todayMonth());
  const fromI = el('input', { type: 'date', id: 'rp-from', value: md0[0], title: 'Từ ngày' });
  const toI = el('input', { type: 'date', id: 'rp-to', value: md0[md0.length - 1], title: 'Đến ngày' });
  const arrow = el('span', { style: 'align-self:center;color:var(--muted)' }, '→');
  // Phòng ban + Nhân viên chọn NHIỀU (bỏ hết tick = tất cả). Chọn NV cụ thể sẽ ưu tiên hơn phòng ban.
  let depts = [], emps = [];
  try { depts = (await api('/reports/departments')).rows || []; } catch {}
  if (!DEPARTMENTS.length) { try { DEPARTMENTS = (await api('/admin/departments')).rows || []; } catch {} }   // cây cha–con cho ô chọn phòng ban
  try { emps = (await api('/admin/employees')).rows || []; } catch {}
  emps = emps.filter(e => e.role !== 'admin' && e.active !== 0);
  const deptPick = new Set(), empPick = new Set();
  let onFilterChange = () => {};
  const deptCl = makeChecklist('🏢', 'Tất cả phòng ban', () => deptTreeItems(depts), deptPick, () => { empPick.clear(); empCl.sync(); onFilterChange(); });
  const empCl = makeChecklist('👥', 'Tất cả NV', () => { const ex = deptExpand(deptPick); return emps.filter(e => !deptPick.size || ex.has(e.department || '')).map(e => ({ value: e.id, text: `${e.full_name} (${e.code})` })); }, empPick, () => onFilterChange());

  const periodQS = () => `from=${fromI.value}&to=${toI.value}`;
  // Phần lọc NV cho query: ưu tiên NV cụ thể (ids), rồi tới nhiều phòng ban (depts)
  const filterQS = () => (empPick.size ? '&ids=' + [...empPick].join(',')
    : (deptPick.size ? '&depts=' + encodeURIComponent([...deptPick].join(',')) : ''))
    + '&mode=' + formSel.value + (mixedMode() && onlyChk.checked ? '&emode=' + formSel.value : '') + (_virt && auditOn() ? '&virt=' + _virt : '')
    + (_rpAllDays ? '&alldays=1' : '');
  let rpRun = null;   // báo cáo đang mở: hàm tải lại (màn danh sách thẻ = null, không tải)
  const dApply = dateApply(fromI, toI, () => rpRun && rpRun());
  // Chọn tháng = đặt nhanh Từ/Đến ngày về trọn tháng đó
  const snapMonth = () => { const ds = monthDaysArr(monthI.value || todayMonth()); fromI.value = ds[0]; toI.value = ds[ds.length - 1]; dimMonth(); };
  // Ô THÁNG chỉ "sáng" khi Từ / Đến ngày đúng trọn tháng đó; chọn khoảng ngày khác → ô tháng mờ đi (đang lọc theo Từ → Đến)
  const dimMonth = () => {
    const ds = monthDaysArr(monthI.value || todayMonth());
    const on = fromI.value === ds[0] && toI.value === ds[ds.length - 1];
    monthI.classList.toggle('rp-dim', !on);
    monthI.title = on ? 'Chọn nhanh trọn 1 tháng' : 'Đang xem theo Từ ngày → Đến ngày (không theo tháng). Chọn tháng để xem trọn tháng.';
  };
  fromI.addEventListener('change', dimMonth); toI.addEventListener('change', dimMonth); monthI.addEventListener('change', dimMonth);

  // MẪU BÁO CÁO RIÊNG của công ty (server/custom-reports.js): thẻ ở đầu trang; tài khoản tổng thêm / sửa ngay tại đây
  let CR = { bases: [], list: [] };
  const loadCR = async () => { try { CR = await api('/reports/custom'); } catch { CR = { bases: [], list: [] }; } };
  await loadCR();
  const CR_PAIR = ['cin', 'cout', 'inReal', 'outReal'];   // cột giờ vào/ra bị tách theo lần chấm (cin_1, cin_2 …)
  // Hộp thêm / sửa mẫu: cột lấy từ báo cáo gốc theo kỳ + bộ lọc đang chọn; tích cột cần hiện, đổi tên, ↑ ↓ thứ tự, thêm cột công thức
  const crEditor = (tpl) => {
    const nameI = el('input', { value: tpl?.name || '', placeholder: 'VD: Bảng công công ty A' });
    const baseS = el('select', {}, ...CR.bases.map(([t, n]) => el('option', { value: t }, n)));
    if (tpl) baseS.value = tpl.base;
    const titleI = el('input', { value: tpl?.title || '', placeholder: 'Để trống = tiêu đề của báo cáo gốc' });
    const listBox = el('div', { style: 'display:flex;flex-direction:column;gap:4px;max-height:46vh;overflow:auto;border:1px solid var(--line,#eee);border-radius:8px;padding:6px' }, loading());
    let items = [];   // [{ key, orig, label, on } | { f, label }]
    const draw = () => {
      listBox.replaceChildren(...items.map((it, i) => {
        const mv = (d) => { const j = i + d; if (j < 0 || j >= items.length) return; [items[i], items[j]] = [items[j], items[i]]; draw(); };
        const up = el('button', { class: 'btn ghost sm', type: 'button', title: 'Lên' }, '↑'); up.onclick = () => mv(-1);
        const dn = el('button', { class: 'btn ghost sm', type: 'button', title: 'Xuống' }, '↓'); dn.onclick = () => mv(1);
        if (it.f != null) {
          const lb = el('input', { value: it.label, placeholder: 'Tên cột', style: 'width:150px' }); lb.oninput = () => { it.label = lb.value; };
          const fI = el('input', { value: it.f, placeholder: '=cong*8', style: 'flex:1;min-width:120px;font-family:monospace' }); fI.oninput = () => { it.f = fI.value; };
          const rm = el('button', { class: 'btn ghost sm', type: 'button', title: 'Bỏ cột công thức' }, '✕'); rm.onclick = () => { items.splice(i, 1); draw(); };
          return el('div', { style: 'display:flex;gap:6px;align-items:center;padding:4px;background:var(--bg2,#f8fafc);border-radius:6px' }, up, dn, el('b', { title: 'Cột công thức' }, 'ƒ'), lb, fI, rm);
        }
        const chk = el('input', { type: 'checkbox', style: 'width:auto', ...(it.on ? { checked: '' } : {}) }); chk.onchange = () => { it.on = chk.checked; };
        const lb = it.key === '@days' ? el('span', { style: 'flex:1' }) : el('input', { value: it.label, placeholder: 'Tên cột riêng (để trống = giữ tên gốc)', style: 'flex:1;min-width:120px' });
        if (it.key !== '@days') lb.oninput = () => { it.label = lb.value; };
        return el('div', { style: 'display:flex;gap:6px;align-items:center;padding:2px 4px' }, up, dn, chk,
          el('div', { style: 'width:210px;font-size:13px' }, it.orig, it.key === '@days' ? null : el('div', { style: 'font-size:11px;color:var(--muted);font-family:monospace' }, 'mã: ' + it.key)), lb);
      }));
    };
    const loadCols = async (keepTpl) => {
      listBox.replaceChildren(loading());
      let cols;
      try { cols = (await api(`/reports/data?type=${baseS.value}&${periodQS()}${filterQS()}`)).columns || []; }
      catch (e) { listBox.replaceChildren(el('div', { class: 'empty' }, e.message)); return; }
      const base = [];   // cột gốc, gộp cột ngày + cột giờ vào/ra tách theo lần chấm thành 1 mục
      for (const c of cols) {
        if (/^d\d{4}-\d\d-\d\d$/.test(c.key)) { if (!base.some((b) => b.key === '@days')) base.push({ key: '@days', orig: '📅 Các cột ngày (mỗi ngày 1 cột)' }); continue; }
        const m = /^(.+)_(\d+)$/.exec(c.key);
        if (m && CR_PAIR.includes(m[1])) { if (!base.some((b) => b.key === m[1])) base.push({ key: m[1], orig: c.label.replace(/\s*\d+$/, '') + ' (mỗi lần chấm 1 cột)' }); continue; }
        base.push({ key: c.key, orig: c.grp ? c.grp + ' · ' + c.label : c.label });
      }
      if (keepTpl && tpl && tpl.base === baseS.value) {
        items = tpl.cols.map((it) => (it.f != null ? { f: it.f, label: it.label }
          : { key: it.key, label: it.label || '', on: true, orig: (base.find((b) => b.key === it.key) || { orig: it.key + ' (kỳ này không có)' }).orig }));
        for (const b of base) if (!items.some((i) => i.key === b.key)) items.push({ ...b, label: '', on: false });
      } else items = base.map((b) => ({ ...b, label: '', on: true }));
      draw();
    };
    const addF = el('button', { class: 'btn ghost sm', type: 'button' }, '＋ Thêm cột công thức');
    addF.onclick = () => { items.push({ f: '', label: '' }); draw(); listBox.scrollTop = listBox.scrollHeight; };
    baseS.onchange = () => loadCols(false);
    const save = el('button', { class: 'btn' }, 'Lưu mẫu');
    save.onclick = async () => {
      const cols = items.filter((it) => it.f != null || it.on).map((it) => (it.f != null ? { label: it.label, f: it.f } : { key: it.key, label: it.label }));
      save.disabled = true;
      try {
        const t = await api(tpl ? `/admin/custom-reports/${tpl.id}` : '/admin/custom-reports', { method: tpl ? 'PUT' : 'POST', body: { name: nameI.value, base: baseS.value, title: titleI.value, cols } });
        await loadCR(); closeModal(); toast('Đã lưu mẫu báo cáo riêng', 'ok'); showReport('cr' + t.id);
      } catch (e) { toast(e.message, 'err'); } finally { save.disabled = false; }
    };
    const del = tpl ? el('button', { class: 'btn ghost', style: 'color:#b91c1c' }, 'Xoá mẫu') : null;
    if (del) del.onclick = async () => {
      if (!confirm(`Xoá mẫu "${tpl.name}"? Báo cáo gốc không bị ảnh hưởng.`)) return;
      try { await api(`/admin/custom-reports/${tpl.id}`, { method: 'DELETE' }); await loadCR(); closeModal(); toast('Đã xoá mẫu', 'ok'); hub(); } catch (e) { toast(e.message, 'err'); }
    };
    const cancel = el('button', { class: 'btn ghost' }, 'Huỷ'); cancel.onclick = closeModal;
    openModal(tpl ? 'Sửa mẫu báo cáo riêng' : 'Thêm mẫu báo cáo riêng', [
      el('div', { class: 'map-hint', style: 'margin-bottom:8px' }, 'Mẫu riêng chỉ lưu cách trình bày (cột nào, thứ tự, tên cột, cột công thức) cho riêng công ty này. Số liệu vẫn do báo cáo gốc tính, nên cập nhật phần mềm vẫn áp dụng cho mẫu. Cột lấy theo kỳ + bộ lọc đang chọn ở trang Báo cáo.'),
      el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px' }, field('Tên mẫu', nameI), field('Dựa trên báo cáo', baseS), field('Tiêu đề trên báo cáo', titleI)),
      el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin:10px 0 4px;gap:8px;flex-wrap:wrap' }, el('b', {}, 'Cột (tích cột cần hiện, ↑ ↓ đổi thứ tự)'), addF),
      listBox,
      el('div', { class: 'map-hint', style: 'margin-top:6px' }, 'Công thức kiểu Excel dùng mã cột, VD =cong*8 + ot hoặc =IF(vang>0, "Có vắng", ""). Hàm: IF, ROUND, MIN, MAX, SUM… Ô không phải số (giờ 08:00, ký hiệu) tính là 0.'),
    ], [save, del, cancel].filter(Boolean));
    $('#modal').style.maxWidth = '820px';
    loadCols(true);
  };
  // Nhóm thẻ mẫu riêng ở đầu trang (chưa có mẫu nào → chỉ tài khoản tổng thấy thẻ "＋ Thêm mẫu riêng")
  const crGroup = () => {
    if (!CR.list.length && !isMaster()) return null;
    const baseName = (b) => (CR.bases.find(([t]) => t === b) || [b, b])[1];
    const grid = el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:12px' });
    for (const t of CR.list) {
      const edit = isMaster() ? el('button', { class: 'btn ghost sm', title: 'Sửa mẫu', style: 'margin-left:auto' }, '✎ Sửa') : null;
      if (edit) edit.onclick = (ev) => { ev.stopPropagation(); crEditor(t); };
      const card = el('div', { class: 'panel', style: 'padding:16px;cursor:pointer;display:flex;gap:12px;align-items:flex-start' },
        el('div', { style: 'font-size:26px;line-height:1' }, '📌'),
        el('div', { style: 'flex:1' }, el('div', { style: 'font-weight:700;color:var(--ink)' }, t.name),
          el('div', { style: 'font-size:12.5px;color:var(--muted);margin-top:3px;line-height:1.5' }, 'Mẫu riêng — dựa trên: ' + baseName(t.base))), edit);
      card.onclick = () => showReport('cr' + t.id);
      grid.append(card);
    }
    if (isMaster()) {
      const add = el('div', { class: 'panel', style: 'padding:16px;cursor:pointer;display:flex;gap:12px;align-items:flex-start;border:1px dashed var(--line,#d8dee6)' },
        el('div', { style: 'font-size:26px;line-height:1' }, '＋'),
        el('div', {}, el('div', { style: 'font-weight:700;color:var(--ink)' }, 'Thêm mẫu riêng'),
          el('div', { style: 'font-size:12.5px;color:var(--muted);margin-top:3px;line-height:1.5' }, 'Dựa trên 1 báo cáo có sẵn: chọn cột, thứ tự, tên cột, thêm cột công thức. 🔒 Chỉ tài khoản tổng thấy thẻ này.')));
      add.onclick = () => crEditor(null);
      grid.append(add);
    }
    return [el('div', { style: 'font-weight:800;color:var(--ink);margin:18px 0 10px;font-size:15px' }, '📌 Mẫu báo cáo riêng của công ty'), grid];
  };

  // Màn danh sách báo cáo dạng thẻ, gom nhóm
  const hub = () => {
    monthI.onchange = () => { snapMonth(); dApply.synced(); }; fromI.onchange = null; toI.onchange = null; onFilterChange = () => {}; rpRun = null;
    formSel.onchange = () => { _rpForm = formSel.value; hub(); }; onlyChk.onchange = () => { _rpOnly = onlyChk.checked; };
    const wrap = el('div', {});
    wrap.append(el('div', { class: 'map-hint', style: 'margin-bottom:4px' }, 'Chọn kỳ (tháng hoặc Từ ngày → Đến ngày), phòng ban và/hoặc nhân viên cụ thể ở trên, rồi bấm vào một báo cáo để xem chi tiết và xuất Excel.'));
    const crNodes = crGroup(); if (crNodes) wrap.append(...crNodes);
    const H = formSel.value === 'hourly';
    // Công ty đã áp gói cài đặt (Cài đặt › Chế độ tính công): ghim báo cáo hay dùng của gói lên đầu (vẫn còn ở nhóm cũ). Chưa áp gói → như cũ.
    const pin = Array.isArray(SETTINGS.profile_reports) ? SETTINGS.profile_reports : [];
    const pinCards = pin.map((v) => REPORT_GROUPS.flatMap(([, cs]) => cs).find((c) => c[0] === v)).filter(Boolean);
    for (const [gname, cards0] of [...(pinCards.length ? [['⭐ Hay dùng — ' + (SETTINGS.profile_name || ''), pinCards]] : []), ...REPORT_GROUPS]) {
      const cards = H ? cards0.map((c) => (REPORT_HOURLY_TEXT[c[0]] ? [c[0], c[1], ...REPORT_HOURLY_TEXT[c[0]]] : c)) : cards0;
      const list = cards.filter(([v]) => (!H || !REPORT_HOURLY_HIDE.includes(v)) && (auditOn() || !v.startsWith('audit3')));
      if (!list.length) continue;
      wrap.append(el('div', { style: 'font-weight:800;color:var(--ink);margin:18px 0 10px;font-size:15px' }, gname));
      const grid = el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:12px' });
      for (const [v, ic, title, desc] of list) {
        const card = el('div', { class: 'panel', style: 'padding:16px;cursor:pointer;display:flex;gap:12px;align-items:flex-start;transition:box-shadow .15s,transform .15s' },
          el('div', { style: 'font-size:26px;line-height:1' }, ic),
          el('div', {}, el('div', { style: 'font-weight:700;color:var(--ink)' }, title),
            el('div', { style: 'font-size:12.5px;color:var(--muted);margin-top:3px;line-height:1.5' }, desc)));
        card.onmouseenter = () => { card.style.boxShadow = '0 6px 18px rgba(0,0,0,.09)'; card.style.transform = 'translateY(-2px)'; };
        card.onmouseleave = () => { card.style.boxShadow = ''; card.style.transform = ''; };
        card.onclick = () => showReport(v);
        grid.append(card);
      }
      wrap.append(grid);
    }
    setMain(head('Báo cáo', monthI, fromI, arrow, toI, deptCl.btn, empCl.btn, formSel, onlyLbl, virtToggle(() => hub())), wrap);
  };

  // Xem 1 báo cáo cụ thể (có nút quay lại danh sách)
  const showReport = (type) => {
    const backBtn = el('button', { class: 'btn ghost sm' }, '← Danh sách báo cáo');
    backBtn.onclick = hub;
    const exportBtn = el('button', { class: 'btn green' }, '⬇ Xuất Excel');
    exportBtn.onclick = () => { if (!dApply.btn.disabled) return toast('Bấm "✓ Áp dụng" để xem khoảng ngày mới trước khi xuất Excel', 'err'); downloadExcel(type, fromI.value, toI.value, filterQS()); };
    const base = type.startsWith('cr') ? (CR.list.find((t) => 'cr' + t.id === type) || {}).base : type;   // mẫu riêng: theo báo cáo gốc
    const allChk = el('input', { type: 'checkbox', style: 'width:auto', ...(_rpAllDays ? { checked: '' } : {}) });
    const allLbl = REPORT_ALLDAYS.includes(base) ? el('label', { style: 'display:flex;align-items:center;gap:6px;font-weight:600;color:var(--ink);font-size:13px;cursor:pointer',
      title: 'Tích: hiện cả những ngày nhân viên không chấm công (dòng để trống, tô xám) để biết đi làm ngày nào, nghỉ ngày nào. Bỏ tích: chỉ hiện ngày có đi làm' }, allChk, 'Hiện cả ngày không đi làm') : null;
    const wrap = el('div', {}, loading());
    setMain(head('Báo cáo', backBtn, monthI, fromI, arrow, toI, dApply.btn, deptCl.btn, empCl.btn, formSel, onlyLbl, virtToggle(() => showReport(type)), allLbl, exportBtn), wrap);
    const load = async () => {
      if (fromI.value && toI.value && toI.value < fromI.value) return toast('Đến ngày phải sau Từ ngày', 'err');
      dApply.synced();
      wrap.innerHTML = ''; wrap.append(loading());
      let data;
      try { data = await api(`/reports/data?type=${type}&${periodQS()}${filterQS()}`); }
      catch (e) { wrap.innerHTML = ''; wrap.append(el('div', { class: 'empty' }, e.message)); return; }
      const tbl = el('table', { class: 'data' });
      const thead = el('tr', {});
      // cột ngày cuối tuần (báo cáo ma trận): THỨ 7 NHẠT HƠN CHỦ NHẬT (Anh 04/11/2026) — c.weekend = 'T7' | 'CN' | 'X' (ngày khác khai ở Cài đặt)
      const wkTh = (w) => (!w ? '' : w === 'T7' ? 'background:#fff4e6;color:#b45309;' : 'background:#ffd9a8;color:#9a3412;');
      const wkTd = (w) => (!w ? '' : w === 'T7' ? 'background:#fffaf3;' : 'background:#ffecd6;');
      for (const c of data.columns) thead.append(el('th', { style: wkTh(c.weekend) + (c.sub || c.grp ? 'text-align:center;white-space:pre-line' : '') },
        c.sub ? c.label + '\n' + c.sub : c.grp ? c.grp + '\n' + c.label : c.label));
      tbl.append(el('thead', {}, thead));
      const tb = el('tbody');
      let pinLefts = null;   // vị trí các cột ghim (tính sau khi vẽ) → áp cả cho dòng vẽ sau
      const mkRow = (row) => {
        // rp-off: ngày không đi làm (ô "Hiện cả ngày không đi làm"); rp-t7 / rp-cn: dòng thứ 7 / chủ nhật tô cam, T7 nhạt hơn CN (Anh 04/11/2026)
        const wk = row.wd === 'T7' || row.wd === 'CN';
        const cls = [row._off ? 'rp-off' : '', row.wd === 'T7' ? 'rp-t7' : row.wd === 'CN' ? 'rp-cn' : ''].filter(Boolean).join(' ');
        const tr = el('tr', cls ? { class: cls } : {});
        if (row._total) tr.style.cssText = 'font-weight:800;background:#eff4fa';   // dòng TỔNG CỘNG (Bảng thống kê chấm công giờ)
        for (const c of data.columns) {
          const v = row[c.key];
          const isSym = type === 'symbol' && SYMBOL_COLOR[v];
          tr.append(el('td', {
            // white-space:pre-line: ô có nhiều lần vào/ra (máy chủ nối bằng xuống dòng) hiện mỗi cặp một dòng
            style: wkTd(c.weekend) + (wk && c.key === 'wd' ? 'color:#b45309;font-weight:700;' : '') + (c.key === 'missShift' && v ? 'background:#fee2e2;color:#b91c1c;font-weight:700;' : '') + (isSym ? `color:${SYMBOL_COLOR[v]};font-weight:700;text-align:center` : (c.key.startsWith('d20') ? 'text-align:center;white-space:pre-line' : 'white-space:pre-line')),
          }, v === '' || v == null ? '' : String(v)));
        }
        if (pinLefts) pinLefts.forEach((L, i) => { const td = tr.children[i]; if (td) { td.classList.add('pin'); td.style.left = L + 'px'; } });
        return tr;
      };
      // Xem trước chia trang 20 / 50 / 100 dòng (mặc định 20, nhớ lựa chọn) — Xuất Excel vẫn ra đủ mọi dòng
      const pager = pagedRows(tb, data.rows, mkRow, data.columns.length, { page: 1 }, 'report_page_size');
      tbl.append(tb);
      wrap.innerHTML = '';
      // Khung bảng cao vừa màn hình, tự cuộn bên trong → thanh kéo ngang luôn nằm ở đáy khung (không phải kéo xuống cuối trang);
      // dòng tiêu đề + 2 cột đầu (mã, tên) đứng yên khi cuộn. Thanh chia trang nằm ngay dưới khung.
      const box = el('div', { class: 'rep-scroll' }, tbl);
      wrap.append(...[lockNote(data.locks)].filter(Boolean), el('div', { style: 'font-weight:800;font-size:16px;color:var(--ink);margin-bottom:10px' }, data.title),
        el('div', { class: 'panel', style: 'overflow:hidden' }, box, pager));
      const pinCols = data.columns.some(c => c.key.startsWith('d20')) ? (data.columns[0].key === 'stt' ? 4 : 2) : 0;
      setTimeout(() => {
        box.style.maxHeight = Math.max(300, innerHeight - box.getBoundingClientRect().top - pager.offsetHeight - 16) + 'px';
        if (!pinCols) return;
        const ths = [...tbl.querySelectorAll('thead th')].slice(0, pinCols);
        let left = 0;
        ths.forEach((th, i) => {
          const L = left;
          th.classList.add('pin'); th.style.left = L + 'px';
          tbl.querySelectorAll(`tbody tr > td:nth-child(${i + 1})`).forEach(td => { td.classList.add('pin'); td.style.left = L + 'px'; });
          left += th.getBoundingClientRect().width;
        });
        pinLefts = ths.map((th) => parseFloat(th.style.left) || 0);
      });
    };
    const snapAndLoad = () => { snapMonth(); load(); };
    monthI.onchange = snapAndLoad; fromI.onchange = null; toI.onchange = null; onFilterChange = load; rpRun = load;   // Từ / Đến: chờ "✓ Áp dụng"
    formSel.onchange = () => { _rpForm = formSel.value; load(); }; onlyChk.onchange = () => { _rpOnly = onlyChk.checked; load(); };
    allChk.onchange = () => { _rpAllDays = allChk.checked; try { localStorage.setItem('rp_alldays', _rpAllDays ? '1' : '0'); } catch {} load(); };
    load();
  };

  hub();
}
// Thanh TIẾN TRÌNH xuất Excel (góc dưới phải): máy chủ báo % + đang làm gì; không chặn thao tác khác.
// Trả { pt, done(ok) }: pt = mã gửi kèm yêu cầu xuất để máy chủ báo tiến độ theo.
function exportProgress(title) {
  const pt = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const bar = el('div', { class: 'xp-bar' }, el('i', {}));
  const pctEl = el('b', {}, '0%'), msgEl = el('div', { class: 'xp-msg' }, 'Đang gửi yêu cầu…');
  const box = el('div', { class: 'xp-box' }, el('div', { class: 'xp-top' }, el('span', {}, '📊 ' + title), pctEl), bar, msgEl);
  document.body.append(box);
  const t0 = Date.now(); let stop = false, shown = 0;
  const set = (pct, msg) => { shown = Math.max(shown, pct); bar.firstChild.style.width = shown + '%'; pctEl.textContent = shown + '%'; if (msg) msgEl.textContent = msg + ` · ${Math.round((Date.now() - t0) / 1000)} giây`; };
  (async () => {
    while (!stop) {
      await new Promise((ok) => setTimeout(ok, 450));
      if (stop) break;
      try { const r = await api('/reports/progress?pt=' + pt); if (!stop && r) set(Math.min(99, r.pct || 0), r.pct >= 100 ? 'Đang tải file về máy…' : (r.msg || 'Đang xử lý…')); } catch { /* hỏi lại lần sau */ }
    }
  })();
  return { pt, done(ok) { stop = true; if (ok) { set(100, 'Xong'); box.classList.add('ok'); } setTimeout(() => box.remove(), ok ? 1200 : 0); } };
}
// Thanh TIẾN TRÌNH lệnh máy đẩy (ADMS) góc dưới phải: tải NV về / xoá NV / đẩy NV + vân tay/khuôn mặt / đồng bộ.
// t = track máy chủ trả về { from, to, serials } (to = 0: đồng bộ — lệnh còn sinh thêm khi máy trả lời). Chỉ hỏi số lệnh máy
// đã báo nhận (1,5 giây/lần) — không đụng tới máy nên không làm chậm. counts: hiện số NV/vân tay/khuôn mặt phần mềm đã nhận.
function cmdTrack(title, t, opt = {}) {
  if (!t || !t.from && !t.to || (t.to && t.to <= t.from)) return;
  let stack = document.getElementById('xp-stack');
  if (!stack) { stack = el('div', { id: 'xp-stack', class: 'xp-stack' }); document.body.append(stack); }
  const bar = el('div', { class: 'xp-bar' }, el('i', {}));
  const pctEl = el('b', {}, '0%'), msgEl = el('div', { class: 'xp-msg' }, 'Đang chờ máy nhận lệnh…'), list = el('div', { class: 'xp-list' });
  const x = el('button', { class: 'xp-x', title: 'Ẩn (máy vẫn chạy tiếp)' }, '×');
  const box = el('div', { class: 'xp-box' }, el('div', { class: 'xp-top' }, el('span', {}, '📡 ' + title), el('span', { class: 'xp-r' }, pctEl, x)), bar, msgEl, list);
  stack.append(box);
  let stop = false;
  x.onclick = () => { stop = true; box.remove(); };
  const qs = `from=${t.from}&to=${t.to || 0}&serials=${encodeURIComponent((t.serials || []).join(','))}`;
  const t0 = Date.now(), sum = (a, k) => a.reduce((s, d) => s + d[k], 0);
  let prev = '', offSince = 0;
  (async () => {
    while (!stop) {
      await new Promise((ok) => setTimeout(ok, 1500));
      if (stop) break;
      let r; try { r = await api('/admin/devices/cmd-progress?' + qs); } catch { continue; }
      const sec = Math.round((Date.now() - t0) / 1000);
      const on = r.devices.filter((d) => d.online && d.total), off = r.devices.filter((d) => !d.online && d.total > d.done);
      const tot = sum(on, 'total'), done = sum(on, 'done'), failed = sum(r.devices, 'failed');
      const pct = tot ? Math.floor(done * 100 / tot) : (off.length ? 0 : 100);
      bar.firstChild.style.width = pct + '%'; pctEl.textContent = pct + '%';
      // Lệnh lỗi: ghi rõ lệnh gì + mã máy trả (gộp lệnh cùng loại cùng mã); lỗi "bình thường" (máy chỉ hiểu 1 trong 2 bảng vân tay) ghi chú xám
      list.replaceChildren(...r.devices.filter((d) => d.total || opt.counts).flatMap((d) => [el('div', {},
        `• ${d.name}: ${d.done}/${d.total} lệnh` + (opt.counts ? ` · có ${d.users} NV, ${d.fp} vân tay, ${d.face} khuôn mặt` : '')
        + (!d.online ? ' · ⚠ mất kết nối, máy nối lại mới nhận' : d.ahead && d.done < d.total ? ` · chờ ${d.ahead} lệnh xếp trước` : '')
        + (d.failed ? ` · ${d.failed} lệnh máy báo lỗi` : '')),
        ...(d.errors || []).map((g) => el('div', { class: 'xp-err' }, `⚠ ${g.what}: máy báo ${g.code} (${g.msg})`
          + (g.n > 1 ? ` — ${g.n} lệnh` : '') + (g.pins.length ? ` · Số ID ${g.pins.join(', ')}${g.n > g.pins.length ? '…' : ''}` : ''))),
        ...(d.skipped || []).map((s) => el('div', { class: 'xp-note' }, `ℹ ${s.what}: máy không dùng bảng này (mã ${s.code}) — bình thường, dữ liệu đã về qua bảng còn lại`))]));
      // xong = máy đang kết nối đã báo nhận hết + 1 lượt hỏi không đổi gì (máy gửi dữ liệu / phần mềm xếp thêm lệnh sau báo nhận)
      const sig = JSON.stringify(r.devices.map((d) => [d.total, d.done, d.users, d.fp, d.face]));
      const settled = on.every((d) => d.done >= d.total) && sig === prev;
      prev = sig;
      if (!on.length && off.length) {
        msgEl.textContent = `Máy đang mất kết nối — lệnh đã xếp sẵn, máy nối lại sẽ tự nhận · ${sec} giây`;
        if (!offSince) offSince = Date.now();
        if (Date.now() - offSince > 10 * 60000) break;
        continue;
      }
      offSince = 0;
      if (!settled) { msgEl.textContent = `Máy đang nhận ${done}/${tot} lệnh · ${sec} giây`; continue; }
      bar.firstChild.style.width = '100%'; pctEl.textContent = '100%';
      msgEl.textContent = (tot ? `✅ Máy đã nhận đủ ${tot} lệnh sau ${sec} giây` : '✅ Không còn gì phải gửi xuống máy')
        + (failed ? ` — ⚠ ${failed} lệnh máy báo lỗi` : '') + (off.length ? ` — ${off.length} máy mất kết nối sẽ nhận khi nối lại` : '');
      box.classList.add('ok');
      // Xong → tự ẩn sau 3 giây kể cả có lỗi (Anh 03/11/2026: trước có lỗi thì hiện mãi, phải bấm × tay); đang rê chuột vào hộp để đọc thì chờ
      const close = () => (box.matches(':hover') ? setTimeout(close, 1000) : box.remove());
      setTimeout(close, 3000);
      opt.after && opt.after();
      return;
    }
  })();
}
let _xlBusy = false;
async function downloadExcel(type, from, to, extraQS) {
  if (_xlBusy) return toast('Đang xuất 1 file Excel — chờ xong rồi xuất tiếp', 'err');
  _xlBusy = true;
  const xp = exportProgress('Xuất Excel');
  try {
    const res = await api(`/reports/export.xlsx?type=${type}&from=${from}&to=${to}${extraQS || ''}&pt=${xp.pt}`, { raw: true });
    if (!res.ok) { xp.done(false); toast('Máy chủ trả lỗi ' + res.status + ' khi xuất', 'err'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: `baocao_${type}_${from}_${to}.xlsx` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    xp.done(true);
    toast('Đã xuất Excel', 'ok');
  } catch (e) { xp.done(false); toast('Không xuất được file (mất kết nối máy chủ, thử lại)', 'err'); }
  finally { _xlBusy = false; }
}

