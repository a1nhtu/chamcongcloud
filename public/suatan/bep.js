// MÀN HÌNH BẾP — hỏi máy chủ mỗi 2 giây xem có lượt quẹt máy chấm công mới không, hiện tên NV + món đã chọn của lượt gần nhất.
// Không đăng nhập: dùng khoá do HR cấp (liên kết /bep?key=…; khoá nhớ trên máy này).
const $ = (s) => document.querySelector(s);
const KEY_LS = 'digiplus_bep_key';
let key = '', since = 0, first = true, lastShown = 0, soundOn = false, audio = null;

try {
  const u = new URL(location.href), k = u.searchParams.get('key');
  if (k) { localStorage.setItem(KEY_LS, k); u.searchParams.delete('key'); history.replaceState(null, '', u.pathname + u.search); }
  key = localStorage.getItem(KEY_LS) || '';
} catch { /* trình duyệt chặn lưu trữ */ }

const hm = (iso) => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString('vi-VN', { hour12: false, timeZone: 'Asia/Ho_Chi_Minh' }); }, 1000);

$('#sound').onclick = () => {
  soundOn = !soundOn; $('#sound').textContent = soundOn ? '🔕 Tắt tiếng' : '🔔 Bật tiếng';
  if (soundOn && !audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { soundOn = false; } }
};
function beep() {
  if (!soundOn || !audio) return;
  try {
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = 880; g.gain.value = 0.12; o.connect(g); g.connect(audio.destination);
    o.start(); o.stop(audio.currentTime + 0.18);
  } catch { /* bỏ qua */ }
}

function showGate(msg) {
  $('#gate').style.display = 'flex';
  if (msg) $('#gk').placeholder = msg;
}
$('#gb').onclick = () => {
  const v = $('#gk').value.trim();
  if (!v) return;
  try { key = v.includes('key=') ? new URL(v).searchParams.get('key') || v : v; } catch { key = v; }
  try { localStorage.setItem(KEY_LS, key); } catch {}
  $('#gate').style.display = 'none'; since = 0; first = true; poll();
};

function drawBig(e) {
  const big = $('#big');
  big.innerHTML = `<div class="name">${esc(e.name)}</div>
    <div class="meta">${esc(e.code)}${e.department ? ' · ' + esc(e.department) : ''} · ${esc(e.shift_name)} · ${hm(e.at)}</div>
    ${e.dish ? `<div class="dish">${esc(e.dish)}</div>` : '<div class="dish none">Chưa chọn món — phát suất mặc định</div>'}
    ${e.times > 1 ? `<div class="tag again">⚠ Quẹt lần thứ ${e.times} trong bữa này</div>` : ''}`;
  big.classList.remove('flash'); void big.offsetWidth; big.classList.add('flash');
}
function drawList(events) {
  $('#list').innerHTML = events.slice(0, 9).map((e) => `<div class="it"><span class="t">${hm(e.at)}</span><span class="n">${esc(e.name)}</span><span class="d${e.dish ? '' : ' none'}">${e.dish ? esc(e.dish) : 'chưa chọn món'}</span></div>`).join('');
}

let recent = [];
async function poll() {
  if (!key) return showGate();
  try {
    const res = await fetch(`/api/meal/kitchen/feed?key=${encodeURIComponent(key)}&since=${since}`, { cache: 'no-store' });
    if (res.status === 401) { $('#dot').classList.add('off'); try { localStorage.removeItem(KEY_LS); } catch {} key = ''; return showGate('Khoá không đúng / đã đổi — nhập lại'); }
    if (res.status === 403 || res.status === 404) { $('#dot').classList.add('off'); $('#big').innerHTML = '<div class="wait">Phân hệ suất ăn đang tắt</div>'; return setTimeout(poll, 10000); }
    const d = await res.json();
    $('#dot').classList.remove('off');
    since = Math.max(since, d.last_id || 0);
    if (d.events.length) {
      recent = [...d.events, ...recent].slice(0, 30);   // events: mới nhất trước
      drawList(recent);
      const newest = d.events[0];
      if (newest.id > lastShown) {
        drawBig(newest);
        if (!first) beep();   // lần tải đầu chỉ hiện, không kêu
        lastShown = newest.id;
      }
    }
    first = false;
  } catch { $('#dot').classList.add('off'); }
  setTimeout(poll, 2000);
}
poll();
