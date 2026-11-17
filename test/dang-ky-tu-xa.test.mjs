// ĐĂNG KÝ VÂN TAY / KHUÔN MẶT TỪ XA (tab Sinh trắc → "📲 Đăng ký từ xa"): người quản lý bấm ở văn phòng, máy ở xa hiện màn hình đăng ký.
//  - Máy ZKTeco ADMS: lệnh ENROLL_FP / ENROLL_BIO qua hàng lệnh; máy giả = gọi nextCommand / ackCommand / storeTemplates như /iclock.
//  - Máy Hikvision: máy chủ ISAPI giả (CaptureFingerPrint, CaptureFaceData + hỏi tiến độ, FingerPrint/SetUp, FDSetUp).
//  - Máy ZKTeco TCP/IP: chạy SCRIPT THẬT server/zk/zk-tcp.ps1 'enroll' với SDK giả (StartEnrollEx → máy "có" mẫu mới).
// Chạy: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, writeFileSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as netServer } from 'node:net';
import { moCong } from './_cong.mjs';

const WIN = process.platform === 'win32';
const T = (n) => join(tmpdir(), `dgp-dktx-${n}-${process.pid}`);
const DBP = T('db') + '.db', SCRIPT = T('script') + '.ps1', SDK = T('sdk') + '.ps1', STATE = T('state') + '.json';
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;
process.env.ZK_TCP_SCRIPT = SCRIPT;
process.env.FAKE_SDK = SDK;
process.env.FAKE_SDK_STATE = STATE;
process.env.ZK_ENROLL_WAIT = '1';   // SDK giả không báo sự kiện → script chờ yên 1 giây rồi đọc mẫu

// ---- SDK zkemkeeper giả cho máy TCP/IP: StartEnrollEx = NV đã đặt ngón xong → máy có mẫu mới ở ngón đó ----
const real = readFileSync(new URL('../server/zk/zk-tcp.ps1', import.meta.url), 'utf8');
const NEWZ = 'try { $z = New-Object -ComObject zkemkeeper.ZKEM }';
assert.ok(real.includes(NEWZ));
writeFileSync(SCRIPT, real.replace(NEWZ, 'try { . $env:FAKE_SDK }'));
writeFileSync(SDK, '﻿' + `
$global:FakeDev = Get-Content $env:FAKE_SDK_STATE -Raw -Encoding UTF8 | ConvertFrom-Json
function global:SaveFake { $global:FakeDev | ConvertTo-Json -Depth 8 | Set-Content $env:FAKE_SDK_STATE -Encoding UTF8 }
function global:FindU($p) { @($global:FakeDev.users) | Where-Object { $_.pin -eq [string]$p } | Select-Object -First 1 }
$z = New-Object PSObject
foreach ($n in 'Connect_Net', 'SetCommPassword', 'SetCommProType', 'Disconnect', 'EnableDevice', 'RefreshData', 'SetStrCardNumber', 'CancelOperation', 'StartIdentify') { $z | Add-Member ScriptMethod $n { $true } }
foreach ($n in 'GetFirmwareVersion', 'GetPlatform', 'GetDeviceMAC', 'GetProductCode', 'GetDeviceTime', 'GetDeviceStatus') { $z | Add-Member ScriptMethod $n { $false } }
$z | Add-Member ScriptMethod GetLastError { param($e) $e.Value = -5; $true }
$z | Add-Member ScriptMethod GetSerialNumber { param($m, $v) $v.Value = $global:FakeDev.serial; $true }
$z | Add-Member ScriptMethod GetSysOption { param($m, $k, $v) if ($k -eq '~ZKFPVersion') { $v.Value = '10'; return $true }; $false }
$z | Add-Member ScriptMethod SSR_GetUserInfo { param($m, $p, $name, $pw, $pri, $en) $u = FindU $p; if (-not $u) { return $false }; $name.Value = $u.name; $true }
$z | Add-Member ScriptMethod SSR_SetUserInfo { param($m, $p, $name, $pw, $pri, $en)
  $global:FakeDev.users = @($global:FakeDev.users) + [pscustomobject]@{ pin = [string]$p; name = $name; fps = [pscustomobject]@{} }; SaveFake; $true }
$z | Add-Member ScriptMethod GetUserTmpExStr { param($m, $p, $f, $flag, $tmp, $len)
  $u = FindU $p; if (-not $u) { return $false }; $t = $u.fps."$f"; if (-not $t) { return $false }
  $flag.Value = 1; $tmp.Value = $t; $len.Value = $t.Length; $true }
$z | Add-Member ScriptMethod SSR_DelUserTmpExt { param($m, $p, $f) $global:FakeDev.deleted = [int]$global:FakeDev.deleted + 1; SaveFake; $true }
$z | Add-Member ScriptMethod StartEnrollEx { param($p, $f, $flag)
  if ($global:FakeDev.refuse) { return $false }
  $u = FindU $p; $u.fps | Add-Member -Force NoteProperty ([string]$f) ('NEWFP-' + $p + '-' + $f); SaveFake; $true }
$z | Add-Member ScriptMethod StartEnroll { param($p, $f) $false }
`);
writeFileSync(STATE, JSON.stringify({ serial: 'TCPE', refuse: false, deleted: 0, users: [{ pin: '21', name: 'Co san', fps: { 6: 'OLDFP' } }] }));

let db, D, S, E, ZK, hikSrv, hikPort, tcpSrv;
const routes = {};
const call = async (key, { body = {}, params = {} } = {}) => {
  const hs = routes[key]; assert.ok(hs, 'thiếu route ' + key);
  let out = null, code = 200, i = 0;
  const res = { status(c) { code = c; return this; }, json(o) { out = o; return this; } };
  const req = { body, params, query: {}, user: { id: 1, role: 'admin', master: true } };
  const next = async () => { const h = hs[i++]; if (h) await h(req, res, next); };
  await next();
  return { code, out };
};
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const waitJob = async (id, ms = 20000) => { const t0 = Date.now(); for (;;) { const j = ZK.getJob(id); if (j.state !== 'run') return j; if (Date.now() - t0 > ms) throw new Error('job treo: ' + j.msg); await sleep(20); } };
const empId = (pin) => db.prepare('SELECT id FROM employees WHERE device_pin=?').get(pin).id;

// ---- máy ADMS giả: hỏi lệnh, chạy lệnh, báo kết quả ----
const seen = [];
let answer = () => '0';   // mã máy báo cho lệnh ENROLL
let deviceOn = true;
async function fakeAdms(serial, { stop }) {
  while (!stop.v) {
    await sleep(15);
    if (!deviceOn) continue;
    const c = S.nextCommand(serial);
    if (!c) continue;
    for (const line of c.split('\n')) {
      const [, id, content] = /^C:(\d+):(.*)$/s.exec(line);
      seen.push(content);
      if (/^ENROLL_/.test(content)) {
        const ret = answer(content);
        S.ackCommand(+id, ret);
        const pin = /PIN=(\w+)/.exec(content)[1];
        if (ret === '0' && /^ENROLL_FP/.test(content)) S.storeTemplates(serial, 'FP', `FP PIN=${pin}\tFID=${/FID=(\d)/.exec(content)[1]}\tSize=6\tValid=1\tTMP=ENRFP${pin}`);
        if (ret === '0' && /^ENROLL_BIO TYPE=9/.test(content)) S.storeTemplates(serial, 'BIODATA', `BIODATA Pin=${pin}\tNo=0\tIndex=0\tValid=1\tDuress=0\tType=9\tMajorVer=39\tMinorVer=0\tFormat=0\tTmp=ENRFACE${pin}`);
      } else S.ackCommand(+id, '0');
    }
  }
}

// ---- máy Hikvision giả ----
const H = { users: new Set(['31']), fpSet: [], faceSet: 0, progressCalls: 0, noCapture: false };
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7), Buffer.from([0xff, 0xd9])]);

before(async () => {
  hikSrv = createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const u = req.url, j = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      const x = (s) => { res.writeHead(200, { 'Content-Type': 'application/xml' }); res.end(s); };
      if (u.startsWith('/ISAPI/AccessControl/UserInfo/Search')) {
        const want = JSON.parse(b).UserInfoSearchCond.EmployeeNoList.map((e) => e.employeeNo);
        return j({ UserInfoSearch: { responseStatusStrg: 'OK', UserInfo: want.filter((p) => H.users.has(p)).map((p) => ({ employeeNo: p, name: 'X', userType: 'normal' })) } });
      }
      if (u.startsWith('/ISAPI/AccessControl/UserInfo/SetUp')) { H.users.add(JSON.parse(b).UserInfo.employeeNo); return j({ statusCode: 1 }); }
      if (u === '/ISAPI/AccessControl/CaptureFingerPrint') {
        if (H.noCapture) { res.writeHead(404); return res.end('<ResponseStatus><subStatusCode>notSupport</subStatusCode></ResponseStatus>'); }
        const no = /<fingerNo>(\d+)/.exec(b)[1];
        return x(`<CaptureFingerPrint version="2.0"><fingerData>SElLRlA=</fingerData><fingerNo>${no}</fingerNo><fingerPrintQuality>87</fingerPrintQuality></CaptureFingerPrint>`);
      }
      if (u.startsWith('/ISAPI/AccessControl/FingerPrintCfg/capabilities')) return j({ FingerPrintCfg: { enableCardReader: { '@min': 1, '@max': 1 } } });
      if (u.startsWith('/ISAPI/AccessControl/CardReaderCfg/1')) return j({ CardReaderCfg: { cardReaderFunction: ['fingerPrint', 'face'] } });
      if (u.startsWith('/ISAPI/AccessControl/FingerPrint/SetUp')) { H.fpSet.push(JSON.parse(b).FingerPrintCfg); return j({ FingerPrintStatus: { status: 'success', StatusList: [{ id: 1, cardReaderRecvStatus: 1 }] } }); }
      if (u === '/ISAPI/AccessControl/CaptureFaceData') return x('<CaptureFaceData version="2.0"><captureProgress>0</captureProgress></CaptureFaceData>');
      if (u === '/ISAPI/AccessControl/CaptureFaceData/Progress') {
        H.progressCalls++;
        return x(H.progressCalls < 2 ? '<CaptureFaceDataProgress><captureProgress>50</captureProgress></CaptureFaceDataProgress>'
          : `<CaptureFaceDataProgress><captureProgress>100</captureProgress><faceDataUrl>http://127.0.0.1:${hikPort}/LOCALS/pic/face.jpg@WEB0001</faceDataUrl></CaptureFaceDataProgress>`);
      }
      if (u === '/LOCALS/pic/face.jpg@WEB0001') { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(JPG); }
      if (u.startsWith('/ISAPI/Intelligent/FDLib?')) return j({ FDLib: [{ FDID: '1', faceLibType: 'blackFD' }] });
      if (u.startsWith('/ISAPI/Intelligent/FDLib/FDSetUp')) { H.faceSet++; return j({ statusCode: 1 }); }
      res.writeHead(404); res.end('{}');
    });
  });
  await moCong(hikSrv); hikPort = hikSrv.address().port;
  tcpSrv = netServer((s) => s.destroy()); await moCong(tcpSrv);

  D = await import('../server/db.js');
  db = D.db; D.initSchema();
  D.setSetting('device_enabled', '1'); D.setSetting('hik_device_enabled', '1'); D.setSetting('tcp_device_enabled', '1');
  S = await import('../server/device-sync.js');
  ZK = await import('../server/zk-tcp.js');
  E = await import('../server/remote-enroll.js');
  Object.assign(E.ENROLL_WAIT, { sendMs: 400, answerMs: 600, tmplMs: 400, tickMs: 20 });
  const add = (m) => (p, ...h) => { routes[`${m} ${p}`] = h; };
  (await import('../server/routes/admin/employees.js')).registerEmployeeRoutes({ get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE') }, { need: () => (q, s, n) => n() });
  const now = new Date().toISOString();
  db.prepare("INSERT INTO push_devices(serial,name,active,conn_type,last_seen) VALUES('ADMS1','Máy cổng',1,'push',?)").run(now);
  db.prepare("INSERT INTO push_devices(serial,name,active,conn_type,last_seen) VALUES('ADMS_OFF','Máy kho',1,'push','2026-01-01T00:00:00Z')").run();
  db.prepare("INSERT INTO push_devices(serial,name,active,conn_type,tcp_ip,tcp_port) VALUES('HIK1','Cửa 1',1,'hik','127.0.0.1',?)").run(hikPort);
  db.prepare("INSERT INTO push_devices(serial,name,active,conn_type,tcp_ip,tcp_port) VALUES('TCPE','Máy quầy',1,'tcp','127.0.0.1',?)").run(tcpSrv.address().port);
  db.prepare("INSERT INTO push_devices(serial,name,active,conn_type) VALUES('AI1','Máy AI',1,'ai')").run();
  S.ingestUserData('ADMS1', 'USER', 'USER PIN=11\tName=Da Co Tren May');   // 11 đã có trên máy ADMS1
  for (const [p, n] of [['12', 'Chua Co'], ['31', 'Hik Mot'], ['32', 'Hik Hai'], ['21', 'Co san'], ['22', 'Moi Tcp']]) S.createDraftEmployee(p, n);
});
after(() => { hikSrv?.close(); tcpSrv?.close(); for (const f of [SCRIPT, SDK, STATE]) { try { rmSync(f); } catch {} } });

test('Danh sách máy đăng ký từ xa: ADMS (vân tay + mặt, online/offline), Hikvision, TCP/IP (chỉ vân tay); máy AI không có', async () => {
  const r = await call('GET /employees/:id/enroll-devices', { params: { id: empId('11') } });
  const by = Object.fromEntries(r.out.devices.map((d) => [d.serial, d]));
  assert.deepEqual(Object.keys(by).sort(), ['ADMS1', 'ADMS_OFF', 'HIK1', 'TCPE']);
  assert.deepEqual([by.ADMS1.online, by.ADMS_OFF.online, by.ADMS1.onDevice, by.ADMS_OFF.onDevice], [true, false, true, false]);
  assert.deepEqual([by.TCPE.fp, by.TCPE.face, by.HIK1.face], [true, false, true]);
  assert.equal(r.out.fingers.length, 10);
  D.setSetting('hik_device_enabled', '0');
  const off = await call('GET /employees/:id/enroll-devices', { params: { id: empId('11') } });
  assert.ok(!off.out.devices.some((d) => d.serial === 'HIK1'), 'tắt công tắc Hikvision = không hiện máy Hikvision');
  D.setSetting('hik_device_enabled', '1');
});

test('ADMS vân tay: NV chưa có trên máy → ghi NV trước rồi ENROLL_FP; máy báo 0 + gửi mẫu → xong, mẫu đã về', async () => {
  const stop = { v: false }; seen.length = 0; answer = () => '0';
  const loop = fakeAdms('ADMS1', { stop });
  const r = await call('POST /employees/:id/remote-enroll', { params: { id: empId('12') }, body: { serial: 'ADMS1', kind: 'fp', fid: 3 } });
  assert.equal(r.code, 200, JSON.stringify(r.out));
  const j = await waitJob(r.out.job);
  stop.v = true; await loop;
  assert.equal(j.state, 'done', j.msg);
  assert.deepEqual([j.result.received, j.result.what], [true, 'Ngón trỏ trái']);
  assert.match(seen[0], /^DATA UPDATE USERINFO PIN=12\tName=Chua Co/);
  assert.equal(seen[1], 'ENROLL_FP PIN=12\tFID=3\tRETRY=3\tOVERWRITE=1');
  assert.equal(db.prepare("SELECT tmp FROM device_bio_templates WHERE serial='ADMS1' AND pin='12' AND bio_type=1 AND idx=3").get().tmp, 'ENRFP12');
  assert.equal(S.cmdLabel(seen[1]).what, 'Đăng ký vân tay từ xa');
});

test('ADMS: máy không hiểu ENROLL_FP (-1002) → thử ENROLL_BIO TYPE=1; máy báo mã dương → báo đăng ký không thành công kèm mã', async () => {
  const stop = { v: false }; seen.length = 0; answer = (c) => (/^ENROLL_FP/.test(c) ? '-1002' : '4');
  const loop = fakeAdms('ADMS1', { stop });
  const r = await call('POST /employees/:id/remote-enroll', { params: { id: empId('11') }, body: { serial: 'ADMS1', kind: 'fp', fid: 6 } });
  const j = await waitJob(r.out.job);
  stop.v = true; await loop;
  assert.deepEqual(seen, ['ENROLL_FP PIN=11\tFID=6\tRETRY=3\tOVERWRITE=1', 'ENROLL_BIO TYPE=1\tPIN=11\tFID=6\tRETRY=3\tOVERWRITE=1'], 'NV đã có trên máy → không ghi lại NV');
  assert.equal(j.state, 'err');
  assert.match(j.msg, /không thành công \(máy báo mã 4\)/);
});

test('ADMS khuôn mặt: ENROLL_BIO TYPE=9 (máy chưa có mặt nào → mặc định mặt đời mới), mẫu mặt về phần mềm', async () => {
  const stop = { v: false }; seen.length = 0; answer = () => '0';
  const loop = fakeAdms('ADMS1', { stop });
  const r = await call('POST /employees/:id/remote-enroll', { params: { id: empId('11') }, body: { serial: 'ADMS1', kind: 'face' } });
  const j = await waitJob(r.out.job);
  stop.v = true; await loop;
  assert.equal(j.state, 'done', j.msg);
  assert.deepEqual(seen, ['ENROLL_BIO TYPE=9\tPIN=11\tRETRY=3\tOVERWRITE=1']);
  assert.equal(j.result.received, true);
  assert.equal(S.cmdLabel(seen[0]).what, 'Đăng ký khuôn mặt từ xa');
});

test('ADMS: máy không lấy lệnh → hết giờ chờ, tự huỷ lệnh (không để máy nhận muộn rồi bật màn hình đăng ký bất ngờ); máy offline báo ngay', async () => {
  deviceOn = false;
  const stop = { v: false }; const loop = fakeAdms('ADMS1', { stop });
  const r = await call('POST /employees/:id/remote-enroll', { params: { id: empId('11') }, body: { serial: 'ADMS1', kind: 'fp', fid: 1 } });
  const j = await waitJob(r.out.job);
  stop.v = true; await loop; deviceOn = true;
  assert.equal(j.state, 'err'); assert.match(j.msg, /chưa nhận lệnh/);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM push_device_commands WHERE serial='ADMS1' AND content LIKE 'ENROLL_FP PIN=11\tFID=1%'").get().c, 0);
  const off = await call('POST /employees/:id/remote-enroll', { params: { id: empId('11') }, body: { serial: 'ADMS_OFF', kind: 'fp', fid: 1 } });
  const j2 = await waitJob(off.out.job);
  assert.match(j2.msg, /mất kết nối/);
  const ai = await call('POST /employees/:id/remote-enroll', { params: { id: empId('11') }, body: { serial: 'AI1', kind: 'fp' } });
  assert.equal(ai.code, 400);
});

test('Hikvision vân tay: máy đã có người → không ghi lại người; lấy vân tay (ngón FID+1) rồi ghi vào đầu đọc vân tay', async () => {
  const r = await call('POST /employees/:id/remote-enroll', { params: { id: empId('31') }, body: { serial: 'HIK1', kind: 'fp', fid: 6 } });
  const j = await waitJob(r.out.job);
  assert.equal(j.state, 'done', j.msg);
  assert.deepEqual(H.fpSet, [{ employeeNo: '31', enableCardReader: [1], fingerPrintID: 7, fingerType: 'normalFP', fingerData: 'SElLRlA=' }]);
  assert.equal(j.result.quality, 87);
});

test('Hikvision khuôn mặt: máy chưa có người → ghi người; chờ máy chụp (hỏi tiến độ) → tải ảnh → ghi mặt + lưu ảnh vào phần mềm', async () => {
  const r = await call('POST /employees/:id/remote-enroll', { params: { id: empId('32') }, body: { serial: 'HIK1', kind: 'face' } });
  const j = await waitJob(r.out.job);
  assert.equal(j.state, 'done', j.msg);
  assert.ok(H.users.has('32'));
  assert.deepEqual([H.faceSet, H.progressCalls >= 2], [1, true]);
  const ph = db.prepare("SELECT kind, photo FROM device_user_photos WHERE pin='32'").get();
  assert.equal(ph.kind, 'face');
  assert.deepEqual(Buffer.from(ph.photo, 'base64'), JPG);
});

test('Hikvision không có đầu đọc / không hỗ trợ lấy vân tay → báo rõ', async () => {
  H.noCapture = true;
  const r = await call('POST /employees/:id/remote-enroll', { params: { id: empId('31') }, body: { serial: 'HIK1', kind: 'fp', fid: 0 } });
  const j = await waitJob(r.out.job);
  H.noCapture = false;
  assert.equal(j.state, 'err'); assert.match(j.msg, /không hỗ trợ lấy vân tay từ xa/);
});

test('Ảnh trong dữ liệu máy trả (multipart) được tách đúng', () => {
  const buf = Buffer.concat([Buffer.from('--b\r\nContent-Type: image/jpeg\r\n\r\n'), JPG, Buffer.from('\r\n--b--')]);
  assert.deepEqual(E.jpgIn(buf), JPG);
  assert.equal(E.jpgIn(Buffer.from('<x/>'.repeat(40))), null);
});

test('TCP/IP vân tay: NV chưa có trên máy → script tạo NV, StartEnrollEx, đọc mẫu mới về; ngón đã có mẫu cũ thì chờ mẫu KHÁC mẫu cũ', { skip: !WIN && 'cần PowerShell', timeout: 60000 }, async () => {
  const r = await call('POST /employees/:id/remote-enroll', { params: { id: empId('22') }, body: { serial: 'TCPE', kind: 'fp', fid: 5 } });
  const j = await waitJob(r.out.job, 50000);
  assert.equal(j.state, 'done', j.msg);
  const st = JSON.parse(readFileSync(STATE, 'utf8').replace(/^﻿/, ''));
  assert.equal(st.users.find((u) => u.pin === '22').name, 'Moi Tcp');
  assert.equal(db.prepare("SELECT tmp FROM device_bio_templates WHERE serial='TCPE' AND pin='22' AND idx=5").get().tmp, 'NEWFP-22-5');
  const r2 = await call('POST /employees/:id/remote-enroll', { params: { id: empId('21') }, body: { serial: 'TCPE', kind: 'fp', fid: 6 } });
  const j2 = await waitJob(r2.out.job, 50000);
  assert.equal(j2.state, 'done', j2.msg);
  assert.equal(db.prepare("SELECT tmp FROM device_bio_templates WHERE serial='TCPE' AND pin='21' AND idx=6").get().tmp, 'NEWFP-21-6');
  const face = await call('POST /employees/:id/remote-enroll', { params: { id: empId('21') }, body: { serial: 'TCPE', kind: 'face' } });
  assert.equal(face.code, 400, 'máy TCP/IP chưa đăng ký khuôn mặt từ xa');
});

test('TCP/IP: máy từ chối lệnh đăng ký → báo đời máy chưa hỗ trợ', { skip: !WIN && 'cần PowerShell', timeout: 60000 }, async () => {
  const st = JSON.parse(readFileSync(STATE, 'utf8').replace(/^﻿/, '')); st.refuse = true; writeFileSync(STATE, JSON.stringify(st));
  const r = await call('POST /employees/:id/remote-enroll', { params: { id: empId('22') }, body: { serial: 'TCPE', kind: 'fp', fid: 2 } });
  const j = await waitJob(r.out.job, 50000);
  assert.equal(j.state, 'err'); assert.match(j.msg, /không nhận lệnh đăng ký vân tay từ xa \(mã lỗi -5\)/);
});

test('TCP/IP: không hỏi máy lúc đang đăng ký — bấm "Nhân viên đã đặt xong" thì đọc mẫu ngay, khỏi chờ hết giờ', { skip: !WIN && 'cần PowerShell', timeout: 60000 }, async () => {
  const st = JSON.parse(readFileSync(STATE, 'utf8').replace(/^﻿/, '')); st.refuse = false; writeFileSync(STATE, JSON.stringify(st));
  process.env.ZK_ENROLL_WAIT = '40';
  try {
    const t0 = Date.now();
    const r = await call('POST /employees/:id/remote-enroll', { params: { id: empId('22') }, body: { serial: 'TCPE', kind: 'fp', fid: 8 } });
    for (;;) { const j = ZK.getJob(r.out.job); if (j.canFinish && /màn hình đăng ký/.test(j.msg)) break; assert.equal(j.state, 'run', j.msg); await sleep(50); }
    const d = await call('POST /employees/remote-enroll/:job/done', { params: { job: r.out.job } });
    assert.equal(d.out.ok, true);
    const j = await waitJob(r.out.job, 50000);
    assert.equal(j.state, 'done', j.msg);
    assert.ok(Date.now() - t0 < 25000, 'đọc ngay sau khi bấm, không chờ đủ 40 giây');
    assert.equal(db.prepare("SELECT tmp FROM device_bio_templates WHERE serial='TCPE' AND pin='22' AND idx=8").get().tmp, 'NEWFP-22-8');
    assert.equal((await call('POST /employees/remote-enroll/:job/done', { params: { job: r.out.job } })).out.ok, false, 'việc đã xong → nút không còn tác dụng');
  } finally { process.env.ZK_ENROLL_WAIT = '1'; }
});
