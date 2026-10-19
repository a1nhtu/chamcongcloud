// Máy chấm công Hikvision TỰ GỬI sự kiện về đây (HTTP Listening): POST /hik/event/<mã máy> — xem hikReceive trong server/hik-isapi.js.
// KHÔNG nằm sau cổng bản quyền (giống /iclock) — máy phải gửi được. Tắt công tắc "Dùng máy Hikvision" → như chưa có route (404).
import { Router, raw } from 'express';
import { hikEnabled, hikReceive, HIK_EVENT_PATH } from '../hik-isapi.js';

const r = Router();
const enabledOnly = (req, res, next) => (hikEnabled() ? next() : next('route'));
const rawBody = raw({ type: () => true, limit: '12mb' });   // JSON / XML / multipart kèm ảnh chụp

function handleHikEvent(req, res) {
  let out;
  try {
    out = hikReceive({ token: req.params.token || '', contentType: req.headers['content-type'] || '',
      body: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), remoteIp: req.socket?.remoteAddress || '' });
  } catch (e) {
    console.error('[hik] nhận sự kiện lỗi:', e.message);
    return res.status(500).type('text/plain').send('ERROR');   // máy sẽ gửi lại sau
  }
  if (!out.device) return res.status(404).type('text/plain').send('Unknown device');
  res.type('text/plain').send('OK');
}

r.post([HIK_EVENT_PATH, HIK_EVENT_PATH + '/:token'], enabledOnly, rawBody, handleHikEvent);

export default r;
export { handleHikEvent };
