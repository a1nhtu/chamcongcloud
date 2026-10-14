// BẢN LINUX — file khởi động, nằm ở THƯ MỤC CÀI (cạnh config.txt), do systemd gọi.
// Làm đúng việc của ChayApp.bat bên Windows: đọc config.txt → biến môi trường → chạy app / chạy tunnel.
//   runtime/node chay-app.mjs           → chạy phần mềm (app/server/index.js)
//   runtime/node chay-app.mjs --tunnel  → chạy Cloudflare Tunnel với TUNNEL_TOKEN trong config.txt
// Cố ý để NGOÀI thư mục app/: nút Cập nhật chỉ thay app/server + app/public, file này không bị đụng
// → bản nào trên GitHub thì máy Linux vẫn khởi động được.
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

// Cùng quy tắc với ChayApp.bat: mỗi dòng KEY=VALUE, tách ở dấu "=" đầu tiên; bỏ dòng trống / dòng chú thích (#, ;)
export function parseConfig(text) {
  const out = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const i = line.indexOf('=');
    if (i <= 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function loadConfig() {
  const p = join(ROOT, 'config.txt');
  if (!existsSync(p)) return {};
  const cfg = parseConfig(readFileSync(p, 'utf8'));
  for (const [k, v] of Object.entries(cfg)) if (process.env[k] === undefined) process.env[k] = v;
  if (!process.env.PORT) process.env.PORT = '8686';
  return cfg;
}

async function main() {
  loadConfig();
  process.chdir(ROOT);

  if (process.argv.includes('--tunnel')) {
    const token = (process.env.TUNNEL_TOKEN || '').trim();
    const cf = join(ROOT, 'cloudflared');
    if (!token) { console.log('config.txt chưa có TUNNEL_TOKEN → bản LAN, không chạy tunnel.'); process.exit(0); }
    if (!existsSync(cf)) { console.error('Không thấy file cloudflared trong thư mục cài.'); process.exit(1); }
    // Token đưa qua biến môi trường (cloudflared tự đọc TUNNEL_TOKEN) → không lộ trên danh sách tiến trình
    const child = spawn(cf, ['tunnel', '--no-autoupdate', 'run'], { stdio: 'inherit', env: { ...process.env, TUNNEL_TOKEN: token } });
    for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => child.kill(sig));
    child.on('exit', (code, sig) => process.exit(code ?? (sig ? 1 : 0)));
    return;
  }

  await import(pathToFileURL(join(ROOT, 'app', 'server', 'index.js')).href);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
