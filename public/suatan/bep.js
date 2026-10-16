// MÀN HÌNH BẾP — hỏi máy chủ mỗi 2 giây xem có lượt quẹt máy chấm công mới không, hiện tên NV + món đã chọn của lượt gần nhất
// (bấm lượt cũ bên phải để xem lại).
// Không đăng nhập: dùng khoá do HR cấp (liên kết /bep?key=…; khoá nhớ trên máy này).
const $ = (s) => document.querySelector(s);
const KEY_LS = 'digiplus_bep_key';
let key = '', since = 0, first = true, lastShown = 0, soundOn = false, audio = null;

try {
  // mã đến từ /bep/MÃ (ngắn, dễ gõ) hoặc /bep?key=MÃ; nhớ trên máy rồi gỡ khỏi thanh địa chỉ
  const u = new URL(location.href), seg = decodeURIComponent(u.pathname.replace(/^\/bep\/?/, '').split('/')[0] || '');
  const k = seg || u.searchParams.get('key');
  if (k) { localStorage.setItem(KEY_LS, k.trim().toUpperCase()); history.replaceState(null, '', '/bep'); }
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
$('#gk').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#gb').click(); });
$('#gb').onclick = () => {
  const v = $('#gk').value.trim();
  if (!v) return;
  key = v.includes('/bep/') ? v.split('/bep/')[1].split(/[?#/]/)[0] : v.replace(/^.*key=/, '');   // dán cả link hay chỉ gõ mã đều được
  key = key.trim().toUpperCase();
  try { localStorage.setItem(KEY_LS, key); } catch {}
  $('#gate').style.display = 'none'; since = 0; first = true; poll();
};

function drawBig(e, review = false) {
  const big = $('#big');
  big.classList.toggle('review', review);
  big.innerHTML = `${review ? `<div class="rv">↩ ĐANG XEM LẠI lượt ${hm(e.at)} <button id="live" type="button">Về lượt mới nhất</button></div>` : ''}
    <div class="name">${esc(e.name)}</div>
    <div class="meta">${esc(e.code)}${e.department ? ' · ' + esc(e.department) : ''} · ${esc(e.shift_name)} · ${hm(e.at)}</div>
    ${e.dish ? `<div class="dish">${esc(e.dish)}</div>` : '<div class="dish none">Chưa chọn món — phát suất mặc định</div>'}
    ${e.times > 1 ? `<div class="tag again">⚠ Quẹt lần thứ ${e.times} trong bữa này</div>` : ''}`;
  if (review) $('#live').onclick = backToLive;
  else { big.classList.remove('flash'); void big.offsetWidth; big.classList.add('flash'); }
}
function drawList(events) {
  $('#list').innerHTML = events.map((e) => `<div class="it${e.id === viewing ? ' sel' : ''}" data-id="${e.id}"><span class="t">${hm(e.at)}</span><span class="n">${esc(e.name)}</span><span class="d${e.dish ? '' : ' none'}">${e.dish ? esc(e.dish) : 'chưa chọn món'}</span></div>`).join('');
}

// XEM LẠI: bấm 1 lượt bên phải (hoặc phím ↓/↑) → hiện to ở giữa; 10 giây không thao tác thì tự về lượt mới nhất.
// Trong lúc xem lại, lượt mới vẫn vào danh sách + kêu, chỉ ô lớn đứng yên.
let viewing = 0, viewTimer = 0;
function view(id) {
  const e = recent.find((x) => x.id === id);
  if (!e) return;
  if (e.id === recent[0]?.id) return backToLive();
  viewing = e.id; drawBig(e, true); drawList(recent);
  document.querySelector('#list .sel')?.scrollIntoView({ block: 'nearest' });
  clearTimeout(viewTimer); viewTimer = setTimeout(backToLive, 10000);
}
function backToLive() {
  clearTimeout(viewTimer); viewing = 0;
  if (recent[0]) drawBig(recent[0]);
  drawList(recent);
}
$('#list').onclick = (ev) => { const it = ev.target.closest('.it'); if (it) view(Number(it.dataset.id)); };
document.addEventListener('keydown', (ev) => {
  if ($('#gate').style.display === 'flex' || !recent.length) return;
  const i = viewing ? recent.findIndex((x) => x.id === viewing) : 0;
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowRight') view(recent[Math.min(i + 1, recent.length - 1)].id);
  else if (ev.key === 'ArrowUp' || ev.key === 'ArrowLeft') view(recent[Math.max(i - 1, 0)].id);
  else if (ev.key === 'Escape' || ev.key === 'Home') backToLive();
  else return;
  ev.preventDefault();
});

let recent = [];
async function poll() {
  if (!key) return showGate();
  try {
    const res = await fetch(`/api/meal/kitchen/feed?key=${encodeURIComponent(key)}&since=${since}`, { cache: 'no-store' });
    if (res.status === 401) { $('#dot').classList.add('off'); try { localStorage.removeItem(KEY_LS); } catch {} key = ''; return showGate('Mã không đúng / đã đổi — nhập lại'); }
    if (res.status === 403 || res.status === 404) { $('#dot').classList.add('off'); $('#big').innerHTML = '<div class="wait">Phân hệ suất ăn đang tắt</div>'; return setTimeout(poll, 10000); }
    const d = await res.json();
    $('#dot').classList.remove('off');
    since = Math.max(since, d.last_id || 0);
    if (d.events.length) {
      recent = [...d.events, ...recent].slice(0, 30);   // events: mới nhất trước
      drawList(recent);
      const newest = d.events[0];
      if (newest.id > lastShown) {
        if (!viewing) drawBig(newest);
        if (!first) beep();   // lần tải đầu chỉ hiện, không kêu
        lastShown = newest.id;
      }
    }
    first = false;
  } catch { $('#dot').classList.add('off'); }
  setTimeout(poll, 2000);
}
poll();
