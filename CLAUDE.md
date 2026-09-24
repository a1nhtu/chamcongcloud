# HƯỚNG DẪN CLAUDE — Digiplus Chấm Công (repo chamcongcloud)

## Xưng hô
- Trả lời bằng **tiếng Việt**. Gọi chủ dự án là **"Anh"**, tự xưng **"em"**.
- Thương hiệu: **Digiplus** (máy chấm công / chấm công cloud).

## Dự án là gì
App chấm công bằng điện thoại (ảnh + GPS) + web quản lý + nhận log máy chấm công ZKTeco (ADMS).
Node.js (ES module) + SQLite, Express. Chạy port 8686.

- `server/` — backend. Logic tính công nằm ở `attendance-calc.js`, `day-metrics.js`, `shift-resolver.js`, `payroll-calc.js`.
- `server/routes/` — API (`admin/*` là các submodule quản trị, `reports.js` báo cáo, `iclock.js` nhận dữ liệu máy chấm công).
- `public/` — giao diện web (HTML/JS/CSS thuần, không build).
- `test/*.test.mjs` — test dùng `node:test`.

## Lệnh
```
npm install
npm test        # BẮT BUỘC chạy và pass trước khi tạo PR
npm start       # chạy app (cần thư mục data/, không có trong repo)
```

## ⚠️ QUY TẮC BẮT BUỘC
1. **KHÔNG tự đổi `version` trong `package.json`.** Nhánh `main` là kênh phát hành: máy khách tự cập nhật
   khi version trên GitHub cao hơn bản đang chạy (`server/update.js`). Chỉ Anh quyết định lên version.
2. **KHÔNG sửa `server/update.js`, `CapNhat-ThuCong.bat`, `server/license.js`** trừ khi Anh yêu cầu rõ.
3. **KHÔNG commit thẳng vào `main`** — luôn làm trên nhánh riêng và tạo Pull Request để Anh duyệt.
4. **KHÔNG commit dữ liệu/bí mật**: `data/`, `*.db`, `tools/cf.env`, `tools/keys/`, `PASS_*`, `dist-khach/`, `uploads/`.
   Chỉ `git add` từng file cụ thể, không dùng `git add -A`.
5. Giữ nguyên hành vi cũ khi không được yêu cầu đổi. Sửa logic tính công/lương thì **phải thêm/cập nhật test**.
6. Môi trường cloud **không có** máy chấm công thật, database khách, Cloudflare Tunnel — đừng cố chạy/kiểm thử các phần đó;
   ghi rõ trong PR những gì chưa kiểm được để Anh test trên máy thật.

## Khi tạo Pull Request
- Mô tả bằng tiếng Việt: sửa gì, vì sao, file nào, kết quả `npm test`, phần nào cần Anh test tay.
- Diff gọn, chỉ đụng đúng phần được giao.
