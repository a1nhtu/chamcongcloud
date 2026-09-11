// Cấp license cho khách. CHỈ ANH DÙNG (cần khoá riêng tools/keys/private.pem).
// Cách dùng:
//   node tools/license-gen.mjs --machine <MÃ_MÁY> --company "Công ty A" [--exp 2027-12-31] [--max 50]
//   --exp bỏ trống = vĩnh viễn; --max bỏ trống = không giới hạn NV; --machine "*" = không gắn máy (không khuyến nghị)
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const privPem = readFileSync(join(DIR, 'keys', 'private.pem'), 'utf8');
const privateKey = crypto.createPrivateKey(privPem);

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) { args[a.slice(2)] = process.argv[i + 1]; i++; }
}
if (!args.machine || !args.company) {
  console.log('Thiếu tham số. VD:');
  console.log('  node tools/license-gen.mjs --machine A1B2C3D4E5F6A7B8 --company "Công ty A" --exp 2027-12-31 --max 50');
  process.exit(1);
}

const payload = {
  c: args.company,
  m: args.machine.replace(/-/g, '').toUpperCase(),
  e: args.exp || null,
  n: args.max ? parseInt(args.max, 10) : null,
  i: new Date().toISOString().slice(0, 10),
};
const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64');
const sig = crypto.sign(null, Buffer.from(payloadB64), privateKey).toString('base64');
const license = payloadB64 + '.' + sig;

console.log('\n=== LICENSE cho', payload.c, '===');
console.log('  Máy:', payload.m, '| Hạn:', payload.e || 'vĩnh viễn', '| Tối đa NV:', payload.n || 'không giới hạn');
console.log('\nGửi khách chuỗi license dưới đây (dán vào màn hình kích hoạt):\n');
console.log(license);
console.log('');
