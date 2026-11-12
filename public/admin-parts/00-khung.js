import {
  api, getToken, setToken, clearToken, toast, $, el, deviceId,
  isoToHM, isoToHMS, humanMinutes, humanDistance, todayMonth, ensureLicensed,
} from '/common.js';
// Hàm MỚI của common.js lấy qua namespace: trình duyệt còn giữ common.js bản cũ thì chỉ thiếu hàm (dùng mặc định), KHÔNG
// lỗi nạp cả trang (1.25.9: import tên mới + common.js cũ bị Cloudflare giữ 4 tiếng → trang đăng nhập chết)
import * as COMMON from '/common.js';
const rememberLogin = () => (COMMON.rememberLogin ? COMMON.rememberLogin() : true);
const tokenFromOtherTab = () => (COMMON.tokenFromOtherTab ? COMMON.tokenFromOtherTab() : Promise.resolve());

let ME = null;
let SETTINGS = {};        // cache cấu hình (attendance_mode, geofence…)
let _navKeys = new Set(); // các trang (key NAV) tài khoản đang đăng nhập được mở — cho /admin#<trang>
// [key, icon, label, quyền cần có để thấy mục này]
const NAV = [
  ['dashboard', '📊', 'Tổng quan', 'reports'],
  ['employees', '👥', 'Nhân viên', 'employees'],
  ['org', '🏢', 'Bộ phận', 'departments'],
  ['positions', '💼', 'Chức danh', 'departments'],
  ['hrprofile', '📇', 'Hồ sơ nhân sự', 'hr'],
  ['hrcontract', '📄', 'Hợp đồng lao động', 'hr'],
  ['hrdecision', '🔀', 'Thuyên chuyển & nghỉ việc', 'hr'],
  ['hrtemplates', '🖨️', 'Mẫu giấy tờ', 'hr'],
  ['shifts', '🕐', 'Ca làm', 'shifts'],
  ['assignments', '🗓️', 'Phân ca', 'assignments'],
  ['shiftreq', '🙋', 'Duyệt chọn ca', 'shift_requests'],
  ['editatt', '🧮', 'Tính công', 'attendance_edit'],
  ['fixtime', '✏️', 'Thêm/sửa/xóa giờ chấm', 'attendance_edit'],
  ['otreg', '⏰', 'Đăng ký làm thêm', 'attendance_edit'],
  ['swap', '🔁', 'Đăng ký làm bù', 'attendance_edit'],
  ['abnormal', '🚨', 'Chấm công bất thường', 'reports'],
  ['meal', '🍱', 'Đối chiếu & chốt suất ăn', 'meal'],
  ['mealreg', '📝', 'Đăng ký ăn', 'meal'],   // chế độ chỉ đăng ký ăn (không chọn món): danh sách + số lượng từng bữa / bếp, đăng ký hộ, gửi bếp
  ['mealrep', '📋', 'Tổng hợp & điều chỉnh suất ăn', 'meal'],
  ['mealrpt', '📊', 'Báo cáo suất ăn', 'meal'],
  ['mealmenu', '🍽️', 'Thực đơn các bữa', 'meal'],
  ['mealinv', '🥕', 'Nguyên liệu & kho bếp', 'meal'],   // định lượng nguyên liệu + tồn kho — công tắc riêng meal_ingredient (mặc định tắt)
  ['mealcfg', '⚙️', 'Cấu hình suất ăn', 'meal'],
  ['mealme', '🥢', 'Suất ăn của tôi', null],   // ai cũng thấy khi phân hệ bật: chọn món + (trưởng bộ phận) nhập số đăng ký
  ['offices', '📍', 'Chi nhánh', 'offices'],
  ['leaves', '📝', 'Đơn từ', 'leaves'],
  ['salary', '💰', 'Lương', 'salary'],
  ['report', '📅', 'Báo cáo', 'reports'],
  ['audit', '🎭', 'Công ảo / lương ảo', 'audit'],
  ['auditlimits', '⏱️', 'Tăng ca tối đa (ảo)', 'audit'],
  ['devices', '🔌', 'Máy chấm công', 'devices'],
  ['devreq', '📱', 'Duyệt đổi thiết bị', 'employees'],
  ['logs', '🧾', 'Nhật ký', 'logs'],
  ['settings', '⚙️', 'Cài đặt', 'settings'],
];
// NHÓM MENU TRÁI (menu dài → gom các mục cùng loại, mỗi nhóm 1 mũi tên xổ / thu). Mục không thuộc nhóm nào đứng riêng.
// Nhóm chỉ còn 1 mục nhìn thấy (do phân quyền / tắt tính năng) thì hiện thẳng mục đó, không cần tiêu đề nhóm.
const NAV_GROUPS = [
  ['org', 'Tổ chức', ['employees', 'org', 'positions', 'offices']],
  ['hr', 'Nhân sự', ['hrprofile', 'hrcontract', 'hrdecision', 'hrtemplates']],
  ['shift', 'Ca & phân ca', ['shifts', 'assignments', 'shiftreq']],
  ['att', 'Chấm công', ['editatt', 'fixtime', 'otreg', 'swap', 'abnormal', 'leaves']],
  ['mealg', 'Suất ăn', ['meal', 'mealreg', 'mealrep', 'mealrpt', 'mealmenu', 'mealinv', 'mealcfg', 'mealme']],
  ['pay', 'Lương & báo cáo', ['salary', 'report']],
  ['audit', 'Công ảo', ['audit', 'auditlimits']],
  ['sys', 'Thiết bị & hệ thống', ['devices', 'devreq', 'logs', 'settings']],
];
const _navGrp = new Map();   // id nhóm → { open(o, save), isOpen(), has(key) }
const _navSubs = [];         // menu con (Ca làm, Phân ca) → { isOpen(), setOpen(o) }
const navAnyOpen = () => [..._navGrp.values()].some((g) => g.isOpen()) || _navSubs.some((s) => s.isOpen());
// nút "Thu gọn hết / Mở hết": đóng (hoặc mở) mọi nhóm + menu con; nhóm thì nhớ trên máy như khi bấm từng nhóm
function navFoldAll(open) {
  for (const g of _navGrp.values()) g.open(open, true);
  for (const s of _navSubs) s.setOpen(open);
}
function navFoldSync() {
  const b = $('#nav-fold'); if (!b) return;
  const any = navAnyOpen();
  b.style.display = _navGrp.size || _navSubs.length ? '' : 'none';
  b.textContent = any ? '⊟ Thu gọn hết' : '⊞ Mở hết';
  b.title = any ? 'Thu gọn tất cả các nhóm menu' : 'Mở tất cả các nhóm menu';
}
const isMaster = () => ME?.role === 'master';                 // tài khoản tổng (Anh)
const isAdmin = () => ME?.role === 'admin' || isMaster();     // master có mọi quyền admin
const hasPerm = (key) => isAdmin() || (ME?.permissions || []).includes(key);
const hourlyMode = () => (SETTINGS.any_shift != null ? !SETTINGS.any_shift : SETTINGS.attendance_mode === 'hourly');
// Công ty có CẢ nhân viên chấm theo ca lẫn theo giờ
const mixedMode = () => !!(SETTINGS.any_shift && SETTINGS.any_hourly);
const ATT_MODE_LABEL = { '': 'Theo cài đặt chung của công ty', shift: '🕐 Theo ca làm việc', hourly: '⏱️ Theo giờ (làm bao nhiêu tính bấy nhiêu)' };
const deviceEnabled = () => SETTINGS.device_enabled === '1';
// CẤU HÌNH HIỂN THỊ (Cài đặt, chỉ tài khoản tổng): công ty không dùng chấm công (chỉ suất ăn…) → ẩn các menu chấm công / ca / lương / công ảo
const attOff = () => SETTINGS.att_enabled === '0';
const ATT_KEYS = new Set(['dashboard', 'shifts', 'assignments', 'shiftreq', 'editatt', 'fixtime', 'otreg', 'swap', 'abnormal', 'leaves', 'salary', 'report', 'audit', 'auditlimits', 'devreq', 'offices']);
// 3 công tắc cách đăng ký suất ăn (mặc định bật = như cũ): self_order · dish_choice · dept_head
const mealOpt = (k) => SETTINGS['meal_' + k] !== '0';
// CÔNG ẢO / LƯƠNG ẢO (audit): tài khoản tổng bật tính năng + người dùng có quyền "audit" mới thấy
// TÀI KHOẢN KIỂM TRA (audit_only): luôn công ảo, không có nút bật/tắt, không thấy chữ "ảo", chỉ xem
const isInspector = () => !!(ME && ME.audit_only);
const auditOn = () => SETTINGS.audit_enabled === '1' && hasPerm('audit') && !isInspector();
let _virt = 0;   // đang xem: 0 = công thật, 1/2/3 = công ảo mức đó (dùng chung cho Tính công / Báo cáo / Lương)
function virtToggle(onChange) {
  if (!auditOn()) return null;
  const box = el('div', { class: 'virt-seg', title: 'Xem công THẬT hay công ẢO mức 1 / 2 / 3 (tăng ca cắt theo menu "⏱️ Tăng ca tối đa"). Công thật không bao giờ bị đổi.' });
  for (const [v, t] of [[0, 'Thật'], [1, '🎭 Ảo 1'], [2, 'Ảo 2'], [3, 'Ảo 3']]) {
    const b = el('button', { type: 'button', class: (v === 0 ? 'real' : '') + (_virt === v ? ' on' : '') }, t);
    b.onclick = () => { if (_virt === v) return; _virt = v; box.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); onChange && onChange(); };
    box.append(b);
  }
  return box;
}
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
    // tên công ty do người dùng nhập → chèn dạng CHỮ (không qua innerHTML) để tên có ký tự < > & không thành thẻ HTML
    $('#side-brand').replaceChildren(c.company_name || '', el('small', {}, `Chấm công${ver ? ' · v' + ver : ''}`));
  } catch {}
  if ($('#li-remember')) $('#li-remember').checked = rememberLogin();
  await tokenFromOtherTab();
  if (getToken()) { try { const r = await api('/auth/me'); ME = r.user; return afterLogin(); } catch { clearToken(); } }
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#li-btn'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
  try {
    const r = await api('/auth/login', { method: 'POST', body: { username: $('#li-user').value, password: $('#li-pass').value } });
    ME = r.user;
    if (ME.role === 'employee') { toast('Tài khoản nhân viên — vui lòng dùng app chấm công', 'err'); btn.disabled = false; btn.textContent = 'Đăng nhập'; return; }
    setToken(r.token, $('#li-remember') ? $('#li-remember').checked : true); afterLogin();
  } catch (err) { toast(err.message, 'err'); btn.disabled = false; btn.textContent = 'Đăng nhập'; }
});
$('#btn-logout').addEventListener('click', () => { clearToken(); location.reload(); });

async function afterLogin() {
  if (ME.role === 'employee') { location.href = '/'; return; }
  $('#login-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  $('#me-name').textContent = ME.full_name;
  $('#me-role').textContent = ME.role === 'admin' ? 'Quản trị viên' : 'Quản lý';
  if (isInspector()) _virt = 1;   // tài khoản kiểm tra: máy chủ cũng ép công ảo cho mọi dữ liệu
  try { SETTINGS = await api('/admin/settings'); } catch { SETTINGS = {}; }
  try { PERM_CATALOG = (await api('/admin/perm-catalog')).permissions; } catch { PERM_CATALOG = []; }
  const nav = $('#nav'); nav.innerHTML = '';
  // nút thu gọn / mở rộng menu trái (thu gọn = chỉ còn biểu tượng, nội dung rộng hơn); nhớ lựa chọn trên máy này
  const setMini = (on) => { document.body.classList.toggle('nav-mini', on); try { localStorage.setItem('navMini', on ? '1' : '0'); } catch {} };
  try { if (localStorage.getItem('navMini') === '1') document.body.classList.add('nav-mini'); } catch {}
  if (!$('#nav-toggle')) {
    const tg = el('button', { id: 'nav-toggle', type: 'button', title: 'Thu gọn / mở rộng menu' }, el('span', { class: 'nt-c' }, '«'), el('span', { class: 'nt-o' }, '»'));
    tg.onclick = () => setMini(!document.body.classList.contains('nav-mini'));
    // nút cạnh «: thu gọn hết / mở hết các nhóm menu + menu con (Ca làm, Phân ca)
    const fold = el('button', { id: 'nav-fold', type: 'button' });
    fold.onclick = () => navFoldAll(!navAnyOpen());
    $('#side-brand').after(el('div', { id: 'nav-tools' }, tg, fold));
  }
  // tài khoản kiểm tra: chỉ các màn XEM (không Sửa giờ chấm công, Máy chấm công, Nhật ký, Cài đặt…)
  const INSPECTOR_NAV = ['dashboard', 'employees', 'org', 'positions', 'shifts', 'assignments', 'editatt', 'offices', 'leaves', 'salary', 'report'];
  const visible = NAV.filter(([key, , , perm]) => (perm == null || hasPerm(perm)) && (!isInspector() || INSPECTOR_NAV.includes(key))
    && !(hourlyMode() && (key === 'shifts' || key === 'assignments' || key === 'shiftreq' || key === 'otreg' || key === 'swap' || key === 'abnormal'))
    && !(key === 'devices' && !deviceEnabled())
    && !(key === 'devreq' && !deviceLockEnabled())
    && !(key === 'shiftreq' && !selfShiftEnabled())
    && !((key === 'audit' || key === 'auditlimits') && SETTINGS.audit_enabled !== '1')   // công ảo: chỉ hiện khi tài khoản tổng đã bật
    && !(key.startsWith('hr') && SETTINGS.hr_enabled !== '1')   // nhân sự: chỉ hiện khi tài khoản tổng đã bật
    && !(key.startsWith('meal') && SETTINGS.meal_enabled !== '1')   // suất ăn: chỉ hiện khi tài khoản tổng đã bật
    && !(attOff() && ATT_KEYS.has(key))                                 // công ty không dùng chấm công
    && !(key === 'meal' && !mealOpt('dept_head'))                       // không dùng trưởng bộ phận báo số → không cần Đối chiếu & chốt
    && !((key === 'mealrep' || key === 'mealmenu') && !mealOpt('dish_choice'))   // chỉ đăng ký ăn → không thực đơn / tổng hợp theo món
    && !(key === 'mealreg' && mealOpt('dish_choice'))
    && !(key === 'mealinv' && SETTINGS.meal_ingredient !== '1')            // định lượng nguyên liệu: chỉ khi tài khoản tổng bật
    && !(key === 'mealme' && !mealOpt('self_order') && !mealOpt('dept_head') && !(SETTINGS.meal_machine_signup === '1' && !mealOpt('dish_choice'))));
  // dựng khung nhóm: tiêu đề (bấm để xổ / thu, nhớ trên máy) + phần thân chứa các mục
  _navGrp.clear(); _navSubs.length = 0;
  const visKeys = new Set(visible.map((v) => v[0]));
  const boxOf = new Map();   // key mục → nơi gắn nút (thân nhóm hoặc nav)
  const made = new Set();
  const groupFor = (key) => NAV_GROUPS.find((g) => g[2].includes(key) && g[2].filter((k) => visKeys.has(k)).length > 1);
  const ensureGroup = (g) => {
    if (made.has(g[0])) return; made.add(g[0]);
    const [gid, glabel, keys] = g;
    let open = false; try { open = localStorage.getItem('navGrp_' + gid) === '1'; } catch {}
    const arrow = el('span', { class: 'nav-arrow' }, '▸');
    const h = el('button', { type: 'button', class: 'nav-grp-h', title: 'Xổ / thu nhóm ' + glabel }, el('span', { class: 'nav-lb' }, glabel), el('span', { style: 'flex:1' }), arrow);
    const body = el('div', { class: 'nav-grp-body' });
    const set = (o, save) => { open = o; body.classList.toggle('shut', !o); arrow.textContent = o ? '▾' : '▸'; h.classList.toggle('open', o); if (save) { try { localStorage.setItem('navGrp_' + gid, o ? '1' : '0'); } catch {} } navFoldSync(); };
    h.addEventListener('click', () => set(!open, true));
    set(open, false);
    nav.append(h, body);
    _navGrp.set(gid, { open: set, isOpen: () => open, has: (k) => keys.includes(k), head: h });
    for (const k of keys) boxOf.set(k, body);
  };
  visible.forEach(([key, ic, label]) => {
    const grp = groupFor(key); if (grp) ensureGroup(grp);
    const nav = boxOf.get(key) || $('#nav');   // mục trong nhóm gắn vào thân nhóm
    const b = el('button', { 'data-k': key, title: label + ' (Ctrl + bấm / chuột giữa: mở tab mới)' }, el('span', {}, ic), el('span', { class: 'nav-lb' }, label));
    // Ctrl/⌘/Shift + bấm hoặc bấm chuột giữa → mở trang này ở TAB MỚI (/admin#key), tab hiện tại giữ nguyên
    const openTab = (ev) => { ev.preventDefault(); ev.stopImmediatePropagation(); window.open(location.pathname + location.search + '#' + key, '_blank'); };
    b.addEventListener('click', (ev) => { if (ev.ctrlKey || ev.metaKey || ev.shiftKey) openTab(ev); }, true);
    b.addEventListener('auxclick', (ev) => { if (ev.button === 1) openTab(ev); });
    b.addEventListener('mousedown', (ev) => { if (ev.button === 1) ev.preventDefault(); });   // chuột giữa: không bật cuộn tự động
    // Mục có MENU CON (kiểu ZKBio): bấm mũi tên hoặc bấm mục để xổ ra / thu lại
    const SUB = key === 'assignments' ? { id: 'nav-sub-as', tabs: AS_TABS, isOpen: () => _asNavOpen, setOpen: (o) => { _asNavOpen = o; }, pick: (tab) => { if (!asLeaveOk()) return false; _asTab = tab; _asAdd = null; return true; } }
      : key === 'shifts' ? { id: 'nav-sub-sh', tabs: SH_TABS, isOpen: () => _shNavOpen, setOpen: (o) => { _shNavOpen = o; }, pick: (tab) => { _shView = tab; _schEdit = null; return true; } }
        : null;
    if (SUB) {
      const arrow = el('span', { class: 'nav-arrow', title: 'Mở / thu menu con' }, SUB.isOpen() ? '▾' : '▸');
      b.append(el('span', { style: 'flex:1' }), arrow);
      const subBox = el('div', { class: 'nav-sub', id: SUB.id, style: SUB.isOpen() ? '' : 'display:none' });
      const setOpen = (o) => { SUB.setOpen(o); arrow.textContent = o ? '▾' : '▸'; subBox.style.display = o ? '' : 'none'; navFoldSync(); };
      _navSubs.push({ isOpen: SUB.isOpen, setOpen });
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
  navFoldSync();
  // Lần đầu khởi tạo: Admin chọn kiểu chấm công + phạm vi
  if (isAdmin() && SETTINGS.setup_done !== '1' && !attOff()) { setupWizard(); return; }
  // /admin#hrcontract (bấm vào thông báo nhắc hợp đồng) → mở thẳng trang đó nếu có quyền; đọc xong thì xoá #
  // để lần bấm thông báo sau (cửa sổ đang mở) vẫn có sự kiện hashchange
  _navKeys = new Set(visible.map((v) => v[0]));
  const want = (location.hash || '').slice(1);
  if (want) history.replaceState(null, '', location.pathname + location.search);
  if (!window._hashNav) {
    window._hashNav = true;
    window.addEventListener('hashchange', () => {
      const k = (location.hash || '').slice(1);
      if (!k) return;
      history.replaceState(null, '', location.pathname + location.search);
      if (_navKeys.has(k)) go(k);
    });
  }
  if (want && _navKeys.has(want)) go(want);
  else if (visible.length) go(visible[0][0]);
  else setMain(el('div', { class: 'empty' }, 'Tài khoản của bạn chưa được cấp quyền dùng chức năng nào. Vui lòng liên hệ quản trị viên.'));
  checkUpdateBanner();   // báo khi có bản mới
}

// Cập nhật phần mềm có thanh %: máy chủ báo tiến độ tải / giải nén / sao lưu (/admin/update/status);
// tới bước khởi động lại thì máy chủ tắt → chờ /api/version ra bản mới rồi tải lại trang.
// onFail(thông báo lỗi) · onLatest() khi máy đã ở bản mới nhất · target = bản màn hình đang thấy. Trả Promise xong khi kết thúc.
async function runUpdateProgress(box, { onFail, onLatest, target: seen = '' }) {
  const bar = el('div', { style: 'height:100%;width:0%;border-radius:99px;background:linear-gradient(90deg,#16a34a,#4ade80);transition:width .5s' });
  const pctT = el('b', { style: 'font-variant-numeric:tabular-nums' }, '0%');
  const stepT = el('span', {}, 'Đang bắt đầu…');
  box.innerHTML = '';
  box.append(
    el('div', { style: 'display:flex;justify-content:space-between;gap:10px;font-size:13px;margin-bottom:5px' }, stepT, pctT),
    el('div', { style: 'height:12px;border-radius:99px;background:rgba(0,0,0,.08);overflow:hidden' }, bar),
    el('div', { style: 'font-size:12px;opacity:.75;margin-top:5px' }, 'Vui lòng đợi, ĐỪNG tắt máy. Dữ liệu giữ nguyên và đã tự sao lưu trước khi cập nhật.'));
  let p = 0;
  const set = (v, t) => { p = Math.max(p, Math.min(100, v)); bar.style.width = p + '%'; pctT.textContent = Math.floor(p) + '%'; if (t) stepT.textContent = t; };
  set(1);
  let r;
  try { r = await api('/admin/update/apply', { method: 'POST', body: { target: seen } }); } catch (e) { onFail(e.message); return; }
  if (r && r.ok === false) { onLatest(); return; }
  const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
  let misses = 0, restartAt = 0;
  for (;;) {
    await wait(700);
    if (!restartAt) {
      let s = null; try { s = await api('/admin/update/status'); } catch { /* máy chủ đang tắt để thay bản mới */ }
      if (s && s.state === 'error') { onFail(s.error || 'Cập nhật bị lỗi'); return; }
      if (s && s.state === 'run') { misses = 0; set(s.pct, s.step); continue; }
      if (!s && ++misses < 3) continue;
      restartAt = Date.now(); set(s && s.pct ? s.pct : 90, 'Đang cài bản mới & khởi động lại phần mềm…');
      continue;
    }
    try {
      const v = await fetch('/api/version', { cache: 'no-store' }).then((x) => x.json());
      // đã đổi bản (có thể mới hơn bản đã thấy nếu vừa phát hành thêm)
      if (v && v.version && v.version !== r.current) { set(100, `✓ Đã cập nhật lên bản ${v.version} — đang tải lại trang…`); await wait(1200); location.reload(); return; }
      // máy chủ CŨ vẫn chạy và tự báo không thay được bản mới (sau 2 phút) → báo lỗi để bấm lại, khỏi chờ mãi
      const s = await api('/admin/update/status');
      if (s && s.state === 'error') { onFail(s.error || 'Cập nhật bị lỗi'); return; }
    } catch { /* đang khởi động lại */ }
    set(p < 97 ? p + 0.7 : p + 0.05);   // nhích dần trong lúc chờ khởi động lại (thường 10–30 giây)
    if (Date.now() - restartAt > 180000) { stepT.textContent = 'Phần mềm khởi động lại lâu hơn bình thường — đợi thêm rồi tải lại trang (F5).'; return; }
  }
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
    goBtn.style.display = laterBtn.style.display = 'none';
    const box = el('div', { style: 'flex:1;min-width:260px;max-width:560px' });
    txt.replaceWith(box);
    await runUpdateProgress(box, {
      target: r.latest,
      onLatest: () => { box.replaceWith(txt); txt.textContent = '✓ Máy đã ở bản mới nhất. Hãy tải lại trang (F5).'; laterBtn.style.display = ''; laterBtn.textContent = 'Đóng'; },
      onFail: (msg) => { toast(msg, 'err'); box.replaceWith(txt); txt.textContent = '⚠️ Cập nhật chưa xong: ' + msg; goBtn.style.display = laterBtn.style.display = ''; goBtn.textContent = '⬆ Thử lại'; },
    });
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
  // nhóm chứa trang đang mở: tự xổ ra (không ghi nhớ) + tô nhẹ tiêu đề nhóm
  for (const g of _navGrp.values()) { const mine = g.has(key); g.head.classList.toggle('cur', mine); if (mine) g.open(true, false); }
  ({ dashboard: pageDashboard, employees: pageEmployees, org: () => pageOrg('dept'), positions: () => pageOrg('pos'), shifts: pageShifts, assignments: pageAssignments, shiftreq: pageShiftReq, devreq: pageDevReq, editatt: pageEditAtt, fixtime: pageFixTime, otreg: pageOtReg, swap: pageSwap, abnormal: pageAbnormal, devices: pageDevices, offices: pageOffices, leaves: pageLeaves, salary: pageSalary, report: pageReport, audit: pageAudit, auditlimits: pageAuditLimits, logs: pageLogs, settings: pageSettings,
    hrprofile: () => hrPage('pageHrProfiles'), hrcontract: () => hrPage('pageHrContracts'), hrdecision: () => hrPage('pageHrDecisions'), hrtemplates: () => hrPage('pageHrTemplates'),
    meal: () => mealPage('pageMealBoard'), mealreg: () => mealPage('pageMealReg'), mealrpt: () => mealPage('pageMealRpt'), mealrep: () => mealPage('pageMealReport'), mealmenu: () => mealPage('pageMealMenu'), mealinv: () => mealPage('pageMealInv'), mealcfg: () => mealPage('pageMealCfg'), mealme: () => mealPage('pageMealMe') }[key])();
}
// PHÂN HỆ QUẢN LÝ SUẤT ĂN (public/suatan/admin.js) — chỉ nạp khi mở menu Suất ăn (và chỉ có menu khi tài khoản tổng đã bật)
async function mealPage(fn) {
  setMain(loading());
  try { const m = await import('/suatan/admin.js'); m[fn]({ head, setMain, openModal, closeModal, loading, hasPerm, go }); }
  catch (e) { setMain(el('div', { class: 'empty' }, 'Không tải được phân hệ Suất ăn: ' + e.message)); }
}
// PHÂN HỆ NHÂN SỰ (public/hr.js) — chỉ nạp khi mở menu Nhân sự
async function hrPage(fn) {
  setMain(loading());
  try { const m = await import('/hr.js'); m[fn]({ head, setMain, openModal, closeModal, loading, hasPerm, go }); }
  catch (e) { setMain(el('div', { class: 'empty' }, 'Không tải được phân hệ Nhân sự: ' + e.message)); }
}

/* ---------- Lựa chọn phụ khi chấm "Theo giờ": đầu–cuối (FILO) / theo cặp vào–ra ----------
 * Chỉ hiện khi radio "Theo giờ" đang được chọn. Trả { box, value(), sync() }. */
// overnight: giá trị ô "Cho phép chấm qua đêm" ('1' = bật, mặc định tắt). anyHourly: công ty có NV đặt riêng kiểu theo giờ
// → vẫn hiện khung này dù kiểu chung là theo ca.
function hourlyRulePicker(name, current, hourlyRadio, radios, overnight = '0', anyHourly = false) {
  const rFilo = el('input', { type: 'radio', name, value: 'filo', style: 'width:auto', ...(current !== 'pairs' ? { checked: '' } : {}) });
  const rPairs = el('input', { type: 'radio', name, value: 'pairs', style: 'width:auto', ...(current === 'pairs' ? { checked: '' } : {}) });
  const nightChk = el('input', { type: 'checkbox', style: 'width:auto', ...(overnight === '1' ? { checked: '' } : {}) });
  const sub = (radio, title, desc) => el('label', { style: 'display:flex;gap:8px;align-items:flex-start;padding:8px 10px;border:1px solid var(--line,#eee);border-radius:10px;cursor:pointer;background:var(--surface,#fff)' },
    radio, el('div', {}, el('b', { style: 'font-size:14px' }, title), el('div', { style: 'font-size:12.5px;color:var(--muted)' }, desc)));
  const box = el('div', { style: 'display:flex;flex-direction:column;gap:6px;margin:-2px 0 0 28px' },
    el('div', { style: 'font-size:12.5px;color:var(--muted)' }, 'Khi một ngày chấm nhiều lần, tính giờ làm theo:'),
    sub(rFilo, 'Đầu – cuối (FILO)', 'Từ lần chấm đầu đến lần chấm cuối trong ngày.'),
    sub(rPairs, 'Theo cặp vào / ra', 'Chấm 1–2 là một cặp, 3–4 là cặp tiếp…; giờ làm = tổng các cặp, thời gian ra ngoài bị trừ.'),
    sub(nightChk, '🌙 Cho phép chấm qua đêm', 'Bỏ trống (mặc định): giờ làm chỉ tính trong ngày — quên chấm ra thì dòng đó để "thiếu ra", lượt chấm sáng hôm sau là giờ VÀO của hôm sau, không bị lấy làm giờ ra hôm trước. Tích khi có người làm vắt qua nửa đêm (VD 22:00 → 06:00): lượt chấm sáng hôm sau đóng phiên còn mở của hôm trước — ai quên chấm ra thì phải sửa giờ tay.'));
  const sync = () => { box.style.display = hourlyRadio.checked || anyHourly ? 'flex' : 'none'; };
  for (const r of radios) r.addEventListener('change', sync);
  sync();
  return { box, value: () => (rPairs.checked ? 'pairs' : 'filo'), overnight: () => nightChk.checked };
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
      await api('/admin/settings', { method: 'PUT', body: { attendance_mode, hourly_merge_rule, hourly_overnight: swRule.overnight(), geofence_enforce: geo.checked, setup_done: true } });
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
  modal.style.maxWidth = '';   // hộp thoại rộng (Nhân sự) tự đặt lại sau khi mở
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

