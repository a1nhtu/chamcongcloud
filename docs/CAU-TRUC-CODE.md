# Cấu trúc code Digiplus Chấm Công — tài liệu cho người mới

Tài liệu này giải thích code thực tế trong repo (nhánh lúc viết tài liệu), giúp người mới đọc code
nhanh hơn. Chỗ nào code không thể hiện rõ ý đồ, tài liệu ghi **"chưa rõ"** thay vì đoán.

Ứng dụng là Node.js (ES module) dùng Express + SQLite (`node:sqlite` tích hợp sẵn của Node, không
cần cài driver ngoài), chạy 1 tiến trình duy nhất, phục vụ cả API lẫn giao diện web tĩnh trong
`public/`.

---

## 1. Từng file trong `server/` làm gì

| File | Vai trò |
|---|---|
| `index.js` | Điểm khởi động app: dựng schema DB, tạo dữ liệu mẫu, bật auto-backup định kỳ, gắn các router theo thứ tự, mở cổng HTTP (bắt buộc) và HTTPS (tuỳ chọn, cho điện thoại dùng camera/GPS qua LAN), tự chèn `?v=<version>` vào link JS/CSS khi trả `index.html`/`admin.html` để phá cache khi lên bản mới. |
| `db.js` | Lớp truy cập dữ liệu: mở kết nối SQLite (`DatabaseSync`), định nghĩa **toàn bộ schema** (`initSchema`), các hàm `migrateColumns`/`migrateAttendanceMultiShift`/`migrateDailyMultiShift` để nâng cấp DB cũ một cách an toàn (thêm cột, dựng lại bảng) khi lên version mới, cùng các hàm tiện ích `getSetting`/`setSetting`/`allowedOffices`. Cũng là nơi xử lý phục hồi DB từ file `.restore` lúc khởi động. |
| `auth.js` | Xác thực (JWT + bcrypt) và phân quyền. Có khái niệm **tài khoản tổng** (`master`, ví dụ `sadmin`) nhúng cứng trong code — không nằm trong DB, đăng nhập được ở mọi bản cài, dùng cho Anh (chủ Digiplus) hỗ trợ khách. Định nghĩa danh mục quyền chi tiết (`PERMISSIONS`) và middleware `authRequired`/`roleRequired`/`permRequired`. |
| `attendance-calc.js` | **Công thức tính công thuần** (không đụng DB): tính giờ ca (`shiftBounds`), đi muộn (`computeLate`), số liệu khi ra ca (`computeCheckout`: về sớm, giờ công, tăng ca, số công), số công khi không xác định được ca (`noShiftUnit`), và 4 quy tắc ghép log máy chấm công thành 1 cặp vào/ra (`mergeDayPunches`: filo, tdhc, idm, tdqd). |
| `day-metrics.js` | Gói lại `attendance-calc.js` thành **một hàm tính đủ chỉ số cho 1 bản ghi** (`computeDayMetrics`) dùng chung, tránh lặp code giữa `attendance.js` (check-out), `admin/attendance.js` (sửa tay/tính lại) — nhưng trên thực tế `device-sync.js` vẫn có bản `metrics()` riêng gần giống (xem mục "Trùng lặp" bên dưới). |
| `payroll-calc.js` | Tính lương theo kỳ lương: `payPeriod` (khoảng ngày của kỳ lương, hỗ trợ kỳ lệch tháng qua `pay_period_start_day`), `computePayrollForEmployee` (lương công + nghỉ phép có lương + tăng ca theo 3 mức hệ số, hoặc lương theo giờ nếu `attendance_mode='hourly'`), `computePayrollTable` (bảng lương nhiều NV, lọc theo phòng ban/danh sách NV). |
| `shift-resolver.js` | **Bộ giải ca**: quyết định NV làm ca nào vào 1 ngày cụ thể, theo thứ tự ưu tiên xuyên suốt cả app: *phân ca theo ngày (đè tay)* → *phân ca theo khoảng ngày* → *lịch trình (nhiều ca xoay)* → *ca mặc định của NV* → *tự dò theo giờ chấm*. Có 2 chế độ: `resolveShift`/`resolveDayShifts` (chỉ để hiển thị, chưa biết giờ chấm) và `resolveEffectiveShift` (khi đã có giờ chấm, dùng `autoDetectShift` để phân biệt các ca trùng giờ vào). |
| `device-sync.js` | Toàn bộ nghiệp vụ máy chấm công ZKTeco: parse dữ liệu ATTLOG/USERINFO/vân tay/khuôn mặt/ảnh máy đẩy về, tự tạo nhân viên nháp từ máy (`upsertEmployeeFromDevice`), dựng lại bản ghi `attendance` từ các lượt quẹt (`rebuildDay`/`ingestAttlog`), hàng đợi lệnh gửi xuống máy (đồng bộ NV/vân tay giữa các máy cùng nhóm, mở cửa, xoá dữ liệu máy...), và nhập dữ liệu từ USB. |
| `storage.js` | Lưu ảnh selfie chấm công (`savePhoto`, giới hạn 3MB) và logo công ty (`saveBrandLogo`, giới hạn 2MB) từ data URL base64 xuống `uploads/`. |
| `util.js` | Tiện ích dùng chung: giờ Việt Nam (`vnDateStr`, `vnParts`, UTC+7 cộng cứng), khoảng cách GPS Haversine (`distanceMeters`), định dạng hiển thị. *Lưu ý*: file này có một hàm `computeLate` **khác** với hàm cùng tên trong `attendance-calc.js` (bản này nhận `Date` hiện tại thay vì mốc chấm ISO+ngày công) — cần xem file nào đang import khi đọc code, tránh nhầm. |
| `license.js` | Bản quyền: license là chuỗi ký số Ed25519 (`payload_base64.chữ_ký_base64`), khoá công khai nhúng sẵn trong code, khoá riêng do Anh giữ ngoài repo. `machineId()` sinh mã máy từ `MachineGuid` Windows (hoặc hostname+MAC dự phòng) + mã khách (`CUSTOMER` env) để nhiều công ty dùng chung 1 VPS vẫn có license riêng biệt. |
| `push.js` | Web Push tự cài bằng `node:crypto` (không dùng thư viện `web-push` ngoài) — chuẩn VAPID + mã hoá `aes128gcm`, dùng để báo cho quản lý khi có NV chấm vào/ra. |
| `backup.js` | Sao lưu/phục hồi: sao lưu riêng file DB (`.db`) hoặc sao lưu toàn bộ gồm DB + ảnh (`.zip`, dùng `tar` của Windows). Phục hồi không áp ngay mà ghi file `<db>.restore`, việc thay thế thật sự xảy ra ở `db.js` lúc khởi động lại app (an toàn vì không sửa DB đang mở). Có `maybeAutoBackup` chạy định kỳ mỗi ngày vào giờ cấu hình. |
| `audit.js` | Middleware ghi **nhật ký thao tác admin/quản lý**: tự động log mọi POST/PUT/DELETE thành công trên router `/api/admin/*` thành nhãn tiếng Việt dễ đọc (bảng `LABELS`), giấu các field nhạy cảm (mật khẩu, ảnh, token...). Đăng nhập được log riêng qua `logLogin` (gọi từ `routes/auth.js`). |
| `seed.js` | Tạo dữ liệu khởi tạo lần đầu (chạy 1 lần, đánh dấu bằng setting `seeded`): 1 chi nhánh mẫu, 1 ca hành chính mẫu, tài khoản `admin/admin123` và NV demo `nv001/123456`. |
| `update.js` | Cơ chế tự cập nhật phần mềm — xem mục 5 bên dưới. **Không được sửa file này trừ khi Anh yêu cầu rõ** (theo CLAUDE.md). |

### `server/routes/` — các router API

| File | Vai trò |
|---|---|
| `auth.js` | `/api/auth`: đăng nhập (kiểm tra tài khoản tổng trước, rồi tới NV trong DB), lấy thông tin bản thân (`/me`), đổi mật khẩu. Export `publicUser()` — dạng rút gọn của 1 NV trả về cho client (kèm quyền hiệu lực), dùng lại ở nơi khác. |
| `attendance.js` | `/api/attendance`: API cho **nhân viên** tự chấm công — xem chi tiết ở mục 2 (luồng chấm công). Gồm chấm vào/ra, xem trạng thái hôm nay, bảng công/tháng, lịch chấm công cá nhân, tổng hợp tháng. |
| `leaves.js` | `/api/leaves`: NV gửi đơn nghỉ phép/không lương/công tác, xem đơn của mình, xoá đơn khi còn chờ duyệt; quản lý (quyền `leaves`) xem danh sách và duyệt/từ chối. |
| `shift-requests.js` | `/api/shift-requests`: nhân viên tự đăng ký ca làm (bật/tắt bằng setting `self_shift_enabled`), có thể cần duyệt (`self_shift_approve`) hoặc tự áp dụng ngay vào `daily_shift_assignments`. Cho phép đăng ký nhiều ca/ngày (ca gãy). |
| `reports.js` | `/api/reports`: báo cáo tổng hợp cho quản lý — dashboard, bảng chấm công theo khoảng ngày/phòng ban, xuất Excel (`export.xlsx`, dùng thư viện `exceljs`). |
| `license.js` | `/api/license`: xem trạng thái kích hoạt + Mã máy (không cần đăng nhập, để hiện màn kích hoạt), kích hoạt bằng chuỗi license. |
| `iclock.js` | Nhận dữ liệu từ máy chấm công ZKTeco qua giao thức ADMS Push — xem chi tiết ở mục 3. **Không** nằm sau cổng bản quyền (máy phải luôn kết nối được), nhưng chỉ *xử lý* dữ liệu khi đã bật "Dùng máy chấm công" (`device_enabled`) và máy đã được duyệt (`push_devices.active=1`). |
| `admin.js` | Router gốc `/api/admin`: chỉ lắp ráp — gắn `authRequired` + `roleRequired('admin','manager')` + `auditMiddleware` dùng chung, rồi đăng ký từng nhóm route con trong `admin/*.js`. |
| `admin/employees.js` | CRUD nhân viên, phân quyền chi tiết, khoá thiết bị chấm công (duyệt/đặt lại đổi điện thoại), import/export Excel danh sách NV, xem sinh trắc/ảnh NV đã đăng ký qua máy chấm công. |
| `admin/org.js` | Cơ cấu tổ chức: lịch trình ca (`schedules`), bộ phận (`departments`, có cây cha-con), chức danh (`positions`), chi nhánh/định vị (`offices`, gán NV được phép chấm ở đâu), ca làm (`shifts`). |
| `admin/settings.js` | Cài đặt hệ thống (giờ cuối tuần, làm tròn công, chế độ chấm công theo ca/giờ, bật máy chấm công, khoá thiết bị...), đổi logo/thương hiệu, và endpoint kiểm tra/áp dụng cập nhật phần mềm (`/update/check`, `/update/apply` — chỉ admin). |
| `admin/payroll.js` | Cấu hình lương từng NV (`salary_configs`), xem bảng lương kỳ hiện tại, quản lý ngày lễ (`public_holidays`). |
| `admin/assignments.js` | Phân ca: theo từng ngày (đè tay), theo khoảng ngày (hàng loạt), nhập/xuất phân ca bằng Excel. |
| `admin/attendance.js` | Tính lại công hàng loạt (`recompute`, dùng `day-metrics.js`), lưới chấm công dạng bảng để xem nhanh, sửa/thêm/xoá bản ghi chấm công bằng tay, xoá theo khoảng ngày. |
| `admin/backup.js` | Sao lưu/tải về/xoá bản sao lưu, phục hồi (DB riêng hoặc toàn bộ `.zip`), đổi cấu hình auto-backup. |
| `admin/devices.js` | Quản lý máy chấm công: danh sách, duyệt máy, đồng bộ NV/vân tay giữa các máy nhóm, mở cửa từ xa, dựng lại ngày công từ log máy, nhập dữ liệu từ USB, các lệnh xoá dữ liệu trên máy. |
| `admin/push.js` | Đăng ký/huỷ đăng ký nhận Web Push của trình duyệt quản lý, gửi thử thông báo, cấp public key VAPID cho client. |
| `admin/logs.js` | Xem + xuất Excel nhật ký thao tác admin (`audit_logs`) và nhật ký thao tác trên máy chấm công (`device_oplogs`). |

---

## 2. Luồng một lần chấm công — từ điện thoại đến báo cáo

1. **Điện thoại** (giao diện `public/`, không nằm trong phạm vi review code server) chụp ảnh, lấy
   GPS, gọi `POST /api/attendance/check-in` (hoặc `check-out`) kèm `lat`, `lng`, `photo` (data URL),
   và header `X-Device-Id` (mã thiết bị, nếu bật khoá thiết bị).
2. Request đi qua `authRequired` (`server/auth.js`) — cần JWT hợp lệ trong header
   `Authorization: Bearer <token>`.
3. `server/routes/attendance.js` xử lý `check-in`:
   - `checkDevice()` — nếu bật `device_lock_enabled`, kiểm tra thiết bị đã gắn với tài khoản này
     chưa; lần đầu tự gắn, lần sau lệch thiết bị thì chặn.
   - `resolveEffectiveShift()` (`shift-resolver.js`) — xác định NV đang vào **ca nào** dựa trên giờ
     chấm hiện tại (bỏ qua nếu `attendance_mode='hourly'`).
   - Chống chấm trùng theo `punch_dedup_min` (nếu bật).
   - `nearestAllowedOffice()` — tìm chi nhánh/định vị gần nhất trong các định vị NV được phép chấm
     (`allowedOffices()` ở `db.js`); nếu bật `geofence_enforce` và ở ngoài bán kính → chặn.
   - `computeLate()` (`attendance-calc.js`) — tính số phút đi muộn theo ca.
   - `savePhoto()` (`storage.js`) — lưu ảnh selfie vào `uploads/`.
   - Ghi (insert hoặc update) 1 dòng vào bảng `attendance` — khoá theo `(employee_id, work_date,
     shift_id)` nên **1 NV có thể có nhiều dòng công/ngày** nếu làm nhiều ca.
   - Trả kết quả cho app, đồng thời gọi `notifyManagers()` (`push.js`) để báo Web Push cho quản lý
     (không chặn phản hồi — chạy nền, lỗi bị nuốt).
4. `check-out` tương tự nhưng tìm **ca đang mở** (đã vào chưa ra) của hôm nay hoặc ca đêm hôm qua,
   dò lại ca theo *cả* giờ vào lẫn giờ ra (phân biệt ca trùng giờ vào), rồi gọi `computeCheckout()`
   để tính đủ: về sớm, giờ công, tăng ca, số công (`work_unit`), cập nhật dòng `attendance` đó.
5. Dữ liệu chấm công (`attendance`) sau đó được:
   - NV xem lại qua `/api/attendance/mine`, `/calendar`, `/summary`.
   - Quản lý xem/sửa qua `admin/attendance.js` (lưới chấm công, sửa tay, tính lại).
   - Tổng hợp thành **báo cáo** qua `routes/reports.js` (dashboard, bảng theo khoảng ngày, xuất Excel).
   - Tính thành **lương** qua `payroll-calc.js` (`admin/payroll.js` → `/api/admin/payroll`), dựa
     trực tiếp trên cột `work_unit`, `work_minutes`, `ot_min`, `ot_type` của bảng `attendance`.

---

## 3. Luồng máy chấm công ZKTeco gửi log về (`iclock.js`)

Máy chấm công dùng giao thức **ADMS Push** — chính máy chủ động gọi các endpoint này định kỳ (không
phải server gọi máy). Các route nằm ở gốc (`/cdata`, `/iclock/cdata`...), được gắn **trước**
`express.json()` và **trước** cổng kiểm tra license trong `index.js`, vì máy chấm công phải luôn kết
nối được kể cả khi phần mềm chưa kích hoạt bản quyền — nhưng dữ liệu chỉ thực sự được xử lý khi
`device_enabled='1'` và máy đã được admin duyệt (`push_devices.active=1`).

1. **`GET /iclock/cdata?SN=...&options=all`** — máy hỏi cấu hình khi vừa kết nối. Server ghi nhận
   máy vào bảng `push_devices` (`seenDevice`), nếu máy đã bật+duyệt thì xếp sẵn lệnh đồng bộ nhóm
   (`syncFillDevice`) rồi trả về chuỗi cấu hình ADMS (`initInfo`: bật đẩy real-time AttLog, OpLog,
   vân tay, ảnh...).
2. **`POST /iclock/cdata?table=ATTLOG`** — máy đẩy các dòng chấm công mới (mỗi dòng: `PIN \t Time \t
   Status \t Verify \t WorkCode`). Server gọi `ingestAttlog()` (`device-sync.js`):
   - Parse từng dòng, khớp NV theo `device_pin` (Số ID trên máy) rồi fallback theo `code`
     (`findEmpByPin`).
   - Ghi vào bảng `device_punches` (mỗi lượt quẹt là 1 dòng, `UNIQUE(serial, pin, punch_at)`).
   - Với mỗi (NV, ngày) có punch mới — và cả **ngày hôm trước** (phòng trường hợp lượt quẹt sáng
     sớm là giờ ra của ca đêm) — gọi `rebuildDay()`.
   - `rebuildDay()` lấy ca dự kiến của NV/ngày đó (`resolveDayShifts`), dùng `mergeDayPunches()`
     (`attendance-calc.js`) để ghép các lượt quẹt trong "cửa sổ ca" (`ruleWindow`) thành 1 cặp
     vào/ra theo 1 trong 4 quy tắc (filo/tdhc/idm/tdqd), tính chỉ số công, rồi ghi/update bảng
     `attendance` — **trừ khi bản ghi đã bị admin sửa tay** (`manual=1`, được tôn trọng không đè).
   - Cập nhật `push_devices.att_stamp` để lần sau máy chỉ đẩy log mới hơn mốc này.
3. **`POST /iclock/cdata?table=OPERLOG` (và USERINFO/FP/BIODATA/BIOPHOTO/USERPIC)** — máy đẩy thông
   tin đăng ký NV mới, vân tay/khuôn mặt mới đăng ký, ảnh, và nhật ký thao tác trên máy (OPLOG).
   Server tách các loại dòng, gọi tương ứng `ingestUserData`/`storeTemplates`/`storeUserPhotos`/
   `storeDeviceOplogs`. Nếu chưa có NV khớp Số ID và bật `device_autocreate`, tự tạo **NV nháp**
   (`upsertEmployeeFromDevice`, mật khẩu mặc định `123456`) để admin bổ sung thông tin sau. Nếu máy
   thuộc 1 "nhóm đồng bộ" (`push_devices.sync_group`), dữ liệu vừa nhận được đẩy real-time
   (`syncPinsToGroup`) sang các máy khác cùng nhóm qua hàng đợi lệnh.
4. **`GET /iclock/getrequest?SN=...`** — máy hỏi "có lệnh gì cho tôi không". Server lấy lệnh kế tiếp
   từ `push_device_commands` (`nextCommand`), trả dạng `C:<id>:<nội dung lệnh>` rồi đánh dấu
   `trans_time` (đã gửi).
5. **`POST /iclock/devicecmd`** — máy báo kết quả thực hiện lệnh (`ID=...&Return=0`). Server gọi
   `ackCommand()`: chỉ khi `Return=0` (thành công) mới "mirror" — tức cập nhật các bảng đếm cục bộ
   (`device_users_serial`, `device_bio_templates` theo máy đích) để số liệu hiển thị đúng thực tế,
   tránh đếm khống khi máy offline/lỗi mạng không xác nhận.
6. `edata`/`fdata` — server chỉ trả `OK` cho máy khỏi báo lỗi; **chưa rõ** máy dùng 2 endpoint này để
   gửi gì cụ thể (không thấy xử lý dữ liệu thật).

Ngoài luồng tự động trên, admin còn có thể **nhập dữ liệu từ USB** (`admin/devices.js` →
`device-sync.js: importUsbAttlog`/`importUsbUsers`) khi máy không có kết nối mạng, hoặc **yêu cầu
máy gửi lại log cũ** theo khoảng ngày (`queryDeviceAttlog`, gửi qua hàng đợi lệnh).

---

## 4. Các bảng chính trong SQLite và quan hệ

Schema định nghĩa toàn bộ trong `server/db.js` (`initSchema`). Các bảng cột lõi:

**Nhóm tổ chức**
- `offices` — chi nhánh/định vị GPS (toạ độ + bán kính cho phép).
- `departments` — bộ phận, có `parent_id` tự tham chiếu (cây cha-con).
- `positions` — danh mục chức danh.
- `shifts` — ca làm việc (giờ vào/ra, dung sai trễ/sớm, nghỉ giữa ca, cấu hình tăng ca, cửa sổ nhận
  diện giờ vào/ra, quy tắc ghép log mặc định, ca có qua đêm hay không).
- `work_schedules` + `work_schedule_shifts` — lịch trình gồm nhiều ca theo thứ tự (`sort_order`),
  dùng cho NV làm ca xoay.

**Nhóm nhân sự**
- `employees` — hồ sơ NV: đăng nhập (`username`/`password_hash`), vai trò (`admin|manager|employee`),
  `office_id`/`shift_id` mặc định, `work_schedule_id` (lịch trình thay ca cố định), `device_pin` (Số
  ID trên máy chấm công, dùng khớp dữ liệu máy), `device_id`/`pending_device` (khoá điện thoại chống
  chấm hộ), `permissions` (JSON quyền riêng, ghi đè mặc định theo vai trò), `from_device` (đánh dấu
  NV nháp tự tạo từ máy).
- `employee_offices` — N-N giữa NV và định vị được phép chấm (rỗng ở phía NV = được chấm mọi định vị
  đang bật, xem `allowedOffices()`).
- `salary_configs` — cấu hình lương 1-1 với `employees` (lương cơ bản, đơn giá ngày/giờ, hệ số tăng
  ca theo ngày thường/cuối tuần/lễ, phụ cấp).

**Nhóm phân ca** (thứ tự ưu tiên áp dụng — xem `shift-resolver.js`)
- `daily_shift_assignments` — phân ca **theo từng ngày cụ thể**, ưu tiên cao nhất (đè), NV có thể có
  nhiều dòng/ngày (nhiều ca gãy) từ khi bỏ ràng buộc UNIQUE 1-ca/ngày.
- `shift_assignments` — phân ca **theo khoảng ngày** (`from_date`..`to_date`, `to_date` NULL = mãi
  mãi), có thể gán 1 ca cố định hoặc 1 lịch trình (`mode='shift'|'schedule'`), có thể ghi đè quy tắc
  ghép log (`merge_rule`).
- `shift_requests` — NV **tự đăng ký** ca/xin nghỉ ngày cụ thể, cần duyệt hoặc tự động áp dụng (ghi
  vào `daily_shift_assignments` khi được duyệt/tự động).

**Nhóm chấm công**
- `attendance` — **bảng trung tâm**: 1 dòng = 1 ca công của 1 NV/1 ngày (`employee_id`, `work_date`,
  `shift_id` — unique theo `(employee_id, work_date, COALESCE(shift_id,0))` để cho phép nhiều ca/
  ngày). Lưu đầy đủ: giờ vào/ra + GPS + ảnh + khoảng cách tới định vị của mỗi lượt, các chỉ số đã
  tính (`late_min`, `early_min`, `ot_min`, `work_minutes`, `work_unit`, `day_status`, `ot_type`),
  nguồn gốc ca (`shift_source`: manual|auto|schedule|default|device), và cờ `manual`/`note` khi admin
  sửa tay (được các luồng tự động — máy chấm công, tính lại — tôn trọng, không ghi đè).
- `leave_requests` — đơn nghỉ phép, được `payroll-calc.js` cộng làm ngày nghỉ có lương (trừ loại
  "không lương").
- `public_holidays` — ngày lễ, ảnh hưởng `ot_type` (tăng ca ngày lễ) và `day_status`.

**Nhóm máy chấm công ZKTeco**
- `push_devices` — danh sách máy đã kết nối (serial), trạng thái duyệt, mốc log đã nhận
  (`att_stamp`/`oper_stamp`), số máy (`machine_number`, dùng cho quy tắc idm), nhóm đồng bộ
  (`sync_group`), có kiểm soát cửa hay không.
- `device_punches` — mỗi lượt quẹt thô từ máy (trước khi ghép thành `attendance`), khớp
  `employee_id` nếu tìm được qua `device_pin`/`code`.
- `device_bio_templates` — template vân tay/khuôn mặt, dùng đồng bộ máy↔máy.
- `device_user_photos`, `device_users`, `device_users_serial` — ảnh & thông tin NV trên máy, theo
  từng máy riêng (để đếm/so sánh) và theo PIN chung (để đồng bộ).
- `push_device_commands` — hàng đợi lệnh gửi xuống máy (đồng bộ, xoá dữ liệu, mở cửa...), máy lấy
  qua `getrequest`, báo kết quả qua `devicecmd`.
- `device_oplogs` — nhật ký thao tác thực hiện trên chính máy chấm công (vào menu, đăng ký vân
  tay, xoá dữ liệu...).

**Nhóm hệ thống**
- `settings` — key-value cấu hình toàn hệ thống (giờ cuối tuần, chế độ tính công, bật máy chấm công,
  khoá thiết bị, cấu hình backup, khoá VAPID...).
- `push_subscriptions` — đăng ký nhận Web Push của quản lý.
- `audit_logs` — nhật ký thao tác admin/quản lý trên phần mềm.

**Sơ đồ quan hệ rút gọn**

```
offices ──┬── employees ──┬── attendance (nhiều dòng/NV/ngày)
          │               ├── salary_configs (1-1)
employee_offices (N-N)    ├── leave_requests
          │               ├── daily_shift_assignments ─┐
shifts ───┼── work_schedule_shifts ── work_schedules    ├─ đều tham chiếu shifts
          │               ├── shift_assignments ────────┤  (qua shift_id, work_schedule_id)
          │               └── shift_requests ───────────┘
          │
push_devices ── device_punches ── employees (device_pin)
          └── push_device_commands
```

---

## 5. Cơ chế tự cập nhật (`server/update.js`)

**Mục đích**: khách chạy bản cài trên máy Windows riêng, không có quy trình deploy — app tự kiểm
tra và tự cập nhật code từ **repo GitHub công khai** khi Anh lên version mới trên nhánh `main`.

**Kiểm tra bản mới** (`checkUpdate`):
1. Đọc cấu hình `update_repo`/`update_branch` từ `settings` (mặc định `a1nhtu/chamcongcloud` @
   `main`, đổi được trong trang Cài đặt, không cần build lại).
2. Tải trực tiếp `package.json` trên GitHub qua
   `https://raw.githubusercontent.com/<repo>/<branch>/package.json` (không cần token — repo công
   khai).
3. So sánh `version` trong đó với `currentVersion()` (đọc từ `package.json` cục bộ) bằng `cmpVer`
   (so từng phần số, kiểu `1.2.3`).
4. Trả `hasUpdate: true` nếu bản trên GitHub mới hơn.

**Áp dụng cập nhật** (`applyUpdate`, chỉ admin gọi được qua `/api/admin/update/apply`):
1. Chỉ chạy trên **bản cài cho khách** (`isPackaged()` — phát hiện qua có `runtime/node.exe` hoặc
   `ChayApp.bat` trong thư mục cài); trên máy dev báo lỗi, yêu cầu `git pull` thủ công.
2. Tải file zip của nhánh (`codeload.github.com/<repo>/zip/refs/heads/<branch>`), giải nén bằng
   `tar` có sẵn trong Windows (dự phòng PowerShell `Expand-Archive`).
3. Sao chép các phần cần cập nhật (`server/`, `public/`, `package.json`, `node_modules/` nếu có)
   vào thư mục tạm `staged`.
4. Sao lưu DB trước khi cập nhật (`doBackup('preupdate')`, an toàn nếu cần khôi phục).
5. Sinh file `CapNhat.bat` (nội dung ở `buildBat`) và chạy nền: bat này dừng tiến trình Node đang
   giữ đúng cổng app (không đụng tiến trình Node khác), sao lưu bản đang chạy vào `_prev` (để có thể
   khôi phục thủ công), copy bản `staged` đè lên thư mục cài thật, khởi động lại app qua 1 file VBS
   ẩn (`restart-app.vbs`, để không hiện cửa sổ console đen), rồi tự xoá dọn (`_update`, chính nó).
6. Endpoint trả `{ ok: true, restarting: true }` ngay khi đã xếp xong việc cập nhật nền — **không**
   đợi app khởi động lại xong (vì tiến trình cũ sẽ bị kill).

**Cách khách nhận diện có bản mới**: `server/index.js` để cổng `/api/version` công khai (không cần
đăng nhập), khách có thể gọi định kỳ hoặc bấm nút trong trang Cài đặt để kiểm tra thủ công. Cơ chế
tự động kiểm tra định kỳ (không cần bấm nút) — **chưa rõ**, không thấy có `setInterval` gọi
`checkUpdate`/`applyUpdate` trong `index.js`; việc gọi kiểm tra/áp dụng chỉ thấy qua 2 endpoint HTTP
trong `admin/settings.js`.

**File liên quan khác** (không được sửa trừ khi Anh yêu cầu, theo CLAUDE.md): `CapNhat-ThuCong.bat`
— **chưa rõ** nội dung/khi nào dùng (không đọc trong lần review này vì nằm ngoài `server/`), có vẻ là
kịch bản cập nhật thủ công tương ứng với `CapNhat.bat` do `update.js` tự sinh.

---

## Ghi chú thêm cho người mới

- **Không có bước build**: `public/` là HTML/JS/CSS thuần, sửa xong là chạy được ngay, không cần
  bundler.
- **Giờ giấc**: toàn bộ app quy về giờ Việt Nam UTC+7 bằng cách cộng thủ công `7 * 3600000` ms vào
  `Date` UTC (xem `util.js`, `attendance-calc.js`, `backup.js` — mỗi file tự làm lại phép cộng này
  thay vì dùng chung 1 hàm, có thể là chỗ dễ lệch nếu sửa không đồng bộ).
- **`node:sqlite`** là module tích hợp sẵn của Node (không phải `better-sqlite3` hay tương tự) — cần
  bản Node đủ mới mới có; **chưa rõ** version Node tối thiểu yêu cầu (không thấy khai báo `engines`
  trong `package.json`).
- Test hiện có (`test/*.test.mjs`) chỉ bao phủ 4 module thuần logic: `attendance-calc.js`,
  `day-metrics.js`, `payroll-calc.js`, `shift-resolver.js` — các route Express, `device-sync.js`,
  `update.js`, `license.js`... chưa có test tự động.
