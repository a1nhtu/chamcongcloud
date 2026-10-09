/* ============================================================
   TRANG HƯỚNG DẪN — Cloudflare Pages Worker (chạy trên máy chủ)
   File này được deploy thành _worker.js. Nó đọc mã đại lý trên link
   (?dl=ma-dai-ly) rồi thay TÊN + HOTLINE + ẢNH XEM TRƯỚC trước khi trả
   trang về — nên cả thẻ preview khi share Zalo/Messenger lẫn nội dung
   trang đều hiện đúng của đại lý (ẩn hết Digiplus).

   NGOÀI RA: cấp license/key máy ONLINE tại /cap-license.html
   → API ký số Ed25519 chạy tại đây (server), khoá RIÊNG là SECRET trên
     Cloudflare (KHÔNG nằm trong code). Có mật khẩu chặn.
   ============================================================ */

/* ====== DANH SÁCH ĐẠI LÝ — Anh CHỈ SỬA TRONG KHỐI NÀY ======
   Thêm mỗi đại lý một dòng theo mẫu:
     "ma-dai-ly": { ten:"Tên đại lý", hotline:"09xx xxx xxx", web:"" },
   • Đại lý gửi khách link:  https://huongdan.maychamcongcloud.com/?dl=ma-dai-ly
   • Mã: chữ thường, không dấu, không cách (dùng gạch ngang).
   • web để "" nếu đại lý không có website.
   =========================================================== */
const DAILY = {
  "skytech":   { ten: "Skytech",        hotline: "0865 574 611", web: "vietskytech.com.vn" },
  // "spa-abc":   { ten: "Spa ABC",        hotline: "0900 000 001", web: "" },
  // "cty-xyz":   { ten: "Công ty XYZ",    hotline: "0900 000 002", web: "xyz.vn" },
};

/* Mặc định khi KHÔNG có mã đại lý = của chính Anh (Digiplus) */
const MAC_DINH = { ten: "Digiplus", hotline: "0372 669 992", web: "maychamcongcloud.com" };
/* =========================================================== */

const DESC = "Máy chấm công vân tay/khuôn mặt + app điện thoại (ảnh + GPS). Tự động tính công, xuất báo cáo và bảng lương.";

// escape cho nội dung trong thuộc tính HTML
const esc = (s) => String(s || "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* ---------- Tiện ích cấp license/key ---------- */
const jsonRes = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });

// So sánh chuỗi kiểu hằng-thời-gian (chống dò mật khẩu)
function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const b64FromBuf = (buf) => {
  let s = ""; const a = new Uint8Array(buf);
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s);
};
const b64FromUtf8 = (str) => btoa(unescape(encodeURIComponent(str)));

// Nhập khoá riêng Ed25519 (PKCS8, dạng PEM hoặc base64 thuần) từ SECRET
async function importPrivateKey(pem) {
  const b64 = String(pem).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "Ed25519" }, false, ["sign"]);
}

// Ký 1 payload → trả chuỗi "payloadB64.sigB64" (khớp verify Ed25519 phía app)
async function signPayload(payload, privKey) {
  const payloadB64 = b64FromUtf8(JSON.stringify(payload));
  const sig = await crypto.subtle.sign({ name: "Ed25519" }, privKey, new TextEncoder().encode(payloadB64));
  return payloadB64 + "." + b64FromBuf(sig);
}
const todayStr = () => new Date().toISOString().slice(0, 10);

async function handleSign(request, env, kind) {
  if (request.method !== "POST") return jsonRes({ error: "Chỉ nhận POST" }, 405);
  if (!env.LICENSE_PRIVATE_KEY || !env.LICENSE_ADMIN_PASS)
    return jsonRes({ error: "Máy chủ chưa cấu hình khoá/mật khẩu cấp license (đặt Secret trong Cloudflare)." }, 503);

  let b;
  try { b = await request.json(); } catch { return jsonRes({ error: "Dữ liệu gửi lên không hợp lệ" }, 400); }
  if (!b || !safeEqual(b.pass || "", env.LICENSE_ADMIN_PASS)) return jsonRes({ error: "Sai mật khẩu cấp license" }, 401);

  let key;
  try { key = await importPrivateKey(env.LICENSE_PRIVATE_KEY); }
  catch (e) { return jsonRes({ error: "Khoá riêng cấu hình sai định dạng: " + e.message }, 500); }

  try {
    if (kind === "device") {
      if (!b.serial) return jsonRes({ error: "Thiếu Serial máy" }, 400);
      const payload = { t: "dev", s: String(b.serial).replace(/\s/g, "").toUpperCase(), c: b.company || "", e: b.exp || null, i: todayStr() };
      return jsonRes({ ok: true, key: await signPayload(payload, key), payload });
    }
    if (!b.machine || !b.company) return jsonRes({ error: "Thiếu Mã máy hoặc Tên công ty" }, 400);
    const payload = {
      c: b.company,
      m: String(b.machine).replace(/[-\s]/g, "").toUpperCase() || "*",
      e: b.exp || null,
      n: b.max ? parseInt(b.max, 10) : null,
      i: todayStr(),
    };
    return jsonRes({ ok: true, license: await signPayload(payload, key), payload });
  } catch (e) { return jsonRes({ error: "Lỗi ký: " + e.message }, 500); }
}

/* ============================================================
   CẤP DOMAIN ONLINE cho KỸ THUẬT (có QUOTA + mật khẩu riêng)
   → route /api/tao-domain. Token Cloudflare là SECRET (CF_PROVISION_TOKEN),
     mật khẩu riêng DOMAIN_ADMIN_PASS (KHÁC mật khẩu cấp license),
     hạn mức DOMAIN_QUOTA (mặc định 100) = đếm số tunnel digiplus-* đang sống.
   Kỹ thuật nghỉ việc → đổi DOMAIN_ADMIN_PASS là khóa ngay, token CF không lộ.
   ============================================================ */
const CF_API = "https://api.cloudflare.com/client/v4";
const slugOkProv = (s) => /^[a-z0-9]([a-z0-9-]{0,40}[a-z0-9])?$/.test(s);

async function cfProv(token, method, path, body) {
  const res = await fetch(CF_API + path, {
    method,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!data.success) {
    const msg = (data.errors || []).map((e) => `${e.code} ${e.message}`).join("; ") || `HTTP ${res.status}`;
    throw new Error(`Cloudflare API lỗi (${method} ${path}): ${msg}`);
  }
  return data.result;
}

// Danh sách khách (tunnel digiplus-*) kèm CỔNG đã cấp. Cổng lưu ở "comment" của bản ghi DNS
// (đọc 1 lần cho cả zone). Khách cũ chưa có comment → đọc cấu hình tunnel rồi ghi bù comment
// (mỗi lần tối đa 15 khách, để không vượt giới hạn số request của Worker).
const DNS_TAG = "digiplus";
function parseComment(c) {
  const m = {}; for (const kv of String(c || "").split(/\s+/)) { const i = kv.indexOf("="); if (i > 0) m[kv.slice(0, i)] = kv.slice(i + 1); }
  return m;
}
async function listCustomers(token, accountId, zoneId, zoneName) {
  const tunnels = [];
  for (let page = 1; page <= 20; page++) {
    const list = await cfProv(token, "GET", `/accounts/${accountId}/cfd_tunnel?is_deleted=false&per_page=100&page=${page}`);
    if (!Array.isArray(list) || !list.length) break;
    tunnels.push(...list.filter((t) => (t.name || "").startsWith("digiplus-")));
    if (list.length < 100) break;
  }
  const recs = await cfProv(token, "GET", `/zones/${zoneId}/dns_records?type=CNAME&per_page=1000`);
  const byName = new Map((recs || []).map((r) => [r.name, r]));
  const out = [];
  let backfill = 0;
  for (const t of tunnels) {
    const slug = t.name.slice("digiplus-".length);
    const fqdn = `${slug}.${zoneName}`;
    const rec = byName.get(fqdn);
    const meta = parseComment(rec && rec.comment);
    let port = parseInt(meta.port || "", 10) || null;
    if (!port && backfill < 15) {
      backfill++;
      try {
        const cfg = await cfProv(token, "GET", `/accounts/${accountId}/cfd_tunnel/${t.id}/configurations`);
        const svc = ((cfg && cfg.config && cfg.config.ingress) || []).map((i) => i.service || "").find((x) => /localhost:\d+/.test(x));
        port = svc ? parseInt(svc.match(/localhost:(\d+)/)[1], 10) : null;
        if (port && rec) await cfProv(token, "PATCH", `/zones/${zoneId}/dns_records/${rec.id}`, { comment: `${DNS_TAG} port=${port}` });
      } catch { /* bỏ qua, lần sau đọc lại */ }
    }
    out.push({ slug, domain: `https://${fqdn}`, port, created: t.created_at || "", mode: meta.mode || "",
      useDevice: meta.dev !== "0", usePhone: meta.phone !== "0", tunnelId: t.id, dnsId: rec ? rec.id : null });
  }
  out.sort((x, y) => String(y.created).localeCompare(String(x.created)));
  return out;
}
const nextFreePort = (list) => {
  const used = new Set(list.map((c) => c.port).filter(Boolean));
  let p = Math.max(8685, ...used) + 1;
  while (used.has(p)) p++;
  return p;
};
async function zoneAndAccount(token, env) {
  const zoneName = env.CF_ZONE || "maychamcongcloud.com";
  const zones = await cfProv(token, "GET", `/zones?name=${encodeURIComponent(zoneName)}`);
  if (!zones.length) throw new Error(`Không tìm thấy zone "${zoneName}" trên Cloudflare.`);
  let accountId = env.CF_ACCOUNT_ID || zones[0].account?.id;
  if (!accountId) {
    const accts = await cfProv(token, "GET", "/accounts");
    if (!accts.length) throw new Error("Không lấy được account id (đặt CF_ACCOUNT_ID).");
    accountId = accts[0].id;
  }
  return { zoneName, zoneId: zones[0].id, accountId };
}
async function readProvBody(request, env) {
  if (request.method !== "POST") return { res: jsonRes({ error: "Chỉ nhận POST" }, 405) };
  if (!env.CF_PROVISION_TOKEN || !env.DOMAIN_ADMIN_PASS)
    return { res: jsonRes({ error: "Máy chủ chưa cấu hình cấp domain (đặt Secret CF_PROVISION_TOKEN + DOMAIN_ADMIN_PASS trong Cloudflare)." }, 503) };
  let b;
  try { b = await request.json(); } catch { return { res: jsonRes({ error: "Dữ liệu gửi lên không hợp lệ" }, 400) }; }
  if (!b || !safeEqual(b.pass || "", env.DOMAIN_ADMIN_PASS)) return { res: jsonRes({ error: "Sai mật khẩu cấp domain" }, 401) };
  return { b };
}

// Danh sách khách đã tạo + cổng gợi ý tiếp theo (trang tao-domain.html: chống trùng cổng + tải lại bộ cài)
async function handleListCustomers(request, env) {
  const { b, res } = await readProvBody(request, env);
  if (res) return res;
  try {
    const token = env.CF_PROVISION_TOKEN;
    const { zoneName, zoneId, accountId } = await zoneAndAccount(token, env);
    const list = await listCustomers(token, accountId, zoneId, zoneName);
    const quota = parseInt(env.DOMAIN_QUOTA || "100", 10) || 100;
    return jsonRes({ ok: true, customers: list.map(({ tunnelId, dnsId, ...c }) => c), nextPort: nextFreePort(list), count: list.length, quota });
  } catch (e) {
    return jsonRes({ error: "Lỗi đọc danh sách khách: " + e.message }, 500);
  }
}

async function handleProvision(request, env) {
  const { b, res } = await readProvBody(request, env);
  if (res) return res;

  const slug = String(b.slug || "").toLowerCase().trim();
  if (!slugOkProv(slug)) return jsonRes({ error: "Tên công ty không hợp lệ (chỉ chữ thường, số, gạch ngang; vd: congtyabc)." }, 400);
  const mode = b.mode === "vps" ? "vps" : "office";
  let port = parseInt(b.port || "8686", 10) || 8686;
  if (port < 1024 || port > 65000) return jsonRes({ error: "Cổng app phải trong khoảng 1024–65000." }, 400);
  const useDevice = b.useDevice === false ? "0" : "1";
  const usePhone = b.usePhone === false ? "0" : "1";

  const token = env.CF_PROVISION_TOKEN;
  const quota = parseInt(env.DOMAIN_QUOTA || "100", 10) || 100;

  try {
    // 1) Zone + account + danh sách khách hiện có (kèm cổng)
    const { zoneName, zoneId, accountId } = await zoneAndAccount(token, env);
    const fqdn = `${slug}.${zoneName}`;
    const tname = `digiplus-${slug}`;
    const list = await listCustomers(token, accountId, zoneId, zoneName);
    const existing = list.find((c) => c.slug === slug);

    // 2) Tunnel: dùng lại nếu đã có (không tính quota, GIỮ NGUYÊN cổng cũ để khỏi làm hỏng khách đang chạy);
    //    nếu MỚI → kiểm tra hạn mức + cổng không trùng khách khác
    let tunnelId, reused = !!existing, portKept = false;
    if (existing) {
      tunnelId = existing.tunnelId;
      if (existing.port && existing.port !== port) { port = existing.port; portKept = true; }
    } else {
      if (list.length >= quota)
        return jsonRes({ error: `Đã đạt hạn mức ${quota} domain (đang dùng ${list.length}). Liên hệ quản trị để nâng hạn mức.`, count: list.length, quota }, 403);
      const clash = list.find((c) => c.port === port);
      if (clash)
        return jsonRes({ error: `Cổng ${port} đã cấp cho khách "${clash.slug}". Dùng cổng trống tiếp theo: ${nextFreePort(list)}.`, nextPort: nextFreePort(list) }, 409);
      const t = await cfProv(token, "POST", `/accounts/${accountId}/cfd_tunnel`, { name: tname, config_src: "cloudflare" });
      tunnelId = t.id;
    }

    // 3) Token tunnel
    const tunnelToken = await cfProv(token, "GET", `/accounts/${accountId}/cfd_tunnel/${tunnelId}/token`);

    // 4) Ingress fqdn → localhost:PORT
    await cfProv(token, "PUT", `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`, {
      config: { ingress: [{ hostname: fqdn, service: `http://localhost:${port}` }, { service: "http_status:404" }] },
    });

    // 5) DNS CNAME fqdn → <tunnelid>.cfargotunnel.com (proxied) + comment lưu cổng/cấu hình để lần sau tra lại
    const dns = { type: "CNAME", name: fqdn, content: `${tunnelId}.cfargotunnel.com`, proxied: true,
      comment: `${DNS_TAG} port=${port} mode=${mode} dev=${useDevice} phone=${usePhone}` };
    if (existing && existing.dnsId) await cfProv(token, "PUT", `/zones/${zoneId}/dns_records/${existing.dnsId}`, dns);
    else {
      const recs = await cfProv(token, "GET", `/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(fqdn)}`);
      if (recs.length) await cfProv(token, "PUT", `/zones/${zoneId}/dns_records/${recs[0].id}`, dns);
      else await cfProv(token, "POST", `/zones/${zoneId}/dns_records`, dns);
    }

    // 6) Nội dung config.txt (đúng định dạng launcher đọc)
    //    USE_DEVICE / USE_PHONE = chức năng chấm công đặt sẵn theo bộ cài (khỏi cần đăng nhập tài khoản tổng)
    const configTxt = `PORT=${port}\nCUSTOMER=${slug}\nTUNNEL_TOKEN=${tunnelToken}\nUSE_DEVICE=${useDevice}\nUSE_PHONE=${usePhone}\n`;
    const used = list.length + (reused ? 0 : 1);
    return jsonRes({
      ok: true, slug, mode, port, portKept, domain: `https://${fqdn}`,
      customer: slug, tunnelToken, configTxt,
      reused, count: used, quota, remaining: Math.max(0, quota - used),
    });
  } catch (e) {
    return jsonRes({ error: "Lỗi tạo domain: " + e.message }, 500);
  }
}

// Cổng "Nội bộ" (/noibo): kiểm tra mật khẩu trước khi hiện link công cụ. Nhận mật khẩu cấp domain HOẶC cấp license.
// Chỉ để gom link + đỡ gõ địa chỉ; bảo vệ thật vẫn là mật khẩu riêng của từng công cụ.
async function handleNoiBo(request, env) {
  if (request.method !== "POST") return jsonRes({ error: "Chỉ nhận POST" }, 405);
  let b;
  try { b = await request.json(); } catch { return jsonRes({ error: "Dữ liệu gửi lên không hợp lệ" }, 400); }
  const pass = String((b && b.pass) || "");
  const domain = !!env.DOMAIN_ADMIN_PASS && safeEqual(pass, env.DOMAIN_ADMIN_PASS);
  const license = !!env.LICENSE_ADMIN_PASS && safeEqual(pass, env.LICENSE_ADMIN_PASS);
  if (!domain && !license) return jsonRes({ error: "Sai mật khẩu" }, 401);
  return jsonRes({ ok: true, domain, license });
}

// Proxy bộ cài BASE (neutral) từ link ngoài (GitHub Release...) qua CÙNG tên miền
// → trang tao-domain.html tải về ghép config, KHÔNG dính lỗi CORS.
async function handleBaseZip(request, env) {
  if (!env.BASE_ZIP_URL)
    return jsonRes({ error: "Chưa cấu hình BASE_ZIP_URL (link bộ cài base) trên Cloudflare." }, 503);
  const upstream = await fetch(env.BASE_ZIP_URL, { redirect: "follow", cf: { cacheEverything: true, cacheTtl: 3600 } });
  if (!upstream.ok || !upstream.body)
    return jsonRes({ error: "Không tải được bộ cài base (HTTP " + upstream.status + ")." }, 502);
  const headers = new Headers();
  headers.set("content-type", "application/zip");
  const len = upstream.headers.get("content-length");
  if (len) headers.set("content-length", len);
  headers.set("cache-control", "public, max-age=3600");
  headers.set("access-control-allow-origin", "*");
  return new Response(upstream.body, { status: 200, headers });
}

// Tải BỘ CÀI LAN có thương hiệu: proxy file lan.zip từ GitHub Release → trình duyệt tải thẳng về.
// File vẫn ở GitHub (khỏi tốn hosting), link hiện là maychamcongcloud.com.
async function handleLanZip(request, env) {
  const src = env.LAN_ZIP_URL || "https://github.com/a1nhtu/chamcongcloud/releases/download/base/DigiplusChamCong-lan.zip";
  const upstream = await fetch(src, { redirect: "follow", cf: { cacheEverything: true, cacheTtl: 3600 } });
  if (!upstream.ok || !upstream.body)
    return jsonRes({ error: "Chưa tải được bộ cài LAN (HTTP " + upstream.status + "). Thử lại sau ít phút." }, 502);
  const headers = new Headers();
  headers.set("content-type", "application/zip");
  const len = upstream.headers.get("content-length");
  if (len) headers.set("content-length", len);
  headers.set("content-disposition", 'attachment; filename="DigiplusChamCong-LAN.zip"');
  headers.set("cache-control", "public, max-age=3600");
  return new Response(upstream.body, { status: 200, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // API cấp license / key máy (ký số phía server)
    if (url.pathname === "/api/gen-license") return handleSign(request, env, "license");
    if (url.pathname === "/api/gen-device") return handleSign(request, env, "device");
    if (url.pathname === "/api/tao-domain") return handleProvision(request, env);
    if (url.pathname === "/api/ds-khach") return handleListCustomers(request, env);
    if (url.pathname === "/api/noibo") return handleNoiBo(request, env);
    if (url.pathname === "/api/base-zip") return handleBaseZip(request, env);
    // Link TẢI BỘ CÀI LAN có thương hiệu (proxy từ GitHub Release → tải thẳng về)
    if (url.pathname === "/tai-ban-lan" || url.pathname === "/tai-ban-lan.zip") return handleLanZip(request, env);

    const res = await env.ASSETS.fetch(request);

    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html")) return res;   // chỉ xử lý trang HTML
    // Trang nội bộ (cấp license / cấp domain): KHÔNG tiêm quảng cáo/đại lý, giữ nguyên
    if (url.pathname.startsWith("/cap-license") || url.pathname.startsWith("/tao-domain") || url.pathname.startsWith("/noibo")) return res;

    const code = (url.searchParams.get("dl") || url.searchParams.get("daily") || "").trim().toLowerCase();
    const d = (code && DAILY[code]) ? DAILY[code] : MAC_DINH;
    const ten = d.ten || "Phần mềm chấm công";
    const title = ten + " — Chấm công";
    const canonical = url.origin + url.pathname + (code && DAILY[code] ? ("?dl=" + code) : "");

    const injected =
      `<meta property="og:title" content="${esc(title)}">` +
      `<meta property="og:description" content="${esc(DESC)}">` +
      `<meta property="og:type" content="website">` +
      `<meta property="og:url" content="${esc(canonical)}">` +
      `<meta name="twitter:card" content="summary">` +
      `<meta name="twitter:title" content="${esc(title)}">` +
      `<meta name="twitter:description" content="${esc(DESC)}">` +
      `<meta name="description" content="${esc(DESC)}">` +
      `<script>window.__DL__=${JSON.stringify(d)};<\/script>`;

    // Trang không có thẻ <head> tường minh → chèn ngay SAU <title>
    return new HTMLRewriter()
      .on("title", { element(e) { e.setInnerContent(title); e.after(injected, { html: true }); } })
      .transform(res);
  }
};
