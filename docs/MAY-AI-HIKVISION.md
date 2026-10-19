# Máy chấm công hãng khác: máy AI + Hikvision (từ v1.22.1)

Hai công tắc riêng, **mặc định TẮT**, chỉ **tài khoản tổng** bật được: Cài đặt → Kiểu chấm công → Hình thức chấm công
(hoặc trang Máy chấm công → ⚙️ Tính năng). Phải bật "Dùng máy chấm công" trước. Tắt = phần mềm chạy y như bản cũ.

Lượt chấm của mọi hãng đổ chung một chỗ với máy ZKTeco → tính công, báo cáo, công ảo, lương **không phải đổi gì**.

| | Máy AI | Máy Hikvision |
|---|---|---|
| Kiểu kết nối | Máy **tự nối về** phần mềm (WebSocket + JSON) | **Phần mềm nối vào** máy (ISAPI web của máy) |
| Chạy trên VPS / qua Internet | Được, khỏi mở port modem | Chỉ khi máy được mở port ra Internet |
| Lượt chấm về phần mềm | Ngay lúc chấm | Bấm "⬇ Tải chấm công" hoặc tự tải theo lịch |
| NV đăng ký trên máy → phần mềm | Ngay lúc đăng ký (tự tạo NV nháp) | Lúc tải NV / tải chấm công |
| Đồng bộ vân tay / khuôn mặt giữa các máy | Có (các máy AI cùng "Nhóm đồng bộ") | Chưa (đợt sau) |
| Đẩy NV từ phần mềm xuống máy | Có (tên, thẻ, mật mã, mẫu) | Có (Số ID, tên, thẻ) |
| Code | `server/ai-device.js`, `server/ai-ws.js` | `server/hik-isapi.js` |

## Máy AI — cài đặt trên máy
1. Trên máy: Menu → Network / Cloud Server → điền **IP máy chủ + cổng phần mềm** (VD `192.168.1.10` : `8686`).
   Qua Internet: điền **tên miền công ty** (VD `abc.maychamcongcloud.com`) + cổng **80** (máy chỉ chạy `ws://` không mã hoá).
2. Máy tự kết nối → hiện ở trang Máy chấm công với nhãn 🤖 Máy AI, trạng thái **Chờ duyệt** (màn hình máy hiện "Cho duyet tren phan mem").
3. Bấm **✅ Duyệt** (dán key bản quyền nếu đang bật "Bắt buộc key"). Máy tự kết nối lại, nhận giờ máy chủ, gửi các lượt chấm đang giữ.
4. Menu "⋯ Thêm": tải NV + vân tay/khuôn mặt từ máy, tải lại log theo ngày, đặt giờ, khởi động lại, nhóm đồng bộ, xóa dữ liệu trên máy.

Giao thức: tài liệu `SDK_MayChamCong/AI/cloud SDK(API)/cloud/AI-JAVA/websocket+json protocol2.0.pdf`.
Phần WebSocket tự viết (không thêm thư viện npm) nên khách cập nhật bằng nút Update là đủ.

## Máy Hikvision — cài đặt
1. Lấy IP máy: Menu → Communication / Network. Tài khoản `admin` + mật khẩu đặt lúc kích hoạt máy.
2. Trang Máy chấm công → **＋ Thêm máy Hikvision** → nhập tên, IP, cổng (mặc định 80), tài khoản, mật khẩu → phần mềm đăng nhập thử, đọc Serial.
   ⚠️ Nhập sai mật khẩu nhiều lần, máy tạm khoá đăng nhập khoảng 30 phút.
3. Bấm **✅ Duyệt** → **⬇ Tải chấm công** (lần đầu tích "Tải TOÀN BỘ"). Muốn tự động: thanh "⏱ Tự động tải máy Hikvision" chọn chu kỳ.
4. Giờ lượt chấm lấy theo **đồng hồ hiển thị trên máy** (giống mọi máy khác) → máy để sai múi giờ cũng không lệch công.
   Chỉ nhận lượt **xác thực thành công** (máy mới: lọc `eventAttribute=attendance`; máy cũ: phần mềm tự lọc theo mã sự kiện trong `HCNetSDK.h`).

Tài liệu: `SDK_MayChamCong/HIK/.../doc/Device Network SDK (Person-Based Access Control)_Developer Guide` (mục E.6, E.164–E.169).
Không dùng DLL HCNetSDK → chạy được cả bản Windows lẫn bản Linux.

## Đã kiểm / chưa kiểm
- Đã kiểm bằng máy giả lập (test `test/may-ai-hikvision.test.mjs` + chạy thử giao diện): kết nối, chờ duyệt, lượt chấm → công,
  tự tạo NV, tải NV chia trang, đồng bộ nhóm máy AI, xoá NV, đẩy NV, Digest sai/đúng mật khẩu, lọc lượt thất bại.
- **Chưa kiểm trên máy thật** (cần thử tại chỗ): máy AI qua tên miền Cloudflare (`ws://` cổng 80), mã `mode` khuôn mặt của máy AI,
  lệnh đặt giờ / mở cửa / khởi động lại của Hikvision, đẩy thẻ xuống Hikvision.
- Đợt sau: đẩy ảnh khuôn mặt xuống Hikvision, Hikvision tự gửi lượt chấm tức thì (HTTP Listening / ISUP).
