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
  // Công ty trên máy chủ nhiều công ty: không có tunnel riêng, nhận ra qua ghi chú DNS "mode=host host=<máy chủ>"
  for (const r of recs || []) {
    const meta = parseComment(r.comment);
    if (meta.mode !== "host" || !r.name.endsWith("." + zoneName)) continue;
    const slug = r.name.slice(0, -(zoneName.length + 1));
    out.push({ slug, domain: `https://${r.name}`, port: null, created: r.created_on || "", mode: "host", host: meta.host || "",
      useDevice: meta.dev !== "0", usePhone: meta.phone !== "0", tunnelId: null, dnsId: r.id });
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
    // Setup.exe "Cài trên VPS nhiều khách": các dòng "cổng slug" của khách chạy trên VPS (mode vps / chưa rõ), trừ khách đang cài
    if (b.vpsPorts) {
      const me = String(b.slug || "").toLowerCase().trim();
      const lines = list.filter((c) => c.port && c.slug !== me && (c.mode === "vps" || !c.mode)).map((c) => `${c.port} ${c.slug}`);
      return new Response(lines.join("\n"), { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
    }
    const quota = parseInt(env.DOMAIN_QUOTA || "100", 10) || 100;
    return jsonRes({ ok: true, customers: list.map(({ tunnelId, dnsId, ...c }) => c), nextPort: nextFreePort(list), count: list.filter((c) => c.tunnelId).length, quota });
  } catch (e) {
    return jsonRes({ error: "Lỗi đọc danh sách khách: " + e.message }, 500);
  }
}

async function handleProvision(request, env) {
  const { b, res } = await readProvBody(request, env);
  if (res) return res;
  return provisionCore(b, env);
}

// Lõi cấp / lấy domain (đã tách khỏi kiểm mật khẩu để install không mật khẩu dùng lại).
async function provisionCore(b, env) {
  if (!env.CF_PROVISION_TOKEN) return jsonRes({ error: "Máy chủ chưa cấu hình cấp domain (đặt Secret CF_PROVISION_TOKEN)." }, 503);
  const slug = String(b.slug || "").toLowerCase().trim();
  if (!slugOkProv(slug)) return jsonRes({ error: "Tên công ty không hợp lệ (chỉ chữ thường, số, gạch ngang; vd: congtyabc)." }, 400);
  let mode = b.mode === "vps" ? "vps" : "office";
  let port = parseInt(b.port || "8686", 10) || 8686;
  if (port < 1024 || port > 65000) return jsonRes({ error: "Cổng app phải trong khoảng 1024–65000." }, 400);
  const reqPort = port;
  let useDevice = b.useDevice === false ? "0" : "1";
  let usePhone = b.usePhone === false ? "0" : "1";

  const token = env.CF_PROVISION_TOKEN;
  const quota = parseInt(env.DOMAIN_QUOTA || "100", 10) || 100;

  try {
    // 1) Zone + account + danh sách khách hiện có (kèm cổng)
    const { zoneName, zoneId, accountId } = await zoneAndAccount(token, env);
    const fqdn = `${slug}.${zoneName}`;
    const tname = `digiplus-${slug}`;
    const list = await listCustomers(token, accountId, zoneId, zoneName);
    const existing = list.find((c) => c.slug === slug && c.tunnelId);
    // Tên miền đang thuộc 1 công ty trên MÁY CHỦ NHIỀU CÔNG TY → không tạo tunnel riêng đè lên
    const onHost = list.find((c) => c.slug === slug && c.mode === "host");
    if (onHost) return jsonRes({ error: `"${slug}" đang chạy trên máy chủ nhiều công ty (${onHost.host}). Không cài bản riêng trùng tên.` }, 409);
    if (slug.startsWith("ctl-")) return jsonRes({ error: "Tên công ty không hợp lệ." }, 400);

    // 2) Tunnel: dùng lại nếu đã có (không tính quota, GIỮ NGUYÊN cổng cũ để khỏi làm hỏng khách đang chạy);
    //    nếu MỚI → kiểm tra hạn mức + cổng không trùng khách khác
    let tunnelId, reused = !!existing, portKept = false;
    // Setup.exe: chỉ LẤY cấu hình của khách đã tạo trên trang Tạo khách (không tự tạo khách mới ở đây)
    if (!existing && b.onlyExisting)
      return jsonRes({ error: `Chưa có khách "${slug}". Tạo khách trên trang Tạo khách trước.` }, 404);
    if (existing && b.onlyExisting) {
      // giữ nguyên cổng + lựa chọn máy/điện thoại đã lưu lúc tạo
      if (existing.port) port = existing.port;
      useDevice = existing.useDevice ? "1" : "0";
      usePhone = existing.usePhone ? "1" : "0";
      if (existing.mode) mode = existing.mode;
      if (b.vps) mode = "vps";   // Setup.exe tích "Cài trên VPS nhiều khách" → đánh dấu khách VPS
    }
    // cổng đã cấp cho khách VPS khác (mode vps / chưa rõ) — dùng khi cài trên VPS nhiều khách
    const vpsClash = (p) => list.find((c) => c.slug !== slug && c.port === p && (c.mode === "vps" || !c.mode));
    if (existing) {
      tunnelId = existing.tunnelId;
      // Setup.exe: cổng cũ bị trùng trên máy cài, người cài đã đồng ý đổi → trỏ tên miền về cổng mới
      if (b.onlyExisting && b.setPort) {
        port = reqPort;
        const vc = mode === "vps" ? vpsClash(port) : null;
        if (vc) return jsonRes({ error: `Cổng ${port} đã cấp cho khách VPS "${vc.slug}".`, nextPort: nextFreePort(list) }, 409);
      }
      else if (existing.port && existing.port !== port) { port = existing.port; portKept = true; }
    } else {
      const ntun = list.filter((c) => c.tunnelId).length;
      if (ntun >= quota)
        return jsonRes({ error: `Đã đạt hạn mức ${quota} domain (đang dùng ${ntun}). Liên hệ quản trị để nâng hạn mức.`, count: ntun, quota }, 403);
      if (b.autoPort) port = nextFreePort(list);   // Setup.exe: khách mới tự lấy cổng trống tiếp theo
      // Setup.exe bản mới (localPort): cổng do người cài chọn, đã kiểm tra trống TRÊN MÁY CÀI — cổng chỉ cần riêng trong 1 máy
      const clash = b.localPort ? (mode === "vps" ? vpsClash(port) : null) : list.find((c) => c.port === port);
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
    if (b.plain) return new Response(configTxt, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
    const used = list.filter((c) => c.tunnelId).length + (reused ? 0 : 1);
    return jsonRes({
      ok: true, slug, mode, port, portKept, domain: `https://${fqdn}`,
      customer: slug, tunnelToken, configTxt,
      reused, count: used, quota, remaining: Math.max(0, quota - used),
    });
  } catch (e) {
    return jsonRes({ error: "Lỗi tạo domain: " + e.message }, 500);
  }
}

// Setup.exe (link 01 — đại lý tự cài): tạo MỚI hoặc lấy cấu hình khách bằng tên miền, KHÔNG cần mật khẩu.
// Trả config.txt (kèm TUNNEL_TOKEN) đúng như trang Tạo khách, nhưng không bảo vệ bằng mật khẩu — đánh đổi để đại lý tự cài.
// vpsPorts: chỉ trả các dòng "cổng slug" của khách VPS để Setup né cổng (không lộ toàn bộ danh sách khách).
async function handleInstallConfig(request, env) {
  if (request.method !== "POST") return jsonRes({ error: "Chỉ nhận POST" }, 405);
  if (!env.CF_PROVISION_TOKEN) return jsonRes({ error: "Máy chủ chưa cấu hình cấp domain." }, 503);
  let b;
  try { b = await request.json(); } catch { return jsonRes({ error: "Dữ liệu gửi lên không hợp lệ" }, 400); }
  if (!b) return jsonRes({ error: "Dữ liệu gửi lên không hợp lệ" }, 400);
  if (b.vpsPorts) {
    try {
      const token = env.CF_PROVISION_TOKEN;
      const { zoneName, zoneId, accountId } = await zoneAndAccount(token, env);
      const list = await listCustomers(token, accountId, zoneId, zoneName);
      const me = String(b.slug || "").toLowerCase().trim();
      const lines = list.filter((c) => c.port && c.slug !== me && (c.mode === "vps" || !c.mode)).map((c) => `${c.port} ${c.slug}`);
      return new Response(lines.join("\n"), { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
    } catch (e) {
      return jsonRes({ error: "Lỗi đọc cổng: " + e.message }, 500);
    }
  }
  return provisionCore(b, env);
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
  const upstream = await fetch(env.BASE_ZIP_URL, { redirect: "follow", cf: { cacheEverything: true, cacheTtl: 60 } });
  if (!upstream.ok || !upstream.body)
    return jsonRes({ error: "Không tải được bộ cài base (HTTP " + upstream.status + ")." }, 502);
  const headers = new Headers();
  headers.set("content-type", "application/zip");
  const len = upstream.headers.get("content-length");
  if (len) headers.set("content-length", len);
  headers.set("cache-control", "no-cache");
  headers.set("access-control-allow-origin", "*");
  return new Response(upstream.body, { status: 200, headers });
}

// Tải BỘ CÀI LAN có thương hiệu: proxy file lan.zip từ GitHub Release → trình duyệt tải thẳng về.
// File vẫn ở GitHub (khỏi tốn hosting), link hiện là maychamcongcloud.com.
async function handleLanZip(request, env) {
  const src = env.LAN_ZIP_URL || "https://github.com/a1nhtu/chamcongcloud/releases/download/base/DigiplusChamCong-lan.zip";
  const upstream = await fetch(src, { redirect: "follow", cf: { cacheEverything: true, cacheTtl: 60 } });
  if (!upstream.ok || !upstream.body)
    return jsonRes({ error: "Chưa tải được bộ cài LAN (HTTP " + upstream.status + "). Thử lại sau ít phút." }, 502);
  const headers = new Headers();
  headers.set("content-type", "application/zip");
  const len = upstream.headers.get("content-length");
  if (len) headers.set("content-length", len);
  headers.set("content-disposition", 'attachment; filename="DigiplusChamCong-LAN.zip"');
  headers.set("cache-control", "no-cache");
  return new Response(upstream.body, { status: 200, headers });
}

// Tải TRÌNH CÀI ĐẶT dạng .ZIP (mặc định): Chrome KHÔNG báo "tệp đáng ngờ" với file .zip như với .exe trần
// → khách tải được, giải nén rồi chạy DigiplusChamCong-Setup.exe bên trong. Proxy từ GitHub Release.
async function handleSetupExe(request, env) {
  const src = env.SETUP_ZIP_URL || "https://github.com/a1nhtu/chamcongcloud/releases/download/base/DigiplusChamCong-Setup.zip";
  const upstream = await fetch(src, { redirect: "follow", cf: { cacheEverything: true, cacheTtl: 60 } });
  if (!upstream.ok || !upstream.body)
    return jsonRes({ error: "Chưa tải được bộ cài (HTTP " + upstream.status + "). Thử lại sau ít phút." }, 502);
  const headers = new Headers();
  headers.set("content-type", "application/zip");
  const len = upstream.headers.get("content-length");
  if (len) headers.set("content-length", len);
  headers.set("content-disposition", 'attachment; filename="DigiplusChamCong-Setup.zip"');
  headers.set("cache-control", "no-cache");   // bộ cài build lại thường xuyên → luôn lấy bản mới nhất
  return new Response(upstream.body, { status: 200, headers });
}

// Bản .exe trần (dự phòng, cho ai cần): /tai-bo-cai.exe
async function handleSetupExeRaw(request, env) {
  const src = env.SETUP_EXE_URL || "https://github.com/a1nhtu/chamcongcloud/releases/download/base/DigiplusChamCong-Setup.exe";
  const upstream = await fetch(src, { redirect: "follow", cf: { cacheEverything: true, cacheTtl: 60 } });
  if (!upstream.ok || !upstream.body)
    return jsonRes({ error: "Chưa tải được bộ cài (HTTP " + upstream.status + "). Thử lại sau ít phút." }, 502);
  const headers = new Headers();
  headers.set("content-type", "application/octet-stream");
  const len = upstream.headers.get("content-length");
  if (len) headers.set("content-length", len);
  headers.set("content-disposition", 'attachment; filename="DigiplusChamCong-Setup.exe"');
  headers.set("cache-control", "no-cache");
  return new Response(upstream.body, { status: 200, headers });
}

// Tải TOOL PHÁ QUẢN TRỊ MÁY CHẤM CÔNG (Setup.exe riêng): proxy từ GitHub Release tag `tool-pha-quan-tri`.
async function handleToolPhaQuanTri(request, env) {
  const src = env.TOOL_PQT_URL || "https://github.com/a1nhtu/chamcongcloud/releases/download/tool-pha-quan-tri/ToolPhaQuanTri-Setup.exe";
  const upstream = await fetch(src, { redirect: "follow", cf: { cacheEverything: true, cacheTtl: 60 } });
  if (!upstream.ok || !upstream.body)
    return jsonRes({ error: "Chưa tải được tool (HTTP " + upstream.status + "). Thử lại sau ít phút." }, 502);
  const headers = new Headers();
  headers.set("content-type", "application/octet-stream");
  const len = upstream.headers.get("content-length");
  if (len) headers.set("content-length", len);
  headers.set("content-disposition", 'attachment; filename="ToolPhaQuanTri-Setup.exe"');
  headers.set("cache-control", "no-cache");
  return new Response(upstream.body, { status: 200, headers });
}

// Lệnh cài BẢN LINUX ngắn gọn: curl -fsSL https://huongdan.maychamcongcloud.com/cai-linux | sudo bash
// → trả script tools/linux/cai-dat.sh mới nhất trên nhánh main (repo công khai).
async function handleLinuxScript() {
  const upstream = await fetch("https://raw.githubusercontent.com/a1nhtu/chamcongcloud/main/tools/linux/cai-dat.sh", { cf: { cacheTtl: 60 } });
  if (!upstream.ok) return new Response("echo 'Chua tai duoc bo cai Linux (HTTP " + upstream.status + "). Thu lai sau it phut.'; exit 1\n", { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(upstream.body, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-cache" } });
}

/* ============================================================
   MÁY CHỦ NHIỀU CÔNG TY (1 VPS chạy 1 phần mềm cho NHIỀU công ty)
   • Mỗi máy chủ = 1 tunnel "dgphost-<tên>" nhận MỌI tên miền *.maychamcongcloud.com (ingress wildcard)
     → tạo công ty mới chỉ cần thêm 1 bản ghi DNS <mã> → tunnel máy chủ, KHÔNG tạo tunnel / cloudflared mới.
   • Worker gọi máy chủ qua https://ctl-<tên>.<zone>/_host/... kèm HOST_TOKEN. Mã này TÍNH RA từ bí mật
     (HMAC) nên không phải lưu ở đâu: Secret HOST_SECRET, chưa đặt thì dựa trên LICENSE_PRIVATE_KEY.
   • Link tạo công ty của Anh/đại lý: /tao-cong-ty?k=<mã-đại-lý>.<chữ-ký>. Đại lý lưu trong DNS (bản ghi TXT
     _dl-<mã>), XOÁ bản ghi = khoá link ngay; "cấp lại" = tăng v → link cũ hết hiệu lực.
   ============================================================ */
const HOST_TUN = "dgphost-";
const hostNameOk = (s) => /^[a-z0-9]{1,20}$/.test(s);
const dlCodeOk = (s) => /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/.test(s);
const RESERVED_SLUG = new Set(["www", "huongdan", "app", "api", "admin", "mail", "ctl", "host", "noibo"]);

function hostSecret(env) {
  if (env.HOST_SECRET) return env.HOST_SECRET;
  if (env.LICENSE_PRIVATE_KEY) return "dgp-host|" + env.LICENSE_PRIVATE_KEY;
  throw new Error("Chưa cấu hình HOST_SECRET / LICENSE_PRIVATE_KEY trên Cloudflare.");
}
async function hmacHex(secret, msg) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)));
  return [...sig].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const hostToken = async (env, name) => (await hmacHex(hostSecret(env), "host:" + name)).slice(0, 40);
const dlSig = async (env, code, v) => (await hmacHex(hostSecret(env), `dl:${code}:${v}`)).slice(0, 16);

// Ngày theo giờ Việt Nam (+7), cộng thêm n ngày
const vnDate = (n = 0) => new Date(Date.now() + 7 * 3600000 + n * 86400000).toISOString().slice(0, 10);

async function allTunnels(token, accountId) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const list = await cfProv(token, "GET", `/accounts/${accountId}/cfd_tunnel?is_deleted=false&per_page=100&page=${page}`);
    if (!Array.isArray(list) || !list.length) break;
    out.push(...list);
    if (list.length < 100) break;
  }
  return out;
}
const hostsOf = (tunnels) => tunnels.filter((t) => (t.name || "").startsWith(HOST_TUN))
  .map((t) => ({ name: t.name.slice(HOST_TUN.length), tunnelId: t.id, created: t.created_at || "" }))
  .sort((a, b) => a.name.localeCompare(b.name));

// Gọi API điều khiển của máy chủ (qua chính tunnel của máy chủ)
async function hostCall(env, zoneName, host, method, path, body) {
  let res;
  try {
    res = await fetch(`https://ctl-${host}.${zoneName}/_host${path}`, {
      method, headers: { Authorization: "Bearer " + (await hostToken(env, host)), "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) { throw Object.assign(new Error(`Không gọi được máy chủ "${host}": ${e.message}`), { status: 502 }); }
  const d = await res.json().catch(() => null);
  if (!d) throw Object.assign(new Error(`Máy chủ "${host}" không trả lời (HTTP ${res.status}) — máy chủ đang tắt hoặc chưa cài?`), { status: 502 });
  if (!res.ok) throw Object.assign(new Error(d.error || `HTTP ${res.status}`), { status: res.status });
  return d;
}

// Bản quyền cho công ty trên máy chủ (dùng thử / gia hạn): ký theo Mã máy của công ty
async function signTenantLicense(env, company, machine, exp, max) {
  const key = await importPrivateKey(env.LICENSE_PRIVATE_KEY);
  return signPayload({ c: company, m: String(machine).replace(/[-\s]/g, "").toUpperCase(), e: exp || null,
    n: max ? parseInt(max, 10) : null, i: todayStr() }, key);
}

// Ghi / sửa 1 bản ghi DNS theo tên (có rồi thì PUT, chưa có thì POST)
async function upsertDns(token, zoneId, rec) {
  const found = await cfProv(token, "GET", `/zones/${zoneId}/dns_records?type=${rec.type}&name=${encodeURIComponent(rec.name)}`);
  if (found.length) return cfProv(token, "PUT", `/zones/${zoneId}/dns_records/${found[0].id}`, rec);
  return cfProv(token, "POST", `/zones/${zoneId}/dns_records`, rec);
}

/* ---- Đại lý (link tạo công ty) — lưu ở DNS TXT _dl-<mã>.<zone>: "dgp-dl v=1 host=vps1 ten=..." ---- */
function parseDealer(rec, zoneName) {
  const code = rec.name.slice(4, -(zoneName.length + 1));
  const m = parseComment(String(rec.content || "").replace(/^"|"$/g, ""));
  let ten = code; try { ten = decodeURIComponent(m.ten || code); } catch {}
  return { code, ten, host: m.host || "", v: parseInt(m.v || "1", 10) || 1, dnsId: rec.id };
}
async function listDealers(token, zoneId, zoneName) {
  const recs = await cfProv(token, "GET", `/zones/${zoneId}/dns_records?type=TXT&per_page=1000`);
  return (recs || []).filter((r) => r.name.startsWith("_dl-") && r.name.endsWith("." + zoneName)).map((r) => parseDealer(r, zoneName))
    .sort((a, b) => a.code.localeCompare(b.code));
}
async function getDealer(token, zoneId, zoneName, code) {
  const recs = await cfProv(token, "GET", `/zones/${zoneId}/dns_records?type=TXT&name=${encodeURIComponent(`_dl-${code}.${zoneName}`)}`);
  return recs.length ? parseDealer(recs[0], zoneName) : null;
}
const dealerLink = async (env, origin, d) => `${origin}/tao-cong-ty?k=${d.code}.${await dlSig(env, d.code, d.v)}`;
async function saveDealer(token, zoneId, zoneName, d) {
  return upsertDns(token, zoneId, { type: "TXT", name: `_dl-${d.code}.${zoneName}`, ttl: 300,
    content: `"dgp-dl v=${d.v} host=${d.host} ten=${encodeURIComponent(d.ten)}"`, comment: "digiplus đại lý tạo công ty" });
}
// Link ?k=<mã>.<chữ ký> còn hiệu lực? → trả đại lý, không thì null
async function dealerFromLink(env, token, zoneId, zoneName, k) {
  const m = String(k || "").trim().toLowerCase().match(/^([a-z0-9-]{1,30})\.([0-9a-f]{16})$/);
  if (!m || !dlCodeOk(m[1])) return null;
  const d = await getDealer(token, zoneId, zoneName, m[1]);
  if (!d) return null;
  return safeEqual(m[2], await dlSig(env, d.code, d.v)) ? d : null;
}

// Mã công ty (phần đầu tên miền) gợi ý từ tên: bỏ dấu + bỏ "công ty / TNHH / cổ phần..."
function slugFromName(name) {
  let s = String(name || "").toLowerCase().replace(/đ/g, "d").normalize("NFD").replace(/[̀-ͯ]/g, "");
  s = s.replace(/\b(cong ty|cty|ct|tnhh|co phan|cp|mtv|1tv|mot thanh vien|trach nhiem huu han|chi nhanh|cn)\b/g, " ");
  s = s.replace(/[^a-z0-9]+/g, "");
  return s.slice(0, 30);
}
// Tên đã có ai dùng chưa (bản ghi DNS bất kỳ, khách cũ có tunnel riêng, tên dành riêng)
async function slugProblem(token, accountId, zoneId, zoneName, slug) {
  if (!slugOkProv(slug) || slug.length > 40 || RESERVED_SLUG.has(slug) || slug.startsWith("ctl-")) return "Tên này không dùng được (chỉ chữ thường không dấu, số, gạch ngang).";
  const recs = await cfProv(token, "GET", `/zones/${zoneId}/dns_records?name=${encodeURIComponent(`${slug}.${zoneName}`)}`);
  if (recs.length) return `Tên "${slug}" đã có công ty dùng — chọn tên khác.`;
  const t = await cfProv(token, "GET", `/accounts/${accountId}/cfd_tunnel?is_deleted=false&name=digiplus-${slug}`);
  if (Array.isArray(t) && t.length) return `Tên "${slug}" đã có công ty dùng — chọn tên khác.`;
  return "";
}

// Trang điện thoại "Tạo công ty": { k, name, slug?, phone?, email?, useDevice?, usePhone?, check? }
async function handleTaoCongTy(request, env) {
  if (request.method !== "POST") return jsonRes({ error: "Chỉ nhận POST" }, 405);
  if (!env.CF_PROVISION_TOKEN || !env.LICENSE_PRIVATE_KEY) return jsonRes({ error: "Máy chủ Digiplus chưa cấu hình tạo công ty." }, 503);
  let b;
  try { b = await request.json(); } catch { return jsonRes({ error: "Dữ liệu gửi lên không hợp lệ" }, 400); }
  const token = env.CF_PROVISION_TOKEN;
  try {
    const { zoneName, zoneId, accountId } = await zoneAndAccount(token, env);
    const dl = await dealerFromLink(env, token, zoneId, zoneName, b && b.k);
    if (!dl) return jsonRes({ error: "Link tạo công ty không đúng hoặc đã bị khoá. Liên hệ Digiplus để lấy link mới.", badLink: true }, 403);
    const name = String(b.name || "").trim().replace(/\s+/g, " ").slice(0, 120);
    let slug = String(b.slug || "").trim().toLowerCase() || slugFromName(name);

    // Chỉ kiểm tra (gõ tên tới đâu báo tới đó): link còn hiệu lực + tên miền còn trống không
    if (b.check) {
      if (!slug) return jsonRes({ ok: true, dealer: dl.ten, slug: "", problem: "" });
      let problem = await slugProblem(token, accountId, zoneId, zoneName, slug), suggest = "";
      if (problem && !b.slug) {   // tên tự gợi ý bị trùng → thử thêm số
        for (let i = 2; i <= 4 && !suggest; i++) if (!(await slugProblem(token, accountId, zoneId, zoneName, slug + i))) suggest = slug + i;
      }
      return jsonRes({ ok: true, dealer: dl.ten, slug, problem, suggest, domain: `${slug}.${zoneName}` });
    }

    if (name.length < 2) return jsonRes({ error: "Nhập tên công ty." }, 400);
    const problem = await slugProblem(token, accountId, zoneId, zoneName, slug);
    if (problem) return jsonRes({ error: problem, field: "slug" }, 409);

    // Máy chủ của đại lý (chưa gán → máy chủ đầu tiên) + hạn mức tạo / ngày của mỗi link (chống lộ link)
    const tunnels = await allTunnels(token, accountId);
    const hosts = hostsOf(tunnels);
    const host = hosts.find((h) => h.name === (dl.host || env.DEFAULT_HOST)) || hosts[0];
    if (!host) return jsonRes({ error: "Chưa có máy chủ nhiều công ty nào. Liên hệ Digiplus." }, 503);
    const today = vnDate();
    const cnames = await cfProv(token, "GET", `/zones/${zoneId}/dns_records?type=CNAME&per_page=1000`);
    const madeToday = (cnames || []).filter((r) => { const c = parseComment(r.comment); return c.by === dl.code && c.d === today; }).length;
    const cap = parseInt(env.DL_DAILY_MAX || "20", 10) || 20;
    if (madeToday >= cap) return jsonRes({ error: `Link này đã tạo ${madeToday} công ty hôm nay (tối đa ${cap}). Liên hệ Digiplus.` }, 429);

    const useDevice = b.useDevice === false ? "0" : "1", usePhone = b.usePhone === false ? "0" : "1";
    // 1) Máy chủ tạo công ty (CSDL riêng + mật khẩu admin) → 2) ký dùng thử 30 ngày theo Mã máy → 3) trỏ tên miền về máy chủ
    const c = await hostCall(env, zoneName, host.name, "POST", "/tenants",
      { slug, name, env: { USE_DEVICE: useDevice, USE_PHONE: usePhone }, phone: b.phone, email: b.email });
    const days = parseInt(env.TRIAL_DAYS || "30", 10) || 30;
    const exp = vnDate(days);
    const key = await signTenantLicense(env, name, c.machine_id, exp, env.TRIAL_MAX);
    await hostCall(env, zoneName, host.name, "POST", `/tenants/${slug}/license`, { key });
    await cfProv(token, "POST", `/zones/${zoneId}/dns_records`, { type: "CNAME", name: `${slug}.${zoneName}`,
      content: `${host.tunnelId}.cfargotunnel.com`, proxied: true,
      comment: `${DNS_TAG} host=${host.name} mode=host dev=${useDevice} phone=${usePhone} by=${dl.code} d=${today}` });
    return jsonRes({ ok: true, name, slug, domain: `https://${slug}.${zoneName}`, admin_user: c.admin_user, admin_pass: c.admin_pass,
      exp, days, host: host.name });
  } catch (e) {
    return jsonRes({ error: e.message }, e.status && e.status < 600 ? e.status : 500);
  }
}

// Trang nội bộ "Máy chủ nhiều công ty" (/may-chu): mật khẩu cấp domain. b.action:
//   hosts | host-config {name,port} | tenants {host} | disable/enable {host,slug} | renew {host,slug,exp,max}
//   dl-save {code,ten,host} | dl-renew {code} | dl-lock {code}
async function handleMayChu(request, env) {
  const { b, res } = await readProvBody(request, env);
  if (res) return res;
  const token = env.CF_PROVISION_TOKEN;
  const origin = new URL(request.url).origin;
  try {
    const { zoneName, zoneId, accountId } = await zoneAndAccount(token, env);
    const a = String(b.action || "");
    const host = String(b.host || "").toLowerCase();
    const slug = String(b.slug || "").toLowerCase();

    if (a === "hosts") {
      const hosts = hostsOf(await allTunnels(token, accountId));
      for (const h of hosts) {
        try { const p = await hostCall(env, zoneName, h.name, "GET", "/ping"); Object.assign(h, { online: true, version: p.version, tenants: p.tenants, rss_mb: p.rss_mb }); }
        catch (e) { h.online = false; h.error = e.message; }
        delete h.tunnelId;
      }
      const dealers = await listDealers(token, zoneId, zoneName);
      for (const d of dealers) { d.link = await dealerLink(env, origin, d); delete d.dnsId; }
      return jsonRes({ ok: true, hosts, dealers, zone: zoneName });
    }

    if (a === "host-config") {   // tạo / lấy cấu hình máy chủ (config.txt cho bộ cài máy chủ)
      const name = String(b.name || "").toLowerCase().trim();
      if (!hostNameOk(name)) return jsonRes({ error: "Tên máy chủ: chữ thường không dấu + số, tối đa 20 ký tự (vd: vps1)." }, 400);
      const port = parseInt(b.port || "8600", 10) || 8600;
      if (port < 1024 || port > 65000) return jsonRes({ error: "Cổng phải trong khoảng 1024–65000." }, 400);
      let t = (await allTunnels(token, accountId)).find((x) => x.name === HOST_TUN + name);
      if (!t) t = await cfProv(token, "POST", `/accounts/${accountId}/cfd_tunnel`, { name: HOST_TUN + name, config_src: "cloudflare" });
      const tunnelToken = await cfProv(token, "GET", `/accounts/${accountId}/cfd_tunnel/${t.id}/token`);
      // Nhận MỌI tên miền của zone: tên miền nào trỏ (CNAME) về tunnel này thì tới máy chủ này
      await cfProv(token, "PUT", `/accounts/${accountId}/cfd_tunnel/${t.id}/configurations`, {
        config: { ingress: [{ hostname: `*.${zoneName}`, service: `http://localhost:${port}` }, { service: "http_status:404" }] },
      });
      await upsertDns(token, zoneId, { type: "CNAME", name: `ctl-${name}.${zoneName}`, content: `${t.id}.cfargotunnel.com`,
        proxied: true, comment: `digiplus-host port=${port}` });
      const configTxt = `PORT=${port}\nMULTI_TENANT=1\nHOST_NAME=${name}\nHOST_DOMAIN=${zoneName}\nHOST_TOKEN=${await hostToken(env, name)}\nTUNNEL_TOKEN=${tunnelToken}\n`;
      if (b.plain) return new Response(configTxt, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
      return jsonRes({ ok: true, name, port, ctl: `https://ctl-${name}.${zoneName}`, configTxt });
    }

    if (a === "tenants") {
      if (!hostNameOk(host)) return jsonRes({ error: "Thiếu tên máy chủ" }, 400);
      const d = await hostCall(env, zoneName, host, "GET", "/tenants");
      const cnames = await cfProv(token, "GET", `/zones/${zoneId}/dns_records?type=CNAME&per_page=1000`);
      const meta = new Map((cnames || []).map((r) => [r.name, parseComment(r.comment)]));
      for (const t of d.tenants || []) {
        const m = meta.get(`${t.slug}.${zoneName}`);
        t.domain = `https://${t.slug}.${zoneName}`;
        t.dns = !!m; t.by = (m && m.by) || "";
      }
      return jsonRes({ ok: true, tenants: d.tenants || [] });
    }

    if (a === "disable" || a === "enable") {
      if (!hostNameOk(host) || !slugOkProv(slug)) return jsonRes({ error: "Thiếu máy chủ / công ty" }, 400);
      return jsonRes(await hostCall(env, zoneName, host, "POST", `/tenants/${slug}/${a}`));
    }

    if (a === "renew") {   // gia hạn / cấp bản quyền chính thức: exp rỗng = vĩnh viễn
      if (!hostNameOk(host) || !slugOkProv(slug)) return jsonRes({ error: "Thiếu máy chủ / công ty" }, 400);
      if (!env.LICENSE_PRIVATE_KEY) return jsonRes({ error: "Chưa cấu hình LICENSE_PRIVATE_KEY" }, 503);
      const exp = b.exp ? String(b.exp).slice(0, 10) : null;
      if (exp && !/^\d{4}-\d{2}-\d{2}$/.test(exp)) return jsonRes({ error: "Hạn dạng YYYY-MM-DD" }, 400);
      const t = await hostCall(env, zoneName, host, "GET", `/tenants/${slug}`);
      const key = await signTenantLicense(env, t.name || slug, t.machine_id, exp, b.max);
      return jsonRes(await hostCall(env, zoneName, host, "POST", `/tenants/${slug}/license`, { key }));
    }

    if (a.startsWith("dl-")) {
      const code = String(b.code || "").toLowerCase().trim();
      if (!dlCodeOk(code)) return jsonRes({ error: "Mã đại lý: chữ thường không dấu, số, gạch ngang (vd: skytech)." }, 400);
      const cur = await getDealer(token, zoneId, zoneName, code);
      if (a === "dl-lock") {
        if (cur) await cfProv(token, "DELETE", `/zones/${zoneId}/dns_records/${cur.dnsId}`);
        return jsonRes({ ok: true });
      }
      const d = { code, ten: cur ? cur.ten : code, host: cur ? cur.host : "", v: cur ? cur.v : 1 };
      if (a === "dl-save") {
        d.ten = String(b.ten || d.ten).trim().slice(0, 60) || code;
        d.host = hostNameOk(String(b.host || "")) ? String(b.host) : d.host;
      } else if (a === "dl-renew") {
        if (!cur) return jsonRes({ error: "Chưa có đại lý này" }, 404);
        d.v = cur.v + 1;   // link cũ hết hiệu lực
      } else return jsonRes({ error: "Thao tác không hợp lệ" }, 400);
      await saveDealer(token, zoneId, zoneName, d);
      return jsonRes({ ok: true, ...d, link: await dealerLink(env, origin, d) });
    }
    return jsonRes({ error: "Thao tác không hợp lệ" }, 400);
  } catch (e) {
    return jsonRes({ error: e.message }, e.status && e.status < 600 ? e.status : 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/cai-linux" || url.pathname === "/cai-linux.sh") return handleLinuxScript();

    // API cấp license / key máy (ký số phía server)
    if (url.pathname === "/api/gen-license") return handleSign(request, env, "license");
    if (url.pathname === "/api/gen-device") return handleSign(request, env, "device");
    if (url.pathname === "/api/tao-domain") return handleProvision(request, env);
    if (url.pathname === "/api/cai-config") return handleInstallConfig(request, env);   // đại lý tự cài: lấy config bằng tên miền, không mật khẩu
    if (url.pathname === "/api/ds-khach") return handleListCustomers(request, env);
    if (url.pathname === "/api/noibo") return handleNoiBo(request, env);
    if (url.pathname === "/api/tao-cong-ty") return handleTaoCongTy(request, env);   // trang điện thoại: tạo công ty trên máy chủ nhiều công ty
    if (url.pathname === "/api/may-chu") return handleMayChu(request, env);         // nội bộ: máy chủ, công ty, link đại lý
    if (url.pathname === "/api/base-zip") return handleBaseZip(request, env);
    // Link TẢI BỘ CÀI LAN có thương hiệu (proxy từ GitHub Release → tải thẳng về)
    // Link cũ /tai-ban-lan (đã phát ra ngoài, trang cũ còn nằm trong bộ nhớ trình duyệt) giờ cũng trả Setup.exe;
    // file zip bản LAN chỉ còn ở /tai-ban-lan.zip để dự phòng.
    if (url.pathname === "/tai-ban-lan.zip") return handleLanZip(request, env);
    if (url.pathname === "/tai-bo-cai.exe") return handleSetupExeRaw(request, env);
    if (url.pathname === "/tai-ban-lan" || url.pathname === "/tai-bo-cai" || url.pathname === "/tai-bo-cai.zip") return handleSetupExe(request, env);
    // Tool phá quản trị máy chấm công (bộ cài riêng)
    if (url.pathname === "/tai-tool-pha-quan-tri" || url.pathname === "/tai-tool-pha-quan-tri.exe") return handleToolPhaQuanTri(request, env);

    const res = await env.ASSETS.fetch(request);

    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html")) return res;   // chỉ xử lý trang HTML
    // Trang nội bộ (cấp license / cấp domain): KHÔNG tiêm quảng cáo/đại lý, giữ nguyên
    if (url.pathname.startsWith("/cap-license") || url.pathname.startsWith("/tao-domain") || url.pathname.startsWith("/noibo") ||
      url.pathname.startsWith("/may-chu") || url.pathname.startsWith("/tao-cong-ty")) return res;

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
