# Máy chấm công hãng khác: máy AI + Hikvision (từ v1.22.1)

Hai công tắc riêng, **mặc định TẮT**, chỉ **tài khoản tổng** bật được: Cài đặt → Kiểu chấm công → Hình thức chấm công
(hoặc trang Máy chấm công → ⚙️ Tính năng). Phải bật "Dùng máy chấm công" trước. Tắt = phần mềm chạy y như bản cũ.

Lượt chấm của mọi hãng đổ chung một chỗ với máy ZKTeco → tính công, báo cáo, công ảo, lương **không phải đổi gì**.

| | Máy AI | Máy Hikvision |
|---|---|---|
| Kiểu kết nối | Máy **tự nối về** phần mềm (WebSocket + JSON) | **Phần mềm nối vào** máy (ISAPI web của máy) |
| Chạy trên VPS / qua Internet | Được, khỏi mở port modem | Chỉ khi máy được mở port ra Internet |
| Lượt chấm về phần mềm | Ngay lúc chấm | Ngay lúc chấm khi đã cài "📡 Máy tự gửi" (HTTP Listening); hoặc bấm "⬇ Tải chấm công" / tự tải theo lịch |
| NV đăng ký trên máy → phần mềm | Ngay lúc đăng ký (tự tạo NV nháp) | Lúc tải NV / tải chấm công |
| Đồng bộ vân tay / khuôn mặt giữa các máy | Có (các máy AI cùng "Nhóm đồng bộ") | Chưa (đợt sau) |
| Đẩy NV từ phần mềm xuống máy | Có (tên, thẻ, mật mã, mẫu) | Có (Số ID, tên, thẻ + ảnh khuôn mặt khi tích "Kèm vân tay / khuôn mặt") |
| Code | `server/ai-device.js`, `server/ai-ws.js` | `server/hik-isapi.js`, `server/routes/hik-event.js` |

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

### Máy tự gửi lượt chấm tức thì (từ v1.22.2)
1. Máy đã duyệt → "⋯ Thêm" → **📡 Cài máy tự gửi lượt chấm về phần mềm** → chọn địa chỉ mà MÁY gọi tới được
   (cùng LAN: IP máy tính cài phần mềm + cổng phần mềm; VPS / tên miền: tên miền + cổng 80; cổng 443 = HTTPS) → **Cài lên máy**.
2. Phần mềm ghi địa chỉ `http://<máy chủ>:<cổng>/hik/event/<mã bí mật của máy>` vào 1 ô **HTTP Listening** còn trống trên máy
   (`/ISAPI/Event/notification/httpHosts`), định dạng JSON, rồi nhờ máy **gửi thử**. Ô của phần mềm khác giữ nguyên; hết ô thì báo để xoá bớt trên web máy.
3. Từ đó mỗi lượt chấm máy POST sự kiện `AccessControllerEvent` (JSON hoặc multipart kèm ảnh chụp) về phần mềm → lưu + tính công ngay.
   Chỉ nhận lượt xác thực thành công (cùng bộ mã với lúc tải). Lượt đã có thì bỏ (máy gửi lại / tải theo lịch sau đó không bị trùng).
   Số ID lạ: sự kiện có tên thì tự tạo NV; không có tên thì phần mềm hỏi máy tên người đó rồi tạo (theo công tắc "Tự tạo NV").
4. Điền tay trên web máy (không có mã trong địa chỉ, URL `/hik/event`): chỉ nhận khi IP kết nối = IP máy đã khai và MAC khớp → chỉ dùng trong LAN.
5. Nên giữ "Tự động tải" theo lịch làm dự phòng (máy mất mạng lúc chấm thì tải bù). Tắt công tắc Hikvision → `/hik/event` trả 404 như bản cũ.
   Route đặt TRƯỚC cổng bản quyền (giống `/iclock`). Tài liệu: Person Arming Guide D.3–D.5, E.39–E.41; Person-Based Access Control Guide F.98.

### Đẩy ảnh khuôn mặt xuống máy (từ v1.22.2)
Trang Máy chấm công → "Đẩy NV xuống máy" → tích **Kèm vân tay / khuôn mặt** → máy Hikvision nhận Số ID + tên rồi tới **ảnh khuôn mặt**.
Ảnh lấy từ ảnh phần mềm đang có (`device_user_photos` — ảnh người dùng / ảnh mặt các máy ZKTeco… đã gửi về). Chỉ ảnh JPG ≤ 200 KB.
Gửi `PUT /ISAPI/Intelligent/FDLib/FDSetUp?format=json` (multipart `FaceDataRecord` + `FaceImage`, thư viện `blackFD`, FPID = Số ID; có rồi thì thay),
máy đời cũ không có FDSetUp thì `POST /ISAPI/Intelligent/FDLib/FaceDataRecord?format=json`. Tài liệu: E.186, E.190, F.6, F.161.

## Đã kiểm trên máy thật (05/11/2026, v1.29.6 trên 8686)
Máy khuôn mặt + vân tay + thẻ, SADP báo model MT05WE, firmware V3.9.50 build 260130, cùng LAN với máy chủ.
- **Đạt:** đăng nhập Digest, đọc thông tin, tải NV, tải chấm công, đặt giờ (máy đang để UTC+8 đổi được về UTC+7), cài HTTP Listening (ghi từng ô `/httpHosts/<id>`),
  lượt quẹt khuôn mặt + vân tay về phần mềm trong khoảng 1 giây, kể cả sau khi cài lại địa chỉ nhận (sự kiện cửa, thẻ lạ, vân tay trượt bị bỏ đúng),
  đẩy NV + ảnh mặt + thẻ, xoá NV (xoá luôn ảnh mặt),
  khởi động lại (khoảng 30 giây, giữ giờ + địa chỉ nhận). Máy tự thêm `SubscribeEvent` cho `AccessControllerEvent`, không phải bật gì thêm trên web máy.
- **Riêng máy này:** nhận `eventAttribute=attendance` nhưng không lọc (trả cả sự kiện cửa) → phần mềm tự lọc mã thành công khi gặp sự kiện không Số ID (từ v1.29.7).
  Lệnh gửi thử `/httpHosts/<id>/test` trả HTTP 400 `methodNotAllowed` = máy không có lệnh này, phải quẹt thử để kiểm tra.
  Cấu hình máy ghi `heartbeat 30` nhưng KHÔNG gửi nhịp tim đều (theo dõi 100 giây không có tin) → chỉ gửi khi có sự kiện;
  "lần cuối máy gửi" lâu không đổi chưa chắc là mất kết nối.
- **Mở cửa từ xa:** đạt (Anh nghe rơ le nhảy).
- **Chưa kiểm trên máy thật:** lượt thẻ hợp lệ gửi tức thì, tên miền Cloudflare.

### Máy thứ 2: DS-K1T671M, firmware V3.2.30 build 230330 (máy khách gửi thử, 05/11/2026)
Máy đang có 3.977 người + 44.665 lượt chấm từ 04/2026 của khách.
- **Đạt:** đăng nhập, tải chấm công theo ngày (9001/9002 quẹt mặt → tự tạo NV nháp "NV 9001"/"NV 9002" vì máy không lưu tên, công dựng ngay),
  cài máy tự gửi, đẩy NV + ảnh mặt (FDLib có FDID 1 blackFD + FDID 2 infraredFD), xoá NV.
- **Máy chỉ giữ 1 địa chỉ nhận:** báo `hostNumber 2` nhưng ghi ô 2 thì ô 1 về `0.0.0.0` (và ngược lại).
  Từ v1.29.8 phần mềm đọc lại danh sách sau khi ghi, ô của phần mềm khác bị máy xoá thì hiện cảnh báo (`lost`).
- **Cài địa chỉ nhận lần đầu, máy gửi lại TOÀN BỘ sự kiện cũ** (`currentEvent:false`) khoảng 4 tin/giây, từ sự kiện cũ nhất →
  44 nghìn sự kiện mất cỡ 3 giờ, lượt quẹt mới xếp hàng sau. Không có cài đặt bỏ qua (`EventOptimizationCfg` chỉ là gộp sự kiện,
  `EventStorageCfg` báo notSupport). Trong lúc chờ: bấm "⬇ Tải chấm công" hôm nay là có ngay. Chỉ xoá sạch sự kiện trên máy mới bỏ được hàng đợi.
- **Số ID 32 ký tự** (3.976 người, kiểu `a00b06f3…`): phần mềm chỉ nhận Số ID ≤ 20 ký tự → bỏ qua người + lượt chấm của họ.
  Từ v1.29.8 tải NV báo rõ số người bị bỏ, và thông tin máy ghi đúng số người trên máy (trước ghi số người phần mềm nhận).
- Lệnh gửi thử: không có (giống MT05WE).

## Đã kiểm / chưa kiểm (máy giả lập)
- Đã kiểm bằng máy giả lập (test `test/may-ai-hikvision.test.mjs` + chạy thử giao diện): kết nối, chờ duyệt, lượt chấm → công,
  tự tạo NV, tải NV chia trang, đồng bộ nhóm máy AI, xoá NV, đẩy NV, Digest sai/đúng mật khẩu, lọc lượt thất bại.
- Đợt 2 (test `test/hikvision-tu-gui-anh-mat.test.mjs`): cài địa chỉ nhận vào ô trống / không đè ô phần mềm khác / hết ô, máy gửi thử,
  sự kiện JSON + multipart + XML, giờ UTC, lọc lượt thất bại / cửa / nhịp tim, không trùng với lượt tải sau, Số ID lạ có / không kèm tên,
  máy chờ duyệt, mã sai, đẩy ảnh mặt (FDSetUp + máy cũ FaceDataRecord, ảnh > 200 KB), tắt công tắc = 404 như cũ.
- **Chưa kiểm trên máy thật** (cần thử tại chỗ): máy AI qua tên miền Cloudflare (`ws://` cổng 80), mã `mode` khuôn mặt của máy AI,
  lệnh đặt giờ / mở cửa / khởi động lại của Hikvision, đẩy thẻ xuống Hikvision.
- **Đợt 2 chưa kiểm trên máy thật**: máy có nhận lệnh ghi ô HTTP Listening (từng ô `/httpHosts/<id>` hay cả danh sách) và lệnh gửi thử không;
  máy có gửi lượt chấm khi chỉ cài HTTP Listening (một số firmware phải bật thêm "upload to center" cho sự kiện cửa); qua tên miền Cloudflare
  cổng 80 (nếu bật "Always Use HTTPS" thì máy không theo được chuyển hướng); tên phần JSON trong multipart thật; ảnh mặt có bị máy chê chất lượng
  (ảnh nhỏ / mờ từ máy ZKTeco) và thư viện mặt có đúng FDID 1 / blackFD.
- Đợt sau: tải ảnh khuôn mặt TỪ máy Hikvision về phần mềm (để chép sang máy Hikvision khác), ISUP (máy tự nối về như máy AI).
