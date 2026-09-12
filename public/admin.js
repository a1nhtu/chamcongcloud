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
  ['editatt', '✏️', 'Sửa công', 'attendance_edit'],
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
$('#modal-bg').addEventListener('click', (e) => { if (e.target.id === 'modal-bg') closeModal(); });

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
  const officeSel = el('select', { id: 'e-office' }, el('option', { value: '' }, '— Chọn chi nhánh —'),
    ...OFFICES.map(o => el('option', { value: o.id, ...(e?.office_id === o.id ? { selected: '' } : {}) }, o.name)));
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
    hourlyMode() ? field('Chi nhánh', officeSel) : el('div', { class: 'two-col' }, field('Phân công ca', assignSel), field('Chi nhánh', officeSel)),
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
      username: f.username.value.trim(), office_id: +$('#e-office').value || null,
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
    el('div', { class: 'two-col' }, field('Giờ vào *', input('s-start', { type: 'time', value: s?.start_time || '08:00' })), field('Giờ ra *', input('s-end', { type: 'time', value: s?.end_time || '17:30' }))),
    el('div', { class: 'map-hint', style: 'margin:-4px 0 0' }, '🌙 Ca qua đêm: đặt Giờ ra NHỎ HƠN Giờ vào (VD 22:00 → 06:00) — hệ thống tự hiểu là qua ngày hôm sau.'),
    el('div', {}, el('label', {}, 'Cửa sổ nhận diện giờ vào — bật TỰ ĐỘNG tìm ca (tuỳ chọn)'),
      el('div', { class: 'two-col' }, input('s-ciStart', { type: 'time', value: s?.check_in_start || '' }), input('s-ciEnd', { type: 'time', value: s?.check_in_end || '' })),
      el('div', { class: 'map-hint' }, 'VD ca sáng 06:00–10:00, ca chiều 12:00–15:00. Khi NV chấm, hệ thống tự chọn ca có giờ khớp.')),
    el('div', { class: 'two-col' },
      field('Cho phép đi muộn (phút)', input('s-grace', { type: 'number', value: s?.late_grace_min ?? 5, min: 0 })),
      field('Cho phép về sớm (phút)', input('s-early', { type: 'number', value: s?.early_grace_min ?? 15, min: 0 }))),
    el('div', { class: 'two-col' },
      field('Nghỉ giữa ca (phút)', input('s-break', { type: 'number', value: s?.break_minutes ?? 0, min: 0 })),
      field('Giá trị công (1 ca=1.0, nửa ca=0.5)', input('s-unit', { type: 'number', step: '0.1', value: s?.work_unit_value ?? 1.0, min: 0 }))),
    el('div', {}, el('label', { style: 'display:flex;align-items:center;gap:8px;color:var(--ink);font-weight:600' }, otChk, 'Cho phép tính tăng ca (OT) khi ở lại sau giờ tan ca')),
    el('div', { class: 'two-col' },
      field('OT: ở lại tối thiểu (phút)', input('s-otafter', { type: 'number', value: s?.ot_start_after_min ?? 30, min: 0 })),
      field('OT: làm tròn theo (phút, 0=không)', input('s-otround', { type: 'number', value: s?.ot_rounding_unit ?? 0, min: 0 }))),
    el('div', {}, el('label', {}, 'Ngày làm việc'), el('div', { style: 'display:flex;gap:12px;flex-wrap:wrap' }, ...dayBoxes)),
  ];
  const save = el('button', { class: 'btn' }, 'Lưu');
  save.onclick = async () => {
    const work_days = [...document.querySelectorAll('.s-day:checked')].map(x => x.value).join(',') || '1,2,3,4,5,6';
    const b = {
      name: $('#s-name').value.trim(), code: $('#s-code').value.trim(),
      start_time: $('#s-start').value, end_time: $('#s-end').value,
      check_in_start: $('#s-ciStart').value || '', check_in_end: $('#s-ciEnd').value || '',
      late_grace_min: +$('#s-grace').value || 0, early_grace_min: +$('#s-early').value || 0,
      break_minutes: +$('#s-break').value || 0, work_unit_value: +$('#s-unit').value || 1,
      allow_ot: otChk.checked, ot_start_after_min: +$('#s-otafter').value || 0,
      ot_rounding_unit: +$('#s-otround').value || 0, work_days,
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
      el('td', {}, hasPerm('offices') ? btnSm('Sửa', () => officeModal(o)) : ''),
    ));
  }
  tbl.append(tb);
  if (addBtn) addBtn.onclick = () => officeModal(null);
  setMain(head('Chi nhánh / Vị trí', addBtn), el('div', { class: 'panel tbl-scroll' }, tbl));
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

let _asStart = null; // ngày đầu tuần đang xem

async function pageAssignments() {
  if (!_asStart) _asStart = mondayOf(todayVN());

  const prevBtn = el('button', { class: 'btn ghost sm' }, '‹ Tuần trước');
  const nextBtn = el('button', { class: 'btn ghost sm' }, 'Tuần sau ›');
  const todayBtn = el('button', { class: 'btn ghost sm' }, 'Tuần này');
  const deptSel = el('select', { id: 'as-dept' }, el('option', { value: '' }, '-- Tất cả phòng ban --'));
  prevBtn.onclick = () => { _asStart = addDays(_asStart, -7); pageAssignments(); };
  nextBtn.onclick = () => { _asStart = addDays(_asStart, 7); pageAssignments(); };
  todayBtn.onclick = () => { _asStart = mondayOf(todayVN()); pageAssignments(); };

  const curMonth = _asStart.slice(0, 7);
  const exBtn = hasPerm('assignments') ? el('button', { class: 'btn ghost sm' }, '⬇ Xuất Excel mẫu') : null;
  const imBtn = hasPerm('assignments') ? el('button', { class: 'btn ghost sm' }, '⬆ Nhập Excel') : null;
  const fileI = el('input', { type: 'file', accept: '.xlsx', style: 'display:none' });
  if (exBtn) exBtn.onclick = async () => {
    try {
      const res = await api(`/admin/assignments/export.xlsx?month=${curMonth}&dept=${encodeURIComponent(deptSel.value)}`, { raw: true });
      const blob = await res.blob(); const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `phanca_${curMonth}.xlsx`; a.click(); URL.revokeObjectURL(a.href);
    } catch (e) { toast('Không xuất được', 'err'); }
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
  const tools = [prevBtn, todayBtn, nextBtn, deptSel, exBtn, imBtn, fileI].filter(Boolean);

  setMain(head('Phân ca', ...tools), loading());

  const days = Array.from({ length: 7 }, (_, i) => addDays(_asStart, i));
  const from = days[0], to = days[6];
  let data;
  try { data = await api(`/admin/assignments?from=${from}&to=${to}`); }
  catch (e) { setMain(head('Phân ca'), el('div', { class: 'empty' }, e.message)); return; }

  // Dropdown phòng ban
  const depts = [...new Set(data.employees.map(e => e.department).filter(Boolean))].sort();
  for (const d of depts) deptSel.append(el('option', { value: d }, d));

  // Map phân ca: key emp|date -> {shift_id,is_off}
  const amap = new Map();
  for (const a of data.assignments) amap.set(a.employee_id + '|' + a.work_date, a);

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
    const wdBoxes = [1, 2, 3, 4, 5, 6, 7].map(d => el('label', { style: 'display:flex;align-items:center;gap:4px;font-weight:600;color:var(--ink)' },
      el('input', { type: 'checkbox', class: 'bulk-wd', value: d, style: 'width:auto' }), WD[d]));
    const bulkBtn = el('button', { class: 'btn' }, `Áp dụng cho ${emps.length} NV đang hiển thị`);
    bulkBtn.onclick = async () => {
      const v = bulkShift.value;
      const weekdays = [...document.querySelectorAll('.bulk-wd:checked')].map(x => +x.value);
      const body = {
        employee_ids: emps.map(e => e.id), from: bulkFrom.value, to: bulkTo.value, weekdays,
        shift_id: (v === '' || v === 'off') ? null : +v, is_off: v === 'off',
      };
      if (!body.from || !body.to) return toast('Chọn khoảng ngày', 'err');
      try { const r = await api('/admin/assignments/bulk', { method: 'POST', body }); toast(`Đã gán ${r.count} lượt`, 'ok'); pageAssignments(); }
      catch (e) { toast(e.message, 'err'); }
    };
    const bulkPanel = hasPerm('assignments') ? el('div', { class: 'panel', style: 'padding:14px 16px;margin-bottom:14px' },
      el('div', { style: 'font-weight:700;margin-bottom:10px' }, 'Gán hàng loạt'),
      el('div', { style: 'display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end' },
        el('div', {}, el('label', {}, 'Ca'), bulkShift),
        el('div', {}, el('label', {}, 'Từ ngày'), bulkFrom),
        el('div', {}, el('label', {}, 'Đến ngày'), bulkTo),
        el('div', {}, el('label', {}, 'Thứ (bỏ trống = tất cả)'), el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;padding-top:6px' }, ...wdBoxes)),
        bulkBtn)) : null;

    // Bảng lịch tuần
    const tbl = el('table', { class: 'data' });
    const thead = el('tr', {}, el('th', {}, 'Nhân viên'));
    for (const d of days) {
      const we = weekdayVN(d) >= 6;
      thead.append(el('th', { style: we ? 'background:#fff4e6' : '' },
        el('div', {}, WD[weekdayVN(d)]),
        el('div', { style: 'font-weight:400;color:#999' }, d.slice(8) + '/' + d.slice(5, 7))));
    }
    tbl.append(el('thead', {}, thead));
    const tb = el('tbody');
    if (!emps.length) tb.append(el('tr', {}, el('td', { colspan: 8 }, el('div', { class: 'empty' }, 'Không có nhân viên.'))));
    for (const e of emps) {
      const tr = el('tr', {}, el('td', {},
        el('b', {}, e.full_name),
        el('div', { style: 'color:#999;font-size:12px' }, `${e.code} · mặc định: ${e.shift_name || '—'}`)));
      for (const d of days) {
        const a = amap.get(e.id + '|' + d);
        const cur = a ? (a.is_off ? 'off' : String(a.shift_id)) : '';
        const sel = el('select', { class: 'as-cell', style: 'padding:6px 8px;font-size:13px;min-width:120px' }, ...shiftOpts(cur));
        if (!hasPerm('assignments')) sel.disabled = true;
        if (cur === 'off') sel.style.color = '#b45309';
        sel.onchange = async () => {
          const v = sel.value;
          try {
            await api('/admin/assignments', { method: 'POST', body: { employee_id: e.id, work_date: d, shift_id: (v === '' || v === 'off') ? null : +v, is_off: v === 'off' } });
            if (v === 'off') { amap.set(e.id + '|' + d, { is_off: 1 }); sel.style.color = '#b45309'; }
            else if (v === '') { amap.delete(e.id + '|' + d); sel.style.color = ''; }
            else { amap.set(e.id + '|' + d, { shift_id: +v, is_off: 0 }); sel.style.color = ''; }
            toast('Đã lưu', 'ok');
          } catch (err) { toast(err.message, 'err'); }
        };
        const we = weekdayVN(d) >= 6;
        tr.append(el('td', { style: we ? 'background:#fffaf3' : '' }, sel));
      }
      tb.append(tr);
    }
    tbl.append(tb);

    const range = el('div', { style: 'color:var(--muted);font-size:13px;margin-bottom:10px' },
      `Tuần: ${from.slice(8)}/${from.slice(5, 7)} – ${to.slice(8)}/${to.slice(5, 7)}/${to.slice(0, 4)}`);
    setMain(head('Phân ca', ...tools), range, bulkPanel, el('div', { class: 'panel tbl-scroll' }, tbl));
  };

  deptSel.onchange = render;
  render();
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
async function pageSalary() {
  setMain(head('Cấu hình lương'), loading());
  let data;
  try { data = await api('/admin/salary'); } catch (e) { setMain(head('Cấu hình lương'), el('div', { class: 'empty' }, e.message)); return; }
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
  setMain(head('Cấu hình lương'), hint, el('div', { class: 'panel tbl-scroll' }, tbl));
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
async function pageEditAtt() {
  setMain(head('Sửa công'), loading());
  let emps;
  try { emps = (await api('/admin/employees')).rows.filter(e => e.active); }
  catch (e) { setMain(head('Sửa công'), el('div', { class: 'empty' }, e.message)); return; }
  if (!EDITATT_EMP && emps[0]) EDITATT_EMP = emps[0].id;
  const empSel = el('select', { id: 'ea-emp', style: 'min-width:200px' },
    ...emps.map(e => el('option', { value: e.id, ...(e.id === EDITATT_EMP ? { selected: '' } : {}) }, `${e.full_name} (${e.code})`)));
  const monthI = el('input', { type: 'month', id: 'ea-month', value: todayMonth() });
  const addBtn = el('button', { class: 'btn' }, '+ Thêm giờ');
  const wrap = el('div', { id: 'ea-wrap' });
  const load = async () => {
    EDITATT_EMP = +empSel.value;
    wrap.innerHTML = ''; wrap.append(loading());
    let data;
    try { data = await api(`/admin/attendance?employee_id=${empSel.value}&month=${monthI.value}`); }
    catch (e) { wrap.innerHTML = ''; wrap.append(el('div', { class: 'empty' }, e.message)); return; }
    const tbl = el('table', { class: 'data' });
    tbl.innerHTML = `<thead><tr><th>Ngày</th><th>Thứ</th><th>Vào</th><th>Ra</th><th>Giờ</th><th>Công</th><th>Ghi chú</th><th></th></tr></thead>`;
    const tb = el('tbody');
    if (!data.rows.length) tb.append(el('tr', {}, el('td', { colspan: 8 }, el('div', { class: 'empty' }, 'Chưa có bản ghi nào trong tháng. Bấm "+ Thêm giờ".'))));
    for (const r of data.rows) {
      tb.append(el('tr', {},
        el('td', {}, r.work_date.slice(8) + '/' + r.work_date.slice(5, 7), r.manual ? el('span', { class: 'pill muted', style: 'margin-left:6px' }, '✏️ tay') : ''),
        el('td', {}, wdName(r.work_date)),
        el('td', {}, r.check_in_at ? isoToHM(r.check_in_at) : '—'),
        el('td', {}, r.check_out_at ? isoToHM(r.check_out_at) : el('span', { class: 'pill muted' }, 'chưa ra')),
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
    wrap.append(el('div', { class: 'map-hint', style: 'margin-bottom:10px' }, 'Thêm/sửa giờ cho trường hợp quên chấm hoặc đi công tác. Hệ thống tự tính lại số công, đi muộn theo giờ nhập.'), el('div', { class: 'panel tbl-scroll' }, tbl));
  };
  empSel.onchange = load; monthI.onchange = load;
  addBtn.onclick = () => attEditModal(null, +empSel.value, load);
  setMain(head('Sửa công', empSel, monthI, addBtn), wrap);
  load();
}
function attEditModal(row, employeeId, reload) {
  const date0 = row ? row.work_date : new Date().toLocaleDateString('sv', { timeZone: 'Asia/Ho_Chi_Minh' });
  const dateI = input('att-date', { type: 'date', value: date0, ...(row ? { disabled: '' } : {}) });
  const inI = input('att-in', { type: 'time', value: row?.check_in_at ? isoToHM(row.check_in_at) : '' });
  const outI = input('att-out', { type: 'time', value: row?.check_out_at ? isoToHM(row.check_out_at) : '' });
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
    const logBtn = btnSm('Xem quẹt', () => devicePunchesModal(m));
    const del = btnSm('Xoá', async () => { if (confirm('Xoá máy này khỏi danh sách?')) { await api('/admin/devices/' + m.id, { method: 'DELETE' }); pageDevices(); } }, 'ghost');
    const cNV = el('td', { style: 'text-align:center;font-weight:600;font-variant-numeric:tabular-nums' }, String(m.emp_count ?? 0));
    const cFP = el('td', { style: 'text-align:center;font-variant-numeric:tabular-nums' }, String(m.fp_count ?? 0));
    const cFace = el('td', { style: 'text-align:center;font-variant-numeric:tabular-nums' }, String(m.face_count ?? 0));
    const cCard = el('td', { style: 'text-align:center;font-variant-numeric:tabular-nums' }, String(m.card_count ?? 0));
    countCells[m.serial] = { cNV, cFP, cFace, cCard };
    tb.append(el('tr', {},
      el('td', {}, el('span', { class: 'mono', style: 'font-family:monospace' }, m.serial)),
      el('td', {}, m.name || '—', m.sync_group ? el('div', { style: 'font-size:11px;color:#0a7' }, '🔁 Nhóm: ' + m.sync_group) : ''),
      el('td', {}, m.active ? el('span', { class: 'pill ok' }, 'Đã duyệt') : el('span', { class: 'pill warn' }, 'Chờ duyệt')),
      cNV, cFP, cFace, cCard,
      el('td', {}, m.last_ip || '—'),
      el('td', {}, m.last_seen ? isoToHMS(m.last_seen) + ' ' + m.last_seen.slice(8, 10) + '/' + m.last_seen.slice(5, 7) : '—'),
      el('td', {}, `${m.punch_count}${m.unmatched ? ` · ${m.unmatched} mã chưa khớp` : ''}`),
      el('td', {}, el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, approve, rename, groupBtn, logBtn, del)),
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
  setMain(head('Máy chấm công', resyncBtn, rebuildBtn), togglePanel, guide, el('div', { class: 'panel tbl-scroll' }, tbl));
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

async function pageReport() {
  // Chế độ theo giờ: bỏ các mẫu gắn với ca (đi muộn/về sớm, tăng ca, ký hiệu công)
  const types = hourlyMode() ? REPORT_TYPES.filter(([v]) => !['late', 'ot', 'symbol'].includes(v)) : REPORT_TYPES;
  const typeSel = el('select', { id: 'rp-type', style: 'min-width:180px' },
    ...types.map(([v, l]) => el('option', { value: v }, l)));
  const monthI = el('input', { type: 'month', id: 'rp-month', value: todayMonth() });
  const deptSel = el('select', { id: 'rp-dept' }, el('option', { value: '' }, '-- Tất cả phòng ban --'));
  const exportBtn = el('button', { class: 'btn green' }, '⬇ Xuất Excel');
  setMain(head('Báo cáo', typeSel, monthI, deptSel, exportBtn), loading());

  try {
    const { rows } = await api('/reports/departments');
    for (const d of rows) deptSel.append(el('option', { value: d }, d));
  } catch {}

  const load = async () => {
    const type = typeSel.value, month = monthI.value, dept = deptSel.value;
    const wrap = el('div', { id: 'rp-wrap' }, loading());
    setMain(head('Báo cáo', typeSel, monthI, deptSel, exportBtn), wrap);
    let data;
    try { data = await api(`/reports/data?type=${type}&month=${month}&dept=${encodeURIComponent(dept)}`); }
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
    wrap.append(el('div', { style: 'font-weight:700;margin-bottom:8px' }, data.title),
      el('div', { class: 'panel tbl-scroll' }, tbl));
  };

  exportBtn.onclick = () => downloadExcel(typeSel.value, monthI.value, deptSel.value);
  typeSel.onchange = load; monthI.onchange = load; deptSel.onchange = load;
  load();
}
async function downloadExcel(type, month, dept) {
  try {
    const res = await api(`/reports/export.xlsx?type=${type}&month=${month}&dept=${encodeURIComponent(dept || '')}`, { raw: true });
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `baocao_${type}_${month}.xlsx`; a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) { toast('Không xuất được file', 'err'); }
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

async function pageSettings() {
  setMain(head('Cài đặt'), loading());
  const s = await api('/admin/settings');
  const nameI = input('st-name', { value: s.company_name });
  const saveName = el('button', { class: 'btn' }, 'Lưu tên công ty');
  saveName.onclick = async () => { try { await api('/admin/settings', { method: 'PUT', body: { company_name: nameI.value } }); toast('Đã lưu', 'ok'); applyBrand(); } catch (e) { toast(e.message, 'err'); } };

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
      field('Tên công ty (hiển thị trên app)', nameI), saveName,
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
  const repoI = input('st-repo', { value: s.update_repo || '', placeholder: 'owner/repo' });
  const branchI = input('st-branch', { value: s.update_branch || 'main', placeholder: 'main' });
  const saveRepo = el('button', { class: 'btn sm ghost' }, 'Lưu nguồn cập nhật');
  saveRepo.onclick = async () => {
    try { await api('/admin/settings', { method: 'PUT', body: { update_repo: repoI.value, update_branch: branchI.value } }); toast('Đã lưu nguồn cập nhật', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  };
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
      el('div', { class: 'two-col' }, field('Nguồn GitHub (owner/repo)', repoI), field('Nhánh', branchI)),
      saveRepo,
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

  const panel2 = el('div', { class: 'panel', style: 'padding:20px;max-width:520px' },
    el('h3', { style: 'margin-top:0' }, 'Đổi mật khẩu của tôi'),
    el('div', { style: 'display:flex;flex-direction:column;gap:12px' }, field('Mật khẩu hiện tại', oldP), field('Mật khẩu mới', newP), savePw));
  setMain(head('Cài đặt'), panel1, panelLicense, panelMode, panelCalc, panelHol, panelBackup, panelUpdate, panel2);
  if (hasPerm('holidays') && !hourlyMode()) loadHols();
  if (hasPerm('backup')) loadBackups();
  loadLic();
}
