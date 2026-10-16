# Phân hệ QUẢN LÝ SUẤT ĂN

Đếm đúng số suất ăn 3 ca (Trưa · Chiều · Đêm) bằng cách đối chiếu nhiều nguồn, HR chốt số thực tế.
Phân hệ **độc lập** với tính công: chỉ ĐỌC lượt quẹt máy chấm công (`device_punches`) và đăng ký làm thêm (`ot_registrations`), ghi vào các bảng `meal_*` riêng.

## Bật / tắt
- Công tắc `meal_enabled` ở **Cài đặt › Kiểu chấm công** (mở mục ra, kéo xuống) — **chỉ tài khoản tổng (sadmin) bật được**, mặc định **TẮT**.
- **Tắt** = app chạy y như cũ: menu "Suất ăn" ẩn, tab Suất ăn trên app nhân viên ẩn, `/api/meal/*` và `/api/admin/meal/*` trả 403, trang `/bep` + `/suatan/*` trả 404, bảng `meal_*` để trống. Dữ liệu đã nhập vẫn giữ khi tắt.
- Quản lý (không phải admin) muốn dùng cần được tích quyền **"Quản lý suất ăn"** (`meal`) ở hồ sơ nhân viên.

## Quy tắc đối chiếu
| Ca | Số tham chiếu | Số để chốt |
|---|---|---|
| Trưa, Đêm | **Lượt chấm hợp lệ** = số NGƯỜI có lượt quẹt máy chấm công trong khung giờ chốt của ca (mỗi người 1 suất/ca; quẹt ngoài khung bị loại; lượt thêm tay `TAY_*` và chấm điện thoại `DT_*` không tính) | Số **trưởng bộ phận đăng ký** |
| Chiều (tối) | **Không đếm chấm công.** Lấy số người có **đăng ký làm thêm** (`ot_registrations`, phút > 0) cộng theo bộ phận trong ngày | Số trưởng bộ phận đăng ký |

- Giờ chốt cấu hình từng ca (Suất ăn › Cấu hình); khung qua nửa đêm được (Đêm 23:00 → 02:00 tính cho ngày bắt đầu).
- Chênh lệch = trưởng BP đăng ký − số tham chiếu. Tổng suất = số trưởng BP đăng ký (chưa đăng ký tính 0, hiện cờ "chưa đăng ký").
- HR **chốt** số của ngày + ca → khoá sửa (trưởng BP và HR) cho tới khi **mở lại**.

## Ai làm gì
- **HR** (`/admin` › Suất ăn): Đối chiếu & chốt (nhập hộ / sửa số của mọi bộ phận) · Thực đơn các bữa · Cấu hình (3 ca + giờ chốt, chỉ định trưởng bộ phận, chọn máy chấm công tính suất ăn, mã màn hình bếp).
- **Trưởng bộ phận**: app nhân viên › tab **Suất ăn** › "Đăng ký suất ăn của bộ phận" (chỉ bộ phận mình + bộ phận con, ngày hôm nay trở đi). Quản lý dùng menu "Suất ăn của tôi" trong /admin.
- **Nhân viên**: app › tab **Suất ăn** › chọn món cho từng bữa trước **hạn chọn món** (app ghi "chọn món trước HH:MM"). HR đặt hạn ở Cấu hình › từng ca › **Khoá chọn món**: *Khi bắt đầu giờ ăn* (mặc định, như cũ) · *Trước giờ ăn N tiếng* (lẻ được, tối đa 48) · *Lúc giờ cố định* (muộn hơn giờ bắt đầu = của hôm trước, VD bữa trưa khoá 20:00 tối hôm trước) — để bếp kịp chuẩn bị.
- **Nhà bếp**: mở `/bep` rồi gõ **mã 6 ký tự** (hoặc liên kết ngắn `/bep/MÃ`) — lấy ở Cấu hình › Màn hình bếp, không cần đăng nhập; dò mã sai quá 10 lần/5 phút bị chặn theo IP. Màn hình hỏi máy chủ mỗi 2 giây; mỗi lượt quẹt trong giờ ăn hiện **tên NV + món đã chọn** (cảnh báo nếu quẹt lần thứ 2 trong bữa). Quẹt nhanh quá chưa kịp nhìn: **bấm một lượt ở cột "Lượt quẹt gần đây"** (hoặc phím ↓/↑) để hiện lại to ở giữa; 10 giây sau tự về lượt mới nhất (Esc / nút "Về lượt mới nhất" để về ngay). Liên kết bếp in theo **tên miền** điền ở Cấu hình › Màn hình bếp (để trống = theo địa chỉ đang mở). Đổi mã = mã cũ vô hiệu.

## Bảng dữ liệu (CREATE TABLE IF NOT EXISTS trong `db.js › initSchema`)
`meal_shifts` (3 ca + giờ chốt, tạo khi bật lần đầu) · `meal_registrations` (BP, ngày, ca, số, ghi chú) · `meal_closings` (đã chốt) · `meal_dept_heads` (trưởng BP) · `meal_menu` (món theo ngày + ca) · `meal_orders` (món NV đã chọn).
Cài đặt kèm theo: `meal_enabled`, `meal_serials` (máy chấm công tính suất ăn, rỗng = mọi máy thật), `meal_kitchen_key`.

## File
`server/meal-rules.js` (quy tắc thuần, test không cần DB) · `server/meal.js` (CSDL + công tắc + `mealAllowed`) · `server/routes/admin/meal.js` (HR) · `server/routes/meal.js` (NV / trưởng BP / màn hình bếp) · `public/suatan/*` (giao diện).

## Kiểm chứng "không đụng tính công"
- `test/meal-rules.test.mjs`, `test/meal.test.mjs` (gồm test "công tắc tắt = tính như cũ").
- `node tools/prove-meal-safe.mjs` — so bảng công của bản `main` và bản nhánh trên hàng chục nghìn ca ngẫu nhiên (công tắc tắt / bật + chạy xen thao tác suất ăn): số dòng khác nhau phải = 0.
