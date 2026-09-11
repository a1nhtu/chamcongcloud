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
echo.
node tools\make-customer.mjs "%TENCTY%" %MODE%
echo.
pause
