@echo off
chcp 65001 >nul
title Digiplus - Tao khach hang moi (domain + tunnel)
cd /d "%~dp0"
echo ============================================
echo   TAO KHACH HANG MOI (tu dong tao domain)
echo ============================================
echo.
set /p TENCTY=Ten cong ty (khong dau, vd congtyabc):
if "%TENCTY%"=="" echo Ban chua nhap ten cong ty. & pause & exit /b
echo.
echo Chon che do cai dat:
echo   1 = Cai tai VAN PHONG KHACH (chay tai cho khach)
echo   2 = Cai tren SERVER VPS ben Anh (truy cap moi noi)
echo.
set /p CHEDO=Nhap 1 hoac 2 (Enter = 1):
if "%CHEDO%"=="2" (set MODE=vps) else (set MODE=office)
set "PORTIN="
if "%MODE%"=="vps" (
  echo.
  echo === CONG APP ===
  echo Neu VPS DA co khach khac dang chay, PHAI chon cong KHAC de khong trung.
  echo   Vi du: khach 1 = 8686, khach 2 = 8687, khach 3 = 8688 ...
  set /p PORTIN=Cong cho khach nay ^(Enter = 8686^):
)
echo.
node tools\make-customer.mjs "%TENCTY%" %MODE% %PORTIN%
echo.
pause
