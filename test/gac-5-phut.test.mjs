// LỊCH GÁC 5 PHÚT (Anh chốt "Làm luôn" 04/11/2026): 3svina app tắt từ đầu giờ chiều, không gì bật lại, tối mới biết (502).
// App tự tạo lịch Digiplus-<cổng>-watch chạy start-hidden.vbs 5 phút/lần → ChayApp.bat bật lại phần nào đã tắt.
// ChayApp.bat không bật app khi cổng đang nghe, và CHỜ khi đang cập nhật (CapNhat.bat vừa ghi) để không chạy code chép dở.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHAY_APP_BAT, GO_CAI_DAT_BAT, WATCH_EVERY_MIN, watchTaskName, watchTaskArgs } from '../server/autostart.js';

test('lịch gác: 5 phút/lần chạy start-hidden.vbs; đủ quyền chạy bằng SYSTEM, không đủ quyền là lịch của user', () => {
  assert.equal(WATCH_EVERY_MIN, 5);
  assert.equal(watchTaskName(8697), 'Digiplus-8697-watch');
  const vbs = 'D:\\ChamCong\\DigiplusChamCong\\start-hidden.vbs';
  assert.deepEqual(watchTaskArgs('Digiplus-8697-watch', vbs, true), ['/Create', '/TN', 'Digiplus-8697-watch', '/TR',
    `wscript.exe "${vbs}"`, '/SC', 'MINUTE', '/MO', '5', '/F', '/RU', 'SYSTEM', '/RL', 'HIGHEST']);
  const user = watchTaskArgs('Digiplus-8697-watch', vbs, false);
  assert.ok(!user.includes('/RU') && !user.includes('SYSTEM'));
  assert.deepEqual(user.slice(0, 10), watchTaskArgs('Digiplus-8697-watch', vbs, true).slice(0, 10));
});

test('gỡ cài đặt xoá cả lịch gác và báo "chưa gỡ hết" nếu lịch còn', () => {
  assert.match(GO_CAI_DAT_BAT, /schtasks \/Delete \/TN "Digiplus-%PORT%-watch" \/F/);
  assert.match(GO_CAI_DAT_BAT, /schtasks \/Query \/TN "Digiplus-%PORT%-watch" >nul 2>&1 && set "CON=1"/);
  // xoá lịch TRƯỚC khi tắt node (không thì lịch gác bật lại ngay)
  assert.ok(GO_CAI_DAT_BAT.indexOf('-watch" /F') < GO_CAI_DAT_BAT.indexOf('Stop-Process'));
  assert.doesNotMatch(GO_CAI_DAT_BAT, /[^\x00-\x7f]/);
});

// Lấy đúng lệnh PowerShell kiểm tra "có nên bật app không" trong ChayApp.bat rồi chạy thật (chỉ trên Windows)
const appCheck = CHAY_APP_BAT.split('\n').find((l) => l.startsWith('powershell') && l.includes('-LocalPort %PORT%'));
const runCheck = (dir, port) => spawnSync('powershell', ['-NoProfile', '-Command', appCheck.slice(appCheck.indexOf('-Command "') + 10, appCheck.lastIndexOf('"')).replace(/%PORT%/g, String(port))],
  { env: { ...process.env, DGP_DIR: dir + '\\' }, windowsHide: true }).status;   // 0 = bật app, 1 = không bật
const freePort = () => new Promise((ok) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });

test('ChayApp.bat: CHỜ khi đang cập nhật, cập nhật cũ quá 3 phút thì bật; cổng đang nghe thì không bật trùng', { skip: process.platform !== 'win32' }, async () => {
  assert.ok(appCheck, 'không thấy lệnh kiểm tra trong ChayApp.bat');
  assert.match(CHAY_APP_BAT, /set "DGP_DIR=%~dp0"/);
  const dir = mkdtempSync(join(tmpdir(), 'dgp-gac-'));
  try {
    const port = await freePort();
    assert.equal(runCheck(dir, port), 0, 'không cập nhật, cổng trống → bật');
    const bat = join(dir, 'CapNhat.bat');
    writeFileSync(bat, '@echo off\r\n');
    assert.equal(runCheck(dir, port), 1, 'CapNhat.bat vừa ghi → đang cập nhật, không bật');
    const old = new Date(Date.now() - 10 * 60000);
    utimesSync(bat, old, old);
    assert.equal(runCheck(dir, port), 0, 'CapNhat.bat sót lại từ 10 phút trước (cập nhật hỏng) → vẫn bật');
    rmSync(bat);
    const srv = createServer().listen(0, '0.0.0.0');
    await new Promise((ok) => srv.on('listening', ok));
    try { assert.equal(runCheck(dir, srv.address().port), 1, 'cổng đang nghe → không bật trùng'); }
    finally { srv.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
