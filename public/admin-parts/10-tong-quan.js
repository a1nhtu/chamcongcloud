/* ---------- 1) TỔNG QUAN ---------- */
let dashTimer = null;
let dashDate = '';   // '' = hôm nay; đặt ngày để xem lại tổng quan ngày trước (todayVN() có sẵn bên dưới)
async function pageDashboard() {
  if (dashTimer) { clearInterval(dashTimer); dashTimer = null; }
  await renderDashboard(true);
  dashTimer = setInterval(() => {
    const active = document.querySelector('#nav button.active')?.dataset.k;
    // Chỉ tự cập nhật khi đang xem HÔM NAY (xem ngày cũ thì không refresh cho khỏi nhảy)
    if (active === 'dashboard' && !$('#modal-bg').classList.contains('show') && (!dashDate || dashDate === todayVN())) renderDashboard(false);
    else if (active !== 'dashboard') { clearInterval(dashTimer); dashTimer = null; }
  }, 20000);
}

// Tổng quan: trang đang xem + số dòng mỗi trang (0 = tất cả; nhớ theo trình duyệt)
let dashPage = 1, dashPageSize = 20;
try { const v = localStorage.getItem('dash_page_size'); if (v != null && [0, 10, 20, 50, 100].includes(+v)) dashPageSize = +v; } catch {}
async function renderDashboard(showLoading) {
  const refreshBtn = el('button', { class: 'btn ghost sm' }, '↻ Làm mới');
  refreshBtn.onclick = () => renderDashboard(true);
  const dateI = el('input', { type: 'date', value: dashDate || todayVN(), title: 'Chọn ngày để xem lại tổng quan', style: 'width:auto' });
  dateI.onchange = () => { dashDate = dateI.value; dashPage = 1; renderDashboard(true); };
  const autotag = el('span', { style: 'font-size:12px;color:var(--muted)' }, dashDate && dashDate !== todayVN() ? 'Đang xem ngày cũ' : 'Tự cập nhật mỗi 20 giây');
  if (showLoading) setMain(head('Tổng quan', dateI, autotag, refreshBtn), loading());
  try {
    const d = await api('/reports/dashboard?date=' + (dashDate || ''));
    const rep = await api('/reports/attendance?month=' + d.today.slice(0, 7) + '&date=' + d.today);   // chỉ tải đúng ngày đang xem
    const today = rep.rows.filter(r => r.work_date === d.today);
    const hourly = hourlyMode();
    const person = (r, info) => ({ name: r.full_name, code: r.code, dept: r.department, info });
    // 1 NV chấm nhiều phiên/ngày chỉ hiện 1 dòng (giữ lần chấm vào ĐẦU) để khớp số trên thẻ
    const uniqByCode = (rows) => { const s = new Set(); return rows.filter(r => (s.has(r.code) ? false : s.add(r.code))); };
    const cards = el('div', { class: 'cards' },
      mcard('brand', d.totalEmp, 'Nhân viên', () => go('employees')),
      mcard('green', d.checkedIn, 'Đã chấm vào', () => dashListModal('Đã chấm vào',
        uniqByCode(today.filter(r => r.check_in_hm)).map(r => person(r, r.check_in_hm)))),
      mcard('warn', d.notYet, 'Chưa chấm', async () => {
        let emps = [];
        try { emps = (await api('/admin/employees')).rows || []; } catch {}
        const inCodes = new Set(today.filter(r => r.check_in_hm).map(r => r.code));
        const people = emps.filter(e => (d.includeAdmin || e.role !== 'admin') && e.active !== 0 && !inCodes.has(e.code))
          .map(e => ({ name: e.full_name, code: e.code, dept: e.department, info: 'Chưa chấm' }));
        dashListModal('Chưa chấm', people);
      }),
      ...(hourly ? [] : [mcard('warn', d.late, 'Đi muộn', () => dashListModal('Đi muộn',
        today.filter(r => r.late_min > 0).map(r => person(r, r.late_min + ' phút'))))]),
      mcard('red', d.outside, 'Chấm ngoài VP', () => dashListModal('Chấm ngoài văn phòng',
        today.filter(r => r.check_in_outside).map(r => person(r, 'Ngoài ' + humanDistance(r.check_in_distance_m))))),
      mcard('red', d.pendingLeaves, 'Đơn chờ duyệt', () => go('leaves')),
    );
    // Có NV chấm hơn 2 lần → mỗi lần chấm 1 cột: Vào 1 · Ra 1 · Vào 2 · Ra 2 … (số cột theo người chấm nhiều nhất trong ngày)
    const np = today.reduce((m, r) => Math.max(m, Math.ceil((r.punches_hm || []).length / 2)), 1);
    const n1 = np > 1 ? ' 1' : '';
    let extraTh = '';
    for (let i = 2; i <= np; i++) extraTh += `<th>Vào ${i}</th><th>Ra ${i}</th>`;
    const tbl = el('table', { class: 'data' });
    // Vị trí + Muộn đứng trước để các lần chấm (Vào / Ra) nằm liền nhau
    tbl.innerHTML = `<thead><tr><th>Ảnh vào</th><th>Nhân viên</th><th>Bộ phận</th><th>Vị trí</th>${hourly ? '' : '<th>Muộn</th>'}<th>Vào${n1}</th><th>Ra${n1}</th>${extraTh}<th>Ảnh ra</th><th>Giờ</th></tr></thead>`;
    const tb = el('tbody');
    tbl.append(tb);
    // Phân trang: chọn số dòng/trang, giữ nguyên trang đang xem khi tự cập nhật mỗi 20 giây
    const pager = el('div', { style: 'display:flex;gap:10px;align-items:center;justify-content:flex-end;flex-wrap:wrap;padding:10px 14px;border-top:1px solid var(--line);font-size:13px' });
    const sizeSel = el('select', { style: 'width:auto;padding:4px 8px' },
      ...[10, 20, 50, 100, 0].map(n => el('option', { value: n, ...(n === dashPageSize ? { selected: '' } : {}) }, n ? n + ' dòng' : 'Tất cả')));
    const renderPage = () => {
      const size = dashPageSize || today.length || 1;
      const pages = Math.max(1, Math.ceil(today.length / size));
      dashPage = Math.min(Math.max(1, dashPage), pages);
      const from = (dashPage - 1) * size, part = today.slice(from, from + size);
      tb.innerHTML = '';
      if (!today.length) tb.append(el('tr', {}, el('td', { colspan: (hourly ? 8 : 9) + 2 * (np - 1) }, el('div', { class: 'empty' }, 'Không có ai chấm công ngày này.'))));
      for (const r of part) tb.append(rowToday(r, np));
      const prev = el('button', { class: 'btn ghost sm', ...(dashPage <= 1 ? { disabled: '' } : {}), onclick: () => { dashPage--; renderPage(); } }, '‹ Trước');
      const next = el('button', { class: 'btn ghost sm', ...(dashPage >= pages ? { disabled: '' } : {}), onclick: () => { dashPage++; renderPage(); } }, 'Sau ›');
      pager.innerHTML = '';
      pager.append(
        el('span', { style: 'color:var(--muted);margin-right:auto' }, today.length ? `Hiện ${from + 1}–${from + part.length} / ${today.length} lượt chấm` : ''),
        'Mỗi trang:', sizeSel, prev, el('b', {}, `Trang ${dashPage}/${pages}`), next);
    };
    sizeSel.onchange = () => { dashPageSize = +sizeSel.value; dashPage = 1; try { localStorage.setItem('dash_page_size', String(dashPageSize)); } catch {} renderPage(); };
    renderPage();
    const clock = el('span', { style: 'font-size:12px;color:var(--muted)' }, 'Cập nhật lúc ' + new Date().toLocaleTimeString('vi-VN'));
    setMain(head('Tổng quan · ' + d.today, dateI, clock, refreshBtn), cards, el('div', { class: 'panel' }, el('div', { class: 'tbl-scroll' }, tbl), pager));
  } catch (e) { if (showLoading) setMain(head('Tổng quan'), el('div', { class: 'empty' }, e.message)); }
}
function mcard(cls, n, l, onClick) {
  const c = el('div', { class: 'mcard ' + cls }, el('div', { class: 'n' }, String(n)), el('div', { class: 'l' }, l));
  if (onClick) {
    c.style.cursor = 'pointer'; c.title = 'Bấm để xem chi tiết';
    c.onclick = onClick;
    c.onmouseenter = () => { c.style.boxShadow = '0 6px 18px rgba(0,0,0,.10)'; c.style.transform = 'translateY(-2px)'; };
    c.onmouseleave = () => { c.style.boxShadow = ''; c.style.transform = ''; };
  }
  return c;
}
// Popup danh sách người cho các thẻ Tổng quan (Đã chấm/Chưa chấm/Đi muộn/Ngoài VP)
function dashListModal(title, people) {
  const body = el('div', {});
  if (!people.length) body.append(el('div', { class: 'empty' }, 'Không có ai.'));
  else {
    const list = el('div', {});
    for (const p of people) list.append(el('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 2px;border-bottom:1px solid #f1efec' },
      el('div', {}, el('b', {}, p.name || p.code || ''), el('div', { style: 'color:#999;font-size:12px' }, (p.code || '') + (p.dept ? ' · ' + p.dept : ''))),
      el('div', { style: 'font-weight:600;color:var(--ink);white-space:nowrap' }, p.info || '')));
    body.append(list);
  }
  openModal(`${title} (${people.length})`, [body], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Đóng')]);
}
// np: số cặp vào/ra đang hiện trên bảng (NV chấm hơn 2 lần trong ngày → thêm cột Vào 2 · Ra 2 …)
// Ngày vừa chấm điện thoại vừa quẹt máy (1 dòng Vào 1 · Ra 1 · Vào 2 …): lượt chấm điện thoại có ảnh nhỏ ngay cạnh giờ, bấm xem to
function punchTime(t, photo) {
  if (!t || !photo) return t || '';
  const img = el('img', { src: photo, title: 'Ảnh chấm điện thoại lúc ' + t, style: 'width:30px;height:30px;border-radius:7px;object-fit:cover;cursor:pointer;vertical-align:middle;margin-left:6px' });
  img.addEventListener('click', () => showPhoto(photo));
  return el('span', { style: 'white-space:nowrap' }, t, img);
}
function rowToday(r, np = 1) {
  const ps = r.punches_hm || [];
  const pp = ps.length > 2 ? (r.punch_photos || []) : [];
  const pairs = ps.length > 2 ? Array.from({ length: Math.ceil(ps.length / 2) }, (_, i) => [ps[2 * i], ps[2 * i + 1], pp[2 * i], pp[2 * i + 1]]) : [[r.check_in_hm, r.check_out_hm]];
  const outCell = (p) => (p[1] ? punchTime(p[1], p[3]) : el('span', { class: 'pill muted' }, 'chưa ra'));
  // ảnh đã hiện cạnh giờ thì cột Ảnh vào / Ảnh ra không hiện lặp lại
  const inline = new Set(pp.filter(Boolean));
  const sidePhoto = (src) => photoCell(src && !inline.has(src) ? src : null);
  const extra = [];
  for (let i = 1; i < np; i++) { const p = pairs[i]; extra.push(el('td', {}, p ? punchTime(p[0], p[2]) : ''), el('td', {}, p ? outCell(p) : '')); }
  return el('tr', {},
    el('td', {}, sidePhoto(r.check_in_photo)),
    el('td', {}, el('b', {}, r.full_name), el('div', { style: 'color:#999;font-size:12px' }, r.code)),
    el('td', {}, r.department || '—'),
    el('td', {}, r.check_in_outside ? el('span', { class: 'pill bad' }, 'Ngoài ' + humanDistance(r.check_in_distance_m)) : el('span', { class: 'pill ok' }, 'Trong VP')),
    ...(hourlyMode() ? [] : [el('td', {}, r.late_min > 0 ? el('span', { class: 'pill warn' }, r.late_min + 'p') : '—')]),
    el('td', {}, (pairs[0][0] ? punchTime(pairs[0][0], pairs[0][2]) : '—'), (r.manual && r.check_in_hm ? el('span', { style: 'color:var(--brand);font-weight:700', title: 'Giờ sửa/thêm bằng tay' }, ' *') : '')),
    el('td', {}, outCell(pairs[0])),
    ...extra,
    el('td', {}, sidePhoto(r.check_out_photo)),
    el('td', {}, humanMinutes(r.work_minutes)),
  );
}

