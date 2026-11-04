import { Router } from 'express';
import { licenseState, verifyLicense, saveLicenseKey } from '../license.js';
import { moveState, retryMoveClaim } from '../chuyen-may-nhan.js';

const r = Router();

// Trạng thái bản quyền + Mã máy (không cần đăng nhập — để hiện màn kích hoạt)
r.get('/status', (req, res) => res.json({ ...licenseState(), move: moveState() }));

// Máy mới vừa chuyển sang: đang đổi license máy cũ lấy license máy này → nút "Thử lại" trên màn kích hoạt
r.post('/move-retry', async (req, res) => res.json({ move: await retryMoveClaim(), state: licenseState() }));

// Kích hoạt bằng chuỗi license do Digiplus cấp
r.post('/activate', (req, res) => {
  const key = (req.body?.key || '').trim();
  const v = verifyLicense(key);
  if (!v.valid) return res.status(400).json({ error: v.reason });
  saveLicenseKey(key);
  res.json({ ok: true, state: licenseState() });
});

export default r;
