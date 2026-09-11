// Tool tạo khách hàng mới: tự động tạo subdomain + Cloudflare Tunnel + token + bộ config.
// Anh chỉ cần gõ tên công ty → ra <tencty>.maychamcongcloud.com và file config.txt sẵn sàng.
//
// Dùng: node tools/make-customer.mjs <tencty> <mode> [port]
//   <tencty> : tên không dấu, vd congtyabc  (thành congtyabc.maychamcongcloud.com)
//   <mode>   : office = cài tại văn phòng khách | vps = chạy trên VPS bên Anh
//   [port]   : cổng app (mặc định 8686)
//
// Cần file tools/cf.env (KHÔNG commit) chứa:
//   CF_API_TOKEN=<token Cloudflare có quyền Tunnel:Edit + DNS:Edit + Zone:Read>
//   ZONE=maychamcongcloud.com
//   CF_ACCOUNT_ID=<tuỳ chọn — bỏ trống thì tool tự lấy>

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const API = 'https://api.cloudflare.com/client/v4';

/* ---------- đọc cf.env ---------- */
function loadEnv() {
  const p = join(HERE, 'cf.env');
  if (!existsSync(p)) {
    fail(`Chưa có file cấu hình: ${p}\n` +
      `→ Tạo file tools/cf.env với nội dung:\n` +
      `   CF_API_TOKEN=<token Cloudflare của Anh>\n` +
      `   ZONE=maychamcongcloud.com\n` +
      `(Xem mẫu ở tools/cf.env.example)`);
  }
  const env = {};
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i > 0) env[s.slice(0, i).trim()] = s.slice(i + 1).trim();
  }
  if (!env.CF_API_TOKEN) fail('Thiếu CF_API_TOKEN trong tools/cf.env');
  env.ZONE = env.ZONE || 'maychamcongcloud.com';
  return env;
}

/* ---------- gọi Cloudflare API ---------- */
let TOKEN = '';
async function cf(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!data.success) {
    const msg = (data.errors || []).map((e) => `${e.code} ${e.message}`).join('; ') || `HTTP ${res.status}`;
    throw new Error(`Cloudflare API lỗi (${method} ${path}): ${msg}`);
  }
  return data.result;
}

function fail(msg) { console.error('\n❌ ' + msg + '\n'); process.exit(1); }
const slugOk = (s) => /^[a-z0-9]([a-z0-9-]{0,40}[a-z0-9])?$/.test(s);

/* ---------- main ---------- */
async function main() {
  const [, , rawSlug, rawMode, rawPort] = process.argv;
  if (!rawSlug) fail('Thiếu tên công ty. Dùng: node tools/make-customer.mjs <tencty> <office|vps> [port]');
  const slug = String(rawSlug).toLowerCase().trim();
  if (!slugOk(slug)) fail(`Tên "${rawSlug}" không hợp lệ. Chỉ dùng chữ thường, số và dấu gạch ngang (vd: congtyabc, cong-ty-abc).`);
  const mode = (rawMode === 'vps') ? 'vps' : 'office';
  const port = parseInt(rawPort || '8686', 10) || 8686;

  const env = loadEnv();
  TOKEN = env.CF_API_TOKEN;
  const zoneName = env.ZONE;
  const fqdn = `${slug}.${zoneName}`;
  const tname = `digiplus-${slug}`;

  console.log(`\n=== TẠO KHÁCH: ${slug} ===`);
  console.log(`Domain : ${fqdn}`);
  console.log(`Chế độ : ${mode === 'vps' ? 'Server VPS bên Anh (truy cập mọi nơi)' : 'Cài tại văn phòng khách'}`);
  console.log(`Cổng   : ${port}\n`);

  // 1) Zone trước (đồng thời lấy luôn account id từ zone — token scoped không list được /accounts)
  const zones = await cf('GET', `/zones?name=${encodeURIComponent(zoneName)}`);
  if (!zones.length) fail(`Không tìm thấy zone "${zoneName}" trong tài khoản Cloudflare. Domain đã trỏ về Cloudflare chưa?`);
  const zoneId = zones[0].id;
  console.log(`• Zone: ${zoneName} (${zoneId})`);

  let accountId = env.CF_ACCOUNT_ID || zones[0].account?.id;
  if (!accountId) {
    const accts = await cf('GET', '/accounts');
    if (!accts.length) fail('Không lấy được account id. Thêm CF_ACCOUNT_ID vào tools/cf.env.');
    accountId = accts[0].id;
  }
  console.log(`• Account: ${zones[0].account?.name || accountId} (${accountId})`);

  // 2) Tunnel: dùng lại nếu đã có, không thì tạo mới
  let tunnels = await cf('GET', `/accounts/${accountId}/cfd_tunnel?name=${encodeURIComponent(tname)}&is_deleted=false`);
  let tunnel = tunnels.find((t) => t.name === tname);
  if (tunnel) console.log(`• Tunnel đã có: ${tname} (${tunnel.id}) — dùng lại`);
  else {
    tunnel = await cf('POST', `/accounts/${accountId}/cfd_tunnel`, { name: tname, config_src: 'cloudflare' });
    console.log(`• Đã tạo tunnel: ${tname} (${tunnel.id})`);
  }

  // 3) Token của tunnel (để khách/VPS chạy cloudflared)
  const tunnelToken = await cf('GET', `/accounts/${accountId}/cfd_tunnel/${tunnel.id}/token`);

  // 4) Cấu hình ingress: fqdn → http://localhost:PORT
  await cf('PUT', `/accounts/${accountId}/cfd_tunnel/${tunnel.id}/configurations`, {
    config: { ingress: [{ hostname: fqdn, service: `http://localhost:${port}` }, { service: 'http_status:404' }] },
  });
  console.log(`• Ingress: ${fqdn} → http://localhost:${port}`);

  // 5) DNS CNAME fqdn → <tunnelid>.cfargotunnel.com (proxied)
  const content = `${tunnel.id}.cfargotunnel.com`;
  const recs = await cf('GET', `/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(fqdn)}`);
  if (recs.length) {
    await cf('PUT', `/zones/${zoneId}/dns_records/${recs[0].id}`, { type: 'CNAME', name: fqdn, content, proxied: true });
    console.log(`• DNS CNAME: cập nhật ${fqdn}`);
  } else {
    await cf('POST', `/zones/${zoneId}/dns_records`, { type: 'CNAME', name: fqdn, content, proxied: true });
    console.log(`• DNS CNAME: tạo mới ${fqdn}`);
  }

  // 6) Xuất file cấu hình cho khách
  const outDir = join(HERE, 'customers', slug);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'config.txt'), `PORT=${port}\nTUNNEL_TOKEN=${tunnelToken}\n`, 'utf8');

  const url = `https://${fqdn}`;
  const guide = mode === 'vps'
    ? `CHẾ ĐỘ: SERVER VPS (bên Anh chạy — khách truy cập mọi nơi)\n` +
      `1. Trên VPS: chép cả bộ Digiplus + cloudflared vào.\n` +
      `2. Đặt config.txt (file này) cạnh app, chạy app + cloudflared bằng token trong config.\n` +
      `3. Khách vào: ${url} (đăng nhập tài khoản Anh cấp).`
    : `CHẾ ĐỘ: VĂN PHÒNG KHÁCH (chạy tại chỗ khách)\n` +
      `1. Chép file config.txt này ĐÈ vào bộ cài dist-khach của khách.\n` +
      `2. Khách bấm CaiDat.bat → app tự chạy + tunnel tự bật.\n` +
      `3. Truy cập tại chỗ: http://localhost:${port}/admin  ·  từ xa: ${url}`;
  writeFileSync(join(outDir, 'THONG-TIN.txt'),
    `KHÁCH: ${slug}\nDOMAIN: ${url}\nCỔNG: ${port}\n\n${guide}\n\n(config.txt đã chứa TUNNEL_TOKEN riêng của khách này — KHÔNG chia sẻ ra ngoài.)\n`, 'utf8');

  console.log(`\n✅ XONG!`);
  console.log(`• Link khách:  ${url}`);
  console.log(`• File cấu hình: ${outDir}\\config.txt  (đã có PORT + TUNNEL_TOKEN)`);
  console.log(`• Hướng dẫn:     ${outDir}\\THONG-TIN.txt`);
  console.log(mode === 'vps'
    ? `→ Dán config.txt vào bản chạy trên VPS của Anh.\n`
    : `→ Chép config.txt vào bộ cài dist-khach rồi gửi khách.\n`);
}

main().catch((e) => fail(e.message));
