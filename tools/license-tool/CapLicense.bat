@echo off
chcp 65001 >nul
title Digiplus - Cap License
cd /d "%~dp0"
echo Dang mo cong cu cap license...
node --no-warnings server.mjs
echo.
echo (Da dong cong cu. Bam phim bat ky de thoat.)
pause >nul
