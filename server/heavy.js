// VIỆC ĐỌC NẶNG CHẠY Ở LUỒNG PHỤ (worker thread).
// Node chạy 1 luồng: dựng lưới Tính công cả tháng / báo cáo / xuất Excel của công ty đông người mất vài giây → vài chục giây,
// trong lúc đó MỌI người khác phải chờ (máy chủ "đứng"). Mỗi luồng phụ là 1 máy chủ con (chỉ nghe 127.0.0.1, cổng ngẫu nhiên)
// nạp đúng các route sẵn có và mở kết nối CSDL riêng (SQLite WAL cho nhiều kết nối đọc cùng lúc).
// Luồng chính chỉ CHUYỂN TIẾP các yêu cầu GET nặng trong danh sách sang đó; mọi thao tác ghi, chấm công, máy chấm công vẫn ở luồng chính.
// Luồng phụ không chạy được / lỗi trước khi trả lời → luồng chính tự xử lý như bản cũ (next()).
import { Worker, isMainThread } from 'node:worker_threads';
import http from 'node:http';
import { currentTenant } from './tenant.js';

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
// sticky: yêu cầu cùng nội dung về cùng 1 luồng phụ (báo cáo xem trước + xuất Excel của nó → Excel dùng lại được số vừa dựng ở luồng đó)
const hashOf = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h >>> 0; };
async function pick(sticky) {
  while (pool.length < SIZE) spawn();
  const slot = pool[(sticky ? hashOf(sticky) : rr++) % pool.length];
  return slot.ready;
}
// Xem trước (/data) và Xuất Excel (/export.xlsx) của cùng 1 báo cáo → cùng 1 luồng phụ (bỏ ?pt=… là mã thanh tiến trình)
export const reportSticky = (req) => {
  if (!/^\/(data|export\.xlsx)$/.test(req.path)) return null;
  const { pt, ...q } = req.query;
  return JSON.stringify(Object.entries(q).sort());
};
// Khởi động sẵn luồng phụ ngay sau khi máy chủ lên: mỗi luồng phải nạp lại toàn bộ mã (máy văn phòng yếu mất vài giây),
// để tới lúc có người xuất báo cáo đầu tiên trong ngày mới nạp thì người đó phải chờ.
export function warmHeavy() {
  if (OFF || !isMainThread) return;
  while (pool.length < SIZE) spawn();
}

// THẾ HỆ DỮ LIỆU theo công ty: tăng sau mỗi yêu cầu GHI vào máy chủ (mọi thao tác trên web / điện thoại, máy chấm công gửi lượt quẹt).
// Máy chấm công hỏi lệnh 10 giây/lần (GET) không tính — vì vậy không dùng PRAGMA data_version (đổi liên tục theo nhịp đó).
// Bản báo cáo xem trước giữ ở luồng phụ chỉ được dùng lại khi thế hệ chưa đổi (routes/reports.js).
const gens = new Map();
const genKey = () => { const t = currentTenant(); return t ? t.slug : ''; };
export function markWrites(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const k = genKey();
    res.once('finish', () => gens.set(k, (gens.get(k) || 0) + 1));
  }
  next();
}
export const dataGen = (req) => (isMainThread ? String(gens.get(genKey()) || 0) : String(req.headers['x-dgp-gen'] || ''));

// Middleware: chuyển tiếp GET khớp `patterns` (so với req.path sau tiền tố mount) sang luồng phụ.
// postPatterns: POST KHÔNG thân (tính lại được nhiều lần cho cùng kết quả, VD tính lại bảng lương nháp) cũng chuyển sang luồng phụ.
// stickyOf(req): chuỗi xác định nội dung yêu cầu — cùng chuỗi về cùng 1 luồng phụ (không truyền = xoay vòng).
export function offload(patterns, postPatterns = [], stickyOf = null) {
  return (req, res, next) => {
    const isGet = req.method === 'GET' && patterns.some((re) => re.test(req.path));
    const isPost = req.method === 'POST' && postPatterns.some((re) => re.test(req.path));
    if (OFF || !isMainThread || broken >= 6 || !(isGet || isPost)) return next();
    pick(stickyOf && stickyOf(req)).then((slot) => {
      const headers = { ...req.headers, connection: 'close', 'x-dgp-gen': dataGen(req) };
      delete headers['x-dgp-tenant'];
      const t = currentTenant();   // máy chủ nhiều công ty: báo luồng phụ đọc CSDL của công ty nào (người ngoài không tự đặt được)
      if (t) headers['x-dgp-tenant'] = t.slug;
      if (isPost) { delete headers['content-length']; delete headers['transfer-encoding']; delete headers['content-type']; }
      const p = http.request({ host: '127.0.0.1', port: slot.port, path: req.originalUrl, method: req.method, headers }, (r) => {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
      });
      p.on('error', (e) => { if (!res.headersSent) next(); else res.destroy(e); });   // chưa trả gì → luồng chính tự làm
      res.on('close', () => { if (!res.writableEnded) p.destroy(); });               // người dùng bỏ ngang → dừng chờ
      p.end();
    }).catch(() => next());
  };
}
// Tắt hết luồng phụ (máy chủ nhiều công ty mở lại CSDL 1 công ty sau khi phục hồi: luồng phụ đang giữ file CSDL cũ).
// Yêu cầu nặng kế tiếp tự sinh luồng mới.
export async function stopHeavyWorkers() {
  const all = pool.splice(0, pool.length);
  await Promise.all(all.map((s) => { s.dead = true; return s.w.terminate().catch(() => {}); }));
}
