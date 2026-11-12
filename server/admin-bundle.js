// Trang quản lý (/admin.js) được viết thành NHIỀU FILE theo mục trong public/admin-parts/ (00-khung, 10-tong-quan, 20-nhan-vien…)
// để dễ đọc, dễ sửa. Trình duyệt vẫn nhận MỘT file /admin.js: máy chủ ghép các phần theo thứ tự tên file, không thêm bớt ký tự nào
// → mã chạy trong trình duyệt y như khi còn là 1 file (cùng một phạm vi biến, cùng thứ tự). Không cần bước build.
// Quy ước: tên phần bắt đầu bằng 2 chữ số; thêm phần mới thì đặt số nằm giữa hai phần liền kề. Phần "00-khung.js" chứa dòng import.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ADMIN_PARTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'admin-parts');

// Danh sách phần theo đúng thứ tự ghép
export function adminParts(dir = ADMIN_PARTS_DIR) {
  return readdirSync(dir).filter((f) => /^\d\d-[\w-]+\.js$/.test(f)).sort();
}

let cache = null;   // { key, text } — đọc lại khi có phần đổi (ngày sửa / kích thước) nên sửa file xong chỉ cần F5
export function adminBundle(dir = ADMIN_PARTS_DIR) {
  const files = adminParts(dir);
  if (!files.length) throw new Error('Thiếu thư mục public/admin-parts');
  const key = dir + '|' + files.map((f) => { const s = statSync(join(dir, f)); return f + ':' + s.mtimeMs + ':' + s.size; }).join('|');
  if (cache && cache.key === key) return cache.text;
  const text = files.map((f) => readFileSync(join(dir, f), 'utf8')).join('');
  cache = { key, text };
  return text;
}

// Trình duyệt báo lỗi ở "admin.js dòng N" → dòng đó nằm ở phần nào, dòng mấy (để tìm đúng file khi sửa)
export function adminLocate(line, dir = ADMIN_PARTS_DIR) {
  let left = Math.trunc(+line);
  if (!(left >= 1)) return null;
  for (const f of adminParts(dir)) {
    const t = readFileSync(join(dir, f), 'utf8');
    const n = t.split('\n').length - (t.endsWith('\n') ? 1 : 0);
    if (left <= n) return { file: f, line: left };
    left -= n;
  }
  return null;
}
