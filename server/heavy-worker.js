// Luồng phụ = máy chủ con CHỈ ĐỌC cho các yêu cầu nặng (xem server/heavy.js). Dùng lại nguyên các route sẵn có
// (kể cả kiểm tra đăng nhập / quyền / tài khoản kiểm tra) với kết nối CSDL riêng; chỉ nghe trên 127.0.0.1.
import { parentPort } from 'node:worker_threads';
import express from 'express';

try {
  const [{ default: adminRoutes }, { default: reportRoutes }] = await Promise.all([import('./routes/admin.js'), import('./routes/reports.js')]);
  const app = express();
  app.disable('x-powered-by');
  // phòng hờ: luồng phụ không nhận thao tác ghi — TRỪ "tính lại bảng lương nháp" (tiền lương nâng cao): việc nặng, chỉ ghi bảng
  // pay_sheet_rows của chính bảng nháp đó, làm lại nhiều lần cùng kết quả (SQLite WAL + busy_timeout cho 2 luồng ghi nối tiếp)
  const POST_OK = /^\/api\/admin\/pay\/sheets\/\d+\/compute$/;
  app.use((req, res, next) => (req.method === 'GET' || (req.method === 'POST' && POST_OK.test(req.path)) ? next() : res.status(405).json({ error: 'Luồng phụ chỉ đọc' })));
  app.use('/api/admin', adminRoutes);
  app.use('/api/reports', reportRoutes);
  app.use((err, req, res, next) => { console.error('[heavy-worker]', err); if (!res.headersSent) res.status(500).json({ error: err.message || 'Lỗi máy chủ' }); });
  const srv = app.listen(0, '127.0.0.1', () => parentPort.postMessage({ port: srv.address().port }));
  srv.on('error', (e) => parentPort.postMessage({ error: e.message }));
} catch (e) {
  parentPort.postMessage({ error: (e && e.message) || String(e) });
}
