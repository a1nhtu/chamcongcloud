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
  ['settings', '⚙️', 'Cài đặt', 'settings'],
];
const isMaster = () => ME?.role === 'master';                 // tài khoản tổng (Anh)
const isAdmin = () => ME?.role === 'admin' || isMaster();     // master có mọi quyền admin
const hasPerm = (key) => isAdmin() || (ME?.permissions || []).includes(key);
const hourlyMode = () => SETTINGS.attendance_mode === 'hourly';
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
  ({ dashboard: pageDashboard, employees: pageEmployees, shifts: pageShifts, assignments: pageAssignments, shiftreq: pageShiftReq, devreq: pageDevReq, editatt: pageEditAtt, devices: pageDevices, offices: pageOffices, leaves: pageLeaves, salary: pageSalary, report: pageReport, settings: pageSettings }[key])();
}

/* ---------- Thiết lập lần đầu ---------- */
function setupWizard() {
  const mShift = el('input', { type: 'radio', name: 'sw-mode', value: 'shift', checked: '', style: 'width:auto' });
  const mHourly = el('input', { type: 'radio', name: 'sw-mode', value: 'hourly', style: 'width:auto' });
  const geo = el('input', { type: 'checkbox', id: 'sw-geo', style: 'width:auto' });
  const opt = (radio, title, desc) => el('label', { style: 'display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid var(--line,#e5e5e5);border-radius:12px;cursor:pointer' },
    radio, el('div', {}, el('b', {}, title), el('div', { style: 'font-size:13px;color:var(--muted)' }, desc)));
  const body = [
    el('p', { style: 'color:var(--muted);margin-top:0' }, 'Chọn cách doanh nghiệp của bạn muốn chấm công. Có thể đổi lại sau trong Cài đặt.'),
    el('div', { style: 'display:flex;flex-direction:column;gap:10px' },
      opt(mShift, '🕐 Theo ca làm việc', 'Có khai báo ca, tính đi muộn / về sớm / tăng ca và báo cáo đầy đủ. Phù hợp văn phòng, nhà máy.'),
      opt(mHourly, '⏱️ Chỉ tính công theo giờ', 'Không cần ca, chỉ tính tổng giờ làm để trả lương theo giờ. Đơn giản cho cửa hàng, quán ăn.'),
      el('label', { style: 'display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px dashed var(--line,#e5e5e5);border-radius:12px;cursor:pointer;margin-top:4px' },
        geo, el('div', {}, el('b', {}, 'Chỉ cho chấm trong bán kính chi nhánh (GPS)'),
          el('div', { style: 'font-size:13px;color:var(--muted)' }, 'Bật nếu muốn nhân viên phải có mặt tại văn phòng mới chấm được. Bỏ trống = chấm tự do mọi nơi.')))),
  ];
  const save = el('button', { class: 'btn' }, 'Bắt đầu sử dụng →');
  save.onclick = async () => {
    const attendance_mode = document.querySelector('input[name=sw-mode]:checked')?.value || 'shift';
    save.disabled = true;
    try {
      await api('/admin/settings', { method: 'PUT', body: { attendance_mode, geofence_enforce: geo.checked, setup_done: true } });
      closeModal(); location.reload();
    } catch (e) { toast(e.message, 'err'); save.disabled = false; }
  };
  openModal('👋 Chào mừng đến Digiplus Chấm Công', body, [save]);
}

/* ---------- Helpers ---------- */
function head(title, ...tools) {
  return el('div', { class: 'page-head' }, el('h2', {}, title), el('div', { class: 'toolbar' }, ...tools));
}
function setMain(...nodes) { const m = $('#main'); m.innerHTML = ''; nodes.forEach(n => n && m.append(n)); }
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
async function pageDashboard() {
  if (dashTimer) { clearInterval(dashTimer); dashTimer = null; }
  await renderDashboard(true);
  dashTimer = setInterval(() => {
    const active = document.querySelector('#nav button.active')?.dataset.k;
    if (active === 'dashboard' && !$('#modal-bg').classList.contains('show')) renderDashboard(false);
    else { clearInterval(dashTimer); dashTimer = null; }
  }, 20000);
}

async function renderDashboard(showLoading) {
  const refreshBtn = el('button', { class: 'btn ghost sm' }, '↻ Làm mới');
  refreshBtn.onclick = () => renderDashboard(true);
  const autotag = el('span', { style: 'font-size:12px;color:var(--muted)' }, 'Tự cập nhật mỗi 20 giây');
  if (showLoading) setMain(head('Tổng quan', autotag, refreshBtn), loading());
  try {
    const d = await api('/reports/dashboard');
    const rep = await api('/reports/attendance?month=' + todayMonth());
    const today = rep.rows.filter(r => r.work_date === d.today);
    const hourly = hourlyMode();
    const cards = el('div', { class: 'cards' },
      mcard('brand', d.totalEmp, 'Nhân viên'),
      mcard('green', d.checkedIn, 'Đã chấm vào'),
      mcard('warn', d.notYet, 'Chưa chấm'),
      ...(hourly ? [] : [mcard('warn', d.late, 'Đi muộn')]),
      mcard('red', d.outside, 'Chấm ngoài VP'),
      mcard('red', d.pendingLeaves, 'Đơn chờ duyệt'),
    );
    const tbl = el('table', { class: 'data' });
    tbl.innerHTML = `<thead><tr><th>Ảnh vào</th><th>Nhân viên</th><th>Bộ phận</th><th>Vào</th>${hourly ? '' : '<th>Muộn</th>'}<th>Vị trí</th><th>Ra</th><th>Ảnh ra</th><th>Giờ</th></tr></thead>`;
    const tb = el('tbody');
    if (!today.length) tb.append(el('tr', {}, el('td', { colspan: hourly ? 8 : 9 }, el('div', { class: 'empty' }, 'Chưa có ai chấm công hôm nay.'))));
    for (const r of today) tb.append(rowToday(r));
    tbl.append(tb);
    const clock = el('span', { style: 'font-size:12px;color:var(--muted)' }, 'Cập nhật lúc ' + new Date().toLocaleTimeString('vi-VN'));
    setMain(head('Tổng quan · ' + d.today, clock, refreshBtn), cards, el('div', { class: 'panel tbl-scroll' }, tbl));
  } catch (e) { if (showLoading) setMain(head('Tổng quan'), el('div', { class: 'empty' }, e.message)); }
}
function mcard(cls, n, l) { return el('div', { class: 'mcard ' + cls }, el('div', { class: 'n' }, String(n)), el('div', { class: 'l' }, l)); }
function rowToday(r) {
  return el('tr', {},
    el('td', {}, photoCell(r.check_in_photo)),
    el('td', {}, el('b', {}, r.full_name), el('div', { style: 'color:#999;font-size:12px' }, r.code)),
    el('td', {}, r.department || '—'),
    el('td', {}, r.check_in_hm || '—'),
    ...(hourlyMode() ? [] : [el('td', {}, r.late_min > 0 ? el('span', { class: 'pill warn' }, r.late_min + 'p') : '—')]),
    el('td', {}, r.check_in_outside ? el('span', { class: 'pill bad' }, 'Ngoài ' + humanDistance(r.check_in_distance_m)) : el('span', { class: 'pill ok' }, 'Trong VP')),
    el('td', {}, r.check_out_hm || el('span', { class: 'pill muted' }, 'chưa ra')),
    el('td', {}, photoCell(r.check_out_photo)),
    el('td', {}, humanMinutes(r.work_minutes)),
  );
}

/* ---------- 2) NHÂN VIÊN ---------- */
let OFFICES = [], SHIFTS = [], DEPARTMENTS = [], SCHEDULES = [], PERM_CATALOG = [];
async function loadRefs() {
  [OFFICES, SHIFTS, DEPARTMENTS, SCHEDULES] = await Promise.all([
    api('/admin/offices').then(r => r.rows),
    api('/admin/shifts').then(r => r.rows),
    api('/admin/departments').then(r => r.rows),
    api('/admin/schedules').then(r => r.rows),
  ]);
}
async function pageEmployees() {
  const addBtn = hasPerm('employees') ? el('button', { class: 'btn' }, '+ Thêm nhân viên') : null;
  const deptBtn = hasPerm('departments') ? el('button', { class: 'btn ghost' }, '🏢 Quản lý bộ phận') : null;
  if (deptBtn) deptBtn.onclick = deptManageModal;
  setMain(head('Nhân viên', deptBtn, addBtn), loading());
  try {
    await loadRefs();
    const { rows } = await api('/admin/employees');
    const tbl = el('table', { class: 'data' });
    tbl.innerHTML = `<thead><tr><th>Mã</th><th>Họ tên</th><th>Bộ phận</th><th>Chức danh</th><th>Tài khoản</th><th>Quyền</th><th>${hourlyMode() ? 'Chi nhánh' : 'Ca / Chi nhánh'}</th><th>TT</th><th></th></tr></thead>`;
    const tb = el('tbody');
    for (const e of rows) {
      const actions = hasPerm('employees') ? el('div', { style: 'display:flex;gap:6px' },
        btnSm('Sửa', () => empModal(e)),
        e.active ? btnSm('Khoá', () => toggleEmp(e), 'ghost') : el('span', { class: 'pill muted' }, 'đã khoá')) : '';
      tb.append(el('tr', {},
        el('td', {}, e.code,
          e.device_pin ? el('div', { style: 'color:#0a7;font-size:11px' }, '🔌 ID máy: ' + e.device_pin) : ''),
        el('td', {}, el('b', {}, e.full_name),
          e.from_device ? el('span', { class: 'pill warn', style: 'margin-left:6px', title: 'Tự tạo khi đăng ký vân tay trên máy — bổ sung thông tin rồi lưu' }, 'nháp từ máy') : ''),
        el('td', {}, e.department || '—'),
        el('td', {}, e.position || '—'),
        el('td', {}, e.username),
        el('td', {}, roleLabel(e.role)),
        el('td', {}, hourlyMode() ? (e.office_name || '—') : `${e.work_schedule_id ? '📋 ' + (e.schedule_name || '') : (e.shift_name || '—')} / ${e.office_name || '—'}`),
        el('td', {}, e.active ? el('span', { class: 'pill ok' }, 'Hoạt động') : el('span', { class: 'pill bad' }, 'Khoá')),
        el('td', {}, actions),
      ));
    }
    tbl.append(tb);
    if (addBtn) addBtn.onclick = () => empModal(null);
    setMain(head('Nhân viên (' + rows.length + ')', deptBtn, addBtn), el('div', { class: 'panel tbl-scroll' }, tbl));
  } catch (e) { setMain(head('Nhân viên'), el('div', { class: 'empty' }, e.message)); }
}
function roleLabel(r) { return el('span', { class: 'pill ' + (r === 'admin' ? 'bad' : r === 'manager' ? 'warn' : 'muted') }, { admin: 'Admin', manager: 'Quản lý', employee: 'Nhân viên' }[r]); }
function btnSm(t, fn, cls = '') { const b = el('button', { class: 'btn sm ' + cls }, t); b.onclick = fn; return b; }

function empModal(e) {
  const f = {};
  const mk = (id, ph, val = '') => (f[id] = input('e-' + id, { placeholder: ph, value: val }));
  const roleSel = el('select', { id: 'e-role' },
    ...['employee', 'manager', 'admin'].map(v => el('option', { value: v, ...(e?.role === v ? { selected: '' } : {}) }, { employee: 'Nhân viên', manager: 'Quản lý', admin: 'Admin' }[v])));
  const officeBox = el('div', { style: 'display:flex;flex-wrap:wrap;gap:10px 16px;padding-top:4px' },
    ...OFFICES.map(o => el('label', { style: 'display:flex;align-items:center;gap:6px;font-weight:500;color:var(--ink)' },
      el('input', { type: 'checkbox', class: 'e-office', value: o.id, style: 'width:auto', ...((e?.office_ids || []).includes(o.id) ? { checked: '' } : {}) }), o.name)));
  const officeField = el('div', {}, el('label', {}, 'Định vị được chấm (bỏ trống = tất cả định vị)'),
    OFFICES.length ? officeBox : el('div', { class: 'map-hint' }, 'Chưa có định vị nào. Thêm ở mục Chi nhánh.'));
  const assignSel = el('select', { id: 'e-assign' },
    el('option', { value: '' }, '— Chọn phân công ca —'),
    el('optgroup', { label: 'Ca cố định' },
      ...SHIFTS.map(s => el('option', { value: 's:' + s.id, ...(!e?.work_schedule_id && e?.shift_id === s.id ? { selected: '' } : {}) }, `${s.name} (${s.start_time}-${s.end_time})`))),
    el('optgroup', { label: 'Lịch trình ca (tự động tìm ca)' },
      ...SCHEDULES.map(w => el('option', { value: 'w:' + w.id, ...(e?.work_schedule_id === w.id ? { selected: '' } : {}) }, `📋 ${w.name}`))));

  // Bộ phận: dropdown + thêm nhanh
  const deptSel = el('select', { id: 'e-department' },
    el('option', { value: '' }, '— Chọn bộ phận —'),
    ...DEPARTMENTS.map(d => el('option', { value: d.name, ...(e?.department === d.name ? { selected: '' } : {}) }, d.name)));
  if (e?.department && !DEPARTMENTS.some(d => d.name === e.department))
    deptSel.append(el('option', { value: e.department, selected: '' }, e.department));
  const addDeptBtn = el('button', { class: 'btn ghost sm', type: 'button', title: 'Thêm bộ phận' }, '＋');
  addDeptBtn.onclick = async () => {
    const name = (prompt('Tên bộ phận mới:') || '').trim();
    if (!name) return;
    try {
      await api('/admin/departments', { method: 'POST', body: { name } });
      DEPARTMENTS.push({ name });
      deptSel.append(el('option', { value: name, selected: '' }, name));
      deptSel.value = name; toast('Đã thêm bộ phận', 'ok');
    } catch (err) { toast(err.message, 'err'); }
  };
  const deptField = el('div', {}, el('label', {}, 'Bộ phận'),
    el('div', { style: 'display:flex;gap:6px' }, deptSel, addDeptBtn));

  // ----- Phân quyền chi tiết (chỉ áp cho Quản lý / Nhân viên; Admin toàn quyền) -----
  const permWrap = el('div', { id: 'e-perm-wrap', style: 'margin-top:4px' });
  const initialPerms = () => {
    if (e && e.permissions) { try { const p = JSON.parse(e.permissions); if (Array.isArray(p)) return p; } catch {} }
    return (e?.role === 'manager') ? MANAGER_DEFAULT.slice() : [];
  };
  let permState = new Set(initialPerms());
  const renderPerms = (role) => {
    permWrap.innerHTML = '';
    if (role === 'admin') { permWrap.append(el('div', { class: 'map-hint' }, '👑 Admin có toàn quyền mọi chức năng — không cần phân quyền.')); return; }
    permWrap.append(el('label', {}, 'Cho phép dùng chức năng'));
    const grid = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;margin-top:4px;padding:10px;border:1px solid var(--line,#eee);border-radius:10px' });
    for (const [k, label] of PERM_CATALOG) {
      const cb = el('input', { type: 'checkbox', class: 'e-perm', value: k, style: 'width:auto', ...(permState.has(k) ? { checked: '' } : {}) });
      cb.addEventListener('change', () => { cb.checked ? permState.add(k) : permState.delete(k); });
      grid.append(el('label', { style: 'display:flex;align-items:center;gap:6px;font-weight:500;color:var(--ink)' }, cb, label));
    }
    permWrap.append(grid);
  };
  roleSel.addEventListener('change', () => {
    // Đổi vai trò → gợi ý bộ quyền mặc định của vai trò đó
    permState = new Set(roleSel.value === 'manager' ? MANAGER_DEFAULT : (roleSel.value === 'admin' ? [] : []));
    renderPerms(roleSel.value);
  });
  renderPerms(e?.role || 'employee');

  const body = [
    el('div', { class: 'two-col' }, field('Mã NV *', mk('code', 'VD: NV002', e?.code)), field('Họ tên *', mk('full_name', 'Nguyễn Văn A', e?.full_name))),
    el('div', { class: 'two-col' }, deptField, field('Chức danh', mk('position', 'Nhân viên · Sale', e?.position))),
    el('div', { class: 'two-col' },
      field('Số điện thoại', mk('phone', '', e?.phone)),
      field('Số ID máy chấm công', mk('device_pin', 'VD: 1 (số ID trên máy)', e?.device_pin))),
    el('div', { class: 'two-col' }, field('Tài khoản *', mk('username', 'nv002', e?.username)), field('Vai trò', roleSel)),
    hourlyMode() ? officeField : el('div', {}, field('Phân công ca', assignSel), el('div', { style: 'margin-top:10px' }, officeField)),
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
      position: f.position.value, phone: f.phone.value, role: $('#e-role').value,
      device_pin: f.device_pin.value.trim(),
      username: f.username.value.trim(), office_ids: [...document.querySelectorAll('.e-office:checked')].map((x) => +x.value),
      password: $('#e-password').value || undefined,
    };
    const av = $('#e-assign')?.value || '';
    body.shift_id = av.startsWith('s:') ? +av.slice(2) : null;
    body.work_schedule_id = av.startsWith('w:') ? +av.slice(2) : null;
    if (body.role !== 'admin') body.permissions = [...permState];
    try {
      if (e) await api('/admin/employees/' + e.id, { method: 'PUT', body });
      else await api('/admin/employees', { method: 'POST', body });
      toast('Đã lưu', 'ok'); closeModal(); pageEmployees();
    } catch (err) { toast(err.message, 'err'); }
  };
  openModal(e ? 'Sửa nhân viên' : 'Thêm nhân viên', body, [el('button', { class: 'btn ghost' , onclick: closeModal }, 'Huỷ'), save]);
}
async function toggleEmp(e) { if (!confirm(`Khoá nhân viên ${e.full_name}?`)) return; await api('/admin/employees/' + e.id, { method: 'DELETE' }); pageEmployees(); }

function deptManageModal() {
  const listBox = el('div', {}, loading());
  const nameI = input('dm-name', { placeholder: 'VD: Kinh doanh, Kỹ thuật…' });
  const addBtn = el('button', { class: 'btn' }, 'Thêm');
  const load = async () => {
    const { rows } = await api('/admin/departments');
    DEPARTMENTS = rows;
    listBox.innerHTML = '';
    if (!rows.length) listBox.append(el('div', { class: 'map-hint' }, 'Chưa có bộ phận nào.'));
    for (const d of rows) {
      const del = btnSm('Xoá', async () => {
        try { await api('/admin/departments/' + d.id, { method: 'DELETE' }); load(); toast('Đã xoá', 'ok'); }
        catch (e) { toast(e.message, 'err'); }
      }, 'ghost');
      listBox.append(el('div', { style: 'display:flex;align-items:center;gap:10px;padding:8px 2px;border-bottom:1px solid #f1efec' },
        el('b', { style: 'flex:1' }, d.name), del));
    }
  };
  addBtn.onclick = async () => {
    const n = nameI.value.trim(); if (!n) return;
    try { await api('/admin/departments', { method: 'POST', body: { name: n } }); nameI.value = ''; load(); toast('Đã thêm', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  };
  openModal('Quản lý bộ phận', [
    el('div', { class: 'map-hint' }, 'Tạo sẵn bộ phận để chọn khi thêm nhân viên. Không xoá được bộ phận đang có nhân viên.'),
    el('div', { style: 'display:flex;gap:8px' }, nameI, addBtn),
    listBox,
  ], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Đóng')]);
  load();
}

/* ---------- 3) CA LÀM ---------- */
async function pageShifts() {
  const addBtn = hasPerm('shifts') ? el('button', { class: 'btn' }, '+ Thêm ca') : null;
  const schedBtn = hasPerm('shifts') ? el('button', { class: 'btn ghost' }, '🗂️ Lịch trình ca') : null;
  if (schedBtn) schedBtn.onclick = scheduleManageModal;
  setMain(head('Ca làm', schedBtn, addBtn), loading());
  const { rows } = await api('/admin/shifts');
  const tbl = el('table', { class: 'data' });
  tbl.innerHTML = `<thead><tr><th>Tên ca</th><th>Mã</th><th>Giờ vào</th><th>Giờ ra</th><th>Nhận diện tự động</th><th>Nghỉ giữa ca</th><th>Muộn/Sớm</th><th>Công/ca</th><th>OT</th><th>Ngày làm</th><th>TT</th><th></th></tr></thead>`;
  const tb = el('tbody');
  const dayNames = { 1: 'T2', 2: 'T3', 3: 'T4', 4: 'T5', 5: 'T6', 6: 'T7', 7: 'CN' };
  for (const s of rows) {
    const overnight = s.end_time <= s.start_time;
    tb.append(el('tr', {},
      el('td', {}, el('b', {}, s.name), overnight ? el('span', { title: 'Ca qua đêm' }, ' 🌙') : ''),
      el('td', {}, s.code ? el('span', { class: 'pill muted' }, s.code) : '—'),
      el('td', {}, s.start_time), el('td', {}, s.end_time),
      el('td', {}, s.check_in_start && s.check_in_end ? `${s.check_in_start}–${s.check_in_end}` : el('span', { style: 'color:#bbb' }, 'tắt')),
      el('td', {}, (s.break_minutes || 0) + ' phút'),
      el('td', {}, `${s.late_grace_min || 0}/${s.early_grace_min ?? 15} phút`),
      el('td', {}, el('b', {}, String(s.work_unit_value ?? 1))),
      el('td', {}, s.allow_ot ? el('span', { class: 'pill ok' }, 'Có') : el('span', { class: 'pill muted' }, 'Không')),
      el('td', {}, s.work_days.split(',').map(d => dayNames[d]).join(' ')),
      el('td', {}, s.active ? el('span', { class: 'pill ok' }, 'Bật') : el('span', { class: 'pill bad' }, 'Tắt')),
      el('td', {}, hasPerm('shifts') ? btnSm('Sửa', () => shiftModal(s)) : ''),
    ));
  }
  tbl.append(tb);
  if (addBtn) addBtn.onclick = () => shiftModal(null);
  setMain(head('Ca làm', schedBtn, addBtn), el('div', { class: 'panel tbl-scroll' }, tbl));
}

/* ---------- Lịch trình ca ---------- */
async function scheduleManageModal() {
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
function shiftModal(s) {
  const days = (s?.work_days || '1,2,3,4,5,6').split(',');
  const dayBoxes = [1, 2, 3, 4, 5, 6, 7].map(d => {
    const c = el('label', { style: 'display:flex;align-items:center;gap:5px;font-weight:600;color:var(--ink)' },
      el('input', { type: 'checkbox', class: 's-day', value: d, style: 'width:auto', ...(days.includes(String(d)) ? { checked: '' } : {}) }),
      { 1: 'T2', 2: 'T3', 3: 'T4', 4: 'T5', 5: 'T6', 6: 'T7', 7: 'CN' }[d]);
    return c;
  });
  const otChk = el('input', { type: 'checkbox', id: 's-allowot', style: 'width:auto', ...(s?.allow_ot ? { checked: '' } : {}) });
  const body = [
    el('div', { class: 'two-col' }, field('Tên ca *', input('s-name', { value: s?.name || '', placeholder: 'Hành chính' })), field('Mã ca (cho Excel)', input('s-code', { value: s?.code || '', placeholder: 'VD: HC, S, C, DEM' }))),
    el('div', { class: 'two-col' }, field('Giờ vào * (24h, VD 08:00)', time24('s-start', s?.start_time || '08:00')), field('Giờ ra * (24h, VD 17:30)', time24('s-end', s?.end_time || '17:30'))),
    el('div', { class: 'map-hint', style: 'margin:-4px 0 0' }, '🌙 Ca qua đêm: đặt Giờ ra NHỎ HƠN Giờ vào (VD 22:00 → 06:00) — hệ thống tự hiểu là qua ngày hôm sau.'),
    el('div', {}, el('label', {}, 'Cửa sổ nhận diện ca theo GIỜ CHẤM VÀO (tuỳ chọn — để tự tìm đúng ca)'),
      el('div', { class: 'two-col' }, field('Nhận diện TỪ giờ', time24('s-ciStart', s?.check_in_start || '')), field('ĐẾN giờ', time24('s-ciEnd', s?.check_in_end || ''))),
      el('div', { class: 'map-hint' }, 'Là MỘT khoảng giờ (từ → đến) để tự nhận đúng ca khi nhân viên chấm VÀO. VD ca Sáng 06:00→10:00, ca Chiều 12:00→15:00.')),
    el('div', {}, el('label', {}, 'Cửa sổ nhận diện theo GIỜ CHẤM RA (để phân biệt ca CÙNG giờ vào)'),
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
      field('OT: làm tròn theo (phút, 0=không)', input('s-otround', { type: 'number', value: s?.ot_rounding_unit ?? 0, min: 0 }))),
    el('div', { class: 'two-col' },
      field('Quy tắc ghép log máy (mặc định của ca)',
        el('select', { id: 's-rule' }, ...MERGE_RULES.filter(([v]) => v !== 'default').map(([v, t]) =>
          el('option', { value: v, ...(String(s?.merge_rule || 'filo') === v ? { selected: '' } : {}) }, t)))),
      field('TĐ-QĐ ghép theo',
        el('select', { id: 's-tdqd' },
          el('option', { value: 'pair', ...((s?.tdqd_mode || 'pair') === 'pair' ? { selected: '' } : {}) }, 'Thời gian (vào trước/ra sau)'),
          el('option', { value: 'idm', ...(s?.tdqd_mode === 'idm' ? { selected: '' } : {}) }, 'Máy lẻ/chẵn (IDM)')))),
    el('div', { class: 'map-hint', style: 'margin:-4px 0 0' }, 'Quy tắc ghép log = cách gộp nhiều lần quẹt máy thành giờ Vào/Ra. FILO hợp đa số. IDM cần đặt "số máy" cho từng máy (lẻ=Vào, chẵn=Ra). Có thể ghi đè khi phân ca.'),
    el('div', {}, el('label', {}, 'Ngày làm việc'), el('div', { style: 'display:flex;gap:12px;flex-wrap:wrap' }, ...dayBoxes)),
  ];
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
      ot_rounding_unit: +$('#s-otround').value || 0, work_days,
      merge_rule: $('#s-rule').value || 'filo', tdqd_mode: $('#s-tdqd').value || 'pair',
    };
    try { if (s) await api('/admin/shifts/' + s.id, { method: 'PUT', body: b }); else await api('/admin/shifts', { method: 'POST', body: b }); toast('Đã lưu', 'ok'); closeModal(); pageShifts(); }
    catch (err) { toast(err.message, 'err'); }
  };
  openModal(s ? 'Sửa ca' : 'Thêm ca', body, [el('button', { class: 'btn ghost', onclick: closeModal }, 'Huỷ'), save]);
}

/* ---------- 4) CHI NHÁNH ---------- */
async function pageOffices() {
  const addBtn = hasPerm('offices') ? el('button', { class: 'btn' }, '+ Thêm chi nhánh') : null;
  setMain(head('Chi nhánh / Vị trí', addBtn), loading());
  const { rows } = await api('/admin/offices');
  const tbl = el('table', { class: 'data' });
  tbl.innerHTML = `<thead><tr><th>Tên</th><th>Địa chỉ</th><th>Toạ độ</th><th>Bán kính</th><th>Bản đồ</th><th>TT</th><th></th></tr></thead>`;
  const tb = el('tbody');
  for (const o of rows) {
    tb.append(el('tr', {},
      el('td', {}, el('b', {}, o.name)),
      el('td', {}, o.address || '—'),
      el('td', {}, `${o.lat.toFixed(5)}, ${o.lng.toFixed(5)}`),
      el('td', {}, o.radius_m + ' m'),
      el('td', {}, el('a', { href: `https://www.google.com/maps?q=${o.lat},${o.lng}`, target: '_blank' }, 'Xem')),
      el('td', {}, o.active ? el('span', { class: 'pill ok' }, 'Bật') : el('span', { class: 'pill bad' }, 'Tắt')),
      el('td', {}, hasPerm('offices') ? el('div', { style: 'display:flex;gap:6px' }, btnSm('👥 Nhân viên', () => officeEmpModal(o)), btnSm('Sửa', () => officeModal(o))) : ''),
    ));
  }
  tbl.append(tb);
  if (addBtn) addBtn.onclick = () => officeModal(null);
  setMain(head('Chi nhánh / Vị trí', addBtn), el('div', { class: 'panel tbl-scroll' }, tbl));
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
let _asMode = 'week';        // 'week' = theo tuần | 'month' = theo tháng
let _asRange = null;         // {from,to} khi Anh tự chọn khoảng ngày (đè lên tuần/tháng)
function daysBetween(from, to) { const out = []; let d = from; for (let i = 0; i < 366 && d <= to; i++) { out.push(d); d = addDays(d, 1); } return out.length ? out : [from]; }

async function pageAssignments() {
  if (!_asStart) _asStart = todayVN();
  const isMonth = _asMode === 'month';

  const modeSel = el('select', { id: 'as-mode', title: 'Xem theo tuần hay theo tháng' },
    el('option', { value: 'week', ...(!isMonth ? { selected: '' } : {}) }, '🗓️ Theo tuần'),
    el('option', { value: 'month', ...(isMonth ? { selected: '' } : {}) }, '📅 Theo tháng'));
  modeSel.onchange = () => { _asMode = modeSel.value; _asRange = null; pageAssignments(); };

  const prevBtn = el('button', { class: 'btn ghost sm' }, isMonth ? '‹ Tháng trước' : '‹ Tuần trước');
  const nextBtn = el('button', { class: 'btn ghost sm' }, isMonth ? 'Tháng sau ›' : 'Tuần sau ›');
  const todayBtn = el('button', { class: 'btn ghost sm' }, isMonth ? 'Tháng này' : 'Tuần này');
  const deptSel = el('select', { id: 'as-dept' }, el('option', { value: '' }, '-- Tất cả phòng ban --'));
  prevBtn.onclick = () => { _asRange = null; _asStart = isMonth ? addMonths(_asStart, -1) : addDays(_asStart, -7); pageAssignments(); };
  nextBtn.onclick = () => { _asRange = null; _asStart = isMonth ? addMonths(_asStart, 1) : addDays(_asStart, 7); pageAssignments(); };
  todayBtn.onclick = () => { _asRange = null; _asStart = todayVN(); pageAssignments(); };

  const curMonth = _asStart.slice(0, 7);
  const exBtn = hasPerm('assignments') ? el('button', { class: 'btn ghost sm' }, '⬇ Xuất Excel mẫu') : null;
  const imBtn = hasPerm('assignments') ? el('button', { class: 'btn ghost sm' }, '⬆ Nhập Excel') : null;
  const fileI = el('input', { type: 'file', accept: '.xlsx', style: 'display:none' });
  if (exBtn) exBtn.onclick = async () => {
    try {
      const res = await api(`/admin/assignments/export.xlsx?month=${curMonth}&dept=${encodeURIComponent(deptSel.value)}`, { raw: true });
      if (!res.ok) { toast('Máy chủ trả lỗi ' + res.status, 'err'); return; }
      const blob = await res.blob(); const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: `phanca_${curMonth}.xlsx` });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) { toast('Không xuất được (mất kết nối, thử lại)', 'err'); }
  };
  if (imBtn) imBtn.onclick = () => fileI.click();
  fileI.onchange = () => {
    const f = fileI.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const r = await api('/admin/assignments/import', { method: 'POST', body: { month: curMonth, fileBase64: reader.result } });
        let msg = `Đã nhập: ${r.updated} ô ca, ${r.off} nghỉ, ${r.cleared} chuyển tự động`;
        if (r.errorCount) msg += ` · ${r.errorCount} lỗi`;
        toast(msg, r.errorCount ? 'err' : 'ok');
        if (r.errorCount) alert('Một số lỗi:\n' + r.errors.join('\n'));
        pageAssignments();
      } catch (e) { toast(e.message, 'err'); }
    };
    reader.readAsDataURL(f);
    fileI.value = '';
  };
  const saBtn = hasPerm('assignments') ? el('button', { class: 'btn ghost sm' }, '📋 Phân ca làm việc') : null;
  if (saBtn) saBtn.onclick = shiftAssignManageModal;
  const tools = [modeSel, prevBtn, todayBtn, nextBtn, deptSel, saBtn, exBtn, imBtn, fileI].filter(Boolean);

  setMain(head('Phân ca', ...tools), loading());

  let days;
  if (_asRange) days = daysBetween(_asRange.from, _asRange.to);
  else if (isMonth) days = monthDaysArr(curMonth);
  else { const ws = mondayOf(_asStart); days = Array.from({ length: 7 }, (_, i) => addDays(ws, i)); }
  const from = days[0], to = days[days.length - 1];
  let data;
  try { data = await api(`/admin/assignments?from=${from}&to=${to}`); }
  catch (e) { setMain(head('Phân ca'), el('div', { class: 'empty' }, e.message)); return; }

  // Dropdown phòng ban
  const depts = [...new Set(data.employees.map(e => e.department).filter(Boolean))].sort();
  for (const d of depts) deptSel.append(el('option', { value: d }, d));

  // Map phân ca: key emp|date -> {shift_id,is_off}
  // 1 ngày có thể NHIỀU ca (NV tự chọn ca gãy) → gom mảng theo emp|date
  const amap = new Map();
  for (const a of data.assignments) { const k = a.employee_id + '|' + a.work_date; if (!amap.has(k)) amap.set(k, []); amap.get(k).push(a); }

  const shiftOpts = (sel) => [
    el('option', { value: '', ...(sel === '' ? { selected: '' } : {}) }, '⚙ Tự động (theo giờ)'),
    ...data.shifts.map(s => el('option', { value: String(s.id), ...(String(sel) === String(s.id) ? { selected: '' } : {}) }, s.name)),
    el('option', { value: 'off', ...(sel === 'off' ? { selected: '' } : {}) }, '🛌 Nghỉ'),
  ];

  const render = () => {
    const dept = deptSel.value;
    const emps = dept ? data.employees.filter(e => e.department === dept) : data.employees;

    // Panel gán hàng loạt
    const bulkShift = el('select', {}, ...shiftOpts(''));
    const bulkFrom = el('input', { type: 'date', value: from });
    const bulkTo = el('input', { type: 'date', value: to });
    // Chọn Từ/Đến ngày → nạp lưới đúng khoảng đó (và cũng là khoảng để gán hàng loạt)
    const applyRange = () => { const f = bulkFrom.value, t = bulkTo.value; if (!f || !t) return; if (t < f) return toast('Đến ngày phải sau Từ ngày', 'err'); _asRange = { from: f, to: t }; pageAssignments(); };
    bulkFrom.onchange = applyRange; bulkTo.onchange = applyRange;
    const wdBoxes = [1, 2, 3, 4, 5, 6, 7].map(d => el('label', { style: 'display:flex;align-items:center;gap:4px;font-weight:600;color:var(--ink)' },
      el('input', { type: 'checkbox', class: 'bulk-wd', value: d, style: 'width:auto' }), WD[d]));
    const bulkBtn = el('button', { class: 'btn' }, `Áp dụng cho ${emps.length} NV đang hiển thị`);
    const pickedIds = () => [...document.querySelectorAll('.emp-pick:checked')].map(x => +x.value);
    const updateBulkLabel = () => { const n = pickedIds().length; bulkBtn.textContent = n ? `Áp dụng cho ${n} NV đã chọn` : `Áp dụng cho ${emps.length} NV đang hiển thị`; };
    bulkBtn.onclick = async () => {
      const v = bulkShift.value;
      const weekdays = [...document.querySelectorAll('.bulk-wd:checked')].map(x => +x.value);
      const picked = pickedIds();
      const ids = picked.length ? picked : emps.map(e => e.id);   // bỏ trống = tất cả đang hiển thị
      if (!ids.length) return toast('Không có nhân viên', 'err');
      const body = { employee_ids: ids, from: bulkFrom.value, to: bulkTo.value, weekdays,
        shift_id: (v === '' || v === 'off') ? null : +v, is_off: v === 'off' };
      if (!body.from || !body.to) return toast('Chọn khoảng ngày', 'err');
      try { const r = await api('/admin/assignments/bulk', { method: 'POST', body }); toast(`Đã gán ${r.count} lượt cho ${ids.length} NV`, 'ok'); pageAssignments(); }
      catch (e) { toast(e.message, 'err'); }
    };
    const bulkPanel = hasPerm('assignments') ? el('div', { class: 'panel', style: 'padding:14px 16px;margin-bottom:14px' },
      el('div', { style: 'font-weight:700;margin-bottom:4px' }, 'Gán hàng loạt'),
      el('div', { class: 'map-hint', style: 'margin:0 0 10px' }, 'Tích chọn nhân viên ở bảng bên dưới để chỉ áp cho họ; bỏ trống = tất cả NV đang hiển thị.'),
      el('div', { style: 'display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end' },
        el('div', {}, el('label', {}, 'Ca'), bulkShift),
        el('div', {}, el('label', {}, 'Từ ngày'), bulkFrom),
        el('div', {}, el('label', {}, 'Đến ngày'), bulkTo),
        el('div', {}, el('label', {}, 'Thứ (bỏ trống = tất cả)'), el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;padding-top:6px' }, ...wdBoxes)),
        bulkBtn)) : null;

    // Bảng lịch tuần
    const tbl = el('table', { class: 'data' });
    const selAll = el('input', { type: 'checkbox', style: 'width:auto;margin-right:6px;vertical-align:middle', title: 'Chọn / bỏ tất cả' });
    selAll.onchange = () => { document.querySelectorAll('.emp-pick').forEach((c) => { c.checked = selAll.checked; }); updateBulkLabel(); };
    const thead = el('tr', {}, el('th', {}, selAll, 'Nhân viên'));
    for (const d of days) {
      const we = weekdayVN(d) >= 6;
      thead.append(el('th', { style: we ? 'background:#fff4e6' : '' },
        el('div', {}, WD[weekdayVN(d)]),
        el('div', { style: 'font-weight:400;color:#999' }, d.slice(8) + '/' + d.slice(5, 7))));
    }
    tbl.append(el('thead', {}, thead));
    const tb = el('tbody');
    if (!emps.length) tb.append(el('tr', {}, el('td', { colspan: days.length + 1 }, el('div', { class: 'empty' }, 'Không có nhân viên.'))));
    for (const e of emps) {
      const cb = el('input', { type: 'checkbox', class: 'emp-pick', value: e.id, style: 'width:auto;margin-top:2px' });
      cb.onchange = updateBulkLabel;
      const tr = el('tr', {}, el('td', {}, el('div', { style: 'display:flex;align-items:flex-start;gap:8px' }, cb,
        el('div', {},
          el('b', {}, e.full_name),
          el('div', { style: 'color:#999;font-size:12px' }, `${e.code} · `,
            el('span', { style: /📋|📌|🛌/.test(e.base || '') ? 'color:#0a7;font-weight:600' : 'color:#999' }, e.base || (e.shift_name || '⚙ Tự động')))))));
      for (const d of days) {
        const arr = amap.get(e.id + '|' + d) || [];
        const a = arr[0];
        const cur = a ? (a.is_off ? 'off' : String(a.shift_id)) : '';
        const sel = el('select', { class: 'as-cell', style: 'padding:6px 8px;font-size:13px;min-width:120px' }, ...shiftOpts(cur));
        if (!hasPerm('assignments')) sel.disabled = true;
        if (cur === 'off') sel.style.color = '#b45309';
        // Badge khi 1 ngày có nhiều ca (NV tự chọn ca gãy); đổi ô này sẽ THAY bằng 1 ca
        const multi = arr.filter((x) => !x.is_off).length > 1
          ? el('div', { style: 'font-size:11px;color:#0a7;margin-top:2px', title: 'NV có ' + arr.length + ' ca ngày này' }, '🔀 ' + arr.length + ' ca') : null;
        sel.onchange = async () => {
          const v = sel.value;
          try {
            await api('/admin/assignments', { method: 'POST', body: { employee_id: e.id, work_date: d, shift_id: (v === '' || v === 'off') ? null : +v, is_off: v === 'off' } });
            if (v === 'off') { amap.set(e.id + '|' + d, [{ is_off: 1 }]); sel.style.color = '#b45309'; }
            else if (v === '') { amap.delete(e.id + '|' + d); sel.style.color = ''; }
            else { amap.set(e.id + '|' + d, [{ shift_id: +v, is_off: 0 }]); sel.style.color = ''; }
            if (multi) multi.remove();
            toast('Đã lưu', 'ok');
          } catch (err) { toast(err.message, 'err'); }
        };
        const we = weekdayVN(d) >= 6;
        tr.append(el('td', { style: we ? 'background:#fffaf3' : '' }, sel, multi));
      }
      tb.append(tr);
    }
    tbl.append(tb);

    const range = el('div', { style: 'color:var(--muted);font-size:13px;margin-bottom:6px' },
      _asRange ? `Khoảng: ${from.slice(8)}/${from.slice(5, 7)} – ${to.slice(8)}/${to.slice(5, 7)}/${to.slice(0, 4)} (${days.length} ngày)`
        : isMonth ? `Tháng ${curMonth.slice(5)}/${curMonth.slice(0, 4)} (${days.length} ngày)`
          : `Tuần: ${from.slice(8)}/${from.slice(5, 7)} – ${to.slice(8)}/${to.slice(5, 7)}/${to.slice(0, 4)}`);
    const hint = el('div', { class: 'map-hint', style: 'margin-bottom:10px' },
      'Cột trái hiện lịch trình/ca gốc của NV (gán ở nút "📋 Phân ca làm việc"). Mỗi ô = ĐÈ ca cho riêng ngày đó; để "⚙ Tự động" là chấm theo lịch trình/ca gốc. Chỉ đổi ô khi muốn 1 ngày khác lịch (VD nghỉ, hoặc đổi ca đột xuất).');
    setMain(head('Phân ca', ...tools), range, hint, bulkPanel, el('div', { class: 'panel tbl-scroll' }, tbl));
  };

  deptSel.onchange = render;
  render();
}

/* ---------- 4c) PHÂN CA LÀM VIỆC (gán ca/lịch trình theo khoảng ngày) ---------- */
const MERGE_RULES = [
  ['default', 'Mặc định (theo khai báo trong từng ca)'],
  ['filo', 'FILO — Vào trước, ra sau'],
  ['tdhc', 'TĐ-HC — Theo cửa sổ thời gian'],
  ['idm', 'IDM — Máy lẻ vào / máy chẵn ra'],
  ['tdqd', 'TĐ-QĐ — Qua đêm'],
];
const RULE_LABEL = Object.fromEntries(MERGE_RULES);

async function shiftAssignManageModal() {
  const listBox = el('div', {}, loading());
  const addBtn = el('button', { class: 'btn' }, '+ Thêm phân ca');
  addBtn.onclick = () => shiftAssignFormModal(reload);
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
    const depts = [...new Set(ALL.map((r) => r.department).filter(Boolean))].sort();
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

async function shiftAssignFormModal(onSaved) {
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
    try { const r = await api('/admin/shift-assignments', { method: 'POST', body }); toast(`Đã phân ca cho ${r.count} nhân viên`, 'ok'); closeModal(); if (onSaved) setTimeout(shiftAssignManageModal, 100); }
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
  if (!EDITATT_EMP && emps[0]) EDITATT_EMP = emps[0].id;
  const empSel = el('select', { id: 'ea-emp', style: 'min-width:200px' },
    ...emps.map(e => el('option', { value: e.id, ...(e.id === EDITATT_EMP ? { selected: '' } : {}) }, `${e.full_name} (${e.code})`)));
  const monthI = el('input', { type: 'month', id: 'ea-month', value: todayMonth() });
  const addBtn = el('button', { class: 'btn' }, '+ Thêm giờ');
  const recalcBtn = el('button', { class: 'btn ghost' }, '↻ Tính lại');
  const roundBtn = el('button', { class: 'btn ghost' }, '⚙ Làm tròn');
  const wrap = el('div', { id: 'ea-wrap' });
  const load = async () => {
    EDITATT_EMP = +empSel.value;
    wrap.innerHTML = ''; wrap.append(loading());
    let data;
    try { data = await api(`/admin/attendance?employee_id=${empSel.value}&month=${monthI.value}`); }
    catch (e) { wrap.innerHTML = ''; wrap.append(el('div', { class: 'empty' }, e.message)); return; }
    const tbl = el('table', { class: 'data' });
    tbl.innerHTML = `<thead><tr><th>Ngày</th><th>Thứ</th><th>Vào</th><th>Ra</th><th>Ca</th><th>Muộn(ph)</th><th>Sớm(ph)</th><th>OT(ph)</th><th>Giờ</th><th>Công</th><th>Ghi chú</th><th></th></tr></thead>`;
    const tb = el('tbody');
    if (!data.rows.length) tb.append(el('tr', {}, el('td', { colspan: 12 }, el('div', { class: 'empty' }, 'Chưa có bản ghi nào trong tháng. Bấm "+ Thêm giờ".'))));
    for (const r of data.rows) {
      const nm = shiftName(r.shift_id);
      tb.append(el('tr', {},
        el('td', {}, r.work_date.slice(8) + '/' + r.work_date.slice(5, 7), r.manual ? el('span', { class: 'pill muted', style: 'margin-left:6px' }, '✏️ tay') : ''),
        el('td', {}, wdName(r.work_date)),
        el('td', {}, r.check_in_at ? isoToHM(r.check_in_at) : '—'),
        el('td', {}, r.check_out_at ? isoToHM(r.check_out_at) : el('span', { class: 'pill muted' }, 'chưa ra')),
        el('td', {}, nm ? el('span', { class: 'pill' }, nm) : el('span', { class: 'muted' }, '—')),
        el('td', {}, r.late_min > 0 ? el('span', { style: 'color:#c0392b;font-weight:600' }, String(r.late_min)) : '—'),
        el('td', {}, r.early_min > 0 ? el('span', { style: 'color:#c0392b;font-weight:600' }, String(r.early_min)) : '—'),
        el('td', {}, r.ot_min > 0 ? el('span', { style: 'color:#0a7;font-weight:600' }, String(r.ot_min)) : '—'),
        el('td', {}, humanMinutes(r.work_minutes)),
        el('td', {}, String(r.work_unit ?? 0)),
        el('td', {}, r.note || '—'),
        el('td', {}, el('div', { style: 'display:flex;gap:6px' },
          btnSm('Sửa', () => attEditModal(r, null, load)),
          btnSm('Xoá', async () => { if (confirm(`Xoá giờ chấm ngày ${r.work_date}?`)) { await api('/admin/attendance/' + r.id, { method: 'DELETE' }); load(); } }, 'ghost'))),
      ));
    }
    tbl.append(tb);
    wrap.innerHTML = '';
    wrap.append(el('div', { class: 'map-hint', style: 'margin-bottom:10px' }, 'Thêm/sửa giờ cho trường hợp quên chấm hoặc đi công tác. Sau khi đổi ca, bấm "↻ Tính lại" để cập nhật Ca / Muộn / Sớm / OT / Công theo cấu hình mới.'), el('div', { class: 'panel tbl-scroll' }, tbl));
  };
  empSel.onchange = load; monthI.onchange = load;
  addBtn.onclick = () => attEditModal(null, +empSel.value, load);
  recalcBtn.onclick = async () => {
    if (!confirm(`Tính lại toàn bộ công tháng ${monthI.value} (tất cả nhân viên)?\nHệ thống sẽ dò lại ca theo giờ vào/ra và tính lại Muộn/Sớm/OT/Công.`)) return;
    recalcBtn.disabled = true; recalcBtn.textContent = 'Đang tính…';
    try { const rs = await api('/admin/recompute?month=' + monthI.value, { method: 'POST' }); toast(`Đã tính lại ${rs.updated} bản ghi`, 'ok'); await load(); }
    catch (e) { toast(e.message, 'err'); }
    finally { recalcBtn.disabled = false; recalcBtn.textContent = '↻ Tính lại'; }
  };
  roundBtn.onclick = () => roundingModal(monthI.value, load);
  setMain(head('Tính công', empSel, monthI, addBtn, recalcBtn, roundBtn), wrap);
  load();
}

// Cấu hình làm tròn số công + tính lại
async function roundingModal(month, reload) {
  let cfg = {};
  try { cfg = await api('/admin/settings'); } catch {}
  const decI = el('select', { style: 'width:100%' },
    ...[0, 1, 2, 3].map(d => el('option', { value: d, ...(String(cfg.workunit_rounding) === String(d) ? { selected: '' } : {}) },
      d === 0 ? '0 (số nguyên)' : d + ' chữ số thập phân')));
  const modeI = el('select', { style: 'width:100%' },
    ...[['0', 'Lùi (làm tròn xuống)'], ['1', 'Tới (làm tròn lên)'], ['2', 'Gần nhất']].map(([v, t]) =>
      el('option', { value: v, ...(String(cfg.workunit_rounding_mode || '0') === v ? { selected: '' } : {}) }, t)));
  const body = [
    field('Số chữ số thập phân của công', decI),
    field('Kiểu làm tròn', modeI),
    el('div', { class: 'map-hint' }, 'VD: công thực 0,86 → Lùi = 0,8 · Tới = 0,9 · Gần nhất = 0,9 (với 1 chữ số thập phân). Lưu xong sẽ tính lại công tháng ' + month + '.'),
  ];
  const save = el('button', { class: 'btn' }, 'Lưu & tính lại');
  save.onclick = async () => {
    save.disabled = true; save.textContent = 'Đang xử lý…';
    try {
      await api('/admin/settings', { method: 'PUT', body: { workunit_rounding: decI.value, workunit_rounding_mode: modeI.value } });
      const rs = await api('/admin/recompute?month=' + month, { method: 'POST' });
      toast(`Đã lưu và tính lại ${rs.updated} bản ghi`, 'ok'); closeModal(); reload();
    } catch (e) { toast(e.message, 'err'); save.disabled = false; save.textContent = 'Lưu & tính lại'; }
  };
  openModal('Làm tròn số công', body, [el('button', { class: 'btn ghost', onclick: closeModal }, 'Huỷ'), save]);
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
  openModal(row ? 'Sửa giờ chấm' : 'Thêm giờ chấm', body, [el('button', { class: 'btn ghost', onclick: closeModal }, 'Huỷ'), save]);
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

/* ---------- MÁY CHẤM CÔNG (ZKTeco ADMS push) ---------- */
async function pageDevices() {
  setMain(head('Máy chấm công'), loading());
  let d;
  try { d = await api('/admin/devices'); } catch (e) { setMain(head('Máy chấm công'), el('div', { class: 'empty' }, e.message)); return; }

  // Bật/tắt dùng máy chấm công + tự tạo NV — CHỈ tài khoản tổng đổi được
  const enChk = el('input', { type: 'checkbox', style: 'width:auto', ...(d.enabled ? { checked: '' } : {}) });
  const autoChk = el('input', { type: 'checkbox', style: 'width:auto', ...(d.autocreate ? { checked: '' } : {}) });
  const saveEn = el('button', { class: 'btn sm' }, 'Lưu');
  saveEn.onclick = async () => {
    try {
      await api('/admin/settings', { method: 'PUT', body: { device_enabled: enChk.checked, device_autocreate: autoChk.checked } });
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
        el('div', { style: 'margin-top:12px' }, saveEn))
    : el('div', { class: 'panel', style: 'padding:16px 18px;margin-bottom:14px;max-width:640px' },
        el('div', {}, el('b', {}, 'Tính năng máy chấm công:'), stPill(d.enabled)),
        el('div', { style: 'margin-top:6px' }, el('b', {}, 'Tự tạo NV khi đăng ký vân tay:'), stPill(d.autocreate)),
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
  const guide = el('div', { class: 'panel', style: 'padding:16px 18px;margin-bottom:14px;max-width:640px' },
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap' },
      el('h3', { style: 'margin:0;font-size:15px' }, '🔧 Cách kết nối máy chấm công'), refreshNet),
    el('ol', { style: 'margin:10px 0 0;padding-left:18px;font-size:14px;line-height:1.9' },
      el('li', { html: 'Trên máy: <b>Menu → Comm/Kết nối → Cloud Server (ADMS)</b>.' }),
      el('li', {}, 'Server IP: ', ipVal, '  ·  Port: ', portVal, '  ', el('span', { style: 'font-size:12px;color:var(--muted)' }, '(đổi mạng xong bấm “Refresh mạng”)')),
      el('li', { html: 'Chọn giao thức <b>HTTP</b> (KHÔNG bật SSL/HTTPS). Lưu & khởi động lại máy.' }),
      el('li', { html: 'Máy sẽ hiện bên dưới ở trạng thái <b>Chờ duyệt</b> → bấm <b>Duyệt</b>.' }),
      el('li', { html: 'Đăng ký vân tay trên máy → NV tự về phần mềm (bản nháp). Điền <b>Số ID máy</b> trong hồ sơ NV cho khớp <b>số ID trên máy</b> để tính công.' })),
    ipsHint);

  // Bảng danh sách máy
  const tbl = el('table', { class: 'data' });
  tbl.innerHTML = `<thead><tr><th>Serial</th><th>Tên máy</th><th>Trạng thái</th><th>👥 NV</th><th>👉 Vân tay</th><th>😊 Mặt</th><th>💳 Thẻ</th><th>IP</th><th>Lần cuối</th><th>Số quẹt</th><th></th></tr></thead>`;
  const tb = el('tbody');
  const countCells = {};   // serial -> {nv,fp,face,card} để tự làm mới số liệu
  if (!d.rows.length) tb.append(el('tr', {}, el('td', { colspan: 11 }, el('div', { class: 'empty' }, 'Chưa có máy nào kết nối. Cấu hình máy theo hướng dẫn trên, máy sẽ tự hiện ở đây.'))));
  for (const m of d.rows) {
    const approve = m.active
      ? btnSm('Tạm dừng', async () => { await api('/admin/devices/' + m.id, { method: 'PUT', body: { active: false } }); pageDevices(); }, 'ghost')
      : btnSm('✅ Duyệt', async () => { await api('/admin/devices/' + m.id, { method: 'PUT', body: { active: true } }); pageDevices(); });
    const rename = btnSm('Đổi tên', async () => { const name = prompt('Tên máy:', m.name || ''); if (name != null) { await api('/admin/devices/' + m.id, { method: 'PUT', body: { name } }); pageDevices(); } }, 'ghost');
    const groupBtn = btnSm('Nhóm ĐB', async () => { const g = prompt('Nhóm đồng bộ (các máy CÙNG nhóm sẽ tự đồng bộ NV/vân tay/thẻ/mật mã/khuôn mặt cho nhau).\nĐể trống = không đồng bộ:', m.sync_group || ''); if (g != null) { await api('/admin/devices/' + m.id, { method: 'PUT', body: { sync_group: g } }); toast('Đã đặt nhóm đồng bộ', 'ok'); pageDevices(); } }, 'ghost');
    const mnumBtn = btnSm('Số máy', async () => { const n = prompt('Số máy (dùng cho quy tắc ghép log IDM: máy số LẺ = chấm VÀO, máy CHẴN = chấm RA).\n0 = không dùng:', m.machine_number || 0); if (n != null) { await api('/admin/devices/' + m.id, { method: 'PUT', body: { machine_number: parseInt(n, 10) || 0 } }); toast('Đã đặt số máy', 'ok'); pageDevices(); } }, 'ghost');
    const logBtn = btnSm('Xem quẹt', () => devicePunchesModal(m));
    const clearBtn = btnSm('🗑 Xóa dữ liệu', () => deviceClearModal(m), 'ghost');
    const del = btnSm('Xoá', async () => { if (confirm('Xoá máy này khỏi danh sách?')) { await api('/admin/devices/' + m.id, { method: 'DELETE' }); pageDevices(); } }, 'ghost');
    const cNV = el('td', { style: 'text-align:center;font-weight:600;font-variant-numeric:tabular-nums' }, String(m.emp_count ?? 0));
    const cFP = el('td', { style: 'text-align:center;font-variant-numeric:tabular-nums' }, String(m.fp_count ?? 0));
    const cFace = el('td', { style: 'text-align:center;font-variant-numeric:tabular-nums' }, String(m.face_count ?? 0));
    const cCard = el('td', { style: 'text-align:center;font-variant-numeric:tabular-nums' }, String(m.card_count ?? 0));
    countCells[m.serial] = { cNV, cFP, cFace, cCard };
    tb.append(el('tr', {},
      el('td', {}, el('span', { class: 'mono', style: 'font-family:monospace' }, m.serial)),
      el('td', {}, m.name || '—', m.sync_group ? el('div', { style: 'font-size:11px;color:#0a7' }, '🔁 Nhóm: ' + m.sync_group) : '', m.machine_number ? el('div', { style: 'font-size:11px;color:#666' }, '🔢 Số máy: ' + m.machine_number) : ''),
      el('td', {}, m.active ? el('span', { class: 'pill ok' }, 'Đã duyệt') : el('span', { class: 'pill warn' }, 'Chờ duyệt')),
      cNV, cFP, cFace, cCard,
      el('td', {}, m.last_ip || '—'),
      el('td', {}, m.last_seen ? isoToHMS(m.last_seen) + ' ' + m.last_seen.slice(8, 10) + '/' + m.last_seen.slice(5, 7) : '—'),
      el('td', {}, `${m.punch_count}${m.unmatched ? ` · ${m.unmatched} mã chưa khớp` : ''}`),
      el('td', {}, el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, approve, rename, groupBtn, mnumBtn, logBtn, clearBtn, del)),
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
        cc.cNV.textContent = String(m.emp_count ?? 0);
        cc.cFP.textContent = String(m.fp_count ?? 0);
        cc.cFace.textContent = String(m.face_count ?? 0);
        cc.cCard.textContent = String(m.card_count ?? 0);
      }
    } catch { /* bỏ qua, thử lại lần sau */ }
    if (document.body.contains(tbl)) setTimeout(tickCounts, 10000);
  };
  setTimeout(tickCounts, 10000);
  const rebuildBtn = el('button', { class: 'btn ghost' }, '🔄 Đồng bộ lại (khớp mã NV)');
  rebuildBtn.onclick = async () => {
    rebuildBtn.disabled = true; rebuildBtn.textContent = 'Đang xử lý…';
    try { const r = await api('/admin/devices/rebuild', { method: 'POST' }); toast(`Đã dựng lại ${r.rebuilt} ngày công`, 'ok'); pageDevices(); }
    catch (e) { toast(e.message, 'err'); }
    finally { rebuildBtn.disabled = false; rebuildBtn.textContent = '🔄 Đồng bộ lại (khớp mã NV)'; }
  };
  const resyncBtn = el('button', { class: 'btn' }, '🔁 Đồng bộ vân tay các máy');
  resyncBtn.onclick = async () => {
    if (!confirm('Đẩy toàn bộ nhân viên/vân tay/thẻ/khuôn mặt của mỗi nhóm sang tất cả máy trong nhóm ngay bây giờ?\n(Dùng khi vân tay đăng ký trước lúc ghép nhóm, hoặc máy vừa bật lại — không cần khởi động lại máy.)')) return;
    resyncBtn.disabled = true; resyncBtn.textContent = 'Đang đồng bộ…';
    try {
      const r = await api('/admin/devices/resync', { method: 'POST' });
      if (!r.devices) toast('Chưa có nhóm nào ≥2 máy để đồng bộ. Hãy đặt "Nhóm ĐB" giống nhau cho các máy.', 'err');
      else toast(`Đã xếp ${r.queued} lệnh đồng bộ cho ${r.devices} máy (${r.groups} nhóm). Máy sẽ nhận trong ít giây.`, 'ok');
    } catch (e) { toast(e.message, 'err'); }
    finally { resyncBtn.disabled = false; resyncBtn.textContent = '🔁 Đồng bộ vân tay các máy'; }
  };
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
function devicePunchesModal(m) {
  const box = el('div', {}, loading());
  api('/admin/devices/' + m.id + '/punches').then(({ rows }) => {
    box.innerHTML = '';
    if (!rows.length) { box.append(el('div', { class: 'empty' }, 'Chưa có lượt quẹt nào.')); return; }
    const t = el('table', { class: 'data' });
    t.innerHTML = '<thead><tr><th>Mã</th><th>Nhân viên</th><th>Thời điểm</th><th>Kiểu</th></tr></thead>';
    const tb = el('tbody');
    const vName = { 1: 'Vân tay', 15: 'Khuôn mặt', 4: 'Thẻ', 0: 'Mật mã' };
    for (const p of rows) tb.append(el('tr', {},
      el('td', {}, p.pin),
      el('td', {}, p.full_name || el('span', { class: 'pill warn' }, 'chưa khớp')),
      el('td', {}, isoToHMS(p.punch_at) + ' ' + p.punch_at.slice(8, 10) + '/' + p.punch_at.slice(5, 7)),
      el('td', {}, vName[p.verify] || ('#' + p.verify))));
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
const SYMBOL_COLOR = { X: '#166534', T: '#b45309', P: '#1d4ed8', L: '#7c3aed', V: '#dc2626', O: '#b45309' };
// Nhóm báo cáo cho giao diện dạng thẻ: [nhóm, [ [type, icon, tên, mô tả] ... ]]
const REPORT_GROUPS = [
  ['Bản ghi chấm công', [
    ['attendance', '📋', 'Bản ghi chấm công', 'Tất cả lần chấm: giờ vào/ra, đi muộn, vị trí'],
    ['firstlast', '🕐', 'Giờ vào & ra đầu/cuối', 'Giờ chấm sớm nhất và muộn nhất mỗi ngày'],
  ]],
  ['Chi tiết chấm công', [
    ['detail', '📆', 'Chi tiết theo ngày', 'Chi tiết chấm công từng ngày của từng nhân viên'],
    ['daytime', '⏱️', 'Chi tiết giờ vào/ra', 'Giờ vào–ra thực tế từng ngày trong tháng (ma trận)'],
    ['workhours', '🕘', 'Giờ công & tăng ca', 'Ma trận giờ công mỗi ngày + tổng giờ, giờ tăng ca'],
    ['horizontal', '📊', 'Bảng công ngang', 'Ma trận ngày × NV: công, giờ, trễ, sớm, tăng ca'],
    ['symbol', '🔤', 'Bảng ký hiệu / Thống kê tháng', 'X=làm · T=trễ/sớm · P=phép · L=lễ · V=vắng · O=thiếu ra'],
    ['late', '⏰', 'Đi muộn / về sớm', 'Danh sách đi muộn, về sớm và số phút'],
    ['ot', '➕', 'Tăng ca', 'Chi tiết giờ tăng ca theo ngày'],
  ]],
  ['Tổng hợp', [
    ['summary', '👥', 'Tổng hợp nhân viên', 'Tổng công, giờ, tăng ca, trễ, sớm mỗi NV'],
    ['absence', '🚫', 'Vắng mặt / nghỉ phép', 'Số ngày làm, vắng, nghỉ phép, nghỉ lễ, thiếu ra'],
    ['leave', '🌴', 'Nghỉ phép / đơn từ', 'Tổng nghỉ phép và chi tiết theo loại'],
    ['payroll', '💰', 'Bảng lương', 'Bảng lương tháng theo kỳ lương đã cấu hình'],
  ]],
];

async function pageReport() {
  const hourly = hourlyMode();
  const monthI = el('input', { type: 'month', id: 'rp-month', value: todayMonth() });
  const deptSel = el('select', { id: 'rp-dept' }, el('option', { value: '' }, '-- Tất cả phòng ban --'));
  try { const { rows } = await api('/reports/departments'); for (const d of rows) deptSel.append(el('option', { value: d }, d)); } catch {}

  // Màn danh sách báo cáo dạng thẻ, gom nhóm
  const hub = () => {
    monthI.onchange = null; deptSel.onchange = null;
    const wrap = el('div', {});
    wrap.append(el('div', { class: 'map-hint', style: 'margin-bottom:4px' }, 'Chọn kỳ (tháng) và phòng ban ở trên, rồi bấm vào một báo cáo để xem chi tiết và xuất Excel.'));
    for (const [gname, cards] of REPORT_GROUPS) {
      const list = cards.filter(([v]) => !hourly || !['late', 'ot', 'symbol'].includes(v));
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
    setMain(head('Báo cáo', monthI, deptSel), wrap);
  };

  // Xem 1 báo cáo cụ thể (có nút quay lại danh sách)
  const showReport = (type) => {
    const backBtn = el('button', { class: 'btn ghost sm' }, '← Danh sách báo cáo');
    backBtn.onclick = hub;
    const exportBtn = el('button', { class: 'btn green' }, '⬇ Xuất Excel');
    exportBtn.onclick = () => downloadExcel(type, monthI.value, deptSel.value);
    const wrap = el('div', {}, loading());
    setMain(head('Báo cáo', backBtn, monthI, deptSel, exportBtn), wrap);
    const load = async () => {
      wrap.innerHTML = ''; wrap.append(loading());
      let data;
      try { data = await api(`/reports/data?type=${type}&month=${monthI.value}&dept=${encodeURIComponent(deptSel.value)}`); }
      catch (e) { wrap.innerHTML = ''; wrap.append(el('div', { class: 'empty' }, e.message)); return; }
      const tbl = el('table', { class: 'data' });
      const thead = el('tr', {});
      for (const c of data.columns) thead.append(el('th', { style: c.weekend ? 'background:#fff4e6;color:#b45309' : '' }, c.label));
      tbl.append(el('thead', {}, thead));
      const tb = el('tbody');
      if (!data.rows.length) tb.append(el('tr', {}, el('td', { colspan: data.columns.length }, el('div', { class: 'empty' }, 'Không có dữ liệu.'))));
      for (const row of data.rows) {
        const tr = el('tr', {});
        for (const c of data.columns) {
          const v = row[c.key];
          const isSym = type === 'symbol' && SYMBOL_COLOR[v];
          tr.append(el('td', {
            style: (c.weekend ? 'background:#fffaf3;' : '') + (isSym ? `color:${SYMBOL_COLOR[v]};font-weight:700;text-align:center` : (c.key.startsWith('d20') ? 'text-align:center' : '')),
          }, v === '' || v == null ? '' : String(v)));
        }
        tb.append(tr);
      }
      tbl.append(tb);
      wrap.innerHTML = '';
      wrap.append(el('div', { style: 'font-weight:800;font-size:16px;color:var(--ink);margin-bottom:10px' }, data.title),
        el('div', { class: 'panel tbl-scroll' }, tbl));
    };
    monthI.onchange = load; deptSel.onchange = load;
    load();
  };

  hub();
}
async function downloadExcel(type, month, dept) {
  try {
    const res = await api(`/reports/export.xlsx?type=${type}&month=${month}&dept=${encodeURIComponent(dept || '')}`, { raw: true });
    if (!res.ok) { toast('Máy chủ trả lỗi ' + res.status + ' khi xuất', 'err'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: `baocao_${type}_${month}.xlsx` });
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
  const geoChk = el('input', { type: 'checkbox', id: 'st-geo', style: 'width:auto', ...(s.geofence_enforce === '1' ? { checked: '' } : {}) });
  const devChk = el('input', { type: 'checkbox', id: 'st-dev', style: 'width:auto', ...(s.device_enabled === '1' ? { checked: '' } : {}) });
  const lockChk = el('input', { type: 'checkbox', id: 'st-lock', style: 'width:auto', ...(s.device_lock_enabled === '1' ? { checked: '' } : {}) });
  const selfChk = el('input', { type: 'checkbox', id: 'st-self', style: 'width:auto', ...(s.self_shift_enabled === '1' ? { checked: '' } : {}) });
  const apprChk = el('input', { type: 'checkbox', id: 'st-appr', style: 'width:auto', ...(s.self_shift_approve !== '0' ? { checked: '' } : {}) });
  const saveMode = el('button', { class: 'btn' }, 'Lưu cấu hình chấm công');
  saveMode.onclick = async () => {
    const attendance_mode = document.querySelector('input[name=att-mode]:checked')?.value || 'shift';
    try {
      const body = { attendance_mode, geofence_enforce: geoChk.checked, device_lock_enabled: lockChk.checked, self_shift_enabled: selfChk.checked, self_shift_approve: apprChk.checked };
      if (isMaster()) body.device_enabled = devChk.checked;   // chỉ tài khoản tổng đổi được máy chấm công
      await api('/admin/settings', { method: 'PUT', body });
      toast('Đã lưu. Đang tải lại…', 'ok'); setTimeout(() => location.reload(), 700);
    } catch (e) { toast(e.message, 'err'); }
  };
  const modeRow = (radio, title, desc) => el('label', { style: 'display:flex;gap:10px;align-items:flex-start;padding:10px;border:1px solid var(--line,#eee);border-radius:10px;cursor:pointer' },
    radio, el('div', {}, el('b', {}, title), el('div', { style: 'font-size:13px;color:var(--muted)' }, desc)));
  const panelMode = hasPerm('settings') ? el('div', { class: 'panel', style: 'padding:20px;max-width:520px;margin-bottom:16px' },
    el('h3', { style: 'margin-top:0' }, 'Kiểu chấm công'),
    el('div', { style: 'display:flex;flex-direction:column;gap:10px' },
      modeRow(modeShift, '🕐 Theo ca làm việc', 'Có ca, tính đi muộn / về sớm / tăng ca, báo cáo đầy đủ. Phù hợp văn phòng, nhà máy.'),
      modeRow(modeHourly, '⏱️ Chỉ tính công theo giờ', 'Không cần khai báo ca, chỉ tính tổng giờ làm để trả lương theo giờ. Đơn giản cho cửa hàng, quán.'),
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
      el('h3', { style: 'margin:0;font-size:15px' }, 'Máy chấm công (ZKTeco)'),
      isMaster()
        ? el('label', { style: 'display:flex;gap:10px;align-items:flex-start;cursor:pointer' }, devChk,
            el('div', {}, el('b', {}, 'Dùng máy chấm công'),
              el('div', { style: 'font-size:13px;color:var(--muted)' }, 'Bật để nhận dữ liệu chấm công đẩy về từ máy ZKTeco (vân tay/khuôn mặt/thẻ). Cấu hình & duyệt máy ở menu “Máy chấm công”. Có thể dùng song song với chấm điện thoại.')))
        : el('div', { style: 'font-size:13px;color:var(--muted)' }, el('b', { style: 'color:var(--ink)' }, s.device_enabled === '1' ? 'Đang BẬT. ' : 'Đang TẮT. '), '🔒 Chỉ tài khoản tổng (Digiplus) bật/tắt được tính năng máy chấm công.'),
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
  const roundI = input('st-round', { type: 'number', min: 0, max: 3, value: s.workunit_rounding ?? 2 });
  const payStartI = input('st-paystart', { type: 'number', min: 1, max: 28, value: s.pay_period_start_day ?? 1 });
  const saveCalc = el('button', { class: 'btn' }, 'Lưu quy tắc');
  saveCalc.onclick = async () => {
    const weekend_days = [...document.querySelectorAll('.wk-day:checked')].map(x => x.value).join(',');
    try { await api('/admin/settings', { method: 'PUT', body: { weekend_days, workunit_rounding: roundI.value, pay_period_start_day: payStartI.value } }); toast('Đã lưu quy tắc', 'ok'); }
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
  const panelCalc = (hasPerm('settings') && !hourlyMode()) ? el('div', { class: 'panel', style: 'padding:20px;max-width:520px;margin-bottom:16px' },
    el('h3', { style: 'margin-top:0' }, 'Quy tắc tính công'),
    el('div', { style: 'display:flex;flex-direction:column;gap:12px' },
      el('div', {}, el('label', {}, 'Ngày cuối tuần (tính OT ×2)'), el('div', { style: 'display:flex;gap:12px;flex-wrap:wrap' }, ...wkBoxes)),
      field('Làm tròn số công (số chữ số thập phân)', roundI),
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
    el('h3', { style: 'margin-top:0' }, 'Ngày lễ (tính OT ×3)'),
    el('div', { style: 'display:flex;flex-direction:column;gap:12px' },
      el('div', { class: 'two-col' }, field('Ngày', holDate), field('Tên', holName)),
      addHol, holBox)) : null;

  // ----- Sao lưu & phục hồi dữ liệu -----
  const bkBox = el('div', { id: 'bk-box' }, loading());
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

    // Danh sách bản sao lưu
    bkBox.append(el('div', { class: 'sec-title', style: 'font-weight:700;margin:16px 0 6px' }, `Các bản sao lưu (${d.list.length})`));
    if (!d.list.length) bkBox.append(el('div', { class: 'map-hint' }, 'Chưa có bản sao lưu nào.'));
    for (const b of d.list) {
      const dl = btnSm('Tải', () => downloadBackup(b.name));
      const del = btnSm('Xoá', async () => { if (confirm('Xoá bản sao lưu này?')) { await api('/admin/backup?name=' + encodeURIComponent(b.name), { method: 'DELETE' }); loadBackups(); } }, 'ghost');
      bkBox.append(el('div', { style: 'display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #f1efec' },
        el('span', { style: 'flex:1;font-family:monospace;font-size:13px' }, (b.full ? '📦 ' : '🗃 ') + b.name),
        el('span', { style: 'color:var(--muted);font-size:12px' }, (b.full ? 'toàn bộ · ' : '') + fmtSize(b.size)), dl, del));
    }

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
  const panelUpdate = hasPerm('settings') ? el('div', { class: 'panel', style: 'padding:20px;max-width:520px;margin-bottom:16px' },
    el('h3', { style: 'margin-top:0' }, '⬆ Cập nhật phần mềm'),
    el('div', { style: 'display:flex;flex-direction:column;gap:12px' },
      el('div', {}, el('span', { style: 'color:var(--muted)' }, 'Phiên bản đang dùng: '), el('b', {}, s.app_version || '—')),
      el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, checkBtn, applyBtn),
      updStatus,
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
