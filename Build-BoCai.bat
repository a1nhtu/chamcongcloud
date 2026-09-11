@echo off
chcp 65001 >nul
title Digiplus - Build bo cai gui khach
cd /d "%~dp0"
echo ============================================
echo   BUILD BO CAI GUI KHACH (dist-khach)
echo ============================================
echo.
echo Dong goi code MOI NHAT + Node + cloudflared...
echo (Chay lai moi khi nang cap phan mem, truoc khi gui khach)
echo.
node tools\build-package.mjs
if errorlevel 1 (
  echo.
  echo !! BUILD LOI - xem thong bao ben tren.
  pause
  exit /b
)
echo.
echo ============================================
echo   XONG! Bo cai o: dist-khach\DigiplusChamCong
echo ============================================
echo.
echo Buoc tiep: chay Tao-Khach.bat de lay config.txt cho khach,
echo chep de vao dist-khach\DigiplusChamCong\config.txt roi nen gui khach.
echo.
set /p OPEN=Mo thu muc bo cai bay gio? (Y/N):
if /I "%OPEN%"=="Y" start "" explorer "%~dp0dist-khach\DigiplusChamCong"
pause
