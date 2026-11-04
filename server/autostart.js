// Tự sửa phần "tự bật khi mở máy" cho bản cài của khách, chạy mỗi lần app khởi động.
// Lý do: nút Cập nhật chỉ thay server/public, KHÔNG thay các file .bat và lịch tự bật đã tạo lúc cài.
// Laptop/PC tắt máy kiểu Fast Startup mở lại không tính là "khởi động" nên lịch ONSTART cũ không chạy
// → app + tunnel không tự lên. Ở đây app tự:
//   1) ghi lại ChayApp.bat bản mới (có chống bật trùng),
//   2) thêm tự bật lúc ĐĂNG NHẬP: lịch ONLOGON nếu đủ quyền (Admin/SYSTEM), không thì shortcut Startup của user,
//   3) lịch GÁC 5 phút/lần: app / tunnel chết giữa chừng thì tự bật lại.
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
set "DGP_DIR=%~dp0"
rem --- Kiem tra RIENG tung phan, phan nao chua chay thi bat phan do (khong bat trung, ma cung khong bo sot tunnel) ---
rem 1) Phan mem: chi bat khi cong chua nghe VA khong dang cap nhat (CapNhat.bat moi ghi duoi 3 phut = dang chep code moi, bat cap nhat tu bat lai)
powershell -NoProfile -Command "if(@(Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue).Count -gt 0){exit 1}; $b=Get-Item -LiteralPath (Join-Path $env:DGP_DIR 'CapNhat.bat') -ErrorAction SilentlyContinue; if($b -and $b.LastWriteTime -gt (Get-Date).AddMinutes(-3)){exit 1}; exit 0" >nul 2>&1
if not errorlevel 1 start "" /b "%~dp0runtime\node.exe" --no-warnings "%~dp0app\server\index.js"
rem 2) Tunnel: chi bat khi cloudflared cua CHINH thu muc nay chua chay (khach khac tren cung VPS khong anh huong)
if "%TUNNEL_TOKEN%"=="" exit /b
set "CF_EXE=%~dp0cloudflared.exe"
powershell -NoProfile -Command "if(@(Get-Process cloudflared -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $env:CF_EXE }).Count -gt 0){exit 1}else{exit 0}" >nul 2>&1
if not errorlevel 1 start "" /b "%~dp0cloudflared.exe" tunnel run --token %TUNNEL_TOKEN%
`;

// Nội dung GoCaiDat.bat (nguồn DUY NHẤT — bộ cài cũng lấy từ đây; trình gỡ cài đặt gọi file này).
// App tự ghi lại file khi khởi động: bản cài trước 9/10/2026 có GoCaiDat KHÔNG tắt cloudflared, gỡ xong node tắt mà tunnel còn
// → tên miền lỗi 502 tới khi khởi động lại máy cũ. CHỈ tắt theo thư mục này + token này, khách khác trên cùng VPS không ảnh hưởng.
// Có nhãn goto nên dùng CRLF (cmd đọc nhãn trong file chỉ có LF dễ trượt).
export const GO_CAI_DAT_BAT = String.raw`@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Tham so: silent = trinh go cai dat goi (da co quyen Admin, khong pause)
set "SILENT="
if /i "%~1"=="silent" set "SILENT=1"
if defined SILENT goto main
net session >nul 2>&1
if %errorlevel%==0 goto main
powershell -NoProfile -Command "try { Start-Process -FilePath '%~f0' -Verb RunAs; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel%==0 exit /b
echo !! Can quyen Admin moi go duoc. Chuot phai file nay, chon Run as administrator.
pause
exit /b 1
:main
set "PORT=8686"
set "TUNNEL_TOKEN="
for /f "usebackq tokens=1,* delims==" %%a in ("%~dp0config.txt") do set "%%a=%%b"
echo Dang go cai dat instance cong %PORT% (KHONG dung khach khac tren may/VPS)...
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\DigiplusChamCong-%PORT%.lnk" 2>nul
schtasks /Delete /TN "Digiplus-%PORT%" /F >nul 2>&1
schtasks /Delete /TN "Digiplus-%PORT%-logon" /F >nul 2>&1
schtasks /Delete /TN "Digiplus-%PORT%-watch" /F >nul 2>&1
netsh advfirewall firewall delete rule name=all program="%~dp0runtime\node.exe" >nul 2>&1
netsh advfirewall firewall delete rule name="Digiplus Union 9870" >nul 2>&1
for /f "tokens=*" %%p in ('powershell -NoProfile -Command "(@(Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue))[0].OwningProcess"') do taskkill /f /pid %%p >nul 2>&1
rem Tat node + cloudflared cua CHINH thu muc nay; cloudflared con nhan theo token (phong khi thu muc da doi ten / doi cho)
set "DGP_DIR=%~dp0"
powershell -NoProfile -Command "$m={ @(Get-WmiObject Win32_Process | Where-Object { ($_.Name -eq 'node.exe' -or $_.Name -eq 'cloudflared.exe') -and (($_.ExecutablePath -and $_.ExecutablePath.StartsWith($env:DGP_DIR,'OrdinalIgnoreCase')) -or ($env:TUNNEL_TOKEN -and $_.Name -eq 'cloudflared.exe' -and $_.CommandLine -and $_.CommandLine.Contains($env:TUNNEL_TOKEN))) }) }; foreach($p in (& $m)){ Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Sleep -Seconds 2; if((& $m).Count -gt 0){exit 1}else{exit 0}" >nul 2>&1
set "CON="
if errorlevel 1 set "CON=1"
schtasks /Query /TN "Digiplus-%PORT%" >nul 2>&1 && set "CON=1"
schtasks /Query /TN "Digiplus-%PORT%-logon" >nul 2>&1 && set "CON=1"
schtasks /Query /TN "Digiplus-%PORT%-watch" >nul 2>&1 && set "CON=1"
if defined CON echo !! CHUA GO HET phan mem cong %PORT%. Hay khoi dong lai may tinh roi chay lai file nay bang Run as administrator.
if not defined CON echo Da go tu bat, da tat phan mem va tunnel cong %PORT%.
echo Du lieu trong app\data va app\uploads van con.
if defined SILENT exit /b 0
pause
`.replace(/\r?\n/g, '\r\n');

const run = (file, args) => new Promise((resolve) => {
  execFile(file, args, { windowsHide: true, timeout: 30000 }, (err) => resolve(!err));
});
const psQuote = (s) => "'" + String(s).replace(/'/g, "''") + "'";

// Lịch GÁC 5 phút/lần (xem bước 3 của ensureAutostart). system = đủ quyền → chạy bằng SYSTEM (cả khi chưa ai đăng nhập);
// không đủ quyền → lịch của chính user đang chạy app (Windows cho tạo không cần Admin, chạy khi user đăng nhập).
export const WATCH_EVERY_MIN = 5;
export const watchTaskName = (port) => `Digiplus-${port}-watch`;
export const watchTaskArgs = (name, vbs, system) => [
  '/Create', '/TN', name, '/TR', `wscript.exe "${vbs}"`, '/SC', 'MINUTE', '/MO', String(WATCH_EVERY_MIN), '/F',
  ...(system ? ['/RU', 'SYSTEM', '/RL', 'HIGHEST'] : []),
];

// opts chỉ dùng khi thử nghiệm: { root, port, startupDir, skipTask }
export async function ensureAutostart(opts = {}) {
  const root = opts.root || INSTALL_ROOT;
  const port = String(opts.port || process.env.PORT || 8686);
  const vbs = join(root, 'start-hidden.vbs');
  // Chỉ làm trên BẢN CÀI của khách (có runtime\node.exe + start-hidden.vbs); máy dev thì bỏ qua
  if (process.platform !== 'win32' || !existsSync(join(root, 'runtime', 'node.exe')) || !existsSync(vbs)) return { skipped: true };
  const out = { bat: false, go: false, task: false, shortcut: false };

  // 1) ChayApp.bat bản mới (chống bật trùng) — phải có trước khi thêm đường tự bật thứ hai
  try {
    const batPath = join(root, 'ChayApp.bat');
    const cur = existsSync(batPath) ? readFileSync(batPath, 'latin1').replace(/\r\n/g, '\n') : '';
    if (cur !== CHAY_APP_BAT) { writeFileSync(batPath, CHAY_APP_BAT, 'latin1'); out.bat = true; }
  } catch (e) { console.error('[autostart] không ghi được ChayApp.bat:', e.message); return out; }
  // GoCaiDat.bat bản mới (nút Cập nhật không thay file này, trình gỡ cài đặt lại gọi nó)
  try {
    const goPath = join(root, 'GoCaiDat.bat');
    const cur = existsSync(goPath) ? readFileSync(goPath, 'latin1') : '';
    if (cur !== GO_CAI_DAT_BAT) { writeFileSync(goPath, GO_CAI_DAT_BAT, 'latin1'); out.go = true; }
  } catch (e) { console.error('[autostart] không ghi được GoCaiDat.bat:', e.message); }

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

  // 3) GÁC 5 PHÚT: app / tunnel chết giữa chừng (phần mềm diệt virus tắt, lỗi…) trước đây không có gì bật lại — 3svina
  //    04/11/2026 app tắt từ đầu giờ chiều, tối mới biết (tên miền lỗi 502). Lịch chạy start-hidden.vbs 5 phút/lần →
  //    ChayApp.bat bật lại phần nào đã tắt; đang chạy thì thôi; đang cập nhật (CapNhat.bat vừa ghi) thì chờ.
  //    Gỡ cài đặt (GoCaiDat.bat) xoá lịch này cùng 2 lịch kia.
  if (!opts.skipTask) {
    const watch = watchTaskName(port);
    out.watch = await run('schtasks', ['/Query', '/TN', watch]);
    if (!out.watch) {
      out.watch = (await run('schtasks', watchTaskArgs(watch, vbs, true))) || (await run('schtasks', watchTaskArgs(watch, vbs, false)));
      if (out.watch) {
        await run('powershell', ['-NoProfile', '-Command',
          `try { $t=Get-ScheduledTask -TaskName '${watch}' -ErrorAction Stop; $t.Settings.DisallowStartIfOnBatteries=$false; ` +
          `$t.Settings.StopIfGoingOnBatteries=$false; Set-ScheduledTask -InputObject $t | Out-Null } catch {}`]);
        console.log(`  [autostart] Đã thêm lịch tự kiểm ${WATCH_EVERY_MIN} phút/lần (${watch}): phần mềm / tunnel tắt thì tự bật lại.`);
      } else console.error(`  [autostart] Không tạo được lịch tự kiểm ${watch} — phần mềm tắt giữa chừng sẽ không tự bật lại.`);
    }
  }
  return out;
}
