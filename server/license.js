// Hệ thống bản quyền: license ký số Ed25519, gắn theo máy (Machine ID).
import crypto from 'node:crypto';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir, cfg, MULTI, needTenant } from './tenant.js';

// Khoá công khai của Digiplus (nhúng sẵn — không bí mật). Khoá RIÊNG do Anh giữ để cấp license.
const PUBLIC_KEY_DER_B64 = 'MCowBQYDK2VwAyEAF/1ATcAPsGqwXobiqTedXn/Nwt3VGy6gAtslKyD4yi8=';
const publicKey = crypto.createPublicKey({ key: Buffer.from(PUBLIC_KEY_DER_B64, 'base64'), format: 'der', type: 'spki' });

// File bản quyền của công ty đang phục vụ (bản 1 công ty: data/license.key như cũ)
const licensePath = () => join(dataDir(), 'license.key');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Mã máy: ưu tiên MachineGuid của Windows; dự phòng hostname + MAC.
let _raw = null;
const _mid = new Map();   // mã khách → Mã máy
function machineRaw() {
  if (_raw) return _raw;
  let raw = '';
  try {
    const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const m = out.match(/MachineGuid\s+REG_SZ\s+([\w-]+)/i);
    if (m) raw = 'g:' + m[1];
  } catch {}
  // Linux (bản cài VPS Linux): mã định danh máy do hệ điều hành sinh lúc cài (/etc/machine-id). Windows không vào nhánh này.
  if (!raw && process.platform === 'linux') {
    try {
      const id = readFileSync('/etc/machine-id', 'utf8').trim().toLowerCase();
      if (/^[0-9a-f]{32}$/.test(id)) raw = 'l:' + id;
    } catch {}
  }
  if (!raw) {
    const macs = Object.values(os.networkInterfaces()).flat()
      .filter((n) => n && !n.internal && n.mac && n.mac !== '00:00:00:00:00:00')
      .map((n) => n.mac).sort().join(',');
    raw = 'h:' + os.hostname() + '|' + macs;
  }
  return (_raw = raw);
}
export function machineId() {
  // Mã khách (từ config.txt qua env CUSTOMER): để NHIỀU công ty trên CÙNG 1 VPS
  // có Mã máy KHÁC nhau → mỗi công ty 1 license riêng (đại lý không tự nhân thêm được).
  // Bỏ trống (cài máy riêng của khách / bản cũ) → giữ nguyên Mã máy cũ (tương thích ngược).
  // Máy chủ nhiều công ty: luôn theo mã của công ty (tên miền) đang phục vụ.
  const cust = (MULTI ? needTenant().slug : (cfg('CUSTOMER') || '')).trim().toLowerCase();
  let id = _mid.get(cust);
  if (!id) { id = sha(machineRaw() + (cust ? '|c:' + cust : '')).slice(0, 16).toUpperCase(); _mid.set(cust, id); }
  return id;
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

// Kiểm tra KEY THEO MÁY (bản quyền từng máy chấm công). Gắn theo serial máy.
// payload: { t:'dev', s:'<serial>', c:'<công ty>', e:'<hạn|null>', i:'<ngày cấp>' }
export function verifyDeviceKey(keyString, serial) {
  if (!keyString || typeof keyString !== 'string' || !keyString.includes('.'))
    return { valid: false, reason: 'Key rỗng hoặc sai định dạng' };
  const [payloadB64, sigB64] = keyString.trim().split('.');
  let ok = false;
  try { ok = crypto.verify(null, Buffer.from(payloadB64), publicKey, Buffer.from(sigB64, 'base64')); }
  catch { ok = false; }
  if (!ok) return { valid: false, reason: 'Chữ ký key không hợp lệ (không phải do Digiplus cấp)' };
  let p;
  try { p = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8')); }
  catch { return { valid: false, reason: 'Nội dung key hỏng' }; }
  if (p.t !== 'dev') return { valid: false, reason: 'Đây không phải key máy chấm công' };
  const norm = (s) => String(s || '').trim().toUpperCase();
  if (norm(p.s) !== norm(serial))
    return { valid: false, reason: `Key cấp cho serial ${p.s || '?'} — không khớp máy ${serial}` };
  if (p.e) {
    const today = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Ho_Chi_Minh' });
    if (today > p.e) return { valid: false, reason: `Key đã hết hạn (${p.e})` };
  }
  return { valid: true, data: { serial: norm(p.s), company: p.c || '', exp: p.e || null } };
}

export function loadLicenseKey() {
  try { const p = licensePath(); return existsSync(p) ? readFileSync(p, 'utf8').trim() : null; }
  catch { return null; }
}
export function saveLicenseKey(key) {
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(licensePath(), String(key).trim());
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
