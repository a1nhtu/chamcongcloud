// Tạo cặp khoá ký license (CHẠY 1 LẦN DUY NHẤT). Khoá riêng phải GIỮ BÍ MẬT, KHÔNG đưa cho khách.
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'keys');
mkdirSync(DIR, { recursive: true });
const privPath = join(DIR, 'private.pem');
const pubDerPath = join(DIR, 'public.der.b64.txt');

if (existsSync(privPath)) {
  console.log('ĐÃ CÓ khoá riêng tại', privPath, '- KHÔNG tạo lại để tránh mất license cũ.');
  process.exit(0);
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const pubDerB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

writeFileSync(privPath, privPem);
writeFileSync(pubDerPath, pubDerB64);

console.log('✓ Đã tạo khoá.');
console.log('  Khoá RIÊNG (bí mật):', privPath);
console.log('  Public key (DER b64) để nhúng vào app:');
console.log(pubDerB64);
