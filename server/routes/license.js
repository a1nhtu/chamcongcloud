import { Router } from 'express';
import { licenseState, verifyLicense, saveLicenseKey } from '../license.js';

const r = Router();

// Trạng thái bản quyền + Mã máy (không cần đăng nhập — để hiện màn kích hoạt)
r.get('/status', (req, res) => res.json(licenseState()));

// Kích hoạt bằng chuỗi license do Digiplus cấp
r.post('/activate', (req, res) => {
  const key = (req.body?.key || '').trim();
  const v = verifyLicense(key);
  if (!v.valid) return res.status(400).json({ error: v.reason });
  saveLicenseKey(key);
  res.json({ ok: true, state: licenseState() });
});

export default r;
