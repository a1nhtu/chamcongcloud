// GỠ CÀI ĐẶT PHẢI TẮT HẲN TUNNEL: GoCaiDat.bat cũ (trước 9/10/2026) chỉ tắt node, cloudflared vẫn sống → máy mới cùng token bị 502
// tới khi khởi động lại máy cũ. Nút Cập nhật không thay file .bat nên app tự ghi lại GoCaiDat.bat lúc khởi động. Chạy: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GO_CAI_DAT_BAT, ensureAutostart } from '../server/autostart.js';

test('GoCaiDat.bat tắt cloudflared + node theo đúng thư mục / token, không tắt tổng thể', () => {
  assert.match(GO_CAI_DAT_BAT, /cloudflared\.exe/);
  assert.match(GO_CAI_DAT_BAT, /DGP_DIR/);
  assert.match(GO_CAI_DAT_BAT, /CommandLine\.Contains\(\$env:TUNNEL_TOKEN\)/);
  assert.doesNotMatch(GO_CAI_DAT_BAT, /taskkill\s+\/f\s+\/im/i);
  assert.doesNotMatch(GO_CAI_DAT_BAT, /Stop-Process\s+-Name/i);
});

test('GoCaiDat.bat tự xin quyền Admin, gỡ cả 2 lịch tự bật và báo thật khi chưa gỡ hết', () => {
  assert.match(GO_CAI_DAT_BAT, /-Verb RunAs/);
  assert.match(GO_CAI_DAT_BAT, /schtasks \/Delete \/TN "Digiplus-%PORT%" /);
  assert.match(GO_CAI_DAT_BAT, /schtasks \/Delete \/TN "Digiplus-%PORT%-logon" /);
  assert.match(GO_CAI_DAT_BAT, /CHUA GO HET/);
});

test('GoCaiDat.bat chỉ có ký tự ASCII và xuống dòng CRLF (có nhãn goto, ghi bằng latin1)', () => {
  assert.doesNotMatch(GO_CAI_DAT_BAT, /[^\x00-\x7f]/);
  assert.doesNotMatch(GO_CAI_DAT_BAT, /[^\r]\n/);
});

test('app tự thay GoCaiDat.bat cũ trên bản cài, chạy lại lần 2 thì không ghi nữa', { skip: process.platform !== 'win32' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'dgp-go-cai-dat-'));
  try {
    mkdirSync(join(root, 'runtime'));
    writeFileSync(join(root, 'runtime', 'node.exe'), '');
    writeFileSync(join(root, 'start-hidden.vbs'), '');
    writeFileSync(join(root, 'GoCaiDat.bat'), '@echo off\r\nrem ban cu khong tat cloudflared\r\n');
    const opts = { root, port: 59999, skipTask: true, startupDir: join(root, 'startup') };
    mkdirSync(opts.startupDir);
    assert.equal((await ensureAutostart(opts)).go, true);
    assert.equal(readFileSync(join(root, 'GoCaiDat.bat'), 'latin1'), GO_CAI_DAT_BAT);
    assert.equal((await ensureAutostart(opts)).go, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
