// Tạo link tải file để gửi qua Zalo / Mail từ điện thoại (xem server/share-file.js). Trang quản lý gửi nguyên file vừa xuất lên.
import { raw } from 'express';
import { createShare, SHARE_MAX_BYTES } from '../../share-file.js';

export function registerShareRoutes(r) {
  // POST /api/admin/share-file?name=<tên file>  (thân = nội dung file) → { url, name, expires }
  r.post('/share-file', raw({ type: () => true, limit: SHARE_MAX_BYTES }), (req, res) => {
    try {
      const buf = Buffer.isBuffer(req.body) ? req.body : null;
      res.json(createShare(buf, req.query.name));
    } catch (e) { res.status(400).json({ error: e.message || 'Không tạo được link' }); }
  });
}
