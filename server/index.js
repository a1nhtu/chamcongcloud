import express from 'express';
import { createServer as createHttp } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { readFileSync, existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSchema, getSetting } from './db.js';
import { UPLOAD_DIR } from './storage.js';
import { ensureSeed } from './seed.js';
import { maybeAutoBackup } from './backup.js';

import authRoutes from './routes/auth.js';
import attendanceRoutes from './routes/attendance.js';
import leaveRoutes from './routes/leaves.js';
import adminRoutes from './routes/admin.js';
import reportRoutes from './routes/reports.js';
import licenseRoutes from './routes/license.js';
import shiftRequestRoutes from './routes/shift-requests.js';
import iclockRoutes from './routes/iclock.js';
import { isActivated } from './license.js';
import { currentVersion } from './update.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

initSchema();
ensureSeed();

// Tự động sao lưu dữ liệu: kiểm tra mỗi 5 phút, chạy khi tới giờ đã đặt (1 lần/ngày)
maybeAutoBackup();
setInterval(maybeAutoBackup, 5 * 60 * 1000);

const app = express();

// Máy chấm công ZKTeco đẩy dữ liệu (ADMS push) — đặt TRƯỚC express.json + cổng bản quyền
app.use('/', iclockRoutes);

app.use(express.json({ limit: '6mb' }));

// License (không bị khoá — để kích hoạt được)
app.use('/api/license', licenseRoutes);

// Phiên bản hiện tại (công khai — để giao diện kiểm tra sau khi cập nhật/khởi động lại)
app.get('/api/version', (req, res) => res.json({ version: currentVersion() }));

// Thương hiệu (công khai — để màn đăng nhập/kích hoạt hiện logo + tên công ty của khách)
app.get('/api/brand', (req, res) => res.json({
  company_name: getSetting('company_name', 'Digiplus'),
  logo: getSetting('company_logo', ''),
}));

// Cổng bản quyền: chưa kích hoạt → khoá mọi API khác
app.use('/api', (req, res, next) => {
  if (isActivated()) return next();
  res.status(403).json({ error: 'Phần mềm chưa được kích hoạt bản quyền', needLicense: true });
});

// API
app.use('/api/auth', authRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/leaves', leaveRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/shift-requests', shiftRequestRoutes);
app.get('/api/config', (req, res) => res.json({
  company_name: getSetting('company_name', 'Digiplus'),
  attendance_mode: getSetting('attendance_mode', 'shift'),
  self_shift_enabled: getSetting('self_shift_enabled', '0'),
  self_shift_approve: getSetting('self_shift_approve', '1'),
}));

// Ảnh selfie
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

// Trang tĩnh (PWA nhân viên + trang admin)
app.use(express.static(PUBLIC_DIR));
app.get('/admin', (req, res) => res.sendFile(join(PUBLIC_DIR, 'admin.html')));
app.get('/', (req, res) => res.sendFile(join(PUBLIC_DIR, 'index.html')));

// Fallback lỗi JSON
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Lỗi máy chủ' });
});

const PORT = Number(process.env.PORT || 8080);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 8444);
const CERT_DIR = join(__dirname, '..', 'certs');

function lanIPs() {
  const real = [], virt = [];
  const isVirtual = (name) => /vethernet|virtual|vmware|virtualbox|hyper-?v|wsl|loopback|default switch|docker|tap-|tailscale|zerotier|bluetooth|npcap/i.test(name);
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family !== 'IPv4' || ni.internal || /^169\.254\./.test(ni.address)) continue;
      (isVirtual(name) ? virt : real).push(ni.address);
    }
  }
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
  real.sort((a, b) => rank(a) - rank(b));
  return [...real, ...virt];
}

// HTTP (dùng cho localhost trên chính máy này)
createHttp(app).listen(PORT, '0.0.0.0', () => {
  console.log(`\n  === Digiplus Chấm công ===`);
  console.log(`  HTTP  (máy này):  http://localhost:${PORT}/  |  /admin`);
});

// HTTPS (bắt buộc để điện thoại dùng camera + GPS qua mạng LAN)
const keyPath = join(CERT_DIR, 'key.pem');
const certPath = join(CERT_DIR, 'cert.pem');
if (existsSync(keyPath) && existsSync(certPath)) {
  createHttps({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, app)
    .listen(HTTPS_PORT, '0.0.0.0', () => {
      const ips = lanIPs();
      console.log(`  HTTPS (điện thoại/LAN):`);
      if (!ips.length) console.log(`     https://localhost:${HTTPS_PORT}/`);
      for (const ip of ips) console.log(`     https://${ip}:${HTTPS_PORT}/        (điện thoại mở link này)`);
      console.log(`  * Điện thoại sẽ báo "không an toàn" (chứng chỉ tự ký) → bấm Nâng cao → Tiếp tục.\n`);
    });
} else {
  console.log(`  (Chưa có chứng chỉ HTTPS trong /certs — chạy "npm run cert" để tạo, cần cho camera/GPS trên điện thoại)\n`);
}
