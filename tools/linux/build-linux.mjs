// Đóng gói BỘ CÀI LINUX (trung tính, không chứa token/mật khẩu/dữ liệu khách nào).
// PHẢI chạy trên Linux x64 (GitHub Actions ubuntu-latest) vì chép chính file node đang chạy làm runtime.
// Dùng:  node tools/linux/build-linux.mjs
//   CLOUDFLARED_BIN=<đường dẫn>  file cloudflared-linux-amd64 (mặc định tools/cloudflared-linux-amd64)
//   DIST_LINUX=<thư mục ra>      mặc định dist-linux/
// Ra:  dist-linux/DigiplusChamCong-linux.tar.gz  (gốc nén = thư mục DigiplusChamCong/)
import { cpSync, mkdirSync, writeFileSync, rmSync, existsSync, copyFileSync, chmodSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const DIST = process.env.DIST_LINUX || join(ROOT, 'dist-linux');
const OUT = join(DIST, 'DigiplusChamCong');
const APP = join(OUT, 'app');

if (process.platform !== 'linux' || process.arch !== 'x64') {
  console.error('Phải chạy trên Linux x64 (node hiện tại là ' + process.platform + '/' + process.arch + ').');
  process.exit(1);
}

console.log('Dọn thư mục đóng gói...');
rmSync(DIST, { recursive: true, force: true });
mkdirSync(join(OUT, 'runtime'), { recursive: true });
mkdirSync(APP, { recursive: true });

console.log('Copy Node runtime:', process.execPath, process.version);
copyFileSync(process.execPath, join(OUT, 'runtime', 'node'));
chmodSync(join(OUT, 'runtime', 'node'), 0o755);

const cf = process.env.CLOUDFLARED_BIN || join(ROOT, 'tools', 'cloudflared-linux-amd64');
if (!existsSync(cf)) { console.error('Thiếu cloudflared Linux: ' + cf); process.exit(1); }
copyFileSync(cf, join(OUT, 'cloudflared'));
chmodSync(join(OUT, 'cloudflared'), 0o755);

// App: server, public, node_modules, package.json (KHÔNG copy data/uploads/certs/tools/.git)
console.log('Copy app...');
cpSync(join(ROOT, 'server'), join(APP, 'server'), { recursive: true });
cpSync(join(ROOT, 'public'), join(APP, 'public'), { recursive: true });
cpSync(join(ROOT, 'node_modules'), join(APP, 'node_modules'), { recursive: true });
copyFileSync(join(ROOT, 'package.json'), join(APP, 'package.json'));

// File khởi động + script quản lý (nằm ở thư mục cài, ngoài app/ → nút Cập nhật không đụng tới)
copyFileSync(join(HERE, 'chay-app.mjs'), join(OUT, 'chay-app.mjs'));
for (const f of ['cai-dat.sh', 'go-cai-dat.sh', 'kiem-tra.sh']) {
  copyFileSync(join(HERE, f), join(OUT, f));
  chmodSync(join(OUT, f), 0o755);
}
copyFileSync(join(HERE, 'HUONG-DAN-LINUX.txt'), join(OUT, 'HUONG-DAN.txt'));

// config.txt TRUNG TÍNH (bản LAN). Bộ cài sẽ ghi đè bằng cấu hình lấy từ máy chủ Digiplus khi cài có tên miền.
writeFileSync(join(OUT, 'config.txt'),
`PORT=8686
CUSTOMER=
TUNNEL_TOKEN=
USE_DEVICE=1
USE_PHONE=1
`);

mkdirSync(DIST, { recursive: true });
const tgz = join(DIST, 'DigiplusChamCong-linux.tar.gz');
execFileSync('tar', ['-czf', tgz, '-C', DIST, 'DigiplusChamCong'], { stdio: 'inherit' });
console.log('\n✓ Xong:', tgz, (statSync(tgz).size / 1048576).toFixed(1) + ' MB');
