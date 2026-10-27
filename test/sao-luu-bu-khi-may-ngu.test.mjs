// SAO LƯU TỰ ĐỘNG BÙ: máy tính văn phòng NGỦ đúng giờ hẹn (2h sáng) thì trước đây không bao giờ sao lưu
// (minhphu 19→22/10/2026 chưa có bản tự động nào) → từ giờ hẹn trở đi trong ngày, máy thức là sao lưu bù 1 lần. Chạy: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-sao-luu-bu-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let getSetting, setSetting, B;
const made = [];
const autoFiles = () => B.listBackups().filter((b) => b.name.endsWith('_auto.db')).map((b) => b.name);
const vnHour = () => new Date(Date.now() + 7 * 3600e3).getUTCHours();

before(async () => {
  const D = await import('../server/db.js');
  ({ getSetting, setSetting } = D); D.initSchema();
  B = await import('../server/backup.js');
  setSetting('backup_enabled', '1');
  setSetting('backup_keep_days', '100000');   // không dọn bản sao lưu có sẵn trong data/backups
});
after(() => { for (const n of made) { try { rmSync(join(B.backupDir(), n)); } catch {} } });

test('chưa tới giờ hẹn trong ngày → chưa sao lưu', () => {
  setSetting('backup_hour', String(vnHour() + 1));   // 23h thì giờ hẹn 24 (không bao giờ tới) — vẫn đúng ý
  setSetting('backup_last_date', '');
  const prev = autoFiles();
  B.maybeAutoBackup();
  assert.deepEqual(autoFiles(), prev);
  assert.equal(getSetting('backup_last_date', ''), '');
});

test('đã QUA giờ hẹn mà hôm nay chưa sao lưu (máy ngủ lúc hẹn) → sao lưu bù đúng 1 lần', () => {
  setSetting('backup_hour', '0');
  setSetting('backup_last_date', '');
  const prev = new Set(autoFiles());
  B.maybeAutoBackup();
  const added = autoFiles().filter((n) => !prev.has(n));
  made.push(...added);
  assert.equal(added.length, 1);
  assert.match(getSetting('backup_last_date', ''), /^\d{4}-\d{2}-\d{2}$/);
  B.maybeAutoBackup();   // lần kiểm tra 5 phút sau: đã sao lưu hôm nay → không thêm
  assert.equal(autoFiles().filter((n) => !prev.has(n)).length, 1);
});
