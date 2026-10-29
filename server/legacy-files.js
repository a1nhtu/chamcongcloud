// CHỌN FILE .mdb NGAY TRÊN MÁY CÀI DIGIPLUS (màn Chuyển từ Wise Eye / Ronald Jack) — thay hộp chọn file của trình duyệt
// (máy khách nhahanggiadinh 29/10/2026: hộp chọn file treo cả trang qua UltraViewer; file lại để ổ D, không phải chỗ mặc định).
// - listDir: duyệt thư mục (rỗng = danh sách ổ đĩa) → thư mục con + file .mdb/.accdb
// - findLegacyFiles: quét các ổ tìm file của Wise Eye / Ronald Jack (tên file hoặc thư mục có chữ wise / ronald / rjdata)
// Chỉ đọc tên file, không mở / sửa gì. Đọc bất đồng bộ → máy chủ vẫn nhận máy chấm công trong lúc quét.
import { readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, parse } from 'node:path';

const IS_WIN = process.platform === 'win32';
const MDB = /\.(mdb|accdb)$/i;
// Thư mục hệ thống / rất nhiều file mà phần mềm chấm công không bao giờ để dữ liệu → bỏ qua cho nhanh
const SKIP = new Set(['windows', '$recycle.bin', 'system volume information', 'node_modules', '.git', 'winsxs', 'microsoft',
  'packages', 'temp', 'tmp', 'cache', 'caches', 'google', 'mozilla', 'nvidia corporation', 'intel', 'amd', 'windowsapps', 'msocache', '$windows.~bt', '$windows.~ws']);
const LEGACY = /wise|ronald|rjdata|on39|chamcong|cham cong|cham_cong/i;

export function drives() {
  if (!IS_WIN) return ['/'];
  const out = [];
  for (let c = 67; c <= 90; c++) { const d = String.fromCharCode(c) + ':\\'; if (existsSync(d)) out.push(d); }   // C..Z
  return out;
}

const fileInfo = async (p) => { try { const s = await stat(p); return { path: p, size: s.size, mtime: s.mtime.toISOString() }; } catch { return { path: p, size: 0, mtime: '' }; } };

export async function listDir(dir = '') {
  dir = String(dir || '').trim().replace(/^"(.*)"$/, '$1');
  if (!dir) return { dir: '', parent: null, dirs: drives().map((d) => ({ name: d, path: d })), files: [] };
  if (IS_WIN && /^[A-Za-z]:$/.test(dir)) dir += '\\';
  let ents;
  try { ents = await readdir(dir, { withFileTypes: true }); }
  catch (e) { throw Object.assign(new Error(`Không mở được thư mục ${dir} (${e.code || e.message})`), { status: 400 }); }
  const root = parse(dir).root === dir;
  const dirs = [], files = [];
  for (const e of ents) {
    if (e.isDirectory()) { if (!e.name.startsWith('$')) dirs.push({ name: e.name, path: join(dir, e.name) }); }
    else if (e.isFile() && MDB.test(e.name)) files.push({ name: e.name, ...(await fileInfo(join(dir, e.name))) });
  }
  const by = (a, b) => a.name.localeCompare(b.name, 'vi', { sensitivity: 'base' });
  return { dir, parent: root ? '' : dirname(dir), dirs: dirs.sort(by), files: files.sort(by) };
}

// Quét theo chiều rộng từng ổ, tối đa `depth` cấp thư mục, dừng sau `ms` → danh sách file mới sửa gần nhất trước
export async function findLegacyFiles({ roots = drives(), depth = 8, ms = 20000, max = 50 } = {}) {
  const until = Date.now() + ms, found = [];
  let queue = roots.map((p) => ({ p, d: 0, hint: false })), timedOut = false;
  while (queue.length && found.length < max) {
    if (Date.now() > until) { timedOut = true; break; }
    const next = [];
    for (const { p, d, hint } of queue) {
      if (Date.now() > until || found.length >= max) { timedOut = Date.now() > until; break; }
      let ents; try { ents = await readdir(p, { withFileTypes: true }); } catch { continue; }
      for (const e of ents) {
        const full = join(p, e.name);
        if (e.isFile() && MDB.test(e.name) && (hint || LEGACY.test(e.name))) found.push(await fileInfo(full));
        else if (e.isDirectory() && d < depth && !SKIP.has(e.name.toLowerCase()) && !e.name.startsWith('.')) next.push({ p: full, d: d + 1, hint: hint || LEGACY.test(e.name) });
      }
    }
    queue = next;
  }
  found.sort((a, b) => b.mtime.localeCompare(a.mtime));
  return { files: found, timedOut };
}
