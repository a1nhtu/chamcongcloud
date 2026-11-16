# TRO MAY CHAM CONG ZKTECO VE TEN MIEN DIGIPLUS (Cloud Server / ADMS) - cong cu tai tu trang May cham cong
# cua MAY CHU NHIEU CONG TY (server/routes/admin/devices.js: /devices/point-tool). Chay tren may tinh CUNG MANG voi may cham cong
# (may chu o noi khac khong ket noi thang toi IP LAN cua khach duoc). File .bat di kem dien san IP / ten mien / DHCP.
# - Cloud Server theo ten mien; may co muc HTTPS -> HTTPS cong 443, khong co -> HTTP cong 80.
# - Gateway / DNS: chi dien khi dang de trong.  -Dhcp: bat DHCP (IP may co the doi -> phan mem ket noi theo IP se mat ket noi).
# - May tinh chua co SDK zkemkeeper -> tu dang ky ban kem theo (thu muc zksdk, can quyen Admin), xong viec thi go dang ky.
param(
  [Parameter(Mandatory = $true)][string]$Ip,
  [Parameter(Mandatory = $true)][string]$Domain,
  [int]$Port = 4370,
  [int]$Key = 0,
  [switch]$Dhcp,
  [string]$Dns = '8.8.8.8',
  [switch]$Pause                 # chay lai voi quyen Admin (cua so moi) -> dung lai cuoi de doc ket qua
)
function Say($s, $c = 'Gray') { Write-Host $s -ForegroundColor $c }
function Empty($v) { $v = "$v".Trim(); return ($v -eq '' -or $v -eq '0.0.0.0') }
if ([Environment]::Is64BitProcess) { Say 'Hay chay bang file TroMay.bat (PowerShell 32-bit).' Red; exit 1 }
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$sdkDir = Join-Path $here 'zksdk'
$ourReg = $false

function SdkDll {
  try {
    $clsid = (Get-ItemProperty 'Registry::HKEY_CLASSES_ROOT\zkemkeeper.ZKEM\CLSID' -ErrorAction Stop).'(default)'
    $dll = (Get-ItemProperty "Registry::HKEY_CLASSES_ROOT\CLSID\$clsid\InprocServer32" -ErrorAction Stop).'(default)'
    if ($dll -and (Test-Path $dll.Trim('"'))) { return $dll.Trim('"') }
  } catch {}
  return $null
}
$reg32 = Join-Path $env:SystemRoot 'SysWOW64\regsvr32.exe'
$dll = SdkDll
if (-not $dll) {
  if (-not (Test-Path (Join-Path $sdkDir 'zkemkeeper.dll'))) { Say 'May tinh nay chua co SDK zkemkeeper va goi cong cu khong kem SDK. Chay tren may tinh dang cai Wise Eye / On39 / phan mem cham cong khac.' Red; exit 1 }
  $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $admin) {
    Say 'May tinh chua co SDK may cham cong -> can quyen Administrator de dang ky tam (bam Yes o hop thoai).' Yellow
    $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$($MyInvocation.MyCommand.Path)`"", '-Ip', $Ip, '-Domain', $Domain, '-Port', $Port, '-Key', $Key, '-Dns', $Dns)
    if ($Dhcp) { $a += '-Dhcp' }
    try { Start-Process -FilePath (Join-Path $env:SystemRoot 'SysWOW64\WindowsPowerShell\v1.0\powershell.exe') -ArgumentList ($a + '-Pause') -Verb RunAs -Wait } catch { Say 'Khong duoc cap quyen Administrator.' Red; exit 1 }
    exit 0
  }
  & $reg32 /s (Join-Path $sdkDir 'zkemkeeper.dll'); Start-Sleep -Milliseconds 500
  $dll = SdkDll
  if (-not $dll) { Say 'Khong dang ky duoc SDK zkemkeeper.' Red; exit 1 }
  $ourReg = $true
}
$dir = Split-Path $dll; $env:PATH = "$dir;$env:PATH"; Set-Location $dir

function Finish($code) {
  if ($script:z) { try { $script:z.Disconnect() } catch {} }
  if ($ourReg) { & $reg32 /u /s (Join-Path $sdkDir 'zkemkeeper.dll') }   # tra may tinh ve nhu cu
  if ($Pause) { Read-Host 'Nhan Enter de dong' | Out-Null }
  exit $code
}

try { $script:z = New-Object -ComObject zkemkeeper.ZKEM } catch { Say 'Khong nap duoc SDK zkemkeeper.' Red; Finish 1 }
$z = $script:z
$gw = ''
try { $gw = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1).IPv4DefaultGateway.NextHop } catch {}
if (-not $gw) { try { $gw = (Get-WmiObject Win32_NetworkAdapterConfiguration -Filter 'IPEnabled=True' | Where-Object { $_.DefaultIPGateway } | Select-Object -First 1).DefaultIPGateway[0] } catch {} }

Say "Ket noi may $Ip`:$Port ..." Cyan
if ($Key -gt 0) { [void]$z.SetCommPassword($Key) }
if (-not $z.Connect_Net($Ip, $Port)) {
  try { [void]$z.SetCommProType(1) } catch {}
  if (-not $z.Connect_Net($Ip, $Port)) { $e = 0; [void]$z.GetLastError([ref]$e); Say "Khong ket noi duoc may (ma loi $e). Kiem tra IP, day mang, mat khau ket noi (Comm Key); tat tam phan mem cham cong khac dang ket noi may." Red; Finish 1 }
}
$m = 1
function Get1($k) { $s = ''; if ($z.GetSysOption($m, $k, [ref]$s)) { return "$s".Trim() }; return $null }
function Set1($k, $v) { [void]$z.SetSysOption($m, $k, $v); return (Get1 $k) }
$sn = ''; [void]$z.GetSerialNumber($m, [ref]$sn)
Say "May: $(Get1 '~DeviceName')  Serial: $sn" Green
$keys = 'IPAddress', 'NetMask', 'GATEIPAddress', 'DNS', 'DHCP', 'IclockSvrFun', 'WebServerURLModel', 'ICLOCKSVRURL', 'IclockSvrPort', 'IISSupportSSL'
Say '--- CAI DAT HIEN TAI (ghi lai de tra ve neu can) ---' Yellow
$before = @{}; foreach ($k in $keys) { $before[$k] = Get1 $k; if ($null -ne $before[$k]) { Say ("  {0,-18} = {1}" -f $k, $before[$k]) } }

if ($null -ne $before['GATEIPAddress'] -and (Empty $before['GATEIPAddress']) -and $gw) { Say "  Gateway dang trong -> $gw : $(Set1 'GATEIPAddress' $gw)" Cyan }
if ($null -ne $before['DNS'] -and (Empty $before['DNS']) -and $Dns) { Say "  DNS dang trong -> $Dns : $(Set1 'DNS' $Dns)" Cyan }
[void]$z.SetSysOption($m, 'IclockSvrFun', '1')
[void]$z.SetSysOption($m, 'WebServerURLModel', '1')
[void]$z.SetSysOption($m, 'ICLOCKSVRURL', $Domain)
if ($null -ne $before['IISSupportSSL'] -and (Set1 'IISSupportSSL' '1') -eq '1') { [void]$z.SetSysOption($m, 'IclockSvrPort', '443') }
else { [void]$z.SetSysOption($m, 'IclockSvrPort', '80') }
if ($Dhcp) {
  foreach ($p in 'DHCP', 'WirelessDHCP') {
    if ($null -eq (Get1 $p)) { continue }
    $v = Set1 $p '1'
    Say ("  Bat {0}: {1}" -f $p, $(if ($v -eq '1') { 'OK' } else { 'KHONG NHAN - bat tay: Menu > Comm > Ethernet > DHCP' })) $(if ($v -eq '1') { 'Cyan' } else { 'Red' })
  }
}
Say '--- SAU KHI DAT ---' Yellow
foreach ($k in $keys) { $v = Get1 $k; if ($null -ne $v) { Say ("  {0,-18} = {1}" -f $k, $v) } }
if ((Get1 'ICLOCKSVRURL') -ne $Domain) { Say 'May KHONG nhan ten mien (firmware doi cu chi co o Server IP). Chup man Menu > Comm > Cloud Server gui Digiplus.' Red; Finish 1 }
[void]$z.RestartDevice($m)
Say "XONG. May dang khoi dong lai (~1 phut), sau do vao trang $Domain > May cham cong > muc Cho duyet." Green
if ($Dhcp) { Say 'Da bat DHCP: IP may co the doi. Phan mem khac ket noi may theo IP thi dat IP co dinh cho may tren router (theo dia chi MAC).' Yellow }
Finish 0
