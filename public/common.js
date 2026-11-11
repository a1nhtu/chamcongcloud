// Tiện ích dùng chung cho cả app nhân viên và admin
export const TK = 'digiplus_token';
const DEV = 'digiplus_device_id';

// "Tự động đăng nhập" (ô tích ở màn đăng nhập trang quản lý — Anh 29/10/2026: nhân viên mở máy tính văn phòng là vào thẳng phần mềm):
// tích = nhớ phiên như cũ (localStorage); bỏ tích = phiên chỉ sống khi cửa sổ còn mở (sessionStorage) + nhịp "còn mở" mỗi 20 giây —
// trình duyệt khôi phục tab cũ sau khi tắt máy (Chrome "tiếp tục nơi đã dừng") mà nhịp đã ngừng quá 2 phút thì vẫn phải đăng nhập lại.
// Tab mới (Ctrl/chuột giữa mở menu) không được chép sessionStorage → hỏi tab đang mở qua BroadcastChannel (cùng trang mới nghe được).
const REM = 'digiplus_remember', ALIVE = 'digiplus_alive';
const SS = (() => { try { return sessionStorage; } catch { return null; } })();
const beat = () => { if (SS?.getItem(TK)) localStorage.setItem(ALIVE, String(Date.now())); };
if (SS?.getItem(TK) && Date.now() - (+localStorage.getItem(ALIVE) || 0) > 120000) SS.removeItem(TK);
setInterval(beat, 20000);
const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('digiplus_auth') : null;
if (bc) bc.addEventListener('message', (e) => { if (e.data === 'ask' && SS?.getItem(TK)) bc.postMessage({ token: SS.getItem(TK) }); });
export const rememberLogin = () => localStorage.getItem(REM) !== '0';
export function getToken() { return SS?.getItem(TK) || localStorage.getItem(TK); }
export function setToken(t, remember) {   // remember bỏ trống (app nhân viên) = nhớ phiên, không đổi lựa chọn của trang quản lý
  if (remember !== undefined) localStorage.setItem(REM, remember ? '1' : '0');
  if (remember !== false || !SS) { localStorage.setItem(TK, t); SS?.removeItem(TK); return; }
  SS.setItem(TK, t); localStorage.removeItem(TK); beat();
}
export function clearToken() { localStorage.removeItem(TK); SS?.removeItem(TK); }
// Chưa có phiên + đang chế độ không tự đăng nhập → xin phiên từ tab khác đang mở (chờ tối đa ~0,4 giây)
export function tokenFromOtherTab(ms = 400) {
  return new Promise((ok) => {
    if (!bc || !SS || getToken() || rememberLogin()) return ok();
    const done = () => { clearTimeout(t); bc.removeEventListener('message', h); ok(); };
    const h = (e) => { if (e.data && e.data.token) { SS.setItem(TK, e.data.token); beat(); done(); } };
    const t = setTimeout(done, ms);
    bc.addEventListener('message', h);
    bc.postMessage('ask');
  });
}

// Mã định danh thiết bị (ổn định trên 1 điện thoại) — dùng để khoá thiết bị chấm công.
export function deviceId() {
  let d = localStorage.getItem(DEV);
  if (!d) {
    d = (self.crypto && crypto.randomUUID) ? crypto.randomUUID()
      : 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(DEV, d);
  }
  return d;
}

export async function api(path, { method = 'GET', body, raw = false } = {}) {
  const headers = { 'X-Device-Id': deviceId() };
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch('/api' + path, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  // 401 khi ĐÃ đăng nhập = hết phiên → xoá token + tải lại. Nhưng 401 lúc ĐANG đăng nhập
  // (/auth/login) = sai tài khoản/mật khẩu → để rơi xuống dưới báo lỗi cho người dùng thấy.
  if (res.status === 401 && !path.startsWith('/auth/login')) { clearToken(); location.reload(); throw new Error('Hết phiên'); }
  if (raw) return res;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Có lỗi xảy ra'); e.code = data.code; e.status = res.status; e.data = data; throw e; }
  return data;
}

let toastEl;
export function toast(msg, type = '') {
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.id = 'toast'; document.body.appendChild(toastEl); }
  toastEl.className = 'show ' + type;
  toastEl.textContent = msg;
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => (toastEl.className = type), 2600);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v != null) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(kid));
  if (tag === 'input') viDate(n);
  return n;
}

/* ---------- Ô chọn NGÀY / THÁNG tiếng Việt trên MỌI máy (Anh 11/11/2026) ----------
 * Ô gốc <input type="date|month"> hiện theo ngôn ngữ của Chrome: máy khách Chrome tiếng Anh ra "November 2026", lịch "Su Mo Tu…".
 * viDate() đổi ô đó thành ô chữ hiện "01/11/2026" / "Tháng 11/2026" + lịch riêng (T2 … CN, Tháng 1 … 12) — KHÔNG đổi cách code dùng:
 * .value vẫn đọc / ghi "YYYY-MM-DD" / "YYYY-MM", chọn xong vẫn phát sự kiện input + change, thuộc tính min / max vẫn dùng được.
 * Gõ tay được: 1/11/2026, 01-11-2026, 11/2026 … (rời ô hoặc Enter thì nhận). Ô tạo bằng HTML (innerHTML) cũng tự đổi (MutationObserver). */
const VI_NATIVE = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
const VD_ICON = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23667085' stroke-width='2'%3E%3Crect x='3' y='5' width='18' height='16' rx='2'/%3E%3Cpath d='M3 10h18M8 3v4M16 3v4'/%3E%3C/svg%3E\")";
const pad2 = (x) => String(x).padStart(2, '0');
const vdNorm = (kind, v) => {
  v = String(v ?? '').trim();
  if (kind === 'month') return /^\d{4}-\d{2}$/.test(v) ? v : /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.slice(0, 7) : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
};
const vdShow = (kind, iso) => (!iso ? '' : kind === 'month' ? `Tháng ${+iso.slice(5, 7)}/${iso.slice(0, 4)}` : `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`);
const vdValid = (y, m, d) => m >= 1 && m <= 12 && (d == null || (d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate()));
function vdParse(kind, txt) {   // chữ gõ tay → ISO ('' = bỏ trống, null = không hiểu)
  const t = String(txt || '').trim().replace(/^tháng\s*/i, '');
  if (!t) return '';
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(t)) return vdNorm(kind, t) || null;
  const p = t.split(/[^\d]+/).filter(Boolean).map(Number);
  if (kind === 'month') {
    const [m, y] = p.length >= 3 ? [p[1], p[2]] : p;
    return p.length >= 2 && y > 999 && vdValid(y, m) ? `${y}-${pad2(m)}` : null;
  }
  if (p.length < 2) return null;
  const y = p[2] ? (p[2] < 100 ? 2000 + p[2] : p[2]) : +todayMonth().slice(0, 4);
  return vdValid(y, p[1], p[0]) ? `${y}-${pad2(p[1])}-${pad2(p[0])}` : null;
}
export function viDate(inp) {
  if (!inp || inp._viKind || !(inp instanceof HTMLInputElement)) return inp;
  const kind = (inp.getAttribute('type') || '').toLowerCase();
  if (kind !== 'date' && kind !== 'month') return inp;
  let iso = vdNorm(kind, VI_NATIVE.get.call(inp) || inp.getAttribute('value'));
  inp._viKind = kind;
  inp.type = 'text';
  inp.classList.add('vi-date');
  inp.autocomplete = 'off';
  if (!inp.getAttribute('size')) inp.size = kind === 'month' ? 13 : 10;
  if (matchMedia('(pointer: coarse)').matches) inp.inputMode = 'none';   // điện thoại: bấm là mở lịch, không bật bàn phím
  if (!inp.placeholder) inp.placeholder = kind === 'month' ? 'Tháng ../....' : 'dd/mm/yyyy';
  Object.assign(inp.style, { backgroundImage: VD_ICON, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 9px center', paddingRight: '30px', cursor: 'pointer' });
  Object.defineProperty(inp, 'value', {
    configurable: true,
    get: () => iso,
    set: (v) => { iso = vdNorm(kind, v); VI_NATIVE.set.call(inp, vdShow(kind, iso)); },
  });
  VI_NATIVE.set.call(inp, vdShow(kind, iso));
  // gõ tay: đổi chữ → ISO TRƯỚC mọi bộ nghe 'change' khác (pha capture chạy trước)
  const take = () => {
    const txt = VI_NATIVE.get.call(inp);
    if (txt === vdShow(kind, iso)) return;
    const v = vdParse(kind, txt);
    if (v === null) { VI_NATIVE.set.call(inp, vdShow(kind, iso)); return; }
    inp.value = v;
  };
  inp.addEventListener('change', take, true);
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { take(); vdClose(); }
    else if (e.key === 'Escape') vdClose();
    else if (e.key === 'ArrowDown' && e.altKey) vdOpen(inp);
  });
  inp.addEventListener('click', () => { if (!inp.disabled && !inp.readOnly) vdOpen(inp); });
  return inp;
}

let vdBox = null, vdFor = null;
function vdClose() { if (vdBox) { vdBox.remove(); vdBox = null; vdFor = null; } }
function vdPick(inp, v) {
  inp.value = v;
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  vdClose();
}
function vdOpen(inp) {
  if (vdFor === inp) return;
  vdClose();
  const kind = inp._viKind;
  const today = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Ho_Chi_Minh' });
  const min = vdNorm(kind, inp.getAttribute('min')), max = vdNorm(kind, inp.getAttribute('max'));
  const off = (v) => (min && v < min) || (max && v > max);
  const cur = inp.value || (kind === 'month' ? today.slice(0, 7) : today);
  let y = +cur.slice(0, 4), m = +cur.slice(5, 7);   // tháng / năm đang xem
  let view = kind === 'month' ? 'months' : 'days';
  const box = vdBox = el('div', { class: 'vd-pop' });
  vdFor = inp;
  box.addEventListener('mousedown', (e) => e.preventDefault());   // bấm trong lịch không làm ô mất focus
  const btn = (txt, cls, fn, dis) => {
    const b = el('button', { type: 'button', class: cls }, txt);
    if (dis) b.disabled = true; else b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    return b;
  };
  const draw = () => {
    box.innerHTML = '';
    const head = el('div', { class: 'vd-head' });
    if (view === 'days') {
      head.append(btn('‹', 'vd-nav', () => { if (--m < 1) { m = 12; y--; } draw(); }),
        btn(`Tháng ${m} / ${y}`, 'vd-title', () => { view = 'months'; draw(); }),
        btn('›', 'vd-nav', () => { if (++m > 12) { m = 1; y++; } draw(); }));
      const grid = el('div', { class: 'vd-grid' });
      for (const w of ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']) grid.append(el('div', { class: 'vd-wd' + (w === 'CN' ? ' vd-cn' : '') }, w));
      const first = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;   // thứ 2 đứng đầu tuần
      const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
      for (let i = 0; i < first; i++) grid.append(el('div'));
      for (let d = 1; d <= n; d++) {
        const v = `${y}-${pad2(m)}-${pad2(d)}`;
        const wd = (first + d - 1) % 7;
        grid.append(btn(String(d), 'vd-d' + (v === inp.value ? ' vd-sel' : '') + (v === today ? ' vd-today' : '') + (wd === 6 ? ' vd-cn' : wd === 5 ? ' vd-t7' : ''), () => vdPick(inp, v), off(v)));
      }
      box.append(head, grid, el('div', { class: 'vd-foot' },
        btn('Hôm nay', 'vd-link', () => vdPick(inp, today), off(today)), btn('Xoá', 'vd-link', () => vdPick(inp, ''))));
    } else {
      head.append(btn('‹', 'vd-nav', () => { y--; draw(); }), btn(`Năm ${y}`, 'vd-title', () => {}), btn('›', 'vd-nav', () => { y++; draw(); }));
      const grid = el('div', { class: 'vd-mgrid' });
      for (let k = 1; k <= 12; k++) {
        const v = `${y}-${pad2(k)}`;
        const sel = kind === 'month' ? v === inp.value : v === (inp.value || '').slice(0, 7);
        grid.append(btn('Tháng ' + k, 'vd-m' + (sel ? ' vd-sel' : '') + (v === today.slice(0, 7) ? ' vd-today' : ''),
          () => { if (kind === 'month') vdPick(inp, v); else { m = k; view = 'days'; draw(); } },
          kind === 'month' && off(v)));
      }
      box.append(head, grid);
      if (kind === 'month') box.append(el('div', { class: 'vd-foot' }, btn('Tháng này', 'vd-link', () => vdPick(inp, today.slice(0, 7)), off(today.slice(0, 7))), btn('Xoá', 'vd-link', () => vdPick(inp, ''))));
    }
  };
  draw();
  document.body.append(box);
  const r = inp.getBoundingClientRect(), bw = box.offsetWidth, bh = box.offsetHeight;
  box.style.left = Math.max(6, Math.min(r.left, innerWidth - bw - 6)) + 'px';
  box.style.top = (r.bottom + bh + 6 > innerHeight && r.top - bh - 6 > 0 ? r.top - bh - 4 : r.bottom + 4) + 'px';
}
if (typeof document !== 'undefined' && !window._viDateOn) {
  window._viDateOn = true;
  // bấm ra ngoài / cuộn trang / đổi cỡ cửa sổ → đóng lịch
  document.addEventListener('mousedown', (e) => { if (vdBox && !vdBox.contains(e.target) && e.target !== vdFor) vdClose(); }, true);
  addEventListener('scroll', (e) => { if (vdBox && !vdBox.contains(e.target)) vdClose(); }, true);
  addEventListener('resize', vdClose);
  const scan = (root) => { if (root.querySelectorAll) for (const i of root.querySelectorAll('input[type=date],input[type=month]')) viDate(i); };
  const st = document.createElement('style');
  st.textContent = `.vd-pop{position:fixed;z-index:100000;background:#fff;border:1px solid #e4e7ec;border-radius:12px;box-shadow:0 12px 32px rgba(16,24,40,.18);padding:10px;width:264px;font:14px 'Segoe UI',system-ui,sans-serif;color:#1d2939}
.vd-pop button{border:none;background:none;font:inherit;color:inherit;cursor:pointer;border-radius:8px;padding:0}
.vd-pop button:disabled{color:#d0d5dd;cursor:default}
.vd-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
.vd-nav{width:32px;height:30px;font-size:20px!important;line-height:1}.vd-nav:hover,.vd-title:hover{background:#f2f4f7}
.vd-title{font-weight:700;padding:5px 10px!important}
.vd-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center}
.vd-wd{font-size:12px;font-weight:700;color:#667085;padding:4px 0}
.vd-d{height:32px}.vd-d:hover:not(:disabled),.vd-m:hover:not(:disabled){background:#fff1e6}
.vd-t7{color:#b45309!important}.vd-cn{color:#dc2626!important}
.vd-today{box-shadow:inset 0 0 0 1px var(--brand,#f97316)}
.vd-sel{background:var(--brand,#f97316)!important;color:#fff!important;font-weight:700}
.vd-mgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.vd-m{height:38px}
.vd-foot{display:flex;justify-content:space-between;margin-top:8px;border-top:1px solid #f2f4f7;padding-top:6px}
.vd-link{color:var(--brand,#f97316)!important;font-weight:700;padding:4px 8px!important}`;
  const boot = () => {
    document.head.append(st);
    scan(document);
    new MutationObserver((ms) => { for (const mu of ms) for (const nd of mu.addedNodes) if (nd.nodeType === 1) { if (nd.matches('input[type=date],input[type=month]')) viDate(nd); else scan(nd); } })
      .observe(document.documentElement, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
}

/* ---------- Định dạng thời gian (chuẩn, KHÔNG bị lỗi 1899) ---------- */
export function isoToHM(iso) {
  if (!iso) return '--:--';
  const d = new Date(iso);
  if (isNaN(d)) return '--:--';
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' });
}
export function isoToHMS(iso) {
  if (!iso) return '';
  const d = new Date(iso); if (isNaN(d)) return '';
  return d.toLocaleTimeString('vi-VN', { hour12: false, timeZone: 'Asia/Ho_Chi_Minh' });
}
export function humanMinutes(min) {
  if (!min || min <= 0) return '0g';
  const h = Math.floor(min / 60), m = min % 60;
  return `${h}g${m ? ' ' + m + 'p' : ''}`;
}
export function humanDistance(m) {
  if (m == null) return '';
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
}
export function todayMonth() { return new Date().toLocaleDateString('sv', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 7); }

export const WEEKDAYS = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
export function nowClock() {
  const now = new Date();
  const t = now.toLocaleTimeString('vi-VN', { hour12: false, timeZone: 'Asia/Ho_Chi_Minh' });
  const parts = new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' }).format(now);
  return { time: t, date: parts };
}

/* ---------- Camera: chụp selfie, trả về dataURL jpeg đã nén ----------
   stamp: mảng dòng chữ đóng dấu lên ảnh (giờ, tên, GPS) — chống dùng ảnh cũ / ảnh chụp lại. */
export function openCamera({ title = 'Chụp ảnh xác nhận', stamp = [] } = {}) {
  return new Promise((resolve) => {
    const modal = el('div', { class: 'cam-modal show' });
    const video = el('video', { autoplay: '', playsinline: '', muted: '' });
    const top = el('div', { class: 'cam-top' }, title);
    let facing = 'user';
    let stream = null;

    const shutter = el('button', { class: 'cam-shutter', title: 'Chụp' });
    const cancel = el('button', { class: 'cam-cancel' }, 'Huỷ');
    const flip = el('button', { class: 'cam-flip' }, '⟲ Đổi cam');
    const bar = el('div', { class: 'cam-bar' }, cancel, shutter, flip);
    modal.append(top, video, bar);
    document.body.append(modal);

    async function start() {
      try {
        if (stream) stream.getTracks().forEach((t) => t.stop());
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false });
        video.srcObject = stream;
      } catch (e) {
        toast('Không mở được camera. Hãy cấp quyền camera cho trình duyệt.', 'err');
        close(null);
      }
    }
    function close(result) {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      modal.remove();
      resolve(result);
    }
    shutter.onclick = () => {
      const w = 640;
      const ratio = video.videoHeight / video.videoWidth || 1.33;
      const canvas = el('canvas');
      canvas.width = w; canvas.height = Math.round(w * ratio);
      const ctx = canvas.getContext('2d');
      if (facing === 'user') { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      if (facing === 'user') ctx.setTransform(1, 0, 0, 1, 0, 0); // bỏ lật để chữ đóng dấu không bị ngược
      // Đóng dấu (watermark): giờ + tên + GPS lên góc dưới ảnh
      const lines = (stamp || []).filter(Boolean);
      if (lines.length) {
        const fs = Math.round(canvas.width / 26);
        const pad = Math.round(fs * 0.5);
        const barH = lines.length * (fs + 4) + pad * 2;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0, canvas.height - barH, canvas.width, barH);
        ctx.font = `600 ${fs}px system-ui, Arial`;
        ctx.textBaseline = 'top';
        lines.forEach((t, i) => {
          const y = canvas.height - barH + pad + i * (fs + 4);
          ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(t, pad + 1, y + 1);
          ctx.fillStyle = '#fff'; ctx.fillText(t, pad, y);
        });
      }
      close(canvas.toDataURL('image/jpeg', 0.72));
    };
    flip.onclick = () => { facing = facing === 'user' ? 'environment' : 'user'; start(); };
    cancel.onclick = () => close(null);
    if (facing === 'user') video.style.transform = 'scaleX(-1)';
    start();
  });
}

/* ---------- Bản quyền ---------- */
// Hỏi máy chủ trạng thái bản quyền. Không hỏi được (máy chủ đang khởi động lại sau cập nhật, máy tính chạy phần mềm tắt/ngủ,
// mạng chập chờn — Cloudflare trả trang lỗi HTML) → null, KHÔNG coi là "chưa kích hoạt". Trước đây lỗi mạng rơi thẳng vào màn
// "Kích hoạt bản quyền" với Mã máy "?" → khách đã kích hoạt tưởng mất bản quyền (Anh 04/11/2026).
async function licenseStatus() {
  try {
    const r = await fetch('/api/license/status', { cache: 'no-store' });
    if (!r.ok) return null;
    const s = await r.json();
    return s && typeof s.activated === 'boolean' ? s : null;
  } catch { return null; }
}
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
export async function ensureLicensed() {
  let s = await licenseStatus();
  for (let i = 0; !s && i < 3; i++) { await sleep(1500); s = await licenseStatus(); }   // chập chờn 1–2 giây: thử lại lặng lẽ
  if (!s) s = await waitForServer();
  if (s.activated) {
    if (s.daysLeft != null && s.daysLeft <= 15)
      toast(`Bản quyền còn ${s.daysLeft} ngày${s.daysLeft <= 0 ? ' (hết hạn)' : ''}`, s.daysLeft <= 0 ? 'err' : '');
    return true;
  }
  showActivation(s);
  return false;
}
// Mất kết nối máy chủ: hiện màn chờ, cứ 5 giây tự hỏi lại — máy chủ trả lời là đi tiếp như thường (không cần tải lại trang)
function waitForServer() {
  return new Promise((resolve) => {
    const box = el('div', { style: 'background:#fff;border-radius:18px;max-width:460px;width:100%;padding:26px;box-shadow:var(--shadow);text-align:center' });
    box.innerHTML = `
      <h2 style="margin:0 0 8px;color:var(--brand)">Đang kết nối máy chủ…</h2>
      <p style="color:var(--muted);margin:0 0 14px;font-size:14px;line-height:1.5">Chưa kết nối được tới máy chủ chấm công. Đây <b>không phải lỗi bản quyền</b> — thường do máy chủ đang khởi động lại sau khi cập nhật, máy tính chạy phần mềm đang tắt / ngủ, hoặc mạng chập chờn.</p>
      <div id="srv-st" style="font-size:13px;color:var(--muted);margin-bottom:14px"></div>
      <button class="btn block" id="srv-go" type="button">Thử lại ngay</button>`;
    const wrap = el('div', { style: 'position:fixed;inset:0;background:linear-gradient(160deg,var(--brand),var(--brand-dark));z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;overflow:auto' }, box);
    document.body.append(wrap);
    const st = box.querySelector('#srv-st'), go = box.querySelector('#srv-go');
    let left = 0, timer = null;
    const tick = () => { if (--left <= 0) return check(); st.textContent = `Tự thử lại sau ${left} giây…`; timer = setTimeout(tick, 1000); };
    async function check() {
      clearTimeout(timer); go.disabled = true; st.textContent = 'Đang thử kết nối…';
      const s = await licenseStatus();
      if (s) { wrap.remove(); return resolve(s); }
      go.disabled = false; left = 6; tick();
    }
    go.onclick = check;
    left = 6; tick();
  });
}
function showActivation(s) {
  const box = el('div', { style: 'background:#fff;border-radius:18px;max-width:460px;width:100%;padding:26px;box-shadow:var(--shadow)' });
  box.innerHTML = `
    <h2 style="margin:0 0 4px;color:var(--brand)">Kích hoạt bản quyền</h2>
    <p style="color:var(--muted);margin:0 0 16px;font-size:14px">Phần mềm cần license của Digiplus để chạy.</p>
    ${s.move ? `<div id="lic-move" style="background:#fffaf0;border:1px solid #f0dcb4;border-radius:12px;padding:12px;margin-bottom:14px;font-size:14px;line-height:1.5">
      <b>📦 Vừa chuyển từ máy cũ — đang tự chuyển bản quyền sang máy này…</b>
      <div id="lic-move-st" style="margin-top:6px"></div>
      <button class="btn ghost sm" id="lic-move-go" type="button" style="margin-top:8px">Thử lại</button>
      <div style="font-size:12px;color:var(--muted);margin-top:6px">Không tự chuyển được thì gửi Mã máy bên dưới cho Digiplus để cấp lại.</div>
    </div>` : ''}
    <label>Mã máy — gửi mã này cho Digiplus để lấy license</label>
    <div style="display:flex;gap:8px;margin-bottom:14px">
      <input id="lic-mid" readonly value="${s.machineIdFmt || ''}" style="font-weight:700;font-family:monospace" />
      <button class="btn ghost sm" id="lic-copy" type="button">Copy</button>
    </div>
    <label>Dán license vào đây</label>
    <textarea id="lic-key" rows="4" placeholder="Dán chuỗi license Digiplus cấp..."></textarea>
    ${s.reason ? `<div class="pill bad" style="margin-top:10px;display:inline-block">${s.reason}</div>` : ''}
    <button class="btn block" id="lic-go" type="button" style="margin-top:14px">Kích hoạt</button>
    <div style="font-size:12px;color:var(--muted);text-align:center;margin-top:10px">Liên hệ Digiplus để mua / cấp bản quyền.</div>`;
  const wrap = el('div', { style: 'position:fixed;inset:0;background:linear-gradient(160deg,var(--brand),var(--brand-dark));z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;overflow:auto' }, box);
  document.body.append(wrap);
  // Đang tự chuyển bản quyền từ máy cũ: hỏi lại 5 giây/lần, có bản quyền là vào luôn
  if (s.move) {
    const st = box.querySelector('#lic-move-st'), go = box.querySelector('#lic-move-go');
    const show = (m) => { if (!m) return; st.textContent = m.error || 'Đang gửi lên máy chủ Digiplus…'; st.style.color = m.stopped ? '#c0392b' : 'var(--muted)'; };
    const poll = async () => {
      if (!wrap.isConnected) return;
      const n = await licenseStatus();
      if (n && n.activated) { toast('Đã nhận bản quyền cho máy này!', 'ok'); setTimeout(() => location.reload(), 800); return; }
      if (n) show(n.move);
      setTimeout(poll, 5000);
    };
    show(s.move);
    setTimeout(poll, 5000);
    go.onclick = async () => {
      go.disabled = true; st.textContent = 'Đang thử lại…';
      try {
        const d = await (await fetch('/api/license/move-retry', { method: 'POST' })).json();
        if (d.state && d.state.activated) { toast('Đã nhận bản quyền cho máy này!', 'ok'); setTimeout(() => location.reload(), 800); return; }
        show(d.move);
      } catch { st.textContent = 'Chưa kết nối được máy chủ phần mềm.'; }
      go.disabled = false;
    };
  }
  box.querySelector('#lic-copy').onclick = () => { try { navigator.clipboard.writeText(s.machineIdFmt || ''); toast('Đã copy Mã máy', 'ok'); } catch { toast('Copy thủ công giúp em', 'err'); } };
  box.querySelector('#lic-go').onclick = async () => {
    const key = box.querySelector('#lic-key').value.trim();
    if (!key) return toast('Dán license vào', 'err');
    try {
      const res = await fetch('/api/license/activate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Lỗi kích hoạt');
      toast('Kích hoạt thành công!', 'ok');
      setTimeout(() => location.reload(), 800);
    } catch (e) { toast(e.message, 'err'); }
  };
}

/* ---------- GPS ---------- */
export function getGps() {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext) return reject(new Error('Cần mở app bằng đường link HTTPS (an toàn) mới lấy được vị trí. Hãy mở bằng địa chỉ web (domain) công ty cấp — KHÔNG mở bằng địa chỉ IP dạng http.'));
    if (!navigator.geolocation) return reject(new Error('Thiết bị không hỗ trợ GPS'));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) }),
      (err) => reject(new Error(
        err.code === 1 ? 'Chưa cho phép quyền Vị trí. Bấm “Cho phép/Allow” khi được hỏi; nếu lỡ chặn: bấm biểu tượng ổ khoá cạnh địa chỉ web → bật lại Vị trí, và bật Dịch vụ vị trí (Location) trên điện thoại.'
          : err.code === 3 ? 'Lấy vị trí quá lâu — ra chỗ thoáng (gần cửa sổ/ngoài trời) rồi thử lại.'
            : 'Không lấy được vị trí GPS. Kiểm tra đã bật Dịch vụ vị trí (GPS) trên điện thoại chưa.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}
