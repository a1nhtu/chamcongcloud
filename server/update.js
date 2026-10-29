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
import { getSetting, setSetting } from './db.js';
import { doBackup } from './backup.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(__dirname, '..');        // thư mục chứa code (bản cài: <install>\app ; dev: gốc repo)
const INSTALL_ROOT = join(APP_DIR, '..');     // thư mục cài (bản cài: <install> ; dev: cha của repo)

// Mặc định — có thể đổi trong Cài đặt (không cần build lại)
const DEFAULT_REPO = 'a1nhtu/chamcongcloud';
const DEFAULT_BRANCH = 'main';

const IS_WIN = process.platform === 'win32';

// Bản cài cho khách có runtime\node.exe + ChayApp.bat (khác với môi trường dev).
// Bản cài Linux: runtime/node + chay-app.mjs (systemd chạy, tự bật lại khi app thoát).
export function isPackaged() {
  if (!IS_WIN) return existsSync(join(INSTALL_ROOT, 'runtime', 'node')) && existsSync(join(INSTALL_ROOT, 'chay-app.mjs'));
  return existsSync(join(INSTALL_ROOT, 'runtime', 'node.exe')) || existsSync(join(INSTALL_ROOT, 'ChayApp.bat'));
}
function nodeExe() {
  const p = join(INSTALL_ROOT, 'runtime', 'node.exe');
  return existsSync(p) ? p : process.execPath;
}

// Tạo VBS khởi động lại app ẩn hoàn toàn (không hiện cửa sổ đen), giống start-hidden.vbs lúc cài.
// Node phải được chạy qua đây (không dùng "start /b") để khi bat thoát không bị Windows cấp console mới.
function writeHiddenLauncher() {
  const vbsPath = join(INSTALL_ROOT, 'restart-app.vbs');
  const serverJs = join(APP_DIR, 'server', 'index.js');
  const vbs =
    'Set sh = CreateObject("WScript.Shell")\r\n' +
    `sh.CurrentDirectory = "${INSTALL_ROOT}"\r\n` +
    `sh.Run """${nodeExe()}"" --no-warnings ""${serverJs}""", 0, False\r\n`;
  writeFileSync(vbsPath, vbs, 'latin1');
  return vbsPath;
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

  // File raw của GitHub bị lưu đệm ~5 phút (vừa đẩy bản mới mà bấm kiểm tra vẫn báo "đang dùng bản mới nhất").
  // → hỏi THÊM GitHub API (đệm ngắn hơn, nhưng giới hạn 60 lượt/giờ mỗi IP) rồi lấy số phiên bản CAO hơn;
  //   API lỗi/hết lượt thì vẫn còn kết quả từ file raw.
  // ?t= mỗi lần 1 khác → không lấy bản lưu đệm cũ của CDN (vừa phát hành mà vẫn trả số cũ)
  const url = `https://raw.githubusercontent.com/${repo}/${branch}/package.json?t=${Date.now()}`;
  const headers = { 'Cache-Control': 'no-cache', 'User-Agent': 'Digiplus-Updater' };
  const apiVersion = fetch(`https://api.github.com/repos/${repo}/contents/package.json?ref=${encodeURIComponent(branch)}`,
    { headers: { ...headers, Accept: 'application/vnd.github.raw' } })
    .then(async (r) => (r.ok ? JSON.parse(await r.text()).version || null : null)).catch(() => null);
  let res;
  try {
    res = await fetch(url, { headers });
  } catch { throw new Error('Không kết nối được GitHub (kiểm tra Internet).'); }
  if (res.status === 404)
    throw new Error(`Không thấy code ở ${repo} nhánh ${branch}. Kiểm tra tên repo/nhánh và đã push code lên chưa.`);
  if (!res.ok) throw new Error('GitHub trả lỗi ' + res.status);

  let latest;
  try { latest = JSON.parse(await res.text()).version; }
  catch { throw new Error('package.json trên GitHub không hợp lệ.'); }
  if (!latest) throw new Error('package.json trên GitHub thiếu "version".');
  const viaApi = await apiVersion;
  if (viaApi && cmpVer(viaApi, latest) > 0) latest = viaApi;

  return { current, latest, hasUpdate: cmpVer(latest, current) > 0, repo, branch };
}

// Tiến độ cập nhật cho thanh % trên giao diện (GET /admin/update/status).
// state: idle · run (tải / giải nén / chuẩn bị / sao lưu) · restart (đang thay code + khởi động lại — máy chủ sắp tắt) · error
let progress = { state: 'idle', pct: 0, step: '' };
const report = (pct, step) => { progress = { ...progress, state: 'run', pct: Math.round(pct), step }; };
export const updateStatus = () => progress;

// Sinh nội dung CapNhat.bat (khởi động lại app với code mới). Toàn bộ dùng đường dẫn tuyệt đối.
// Bat chạy trong cửa sổ console ẨN (qua CapNhat.vbs) → các lệnh con dùng chung cửa sổ ẩn đó, không bật cửa sổ đen nào.
// Chờ bằng ping thay cho timeout (timeout đứng đợi phím, người dùng phải bấm Ctrl+C).
// Ghi từng bước vào CapNhat.log (cạnh thư mục cài) — cập nhật hỏng giữa chừng thì mở file này biết hỏng ở đâu.
export function buildBat({ appDir, staged, prev, workRoot, config, vbsPath, runVbs, pid }) {
  const log = join(INSTALL_ROOT, 'CapNhat.log');
  return `@echo off
chcp 65001 >nul
cd /d "${INSTALL_ROOT}"
echo ==== %date% %time% bat dau cap nhat (pid node ${pid}) >> "${log}"
rem --- Doc PORT tu config.txt (can cho ca buoc kill dung cong + khoi dong lai) ---
set "PORT=8686"
if exist "${config}" for /f "usebackq tokens=1,* delims==" %%a in ("${config}") do set "%%a=%%b"
ping -n 4 127.0.0.1 >nul
rem --- Dung app cu: kill dung tien trinh Node dang chay (pid truyen vao) + tien trinh giu PORT (neu khac) ---
taskkill /f /pid ${pid} >> "${log}" 2>&1
for /f "tokens=*" %%p in ('powershell -NoProfile -Command "(@(Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue))[0].OwningProcess"') do if not "%%p"=="${pid}" taskkill /f /pid %%p >> "${log}" 2>&1
ping -n 3 127.0.0.1 >nul
rem --- Sao luu ban dang chay de co the khoi phuc ---
robocopy "${appDir}\\server" "${prev}\\server" /MIR /NFL /NDL /NJH /NJS /R:1 /W:1 >nul
robocopy "${appDir}\\public" "${prev}\\public" /MIR /NFL /NDL /NJH /NJS /R:1 /W:1 >nul
copy /y "${appDir}\\package.json" "${prev}\\package.json" >nul 2>&1
rem --- Chep ban moi de len ---
robocopy "${staged}\\server" "${appDir}\\server" /MIR /NFL /NDL /NJH /NJS /R:2 /W:1 >nul
echo chep server: robocopy ma %errorlevel% (0-7 = OK) >> "${log}"
robocopy "${staged}\\public" "${appDir}\\public" /MIR /NFL /NDL /NJH /NJS /R:2 /W:1 >nul
echo chep public: robocopy ma %errorlevel% (0-7 = OK) >> "${log}"
copy /y "${staged}\\package.json" "${appDir}\\package.json" >> "${log}" 2>&1
if exist "${staged}\\node_modules" robocopy "${staged}\\node_modules" "${appDir}\\node_modules" /E /NFL /NDL /NJH /NJS /R:1 /W:1 >nul
rem --- Khoi dong lai app AN (qua VBS, khong hien cua so den) ---
echo khoi dong lai >> "${log}"
wscript "${vbsPath}"
rem --- Don dep + tu xoa an toan ---
rmdir /s /q "${workRoot}" >nul 2>&1
del "${runVbs}" >nul 2>&1
(goto) 2>nul & del "%~f0"
`;
}

// Linux: lưu bản đang chạy vào _prev rồi chép bản mới đè lên app/. Lỗi giữa chừng → trả lại bản cũ.
function swapInPlaceLinux({ staged, prev }) {
  const parts = ['server', 'public', 'package.json'];
  rmSync(prev, { recursive: true, force: true });
  mkdirSync(prev, { recursive: true });
  for (const p of parts) cpSync(join(APP_DIR, p), join(prev, p), { recursive: true });
  try {
    for (const p of parts) {
      rmSync(join(APP_DIR, p), { recursive: true, force: true });
      cpSync(join(staged, p), join(APP_DIR, p), { recursive: true });
    }
    if (existsSync(join(staged, 'node_modules')))
      cpSync(join(staged, 'node_modules'), join(APP_DIR, 'node_modules'), { recursive: true });
  } catch (e) {
    for (const p of parts) {
      try { rmSync(join(APP_DIR, p), { recursive: true, force: true }); cpSync(join(prev, p), join(APP_DIR, p), { recursive: true }); } catch {}
    }
    throw new Error('Chép bản mới bị lỗi, đã giữ nguyên bản cũ: ' + e.message);
  }
}

// Bắt đầu cập nhật: kiểm tra xong là trả lời ngay, phần tải + cài chạy nền và báo tiến độ qua updateStatus().
// Màn hình đã thấy bản mới (target) mà lúc bấm GitHub lại trả số cũ đang lưu đệm → vẫn cập nhật theo target
// (trước: báo "đã ở bản mới nhất" mà không tải gì, thanh nhắc vẫn hiện — nhahanggiadinh 29/10/2026).
export function pickTarget(info, target = '') {
  const t = String(target || '').trim();
  if (info.hasUpdate || !/^\d+(\.\d+){1,3}$/.test(t) || cmpVer(t, info.current) <= 0) return info;
  return { ...info, latest: t, hasUpdate: true };
}
// Bản tải về không mới hơn bản đang chạy (GitHub chưa kịp có bản vừa phát hành) → không cài đè, báo thử lại sau
export const stagedIsNewer = (stagedVer, current) => cmpVer(stagedVer || '0', current) > 0;

export async function startUpdate(target = '') {
  // Đang chạy thật thì không chạy chồng. Trạng thái 'restart' mà tiến trình này vẫn sống quá 2 phút = bước thay code + khởi động
  // lại đã hỏng (watchdog ở applyUpdate đổi sang 'error') → cho bấm lại từ đầu. Trước đây kẹt 'restart' mãi: bấm Cập nhật
  // bao nhiêu lần cũng chỉ đứng chờ (Letefe Bistro / nhahanggiadinh 29/10/2026).
  if (updateBusy())
    return { ok: true, started: true, running: true, current: progress.current, latest: progress.latest };
  const info = pickTarget(await checkUpdate(), target);
  if (!info.hasUpdate) return { ok: false, reason: 'latest', ...info };
  if (!isPackaged())
    throw new Error('Cập nhật tự động chỉ chạy trên bản cài cho khách (có runtime\\node.exe). Trên máy dev hãy dùng git pull.');
  progress = { state: 'run', pct: 2, step: 'Đang chuẩn bị…', current: info.current, latest: info.latest };
  applyUpdate(info).catch((e) => { progress = { ...progress, state: 'error', error: e.message }; });
  return { ok: true, started: true, current: info.current, latest: info.latest };
}

// Thực hiện cập nhật: tải zip → giải nén → chuẩn bị → khởi động lại
async function applyUpdate(info) {
  const { repo, branch } = info;
  const workRoot = join(INSTALL_ROOT, '_update');
  rmSync(workRoot, { recursive: true, force: true });
  mkdirSync(workRoot, { recursive: true });

  // 1) Tải zip nhánh (5 → 60%). GitHub không báo dung lượng (chunked) → ước theo lần tải trước, lần đầu ~7 MB.
  const zipPath = join(workRoot, 'repo.zip');
  const durl = `https://codeload.github.com/${repo}/zip/refs/heads/${branch}`;
  report(4, 'Đang kết nối máy chủ cập nhật…');
  let res;
  try { res = await fetch(durl, { headers: { 'User-Agent': 'Digiplus-Updater' } }); }
  catch { throw new Error('Không tải được bản mới (kiểm tra Internet).'); }
  if (!res.ok) throw new Error('Tải bản mới lỗi ' + res.status);
  const total = Number(res.headers.get('content-length')) || Number(getSetting('update_zip_size', '0')) || 7e6;
  const chunks = [];
  let got = 0;
  try {
    for await (const c of res.body) {
      chunks.push(c); got += c.length;
      report(5 + 55 * Math.min(got / total, 0.97), `Đang tải bản ${info.latest}… ${(got / 1048576).toFixed(1)} MB`);
    }
  } catch { throw new Error('Mất kết nối khi đang tải bản mới — bấm Cập nhật lại.'); }
  const buf = Buffer.concat(chunks);
  if (buf.length < 1000) throw new Error('File tải về rỗng/hỏng.');
  writeFileSync(zipPath, buf);
  try { setSetting('update_zip_size', String(buf.length)); } catch {}

  // 2) Giải nén (Windows 10+ có tar bsdtar giải được zip; dự phòng PowerShell)
  report(62, 'Đang giải nén…');
  const exDir = join(workRoot, 'x');
  mkdirSync(exDir, { recursive: true });
  let extracted = false;
  // Dùng bsdtar của Windows (System32\tar.exe) — giải được .zip; tránh GNU tar trong PATH
  const winTar = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  // Linux: GNU tar không giải được .zip → bsdtar (libarchive-tools), dự phòng unzip
  const tarBin = !IS_WIN ? 'bsdtar' : existsSync(winTar) ? winTar : 'tar';
  try { execFileSync(tarBin, ['-xf', zipPath, '-C', exDir], { stdio: 'ignore' }); extracted = true; } catch {}
  if (!extracted && !IS_WIN) {
    try { execFileSync('unzip', ['-q', '-o', zipPath, '-d', exDir], { stdio: 'ignore' }); extracted = true; } catch {}
  }
  if (!extracted && IS_WIN) {
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
  let gotVer = '';
  try { gotVer = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8')).version || ''; } catch {}
  if (!stagedIsNewer(gotVer, info.current))
    throw new Error(`GitHub chưa kịp có bản ${info.latest} (vừa phát hành) — đợi khoảng 5 phút rồi bấm Cập nhật lại.`);
  progress = { ...progress, latest: gotVer };

  // 4) Chuẩn bị các phần sẽ chép đè
  report(72, 'Đang chuẩn bị bản mới…');
  const staged = join(workRoot, 'staged');
  mkdirSync(staged, { recursive: true });
  cpSync(join(src, 'server'), join(staged, 'server'), { recursive: true });
  cpSync(join(src, 'public'), join(staged, 'public'), { recursive: true });
  cpSync(join(src, 'package.json'), join(staged, 'package.json'));
  if (existsSync(join(src, 'node_modules')))
    cpSync(join(src, 'node_modules'), join(staged, 'node_modules'), { recursive: true });

  // 5) Sao lưu CSDL trước khi cập nhật (an toàn)
  report(80, 'Đang sao lưu dữ liệu…');
  try { doBackup('preupdate'); } catch {}

  // 6-Linux) Chép đè ngay trong tiến trình này (Linux cho thay file đang chạy) rồi thoát → systemd tự bật lại bằng code mới
  if (!IS_WIN) {
    report(88, 'Đang cài bản mới…');
    swapInPlaceLinux({ staged, prev: join(INSTALL_ROOT, '_prev') });
    rmSync(workRoot, { recursive: true, force: true });
    progress = { ...progress, state: 'restart', pct: 92, step: 'Đang khởi động lại phần mềm…' };
    setTimeout(() => process.exit(0), 1500);   // đợi giao diện kịp đọc trạng thái rồi mới thoát
    return;
  }

  // 6) Ghi CapNhat.bat + CapNhat.vbs rồi chạy ẨN → app tự khởi động lại với code mới.
  //    KHÔNG chạy thẳng cmd.exe detached: tiến trình detached không có console nên mỗi lệnh con
  //    (powershell, robocopy, taskkill…) lại tự bật 1 cửa sổ đen riêng.
  report(88, 'Đang cài bản mới…');
  const vbsPath = writeHiddenLauncher();
  const batPath = join(INSTALL_ROOT, 'CapNhat.bat');
  const runVbs = join(INSTALL_ROOT, 'CapNhat.vbs');
  const bat = buildBat({
    appDir: APP_DIR,
    staged,
    prev: join(INSTALL_ROOT, '_prev'),
    workRoot,
    config: join(INSTALL_ROOT, 'config.txt'),
    vbsPath,
    runVbs,
    pid: process.pid,
  });
  writeFileSync(batPath, bat, 'latin1');
  writeFileSync(runVbs, 'Set sh = CreateObject("WScript.Shell")\r\n' + `sh.Run "cmd /c """"${batPath}""""", 0, False\r\n`, 'latin1');
  progress = { ...progress, state: 'restart', pct: 90, step: 'Đang cài bản mới & khởi động lại phần mềm…', restartAt: Date.now() };
  const child = spawn('wscript.exe', ['//B', '//Nologo', runVbs], {
    detached: true, stdio: 'ignore', windowsHide: true, cwd: INSTALL_ROOT,
  });
  child.on('error', (e) => console.error('[update] không chạy được wscript:', e.message));
  child.unref();
  // Cập nhật chạy đúng thì tiến trình này bị CapNhat.bat tắt trong vài giây. Còn sống sau RESTART_WAIT_MS = bat không chạy /
  // không tắt được app (máy chặn wscript, phần mềm diệt virus…) → báo lỗi rõ để bấm lại, thay vì giao diện chờ mãi.
  const t = setTimeout(() => {
    console.error(`[update] sau ${RESTART_WAIT_MS / 1000} giây phần mềm vẫn chưa được khởi động lại — xem ${join(INSTALL_ROOT, 'CapNhat.log')}`);
    progress = { ...progress, state: 'error', error: 'Chưa thay được bản mới (phần mềm không tự khởi động lại). Bấm Cập nhật lại; vẫn lỗi thì khởi động lại máy tính rồi thử lại.' };
  }, RESTART_WAIT_MS);
  t.unref?.();
}
const RESTART_WAIT_MS = 120000;
export const updateBusy = (p = progress, now = Date.now()) =>
  p.state === 'run' || (p.state === 'restart' && now - (p.restartAt || 0) < RESTART_WAIT_MS);
