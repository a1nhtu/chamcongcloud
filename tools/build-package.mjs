// Đóng gói bộ cài cho khách: gói kèm Node + cloudflared + app + launcher tự chạy.
// Dùng: node tools/build-package.mjs
import { cpSync, mkdirSync, writeFileSync, rmSync, existsSync, copyFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist-khach', 'DigiplusChamCong');
const APP = join(OUT, 'app');

console.log('Dọn thư mục đóng gói...');
rmSync(join(ROOT, 'dist-khach'), { recursive: true, force: true });
mkdirSync(join(OUT, 'runtime'), { recursive: true });
mkdirSync(APP, { recursive: true });

// Node di động
const nodeExe = process.execPath;
console.log('Copy Node runtime:', nodeExe);
copyFileSync(nodeExe, join(OUT, 'runtime', 'node.exe'));

// cloudflared
const cf = join(ROOT, 'tools', 'cloudflared.exe');
if (existsSync(cf)) copyFileSync(cf, join(OUT, 'cloudflared.exe'));
else console.warn('CẢNH BÁO: chưa có tools/cloudflared.exe');

// App: server, public, node_modules, package.json (KHÔNG copy data/uploads/certs/tools/.git)
console.log('Copy app...');
cpSync(join(ROOT, 'server'), join(APP, 'server'), { recursive: true });
cpSync(join(ROOT, 'public'), join(APP, 'public'), { recursive: true });
cpSync(join(ROOT, 'node_modules'), join(APP, 'node_modules'), { recursive: true });
copyFileSync(join(ROOT, 'package.json'), join(APP, 'package.json'));

// config.txt (Anh điền TUNNEL_TOKEN cho từng khách) — tự nhúng TÀI KHOẢN TỔNG nếu đã cấu hình
let masterLines = '# MASTER_USER=...\n# MASTER_HASH=...   (tao bang: node tools/make-master.mjs <user> <pass>)\n';
const masterEnv = join(ROOT, 'tools', 'master.env');
if (existsSync(masterEnv)) { masterLines = readFileSync(masterEnv, 'utf8').trim() + '\n'; console.log('  + Da nhung TAI KHOAN TONG tu tools/master.env'); }
writeFileSync(join(OUT, 'config.txt'),
`PORT=8686
CUSTOMER=
TUNNEL_TOKEN=
${masterLines}`);

// Launcher chạy ẩn (không hiện cửa sổ đen)
writeFileSync(join(OUT, 'start-hidden.vbs'),
`Set fso = CreateObject("Scripting.FileSystemObject")
d = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = d
sh.Run """" & d & "\\ChayApp.bat""", 0, False
`);

// ChayApp.bat: đọc config, chạy node + tunnel
writeFileSync(join(OUT, 'ChayApp.bat'),
`@echo off
cd /d "%~dp0"
set "PORT=8686"
set "TUNNEL_TOKEN="
for /f "usebackq tokens=1,* delims==" %%a in ("%~dp0config.txt") do set "%%a=%%b"
start "" /b "%~dp0runtime\\node.exe" --no-warnings "%~dp0app\\server\\index.js"
if not "%TUNNEL_TOKEN%"=="" start "" /b "%~dp0cloudflared.exe" tunnel run --token %TUNNEL_TOKEN%
`);

// KiemTra-Tunnel.bat: chạy cloudflared FOREGROUND để xem log/chẩn đoán khi domain lỗi 1033
writeFileSync(join(OUT, 'KiemTra-Tunnel.bat'),
`@echo off
chcp 65001 >nul
title Kiem tra Tunnel - hien log cloudflared
cd /d "%~dp0"
if not exist "%~dp0cloudflared.exe" (echo !! KHONG THAY cloudflared.exe - co the bi Antivirus xoa. & pause & exit /b)
set "TUNNEL_TOKEN="
for /f "usebackq tokens=1,* delims==" %%a in ("%~dp0config.txt") do set "%%a=%%b"
if "%TUNNEL_TOKEN%"=="" (echo !! config.txt CHUA co TUNNEL_TOKEN. & pause & exit /b)
echo Dang chay cloudflared de xem log... (thay "Registered tunnel connection" = OK; Ctrl+C de dung)
echo.
"%~dp0cloudflared.exe" tunnel run --token %TUNNEL_TOKEN%
pause
`);

// CaiDat.bat: tạo autostart + chạy + mở trình duyệt
// Shortcut autostart đặt tên THEO CỔNG (DigiplusChamCong-<PORT>.lnk) → chạy nhiều khách
// trên cùng 1 VPS không đè autostart của nhau.
writeFileSync(join(OUT, 'CaiDat.bat'),
`@echo off
chcp 65001 >nul
title Cai dat Digiplus Cham Cong
echo ============================================
echo   DIGIPLUS CHAM CONG - CAI DAT
echo ============================================
echo.
set "PORT=8686"
for /f "usebackq tokens=1,* delims==" %%a in ("%~dp0config.txt") do set "%%a=%%b"
echo Dang cai dat va tao tu dong chay khi mo may (cong %PORT%)...
powershell -NoProfile -Command "$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut([Environment]::GetFolderPath('Startup')+'\\DigiplusChamCong-%PORT%.lnk'); $s.TargetPath='%~dp0start-hidden.vbs'; $s.WorkingDirectory='%~dp0'; $s.Save()"
echo Dang khoi dong ung dung...
start "" "%~dp0start-hidden.vbs"
timeout /t 4 >nul
start "" "http://localhost:%PORT%/admin"
echo.
echo ============================================
echo   CAI DAT XONG!
echo   - App da chay va tu bat khi mo may.
echo   - Trinh duyet vua mo trang quan ly.
echo   - Lan dau: nhap MA MAY gui cho Digiplus de lay license.
echo ============================================
echo.
pause
`);

// GoCaiDat.bat: gỡ autostart + dừng — CHỈ tắt instance của CỔNG này
// (an toàn khi nhiều khách chạy chung 1 VPS: KHONG taskkill node/cloudflared tong the).
writeFileSync(join(OUT, 'GoCaiDat.bat'),
`@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PORT=8686"
for /f "usebackq tokens=1,* delims==" %%a in ("%~dp0config.txt") do set "%%a=%%b"
echo Dang go cai dat instance cong %PORT% (KHONG dung khach khac tren may/VPS)...
del "%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\DigiplusChamCong-%PORT%.lnk" 2>nul
for /f "tokens=*" %%p in ('powershell -NoProfile -Command "(@(Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue))[0].OwningProcess"') do taskkill /f /pid %%p >nul 2>&1
echo Da go autostart + dung app cong %PORT%.
echo LUU Y: neu chay nhieu khach tren 1 VPS, cloudflared cua khach nay van chay -
echo        dong cua so cloudflared tuong ung, hoac reboot may. KHONG taskkill cloudflared tong the.
echo Du lieu trong app\\data va app\\uploads van con.
pause
`);

// Hướng dẫn cho khách (UTF-8 tiếng Việt)
writeFileSync(join(OUT, 'HUONG-DAN.txt'),
`DIGIPLUS CHẤM CÔNG — HƯỚNG DẪN CÀI ĐẶT
========================================

1. Giải nén thư mục này ra ổ đĩa (VD: C:\\DigiplusChamCong). KHÔNG để trong thư mục tạm.

2. Double-click "CaiDat.bat".
   - Ứng dụng sẽ tự cài, tự chạy, và tự bật mỗi khi mở máy.
   - Trình duyệt sẽ mở trang quản lý.

3. LẦN ĐẦU cần KÍCH HOẠT BẢN QUYỀN:
   - Màn hình sẽ hiện "Mã máy" của bạn.
   - Gửi Mã máy đó cho Digiplus (kèm thông tin mua) để nhận license.
   - Dán license vào ô kích hoạt → xong.

4. Đăng nhập quản lý mặc định: admin / admin123 (đổi mật khẩu ngay trong Cài đặt).
   Nhân viên chấm công mở app trên điện thoại theo địa chỉ Digiplus cấp.

LƯU Ý:
- Máy tính cài app phải BẬT khi cần chấm công.
- Sao lưu dữ liệu: copy 2 thư mục app\\data và app\\uploads.
- Gỡ cài đặt: chạy "GoCaiDat.bat".

Hỗ trợ: Digiplus.
`);

// Ghi chú cho Anh (không đưa khách — nhắc cấu hình token)
writeFileSync(join(ROOT, 'dist-khach', 'DOC-CHO-ANH.txt'),
`GHI CHÚ CHO ANH (KHÔNG gửi khách)
=================================
Quy trình ĐẦY ĐỦ: xem file QUY-TRINH-BAN-KHACH.txt. Tóm tắt nhanh:

TẠO 1 KHÁCH (TỰ ĐỘNG — không cần vào Cloudflare bằng tay nữa):
1. Build-BoCai.bat (chỉ khi vừa nâng cấp phần mềm) → đóng gói bản MỚI NHẤT.
2. Tao-Khach.bat → gõ tên cty (không dấu) → chọn chế độ:
     1 = cài tại VĂN PHÒNG KHÁCH (cổng 8686).
     2 = chạy trên VPS bên Anh → NHẬP CỔNG (nhiều khách/1 VPS phải khác cổng).
   → Tool tự tạo domain + tunnel + token + file tools\\customers\\<tencty>\\config.txt.
3. Chép tools\\customers\\<tencty>\\config.txt ĐÈ vào dist-khach\\DigiplusChamCong\\config.txt.
4. Nén thư mục dist-khach\\DigiplusChamCong (zip) → gửi khách / mang lên VPS.
5. Khách (hoặc VPS): giải nén → CaiDat.bat → lấy MÃ MÁY → Anh cấp license bằng
   tools\\license-tool\\CapLicense.bat → gửi chuỗi license → khách dán → xong.

NHIỀU KHÁCH TRÊN CÙNG 1 VPS:
   - Mỗi khách 1 CỔNG khác nhau (8686, 8687, 8688...) + để 1 THƯ MỤC RIÊNG.
   - CaiDat.bat/GoCaiDat.bat đã TỰ an toàn theo cổng (không đè / không giết khách khác).
   - KHÔNG chạy "taskkill /im node.exe" hay "cloudflared.exe" tổng thể → tắt HẾT khách.
   - Cùng VPS = cùng Mã máy → dùng lại 1 chuỗi license được.

XÓA KHÁCH: Xoa-Khach.bat → gõ tên cty → YES (xóa domain + tunnel + config).

BẢO MẬT — KHÔNG BAO GIỜ đưa khách: tools\\keys\\private.pem, tools\\license-tool,
   tools\\cf.env, QUY-TRINH-BAN-KHACH.txt, file này.
   Bộ cài (dist-khach\\DigiplusChamCong) đã KHÔNG chứa chúng — gửi cả thư mục đó là an toàn.
`);

console.log('\\n✓ Đã đóng gói xong tại:', OUT);
try {
  const sz = execSync(`powershell -NoProfile -Command "'{0:N0} MB' -f ((Get-ChildItem -Recurse '${OUT}' | Measure-Object Length -Sum).Sum/1MB)"`).toString().trim();
  console.log('  Kích thước:', sz);
} catch {}
