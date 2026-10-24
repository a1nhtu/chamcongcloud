# Mo trang quan ly vao TRINH DUYET KHACH DANG MO SAN (Chrome / Coc Coc / Edge / Firefox...) thay vi trinh duyet mac dinh.
# Bo cai goi cuoi luc cai xong (chay duoi quyen nguoi dung, an cua so):  MoTrinhDuyet.ps1 <url>   (-DryRun = chi in lua chon, khong mo)
# - Khong co trinh duyet nao dang mo cua so, hoac trinh duyet mac dinh dang mo  -> mo bang trinh duyet mac dinh (nhu cu)
# - Dang mo trinh duyet khac mac dinh -> mo tab moi trong trinh duyet do
# (File de ASCII khong dau: PowerShell 5.1 doc file khong BOM theo ma ANSI.)
param([string]$Url, [switch]$DryRun)
$ErrorActionPreference = 'SilentlyContinue'

function DefaultExe {
  $id = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice').ProgId
  if (-not $id) { return '' }
  $cmd = (Get-ItemProperty "Registry::HKEY_CLASSES_ROOT\$id\shell\open\command").'(default)'
  if ($cmd -match '^\s*"([^"]+)"') { return $matches[1] }
  if ($cmd -match '^\s*(\S+\.exe)') { return $matches[1] }
  return ''
}

# thu tu uu tien khi dang mo nhieu trinh duyet (khong co trinh duyet mac dinh trong so do)
$known = @('chrome', 'browser', 'msedge', 'firefox', 'opera', 'brave', 'vivaldi')
# chi tinh trinh duyet CO CUA SO (Edge hay chay ngam khong cua so -> bo qua); 'browser.exe' chi nhan Coc Coc / Yandex
$open = @(Get-Process -Name $known | Where-Object {
    $_.MainWindowHandle -ne 0 -and $_.Path -and ($_.Name -ne 'browser' -or $_.Path -match 'CocCoc|Yandex') } |
  Sort-Object { [array]::IndexOf($known, $_.Name.ToLower()) })
$def = DefaultExe
$useDefault = (-not $open.Count) -or ($def -and @($open | Where-Object { $_.Path -ieq $def }).Count)

if ($DryRun) {
  "mac dinh : $def"
  "dang mo  : " + (($open | ForEach-Object { $_.Path } | Select-Object -Unique) -join ' | ')
  "se mo bang: " + $(if ($useDefault) { 'trinh duyet mac dinh' } else { $open[0].Path })
  exit 0
}
if ($useDefault) { Start-Process $Url; exit 0 }
try { Start-Process -FilePath $open[0].Path -ArgumentList $Url -ErrorAction Stop } catch { Start-Process $Url }
