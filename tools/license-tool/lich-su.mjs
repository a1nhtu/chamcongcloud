// Lịch sử cấp license — DÙNG CHUNG với trang online /cap-license (HuongDan/hd-worker.js, mục "LỊCH SỬ CẤP LICENSE").
// Lưu ở DNS TXT _lic-<mã>.<zone> (mỗi khách 1 bản ghi, nội dung mã hoá AES-GCM bằng khoá suy ra từ private.pem).
// Cần tools/cf.env (CF_API_TOKEN + ZONE) — thiếu thì tool vẫn cấp license được, chỉ không ghi/đọc lịch sử.
// SỬA Ở ĐÂY THÌ SỬA CẢ hd-worker.js (cùng định dạng), không thì 2 nơi đọc không ra của nhau.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = join(DIR, '..', 'cf.env');
const subtle = globalThis.crypto.subtle;
const LIC_PREFIX = '_lic-';
const LIC_MAX_CHARS = 1800;

function cfEnv() {
  if (!existsSync(ENV_FILE)) return null;
  const env = Object.fromEntries(readFileSync(ENV_FILE, 'utf8').replace(/^﻿/, '').split(/\r?\n/)
    .filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
  return env.CF_API_TOKEN && env.ZONE ? env : null;
}
export const historyReady = () => !!cfEnv();

const hex = (u8) => [...u8].map((x) => x.toString(16).padStart(2, '0')).join('');
const b64u = (u8) => Buffer.from(u8).toString('base64url');
export const licNorm = (s) => String(s || '').toLowerCase().replace(/đ/g, 'd').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

let _secret = null;
function secretHex(privPem) {
  if (_secret) return _secret;
  const der = Buffer.from(privPem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');
  for (let i = 0; i + 36 <= der.length; i++)
    if (der[i] === 0x04 && der[i + 1] === 0x22 && der[i + 2] === 0x04 && der[i + 3] === 0x20) return (_secret = hex(der.subarray(i + 4, i + 36)));
  throw new Error('private.pem không đúng dạng Ed25519 PKCS8');
}
async function aesKey(privPem) {
  const raw = await subtle.digest('SHA-256', new TextEncoder().encode('lic-log|' + secretHex(privPem)));
  return subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function idOf(privPem, company) {
  const k = await subtle.importKey('raw', new TextEncoder().encode('lic-id|' + secretHex(privPem)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(new Uint8Array(await subtle.sign('HMAC', k, new TextEncoder().encode(licNorm(company))))).slice(0, 16);
}
async function seal(privPem, id, obj) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(id) },
    await aesKey(privPem), new TextEncoder().encode(JSON.stringify(obj))));
  return b64u(Buffer.concat([iv, ct]));
}
async function open(privPem, id, sealed) {
  try {
    const b = Buffer.from(sealed, 'base64url');
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: b.subarray(0, 12), additionalData: new TextEncoder().encode(id) },
      await aesKey(privPem), b.subarray(12));
    return JSON.parse(new TextDecoder().decode(pt));
  } catch { return null; }
}
const txtJoin = (s) => String(s || '').replace(/"\s*"/g, '').replace(/^"|"$/g, '');

async function cf(env, method, path, body) {
  const r = await fetch('https://api.cloudflare.com/client/v4' + path, {
    method, headers: { Authorization: 'Bearer ' + env.CF_API_TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
  });
  const d = await r.json().catch(() => ({}));
  if (!d.success) throw new Error('Cloudflare: ' + ((d.errors || []).map((e) => e.message).join('; ') || 'HTTP ' + r.status));
  return d.result;
}
let _zoneId = null;
async function ctx() {
  const env = cfEnv();
  if (!env) throw new Error('Thiếu tools/cf.env (CF_API_TOKEN + ZONE) — chưa đọc/ghi được lịch sử');
  if (!_zoneId) _zoneId = (await cf(env, 'GET', `/zones?name=${encodeURIComponent(env.ZONE)}`))[0]?.id;
  if (!_zoneId) throw new Error('Không thấy zone ' + env.ZONE);
  return { env, zoneId: _zoneId, zoneName: env.ZONE };
}

export async function licList(privPem) {
  const c = await ctx();
  const recs = await cf(c.env, 'GET', `/zones/${c.zoneId}/dns_records?type=TXT&per_page=1000`);
  const out = [];
  for (const r of recs || []) {
    if (!r.name.startsWith(LIC_PREFIX) || !r.name.endsWith('.' + c.zoneName)) continue;
    const id = r.name.slice(LIC_PREFIX.length, -(c.zoneName.length + 1));
    const m = txtJoin(r.content).match(/^dgp-lic (\S+)$/);
    const obj = m ? await open(privPem, id, m[1]) : null;
    if (obj && obj.c) out.push({ id, c: obj.c, h: Array.isArray(obj.h) ? obj.h : [], dnsId: r.id });
  }
  return out;
}

// Thêm 1 lần cấp: rid = mã khách đã có (cấp lại), bỏ trống = theo tên công ty
export async function licAdd(privPem, { rid, company, entry }) {
  const c = await ctx();
  const all = await licList(privPem);
  const id = /^[0-9a-f]{16}$/.test(String(rid || '')) ? String(rid) : await idOf(privPem, company);
  let rec = all.find((x) => x.id === id);
  if (!rec) rec = { id, c: company, h: [], dnsId: null };
  rec.c = company;
  const e = { ...entry, at: new Date().toISOString().slice(0, 19) };
  const key = (x) => [x.m || '', x.e || '', x.n || '', x.i || ''].join('|');
  if (rec.h.some((x) => key(x) === key(e))) return { id, added: 0 };
  rec.h.unshift(e);   // đứng đầu: cùng ngày cấp thì lần vừa ghi vẫn là mới nhất
  rec.h.sort((a, b) => String(b.i || '').localeCompare(String(a.i || '')) || String(b.at || '').localeCompare(String(a.at || '')));
  let h = rec.h, sealed;
  for (;;) {
    sealed = await seal(privPem, id, { c: rec.c, h });
    if (sealed.length <= LIC_MAX_CHARS || h.length <= 1) break;
    h = h.slice(0, -1);
  }
  const body = { type: 'TXT', name: `${LIC_PREFIX}${id}.${c.zoneName}`, ttl: 300, content: `"dgp-lic ${sealed}"`, comment: 'digiplus lịch sử cấp license' };
  if (rec.dnsId) await cf(c.env, 'PUT', `/zones/${c.zoneId}/dns_records/${rec.dnsId}`, body);
  else await cf(c.env, 'POST', `/zones/${c.zoneId}/dns_records`, body);
  return { id, added: 1 };
}
