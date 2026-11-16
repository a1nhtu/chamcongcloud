// CÔNG CỤ TRỎ MÁY BẰNG IP (máy chủ nhiều công ty, Anh 16/11/2026): máy chủ ở nơi khác không kết nối thẳng tới IP LAN
// của khách → tải .zip (TroMay.ps1 + TroMay.bat điền sẵn IP / tên miền / DHCP, kèm SDK) chạy trên máy tính cùng mạng với máy.
// Bản cài 1 công ty (không MULTI_TENANT) KHÔNG có công cụ này — vẫn dùng Tìm / Trỏ máy trong LAN như cũ.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import JSZip from 'jszip';

const DBP = join(tmpdir(), `dgp-tro-may-ip-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;
delete process.env.MULTI_TENANT;

let M;
before(async () => {
  const D = await import('../server/db.js');
  D.initSchema();
  M = await import('../server/routes/admin/devices.js');
});

test('zip có script + .bat điền sẵn IP / tên miền / DHCP + SDK + hướng dẫn', async () => {
  const { buf, sdk } = await M.buildPointTool({ ip: '192.168.1.210', domain: 'tungphong.maychamcongcloud.com' });
  const z = await JSZip.loadAsync(buf);
  const names = Object.keys(z.files);
  assert.ok(names.includes('TroMay.ps1') && names.includes('TroMay.bat') && names.includes('HUONG-DAN.txt'));
  if (sdk) assert.ok(names.includes('zksdk/zkemkeeper.dll'), 'có SDK thì phải kèm zkemkeeper.dll');
  const bat = await z.file('TroMay.bat').async('string');
  assert.ok(bat.includes('%SystemRoot%\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe'), 'chạy PowerShell 32-bit (SDK zkemkeeper 32-bit)');
  assert.match(bat, /-Ip 192\.168\.1\.210 -Domain tungphong\.maychamcongcloud\.com -Port 4370 -Key 0 -Dhcp\r\n/);
  assert.ok(bat.includes('\r\n') && !/[^\r]\n/.test(bat), '.bat xuống dòng CRLF');
  const ps = await z.file('TroMay.ps1').async('string');
  assert.ok(/^[\x00-\x7f]*$/.test(ps), 'script chỉ ký tự ASCII (PowerShell 5.1 đọc sai UTF-8 không BOM)');
  assert.match(ps, /ICLOCKSVRURL/);
});

test('bỏ tích DHCP + cổng / Comm Key riêng', async () => {
  const { buf } = await M.buildPointTool({ ip: '10.0.0.5', domain: 'abc.maychamcongcloud.com', dhcp: false, port: '4371', key: '123' });
  const bat = await (await JSZip.loadAsync(buf)).file('TroMay.bat').async('string');
  assert.match(bat, /-Port 4371 -Key 123\r\n/);
  assert.ok(!bat.includes('-Dhcp'));
});

test('IP / tên miền / cổng sai → báo lỗi 400, không sinh lệnh lạ trong .bat', async () => {
  for (const ip of ['', '192.168.1', '192.168.1.256', '1.2.3.4 & del x', '192.168.1.1"']) {
    await assert.rejects(M.buildPointTool({ ip, domain: 'a.b.com' }), (e) => e.status === 400, ip);
  }
  await assert.rejects(M.buildPointTool({ ip: '192.168.1.2', domain: '' }), (e) => e.status === 400);
  await assert.rejects(M.buildPointTool({ ip: '192.168.1.2', domain: 'a.com & calc' }), (e) => e.status === 400);
  await assert.rejects(M.buildPointTool({ ip: '192.168.1.2', domain: 'a.com', port: 70000 }), (e) => e.status === 400);
});

test('bản cài 1 công ty: không có công cụ tải (404), Tìm / Trỏ máy trong LAN giữ như cũ', async () => {
  const routes = {};
  const reg = (m) => (path, ...h) => { routes[m + ' ' + path] = h[h.length - 1]; };
  M.registerDeviceRoutes({ get: reg('GET'), post: reg('POST'), put: reg('PUT'), delete: reg('DELETE'), patch: reg('PATCH'), use() {} }, { need: () => (q, s, n) => n() });
  const h = routes['GET /devices/point-tool'];
  assert.ok(h, 'có route');
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(x) { this.body = x; return this; }, setHeader() {}, end() { this.code = 'sent'; } };
  await h({ query: { ip: '192.168.1.210' } }, res);
  assert.equal(res.code, 404);
  if (process.platform === 'win32') assert.equal(M.lanScanBlocked(), '');
});
