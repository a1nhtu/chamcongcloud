// Sao lưu / phục hồi cơ sở dữ liệu (SQLite) + sao lưu TOÀN BỘ (.zip gồm DB + ảnh + logo).
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { db, DATA_DIR, DB_PATH, getSetting, setSetting } from './db.js';
import { UPLOAD_DIR } from './storage.js';

const ROOT = join(DATA_DIR, '..');                 // thư mục app (chứa uploads/)
const winTar = () => { const p = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'); return existsSync(p) ? p : 'tar'; };

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
    .filter((f) => f.endsWith('.db') || f.endsWith('.zip'))
    .map((f) => { const s = statSync(join(BACKUP_DIR, f)); return { name: f, size: s.size, mtime: s.mtimeMs, full: f.endsWith('.zip') }; })
    .sort((a, b) => b.mtime - a.mtime);
}

// Giữ lại `keep` bản gần nhất, xoá phần cũ hơn
export function pruneBackups(keep) {
  keep = Math.max(1, parseInt(keep, 10) || 7);
  const all = listBackups().filter((b) => !b.full);   // chỉ dọn bản .db tự động; GIỮ .zip toàn bộ
  for (const b of all.slice(keep)) { try { rmSync(join(BACKUP_DIR, b.name)); } catch {} }
  return Math.max(0, all.length - keep);
}

export function backupPath(name) {
  // chống path traversal: chỉ nhận tên file .db/.zip, không có dấu tách thư mục
  if (!/^[\w.\-]+\.(db|zip)$/.test(name)) return null;
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

/* ---------------- SAO LƯU / PHỤC HỒI TOÀN BỘ (.zip = DB + ảnh + logo) ---------------- */
// Tạo 1 file .zip gồm database + thư mục uploads (ảnh chấm công + logo). Dùng để chuyển máy/VPS.
export function doFullBackup() {
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {}
  const p = vnParts();
  const name = `digiplus_full_${p.date}_${pad(p.hour)}${pad(p.min)}.zip`;
  const dest = join(BACKUP_DIR, name);
  if (existsSync(dest)) { try { rmSync(dest); } catch {} }
  // Copy DB ra thư mục tạm trước (tar đọc trực tiếp file DB đang mở sẽ bị "Permission denied")
  const stage = join(BACKUP_DIR, '_full_' + Date.now());
  mkdirSync(stage, { recursive: true });
  copyFileSync(DB_PATH, join(stage, 'digiplus.db'));
  try {
    const args = ['--format', 'zip', '-cf', dest, '-C', stage, 'digiplus.db'];
    if (existsSync(UPLOAD_DIR)) args.push('-C', ROOT, 'uploads');   // kèm ảnh + logo nếu có (không bị khoá)
    execFileSync(winTar(), args, { stdio: 'ignore' });
  } finally { rmSync(stage, { recursive: true, force: true }); }
  return { name, size: statSync(dest).size };
}

// Phục hồi từ .zip: nạp lại database (áp lúc khởi động lại) + thay ngay thư mục uploads.
export function stageFullRestore(buffer) {
  if (buffer.slice(0, 2).toString('latin1') !== 'PK') throw new Error('File không phải bản sao lưu .zip hợp lệ');
  const tmp = join(BACKUP_DIR, '_restore_' + Date.now());
  mkdirSync(tmp, { recursive: true });
  const zp = join(tmp, 'in.zip');
  writeFileSync(zp, buffer);
  try { execFileSync(winTar(), ['-xf', zp, '-C', tmp], { stdio: 'ignore' }); }
  catch { rmSync(tmp, { recursive: true, force: true }); throw new Error('Không giải nén được file sao lưu'); }
  const dbIn = join(tmp, 'digiplus.db');
  if (!existsSync(dbIn)) { rmSync(tmp, { recursive: true, force: true }); throw new Error('File sao lưu thiếu dữ liệu (digiplus.db)'); }
  const head = readFileSync(dbIn).slice(0, 16).toString('latin1');
  if (!head.startsWith('SQLite format 3')) { rmSync(tmp, { recursive: true, force: true }); throw new Error('Dữ liệu trong file không hợp lệ'); }
  copyFileSync(dbIn, PENDING);                         // DB áp lúc khởi động lại (giống phục hồi .db)
  const upIn = join(tmp, 'uploads');
  if (existsSync(upIn)) {                              // thay ảnh + logo ngay
    try { rmSync(UPLOAD_DIR, { recursive: true, force: true }); } catch {}
    try { cpSync(upIn, UPLOAD_DIR, { recursive: true }); } catch {}
  }
  rmSync(tmp, { recursive: true, force: true });
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
