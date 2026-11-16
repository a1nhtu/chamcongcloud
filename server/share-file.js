// LINK TẢI FILE ĐỂ GỬI QUA ZALO / MAIL (Anh 16/11/2026: file Excel xuất ra phải có nút chia sẻ trên điện thoại).
// Chrome (Android lẫn máy tính) KHÔNG cho trang web chia sẻ thẳng file .xlsx / .docx (chỉ ảnh, PDF, CSV, TXT) → trang quản lý gửi
// file vừa xuất lên đây, máy chủ giữ file dưới một link mã ngẫu nhiên rồi điện thoại chia sẻ LINK đó (Zalo, Gmail, Messenger…).
// iPhone (Safari) chia sẻ được file thật nên không cần link (xem saveFile trong public/common.js).
// - Mỗi link 1 thư mục data/chia-se/<mã 24 ký tự>/<tên file>; link hết hạn sau SHARE_TTL_MS rồi tự xoá.
// - Ai có link đều tải được (người nhận trên Zalo không có tài khoản phần mềm) → mã 18 byte ngẫu nhiên, không đoán được;
//   chỉ người đã đăng nhập trang quản lý mới tạo được link.
// - Máy chủ nhiều công ty: thư mục data/ của từng công ty (dataDir theo tên miền), link công ty A không mở được ở tên miền công ty B.
import { mkdirSync, writeFileSync, readdirSync, statSync, rmSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { dataDir } from './db.js';

export const SHARE_TTL_MS = 3 * 24 * 3600 * 1000;   // 3 ngày
export const SHARE_MAX_BYTES = 30 * 1024 * 1024;
const OK_EXT = new Set(['.xlsx', '.xls', '.csv', '.pdf', '.docx', '.doc']);
const TOK_RE = /^[A-Za-z0-9_-]{24}$/;
const shareDir = () => join(dataDir(), 'chia-se');

// Tên file an toàn để ghi đĩa: bỏ ký tự cấm của Windows + đường dẫn, giữ chữ tiếng Việt; đuôi phải nằm trong danh sách cho phép
export function safeShareName(name) {
  let n = String(name || '').normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^[.\s]+/, '').trim();
  if (n.length > 120) n = n.slice(n.length - 120);
  const ext = extname(n).toLowerCase();
  return OK_EXT.has(ext) ? n : null;
}

// Xoá các link đã hết hạn (gọi khi tạo link mới, khi có người mở link và theo giờ)
export function cleanupShares(now = Date.now()) {
  const d = shareDir();
  if (!existsSync(d)) return 0;
  let n = 0;
  for (const tok of readdirSync(d)) {
    const p = join(d, tok);
    try { if (now - statSync(p).mtimeMs > SHARE_TTL_MS) { rmSync(p, { recursive: true, force: true }); n++; } } catch { /* file đang bị giữ → lần sau xoá */ }
  }
  return n;
}

// Lưu file → trả { url (đường dẫn tương đối, trang tự ghép tên miền), name, expires }
export function createShare(buf, name) {
  const safe = safeShareName(name);
  if (!safe) throw new Error('Chỉ chia sẻ được file Excel, Word, PDF hoặc CSV');
  if (!buf || !buf.length) throw new Error('File rỗng');
  if (buf.length > SHARE_MAX_BYTES) throw new Error('File quá lớn để gửi bằng link (tối đa 30 MB)');
  try { cleanupShares(); } catch {}
  const tok = randomBytes(18).toString('base64url');
  const dir = join(shareDir(), tok);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, safe), buf);
  return { url: `/api/f/${tok}/${encodeURIComponent(safe)}`, name: safe, expires: Date.now() + SHARE_TTL_MS };
}

// Trả đường dẫn file của 1 link còn hạn (null = không có / đã hết hạn — hết hạn thì xoá luôn)
export function shareFilePath(tok, now = Date.now()) {
  if (!TOK_RE.test(String(tok || ''))) return null;
  const dir = join(shareDir(), tok);
  if (!existsSync(dir)) return null;
  try {
    if (now - statSync(dir).mtimeMs > SHARE_TTL_MS) { rmSync(dir, { recursive: true, force: true }); return null; }
    const f = readdirSync(dir)[0];
    return f ? { path: join(dir, f), name: f } : null;
  } catch { return null; }
}

// GET /api/f/:tok/:name — công khai (người nhận trên Zalo / mail bấm link là tải file). Tên file trên link chỉ để dễ đọc.
export function shareDownload(req, res) {
  const f = shareFilePath(req.params.tok);
  // Cloudflare mặc định giữ bản sao file .xlsx ở máy chủ trung gian → cấm giữ, để link hết hạn là hết tải được thật
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (!f) {
    return res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<title>Link đã hết hạn</title><div style="font-family:system-ui,Segoe UI,Arial;max-width:420px;margin:60px auto;padding:0 20px;text-align:center;color:#1f2430">'
      + '<div style="font-size:44px">⏳</div><h2 style="margin:8px 0">Link tải file đã hết hạn</h2>'
      + '<p style="color:#7a808c;line-height:1.5">Link chỉ dùng được 3 ngày kể từ lúc gửi. Vui lòng nhờ người gửi xuất và gửi lại file.</p></div>');
  }
  res.download(f.path, f.name);
}
