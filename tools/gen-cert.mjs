// Tạo chứng chỉ HTTPS tự ký kèm mọi IP LAN của máy (cho phép điện thoại dùng camera/GPS qua LAN).
// Dùng: npm run cert
import { execFileSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CERT_DIR = join(ROOT, 'certs');
mkdirSync(CERT_DIR, { recursive: true });

function lanIPs() {
  const ips = [];
  for (const list of Object.values(networkInterfaces()))
    for (const ni of list || [])
      if (ni.family === 'IPv4' && !ni.internal && !/^169\.254\./.test(ni.address)) ips.push(ni.address);
  return ips;
}

// Tìm openssl (PATH hoặc trong Git for Windows)
function findOpenssl() {
  const candidates = [
    'openssl',
    'C:/Program Files/Git/mingw64/bin/openssl.exe',
    'C:/Program Files/Git/usr/bin/openssl.exe',
    'C:/Program Files (x86)/Git/mingw64/bin/openssl.exe',
  ];
  for (const c of candidates) {
    try { execFileSync(c, ['version'], { stdio: 'ignore' }); return c; } catch {}
  }
  throw new Error('Không tìm thấy openssl. Cài Git for Windows hoặc thêm openssl vào PATH.');
}

const ips = lanIPs();
const alt = ['DNS.1 = localhost', 'IP.1 = 127.0.0.1', ...ips.map((ip, i) => `IP.${i + 2} = ${ip}`)].join('\n');
const cnf = `[req]
distinguished_name = dn
x509_extensions = v3
prompt = no
[dn]
CN = Digiplus ChamCong
[v3]
subjectAltName = @alt
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
[alt]
${alt}
`;
const cnfPath = join(CERT_DIR, 'san.cnf');
writeFileSync(cnfPath, cnf);

const openssl = findOpenssl();
execFileSync(openssl, [
  'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
  '-keyout', join(CERT_DIR, 'key.pem'),
  '-out', join(CERT_DIR, 'cert.pem'),
  '-days', '825', '-config', cnfPath,
], { stdio: 'ignore' });

console.log('✓ Đã tạo chứng chỉ trong /certs cho các địa chỉ:');
console.log('   localhost, 127.0.0.1' + (ips.length ? ', ' + ips.join(', ') : ''));
console.log('  Chạy lại "npm start" để áp dụng.');
