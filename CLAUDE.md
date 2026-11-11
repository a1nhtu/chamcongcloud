# HƯỚNG DẪN CLAUDE — Digiplus Chấm Công (repo chamcongcloud)

## Xưng hô
- Trả lời bằng **tiếng Việt**. Gọi chủ dự án là **"Anh"**, tự xưng **"em"**.
- Thương hiệu: **Digiplus** (máy chấm công / chấm công cloud).

## Dự án là gì
App chấm công bằng điện thoại (ảnh + GPS) + web quản lý + nhận dữ liệu máy chấm công (ZKTeco ADMS / TCP, Hikvision, Union, máy AI)
+ tính lương, nhân sự, suất ăn. Node.js 24 (ES module) + SQLite tích hợp (`node:sqlite`), Express, giao diện không build.
Cổng mặc định trong code là 8080; bản cài của khách và máy Anh chạy **8686** (`PORT` trong `config.txt`).

- `server/` — backend. Logic tính công nằm ở `attendance-calc.js`, `day-metrics.js`, `shift-resolver.js`, `payroll-calc.js`.
- `server/routes/` — API (`admin/*` là các submodule quản trị, `reports.js` báo cáo, `iclock.js` nhận dữ liệu máy chấm công).
- `public/` — giao diện web (HTML/JS/CSS thuần, không build).
- `test/*.test.mjs` — test dùng `node:test`.
- `docs/CAU-TRUC-CODE.md` — bản đồ code chi tiết (mở khi cần tra, không cần đọc hết).

## Lệnh
```
npm install
npm test        # BẮT BUỘC chạy và pass trước khi commit / tạo PR
npm start       # chạy app (cần thư mục data/, không có trong repo)
```

## ⚠️ QUY TẮC BẮT BUỘC
1. **Nhánh `main` là kênh phát hành**: máy khách tự cập nhật khi `version` trong `package.json` trên GitHub cao hơn bản đang chạy
   (`server/update.js`); CI chỉ đóng gói bộ cài khi `package.json` đổi.
   - **Phiên trên máy Anh (local):** việc nhỏ sửa thẳng `main`; việc lớn làm nhánh / worktree, test xong thì tự gộp. Mỗi lần có đổi code app:
     `npm test` pass → tăng `version` → commit → push `main` (không hỏi lại). Số cuối của version chỉ chạy 0 → 10, hết 10 thì tăng số giữa
     (1.33.10 → 1.34.0). Đổi số bằng `sed` trong Bash — không dùng `Set-Content` của PowerShell 5.1 (thêm BOM, hỏng dấu tiếng Việt).
   - **Phiên cloud (claude.ai/code):** KHÔNG đổi `version`, KHÔNG commit vào `main` — làm nhánh riêng và tạo Pull Request để Anh duyệt.
2. **KHÔNG sửa `server/update.js`, `CapNhat-ThuCong.bat`, `server/license.js`** trừ khi Anh yêu cầu rõ.
3. **KHÔNG commit dữ liệu/bí mật**: `data/`, `*.db`, `tools/cf.env`, `tools/keys/`, `PASS_*`, `dist-khach/`, `uploads/`.
   Chỉ `git add` từng file cụ thể, không dùng `git add -A`.
4. Giữ nguyên hành vi cũ khi không được yêu cầu đổi. Sửa logic tính công/lương thì **phải thêm/cập nhật test**.
   Tính năng riêng của một khách → để sau công tắc, **mặc định TẮT** (tắt = chạy y như cũ), không tách bản riêng.
5. Quy tắc tính công chưa rõ ở mốc biên (đúng 15 phút, đúng giờ giao ca…) → **hỏi Anh trước** khi sửa công thức hay tính lại công.
6. Môi trường cloud **không có** máy chấm công thật, database khách, Cloudflare Tunnel — đừng cố chạy/kiểm thử các phần đó;
   ghi rõ trong PR những gì chưa kiểm được để Anh test trên máy thật.

## Khi tạo Pull Request (phiên cloud)
- Mô tả bằng tiếng Việt: sửa gì, vì sao, file nào, kết quả `npm test`, phần nào cần Anh test tay.
- Diff gọn, chỉ đụng đúng phần được giao.
