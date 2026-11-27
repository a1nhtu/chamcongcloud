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
- **Cách đăng ký** (Cấu hình › đầu trang, công tắc **"Nhân viên tự chọn món trên app"**, setting `meal_self_order`, mặc định BẬT = như cũ). TẮT = công ty chỉ dùng quy trình **trưởng bộ phận báo số → HR đối chiếu & chốt**: nhân viên thường không thấy tab Suất ăn (chỉ trưởng BP thấy để nhập số), API chọn món trả 403, màn hình bếp hiện tên + "✔ Có suất ăn" thay cho "chưa chọn món"; HR vẫn chọn món hộ / điều chỉnh số suất được.
- **Nhân viên**: app › tab **Suất ăn** › chọn món cho từng bữa trước **hạn chọn món** (app ghi "chọn món trước HH:MM"). HR đặt hạn ở Cấu hình › từng ca › **Khoá chọn món**: *Khi bắt đầu giờ ăn* (mặc định, như cũ) · *Trước giờ ăn N tiếng* (lẻ được, tối đa 48) · *Lúc giờ cố định* (muộn hơn giờ bắt đầu = của hôm trước, VD bữa trưa khoá 20:00 tối hôm trước) — để bếp kịp chuẩn bị.
- **Nhà bếp**: mở `/bep` rồi gõ **mã 6 ký tự** (hoặc liên kết ngắn `/bep/MÃ`) — lấy ở Cấu hình › Màn hình bếp, không cần đăng nhập; dò mã sai quá 10 lần/5 phút bị chặn theo IP. Màn hình hỏi máy chủ mỗi 2 giây; mỗi lượt quẹt trong giờ ăn hiện **tên NV + món đã chọn** (cảnh báo nếu quẹt lần thứ 2 trong bữa). Quẹt nhanh quá chưa kịp nhìn: **bấm một lượt ở cột "Lượt quẹt gần đây"** (hoặc phím ↓/↑) để hiện lại to ở giữa; 10 giây sau tự về lượt mới nhất (Esc / nút "Về lượt mới nhất" để về ngay). Liên kết bếp in theo **tên miền** điền ở Cấu hình › Màn hình bếp (để trống = theo địa chỉ đang mở). Đổi mã = mã cũ vô hiệu.
- **Tổng hợp & điều chỉnh suất ăn** (menu Suất ăn › 📋 Tổng hợp & điều chỉnh suất ăn — vừa xem số vừa sửa số suất): chọn ngày → mỗi bữa 1 khung **thu gọn / mở rộng** được (bấm tiêu đề; nút ⊞ Mở hết / ⊟ Thu gọn hết; bấm ô tổng trên cùng để nhảy tới bữa; nhớ trên máy), bảng theo MÓN: *NV tự chọn* · *HR chọn hộ* · *HR điều chỉnh (+/−)* · **Tổng phải nấu** · *Thực tế đã quẹt* (người quẹt máy chấm công trong giờ ăn), kèm dòng *Không chọn món (suất mặc định)* = số trưởng BP đăng ký vượt số người đã chọn món; đầu bảng ghi hạn chọn món (đã khoá / còn mở), số trưởng BP đăng ký, HR đã chốt chưa. **HR chỉnh tay**: bấm ô ✎ ở cột HR điều chỉnh để thêm/bớt suất của món (khách, người đột xuất…); nút **➕ Chọn món hộ nhân viên** (quên đăng ký, điện thoại hỏng / mất mạng) — không bị hạn chọn món chặn, màn hình bếp hiện món đó khi NV quẹt; NV tự đổi lại trên app thì mất dấu "HR chọn hộ". Mỗi lần chỉnh **bắt buộc ghi lý do** và được **lưu vết** (bảng meal_adjust_log: ai, lúc nào, cũ → mới, lý do) — xem ở cuối trang. **⬇ Xuất Excel** (tối đa 62 ngày, có nút "Cả tháng này"): 3 sheet Tổng hợp theo ngày/bữa/món · Chi tiết từng NV · Lịch sử chỉnh sửa.

## Máy bếp tự từ chối (v1.40.6 — Cấu hình › mục 5, chỉ máy ZKTeco ADMS có kiểm soát ra vào, VD SenseFace 4B)
Hai công tắc, mặc định **TẮT** (tắt = máy chạy y như cũ). Chỉ áp dụng cho máy ADMS đã tích ở danh sách "Máy bếp".
- **Quét ngoài giờ ăn → máy báo thất bại** (`meal_guard_window`): phần mềm gửi khung giờ ăn (các ca ở mục 1, ca qua đêm tách đôi, khung chồng nhau gộp) xuống máy thành `AccTimeZone` UID 46–48 + `AccGroup ID=1 TZ=46;47;48`. Máy chỉ giữ 3 khung/nhóm → có > 3 khung thì phần mềm **tự xoay** (luôn gửi 3 khung hiện tại / sắp tới). Người quản trị trên máy được gán TZ riêng UID 45 (cả ngày) để vẫn vào menu máy. Tắt = trả nhóm 1 về `TZ=1;0;0`.
- **Mỗi bữa chỉ quét thành công 1 lần trên tất cả máy bếp** (`meal_guard_once`): quét được ở 1 máy → phần mềm gửi `USERINFO TZ=0001000000000000` (TZ riêng rỗng = máy báo "Khoảng thời gian không hợp lệ") cho người đó xuống **mọi** máy bếp, hết bữa thì gửi lại TZ thường. Lệnh khoá được ưu tiên đầu hàng đợi; máy bếp hỏi lệnh 3 giây/lần (`Delay=3`, máy nhận khi bắt tay lại → khởi động lại máy 1 lần). Khoá chưa kịp xuống máy mà đã hết bữa thì huỷ lệnh. Quản trị máy (privilege > 0) không bị khoá.
- Giới hạn: máy chỉ chấm công (VD NF24HA) bỏ qua TZ; giữa 2 lần hỏi lệnh (≈ 3 giây) người đó vẫn quét được ở máy khác; máy mất mạng thì chưa nhận khoá (báo cáo vẫn chỉ tính 1 suất).
- Dữ liệu: `meal_guard_locks` (khoá theo máy + Số ID + ngày + ca, `released_at` khi mở) · `meal_guard_state` (khung đã gửi từng máy) · setting `meal_guard_serials`. Lệnh mang `mkind='mguard'`, dọn sau 7 ngày.
- Mã: `server/meal-guard.js` (gắn vào lõi qua móc chung `setUserTzResolver` / `setPunchListener` / `setPollDelayResolver` ở `device-sync.js` — file lõi không nhắc tới suất ăn) · test `test/may-bep-tu-tu-choi.test.mjs`.
- **Nhân viên nghỉ việc / đã khoá → máy bếp báo thất bại** (v1.40.9, `meal_guard_off`, mặc định TẮT): NV `active = 0` hoặc đã tới `leave_date` bị gửi TZ rỗng như trên xuống mọi máy bếp (Số ID khớp theo `device_pin`, mã NV, `device_users.code`; Số ID đang thuộc NV còn làm thì bỏ). Mở khoá / đi làm lại / tắt công tắc → gửi lại TZ thường. Quản trị máy không chặn. Bảng `meal_guard_off(serial, pin, since)`; `userTzFor` trả TZ rỗng nếu còn dòng ở đây (đẩy lại NV vẫn giữ chặn).

## Máy không dùng tính công (v1.40.9 — Thiết bị › máy › ⋯ Thêm › "🍽 Không dùng máy này để tính công")
`push_devices.no_att = 1`: lượt quẹt máy đó vẫn lưu ở `device_punches` (Xem quẹt, báo cáo suất ăn) nhưng **không vào bảng công**. Mọi chỗ ĐỌC lượt quẹt để tính công dùng VIEW `att_punches` (= `device_punches` trừ máy `no_att`); `ingestAttlog` của máy `no_att` không cộng ngày cần tính lại, và chống trùng `punch_dedup_min` chỉ so lượt CÙNG LOẠI máy (lượt ăn 17:25 không xoá lượt ra cổng 17:20 / 17:30). Ngày cũ: bấm "Tính lại công". Mặc định 0 = như cũ.

## Bữa tăng ca + báo cáo Chi tiết lượt ăn (v1.40.9)
- Ca có `meal_shifts.ot_need_min > 0` (Cấu hình › ô "Bữa tăng ca … từ N giờ") = bữa tăng ca: xét **tăng ca thực tế** (`ot_raw_min` ?? `ot_min`, gộp các dòng công) của ngày công chứa giờ ăn (`pickAttDay`: giờ vào gần nhất ≤ giờ ăn trong 20 tiếng → bữa 04:00 thuộc ca đêm vào từ tối trước). Đủ → "Đủ điều kiện"; chưa chấm ra / chưa có dữ liệu công → "Chờ xác minh" (tính công xong tự đổi); đã ra mà thiếu, hoặc quá 12 tiếng sau bữa → "Không đủ điều kiện". Quy tắc thuần `otMealStatus` / `pickAttDay` / `mergeAttRows` ở `meal-rules.js`.
- Báo cáo › tab 5 "Chi tiết lượt ăn" (`server/meal-scans.js`, Excel luồng `server/meal-scans-xlsx.js`, API `GET /admin/meal/rpt/scans`, `/scans.xlsx`): mỗi lượt quét máy chấm ăn (`meal_serials`) trong giờ ăn 1 dòng — mã, tên, bộ phận, máy + số máy, hình thức, bữa, đơn giá, tăng ca, trạng thái, ngày vào làm / nghỉ việc, quốc tịch + loại NV (`hr_profiles`). Mỗi người 1 suất/bữa: lượt sau = "Quẹt lặp" (không tính tiền); NV khoá / đã nghỉ = "NV nghỉ việc / bị khoá"; Số ID không khớp = "Chưa khớp nhân viên". Lọc bộ phận / bữa / trạng thái / tìm không dấu; tối đa 31 ngày; giao diện 500 dòng/trang. Đơn giá: setting `meal_unit_price` (`GET/PUT /admin/meal/price`).
- Test: `test/bep-bao-cao.test.mjs`.

## Bảng dữ liệu (CREATE TABLE IF NOT EXISTS trong `db.js › initSchema`)
`meal_shifts` (3 ca + giờ chốt, tạo khi bật lần đầu) · `meal_registrations` (BP, ngày, ca, số, ghi chú) · `meal_closings` (đã chốt) · `meal_dept_heads` (trưởng BP) · `meal_menu` (món theo ngày + ca) · `meal_orders` (món NV đã chọn).
Cài đặt kèm theo: `meal_enabled`, `meal_serials` (máy chấm công tính suất ăn, rỗng = mọi máy thật), `meal_kitchen_key`.

## File
`server/meal-rules.js` (quy tắc thuần, test không cần DB) · `server/meal.js` (CSDL + công tắc + `mealAllowed`) · `server/routes/admin/meal.js` (HR) · `server/routes/meal.js` (NV / trưởng BP / màn hình bếp) · `public/suatan/*` (giao diện).

## Kiểm chứng "không đụng tính công"
- `test/meal-rules.test.mjs`, `test/meal.test.mjs` (gồm test "công tắc tắt = tính như cũ").
- `node tools/prove-meal-safe.mjs` — so bảng công của bản `main` và bản nhánh trên hàng chục nghìn ca ngẫu nhiên (công tắc tắt / bật + chạy xen thao tác suất ăn): số dòng khác nhau phải = 0.
