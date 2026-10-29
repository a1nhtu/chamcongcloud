// NÚT CẬP NHẬT KHÔNG ĐƯỢC KẸT (Letefe Bistro / nhahanggiadinh 29/10/2026: bấm Cập nhật ngay → báo xong → vẫn bản cũ, bấm lại
// cũng thế). Bước thay code + khởi động lại hỏng thì tiến trình cũ cứ ở trạng thái 'restart' → mọi lần bấm sau chỉ đứng chờ.
// Giờ: quá 2 phút cho bấm lại; CapNhat.bat tắt ĐÚNG tiến trình đang chạy (pid) + ghi CapNhat.log từng bước. Chạy: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-cap-nhat-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let U;
before(async () => {
  const D = await import('../server/db.js'); D.initSchema();
  U = await import('../server/update.js');
});

test('đang tải / vừa sang bước khởi động lại → không chạy chồng; kẹt "khởi động lại" quá 2 phút → cho cập nhật lại', () => {
  const now = Date.now();
  assert.equal(U.updateBusy({ state: 'run' }, now), true);
  assert.equal(U.updateBusy({ state: 'restart', restartAt: now - 30e3 }, now), true);
  assert.equal(U.updateBusy({ state: 'restart', restartAt: now - 121e3 }, now), false);
  assert.equal(U.updateBusy({ state: 'restart' }, now), false, 'trạng thái cũ không có mốc giờ cũng không được kẹt');
  assert.equal(U.updateBusy({ state: 'error' }, now), false);
  assert.equal(U.updateBusy({ state: 'idle' }, now), false);
});

test('CapNhat.bat tắt đúng tiến trình đang chạy theo pid, ghi CapNhat.log từng bước', () => {
  const bat = U.buildBat({ appDir: 'C:\\D\\app', staged: 'C:\\D\\_update\\staged', prev: 'C:\\D\\_prev', workRoot: 'C:\\D\\_update',
    config: 'C:\\D\\config.txt', vbsPath: 'C:\\D\\restart-app.vbs', runVbs: 'C:\\D\\CapNhat.vbs', pid: 4321 });
  assert.match(bat, /taskkill \/f \/pid 4321 >> ".*CapNhat\.log" 2>&1/);
  assert.match(bat, /if not "%%p"=="4321" taskkill/);
  assert.match(bat, /chep server: robocopy ma %errorlevel%/);
  assert.match(bat, /copy \/y "C:\\D\\_update\\staged\\package\.json" "C:\\D\\app\\package\.json" >> ".*CapNhat\.log"/);
  // thứ tự: tắt app → chép bản mới → khởi động lại
  assert.ok(bat.indexOf('taskkill /f /pid 4321') < bat.indexOf('robocopy "C:\\D\\_update\\staged\\server"'));
  assert.ok(bat.indexOf('robocopy "C:\\D\\_update\\staged\\server"') < bat.indexOf('wscript "C:\\D\\restart-app.vbs"'));
});

// Vừa phát hành 1.25.4: thanh nhắc thấy 1.25.4 nhưng lúc bấm GitHub trả số cũ đang lưu đệm (1.25.3) → trước báo "đã ở bản mới nhất",
// không tải gì, thanh nhắc vẫn hiện (nhahanggiadinh 29/10/2026). Giờ cập nhật theo bản màn hình đã thấy; tải về mà chưa mới hơn thì báo đợi.
test('GitHub trả số cũ lưu đệm nhưng màn hình đã thấy bản mới → vẫn cập nhật theo bản đã thấy', () => {
  const stale = { current: '1.25.3', latest: '1.25.3', hasUpdate: false };
  assert.deepEqual(U.pickTarget(stale, '1.25.4'), { current: '1.25.3', latest: '1.25.4', hasUpdate: true });
  assert.equal(U.pickTarget(stale, '').hasUpdate, false, 'không có bản đã thấy → như cũ');
  assert.equal(U.pickTarget(stale, '1.25.3').hasUpdate, false, 'bản đã thấy không mới hơn → không cập nhật');
  assert.equal(U.pickTarget(stale, 'abc').hasUpdate, false);
  const fresh = { current: '1.25.3', latest: '1.25.5', hasUpdate: true };
  assert.equal(U.pickTarget(fresh, '1.25.4'), fresh, 'GitHub đã trả bản mới → dùng kết quả GitHub');
});

test('Bản tải về chưa mới hơn bản đang chạy → không cài đè', () => {
  assert.equal(U.stagedIsNewer('1.25.3', '1.25.3'), false);
  assert.equal(U.stagedIsNewer('', '1.25.3'), false);
  assert.equal(U.stagedIsNewer('1.25.4', '1.25.3'), true);
  assert.equal(U.stagedIsNewer('1.26.0', '1.25.10'), true);
});

test('Bản cũ không tắt được sau khi cập nhật → bản mới nhận ra đúng pid bản cũ để tự tắt (dấu mới, không phải chính mình)', () => {
  const now = 1_000_000_000;
  const mark = (pid, at) => JSON.stringify({ pid, at });
  assert.equal(U.oldPidToReplace(mark(4321, now - 60000), now, 999), 4321);          // vừa cập nhật 1 phút trước
  assert.equal(U.oldPidToReplace(mark(4321, now - 16 * 60000), now, 999), 0);        // dấu cũ quá 15 phút → bỏ qua
  assert.equal(U.oldPidToReplace(mark(999, now - 1000), now, 999), 0);               // pid chính mình
  assert.equal(U.oldPidToReplace(mark(-1, now), now, 999), 0);
  assert.equal(U.oldPidToReplace('', now, 999), 0);                                  // không có file
  assert.equal(U.oldPidToReplace('rác', now, 999), 0);
});
