// Bản cài Windows: tự nạp config.txt (PORT, CUSTOMER, TUNNEL_TOKEN…) vào biến môi trường khi node được chạy THẲNG,
// không qua ChayApp.bat / CapNhat.bat (2 file đó tự đọc config.txt rồi mới bật node) — vd bấm đúp restart-app.vbs trong
// thư mục cài. Trước đây bật kiểu đó app lên cổng 8080 (mặc định) và thiếu mã khách → tên miền vẫn lỗi 502, Mã máy đổi
// → hiện màn kích hoạt (3svina 04/11/2026). Chỉ điền biến CHƯA có — không đè giá trị bat đã đặt.
// Import ĐẦU TIÊN trong server/index.js (trước logger / tenant đọc MULTI_TENANT). Không import module nào khác của app.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const INSTALL_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');   // <install>\app\server → <install>

// Đọc như cmd "for /f tokens=1,* delims==": KHÓA=GIÁ TRỊ (cắt ở dấu = đầu tiên), bỏ dòng trống / chú thích / dòng lạ
export function parseConfig(text) {
  const out = {};
  for (const line of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i <= 0) continue;
    const k = line.slice(0, i).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue;
    out[k] = line.slice(i + 1).trim();
  }
  return out;
}

// Trả danh sách biến vừa điền (để thử nghiệm). Chỉ chạy ở bản cài cho khách (có runtime\node.exe cạnh config.txt):
// máy dev / VPS Linux (systemd đã nạp sẵn) không đụng.
export function loadInstallConfig(root = INSTALL_ROOT, env = process.env) {
  const file = join(root, 'config.txt');
  if (!existsSync(file) || !existsSync(join(root, 'runtime', 'node.exe'))) return [];
  let conf;
  try { conf = parseConfig(readFileSync(file, 'utf8')); } catch { return []; }
  const set = [];
  for (const [k, v] of Object.entries(conf)) {
    if (env[k] === undefined && v !== '') { env[k] = v; set.push(k); }
  }
  return set;
}

loadInstallConfig();
