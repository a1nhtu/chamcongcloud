// Hộp "Tìm máy chấm công trong mạng LAN" (public/admin-parts/82-may-tcp.js) — Anh 28/11/2026: khách nhiều máy →
// nút "Trỏ tất cả" + ô "Ẩn thiết bị hãng khác" (mặc định tích) để không hiện camera Hikvision. Chạy: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../public/admin-parts/82-may-tcp.js', import.meta.url), 'utf8');
const fn = (name) => {
  const m = src.match(new RegExp(`function ${name}\\([^)]*\\) \\{[^\\n]*\\}`));
  assert.ok(m, `không thấy hàm ${name}`);
  return new Function(`${m[0]}; return ${name};`)();
};
const lanOtherBrand = fn('lanOtherBrand');
const lanPointAllTargets = fn('lanPointAllTargets');

test('hãng khác = thiết bị Hikvision theo MAC; dòng IP trùng (máy ZK + Hik cùng IP) vẫn hiện', () => {
  assert.equal(lanOtherBrand({ hik: true, no_sdk: true, ip: '192.168.1.163' }), true);
  assert.equal(lanOtherBrand({ hik: true, no_sdk: true, conflict: true }), false);
  assert.equal(lanOtherBrand({ serial: '2145254401024', ip: '192.168.1.4' }), false);
  assert.equal(lanOtherBrand({ no_sdk: true, mac: '00:17:61:11:00:59' }), false);   // MAC ZKTeco, không đọc SDK được
});

test('Trỏ tất cả chỉ lấy máy đọc được, chưa trỏ về đây, không cần mật khẩu kết nối', () => {
  const rows = [
    { ip: '.4', serial: 'A' },                              // ✓
    { ip: '.5', serial: 'B', udp: true },                   // ✓
    { ip: '.6', serial: 'C', points_here: true },           // đã trỏ
    { ip: '.7', error: 'Máy đặt mật khẩu', code: 'NEEDKEY' },
    { ip: '.8', serial: 'D', code: 'WRONGKEY' },
    { ip: '.9', no_sdk: true, mac: '00:17:61:00:00:01' },   // không vào SDK
    { ip: '.10', hik: true, no_sdk: true },                  // camera
  ];
  assert.deepEqual(lanPointAllTargets(rows).map((x) => x.ip), ['.4', '.5']);
});

test('giao diện: ô Ẩn hãng khác mặc định tích (nhớ theo trình duyệt), nút Trỏ tất cả hỏi 1 lần rồi ghi lần lượt', () => {
  assert.match(src, /let hideOther = true; try \{ hideOther = localStorage\.getItem\('lanHideOther'\) !== '0'; \} catch \{\}/);
  assert.match(src, /Ẩn thiết bị hãng khác/);
  assert.match(src, /Trỏ tất cả \(\$\{targets\.length\} máy\)/);
  // ghi tuần tự (await trong vòng for), gọi point ở chế độ im lặng — không hỏi confirm từng máy
  assert.match(src, /for \(const x of list\) \{[\s\S]*?await point\(x, r, cells\.get\(x\), true\)/);
  assert.match(src, /if \(!silent && !confirm\(/);
});
