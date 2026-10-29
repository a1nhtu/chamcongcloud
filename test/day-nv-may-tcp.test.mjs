// MÁY TCP/IP: TẢI NV KÈM VÂN TAY + ĐẨY NV TỪ PHẦN MỀM XUỐNG MÁY (Letefe Bistro / nhahanggiadinh 29/10/2026: "Tải nhân viên" không
// lấy vân tay; "Đẩy NV xuống máy" chỉ máy đẩy ADMS nhận được). Chạy SCRIPT THẬT server/zk/zk-tcp.ps1, chỉ thay SDK zkemkeeper bằng
// SDK giả (giữ NV + vân tay trong file JSON, thẻ dùng chung 1 bộ đệm như SDK thật). Chạy: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, writeFileSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';

const WIN = process.platform === 'win32';
const T = (n) => join(tmpdir(), `dgp-day-nv-tcp-${n}-${process.pid}`);
const DBP = T('db') + '.db', SCRIPT = T('script') + '.ps1', SDK = T('sdk') + '.ps1', STATE = T('state') + '.json';
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;
process.env.ZK_TCP_SCRIPT = SCRIPT;
process.env.ZK_RETRY_MS = '50';
process.env.FAKE_SDK = SDK;
process.env.FAKE_SDK_STATE = STATE;

const real = readFileSync(new URL('../server/zk/zk-tcp.ps1', import.meta.url), 'utf8');
const NEWZ = 'try { $z = New-Object -ComObject zkemkeeper.ZKEM }';
assert.ok(real.includes(NEWZ), 'script thật phải còn dòng tạo SDK');
writeFileSync(SCRIPT, real.replace(NEWZ, 'try { . $env:FAKE_SDK }'));
writeFileSync(SDK, '﻿' + `
$global:FakeDev = Get-Content $env:FAKE_SDK_STATE -Raw -Encoding UTF8 | ConvertFrom-Json
$global:it = 0; $global:cardBuf = ''
function global:SaveFake { $global:FakeDev | ConvertTo-Json -Depth 8 | Set-Content $env:FAKE_SDK_STATE -Encoding UTF8 }
function global:FindU($p) { @($global:FakeDev.users) | Where-Object { $_.pin -eq [string]$p } | Select-Object -First 1 }
$z = New-Object PSObject
foreach ($n in 'Connect_Net', 'SetCommPassword', 'SetCommProType', 'Disconnect', 'EnableDevice', 'RefreshData', 'ReadAllUserID', 'ReadAllTemplate') { $z | Add-Member ScriptMethod $n { $true } }
foreach ($n in 'GetFirmwareVersion', 'GetPlatform', 'GetDeviceMAC', 'GetProductCode', 'GetDeviceTime') { $z | Add-Member ScriptMethod $n { $false } }
$z | Add-Member ScriptMethod GetDeviceStatus { param($m, $c, $v) if ($c -eq 2) { $v.Value = @($global:FakeDev.users).Count; return $true }; $false }
# lượt chấm: S.range = máy lọc được theo ngày không; S.rangeCalls = số lần phần mềm thử lọc (để test "nhớ máy không lọc được")
$global:logs = @(); $global:li = 0
$z | Add-Member ScriptMethod ReadTimeGLogData { param($m, $a, $b) $global:FakeDev.rangeCalls = [int]$global:FakeDev.rangeCalls + 1; SaveFake; if (-not $global:FakeDev.range) { return $false }
  $global:logs = @($global:FakeDev.logs | Where-Object { $_.at -ge $a -and $_.at -le $b }); $global:li = 0; $true }
$z | Add-Member ScriptMethod ReadGeneralLogData { param($m) $global:logs = @($global:FakeDev.logs); $global:li = 0; $true }
$z | Add-Member ScriptMethod SSR_GetGeneralLogData { param($m, $pin, $vm, $io, $y, $mo, $d, $h, $mi, $se, $wc)
  if ($global:li -ge $global:logs.Count) { return $false }
  $l = $global:logs[$global:li]; $global:li++; $t = [datetime]$l.at
  $pin.Value = $l.pin; $vm.Value = 1; $io.Value = 0; $y.Value = $t.Year; $mo.Value = $t.Month; $d.Value = $t.Day; $h.Value = $t.Hour; $mi.Value = $t.Minute; $se.Value = $t.Second; $wc.Value = 0; $true }
$z | Add-Member ScriptMethod GetLastError { param($e) $e.Value = 0; $true }
$z | Add-Member ScriptMethod GetSerialNumber { param($m, $v) $v.Value = $global:FakeDev.serial; $true }
$z | Add-Member ScriptMethod GetSysOption { param($m, $k, $v) if ($k -eq '~ZKFPVersion') { $v.Value = $global:FakeDev.fpver; return $true }; $false }
$z | Add-Member ScriptMethod GetStrCardNumber { param($c) $c.Value = $global:cardBuf; $true }
$z | Add-Member ScriptMethod SetStrCardNumber { param($c) $global:cardBuf = $c; $true }
$z | Add-Member ScriptMethod SSR_GetAllUserInfo { param($m, $pin, $name, $pw, $pri, $en)
  $a = @($global:FakeDev.users); if ($global:it -ge $a.Count) { return $false }
  $u = $a[$global:it]; $global:it++
  $pin.Value = $u.pin; $name.Value = $u.name; $pw.Value = $u.pw; $pri.Value = [int]$u.pri; $en.Value = $true; $global:cardBuf = $u.card; $true }
$z | Add-Member ScriptMethod SSR_GetUserInfo { param($m, $p, $name, $pw, $pri, $en)
  $u = FindU $p; if (-not $u) { return $false }
  $name.Value = $u.name; $pw.Value = $u.pw; $pri.Value = [int]$u.pri; $en.Value = $true; $global:cardBuf = $u.card; $true }
$z | Add-Member ScriptMethod SSR_SetUserInfo { param($m, $p, $name, $pw, $pri, $en)
  $u = FindU $p
  if (-not $u) { $u = [pscustomobject]@{ pin = [string]$p; name = ''; pw = ''; pri = 0; card = ''; fps = [pscustomobject]@{} }; $global:FakeDev.users = @($global:FakeDev.users) + $u }
  $u.name = $name; $u.pw = $pw; $u.pri = [int]$pri; $u.card = $(if ($global:cardBuf -eq '0') { '' } else { [string]$global:cardBuf }); SaveFake; $true }
$z | Add-Member ScriptMethod GetUserTmpExStr { param($m, $p, $f, $flag, $tmp, $len)
  $u = FindU $p; $t = $u.fps."$f"; if (-not $t) { return $false }
  $flag.Value = 1; $tmp.Value = $t; $len.Value = $t.Length; $true }
$z | Add-Member ScriptMethod SetUserTmpExStr { param($m, $p, $f, $flag, $tmp)
  $u = FindU $p; if (-not $u) { return $false }
  $u.fps | Add-Member -Force NoteProperty ([string]$f) $tmp; SaveFake; $true }
`);
// Máy giả: Serial TCP9, vân tay ZKFinger 10. NV 5 là QUẢN TRỊ trên máy, có thẻ + 1 vân tay; NV 8 có mật mã
writeFileSync(STATE, JSON.stringify({ serial: 'TCP9', fpver: '10', range: false, rangeCalls: 0, logs: [
  { pin: '8', at: '2026-10-27 08:00:00' }, { pin: '8', at: '2026-10-28 08:01:00' }, { pin: '8', at: '2026-10-28 17:30:00' }, { pin: '77', at: '2026-10-28 09:00:00' },
], users: [
  { pin: '5', name: 'Ten cu tren may', pw: '', pri: 14, card: '777', fps: { 0: 'FPDEV5' } },
  { pin: '8', name: 'Pham Van Tam', pw: '99', pri: 0, card: '', fps: {} },
] }));
const dev = () => JSON.parse(readFileSync(STATE, 'utf8').replace(/^﻿/, ''));
const onDev = (pin) => dev().users.find((u) => u.pin === pin);

let db, Z, S, srv;
const routes = {};
before(async () => {
  srv = createServer((s) => s.destroy());
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const D = await import('../server/db.js');
  db = D.db; D.initSchema();
  D.setSetting('device_enabled', '1'); D.setSetting('tcp_device_enabled', '1');
  S = await import('../server/device-sync.js');
  Z = await import('../server/zk-tcp.js');
  const add = (m) => (p, ...h) => { routes[`${m} ${p}`] = h[h.length - 1]; };
  (await import('../server/routes/admin/devices.js')).registerDeviceRoutes({ get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE') }, { need: () => (q, s, n) => n() });
  db.prepare("INSERT INTO push_devices(serial,name,active,conn_type,tcp_ip,tcp_port) VALUES('TCP9','Máy quầy',1,'tcp','127.0.0.1',?)").run(srv.address().port);
  // NV khai ở máy khác (máy đẩy SN_X): 6 có thẻ 888 + 1 vân tay; 9 không có thẻ; 7 đã nghỉ (khoá)
  db.prepare("INSERT INTO push_devices(serial,name,active) VALUES('SN_X','Máy cổng',1)").run();
  S.ingestUserData('SN_X', 'USER', ['USER PIN=6\tName=Tran Thi Sau\tPri=0\tCard=888', 'USER PIN=9\tName=Le Van Chin\tPri=0', 'USER PIN=7\tName=Da Nghi\tPri=0'].join('\n'));
  S.storeTemplates('SN_X', 'BIODATA', 'BIODATA Pin=6\tNo=3\tIndex=3\tValid=1\tDuress=0\tType=1\tMajorVer=10\tMinorVer=0\tFormat=0\tTmp=FPX6');
  db.prepare("UPDATE employees SET active=0 WHERE device_pin='7'").run();
});
after(() => { srv?.close(); for (const f of [SCRIPT, SDK, STATE]) { try { rmSync(f); } catch {} } });
const tcp = () => db.prepare("SELECT * FROM push_devices WHERE serial='TCP9'").get();

test('Tải nhân viên máy TCP/IP: lấy cả VÂN TAY + mật mã (trước chỉ Số ID / tên / thẻ)', { skip: !WIN && 'cần PowerShell' }, async () => {
  const r = await Z.tcpUsers(tcp(), () => {}, { fp: true });
  assert.deepEqual([r.read, r.fps], [2, 1]);
  const t = db.prepare("SELECT idx, major_ver, tmp FROM device_bio_templates WHERE serial='TCP9' AND pin='5' AND bio_type=1").all();
  assert.deepEqual(t.map((x) => ({ ...x })), [{ idx: 0, major_ver: 10, tmp: 'FPDEV5' }]);
  assert.equal(db.prepare("SELECT passwd FROM device_users WHERE pin='8'").get().passwd, '99');
  const auto = await Z.tcpUsers(tcp());   // tự tải theo chu kỳ: không đọc vân tay
  assert.equal(auto.fps, undefined);
});

test('Đẩy NV xuống máy TCP/IP: ghi tên + thẻ + vân tay từ máy khác; giữ quyền quản trị / thẻ máy đang có; thẻ không dính sang người sau; bỏ NV đã khoá', { skip: !WIN && 'cần PowerShell' }, async () => {
  db.prepare("UPDATE employees SET full_name='Nguyen Van Nam' WHERE device_pin='5'").run();
  const r = await Z.tcpPushUsers(tcp(), ['5', '6', '9', '7'], { withBio: true });
  assert.deepEqual([r.pushed, r.failed, r.fps, r.skipped], [3, 0, 1, 1]);
  assert.deepEqual(onDev('5'), { pin: '5', name: 'Nguyen Van Nam', pw: '', pri: 14, card: '777', fps: { 0: 'FPDEV5' } });
  assert.deepEqual(onDev('6'), { pin: '6', name: 'Tran Thi Sau', pw: '', pri: 0, card: '888', fps: { 3: 'FPX6' } });
  assert.equal(onDev('9').card, '', 'thẻ 888 của người trước không được dính sang');
  assert.equal(onDev('7'), undefined);
  // đọc lại máy → phần mềm biết 6, 9 đã có trên máy
  assert.deepEqual(db.prepare("SELECT pin FROM device_users_serial WHERE serial='TCP9' ORDER BY pin").all().map((x) => x.pin), ['5', '6', '8', '9']);
});

test('Nút "Đẩy NV xuống máy" chọn máy TCP/IP → chạy nền ghi thẳng xuống máy', { skip: !WIN && 'cần PowerShell' }, async () => {
  let out = null;
  await routes['POST /devices/push-employees']({ body: { pins: ['6'], serials: ['TCP9'], with_bio: false }, params: {}, query: {} }, { status() { return this; }, json(o) { out = o; return this; } });
  assert.ok(out.job, JSON.stringify(out));
  let j;
  for (let i = 0; i < 200; i++) {
    j = Z.getJob(out.job);
    if (j.state !== 'run') break;
    await new Promise((ok) => setTimeout(ok, 50));
  }
  assert.equal(j.state, 'done', j.msg);
  assert.deepEqual(j.result.devices.map((x) => [x.device, x.ok, x.tcp, x.pushed]), [['Máy quầy', true, true, 1]]);
});

test('Tải chấm công 1 ngày máy TCP/IP: KHÔNG đọc lại NV khi số NV không đổi; máy không lọc được theo ngày → nhớ, lần sau khỏi thử; báo thời gian từng bước; mã chưa khớp xem được là Số ID nào', { skip: !WIN && 'cần PowerShell' }, async () => {
  const run = async () => {
    let out = null;
    await routes['POST /devices/:id/tcp/:action']({ body: { from: '2026-10-28', to: '2026-10-28' }, params: { id: tcp().id, action: 'logs' }, query: {} }, { status() { return this; }, json(o) { out = o; return this; } });
    assert.ok(out.job, JSON.stringify(out));
    let j;
    for (let i = 0; i < 200; i++) { j = Z.getJob(out.job); if (j.state !== 'run') break; await new Promise((ok) => setTimeout(ok, 50)); }
    assert.equal(j.state, 'done', j.msg);
    return j.result;
  };
  const r1 = await run();
  assert.deepEqual([r1.read, r1.added, r1.users, r1.ranged], [3, 3, null, false], 'chỉ lấy 3 lượt ngày 28; NV trên máy = 4 = phần mềm đã biết → bỏ đọc NV');
  assert.equal(dev().rangeCalls, 1);
  assert.equal(tcp().tcp_no_range, 1);
  for (const k of ['connect', 'read', 'save']) assert.ok(r1.ms[k] >= 0, k);
  assert.equal(r1.ms.users, null);
  const r2 = await run();
  assert.equal(dev().rangeCalls, 1, 'đã biết máy không lọc được → không thử lại');
  assert.deepEqual([r2.read, r2.added], [3, 0]);
  assert.ok(!r2.ms.range_try, 'không tốn thời gian thử lọc');
  // có người mới đăng ký trên máy → số NV đổi → đọc NV lại
  const st = dev(); st.users.push({ pin: '77', name: 'Moi Dang Ky', pw: '', pri: 0, card: '', fps: {} }); writeFileSync(STATE, JSON.stringify(st));
  const r3 = await run();
  assert.equal(r3.users, 5);
  // Số ID chưa khớp: danh sách ở trang Máy chấm công
  let list = null;
  db.prepare("INSERT INTO device_punches(serial,pin,punch_at,work_date) VALUES('TCP9','555','2026-10-28T01:00:00.000Z','2026-10-28')").run();
  await routes['GET /devices']({ query: {}, params: {} }, { status() { return this; }, json(o) { list = o; return this; } });
  const m = list.rows.find((x) => x.serial === 'TCP9');
  assert.ok(m.unmatched_pins.some((x) => x.pin === '555' && x.n === 1), JSON.stringify(m.unmatched_pins));
});
