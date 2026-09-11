// Tự động cập nhật phần mềm từ GitHub (repo công khai).
// Cách hoạt động: đọc package.json trên GitHub để biết bản mới nhất → so với bản đang chạy.
// Khi cập nhật: tải zip nhánh về, giải nén, chép đè server/public/package.json, khởi động lại app.
import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync, mkdirSync, rmSync, writeFileSync, readFileSync,
  readdirSync, statSync, cpSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSetting } from './db.js';
import { doBackup } from './backup.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(__dirname, '..');        // thư mục chứa code (bản cài: <install>\app ; dev: gốc repo)
const INSTALL_ROOT = join(APP_DIR, '..');     // thư mục cài (bản cài: <install> ; dev: cha của repo)

// Mặc định — có thể đổi trong Cài đặt (không cần build lại)
const DEFAULT_REPO = 'a1nhtu/chamcongcloud';
const DEFAULT_BRANCH = 'main';

// Bản cài cho khách có runtime\node.exe + ChayApp.bat (khác với môi trường dev)
export function isPackaged() {
  return existsSync(join(INSTALL_ROOT, 'runtime', 'node.exe')) || existsSync(join(INSTALL_ROOT, 'ChayApp.bat'));
}
function nodeExe() {
  const p = join(INSTALL_ROOT, 'runtime', 'node.exe');
  return existsSync(p) ? p : process.execPath;
}

export function updateConfig() {
  const repo = (getSetting('update_repo', DEFAULT_REPO) || DEFAULT_REPO).trim();
  const branch = (getSetting('update_branch', DEFAULT_BRANCH) || DEFAULT_BRANCH).trim();
  return { repo, branch };
}

export function currentVersion() {
  try { return JSON.parse(readFileSync(join(APP_DIR, 'package.json'), 'utf8')).version || '0.0.0'; }
  catch { return '0.0.0'; }
}

// So sánh phiên bản kiểu 1.2.3 (số). >0 nếu a mới hơn b.
function cmpVer(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// Kiểm tra bản mới: đọc package.json trên GitHub
export async function checkUpdate() {
  const { repo, branch } = updateConfig();
  const current = currentVersion();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo))
    throw new Error('Chưa cấu hình repo GitHub (dạng owner/repo) trong Cài đặt.');

  const url = `https://raw.githubusercontent.com/${repo}/${branch}/package.json`;
  let res;
  try {
    res = await fetch(url, { headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'Digiplus-Updater' } });
  } catch { throw new Error('Không kết nối được GitHub (kiểm tra Internet).'); }
  if (res.status === 404)
    throw new Error(`Không thấy code ở ${repo} nhánh ${branch}. Kiểm tra tên repo/nhánh và đã push code lên chưa.`);
  if (!res.ok) throw new Error('GitHub trả lỗi ' + res.status);

  let latest;
  try { latest = JSON.parse(await res.text()).version; }
  catch { throw new Error('package.json trên GitHub không hợp lệ.'); }
  if (!latest) throw new Error('package.json trên GitHub thiếu "version".');

  return { current, latest, hasUpdate: cmpVer(latest, current) > 0, repo, branch };
}

// Sinh nội dung CapNhat.bat (khởi động lại app với code mới). Toàn bộ dùng đường dẫn tuyệt đối.
function buildBat({ appDir, staged, prev, workRoot, node, config, serverJs }) {
  return `@echo off
chcp 65001 >nul
title Digiplus - Dang cap nhat phan mem
cd /d "${INSTALL_ROOT}"
rem --- Doc PORT tu config.txt (can cho ca buoc kill dung cong + khoi dong lai) ---
set "PORT=8686"
if exist "${config}" for /f "usebackq tokens=1,* delims==" %%a in ("${config}") do set "%%a=%%b"
echo Dang cap nhat phan mem, vui long doi (khong tat may)...
timeout /t 3 /nobreak >nul
rem --- Dung app cu: CHI kill tien trinh Node dang giu dung PORT (khong dung Node khac) ---
for /f "tokens=*" %%p in ('powershell -NoProfile -Command "(@(Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue))[0].OwningProcess"') do taskkill /f /pid %%p >nul 2>&1
timeout /t 2 /nobreak >nul
rem --- Sao luu ban dang chay de co the khoi phuc ---
robocopy "${appDir}\\server" "${prev}\\server" /MIR /NFL /NDL /NJH /NJS /R:1 /W:1 >nul
robocopy "${appDir}\\public" "${prev}\\public" /MIR /NFL /NDL /NJH /NJS /R:1 /W:1 >nul
copy /y "${appDir}\\package.json" "${prev}\\package.json" >nul 2>&1
rem --- Chep ban moi de len ---
robocopy "${staged}\\server" "${appDir}\\server" /MIR /NFL /NDL /NJH /NJS /R:2 /W:1 >nul
robocopy "${staged}\\public" "${appDir}\\public" /MIR /NFL /NDL /NJH /NJS /R:2 /W:1 >nul
copy /y "${staged}\\package.json" "${appDir}\\package.json" >nul
if exist "${staged}\\node_modules" robocopy "${staged}\\node_modules" "${appDir}\\node_modules" /E /NFL /NDL /NJH /NJS /R:1 /W:1 >nul
rem --- Khoi dong lai app (cloudflared van chay, khong dung lai) ---
start "" /b "${node}" --no-warnings "${serverJs}"
rem --- Don dep + tu xoa an toan ---
rmdir /s /q "${workRoot}" >nul 2>&1
(goto) 2>nul & del "%~f0"
`;
}

// Thực hiện cập nhật: tải zip → giải nén → chuẩn bị → khởi động lại
export async function applyUpdate() {
  const info = await checkUpdate();
  if (!info.hasUpdate) return { ok: false, reason: 'latest', ...info };
  if (!isPackaged())
    throw new Error('Cập nhật tự động chỉ chạy trên bản cài cho khách (có runtime\\node.exe). Trên máy dev hãy dùng git pull.');

  const { repo, branch } = info;
  const workRoot = join(INSTALL_ROOT, '_update');
  rmSync(workRoot, { recursive: true, force: true });
  mkdirSync(workRoot, { recursive: true });

  // 1) Tải zip nhánh
  const zipPath = join(workRoot, 'repo.zip');
  const durl = `https://codeload.github.com/${repo}/zip/refs/heads/${branch}`;
  let res;
  try { res = await fetch(durl, { headers: { 'User-Agent': 'Digiplus-Updater' } }); }
  catch { throw new Error('Không tải được bản mới (kiểm tra Internet).'); }
  if (!res.ok) throw new Error('Tải bản mới lỗi ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error('File tải về rỗng/hỏng.');
  writeFileSync(zipPath, buf);

  // 2) Giải nén (Windows 10+ có tar bsdtar giải được zip; dự phòng PowerShell)
  const exDir = join(workRoot, 'x');
  mkdirSync(exDir, { recursive: true });
  let extracted = false;
  // Dùng bsdtar của Windows (System32\tar.exe) — giải được .zip; tránh GNU tar trong PATH
  const winTar = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  const tarBin = existsSync(winTar) ? winTar : 'tar';
  try { execFileSync(tarBin, ['-xf', zipPath, '-C', exDir], { stdio: 'ignore' }); extracted = true; } catch {}
  if (!extracted) {
    try {
      execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
        `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${exDir}' -Force`], { stdio: 'ignore' });
      extracted = true;
    } catch {}
  }
  if (!extracted) throw new Error('Không giải nén được bản cập nhật (thiếu tar & PowerShell).');

  // 3) Tìm thư mục gốc trong zip (dạng <repo>-<branch>) + kiểm tra hợp lệ
  const subs = readdirSync(exDir).map((n) => join(exDir, n)).filter((p) => statSync(p).isDirectory());
  const src = subs[0];
  if (!src || !existsSync(join(src, 'server', 'index.js')))
    throw new Error('Bản tải về không đúng cấu trúc (thiếu server/index.js). Kiểm tra repo.');

  // 4) Chuẩn bị các phần sẽ chép đè
  const staged = join(workRoot, 'staged');
  mkdirSync(staged, { recursive: true });
  cpSync(join(src, 'server'), join(staged, 'server'), { recursive: true });
  cpSync(join(src, 'public'), join(staged, 'public'), { recursive: true });
  cpSync(join(src, 'package.json'), join(staged, 'package.json'));
  if (existsSync(join(src, 'node_modules')))
    cpSync(join(src, 'node_modules'), join(staged, 'node_modules'), { recursive: true });

  // 5) Sao lưu CSDL trước khi cập nhật (an toàn)
  try { doBackup('preupdate'); } catch {}

  // 6) Ghi CapNhat.bat và chạy nền → app tự khởi động lại với code mới
  const bat = buildBat({
    appDir: APP_DIR,
    staged,
    prev: join(INSTALL_ROOT, '_prev'),
    workRoot,
    node: nodeExe(),
    config: join(INSTALL_ROOT, 'config.txt'),
    serverJs: join(APP_DIR, 'server', 'index.js'),
  });
  const batPath = join(INSTALL_ROOT, 'CapNhat.bat');
  writeFileSync(batPath, bat, 'latin1');
  const child = spawn('cmd.exe', ['/c', batPath], {
    detached: true, stdio: 'ignore', windowsHide: true, cwd: INSTALL_ROOT,
  });
  child.unref();

  return { ok: true, restarting: true, current: info.current, latest: info.latest };
}
