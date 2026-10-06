// Tự sửa phần "tự bật khi mở máy" cho bản cài của khách, chạy mỗi lần app khởi động.
// Lý do: nút Cập nhật chỉ thay server/public, KHÔNG thay các file .bat và lịch tự bật đã tạo lúc cài.
// Laptop/PC tắt máy kiểu Fast Startup mở lại không tính là "khởi động" nên lịch ONSTART cũ không chạy
// → app + tunnel không tự lên. Ở đây app tự:
//   1) ghi lại ChayApp.bat bản mới (có chống bật trùng),
//   2) thêm tự bật lúc ĐĂNG NHẬP: lịch ONLOGON nếu đủ quyền (Admin/SYSTEM), không thì shortcut Startup của user.
// File này KHÔNG import module khác của app (tools/build-package.mjs dùng chung CHAY_APP_BAT).
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INSTALL_ROOT = join(__dirname, '..', '..');   // bản cài: <install>\app\server → <install>

// Nội dung ChayApp.bat (nguồn DUY NHẤT — bộ cài cũng lấy từ đây)
export const CHAY_APP_BAT = String.raw`@echo off
cd /d "%~dp0"
set "PORT=8686"
set "TUNNEL_TOKEN="
for /f "usebackq tokens=1,* delims==" %%a in ("%~dp0config.txt") do set "%%a=%%b"
rem --- App da chay (cong dang nghe) thi THOI: auto-start goi ca luc khoi dong lan luc dang nhap, khong bat trung ---
powershell -NoProfile -Command "if(@(Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue).Count -gt 0){exit 1}else{exit 0}" >nul 2>&1
if errorlevel 1 exit /b
start "" /b "%~dp0runtime\node.exe" --no-warnings "%~dp0app\server\index.js"
if not "%TUNNEL_TOKEN%"=="" start "" /b "%~dp0cloudflared.exe" tunnel run --token %TUNNEL_TOKEN%
`;

const run = (file, args) => new Promise((resolve) => {
  execFile(file, args, { windowsHide: true, timeout: 30000 }, (err) => resolve(!err));
});
const psQuote = (s) => "'" + String(s).replace(/'/g, "''") + "'";

// opts chỉ dùng khi thử nghiệm: { root, port, startupDir, skipTask }
export async function ensureAutostart(opts = {}) {
  const root = opts.root || INSTALL_ROOT;
  const port = String(opts.port || process.env.PORT || 8686);
  const vbs = join(root, 'start-hidden.vbs');
  // Chỉ làm trên BẢN CÀI của khách (có runtime\node.exe + start-hidden.vbs); máy dev thì bỏ qua
  if (process.platform !== 'win32' || !existsSync(join(root, 'runtime', 'node.exe')) || !existsSync(vbs)) return { skipped: true };
  const out = { bat: false, task: false, shortcut: false };

  // 1) ChayApp.bat bản mới (chống bật trùng) — phải có trước khi thêm đường tự bật thứ hai
  try {
    const batPath = join(root, 'ChayApp.bat');
    const cur = existsSync(batPath) ? readFileSync(batPath, 'latin1').replace(/\r\n/g, '\n') : '';
    if (cur !== CHAY_APP_BAT) { writeFileSync(batPath, CHAY_APP_BAT, 'latin1'); out.bat = true; }
  } catch (e) { console.error('[autostart] không ghi được ChayApp.bat:', e.message); return out; }

  // 2a) Lịch tự bật lúc ĐĂNG NHẬP (cần quyền Admin/SYSTEM). Có rồi thì thôi.
  const taskName = `Digiplus-${port}-logon`;
  if (!opts.skipTask) {
    out.task = await run('schtasks', ['/Query', '/TN', taskName]);
    if (!out.task) {
      out.task = await run('schtasks', ['/Create', '/TN', taskName, '/TR', `wscript.exe "${vbs}"`,
        '/SC', 'ONLOGON', '/DELAY', '0000:30', '/RU', 'SYSTEM', '/RL', 'HIGHEST', '/F']);
      if (out.task) {
        // Windows mặc định không chạy lịch khi laptop dùng pin → bỏ giới hạn đó (cả lịch ONSTART cũ)
        await run('powershell', ['-NoProfile', '-Command',
          `foreach($n in 'Digiplus-${port}','${taskName}'){ try { $t=Get-ScheduledTask -TaskName $n -ErrorAction Stop; ` +
          `$t.Settings.DisallowStartIfOnBatteries=$false; $t.Settings.StopIfGoingOnBatteries=$false; Set-ScheduledTask -InputObject $t | Out-Null } catch {} }`]);
        console.log(`  [autostart] Đã thêm lịch tự bật khi đăng nhập (${taskName}).`);
      }
    }
  }

  // 2b) Không đủ quyền tạo lịch → shortcut trong thư mục Startup của user đang chạy app (không cần Admin)
  if (!out.task) {
    const dirExpr = opts.startupDir ? psQuote(opts.startupDir) : "[Environment]::GetFolderPath('Startup')";
    out.shortcut = await run('powershell', ['-NoProfile', '-Command',
      `$d=${dirExpr}; if(-not $d){exit 1}; $p=Join-Path $d 'DigiplusChamCong-${port}.lnk'; ` +
      `if(-not (Test-Path $p)){ $w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut($p); ` +
      `$s.TargetPath=${psQuote(vbs)}; $s.WorkingDirectory=${psQuote(root)}; $s.Save() }; exit 0`]);
    if (out.shortcut) console.log('  [autostart] Đã bảo đảm shortcut tự bật khi đăng nhập (thư mục Startup).');
    else console.error('  [autostart] Không tạo được tự bật khi đăng nhập — chạy lại CaiDat.bat bằng quyền Admin.');
  }
  return out;
}
