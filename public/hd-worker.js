/* ============================================================
   TRANG HƯỚNG DẪN — Cloudflare Pages Worker (chạy trên máy chủ)
   File này được deploy thành _worker.js. Nó đọc mã đại lý trên link
   (?dl=ma-dai-ly) rồi thay TÊN + HOTLINE + ẢNH XEM TRƯỚC trước khi trả
   trang về — nên cả thẻ preview khi share Zalo/Messenger lẫn nội dung
   trang đều hiện đúng của đại lý (ẩn hết Digiplus).
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const res = await env.ASSETS.fetch(request);

    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html")) return res;   // chỉ xử lý trang HTML

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

    return new HTMLRewriter()
      .on("title", { element(e) { e.setInnerContent(title); } })
      .on("head", { element(e) { e.append(injected, { html: true }); } })
      .transform(res);
  }
};
