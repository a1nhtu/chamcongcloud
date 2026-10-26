# Tìm máy chấm công — Digiplus

Công cụ cho kỹ thuật viên: tìm địa chỉ IP của máy chấm công **ngay cả khi máy khác dải mạng** với modem/laptop (máy mang từ nơi khác về, chưa biết IP), rồi đổi IP máy về đúng dải modem — không cần reset máy.

## Vì sao tìm được máy khác dải
Khác dải IP nhưng **cùng một dây mạng** (cùng switch/modem) thì laptop và máy chấm công vẫn chung mạng ở tầng MAC (tầng 2). Công cụ gửi gói **ARP** hỏi thẳng xuống dây; máy ZKTeco chạy Linux nên **trả lời kể cả khi người hỏi khác dải**, kèm theo địa chỉ MAC. Nhờ đó lọc ra máy có MAC **00:17:61…** (ZKTeco / Ronald Jack) và dò cổng 4370 / 8818.

> Điều kiện: máy chấm công phải **cắm cùng switch/modem** với laptop (hoặc cắm cáp thẳng vào laptop). Máy nằm sau một router khác thì không công cụ nào thấy được. Nên dùng **cáp LAN** — Wi-Fi nhiều nơi chặn thiết bị thấy nhau.

## Cách dùng
1. Chuột phải `TimMayChamCong.exe` → **Run as administrator** (cần quyền Admin để tạm gắn IP phụ / đổi IP máy).
2. Chọn **card mạng** đang cắm dây tới máy chấm công.
3. Chọn **phạm vi**:
   - *Nhanh* — dò các dải hay gặp (gồm IP mặc định ZK 192.168.1.201), vài giây.
   - *Dải của card mạng này* — chỉ /24 hiện tại.
   - *Toàn bộ 192.168.x.x* — quét rộng, vài phút.
   - *Tự nhập* — ví dụ `10.10.10.1-254, 192.168.9.0/24, 192.168.1.201`.
4. Bấm **🔍 QUÉT TÌM MÁY**. Máy ZKTeco tô **xanh**, máy có cổng 4370/8818 tô **vàng**.
5. Chọn máy → **⚙ Đổi IP máy về dải modem** (hoặc nháy đúp):
   - Bấm **① Kết nối & đọc máy** (nhập Comm Key nếu máy có đặt) để xem serial/model.
   - Chọn IP tĩnh mới cùng dải modem (hoặc bật DHCP) → **② ÁP DỤNG**. Máy tự khởi động lại ở IP mới.
6. **🗝 Xóa quản trị máy**: chọn máy → bấm nút, nhập Comm Key (0 nếu không đặt) → xóa toàn bộ quyền admin trên máy (khi quên/mất admin, không vào được Menu). **Không** xóa nhân viên hay dữ liệu chấm công.

## SDK máy chấm công (để đổi IP / xóa quản trị)
Hai chức năng này dùng SDK **zkemkeeper** của ZKTeco. Bộ phát hành đã **kèm sẵn** trong thư mục `zksdk\`.
- **Tự động:** mở `TimMayChamCong.exe` bằng quyền Admin — nếu máy **chưa có** SDK nào, tool tự đăng ký SDK kèm theo. Máy **đã có** SDK (Wise Eye, Ronald Jack, DigiplusChamCong…) thì **giữ nguyên**, không đụng.
- **Thủ công:** chạy `CaiDatSDK.bat` (tự xin quyền Admin) để đăng ký; `GoSDK.bat` để gỡ.
- Chỉ phần **tìm & liệt kê** máy là không cần SDK; đổi IP / xóa quản trị thì cần.

## Chế độ quét
- **Npcap** (nếu máy đã cài sẵn): gửi ARP thô, nhanh nhất. Công cụ **không** đóng kèm Npcap (giấy phép) — có thì tự dùng.
- **Windows** (không cần cài gì): tự thêm tuyến mạng tạm rồi dùng SendARP; chậm hơn, cần quyền Admin khi quét khác dải. Xong tự gỡ sạch.

## An toàn
- Mọi thay đổi mạng của laptop (IP phụ, tuyến tạm) chỉ **tạm thời** (store=active) và **tự gỡ** khi xong hoặc khi mở lại công cụ. Ghi nhật ký ở `%ProgramData%\Digiplus\TimMayChamCong`.
- Phần "đổi IP máy" dùng SDK **zkemkeeper.dll** — máy tính cần đã cài SDK (có sẵn khi đã cài DigiplusChamCong). Nếu thiếu SDK, vẫn **quét & liệt kê** được, chỉ không đổi IP qua SDK.

## Build lại
```
MSBuild TimMayChamCong.csproj /p:Configuration=Release /p:Platform=x86
```
Yêu cầu: .NET Framework 4.8 (có sẵn Windows 10), MSBuild (VS 2019+). Kết quả: `bin\Release\TimMayChamCong.exe` (~64KB, 1 file, không phụ thuộc ngoài).
