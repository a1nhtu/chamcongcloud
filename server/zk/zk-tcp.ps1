# Cầu nối máy chấm công ZKTeco kết nối TRỰC TIẾP TCP/IP (cổng 4370) qua SDK zkemkeeper (COM).
# Được server/zk-tcp.js gọi; mỗi lần chạy = 1 kết nối + 1 thao tác, in kết quả ra stdout dạng dòng TAB:
#   I <khoá> <giá trị>      thông tin máy            U <pin> <tên> <quyền> <bật> <thẻ>   nhân viên
#   L <pin> <yyyy-MM-dd HH:mm:ss> <vào/ra> <kiểu>    lượt chấm      P <số>   tiến độ
#   OK <ghi chú>            xong                     ERR <mã> <lỗi>          thất bại
param(
  [string]$Ip, [int]$Port = 4370, [int]$Key = 0, [string]$Action = 'info',
  [string]$From = '', [string]$To = '', [int]$Machine = 1
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}
function Out($s) { [Console]::Out.WriteLine($s) }
function Clean($s) { if ($null -eq $s) { return '' }; return (([string]$s) -replace "[`t`r`n`0]", ' ').Trim() }
function Fail($code, $msg) { Out ("ERR`t$code`t" + (Clean $msg)); exit 1 }

try { $z = New-Object -ComObject zkemkeeper.ZKEM }
catch { Fail 'NOSDK' 'Máy tính chưa cài SDK zkemkeeper (chạy Register_SDK.bat bằng quyền Administrator).' }

if ($Key -gt 0) { [void]$z.SetCommPassword($Key) }
if (-not $z.Connect_Net($Ip, $Port)) {
  $e = 0; $z.GetLastError([ref]$e)
  Fail "CONNECT$e" "Không kết nối được máy $Ip`:$Port (mã lỗi $e). Kiểm tra IP, dây mạng, mật mã kết nối (Comm Key)."
}
$m = $Machine
$locked = $false
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
        $day = '{0:D4}-{1:D2}-{2:D2}' -f $y, $mo, $d
        if ($From -and $day -lt $From) { continue }
        if ($To -and $day -gt $To) { continue }
        [void]$sb.Append("L`t").Append((Clean $pin)).Append("`t").Append($day).Append(' {0:D2}:{1:D2}:{2:D2}' -f $h, $mi, $se).Append("`t$io`t$vm`n")
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
      $ok = [bool]$z.SSR_DeleteEnrollData($m, $From, 12); [void]$z.RefreshData($m)
      if (-not $ok) { $e = 0; $z.GetLastError([ref]$e); $z.Disconnect(); Fail "DELUSER$e" "Không xoá được Số ID $From trên máy (mã lỗi $e)." }
      Done 'delete-user'
    }
    'set-time' {        # đặt giờ máy = giờ máy tính đang chạy phần mềm
      [void]$z.SetDeviceTime($m); [void]$z.RefreshData($m); Done ((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))
    }
    'restart' { [void]$z.RestartDevice($m); Out "OK`trestart"; exit 0 }
    default { $z.Disconnect(); Fail 'BADACTION' "Thao tác không hỗ trợ: $Action" }
  }
} catch {
  try { if ($locked) { [void]$z.EnableDevice($m, $true) }; $z.Disconnect() } catch {}
  Fail 'EXC' $_.Exception.Message
}
