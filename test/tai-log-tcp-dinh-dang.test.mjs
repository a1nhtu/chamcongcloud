// TẢI LOG MÁY TCP/IP: script thật server/zk/zk-tcp.ps1 phải in đúng dòng lượt chấm. Lỗi cũ (từ 1.19.0): viết '..' -f $h, $mi, $se
// ngay trong .Append(...) → PowerShell coi dấu phẩy là tham số của Append → "Error formatting a string", máy có lượt chấm nào
// là tải log hỏng (Letefe Bistro / nhahanggiadinh 29/10/2026). Các test khác dùng script giả lập nên không bắt được. Chạy: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../server/zk/zk-tcp.ps1', import.meta.url));

test('zk-tcp.ps1 định dạng dòng lượt chấm đúng "L pin yyyy-MM-dd HH:mm:ss vào/ra kiểu"', { skip: process.platform !== 'win32' && 'chỉ chạy trên Windows' }, () => {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Action', 'selftest'], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.equal(r.stdout, 'L\t15\t2026-10-09 07:05:03\t1\t15\n');
});
