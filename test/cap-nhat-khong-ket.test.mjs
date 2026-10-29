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
