@echo off
chcp 65001 >nul
title Digiplus - Dung lai du lieu DEMO
cd /d "%~dp0"
echo.
echo ============================================
echo   DUNG LAI DU LIEU DEMO (khach nghich loan)
echo ============================================
echo.
echo Tao lai: tai khoan demo/demo123 + 7 nhan vien mau
echo          + cham cong dep 2 thang gan nhat.
echo Khong can tat app.
echo.
node tools\seed-demo.mjs
echo.
echo Xong! Mo lai trang Tong quan (F5) de thay du lieu moi.
echo.
pause
