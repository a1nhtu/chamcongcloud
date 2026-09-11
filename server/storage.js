// Lưu ảnh selfie (data URL base64) xuống thư mục uploads, trả về đường dẫn public
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = join(__dirname, '..', 'uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });

export { UPLOAD_DIR };

// dataUrl dạng: data:image/jpeg;base64,....
export function savePhoto(dataUrl, prefix = 'img') {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/);
  if (!m) return null;
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const buf = Buffer.from(m[2], 'base64');
  // Giới hạn ~3MB để tránh lạm dụng
  if (buf.length > 3 * 1024 * 1024) throw new Error('Ảnh quá lớn');
  const name = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  writeFileSync(join(UPLOAD_DIR, name), buf);
  return `/uploads/${name}`;
}
