@echo off
rem Tao lai anh mau bao cao (nut "Xem mau" o man Bao cao). Can: Node, Python + pywin32 + PyMuPDF + Pillow, Microsoft Excel.
cd /d "%~dp0..\.."
set OUT=%TEMP%\dgp-anh-mau-xlsx
if exist "%OUT%" rmdir /s /q "%OUT%"
node tools\anh-mau-bao-cao\xuat-excel-mau.mjs "%OUT%" || goto :loi
python -I tools\anh-mau-bao-cao\render-anh.py "%OUT%" public\mau-bao-cao || goto :loi
rmdir /s /q "%OUT%"
echo Xong - anh o public\mau-bao-cao
pause
exit /b 0
:loi
echo LOI - xem thong bao o tren
pause
exit /b 1
