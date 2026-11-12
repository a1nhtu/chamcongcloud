# Digiplus Chấm Công

Phần mềm chấm công cho doanh nghiệp Việt Nam của **Digiplus**: nhân viên chấm bằng **điện thoại** (ảnh + GPS) hoặc **máy chấm công**,
quản lý xem công, phân ca, tính lương và xuất báo cáo trên trình duyệt. Dữ liệu nằm trên máy của chính công ty (SQLite), không phụ thuộc
dịch vụ bên ngoài.

## Làm được gì

- **Chấm công điện thoại** (PWA, cài về màn hình như app): chụp ảnh đóng dấu giờ + địa chỉ, kiểm tra phạm vi chi nhánh, khoá thiết bị chống chấm hộ.
- **Máy chấm công**: ZKTeco (tự đẩy ADMS hoặc kết nối TCP/IP), Hikvision, Union / Virdi, máy AI — nhận lượt chấm, đồng bộ nhân viên /
  vân tay / khuôn mặt giữa các máy, mở cửa từ xa, hẹn giờ khởi động lại.
- **Ca & phân ca**: ca ngày / ca đêm / ca gãy, lịch trình xoay ca, phân ca theo ngày hoặc khoảng ngày, nhập - xuất Excel, nhân viên tự đăng ký ca.
- **Tính công**: đi trễ, về sớm, tăng ca (ngày thường / ngày nghỉ / lễ), làm bù, chế độ ưu đãi (thai sản, nuôi con nhỏ), đơn từ và phép năm,
  sửa công tay có nhật ký.
- **Báo cáo**: bảng công ngang, ký hiệu, tổng hợp, chi tiết, đi trễ, tăng ca, giờ công… xem trước và xuất Excel; mẫu báo cáo riêng.
- **Lương**: bảng lương cơ bản; phân hệ Tiền lương nâng cao (thành phần lương, bảo hiểm, thuế TNCN, phiếu lương trên app) bật bằng công tắc.
- **Nhân sự** (hồ sơ, hợp đồng, thuyên chuyển, nghỉ việc) và **Suất ăn** (đăng ký ăn, màn hình bếp, định lượng nguyên liệu) — bật bằng công tắc.
- **Vận hành**: phân quyền chi tiết, nhật ký thao tác, sao lưu tự động, chuyển máy bằng 1 file, tự cập nhật khi có bản mới,
  chuyển dữ liệu từ Wise Eye / Ronald Jack, máy chủ nhiều công ty.

## Cài cho khách

Dùng bộ cài đóng sẵn (GitHub Release `base` của repo này, CI tự đóng mỗi lần lên bản):

| Bộ cài | Dùng khi |
|---|---|
| `DigiplusChamCong-Setup.exe` (hoặc `-Setup.zip`) | Cài trên máy tính Windows của khách, kiểu Next – Next |
| `DigiplusChamCong-lan.zip` | Chỉ dùng trong mạng nội bộ |
| `DigiplusChamCong-base.zip` | Bản gốc có tunnel, dùng để dựng bản có tên miền riêng cho khách |
| `DigiplusChamCong-linux.tar.gz` | Máy chủ Linux (cài 1 lệnh, chạy bằng systemd) |

Hướng dẫn cài đặt và sử dụng: thư mục `HuongDan/` (đăng tại trang hướng dẫn của Digiplus). Phần mềm cần **kích hoạt bản quyền** theo mã máy.
Liên hệ Digiplus: **0372 669 992**.

## Cho người lập trình

Yêu cầu: **Node.js 22.13 trở lên** (bộ cài đóng kèm Node 24; Node 20 không chạy được vì app dùng `node:sqlite`).

```bash
npm install
npm test     # bắt buộc đạt trước khi đẩy mã
npm start    # http://localhost:8080  (đổi cổng: PORT=8686 npm start)
```

- Lần đầu chạy tự tạo `data/digiplus.db`, tài khoản `admin` / `admin123` (đổi ngay), 4 bộ phận và 4 ca mẫu.
- Điện thoại trong mạng nội bộ cần HTTPS để dùng camera + GPS: app tự tạo chứng chỉ tự ký và mở thêm cổng `8444`.
- Biến môi trường: `PORT`, `HTTPS_PORT`, `DB_PATH` (đổi nơi đặt CSDL — bản sao lưu nằm cạnh file CSDL), `MULTI_TENANT=1` (máy chủ nhiều công ty).
- Nhánh `main` là kênh phát hành: máy khách tự cập nhật khi `version` trong `package.json` tăng. Quy tắc làm việc: xem `CLAUDE.md`.

```
server/        backend Express + SQLite (tính công: attendance-calc.js, day-metrics.js, shift-resolver.js; lương: payroll-calc.js, pay-rules.js)
server/routes/ API (admin/*, reports, iclock = máy chấm công…)
public/        giao diện web, không cần build (trang quản lý: public/admin-parts/*.js, máy chủ ghép thành /admin.js)
test/          test bằng node:test
tools/         đóng gói bộ cài, cấp bản quyền, giả lập máy
HuongDan/      trang hướng dẫn cho khách
docs/          tài liệu kỹ thuật (docs/CAU-TRUC-CODE.md là bản đồ mã)
```

© Digiplus
