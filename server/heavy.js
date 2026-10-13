// VIỆC ĐỌC NẶNG CHẠY Ở LUỒNG PHỤ (worker thread).
// Node chạy 1 luồng: dựng lưới Tính công cả tháng / báo cáo / xuất Excel của công ty đông người mất vài giây → vài chục giây,
// trong lúc đó MỌI người khác phải chờ (máy chủ "đứng"). Mỗi luồng phụ là 1 máy chủ con (chỉ nghe 127.0.0.1, cổng ngẫu nhiên)
// nạp đúng các route sẵn có và mở kết nối CSDL riêng (SQLite WAL cho nhiều kết nối đọc cùng lúc).
// Luồng chính chỉ CHUYỂN TIẾP các yêu cầu GET nặng trong danh sách sang đó; mọi thao tác ghi, chấm công, máy chấm công vẫn ở luồng chính.
// Luồng phụ không chạy được / lỗi trước khi trả lời → luồng chính tự xử lý như bản cũ (next()).
import { Worker, isMainThread } from 'node:worker_threads';
import http from 'node:http';

const OFF = process.env.HEAVY_WORKERS === '0';   // HEAVY_WORKERS=0 → tắt hẳn, chạy 1 luồng như bản cũ
const SIZE = Math.max(1, Math.min(4, parseInt(process.env.HEAVY_WORKERS || '2', 10) || 2));   // số luồng phụ (mặc định 2)
const pool = [];
let rr = 0, broken = 0;

function spawn() {
  const slot = { w: new Worker(new URL('./heavy-worker.js', import.meta.url)), port: 0, dead: false, ready: null };
  slot.ready = new Promise((ok, fail) => {
    slot.w.once('message', (m) => { if (m && m.port) { slot.port = m.port; ok(slot); } else fail(new Error((m && m.error) || 'luồng phụ không báo cổng')); });
    slot.w.once('error', fail);
    slot.w.once('exit', (c) => fail(new Error('luồng phụ thoát ' + c)));
  });
  slot.ready.catch(() => {});   // lỗi được xử lý ở nơi chờ
  const gone = (why) => {
    if (slot.dead) return;
    slot.dead = true; broken++;
    const i = pool.indexOf(slot); if (i >= 0) pool.splice(i, 1);
    console.error('[heavy] luồng phụ dừng:', why && why.message ? why.message : why);
  };
  slot.w.on('error', gone);
  slot.w.on('exit', (c) => gone(new Error('exit ' + c)));
  slot.w.unref();   // không giữ tiến trình sống khi tắt máy chủ
  pool.push(slot);
  return slot;
}
async function pick() {
  while (pool.length < SIZE) spawn();
  const slot = pool[rr++ % pool.length];
  return slot.ready;
}

// Middleware: chuyển tiếp GET khớp `patterns` (so với req.path sau tiền tố mount) sang luồng phụ
export function offload(patterns) {
  return (req, res, next) => {
    if (OFF || !isMainThread || broken >= 6 || req.method !== 'GET' || !patterns.some((re) => re.test(req.path))) return next();
    pick().then((slot) => {
      const p = http.request({ host: '127.0.0.1', port: slot.port, path: req.originalUrl, method: 'GET', headers: { ...req.headers, connection: 'close' } }, (r) => {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
      });
      p.on('error', (e) => { if (!res.headersSent) next(); else res.destroy(e); });   // chưa trả gì → luồng chính tự làm
      res.on('close', () => { if (!res.writableEnded) p.destroy(); });               // người dùng bỏ ngang → dừng chờ
      p.end();
    }).catch(() => next());
  };
}
export const heavyInfo = () => ({ off: OFF, workers: pool.length, broken });
