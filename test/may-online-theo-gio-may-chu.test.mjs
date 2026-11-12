// Online/Offline của máy chấm công: máy chủ tính bằng giờ của nó, trang chỉ hiển thị + tự làm mới.
// Trước đây trang tự tính bằng đồng hồ máy đang xem và chỉ tính 1 lần lúc mở trang → máy vẫn gọi về đều, nhận lệnh tốt
// mà vẫn hiện Offline (aac 06/11/2026). Chạy: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(tmpdir(), `dgp-online-test-${process.pid}.db`);
const { deviceOnline } = await import('../server/device-sync.js');
const admin = (await import('../server/admin-bundle.js')).adminBundle();   // trang quản lý = các phần trong public/admin-parts ghép lại

test('máy gọi về trong 2,5 phút = Online, im lâu hơn hoặc chưa từng gọi = Offline', () => {
  const now = Date.parse('2026-11-06T03:50:00.000Z');
  assert.equal(deviceOnline('2026-11-06T03:49:50.000Z', now), true);
  assert.equal(deviceOnline('2026-11-06T03:47:31.000Z', now), true);
  assert.equal(deviceOnline('2026-11-06T03:47:30.000Z', now), false);
  assert.equal(deviceOnline('', now), false);
  assert.equal(deviceOnline(null, now), false);
});

test('trang không tự so last_seen với đồng hồ máy đang xem', () => {
  assert.doesNotMatch(admin, /Date\.now\(\)\s*-\s*Date\.parse\([\w.]*last_seen\)/);
});

test('vòng tự làm mới 10 giây cập nhật cả trạng thái, không chỉ số liệu', () => {
  const start = admin.indexOf('const tickCounts');
  const tick = admin.slice(start, admin.indexOf('setTimeout(tickCounts, 10000);', admin.indexOf('setTimeout(tickCounts, 10000);', start) + 10));
  assert.match(tick, /statusCells\[m\.serial\]/);
  assert.match(tick, /'Online' : 'Offline'/);
  assert.match(tick, /seenText\(m\.last_seen\)/);
});
