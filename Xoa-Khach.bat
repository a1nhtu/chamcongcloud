@echo off
chcp 65001 >nul
title Digiplus - Xoa khach (thu hoi domain)
cd /d "%~dp0"
echo ============================================
echo   XOA KHACH (thu hoi domain + tunnel)
echo ============================================
echo.
set /p TENCTY=Ten cong ty can xoa (vd demo1):
if "%TENCTY%"=="" echo Ban chua nhap ten. & pause & exit /b
echo.
echo Se XOA: DNS %TENCTY%.maychamcongcloud.com + tunnel digiplus-%TENCTY% + file cau hinh.
set /p OK=Go DUNG chu YES de xac nhan xoa:
if /I not "%OK%"=="YES" echo Da huy. & pause & exit /b
echo.
node tools\remove-customer.mjs "%TENCTY%"
echo.
pause
