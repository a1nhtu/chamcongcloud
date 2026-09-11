// Xoá / thu hồi 1 khách: xoá DNS CNAME + Cloudflare Tunnel + thư mục cấu hình local.
// Dùng: node tools/remove-customer.mjs <tencty>
// Cần tools/cf.env (giống make-customer.mjs).

import { readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const API = 'https://api.cloudflare.com/client/v4';

function fail(msg) { console.error('\n❌ ' + msg + '\n'); process.exit(1); }

function loadEnv() {
  const p = join(HERE, 'cf.env');
  if (!existsSync(p)) fail(`Chưa có tools/cf.env (xem tools/cf.env.example).`);
  const env = {};
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('='); if (i > 0) env[s.slice(0, i).trim()] = s.slice(i + 1).trim();
  }
  if (!env.CF_API_TOKEN) fail('Thiếu CF_API_TOKEN trong tools/cf.env');
  env.ZONE = env.ZONE || 'maychamcongcloud.com';
  return env;
}

let TOKEN = '';
async function cf(method, path, body, { allowFail = false } = {}) {
  const res = await fetch(API + path, {
    method, headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!data.success && !allowFail) {
    const msg = (data.errors || []).map((e) => `${e.code} ${e.message}`).join('; ') || `HTTP ${res.status}`;
    throw new Error(`Cloudflare API lỗi (${method} ${path}): ${msg}`);
  }
  return data;
}

async function main() {
  const slug = String(process.argv[2] || '').toLowerCase().trim();
  if (!slug) fail('Thiếu tên công ty. Dùng: node tools/remove-customer.mjs <tencty>');

  const env = loadEnv(); TOKEN = env.CF_API_TOKEN;
  const zoneName = env.ZONE;
  const fqdn = `${slug}.${zoneName}`;
  const tname = `digiplus-${slug}`;

  console.log(`\n=== XOÁ KHÁCH: ${slug}  (${fqdn}) ===\n`);

  // Zone + account
  const zres = await cf('GET', `/zones?name=${encodeURIComponent(zoneName)}`);
  if (!zres.result?.length) fail(`Không thấy zone ${zoneName}.`);
  const zoneId = zres.result[0].id;
  const accountId = env.CF_ACCOUNT_ID || zres.result[0].account?.id;

  // 1) Xoá DNS record(s) khớp fqdn
  const recs = await cf('GET', `/zones/${zoneId}/dns_records?name=${encodeURIComponent(fqdn)}`);
  if (recs.result?.length) {
    for (const r of recs.result) { await cf('DELETE', `/zones/${zoneId}/dns_records/${r.id}`, null, { allowFail: true }); }
    console.log(`• Đã xoá DNS: ${fqdn} (${recs.result.length} record)`);
  } else console.log(`• DNS ${fqdn}: không có (bỏ qua)`);

  // 2) Xoá tunnel digiplus-<slug>
  const tres = await cf('GET', `/accounts/${accountId}/cfd_tunnel?name=${encodeURIComponent(tname)}&is_deleted=false`);
  const tunnel = (tres.result || []).find((t) => t.name === tname);
  if (tunnel) {
    // xoá kết nối đang chạy (nếu có) trước khi xoá tunnel
    await cf('DELETE', `/accounts/${accountId}/cfd_tunnel/${tunnel.id}/connections`, null, { allowFail: true });
    const del = await cf('DELETE', `/accounts/${accountId}/cfd_tunnel/${tunnel.id}`, null, { allowFail: true });
    if (del.success) console.log(`• Đã xoá tunnel: ${tname}`);
    else console.log(`• Tunnel ${tname}: xoá KHÔNG thành công (có thể còn kết nối đang chạy). Tắt app/cloudflared của khách rồi chạy lại.`);
  } else console.log(`• Tunnel ${tname}: không có (bỏ qua)`);

  // 3) Xoá thư mục cấu hình local
  const dir = join(HERE, 'customers', slug);
  if (existsSync(dir)) { rmSync(dir, { recursive: true, force: true }); console.log(`• Đã xoá thư mục: tools/customers/${slug}`); }

  console.log(`\n✅ XONG — đã thu hồi ${fqdn}.\n`);
}

main().catch((e) => fail(e.message));
