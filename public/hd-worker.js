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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // API cấp license / key máy (ký số phía server)
    if (url.pathname === "/api/gen-license") return handleSign(request, env, "license");
    if (url.pathname === "/api/gen-device") return handleSign(request, env, "device");

    const res = await env.ASSETS.fetch(request);

    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html")) return res;   // chỉ xử lý trang HTML
    // Trang cấp license: KHÔNG tiêm quảng cáo/đại lý, giữ nguyên
    if (url.pathname.startsWith("/cap-license")) return res;

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
