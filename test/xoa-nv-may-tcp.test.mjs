// XOÁ NV (VD NV đã khoá) TRÊN MÁY TCP/IP (Letefe Bistro / nhahanggiadinh 29/10/2026: máy TCP/IP không xoá được NV đã khoá, chỉ máy
// đẩy (ADMS) xoá được). Trước: màn "Xóa dữ liệu trên máy" của máy TCP/IP không có chỗ xoá từng người; lệnh SDK chỉ thử 1 cách
// (SSR_DeleteEnrollData 12) và tin giá trị trả về. Giờ: chọn từng người để xoá; script thử 3 cách, đọc lại máy xem đã mất chưa.
// Phần 1 chạy HÀM THẬT DeleteOne trong server/zk/zk-tcp.ps1 với "máy giả" từng kiểu firmware. Chạy: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';

const WIN = process.platform === 'win32';
const DBP = join(tmpdir(), `dgp-xoa-nv-tcp-test-${process.pid}.db`);
const FAKE = join(tmpdir(), `dgp-xoa-nv-tcp-fake-${process.pid}.ps1`);
const HARNESS = join(tmpdir(), `dgp-xoa-nv-tcp-harness-${process.pid}.ps1`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;
process.env.ZK_TCP_SCRIPT = FAKE;
process.env.ZK_RETRY_MS = '50';

// Lấy 2 hàm UserOnDevice + DeleteOne từ script thật, chạy với máy giả $z: mode = kiểu firmware
writeFileSync(HARNESS, '﻿' + `param([string]$Script, [string]$Mode, [string]$Pins, [string]$OnDevice)
$t = $null; $e = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($Script, [ref]$t, [ref]$e)
foreach ($f in $ast.FindAll({ param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] -and @('UserOnDevice', 'DeleteOne') -contains $a.Name }, $true)) { . ([scriptblock]::Create($f.Extent.Text)) }
$global:users = [System.Collections.Generic.HashSet[string]]::new([string[]]($OnDevice -split ',' | ? { $_ }))
$global:mode = $Mode
$m = 1
$z = New-Object PSObject
$z | Add-Member ScriptMethod SSR_GetUserInfo { param($mm, $p, $n, $pw, $pri, $en) return $global:users.Contains([string]$p) }
# 'ok'       : lệnh 12 xoá được (đa số máy)
# 'lie'      : lệnh 12 trả true nhưng KHÔNG xoá; lệnh Ext 13 mới xoá được
# 'falseok'  : lệnh 12 trả false dù ĐÃ xoá (nhiều firmware)
# 'legacy'   : chỉ lệnh đời cũ DeleteEnrollData(Số ID dạng số) xoá được
# 'stuck'    : không lệnh nào xoá được
$z | Add-Member ScriptMethod SSR_DeleteEnrollData { param($mm, $p, $b) switch ($global:mode) { 'ok' { return $global:users.Remove([string]$p) } 'lie' { return $true } 'falseok' { [void]$global:users.Remove([string]$p); return $false } default { return $false } } }
$z | Add-Member ScriptMethod SSR_DeleteEnrollDataExt { param($mm, $p, $b) if ($global:mode -eq 'lie') { return $global:users.Remove([string]$p) }; return $false }
$z | Add-Member ScriptMethod DeleteEnrollData { param($mm, $p, $m2, $b) if ($global:mode -eq 'legacy') { return $global:users.Remove([string]$p) }; return $false }
foreach ($p in ($Pins -split ',')) { [Console]::Out.WriteLine("$p=" + (DeleteOne $p)) }
[Console]::Out.WriteLine('left=' + (($global:users | Sort-Object) -join ','))
`);
const runDelete = (mode, pins, onDevice) => {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', HARNESS,
    '-Script', new URL('../server/zk/zk-tcp.ps1', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '-Mode', mode, '-Pins', pins, '-OnDevice', onDevice], { encoding: 'utf8' });
  return Object.fromEntries(out.trim().split(/\r?\n/).map((l) => l.split('=')));
};

test('Xoá trên máy thật kiểu nào cũng ra đúng: xoá được = 1, máy không cho xoá = 0, không có trên máy = -', { skip: !WIN && 'cần PowerShell (Windows)' }, () => {
  assert.deepEqual(runDelete('ok', '5,9', '5,6'), { 5: '1', 9: '-', left: '6' });
  assert.deepEqual(runDelete('lie', '5', '5,6'), { 5: '1', left: '6' }, 'lệnh 12 báo xong mà chưa xoá → thử tiếp lệnh 13');
  assert.deepEqual(runDelete('falseok', '5', '5,6'), { 5: '1', left: '6' }, 'lệnh trả false nhưng đã xoá → vẫn báo xoá được');
  assert.deepEqual(runDelete('legacy', '5', '5,6'), { 5: '1', left: '6' }, 'firmware đời cũ → lệnh DeleteEnrollData');
  assert.deepEqual(runDelete('stuck', '5', '5,6'), { 5: '0', left: '5,6' }, 'không xoá được thì báo thật, không báo "đã xoá"');
});

// Phần 2: nút "Xóa nhân viên đã chọn" của máy TCP/IP → chạy nền qua script, người xoá được bỏ khỏi danh sách máy, người còn thì giữ
let db, srv, port;
const routes = {};
const call = async (key, { body = {}, params = {} } = {}) => {
  let out = null, code = 200;
  const res = { status(c) { code = c; return this; }, json(o) { out = o; return this; } };
  await routes[key]({ body, params, query: {}, user: { id: 999999, role: 'admin' } }, res);
  return { code, out };
};
before(async () => {
  // máy giả: Serial TCP001; xoá: 5 xoá được, 6 máy không cho xoá, 9 không có trên máy
  writeFileSync(FAKE, '﻿' + `param([string]$Ip, [int]$Port = 4370, [int]$Key = 0, [string]$Action = 'info', [string]$From = '', [string]$To = '', [int]$Machine = 1, [string]$Proto = '')
function Out($s) { [Console]::Out.WriteLine($s) }
switch ($Action) {
  'info' { Out "I\`tserial\`tTCP001"; Out "I\`tusers\`t1"; Out "OK\`tinfo" }
  'delete-users' { foreach ($p in ($From -split ',')) { Out ("D\`t$p\`t" + $(switch ($p) { '5' { '1' } '6' { '0' } default { '-' } })) }; Out "OK\`tdelete-users" }
  default { Out "ERR\`tBADACTION\`t$Action"; exit 1 }
}
`);
  srv = createServer((s) => s.destroy());
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  port = srv.address().port;
  const D = await import('../server/db.js');
  db = D.db; D.initSchema();
  D.setSetting('device_enabled', '1'); D.setSetting('tcp_device_enabled', '1');
  const add = (m) => (p, ...h) => { routes[`${m} ${p}`] = h[h.length - 1]; };
  (await import('../server/routes/admin/devices.js')).registerDeviceRoutes({ get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE') }, { need: () => (q, s, n) => n() });
  db.prepare("INSERT INTO push_devices(serial,name,active,conn_type,tcp_ip,tcp_port) VALUES('TCP001','Máy quầy',1,'tcp','127.0.0.1',?)").run(port);
  const S = await import('../server/device-sync.js');
  S.ingestUserData('TCP001', 'USER', ['5\tNguyen Van A', '6\tTran Thi B', '7\tLe Van C'].map((x) => `USER PIN=${x.split('\t')[0]}\tName=${x.split('\t')[1]}\tPri=0`).join('\n'));
  db.prepare("UPDATE employees SET active=0 WHERE device_pin IN ('5','6')").run();   // 5, 6 đã khoá (nghỉ việc)
});
after(() => { srv?.close(); for (const f of [FAKE, HARNESS]) { try { rmSync(f); } catch {} } });

const devId = () => db.prepare("SELECT id FROM push_devices WHERE serial='TCP001'").get().id;
const waitJob = async (id) => {
  for (let i = 0; i < 200; i++) {
    const { out } = await call('GET /devices/tcp-jobs/:job', { params: { job: id } });
    if (out.state !== 'run') return out;
    await new Promise((ok) => setTimeout(ok, 50));
  }
  throw new Error('job không xong');
};

test('Danh sách NV trên máy kèm "đã khoá" để lọc', async () => {
  const { out } = await call('GET /devices/:id/users', { params: { id: devId() } });
  assert.deepEqual(out.rows.map((u) => [u.pin, u.active]), [['5', false], ['6', false], ['7', true]]);
});

test('Máy TCP/IP: xoá NV đã chọn → báo đúng ai xoá được / máy không cho xoá / không có; người còn trên máy giữ trong danh sách', { skip: !WIN && 'cần PowerShell (Windows)' }, async () => {
  const bad = await call('POST /devices/:id/tcp/:action', { params: { id: devId(), action: 'delete-users' }, body: { pins: ['x y!'] } });
  assert.equal(bad.code, 400);
  const { code, out } = await call('POST /devices/:id/tcp/:action', { params: { id: devId(), action: 'delete-users' }, body: { pins: ['5', '6', '9'] } });
  assert.equal(code, 200, JSON.stringify(out));
  const j = await waitJob(out.job);
  assert.equal(j.state, 'done', j.msg);
  assert.deepEqual([j.result.deleted, j.result.failed, j.result.absent], [['5'], ['6'], ['9']]);
  assert.deepEqual(db.prepare("SELECT pin FROM device_users_serial WHERE serial='TCP001' ORDER BY pin").all().map((r) => r.pin), ['6', '7']);
});

test('Xoá trên TẤT CẢ máy: máy TCP/IP báo cả người máy không cho xoá', { skip: !WIN && 'cần PowerShell (Windows)' }, async () => {
  const { out } = await call('POST /devices/delete-users-all', { body: { pins: ['6'] } });
  const j = await waitJob(out.job);
  assert.equal(j.state, 'done', j.msg);
  assert.deepEqual(j.result.devices, [{ device: 'Máy quầy', ok: true, deleted: 0, failed: ['6'] }]);
});
