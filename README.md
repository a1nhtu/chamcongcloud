# Digiplus — Hệ thống chấm công bằng điện thoại (ảnh + GPS)

Web app tự chủ cho **Digiplus**: nhân viên chấm công trên **điện thoại** (chụp ảnh selfie + định vị GPS), quản lý theo dõi & xuất báo cáo trên **máy tính**. Không phụ thuộc Google Sheet/Drive — toàn bộ dữ liệu do Digiplus sở hữu.

## Tính năng

**App nhân viên (PWA — cài về màn hình như app):**
- Đăng nhập theo tài khoản nhân viên; đồng hồ + ngày realtime.
- **Vào ca / Ra ca**: chụp ảnh xác nhận + lấy GPS, tính khoảng cách tới văn phòng, cảnh báo *đi muộn* và *chấm ngoài văn phòng*.
- **Báo cáo**: ngày công / tổng giờ / số lần đi muộn.
- **Đơn từ**: gửi đơn nghỉ phép / công tác, xem trạng thái duyệt.
- **Bảng công**: xem chi tiết vào/ra/giờ theo tháng.

**Trang quản lý `/admin` (Admin / Quản lý):**
- Tổng quan hôm nay: số đã chấm/chưa chấm/đi muộn/ngoài VP + bảng kèm **ảnh chấm công**.
- Quản lý **nhân viên** & **phân quyền** (Admin / Quản lý / Nhân viên).
- Cấu hình **ca làm** (giờ vào/ra, cho phép muộn, ngày làm) & **chi nhánh/vị trí** (toạ độ + bán kính).
- **Duyệt / từ chối đơn từ**.
- **Bảng công** theo tháng + **Xuất Excel**.

## Yêu cầu
- Node.js 20+ (khuyến nghị 22/24 — dùng SQLite tích hợp sẵn `node:sqlite`).

## Chạy thử (local)
```bash
npm install
npm start
```
Server chạy đồng thời:
- **HTTP** (trên chính máy này): `http://localhost:8080/` · `/admin`
- **HTTPS** (cho điện thoại/LAN): `https://<IP-LAN>:8444/` — cần thiết để dùng camera + GPS trên điện thoại.

Chứng chỉ HTTPS tự ký nằm trong `certs/`. Nếu chưa có hoặc đổi mạng (IP LAN khác), chạy:
```bash
npm run cert
```
(script tự dò IP LAN và tạo lại chứng chỉ; cần Git for Windows/openssl).

**Tài khoản mặc định (đổi ngay sau khi cài):**
| Vai trò | Tài khoản | Mật khẩu |
|---|---|---|
| Admin | `admin` | `admin123` |
| Nhân viên demo | `nv001` | `123456` |

Đổi port: `PORT=9000 npm start`. Đổi vị trí file DB: đặt biến `DB_PATH`.

## Test qua mạng LAN nội bộ (điện thoại + máy tính cùng WiFi)
1. Máy tính và điện thoại **cùng một mạng WiFi/LAN**.
2. Trên máy tính: `npm start`. Ghi lại dòng `https://<IP-LAN>:8444/` (VD `https://172.16.1.38:8444/`).
3. **Mở cổng qua Windows Firewall** (chạy 1 lần, trong PowerShell **Admin**):
   ```powershell
   New-NetFirewallRule -DisplayName "Digiplus ChamCong" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8080,8444
   ```
4. Trên điện thoại, mở trình duyệt (Chrome/Safari) vào `https://<IP-LAN>:8444/`.
5. Điện thoại báo *"Kết nối không an toàn"* (do chứng chỉ tự ký) → bấm **Nâng cao → Tiếp tục/Truy cập**. (Bình thường vì chứng chỉ tự tạo cho mạng nội bộ.)
6. Đăng nhập `nv001 / 123456` → bấm **Vào ca** → **cho phép Camera và Vị trí** khi được hỏi.

> Lưu ý: **bắt buộc dùng `https://...:8444`** trên điện thoại. Nếu mở `http://<IP>:8080` thì trình duyệt sẽ **chặn camera/GPS**.

## Đưa lên HTTPS thật để triển khai (có tên miền)
Chứng chỉ tự ký chỉ hợp cho test LAN. Khi chạy thật cho khách, dùng **tên miền + chứng chỉ hợp lệ** (miễn phí Let's Encrypt). 3 cách phổ biến:

**Cách 1 — Caddy (khuyên dùng, tự động SSL).** Cài Caddy trên VPS, trỏ tên miền `chamcong.digiplus.vn` về IP server, tạo `Caddyfile`:
```
chamcong.digiplus.vn {
    reverse_proxy localhost:8080
}
```
Chạy `caddy run` → Caddy tự xin và gia hạn SSL. App chạy `npm start` phía sau (chỉ cần HTTP 8080).

**Cách 2 — Nginx + Certbot.** Reverse proxy `localhost:8080`, chạy `certbot --nginx -d chamcong.digiplus.vn` để cấp SSL tự động.

**Cách 3 — Cloudflare Tunnel (không cần mở port/không cần IP tĩnh).** `cloudflared tunnel --url http://localhost:8080` cho ngay một URL `https://...` để test nhanh; hoặc gắn tên miền qua Cloudflare Zero Trust cho bản chạy thật.

> Khi đã có HTTPS qua domain, có thể tắt HTTPS tự ký (không cần thư mục `certs/`). App chỉ cần chạy HTTP 8080 sau reverse proxy.

### Gợi ý nơi đặt server
VPS Việt Nam (Viettel IDC, VNG, Vietnix…) hoặc cloud (AWS Lightsail, DigitalOcean) 1–2 GB RAM là đủ cho vài trăm nhân viên. Cài Node 20+, copy mã nguồn, `npm install`, dùng `pm2` để chạy nền: `pm2 start server/index.js --name chamcong`.

## Cấu hình khi triển khai cho khách
1. Đăng nhập `/admin` bằng `admin` → **Cài đặt**: đổi tên công ty + đổi mật khẩu admin.
2. **Chi nhánh**: sửa toạ độ đúng văn phòng khách (nút *"Lấy vị trí hiện tại"* khi đứng tại văn phòng) + đặt bán kính (VD 150–300 m).
3. **Ca làm**: đặt giờ vào/ra, số phút cho phép muộn.
4. **Nhân viên**: tạo tài khoản cho từng người, gán ca + chi nhánh, cấp tài khoản/mật khẩu.

## Ghi chú kỹ thuật
- **Múi giờ**: xử lý theo `Asia/Ho_Chi_Minh`; lưu mốc thời gian chuẩn ISO-8601 UTC → **không còn lỗi `1899-12-30`** như bản trong video.
- **Dữ liệu**: SQLite tại `data/digiplus.db`; ảnh tại `uploads/`. Sao lưu = copy 2 thư mục này. Muốn reset toàn bộ: xoá thư mục `data/` rồi chạy lại.
- **Đổi logo/icon**: thay 2 file `public/icons/icon-192.png`, `icon-512.png` bằng logo Digiplus (nền vuông).
- **Nâng cấp DB** (khi nhiều người dùng đồng thời/nhiều công ty): có thể chuyển sang PostgreSQL — cấu trúc bảng ở `server/db.js`.

## Cấu trúc thư mục
```
server/        # Backend Express + SQLite
  index.js     # khởi động, gắn route, phục vụ web tĩnh
  db.js        # schema + kết nối SQLite
  auth.js      # JWT + phân quyền
  util.js      # thời gian VN, Haversine, tính đi muộn
  storage.js   # lưu ảnh selfie
  seed.js      # dữ liệu khởi tạo
  routes/      # auth, attendance, leaves, admin, reports
public/        # Frontend (PWA nhân viên + trang admin)
data/          # (tự tạo) file SQLite
uploads/       # (tự tạo) ảnh chấm công
```

© Digiplus
