# Báo cáo rà soát bảo mật — `server/routes/` và `server/auth.js`

> Chỉ đọc code, chưa sửa gì. Rà soát tập trung 4 nhóm: (1) thiếu kiểm tra quyền / IDOR,
> (2) SQL nối chuỗi thay vì tham số hoá, (3) upload file thiếu kiểm tra, (4) lộ thông tin
> trong thông báo lỗi. Mỗi mục dưới đây đều có bằng chứng cụ thể trong code hiện tại.

## Tóm tắt

| # | Mức độ | Vấn đề | File chính |
|---|--------|--------|-----------|
| 1 | **Cao** | Quyền "Quản lý nhân viên" (`employees`) cho phép tự nâng lên `admin` / cấp quyền tuỳ ý | `server/routes/admin/employees.js` |
| 2 | **Cao** | Tài khoản tổng (master) dùng chung mọi bản cài, hash mặc định nằm công khai trong mã nguồn | `server/auth.js` |
| 3 | **Trung** | Bí mật ký JWT sinh bằng `Math.random()` (không phải CSPRNG) | `server/auth.js` |
| 4 | **Trung** | `GET /admin/employees` không kiểm tra quyền chi tiết `employees` | `server/routes/admin/employees.js` |
| 5 | **Trung** | `GET /admin/assignments`, `/shift-assignments`, `/assignments/export.xlsx` không kiểm tra quyền `assignments` | `server/routes/admin/assignments.js` |
| 6 | **Thấp** | So sánh `MASTER_PASS` không phải kiểu hằng thời gian (timing-safe) | `server/auth.js` |
| 7 | **Thấp** | Logo công ty cho phép tải lên SVG — nguy cơ XSS lưu trữ nếu mở trực tiếp file | `server/storage.js` (được gọi từ `server/routes/admin/settings.js`) |
| 8 | **Thấp** | Nhiều route trả thẳng `e.message` (lỗi SQLite/hệ thống tệp) cho client | Nhiều file trong `server/routes/admin/*.js` |

Không phát hiện SQL nối chuỗi bằng giá trị đầu vào của người dùng — toàn bộ các câu
`db.prepare(...)` đã rà đều dùng tham số hoá (`?`) hoặc chỉ nối chuỗi số lượng dấu `?`
(ví dụ `IN (${ids.map(() => '?').join(',')})`), giá trị thật luôn truyền qua `.run()/.get()/.all()`.

---

## 1. [Cao] Quyền "Quản lý nhân viên" cho phép nhân viên/quản lý tự nâng quyền lên `admin`

**File:** `server/routes/admin/employees.js:67-97` (tạo NV), `:194-198` (nhập Excel),
`:225-261` (sửa NV) — `server/auth.js:110-117` (`effectivePermissions`, mặc định
`MANAGER_DEFAULT` đã gồm `'employees'`).

**Mô tả:** Route tạo (`POST /employees`) và sửa (`PUT /employees/:id`) nhân viên chỉ
yêu cầu quyền `employees` (`need('employees')`), nhưng nhận thẳng `b.role` và
`b.permissions` từ body rồi ghi vào DB mà không giới hạn giá trị được phép đặt:

```js
// POST /employees — dòng 88
b.role || 'employee', ... normPerms(b.role, b.permissions), ...

// PUT /employees/:id — dòng 234-235
const newRole = b.role ?? emp.role;
const newPerms = b.permissions !== undefined ? normPerms(newRole, b.permissions) : emp.permissions;
```

`normPerms()` (dòng 9-13) chỉ lọc `permissions` theo danh sách khoá hợp lệ (`PERM_KEYS`),
không giới hạn theo vai trò của người đang gọi API. Theo mặc định, một tài khoản **Quản
lý (manager)** đã có quyền `employees` (`MANAGER_DEFAULT` trong `server/auth.js:107`),
nên một Quản lý có thể:
- Tự đổi `role` của chính mình (hoặc bất kỳ ai) thành `admin`, hoặc
- Gửi `permissions: [...ALL_PERMS]` để tự cấp toàn bộ quyền (lương, sao lưu, cài đặt...)
  mà không cần đổi role.

Cùng lỗ hổng xảy ra ở luồng nhập Excel hàng loạt (`POST /employees/import`, dòng
173-198): cột "Vai trò" trong file Excel được map trực tiếp qua `mapRole()` và ghi
`role='admin'` nếu ai đó ghi "Admin"/"Quản trị" vào ô — không có bước xác nhận thêm.

**Ảnh hưởng:** Một tài khoản Quản lý (vốn được thiết kế là vai trò thấp hơn Admin,
mặc định KHÔNG có quyền lương/sao lưu/cài đặt) có thể tự leo thang thành Admin toàn
quyền chỉ bằng 1 request `PUT /admin/employees/<id_của_mình>` với `{ role: "admin" }`.

**Đề xuất:**
- Chỉ cho phép người gọi có `role === 'admin'` (hoặc `req.user.master`) thay đổi
  trường `role` và `permissions` của người khác thành giá trị "rộng hơn" chính họ.
- Chặn tuyệt đối việc tự sửa `role`/`permissions` của chính `req.user.id` qua các route
  này (tương tự cách đã chặn tự xoá bản thân ở `DELETE /employees/:id/purge`, dòng 273-274).
- Với nhập Excel: chỉ Admin mới được phép tạo dòng có vai trò "Admin".

---

## 2. [Cao] Tài khoản tổng (master) dùng chung cho mọi bản cài, hash mặc định nhúng cứng trong mã nguồn công khai

**File:** `server/auth.js:36-46`

```js
const DEFAULT_MASTER_USER = 'sadmin';
const DEFAULT_MASTER_HASH = '$2a$10$6B/WPDau/884M7n0w0U6d.ag1yWwGQUC0ShlwTjfSyG9Eqzy.MKyO';
export function masterUsername() { return (process.env.MASTER_USER || DEFAULT_MASTER_USER).trim(); }
export function masterLogin(username, password) {
  const u = masterUsername();
  if (!u || String(username || '').trim() !== u) return false;
  const plain = process.env.MASTER_PASS;
  if (plain != null && plain !== '') return password === plain;
  const hash = (process.env.MASTER_HASH || DEFAULT_MASTER_HASH).trim();
  try { return bcrypt.compareSync(password || '', hash); } catch { return false; }
}
```

**Mô tả:** Nếu một bản cài không tự đặt `MASTER_USER`/`MASTER_PASS`/`MASTER_HASH` trong
`config.txt`, tài khoản tổng sẽ dùng chung username (`sadmin`) và hash bcrypt **giống hệt
nhau trên mọi bản cài Digiplus**, và hash này nằm công khai trong lịch sử Git của repo.
Đây là thiết kế có chủ đích (theo comment: "LUÔN đăng nhập được ở mọi bản cài"), nhưng
vì hash công khai, kẻ tấn công có thể offline brute-force hash này không giới hạn số
lần thử (không bị khoá tài khoản, không giới hạn tốc độ) — nếu bẻ được, sẽ chiếm được
quyền tổng ở **toàn bộ khách hàng chưa tự đặt `MASTER_HASH` riêng** cùng lúc, không chỉ
một khách hàng.

**Đề xuất (tuỳ Anh quyết định vì đây là lựa chọn thiết kế có chủ đích):**
- Bắt buộc mỗi bản cài phải tự sinh `MASTER_HASH` ngẫu nhiên lúc cài đặt lần đầu (ví dụ
  ghi vào `config.txt` tự động khi chưa có) thay vì rơi về hash mặc định dùng chung.
- Hoặc chí ít: cảnh báo rõ trong log/màn hình cài đặt nếu app đang chạy với
  `DEFAULT_MASTER_HASH` (chưa được khách/Anh ghi đè), để biết bản cài nào còn ở trạng
  thái rủi ro.

---

## 3. [Trung] Bí mật ký JWT (`jwt_secret`) sinh bằng `Math.random()`

**File:** `server/auth.js:6-13`

```js
function getSecret() {
  let s = getSetting('jwt_secret');
  if (!s) {
    s = 'digiplus_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    setSetting('jwt_secret', s);
  }
  return s;
}
```

**Mô tả:** `Math.random()` không phải bộ sinh số ngẫu nhiên an toàn cho mật mã (CSPRNG).
Bí mật này dùng để ký mọi JWT (kể cả token tài khoản tổng — `signMaster`, dòng 47-49),
nên nếu bị dự đoán/khôi phục được, kẻ tấn công có thể tự ký token giả mạo bất kỳ tài
khoản nào, kể cả `master`.

**Đề xuất:** Dùng `crypto.randomBytes(32).toString('hex')` (module `node:crypto`) để
sinh `jwt_secret` thay cho `Math.random()`.

---

## 4. [Trung] `GET /admin/employees` không kiểm tra quyền chi tiết `employees`

**File:** `server/routes/admin/employees.js:46-65`

```js
r.get('/employees', (req, res) => {
  const rows = db.prepare(`
    SELECT e.id,e.code,e.full_name,e.department,e.position,e.phone,e.role,e.username,
           e.active,e.office_id,e.shift_id,e.work_schedule_id,e.permissions,e.device_pin,e.from_device,
           e.device_id,e.pending_device,e.device_label, ...
```

**Mô tả:** Toàn bộ route trong `admin.js` chỉ yêu cầu `role` là `admin` hoặc `manager`
(`server/routes/admin.js:18`), còn quyền chi tiết theo từng chức năng (`need('employees')`,
...) được áp riêng cho từng route con. Route này là **route duy nhất trong nhóm nhân
viên không gọi `need('employees')`** trong khi các route ghi (`POST/PUT/DELETE
/employees`, `/employees/:id/biometrics`, `/photo`, `/approve-device`, ...) đều có.
Hệ quả: nếu Admin thu hồi quyền "Quản lý nhân viên" của một tài khoản Quản lý (qua
UI phân quyền), tài khoản đó **vẫn xem được toàn bộ danh sách nhân viên** — bao gồm
`username`, `permissions` (JSON quyền của người khác), `device_pin`, `device_id` — dù
không còn quyền tương ứng.

**Đề xuất:** Thêm `need('employees')` vào route này để nhất quán với các route còn lại
trong cùng nhóm.

---

## 5. [Trung] `GET /admin/assignments`, `/admin/shift-assignments`, `/admin/assignments/export.xlsx` không kiểm tra quyền `assignments`

**File:** `server/routes/admin/assignments.js:18-48` (`GET /assignments`),
`:97-106` (`GET /shift-assignments`), `:175-234` (`GET /assignments/export.xlsx`)

**Mô tả:** Cả 3 route đọc dữ liệu phân ca của toàn bộ nhân viên (kể cả xuất file
Excel) đều không gọi `need('assignments')`, trong khi các route ghi cùng nhóm
(`POST/DELETE /assignments`, `/shift-assignments`, `/assignments/import`) đều có.
Một tài khoản Quản lý không được cấp quyền "Phân ca" vẫn xem/tải được lịch phân ca
đầy đủ của mọi nhân viên trong công ty.

**Đề xuất:** Thêm `need('assignments')` cho 3 route GET nêu trên (giữ hành vi ghi dữ
liệu như hiện tại).

---

## 6. [Thấp] So sánh `MASTER_PASS` không phải kiểu hằng thời gian

**File:** `server/auth.js:42-43`

```js
const plain = process.env.MASTER_PASS;
if (plain != null && plain !== '') return password === plain;
```

**Mô tả:** Khi khách cấu hình `MASTER_PASS` (mật khẩu thô) thay vì `MASTER_HASH`, việc
so sánh dùng `===` có thời gian thực thi phụ thuộc vào số ký tự trùng đầu chuỗi, về lý
thuyết có thể bị khai thác qua đo thời gian phản hồi (timing attack) để dò từng ký tự
mật khẩu. Nhánh dùng `bcrypt.compareSync` (khi cấu hình bằng hash) không bị lỗi này.

**Đề xuất:** Dùng `crypto.timingSafeEqual` (đệm 2 chuỗi về cùng độ dài trước khi so
sánh) thay vì `===` khi so sánh `MASTER_PASS`.

---

## 7. [Thấp] Logo công ty cho phép tải lên SVG — nguy cơ XSS lưu trữ

**File:** `server/storage.js:31-41` (`saveBrandLogo`) — được gọi từ
`server/routes/admin/settings.js:56-64` (`POST /admin/branding`, yêu cầu quyền `settings`)

```js
export function saveBrandLogo(dataUrl) {
  const m = /^data:image\/(png|jpe?g|webp|svg\+xml);base64,(.+)$/i.exec(dataUrl || '');
  if (!m) throw new Error('Logo không hợp lệ (chỉ nhận PNG, JPG, WebP hoặc SVG).');
  ...
  writeFileSync(join(UPLOAD_DIR, `brand-logo.${ext}`), buf);
  return `/uploads/brand-logo.${ext}?v=${Date.now()}`;
}
```

**Mô tả:** File SVG được chấp nhận và lưu nguyên văn (không lọc `<script>`,
`onload=`, ...). File tĩnh trong `uploads/` được phục vụ trực tiếp qua URL công khai
(dùng để hiện logo ở màn đăng nhập — không cần đăng nhập). Nếu ai đó mở thẳng
`/uploads/brand-logo.svg` bằng trình duyệt (thay vì logo được nhúng qua thẻ `<img>`),
trình duyệt sẽ thực thi mã script nhúng bên trong SVG trong ngữ cảnh domain của ứng
dụng (stored XSS). Route yêu cầu quyền `settings` để tải lên nên rủi ro chính đến từ
1 tài khoản quản trị/quản lý bị chiếm quyền, hoặc vô tình tải logo không rõ nguồn gốc.

**Đề xuất:** Bỏ `svg+xml` khỏi danh sách định dạng logo được chấp nhận (chỉ giữ
PNG/JPG/WebP), hoặc nếu cần giữ SVG thì sanitize (loại `<script>`, sự kiện `on*`,
`xlink:href` trỏ ra ngoài) trước khi lưu, và phục vụ file `uploads/` với header
`Content-Disposition: inline` + `Content-Security-Policy: script-src 'none'` áp riêng
cho thư mục này.

---

## 8. [Thấp] Nhiều route trả thẳng `e.message` (lỗi SQLite/hệ thống tệp) cho client

**File (một vài ví dụ tiêu biểu, còn lặp lại ở nhiều route khác trong `server/routes/admin/`):**
- `server/routes/admin/employees.js:94-96, 203, 221`
- `server/routes/admin/assignments.js:26, 45, 91, 160, 296`
- `server/routes/admin/org.js:26, 45, 67, 80, 103`
- `server/routes/admin/devices.js:109, 125`
- `server/routes/admin/backup.js:28, 45, 50, 58`
- `server/routes/admin/payroll.js:56`

Ví dụ (`admin/employees.js:94-96`):
```js
} catch (e) {
  res.status(400).json({ error: /UNIQUE/.test(e.message) ? 'Mã NV hoặc tài khoản đã tồn tại' : e.message });
}
```

**Mô tả:** `server/index.js:92-96` đã có middleware bắt lỗi chung, chỉ trả về
`{ error: 'Lỗi máy chủ' }` và log chi tiết ở server — đúng cách. Nhưng rất nhiều route
tự `catch` rồi trả thẳng `e.message` ra ngoài thay vì dùng middleware chung này. Với
lỗi SQLite, `e.message` thường chỉ lộ tên bảng/cột (ví dụ
`SQLITE_CONSTRAINT: NOT NULL constraint failed: employees.code`), rủi ro thấp. Nhưng
với các thao tác đụng hệ thống tệp (đặc biệt `server/routes/admin/backup.js` — phục
hồi/sao lưu file `.db`, `.zip`), `e.message` có thể lộ đường dẫn tuyệt đối trên máy
chủ (ví dụ đường dẫn thư mục `data/`, tên file tạm). Các route này đều đã yêu cầu
quyền tương ứng (`need('...')`), nên đối tượng có thể nhìn thấy thông tin này giới hạn
ở tài khoản quản trị/quản lý được cấp quyền — mức độ rủi ro thấp, nhưng vẫn là rò rỉ
thông tin nội bộ không cần thiết.

**Đề xuất:** Với các lỗi không phải lỗi nghiệp vụ đã được nhận diện rõ (như trùng mã,
sai định dạng ngày...), trả một thông báo chung ("Có lỗi xảy ra, vui lòng thử lại")
và chỉ `console.error(e)` chi tiết ở server, thay vì đưa `e.message` thẳng ra response.

---

## Không phát hiện (trong phạm vi đã đọc)

- **SQL injection do nối chuỗi giá trị người dùng:** không thấy — mọi câu lệnh đều dùng
  `db.prepare(...).run/get/all(...)` với tham số `?`, kể cả các đoạn dựng `WHERE ... IN
  (${...})` chỉ nối số lượng dấu `?` (an toàn), giá trị thật truyền qua tham số.
- **IDOR ở các route tự phục vụ của nhân viên** (`server/routes/attendance.js`,
  `server/routes/leaves.js`, `server/routes/shift-requests.js`): các thao tác đọc/sửa/xoá
  dữ liệu cá nhân đều lọc theo `req.user.id` hoặc kiểm tra `row.employee_id ===
  req.user.id` trước khi cho phép — không thấy trường hợp NV xem/sửa được dữ liệu của
  người khác qua các route này.

## Phần chưa/không thể kiểm thử trong môi trường cloud

- Chưa chạy thử các kịch bản khai thác thực tế (ví dụ gọi `PUT /admin/employees/:id`
  với `role: "admin"` bằng tài khoản Quản lý thật) — môi trường cloud không có
  database khách/máy chấm công thật để dựng lại đúng vai trò/quyền như sản xuất. Đề
  nghị Anh kiểm thử tay mục 1 trên máy thật trước khi quyết định cách sửa.
- Không đọc `server/device-sync.js`, `server/db.js`, `server/update.js`,
  `server/license.js` (phần lõi, không phải `routes/` hay `auth.js`) — nằm ngoài phạm
  vi được giao lần này.
