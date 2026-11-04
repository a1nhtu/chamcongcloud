// CHUYỂN PHẦN MỀM SANG MÁY TÍNH KHÁC — phía MÁY CŨ (Anh chốt "Tự cấp lại" 04/11/2026).
// Trước đây khách phải: chạy GoCaiDat.bat → nén cả thư mục → chép sang máy mới → giải nén ĐÚNG đường dẫn cũ → CaiDat.bat
// → gửi Mã máy mới cho Digiplus cấp lại license. Nay:
//   Máy cũ: Cài đặt › Sao lưu › "Chuyển sang máy khác" → 1 file ChuyenMay-<khách>-<ngày>.zip
//           (CSDL + ảnh + giấy tờ NV + config.txt + license.key) → bấm tắt → phần mềm + tunnel máy cũ tắt hẳn.
//   Máy mới: Setup.exe › "Chuyển từ máy cũ" › chọn file (thư mục cài nào cũng được) → phần mềm tự nhận dữ liệu
//           và tự xin license mới cho máy mới, giữ hạn + số NV (chuyen-may-nhan.js + /api/chuyen-may trên máy chủ Digiplus).
// Chỉ bản cài Windows 1 công ty (không phải máy chủ nhiều công ty).
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, dataDir, dbPath, getSetting } from './db.js';
import { winTar } from './backup.js';
import { appRoot, MULTI } from './tenant.js';
import { machineId } from './license.js';
import { currentVersion } from './update.js';
import { userError } from './util.js';
import { movingOut, setMoving } from './move-flag.js';

const run = promisify(execFile);
const INSTALL_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');   // <install>\app\server → <install>
// Dấu "đã chuyển": ChayApp.bat thấy file này thì không bật lại phần mềm / tunnel trên máy cũ (lịch gác 5 phút, lịch đăng nhập…).
// CaiDat.bat (cài lại trên chính máy này) xoá dấu.
export const MOVED_MARKER = 'DA-CHUYEN-MAY.txt';

const pad = (n) => String(n).padStart(2, '0');
function vnStamp(d = new Date()) {
  const t = new Date(d.getTime() + 7 * 3600000);
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}-${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}`;
}

// Máy này dùng được chức năng không + trạng thái đang chuyển (để trang mở lại vẫn thấy file đã tạo)
export function moveInfo(root = INSTALL_ROOT) {
  if (MULTI) return { available: false, reason: 'Máy chủ nhiều công ty không dùng chức năng này.' };
  if (process.platform !== 'win32' || !existsSync(join(root, 'runtime', 'node.exe')) || !existsSync(join(root, 'config.txt')))
    return { available: false, reason: 'Chỉ dùng trên bản cài Windows tại máy khách (máy này không phải bản cài).' };
  const m = movingOut();
  return {
    available: true, customer: process.env.CUSTOMER || '', port: process.env.PORT || '', domain: !!process.env.TUNNEL_TOKEN,
    busy: !!(m && m.busy), error: lastError,
    pending: m && m.path ? { name: m.name, size: m.size, path: m.path, token: m.token, at: m.at } : null,
  };
}

// Nút "Chuyển sang máy khác": chạy nền rồi trả lời ngay (nén nhiều ảnh có thể lâu hơn 100 giây — quá giới hạn chờ của Cloudflare
// khi vào qua tên miền). Trang hỏi lại GET /backup/chuyen-may tới khi xong. Cờ chặn + chụp CSDL đã làm xong TRƯỚC khi trả lời.
let lastError = '';
export function startMovePackage(root = INSTALL_ROOT) {
  const info = moveInfo(root);
  if (!info.available) throw userError(info.reason);
  if (info.busy) return { started: false, busy: true };
  lastError = '';
  createMovePackage(root).catch((e) => { lastError = e.message; });
  return { started: true };
}

// Bước 1: CHẶN nhận dữ liệu mới rồi chụp dữ liệu → file .zip đặt ngay trong thư mục cài của máy cũ.
export async function createMovePackage(root = INSTALL_ROOT) {
  const info = moveInfo(root);
  if (!info.available) throw userError(info.reason);
  const prev = movingOut();
  if (prev && prev.busy) throw userError('Đang đóng file chuyển máy, chờ chút…');
  if (prev && prev.path) { try { rmSync(prev.path, { force: true }); } catch {} }
  // Chặn TRƯỚC khi chụp CSDL: lượt chấm tới sau lúc chụp sẽ không có trong file (máy chấm công tự gửi lại cho máy mới)
  const s = setMoving({ at: new Date().toISOString(), token: randomBytes(16).toString('hex'), busy: true });
  const cust = info.customer || 'LAN';
  const name = `ChuyenMay-${cust}-${vnStamp()}.zip`;
  const dest = join(root, name);
  const stage = join(dataDir(), '_chuyen_may_' + Date.now());
  try {
    mkdirSync(stage, { recursive: true });
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {}
    copyFileSync(dbPath(), join(stage, 'digiplus.db'));   // copy trước: tar đọc thẳng file CSDL đang mở bị "Permission denied"
    const files = ['digiplus.db', 'chuyen-may.json'];
    writeFileSync(join(stage, 'chuyen-may.json'), JSON.stringify({
      v: 1, at: s.at, customer: info.customer, port: info.port, from: machineId(), version: currentVersion(),
      company: getSetting('company_name', ''),
    }, null, 2));
    if (existsSync(join(root, 'config.txt'))) { copyFileSync(join(root, 'config.txt'), join(stage, 'config.txt')); files.push('config.txt'); }
    const lic = join(dataDir(), 'license.key');
    if (existsSync(lic)) { copyFileSync(lic, join(stage, 'license.key')); files.push('license.key'); }
    const args = ['--format', 'zip', '-cf', dest, '-C', stage, ...files];
    if (existsSync(join(appRoot(), 'uploads'))) args.push('-C', appRoot(), 'uploads');      // ảnh chấm công + logo
    if (existsSync(join(dataDir(), 'hr-files'))) args.push('-C', dataDir(), 'hr-files');    // giấy tờ nhân sự
    if (existsSync(dest)) rmSync(dest, { force: true });
    await run(winTar(), args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });   // không chặn máy chủ trong lúc nén ảnh
    const size = statSync(dest).size;
    if (!size) throw new Error('file rỗng');
    Object.assign(s, { name, path: dest, size, busy: false });
    console.log(`  [chuyen-may] Đã đóng file chuyển máy ${dest} (${Math.round(size / 1048576)} MB). Tạm dừng nhận dữ liệu mới.`);
    return { name, path: dest, size, token: s.token };
  } catch (e) {
    setMoving(null);
    try { rmSync(dest, { force: true }); } catch {}
    console.error('  [chuyen-may] Lỗi đóng file chuyển máy:', e.message);
    throw userError('Không đóng được file chuyển máy: ' + e.message);
  } finally { rmSync(stage, { recursive: true, force: true }); }
}

// Huỷ: dùng tiếp máy này như cũ (xoá file đã tạo, nhận dữ liệu lại)
export function cancelMove() {
  lastError = '';
  const s = movingOut();
  if (s && s.path) { try { rmSync(s.path, { force: true }); } catch {} }
  setMoving(null);
  return { ok: true };
}

// Tắt hẳn phần mềm + tunnel của THƯ MỤC NÀY (khách khác trên cùng máy không ảnh hưởng), gỡ tự bật nếu đủ quyền.
// Tunnel máy cũ PHẢI tắt: 2 máy cùng token thì Cloudflare chia yêu cầu cho cả 2 → máy mới chập chờn.
export function stopScript(root, port, token) {
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  return [
    `foreach($n in 'Digiplus-${port}','Digiplus-${port}-logon','Digiplus-${port}-watch'){ schtasks /Delete /TN $n /F 2>$null | Out-Null }`,
    `Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Startup')) 'DigiplusChamCong-${port}.lnk') -Force -ErrorAction SilentlyContinue`,
    `$d=${q(root.endsWith('\\') ? root : root + '\\')}; $tk=${q(token || '')}`,
    `@(Get-WmiObject Win32_Process | Where-Object { $_.Name -eq 'cloudflared.exe' -and (($_.ExecutablePath -and $_.ExecutablePath.StartsWith($d,'OrdinalIgnoreCase')) -or ($tk -and $_.CommandLine -and $_.CommandLine.Contains($tk))) }) | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
  ].join('; ');
}

// Bước 2 (sau khi đã lấy được file): đánh dấu đã chuyển, cất license, tắt tunnel + phần mềm máy cũ.
export function finishMove(root = INSTALL_ROOT, { exit = true, data = dataDir() } = {}) {
  const s = movingOut();
  if (!s || !s.path || !existsSync(s.path)) throw userError('Chưa có file chuyển máy (hoặc đã quá 2 giờ). Bấm "Chuyển sang máy khác" để tạo lại.');
  const port = process.env.PORT || '8686';
  writeFileSync(join(root, MOVED_MARKER), [
    `Phan mem cong ${port} da chuyen sang may khac luc ${s.at} (file ${s.name}).`,
    'May nay se KHONG tu bat lai phan mem / tunnel nua.',
    'Muon dung lai tren may nay: chay CaiDat.bat (hoac bo cai Setup.exe) - lien he Digiplus de cap lai ban quyen.',
  ].join('\r\n') + '\r\n');
  // License máy cũ: đổi tên (không xoá — phòng khi cần tra lại), máy cũ không còn chạy được
  const lic = join(data, 'license.key');
  if (existsSync(lic)) { try { rmSync(lic + '.da-chuyen-may', { force: true }); renameSync(lic, lic + '.da-chuyen-may'); } catch (e) { console.error('  [chuyen-may] Không cất được license:', e.message); } }
  console.log(`  [chuyen-may] Đã chuyển sang máy khác (file ${s.name}). Tắt tunnel + phần mềm trên máy này.`);
  if (exit) {
    // trả lời trang trước rồi mới tắt (người dùng có thể đang vào qua tên miền = qua chính tunnel này)
    setTimeout(() => {
      execFile('powershell', ['-NoProfile', '-Command', stopScript(root, port, process.env.TUNNEL_TOKEN)], { windowsHide: true, timeout: 30000 },
        () => process.exit(0));
    }, 1000);
  }
  return { ok: true, name: s.name, path: s.path };
}

// Tải file chuyển máy bằng link thường (file có thể vài trăm MB — trình duyệt tự hiện tiến trình tải).
// Link có mã ngẫu nhiên, chỉ sống trong lúc đang chuyển.
export function moveDownload(req, res) {
  const s = movingOut();
  const k = String(req.query.k || '');
  if (!s || !s.path || !s.token || k.length !== s.token.length || k !== s.token || !existsSync(s.path))
    return res.status(404).json({ error: 'Link tải file chuyển máy không còn dùng được — mở lại trang Sao lưu.' });
  res.download(s.path, s.name);
}

// Đang chuyển: chặn mọi đường ghi dữ liệu mới. Máy chấm công nhận 503 → tự giữ lượt chấm, gửi lại sau (sang máy mới).
const DEVICE_PATH = /^\/(iclock|cdata|getrequest|devicecmd|querydata|hik)(\/|$)/i;
export function moveGuard(req, res, next) {
  if (!movingOut()) return next();
  const p = req.path;
  if (DEVICE_PATH.test(p)) return res.status(503).type('text/plain').send('MOVING');
  const write = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
  if (write && p.startsWith('/api/') && !p.startsWith('/api/admin/backup/chuyen-may') && !p.startsWith('/api/auth/') && !p.startsWith('/api/license/'))
    return res.status(503).json({ error: 'Phần mềm đang chuyển sang máy tính khác — tạm chưa nhận dữ liệu mới. Vui lòng thử lại sau ít phút.' });
  next();
}
