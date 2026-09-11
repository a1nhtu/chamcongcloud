// Sao lưu / phục hồi cơ sở dữ liệu (SQLite).
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { db, DATA_DIR, DB_PATH, getSetting, setSetting } from './db.js';

export const BACKUP_DIR = join(DATA_DIR, 'backups');
mkdirSync(BACKUP_DIR, { recursive: true });

const pad = (n) => String(n).padStart(2, '0');
// Giờ/ngày theo múi giờ VN (UTC+7)
function vnParts(d = new Date()) {
  const t = new Date(d.getTime() + 7 * 3600000);
  return {
    date: `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`,
    hour: t.getUTCHours(), min: t.getUTCMinutes(),
  };
}

// Tạo 1 bản sao lưu ngay. reason: 'auto' | 'manual'
export function doBackup(reason = 'manual') {
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {}
  const p = vnParts();
  const name = `digiplus_${p.date}_${pad(p.hour)}${pad(p.min)}_${reason}.db`;
  const dest = join(BACKUP_DIR, name);
  copyFileSync(DB_PATH, dest);
  return { name, size: statSync(dest).size };
}

// Danh sách bản sao lưu (mới nhất trước)
export function listBackups() {
  if (!existsSync(BACKUP_DIR)) return [];
  return readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.db'))
    .map((f) => { const s = statSync(join(BACKUP_DIR, f)); return { name: f, size: s.size, mtime: s.mtimeMs }; })
    .sort((a, b) => b.mtime - a.mtime);
}

// Giữ lại `keep` bản gần nhất, xoá phần cũ hơn
export function pruneBackups(keep) {
  keep = Math.max(1, parseInt(keep, 10) || 7);
  const all = listBackups();
  for (const b of all.slice(keep)) { try { rmSync(join(BACKUP_DIR, b.name)); } catch {} }
  return all.length - Math.min(all.length, keep);
}

export function backupPath(name) {
  // chống path traversal: chỉ nhận tên file .db, không có dấu tách thư mục
  if (!/^[\w.\-]+\.db$/.test(name)) return null;
  const p = join(BACKUP_DIR, name);
  return existsSync(p) ? p : null;
}

export function deleteBackup(name) {
  const p = backupPath(name);
  if (!p) return false;
  rmSync(p); return true;
}

// --- Phục hồi: ghi file chờ, việc ĐỔI file thực hiện lúc khởi động lại (xem db.js) ---
const PENDING = DB_PATH + '.restore';
export function stageRestore(buffer) {
  // kiểm tra chữ ký SQLite ("SQLite format 3\0")
  const sig = buffer.slice(0, 16).toString('latin1');
  if (!sig.startsWith('SQLite format 3')) throw new Error('File không phải cơ sở dữ liệu Digiplus hợp lệ');
  writeFileSync(PENDING, buffer);   // ghi đồng bộ
  return true;
}

// Auto-backup: gọi định kỳ; tự chạy khi tới giờ đặt & chưa backup hôm nay
export function maybeAutoBackup() {
  if (getSetting('backup_enabled', '1') !== '1') return;
  const hour = parseInt(getSetting('backup_hour', '2'), 10);
  const p = vnParts();
  if (p.hour !== hour) return;
  if (getSetting('backup_last_date', '') === p.date) return; // đã backup hôm nay
  try {
    doBackup('auto');
    setSetting('backup_last_date', p.date);
    pruneBackups(getSetting('backup_keep_days', '7'));
    console.log(`  [backup] Đã tự sao lưu ${p.date} ${pad(p.hour)}:${pad(p.min)}`);
  } catch (e) { console.error('  [backup] Lỗi tự sao lưu:', e.message); }
}
