/* ---------- 4) CHI NHÁNH ---------- */
let _officesShowHidden = false;
async function pageOffices() {
  const addBtn = hasPerm('offices') ? el('button', { class: 'btn' }, '+ Thêm chi nhánh') : null;
  setMain(head('Chi nhánh / Vị trí', addBtn), loading());
  const { rows } = await api('/admin/offices');
  const hidden = rows.filter(x => !x.active);
  const toggleBtn = hidden.length ? el('button', { class: 'btn ghost sm' },
    _officesShowHidden ? '🙈 Ẩn chi nhánh đã tắt' : `👁 Hiện chi nhánh đã tắt (${hidden.length})`) : null;
  if (toggleBtn) toggleBtn.onclick = () => { _officesShowHidden = !_officesShowHidden; pageOffices(); };
  const list = _officesShowHidden ? rows : rows.filter(x => x.active);
  const tbl = el('table', { class: 'data' });
  tbl.innerHTML = `<thead><tr><th>Tên</th><th>Địa chỉ</th><th>Toạ độ</th><th>Bán kính</th><th>Bản đồ</th><th>TT</th><th></th></tr></thead>`;
  const tb = el('tbody');
  for (const o of list) {
    const acts = !hasPerm('offices') ? '' : (o.active
      ? el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' },
          btnSm('👥 Nhân viên', () => officeEmpModal(o)),
          btnSm('Sửa', () => officeModal(o)),
          (() => { const d = btnSm('🗑 Xoá', () => delOffice(o), 'ghost'); d.style.color = '#c0392b'; return d; })())
      : el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' },
          btnSm('↩ Mở lại', () => reopenOffice(o), 'ghost'),
          btnSm('👥 Nhân viên', () => officeEmpModal(o)),
          (() => { const d = btnSm('🗑 Xoá hẳn', () => delOfficeForce(o), 'ghost'); d.style.color = '#c0392b'; return d; })()));
    tb.append(el('tr', o.active ? {} : { style: 'opacity:.6' },
      el('td', {}, el('b', {}, o.name)),
      el('td', {}, o.address || '—'),
      el('td', {}, `${o.lat.toFixed(5)}, ${o.lng.toFixed(5)}`),
      el('td', {}, o.radius_m + ' m'),
      el('td', {}, el('a', { href: `https://www.google.com/maps?q=${o.lat},${o.lng}`, target: '_blank' }, 'Xem')),
      el('td', {}, o.active ? el('span', { class: 'pill ok' }, 'Bật') : el('span', { class: 'pill bad' }, 'Đã tắt')),
      el('td', {}, acts),
    ));
  }
  tbl.append(tb);
  if (addBtn) addBtn.onclick = () => officeModal(null);
  const headArgs = ['Chi nhánh / Vị trí', addBtn, toggleBtn].filter(Boolean);
  setMain(head(...headArgs), el('div', { class: 'panel tbl-scroll' }, tbl));
}
// Xoá chi nhánh: chưa dùng → xoá hẳn; còn NV/lịch sử → tắt (ẩn khỏi danh sách, giữ dữ liệu)
async function delOffice(o) {
  if (!confirm(`Xoá chi nhánh "${o.name}"?`)) return;
  try {
    const r = await api('/admin/offices/' + o.id, { method: 'DELETE' });
    toast(r.hard ? 'Đã xoá chi nhánh' : `Chi nhánh ${r.reason} nên đã TẮT. Bấm "Hiện chi nhánh đã tắt" để xoá hẳn.`, 'ok');
    pageOffices();
  } catch (e) { toast(e.message, 'err'); }
}
// Xoá HẲN chi nhánh đã tắt: gỡ mọi gán NV + bỏ liên kết lịch sử chấm rồi xoá khỏi CSDL
async function delOfficeForce(o) {
  if (!confirm(`XOÁ HẲN chi nhánh "${o.name}" khỏi hệ thống?\n\nSẽ gỡ chi nhánh này khỏi mọi nhân viên và bỏ liên kết ở lịch sử chấm công cũ (giữ giờ chấm, chỉ mất tên định vị). Không khôi phục được.`)) return;
  try {
    await api('/admin/offices/' + o.id + '?force=1', { method: 'DELETE' });
    toast('Đã xoá hẳn chi nhánh', 'ok');
    pageOffices();
  } catch (e) { toast(e.message, 'err'); }
}
// Mở lại chi nhánh đã tắt
async function reopenOffice(o) {
  try {
    await api('/admin/offices/' + o.id, { method: 'PUT', body: { name: o.name, address: o.address, lat: o.lat, lng: o.lng, radius_m: o.radius_m, active: 1 } });
    toast('Đã mở lại chi nhánh', 'ok');
    pageOffices();
  } catch (e) { toast(e.message, 'err'); }
}

// Chọn nhân viên được phép chấm ở 1 định vị (quản lý từ phía định vị)
async function officeEmpModal(o) {
  const box = el('div', {}, loading());
  const deptSel = el('select', { style: 'min-width:170px' }, el('option', { value: '' }, '-- Tất cả phòng ban --'));
  const selAll = el('input', { type: 'checkbox', style: 'width:auto' });
  let ROWS = [];
  const render = () => {
    const dept = deptSel.value;
    const rows = ROWS.filter((r) => !dept || r.department === dept);
    box.innerHTML = '';
    if (!rows.length) { box.append(el('div', { class: 'map-hint' }, 'Không có nhân viên.')); return; }
    for (const e of rows) {
      box.append(el('label', { style: 'display:flex;align-items:center;gap:8px;padding:5px 2px;border-bottom:1px solid #f4f2ef;font-weight:500;color:var(--ink)' },
        el('input', { type: 'checkbox', class: 'oe-pick', value: e.id, style: 'width:auto', ...(e.picked ? { checked: '' } : {}) }),
        el('span', { style: 'flex:1' }, `${e.full_name} (${e.code})${e.department ? ' · ' + e.department : ''}`),
        e.anywhere ? el('span', { style: 'font-size:11px;color:#0a7' }, 'đang: mọi định vị') : ''));
    }
  };
  const save = el('button', { class: 'btn' }, '💾 Lưu');
  save.onclick = async () => {
    const ids = [...box.querySelectorAll('.oe-pick:checked')].map((x) => +x.value);
    save.disabled = true;
    try { const r = await api('/admin/offices/' + o.id + '/employees', { method: 'POST', body: { employee_ids: ids } }); toast(`Đã lưu ${r.count} NV cho định vị này`, 'ok'); closeModal(); }
    catch (e) { toast(e.message, 'err'); save.disabled = false; }
  };
  openModal('Nhân viên chấm ở: ' + o.name, [
    el('div', { class: 'map-hint' }, 'Tích các NV được phép chấm ở định vị này. NV được tích ở BẤT KỲ định vị nào sẽ CHỈ chấm được ở các định vị đã tích; NV không tích ở đâu = chấm được MỌI định vị.'),
    el('div', { style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px' },
      el('label', { style: 'display:flex;align-items:center;gap:6px;font-weight:600;color:var(--ink)' }, selAll, 'Chọn tất cả'), deptSel),
    box,
  ], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Huỷ'), save]);
  try {
    ROWS = (await api('/admin/offices/' + o.id + '/employees')).rows;
    const depts = [...new Set(ROWS.map((r) => r.department).filter(Boolean))].sort();
    for (const d of depts) deptSel.append(el('option', { value: d }, d));
  } catch (e) { box.innerHTML = ''; box.append(el('div', { class: 'empty' }, e.message)); return; }
  deptSel.onchange = render;
  selAll.onchange = () => { box.querySelectorAll('.oe-pick').forEach((c) => { c.checked = selAll.checked; }); };
  render();
}
// Ghép nhãn hiển thị từ 1 kết quả Photon
function photonLabel(p) {
  const head = [p.housenumber, p.street].filter(Boolean).join(' ') || p.name;
  return [head, p.district, p.city || p.county, p.state].filter(Boolean).join(', ') || (p.name || '');
}
// Tìm địa chỉ qua Photon (OpenStreetMap), ưu tiên quanh (lat,lon) như Google
// Ưu tiên quanh vị trí bản đồ đang xem (bias mềm, KHÔNG chặn cứng để vẫn ra đa dạng cả nước)
function biasFromMap(map) {
  const c = map.getCenter();
  return { lat: c.lat, lon: c.lng };
}
// Chuẩn hoá tên phố kiểu ngày tháng của VN: "8-3"/"8/3" -> "8 tháng 3" (Google tự hiểu, OSM thì không)
function normalizeViQuery(q) {
  if (/tháng/i.test(q)) return q;
  return q.replace(/\b(\d{1,2})[-/](\d{1,2})\b/, (m, a, b) => {
    const A = +a, B = +b;
    return (A >= 1 && A <= 31 && B >= 1 && B <= 12) ? `${A} tháng ${B}` : m;
  });
}
async function photonSearch(q, opts = {}, limit = 8) {
  const { lat, lon, bbox } = opts;
  let url = 'https://photon.komoot.io/api/?lang=default&limit=' + limit + '&q=' + encodeURIComponent(q);
  if (lat != null && lon != null) url += '&lat=' + lat + '&lon=' + lon;
  if (bbox) url += '&bbox=' + bbox;
  const r = await fetch(url);
  const j = await r.json().catch(() => ({ features: [] }));
  return (j.features || [])
    .filter((f) => f.geometry && f.geometry.coordinates && f.properties && f.properties.countrycode === 'VN')
    .map((f) => ({ lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], name: photonLabel(f.properties || {}) }));
}
// Trộn xen kẽ nhiều danh sách + loại trùng
function mergeUnique(lists, max = 10) {
  const seen = new Set(), out = [];
  const maxLen = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < maxLen && out.length < max; i++) {
    for (const list of lists) {
      const it = list[i]; if (!it) continue;
      const key = it.name + '|' + it.lat.toFixed(4) + ',' + it.lng.toFixed(4);
      if (seen.has(key)) continue;
      seen.add(key); out.push(it);
      if (out.length >= max) break;
    }
  }
  return out;
}
async function geocodeAddress(q, opts = {}) {
  const norm = normalizeViQuery(q);
  let arr = await photonSearch(norm, opts, 1);
  if (!arr.length && norm !== q) arr = await photonSearch(q, opts, 1);
  if (!arr.length) throw new Error('Không tìm thấy địa chỉ này');
  return arr[0];
}

function officeModal(o) {
  const nameI = input('o-name', { value: o?.name || '', placeholder: 'Văn phòng chính' });
  const addrI = input('o-addr', { value: o?.address || '', placeholder: 'VD: 8 Tôn Thất Thuyết, Cầu Giấy, Hà Nội' });
  const latI = input('o-lat', { type: 'number', step: 'any', value: o?.lat ?? '' });
  const lngI = input('o-lng', { type: 'number', step: 'any', value: o?.lng ?? '' });
  const radiusI = input('o-radius', { type: 'number', value: o?.radius_m ?? 200, min: 20 });
  const searchBtn = el('button', { class: 'btn' }, 'Tìm');
  const acList = el('div', { class: 'ac-list hidden' });
  const gpsBtn = el('button', { class: 'btn ghost sm block' }, '📍 Lấy vị trí hiện tại của tôi');
  const mapDiv = el('div', { id: 'office-map', class: 'map-box' });

  const body = [
    field('Tên chi nhánh *', nameI),
    el('div', {},
      el('label', {}, 'Địa chỉ (gõ để hiện gợi ý, chọn 1 dòng là bản đồ nhảy tới)'),
      el('div', { class: 'ac-wrap' }, el('div', { class: 'map-search' }, addrI, searchBtn), acList)),
    el('div', { class: 'two-col' }, field('Vĩ độ (lat) *', latI), field('Kinh độ (lng) *', lngI)),
    field('Bán kính cho phép chấm công (m)', radiusI),
    gpsBtn,
    el('div', {},
      el('div', { class: 'map-hint' }, 'Kéo chấm đỏ hoặc bấm lên bản đồ để chọn đúng vị trí. Vòng tròn cam = phạm vi cho phép chấm công.'),
      mapDiv),
  ];

  const save = el('button', { class: 'btn' }, 'Lưu');
  save.onclick = async () => {
    const b = { name: nameI.value.trim(), address: addrI.value, lat: +latI.value, lng: +lngI.value, radius_m: +radiusI.value || 200 };
    if (!b.name || !b.lat || !b.lng) return toast('Nhập tên và toạ độ', 'err');
    try {
      if (o) await api('/admin/offices/' + o.id, { method: 'PUT', body: b });
      else await api('/admin/offices', { method: 'POST', body: b });
      toast('Đã lưu', 'ok'); closeModal(); pageOffices();
    } catch (err) { toast(err.message, 'err'); }
  };
  openModal(o ? 'Sửa chi nhánh' : 'Thêm chi nhánh', body, [el('button', { class: 'btn ghost', onclick: closeModal }, 'Huỷ'), save]);

  // Khởi tạo bản đồ sau khi modal đã hiển thị
  setTimeout(() => initOfficeMap({ o, mapDiv, latI, lngI, radiusI, addrI, gpsBtn, searchBtn, acList }), 60);
}

async function geocodeSuggest(q, opts = {}) {
  const norm = normalizeViQuery(q);
  const qs = norm !== q ? [norm, q] : [q];   // tìm cả nghĩa "8 Tháng 3" lẫn "8/3" gốc
  const lists = await Promise.all(qs.map((x) => photonSearch(x, opts, 8)));
  return mergeUnique(lists, 10);
}

function initOfficeMap({ o, mapDiv, latI, lngI, radiusI, addrI, gpsBtn, searchBtn, acList }) {
  if (typeof L === 'undefined') { mapDiv.innerHTML = '<div class="empty">Không tải được bản đồ (cần internet).</div>'; return; }
  L.Icon.Default.imagePath = '/vendor/leaflet/images/';
  const lat0 = Number(o?.lat) || 21.027764;   // mặc định: Hà Nội
  const lng0 = Number(o?.lng) || 105.834160;
  if (!latI.value) latI.value = lat0.toFixed(6);
  if (!lngI.value) lngI.value = lng0.toFixed(6);

  const map = L.map(mapDiv).setView([lat0, lng0], o?.lat ? 16 : 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap',
  }).addTo(map);

  const marker = L.marker([lat0, lng0], { draggable: true }).addTo(map);
  const circle = L.circle([lat0, lng0], {
    radius: +radiusI.value || 200, color: '#E8541E', weight: 2, fillColor: '#E8541E', fillOpacity: 0.15,
  }).addTo(map);

  function setPos(la, ln, recenter) {
    latI.value = la.toFixed(6); lngI.value = ln.toFixed(6);
    marker.setLatLng([la, ln]); circle.setLatLng([la, ln]);
    if (recenter) map.setView([la, ln], Math.max(map.getZoom(), 16));
  }
  marker.on('dragend', (e) => { const p = e.target.getLatLng(); setPos(p.lat, p.lng, false); });
  map.on('click', (e) => setPos(e.latlng.lat, e.latlng.lng, false));
  radiusI.addEventListener('input', () => circle.setRadius(+radiusI.value || 200));
  const syncFromInputs = () => { const la = +latI.value, ln = +lngI.value; if (la && ln) setPos(la, ln, true); };
  latI.addEventListener('change', syncFromInputs);
  lngI.addEventListener('change', syncFromInputs);

  gpsBtn.onclick = () => navigator.geolocation.getCurrentPosition(
    (p) => { setPos(p.coords.latitude, p.coords.longitude, true); toast('Đã lấy vị trí hiện tại', 'ok'); },
    () => toast('Không lấy được vị trí (cần HTTPS + quyền)', 'err'), { enableHighAccuracy: true });

  async function doSearch() {
    const q = addrI.value.trim(); if (!q) return;
    searchBtn.disabled = true; searchBtn.textContent = '…';
    try { const g = await geocodeAddress(q, biasFromMap(map)); setPos(g.lat, g.lng, true); }
    catch (e) { toast(e.message, 'err'); }
    finally { searchBtn.disabled = false; searchBtn.textContent = 'Tìm'; }
  }
  searchBtn.onclick = doSearch;

  // Gợi ý địa chỉ tức thì (như Google Maps)
  let acTimer = null, acSeq = 0;
  const hideAc = () => { if (acList) { acList.classList.add('hidden'); acList.innerHTML = ''; } };
  addrI.addEventListener('input', () => {
    clearTimeout(acTimer);
    const q = addrI.value.trim();
    if (q.length < 3) { hideAc(); return; }
    acTimer = setTimeout(async () => {
      const seq = ++acSeq;
      acList.innerHTML = '<div class="ac-loading">Đang tìm…</div>';
      acList.classList.remove('hidden');
      let items = [];
      try { items = await geocodeSuggest(q, biasFromMap(map)); } catch {}
      if (seq !== acSeq) return;              // bỏ kết quả cũ
      if (!items.length) { acList.innerHTML = '<div class="ac-loading">Không có gợi ý phù hợp</div>'; return; }
      acList.innerHTML = '';
      for (const it of items) {
        const row = el('div', { class: 'ac-item' }, el('span', { class: 'ac-ic' }, '📍'), el('span', {}, it.name));
        row.addEventListener('mousedown', (e) => {   // mousedown để chạy trước blur
          e.preventDefault();
          addrI.value = it.name;
          setPos(it.lat, it.lng, true);
          hideAc();
        });
        acList.append(row);
      }
    }, 450);
  });
  addrI.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); hideAc(); doSearch(); } });
  addrI.addEventListener('blur', () => setTimeout(hideAc, 150));

  setTimeout(() => map.invalidateSize(), 80);
}

