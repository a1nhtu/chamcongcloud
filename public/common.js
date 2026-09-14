// Tiện ích dùng chung cho cả app nhân viên và admin
export const TK = 'digiplus_token';
const DEV = 'digiplus_device_id';

export function getToken() { return localStorage.getItem(TK); }
export function setToken(t) { localStorage.setItem(TK, t); }
export function clearToken() { localStorage.removeItem(TK); }

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
  if (res.status === 401) { clearToken(); location.reload(); throw new Error('Hết phiên'); }
  if (raw) return res;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Có lỗi xảy ra'); e.code = data.code; e.status = res.status; throw e; }
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
  return n;
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
export async function ensureLicensed() {
  let s;
  try { s = await fetch('/api/license/status').then((r) => r.json()); }
  catch { s = { activated: false, machineIdFmt: '?' }; }
  if (s.activated) {
    if (s.daysLeft != null && s.daysLeft <= 15)
      toast(`Bản quyền còn ${s.daysLeft} ngày${s.daysLeft <= 0 ? ' (hết hạn)' : ''}`, s.daysLeft <= 0 ? 'err' : '');
    return true;
  }
  showActivation(s);
  return false;
}
function showActivation(s) {
  const box = el('div', { style: 'background:#fff;border-radius:18px;max-width:460px;width:100%;padding:26px;box-shadow:var(--shadow)' });
  box.innerHTML = `
    <h2 style="margin:0 0 4px;color:var(--brand)">Kích hoạt bản quyền</h2>
    <p style="color:var(--muted);margin:0 0 16px;font-size:14px">Phần mềm cần license của Digiplus để chạy.</p>
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
