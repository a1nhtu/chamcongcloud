/* ---------- NHẬT KÝ THAO TÁC ---------- */
// Đổi JSON chi tiết nhật ký → chữ dễ đọc (tiếng Việt), thay vì đổ code thô
const LOG_SKIP = new Set(['merge_rule', 'shift_type', 'tdqd_mode', 'cross_midnight', 'work_days', 'ot_rounding_unit']);
const LOG_KEY_VI = {
  scope: 'Phạm vi', mode: 'Kiểu', from_date: 'Từ ngày', to_date: 'Đến ngày', from: 'Từ ngày', to: 'Đến ngày', date: 'Ngày', work_date: 'Ngày',
  start_time: 'Giờ vào', end_time: 'Giờ ra', late_grace_min: 'Cho phép muộn (phút)', early_grace_min: 'Cho phép sớm (phút)',
  break_minutes: 'Nghỉ giữa ca (phút)', work_unit_value: 'Số công', allow_ot: 'Tính tăng ca', ot_start_after_min: 'Ở lại tối thiểu (phút)',
  check_in_start: 'Bắt đầu vào', check_in_end: 'Kết thúc vào', check_out_start: 'Bắt đầu ra', check_out_end: 'Kết thúc ra',
  check_in: 'Giờ vào', check_out: 'Giờ ra', note: 'Ghi chú', cells: 'Ô sửa', ids: 'Các mục', value: 'Giá trị', employee_id: 'NV (ID)',
  departments: 'Phòng ban', include_children: 'Kèm cấp dưới', is_off: 'Nghỉ', skip_off: 'Bỏ qua ngày nghỉ', month: 'Tháng',
  inout_schedule_id: 'Lịch trình vào ra', weekend_days: 'Ngày cuối tuần', company_name: 'Tên công ty',
  name: 'Tên', address: 'Địa chỉ', lat: 'Vĩ độ', lng: 'Kinh độ', radius_m: 'Bán kính(m)',
  code: 'Mã', full_name: 'Họ tên', role: 'Vai trò', username: 'Tài khoản', permissions: 'Quyền',
  department: 'Bộ phận', position: 'Chức danh', phone: 'SĐT', device_pin: 'Số ID máy',
  employee_ids: 'NV (ID)', active: 'Kích hoạt', shift_id: 'Ca', work_schedule_id: 'Lịch trình',
  basic_salary: 'Lương cơ bản', allowance: 'Phụ cấp', name_new: 'Tên mới', parent_id: 'Thuộc bộ phận' };
const LOG_ROLE_VI = { admin: 'Admin', manager: 'Quản lý', employee: 'Nhân viên', master: 'Tài khoản tổng' };
function fmtLogDetail(raw) {
  if (raw == null || raw === '' || raw === '{}') return '(không có chi tiết)';
  let o; try { o = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch {
    // Không phải mã JSON (bản ghi mới đã là câu tiếng Việt) → giữ nguyên; JSON bị cắt dở (bản ghi cũ) → đọc từng cặp "khoá":giá trị
    const t = String(raw);
    if (!t.startsWith('{')) return t;
    o = {}; for (const mm of t.matchAll(/"(\w+)":(?:"((?:[^"\\]|\\.)*)"|(-?[\d.]+|true|false|null))/g)) if (mm[1] !== 'data') o[mm[1]] = mm[2] !== undefined ? mm[2] : mm[3];
    if (!Object.keys(o).length) return t;
  }
  const flat = {};
  const take = (obj) => { for (const [k, v] of Object.entries(obj || {})) { if (k === 'data' && v && typeof v === 'object') take(v); else flat[k] = v; } };
  take(o);
  const parts = [];
  for (const [k, v] of Object.entries(flat)) {
    if (k === 'id' || v == null || v === '' || LOG_SKIP.has(k)) continue;
    let val = v === true || v === 'true' ? 'Có' : v === false || v === 'false' ? 'Không' : v;
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

  const fromI = el('input', { type: 'date', value: addDays(todayVN(), -29), style: 'width:auto' });
  const toI = el('input', { type: 'date', value: todayVN(), style: 'width:auto' });
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

// 1 dòng công tắc gọn trong khung Tính năng máy chấm công: công tắc + tên + 1 dòng gợi ý ngắn (đầy đủ ở tooltip)
// chk.disabled = khoá (chỉ tài khoản tổng đổi được) → hiện 🔒. extra = phần phụ (VD ô cổng) chỉ hiện khi công tắc BẬT.
function devToggle(chk, title, hint, full, extra) {
  const locked = chk.disabled;
  const sub = extra ? el('div', { class: 'dfx-extra' }, extra) : null;
  if (sub) { const show = () => { sub.style.display = chk.checked ? '' : 'none'; }; chk.addEventListener('change', show); show(); }
  return el('div', { class: 'dfx-item' + (locked ? ' locked' : ''), title: full + (locked ? ' — 🔒 Chỉ tài khoản tổng (Digiplus) đổi được' : '') },
    el('label', { class: 'dfx-row' }, chk,
      el('div', { class: 'dfx-txt' }, el('b', {}, title, locked ? el('span', { class: 'dfx-lock' }, '🔒') : ''), el('span', { class: 'dfx-hint' }, hint))),
    sub);
}
const devGroup = (title, ...items) => el('div', { class: 'dfx-group' }, el('div', { class: 'dfx-gt' }, title), ...items);
