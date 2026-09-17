// Hệ thống bản quyền: license ký số Ed25519, gắn theo máy (Machine ID).
import crypto from 'node:crypto';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Khoá công khai của Digiplus (nhúng sẵn — không bí mật). Khoá RIÊNG do Anh giữ để cấp license.
const PUBLIC_KEY_DER_B64 = 'MCowBQYDK2VwAyEAF/1ATcAPsGqwXobiqTedXn/Nwt3VGy6gAtslKyD4yi8=';
const publicKey = crypto.createPublicKey({ key: Buffer.from(PUBLIC_KEY_DER_B64, 'base64'), format: 'der', type: 'spki' });

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const LICENSE_PATH = join(DATA_DIR, 'license.key');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Mã máy: ưu tiên MachineGuid của Windows; dự phòng hostname + MAC.
let _mid = null;
export function machineId() {
  if (_mid) return _mid;
  let raw = '';
  try {
    const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const m = out.match(/MachineGuid\s+REG_SZ\s+([\w-]+)/i);
    if (m) raw = 'g:' + m[1];
  } catch {}
  if (!raw) {
    const macs = Object.values(os.networkInterfaces()).flat()
      .filter((n) => n && !n.internal && n.mac && n.mac !== '00:00:00:00:00:00')
      .map((n) => n.mac).sort().join(',');
    raw = 'h:' + os.hostname() + '|' + macs;
  }
  // Mã khách (từ config.txt qua env CUSTOMER): để NHIỀU công ty trên CÙNG 1 VPS
  // có Mã máy KHÁC nhau → mỗi công ty 1 license riêng (đại lý không tự nhân thêm được).
  // Bỏ trống (cài máy riêng của khách / bản cũ) → giữ nguyên Mã máy cũ (tương thích ngược).
  const cust = (process.env.CUSTOMER || '').trim().toLowerCase();
  if (cust) raw += '|c:' + cust;
  _mid = sha(raw).slice(0, 16).toUpperCase();
  return _mid;
}
export function machineIdFmt() {
  const id = machineId();
  return id.match(/.{1,4}/g).join('-');
}

// Kiểm tra 1 chuỗi license
export function verifyLicense(keyString) {
  if (!keyString || typeof keyString !== 'string' || !keyString.includes('.'))
    return { valid: false, reason: 'License rỗng hoặc sai định dạng' };
  const [payloadB64, sigB64] = keyString.trim().split('.');
  let ok = false;
  try {
    ok = crypto.verify(null, Buffer.from(payloadB64), publicKey, Buffer.from(sigB64, 'base64'));
  } catch { ok = false; }
  if (!ok) return { valid: false, reason: 'Chữ ký license không hợp lệ (không phải do Digiplus cấp)' };

  let p;
  try { p = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8')); }
  catch { return { valid: false, reason: 'Nội dung license hỏng' }; }

  if (p.m && p.m !== '*' && p.m !== machineId())
    return { valid: false, reason: 'License không dành cho máy này (sai Mã máy)' };

  if (p.e) {
    const today = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Ho_Chi_Minh' });
    if (today > p.e) return { valid: false, reason: `License đã hết hạn (${p.e})` };
  }
  return {
    valid: true,
    data: { company: p.c || '', machine: p.m || '*', exp: p.e || null, maxEmp: p.n || null, issued: p.i || null },
  };
}

export function loadLicenseKey() {
  try { return existsSync(LICENSE_PATH) ? readFileSync(LICENSE_PATH, 'utf8').trim() : null; }
  catch { return null; }
}
export function saveLicenseKey(key) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(LICENSE_PATH, String(key).trim());
}

// Trạng thái bản quyền hiện tại
export function licenseState() {
  const machine = machineId();
  const key = loadLicenseKey();
  if (!key) return { activated: false, machineId: machine, machineIdFmt: machineIdFmt() };
  const v = verifyLicense(key);
  if (!v.valid) return { activated: false, machineId: machine, machineIdFmt: machineIdFmt(), reason: v.reason };
  let daysLeft = null;
  if (v.data.exp) {
    const today = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Ho_Chi_Minh' });
    daysLeft = Math.round((new Date(v.data.exp) - new Date(today)) / 86400000);
  }
  return {
    activated: true, machineId: machine, machineIdFmt: machineIdFmt(),
    company: v.data.company, exp: v.data.exp, maxEmp: v.data.maxEmp, daysLeft,
  };
}

export function isActivated() { const k = loadLicenseKey(); return !!k && verifyLicense(k).valid; }
