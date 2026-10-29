import './logger.js';   // ghi log ra data/logs/server.log (phải import đầu tiên)
import express from 'express';
import { createServer as createHttp } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSchema, getSetting, optimizeDb } from './db.js';
import { uploadDir } from './storage.js';
import { MULTI, eachTenant } from './tenant.js';
import { ensureSeed } from './seed.js';
import { maybeAutoBackup } from './backup.js';
import { fixOverlappingAssignmentsOnce } from './assign-normalize.js';

import authRoutes from './routes/auth.js';
import attendanceRoutes from './routes/attendance.js';
import leaveRoutes from './routes/leaves.js';
import adminRoutes from './routes/admin.js';
import reportRoutes from './routes/reports.js';
import licenseRoutes from './routes/license.js';
import shiftRequestRoutes from './routes/shift-requests.js';
import mealRoutes from './routes/meal.js';
import payRoutes from './routes/pay.js';
import { mealStaticGate } from './meal.js';
import iclockRoutes from './routes/iclock.js';
import hikEventRoutes from './routes/hik-event.js';
import { isActivated } from './license.js';
import { currentVersion, takeOverFromOldApp, clearHandoff } from './update.js';
import { offload } from './heavy.js';
import { startTcpScheduler } from './zk-tcp.js';
import { attachAiWs } from './ai-ws.js';
import { startHikScheduler } from './hik-isapi.js';
import { startUnion } from './union.js';
import { startHrScheduler } from './hr.js';
import { startHrRemindScheduler } from './hr-remind.js';
import { startRebootScheduler } from './reboot-schedule.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

// Máy chủ nhiều công ty (MULTI_TENANT=1): mở + khởi tạo CSDL của TỪNG công ty (data/tenants/<mã>) thay cho CSDL duy nhất
const H = MULTI ? await import('./host.js') : null;
if (H) H.openAllTenants();
else {
  initSchema();
  fixOverlappingAssignmentsOnce();   // dọn 1 lần các lịch gán ca chồng ngày của bản cũ (chạy SAU khi CSDL đã khởi tạo)
  optimizeDb();
}
startTcpScheduler();   // tự tải máy chấm công TCP/IP theo lịch (chỉ chạy khi đã bật + đặt số phút)
startHikScheduler();   // tự tải máy Hikvision theo lịch (chỉ chạy khi đã bật "Dùng máy Hikvision" + đặt số phút)
startUnion();          // máy Union tự kết nối về cổng 9870 (chỉ mở cổng khi đã bật "Dùng máy Union")
if (!H) ensureSeed();   // máy chủ nhiều công ty: đã tạo lúc mở từng công ty
startHrScheduler();   // nhân sự: tới ngày hiệu lực thì tự áp dụng quyết định thuyên chuyển / nghỉ việc
startHrRemindScheduler();   // nhân sự: nhắc HĐ sắp hết hạn / hết thử việc qua thông báo đẩy (công tắc hr_remind_push)
startRebootScheduler();   // máy chấm công: tự khởi động lại theo giờ hẹn của từng máy (chưa hẹn máy nào = không làm gì)

// Tự động sao lưu dữ liệu: kiểm tra mỗi 5 phút, chạy khi tới giờ đã đặt (1 lần/ngày)
const backupTick = () => eachTenant(maybeAutoBackup);
backupTick();
setInterval(backupTick, 5 * 60 * 1000);

const app = express();
// Máy chủ nhiều công ty: API điều khiển (tạo công ty — cần HOST_TOKEN) + mọi yêu cầu khác chạy theo công ty của TÊN MIỀN
if (H) { app.use(H.hostRouter()); app.use(H.tenantGate); }

// Máy chấm công ZKTeco đẩy dữ liệu (ADMS push) — đặt TRƯỚC express.json + cổng bản quyền
app.use('/', iclockRoutes);
// Máy Hikvision tự gửi lượt chấm (HTTP Listening) — cũng TRƯỚC cổng bản quyền; tắt "Dùng máy Hikvision" → 404 như cũ
app.use('/', hikEventRoutes);

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
// Các yêu cầu ĐỌC nặng (lưới tính công, bảng lương, phân ca, báo cáo, xuất Excel) chạy ở luồng phụ → máy chủ không "đứng" khi có người chạy báo cáo
app.use('/api/admin', offload([/^\/attendance\/grid$/, /^\/payroll$/, /^\/assignments$/, /^\/abnormal(\.xlsx)?$/, /^\/ot-reg$/,
  /^\/pay\/sheets\/\d+\/(export|bank)\.xlsx$/, /^\/pay\/reports\/[a-z]+(\.xlsx)?$/],
  [/^\/pay\/sheets\/\d+\/compute$/]));   // tiền lương nâng cao: tính lại bảng lương nháp (không thân, làm lại được) ở luồng phụ
app.use('/api/reports', offload([/^\/data$/, /^\/export\.xlsx$/, /^\/attendance$/]));
app.use('/api/admin', adminRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/shift-requests', shiftRequestRoutes);
app.use('/api/meal', mealRoutes);   // quản lý suất ăn — công tắc meal_enabled (tắt: 403)
app.use('/api/pay', payRoutes);     // phiếu lương của nhân viên trên app — công tắc pay_pro + pay_app_slip (tắt: 403)
app.get('/api/config', (req, res) => res.json({
  company_name: getSetting('company_name', 'Digiplus'),
  attendance_mode: getSetting('attendance_mode', 'shift'),
  self_shift_enabled: getSetting('self_shift_enabled', '0'),
  self_shift_approve: getSetting('self_shift_approve', '1'),
  att_enabled: getSetting('att_enabled', '1'),   // Cấu hình hiển thị: tắt = công ty không dùng chấm công (app NV ẩn tab chấm công, chỉ còn Suất ăn)
}));

// Ảnh selfie + logo công ty. Logo cho phép định dạng SVG (nhúng qua thẻ <img> ở giao
// diện, không bị ảnh hưởng bởi header dưới đây) — nhưng nếu ai đó mở thẳng file .svg
// bằng trình duyệt (điều hướng trực tiếp, không qua <img>), chặn thực thi script/tải
// tài nguyên ngoài để tránh XSS lưu trữ.
app.use('/uploads', (req, res, next) => {
  if (req.path.toLowerCase().endsWith('.svg')) {
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
  next();
}, H ? H.tenantUploads({ maxAge: '7d' }) : express.static(uploadDir(), { maxAge: '7d' }));

// Trang tĩnh (PWA nhân viên + trang admin)
app.use('/suatan', mealStaticGate);   // giao diện Suất ăn: tắt công tắc meal_enabled → 404 (đặt TRƯỚC express.static)
app.use(express.static(PUBLIC_DIR, { index: false }));
// Trả HTML kèm cache-busting: chèn ?v=<version> vào js/css nội bộ để trình duyệt/Cloudflare
// tự lấy bản mới mỗi khi lên version (khỏi phải xoá cache tay khi cập nhật).
function sendHtmlNoCache(res, file) {
  try {
    const v = currentVersion();
    const html = readFileSync(join(PUBLIC_DIR, file), 'utf8')
      .replace(/(src|href)="(\/[^"?]+\.(?:js|css))"/g, `$1="$2?v=${v}"`);
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(html);
  } catch { res.sendFile(join(PUBLIC_DIR, file)); }
}
app.get('/admin', (req, res) => sendHtmlNoCache(res, 'admin.html'));
app.get('/', (req, res) => sendHtmlNoCache(res, 'index.html'));
app.get(['/bep', '/bep/:key'], mealStaticGate, (req, res) => sendHtmlNoCache(res, 'suatan/bep.html'));   // màn hình bếp (mã ngắn do HR cấp: /bep/MÃ hoặc /bep rồi gõ mã)

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

// HTTP (localhost trên máy này + Cloudflare Tunnel ra internet) — BẮT BUỘC phải mở được
// Vừa cập nhật mà bản cũ còn giữ cổng → tự tắt bản cũ, chờ cổng nhả rồi mới mở (xem update.js takeOverFromOldApp)
if (takeOverFromOldApp()) await new Promise((ok) => setTimeout(ok, 2000));
const httpServer = createHttp(app);
attachAiWs(httpServer);   // máy chấm công AI kết nối WebSocket vào CHÍNH cổng này (tắt công tắc "Dùng máy AI" → từ chối)
httpServer.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`\n  [X] Cổng HTTP ${PORT} đang bị chiếm — có thể app đã chạy sẵn. Không mở thêm.`);
  else console.error(`\n  [X] Không mở được cổng HTTP ${PORT}: ${e.code}. App không thể chạy.`);
  process.exit(1);
});
httpServer.listen(PORT, '0.0.0.0', () => {
  clearHandoff();
  console.log(`\n  === Digiplus Chấm công ===`);
  console.log(`  HTTP  (máy này):  http://localhost:${PORT}/  |  /admin`);
  // Bản cài của khách: tự bảo đảm app tự bật khi mở máy/đăng nhập (khách cũ bấm Cập nhật là được sửa, khỏi chạy lại CaiDat.bat)
  import('./autostart.js').then((m) => m.ensureAutostart()).catch((e) => console.error('[autostart] lỗi:', e.message));
  if (H) H.startDevicePorts(app, attachAiWs);   // cổng riêng cho máy chấm công chỉ điền được IP + cổng
});

// HTTPS (cho điện thoại dùng camera + GPS qua mạng LAN/wifi nội bộ) — KHÔNG bắt buộc:
// nếu cổng bị Windows/phần mềm khác chặn thì chỉ cảnh báo, app vẫn chạy bình thường qua HTTP + tunnel.
const keyPath = join(CERT_DIR, 'key.pem');
const certPath = join(CERT_DIR, 'cert.pem');
// Tự sinh chứng chỉ tự ký theo IP LAN của MÁY KHÁCH nếu chưa có (bản LAN khỏi bake cert sẵn).
// Dùng lib 'selfsigned' (thuần JS, không cần openssl ở máy khách). Best-effort: lỗi/thiếu lib → bỏ qua, app vẫn chạy HTTP.
// (Máy chủ nhiều công ty chạy trên VPS: điện thoại vào qua tên miền HTTPS của Cloudflare → không cần HTTPS mạng LAN)
if (!H && (!existsSync(keyPath) || !existsSync(certPath))) {
  try {
    const { default: selfsigned } = await import('selfsigned');
    mkdirSync(CERT_DIR, { recursive: true });
    const ips = lanIPs();
    const altNames = [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }, ...ips.map((ip) => ({ type: 7, ip }))];
    const pems = await selfsigned.generate([{ name: 'commonName', value: 'Digiplus ChamCong' }],
      { days: 3650, keySize: 2048, algorithm: 'sha256', extensions: [{ name: 'subjectAltName', altNames }] });
    writeFileSync(keyPath, pems.private);
    writeFileSync(certPath, pems.cert);
    console.log('  [+] Đã tự tạo chứng chỉ HTTPS tự ký cho: localhost, 127.0.0.1' + (ips.length ? ', ' + ips.join(', ') : ''));
  } catch (e) {
    console.warn('  [!] Chưa tạo được chứng chỉ tự động (' + e.message + ') — app vẫn chạy HTTP; HTTPS điện thoại tạm chưa dùng.');
  }
}
if (!H && existsSync(keyPath) && existsSync(certPath)) {
  const httpsServer = createHttps({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, app);
  httpsServer.on('error', (e) => {
    console.warn(`  [!] Bỏ qua HTTPS cổng ${HTTPS_PORT} (${e.code}) — app VẪN CHẠY bình thường qua HTTP + tunnel.`);
    console.warn(`      (Chấm qua internet không cần cổng này. Chấm qua wifi nội bộ sẽ tạm không dùng được tới khi cổng ${HTTPS_PORT} rảnh — thường do Windows/Hyper-V/WSL giữ dải cổng. Đặt HTTPS_PORT khác trong config nếu cần.)\n`);
  });
  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    const ips = lanIPs();
    console.log(`  HTTPS (điện thoại/LAN):`);
    if (!ips.length) console.log(`     https://localhost:${HTTPS_PORT}/`);
    for (const ip of ips) console.log(`     https://${ip}:${HTTPS_PORT}/        (điện thoại mở link này)`);
    console.log(`  * Điện thoại sẽ báo "không an toàn" (chứng chỉ tự ký) → bấm Nâng cao → Tiếp tục.\n`);
  });
} else if (!H) {
  console.log(`  (Chưa có chứng chỉ HTTPS trong /certs — chạy "npm run cert" để tạo, cần cho camera/GPS trên điện thoại)\n`);
}
