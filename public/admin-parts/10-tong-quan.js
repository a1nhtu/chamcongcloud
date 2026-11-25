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
    // Chấm ngoài VP: dòng có BẤT KỲ giờ chấm nào (vào / ra / vào 2 …) nằm ngoài định vị — popup ghi rõ giờ nào ngoài, cách bao xa
    const outRows = today.filter(r => rowPunches(r).some(p => p.geo && p.geo.out));
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
      mcard('red', outRows.length, 'Chấm ngoài VP', () => dashListModal('Chấm ngoài văn phòng',
        outRows.map(r => person(r, outsideText(r))))),
      mcard('red', d.pendingLeaves, 'Đơn chờ duyệt', () => go('leaves')),
    );
    // Có NV chấm hơn 2 lần → mỗi lần chấm 1 cột: Vào 1 · Ra 1 · Vào 2 · Ra 2 … (số cột theo người chấm nhiều nhất trong ngày)
    const np = today.reduce((m, r) => Math.max(m, Math.ceil((r.punches_hm || []).length / 2)), 1);
    const n1 = np > 1 ? ' 1' : '';
    let extraTh = '';
    for (let i = 2; i <= np; i++) extraTh += `<th>Vào ${i}</th><th>Ra ${i}</th>`;
    const tbl = el('table', { class: 'data' });
    // Muộn đứng trước để các lần chấm (Vào / Ra) nằm liền nhau; vị trí (trong / ngoài định vị) hiện ngay dưới TỪNG giờ chấm
    tbl.innerHTML = `<thead><tr><th>Ảnh vào</th><th>Nhân viên</th><th>Bộ phận</th>${hourly ? '' : '<th>Muộn</th>'}<th>Vào${n1}</th><th>Ra${n1}</th>${extraTh}<th>Ảnh ra</th><th>Giờ</th></tr></thead>`;
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
      if (!today.length) tb.append(el('tr', {}, el('td', { colspan: (hourly ? 6 : 7) + 2 * (np - 1) }, el('div', { class: 'empty' }, 'Không có ai chấm công ngày này.'))));
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
      el('div', { style: 'font-weight:600;color:var(--ink);white-space:pre-line;text-align:right' }, p.info || '')));
    body.append(list);
  }
  openModal(`${title} (${people.length})`, [body], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Đóng')]);
}
// Các lần chấm của 1 dòng công theo thứ tự: { label, t, photo, geo } — geo = vị trí lượt đó (null: quẹt máy / không có GPS)
// NV chấm hơn 2 lần trong ngày (ngày vừa chấm điện thoại vừa quẹt máy) → Vào 1 · Ra 1 · Vào 2 …, ảnh + vị trí theo từng lượt
function rowPunches(r) {
  const ps = r.punches_hm || [];
  if (ps.length > 2) {
    const pp = r.punch_photos || [], pg = r.punch_geos || [];
    return ps.map((t, i) => ({ label: (i % 2 ? 'Ra ' : 'Vào ') + (Math.floor(i / 2) + 1), t, photo: pp[i] || null, geo: pg[i] || null }));
  }
  const out = [];
  if (r.check_in_hm) out.push({ label: 'Vào', t: r.check_in_hm, photo: null, geo: r.in_geo || null });
  if (r.check_out_hm) out.push({ label: 'Ra', t: r.check_out_hm, photo: null, geo: r.out_geo || null });
  return out;
}
// np: số cặp vào/ra đang hiện trên bảng (NV chấm hơn 2 lần trong ngày → thêm cột Vào 2 · Ra 2 …)
// Ngày vừa chấm điện thoại vừa quẹt máy (1 dòng Vào 1 · Ra 1 · Vào 2 …): lượt chấm điện thoại có ảnh nhỏ ngay cạnh giờ, bấm xem to
function punchTime(t, photo) {
  if (!t || !photo) return t || '';
  const img = el('img', { src: photo, title: 'Ảnh chấm điện thoại lúc ' + t, style: 'width:30px;height:30px;border-radius:7px;object-fit:cover;cursor:pointer;vertical-align:middle;margin-left:6px' });
  img.addEventListener('click', () => showPhoto(photo));
  return el('span', { style: 'white-space:nowrap' }, t, img);
}
// Vị trí của 1 giờ chấm (ngay dưới giờ): Trong VP / Ngoài 2.1 km + định vị đã so + nút mở Google Maps đúng chỗ điện thoại chấm.
// Định vị đã so = định vị GẦN NHẤT mà NV được phép chấm. Lượt quẹt máy (không có GPS) → không hiện gì.
function geoBlock(g, t) {
  if (!g || g.lat == null || g.lng == null) return null;
  const la = Number(g.lat), ln = Number(g.lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  const ll = la.toFixed(6) + ',' + ln.toFixed(6);
  return el('div', { style: 'margin-top:5px;line-height:1.4' },
    g.out ? el('span', { class: 'pill bad', style: 'white-space:nowrap' }, 'Ngoài ' + humanDistance(g.dist))
          : el('span', { class: 'pill ok', style: 'white-space:nowrap' }, 'Trong VP'),
    g.office ? el('div', { style: 'color:#999;font-size:12px;white-space:nowrap' }, (g.out ? 'so với ' : '') + g.office) : null,
    el('div', {}, el('a', {
      href: 'https://www.google.com/maps/search/?api=1&query=' + ll, target: '_blank', rel: 'noopener', style: 'font-size:12px;white-space:nowrap',
      title: 'Mở Google Maps đúng chỗ điện thoại chấm' + (t ? ' lúc ' + t : '') + ' (' + la.toFixed(6) + ', ' + ln.toFixed(6) + ')',
    }, '🗺 Xem chỗ chấm')));
}
function rowToday(r, np = 1) {
  const list = rowPunches(r);
  const multi = (r.punches_hm || []).length > 2;
  // cặp i = [lượt vào, lượt ra]; dòng 1–2 lần chấm: Vào = giờ vào, Ra = giờ ra (quên chấm vào thì chỉ có giờ ra)
  const pairs = multi ? Array.from({ length: Math.ceil(list.length / 2) }, (_, i) => [list[2 * i], list[2 * i + 1]])
    : [[list.find(p => p.label === 'Vào'), list.find(p => p.label === 'Ra')]];
  const cell = (p, star) => el('td', {}, el('div', { style: 'white-space:nowrap' }, punchTime(p.t, p.photo), star || ''), geoBlock(p.geo, p.t));
  const inCell = (p, star) => (p ? cell(p, star) : el('td', {}, '—'));
  const outCell = (p, star) => (p ? cell(p, star) : el('td', {}, el('span', { class: 'pill muted' }, 'chưa ra')));
  // ảnh đã hiện cạnh giờ thì cột Ảnh vào / Ảnh ra không hiện lặp lại
  const inline = new Set(list.map(p => p.photo).filter(Boolean));
  const sidePhoto = (src) => photoCell(src && !inline.has(src) ? src : null);
  const extra = [];
  for (let i = 1; i < np; i++) { const p = pairs[i]; extra.push(p ? inCell(p[0]) : el('td', {}, ''), p ? outCell(p[1]) : el('td', {}, '')); }
  // * cạnh đúng giờ sửa / thêm tay (man_in / man_out); không rõ ô nào → cạnh giờ vào như cũ
  const mkStar = () => el('span', { style: 'color:var(--brand);font-weight:700', title: 'Giờ sửa/thêm bằng tay' }, ' *');
  const sides = r.man_in || r.man_out;
  const star = r.manual && (sides ? r.man_in : r.check_in_hm) ? mkStar() : null;
  const starOut = r.manual && sides && r.man_out && !multi ? mkStar() : null;   // nhiều cặp: ô Ra đầu không phải giờ ra của dòng
  return el('tr', {},
    el('td', {}, sidePhoto(r.check_in_photo)),
    el('td', {}, el('b', {}, r.full_name), el('div', { style: 'color:#999;font-size:12px' }, r.code)),
    el('td', {}, r.department || '—'),
    ...(hourlyMode() ? [] : [el('td', {}, r.late_min > 0 ? el('span', { class: 'pill warn' }, r.late_min + 'p') : '—')]),
    inCell(pairs[0][0], star),
    outCell(pairs[0][1], starOut),
    ...extra,
    el('td', {}, sidePhoto(r.check_out_photo)),
    el('td', {}, humanMinutes(r.work_minutes)),
  );
}

// Popup "Chấm ngoài VP": mỗi giờ ngoài định vị 1 dòng — "Vào 09:47 · ngoài 2.1 km (so với VP Chính)"
function outsideText(r) {
  return rowPunches(r).filter(p => p.geo && p.geo.out)
    .map(p => `${p.label} ${p.t} · ngoài ${humanDistance(p.geo.dist)}` + (p.geo.office ? ` (so với ${p.geo.office})` : '')).join('\n');
}
