@echo off
chcp 65001 >nul
title Digiplus - Cap nhat phan mem (lan dau)
cd /d "%~dp0"
echo ================================================
echo    DIGIPLUS - CAP NHAT PHAN MEM
echo ================================================
echo.

rem --- Kiem tra dung thu muc cai (phai co app\server) ---
if not exist "%~dp0app\server\index.js" (
  echo [!] Khong thay app\server o thu muc nay.
  echo     Hay dat file nay VAO THU MUC CAI Digiplus roi chay lai.
  echo.
  pause & exit /b
)

echo Dang tai ban moi nhat tu Digiplus, vui long doi...
if exist "%~dp0_upd" rmdir /s /q "%~dp0_upd"
mkdir "%~dp0_upd"
curl -L -s -o "%~dp0_upd\repo.zip" https://codeload.github.com/a1nhtu/chamcongcloud/zip/refs/heads/main
if not exist "%~dp0_upd\repo.zip" (echo [!] Tai ve that bai - kiem tra Internet. & rmdir /s /q "%~dp0_upd" & pause & exit /b)

"%SystemRoot%\System32\tar.exe" -xf "%~dp0_upd\repo.zip" -C "%~dp0_upd"
if not exist "%~dp0_upd\chamcongcloud-main\server\index.js" (echo [!] Ban tai ve khong hop le. & rmdir /s /q "%~dp0_upd" & pause & exit /b)

echo Dang dung phan mem va cai ban moi...
taskkill /f /im node.exe >nul 2>&1
taskkill /f /im cloudflared.exe >nul 2>&1
timeout /t 2 /nobreak >nul

robocopy "%~dp0_upd\chamcongcloud-main\server" "%~dp0app\server" /MIR /NFL /NDL /NJH /NJS /R:2 /W:1 >nul
robocopy "%~dp0_upd\chamcongcloud-main\public" "%~dp0app\public" /MIR /NFL /NDL /NJH /NJS /R:2 /W:1 >nul
copy /y "%~dp0_upd\chamcongcloud-main\package.json" "%~dp0app\package.json" >nul
rmdir /s /q "%~dp0_upd"

echo Dang khoi dong lai...
if exist "%~dp0start-hidden.vbs" ( start "" "%~dp0start-hidden.vbs" ) else ( start "" /b "%~dp0ChayApp.bat" )
timeout /t 3 /nobreak >nul

echo.
echo ================================================
echo    XONG! Da cap nhat len ban moi nhat.
echo    Du lieu duoc giu nguyen.
echo    Tu gio: vao trang quan ly ^> Cai dat ^> "Cap nhat phan mem"
echo    la co the tu cap nhat, khong can file nay nua.
echo ================================================
echo.
pause
