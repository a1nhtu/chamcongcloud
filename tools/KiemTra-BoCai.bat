@echo off
chcp 65001 >nul
cd /d "%~dp0"
python kiem-tra-bo-cai.py
echo.
pause
