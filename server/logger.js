// Ghi log máy chủ ra file data/logs/server.log để tra lỗi trên máy khách (app chạy ẩn, không có cửa sổ console).
// Import file này ĐẦU TIÊN trong server/index.js. Không bao giờ được làm app lỗi: mọi thao tác ghi file đều bọc try/catch.
import { appendFileSync, mkdirSync, statSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const LOG_DIR = join(__dirname, '..', 'data', 'logs');
export const LOG_FILE = join(LOG_DIR, 'server.log');
const MAX_BYTES = 2 * 1024 * 1024;   // quá 2MB thì xoay vòng: server.log → server.log.1 (giữ 1 bản cũ, tổng tối đa ~4MB)

let size = 0;
try { mkdirSync(LOG_DIR, { recursive: true }); size = statSync(LOG_FILE).size; } catch { /* chưa có file */ }

function rotate() {
  try {
    rmSync(LOG_FILE + '.1', { force: true });
    renameSync(LOG_FILE, LOG_FILE + '.1');
    size = 0;
  } catch { /* bỏ qua */ }
}

// Giờ Việt Nam (UTC+7) dạng 2026-09-24 15:04:05
function stamp() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

export function writeLog(level, args) {
  try {
    const line = `${stamp()} [${level}] ${format(...args)}\n`;
    if (size + line.length > MAX_BYTES) rotate();
    appendFileSync(LOG_FILE, line);
    size += line.length;
  } catch { /* tuyệt đối không để lỗi ghi log làm hỏng app */ }
}

// Vẫn in ra console như cũ (khi chạy tay/dev), đồng thời ghi file.
for (const [method, level] of [['log', 'INFO'], ['warn', 'WARN'], ['error', 'ERROR']]) {
  const orig = console[method].bind(console);
  console[method] = (...args) => { writeLog(level, args); orig(...args); };
}

// Giữ nguyên hành vi mặc định của Node (lỗi chưa bắt → app thoát), chỉ thêm ghi log trước khi thoát.
process.on('uncaughtException', (err) => { writeLog('FATAL', ['uncaughtException:', err && err.stack || err]); process.exit(1); });
process.on('unhandledRejection', (err) => { writeLog('FATAL', ['unhandledRejection:', err && err.stack || err]); process.exit(1); });

writeLog('INFO', ['=== Khởi động máy chủ (pid ' + process.pid + ') ===']);
