' Khoi chay Digiplus Cham Cong (app + cloudflare tunnel) o che do AN (khong hien cua so).
' Cong 8686 (vi 8080 bi Windows chiem tren may nay).
Dim sh, base, cfg
Set sh = CreateObject("WScript.Shell")
base = "E:\AntiGravity\Claude_CODE\DigiplusChamCong"
cfg  = "C:\Users\ADMIN\.cloudflared\config.yml"
sh.CurrentDirectory = base

' 1) May chu app tren cong 8686 (an)
sh.Run "cmd /c set PORT=8686 && node --no-warnings server\index.js", 0, False

' 2) Cho app khoi dong roi bat Cloudflare tunnel (an)
WScript.Sleep 5000
sh.Run "cmd /c """ & base & "\tools\cloudflared.exe"" tunnel --config " & cfg & " run", 0, False
