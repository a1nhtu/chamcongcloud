// Tạo TÀI KHOẢN TỔNG (super-admin dùng chung mọi bản cài).
// Dùng:  node tools/make-master.mjs <tên_đăng_nhập> <mật_khẩu>
// → in ra 2 dòng cho config.txt, ĐỒNG THỜI lưu vào tools/master.env để Build-BoCai tự nhúng.
import bcrypt from 'bcryptjs';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , user, pass] = process.argv;
if (!user || !pass) {
  console.log('Cách dùng: node tools/make-master.mjs <ten_dang_nhap> <mat_khau>');
  console.log('  VD:      node tools/make-master.mjs sadmin "Matkhau#Manh2026"');
  process.exit(1);
}
if (pass.length < 8) console.warn('CẢNH BÁO: nên đặt mật khẩu tài khoản tổng >= 8 ký tự, đủ mạnh (đây là chìa khoá vào MỌI bản cài).');

const hash = bcrypt.hashSync(pass, 10);
const lines = `MASTER_USER=${user}\nMASTER_HASH=${hash}\n`;

const DIR = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(DIR, 'master.env'), lines);

console.log('\n=== ĐÃ LƯU tools/master.env (Build-BoCai sẽ tự nhúng vào bộ cài mới) ===');
console.log('\n--- Hoặc dán 2 dòng này vào cuối config.txt của bản cài đang chạy: ---\n');
console.log(lines);
console.log('LƯU Ý: giữ BÍ MẬT mật khẩu này. Ai có nó vào được TẤT CẢ bản cài/subdomain.');
