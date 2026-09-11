import {
  api, getToken, setToken, clearToken, toast, $, el,
  isoToHM, humanMinutes, humanDistance, nowClock, todayMonth, openCamera, getGps, ensureLicensed,
} from '/common.js';

let ME = null;
let currentTab = 'cham';
let MODE = 'shift';   // 'shift' | 'hourly' (chỉ tính giờ)
let SELF_SHIFT = false;   // cho nhân viên tự chọn ca
let SELF_APPROVE = true;  // chọn ca cần admin duyệt

/* ---------------- Khởi động ---------------- */
init();
async function init() {
  if (!(await ensureLicensed())) return; // chưa kích hoạt bản quyền → hiện màn kích hoạt
  // Thương hiệu
  try {
    const c = await api('/config');
    $('#brand-mark').textContent = c.company_name || 'Digiplus';
    MODE = c.attendance_mode || 'shift';
    SELF_SHIFT = c.self_shift_enabled === '1';
    SELF_APPROVE = c.self_shift_approve !== '0';
  } catch {}
  if (getToken()) {
    try { const r = await api('/auth/me'); ME = r.user; showApp(); return; } catch { clearToken(); }
  }
  showLogin();
}

function showLogin() {
  $('#login-view').classList.remove('hidden');
  $('#app-view').classList.add('hidden');
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#li-btn');
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
  try {
    const r = await api('/auth/login', { method: 'POST', body: { username: $('#li-user').value, password: $('#li-pass').value } });
    setToken(r.token); ME = r.user;
    if (ME.role === 'admin' || ME.role === 'manager') { location.href = '/admin'; return; }
    showApp();
  } catch (err) { toast(err.message, 'err'); }
  finally { btn.disabled = false; btn.textContent = 'Đăng nhập'; }
});

$('#btn-logout').addEventListener('click', () => { clearToken(); location.reload(); });

function showApp() {
  $('#login-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  $('#h-name').textContent = ME.full_name;
  $('#h-pos').textContent = [ME.position, ME.department].filter(Boolean).join(' · ') || 'Nhân viên';
  // Tab "Chọn ca" chỉ hiện khi bật tính năng + đang ở chế độ theo ca
  const navChonca = $('#nav-chonca');
  if (navChonca) navChonca.style.display = (SELF_SHIFT && MODE !== 'hourly') ? '' : 'none';
  tickClock(); setInterval(tickClock, 1000);
  renderTab('cham');
}
function tickClock() { const c = nowClock(); $('#h-clock').textContent = c.time; $('#h-date').textContent = c.date; }

document.querySelectorAll('.bottom-nav button').forEach((b) =>
  b.addEventListener('click', () => renderTab(b.dataset.tab)));

function renderTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.bottom-nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  const map = { cham: renderCham, chonca: renderChonca, baocao: renderBaocao, dontu: renderDontu, bangcong: renderBangcong };
  (map[tab] || renderCham)();
}

/* ---------------- Tab CHẤM CÔNG ---------------- */
async function renderCham() {
  const c = $('#content'); c.innerHTML = '<div class="empty"><span class="spin" style="border-color:#ddd;border-top-color:var(--brand)"></span></div>';
  let data;
  try { data = await api('/attendance/today'); } catch (e) { c.innerHTML = `<div class="empty">${e.message}</div>`; return; }
  const a = data.attendance;
  const hasIn = a && a.check_in_at;
  const hasOut = a && a.check_out_at;

  c.innerHTML = '';
  // 2 ô Vào/Ra
  const grid = el('div', { class: 'io-grid' },
    el('div', { class: 'io-cell' }, el('div', { class: 'lbl' }, 'VÀO CA'), el('div', { class: 'val' }, hasIn ? isoToHM(a.check_in_at) : '--:--')),
    el('div', { class: 'io-cell' }, el('div', { class: 'lbl' }, 'RA CA'), el('div', { class: 'val' }, hasOut ? isoToHM(a.check_out_at) : '--:--')),
  );
  c.append(grid);

  // Cảnh báo khoá thiết bị (chống chấm hộ)
  if (data.device && data.device.lock && data.device.state !== 'ok') {
    if (data.device.state === 'pending') {
      c.append(el('div', { class: 'status-banner', style: 'background:#fef3c7;color:#92400e', html: '📱 Đã gửi yêu cầu dùng điện thoại này — <b>đang chờ admin duyệt</b>. Duyệt xong bạn mới chấm công được trên máy này.' }));
    } else {
      const b = el('div', { class: 'status-banner', style: 'background:#fee2e2;color:#991b1b', html: '📱 Tài khoản của bạn đã gắn với <b>một điện thoại khác</b>. Không thể chấm công trên máy này để tránh chấm hộ.' });
      const reqBtn = el('button', { class: 'btn sm', style: 'margin-top:8px' }, 'Gửi yêu cầu dùng điện thoại này');
      reqBtn.onclick = async () => {
        try { await api('/attendance/request-device', { method: 'POST', body: {} }); toast('Đã gửi yêu cầu. Chờ admin duyệt.', 'ok'); renderCham(); }
        catch (e) { toast(e.message, 'err'); }
      };
      c.append(el('div', {}, b, reqBtn));
    }
  }

  // Chế độ theo giờ: báo rõ, không hiển thị ca
  if (MODE === 'hourly') {
    c.append(el('div', { class: 'status-banner', style: 'background:#eef2ff;color:#3730a3', html: '⏱️ Chấm công <b>theo giờ</b> — hệ thống tính tổng giờ làm của bạn' }));
  }
  // Ca hôm nay
  if (MODE !== 'hourly' && data.dayOff) {
    c.append(el('div', { class: 'status-banner done', html: '📅 Hôm nay là <b>ngày nghỉ</b> theo lịch phân ca' }));
  } else if (data.todayShift) {
    const s = data.todayShift;
    c.append(el('div', { class: 'status-banner', style: 'background:#eef2ff;color:#3730a3', html: `📅 Ca hôm nay: <b>${s.name}</b> (${s.start_time}–${s.end_time})` }));
  } else if (data.autoDetect) {
    c.append(el('div', { class: 'status-banner', style: 'background:#eef2ff;color:#3730a3', html: '⚙ Ca hôm nay: <b>tự động</b> — hệ thống xác định theo giờ Anh/Chị chấm vào' }));
  }

  // Banner trạng thái
  if (hasIn) {
    const bits = [`Đã vào ca lúc <b>${isoToHM(a.check_in_at)}</b>`];
    if (a.check_in_outside) bits.push(`Ngoài văn phòng (cách ~${humanDistance(a.check_in_distance_m)})`);
    else if (a.check_in_distance_m != null) bits.push(`Trong văn phòng (cách ${a.check_in_distance_m} m)`);
    if (a.late_min > 0) bits.push(`⏰ Muộn ${a.late_min} phút`);
    if (hasOut) bits.push(`Đã ra ca lúc <b>${isoToHM(a.check_out_at)}</b> · Tổng ${humanMinutes(a.work_minutes)}`);
    c.append(el('div', { class: 'status-banner' + (hasOut ? ' done' : ''), html: bits.join(' · ') }));
  }

  // Nút lớn
  const card = el('div', { class: 'card' });
  if (!hasIn) card.append(makeBigBtn('in', '📸', 'VÀO CA', 'Chụp ảnh xác nhận có mặt', () => doCheck('in')));
  else if (!hasOut) card.append(makeBigBtn('out', '🏁', 'RA CA', 'Chụp ảnh xác nhận kết thúc ca', () => doCheck('out')));
  else card.append(el('div', { class: 'big-btn done' }, el('div', { class: 'ic' }, '✔'), el('div', { class: 't' }, 'HOÀN TẤT'), el('div', { class: 's' }, 'Bạn đã chấm công đủ hôm nay')));

  card.append(el('div', { class: 'gps-line', id: 'gps-line' }, 'Vị trí văn phòng: ', el('b', {}, ME.office?.name || 'Chưa gán')));
  if (data.geofence?.enforce && data.geofence.radius_m != null)
    card.append(el('div', { class: 'gps-line', style: 'color:#9a3412' }, `🎯 Chỉ chấm được khi ở trong bán kính ${data.geofence.radius_m}m quanh văn phòng`));
  c.append(card);
}

function makeBigBtn(kind, ic, t, s, onClick) {
  const b = el('button', { class: 'big-btn ' + kind },
    el('div', { class: 'ic' }, ic), el('div', { class: 't' }, t), el('div', { class: 's' }, s));
  b.addEventListener('click', onClick);
  return b;
}

async function doCheck(kind) {
  const btn = $('.big-btn.' + kind);
  const gpsLine = $('#gps-line');
  try {
    if (btn) { btn.style.opacity = .6; btn.style.pointerEvents = 'none'; }
    if (gpsLine) gpsLine.innerHTML = '<span class="spin" style="border-color:#ddd;border-top-color:var(--brand)"></span> Đang lấy vị trí GPS…';
    const gps = await getGps();
    if (gpsLine) gpsLine.innerHTML = `📍 Đã xác định vị trí · sai số ~${gps.accuracy}m`;
    // Đóng dấu chống gian lận: giờ thật + tên NV + toạ độ GPS lên ảnh
    const stampTime = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    const stamp = [ME?.full_name || 'Nhân viên', stampTime, `GPS ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`];
    const photo = await openCamera({ title: kind === 'in' ? 'Chụp ảnh vào ca' : 'Chụp ảnh ra ca', stamp });
    if (!photo) { if (btn) { btn.style.opacity = 1; btn.style.pointerEvents = 'auto'; } return; }
    const res = await api('/attendance/' + (kind === 'in' ? 'check-in' : 'check-out'),
      { method: 'POST', body: { lat: gps.lat, lng: gps.lng, accuracy: gps.accuracy, photo } });
    if (kind === 'in') {
      const m = res.meta;
      toast(`Vào ca thành công${m.late ? ' · muộn ' + m.late + ' phút' : ''}${m.outside ? ' · ngoài VP' : ''}`, 'ok');
    } else toast(`Ra ca thành công · ${humanMinutes(res.meta.workMinutes)}`, 'ok');
    renderCham();
  } catch (e) {
    if (btn) { btn.style.opacity = 1; btn.style.pointerEvents = 'auto'; }
    // Chặn vì đang dùng điện thoại lạ → mời gửi yêu cầu đổi thiết bị
    if (e.code === 'DEVICE_MISMATCH') {
      if (confirm(e.message + '\n\nGửi yêu cầu dùng ĐIỆN THOẠI NÀY để admin duyệt?')) {
        try { await api('/attendance/request-device', { method: 'POST', body: {} }); toast('Đã gửi yêu cầu. Chờ admin duyệt rồi chấm công lại nhé.', 'ok'); renderCham(); }
        catch (err) { toast(err.message, 'err'); }
      }
      return;
    }
    toast(e.message, 'err');
  }
}

/* ---------------- Tab CHỌN CA ---------------- */
async function renderChonca() {
  const c = $('#content'); c.innerHTML = '<div class="empty"><span class="spin" style="border-color:#ddd;border-top-color:var(--brand)"></span></div>';
  let info;
  try { info = await api('/shift-requests/shifts'); }
  catch (e) { c.innerHTML = `<div class="empty">${e.message}</div>`; return; }
  if (!info.enabled) { c.innerHTML = '<div class="empty">Tính năng tự chọn ca đang tắt.</div>'; return; }
  c.innerHTML = '';

  const approve = info.needApprove;
  c.append(el('div', { class: 'status-banner', style: 'background:#eef2ff;color:#3730a3',
    html: approve
      ? '🗓️ Bạn đăng ký ca cho ngày làm việc, <b>quản lý duyệt</b> rồi mới áp dụng.'
      : '🗓️ Bạn đăng ký ca cho ngày làm việc, hệ thống <b>tự áp dụng ngay</b> (không cần duyệt).' }));

  // Form đăng ký
  const shiftSel = el('select', { id: 'sc-shift' });
  for (const s of info.shifts) shiftSel.append(el('option', { value: String(s.id) }, `${s.name} (${s.start_time}–${s.end_time})`));
  shiftSel.append(el('option', { value: 'off' }, '🛌 Xin nghỉ ngày này'));
  const form = el('div', { class: 'card' });
  form.append(
    el('div', { class: 'sec-title', style: 'margin-top:0' }, 'Đăng ký ca'),
    el('div', { class: 'form-grid' },
      el('div', {}, el('label', {}, 'Ngày làm việc'), el('input', { id: 'sc-date', type: 'date' })),
      el('div', {}, el('label', {}, 'Ca đăng ký'), shiftSel),
    ),
  );
  if (!info.shifts.length) form.querySelector('.form-grid').before(el('div', { class: 'status-banner', style: 'background:#fef3c7;color:#92400e', html: 'Chưa có ca nào được khai báo. Bạn vẫn có thể xin nghỉ.' }));
  const submit = el('button', { class: 'btn block', style: 'margin-top:12px' }, 'Gửi đăng ký');
  submit.addEventListener('click', submitShiftReq);
  form.append(submit);
  c.append(form);
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('sv', { timeZone: 'Asia/Ho_Chi_Minh' });
  form.querySelector('#sc-date').value = tomorrow;

  c.append(el('div', { class: 'sec-title' }, 'Ca đã đăng ký'));
  c.append(el('div', { id: 'sc-list' }, el('div', { class: 'empty' }, 'Đang tải…')));
  loadMyShiftReq();
}

async function submitShiftReq() {
  const date = $('#sc-date').value;
  const val = $('#sc-shift').value;
  if (!date) return toast('Chọn ngày', 'err');
  const body = val === 'off' ? { work_date: date, is_off: true } : { work_date: date, shift_id: +val };
  try {
    const r = await api('/shift-requests', { method: 'POST', body });
    toast(r.auto ? 'Đã đăng ký & áp dụng' : 'Đã gửi, chờ duyệt', 'ok');
    loadMyShiftReq();
  } catch (e) { toast(e.message, 'err'); }
}

async function loadMyShiftReq() {
  const list = $('#sc-list'); if (!list) return;
  try {
    const { rows } = await api('/shift-requests/mine');
    if (!rows.length) { list.innerHTML = '<div class="empty">Chưa có đăng ký nào.</div>'; return; }
    list.innerHTML = '';
    for (const r of rows) {
      const status = { pending: ['warn', 'Chờ duyệt'], approved: ['ok', 'Đã duyệt'], rejected: ['bad', 'Từ chối'] }[r.status];
      const caText = r.is_off ? '🛌 Xin nghỉ' : `${r.shift_name || 'Ca'}${r.start_time ? ` (${r.start_time}–${r.end_time})` : ''}`;
      const item = el('div', { class: 'leave-item' },
        el('div', { class: 'top' }, el('b', {}, fmtD(r.work_date)), el('span', { class: 'pill ' + status[0] }, status[1])),
        el('div', { class: 'meta' }, caText),
      );
      if (r.status === 'pending') {
        const del = el('button', { class: 'btn ghost sm', style: 'margin-top:8px' }, 'Huỷ đăng ký');
        del.addEventListener('click', async () => { try { await api('/shift-requests/' + r.id, { method: 'DELETE' }); loadMyShiftReq(); } catch (e) { toast(e.message, 'err'); } });
        item.append(del);
      }
      if (r.review_note) item.append(el('div', { class: 'meta' }, 'Ghi chú: ' + r.review_note));
      list.append(item);
    }
  } catch (e) { list.innerHTML = `<div class="empty">${e.message}</div>`; }
}

/* ---------------- Tab BÁO CÁO ---------------- */
async function renderBaocao() {
  const c = $('#content'); c.innerHTML = '';
  let sum, mine;
  try { [sum, mine] = await Promise.all([api('/attendance/summary'), api('/attendance/mine')]); }
  catch (e) { c.innerHTML = `<div class="empty">${e.message}</div>`; return; }

  if (MODE === 'hourly') {
    c.append(el('div', { class: 'stat-row' },
      stat(humanMinutes(sum.totalMinutes), 'TỔNG GIỜ'),
      stat(sum.days, 'NGÀY CHẤM'),
    ));
  } else {
    c.append(el('div', { class: 'stat-row' },
      stat(sum.totalWorkUnit ?? 0, 'SỐ CÔNG'),
      stat(humanMinutes(sum.totalMinutes), 'TỔNG GIỜ'),
      stat(sum.lateCount, 'ĐI MUỘN'),
    ));
    if (sum.otMinutes > 0 || sum.earlyCount > 0)
      c.append(el('div', { class: 'stat-row', style: 'margin-top:10px' },
        stat(humanMinutes(sum.otMinutes), 'TĂNG CA'),
        stat(sum.earlyCount, 'VỀ SỚM'),
        stat(sum.days, 'NGÀY CHẤM'),
      ));
  }
  c.append(el('div', { class: 'sec-title' }, 'Công tháng này'));
  c.append(monthTable(mine.rows));
}
function stat(n, l) { return el('div', { class: 'stat' }, el('div', { class: 'n' }, String(n)), el('div', { class: 'l' }, l)); }

function monthTable(rows) {
  if (!rows.length) return el('div', { class: 'card' }, el('div', { class: 'empty' }, 'Chưa có dữ liệu chấm công.'));
  const t = el('table', { class: 'tbl' });
  t.innerHTML = '<thead><tr><th>Ngày</th><th>Vào</th><th>Ra</th><th>Giờ</th><th>Công</th><th>Muộn</th></tr></thead>';
  const tb = el('tbody');
  for (const r of rows) {
    tb.append(el('tr', {},
      el('td', {}, r.work_date.slice(8) + '/' + r.work_date.slice(5, 7)),
      el('td', {}, isoToHM(r.check_in_at)),
      el('td', {}, r.check_out_at ? isoToHM(r.check_out_at) : el('span', { class: 'pill bad' }, 'chưa ra')),
      el('td', {}, humanMinutes(r.work_minutes)),
      el('td', {}, el('b', {}, String(r.work_unit ?? 0))),
      el('td', {}, r.late_min > 0 ? el('span', { class: 'pill warn' }, r.late_min + 'p') : '—'),
    ));
  }
  t.append(tb);
  return el('div', { class: 'card', style: 'overflow-x:auto' }, t);
}

/* ---------------- Tab ĐƠN TỪ ---------------- */
async function renderDontu() {
  const c = $('#content'); c.innerHTML = '';
  const form = el('div', { class: 'card' });
  form.innerHTML = `
    <div class="sec-title" style="margin-top:0">Gửi đơn</div>
    <div class="form-grid">
      <div><label>Loại đơn</label>
        <select id="lv-type">
          <option>Nghỉ phép</option><option>Nghỉ không lương</option>
          <option>Công tác</option><option>Khác</option>
        </select></div>
      <div style="display:flex;gap:10px">
        <div style="flex:1"><label>Từ ngày</label><input id="lv-from" type="date" /></div>
        <div style="flex:1"><label>Đến ngày</label><input id="lv-to" type="date" /></div>
      </div>
      <div><label>Lý do</label><textarea id="lv-reason" rows="2" placeholder="Ghi rõ lý do để quản lý duyệt nhanh"></textarea></div>
      <button class="btn block" id="lv-submit">Gửi đơn</button>
    </div>`;
  c.append(form);
  const today = new Date().toISOString().slice(0, 10);
  form.querySelector('#lv-from').value = today; form.querySelector('#lv-to').value = today;
  form.querySelector('#lv-submit').addEventListener('click', submitLeave);

  c.append(el('div', { class: 'sec-title' }, 'Đơn của tôi'));
  const list = el('div', { id: 'leave-list' }, el('div', { class: 'empty' }, 'Đang tải…'));
  c.append(list);
  loadMyLeaves();
}

async function submitLeave() {
  const body = {
    type: $('#lv-type').value, from_date: $('#lv-from').value,
    to_date: $('#lv-to').value, reason: $('#lv-reason').value,
  };
  if (!body.from_date || !body.to_date) return toast('Chọn ngày', 'err');
  try { await api('/leaves', { method: 'POST', body }); toast('Đã gửi đơn', 'ok'); $('#lv-reason').value = ''; loadMyLeaves(); }
  catch (e) { toast(e.message, 'err'); }
}

async function loadMyLeaves() {
  const list = $('#leave-list'); if (!list) return;
  try {
    const { rows } = await api('/leaves/mine');
    if (!rows.length) { list.innerHTML = '<div class="empty">Chưa có đơn nào.</div>'; return; }
    list.innerHTML = '';
    for (const r of rows) {
      const status = { pending: ['warn', 'Chờ duyệt'], approved: ['ok', 'Đã duyệt'], rejected: ['bad', 'Từ chối'] }[r.status];
      const item = el('div', { class: 'leave-item' },
        el('div', { class: 'top' },
          el('b', {}, r.type),
          el('span', { class: 'pill ' + status[0] }, status[1])),
        el('div', { class: 'meta' }, `${fmtD(r.from_date)} → ${fmtD(r.to_date)}${r.reason ? ' · ' + r.reason : ''}`),
      );
      if (r.status === 'pending') {
        const del = el('button', { class: 'btn ghost sm', style: 'margin-top:8px' }, 'Xoá đơn');
        del.addEventListener('click', async () => { await api('/leaves/' + r.id, { method: 'DELETE' }); loadMyLeaves(); });
        item.append(del);
      }
      if (r.review_note) item.append(el('div', { class: 'meta' }, 'Ghi chú: ' + r.review_note));
      list.append(item);
    }
  } catch (e) { list.innerHTML = `<div class="empty">${e.message}</div>`; }
}
const fmtD = (d) => d.slice(8) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4);

/* ---------------- Tab BẢNG CÔNG ---------------- */
const CAL_ST = {
  du_cong:   { bg: '#dcfce7', fg: '#166534', ic: '✓', label: 'Đủ công' },
  muon_som:  { bg: '#fff4d6', fg: '#8a6d00', ic: '⏰', label: 'Muộn/Sớm' },
  thieu_ra:  { bg: '#ffe4cc', fg: '#9a3412', ic: '⚠', label: 'Thiếu ra' },
  vang:      { bg: '#fee2e2', fg: '#991b1b', ic: '✕', label: 'Vắng' },
  nghi:      { bg: '#e2e8f0', fg: '#475569', ic: '🛌', label: 'Nghỉ' },
  le:        { bg: '#ede9fe', fg: '#6d28d9', ic: '🎉', label: 'Lễ' },
  phep:      { bg: '#dbeafe', fg: '#1d4ed8', ic: 'P', label: 'Phép' },
  chua_toi:  { bg: '#f8fafc', fg: '#cbd5e1', ic: '', label: 'Chưa tới' },
  ngoai_lich:{ bg: '#fbfbfb', fg: '#cbd5e1', ic: '', label: 'Ngoài lịch' },
};
const WDH = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

async function renderBangcong() {
  const c = $('#content'); c.innerHTML = '';
  const bar = el('div', { class: 'card', style: 'display:flex;align-items:center;gap:10px' },
    el('label', { style: 'margin:0' }, 'Tháng'),
    el('input', { type: 'month', id: 'bc-month', value: todayMonth(), style: 'flex:1' }));
  c.append(bar);
  const wrap = el('div', { id: 'bc-wrap' });
  c.append(wrap);
  const load = async () => {
    wrap.innerHTML = '<div class="empty">Đang tải…</div>';
    let data;
    try { data = await api('/attendance/calendar?month=' + $('#bc-month').value); }
    catch (e) { wrap.innerHTML = `<div class="empty">${e.message}</div>`; return; }
    wrap.innerHTML = '';

    // Lưới lịch
    const grid = el('div', { style: 'display:grid;grid-template-columns:repeat(7,1fr);gap:4px' });
    for (const w of WDH) grid.append(el('div', { style: 'text-align:center;font-size:11px;font-weight:700;color:var(--muted);padding:2px 0' }, w));
    const lead = (data.days[0]?.wd || 1) - 1;
    for (let i = 0; i < lead; i++) grid.append(el('div', {}));
    for (const d of data.days) {
      const st = CAL_ST[d.status] || CAL_ST.ngoai_lich;
      const cell = el('div', {
        style: `background:${st.bg};color:${st.fg};border-radius:9px;padding:5px 2px;text-align:center;cursor:pointer;min-height:44px;border:1px solid ${d.date === (new Date().toLocaleDateString('sv',{timeZone:'Asia/Ho_Chi_Minh'})) ? 'var(--brand)' : 'transparent'}`,
      }, el('div', { style: 'font-size:13px;font-weight:700' }, String(d.day)),
         el('div', { style: 'font-size:14px;line-height:1.1' }, st.ic || ''));
      cell.addEventListener('click', () => showDay(d, detail));
      grid.append(cell);
    }
    wrap.append(el('div', { class: 'card' }, grid));

    // Chú thích
    const legend = el('div', { class: 'card', style: 'display:flex;flex-wrap:wrap;gap:8px' });
    for (const k of ['du_cong', 'muon_som', 'thieu_ra', 'vang', 'nghi', 'le', 'phep']) {
      const s = CAL_ST[k];
      legend.append(el('span', { style: 'display:inline-flex;align-items:center;gap:5px;font-size:12px' },
        el('span', { style: `width:16px;height:16px;border-radius:5px;background:${s.bg};color:${s.fg};display:inline-flex;align-items:center;justify-content:center;font-size:11px` }, s.ic),
        s.label));
    }
    wrap.append(legend);

    const detail = el('div', { class: 'card', style: 'display:none' });
    wrap.append(detail);
  };
  bar.querySelector('#bc-month').addEventListener('change', load);
  load();
}

function showDay(d, detailEl) {
  const st = CAL_ST[d.status] || CAL_ST.ngoai_lich;
  detailEl.style.display = 'block';
  detailEl.innerHTML = '';
  detailEl.append(
    el('div', { style: 'font-weight:800;margin-bottom:6px' }, `Ngày ${String(d.day).padStart(2, '0')} · ${WDH[d.wd - 1]}`,
      el('span', { class: 'pill', style: `margin-left:8px;background:${st.bg};color:${st.fg}` }, st.label)),
    el('table', { class: 'tbl' }, el('tbody', {},
      row2('Giờ vào', d.check_in ? isoToHM(d.check_in) : '—'),
      row2('Giờ ra', d.check_out ? isoToHM(d.check_out) : '—'),
      row2('Số giờ', humanMinutes(d.work_minutes)),
      row2('Số công', String(d.work_unit || 0)),
      row2('Đi muộn', d.late_min > 0 ? d.late_min + ' phút' : '—'),
      row2('Về sớm', d.early_min > 0 ? d.early_min + ' phút' : '—'),
      row2('Tăng ca', d.ot_min > 0 ? d.ot_min + ' phút' : '—'),
    )));
}
function row2(k, v) { return el('tr', {}, el('td', { style: 'color:var(--muted)' }, k), el('td', { style: 'text-align:right;font-weight:600' }, v)); }

/* PWA service worker */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
