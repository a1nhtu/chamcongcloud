# Cầu nối máy chấm công ZKTeco kết nối TRỰC TIẾP TCP/IP (cổng 4370) qua SDK zkemkeeper (COM).
# Được server/zk-tcp.js gọi; mỗi lần chạy = 1 kết nối + 1 thao tác, in kết quả ra stdout dạng dòng TAB:
#   I <khoá> <giá trị>      thông tin máy            U <pin> <tên> <quyền> <bật> <thẻ>   nhân viên
#   L <pin> <yyyy-MM-dd HH:mm:ss> <vào/ra> <kiểu>    lượt chấm      P <số>   tiến độ
#   OK <ghi chú>            xong                     ERR <mã> <lỗi>          thất bại
param(
  [string]$Ip, [int]$Port = 4370, [int]$Key = 0, [string]$Action = 'info',
  [string]$From = '', [string]$To = '', [int]$Machine = 1, [string]$Proto = ''
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}
function Out($s) { [Console]::Out.WriteLine($s) }
function Clean($s) { if ($null -eq $s) { return '' }; return (([string]$s) -replace "[`t`r`n`0]", ' ').Trim() }
function Fail($code, $msg) { Out ("ERR`t$code`t" + (Clean $msg)); exit 1 }
# 1 dòng lượt chấm "L <pin> <yyyy-MM-dd HH:mm:ss> <vào/ra> <kiểu>". Định dạng giờ TÁCH RIÊNG: viết '..' -f $h, $mi, $se
# ngay trong .Append(...) thì PowerShell coi dấu phẩy là tách tham số của Append → -f chỉ nhận 1 số → lỗi
# "Error formatting a string" (Letefe Bistro / nhahanggiadinh 29/10/2026: tải NV được, tải log chấm công lỗi).
function LogLine($pin, $y, $mo, $d, $h, $mi, $se, $io, $vm) {
  $at = '{0:D4}-{1:D2}-{2:D2} {3:D2}:{4:D2}:{5:D2}' -f [int]$y, [int]$mo, [int]$d, [int]$h, [int]$mi, [int]$se
  return "L`t$(Clean $pin)`t$at`t$([int]$io)`t$([int]$vm)`n"
}
# Tự kiểm (test gọi, không cần SDK / máy): in 1 dòng lượt chấm mẫu
if ($Action -eq 'selftest') { [Console]::Out.Write((LogLine ' 15 ' 2026 10 9 7 5 3 1 15)); exit 0 }

# Thư mục chứa SDK đang đăng ký → thêm vào PATH để zkemkeeper nạp được các DLL đi kèm (commpro, tcpcomm…) khi SDK không nằm trong thư mục Windows
try {
  $clsid = (Get-ItemProperty 'Registry::HKEY_CLASSES_ROOT\zkemkeeper.ZKEM\CLSID' -ErrorAction Stop).'(default)'
  $dll = (Get-ItemProperty "Registry::HKEY_CLASSES_ROOT\CLSID\$clsid\InprocServer32" -ErrorAction Stop).'(default)'
  if ($dll) { $dir = Split-Path ($dll.Trim('"')); if ($dir -and (Test-Path $dir)) { $env:PATH = "$dir;$env:PATH"; Set-Location $dir } }
} catch {}
try { $z = New-Object -ComObject zkemkeeper.ZKEM }
catch { Fail 'NOSDK' 'Máy tính này chưa có SDK máy chấm công (zkemkeeper). Chạy lại bộ cài DigiplusChamCong-Setup.exe (bản 1.19.1 trở lên) bằng quyền Administrator để tự đăng ký.' }

if ($Key -gt 0) { [void]$z.SetCommPassword($Key) }
# SetCommProType: 0 = TCP, 1 = UDP. Máy đời cũ chỉ trả lời UDP 4370 → phần mềm dò thấy thì gọi với -Proto udp;
# không chỉ định mà kết nối hỏng thì thử thêm UDP 1 lần trước khi báo lỗi (máy không nói UDP thì lỗi y như cũ)
function Proto($t) { try { [void]$z.SetCommProType($t) } catch {} }
if ($Proto -eq 'udp') { Proto 1 }
if (-not $z.Connect_Net($Ip, $Port)) {
  $e = 0; $z.GetLastError([ref]$e)
  $ok = $false
  if ($Proto -ne 'udp') { Proto 1; $ok = [bool]$z.Connect_Net($Ip, $Port) }
  if (-not $ok) { Fail "CONNECT$e" "Không kết nối được máy $Ip`:$Port (mã lỗi $e). Kiểm tra IP, dây mạng, mật mã kết nối (Comm Key)." }
}
$m = $Machine
$locked = $false
# Số ID còn trên máy không (đọc thẳng máy). Vài firmware đời cũ đọc lỗi → coi như không thấy (khi đó tin kết quả lệnh xoá)
function UserOnDevice($p) {
  $n = ''; $pw = ''; $pri = 0; $en = $false
  try { return [bool]$z.SSR_GetUserInfo($m, $p, [ref]$n, [ref]$pw, [ref]$pri, [ref]$en) } catch { return $false }
}
# Xoá 1 NV (vân tay + thẻ + mật mã + khuôn mặt) → '1' đã xoá · '0' vẫn còn trên máy · '-' không có trên máy.
# Firmware khác nhau nhận lệnh khác nhau (máy TCP/IP khách 29/10/2026 không xoá được NV đã khoá bằng 1 lệnh duy nhất):
# thử lần lượt SSR_DeleteEnrollData(12) → SSR_DeleteEnrollDataExt(13) → DeleteEnrollData đời cũ (Số ID dạng số), mỗi lần
# đọc lại máy xem người đó đã mất chưa — không tin mỗi giá trị trả về (nhiều firmware trả false dù đã xoá và ngược lại).
function DeleteOne($p) {
  $had = UserOnDevice $p
  $ok = $false; try { $ok = [bool]$z.SSR_DeleteEnrollData($m, $p, 12) } catch {}
  if ($ok -and -not (UserOnDevice $p)) { return '1' }
  $ok = $false; try { $ok = [bool]$z.SSR_DeleteEnrollDataExt($m, $p, 13) } catch {}
  if ($ok -and -not (UserOnDevice $p)) { return '1' }
  if ($p -match '^\d{1,9}$') {
    $ok = $false; try { $ok = [bool]$z.DeleteEnrollData($m, [int]$p, $m, 12) } catch {}
    if ($ok -and -not (UserOnDevice $p)) { return '1' }
  }
  if (-not $had) { return '-' }
  if (UserOnDevice $p) { return '0' }
  return '1'
}
function Lock { [void]$z.EnableDevice($m, $false); $script:locked = $true }
function Done($note) {
  if ($script:locked) { [void]$z.EnableDevice($m, $true) }
  $z.Disconnect()
  Out "OK`t$note"; exit 0
}
function Stat($code) { $v = 0; if ($z.GetDeviceStatus($m, $code, [ref]$v)) { return $v }; return -1 }

try {
  switch ($Action) {
    'info' {
      $s = ''; if ($z.GetSerialNumber($m, [ref]$s)) { Out "I`tserial`t$(Clean $s)" }
      $s = ''; if ($z.GetFirmwareVersion($m, [ref]$s)) { Out "I`tfirmware`t$(Clean $s)" }
      $s = ''; if ($z.GetPlatform($m, [ref]$s)) { Out "I`tplatform`t$(Clean $s)" }
      $s = ''; if ($z.GetDeviceMAC($m, [ref]$s)) { Out "I`tmac`t$(Clean $s)" }
      $s = ''; if ($z.GetProductCode($m, [ref]$s)) { Out "I`tmodel`t$(Clean $s)" }
      $s = ''; if ($z.GetSysOption($m, '~ZKFPVersion', [ref]$s)) { Out "I`tfp_version`t$(Clean $s)" }
      $y = 0; $mo = 0; $d = 0; $h = 0; $mi = 0; $se = 0
      if ($z.GetDeviceTime($m, [ref]$y, [ref]$mo, [ref]$d, [ref]$h, [ref]$mi, [ref]$se)) { Out ("I`ttime`t{0:D4}-{1:D2}-{2:D2} {3:D2}:{4:D2}:{5:D2}" -f $y, $mo, $d, $h, $mi, $se) }
      # GetDeviceStatus: 1 quản trị · 2 NV · 3 vân tay · 4 mật mã · 6 lượt chấm · 7/8/9 sức chứa vân tay / NV / lượt chấm · 21 khuôn mặt · 22 sức chứa khuôn mặt
      foreach ($p in @(@('admins', 1), @('users', 2), @('fps', 3), @('pwds', 4), @('logs', 6), @('fp_cap', 7), @('user_cap', 8), @('log_cap', 9), @('faces', 21), @('face_cap', 22))) {
        $v = Stat $p[1]; if ($v -ge 0) { Out "I`t$($p[0])`t$v" }
      }
      Done 'info'
    }
    'users' {
      Lock
      [void]$z.ReadAllUserID($m)
      $pin = ''; $name = ''; $pw = ''; $pri = 0; $en = $false; $n = 0
      while ($z.SSR_GetAllUserInfo($m, [ref]$pin, [ref]$name, [ref]$pw, [ref]$pri, [ref]$en)) {
        $card = ''; try { [void]$z.GetStrCardNumber([ref]$card) } catch {}
        if ($card -eq '0') { $card = '' }
        Out ("U`t" + (Clean $pin) + "`t" + (Clean $name) + "`t$pri`t" + $(if ($en) { 1 } else { 0 }) + "`t" + (Clean $card))
        $n++
      }
      Done "$n"
    }
    'logs' {
      Lock
      $ranged = $false
      if ($From -and $To) { try { $ranged = [bool]$z.ReadTimeGLogData($m, "$From 00:00:00", "$To 23:59:59") } catch { $ranged = $false } }
      if (-not $ranged) {
        if (-not $z.ReadGeneralLogData($m)) {
          $e = 0; $z.GetLastError([ref]$e)
          if ($e -eq 0 -or $e -eq -4) { Done "0`t0`tall" }   # máy không có lượt chấm nào
          $new = $false; try { $new = [bool]$z.ReadNewGLogData($m) } catch {}   # firmware ZMM220 mới: chỉ đọc được log chưa đọc
          if (-not $new) { [void]$z.EnableDevice($m, $true); $z.Disconnect(); Fail "READLOG$e" "Máy không trả dữ liệu chấm công (mã lỗi $e)." }
        }
      }
      $pin = ''; $vm = 0; $io = 0; $y = 0; $mo = 0; $d = 0; $h = 0; $mi = 0; $se = 0; $wc = 0; $n = 0; $all = 0
      $sb = New-Object System.Text.StringBuilder
      while ($z.SSR_GetGeneralLogData($m, [ref]$pin, [ref]$vm, [ref]$io, [ref]$y, [ref]$mo, [ref]$d, [ref]$h, [ref]$mi, [ref]$se, [ref]$wc)) {
        $all++
        $day = '{0:D4}-{1:D2}-{2:D2}' -f [int]$y, [int]$mo, [int]$d
        if ($From -and $day -lt $From) { continue }
        if ($To -and $day -gt $To) { continue }
        [void]$sb.Append((LogLine $pin $y $mo $d $h $mi $se $io $vm))
        $n++
        if ($n % 2000 -eq 0) { [Console]::Out.Write($sb.ToString()); [void]$sb.Clear(); Out "P`t$n" }
      }
      if ($sb.Length) { [Console]::Out.Write($sb.ToString()) }
      Done "$n`t$all`t$(if ($ranged) { 'range' } else { 'all' })"
    }
    'clear-logs' {      # xoá TOÀN BỘ lượt chấm trên máy — nhiều firmware trả false dù đã xoá nên không xét kết quả
      Lock; [void]$z.ClearGLog($m); [void]$z.RefreshData($m); Done 'clear-logs'
    }
    'delete-logs' {     # xoá lượt chấm trong khoảng ngày (chỉ firmware mới hỗ trợ)
      Lock
      $ok = $false; try { $ok = [bool]$z.DeleteAttlogBetweenTheDate($m, "$From 00:00:00", "$To 23:59:59") } catch {}
      if (-not $ok) { $e = 0; $z.GetLastError([ref]$e); [void]$z.EnableDevice($m, $true); $z.Disconnect(); Fail "UNSUPPORTED$e" 'Máy này (firmware cũ) không hỗ trợ xoá lượt chấm theo khoảng ngày — chỉ xoá toàn bộ được.' }
      [void]$z.RefreshData($m); Done 'delete-logs'
    }
    'clear-admins' {    # hạ mọi quản trị trên máy về người dùng thường
      Lock; [void]$z.ClearAdministrators($m); [void]$z.RefreshData($m); Done 'clear-admins'
    }
    'clear-users' {     # xoá toàn bộ NV + vân tay / khuôn mặt (giữ lượt chấm)
      Lock; [void]$z.ClearData($m, 2); [void]$z.ClearData($m, 5); [void]$z.RefreshData($m); Done 'clear-users'
    }
    'clear-all' {       # xoá sạch: lượt chấm + NV + vân tay + khuôn mặt. ClearKeeperData = xoá toàn bộ dữ liệu trên máy (theo tài liệu SDK);
                        # vài firmware trả false dù đã xoá nên gọi thêm từng loại cho chắc, không xét kết quả
      Lock; try { [void]$z.ClearKeeperData($m) } catch {}
      [void]$z.ClearGLog($m); [void]$z.ClearData($m, 2); [void]$z.ClearData($m, 5); [void]$z.RefreshData($m); Done 'clear-all'
    }
    'delete-user' {     # xoá 1 NV trên máy (vân tay + thẻ + mật mã); $From = Số ID
      Lock; $r = DeleteOne $From.Trim(); [void]$z.RefreshData($m)
      if ($r -eq '0') { $e = 0; $z.GetLastError([ref]$e); [void]$z.EnableDevice($m, $true); $z.Disconnect(); Fail "DELUSER$e" "Không xoá được Số ID $From trên máy (mã lỗi $e)." }
      Done 'delete-user'
    }
    'delete-users' {    # xoá NHIỀU NV trên máy; $From = các Số ID cách nhau dấu phẩy. In 'D <pin> <1|0|->' từng người (xem DeleteOne)
      Lock
      foreach ($p in ($From -split ',')) {
        $p = $p.Trim(); if (-not $p) { continue }
        Out ("D`t$p`t" + (DeleteOne $p))
      }
      [void]$z.RefreshData($m); Done 'delete-users'
    }
    'set-time' {        # đặt giờ máy = giờ máy tính đang chạy phần mềm
      [void]$z.SetDeviceTime($m); [void]$z.RefreshData($m); Done ((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))
    }
    'svr' {             # đọc cài đặt máy chủ đẩy dữ liệu (Cloud Server / ADMS) + nhận dạng máy — chỉ đọc
      $s = ''; if ($z.GetSerialNumber($m, [ref]$s)) { Out "I`tserial`t$(Clean $s)" }
      $s = ''; if ($z.GetSysOption($m, '~DeviceName', [ref]$s)) { Out "I`tmodel`t$(Clean $s)" }
      $s = ''; if ($z.GetFirmwareVersion($m, [ref]$s)) { Out "I`tfirmware`t$(Clean $s)" }
      foreach ($p in @(@('svr_fun', 'IclockSvrFun'), @('svr_mode', 'WebServerURLModel'), @('svr_url', 'ICLOCKSVRURL'), @('svr_port', 'IclockSvrPort'), @('svr_ssl', 'IISSupportSSL'))) {
        $s = ''; if ($z.GetSysOption($m, $p[1], [ref]$s)) { Out "I`t$($p[0])`t$(Clean $s)" }
      }
      Done 'svr'
    }
    'set-svr' {         # trỏ máy về tên miền $From (bật Cloud Server theo tên miền) rồi khởi động lại máy để nối lại; $To = cổng cần đặt (rỗng = giữ)
      [void]$z.SetSysOption($m, 'IclockSvrFun', '1')
      [void]$z.SetSysOption($m, 'WebServerURLModel', '1')
      [void]$z.SetSysOption($m, 'ICLOCKSVRURL', $From)
      # Máy CÓ mục HTTPS (IISSupportSSL đọc được) → bật lên, phòng ai đó đã tắt; cổng chưa phải cổng HTTPS của Cloudflare → 443
      # (bật SSL mà cổng 80 thì máy nói HTTPS vào cổng HTTP, không về được). Máy không có mục này → giữ như cũ (HTTP).
      $s = ''
      if ($z.GetSysOption($m, 'IISSupportSSL', [ref]$s)) {
        [void]$z.SetSysOption($m, 'IISSupportSSL', '1')
        $s = ''; [void]$z.GetSysOption($m, 'IISSupportSSL', [ref]$s)
        if ((Clean $s) -eq '1') {
          $cur = ''; [void]$z.GetSysOption($m, 'IclockSvrPort', [ref]$cur)
          if (@('443', '2053', '2083', '2087', '2096', '8443') -notcontains (Clean $cur)) { $To = '443' } else { $To = '' }
        }
        Out "I`tsvr_ssl`t$(Clean $s)"
      }
      if ($To) { [void]$z.SetSysOption($m, 'IclockSvrPort', $To) }
      # nhiều firmware trả false dù đã ghi → xét bằng cách đọc lại
      $s = ''; [void]$z.GetSysOption($m, 'ICLOCKSVRURL', [ref]$s)
      if ((Clean $s) -ne $From) { $z.Disconnect(); Fail 'SETSVR' "Máy không nhận cài đặt máy chủ (đọc lại được: '$(Clean $s)'). Đặt tay trên máy: Menu → Comm → Cloud Server." }
      Out "I`tsvr_url`t$(Clean $s)"
      $s = ''; if ($z.GetSysOption($m, 'IclockSvrPort', [ref]$s)) { Out "I`tsvr_port`t$(Clean $s)" }
      [void]$z.RestartDevice($m); Out "OK`tset-svr"; exit 0
    }
    'restart' { [void]$z.RestartDevice($m); Out "OK`trestart"; exit 0 }
    default { $z.Disconnect(); Fail 'BADACTION' "Thao tác không hỗ trợ: $Action" }
  }
} catch {
  try { if ($locked) { [void]$z.EnableDevice($m, $true) }; $z.Disconnect() } catch {}
  Fail 'EXC' $_.Exception.Message
}
