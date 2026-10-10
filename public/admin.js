import {
  api, getToken, setToken, clearToken, toast, $, el,
  isoToHM, isoToHMS, humanMinutes, humanDistance, todayMonth, ensureLicensed,
} from '/common.js';

let ME = null;
let SETTINGS = {};        // cache cấu hình (attendance_mode, geofence…)
// [key, icon, label, quyền cần có để thấy mục này]
const NAV = [
  ['dashboard', '📊', 'Tổng quan', 'reports'],
  ['employees', '👥', 'Nhân viên', 'employees'],
  ['org', '🏢', 'Bộ phận', 'departments'],
  ['shifts', '🕐', 'Ca làm', 'shifts'],
  ['assignments', '🗓️', 'Phân ca', 'assignments'],
  ['shiftreq', '🙋', 'Duyệt chọn ca', 'shift_requests'],
  ['devreq', '📱', 'Duyệt đổi thiết bị', 'employees'],
  ['editatt', '🧮', 'Tính công', 'attendance_edit'],
  ['devices', '🔌', 'Máy chấm công', 'devices'],
  ['offices', '📍', 'Chi nhánh', 'offices'],
  ['leaves', '📝', 'Đơn từ', 'leaves'],
  ['salary', '💰', 'Lương', 'salary'],
  ['report', '📅', 'Báo cáo', 'reports'],
  ['logs', '🧾', 'Nhật ký', 'logs'],
  ['settings', '⚙️', 'Cài đặt', 'settings'],
];
const isMaster = () => ME?.role === 'master';                 // tài khoản tổng (Anh)
const isAdmin = () => ME?.role === 'admin' || isMaster();     // master có mọi quyền admin
const hasPerm = (key) => isAdmin() || (ME?.permissions || []).includes(key);
const hourlyMode = () => (SETTINGS.any_shift != null ? !SETTINGS.any_shift : SETTINGS.attendance_mode === 'hourly');
// Công ty có CẢ nhân viên chấm theo ca lẫn theo giờ
const mixedMode = () => !!(SETTINGS.any_shift && SETTINGS.any_hourly);
const ATT_MODE_LABEL = { '': 'Theo cài đặt chung của công ty', shift: '🕐 Theo ca làm việc', hourly: '⏱️ Theo giờ (làm bao nhiêu tính bấy nhiêu)' };
const deviceEnabled = () => SETTINGS.device_enabled === '1';
const deviceLockEnabled = () => SETTINGS.device_lock_enabled === '1';
const selfShiftEnabled = () => SETTINGS.self_shift_enabled === '1';
// Quyền mặc định của "Quản lý" khi chưa cấu hình riêng (khớp server)
const MANAGER_DEFAULT = ['reports', 'employees', 'shifts', 'assignments', 'shift_requests', 'offices', 'departments', 'leaves', 'attendance_edit', 'devices', 'holidays', 'recompute'];

/* ---------- Init ---------- */
init();
// Logo + tên công ty của khách (công khai, hiện được cả trước khi đăng nhập/kích hoạt)
async function applyBrand() {
  try {
    const b = await fetch('/api/brand').then((r) => r.json());
    const name = b.company_name || 'Digiplus';
    document.querySelectorAll('#brand-mark').forEach((e) => { e.textContent = name; });
    document.title = name + ' — Quản lý chấm công';
    if (b.logo) document.querySelectorAll('.login-logo-img').forEach((img) => { img.src = b.logo; });
  } catch {}
}
async function init() {
  await applyBrand();
  if (!(await ensureLicensed())) return; // chưa kích hoạt bản quyền → hiện màn kích hoạt
  try {
    const c = await api('/config');
    $('#brand-mark').textContent = c.company_name;
    let ver = '';
    try { ver = (await fetch('/api/version').then(r => r.json())).version; } catch {}
    $('#side-brand').innerHTML = `${c.company_name}<small>Chấm công${ver ? ' · v' + ver : ''}</small>`;
  } catch {}
  if (getToken()) { try { const r = await api('/auth/me'); ME = r.user; return afterLogin(); } catch { clearToken(); } }
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#li-btn'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
  try {
    const r = await api('/auth/login', { method: 'POST', body: { username: $('#li-user').value, password: $('#li-pass').value } });
    ME = r.user;
    if (ME.role === 'employee') { toast('Tài khoản nhân viên — vui lòng dùng app chấm công', 'err'); btn.disabled = false; btn.textContent = 'Đăng nhập'; return; }
    setToken(r.token); afterLogin();
  } catch (err) { toast(err.message, 'err'); btn.disabled = false; btn.textContent = 'Đăng nhập'; }
});
$('#btn-logout').addEventListener('click', () => { clearToken(); location.reload(); });

async function afterLogin() {
  if (ME.role === 'employee') { location.href = '/'; return; }
  $('#login-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  $('#me-name').textContent = ME.full_name;
  $('#me-role').textContent = ME.role === 'admin' ? 'Quản trị viên' : 'Quản lý';
  try { SETTINGS = await api('/admin/settings'); } catch { SETTINGS = {}; }
  try { PERM_CATALOG = (await api('/admin/perm-catalog')).permissions; } catch { PERM_CATALOG = []; }
  const nav = $('#nav'); nav.innerHTML = '';
  const visible = NAV.filter(([key, , , perm]) => hasPerm(perm)
    && !(hourlyMode() && (key === 'shifts' || key === 'assignments' || key === 'shiftreq'))
    && !(key === 'devices' && !deviceEnabled())
    && !(key === 'devreq' && !deviceLockEnabled())
    && !(key === 'shiftreq' && !selfShiftEnabled()));
  visible.forEach(([key, ic, label]) => {
    const b = el('button', { 'data-k': key }, el('span', {}, ic), label);
    // Mục có MENU CON (kiểu ZKBio): bấm mũi tên hoặc bấm mục để xổ ra / thu lại
    const SUB = key === 'assignments' ? { id: 'nav-sub-as', tabs: AS_TABS, isOpen: () => _asNavOpen, setOpen: (o) => { _asNavOpen = o; }, pick: (tab) => { if (!asLeaveOk()) return false; _asTab = tab; _asAdd = null; return true; } }
      : key === 'shifts' ? { id: 'nav-sub-sh', tabs: SH_TABS, isOpen: () => _shNavOpen, setOpen: (o) => { _shNavOpen = o; }, pick: (tab) => { _shView = tab; _schEdit = null; return true; } }
        : null;
    if (SUB) {
      const arrow = el('span', { class: 'nav-arrow', title: 'Mở / thu menu con' }, SUB.isOpen() ? '▾' : '▸');
      b.append(el('span', { style: 'flex:1' }), arrow);
      const subBox = el('div', { class: 'nav-sub', id: SUB.id, style: SUB.isOpen() ? '' : 'display:none' });
      const setOpen = (o) => { SUB.setOpen(o); arrow.textContent = o ? '▾' : '▸'; subBox.style.display = o ? '' : 'none'; };
      arrow.addEventListener('click', (ev) => { ev.stopPropagation(); setOpen(!SUB.isOpen()); });
      b.addEventListener('click', () => { if (!SUB.isOpen()) setOpen(true); else if (b.classList.contains('active')) { setOpen(false); return; } go(key); });
      for (const [tab, sublabel] of SUB.tabs) {
        const sb = el('button', { class: 'nav-sub-btn', 'data-as': tab }, sublabel);
        sb.addEventListener('click', () => { if (SUB.pick(tab)) go(key); });
        subBox.append(sb);
      }
      nav.append(b, subBox);
      return;
    }
    b.addEventListener('click', () => go(key));
    nav.append(b);
  });
  // Lần đầu khởi tạo: Admin chọn kiểu chấm công + phạm vi
  if (isAdmin() && SETTINGS.setup_done !== '1') { setupWizard(); return; }
  if (visible.length) go(visible[0][0]);
  else setMain(el('div', { class: 'empty' }, 'Tài khoản của bạn chưa được cấp quyền dùng chức năng nào. Vui lòng liên hệ quản trị viên.'));
  checkUpdateBanner();   // báo khi có bản mới
}

// Banner nhắc cập nhật khi GitHub có bản mới hơn (chỉ admin) — tránh khách quên update rồi lỗi
async function checkUpdateBanner() {
  if (!isAdmin()) return;
  let r; try { r = await api('/admin/update/check'); } catch { return; }
  if (!r || !r.hasUpdate) return;
  const old = document.getElementById('upd-banner'); if (old) old.remove();
  const goBtn = el('button', { class: 'btn sm' }, '⬆ Cập nhật ngay');
  const laterBtn = el('button', { class: 'btn sm ghost' }, 'Để sau');
  laterBtn.onclick = () => banner.remove();
  goBtn.onclick = async () => {
    if (!confirm(`Cập nhật lên bản ${r.latest} ngay bây giờ?\nApp sẽ tự khởi động lại (khoảng 1 phút). Dữ liệu giữ nguyên và tự sao lưu trước.`)) return;
    goBtn.disabled = laterBtn.disabled = true; goBtn.textContent = 'Đang cập nhật…';
    try {
      const res = await api('/admin/update/apply', { method: 'POST' });
      if (res && res.ok === false) { // đang là bản mới nhất rồi
        txt.textContent = '✓ Máy đã ở bản mới nhất. Hãy tải lại trang (F5).'; goBtn.style.display = 'none'; laterBtn.disabled = false; laterBtn.textContent = 'Đóng'; return;
      }
      txt.textContent = `⏳ Đang tải & cài bản ${res.latest || r.latest}. App sẽ tự khởi động lại — vui lòng đợi, KHÔNG tắt máy…`;
      laterBtn.style.display = 'none';
      // Đợi app khởi động lại xong (đổi version) rồi tự tải lại trang
      const started = Date.now();
      const timer = setInterval(async () => {
        try {
          const v = await fetch('/api/version', { cache: 'no-store' }).then((x) => x.json());
          if (v && v.version && v.version !== r.current) { clearInterval(timer); location.reload(); return; }
        } catch { /* app đang restart, bỏ qua */ }
        if (Date.now() - started > 120000) { clearInterval(timer); txt.textContent = '✓ Đã gửi lệnh cập nhật. Nếu chưa đổi, hãy tải lại trang (F5) sau ít phút.'; }
      }, 4000);
    } catch (e) {
      toast(e.message, 'err'); goBtn.disabled = laterBtn.disabled = false; goBtn.textContent = '⬆ Cập nhật ngay';
    }
  };
  const txt = el('span', { style: 'flex:1;min-width:220px' }, `Đã có bản mới ${r.latest} (đang dùng ${r.current}). Nên cập nhật để có tính năng mới & tránh lỗi.`);
  const banner = el('div', { id: 'upd-banner', style: 'grid-column:1 / -1;background:linear-gradient(90deg,#fef3c7,#fde68a);color:#92400e;padding:12px 20px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;border-bottom:1px solid #f0d98a;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,.06)' },
    el('span', { style: 'font-size:20px;line-height:1' }, '🔔'),
    txt,
    el('div', { style: 'display:flex;gap:8px;flex-shrink:0' }, goBtn, laterBtn));
  const appView = $('#app-view'); appView.insertBefore(banner, appView.firstChild);
}
function go(key) {
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.k === key));
  ({ dashboard: pageDashboard, employees: pageEmployees, org: pageOrg, shifts: pageShifts, assignments: pageAssignments, shiftreq: pageShiftReq, devreq: pageDevReq, editatt: pageEditAtt, devices: pageDevices, offices: pageOffices, leaves: pageLeaves, salary: pageSalary, report: pageReport, logs: pageLogs, settings: pageSettings }[key])();
}

/* ---------- Lựa chọn phụ khi chấm "Theo giờ": đầu–cuối (FILO) / theo cặp vào–ra ----------
 * Chỉ hiện khi radio "Theo giờ" đang được chọn. Trả { box, value(), sync() }. */
function hourlyRulePicker(name, current, hourlyRadio, radios) {
  const rFilo = el('input', { type: 'radio', name, value: 'filo', style: 'width:auto', ...(current !== 'pairs' ? { checked: '' } : {}) });
  const rPairs = el('input', { type: 'radio', name, value: 'pairs', style: 'width:auto', ...(current === 'pairs' ? { checked: '' } : {}) });
  const sub = (radio, title, desc) => el('label', { style: 'display:flex;gap:8px;align-items:flex-start;padding:8px 10px;border:1px solid var(--line,#eee);border-radius:10px;cursor:pointer;background:var(--surface,#fff)' },
    radio, el('div', {}, el('b', { style: 'font-size:14px' }, title), el('div', { style: 'font-size:12.5px;color:var(--muted)' }, desc)));
  const box = el('div', { style: 'display:flex;flex-direction:column;gap:6px;margin:-2px 0 0 28px' },
    el('div', { style: 'font-size:12.5px;color:var(--muted)' }, 'Khi một ngày chấm nhiều lần, tính giờ làm theo:'),
    sub(rFilo, 'Đầu – cuối (FILO)', 'Từ lần chấm đầu đến lần chấm cuối trong ngày.'),
    sub(rPairs, 'Theo cặp vào / ra', 'Chấm 1–2 là một cặp, 3–4 là cặp tiếp…; giờ làm = tổng các cặp, thời gian ra ngoài bị trừ.'));
  const sync = () => { box.style.display = hourlyRadio.checked ? 'flex' : 'none'; };
  for (const r of radios) r.addEventListener('change', sync);
  sync();
  return { box, value: () => (rPairs.checked ? 'pairs' : 'filo') };
}

/* ---------- Thiết lập lần đầu ---------- */
function setupWizard() {
  const mShift = el('input', { type: 'radio', name: 'sw-mode', value: 'shift', checked: '', style: 'width:auto' });
  const mHourly = el('input', { type: 'radio', name: 'sw-mode', value: 'hourly', style: 'width:auto' });
  const swRule = hourlyRulePicker('sw-hrule', 'filo', mHourly, [mShift, mHourly]);
  const geo = el('input', { type: 'checkbox', id: 'sw-geo', style: 'width:auto' });
  const opt = (radio, title, desc) => el('label', { style: 'display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid var(--line,#e5e5e5);border-radius:12px;cursor:pointer' },
    radio, el('div', {}, el('b', {}, title), el('div', { style: 'font-size:13px;color:var(--muted)' }, desc)));
  const body = [
    el('p', { style: 'color:var(--muted);margin-top:0' }, 'Chọn cách doanh nghiệp của bạn muốn chấm công. Có thể đổi lại sau trong Cài đặt.'),
    el('div', { style: 'display:flex;flex-direction:column;gap:10px' },
      opt(mShift, '🕐 Theo ca làm việc', 'Có khai báo ca, tính đi muộn / về sớm / tăng ca và báo cáo đầy đủ. Phù hợp văn phòng, nhà máy.'),
      opt(mHourly, '⏱️ Chỉ tính công theo giờ', 'Không cần ca, chỉ tính tổng giờ làm để trả lương theo giờ. Đơn giản cho cửa hàng, quán ăn.'),
      swRule.box,
      el('label', { style: 'display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px dashed var(--line,#e5e5e5);border-radius:12px;cursor:pointer;margin-top:4px' },
        geo, el('div', {}, el('b', {}, 'Chỉ cho chấm trong bán kính chi nhánh (GPS)'),
          el('div', { style: 'font-size:13px;color:var(--muted)' }, 'Bật nếu muốn nhân viên phải có mặt tại văn phòng mới chấm được. Bỏ trống = chấm tự do mọi nơi.')))),
  ];
  const save = el('button', { class: 'btn' }, 'Bắt đầu sử dụng →');
  save.onclick = async () => {
    const attendance_mode = document.querySelector('input[name=sw-mode]:checked')?.value === 'hourly' ? 'hourly' : 'shift';
    const hourly_merge_rule = swRule.value();
    save.disabled = true;
    try {
      await api('/admin/settings', { method: 'PUT', body: { attendance_mode, hourly_merge_rule, geofence_enforce: geo.checked, setup_done: true } });
      closeModal(); location.reload();
    } catch (e) { toast(e.message, 'err'); save.disabled = false; }
  };
  openModal('👋 Chào mừng đến Digiplus Chấm Công', body, [save]);
}

/* ---------- Helpers ---------- */
function head(title, ...tools) {
  return el('div', { class: 'page-head' }, el('h2', {}, title), el('div', { class: 'toolbar' }, ...tools));
}
function setMain(...nodes) { document.body.classList.remove('as-full'); const m = $('#main'); m.innerHTML = ''; nodes.forEach(n => n && m.append(n)); }
function loading() { return el('div', { class: 'empty' }, 'Đang tải…'); }

function openModal(title, bodyNodes, footNodes) {
  const modal = $('#modal');
  modal.innerHTML = '';
  const close = el('button', { class: 'x-close' }, '×'); close.onclick = closeModal;
  modal.append(el('div', { class: 'm-head' }, el('h3', {}, title), close));
  modal.append(el('div', { class: 'm-body' }, ...bodyNodes));
  if (footNodes) modal.append(el('div', { class: 'm-foot' }, ...footNodes));
  $('#modal-bg').classList.add('show');
}
function closeModal() { $('#modal-bg').classList.remove('show'); }
// Chỉ đóng khi BẤM bắt đầu ngay trên nền tối (tránh: bôi đen trong ô rồi thả chuột ra nền → đóng nhầm)
let _mdOnBg = false;
$('#modal-bg').addEventListener('mousedown', (e) => { _mdOnBg = e.target.id === 'modal-bg'; });
$('#modal-bg').addEventListener('click', (e) => { if (e.target.id === 'modal-bg' && _mdOnBg) closeModal(); _mdOnBg = false; });

function showPhoto(src) { $('#lightbox-img').src = src; $('#lightbox').classList.add('show'); }
$('#lightbox').addEventListener('click', () => $('#lightbox').classList.remove('show'));
function photoCell(src) {
  if (!src) return el('span', { style: 'color:#bbb' }, '—');
  const img = el('img', { class: 'avatar', src });
  img.addEventListener('click', () => showPhoto(src));
  return img;
}
function field(label, input) { return el('div', {}, el('label', {}, label), input); }
function input(id, attrs = {}) { return el('input', { id, ...attrs }); }
// Ô nhập GIỜ 24h (HH:mm) — không phụ thuộc chế độ 12/24 của máy (tránh hiện SA/CH)
function time24(id, value = '') {
  const i = input(id, { value: value || '', placeholder: 'VD 08:00', inputmode: 'numeric', maxlength: 5, autocomplete: 'off' });
  i.addEventListener('input', () => {
    let v = i.value.replace(/[^\d]/g, '').slice(0, 4);
    if (v.length >= 3) v = v.slice(0, 2) + ':' + v.slice(2);
    i.value = v;
  });
  i.addEventListener('blur', () => {
    const t = i.value.trim(); if (!t) return;
    const m = /^(\d{1,2}):?(\d{0,2})$/.exec(t);
    const h = Math.min(23, parseInt((m && m[1]) || '0', 10) || 0);
    const mm = Math.min(59, parseInt((m && m[2]) || '0', 10) || 0);
    i.value = String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  });
  return i;
}

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
    const rep = await api('/reports/attendance?month=' + d.today.slice(0, 7));
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
    const tbl = el('table', { class: 'data' });
    tbl.innerHTML = `<thead><tr><th>Ảnh vào</th><th>Nhân viên</th><th>Bộ phận</th><th>Vào</th>${hourly ? '' : '<th>Muộn</th>'}<th>Vị trí</th><th>Ra</th><th>Ảnh ra</th><th>Giờ</th></tr></thead>`;
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
      if (!today.length) tb.append(el('tr', {}, el('td', { colspan: hourly ? 8 : 9 }, el('div', { class: 'empty' }, 'Không có ai chấm công ngày này.'))));
      for (const r of part) tb.append(rowToday(r));
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
function rowToday(r) {
  return el('tr', {},
    el('td', {}, photoCell(r.check_in_photo)),
    el('td', {}, el('b', {}, r.full_name), el('div', { style: 'color:#999;font-size:12px' }, r.code)),
    el('td', {}, r.department || '—'),
    el('td', {}, (r.check_in_hm || '—'), (r.manual && r.check_in_hm ? el('span', { style: 'color:var(--brand);font-weight:700', title: 'Giờ sửa/thêm bằng tay' }, ' *') : '')),
    ...(hourlyMode() ? [] : [el('td', {}, r.late_min > 0 ? el('span', { class: 'pill warn' }, r.late_min + 'p') : '—')]),
    el('td', {}, r.check_in_outside ? el('span', { class: 'pill bad' }, 'Ngoài ' + humanDistance(r.check_in_distance_m)) : el('span', { class: 'pill ok' }, 'Trong VP')),
    el('td', {}, r.check_out_hm || el('span', { class: 'pill muted' }, 'chưa ra')),
    el('td', {}, photoCell(r.check_out_photo)),
    el('td', {}, humanMinutes(r.work_minutes)),
  );
}

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
const empDeptClosed = new Set();
async function pageEmployees() {
  const addBtn = hasPerm('employees') ? el('button', { class: 'btn' }, '+ Thêm nhân viên') : null;
  const canEdit = hasPerm('employees');
  const tmplBtn = canEdit ? el('button', { class: 'btn ghost sm' }, '📄 Tải mẫu Excel') : null;
  const impAddBtn = canEdit ? el('button', { class: 'btn ghost sm' }, '⬆ Nhập thêm mới') : null;
  const impUpdBtn = canEdit ? el('button', { class: 'btn ghost sm' }, '🔄 Cập nhật từ Excel') : null;
  if (tmplBtn) tmplBtn.onclick = downloadEmpTemplate;
  if (impAddBtn) impAddBtn.onclick = () => importEmployees('add');
  if (impUpdBtn) impUpdBtn.onclick = () => importEmployees('update');
  // Làm mới danh sách (NV tải từ máy chấm công về không tự hiện, trước đây phải F5 cả trang)
  const refreshBtn = el('button', { class: 'btn ghost sm', title: 'Tải lại danh sách nhân viên' }, '↻ Làm mới');
  refreshBtn.onclick = () => pageEmployees();
  const headArgs = ['Nhân viên', refreshBtn, addBtn, tmplBtn, impAddBtn, impUpdBtn].filter(Boolean);
  setMain(head(...headArgs), loading());
  try {
    await loadRefs();
    const { rows } = await api('/admin/employees');
    if (addBtn) addBtn.onclick = () => empModal(null);
    const headArgs2 = ['Nhân viên (' + rows.length + ')', refreshBtn, addBtn, tmplBtn, impAddBtn, impUpdBtn].filter(Boolean);

    // ===== Cây BỘ PHẬN bên trái (bấm để lọc) + bảng nhân viên GỌN bên phải, xếp theo bộ phận =====
    const NONE = '\u0000none';                       // khoá cho NV chưa có bộ phận
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
    const orderOf = new Map(nodes.map((n, i) => [n.key, i]));

    const tree = el('div', { class: 'emp-tree' });
    const listBox = el('div', { class: 'panel tbl-scroll' });
    const searchI = el('input', { type: 'search', placeholder: '🔍 Tìm mã, tên, tài khoản…', value: empSearch, style: 'max-width:280px' });
    const countLbl = el('span', { style: 'font-size:12.5px;color:var(--muted)' });

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
      const list = rows.filter((e) => (!allow || allow.has(e.department || NONE))
        && (!q || [e.code, e.full_name, e.username, e.device_pin, e.position].some((v) => String(v || '').toLowerCase().includes(q))))
        .sort((x, y) => (orderOf.get(x.department || NONE) ?? 9999) - (orderOf.get(y.department || NONE) ?? 9999) || x.full_name.localeCompare(y.full_name, 'vi'));
      countLbl.textContent = list.length + ' nhân viên' + (sel ? ' · ' + sel.label : '');
      const tbl = el('table', { class: 'data emp-compact' });
      tbl.innerHTML = `<thead><tr><th>Mã</th><th>Họ tên</th><th>Chức danh</th><th>Tài khoản</th><th>Quyền</th><th>TT</th><th></th></tr></thead>`;
      const tb = el('tbody');
      let lastDept = null;
      for (const e of list) {
        const dk = e.department || NONE;
        if (dk !== lastDept) {   // dòng tiêu đề nhóm bộ phận
          lastDept = dk;
          const n = list.filter((x) => (x.department || NONE) === dk).length;
          tb.append(el('tr', { class: 'grp' }, el('td', { colspan: 7 }, (dk === NONE ? 'Chưa có bộ phận' : dk) + ' (' + n + ')')));
        }
        const delBtn = btnSm('🗑', () => delEmp(e), 'ghost'); delBtn.style.color = '#c0392b'; delBtn.title = 'Xóa nhân viên';
        const actions = hasPerm('employees') ? el('div', { style: 'display:flex;gap:4px;justify-content:flex-end' },
          btnSm('Sửa', () => empModal(e)),
          e.active ? btnSm('Khoá', () => toggleEmp(e), 'ghost') : btnSm('Mở khoá', () => unlockEmp(e), 'ghost'),
          delBtn) : '';
        tb.append(el('tr', {},
          el('td', {}, e.code,
            e.device_pin ? el('span', { style: 'color:#0a7;font-size:11px;margin-left:6px', title: 'Số ID trên máy chấm công' }, '🔌' + e.device_pin) : ''),
          el('td', {}, el('b', {}, e.full_name),
            e.from_device ? el('span', { class: 'pill warn', style: 'margin-left:6px', title: 'Tự tạo khi đăng ký vân tay trên máy — bổ sung thông tin rồi lưu' }, 'nháp từ máy') : '',
            (e.device_admin_on || []).length ? el('span', { class: 'pill', style: 'margin-left:6px;background:#fdf0df;color:#a25a08', title: 'Quản trị MÁY chấm công (vào được menu máy) tại: ' + e.device_admin_on.join(', ') }, '👑 QT máy') : ''),
          el('td', {}, e.position || '—'),
          el('td', {}, e.username),
          el('td', {}, roleLabel(e.role)),
          el('td', {}, e.active ? el('span', { class: 'pill ok' }, 'Hoạt động') : el('span', { class: 'pill bad' }, 'Khoá')),
          el('td', {}, actions),
        ));
      }
      if (!list.length) tb.append(el('tr', {}, el('td', { colspan: 7 }, el('div', { class: 'empty' }, 'Không có nhân viên nào.'))));
      tbl.append(tb);
      listBox.innerHTML = ''; listBox.append(tbl);
    };
    searchI.oninput = () => { empSearch = searchI.value; renderList(); };
    renderTree(); renderList();
    setMain(head(...headArgs2),
      el('div', { class: 'emp-wrap' },
        el('div', { class: 'panel emp-side' }, el('div', { class: 'emp-side-h' }, 'Bộ phận'), tree),
        el('div', { class: 'emp-main' }, el('div', { style: 'display:flex;gap:10px;align-items:center;margin-bottom:8px;flex-wrap:wrap' }, searchI, countLbl), listBox)));
  } catch (e) { setMain(head('Nhân viên'), el('div', { class: 'empty' }, e.message)); }
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

  // Chức danh: chọn từ danh mục đã khai báo (tab "Bộ phận" → Chức danh)
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

  const body = [
    el('div', { class: 'two-col' }, field('Mã NV *', mk('code', 'VD: NV002', e?.code)), field('Họ tên *', mk('full_name', 'Nguyễn Văn A', e?.full_name))),
    el('div', { class: 'two-col' }, deptField, posField),
    el('div', { class: 'two-col' }, field('Số điện thoại', mk('phone', '', e?.phone)), pinField),
    field('Kiểu chấm công của nhân viên này',
      el('select', { id: 'e-attmode' }, ...['', 'shift', 'hourly'].map((v) => el('option', { value: v, ...((e?.att_mode || '') === v ? { selected: '' } : {}) },
        v === '' ? `Theo cài đặt chung (hiện là: ${SETTINGS.attendance_mode === 'hourly' ? 'theo giờ' : 'theo ca'})` : ATT_MODE_LABEL[v])))),
    el('div', { class: 'two-col' }, field('Tài khoản *', mk('username', 'nv002', e?.username)), field('Vai trò', roleSel)),
    permWrap,
    field(e ? 'Mật khẩu mới (để trống nếu giữ nguyên)' : 'Mật khẩu *', input('e-password', { type: 'text', placeholder: e ? '••••••' : '123456' })),
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
  ];
  const save = el('button', { class: 'btn' }, e ? 'Lưu thay đổi' : 'Tạo nhân viên');
  save.onclick = async () => {
    const body = {
      code: f.code.value.trim(), full_name: f.full_name.value.trim(), department: deptSel.value,
      position: posSel.value, phone: f.phone.value, role: $('#e-role').value,
      username: f.username.value.trim(),
      password: $('#e-password').value || undefined,
      att_mode: $('#e-attmode') ? $('#e-attmode').value : undefined,
    };
    // Số ID chỉ gửi khi CHƯA khóa (tạo mới, hoặc NV cũ chưa có ID); backend cũng chặn đổi ID đã có
    if (!pinLocked) body.device_pin = f.device_pin.value.trim();
    // Không gửi shift_id/work_schedule_id/office_ids → giữ nguyên phân ca & định vị đã gán ở màn riêng
    if (body.role !== 'admin') body.permissions = [...permState];
    try {
      const r = e ? await api('/admin/employees/' + e.id, { method: 'PUT', body }) : await api('/admin/employees', { method: 'POST', body });
      toast(r && r.relinked ? `Đã lưu — gán ${r.relinked} lượt quẹt cũ của Số ID máy và tính lại công` : 'Đã lưu', 'ok');
      closeModal(); pageEmployees();
    } catch (err) { toast(err.message, 'err'); }
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
  if (d.photoData) {
    box.append(el('div', { style: 'text-align:center;margin-bottom:14px' },
      el('img', { src: d.photoData, alt: 'Ảnh NV', style: 'width:120px;height:120px;object-fit:cover;border-radius:14px;border:2px solid var(--brand,#E8541E)' }),
      el('div', { style: 'font-size:12px;color:var(--muted);margin-top:4px' }, d.photo === 'face' ? '📸 Ảnh khuôn mặt đăng ký trên máy' : '📸 Ảnh người dùng từ máy')));
  }
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
async function toggleEmp(e) { if (!confirm(`Khoá nhân viên ${e.full_name}?`)) return; await api('/admin/employees/' + e.id, { method: 'DELETE' }); pageEmployees(); }
async function unlockEmp(e) { try { await api('/admin/employees/' + e.id, { method: 'PUT', body: { active: true } }); toast('Đã mở khoá', 'ok'); pageEmployees(); } catch (err) { toast(err.message, 'err'); } }
async function delEmp(e) {
  if (!confirm(`XÓA HẲN nhân viên "${e.full_name}" (${e.code})?\n\nTOÀN BỘ dữ liệu công/chấm công/phân ca/lương của người này sẽ bị xóa, KHÔNG hoàn tác được.\n\n(Chỉ muốn cho nghỉ việc mà GIỮ lịch sử → bấm "Khoá" thay vì Xóa.)`)) return;
  try { await api('/admin/employees/' + e.id + '/purge', { method: 'DELETE' }); toast('Đã xóa nhân viên', 'ok'); pageEmployees(); }
  catch (err) { toast(err.message, 'err'); }
}

// Trang "Bộ phận & Chức danh" — khai báo bộ phận CHA-CON + danh mục chức danh
async function pageOrg() {
  setMain(head('Bộ phận & Chức danh'), loading());
  const ro = !hasPerm('departments');   // chỉ xem
  const box = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start' });
  const deptPanel = el('div', { class: 'panel', style: 'padding:18px 20px' });
  const posPanel = el('div', { class: 'panel', style: 'padding:18px 20px' });
  box.append(deptPanel, posPanel);
  if (innerWidth < 760) box.style.gridTemplateColumns = '1fr';
  setMain(head('Bộ phận & Chức danh'), box);

  // ---------- BỘ PHẬN (cây cha-con) ----------
  const renderDept = () => {
    deptPanel.innerHTML = '';
    deptPanel.append(el('h3', { style: 'margin:0 0 4px' }, '🏢 Bộ phận'),
      el('div', { class: 'map-hint', style: 'margin-bottom:12px' }, 'Khai báo bộ phận, có thể lồng bộ phận con vào bộ phận cha. Không xoá được bộ phận còn nhân viên hoặc còn bộ phận con.'));
    if (!ro) {
      const nameI = input('org-dname', { placeholder: 'Tên bộ phận mới' });
      const parentSel = el('select', {}, el('option', { value: '' }, '— Không có (cấp trên cùng) —'),
        ...deptOrdered().map(d => el('option', { value: d.id }, ' '.repeat(d.depth * 3) + (d.depth ? '↳ ' : '') + d.name)));
      const addBtn = el('button', { class: 'btn' }, 'Thêm');
      addBtn.onclick = async () => {
        const name = nameI.value.trim(); if (!name) return toast('Nhập tên bộ phận', 'err');
        try { await api('/admin/departments', { method: 'POST', body: { name, parent_id: parentSel.value || null } }); nameI.value = ''; DEPARTMENTS = (await api('/admin/departments')).rows; renderDept(); toast('Đã thêm bộ phận', 'ok'); }
        catch (e) { toast(e.message, 'err'); }
      };
      deptPanel.append(el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px' }, nameI, el('span', { style: 'align-self:center;color:var(--muted);font-size:13px' }, 'thuộc'), parentSel, addBtn));
    }
    const tree = deptOrdered();
    if (!tree.length) { deptPanel.append(el('div', { class: 'map-hint' }, 'Chưa có bộ phận nào.')); return; }
    const list = el('div', { style: 'margin-top:8px' });
    for (const d of tree) {
      const acts = ro ? '' : el('div', { style: 'display:flex;gap:6px' },
        btnSm('Sửa', () => deptEditModal(d, renderDept), 'ghost'),
        btnSm('Xoá', async () => { if (!confirm(`Xoá bộ phận "${d.name}"?`)) return; try { await api('/admin/departments/' + d.id, { method: 'DELETE' }); DEPARTMENTS = (await api('/admin/departments')).rows; renderDept(); toast('Đã xoá', 'ok'); } catch (e) { toast(e.message, 'err'); } }, 'ghost'));
      list.append(el('div', { style: 'display:flex;align-items:center;gap:10px;padding:8px 2px;border-bottom:1px solid #f1efec' },
        el('div', { style: 'flex:1;padding-left:' + (d.depth * 18) + 'px' },
          d.depth ? el('span', { style: 'color:var(--muted)' }, '↳ ') : '', el('b', {}, d.name)),
        acts));
    }
    deptPanel.append(list);
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
  renderDept(); renderPos();
}

// Sửa 1 bộ phận: đổi tên + chọn bộ phận cha (không cho chọn chính nó)
function deptEditModal(d, after) {
  const nameI = input('de-name', { value: d.name });
  const parentSel = el('select', {}, el('option', { value: '' }, '— Không có (cấp trên cùng) —'),
    ...deptOrdered().filter(x => x.id !== d.id).map(x => el('option', { value: x.id, ...((d.parent_id || '') == x.id ? { selected: '' } : {}) },
      ' '.repeat(x.depth * 3) + (x.depth ? '↳ ' : '') + x.name)));
  const save = el('button', { class: 'btn' }, 'Lưu');
  save.onclick = async () => {
    const name = nameI.value.trim(); if (!name) return toast('Nhập tên bộ phận', 'err');
    try { await api('/admin/departments/' + d.id, { method: 'PUT', body: { name, parent_id: parentSel.value || null } }); DEPARTMENTS = (await api('/admin/departments')).rows; closeModal(); after && after(); toast('Đã lưu', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  };
  openModal('Sửa bộ phận', [
    el('div', {}, el('label', {}, 'Tên bộ phận'), nameI),
    el('div', { style: 'margin-top:10px' }, el('label', {}, 'Thuộc bộ phận cha'), parentSel),
  ], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Đóng'), save]);
}

/* ---------- 3) CA LÀM ---------- */
async function pageShifts() {
  document.querySelectorAll('#nav-sub-sh .nav-sub-btn').forEach((x) => x.classList.toggle('active', x.dataset.as === _shView));
  if (_shView === 'schedules') return pageSchedules();
  if (_shView === 'inout') return pageInOut();
  const addBtn = hasPerm('shifts') ? el('button', { class: 'btn' }, '+ Thêm ca') : null;
  // Màn hình hẹp không có menu con → vẫn để nút sang Lịch trình làm việc
  // Màn hình hẹp (không có menu con): nút sang 2 mục còn lại
  const schedBtn = el('span', { class: 'as-tabs', style: 'margin:0' }, btnSm('Lịch trình vào ra', () => { _shView = 'inout'; pageShifts(); }, 'ghost'), btnSm('Lịch trình ca làm việc', () => { _shView = 'schedules'; _schEdit = null; pageShifts(); }, 'ghost'));
  setMain(head('Ca làm việc', schedBtn, addBtn), loading());
  const { rows } = await api('/admin/shifts');
  SHIFTS = rows;
  const tbl = el('table', { class: 'data' });
  tbl.innerHTML = `<thead><tr><th>Tên ca</th><th>Mã</th><th>Giờ vào</th><th>Giờ ra</th><th>Nhận diện tự động</th><th>Nghỉ giữa ca</th><th>Muộn/Sớm</th><th>Công/ca</th><th>OT</th><th>TT</th><th></th></tr></thead>`;
  const tb = el('tbody');
  const dayNames = { 1: 'T2', 2: 'T3', 3: 'T4', 4: 'T5', 5: 'T6', 6: 'T7', 7: 'CN' };
  for (const s of rows) {
    const overnight = s.end_time <= s.start_time;
    tb.append(el('tr', {},
      el('td', {}, el('b', {}, s.name), overnight ? el('span', { title: 'Ca qua đêm' }, ' 🌙') : '',
        (s.merge_rule && s.merge_rule !== 'filo' && s.merge_rule !== 'default') ? el('div', { style: 'font-size:12px;color:#b45309;margin-top:2px' }, `Còn lưu cách ghép giờ riêng (kiểu cũ): ${(RULE_LABEL[s.merge_rule] || s.merge_rule).split(' —')[0]} `,
          hasPerm('shifts') ? el('a', { href: '#', style: 'color:#dc2626;font-weight:700', onclick: async (ev) => { ev.preventDefault(); if (!confirm(`Bỏ cách ghép giờ riêng của ca "${s.name}"? Sau đó ca này ghép giờ theo Lịch trình vào ra.`)) return; try { await api('/admin/shifts/' + s.id + '/clear-merge-rule', { method: 'POST' }); toast('Đã bỏ', 'ok'); pageShifts(); } catch (e) { toast(e.message, 'err'); } } }, 'Bỏ') : '') : ''),
      el('td', {}, s.code ? el('span', { class: 'pill muted' }, s.code) : '—'),
      el('td', {}, s.start_time), el('td', {}, s.end_time),
      el('td', {}, s.check_in_start && s.check_in_end ? `${s.check_in_start}–${s.check_in_end}` : el('span', { style: 'color:#bbb' }, 'tắt')),
      el('td', {}, (s.break_minutes || 0) + ' phút'),
      el('td', {}, `${s.late_grace_min || 0}/${s.early_grace_min ?? 15} phút`),
      el('td', {}, el('b', {}, String(s.work_unit_value ?? 1))),
      el('td', {}, s.allow_ot ? el('span', { class: 'pill ok' }, 'Có') : el('span', { class: 'pill muted' }, 'Không')),
      el('td', {}, s.active ? el('span', { class: 'pill ok' }, 'Bật') : el('span', { class: 'pill bad' }, 'Tắt')),
      el('td', {}, hasPerm('shifts') ? btnSm('Sửa', () => shiftModal(s)) : ''),
    ));
  }
  tbl.append(tb);
  if (addBtn) addBtn.onclick = () => shiftModal(null);
  setMain(head('Ca làm việc', schedBtn, addBtn), el('div', { class: 'panel tbl-scroll' }, tbl));
}

/* ---------- LỊCH TRÌNH VÀO RA (kiểu Ronald Jack) ----------
 * Khai báo RIÊNG cách xác định lượt quẹt nào là VÀO, lượt nào là RA (không còn nằm trong ca). Gán kèm khi Gán ca cho nhân viên / phòng ban. */
const IO_RULES = [
  ['filo', 'Giờ đầu là vào, giờ cuối là ra', 'Lần chấm công đầu tiên được xem là giờ VÀO, lần chấm công cuối cùng được xem là giờ RA, bỏ qua tất cả các giờ chấm ở giữa. Tính trong khung giờ của ca: ca ngày lấy trong ngày; ca qua đêm lấy lượt VÀO buổi tối và lượt RA sáng hôm sau.'],
  ['pairs', 'Tự động - không qua đêm (không qua 12h)', 'Lần chấm đầu là VÀO, lần chấm kế tiếp là RA, rồi lại VÀO… Giờ làm = tổng các cặp vào–ra (thời gian ra ngoài giữa chừng bị trừ). Việc chọn lượt phụ thuộc ba thông số bên dưới.'],
  ['tdqd', 'Tự động - qua đêm (qua 12h)', 'Như "Tự động" nhưng dùng cho ca đêm: lượt VÀO buổi tối ghép với lượt RA sáng hôm sau.'],
  ['idm', 'Theo ID máy', 'Khi chấm công ở máy có số máy lẻ (1, 3, 5, 7, 9) sẽ là VÀO. Khi chấm ở máy có số máy chẵn (2, 4, 6, 8, 10) sẽ là RA. Đặt "số máy" cho từng máy ở mục Máy chấm công.'],
  ['state', 'Chọn từ máy', 'Giờ VÀO hay giờ RA nhận từ máy chấm công: bấm phím Check In trước khi chấm là VÀO, bấm Check Out trước khi chấm là RA.'],
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
function shiftModal(s) {
  const days = (s?.work_days || '1,2,3,4,5,6').split(',');
  const dayBoxes = [1, 2, 3, 4, 5, 6, 7].map(d => {
    const c = el('label', { style: 'display:flex;align-items:center;gap:5px;font-weight:600;color:var(--ink)' },
      el('input', { type: 'checkbox', class: 's-day', value: d, style: 'width:auto', ...(days.includes(String(d)) ? { checked: '' } : {}) }),
      { 1: 'T2', 2: 'T3', 3: 'T4', 4: 'T5', 5: 'T6', 6: 'T7', 7: 'CN' }[d]);
    return c;
  });
  const otChk = el('input', { type: 'checkbox', id: 's-allowot', style: 'width:auto', ...(s?.allow_ot ? { checked: '' } : {}) });
  const parts = [
    el('div', { class: 'two-col' }, field('Tên ca *', input('s-name', { value: s?.name || '', placeholder: 'Hành chính' })), field('Mã ca (cho Excel)', input('s-code', { value: s?.code || '', placeholder: 'VD: HC, S, C, DEM' }))),
    el('div', { class: 'two-col' }, field('Giờ vào * (24h, VD 08:00)', time24('s-start', s?.start_time || '08:00')), field('Giờ ra * (24h, VD 17:30)', time24('s-end', s?.end_time || '17:30'))),
    el('div', { class: 'map-hint', style: 'margin:-4px 0 0' }, '🌙 Ca qua đêm: đặt Giờ ra NHỎ HƠN Giờ vào (VD 22:00 → 06:00) — hệ thống tự hiểu là qua ngày hôm sau.'),
    el('div', {}, el('label', {}, 'Bắt đầu vào – Kết thúc vào: khung giờ nhận lượt chấm VÀO của ca (tuỳ chọn — để tự tìm đúng ca)'),
      el('div', { class: 'two-col' }, field('Nhận diện TỪ giờ', time24('s-ciStart', s?.check_in_start || '')), field('ĐẾN giờ', time24('s-ciEnd', s?.check_in_end || ''))),
      el('div', { class: 'map-hint' }, 'Là MỘT khoảng giờ (từ → đến) để tự nhận đúng ca khi nhân viên chấm VÀO. VD ca Sáng 06:00→10:00, ca Chiều 12:00→15:00.')),
    el('div', {}, el('label', {}, 'Bắt đầu ra – Kết thúc ra: khung giờ nhận lượt chấm RA của ca (để phân biệt ca CÙNG giờ vào)'),
      el('div', { class: 'two-col' }, field('Nhận diện TỪ giờ', time24('s-coStart', s?.check_out_start || '')), field('ĐẾN giờ', time24('s-coEnd', s?.check_out_end || ''))),
      el('div', { class: 'map-hint' }, 'Quan trọng khi 2 ca CÙNG giờ vào: VD ca Sáng (8:00) ra 11:30→13:00, ca Hành chính (8:00) ra 16:00→19:00 → hệ thống nhìn GIỜ RA để chọn đúng ca. Để trống = tự suy từ Giờ ra. Ca đêm: đặt cửa sổ ra buổi sáng hôm sau, VD 05:00→08:00.')),
    el('div', { class: 'two-col' },
      field('Cho phép đi muộn (phút)', input('s-grace', { type: 'number', value: s?.late_grace_min ?? 5, min: 0 })),
      field('Cho phép về sớm (phút)', input('s-early', { type: 'number', value: s?.early_grace_min ?? 15, min: 0 }))),
    el('div', { class: 'two-col' },
      field('Nghỉ giữa ca (phút)', input('s-break', { type: 'number', value: s?.break_minutes ?? 0, min: 0 })),
      field('Số công của ca (cả ngày=1, nửa ngày=0.5)', input('s-unit', { type: 'number', step: '0.1', value: s?.work_unit_value ?? 1.0, min: 0 }))),
    el('div', {}, el('label', { style: 'display:flex;align-items:center;gap:8px;color:var(--ink);font-weight:600' }, otChk, 'Cho phép tính tăng ca (OT) khi ở lại sau giờ tan ca')),
    el('div', { class: 'two-col' },
      field('OT: ở lại tối thiểu (phút)', input('s-otafter', { type: 'number', value: s?.ot_start_after_min ?? 30, min: 0 })),
      el('div', { class: 'map-hint', style: 'align-self:end' }, 'Làm tròn tăng ca: đặt chung cho cả công ty ở Cài đặt > Quy tắc tính công.')),
    el('div', { class: 'two-col' },
      el('label', { style: 'display:flex;align-items:center;gap:8px;color:var(--ink);font-weight:600' }, chk('s-otbefore', s?.ot_before), 'Tính cả tăng ca TRƯỚC giờ vào ca (đến sớm)'),
      field('Đến sớm tối thiểu (phút) mới tính', input('s-otbeforemin', { type: 'number', value: s?.ot_before_min ?? 30, min: 0 }))),
    el('div', {}, el('label', {}, 'Chia mức tăng ca ngày thường TC1 → TC4 (để 0 = không chia, tất cả là TC1)'),
      el('div', { style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:10px' },
        field('TC1 tối đa (phút)', input('s-t1', { type: 'number', value: s?.ot_tier1_min ?? 0, min: 0 })),
        field('TC2 tối đa (phút)', input('s-t2', { type: 'number', value: s?.ot_tier2_min ?? 0, min: 0 })),
        field('TC3 tối đa (phút)', input('s-t3', { type: 'number', value: s?.ot_tier3_min ?? 0, min: 0 })),
        field('Hệ số lương TC2', input('s-r2', { type: 'number', step: '0.1', value: s?.ot_tier2_rate ?? 0, min: 0 })),
        field('Hệ số lương TC3', input('s-r3', { type: 'number', step: '0.1', value: s?.ot_tier3_rate ?? 0, min: 0 })),
        field('Hệ số lương TC4', input('s-r4', { type: 'number', step: '0.1', value: s?.ot_tier4_rate ?? 0, min: 0 }))),
      el('div', { class: 'map-hint' }, 'VD TC1 = 120, TC2 = 120: tăng ca 5 tiếng → 2h TC1, 2h TC2, 1h TC3 (TC3 để 0 = nhận hết phần còn lại; dư nữa → TC4). TC1 tính theo hệ số OT ngày thường của nhân viên (trang Lương); hệ số TC2–TC4 để 0 = cũng như ngày thường.')),
    el('div', {},
      el('label', { style: 'display:flex;align-items:center;gap:6px;font-weight:600;color:var(--ink)' }, chk('s-holidayot', s?.holiday_as_ot), 'Xem CẢ CA là tăng ca khi làm ca này vào ngày lễ'),
      el('div', { class: 'map-hint' }, 'Bật thì ngày lễ không tính công; toàn bộ giờ làm thành tăng ca ngày lễ. (Đi làm ngày cuối tuần = tăng ca: đặt chung ở Cài đặt > Quy tắc tính công.)')),
    el('label', { style: 'display:flex;align-items:flex-start;gap:8px;color:var(--ink);font-weight:600' }, chk('s-comp', s?.compensate_late),
      el('span', {}, 'Tính bù trừ: đi trễ thì về trễ bù lại, không bị trừ giờ ', el('span', { style: 'font-weight:400;color:var(--muted)' }, '(phút ở lại để bù không tính tăng ca; vẫn ghi nhận số phút đi trễ)'))),
    el('label', { style: 'display:flex;align-items:flex-start;gap:8px;color:var(--ink);font-weight:600' }, chk('s-gracededuct', s?.grace_deduct),
      el('span', {}, 'Đi trễ / về sớm chỉ tính phần VƯỢT số phút cho phép ', el('span', { style: 'font-weight:400;color:var(--muted)' }, '(VD cho phép 5 phút, trễ 12 phút → ghi 7 phút. Không tick: ghi đủ 12 phút)'))),
    el('label', { style: 'display:flex;align-items:flex-start;gap:8px;color:var(--ink);font-weight:600' }, chk('s-shiftot', s?.shift_as_ot),
      el('span', {}, 'Ca này là CA TĂNG CA ', el('span', { style: 'font-weight:400;color:var(--muted)' }, '(ngày nào làm ca này cũng không tính công, toàn bộ giờ làm thành tăng ca)'))),
    field('Khi chỉ có giờ VÀO, thiếu giờ RA',
      el('select', { id: 's-noout' },
        el('option', { value: '0', ...(!s?.no_out_credit ? { selected: '' } : {}) }, 'Không tính công (mặc định)'),
        el('option', { value: '1', ...(s?.no_out_credit ? { selected: '' } : {}) }, 'Vẫn tính đủ công của ca, trừ phần đi trễ'))),
    el('div', { class: 'two-col' },
      field('Quy tắc ghép log máy (mặc định của ca)',
        el('select', { id: 's-rule' }, ...MERGE_RULES.filter(([v]) => v !== 'default').map(([v, t]) =>
          el('option', { value: v, ...(String(s?.merge_rule || 'filo') === v ? { selected: '' } : {}) }, t)))),
      field('TĐ-QĐ ghép theo',
        el('select', { id: 's-tdqd' },
          el('option', { value: 'pair', ...((s?.tdqd_mode || 'pair') === 'pair' ? { selected: '' } : {}) }, 'Thời gian (vào trước/ra sau)'),
          el('option', { value: 'idm', ...(s?.tdqd_mode === 'idm' ? { selected: '' } : {}) }, 'Máy lẻ/chẵn (IDM)')))),
    el('div', { class: 'map-hint', style: 'margin:-4px 0 0' }, 'Quy tắc ghép log = cách gộp nhiều lần quẹt máy thành giờ Vào/Ra. FILO hợp đa số. IDM cần đặt "số máy" cho từng máy (lẻ=Vào, chẵn=Ra). "Nhiều lần vào/ra": quẹt 1-2 là một cặp, 3-4 là cặp tiếp…, giờ công = tổng các cặp (giờ ra ngoài giữa chừng bị trừ, không trừ thêm nghỉ giữa ca). Các báo cáo (trừ "Giờ vào & ra đầu/cuối") hiện giờ vào/ra theo quy tắc này. Có thể ghi đè khi phân ca.'),
    el('div', { class: 'map-hint' }, 'Ngày nghỉ cuối tuần đặt chung cho cả công ty ở Cài đặt > Quy tắc tính công (mặc định Chủ nhật).'),
  ];
  // Chia form thành các TAB (như Ronald Jack) cho đỡ rối. Mọi ô vẫn nằm trong form, bấm Lưu một lần là lưu hết các tab.
  // (ô số 16, 17 = quy tắc ghép giờ kiểu cũ: KHÔNG còn khai ở ca — đã chuyển sang mục "Lịch trình vào ra")
  const TABS = [['Ca làm việc', [0, 1, 2, 6, 5, 3, 4, 18]], ['Tăng ca', [7, 8, 9, 10, 11, 14]], ['Nâng cao', [12, 13, 15]]];
  const panes = TABS.map(([, idx]) => el('div', { class: 'tab-pane' }, ...idx.map((k) => parts[k])));
  const tabBtns = TABS.map(([t], k) => { const b = el('button', { type: 'button', class: 'tab-btn' }, t); b.onclick = () => showTab(k); return b; });
  const showTab = (k) => { panes.forEach((p, n) => { p.style.display = n === k ? 'flex' : 'none'; }); tabBtns.forEach((b, n) => b.classList.toggle('on', n === k)); };
  showTab(0);
  const body = [el('div', { class: 'tab-bar' }, ...tabBtns), ...panes];
  const save = el('button', { class: 'btn' }, 'Lưu');
  save.onclick = async () => {
    const work_days = [...document.querySelectorAll('.s-day:checked')].map(x => x.value).join(',') || '1,2,3,4,5,6';
    const b = {
      name: $('#s-name').value.trim(), code: $('#s-code').value.trim(),
      start_time: $('#s-start').value, end_time: $('#s-end').value,
      check_in_start: $('#s-ciStart').value || '', check_in_end: $('#s-ciEnd').value || '',
      check_out_start: $('#s-coStart').value || '', check_out_end: $('#s-coEnd').value || '',
      late_grace_min: +$('#s-grace').value || 0, early_grace_min: +$('#s-early').value || 0,
      break_minutes: +$('#s-break').value || 0, work_unit_value: +$('#s-unit').value || 1,
      allow_ot: otChk.checked, ot_start_after_min: +$('#s-otafter').value || 0,

      ot_before: $('#s-otbefore').checked, ot_before_min: +$('#s-otbeforemin').value || 0,
      ot_tier1_min: +$('#s-t1').value || 0, ot_tier2_min: +$('#s-t2').value || 0, ot_tier3_min: +$('#s-t3').value || 0,
      ot_tier2_rate: +$('#s-r2').value || 0, ot_tier3_rate: +$('#s-r3').value || 0, ot_tier4_rate: +$('#s-r4').value || 0,
      holiday_as_ot: $('#s-holidayot').checked,
      compensate_late: $('#s-comp').checked, no_out_credit: $('#s-noout').value === '1',
      grace_deduct: $('#s-gracededuct').checked, shift_as_ot: $('#s-shiftot').checked,
    };
    try { if (s) await api('/admin/shifts/' + s.id, { method: 'PUT', body: b }); else await api('/admin/shifts', { method: 'POST', body: b }); toast('Đã lưu', 'ok'); closeModal(); pageShifts(); }
    catch (err) { toast(err.message, 'err'); }
  };
  openModal(s ? 'Sửa ca' : 'Thêm ca', body, [el('button', { class: 'btn ghost', onclick: closeModal }, 'Huỷ'), save]);
}

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
let _asNavOpen = true;      // menu con của mục Phân ca ở menu trái đang mở
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
    data = await api(`/admin/assignments?from=${from}&to=${to}${_asTab === 'sheet' ? '&grid=1' : ''}`);
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
  for (const n of nodes) tree.append(node(n.name, n.name, 1 + n.depth));
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
    const pickSearch = el('input', { placeholder: 'Tên ca / lịch trình' });
    let picked = null;   // 'shift:ID' | 'schedule:ID'
    const items = [
      ...data.shifts.map((s) => ({ key: 'shift:' + s.id, name: s.name, kind: 'Ca làm việc', info: `${s.start_time} – ${s.end_time}` })),
      ...schedules.map((w) => ({ key: 'schedule:' + w.id, name: w.name, kind: (w.unit || 'auto') === 'auto' ? 'Lịch trình · tự dò theo giờ' : `Lịch trình · ${SCH_UNIT[w.unit]} · chu kỳ ${w.cycle || 1}`, info: (w.shifts || []).map((x) => x.name).join(', ') || 'chưa có ca' })),
    ];
    if (isTemp) items.push({ key: 'off:0', name: '🛌 Nghỉ', kind: 'Ngày nghỉ', info: 'cho nghỉ các ngày đã chọn' });
    const pickTb = el('tbody');
    const renderPick = () => {
      pickTb.innerHTML = '';
      const q = pickSearch.value.trim().toLowerCase();
      const list = items.filter((it) => !q || it.name.toLowerCase().includes(q));
      if (!list.length) pickTb.append(el('tr', {}, el('td', { colspan: 4 }, el('div', { class: 'empty' }, items.length ? 'Không tìm thấy.' : 'Chưa có ca làm việc nào. Khai báo ở mục Ca làm trước.'))));
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
        el('label', {}, 'Ca làm việc / Lịch trình ca làm việc'),
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
        const set = descOf(curDept);
        return data.employees.filter((e) => set.has(e.department || ''));
      };
      const draw = () => {
        treeBox.innerHTML = '';
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
        listHead.innerHTML = ''; listHead.append(all, `${list.length} mục`);
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
      const treeBox = el('div', { class: 'emp-tree', style: 'padding:0' });
      const drawTree = () => {
        treeBox.innerHTML = '';
        for (const n of nodes) {
          const cb = el('input', { type: 'checkbox', style: 'width:auto', ...(sel.has(n.name) ? { checked: '' } : {}) });
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
        el('label', { style: 'display:flex;align-items:center;gap:8px;font-weight:600;color:var(--ink);margin-bottom:8px' }, incl, 'Bao gồm cấp dưới'),
        treeBox), selCol];
      var getBody = () => ({ url: '/admin/dept-shift-assignments', body: { departments: [...sel.keys()], include_children: incl.checked } });
    } else {
      let curDept = _asDept === '*' ? (nodes[0] ? nodes[0].name : '') : _asDept;
      const empSearch = el('input', { placeholder: 'Tên hoặc mã nhân viên', style: 'margin-bottom:8px' });
      const treeBox = el('div', { class: 'emp-tree', style: 'padding:0' });
      const listHead = el('label', { style: 'display:flex;align-items:center;gap:8px;font-weight:700;color:var(--ink);margin-bottom:6px' });
      const listBox = el('div', { class: 'as-sel-list' });
      const shown = () => {
        const q = empSearch.value.trim().toLowerCase();
        if (q) return data.employees.filter((e) => e.full_name.toLowerCase().includes(q) || String(e.code).toLowerCase().includes(q));   // tìm trên toàn công ty
        const set = descOf(curDept);
        return data.employees.filter((e) => set.has(e.department || ''));
      };
      const lab = (e) => `${e.full_name} (${e.code})`;
      const draw = () => {
        treeBox.innerHTML = '';
        const tn = (key, text, depth) => { const d = el('div', { class: 'tn' + (curDept === key && !empSearch.value.trim() ? ' on' : ''), style: 'padding-left:' + (6 + depth * 16) + 'px' }, el('span', { class: 'nm' }, '📁 ' + text), el('span', { class: 'ct' }, String(countOf(key)))); d.onclick = () => { curDept = key; empSearch.value = ''; draw(); }; return d; };
        for (const n of nodes) treeBox.append(tn(n.name, n.name, n.depth));
        if (data.employees.some((e) => !(e.department || ''))) treeBox.append(tn('', '(Chưa có phòng ban)', 0));
        const list = shown();
        const all = el('input', { type: 'checkbox', style: 'width:auto', ...(list.length && list.every((e) => sel.has(e.id)) ? { checked: '' } : {}) });
        all.onchange = () => { for (const e of list) { if (all.checked) sel.set(e.id, lab(e)); else sel.delete(e.id); } renderSel(); draw(); };
        listHead.innerHTML = ''; listHead.append(all, `${list.length} mục`);
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
      if (!picked) return toast('Chọn 1 ca hoặc 1 lịch trình ở bảng bên phải', 'err');
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
    const fI = el('input', { type: 'date', value: f0, style: 'width:140px', title: 'Từ ngày' });
    const tI = el('input', { type: 'date', value: t0, style: 'width:140px', title: 'Đến ngày' });
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
      el('th', {}, 'Ca / lịch trình ca làm việc'), el('th', {}, 'Lịch trình vào ra'), el('th', {}, 'Ngày bắt đầu'), el('th', {}, 'Ngày kết thúc'))));
    const tb = el('tbody'); tbl.append(tb);
    const renderRows = () => {
      tb.innerHTML = '';
      const q = _asSearch.trim().toLowerCase();
      const rows = ranged.filter((r) => empById.has(r.employee_id) && (!q || (r.emp_name || '').toLowerCase().includes(q) || String(r.emp_code || '').toLowerCase().includes(q)))
        .sort((a, b) => (a.department || '').localeCompare(b.department || '', 'vi') || (a.emp_name || '').localeCompare(b.emp_name || '', 'vi') || (a.from_date < b.from_date ? 1 : -1));
      if (!rows.length) tb.append(el('tr', {}, el('td', { colspan: 8 }, el('div', { class: 'empty' }, '📭 Trống — chưa nhân viên nào ở đây được gán ca riêng. Bấm "+ Thêm" để gán.'))));
      for (const r of rows) {
        const expired = r.to_date && r.to_date < today, future = r.from_date > today;
        tb.append(el('tr', {}, el('td', {}, el('input', { type: 'checkbox', class: 'as-pick', style: 'width:auto', 'data-sa': r.id })),
          el('td', {}, r.department || ''), el('td', {}, r.emp_code || ''), el('td', {}, el('b', {}, r.emp_name || '')),
          el('td', {}, el('span', { style: expired ? 'color:#9ca3af' : 'color:#0f766e;font-weight:700' }, r.mode === 'schedule' ? '📋 ' + (r.schedule_name || 'Lịch trình') : (r.shift_name || 'Ca')),
            expired ? el('span', { class: 'chip', style: 'margin-left:6px' }, 'đã hết hạn') : future ? el('span', { class: 'chip', style: 'margin-left:6px;background:#eff6ff;color:#1d4ed8' }, 'sắp áp dụng') : ''),
          el('td', { style: 'color:var(--muted)' }, r.inout_name || 'Mặc định'),
          el('td', {}, fmtD(r.from_date)), el('td', {}, r.to_date ? fmtD(r.to_date) : '—')));
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
    // Giá trị ĐÃ NHẬP ở bảng này (lớp ưu tiên cao nhất). Lịch trình tạm thời / ca phần mềm tự tìm nằm bên dưới (emps[r].grid).
    const saved = new Map();
    for (const a of data.assignments) {
      if (a.source === 'temp') continue;
      const k = a.employee_id + '|' + a.work_date;
      if (a.is_off) saved.set(k, 'NGHỈ');
      else if (saved.get(k) !== 'NGHỈ') { const c = codeOfShift.get(a.shift_id); if (c) saved.set(k, saved.has(k) ? saved.get(k) + '+' + c : c); }
    }
    const R = emps.length, C = days.length;
    const keyOf = (r, c) => emps[r].id + '|' + days[c];
    const cellEls = [];   // [r][c] → td
    const curVal = (r, c) => { const k = keyOf(r, c); return _asDirty.has(k) ? _asDirty.get(k) : (saved.get(k) || ''); };
    const paint = (r, c) => {
      const td = cellEls[r][c], k = keyOf(r, c), dirty = _asDirty.has(k);
      const v = curVal(r, c), g = (emps[r].grid || [])[c] || {};
      td.textContent = v || g.l || '';   // chưa nhập ở bảng này → hiện (chữ mờ) ca phần mềm tự tìm: lịch tạm thời / lịch đã gán / ca dò theo giờ chấm
      td.className = 'c' + (dirty ? ' dirty' : '') + (v ? (v === 'NGHỈ' ? ' off' : ' ex') : ' ph' + (g.k === 'temp' ? ' tmp' : g.k === 'found' ? ' fnd' : '')) + (dirty && norm(v).bad ? ' bad' : '') + (weekdayVN(days[c]) === 7 ? ' sun' : weekdayVN(days[c]) === 6 ? ' sat' : '');
      const under = g.k === 'none' ? 'tự động theo giờ chấm' : g.k === 'temp' ? (g.t || g.l) : g.k === 'found' ? g.t : 'theo lịch đã gán: ' + (g.t || g.l || '');
      td.title = `${emps[r].full_name} — ${fmtD(days[c])}: ` + (v ? (v === 'NGHỈ' ? 'Nghỉ' : 'ca ' + v) + (dirty ? ' (chưa lưu)' : ' (nhập ở bảng này — ưu tiên cao nhất)') + `\nBấm "↺ Về tự động" để bỏ → ${under}` : (dirty ? '↺ về tự động (chưa lưu) → ' : '') + under);
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
      selInfo.textContent = n > 1 ? `Đang chọn ${n} ô (${q.r2 - q.r1 + 1} nhân viên × ${q.c2 - q.c1 + 1} ngày)` : `${emps[sel.ar].full_name} · ${fmtD(days[sel.ac])}`;
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
      saveBtn.textContent = _asDirty.size ? `💾 Lưu ${_asDirty.size} ô đã sửa` : '💾 Lưu';
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
    emps.forEach((e, r) => {
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
      for (let r = q.r1; r <= q.r2; r++) { const row = []; for (let c = q.c1; c <= q.c2; c++) { const g = (emps[r].grid || [])[c] || {}; row.push(curVal(r, c) || (g.k !== 'none' && g.k !== 'schedule' ? g.l : '')); } lines.push(row.join('\t')); }
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
    const saveBtn = el('button', { class: 'btn green' }, '💾 Lưu');
    const undoBtn = btnSm('↶ Hoàn tác', doUndo, 'ghost');
    const autoBtn = btnSm('↺ Về tự động', () => { fillSel(''); box.focus({ preventScroll: true }); }, 'ghost');
    autoBtn.title = 'Bỏ các ô đã nhập tay trong vùng đang chọn → phần mềm tự tìm ca lại (lịch trình tạm thời / lịch đã gán / dò theo giờ chấm). Bấm Lưu để áp dụng.';
    saveBtn.onclick = async () => {
      if ([..._asDirty.values()].some((v) => norm(v).bad)) return toast('Còn ô sai mã ca (chữ đỏ). Sửa lại trước khi lưu.', 'err');
      const cells = [..._asDirty].map(([k, v]) => { const [eid, date] = k.split('|'); return { employee_id: +eid, date, value: v }; });
      saveBtn.disabled = true;
      try {
        const r = await api('/admin/assignments/cells', { method: 'POST', body: { cells } });
        if (r.errorCount) { toast(`Đã lưu ${r.saved} ô, ${r.errorCount} ô lỗi: ${r.errors[0].error}`, 'err'); }
        else toast(`Đã lưu ${r.saved} ô`, 'ok');
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
          _asDirty.clear(); pageAssignments();
        } catch (e) { toast(e.message, 'err'); }
      };
      reader.readAsDataURL(f);
      fileI.value = '';
    };
    // Bảng mã ca: bấm 1 mã để điền vào vùng đang chọn (không cần gõ)
    const chipFor = (label, value, title, style) => { const b = el('button', { class: 'as-code', title, style: style || '' }, label); b.onclick = () => { if (!canEdit) return; fillSel(value); box.focus({ preventScroll: true }); }; return b; };
    const codes = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:8px 0' }, el('span', { style: 'font-size:12.5px;color:var(--muted)', title: 'Bấm 1 mã để điền vào các ô đang chọn' }, 'Mã ca:'),
      ...data.shifts.map((s) => chipFor((s.code || '').trim() || s.name, (s.code || '').trim() || s.name, `${s.name} (${s.start_time}-${s.end_time})`)),
      chipFor('NGHỈ', 'NGHỈ', 'Ngày nghỉ', 'color:#b45309;border-color:#f5d0a9'), chipFor('↺ Tự động', '', 'Bỏ ca đã nhập tay ngày đó → phần mềm tự tìm ca lại', 'color:#6b7280'));
    const noCode = data.shifts.filter((s) => !(s.code || '').trim());
    // Gọn chiều cao: thanh công cụ lên dòng tiêu đề; mã ca + chú thích + ô đang chọn chung 1 dòng; hướng dẫn ẩn sau nút "?"
    let helpOn = false; try { helpOn = localStorage.getItem('as_help') === '1'; } catch {}
    const hint = el('div', { class: 'map-hint', style: 'margin:0 0 6px;' + (helpOn ? '' : 'display:none') }, 'Dùng như Excel: bấm 1 ô rồi gõ mã ca + Enter · kéo chuột (hoặc Shift + mũi tên) chọn nhiều ô rồi gõ để điền cả vùng · Ctrl+C / Ctrl+V copy–dán (dán được từ Excel) · Delete (hoặc nút ↺ Về tự động) = bỏ ô nhập tay, phần mềm tự tìm ca lại · Ctrl+Z hoàn tác · bấm số ngày / số thứ tự để chọn cả cột / cả dòng · Esc thoát toàn màn hình.'
      + (noCode.length ? ` Ca chưa đặt mã (${noCode.map((s) => s.name).join(', ')}) đang dùng tên ca làm mã — nên đặt mã ngắn ở mục Ca làm.` : ''));
    const helpBtn = btnSm('?', () => { const on = hint.style.display === 'none'; hint.style.display = on ? '' : 'none'; try { localStorage.setItem('as_help', on ? '1' : '0'); } catch {} fitBox(); }, 'ghost');
    helpBtn.title = 'Hướng dẫn thao tác';
    const fullBtn = btnSm(_asFull ? '⤡' : '⛶', () => { _asFull = !_asFull; try { localStorage.setItem('as_full', _asFull ? '1' : '0'); } catch {} pageAssignments(); }, 'ghost');
    fullBtn.title = _asFull ? 'Hiện lại menu trái (phím Esc)' : 'Ẩn menu trái và cây phòng ban để bảng rộng nhất';
    if (deptBar) { deptBar.remove(); deptBar.style.marginBottom = '0'; deptBar.firstChild.remove(); }   // bỏ chữ "Phòng ban:" cho gọn
    undoBtn.textContent = '↶'; undoBtn.title = 'Hoàn tác (Ctrl+Z)';
    headTools.push(deptBar, rangeNav(), canEdit ? saveBtn : '', canEdit ? undoBtn : '', canEdit ? autoBtn : '', exBtn, imBtn, fileI, fullBtn, helpBtn);
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
    const rows = deptRows.filter((r) => !selSet || selSet.has(r.department));
    if (!rows.length) tb.append(el('tr', {}, el('td', { colspan: 8 }, el('div', { class: 'empty' }, '📭 Trống — chưa phòng ban nào ở đây được gán ca. Bấm "+ Thêm" để gán.'))));
    const delIds = async (ids, msg) => {
      if (!confirm(msg)) return;
      try { const r = await api('/admin/dept-shift-assignments/delete', { method: 'POST', body: { ids } }); toast(`Đã xoá ${r.count} lịch trình phòng ban`, 'ok'); pageAssignments(); } catch (e) { toast(e.message, 'err'); }
    };
    for (const r of rows) {
      const expired = r.to_date && r.to_date < today, future = r.from_date > today;
      tb.append(el('tr', {}, el('td', {}, el('input', { type: 'checkbox', class: 'as-pick', style: 'width:auto', 'data-id': r.id })),
        el('td', {}, el('b', {}, '📁 ' + r.department)),
        el('td', {}, el('span', { style: expired ? 'color:#9ca3af' : 'color:#0f766e;font-weight:700' }, r.mode === 'schedule' ? '📋 ' + (r.schedule_name || 'Lịch trình') : (r.shift_name || 'Ca')),
          expired ? el('span', { class: 'chip', style: 'margin-left:6px' }, 'đã hết hạn') : future ? el('span', { class: 'chip', style: 'margin-left:6px;background:#eff6ff;color:#1d4ed8' }, 'sắp áp dụng') : ''),
        el('td', { style: 'color:var(--muted)' }, r.inout_name || 'Mặc định'),
        el('td', {}, fmtD(r.from_date)), el('td', {}, r.to_date ? fmtD(r.to_date) : '—'),
        el('td', { style: 'color:var(--muted);font-size:13px' }, r.include_children ? 'cả phòng ban cấp dưới' : 'chỉ phòng này'),
        el('td', {}, canEdit ? btnSm('Xoá', () => delIds([r.id], `Xoá lịch trình "${r.mode === 'schedule' ? r.schedule_name : r.shift_name}" của phòng "${r.department}"?`), 'ghost') : '')));
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
  if (_asTab === 'sheet') { $('#main .page-head').classList.add('as-head'); if (_asFull) document.body.classList.add('as-full'); }
}

/* ---------- 4c) PHÂN CA LÀM VIỆC (gán ca/lịch trình theo khoảng ngày) ---------- */
const MERGE_RULES = [
  ['default', 'Mặc định (theo khai báo trong từng ca)'],
  ['filo', 'FILO — Vào trước, ra sau'],
  ['tdhc', 'TĐ-HC — Theo cửa sổ thời gian'],
  ['idm', 'IDM — Máy lẻ vào / máy chẵn ra'],
  ['tdqd', 'TĐ-QĐ — Qua đêm'],
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

/* ---------- 5) ĐƠN TỪ ---------- */
async function pageLeaves() {
  const sel = el('select', { id: 'lv-filter' },
    el('option', { value: 'pending' }, 'Chờ duyệt'),
    el('option', { value: '' }, 'Tất cả'),
    el('option', { value: 'approved' }, 'Đã duyệt'),
    el('option', { value: 'rejected' }, 'Từ chối'));
  setMain(head('Đơn từ', sel), loading());
  const load = async () => {
    const status = $('#lv-filter').value;
    const { rows } = await api('/leaves' + (status ? '?status=' + status : ''));
    const tbl = el('table', { class: 'data' });
    tbl.innerHTML = `<thead><tr><th>Nhân viên</th><th>Loại</th><th>Từ</th><th>Đến</th><th>Lý do</th><th>Trạng thái</th><th></th></tr></thead>`;
    const tb = el('tbody');
    if (!rows.length) tb.append(el('tr', {}, el('td', { colspan: 7 }, el('div', { class: 'empty' }, 'Không có đơn.'))));
    for (const r of rows) {
      const st = { pending: ['warn', 'Chờ duyệt'], approved: ['ok', 'Đã duyệt'], rejected: ['bad', 'Từ chối'] }[r.status];
      const act = r.status === 'pending' ? el('div', { style: 'display:flex;gap:6px' },
        btnSm('Duyệt', () => review(r, 'approve'), 'green'),
        btnSm('Từ chối', () => review(r, 'reject'), 'ghost')) : (r.review_note || '—');
      tb.append(el('tr', {},
        el('td', {}, el('b', {}, r.full_name), el('div', { style: 'color:#999;font-size:12px' }, r.code + ' · ' + (r.department || ''))),
        el('td', {}, r.type),
        el('td', {}, fmtD(r.from_date)), el('td', {}, fmtD(r.to_date)),
        el('td', {}, r.reason || '—'),
        el('td', {}, el('span', { class: 'pill ' + st[0] }, st[1])),
        el('td', {}, act),
      ));
    }
    tbl.append(tb);
    setMain(head('Đơn từ', sel), el('div', { class: 'panel tbl-scroll' }, tbl));
    $('#lv-filter').value = status;
    $('#lv-filter').onchange = load;
  };
  sel.onchange = load; load();
}
async function review(r, action) {
  let note = '';
  if (action === 'reject') { note = prompt('Lý do từ chối (tuỳ chọn):') ?? ''; }
  try { await api('/leaves/' + r.id + '/review', { method: 'POST', body: { action, note } }); toast('Đã cập nhật', 'ok'); pageLeaves(); }
  catch (e) { toast(e.message, 'err'); }
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
  try { await api('/shift-requests/' + r.id + '/review', { method: 'POST', body: { action, note } }); toast('Đã cập nhật', 'ok'); pageShiftReq(); }
  catch (e) { toast(e.message, 'err'); }
}

/* ---------- 5b) LƯƠNG ---------- */
const money = (n) => (Number(n) || 0).toLocaleString('vi-VN');
let _salTab = 'config';
async function pageSalary() {
  const cfgBtn = el('button', { class: 'btn sm ' + (_salTab === 'config' ? '' : 'ghost') }, '⚙ Cấu hình lương');
  const payBtn = el('button', { class: 'btn sm ' + (_salTab === 'payroll' ? '' : 'ghost') }, '📄 Bảng lương / Phiếu lương');
  cfgBtn.onclick = () => { _salTab = 'config'; pageSalary(); };
  payBtn.onclick = () => { _salTab = 'payroll'; pageSalary(); };
  const tabs = [cfgBtn, payBtn];
  if (_salTab === 'payroll') return salaryPayrollView(tabs);
  setMain(head('Lương', ...tabs), loading());
  let data;
  try { data = await api('/admin/salary'); } catch (e) { setMain(head('Lương', ...tabs), el('div', { class: 'empty' }, e.message)); return; }
  const tbl = el('table', { class: 'data' });
  const canEdit = hasPerm('salary');
  const tb = el('tbody');
  if (hourlyMode()) {
    tbl.innerHTML = `<thead><tr><th>Mã NV</th><th>Họ tên</th><th>Bộ phận</th><th>Đơn giá 1 giờ</th><th>Phụ cấp</th><th></th></tr></thead>`;
    for (const s of data.rows) {
      tb.append(el('tr', {},
        el('td', {}, s.code),
        el('td', {}, el('b', {}, s.full_name)),
        el('td', {}, s.department || '—'),
        el('td', {}, s.hourly_rate ? money(s.hourly_rate) : el('span', { style: 'color:#c0392b' }, 'chưa đặt')),
        el('td', {}, money(s.allowance)),
        el('td', {}, canEdit ? btnSm('Sửa', () => salaryModal(s)) : ''),
      ));
    }
  } else {
    tbl.innerHTML = `<thead><tr><th>Mã NV</th><th>Họ tên</th><th>Bộ phận</th><th>Lương cơ bản</th><th>Đơn giá ngày</th><th>Ngày công chuẩn</th><th>Hệ số OT (T/CT/Lễ)</th><th>Phụ cấp</th><th></th></tr></thead>`;
    for (const s of data.rows) {
      const wd = s.working_days_per_month || 26;
      const autoDaily = s.daily_rate ? null : Math.round((s.basic_salary || 0) / wd);
      tb.append(el('tr', {},
        el('td', {}, s.code),
        el('td', {}, el('b', {}, s.full_name)),
        el('td', {}, s.department || '—'),
        el('td', {}, money(s.basic_salary)),
        el('td', {}, s.daily_rate ? money(s.daily_rate) : el('span', { style: 'color:#999' }, money(autoDaily) + ' (auto)')),
        el('td', {}, String(wd)),
        el('td', {}, `${s.ot_rate_weekday ?? 1.5}/${s.ot_rate_weekend ?? 2}/${s.ot_rate_holiday ?? 3}`),
        el('td', {}, money(s.allowance)),
        el('td', {}, canEdit ? btnSm('Sửa', () => salaryModal(s)) : ''),
      ));
    }
  }
  tbl.append(tb);
  const hint = el('div', { class: 'map-hint', style: 'margin-bottom:10px' }, hourlyMode()
    ? 'Chế độ tính công theo giờ: Lương = Tổng giờ làm × đơn giá 1 giờ + phụ cấp.'
    : 'Lương = Số công × đơn giá ngày + OT (giờ × đơn giá giờ × hệ số) + nghỉ phép có lương + phụ cấp. Đơn giá giờ = đơn giá ngày ÷ 8.');
  setMain(head('Lương', cfgBtn, payBtn), hint, el('div', { class: 'panel tbl-scroll' }, tbl));
}

/* ---------- Bảng lương + Phiếu lương ---------- */
async function salaryPayrollView(tabs) {
  const monthI = el('input', { type: 'month', value: todayMonth() });
  const deptSel = el('select', {}, el('option', { value: '' }, '-- Tất cả phòng ban --'));
  const wrap = el('div', {}, loading());
  const head2 = () => head('Lương', ...tabs, monthI, deptSel);
  setMain(head2(), wrap);
  try { const { rows } = await api('/reports/departments'); for (const d of rows) deptSel.append(el('option', { value: d }, d)); } catch {}

  const load = async () => {
    wrap.innerHTML = ''; wrap.append(loading());
    let data;
    try { data = await api(`/admin/payroll?month=${monthI.value}&dept=${encodeURIComponent(deptSel.value)}`); }
    catch (e) { wrap.innerHTML = ''; wrap.append(el('div', { class: 'empty' }, e.message)); return; }
    const hourly = data.mode === 'hourly';
    const tbl = el('table', { class: 'data' });
    tbl.innerHTML = hourly
      ? '<thead><tr><th>Mã NV</th><th>Họ tên</th><th>Bộ phận</th><th>Tổng giờ</th><th>Đơn giá giờ</th><th>Lương giờ</th><th>Phụ cấp</th><th>Thực lĩnh</th><th></th></tr></thead>'
      : '<thead><tr><th>Mã NV</th><th>Họ tên</th><th>Bộ phận</th><th>Công</th><th>Phép</th><th>OT(g)</th><th>Đơn giá ngày</th><th>Lương công</th><th>Lương OT</th><th>Phụ cấp</th><th>Thực lĩnh</th><th></th></tr></thead>';
    const tb = el('tbody');
    if (!data.rows.length) tb.append(el('tr', {}, el('td', { colspan: hourly ? 9 : 12 }, el('div', { class: 'empty' }, 'Chưa có nhân viên.'))));
    for (const { emp, pay } of data.rows) {
      const psBtn = btnSm('🧾 Phiếu lương', () => payslipModal(emp, pay, data));
      const cells = hourly
        ? [emp.code, emp.full_name, emp.department || '', pay.totalHours, money(pay.hourlyRate), money(pay.workSalary), money(pay.allowance), money(pay.net)]
        : [emp.code, emp.full_name, emp.department || '', pay.workUnits, pay.paidLeaveDays, pay.otHoursTotal, money(pay.dailyRate), money(pay.workSalary), money(pay.otSalary), money(pay.allowance), money(pay.net)];
      const tr = el('tr', {});
      cells.forEach((c, i) => tr.append(el('td', i === 1 ? {} : {}, i === 1 ? el('b', {}, c) : String(c))));
      tr.append(el('td', {}, psBtn));
      tb.append(tr);
    }
    tbl.append(tb);
    const totNet = data.rows.reduce((s, r) => s + (r.pay.net || 0), 0);
    wrap.innerHTML = '';
    wrap.append(
      el('div', { style: 'font-weight:800;font-size:16px;color:var(--ink);margin-bottom:4px' }, `Bảng lương tháng ${data.month}`),
      el('div', { class: 'map-hint', style: 'margin-bottom:10px' }, `Kỳ lương: ${data.from} → ${data.to} · Tổng thực lĩnh: ${money(totNet)} đ`),
      el('div', { class: 'panel tbl-scroll' }, tbl));
  };
  monthI.onchange = load; deptSel.onchange = load;
  load();
}

// Phiếu lương 1 nhân viên (in được)
function payslipModal(emp, pay, ctx) {
  const hourly = ctx.mode === 'hourly';
  const line = (label, val, bold) => el('div', { style: 'display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed #eee' + (bold ? ';font-weight:800;font-size:15px;border-bottom:2px solid #ddd' : '') },
    el('span', {}, label), el('span', { style: 'font-variant-numeric:tabular-nums' }, val));
  const rows = hourly ? [
    line('Tổng giờ làm', pay.totalHours + ' giờ'),
    line('Số ngày có công', String(pay.daysWorked)),
    line('Đơn giá 1 giờ', money(pay.hourlyRate) + ' đ'),
    line('Lương theo giờ', money(pay.workSalary) + ' đ'),
    line('Phụ cấp', money(pay.allowance) + ' đ'),
    line('THỰC LĨNH', money(pay.net) + ' đ', true),
  ] : [
    line('Số công', String(pay.workUnits)),
    line('Nghỉ phép có lương', pay.paidLeaveDays + ' ngày'),
    line('Lương cơ bản', money(pay.basicSalary) + ' đ'),
    line('Đơn giá 1 ngày công', money(pay.dailyRate) + ' đ'),
    line('Lương theo công', money(pay.workSalary) + ' đ'),
    line('Lương nghỉ phép', money(pay.paidLeaveSalary) + ' đ'),
    line(`Tăng ca (${pay.otHoursTotal} giờ)`, money(pay.otSalary) + ' đ'),
    line('Phụ cấp', money(pay.allowance) + ' đ'),
    line('THỰC LĨNH', money(pay.net) + ' đ', true),
  ];
  const sheet = el('div', { id: 'payslip-print' },
    el('div', { style: 'text-align:center;margin-bottom:10px' },
      el('div', { style: 'font-weight:800;font-size:16px' }, ctx.company || 'Digiplus'),
      el('div', { style: 'font-size:18px;font-weight:800;margin-top:6px' }, 'PHIẾU LƯƠNG'),
      el('div', { style: 'color:var(--muted);font-size:13px' }, `Tháng ${ctx.month} · Kỳ ${ctx.from} → ${ctx.to}`)),
    el('div', { style: 'margin:10px 0;font-size:14px' },
      el('div', {}, el('b', {}, 'Nhân viên: '), `${emp.full_name} (${emp.code})`),
      el('div', {}, el('b', {}, 'Bộ phận: '), emp.department || '—')),
    el('div', {}, ...rows));
  const printBtn = el('button', { class: 'btn' }, '🖨 In phiếu');
  printBtn.onclick = () => printNode(sheet, `Phiếu lương ${emp.code} ${ctx.month}`);
  openModal('Phiếu lương · ' + emp.full_name, [sheet], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Đóng'), printBtn]);
}

// In 1 node ra cửa sổ in (mở popup, chép HTML, gọi print)
function printNode(node, title) {
  const w = window.open('', '_blank', 'width=520,height=700');
  if (!w) return toast('Trình duyệt chặn cửa sổ in', 'err');
  w.document.write(`<html><head><title>${title}</title><meta charset="utf-8"><style>body{font-family:system-ui,Arial,sans-serif;padding:24px;color:#222}</style></head><body>${node.outerHTML}</body></html>`);
  w.document.close(); w.focus(); setTimeout(() => { w.print(); }, 300);
}
function salaryModal(s) {
  const body = hourlyMode() ? [
    el('div', { style: 'font-weight:700' }, `${s.full_name} (${s.code})`),
    field('Đơn giá 1 giờ làm (VNĐ)', input('sl-hourly', { type: 'number', value: s.hourly_rate || 0, min: 0 })),
    field('Phụ cấp cố định / tháng (VNĐ)', input('sl-allow', { type: 'number', value: s.allowance || 0, min: 0 })),
    el('div', { class: 'map-hint' }, 'Lương kỳ = Tổng giờ làm trong kỳ × đơn giá 1 giờ + phụ cấp.'),
  ] : [
    el('div', { style: 'font-weight:700' }, `${s.full_name} (${s.code})`),
    field('Lương cơ bản / tháng (VNĐ)', input('sl-basic', { type: 'number', value: s.basic_salary || 0, min: 0 })),
    field('Đơn giá 1 ngày công (để trống = tự tính: lương CB ÷ ngày công chuẩn)', input('sl-daily', { type: 'number', value: s.daily_rate || '', min: 0 })),
    field('Ngày công chuẩn / tháng', input('sl-wd', { type: 'number', value: s.working_days_per_month || 26, min: 1 })),
    el('div', { class: 'two-col' },
      field('Hệ số OT ngày thường', input('sl-otw', { type: 'number', step: '0.1', value: s.ot_rate_weekday ?? 1.5 })),
      field('Hệ số OT cuối tuần', input('sl-ote', { type: 'number', step: '0.1', value: s.ot_rate_weekend ?? 2.0 }))),
    el('div', { class: 'two-col' },
      field('Hệ số OT ngày lễ', input('sl-oth', { type: 'number', step: '0.1', value: s.ot_rate_holiday ?? 3.0 })),
      field('Phụ cấp cố định / tháng', input('sl-allow', { type: 'number', value: s.allowance || 0, min: 0 }))),
  ];
  const save = el('button', { class: 'btn' }, 'Lưu');
  save.onclick = async () => {
    const b = hourlyMode() ? {
      hourly_rate: +$('#sl-hourly').value || 0, allowance: +$('#sl-allow').value || 0,
    } : {
      basic_salary: +$('#sl-basic').value || 0, daily_rate: $('#sl-daily').value ? +$('#sl-daily').value : null,
      working_days_per_month: +$('#sl-wd').value || 26, ot_rate_weekday: +$('#sl-otw').value || 1.5,
      ot_rate_weekend: +$('#sl-ote').value || 2.0, ot_rate_holiday: +$('#sl-oth').value || 3.0, allowance: +$('#sl-allow').value || 0,
    };
    try { await api('/admin/salary/' + s.employee_id, { method: 'PUT', body: b }); toast('Đã lưu', 'ok'); closeModal(); pageSalary(); }
    catch (e) { toast(e.message, 'err'); }
  };
  openModal('Cấu hình lương', body, [el('button', { class: 'btn ghost', onclick: closeModal }, 'Huỷ'), save]);
}

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

  // Helper: nút "chọn NHIỀU" (checklist tick). picked rỗng = tất cả.
  const makeChecklist = (icon, allLabel, getItems, picked, afterChange) => {
    const btn = el('button', { class: 'btn ghost sm', style: 'text-align:left;min-width:150px' });
    const sync = () => { btn.textContent = (picked.size ? `${icon} Đã chọn ${picked.size}` : `${icon} ${allLabel}`) + ' ▾'; };
    sync();
    let dd = null;
    const close = (reload) => { if (dd) { dd.remove(); dd = null; sync(); if (reload) afterChange(); } };
    btn.onclick = (ev) => {
      ev.stopPropagation();
      if (dd) { close(true); return; }
      dd = el('div', { style: 'position:fixed;z-index:1200;background:var(--surface,#fff);border:1px solid var(--line,#e5e5e5);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:8px;max-height:360px;overflow:auto;min-width:250px' });
      const selAll = el('input', { type: 'checkbox', style: 'width:auto' }); selAll.checked = picked.size === 0;
      selAll.onchange = () => { picked.clear(); dd.querySelectorAll('.mc-cb').forEach(c => c.checked = false); };
      dd.append(el('label', { style: 'display:flex;gap:8px;align-items:center;font-weight:700;padding:5px 6px;border-bottom:1px solid var(--line,#eee);margin-bottom:4px;cursor:pointer' }, selAll, `${allLabel} (bỏ hết tick = tất cả)`));
      for (const it of getItems()) {
        const cb = el('input', { type: 'checkbox', class: 'mc-cb', style: 'width:auto', ...(picked.has(it.value) ? { checked: '' } : {}) });
        cb.onchange = () => { cb.checked ? picked.add(it.value) : picked.delete(it.value); selAll.checked = picked.size === 0; };
        dd.append(el('label', { style: 'display:flex;gap:8px;align-items:center;padding:4px 6px;cursor:pointer' }, cb, it.text));
      }
      const done = el('button', { class: 'btn sm', style: 'width:100%;margin-top:6px' }, 'Xong');
      done.onclick = () => close(true); dd.append(done);
      document.body.append(dd);
      const r = btn.getBoundingClientRect();
      dd.style.left = Math.max(8, Math.min(r.left, innerWidth - 270)) + 'px';
      dd.style.top = (r.bottom + 4) + 'px';
      setTimeout(() => document.addEventListener('click', function h(ev2) { if (dd && !dd.contains(ev2.target) && ev2.target !== btn) { close(true); document.removeEventListener('click', h, true); } }, true), 0);
    };
    return { btn, sync };
  };
  // Phòng ban (chọn nhiều) + Nhân viên (chọn nhiều, lọc theo phòng ban đã chọn)
  const deptPick = new Set(), empPick = new Set();
  const deptCl = makeChecklist('🏢', 'Cả công ty', () => depts.map(d => ({ value: d, text: d })), deptPick, () => { empPick.clear(); empCl.sync(); load(); });
  const empCl = makeChecklist('👥', 'Tất cả NV', () => emps.filter(e => !deptPick.size || deptPick.has(e.department || '')).map(e => ({ value: e.id, text: `${e.full_name} (${e.code})` })), empPick, () => load());
  const fmt = (d) => d.toISOString().slice(0, 10);
  const now = new Date();
  const fromI = el('input', { type: 'date', value: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), style: 'width:auto' });
  const toI = el('input', { type: 'date', value: fmt(now), style: 'width:auto' });

  let view = 'detail';
  const viewBar = el('div', { style: 'display:inline-flex;gap:6px' });
  const renderViewBar = () => viewBar.replaceChildren(
    (() => { const b = el('button', { class: 'btn sm' + (view === 'detail' ? '' : ' ghost') }, '📋 Chi tiết'); b.onclick = () => { view = 'detail'; renderViewBar(); load(); }; return b; })(),
    (() => { const b = el('button', { class: 'btn sm' + (view === 'summary' ? '' : ' ghost') }, 'Σ Tổng hợp'); b.onclick = () => { view = 'summary'; renderViewBar(); load(); }; return b; })());
  renderViewBar();

  const addBtn = el('button', { class: 'btn sm' }, '+ Thêm giờ');
  const recalcBtn = el('button', { class: 'btn ghost sm' }, '↻ Tính lại');
  // Tích để hiện CẢ CÔNG TY (kể cả ngày chưa chấm) — chỉ áp cho tab Chi tiết
  const allChkInput = el('input', { type: 'checkbox', style: 'width:auto' });
  allChkInput.onchange = () => load();
  const allChk = el('label', { style: 'display:inline-flex;align-items:center;gap:5px;font-size:13px;font-weight:600;color:var(--ink);cursor:pointer', title: 'Hiện tất cả nhân viên, kể cả ngày làm việc chưa chấm công' }, allChkInput, 'Cả công ty (kể cả chưa chấm)');
  // Tích để hiện dấu (*) ở dòng giờ sửa/thêm bằng tay (mặc định BẬT)
  const markChkInput = el('input', { type: 'checkbox', style: 'width:auto', checked: '' });
  markChkInput.onchange = () => load();
  const markChk = el('label', { style: 'display:inline-flex;align-items:center;gap:5px;font-size:13px;font-weight:600;color:var(--ink);cursor:pointer', title: 'Đánh dấu (*) các dòng giờ được sửa/thêm bằng tay' }, markChkInput, 'Dấu (*) sửa tay');
  const wrap = el('div');

  const scope = () => {
    let p = `from=${fromI.value}&to=${toI.value}`;
    if (empPick.size) p += '&ids=' + [...empPick].join(',');
    else if (deptPick.size) p += '&depts=' + encodeURIComponent([...deptPick].join(','));
    if (allChkInput.checked) p += '&all=1';
    return p;
  };
  const mkIso = (date, hm) => hm ? new Date(`${date}T${hm}:00+07:00`).toISOString() : null;
  const openEdit = (r) => attEditModal({ id: r.att_id, work_date: r.date, check_in_at: mkIso(r.date, r.in), check_out_at: mkIso(r.date, r.out), note: '' }, r.employee_id, load);

  // Lưới CHI TIẾT: từng ngày, giờ vào/ra, ca, các lần chấm, nghỉ
  const loadDetail = async () => {
    wrap.innerHTML = ''; wrap.append(loading());
    let d;
    try { d = await api(`/admin/attendance/grid?mode=detail&${scope()}`); }
    catch (e) { wrap.innerHTML = ''; wrap.append(el('div', { class: 'empty' }, e.message)); return; }
    const rows = d.rows || [];
    const showNV = empPick.size !== 1;   // hiện cột NV trừ khi chọn đúng 1 người
    const hrly = hourlyMode();
    // Chế độ tính theo GIỜ: bỏ Trễ/Sớm/OT/Công, hiện Tổng giờ + Tổng phút
    const metricHeads = hrly ? ['Tổng giờ', 'Tổng phút'] : ['Trễ(p)', 'Sớm(p)', 'OT(p)', 'Công'];
    const heads = ['Ngày', 'Thứ', ...(showNV ? ['Mã', 'Họ tên', 'Bộ phận'] : []), 'Ca', 'Vào', 'Ra', 'Các lần chấm', ...metricHeads, 'Nghỉ', 'Trạng thái', ''];
    const tbl = el('table', { class: 'data' });
    tbl.innerHTML = '<thead><tr>' + heads.map(h => `<th>${h}</th>`).join('') + '</tr></thead>';
    const tb = el('tbody');
    if (!rows.length) tb.append(el('tr', {}, el('td', { colspan: heads.length }, el('div', { class: 'empty' }, 'Không có dữ liệu trong khoảng ngày này.'))));
    for (const r of rows) {
      const cells = [
        el('td', {}, r.date.slice(8) + '/' + r.date.slice(5, 7)),
        el('td', {}, r.wd),
        ...(showNV ? [el('td', {}, r.code), el('td', {}, el('b', {}, r.name)), el('td', {}, r.dept || '—')] : []),
        el('td', {}, r.shift ? el('span', { class: 'pill' }, r.shift) : el('span', { class: 'muted' }, '—')),
        el('td', {}, r.in || '—', (r.manual && markChkInput.checked) ? el('span', { style: 'color:#e67e22;font-weight:800;margin-left:2px', title: 'Giờ sửa/thêm bằng tay' }, '*') : ''),
        el('td', {}, r.out || (r.in ? el('span', { class: 'pill muted' }, 'chưa ra') : '—')),
        el('td', {}, (r.punches && r.punches.length) ? el('span', { style: 'font-size:12px;color:var(--muted)' }, r.punches.join(' · ')) : '—'),
        ...(hrly ? [
          el('td', { style: 'text-align:center;font-weight:600' }, r.mins ? (Math.round(r.mins / 60 * 100) / 100) + ' giờ' : '—'),
          el('td', { style: 'text-align:center' }, r.mins ? (r.mins + ' phút') : '—'),
        ] : [
          el('td', {}, r.late > 0 ? el('span', { style: 'color:#c0392b;font-weight:600' }, String(r.late)) : '—'),
          el('td', {}, r.early > 0 ? el('span', { style: 'color:#c0392b;font-weight:600' }, String(r.early)) : '—'),
          el('td', {}, r.ot > 0 ? el('span', { style: 'color:#0a7;font-weight:600' }, String(r.ot)) : '—'),
          el('td', { style: 'text-align:center;font-weight:600' }, String(r.cong ?? 0)),
        ]),
        el('td', { style: 'text-align:center' }, r.leave ? el('span', { class: 'pill warn' }, r.leave) : '—'),
        el('td', {}, r.status || '—'),
        el('td', {}, r.att_id ? btnSm('Sửa', () => openEdit(r)) : ''),
      ];
      tb.append(el('tr', {}, ...cells));
    }
    tbl.append(tb);
    wrap.innerHTML = '';
    wrap.append(
      el('div', { class: 'map-hint', style: 'margin-bottom:10px' }, 'Ký hiệu Nghỉ: P = phép · KL = không lương · CT = công tác · K = khác. "Các lần chấm" liệt kê mọi lượt quẹt trong ngày (VD chấm 4 lần). Bấm "Sửa" để chỉnh giờ.'),
      el('div', { class: 'panel tbl-scroll' }, tbl));
  };

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
    if (!rows.length) tb.append(el('tr', {}, el('td', { colspan: 11 }, el('div', { class: 'empty' }, 'Không có nhân viên trong phạm vi này.'))));
    for (const r of rows) tb.append(el('tr', {},
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
    ));
    tbl.append(tb);
    wrap.innerHTML = '';
    wrap.append(
      el('div', { class: 'map-hint', style: 'margin-bottom:10px' }, `Đang xem ${rows.length} nhân viên. Chọn phòng ban / nhân viên (nút 🏢 / 👥) rồi bấm "↻ Tính lại" để tính lại đúng phạm vi. Bấm "Chi tiết" để xem/sửa 1 người.`),
      el('div', { class: 'panel tbl-scroll' }, tbl));
  };

  const load = () => { view === 'summary' ? loadSummary() : loadDetail(); };
  fromI.onchange = load; toI.onchange = load;
  addBtn.onclick = () => {
    if (empPick.size !== 1) return toast('Chọn đúng 1 nhân viên (nút 👥) trước khi thêm giờ', 'err');
    attEditModal(null, [...empPick][0], load);
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
    el('span', { style: 'color:var(--muted);font-size:13px' }, 'đến'), toI,
    allChk, markChk, addBtn, recalcBtn);
  setMain(head('Tính công'), bar, el('div', { style: 'height:10px' }), wrap);
  load();
}

function attEditModal(row, employeeId, reload) {
  const date0 = row ? row.work_date : new Date().toLocaleDateString('sv', { timeZone: 'Asia/Ho_Chi_Minh' });
  const dateI = input('att-date', { type: 'date', value: date0, ...(row ? { disabled: '' } : {}) });
  const inI = time24('att-in', row?.check_in_at ? isoToHM(row.check_in_at) : '');
  const outI = time24('att-out', row?.check_out_at ? isoToHM(row.check_out_at) : '');
  const noteI = input('att-note', { placeholder: 'VD: Quên chấm, Đi công tác…', value: row?.note || '' });
  const body = [
    field('Ngày', dateI),
    el('div', { class: 'two-col' }, field('Giờ vào', inI), field('Giờ ra (để trống nếu chưa ra)', outI)),
    field('Lý do / ghi chú', noteI),
    el('div', { class: 'map-hint' }, 'Giờ ra nhỏ hơn giờ vào sẽ được hiểu là ca qua đêm (sáng hôm sau).'),
  ];
  const save = el('button', { class: 'btn' }, row ? 'Lưu thay đổi' : 'Thêm giờ');
  save.onclick = async () => {
    const b = { check_in: inI.value || '', check_out: outI.value || '', note: noteI.value };
    try {
      if (row) await api('/admin/attendance/' + row.id, { method: 'PUT', body: b });
      else await api('/admin/attendance', { method: 'POST', body: { ...b, employee_id: employeeId, work_date: dateI.value } });
      toast('Đã lưu', 'ok'); closeModal(); reload();
    } catch (e) { toast(e.message, 'err'); }
  };
  const footer = [el('button', { class: 'btn ghost', onclick: closeModal }, 'Huỷ')];
  if (row) {
    const del = el('button', { class: 'btn ghost', style: 'color:#c0392b' }, '🗑 Xoá giờ');
    del.onclick = async () => {
      if (!confirm('XOÁ hẳn giờ chấm ngày ' + (row.work_date || '') + ' của người này?\nDùng khi chấm nhầm / nghịch. Không hoàn tác.')) return;
      try { await api('/admin/attendance/' + row.id, { method: 'DELETE' }); toast('Đã xoá giờ chấm', 'ok'); closeModal(); reload(); }
      catch (e) { toast(e.message, 'err'); }
    };
    footer.push(del);
  }
  footer.push(save);
  openModal(row ? 'Sửa giờ chấm' : 'Thêm giờ chấm', body, footer);
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

/* ---------- NHẬT KÝ THAO TÁC ---------- */
// Đổi JSON chi tiết nhật ký → chữ dễ đọc (tiếng Việt), thay vì đổ code thô
const LOG_KEY_VI = { name: 'Tên', address: 'Địa chỉ', lat: 'Vĩ độ', lng: 'Kinh độ', radius_m: 'Bán kính(m)',
  code: 'Mã', full_name: 'Họ tên', role: 'Vai trò', username: 'Tài khoản', permissions: 'Quyền',
  department: 'Bộ phận', position: 'Chức danh', phone: 'SĐT', device_pin: 'Số ID máy',
  employee_ids: 'NV (ID)', active: 'Kích hoạt', shift_id: 'Ca', work_schedule_id: 'Lịch trình',
  basic_salary: 'Lương cơ bản', allowance: 'Phụ cấp', name_new: 'Tên mới', parent_id: 'Thuộc bộ phận' };
const LOG_ROLE_VI = { admin: 'Admin', manager: 'Quản lý', employee: 'Nhân viên', master: 'Tài khoản tổng' };
function fmtLogDetail(raw) {
  if (raw == null || raw === '' || raw === '{}') return '(không có chi tiết)';
  let o; try { o = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return String(raw); }
  const flat = {};
  const take = (obj) => { for (const [k, v] of Object.entries(obj || {})) { if (k === 'data' && v && typeof v === 'object') take(v); else flat[k] = v; } };
  take(o);
  const parts = [];
  for (const [k, v] of Object.entries(flat)) {
    if (k === 'id' || v == null || v === '') continue;
    let val = v;
    if (k === 'role') val = LOG_ROLE_VI[v] || v;
    else if (k === 'password') val = '••••';
    else if (k === 'permissions') { try { const a = Array.isArray(v) ? v : JSON.parse(v); val = a.length ? a.length + ' quyền' : 'không quyền'; } catch { val = String(v); } }
    else if (Array.isArray(v)) val = v.join(', ');
    else if (typeof v === 'object') val = JSON.stringify(v);
    parts.push(`${LOG_KEY_VI[k] || k}: ${val}`);
  }
  return parts.length ? parts.join(' · ') : '(không có chi tiết)';
}

async function pageLogs() {
  let tab = 'admin';                 // 'admin' | 'device'
  const LIMIT = 200;
  const st = { admin: { rows: [], total: 0 }, device: { rows: [], total: 0 } };

  const fmt = (d) => d.toISOString().slice(0, 10);
  const now = new Date();
  const fromI = el('input', { type: 'date', value: fmt(new Date(now.getTime() - 29 * 86400000)), style: 'width:auto' });
  const toI = el('input', { type: 'date', value: fmt(now), style: 'width:auto' });
  const qI = el('input', { type: 'search', placeholder: 'Tìm thao tác / người…', style: 'width:190px' });
  const serialSel = el('select', { style: 'width:auto' }, el('option', { value: '' }, 'Tất cả máy'));
  const serialWrap = el('span', { style: 'display:none' }, serialSel);

  const mkTab = (label, key) => { const b = el('button', { class: 'btn sm' + (tab === key ? '' : ' ghost') }, label); b.onclick = () => { tab = key; go2(); }; return b; };
  const applyBtn = el('button', { class: 'btn sm' }, 'Lọc');
  const exportBtn = el('button', { class: 'btn ghost sm' }, '⬇ Xuất Excel');
  applyBtn.onclick = () => load();
  qI.addEventListener('keydown', (e) => { if (e.key === 'Enter') load(); });
  exportBtn.onclick = () => downloadLog();

  const body = el('div');
  const roleVi = { master: 'Tài khoản tổng', admin: 'Quản trị viên', manager: 'Quản lý' };

  function qs() {
    const p = new URLSearchParams();
    if (fromI.value) p.set('from', fromI.value);
    if (toI.value) p.set('to', toI.value);
    if (qI.value.trim()) p.set('q', qI.value.trim());
    if (tab === 'device' && serialSel.value) p.set('serial', serialSel.value);
    return p;
  }
  async function downloadLog() {
    exportBtn.disabled = true;
    try {
      const url = `/admin/logs/${tab}/export.xlsx?` + qs().toString();
      const res = await api(url, { raw: true });
      const blob = await res.blob(); const u = URL.createObjectURL(blob);
      const a = el('a', { href: u, download: `nhatky_${tab === 'admin' ? 'quantri' : 'maychamcong'}.xlsx` });
      document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(u);
    } catch (e) { toast(e.message || 'Lỗi xuất Excel', 'err'); }
    exportBtn.disabled = false;
  }

  async function load() {
    body.innerHTML = ''; body.append(loading());
    const p = qs(); p.set('limit', LIMIT); p.set('offset', 0);
    try {
      if (tab === 'admin') {
        const d = await api('/admin/logs/admin?' + p.toString());
        st.admin = d; renderAdmin();
      } else {
        const d = await api('/admin/logs/device?' + p.toString());
        st.device = d;
        // nạp danh sách máy cho bộ lọc
        if (d.serials) {
          const cur = serialSel.value;
          serialSel.innerHTML = ''; serialSel.append(el('option', { value: '' }, 'Tất cả máy'));
          d.serials.forEach((s) => serialSel.append(el('option', { value: s.serial }, (s.name || s.serial))));
          serialSel.value = cur;
        }
        renderDevice();
      }
    } catch (e) { body.innerHTML = ''; body.append(el('div', { class: 'empty' }, e.message)); }
  }

  function renderAdmin() {
    const d = st.admin;
    const tbl = el('table', { class: 'data' });
    tbl.innerHTML = '<thead><tr><th style="width:150px">Thời gian</th><th>Người thực hiện</th><th>Thao tác</th><th>Chi tiết</th><th style="width:110px">IP</th></tr></thead>';
    const tb = el('tbody');
    if (!d.rows.length) tb.append(el('tr', {}, el('td', { colspan: 5 }, el('div', { class: 'empty' }, 'Chưa có thao tác nào trong khoảng này.'))));
    for (const x of d.rows) tb.append(el('tr', {},
      el('td', {}, el('span', { style: 'font-variant-numeric:tabular-nums' }, x.at)),
      el('td', {}, el('b', {}, x.user_name || x.username || '—'),
        el('div', { style: 'color:#999;font-size:11px' }, (x.username || '') + (x.role ? ' · ' + (roleVi[x.role] || x.role) : ''))),
      el('td', {}, el('span', { class: 'pill' }, x.action || '—')),
      el('td', {}, el('div', { style: 'font-size:12px;color:var(--muted);max-width:360px;word-break:break-word', title: x.detail || '' }, fmtLogDetail(x.detail))),
      el('td', {}, el('span', { style: 'font-size:11px;color:#999' }, x.ip || '')),
    ));
    tbl.append(tb);
    body.innerHTML = '';
    body.append(el('div', { class: 'panel tbl-scroll' }, tbl), moreBar(d));
  }

  function renderDevice() {
    const d = st.device;
    const tbl = el('table', { class: 'data' });
    tbl.innerHTML = '<thead><tr><th style="width:160px">Thời gian</th><th>Máy</th><th>Thao tác</th><th>Người thao tác</th><th>Đối tượng</th></tr></thead>';
    const tb = el('tbody');
    if (!d.rows.length) tb.append(el('tr', {}, el('td', { colspan: 5 }, el('div', { class: 'empty' }, 'Chưa có thao tác nào từ máy. Máy chấm công sẽ tự đẩy nhật ký (vào menu, thêm/xóa vân tay, xóa dữ liệu…) khi được bật.'))));
    for (const x of d.rows) tb.append(el('tr', {},
      el('td', {}, el('span', { style: 'font-variant-numeric:tabular-nums' }, x.op_time || '—')),
      el('td', {}, el('div', {}, x.dev_name || x.serial), x.dev_name ? el('div', { style: 'color:#999;font-size:11px' }, x.serial) : null),
      el('td', {}, el('span', { class: 'pill' }, x.action), el('span', { style: 'color:#bbb;font-size:11px;margin-left:4px' }, '#' + x.op_code)),
      el('td', {}, x.emp_name ? el('b', {}, x.emp_name) : '', el('div', { style: 'color:#999;font-size:11px' }, x.admin_pin ? 'ID ' + x.admin_pin : '')),
      el('td', {}, el('div', { style: 'font-size:12px;color:var(--muted);max-width:280px;word-break:break-word', title: x.raw || '' }, [x.obj1, x.obj2, x.obj3].filter(Boolean).join(' · '))),
    ));
    tbl.append(tb);
    body.innerHTML = '';
    body.append(el('div', { class: 'panel tbl-scroll' }, tbl), moreBar(d));
  }

  // Thanh "tải thêm" khi còn dữ liệu
  function moreBar(d) {
    const wrap = el('div', { style: 'display:flex;align-items:center;gap:12px;margin-top:10px;color:var(--muted);font-size:13px' });
    wrap.append(`Hiển thị ${d.rows.length} / ${d.total} dòng`);
    if (d.rows.length < d.total) {
      const more = el('button', { class: 'btn ghost sm' }, 'Tải thêm');
      more.onclick = async () => {
        more.disabled = true;
        const p = qs(); p.set('limit', LIMIT); p.set('offset', d.rows.length);
        try {
          const nd = await api(`/admin/logs/${tab}?` + p.toString());
          d.rows = d.rows.concat(nd.rows); d.total = nd.total;
          tab === 'admin' ? renderAdmin() : renderDevice();
        } catch (e) { toast(e.message, 'err'); more.disabled = false; }
      };
      wrap.append(more);
    }
    return wrap;
  }

  function go2() {
    tabBar.replaceChildren(mkTab('🖥️ Thao tác quản trị', 'admin'), mkTab('🔌 Thao tác trên máy', 'device'));
    serialWrap.style.display = tab === 'device' ? '' : 'none';
    load();
  }
  const tabBar = el('div', { style: 'display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap' },
    mkTab('🖥️ Thao tác quản trị', 'admin'), mkTab('🔌 Thao tác trên máy', 'device'));

  const filters = el('div', { class: 'panel', style: 'padding:12px 14px;margin-bottom:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap' },
    el('span', { style: 'font-size:13px;color:var(--muted)' }, 'Từ'), fromI,
    el('span', { style: 'font-size:13px;color:var(--muted)' }, 'đến'), toI,
    serialWrap, qI, applyBtn, el('span', { style: 'flex:1' }), exportBtn);

  setMain(head('Nhật ký thao tác'), tabBar, filters, body);
  load();
}

/* ---------- MÁY CHẤM CÔNG (ZKTeco ADMS push) ---------- */
async function pageDevices() {
  setMain(head('Máy chấm công'), loading());
  let d;
  try { d = await api('/admin/devices'); } catch (e) { setMain(head('Máy chấm công'), el('div', { class: 'empty' }, e.message)); return; }

  // Bật/tắt dùng máy chấm công + tự tạo NV — CHỈ tài khoản tổng đổi được
  const enChk = el('input', { type: 'checkbox', style: 'width:auto', ...(d.enabled ? { checked: '' } : {}) });
  const autoChk = el('input', { type: 'checkbox', style: 'width:auto', ...(d.autocreate ? { checked: '' } : {}) });
  const keyReqChk = el('input', { type: 'checkbox', style: 'width:auto', ...(d.key_required ? { checked: '' } : {}) });
  const saveEn = el('button', { class: 'btn sm' }, 'Lưu');
  saveEn.onclick = async () => {
    try {
      await api('/admin/settings', { method: 'PUT', body: { device_enabled: enChk.checked, device_autocreate: autoChk.checked, device_key_required: keyReqChk.checked } });
      SETTINGS.device_enabled = enChk.checked ? '1' : '0';
      toast('Đã lưu. Đang tải lại…', 'ok'); setTimeout(() => location.reload(), 600);
    } catch (e) { toast(e.message, 'err'); }
  };
  const stPill = (on) => el('span', { class: 'pill ' + (on ? 'ok' : 'warn'), style: 'margin-left:6px' }, on ? 'ĐANG BẬT' : 'ĐANG TẮT');
  const togglePanel = isMaster()
    ? el('div', { class: 'panel', style: 'padding:16px 18px;margin-bottom:14px;max-width:640px' },
        el('label', { style: 'display:flex;gap:10px;align-items:flex-start;cursor:pointer' }, enChk,
          el('div', {}, el('b', {}, 'Dùng máy chấm công (kết nối máy ZKTeco)'),
            el('div', { style: 'font-size:13px;color:var(--muted)' }, 'Bật để nhận dữ liệu chấm công máy tự đẩy về. Tắt = chỉ chấm bằng điện thoại. Có thể dùng song song.'))),
        el('label', { style: 'display:flex;gap:10px;align-items:flex-start;cursor:pointer;margin-top:12px' }, autoChk,
          el('div', {}, el('b', {}, 'Tự tạo nhân viên khi đăng ký vân tay trên máy'),
            el('div', { style: 'font-size:13px;color:var(--muted)' }, 'Bật: đăng ký vân tay/khuôn mặt cho Số ID mới trên máy → phần mềm tự tạo NV nháp (Số ID + tên máy gửi về), admin bổ sung sau. Tắt: chỉ ghi nhận, chờ admin gán tay.'))),
        el('label', { style: 'display:flex;gap:10px;align-items:flex-start;cursor:pointer;margin-top:12px' }, keyReqChk,
          el('div', {}, el('b', {}, 'Bắt buộc KEY bản quyền theo máy'),
            el('div', { style: 'font-size:13px;color:var(--muted)' }, 'Bật: mỗi máy phải có key Digiplus cấp (theo Serial) mới DUYỆT được — máy khách tự mua nơi khác không chạy. Máy đang chạy không bị ảnh hưởng. Tắt: máy nào cắm vào cũng duyệt được.'))),
        el('div', { style: 'margin-top:12px' }, saveEn))
    : el('div', { class: 'panel', style: 'padding:16px 18px;margin-bottom:14px;max-width:640px' },
        el('div', {}, el('b', {}, 'Tính năng máy chấm công:'), stPill(d.enabled)),
        el('div', { style: 'margin-top:6px' }, el('b', {}, 'Tự tạo NV khi đăng ký vân tay:'), stPill(d.autocreate)),
        el('div', { style: 'margin-top:6px' }, el('b', {}, 'Bắt buộc key theo máy:'), stPill(d.key_required)),
        el('div', { class: 'map-hint', style: 'margin-top:8px' }, '🔒 Chỉ tài khoản tổng (Digiplus) mới bật/tắt được tính năng máy chấm công.'));

  // Hướng dẫn cấu hình máy + nút Refresh mạng (đổi mạng xong bấm để lấy IP mới)
  const ipVal = el('b', { style: 'color:var(--brand-ink,#c0392b);font-size:16px;font-family:monospace' }, d.server_ips[0] || '(IP máy chủ)');
  const portVal = el('b', {}, String(d.port));
  const ipsHint = el('div', { class: 'map-hint', style: 'margin-top:8px' });
  const renderIPs = (ips, port) => {
    ipVal.textContent = ips[0] || '(IP máy chủ)';
    if (port != null) portVal.textContent = String(port);
    ipsHint.innerHTML = '';
    if (ips.length > 1) {
      ipsHint.append('⚠️ Máy tính có nhiều mạng — chọn IP CÙNG lớp mạng với máy chấm công: ');
      ips.forEach((x, i) => ipsHint.append(i ? '  ·  ' : '', el('b', { style: 'font-family:monospace' }, x)));
    } else if (!ips.length) {
      ipsHint.textContent = 'Chưa thấy IP LAN — kiểm tra dây mạng / Wi-Fi rồi bấm Refresh mạng.';
    }
  };
  const refreshNet = el('button', { class: 'btn sm ghost' }, '🔄 Refresh mạng');
  refreshNet.onclick = async () => {
    refreshNet.disabled = true; const t = refreshNet.textContent; refreshNet.textContent = 'Đang kiểm tra…';
    try { const r = await api('/admin/server-ips'); renderIPs(r.ips, r.port); toast('IP máy chủ hiện tại: ' + (r.ips[0] || 'không thấy'), 'ok'); }
    catch (e) { toast(e.message, 'err'); }
    finally { refreshNet.disabled = false; refreshNet.textContent = t; }
  };
  renderIPs(d.server_ips, d.port);
  // Tên miền cho máy ở chi nhánh khác: ưu tiên đúng tên miền đang mở trang này; không có thì lấy theo cấu hình cài đặt
  const hostNow = location.hostname;
  const isDomain = /[a-z]/i.test(hostNow) && hostNow.includes('.') && hostNow !== 'localhost';
  const domain = isDomain ? hostNow : (d.domain || '');
  const domVal = el('b', { style: 'color:var(--brand-ink,#c0392b);font-size:16px;font-family:monospace' }, domain || '(tên miền của công ty)');
  const domCopy = domain ? el('button', { class: 'btn ghost sm', title: 'Copy tên miền', style: 'padding:2px 6px', onclick: () => copySerial(domain) }, '📋') : '';
  const domNote = domain ? '' : el('div', { style: 'font-size:12px;color:var(--muted)' }, 'Bản này chưa có tên miền (bản LAN) — chỉ dùng được Cách A. Cần dùng qua Internet thì liên hệ Digiplus để cấp tên miền.');
  const guide = el('div', { class: 'panel', style: 'padding:16px 18px;margin-bottom:14px;max-width:640px' },
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap' },
      el('h3', { style: 'margin:0;font-size:15px' }, '🔧 Cách kết nối máy chấm công'), refreshNet),
    el('ol', { style: 'margin:10px 0 0;padding-left:18px;font-size:14px;line-height:1.9' },
      el('li', { html: 'Trên máy: <b>Menu → Comm/Kết nối → Cloud Server (ADMS)</b>.' }),
      el('li', {}, 'Điền địa chỉ máy chủ theo 1 trong 2 cách:',
        el('div', { style: 'margin:4px 0 6px;padding:8px 12px;border:1px solid var(--line);border-radius:10px;line-height:1.7' },
          el('div', {}, el('b', {}, 'Cách A — máy chấm công CÙNG mạng LAN'), ' với máy tính cài phần mềm:'),
          el('div', {}, 'Server IP: ', ipVal, '  ·  Port: ', portVal, '  ', el('span', { style: 'font-size:12px;color:var(--muted)' }, '(đổi mạng xong bấm “Refresh mạng”)')),
          el('div', { html: 'Giao thức <b>HTTP</b> — KHÔNG bật SSL/HTTPS, KHÔNG bật tên miền.' })),
        el('div', { style: 'margin:0 0 4px;padding:8px 12px;border:1px solid var(--line);border-radius:10px;line-height:1.7' },
          el('div', {}, el('b', {}, 'Cách B — máy ở CHI NHÁNH KHÁC / qua Internet'), ' (dùng tên miền):'),
          el('div', { html: 'Bật <b>Tên miền (Domain Name / Enable Domain)</b> rồi điền:' }),
          el('div', {}, 'Địa chỉ máy chủ: ', domVal, ' ', domCopy, '  ·  Port: ', el('b', {}, '443')),
          el('div', { html: 'Bật <b>HTTPS</b>. Máy phải có Internet (DNS đúng, ví dụ 8.8.8.8).' }),
          domNote)),
      el('li', { html: 'Lưu & khởi động lại máy.' }),
      el('li', { html: 'Máy sẽ hiện bên dưới ở trạng thái <b>Chờ duyệt</b> → bấm <b>Duyệt</b>.' }),
      el('li', { html: 'Đăng ký vân tay trên máy → NV tự về phần mềm (bản nháp). Điền <b>Số ID máy</b> trong hồ sơ NV cho khớp <b>số ID trên máy</b> để tính công.' })),
    ipsHint);

  // Bảng danh sách máy
  const tbl = el('table', { class: 'data dev-tbl' });
  tbl.innerHTML = `<thead><tr><th>Máy</th><th>Trạng thái</th><th class="c">Nhân viên</th><th class="c">Vân tay</th><th class="c">Khuôn mặt</th><th class="c">Thẻ</th><th>Kết nối gần nhất</th><th class="c">Số quẹt</th><th></th></tr></thead>`;
  const tb = el('tbody');
  const countCells = {};   // serial -> {nv,fp,face,card} để tự làm mới số liệu
  // Copy serial máy (để dán vào trang cấp key, khỏi gõ tay). Bản LAN chạy http → không có navigator.clipboard nên có dự phòng execCommand.
  const copySerial = async (serial, quiet) => {
    let ok = false;
    try { await navigator.clipboard.writeText(serial); ok = true; } catch {}
    if (!ok) {
      const ta = el('textarea', { style: 'position:fixed;left:-9999px;top:0' });
      ta.value = serial; document.body.append(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch {}
      ta.remove();
    }
    if (!quiet) toast(ok ? 'Đã copy ' + serial : 'Không copy tự động được — bôi đen để copy tay', ok ? 'ok' : 'err');
    return ok;
  };
  // Dán KEY bản quyền cho 1 máy (Digiplus cấp theo Serial)
  const pasteDeviceKey = async (m) => {
    copySerial(m.serial, true);   // copy sẵn serial để dán sang trang cấp key
    // Hộp thoại riêng (không dùng prompt của trình duyệt) để serial BÔI ĐEN được + có nút copy lại bất cứ lúc nào
    const serialI = el('input', { readonly: '', value: m.serial, style: 'font-family:monospace;font-weight:700;flex:1' });
    serialI.onclick = () => serialI.select();
    const copyBtn = el('button', { class: 'btn ghost', onclick: () => copySerial(m.serial) }, '📋 Copy serial');
    const keyT = el('textarea', { rows: 4, placeholder: 'Dán key Digiplus cấp cho serial này…', style: 'width:100%;font-family:monospace' });
    const save = el('button', { class: 'btn' }, 'Lưu key');
    save.onclick = async () => {
      const k = keyT.value.trim();
      if (!k) return toast('Chưa dán key', 'err');
      save.disabled = true;
      try { await api('/admin/devices/' + m.id + '/key', { method: 'POST', body: { key: k } }); toast('Đã lưu key máy ✔', 'ok'); closeModal(); pageDevices(); }
      catch (e) { toast(e.message, 'err'); save.disabled = false; }
    };
    openModal('Key bản quyền máy · ' + (m.name || m.serial), [
      el('label', {}, 'Serial máy (đã copy sẵn — dán sang trang cấp key để lấy key)'),
      el('div', { style: 'display:flex;gap:8px;margin:4px 0 14px' }, serialI, copyBtn),
      el('label', {}, 'Key máy chấm công'),
      keyT,
    ], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Huỷ'), save]);
    setTimeout(() => keyT.focus(), 50);
  };
  if (!d.rows.length) tb.append(el('tr', {}, el('td', { colspan: 9 }, el('div', { class: 'empty' }, 'Chưa có máy nào kết nối. Cấu hình máy theo hướng dẫn trên, máy sẽ tự hiện ở đây.'))));
  for (const m of d.rows) {
    // Nút hay dùng để NGOÀI: Duyệt (khi đang chờ), Mở cửa, Xem quẹt; còn lại gom vào "⋯ Thêm"
    const approveInline = !m.active
      ? btnSm('✅ Duyệt', async () => {
          // Bắt buộc key mà máy chưa có key → báo rõ + mở luôn ô dán key (trước đây bấm không thấy gì)
          if (d.key_required && !m.key_ok) {
            toast('Máy ' + m.serial + ' chưa có KEY bản quyền — dán key Digiplus cấp rồi mới duyệt được.', 'err');
            return pasteDeviceKey(m);
          }
          try { await api('/admin/devices/' + m.id, { method: 'PUT', body: { active: true } }); toast('Đã duyệt máy ' + m.serial + ' — máy sẽ tự khởi động lại để nhận cấu hình và giờ đúng.', 'ok'); pageDevices(); }
          catch (e) { toast(e.message || 'Không duyệt được máy', 'err'); }
        })
      : null;
    const doorBtn = (m.access_control && hasPerm('door_open'))
      ? btnSm('🔓 Mở cửa', async () => { if (!confirm(`Mở cửa tại máy "${m.name || m.serial}" ngay?`)) return; try { const r = await api('/admin/devices/' + m.id + '/open-door', { method: 'POST' }); toast(r.msg || 'Đã gửi lệnh mở cửa', 'ok'); } catch (e) { toast(e.message, 'err'); } })
      : null;
    const logBtn = btnSm('Xem quẹt', () => devicePunchesModal(m), 'ghost');
    // Đồng bộ giờ = ra lệnh máy khởi động lại để lấy lại giờ máy chủ + múi giờ (chỉ máy đã duyệt)
    const timeBtn = (m.active && hasPerm('devices'))
      ? btnSm('🕒 Đồng bộ giờ', async () => {
          if (!confirm(`Đồng bộ giờ máy "${m.name || m.serial}" theo máy chủ?\n\nMáy sẽ KHỞI ĐỘNG LẠI (khoảng 30 giây) rồi tự lấy giờ đúng. Trong lúc đó chưa chấm công được.\nLưu ý: giờ lấy theo đồng hồ của máy tính cài phần mềm — kiểm tra đồng hồ máy tính đúng trước.`)) return;
          try { const r = await api('/admin/devices/' + m.id + '/sync-time', { method: 'POST' }); toast(r.msg || 'Đã gửi lệnh đồng bộ giờ', 'ok'); }
          catch (e) { toast(e.message, 'err'); }
        }, 'ghost')
      : null;
    const keyBtn = (d.key_required && !m.key_ok) ? btnSm('🔑 Dán key', () => pasteDeviceKey(m)) : null;
    const putDev = (body) => api('/admin/devices/' + m.id, { method: 'PUT', body });
    const moreBtn = rowMenu([
      m.active ? { group: 'Dữ liệu từ máy', label: '🕒 Xem giờ trên máy', fn: () => deviceClockModal(m) } : null,
      { group: 'Dữ liệu từ máy', label: '⬇ Tải nhân viên từ máy', fn: async () => { if (!confirm(`Tải danh sách nhân viên + vân tay TỪ máy "${m.name || m.serial}" về phần mềm?\nMáy sẽ đẩy lên khi có kết nối; chờ chút rồi bấm Làm mới.`)) return; try { const r = await api('/admin/devices/' + m.id + '/query-users', { method: 'POST' }); toast(r.msg || 'Đã gửi lệnh tải nhân viên', 'ok'); } catch (e) { toast(e.message, 'err'); } } },
      { group: 'Dữ liệu từ máy', label: '⬇ Tải lại log chấm công', fn: () => deviceAttlogModal(m) },
      { group: 'Dữ liệu từ máy', label: '🧹 Đọc lại thông tin từ máy', fn: async () => { if (!confirm(`Xóa số hiển thị (NV/vân tay/thẻ) của máy "${m.name || m.serial}" rồi ĐỌC LẠI thực tế từ máy?\n\nDùng khi số hiển thị KHÔNG đúng thực tế (VD đồng bộ lỗi). Máy phải đang ONLINE; chờ chút rồi bấm Làm mới.`)) return; try { await api('/admin/devices/' + m.id + '/relearn', { method: 'POST' }); toast('Đã xóa số cũ + yêu cầu máy đẩy lại. Chờ chút rồi Làm mới.', 'ok'); pageDevices(); } catch (e) { toast(e.message, 'err'); } } },
      { group: 'Cài đặt máy', label: '✏️ Đổi tên máy', fn: async () => { const name = prompt('Tên máy:', m.name || ''); if (name != null) { await putDev({ name }); pageDevices(); } } },
      { group: 'Cài đặt máy', label: '🔁 Nhóm đồng bộ', fn: async () => { const g = prompt('Nhóm đồng bộ (các máy CÙNG nhóm sẽ tự đồng bộ NV/vân tay/thẻ/mật mã/khuôn mặt cho nhau).\nĐể trống = không đồng bộ:', m.sync_group || ''); if (g != null) { const r = await putDev({ sync_group: g }); toast(r && r.synced ? `Đã đặt nhóm + tự đồng bộ ${r.synced} máy. Chờ ít giây rồi Làm mới.` : 'Đã đặt nhóm đồng bộ', 'ok'); pageDevices(); } } },
      { group: 'Cài đặt máy', hint: 'Ghép log kiểu IDM: máy số lẻ = VÀO, máy chẵn = RA', label: '🔢 Số máy (ghép log)', fn: async () => { const n = prompt('Số máy (quy tắc ghép log IDM: máy số LẺ = chấm VÀO, máy CHẴN = chấm RA).\n0 = không dùng:', m.machine_number || 0); if (n != null) { await putDev({ machine_number: parseInt(n, 10) || 0 }); toast('Đã đặt số máy', 'ok'); pageDevices(); } } },
      hasPerm('devices') ? { group: 'Cài đặt máy', label: m.access_control ? '🚪 Tắt kiểm soát cửa' : '🚪 Bật kiểm soát cửa', fn: async () => { await putDev({ access_control: !m.access_control }); toast(m.access_control ? 'Đã tắt kiểm soát cửa' : 'Đã bật kiểm soát cửa', 'ok'); pageDevices(); } } : null,
      hasPerm('devices') ? { group: 'Bản quyền & quản trị', label: m.key_ok ? '🔑 Đổi key bản quyền máy' : '🔑 Dán key bản quyền máy', fn: () => pasteDeviceKey(m) } : null,
      (hasPerm('devices') && m.key_ok) ? { group: 'Bản quyền & quản trị', label: '🔑 Gỡ key bản quyền máy', fn: async () => { if (confirm('Gỡ key bản quyền khỏi máy này?')) { await api('/admin/devices/' + m.id + '/key', { method: 'DELETE' }); toast('Đã gỡ key', 'ok'); pageDevices(); } } } : null,
      // Hạ quản trị trên máy về nhân viên (vd quản trị được đồng bộ từ cơ sở khác → không ai ở đây vào được menu máy)
      hasPerm('devices') ? { group: 'Bản quyền & quản trị', label: '👤 Xóa quyền quản trị', fn: async () => {
        if (!confirm(`Hạ TẤT CẢ quản trị trên máy "${m.name || m.serial}" về nhân viên thường?\n\nSau đó ai cũng vào được menu máy (cho tới khi đặt quản trị mới trên máy). Máy phải đang Online để nhận lệnh.`)) return;
        try { const r = await api('/admin/devices/' + m.id + '/clear-admins', { method: 'POST' }); toast(r.msg || 'Đã gửi lệnh', r.count ? 'ok' : 'err'); }
        catch (e) { toast(e.message, 'err'); }
      } } : null,
      { group: 'Xóa / tạm dừng', label: '🗑 Xóa dữ liệu máy', fn: () => deviceClearModal(m) },
      m.active ? { group: 'Xóa / tạm dừng', label: '⏸ Tạm dừng máy', fn: async () => { await putDev({ active: false }); pageDevices(); } } : null,
      { danger: true, group: 'Xóa / tạm dừng', label: '❌ Xóa máy khỏi danh sách', fn: async () => { if (confirm('Xoá máy này khỏi danh sách?')) { await api('/admin/devices/' + m.id, { method: 'DELETE' }); pageDevices(); } } },
    ]);
    const numTd = (v, bold) => el('td', { class: 'num' + (bold ? ' b' : '') + (v ? '' : ' zero') }, String(v));
    const cNV = numTd(m.emp_count ?? 0, true);
    const cFP = numTd(m.fp_count ?? 0);
    const cFace = numTd(m.face_count ?? 0);
    const cCard = numTd(m.card_count ?? 0);
    countCells[m.serial] = { cNV, cFP, cFace, cCard };
    // Online = máy có gọi server trong vòng 2,5 phút gần đây (máy ADMS gọi ~mỗi 10s)
    const online = !!(m.last_seen && (Date.now() - Date.parse(m.last_seen) < 150000));
    const chips = [
      m.sync_group ? el('span', { class: 'chip g', title: 'Nhóm đồng bộ' }, '🔁 ' + m.sync_group) : '',
      m.machine_number ? el('span', { class: 'chip', title: 'Số máy' }, '№ ' + m.machine_number) : '',
      m.access_control ? el('span', { class: 'chip o' }, '🚪 Kiểm soát cửa') : '',
    ].filter(Boolean);
    const seen = m.last_seen ? isoToHMS(m.last_seen) + ' · ' + m.last_seen.slice(8, 10) + '/' + m.last_seen.slice(5, 7) : '';
    tb.append(el('tr', { class: online ? '' : 'off' },
      el('td', {},
        el('div', { class: 'dv-name' }, m.name || el('span', { style: 'color:#9ca3af;font-weight:500' }, 'Chưa đặt tên')),
        el('div', { class: 'dv-serial' }, m.serial,
          el('button', { class: 'cp', title: 'Copy serial', onclick: () => copySerial(m.serial) }, '📋')),
        chips.length ? el('div', { class: 'dv-chips' }, ...chips) : ''),
      el('td', {}, el('div', { class: 'dv-st' },
        el('span', { class: 'st ' + (online ? 'on' : 'offl'), title: online ? 'Máy đang kết nối' : 'Máy không gọi về trong 2,5 phút gần đây' }, el('i', {}), online ? 'Online' : 'Offline'),
        m.active ? el('span', { class: 'pill ok' }, 'Đã duyệt') : el('span', { class: 'pill warn' }, 'Chờ duyệt'),
        // Máy đã có key thì ẩn nhãn cho đỡ rối; chỉ cảnh báo khi CHƯA có key
        (d.key_required && !m.key_ok) ? el('span', { class: 'pill warn' }, '🔑 Chưa có key') : '')),
      cNV, cFP, cFace, cCard,
      el('td', {}, el('div', { class: 'dv-ip' }, m.last_ip || '—'), seen ? el('div', { class: 'dv-sub' }, seen) : ''),
      el('td', { class: 'num b' + (m.punch_count ? '' : ' zero') }, String(m.punch_count),
        m.unmatched ? el('div', { class: 'dv-warn', title: 'Số ID trên máy chưa khớp với nhân viên nào trong phần mềm' }, m.unmatched + ' mã chưa khớp') : ''),
      el('td', {}, el('div', { class: 'dv-act' }, approveInline, keyBtn, doorBtn, timeBtn, logBtn, moreBtn)),
    ));
  }
  tbl.append(tb);
  // Tự làm mới số NV/vân tay/mặt/thẻ mỗi 10s (tự dừng khi rời trang Máy chấm công)
  const tickCounts = async () => {
    if (!document.body.contains(tbl)) return;          // đã rời trang → dừng hẳn
    try {
      const dd = await api('/admin/devices');
      for (const m of dd.rows) {
        const cc = countCells[m.serial]; if (!cc) continue;
        for (const [cell, v] of [[cc.cNV, m.emp_count], [cc.cFP, m.fp_count], [cc.cFace, m.face_count], [cc.cCard, m.card_count]]) {
          cell.textContent = String(v ?? 0); cell.classList.toggle('zero', !v);
        }
      }
    } catch { /* bỏ qua, thử lại lần sau */ }
    if (document.body.contains(tbl)) setTimeout(tickCounts, 10000);
  };
  setTimeout(tickCounts, 10000);
  const RB_LABEL = '🔄 Tính lại công (đổi số máy / chẵn-lẻ vào-ra)';
  const rebuildBtn = el('button', { class: 'btn ghost', title: 'Dùng khi vừa đổi SỐ MÁY hoặc quy tắc chẵn/lẻ (VÀO/RA): ghép LẠI giờ vào/ra từ lượt quẹt của máy theo quy tắc mới rồi tính lại công. Khác "↻ Tính lại" bên Tính công (cái đó giữ nguyên giờ vào/ra, chỉ tính lại chỉ số).' }, RB_LABEL);
  rebuildBtn.onclick = async () => {
    if (!confirm('TÍNH LẠI CÔNG — dùng khi vừa đổi SỐ MÁY hoặc quy tắc chẵn/lẻ VÀO-RA.\n\nSẽ ghép LẠI giờ vào/ra từ lượt quẹt của máy theo quy tắc mới, rồi tính lại công cho các ngày có chấm.\n(Nếu chỉ đổi ca/cấu hình mà giờ vào/ra vẫn đúng → dùng "↻ Tính lại" bên trang Tính công.)\n\nTiếp tục?')) return;
    rebuildBtn.disabled = true; rebuildBtn.textContent = 'Đang xử lý…';
    try { const r = await api('/admin/devices/rebuild', { method: 'POST' }); toast(`Đã tính lại ${r.rebuilt} ngày công`, 'ok'); pageDevices(); }
    catch (e) { toast(e.message, 'err'); }
    finally { rebuildBtn.disabled = false; rebuildBtn.textContent = RB_LABEL; }
  };
  // 1 nút "Đồng bộ" gộp: bấm ra menu chọn Đồng bộ thường (mặc định) hoặc Ép toàn bộ.
  const doResync = async (force) => {
    const msg = force
      ? 'ÉP ĐỒNG BỘ LẠI TOÀN BỘ giữa các máy cùng nhóm — đẩy lại HẾT nhân viên/vân tay/khuôn mặt/thẻ (kể cả cái máy tưởng đã có).\n\nDùng khi lần trước bị lỗi/thiếu. Xếp nhiều lệnh hơn, máy nhận dần trong ít phút. Tiếp tục?'
      : 'Đồng bộ giữa các máy cùng nhóm — đẩy nhân viên/vân tay/khuôn mặt/thẻ/ảnh mà máy còn THIẾU sang mọi máy trong nhóm ngay bây giờ?';
    if (!confirm(msg)) return;
    try {
      const r = await api('/admin/devices/resync', { method: 'POST', body: force ? { force: true } : undefined });
      if (!r.devices) toast('Chưa có nhóm nào ≥2 máy để đồng bộ. Hãy đặt "Nhóm ĐB" giống nhau cho các máy.', 'err');
      else toast(`Đã xếp ${r.queued} lệnh đồng bộ cho ${r.devices} máy (${r.groups} nhóm). Máy nhận dần trong ít ${force ? 'phút' : 'giây'}.`, 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };
  const resyncBtn = rowMenu([
    { label: '🔁 Đồng bộ thường (đẩy cái còn thiếu)', fn: () => doResync(false) },
    { label: '🔁 Ép đồng bộ lại TOÀN BỘ (khi lỗi/thiếu)', fn: () => doResync(true) },
  ], '🔁 Đồng bộ');
  resyncBtn.className = 'btn';   // nút chính (không phải kiểu mờ)
  const usbBtn = el('button', { class: 'btn' }, '⬆ Nhập từ USB');
  usbBtn.onclick = usbImportModal;
  setMain(head('Máy chấm công', usbBtn, resyncBtn, rebuildBtn), togglePanel, guide, el('div', { class: 'panel tbl-scroll' }, tbl));
}

// Nhập dữ liệu chấm công + nhân viên từ USB (máy không nối mạng)
function usbImportModal() {
  const doImport = (kind, file, btn) => {
    const reader = new FileReader();
    reader.onload = async () => {
      if (btn) { btn.disabled = true; btn.textContent = 'Đang nhập…'; }
      try {
        const r = await api('/admin/devices/import-usb', { method: 'POST', body: { kind, fileBase64: reader.result } });
        if (kind === 'users') toast(`Đã nhập ${r.total} nhân viên (${r.created} NV mới)`, 'ok');
        else toast(`Đã nhập ${r.punches} lượt chấm, tạo ${r.newEmps} NV mới`, 'ok');
        closeModal(); pageDevices();
      } catch (e) { toast(e.message, 'err'); if (btn) { btn.disabled = false; btn.textContent = btn._t; } }
    };
    reader.readAsDataURL(file);
  };
  const attFile = el('input', { type: 'file', accept: '.dat,.txt,.csv', style: 'display:block;margin-top:6px' });
  attFile.onchange = () => { if (attFile.files[0]) doImport('attlog', attFile.files[0]); };
  const usrFile = el('input', { type: 'file', accept: '.dat,.txt,.csv', style: 'display:block;margin-top:6px' });
  usrFile.onchange = () => { if (usrFile.files[0]) doImport('users', usrFile.files[0]); };
  openModal('Nhập dữ liệu từ USB', [
    el('div', { class: 'map-hint' }, 'Dùng khi máy chấm công KHÔNG nối mạng: cắm USB vào máy → chọn "Tải dữ liệu ra USB / Download" trên máy → rút USB cắm vào máy tính → chọn file bên dưới.'),
    el('div', { style: 'margin:14px 0;padding-top:8px;border-top:1px solid #f0efec' },
      el('div', { style: 'font-weight:700' }, '1) Nhập dữ liệu chấm công'),
      el('div', { class: 'map-hint', style: 'margin:2px 0 0' }, 'File thường tên *_attlog.dat hoặc .txt. Tự tạo NV cho Số ID chưa có rồi tính công.'),
      attFile),
    el('div', { style: 'margin:14px 0;padding-top:8px;border-top:1px solid #f0efec' },
      el('div', { style: 'font-weight:700' }, '2) Nhập danh sách nhân viên'),
      el('div', { class: 'map-hint', style: 'margin:2px 0 0' }, 'File danh sách NV: mỗi dòng "Số ID [tab/phẩy] Tên nhân viên".'),
      usrFile),
  ], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Đóng')]);
}

// Xóa dữ liệu trên máy chấm công (gửi lệnh ADMS) + xóa chấm công trong phần mềm theo ngày
// Tải lại log chấm công CŨ từ máy theo khoảng ngày (DATA QUERY ATTLOG)
function deviceAttlogModal(m) {
  const fromI = el('input', { type: 'date' }), toI = el('input', { type: 'date' });
  const today = new Date().toISOString().slice(0, 10);
  const d30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  fromI.value = d30; toI.value = today;
  const go = el('button', { class: 'btn' }, '⬇ Tải log về');
  go.onclick = async () => {
    if (!fromI.value || !toI.value) return toast('Chọn khoảng ngày', 'err');
    try { const r = await api('/admin/devices/' + m.id + '/query-attlog', { method: 'POST', body: { from: fromI.value, to: toI.value } }); toast(r.msg || 'Đã gửi lệnh', 'ok'); closeModal(); }
    catch (e) { toast(e.message, 'err'); }
  };
  openModal('Tải lại log chấm công · ' + (m.name || m.serial), [
    el('div', { class: 'map-hint' }, 'Yêu cầu máy gửi lại các lượt chấm công đã lưu trong khoảng ngày. Log về sẽ tự tính lại công. Chỉ tải được log MÁY CÒN LƯU (máy đầy sẽ ghi đè log cũ nhất).'),
    el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px' }, el('span', {}, 'Từ'), fromI, el('span', {}, 'đến'), toI, go),
  ], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Đóng')]);
}
async function deviceClearModal(m) {
  const post = async (path, body, okMsg) => { try { const r = await api('/admin/devices/' + m.id + path, { method: 'POST', body: body || {} }); toast(r.msg || okMsg || 'Đã gửi lệnh', 'ok'); return r; } catch (e) { toast(e.message, 'err'); throw e; } };
  const userBox = el('div', { style: 'max-height:160px;overflow:auto;border:1px solid var(--line,#e5e5e5);border-radius:8px;padding:6px 10px;margin-top:6px' }, loading());
  const selAll = el('input', { type: 'checkbox', style: 'width:auto' });
  const loadUsers = async () => {
    let rows = []; try { rows = (await api('/admin/devices/' + m.id + '/users')).rows; } catch {}
    userBox.innerHTML = '';
    if (!rows.length) { userBox.append(el('div', { class: 'map-hint' }, 'Chưa có dữ liệu nhân viên trên máy này (theo đồng bộ).')); return; }
    for (const u of rows) userBox.append(el('label', { style: 'display:flex;align-items:center;gap:8px;padding:3px 0;font-weight:500;color:var(--ink)' },
      el('input', { type: 'checkbox', class: 'dc-pick', value: u.pin, style: 'width:auto' }), `${u.pin}${u.name ? ' · ' + u.name : ''}${u.privilege > 0 ? ' · [Quản trị]' : ''}`));
  };
  selAll.onchange = () => userBox.querySelectorAll('.dc-pick').forEach((c) => { c.checked = selAll.checked; });
  const delUsersBtn = el('button', { class: 'btn' }, 'Xóa NV đã chọn khỏi máy');
  delUsersBtn.onclick = async () => {
    const pins = [...userBox.querySelectorAll('.dc-pick:checked')].map((x) => x.value);
    if (!pins.length) return toast('Chưa chọn nhân viên', 'err');
    if (!confirm(`Xóa ${pins.length} nhân viên khỏi máy "${m.name || m.serial}"? (không xóa dữ liệu trong phần mềm)`)) return;
    await post('/delete-users', { pins }); loadUsers(); pageDevices();
  };
  const fromI = el('input', { type: 'date' }), toI = el('input', { type: 'date' });
  const rangeBtn = el('button', { class: 'btn' }, 'Xóa chấm công (phần mềm)');
  rangeBtn.onclick = async () => {
    if (!fromI.value || !toI.value) return toast('Chọn khoảng ngày', 'err');
    if (!confirm(`XÓA dữ liệu chấm công TRONG PHẦN MỀM từ ${fromI.value} đến ${toI.value}? Không thể hoàn tác.`)) return;
    try { const r = await api('/admin/attendance/clear-range', { method: 'POST', body: { from: fromI.value, to: toI.value } }); toast(`Đã xóa ${r.attendance} bản ghi công + ${r.punches} lượt quẹt`, 'ok'); } catch (e) { toast(e.message, 'err'); }
  };
  const clearLogBtn = el('button', { class: 'btn ghost' }, '🧹 Xóa log chấm công trên máy');
  clearLogBtn.onclick = () => { if (confirm(`Xóa TOÀN BỘ log chấm công trên máy "${m.name || m.serial}"?\n(Dữ liệu đã đồng bộ về phần mềm vẫn còn.)`)) post('/clear-log'); };
  const clearAdminBtn = el('button', { class: 'btn ghost' }, '👤 Xóa quyền quản trị');
  clearAdminBtn.onclick = () => { if (confirm('Hạ quyền tất cả quản trị trên máy về nhân viên thường (Pri=0)?')) post('/clear-admins'); };
  const clearAllBtn = el('button', { class: 'btn', style: 'background:#c0392b' }, '⚠️ Xóa TOÀN BỘ dữ liệu máy');
  clearAllBtn.onclick = () => { if (confirm(`XÓA SẠCH máy "${m.name || m.serial}": toàn bộ nhân viên + vân tay + log trên máy. Không hoàn tác được trên máy.`) && confirm('Xác nhận LẦN 2: xóa toàn bộ dữ liệu trên máy?')) { post('/clear-all'); pageDevices(); } };

  openModal('Xóa dữ liệu máy · ' + (m.name || m.serial), [
    el('div', { class: 'map-hint' }, 'Lệnh gửi xuống MÁY sẽ chạy khi máy có kết nối mạng. Xóa log máy KHÔNG mất dữ liệu đã đồng bộ về phần mềm.'),
    el('div', { style: 'margin-top:12px;padding-top:8px;border-top:1px solid #f0efec' },
      el('div', { style: 'font-weight:700;margin-bottom:6px' }, '1) Xóa nhân viên trên máy'),
      el('div', { style: 'display:flex;align-items:center;gap:10px' }, el('label', { style: 'display:flex;align-items:center;gap:6px;font-weight:600;color:var(--ink)' }, selAll, 'Chọn tất cả'), delUsersBtn),
      userBox),
    el('div', { style: 'margin-top:14px;padding-top:8px;border-top:1px solid #f0efec' },
      el('div', { style: 'font-weight:700;margin-bottom:6px' }, '2) Xóa nhanh trên máy'),
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, clearLogBtn, clearAdminBtn, clearAllBtn)),
    el('div', { style: 'margin-top:14px;padding-top:8px;border-top:1px solid #f0efec' },
      el('div', { style: 'font-weight:700;margin-bottom:6px' }, '3) Xóa chấm công trong phần mềm (theo khoảng ngày)'),
      el('div', { class: 'map-hint', style: 'margin:0 0 6px' }, 'Xóa bản ghi công + lượt quẹt trong phần mềm (không đụng máy). Dùng khi cần dọn dữ liệu sai.'),
      el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, el('span', {}, 'Từ'), fromI, el('span', {}, 'đến'), toI, rangeBtn)),
  ], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Đóng')]);
  loadUsers();
}
// Xem giờ trên máy: gửi lệnh đọc đồng hồ rồi chờ máy trả lời (máy hỏi lệnh ~10 giây/lần). Chỉ đọc, không đổi gì trên máy.
async function deviceClockModal(m) {
  const box = el('div', {}, el('div', { class: 'empty' }, '⏳ Đang hỏi giờ máy "' + (m.name || m.serial) + '"… (chờ tối đa 45 giây)'));
  let stop = false;
  openModal('Giờ trên máy · ' + (m.name || m.serial), [box], [el('button', { class: 'btn', onclick: () => { stop = true; closeModal(); } }, 'Đóng')]);
  const show = (...nodes) => { box.innerHTML = ''; box.append(...nodes); };
  let since;
  try { since = (await api('/admin/devices/' + m.id + '/read-clock', { method: 'POST' })).since; }
  catch (e) { return show(el('div', { class: 'empty' }, e.message)); }
  const toMs = (s) => { const [d, t] = s.split(' '); const [y, mo, da] = d.split('-').map(Number); const [h, mi, se] = t.split(':').map(Number); return Date.UTC(y, mo - 1, da, h, mi, se); };
  for (let i = 0; i < 22 && !stop; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    let row;
    try { row = ((await api('/admin/devices')).rows || []).find((x) => x.id === m.id); } catch { continue; }
    if (!row || !row.clock_at || row.clock_at < since) continue;
    if (!row.clock_text) {
      return show(el('div', { class: 'empty' }, 'Máy có trả lời nhưng không đọc được giờ (dòng máy này có thể không hỗ trợ lệnh xem giờ).'),
        el('div', { style: 'font-size:12px;color:var(--muted);word-break:break-all' }, 'Máy trả về: ' + (row.clock_raw || '(trống)')));
    }
    const diff = Math.round((toMs(row.clock_text) - toMs(row.clock_at)) / 1000);
    const abs = Math.abs(diff), mins = Math.round(abs / 60);
    const verdict = abs <= 90
      ? el('b', { style: 'color:#1a7f37' }, '✓ Giờ máy khớp máy chủ (lệch ' + abs + ' giây)')
      : el('b', { style: 'color:#c0392b' }, '⚠ Máy ' + (diff > 0 ? 'NHANH' : 'CHẬM') + ' hơn máy chủ khoảng ' + (mins >= 1 ? mins + ' phút' : abs + ' giây'));
    return show(
      el('div', { style: 'font-size:15px;line-height:2' },
        el('div', {}, 'Giờ trên máy: ', el('b', { style: 'font-family:monospace' }, row.clock_text)),
        el('div', {}, 'Giờ máy chủ lúc nhận: ', el('b', { style: 'font-family:monospace' }, row.clock_at)),
        el('div', {}, verdict)),
      el('div', { style: 'font-size:12px;color:var(--muted);margin-top:8px' }, 'Sai số vài giây là bình thường (thời gian truyền). Nếu lệch, bấm "🕒 Đồng bộ giờ" ở dòng máy đó.'));
  }
  if (!stop) show(el('div', { class: 'empty' }, 'Máy chưa trả lời sau 45 giây. Máy có thể đang offline, hoặc dòng máy này không hỗ trợ lệnh xem giờ từ xa.'));
}
function devicePunchesModal(m) {
  const box = el('div', {}, loading());
  api('/admin/devices/' + m.id + '/punches').then(({ rows }) => {
    box.innerHTML = '';
    if (!rows.length) { box.append(el('div', { class: 'empty' }, 'Chưa có lượt quẹt nào.')); return; }
    const t = el('table', { class: 'data' });
    t.innerHTML = '<thead><tr><th>Mã</th><th>Nhân viên</th><th>Thời điểm</th><th>Kiểu</th><th></th></tr></thead>';
    const tb = el('tbody');
    const vName = { 1: 'Vân tay', 15: 'Khuôn mặt', 4: 'Thẻ', 0: 'Mật mã' };
    for (const p of rows) {
      const tr = el('tr', {},
        el('td', {}, p.pin),
        el('td', {}, p.full_name || el('span', { class: 'pill warn' }, 'chưa khớp')),
        el('td', {}, isoToHMS(p.punch_at) + ' ' + p.punch_at.slice(8, 10) + '/' + p.punch_at.slice(5, 7)),
        el('td', {}, vName[p.verify] || ('#' + p.verify)),
        el('td', {}, btnSm('🗑', async () => {
          if (!confirm('Xoá lượt quẹt này (quẹt nhầm/nghịch)?\nLưu ý: nếu bấm "Tính lại công" thì giờ tính từ các lượt quẹt còn lại.')) return;
          try { await api('/admin/devices/' + m.id + '/punch/' + p.id, { method: 'DELETE' }); tr.remove(); toast('Đã xoá lượt quẹt', 'ok'); }
          catch (e) { toast(e.message, 'err'); }
        }, 'ghost')));
      tb.append(tr);
    }
    t.append(tb);
    box.append(el('div', { class: 'tbl-scroll' }, t));
  }).catch(e => { box.innerHTML = ''; box.append(el('div', { class: 'empty' }, e.message)); });
  openModal('Lượt quẹt gần đây — ' + (m.name || m.serial), [box], [el('button', { class: 'btn', onclick: closeModal }, 'Đóng')]);
}

const REPORT_TYPES = [
  ['horizontal', 'Bảng công ngang'],
  ['detail', 'Chi tiết chấm công'],
  ['attendance', 'Chấm công'],
  ['late', 'Đi muộn / về sớm'],
  ['ot', 'Tăng ca'],
  ['leave', 'Nghỉ phép / đơn từ'],
  ['symbol', 'Ký hiệu công'],
  ['summary', 'Tổng hợp nhân viên'],
  ['firstlast', 'Giờ vào-ra đầu/cuối'],
  ['payroll', 'Bảng lương 💰'],
];
const SYMBOL_COLOR = { X: '#166534', T: '#b45309', P: '#1d4ed8', KL: '#475569', CT: '#0e7490', K: '#6b21a8', L: '#7c3aed', V: '#dc2626', O: '#b45309' };
// Nhóm báo cáo cho giao diện dạng thẻ: [nhóm, [ [type, icon, tên, mô tả] ... ]]
const REPORT_GROUPS = [
  ['Bản ghi chấm công', [
    ['attendance', '📋', 'Bản ghi chấm công', 'Tất cả lần chấm: giờ vào/ra, đi muộn, vị trí'],
    ['firstlast', '🕐', 'Giờ vào & ra đầu/cuối', 'Giờ chấm sớm nhất và muộn nhất mỗi ngày'],
  ]],
  ['Chi tiết chấm công', [
    ['detail', '📆', 'Chi tiết theo ngày', 'Chi tiết chấm công từng ngày của từng nhân viên'],
    ['detaillist', '🧾', 'Chi tiết chấm công (danh sách)', 'Danh sách mỗi NV × mỗi ngày: vào/ra, trễ, sớm, công, tăng ca, ca'],
    ['empsheet', '🖨️', 'Bảng chi tiết từng nhân viên (in A4)', 'Mỗi nhân viên 1 trang A4: tổng giờ/công/trễ/sớm/vắng + chi tiết từng ngày + chỗ ký tên. Bấm Xuất Excel để in'],
    ['empsheetlate', '⏰', 'Đi muộn / về sớm theo nhân viên (in A4)', 'Chỉ nhân viên có đi muộn/về sớm, chỉ những ngày đó; mỗi người 1 trang A4 có chỗ ký tên. Bấm Xuất Excel để in'],
    ['detailmulti', '🔁', 'Chi tiết chấm công (nhiều lần vào/ra)', 'Mỗi NV × mỗi ngày: Giờ vào 1 → Giờ ra 4 theo từng lần chấm, trễ, sớm, giờ, công, tăng ca'],
    ['daytime', '⏱️', 'Chi tiết giờ vào/ra', 'Giờ vào–ra thực tế từng ngày trong tháng (ma trận)'],
    ['workhours', '🕘', 'Giờ công & tăng ca', 'Ma trận giờ công mỗi ngày + tổng giờ, giờ tăng ca'],
    ['horizontal', '📊', 'Bảng công ngang', 'Ma trận ngày × NV: mỗi ô là SỐ CÔNG trong ngày + tổng công, tăng ca, trễ, sớm, vắng, nghỉ (xem số giờ ở Bảng thống kê chấm công (giờ))'],
    ['hourstat', '🕒', 'Bảng thống kê chấm công (giờ)', 'Ma trận ngày × NV theo SỐ GIỜ mỗi ngày + giờ công, tăng ca TC1–TC3, vắng, nghỉ từng loại, trễ, sớm'],
    ['symbol', '🔤', 'Bảng ký hiệu / Thống kê tháng', 'X=làm · T=trễ/sớm · P=phép · KL=không lương · CT=công tác · K=nghỉ khác · L=lễ · V=vắng · O=thiếu ra'],
    ['late', '⏰', 'Đi muộn / về sớm', 'Danh sách đi muộn, về sớm và số phút'],
    ['ot', '➕', 'Tăng ca', 'Chi tiết giờ tăng ca theo ngày'],
  ]],
  ['Tổng hợp', [
    ['summary', '👥', 'Tổng hợp nhân viên', 'Tổng công, giờ, tăng ca, trễ, sớm mỗi NV'],
    ['absence', '🚫', 'Vắng mặt / nghỉ phép', 'Số ngày làm, vắng, nghỉ phép, nghỉ lễ, thiếu ra'],
    ['leave', '🌴', 'Nghỉ phép / đơn từ', 'Tổng nghỉ phép và chi tiết theo loại'],
    ['payroll', '💰', 'Bảng lương', 'Bảng lương tháng theo kỳ lương đã cấu hình'],
  ]],
  ['Kiểm soát', [
    ['manualtime', '✍️', 'Giờ sửa/thêm bằng tay', 'Vết ai (quản trị/quản lý) sửa/thêm giờ, ngày giờ nào — theo thời gian sửa'],
  ]],
];

// Nút "chọn nhiều" dùng chung (phòng ban / NV): bỏ hết tick = tất cả. Trả {btn, sync}.
function makeChecklist(icon, allLabel, getItems, picked, afterChange) {
  const btn = el('button', { class: 'btn ghost sm', style: 'text-align:left;min-width:150px' });
  const sync = () => { btn.textContent = (picked.size ? `${icon} Đã chọn ${picked.size}` : `${icon} ${allLabel}`) + ' ▾'; };
  sync();
  let dd = null;
  const close = (reload) => { if (dd) { dd.remove(); dd = null; sync(); if (reload) afterChange(); } };
  btn.onclick = (ev) => {
    ev.stopPropagation();
    if (dd) { close(true); return; }
    dd = el('div', { style: 'position:fixed;z-index:1200;background:var(--surface,#fff);border:1px solid var(--line,#e5e5e5);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:8px;max-height:360px;overflow:auto;min-width:250px' });
    const selAll = el('input', { type: 'checkbox', style: 'width:auto' }); selAll.checked = picked.size === 0;
    selAll.onchange = () => { picked.clear(); dd.querySelectorAll('.mc-cb').forEach(c => c.checked = false); };
    dd.append(el('label', { style: 'display:flex;gap:8px;align-items:center;font-weight:700;padding:5px 6px;border-bottom:1px solid var(--line,#eee);margin-bottom:4px;cursor:pointer' }, selAll, `${allLabel} (bỏ hết tick = tất cả)`));
    for (const it of getItems()) {
      const cb = el('input', { type: 'checkbox', class: 'mc-cb', style: 'width:auto', ...(picked.has(it.value) ? { checked: '' } : {}) });
      cb.onchange = () => { cb.checked ? picked.add(it.value) : picked.delete(it.value); selAll.checked = picked.size === 0; };
      dd.append(el('label', { style: 'display:flex;gap:8px;align-items:center;padding:4px 6px;cursor:pointer' }, cb, it.text));
    }
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
  try { emps = (await api('/admin/employees')).rows || []; } catch {}
  emps = emps.filter(e => e.role !== 'admin' && e.active !== 0);
  const deptPick = new Set(), empPick = new Set();
  let onFilterChange = () => {};
  const deptCl = makeChecklist('🏢', 'Tất cả phòng ban', () => depts.map(d => ({ value: d, text: d })), deptPick, () => { empPick.clear(); empCl.sync(); onFilterChange(); });
  const empCl = makeChecklist('👥', 'Tất cả NV', () => emps.filter(e => !deptPick.size || deptPick.has(e.department || '')).map(e => ({ value: e.id, text: `${e.full_name} (${e.code})` })), empPick, () => onFilterChange());

  const periodQS = () => `from=${fromI.value}&to=${toI.value}`;
  // Phần lọc NV cho query: ưu tiên NV cụ thể (ids), rồi tới nhiều phòng ban (depts)
  const filterQS = () => (empPick.size ? '&ids=' + [...empPick].join(',')
    : (deptPick.size ? '&depts=' + encodeURIComponent([...deptPick].join(',')) : ''))
    + '&mode=' + formSel.value + (mixedMode() && onlyChk.checked ? '&emode=' + formSel.value : '');
  // Chọn tháng = đặt nhanh Từ/Đến ngày về trọn tháng đó
  const snapMonth = () => { const ds = monthDaysArr(monthI.value || todayMonth()); fromI.value = ds[0]; toI.value = ds[ds.length - 1]; };

  // Màn danh sách báo cáo dạng thẻ, gom nhóm
  const hub = () => {
    monthI.onchange = snapMonth; fromI.onchange = null; toI.onchange = null; onFilterChange = () => {};
    formSel.onchange = () => { _rpForm = formSel.value; hub(); }; onlyChk.onchange = () => { _rpOnly = onlyChk.checked; };
    const wrap = el('div', {});
    wrap.append(el('div', { class: 'map-hint', style: 'margin-bottom:4px' }, 'Chọn kỳ (tháng hoặc Từ ngày → Đến ngày), phòng ban và/hoặc nhân viên cụ thể ở trên, rồi bấm vào một báo cáo để xem chi tiết và xuất Excel.'));
    for (const [gname, cards] of REPORT_GROUPS) {
      const list = cards.filter(([v]) => formSel.value !== 'hourly' || !['late', 'ot', 'symbol'].includes(v));
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
    setMain(head('Báo cáo', monthI, fromI, arrow, toI, deptCl.btn, empCl.btn, formSel, onlyLbl), wrap);
  };

  // Xem 1 báo cáo cụ thể (có nút quay lại danh sách)
  const showReport = (type) => {
    const backBtn = el('button', { class: 'btn ghost sm' }, '← Danh sách báo cáo');
    backBtn.onclick = hub;
    const exportBtn = el('button', { class: 'btn green' }, '⬇ Xuất Excel');
    exportBtn.onclick = () => downloadExcel(type, fromI.value, toI.value, filterQS());
    const wrap = el('div', {}, loading());
    setMain(head('Báo cáo', backBtn, monthI, fromI, arrow, toI, deptCl.btn, empCl.btn, formSel, onlyLbl, exportBtn), wrap);
    const load = async () => {
      if (fromI.value && toI.value && toI.value < fromI.value) return toast('Đến ngày phải sau Từ ngày', 'err');
      wrap.innerHTML = ''; wrap.append(loading());
      let data;
      try { data = await api(`/reports/data?type=${type}&${periodQS()}${filterQS()}`); }
      catch (e) { wrap.innerHTML = ''; wrap.append(el('div', { class: 'empty' }, e.message)); return; }
      const tbl = el('table', { class: 'data' });
      const thead = el('tr', {});
      for (const c of data.columns) thead.append(el('th', { style: (c.weekend ? 'background:#fff4e6;color:#b45309;' : '') + (c.sub || c.grp ? 'text-align:center;white-space:pre-line' : '') },
        c.sub ? c.label + '\n' + c.sub : c.grp ? c.grp + '\n' + c.label : c.label));
      tbl.append(el('thead', {}, thead));
      const tb = el('tbody');
      if (!data.rows.length) tb.append(el('tr', {}, el('td', { colspan: data.columns.length }, el('div', { class: 'empty' }, 'Không có dữ liệu.'))));
      for (const row of data.rows) {
        const tr = el('tr', {});
        for (const c of data.columns) {
          const v = row[c.key];
          const isSym = type === 'symbol' && SYMBOL_COLOR[v];
          tr.append(el('td', {
            // white-space:pre-line: ô có nhiều lần vào/ra (máy chủ nối bằng xuống dòng) hiện mỗi cặp một dòng
            style: (c.weekend ? 'background:#fffaf3;' : '') + (isSym ? `color:${SYMBOL_COLOR[v]};font-weight:700;text-align:center` : (c.key.startsWith('d20') ? 'text-align:center;white-space:pre-line' : 'white-space:pre-line')),
          }, v === '' || v == null ? '' : String(v)));
        }
        tb.append(tr);
      }
      tbl.append(tb);
      wrap.innerHTML = '';
      // Khung bảng cao vừa màn hình, tự cuộn bên trong → thanh kéo ngang luôn nằm ở đáy khung (không phải kéo xuống cuối trang);
      // dòng tiêu đề + 2 cột đầu (mã, tên) đứng yên khi cuộn.
      const box = el('div', { class: 'panel rep-scroll' }, tbl);
      wrap.append(el('div', { style: 'font-weight:800;font-size:16px;color:var(--ink);margin-bottom:10px' }, data.title), box);
      const pinCols = data.columns.some(c => c.key.startsWith('d20')) ? (data.columns[0].key === 'stt' ? 4 : 2) : 0;
      setTimeout(() => {
        box.style.maxHeight = Math.max(300, innerHeight - box.getBoundingClientRect().top - 16) + 'px';
        if (!pinCols) return;
        const ths = [...tbl.querySelectorAll('thead th')].slice(0, pinCols);
        let left = 0;
        ths.forEach((th, i) => {
          const L = left;
          th.classList.add('pin'); th.style.left = L + 'px';
          tbl.querySelectorAll(`tbody tr > td:nth-child(${i + 1})`).forEach(td => { td.classList.add('pin'); td.style.left = L + 'px'; });
          left += th.getBoundingClientRect().width;
        });
      });
    };
    const snapAndLoad = () => { snapMonth(); load(); };
    monthI.onchange = snapAndLoad; fromI.onchange = load; toI.onchange = load; onFilterChange = load;
    formSel.onchange = () => { _rpForm = formSel.value; load(); }; onlyChk.onchange = () => { _rpOnly = onlyChk.checked; load(); };
    load();
  };

  hub();
}
async function downloadExcel(type, from, to, extraQS) {
  try {
    const res = await api(`/reports/export.xlsx?type=${type}&from=${from}&to=${to}${extraQS || ''}`, { raw: true });
    if (!res.ok) { toast('Máy chủ trả lỗi ' + res.status + ' khi xuất', 'err'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: `baocao_${type}_${from}_${to}.xlsx` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Đã xuất Excel', 'ok');
  } catch (e) { toast('Không xuất được file (mất kết nối máy chủ, thử lại)', 'err'); }
}

/* ---------- 7) CÀI ĐẶT ---------- */
/* ---------- Sao lưu / phục hồi (tải & nạp file nhị phân) ---------- */
async function downloadBackup(name) {
  try {
    const res = await fetch('/api/admin/backup/download?name=' + encodeURIComponent(name), { headers: { Authorization: 'Bearer ' + getToken() } });
    if (!res.ok) { toast('Lỗi tải bản sao lưu', 'err'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  } catch (e) { toast(e.message, 'err'); }
}
async function restoreBackup(file) {
  const buf = await file.arrayBuffer();
  const res = await fetch('/api/admin/backup/restore', { method: 'POST', headers: { Authorization: 'Bearer ' + getToken(), 'Content-Type': 'application/octet-stream' }, body: buf });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { toast(j.error || 'Lỗi phục hồi', 'err'); return; }
  alert('✅ Đã nạp bản sao lưu.\n\nBây giờ hãy KHỞI ĐỘNG LẠI phần mềm (tắt rồi mở lại) để hoàn tất phục hồi dữ liệu.');
}
async function restoreFullBackup(file) {
  const buf = await file.arrayBuffer();
  const res = await fetch('/api/admin/backup/full-restore', { method: 'POST', headers: { Authorization: 'Bearer ' + getToken(), 'Content-Type': 'application/octet-stream' }, body: buf });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { toast(j.error || 'Lỗi phục hồi', 'err'); return; }
  alert('✅ Đã nạp bản sao lưu TOÀN BỘ (dữ liệu + ảnh + logo).\n\nBây giờ hãy KHỞI ĐỘNG LẠI phần mềm (tắt rồi mở lại) để hoàn tất.');
}
const fmtSize = (b) => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';

/* ---------- Thông báo đẩy (Web Push) cho quản lý ---------- */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
function urlB64ToU8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(s); const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
async function pushState() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try { const reg = await navigator.serviceWorker.ready; return (await reg.pushManager.getSubscription()) ? 'on' : 'off'; } catch { return 'off'; }
}
async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Trình duyệt này không hỗ trợ thông báo đẩy.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Bạn chưa cho phép hiện thông báo (kiểm tra quyền của trình duyệt).');
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api('/admin/push/vapid');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToU8(publicKey) });
  await api('/admin/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
}
async function disablePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) { try { await api('/admin/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }); } catch {} try { await sub.unsubscribe(); } catch {} }
}
// Đảm bảo server có đăng ký của trình duyệt này (đồng bộ lại, không hỏi quyền)
async function ensureSubscribed() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await api('/admin/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
    return !!sub;
  } catch { return false; }
}

/* ---------- Cài app vào máy (PWA install) ---------- */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

async function pageSettings() {
  if (!DEPARTMENTS.length) { try { await loadRefs(); } catch {} }   // cần danh sách phòng ban cho mục đặt kiểu chấm công riêng
  setMain(head('Cài đặt'), loading());
  const s = await api('/admin/settings');
  const nameI = input('st-name', { value: s.company_name });
  const addrI = input('st-addr', { value: s.company_address || '', placeholder: 'Địa chỉ công ty (hiện trên đầu báo cáo)' });
  const saveName = el('button', { class: 'btn' }, 'Lưu tên & địa chỉ');
  saveName.onclick = async () => { try { await api('/admin/settings', { method: 'PUT', body: { company_name: nameI.value, company_address: addrI.value } }); toast('Đã lưu', 'ok'); applyBrand(); } catch (e) { toast(e.message, 'err'); } };

  // Logo công ty
  const logoImg = el('img', { src: s.company_logo || '/icons/logo.png', alt: 'logo', style: 'height:56px;max-width:220px;object-fit:contain;background:#fff;border:1px solid var(--line,#eee);border-radius:10px;padding:6px' });
  const logoFile = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/svg+xml', style: 'font-size:13px' });
  const upLogo = el('button', { class: 'btn sm' }, 'Tải logo lên');
  const rmLogo = el('button', { class: 'btn sm ghost' }, 'Dùng logo mặc định');
  upLogo.onclick = async () => {
    const f = logoFile.files?.[0];
    if (!f) return toast('Chọn file ảnh logo (PNG/JPG/WebP/SVG)', 'err');
    if (f.size > 2 * 1024 * 1024) return toast('Logo tối đa 2MB', 'err');
    upLogo.disabled = true;
    try {
      const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
      const r = await api('/admin/branding', { method: 'POST', body: { logo: dataUrl } });
      logoImg.src = r.logo; toast('Đã cập nhật logo', 'ok'); applyBrand();
    } catch (e) { toast(e.message, 'err'); }
    finally { upLogo.disabled = false; }
  };
  rmLogo.onclick = async () => {
    if (!confirm('Xoá logo, dùng lại logo mặc định?')) return;
    try { await api('/admin/branding', { method: 'POST', body: { remove: true } }); logoImg.src = '/icons/logo.png'; toast('Đã xoá logo', 'ok'); applyBrand(); }
    catch (e) { toast(e.message, 'err'); }
  };

  const oldP = input('st-old', { type: 'password' });
  const newP = input('st-new', { type: 'password' });
  const savePw = el('button', { class: 'btn' }, 'Đổi mật khẩu');
  savePw.onclick = async () => {
    try { await api('/auth/change-password', { method: 'POST', body: { oldPassword: oldP.value, newPassword: newP.value } }); toast('Đã đổi mật khẩu', 'ok'); oldP.value = newP.value = ''; }
    catch (e) { toast(e.message, 'err'); }
  };

  const panel1 = el('div', { class: 'panel', style: 'padding:20px;max-width:520px;margin-bottom:16px' },
    el('h3', { style: 'margin-top:0' }, 'Thông tin công ty'),
    hasPerm('settings') ? el('div', { style: 'display:flex;flex-direction:column;gap:14px' },
      field('Tên công ty (hiển thị trên app)', nameI),
      field('Địa chỉ công ty (hiện trên đầu báo cáo)', addrI), saveName,
      el('hr', { style: 'border:none;border-top:1px solid var(--line,#eee);margin:2px 0' }),
      el('div', {},
        el('label', {}, 'Logo công ty (hiện ở màn đăng nhập & app nhân viên)'),
        el('div', { style: 'display:flex;align-items:center;gap:14px;margin-top:8px;flex-wrap:wrap' },
          logoImg,
          el('div', { style: 'display:flex;flex-direction:column;gap:8px' }, logoFile, el('div', { style: 'display:flex;gap:8px' }, upLogo, rmLogo)))),
      el('div', { class: 'map-hint' }, 'PNG / JPG / WebP / SVG, tối đa 2MB. Đổi xong tải lại trang (F5) để thấy ở màn đăng nhập.'))
      : el('p', { style: 'color:var(--muted)' }, 'Bạn không có quyền sửa mục này.'));

  // ----- Kiểu chấm công + Phạm vi chấm công -----
  const modeShift = el('input', { type: 'radio', name: 'att-mode', value: 'shift', style: 'width:auto', ...(s.attendance_mode !== 'hourly' ? { checked: '' } : {}) });
  const modeHourly = el('input', { type: 'radio', name: 'att-mode', value: 'hourly', style: 'width:auto', ...(s.attendance_mode === 'hourly' ? { checked: '' } : {}) });
  const stRule = hourlyRulePicker('att-hrule', s.hourly_merge_rule, modeHourly, [modeShift, modeHourly]);
  const geoChk = el('input', { type: 'checkbox', id: 'st-geo', style: 'width:auto', ...(s.geofence_enforce === '1' ? { checked: '' } : {}) });
  const devChk = el('input', { type: 'checkbox', id: 'st-dev', style: 'width:auto', ...(s.device_enabled === '1' ? { checked: '' } : {}), ...(s.use_device_locked ? { disabled: '' } : {}) });
  const phoneChk = el('input', { type: 'checkbox', id: 'st-phone', style: 'width:auto', ...(s.phone_enabled !== '0' ? { checked: '' } : {}), ...(s.use_phone_locked ? { disabled: '' } : {}) });
  const inclAdminChk = el('input', { type: 'checkbox', id: 'st-incladmin', style: 'width:auto', ...(s.payroll_include_admin === '1' ? { checked: '' } : {}) });
  const lockChk = el('input', { type: 'checkbox', id: 'st-lock', style: 'width:auto', ...(s.device_lock_enabled === '1' ? { checked: '' } : {}) });
  const selfChk = el('input', { type: 'checkbox', id: 'st-self', style: 'width:auto', ...(s.self_shift_enabled === '1' ? { checked: '' } : {}) });
  const apprChk = el('input', { type: 'checkbox', id: 'st-appr', style: 'width:auto', ...(s.self_shift_approve !== '0' ? { checked: '' } : {}) });
  const dedupI = el('input', { type: 'number', min: '0', style: 'width:70px', value: s.punch_dedup_min ?? '15' });
  const saveMode = el('button', { class: 'btn' }, 'Lưu cấu hình chấm công');
  saveMode.onclick = async () => {
    const attendance_mode = document.querySelector('input[name=att-mode]:checked')?.value === 'hourly' ? 'hourly' : 'shift';
    const hourly_merge_rule = stRule.value();
    try {
      const body = { attendance_mode, hourly_merge_rule, geofence_enforce: geoChk.checked, device_lock_enabled: lockChk.checked, payroll_include_admin: inclAdminChk.checked, self_shift_enabled: selfChk.checked, self_shift_approve: apprChk.checked, punch_dedup_min: dedupI.value };
      if (isMaster()) {   // chỉ tài khoản tổng đổi được máy chấm công / chấm điện thoại
        if (!s.use_device_locked) body.device_enabled = devChk.checked;
        if (!s.use_phone_locked) body.phone_enabled = phoneChk.checked;
      }
      await api('/admin/settings', { method: 'PUT', body });
      toast('Đã lưu. Đang tải lại…', 'ok'); setTimeout(() => location.reload(), 700);
    } catch (e) { toast(e.message, 'err'); }
  };
  // Công ty có cả 2 kiểu: đặt kiểu chấm công RIÊNG cho từng phòng ban (hoặc từng người ở hồ sơ nhân viên)
  const mixDept = el('select', { style: 'width:auto;min-width:150px' }, el('option', { value: '*' }, 'Tất cả nhân viên'), ...(DEPARTMENTS || []).map((d) => el('option', { value: d.name }, d.name)));
  const mixMode = el('select', { style: 'width:auto' }, ...['', 'shift', 'hourly'].map((v) => el('option', { value: v }, ATT_MODE_LABEL[v])));
  const mixBtn = btnSm('Áp dụng', async () => {
    const who = mixDept.value === '*' ? 'TẤT CẢ nhân viên' : `phòng "${mixDept.value}"`;
    if (!confirm(`Đặt kiểu chấm công "${ATT_MODE_LABEL[mixMode.value]}" cho ${who}?`)) return;
    try { const r = await api('/admin/employees/att-mode', { method: 'POST', body: { department: mixDept.value, mode: mixMode.value } }); toast(`Đã đặt cho ${r.count} nhân viên. Đang tải lại…`, 'ok'); setTimeout(() => location.reload(), 800); }
    catch (e) { toast(e.message, 'err'); }
  });
  const mixBox = el('div', { style: 'padding:10px;border:1px dashed var(--line,#ddd);border-radius:10px' },
    el('b', {}, 'Công ty vừa có người chấm theo ca, vừa có người chấm theo giờ?'),
    el('div', { style: 'font-size:13px;color:var(--muted);margin:4px 0 8px' }, 'Lựa chọn ở trên là kiểu CHUNG. Nhóm nào khác thì đặt riêng tại đây theo phòng ban, hoặc đặt cho từng người ở Nhân viên → Sửa → "Kiểu chấm công". '
      + (SETTINGS.any_shift && SETTINGS.any_hourly ? 'Hiện công ty đang có CẢ HAI kiểu.' : SETTINGS.any_hourly ? 'Hiện tất cả đang chấm theo giờ.' : 'Hiện tất cả đang chấm theo ca.')),
    el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, mixDept, mixMode, mixBtn));
  const modeRow = (radio, title, desc) => el('label', { style: 'display:flex;gap:10px;align-items:flex-start;padding:10px;border:1px solid var(--line,#eee);border-radius:10px;cursor:pointer' },
    radio, el('div', {}, el('b', {}, title), el('div', { style: 'font-size:13px;color:var(--muted)' }, desc)));
  const panelMode = hasPerm('settings') ? el('div', { class: 'panel', style: 'padding:20px;max-width:520px;margin-bottom:16px' },
    el('h3', { style: 'margin-top:0' }, 'Kiểu chấm công'),
    el('div', { style: 'display:flex;flex-direction:column;gap:10px' },
      modeRow(modeShift, '🕐 Theo ca làm việc', 'Có ca, tính đi muộn / về sớm / tăng ca, báo cáo đầy đủ. Phù hợp văn phòng, nhà máy.'),
      modeRow(modeHourly, '⏱️ Chỉ tính công theo giờ', 'Không cần khai báo ca, chỉ tính tổng giờ làm để trả lương theo giờ. Đơn giản cho cửa hàng, quán.'),
      stRule.box,
      mixBox,
      el('hr', { style: 'border:none;border-top:1px solid var(--line,#eee);margin:6px 0' }),
      el('h3', { style: 'margin:0;font-size:15px' }, 'Phạm vi chấm công (GPS)'),
      el('label', { style: 'display:flex;gap:10px;align-items:flex-start;cursor:pointer' }, geoChk,
        el('div', {}, el('b', {}, 'Chỉ cho chấm trong bán kính chi nhánh'),
          el('div', { style: 'font-size:13px;color:var(--muted)' }, 'Bật: nhân viên phải ở trong bán kính (đặt riêng từng chi nhánh, mục Chi nhánh) mới chấm được. Tắt: chấm tự do ở bất kỳ đâu, hệ thống vẫn ghi lại khoảng cách.'))),
      el('hr', { style: 'border:none;border-top:1px solid var(--line,#eee);margin:6px 0' }),
      el('h3', { style: 'margin:0;font-size:15px' }, 'Chống chấm hộ (khoá thiết bị)'),
      el('label', { style: 'display:flex;gap:10px;align-items:flex-start;cursor:pointer' }, lockChk,
        el('div', {}, el('b', {}, 'Mỗi tài khoản chỉ chấm trên 1 điện thoại'),
          el('div', { style: 'font-size:13px;color:var(--muted)' }, 'Bật: điện thoại đầu tiên nhân viên chấm sẽ được gắn cho tài khoản; đăng nhập máy khác sẽ KHÔNG chấm được (chống mượn tài khoản, chấm hộ). Đổi điện thoại phải admin duyệt ở menu “Duyệt đổi thiết bị”. Ảnh chấm công luôn được đóng dấu giờ + tên + GPS.'))),
      el('hr', { style: 'border:none;border-top:1px solid var(--line,#eee);margin:6px 0' }),
      el('h3', { style: 'margin:0;font-size:15px' }, 'Chống chấm trùng liên tiếp'),
      el('label', { style: 'display:flex;gap:10px;align-items:center' },
        el('div', {}, el('b', {}, 'Bỏ qua lần chấm trùng trong '), dedupI, el('b', {}, ' phút'),
          el('div', { style: 'font-size:13px;color:var(--muted)' }, 'Lượt quẹt/chấm của cùng một người cách lượt trước dưới số phút này chỉ tính 1 lần — chống bấm 2 lần trên app, quẹt máy liên tiếp, và không để lượt lặp làm lệch các cặp vào/ra. Mặc định 15. Nếu nhân viên có nghỉ giữa giờ ngắn hơn số này (và có quẹt) thì giảm xuống. Đặt 0 = lưu đủ mọi lượt quẹt (khi ghép cặp vào/ra vẫn tự bỏ lượt lặp dưới 5 phút).'))),
      el('hr', { style: 'border:none;border-top:1px solid var(--line,#eee);margin:6px 0' }),
      el('h3', { style: 'margin:0;font-size:15px' }, 'Hình thức chấm công'),
      // Máy chấm công (ZKTeco)
      s.use_device_locked
        ? el('div', { style: 'font-size:13px;color:var(--muted)' }, el('b', { style: 'color:var(--ink)' }, '📟 Máy chấm công: ' + (s.device_enabled === '1' ? 'BẬT' : 'TẮT') + '. '), '🔧 Đặt sẵn theo bộ cài (config.txt) — muốn đổi thì sửa config.txt rồi khởi động lại phần mềm.')
        : (isMaster()
          ? el('label', { style: 'display:flex;gap:10px;align-items:flex-start;cursor:pointer' }, devChk,
              el('div', {}, el('b', {}, '📟 Dùng máy chấm công (ZKTeco)'),
                el('div', { style: 'font-size:13px;color:var(--muted)' }, 'Nhận dữ liệu vân tay/khuôn mặt/thẻ đẩy về từ máy. Cấu hình & duyệt máy ở menu “Máy chấm công”.')))
          : el('div', { style: 'font-size:13px;color:var(--muted)' }, el('b', { style: 'color:var(--ink)' }, s.device_enabled === '1' ? '📟 Máy chấm công đang BẬT. ' : '📟 Máy chấm công đang TẮT. '), '🔒 Chỉ tài khoản tổng bật/tắt được.')),
      // Chấm công điện thoại (selfie + GPS)
      s.use_phone_locked
        ? el('div', { style: 'font-size:13px;color:var(--muted)' }, el('b', { style: 'color:var(--ink)' }, '📱 Chấm công điện thoại: ' + (s.phone_enabled !== '0' ? 'BẬT' : 'TẮT') + '. '), '🔧 Đặt sẵn theo bộ cài (config.txt).')
        : (isMaster()
          ? el('label', { style: 'display:flex;gap:10px;align-items:flex-start;cursor:pointer' }, phoneChk,
              el('div', {}, el('b', {}, '📱 Dùng chấm công điện thoại (ảnh + định vị)'),
                el('div', { style: 'font-size:13px;color:var(--muted)' }, 'Tắt nếu công ty chỉ dùng máy chấm công — nhân viên sẽ không thấy nút chấm công trên app điện thoại.')))
          : el('div', { style: 'font-size:13px;color:var(--muted)' }, el('b', { style: 'color:var(--ink)' }, s.phone_enabled !== '0' ? '📱 Chấm điện thoại đang BẬT. ' : '📱 Chấm điện thoại đang TẮT. '), '🔒 Chỉ tài khoản tổng bật/tắt được.')),
      el('label', { style: 'display:flex;gap:10px;align-items:flex-start;cursor:pointer;margin-top:4px' }, inclAdminChk,
        el('div', {}, el('b', {}, '👑 Tính công cho cả tài khoản Admin'),
          el('div', { style: 'font-size:13px;color:var(--muted)' }, 'Mặc định người quyền Admin (chủ/quản trị) KHÔNG hiện ở Tính công / Báo cáo / Lương / Phân ca. Bật nếu Admin cũng là người đi làm cần chấm công.'))),
      el('hr', { style: 'border:none;border-top:1px solid var(--line,#eee);margin:6px 0' }),
      el('h3', { style: 'margin:0;font-size:15px' }, 'Nhân viên tự chọn ca'),
      el('label', { style: 'display:flex;gap:10px;align-items:flex-start;cursor:pointer' }, selfChk,
        el('div', {}, el('b', {}, 'Cho phép nhân viên tự đăng ký ca'),
          el('div', { style: 'font-size:13px;color:var(--muted)' }, 'Bật: trên app nhân viên có mục “Chọn ca” để tự đăng ký ca cho từng ngày. Tắt: mục này ẩn đi. (Chỉ áp dụng khi chấm theo ca.)'))),
      el('label', { style: 'display:flex;gap:10px;align-items:flex-start;cursor:pointer' }, apprChk,
        el('div', {}, el('b', {}, 'Yêu cầu quản lý duyệt'),
          el('div', { style: 'font-size:13px;color:var(--muted)' }, 'Bật: ca nhân viên đăng ký phải được duyệt ở menu “Duyệt chọn ca” mới vào lịch. Tắt: đăng ký xong tự áp dụng ngay.'))),
      saveMode)) : null;

  // ----- Quy tắc tính công -----
  const wkDays = new Set((s.weekend_days || '7').split(',').map(x => x.trim()).filter(Boolean));
  const wkBoxes = [1, 2, 3, 4, 5, 6, 7].map(d => el('label', { style: 'display:flex;align-items:center;gap:5px;font-weight:600;color:var(--ink)' },
    el('input', { type: 'checkbox', class: 'wk-day', value: d, style: 'width:auto', ...(wkDays.has(String(d)) ? { checked: '' } : {}) }),
    { 1: 'T2', 2: 'T3', 3: 'T4', 4: 'T5', 5: 'T6', 6: 'T7', 7: 'CN' }[d]));
  const wkOtChk = el('input', { type: 'checkbox', style: 'width:auto', ...(String(s.weekend_work_as_ot ?? '1') === '1' ? { checked: '' } : {}) });
  // Làm tròn (áp chung cả công ty): số chữ số thập phân + lùi / tới
  const decSel = (v) => el('select', {}, ...[0, 1, 2, 3].map((d) => el('option', { value: d, ...(String(v ?? 2) === String(d) ? { selected: '' } : {}) }, d === 0 ? '0 (số nguyên)' : d + ' số lẻ')));
  const modeSel = (v) => el('select', {}, ...[['0', 'Lùi (xuống)'], ['1', 'Tới (lên)']].map(([k, t]) => el('option', { value: k, ...(String(v ?? '0') === k ? { selected: '' } : {}) }, t)));
  const roundI = decSel(s.workunit_rounding), roundM = modeSel(s.workunit_rounding_mode);
  const otRoundI = decSel(s.ot_rounding), otRoundM = modeSel(s.ot_rounding_mode);
  // Tăng ca: làm tròn theo số lẻ của giờ HOẶC theo khối phút (VD 15 / 30 phút)
  const otTypeSel = el('select', {}, el('option', { value: 'hour' }, 'Theo số lẻ của giờ'), el('option', { value: 'block' }, 'Theo khối phút'));
  otTypeSel.value = s.ot_rounding_type === 'block' ? 'block' : 'hour';
  const otBlockI = el('input', { type: 'number', min: 1, max: 240, step: 1, value: s.ot_rounding_block ?? 15, style: 'width:80px' });
  const otBlockBox = el('div', { style: 'display:flex;align-items:center;gap:6px' }, otBlockI, el('span', {}, 'phút'));
  const otLevel = el('div', {}, otRoundI, otBlockBox);
  const syncOtType = () => { const b = otTypeSel.value === 'block'; otRoundI.style.display = b ? 'none' : ''; otBlockBox.style.display = b ? 'flex' : 'none'; };
  otTypeSel.onchange = syncOtType; syncOtType();
  const payStartI = input('st-paystart', { type: 'number', min: 1, max: 28, value: s.pay_period_start_day ?? 1 });
  const otWdI = input('st-otwd', { type: 'number', min: 0.1, max: 10, step: 0.1, value: s.ot_rate_weekday ?? 1.5 });
  const otWkI = input('st-otwk', { type: 'number', min: 0.1, max: 10, step: 0.1, value: s.ot_rate_weekend ?? 2 });
  const otHoI = input('st-otho', { type: 'number', min: 0.1, max: 10, step: 0.1, value: s.ot_rate_holiday ?? 3 });
  const saveCalc = el('button', { class: 'btn' }, 'Lưu quy tắc');
  saveCalc.onclick = async () => {
    const weekend_days = [...document.querySelectorAll('.wk-day:checked')].map(x => x.value).join(',');
    try { await api('/admin/settings', { method: 'PUT', body: { weekend_days, weekend_work_as_ot: wkOtChk.checked, workunit_rounding: roundI.value, workunit_rounding_mode: roundM.value, ot_rounding: otRoundI.value, ot_rounding_mode: otRoundM.value, ot_rounding_type: otTypeSel.value, ot_rounding_block: otBlockI.value, pay_period_start_day: payStartI.value, ot_rate_weekday: otWdI.value, ot_rate_weekend: otWkI.value, ot_rate_holiday: otHoI.value } }); toast('Đã lưu quy tắc. Bấm "↻ Tính lại công tất cả" để áp cho dữ liệu cũ', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  };
  const recalcBtn = el('button', { class: 'btn ghost' }, '↻ Tính lại công tất cả');
  recalcBtn.onclick = async () => {
    if (!confirm('Tính lại số công/OT cho toàn bộ bản ghi chấm công theo cấu hình hiện tại?')) return;
    recalcBtn.disabled = true; recalcBtn.textContent = 'Đang tính…';
    try { const r = await api('/admin/recompute', { method: 'POST' }); toast(`Đã tính lại ${r.updated} bản ghi`, 'ok'); }
    catch (e) { toast(e.message, 'err'); }
    finally { recalcBtn.disabled = false; recalcBtn.textContent = '↻ Tính lại công tất cả'; }
  };
  const panelCalc = (hasPerm('settings') && !hourlyMode()) ? el('div', { class: 'panel', style: 'padding:20px;max-width:600px;margin-bottom:16px' },
    el('h3', { style: 'margin-top:0' }, 'Quy tắc tính công'),
    el('div', { style: 'display:flex;flex-direction:column;gap:12px' },
      el('div', {}, el('label', {}, 'Ngày cuối tuần'), el('div', { style: 'display:flex;gap:12px;flex-wrap:wrap' }, ...wkBoxes),
        el('label', { style: 'display:flex;gap:8px;align-items:flex-start;margin-top:10px;cursor:pointer;font-weight:600;color:var(--ink)' }, wkOtChk,
          el('div', {}, 'Đi làm vào ngày cuối tuần tính là TĂNG CA',
            el('div', { style: 'font-size:12.5px;color:var(--muted);font-weight:400' }, 'Cả thời gian làm ngày đã tích ở trên thành tăng ca cuối tuần (không tính công thường). Báo cáo quy đổi 8 giờ = 1 công ở cột "Công TC cuối tuần". VD tích T7 → đi làm thứ 7 là tăng ca.')))),
      el('div', {}, el('label', {}, 'Hệ số tăng ca (nhân với đơn giá giờ khi tính lương)'),
        el('div', { style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:10px' }, field('Ngày thường', otWdI), field('Ngày cuối tuần', otWkI), field('Ngày lễ', otHoI)),
        el('div', { class: 'map-hint', style: 'margin-top:4px' }, 'Áp cho mọi nhân viên. Ai cần hệ số khác thì đặt riêng ở trang Lương (đặt riêng thì đổi ở đây không ảnh hưởng người đó).')),
      el('div', {}, el('label', {}, 'Làm tròn (áp cho cả công ty)'),
        el('div', { style: 'display:grid;grid-template-columns:80px 1.3fr 1fr 1fr;gap:8px;align-items:center' },
          ...['', 'Kiểu', 'Mức', 'Làm tròn'].map((t) => el('span', { style: 'color:var(--muted);font-size:12px' }, t)),
          el('b', {}, 'Công'), el('span', { style: 'color:var(--muted);font-size:13px' }, 'Theo số lẻ'), roundI, roundM,
          el('b', {}, 'Tăng ca'), otTypeSel, otLevel, otRoundM),
        el('div', { class: 'map-hint', style: 'margin-top:4px' }, 'VD công 0,866 → 2 số lẻ: lùi = 0,86 · tới = 0,87. Tăng ca 40 phút = 0,666 giờ → 2 số lẻ: lùi 0,66 giờ · tới 0,67 giờ. Theo khối 15 phút: tăng ca 47 phút → lùi 45 phút · tới 60 phút.')),
      field('Ngày bắt đầu kỳ lương (1 = theo tháng dương lịch; VD 26 = 26 tháng trước→25 tháng này)', payStartI),
      el('div', { style: 'display:flex;gap:10px' }, saveCalc, ...(hasPerm('recompute') ? [recalcBtn] : [])),
      el('div', { class: 'map-hint' }, 'Đổi cấu hình ca/quy tắc xong nên bấm "Tính lại công" để áp cho dữ liệu cũ.'))) : null;

  // ----- Ngày lễ -----
  const holBox = el('div', { id: 'hol-box' }, loading());
  const holDate = input('hol-date', { type: 'date' });
  const holName = input('hol-name', { placeholder: 'VD: Quốc khánh 2/9' });
  const addHol = el('button', { class: 'btn' }, 'Thêm ngày lễ');
  const loadHols = async () => {
    const { rows } = await api('/admin/holidays');
    holBox.innerHTML = '';
    if (!rows.length) { holBox.append(el('div', { class: 'map-hint' }, 'Chưa có ngày lễ nào.')); return; }
    for (const h of rows) {
      const del = btnSm('Xoá', async () => { await api('/admin/holidays/' + h.id, { method: 'DELETE' }); loadHols(); }, 'ghost');
      holBox.append(el('div', { style: 'display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #f1efec' },
        el('b', {}, fmtD(h.holiday_date) + '/' + h.holiday_date.slice(0, 4)), el('span', { style: 'flex:1' }, h.name || ''), del));
    }
  };
  addHol.onclick = async () => {
    if (!holDate.value) return toast('Chọn ngày', 'err');
    try { await api('/admin/holidays', { method: 'POST', body: { holiday_date: holDate.value, name: holName.value } }); toast('Đã thêm', 'ok'); holName.value = ''; loadHols(); }
    catch (e) { toast(e.message, 'err'); }
  };
  const panelHol = (hasPerm('holidays') && !hourlyMode()) ? el('div', { class: 'panel', style: 'padding:20px;max-width:520px;margin-bottom:16px' },
    el('h3', { style: 'margin-top:0' }, 'Ngày lễ'),
    el('div', { style: 'display:flex;flex-direction:column;gap:12px' },
      el('div', { class: 'two-col' }, field('Ngày', holDate), field('Tên', holName)),
      addHol, holBox)) : null;

  // ----- Sao lưu & phục hồi dữ liệu -----
  const bkBox = el('div', { id: 'bk-box' }, loading());
  let bkShow = 3;   // số bản sao lưu hiển thị (mặc định 3), 0 = tất cả
  const loadBackups = async () => {
    let d;
    try { d = await api('/admin/backup'); } catch (e) { bkBox.innerHTML = ''; bkBox.append(el('div', { class: 'map-hint' }, e.message)); return; }
    bkBox.innerHTML = '';
    // Cấu hình auto-backup
    const enChk = el('input', { type: 'checkbox', style: 'width:auto', ...(d.config.enabled ? { checked: '' } : {}) });
    const hourI = input('bk-hour', { type: 'number', min: 0, max: 23, value: d.config.hour, style: 'width:80px' });
    const keepI = input('bk-keep', { type: 'number', min: 1, max: 90, value: d.config.keep_days, style: 'width:80px' });
    const saveCfg = el('button', { class: 'btn sm' }, 'Lưu lịch sao lưu');
    saveCfg.onclick = async () => {
      try { await api('/admin/backup/config', { method: 'PUT', body: { enabled: enChk.checked, hour: +hourI.value, keep_days: +keepI.value } }); toast('Đã lưu lịch sao lưu', 'ok'); loadBackups(); }
      catch (e) { toast(e.message, 'err'); }
    };
    bkBox.append(el('div', { style: 'display:flex;flex-direction:column;gap:10px' },
      el('label', { style: 'display:flex;gap:8px;align-items:center' }, enChk, el('b', {}, 'Tự động sao lưu hằng ngày')),
      el('div', { style: 'display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end' },
        field('Vào lúc (giờ, 0–23)', hourI), field('Giữ lại (bản gần nhất)', keepI), saveCfg)));

    // Sao lưu ngay
    const nowBtn = el('button', { class: 'btn' }, '⬇ Sao lưu ngay & tải về');
    nowBtn.onclick = async () => {
      nowBtn.disabled = true; nowBtn.textContent = 'Đang sao lưu…';
      try { const r = await api('/admin/backup/now', { method: 'POST' }); toast('Đã tạo bản sao lưu', 'ok'); await downloadBackup(r.name); loadBackups(); }
      catch (e) { toast(e.message, 'err'); }
      finally { nowBtn.disabled = false; nowBtn.textContent = '⬇ Sao lưu ngay & tải về'; }
    };
    const fullBtn = el('button', { class: 'btn' }, '⬇ Sao lưu TOÀN BỘ (.zip)');
    fullBtn.onclick = async () => {
      fullBtn.disabled = true; fullBtn.textContent = 'Đang nén…';
      try { const r = await api('/admin/backup/full', { method: 'POST' }); toast('Đã tạo bản sao lưu toàn bộ', 'ok'); await downloadBackup(r.name); loadBackups(); }
      catch (e) { toast(e.message, 'err'); }
      finally { fullBtn.disabled = false; fullBtn.textContent = '⬇ Sao lưu TOÀN BỘ (.zip)'; }
    };
    bkBox.append(el('div', { style: 'margin-top:14px;display:flex;gap:8px;flex-wrap:wrap' }, nowBtn, fullBtn));
    bkBox.append(el('div', { class: 'map-hint', style: 'margin-top:6px' }, '"Sao lưu ngày" (.db) = chỉ dữ liệu. "Sao lưu TOÀN BỘ" (.zip) = dữ liệu + ảnh chấm công + logo — dùng khi chuyển máy / lên VPS.'));

    // Danh sách bản sao lưu — mặc định hiện 3 bản gần nhất
    const showSel = el('select', { style: 'width:auto;padding:2px 6px;font-size:13px' },
      ...[['3', '3 bản'], ['5', '5 bản'], ['10', '10 bản'], ['0', 'Tất cả']].map(([v, t]) => {
        const o = el('option', { value: v }, t); if (+v === bkShow) o.selected = true; return o;
      }));
    showSel.onchange = () => { bkShow = +showSel.value; loadBackups(); };
    bkBox.append(el('div', { style: 'display:flex;align-items:center;gap:10px;margin:16px 0 6px;flex-wrap:wrap' },
      el('div', { class: 'sec-title', style: 'font-weight:700;flex:1' }, `Các bản sao lưu (${d.list.length})`),
      el('span', { style: 'color:var(--muted);font-size:13px' }, 'Hiện:'), showSel));
    if (!d.list.length) bkBox.append(el('div', { class: 'map-hint' }, 'Chưa có bản sao lưu nào.'));
    const shown = bkShow > 0 ? d.list.slice(0, bkShow) : d.list;
    for (const b of shown) {
      const dl = btnSm('Tải', () => downloadBackup(b.name));
      const del = btnSm('Xoá', async () => { if (confirm('Xoá bản sao lưu này?')) { await api('/admin/backup?name=' + encodeURIComponent(b.name), { method: 'DELETE' }); loadBackups(); } }, 'ghost');
      bkBox.append(el('div', { style: 'display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #f1efec' },
        el('span', { style: 'flex:1;font-family:monospace;font-size:13px' }, (b.full ? '📦 ' : '🗃 ') + b.name),
        el('span', { style: 'color:var(--muted);font-size:12px' }, (b.full ? 'toàn bộ · ' : '') + fmtSize(b.size)), dl, del));
    }
    if (bkShow > 0 && d.list.length > bkShow)
      bkBox.append(el('div', { class: 'map-hint', style: 'margin-top:6px' }, `Đang hiện ${bkShow}/${d.list.length} bản. Chọn "Tất cả" ở trên để xem hết.`));

    // Phục hồi (nhận cả .db lẫn .zip toàn bộ)
    const fileI = el('input', { type: 'file', accept: '.db,.zip', style: 'font-size:13px' });
    const restoreBtn = el('button', { class: 'btn ghost' }, '⬆ Phục hồi từ file (.db / .zip)');
    restoreBtn.onclick = async () => {
      const f = fileI.files?.[0];
      if (!f) return toast('Chọn file sao lưu (.db hoặc .zip)', 'err');
      const isZip = /\.zip$/i.test(f.name);
      if (!confirm((isZip ? 'PHỤC HỒI TOÀN BỘ (dữ liệu + ảnh + logo)' : 'PHỤC HỒI dữ liệu') + ' sẽ thay toàn bộ hiện tại bằng file này. Tiếp tục?')) return;
      restoreBtn.disabled = true; restoreBtn.textContent = 'Đang nạp…';
      try { await (isZip ? restoreFullBackup(f) : restoreBackup(f)); }
      finally { restoreBtn.disabled = false; restoreBtn.textContent = '⬆ Phục hồi từ file (.db / .zip)'; }
    };
    bkBox.append(el('div', { style: 'margin-top:16px;padding-top:14px;border-top:1px solid #eee' },
      el('div', { style: 'font-weight:700;margin-bottom:8px' }, 'Phục hồi dữ liệu (khi cài lại máy / chuyển VPS)'),
      el('div', { class: 'map-hint', style: 'margin-bottom:8px' }, 'Chọn file .db (chỉ dữ liệu) hoặc .zip (toàn bộ: dữ liệu + ảnh + logo) rồi bấm Phục hồi. Sau đó khởi động lại phần mềm.'),
      el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, fileI, restoreBtn)));
  };
  const panelBackup = hasPerm('backup') ? el('div', { class: 'panel', style: 'padding:20px;max-width:560px;margin-bottom:16px' },
    el('h3', { style: 'margin-top:0' }, '💾 Sao lưu & phục hồi dữ liệu'), bkBox) : null;

  // ----- Cập nhật phần mềm (từ GitHub) -----
  const updStatus = el('div', { style: 'margin-top:6px;font-size:14px' });
  const checkBtn = el('button', { class: 'btn' }, '🔎 Kiểm tra cập nhật');
  const applyBtn = el('button', { class: 'btn', style: 'display:none' }, '⬇ Cập nhật ngay');

  const pollAfterUpdate = async (target) => {
    updStatus.innerHTML = '';
    updStatus.append(el('span', { style: 'color:var(--muted)' }, 'Đang cập nhật & khởi động lại… vui lòng đợi ~30–60 giây, ĐỪNG tắt máy.'));
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const v = await fetch('/api/version').then(r => r.json());
        if (v.version && (!target || v.version === target)) {
          updStatus.innerHTML = '';
          updStatus.append(el('b', { style: 'color:#1a7f37' }, `✓ Đã cập nhật lên phiên bản ${v.version}. Đang tải lại…`));
          setTimeout(() => location.reload(), 1500);
          return;
        }
      } catch { /* server đang khởi động lại */ }
    }
    updStatus.innerHTML = '';
    updStatus.append(el('span', { style: 'color:#b45309' }, 'Đã gửi lệnh cập nhật. Nếu chưa thấy đổi, hãy tải lại trang sau ít phút.'));
  };

  applyBtn.onclick = async () => {
    if (!confirm('Cập nhật phần mềm lên bản mới nhất? App sẽ tự khởi động lại (khoảng 1 phút). Dữ liệu được giữ nguyên và tự sao lưu trước.')) return;
    applyBtn.disabled = checkBtn.disabled = true;
    try {
      const r = await api('/admin/update/apply', { method: 'POST' });
      pollAfterUpdate(r.latest || null);
    } catch (e) { toast(e.message, 'err'); applyBtn.disabled = checkBtn.disabled = false; }
  };
  checkBtn.onclick = async () => {
    checkBtn.disabled = true; checkBtn.textContent = 'Đang kiểm tra…'; applyBtn.style.display = 'none';
    updStatus.innerHTML = '';
    try {
      const r = await api('/admin/update/check');
      if (r.hasUpdate) {
        updStatus.append(el('b', { style: 'color:#1a7f37' }, `Có bản mới: ${r.latest}`), el('span', { style: 'color:var(--muted)' }, ` (đang dùng ${r.current})`));
        applyBtn.style.display = '';
      } else {
        updStatus.append(el('b', { style: 'color:#1a7f37' }, `✓ Đang dùng bản mới nhất (${r.current})`));
      }
    } catch (e) { updStatus.append(el('span', { style: 'color:#c0392b' }, e.message)); }
    finally { checkBtn.disabled = false; checkBtn.textContent = '🔎 Kiểm tra cập nhật'; }
  };
  const logBtn = el('button', { class: 'btn sm ghost' }, '📄 Tải file log lỗi');
  logBtn.onclick = async () => {
    logBtn.disabled = true;
    try {
      const res = await api('/admin/logs/server/download', { raw: true });
      const blob = await res.blob(); const u = URL.createObjectURL(blob);
      const a = el('a', { href: u, download: 'digiplus-server-log.txt' });
      document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(u);
    } catch (e) { toast(e.message || 'Không tải được file log', 'err'); }
    logBtn.disabled = false;
  };
  const panelUpdate = hasPerm('settings') ? el('div', { class: 'panel', style: 'padding:20px;max-width:520px;margin-bottom:16px' },
    el('h3', { style: 'margin-top:0' }, '⬆ Cập nhật phần mềm'),
    el('div', { style: 'display:flex;flex-direction:column;gap:12px' },
      el('div', {}, el('span', { style: 'color:var(--muted)' }, 'Phiên bản đang dùng: '), el('b', {}, s.app_version || '—')),
      el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, checkBtn, applyBtn),
      updStatus,
      el('div', {}, logBtn, el('span', { class: 'map-hint', style: 'margin-left:8px' }, 'Khi gặp lỗi, tải file này gửi cho Digiplus để được hỗ trợ nhanh.')),
      el('div', { class: 'map-hint' }, 'Máy phải có Internet. Bấm “Kiểm tra cập nhật”: đã mới nhất sẽ báo xanh; có bản mới sẽ hiện nút “Cập nhật ngay”. Cập nhật xong app tự khởi động lại, dữ liệu giữ nguyên (tự sao lưu trước khi cập nhật).'))) : null;

  // ----- Bản quyền / Gia hạn -----
  const licBox = el('div', {}, loading());
  const loadLic = async () => {
    let s2; try { s2 = await fetch('/api/license/status').then((r) => r.json()); }
    catch { licBox.innerHTML = ''; licBox.append(el('div', { class: 'map-hint' }, 'Không đọc được trạng thái bản quyền.')); return; }
    licBox.innerHTML = '';
    const row = (k, v, color) => el('div', { style: 'display:flex;gap:8px;padding:3px 0' }, el('span', { style: 'color:var(--muted);min-width:130px' }, k), el('b', color ? { style: 'color:' + color } : {}, v));
    const days = s2.exp ? (s2.daysLeft > 0 ? `còn ${s2.daysLeft} ngày` : 'ĐÃ HẾT HẠN') : '';
    licBox.append(
      row('Trạng thái:', s2.activated ? '✅ Đã kích hoạt' : '❌ Chưa kích hoạt / hết hạn', s2.activated ? '#1a7f37' : '#c0392b'),
      s2.company ? row('Công ty:', s2.company) : '',
      row('Hạn dùng:', s2.exp ? s2.exp + '  (' + days + ')' : 'Vĩnh viễn', s2.exp && s2.daysLeft <= 0 ? '#c0392b' : (s2.exp && s2.daysLeft <= 15 ? '#b45309' : '')),
      row('Số NV tối đa:', s2.maxEmp || 'Không giới hạn'),
      row('Mã máy:', s2.machineIdFmt || '—'));
    const copyBtn = el('button', { class: 'btn sm ghost' }, '📋 Copy Mã máy');
    copyBtn.onclick = () => { try { navigator.clipboard.writeText(s2.machineIdFmt || ''); toast('Đã copy Mã máy', 'ok'); } catch { toast('Copy thủ công giúp em', 'err'); } };
    licBox.append(el('div', { style: 'margin-top:8px' }, copyBtn));
    const licI = el('textarea', { rows: 3, placeholder: 'Dán license mới (gia hạn) do Digiplus cấp...', style: 'width:100%;font-family:monospace;font-size:12px;padding:10px;border:1px solid var(--line,#e7e3df);border-radius:10px' });
    const actBtn = el('button', { class: 'btn' }, '🔑 Gia hạn / Kích hoạt');
    actBtn.onclick = async () => {
      const key = licI.value.trim(); if (!key) return toast('Dán license vào ô', 'err');
      actBtn.disabled = true;
      try {
        const res = await fetch('/api/license/activate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
        const d = await res.json(); if (!res.ok) throw new Error(d.error || 'Lỗi kích hoạt');
        toast('✅ Đã cập nhật bản quyền', 'ok'); licI.value = ''; loadLic();
      } catch (e) { toast(e.message, 'err'); } finally { actBtn.disabled = false; }
    };
    licBox.append(el('div', { style: 'margin-top:14px;padding-top:12px;border-top:1px solid #eee' },
      el('div', { style: 'font-weight:700;margin-bottom:6px' }, 'Gia hạn / nhập license mới'),
      el('div', { class: 'map-hint', style: 'margin-bottom:8px' }, 'Gửi Mã máy ở trên cho Digiplus để lấy license, rồi dán vào đây và bấm. Dùng được cả khi CHƯA hết hạn (gia hạn sớm) — hạn mới sẽ thay hạn cũ.'),
      licI, el('div', { style: 'margin-top:8px' }, actBtn)));
  };
  const panelLicense = el('div', { class: 'panel', style: 'padding:20px;max-width:520px;margin-bottom:16px' },
    el('h3', { style: 'margin-top:0' }, '🔑 Bản quyền'), licBox);

  // ----- Cài app vào máy (PWA) -----
  const installBox = el('div', {});
  const renderInstall = () => {
    installBox.innerHTML = '';
    if (isStandalone()) { installBox.append(el('div', { style: 'color:#1a7f37;font-weight:600' }, '✅ App đã được cài trên thiết bị này.')); return; }
    if (deferredPrompt) {
      const b = el('button', { class: 'btn' }, '📲 Cài app vào máy');
      b.onclick = async () => { try { deferredPrompt.prompt(); await deferredPrompt.userChoice; } catch {} deferredPrompt = null; setTimeout(renderInstall, 400); };
      installBox.append(b, el('div', { class: 'map-hint', style: 'margin-top:8px' }, 'Bấm để cài như ứng dụng thật (mở nhanh + nhận thông báo).'));
      return;
    }
    if (isIOS()) {
      installBox.append(el('ol', { style: 'margin:0;padding-left:18px;font-size:14px;line-height:1.9' },
        el('li', { html: 'Mở trang này bằng <b>Safari</b>.' }),
        el('li', { html: 'Bấm nút <b>Chia sẻ</b> (ô vuông có mũi tên ↑ ở thanh dưới); nếu đang ở menu thì bấm dòng <b>“Chia sẻ”</b>.' }),
        el('li', { html: 'Vuốt xuống → chọn <b>“Thêm vào Màn hình chính”</b> → <b>Thêm</b>.' }),
        el('li', { html: 'Mở app từ <b>icon</b> vừa tạo, rồi bật 🔔 Thông báo bên dưới.' })));
      return;
    }
    installBox.append(el('div', { class: 'map-hint' }, 'Mở menu trình duyệt (⋮) → chọn “Thêm vào Màn hình chính” / “Cài đặt ứng dụng”.'));
  };
  const panelInstall = el('div', { class: 'panel', style: 'padding:20px;max-width:520px;margin-bottom:16px' },
    el('h3', { style: 'margin-top:0' }, '📲 Cài app vào máy'),
    el('div', { class: 'map-hint', style: 'margin-bottom:10px' }, 'Cài để mở nhanh như ứng dụng thật và nhận thông báo chấm công (iPhone bắt buộc cài mới nhận được thông báo).'),
    installBox);

  // ----- Thông báo đẩy khi có người chấm công -----
  const notifyBox = el('div', {}, loading());
  const renderNotify = async () => {
    const st = await pushState();
    notifyBox.innerHTML = '';
    if (st === 'unsupported') { notifyBox.append(el('div', { class: 'map-hint' }, 'Thiết bị/trình duyệt này không hỗ trợ thông báo đẩy. Dùng Chrome/Edge trên Android, hoặc trên iPhone hãy “Thêm vào màn hình chính” rồi mở từ đó (iOS 16.4+). Cần mở qua HTTPS/domain.')); return; }
    if (st === 'denied') { notifyBox.append(el('div', { class: 'map-hint' }, '⚠️ Bạn đã CHẶN quyền thông báo cho trang này. Vào cài đặt trình duyệt (biểu tượng ổ khoá cạnh địa chỉ) → cho phép Thông báo → tải lại trang.')); return; }
    const on = st === 'on';
    const toggle = el('button', { class: 'btn' }, on ? 'Tắt thông báo trên máy này' : '🔔 Bật thông báo chấm công');
    toggle.onclick = async () => {
      toggle.disabled = true;
      try { if (on) { await disablePush(); toast('Đã tắt', 'ok'); } else { await enablePush(); toast('Đã bật thông báo trên thiết bị này', 'ok'); } renderNotify(); }
      catch (e) { toast(e.message, 'err'); toggle.disabled = false; }
    };
    const testBtn = el('button', { class: 'btn ghost' }, 'Gửi thử');
    testBtn.onclick = async () => {
      testBtn.disabled = true;
      try {
        const okSub = await ensureSubscribed();   // đồng bộ đăng ký lên server trước
        if (!okSub) { toast('Thiết bị chưa đăng ký. Bấm "Bật thông báo" lại giúp em.', 'err'); return; }
        const r = await api('/admin/push/test', { method: 'POST' });
        if (!r.total) toast('Server chưa có thiết bị nào đăng ký — thử Tắt rồi Bật lại thông báo.', 'err');
        else if (r.sent) toast(`✅ Đã gửi tới ${r.sent}/${r.total} thiết bị. Chờ thông báo hiện ra (kiểm tra cả cài đặt Thông báo của máy).`, 'ok');
        else toast(`Gửi không thành công (mã: ${(r.statuses || []).join(', ') || '?'}). `, 'err');
      } catch (e) { toast(e.message, 'err'); }
      finally { testBtn.disabled = false; }
    };
    if (on) ensureSubscribed();   // vào trang mà đang bật → đồng bộ đăng ký để server luôn có
    notifyBox.append(
      el('div', {}, el('b', { style: 'color:' + (on ? '#1a7f37' : '#7a808c') }, on ? '✅ Đang BẬT trên thiết bị này' : '⚪ Đang TẮT trên thiết bị này')),
      el('div', { style: 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap' }, toggle, ...(on ? [testBtn] : [])));
  };
  const panelNotify = el('div', { class: 'panel', style: 'padding:20px;max-width:520px;margin-bottom:16px' },
    el('h3', { style: 'margin-top:0' }, '🔔 Thông báo khi có người chấm công'),
    el('div', { class: 'map-hint', style: 'margin-bottom:10px' }, 'Bật để điện thoại/máy này nhận thông báo mỗi khi nhân viên chấm vào/ra (kèm tên, giờ, vị trí) — kể cả khi không mở app. Mỗi quản lý bật riêng trên thiết bị của mình.'),
    notifyBox);

  const panel2 = el('div', { class: 'panel', style: 'padding:20px;max-width:520px' },
    el('h3', { style: 'margin-top:0' }, 'Đổi mật khẩu của tôi'),
    el('div', { style: 'display:flex;flex-direction:column;gap:12px' }, field('Mật khẩu hiện tại', oldP), field('Mật khẩu mới', newP), savePw));
  setMain(head('Cài đặt'), panel1, panelLicense, panelInstall, panelNotify, panelMode, panelCalc, panelHol, panelBackup, panelUpdate, panel2);
  if (hasPerm('holidays') && !hourlyMode()) loadHols();
  if (hasPerm('backup')) loadBackups();
  loadLic();
  renderInstall();
  renderNotify();
}
