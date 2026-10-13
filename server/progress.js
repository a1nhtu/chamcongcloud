// TIẾN ĐỘ các việc chạy lâu (xuất Excel báo cáo…) để giao diện vẽ thanh %.
// Việc nặng chạy ở luồng phụ (server/heavy.js) còn giao diện hỏi tiến độ ở luồng chính → nối 2 bên bằng BroadcastChannel.
// Giao diện tự sinh 1 mã ngẫu nhiên (pt) gửi kèm yêu cầu; nơi làm việc gọi setProgress(pt, %, chữ); luồng chính trả cho giao diện.
import { BroadcastChannel } from 'node:worker_threads';

const store = new Map();   // pt → { pct, msg, at }
const ch = new BroadcastChannel('digiplus-progress');
ch.onmessage = (ev) => { const m = ev.data; if (m && m.pt) put(m.pt, m.pct, m.msg); };
ch.unref();   // không giữ tiến trình sống

function put(pt, pct, msg) {
  store.set(pt, { pct, msg, at: Date.now() });
  if (store.size > 500) { const old = Date.now() - 10 * 60000; for (const [k, v] of store) if (v.at < old) store.delete(k); }
}
const okToken = (pt) => typeof pt === 'string' && /^[A-Za-z0-9_-]{6,40}$/.test(pt);

export function setProgress(pt, pct, msg = '') {
  if (!okToken(pt)) return;
  pct = Math.max(0, Math.min(100, Math.round(pct)));
  put(pt, pct, msg);
  ch.postMessage({ pt, pct, msg });   // báo cho các luồng khác (luồng chính giữ bản để trả giao diện)
}
export const getProgress = (pt) => (okToken(pt) && store.get(pt)) || null;

// Hàm báo tiến độ cho 1 yêu cầu: P(%, chữ). Không có mã pt → hàm rỗng. Tự bỏ các lần báo dày hơn 150ms (trừ lúc đổi chữ / 100%).
export function progressOf(req) {
  const pt = String((req.query && req.query.pt) || '');
  if (!okToken(pt)) return () => {};
  let last = 0, lastMsg = null;
  return (pct, msg = '') => {
    const now = Date.now();
    if (pct < 100 && msg === lastMsg && now - last < 150) return;
    last = now; lastMsg = msg; setProgress(pt, pct, msg);
  };
}
// Báo tiến độ trong vòng lặp: phần thứ i / n nằm trong khoảng [a, b] %
export const loopProg = (P, i, n, a, b, label) => { if (P && (i % 20 === 0 || i === n)) P(a + (b - a) * (n ? i / n : 1), `${label} ${i.toLocaleString('vi')} / ${n.toLocaleString('vi')}`); };
