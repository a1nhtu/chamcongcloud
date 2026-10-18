// Lớp truy cập dữ liệu — dùng SQLite tích hợp sẵn của Node (node:sqlite)
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, copyFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread } from 'node:worker_threads';
import { HR_FIELD_KEYS } from './hr-rules.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
export const DATA_DIR = join(ROOT, 'data');
mkdirSync(DATA_DIR, { recursive: true });

export const DB_PATH = process.env.DB_PATH || join(DATA_DIR, 'digiplus.db');

// PHỤC HỒI: nếu có file chờ (.restore) → thay CSDL trước khi mở (an toàn, làm 1 lần lúc khởi động)
const RESTORE_FILE = DB_PATH + '.restore';
if (isMainThread && existsSync(RESTORE_FILE)) {   // chỉ luồng chính lúc khởi động (luồng phụ xuất báo cáo cũng nạp file này)
  try {
    if (existsSync(DB_PATH)) copyFileSync(DB_PATH, DB_PATH + '.prerestore'); // giữ bản trước khi phục hồi
    for (const ext of ['-wal', '-shm']) { const f = DB_PATH + ext; if (existsSync(f)) rmSync(f); } // bỏ WAL cũ
    renameSync(RESTORE_FILE, DB_PATH);
    console.log('  [restore] Đã phục hồi dữ liệu từ bản sao lưu.');
  } catch (e) { console.error('  [restore] Lỗi phục hồi:', e.message); }
}

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
// WAL + synchronous NORMAL: không ép đĩa ghi xong sau TỪNG lần ghi (CSDL vẫn không hỏng khi mất điện, cùng lắm mất vài thao tác cuối)
// → tính lại công / nhận lượt quẹt nhanh hơn nhiều lần. busy_timeout: luồng phụ (xuất báo cáo, tính lại) và luồng chính chờ nhau thay vì báo lỗi.
db.exec('PRAGMA synchronous = NORMAL;');
db.exec('PRAGMA busy_timeout = 15000;');
// NHỚ CÂU LỆNH ĐÃ SOẠN: mã gọi db.prepare(...) lại ở mỗi lần chạy (hàng triệu lần khi tính lại công / dựng báo cáo công ty đông người);
// soạn 1 lần rồi dùng lại. Chỉ nhớ câu ngắn (câu có danh sách IN dài thay đổi liên tục thì soạn như cũ).
{
  const prep = db.prepare.bind(db), cache = new Map();
  db.prepare = (sql) => {
    if (typeof sql !== 'string' || sql.length > 700) return prep(sql);
    let st = cache.get(sql);
    if (!st) { if (cache.size >= 2000) cache.clear(); st = prep(sql); cache.set(sql, st); }
    return st;
  };
}

// Cập nhật số liệu thống kê để SQLite chọn đúng chỉ mục (nhẹ: chỉ lấy mẫu, chỉ làm khi cần) — gọi lúc khởi động
export function optimizeDb() {
  try { db.exec('PRAGMA analysis_limit = 400; PRAGMA optimize;'); } catch (e) { console.error('[db] optimize:', e.message); }
}

export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS offices (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT NOT NULL,
      address   TEXT DEFAULT '',
      lat       REAL NOT NULL,
      lng       REAL NOT NULL,
      radius_m  INTEGER NOT NULL DEFAULT 200,
      active    INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Định vị (văn phòng) mà từng NV được phép chấm — nhiều định vị/NV. Rỗng = được chấm ở TẤT CẢ.
    CREATE TABLE IF NOT EXISTS employee_offices (
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      office_id   INTEGER NOT NULL REFERENCES offices(id),
      PRIMARY KEY (employee_id, office_id)
    );

    CREATE TABLE IF NOT EXISTS shifts (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      name           TEXT NOT NULL,
      start_time     TEXT NOT NULL,          -- 'HH:MM'
      end_time       TEXT NOT NULL,          -- 'HH:MM'
      late_grace_min INTEGER NOT NULL DEFAULT 0,
      work_days      TEXT NOT NULL DEFAULT '1,2,3,4,5,6', -- 1=T2 .. 7=CN
      active         INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS employees (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      code          TEXT UNIQUE NOT NULL,
      full_name     TEXT NOT NULL,
      department    TEXT DEFAULT '',
      position      TEXT DEFAULT '',
      phone         TEXT DEFAULT '',
      role          TEXT NOT NULL DEFAULT 'employee', -- admin | manager | employee
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      office_id     INTEGER REFERENCES offices(id),
      shift_id      INTEGER REFERENCES shifts(id),
      active        INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id        INTEGER NOT NULL REFERENCES employees(id),
      work_date          TEXT NOT NULL,      -- 'YYYY-MM-DD' (giờ VN)
      check_in_at        TEXT,               -- ISO 8601 UTC
      check_in_lat       REAL,
      check_in_lng       REAL,
      check_in_photo     TEXT,
      check_in_office_id INTEGER REFERENCES offices(id),
      check_in_distance_m INTEGER,
      check_in_outside   INTEGER DEFAULT 0,
      late_min           INTEGER DEFAULT 0,
      check_out_at       TEXT,
      check_out_lat      REAL,
      check_out_lng      REAL,
      check_out_photo    TEXT,
      check_out_distance_m INTEGER,
      work_minutes       INTEGER DEFAULT 0,
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(employee_id, work_date)
    );

    CREATE TABLE IF NOT EXISTS leave_requests (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      type        TEXT NOT NULL,             -- Nghỉ phép | Nghỉ không lương | Công tác | Khác
      from_date   TEXT NOT NULL,
      to_date     TEXT NOT NULL,
      reason      TEXT DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
      reviewed_by INTEGER REFERENCES employees(id),
      reviewed_at TEXT,
      review_note TEXT DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS daily_shift_assignments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      work_date   TEXT NOT NULL,                 -- 'YYYY-MM-DD'
      shift_id    INTEGER REFERENCES shifts(id), -- ca gán; NULL khi is_off
      is_off      INTEGER NOT NULL DEFAULT 0,     -- 1 = ngày nghỉ
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(employee_id, work_date)
    );

    CREATE TABLE IF NOT EXISTS work_schedules (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      code        TEXT DEFAULT '',
      name        TEXT NOT NULL,
      description TEXT DEFAULT '',
      active      INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS work_schedule_shifts (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      work_schedule_id INTEGER NOT NULL REFERENCES work_schedules(id),
      shift_id         INTEGER NOT NULL REFERENCES shifts(id),
      sort_order       INTEGER NOT NULL DEFAULT 0,
      UNIQUE(work_schedule_id, shift_id)
    );

    -- Phân ca theo KHOẢNG NGÀY (gán ca hoặc lịch trình cho NV, có ngày bắt đầu/kết thúc).
    -- Khác daily_shift_assignments (theo từng ngày): bảng này áp cho cả một khoảng, gán hàng loạt được.
    CREATE TABLE IF NOT EXISTS shift_assignments (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id      INTEGER NOT NULL REFERENCES employees(id),
      mode             TEXT NOT NULL DEFAULT 'shift',   -- 'shift' = gán ca | 'schedule' = gán lịch trình
      shift_id         INTEGER REFERENCES shifts(id),           -- khi mode='shift'
      work_schedule_id INTEGER REFERENCES work_schedules(id),   -- khi mode='schedule'
      from_date        TEXT NOT NULL,                   -- 'YYYY-MM-DD'
      to_date          TEXT,                            -- NULL = mãi mãi
      shift_type       TEXT NOT NULL DEFAULT 'fixed',   -- 'fixed' = cố định | 'rotating' = xoay
      merge_rule       TEXT NOT NULL DEFAULT 'default', -- default|filo|tdhc|idm|tdqd (ghi đè quy tắc ghép log của ca)
      note             TEXT DEFAULT '',
      active           INTEGER NOT NULL DEFAULT 1,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Lịch trình gán cho PHÒNG BAN (kiểu ZKBio): mọi NV của phòng — kể cả người vào sau — đều theo,
    -- trừ khi NV có lịch trình riêng (shift_assignments) hoặc đổi ca riêng ngày (daily_shift_assignments).
    CREATE TABLE IF NOT EXISTS dept_shift_assignments (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      department       TEXT NOT NULL,                   -- tên phòng ban (khớp employees.department)
      include_children INTEGER NOT NULL DEFAULT 1,      -- 1 = áp cả các phòng ban cấp dưới
      mode             TEXT NOT NULL DEFAULT 'shift',   -- 'shift' | 'schedule'
      shift_id         INTEGER REFERENCES shifts(id),
      work_schedule_id INTEGER REFERENCES work_schedules(id),
      from_date        TEXT NOT NULL,
      to_date          TEXT,                            -- NULL = không thời hạn
      merge_rule       TEXT NOT NULL DEFAULT 'default',
      note             TEXT DEFAULT '',
      active           INTEGER NOT NULL DEFAULT 1,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Nhân viên tự đăng ký ca (chờ duyệt / tự áp dụng tuỳ cấu hình)
    CREATE TABLE IF NOT EXISTS shift_requests (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      work_date   TEXT NOT NULL,                 -- 'YYYY-MM-DD'
      shift_id    INTEGER REFERENCES shifts(id), -- NULL khi is_off
      is_off      INTEGER NOT NULL DEFAULT 0,     -- 1 = xin nghỉ ngày đó
      status      TEXT NOT NULL DEFAULT 'pending',-- pending | approved | rejected
      reviewed_by INTEGER REFERENCES employees(id),
      reviewed_at TEXT,
      review_note TEXT DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS departments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT UNIQUE NOT NULL,
      parent_id  INTEGER DEFAULT NULL,          -- bộ phận cha (NULL = cấp trên cùng)
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- Danh mục chức danh (để chọn khi khai báo NV, thay vì gõ tay)
    CREATE TABLE IF NOT EXISTS positions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS salary_configs (
      employee_id            INTEGER PRIMARY KEY REFERENCES employees(id),
      basic_salary           REAL NOT NULL DEFAULT 0,     -- lương cơ bản/tháng
      daily_rate             REAL,                        -- NULL = tự tính basic/working_days
      working_days_per_month REAL NOT NULL DEFAULT 26,
      ot_rate_weekday        REAL NOT NULL DEFAULT 1.5,
      ot_rate_weekend        REAL NOT NULL DEFAULT 2.0,
      ot_rate_holiday        REAL NOT NULL DEFAULT 3.0,
      allowance              REAL NOT NULL DEFAULT 0,      -- phụ cấp cố định/tháng
      updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS public_holidays (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      holiday_date TEXT UNIQUE NOT NULL,   -- 'YYYY-MM-DD'
      name         TEXT DEFAULT '',
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS push_devices (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      serial     TEXT UNIQUE NOT NULL,          -- Serial Number máy chấm công
      name       TEXT DEFAULT '',
      active     INTEGER NOT NULL DEFAULT 0,     -- 0=chờ duyệt, 1=đã duyệt
      att_stamp  TEXT DEFAULT '0',               -- mốc log đã nhận (ATTLOGStamp)
      last_ip    TEXT DEFAULT '',
      last_seen  TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS device_punches (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      serial      TEXT NOT NULL,
      pin         TEXT NOT NULL,                 -- mã user trên máy = employees.code
      punch_at    TEXT NOT NULL,                 -- ISO UTC
      work_date   TEXT NOT NULL,                 -- 'YYYY-MM-DD' giờ VN
      status      INTEGER DEFAULT 0,             -- 0 vào / 1 ra (nhiều máy để 0 hết)
      verify      INTEGER DEFAULT 0,             -- 1 vân tay, 15 khuôn mặt, 4 thẻ, 0 mật mã
      employee_id INTEGER,                       -- khớp NV (NULL nếu chưa khớp)
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(serial, pin, punch_at)
    );

    -- Template sinh trắc lưu ở server (để đồng bộ máy↔máy): vân tay / khuôn mặt
    CREATE TABLE IF NOT EXISTS device_bio_templates (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      serial      TEXT NOT NULL,                 -- máy nguồn đang giữ template này
      pin         TEXT NOT NULL,                 -- số ID trên máy
      bio_type    INTEGER NOT NULL DEFAULT 1,    -- 1=vân tay, 2/9=khuôn mặt
      idx         INTEGER NOT NULL DEFAULT 0,    -- ngón thứ mấy / index
      valid       INTEGER NOT NULL DEFAULT 1,
      duress      INTEGER NOT NULL DEFAULT 0,
      major_ver   INTEGER DEFAULT 10,
      minor_ver   INTEGER DEFAULT 0,
      tmp         TEXT NOT NULL,                 -- base64 template
      received_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(serial, pin, bio_type, idx)
    );
    -- Ảnh người dùng / ảnh khuôn mặt đăng ký trên máy (để hiện avatar + đồng bộ sang máy khác)
    CREATE TABLE IF NOT EXISTS device_user_photos (
      pin         TEXT PRIMARY KEY,              -- số ID trên máy
      kind        TEXT NOT NULL DEFAULT 'user',  -- 'user' (USERPIC) | 'face' (BIOPHOTO)
      face_type   INTEGER DEFAULT 0,             -- Type của BIOPHOTO (2=IR, 9=visible) nếu là face
      photo       TEXT NOT NULL,                 -- base64 JPG
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- Thông tin user trên máy (tên/thẻ/mật mã) để đẩy kèm khi đồng bộ
    CREATE TABLE IF NOT EXISTS device_users (
      pin         TEXT PRIMARY KEY,
      name        TEXT DEFAULT '',
      card        TEXT DEFAULT '',
      passwd      TEXT DEFAULT '',
      privilege   INTEGER DEFAULT 0,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- Đăng ký user theo TỪNG máy (để đếm số NV/thẻ mỗi máy, so sánh đồng bộ)
    CREATE TABLE IF NOT EXISTS device_users_serial (
      serial      TEXT NOT NULL,
      pin         TEXT NOT NULL,
      name        TEXT DEFAULT '',
      card        TEXT DEFAULT '',
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (serial, pin)
    );
    -- Đăng ký nhận thông báo đẩy (Web Push) của quản lý — 1 dòng = 1 thiết bị/trình duyệt
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER,
      endpoint    TEXT UNIQUE NOT NULL,
      p256dh      TEXT NOT NULL,
      auth        TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- Hàng đợi lệnh gửi xuống máy (đồng bộ / cập nhật). Máy lấy qua /getrequest, báo kết quả qua /devicecmd.
    CREATE TABLE IF NOT EXISTS push_device_commands (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      serial      TEXT NOT NULL,                 -- máy đích nhận lệnh
      content     TEXT NOT NULL,                 -- nội dung lệnh ADMS (VD 'DATA UPDATE FINGERTMP...')
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      trans_time  TEXT,                          -- lúc đã gửi cho máy (NULL=chờ gửi)
      return_value TEXT,                         -- kết quả máy báo về
      response_at TEXT
    );

    -- Nhật ký thao tác của admin/quản lý trên phần mềm (thêm/sửa/xóa, đăng nhập...).
    CREATE TABLE IF NOT EXISTS audit_logs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      at         TEXT NOT NULL DEFAULT (datetime('now')),  -- ISO/UTC
      user_id    INTEGER,                     -- employees.id (NULL/0 nếu tài khoản tổng)
      username   TEXT DEFAULT '',
      user_name  TEXT DEFAULT '',             -- họ tên hiển thị
      role       TEXT DEFAULT '',
      action     TEXT DEFAULT '',             -- nhãn thao tác tiếng Việt
      method     TEXT DEFAULT '',
      path       TEXT DEFAULT '',
      detail     TEXT DEFAULT '',             -- tóm tắt tham số (JSON gọn, bỏ mật khẩu)
      status     INTEGER DEFAULT 0,           -- HTTP status
      ip         TEXT DEFAULT ''
    );
    -- Nhật ký thao tác TRÊN MÁY chấm công (ZKTeco đẩy về qua OPERLOG/OPLOG):
    -- vào menu, đăng ký/xóa vân tay, xóa dữ liệu, đặt giờ, khôi phục gốc...
    CREATE TABLE IF NOT EXISTS device_oplogs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      serial      TEXT NOT NULL,              -- máy phát sinh thao tác
      op_code     INTEGER,                    -- mã thao tác ZKTeco
      op_time     TEXT,                       -- thời điểm trên máy (chuỗi máy gửi)
      admin_pin   TEXT DEFAULT '',            -- Số ID người thao tác trên máy
      obj1        TEXT DEFAULT '',
      obj2        TEXT DEFAULT '',
      obj3        TEXT DEFAULT '',
      raw         TEXT DEFAULT '',            -- dòng gốc máy gửi (đối chiếu khi cần)
      received_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(serial, op_code, op_time, admin_pin, obj1)
    );
    CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_logs(at);
    CREATE INDEX IF NOT EXISTS idx_oplog_serial ON device_oplogs(serial, op_time);

    CREATE INDEX IF NOT EXISTS idx_bio_serial ON device_bio_templates(serial);
    CREATE INDEX IF NOT EXISTS idx_bio_pin ON device_bio_templates(pin);
    CREATE INDEX IF NOT EXISTS idx_cmd_serial ON push_device_commands(serial, trans_time);
    CREATE INDEX IF NOT EXISTS idx_att_emp_date ON attendance(employee_id, work_date);
    CREATE INDEX IF NOT EXISTS idx_leave_emp ON leave_requests(employee_id);
    CREATE INDEX IF NOT EXISTS idx_leave_status ON leave_requests(status);
    CREATE INDEX IF NOT EXISTS idx_punch_emp_date ON device_punches(employee_id, work_date);
    -- công ty đông người / dữ liệu nhiều năm: tìm lượt quẹt theo khoảng GIỜ của 1 NV, và lọc công / lượt quẹt theo NGÀY cả công ty
    CREATE INDEX IF NOT EXISTS idx_punch_emp_at ON device_punches(employee_id, punch_at);
    CREATE INDEX IF NOT EXISTS idx_punch_date ON device_punches(work_date);
    CREATE INDEX IF NOT EXISTS idx_att_date ON attendance(work_date);
    CREATE INDEX IF NOT EXISTS idx_shiftreq_emp ON shift_requests(employee_id);
    CREATE INDEX IF NOT EXISTS idx_shiftreq_status ON shift_requests(status);
  `);

  migrateColumns();
}

// Dựng lại bảng attendance để BỎ ràng buộc UNIQUE(employee_id, work_date) → cho phép NHIỀU ca/ngày.
// Giữ nguyên mọi cột + dữ liệu (copy động theo PRAGMA), thêm UNIQUE INDEX theo (NV, ngày, ca).
function migrateAttendanceMultiShift() {
  if (getSetting('att_multishift_migrated') === '1') return;
  const cols = db.prepare('PRAGMA table_info(attendance)').all();
  if (!cols.length) { setSetting('att_multishift_migrated', '1'); return; }
  const colDefs = cols.map((c) => {
    if (c.pk) return `${c.name} INTEGER PRIMARY KEY AUTOINCREMENT`;
    let d = `${c.name} ${c.type || ''}`.trim();
    if (c.notnull) d += ' NOT NULL';
    if (c.dflt_value !== null && c.dflt_value !== undefined) d += ` DEFAULT (${c.dflt_value})`;
    return d;
  });
  const colNames = cols.map((c) => c.name).join(', ');
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(`CREATE TABLE attendance_new (${colDefs.join(', ')})`);
    db.exec(`INSERT INTO attendance_new (${colNames}) SELECT ${colNames} FROM attendance`);
    db.exec('DROP TABLE attendance');
    db.exec('ALTER TABLE attendance_new RENAME TO attendance');
    db.exec('CREATE INDEX IF NOT EXISTS idx_att_emp_date ON attendance(employee_id, work_date)');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_att_emp_date_shift ON attendance(employee_id, work_date, COALESCE(shift_id, 0))');
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); db.exec('PRAGMA foreign_keys = ON'); throw e; }
  db.exec('PRAGMA foreign_keys = ON');
  setSetting('att_multishift_migrated', '1');
}

// Cho phép NHIỀU PHIÊN chấm công / NGÀY (công nhân chấm 4-6 lần, nhất là chế độ theo giờ):
// đổi unique index (NV, ngày, ca) → (NV, ngày, ca, giờ VÀO) để nhiều phiên cùng ngày + cùng
// "không ca" (shift_id NULL → COALESCE 0) vẫn lưu được (phân biệt theo giờ check-in).
function migrateAttendanceMultiSession() {
  if (getSetting('att_multisession_migrated') === '1') return;
  try {
    db.exec('DROP INDEX IF EXISTS idx_att_emp_date_shift');
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_att_emp_date_shift ON attendance(employee_id, work_date, COALESCE(shift_id, 0), COALESCE(check_in_at, ''))");
  } catch (e) { /* lỗi thì giữ index cũ, không chặn khởi động */ }
  setSetting('att_multisession_migrated', '1');
}

// Dựng lại daily_shift_assignments để BỎ UNIQUE(employee_id, work_date) → cho NV có NHIỀU ca/ngày
// (NV tự chọn 2-3 ca gãy). Giữ nguyên dữ liệu, thêm UNIQUE INDEX theo (NV, ngày, ca).
function migrateDailyMultiShift() {
  if (getSetting('daily_multishift_migrated') === '1') return;
  const cols = db.prepare('PRAGMA table_info(daily_shift_assignments)').all();
  if (!cols.length) { setSetting('daily_multishift_migrated', '1'); return; }
  const colDefs = cols.map((c) => {
    if (c.pk) return `${c.name} INTEGER PRIMARY KEY AUTOINCREMENT`;
    let d = `${c.name} ${c.type || ''}`.trim();
    if (c.notnull) d += ' NOT NULL';
    if (c.dflt_value !== null && c.dflt_value !== undefined) d += ` DEFAULT (${c.dflt_value})`;
    return d;
  });
  const colNames = cols.map((c) => c.name).join(', ');
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(`CREATE TABLE dsa_new (${colDefs.join(', ')})`);
    db.exec(`INSERT INTO dsa_new (${colNames}) SELECT ${colNames} FROM daily_shift_assignments`);
    db.exec('DROP TABLE daily_shift_assignments');
    db.exec('ALTER TABLE dsa_new RENAME TO daily_shift_assignments');
    db.exec('CREATE INDEX IF NOT EXISTS idx_dsa_emp_date ON daily_shift_assignments(employee_id, work_date)');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uidx_dsa_emp_date_shift ON daily_shift_assignments(employee_id, work_date, COALESCE(shift_id, 0))');
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); db.exec('PRAGMA foreign_keys = ON'); throw e; }
  db.exec('PRAGMA foreign_keys = ON');
  setSetting('daily_multishift_migrated', '1');
}

// Thêm cột mới cho DB đã tồn tại (an toàn, không mất dữ liệu)
function migrateColumns() {
  const cols = (table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  const add = (table, name, ddl) => {
    if (!cols(table).has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
  };
  // Cột shift_id/shift_source PHẢI có TRƯỚC khi rebuild attendance (unique index dùng COALESCE(shift_id,0)).
  // Trên DB mới (initSchema chưa có 2 cột này) nếu không thêm trước → migrateAttendanceMultiShift lỗi "no such column: shift_id".
  add('attendance', 'shift_id',    'INTEGER');
  add('attendance', 'shift_source', "TEXT DEFAULT ''");
  migrateAttendanceMultiShift();
  migrateAttendanceMultiSession();
  migrateDailyMultiShift();

  // GĐ5: mã ca + cửa sổ nhận diện giờ vào (để tự động tìm ca)
  add('shifts', 'code',            "TEXT DEFAULT ''");   // mã ca dùng trong Excel phân ca (S, C, HC, DEM...)
  add('shifts', 'check_in_start',  'TEXT');               // 'HH:MM' đầu cửa sổ nhận VÀO
  add('shifts', 'check_in_end',    'TEXT');               // 'HH:MM' cuối cửa sổ nhận VÀO
  add('shifts', 'check_out_start', 'TEXT');               // 'HH:MM' đầu cửa sổ nhận RA (phân biệt ca cùng giờ vào)
  add('shifts', 'check_out_end',   'TEXT');               // 'HH:MM' cuối cửa sổ nhận RA
  // GĐ5: ca thực tế (đã dò/đã phân) lưu trên bản ghi chấm công
  add('attendance', 'shift_id',    'INTEGER');            // ca áp dụng cho bản ghi này
  add('attendance', 'shift_source', "TEXT DEFAULT ''");   // manual | auto | schedule | default
  // Lịch trình ca gán cho nhân viên (thay cho ca cố định)
  add('employees', 'work_schedule_id', 'INTEGER');
  // Số ID trên máy chấm công (PIN/enroll number) — dùng để khớp NV với dữ liệu máy đẩy về
  add('employees', 'device_pin', "TEXT DEFAULT ''");
  // Đánh dấu NV được tạo tự động khi máy đăng ký vân tay (bản nháp, admin bổ sung sau)
  add('employees', 'from_device', 'INTEGER NOT NULL DEFAULT 0');
  // Khoá thiết bị chấm công (chống chấm hộ): điện thoại đã gắn + điện thoại chờ duyệt đổi
  add('employees', 'device_id',      "TEXT DEFAULT ''");   // ID thiết bị đã duyệt (rỗng = chưa gắn)
  add('employees', 'pending_device', "TEXT DEFAULT ''");   // ID thiết bị NV xin đổi (chờ admin duyệt)
  add('employees', 'device_label',   "TEXT DEFAULT ''");   // mô tả máy (trình duyệt/hệ máy) để admin nhận biết
  // Phân quyền chi tiết theo chức năng (JSON mảng key; NULL = mặc định theo vai trò)
  add('employees', 'permissions', 'TEXT');
  // Kiểu chấm công RIÊNG của nhân viên: '' = theo cài đặt chung | 'shift' = theo ca | 'hourly' = theo giờ
  add('employees', 'att_mode', "TEXT NOT NULL DEFAULT ''");
  // Lương theo giờ (dùng cho chế độ chấm công 'hourly')
  add('salary_configs', 'hourly_rate', 'REAL NOT NULL DEFAULT 0');
  // Đánh dấu bản ghi chấm công do admin thêm/sửa tay + ghi chú lý do
  add('attendance', 'manual', 'INTEGER NOT NULL DEFAULT 0');   // 1 = sửa/thêm bằng tay
  add('attendance', 'note',   "TEXT DEFAULT ''");               // lý do (quên chấm, công tác…)
  add('attendance', 'manual_at', 'TEXT');                        // thời điểm quản lý sửa/thêm giờ (để báo NV biết)
  add('attendance', 'manual_by', "TEXT DEFAULT ''");            // tên người sửa (quản lý/admin)

  // GĐ1: cấu hình tính công cho ca
  add('shifts', 'break_minutes',      'INTEGER NOT NULL DEFAULT 0');   // nghỉ giữa ca (phút)
  add('shifts', 'early_grace_min',    'INTEGER NOT NULL DEFAULT 15');  // ngưỡng về sớm
  add('shifts', 'work_unit_value',    'REAL NOT NULL DEFAULT 1.0');    // 1 ca/ngày=1.0, 2 ca/ngày=0.5
  add('shifts', 'allow_ot',           'INTEGER NOT NULL DEFAULT 0');   // ca này có tính OT?
  add('shifts', 'ot_start_after_min', 'INTEGER NOT NULL DEFAULT 30');  // ở lại tối thiểu để tính OT
  add('shifts', 'ot_rounding_unit',   'INTEGER NOT NULL DEFAULT 0');   // làm tròn OT (phút), 0=không
  // Tăng ca nâng cao (tham khảo Ronald Jack) — mặc định đều TẮT để không đổi kết quả cũ
  add('shifts', 'ot_before',       'INTEGER NOT NULL DEFAULT 0');    // 1 = tính tăng ca TRƯỚC giờ vào ca
  add('shifts', 'ot_before_min',   'INTEGER NOT NULL DEFAULT 30');   // đến sớm tối thiểu (phút) mới tính
  add('shifts', 'ot_tier1_min',    'INTEGER NOT NULL DEFAULT 0');    // giới hạn mức TC1 (phút), 0 = tất cả là TC1
  add('shifts', 'ot_tier2_min',    'INTEGER NOT NULL DEFAULT 0');    // giới hạn mức TC2 (phút), 0 = phần còn lại là TC2
  add('shifts', 'ot_tier3_min',    'INTEGER NOT NULL DEFAULT 0');    // giới hạn mức TC3 (phút), 0 = phần còn lại là TC3; dư → TC4
  add('shifts', 'ot_tier2_rate',   'REAL NOT NULL DEFAULT 0');       // hệ số lương TC2 (0 = theo hệ số OT ngày thường của NV)
  add('shifts', 'ot_tier3_rate',   'REAL NOT NULL DEFAULT 0');
  add('shifts', 'ot_tier4_rate',   'REAL NOT NULL DEFAULT 0');
  add('shifts', 'weekend_as_ot',   'INTEGER NOT NULL DEFAULT 0');    // 1 = làm ca này vào cuối tuần → cả ca là tăng ca
  add('shifts', 'holiday_as_ot',   'INTEGER NOT NULL DEFAULT 0');    // 1 = làm ca này ngày lễ → cả ca là tăng ca
  add('shifts', 'compensate_late', 'INTEGER NOT NULL DEFAULT 0');    // 1 = bù trừ: đi trễ thì về trễ bù lại, không bị trừ giờ
  // Lịch trình làm việc theo CHU KỲ (kiểu "Ca làm việc" của ZKBio): thứ nào / ngày nào làm ca nào.
  //   unit: 'auto' = nhóm ca, tự dò theo giờ chấm (kiểu cũ) | 'week' | 'day' | 'month'; cycle = số tuần/ngày/tháng lặp lại
  add('work_schedules', 'unit',  "TEXT NOT NULL DEFAULT 'auto'");
  add('work_schedules', 'cycle', 'INTEGER NOT NULL DEFAULT 1');
  db.exec(`CREATE TABLE IF NOT EXISTS work_schedule_days (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    work_schedule_id INTEGER NOT NULL REFERENCES work_schedules(id),
    idx              INTEGER NOT NULL,   -- ô trong chu kỳ: tuần = chukỳ*7 + (thứ-1) · ngày = thứ tự ngày · tháng = chukỳ*31 + (ngày-1)
    shift_id         INTEGER NOT NULL REFERENCES shifts(id),
    UNIQUE(work_schedule_id, idx, shift_id)
  )`);
  // LỊCH TRÌNH VÀO RA (kiểu Ronald Jack): cách xác định lượt quẹt nào là VÀO, lượt nào là RA — khai báo RIÊNG, không nằm trong ca.
  //   rule: filo (giờ đầu vào, giờ cuối ra) | pairs (tự động, không qua đêm) | tdqd (tự động, qua đêm) | idm (theo ID máy)
  //         | state (chọn từ máy: phím Check-In/Check-Out) | tdhc (theo khung giờ nhận vào/ra của ca)
  db.exec(`CREATE TABLE IF NOT EXISTS inout_schedules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT DEFAULT '',
    name        TEXT NOT NULL,
    rule        TEXT NOT NULL DEFAULT 'filo',
    min_minutes INTEGER NOT NULL DEFAULT 30,    -- thời gian nhỏ nhất giữa VÀO và RA (dưới mức này = quẹt lặp)
    max_minutes INTEGER NOT NULL DEFAULT 960,   -- thời gian lớn nhất của 1 cặp vào–ra
    gap_minutes INTEGER NOT NULL DEFAULT 30,    -- khoảng cách nhỏ nhất giữa 2 cặp vào–ra
    is_default  INTEGER NOT NULL DEFAULT 0,     -- dùng cho NV chưa được gán lịch trình vào ra nào
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  add('shift_assignments', 'inout_schedule_id', 'INTEGER');        // lịch trình vào ra gán kèm cho NV
  add('dept_shift_assignments', 'inout_schedule_id', 'INTEGER');   // … cho phòng ban
  // Nguồn của dòng phân ca theo NGÀY: 'sheet' = nhập ở bảng Xem lịch trình (kiểu Excel) / Nhập Excel — ƯU TIÊN CAO NHẤT;
  // 'temp' = Lịch trình tạm thời. Dòng cũ coi như 'sheet'.
  add('daily_shift_assignments', 'source', "TEXT NOT NULL DEFAULT 'sheet'");
  // Hai lớp nằm CHỒNG nhau: ô Excel đè lên lịch tạm thời; xoá ô Excel ("Về tự động") thì lịch tạm thời / lịch đã gán hiện lại.
  db.exec('DROP INDEX IF EXISTS uidx_dsa_emp_date_shift');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uidx_dsa_emp_date_src_shift ON daily_shift_assignments(employee_id, work_date, source, COALESCE(shift_id, 0))');
  // Phân ca theo ngày ĐANG CÓ HIỆU LỰC: ngày nào có ô Excel thì chỉ lấy ô Excel, không thì lấy lịch tạm thời
  db.exec(`CREATE VIEW IF NOT EXISTS dsa_effective AS
    SELECT d.* FROM daily_shift_assignments d
    WHERE d.source <> 'temp' OR NOT EXISTS (SELECT 1 FROM daily_shift_assignments x
      WHERE x.employee_id = d.employee_id AND x.work_date = d.work_date AND x.source <> 'temp')`);
  add('shifts', 'no_out_credit',   'INTEGER NOT NULL DEFAULT 0');    // 1 = thiếu giờ ra vẫn tính công (trừ phần đi trễ)
  add('shifts', 'grace_deduct',    'INTEGER NOT NULL DEFAULT 0');    // 1 = trễ/sớm chỉ tính phần VƯỢT số phút cho phép
  add('shifts', 'shift_as_ot',     'INTEGER NOT NULL DEFAULT 0');    // 1 = ca này là ca tăng ca (cả ca tính tăng ca, 0 công)

  // Phân ca làm việc: quy tắc ghép log máy + ca đêm (dùng cho ghép punch máy ZKTeco)
  add('shifts', 'merge_rule',    "TEXT NOT NULL DEFAULT 'filo'");   // filo|tdhc|idm|tdqd — quy tắc ghép log mặc định của ca
  add('shifts', 'cross_midnight', 'INTEGER NOT NULL DEFAULT 0');    // 1 = ca đêm qua ngày hôm sau
  add('shifts', 'break_start',    "TEXT DEFAULT ''");               // 'HH:MM' giờ BẮT ĐẦU nghỉ giữa ca ('' = không cố định giờ nghỉ)
  add('employees', 'start_date',      "TEXT DEFAULT ''");   // ngày vào làm (tính phép năm theo tháng + thâm niên)
  add('employees', 'leave_days_year', 'REAL');              // số ngày phép năm riêng (NULL = theo cài đặt chung)
  add('employees', 'audit_only', 'INTEGER NOT NULL DEFAULT 0');   // 1/2/3 = TÀI KHOẢN KIỂM TRA: chỉ xem công ảo MỨC đó, không thấy công thật, không sửa gì
  add('leave_requests', 'half',       "TEXT DEFAULT ''");   // '' cả ngày | 'sang' | 'chieu' (nửa ngày, chỉ khi từ ngày = đến ngày)
  // CHẾ ĐỘ ƯU ĐÃI (thai sản, nuôi con nhỏ…): trong [from_date, to_date] NV được đến muộn / về sớm số phút này, không trừ công
  db.exec(`CREATE TABLE IF NOT EXISTS employee_privileges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'Mang thai',
      from_date TEXT NOT NULL,
      to_date TEXT DEFAULT '',
      late_min INTEGER NOT NULL DEFAULT 0,      -- đầu ca được đến muộn
      mid_out_min INTEGER NOT NULL DEFAULT 0,   -- trước giờ nghỉ trưa được về sớm
      mid_in_min INTEGER NOT NULL DEFAULT 0,    -- sau giờ nghỉ trưa được đến muộn
      early_min INTEGER NOT NULL DEFAULT 0,     -- cuối ca được về sớm
      note TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_priv_emp ON employee_privileges(employee_id, from_date);`);
  // CHỐT KỲ công ảo: tháng lương đã chốt (audit_locks) + công ảo đã chốt lưu thành CỘT SỐ trong audit_lock_att:
  //   level 0 = dòng công lúc chốt (đủ cột), level 1–3 = chỉ những dòng mức đó khác level 0 (tăng ca, giờ vào/ra ảo, ẩn ngày).
  //   Giờ lưu số giây (epoch) cho nhẹ. audit_lock_sums = tổng tăng ca ảo đã chốt mỗi NV × tháng × mức (cho hạn mức NĂM).
  db.exec(`CREATE TABLE IF NOT EXISTS audit_locks (
      month TEXT PRIMARY KEY, from_date TEXT NOT NULL, to_date TEXT NOT NULL,
      locked_at TEXT NOT NULL DEFAULT (datetime('now')), locked_by TEXT DEFAULT '', rows INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS audit_lock_att (
      month TEXT NOT NULL, level INTEGER NOT NULL, employee_id INTEGER NOT NULL, work_date TEXT NOT NULL, i INTEGER NOT NULL,
      att_id INTEGER, shift_id INTEGER, cin INTEGER, cout INTEGER, late INTEGER, early INTEGER, ot INTEGER, ot_type TEXT,
      wmin INTEGER, wu REAL, day_status TEXT, manual INTEGER, hidden INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_ala ON audit_lock_att(level, employee_id, work_date);
    CREATE INDEX IF NOT EXISTS idx_ala_m ON audit_lock_att(month);
    CREATE TABLE IF NOT EXISTS audit_lock_sums (
      month TEXT NOT NULL, level INTEGER NOT NULL, employee_id INTEGER NOT NULL,
      thuong INTEGER DEFAULT 0, cuoi_tuan INTEGER DEFAULT 0, le INTEGER DEFAULT 0, PRIMARY KEY (month, level, employee_id)
    );
    DROP TABLE IF EXISTS audit_lock_rows;`);
  // CÔNG ẢO 3 mức: tăng ca tối đa (phút) mỗi NV × ngày × mức; work_date='*' = mức riêng của NV (mọi ngày chưa khai)
  db.exec(`CREATE TABLE IF NOT EXISTS audit_ot_max (
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      work_date   TEXT NOT NULL,
      level       INTEGER NOT NULL,
      minutes     INTEGER NOT NULL,
      PRIMARY KEY (employee_id, work_date, level)
    );`);
  // ĐĂNG KÝ LÀM THÊM: số phút đăng ký mỗi NV × ngày (xem server/ot-reg.js)
  // LÀM BÙ (hoán đổi ngày): NV đi làm ngày `work_date` (ngày nghỉ) để nghỉ ngày `off_date`. Ngày nghỉ bù = đơn nghỉ "Nghỉ bù" tự sinh (leave_requests.swap_id).
  db.exec(`CREATE TABLE IF NOT EXISTS swap_days (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      work_date   TEXT NOT NULL,      -- ngày ĐI LÀM bù (tính như ngày thường)
      off_date    TEXT NOT NULL,      -- ngày được NGHỈ bù
      note        TEXT DEFAULT '',
      created_by  TEXT DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(employee_id, work_date)
    );
    CREATE INDEX IF NOT EXISTS idx_swap_work ON swap_days(work_date);
    CREATE INDEX IF NOT EXISTS idx_swap_off ON swap_days(off_date);`);
  add('leave_requests', 'swap_id', 'INTEGER');                       // đơn "Nghỉ bù" tự sinh từ đăng ký làm bù
  add('public_holidays', 'kind', "TEXT NOT NULL DEFAULT 'le'");      // le = ngày lễ | bu = ngày nghỉ bù lễ (đi làm tính như ngày nghỉ hằng tuần)
  // LÝ DO NGHỈ tự khai báo (ngoài các loại có sẵn trong leave-quota.js)
  db.exec(`CREATE TABLE IF NOT EXISTS leave_types (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      sym        TEXT NOT NULL,             -- ký hiệu trên bảng công
      paid       INTEGER NOT NULL DEFAULT 0, -- 1 = có lương
      quota      INTEGER NOT NULL DEFAULT 0, -- 1 = trừ vào quỹ phép năm
      active     INTEGER NOT NULL DEFAULT 1, -- 0 = ẩn (không cho chọn nữa, đơn cũ vẫn giữ)
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`);
  db.exec(`CREATE TABLE IF NOT EXISTS ot_registrations (
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      work_date   TEXT NOT NULL,
      minutes     INTEGER NOT NULL,
      updated_by  TEXT NOT NULL DEFAULT '',
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (employee_id, work_date)
    );
    CREATE INDEX IF NOT EXISTS idx_otreg_date ON ot_registrations(work_date);`);
  // Ngày có LƯỢT CHẤM được thêm / sửa / xoá bằng tay (menu Sửa giờ chấm công) → hiện dấu (*) như giờ sửa tay
  db.exec(`CREATE TABLE IF NOT EXISTS att_edit_marks (
      employee_id INTEGER NOT NULL, work_date TEXT NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (employee_id, work_date));`);
  add('shifts', 'tdqd_mode',     "TEXT NOT NULL DEFAULT 'pair'");   // pair|idm — cách ghép log cho quy tắc TĐ-QĐ
  // Máy chấm công: số máy (IDM: máy lẻ = VÀO, máy chẵn = RA)
  add('push_devices', 'machine_number', 'INTEGER NOT NULL DEFAULT 0');
  add('departments', 'parent_id', 'INTEGER DEFAULT NULL');   // bộ phận cha - con

  // GĐ1: các chỉ số tính công lưu trên bản ghi chấm công
  add('attendance', 'early_min',  'INTEGER DEFAULT 0');
  add('attendance', 'ot_min',     'INTEGER DEFAULT 0');
  add('attendance', 'work_unit',  'REAL DEFAULT 0');
  add('attendance', 'day_status', "TEXT DEFAULT NULL");   // lam_viec | thieu_ra | nghi_le ...
  add('attendance', 'ot_type',    "TEXT DEFAULT 'thuong'"); // thuong | cuoi_tuan | le
  // Tăng ca THỰC TẾ (trước khi chặn theo đăng ký làm thêm); ot_min = tăng ca được tính. Dòng cũ: thực tế = được tính.
  if (!cols('attendance').has('ot_raw_min')) { add('attendance', 'ot_raw_min', 'INTEGER'); db.exec('UPDATE attendance SET ot_raw_min = ot_min WHERE ot_min > 0'); }

  // Máy chấm công: mốc OperLog đã nhận (để máy chỉ đẩy thao tác/vân tay mới hơn)
  add('push_devices', 'oper_stamp', "TEXT DEFAULT '0'");
  // Nhóm đồng bộ máy↔máy: các máy cùng nhãn nhóm sẽ tự đồng bộ NV/vân tay/thẻ/mật mã/khuôn mặt cho nhau (rỗng=không đồng bộ)
  add('push_devices', 'sync_group', "TEXT DEFAULT ''");
  // Máy có chức năng kiểm soát cửa (access control) → hiện nút "Mở cửa từ xa" (lệnh ADMS AC_UNLOCK)
  add('push_devices', 'access_control', 'INTEGER NOT NULL DEFAULT 0');
  // Key BẢN QUYỀN theo MÁY (Ed25519, Digiplus cấp theo serial): rỗng = chưa có key.
  // Khi bật "device_key_required", máy phải có key hợp lệ mới DUYỆT được (chống khách tự mua máy ngoài).
  add('push_devices', 'dev_key', "TEXT DEFAULT ''");
  // Quyền của user TRÊN TỪNG MÁY (0 = nhân viên, >0 = quản trị máy). Quản trị cơ sở này KHÔNG tự lan sang máy khác.
  add('device_users_serial', 'privilege', 'INTEGER DEFAULT 0');
  // Dải Số ID của máy (VD '1001-1999', rỗng = không giới hạn): máy đăng ký số ngoài dải → cảnh báo nghi trùng
  add('push_devices', 'pin_range', "TEXT DEFAULT ''");
  // Máy có NHẬN NV mới khai trên phần mềm (tự đẩy Số ID + tên xuống) không — 1 = nhận (mặc định)
  add('push_devices', 'recv_new', 'INTEGER NOT NULL DEFAULT 1');
  // CẢNH BÁO TRÙNG SỐ ID (công tắc device_pin_guard, mặc định bật): 1 dòng = máy `serial` vừa đăng ký Số ID `pin` đã có chủ.
  // Trong lúc chờ xử lý: Số ID đó không đồng bộ từ/xuống máy này, lượt quẹt ở máy này (từ `since`) bị giữ lại.
  db.exec(`CREATE TABLE IF NOT EXISTS device_pin_conflicts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      serial      TEXT NOT NULL,
      pin         TEXT NOT NULL,
      reason      TEXT NOT NULL DEFAULT 'enroll',   -- enroll (máy đăng ký số đã có chủ) | name (tên khác hẳn) | range (ngoài dải)
      ref_name    TEXT DEFAULT '',                  -- tên đang dùng Số ID này lúc phát hiện
      dev_name    TEXT DEFAULT '', dev_card TEXT DEFAULT '', dev_passwd TEXT DEFAULT '', dev_pri INTEGER DEFAULT 0,
      dev_photo   TEXT DEFAULT '', dev_photo_kind TEXT DEFAULT '', dev_face_type INTEGER DEFAULT 0,
      since       TEXT NOT NULL,                    -- ISO UTC: lượt quẹt của Số ID này ở máy này từ mốc này bị giữ
      status      TEXT NOT NULL DEFAULT 'open',     -- open | moving (đang cấp số mới) | moved | same | failed | dropped
      new_pin     TEXT DEFAULT '', new_emp_id INTEGER, note TEXT DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT, resolved_by TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_pinconf_sp ON device_pin_conflicts(serial, pin);
    -- Quy tắc đổi Số ID của lượt quẹt máy gửi về: Số ID \`pin\` ở máy \`serial\` trong [from_at, to_at) → \`new_pin\`
    CREATE TABLE IF NOT EXISTS device_pin_remaps (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      serial      TEXT NOT NULL, pin TEXT NOT NULL,
      from_at     TEXT NOT NULL, to_at TEXT,        -- ISO UTC; to_at NULL = đến nay
      new_pin     TEXT NOT NULL, conflict_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_pinremap_sp ON device_pin_remaps(serial, pin);`);
  // Giờ đọc từ máy (nút "Xem giờ trên máy"): clock_text = giờ máy trả về, clock_at = giờ máy chủ (VN) lúc nhận
  add('push_devices', 'clock_text', "TEXT DEFAULT ''");
  add('push_devices', 'clock_at',   "TEXT DEFAULT ''");
  add('push_devices', 'clock_raw',  "TEXT DEFAULT ''");
  // Máy kết nối TRỰC TIẾP TCP/IP (SDK zkemkeeper, cổng 4370): conn_type 'push' (máy tự đẩy, mặc định) | 'tcp' (phần mềm chủ động kết nối)
  add('push_devices', 'conn_type',   "TEXT NOT NULL DEFAULT 'push'");
  add('push_devices', 'tcp_ip',      "TEXT DEFAULT ''");
  add('push_devices', 'tcp_port',    'INTEGER NOT NULL DEFAULT 4370');
  add('push_devices', 'tcp_key',     'INTEGER NOT NULL DEFAULT 0');   // mật mã kết nối (Comm Key) đặt trên máy, 0 = không đặt
  add('push_devices', 'tcp_info',    "TEXT DEFAULT ''");              // JSON thông tin + dung lượng đọc lần gần nhất
  add('push_devices', 'tcp_sync_at', "TEXT DEFAULT ''");              // lần tải lượt chấm gần nhất
  // TỰ ĐỘNG TẢI theo lịch (Cài đặt tcp_auto_min = số phút / lần, 0 = tắt): bật riêng từng máy + kết quả lần chạy gần nhất
  add('push_devices', 'tcp_auto',       'INTEGER NOT NULL DEFAULT 1');
  add('push_devices', 'tcp_auto_at',    "TEXT DEFAULT ''");
  add('push_devices', 'tcp_auto_msg',   "TEXT DEFAULT ''");
  add('push_devices', 'tcp_auto_ok',    'INTEGER NOT NULL DEFAULT 1');
  add('push_devices', 'tcp_auto_logs',  'INTEGER NOT NULL DEFAULT -1');   // số lượt chấm trên máy ở lần tự tải gần nhất (không đổi → khỏi tải)
  add('push_devices', 'tcp_auto_users', 'INTEGER NOT NULL DEFAULT -1');
  // Lệnh đồng bộ mang theo "đối tượng" để CHỈ cộng số đếm khi máy XÁC NHẬN đã nhận (chống đếm khống)
  add('push_device_commands', 'pin',      "TEXT DEFAULT ''");
  add('push_device_commands', 'bio_type', 'INTEGER');
  add('push_device_commands', 'idx',      'INTEGER');
  add('push_device_commands', 'mkind',    "TEXT DEFAULT ''");   // 'user' | 'bio' | 'photo' (mirror khi ack OK)
  // Index khớp NV theo Số ID máy
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_emp_device_pin ON employees(device_pin)'); } catch {}

  // PHÂN HỆ NHÂN SỰ (hồ sơ, hợp đồng, thuyên chuyển / nghỉ việc) — bảng riêng, không đụng dữ liệu chấm công
  // Ngày nghỉ việc (ngày ĐẦU TIÊN không còn làm) — chỉ phân hệ Nhân sự ghi; rỗng = chưa nghỉ / khoá theo kiểu cũ
  add('employees', 'leave_date', "TEXT NOT NULL DEFAULT ''");
  db.exec(`CREATE TABLE IF NOT EXISTS hr_profiles (
      employee_id INTEGER PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
      updated_by  TEXT NOT NULL DEFAULT '',
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS hr_family (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      full_name   TEXT NOT NULL,
      relation    TEXT NOT NULL DEFAULT '',
      birth_date  TEXT NOT NULL DEFAULT '',
      phone       TEXT NOT NULL DEFAULT '',
      job         TEXT NOT NULL DEFAULT '',
      dependent   INTEGER NOT NULL DEFAULT 0,   -- 1 = người phụ thuộc (giảm trừ gia cảnh)
      note        TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS hr_documents (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      kind        TEXT NOT NULL DEFAULT '',
      title       TEXT NOT NULL DEFAULT '',
      file_name   TEXT NOT NULL,                -- tên file lưu trong data/hr-files/<employee_id>/
      orig_name   TEXT NOT NULL DEFAULT '',
      mime        TEXT NOT NULL DEFAULT '',
      size        INTEGER NOT NULL DEFAULT 0,
      uploaded_by TEXT NOT NULL DEFAULT '',
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS hr_contracts (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id      INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      contract_no      TEXT NOT NULL DEFAULT '',
      ctype            TEXT NOT NULL,             -- thu_viec | xac_dinh | khong_xac_dinh | dich_vu (server/hr-rules.js)
      term_months      INTEGER NOT NULL DEFAULT 0,
      sign_date        TEXT NOT NULL DEFAULT '',
      start_date       TEXT NOT NULL,
      end_date         TEXT NOT NULL DEFAULT '',  -- rỗng = không xác định thời hạn
      department       TEXT NOT NULL DEFAULT '',
      position         TEXT NOT NULL DEFAULT '',
      work_place       TEXT NOT NULL DEFAULT '',
      salary           REAL NOT NULL DEFAULT 0,   -- lương thoả thuận
      insurance_salary REAL NOT NULL DEFAULT 0,   -- lương đóng BHXH
      allowance        TEXT NOT NULL DEFAULT '',
      signer           TEXT NOT NULL DEFAULT '',  -- người đại diện công ty ký
      note             TEXT NOT NULL DEFAULT '',
      parent_id        INTEGER,                   -- HĐ trước (khi tái ký)
      terminated_date  TEXT NOT NULL DEFAULT '',  -- chấm dứt KỂ TỪ ngày này
      terminate_reason TEXT NOT NULL DEFAULT '',
      created_by       TEXT NOT NULL DEFAULT '',
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_hrc_emp ON hr_contracts(employee_id);
    CREATE TABLE IF NOT EXISTS hr_contract_annexes (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id    INTEGER NOT NULL REFERENCES hr_contracts(id) ON DELETE CASCADE,
      annex_no       TEXT NOT NULL DEFAULT '',
      sign_date      TEXT NOT NULL DEFAULT '',
      effective_date TEXT NOT NULL DEFAULT '',
      salary         REAL NOT NULL DEFAULT 0,     -- lương mới (0 = không đổi)
      position       TEXT NOT NULL DEFAULT '',    -- chức danh mới (rỗng = không đổi)
      content        TEXT NOT NULL DEFAULT '',
      created_by     TEXT NOT NULL DEFAULT '',
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS hr_decisions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id     INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      kind            TEXT NOT NULL,              -- transfer (thuyên chuyển) | resign (nghỉ việc)
      sub_kind        TEXT NOT NULL DEFAULT '',
      decision_no     TEXT NOT NULL DEFAULT '',
      decision_date   TEXT NOT NULL DEFAULT '',
      effective_date  TEXT NOT NULL,              -- ngày hiệu lực (nghỉ việc: ngày đầu tiên không còn làm)
      signer          TEXT NOT NULL DEFAULT '',
      from_department TEXT NOT NULL DEFAULT '',
      to_department   TEXT NOT NULL DEFAULT '',
      from_position   TEXT NOT NULL DEFAULT '',
      to_position     TEXT NOT NULL DEFAULT '',
      request_date    TEXT NOT NULL DEFAULT '',   -- nghỉ việc: ngày nộp đơn
      reason          TEXT NOT NULL DEFAULT '',
      note            TEXT NOT NULL DEFAULT '',
      handover        TEXT NOT NULL DEFAULT '[]', -- JSON [{t, done}] — việc bàn giao khi nghỉ
      end_contract    INTEGER NOT NULL DEFAULT 1, -- nghỉ việc: chấm dứt HĐ đang hiệu lực
      lock_account    INTEGER NOT NULL DEFAULT 1, -- nghỉ việc: khoá tài khoản chấm công từ ngày nghỉ
      status          TEXT NOT NULL DEFAULT 'pending', -- pending | applied | cancelled
      applied_at      TEXT NOT NULL DEFAULT '',
      created_by      TEXT NOT NULL DEFAULT '',
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_hrd_emp ON hr_decisions(employee_id);
    CREATE INDEX IF NOT EXISTS idx_hrd_status ON hr_decisions(status, effective_date);
    -- Nhắc HĐ sắp hết hạn đã gửi (mỗi mốc 1 lần; đổi ngày hết hạn thì nhắc lại) — server/hr-remind.js
    CREATE TABLE IF NOT EXISTS hr_reminders (
      contract_id INTEGER NOT NULL REFERENCES hr_contracts(id) ON DELETE CASCADE,
      stage       TEXT NOT NULL,                -- warn | d7 | expired
      end_date    TEXT NOT NULL DEFAULT '',
      sent_at     TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (contract_id, stage, end_date)
    );`);
  for (const k of HR_FIELD_KEYS) add('hr_profiles', k, "TEXT NOT NULL DEFAULT ''");   // mỗi trường hồ sơ 1 cột
  // Công tắc PHÂN HỆ NHÂN SỰ: mặc định TẮT (ẩn hẳn), chỉ tài khoản tổng bật trong Cài đặt.
  // Đặt 1 lần: bản 1.20.1–1.20.2 đã nhập dữ liệu nhân sự thì giữ BẬT để không "mất" dữ liệu trước mắt khách.
  if (getSetting('hr_enabled') == null) {
    const used = db.prepare(`SELECT (SELECT COUNT(*) FROM hr_contracts) + (SELECT COUNT(*) FROM hr_decisions)
        + (SELECT COUNT(*) FROM hr_profiles) + (SELECT COUNT(*) FROM hr_documents) AS n`).get().n;
    setSetting('hr_enabled', used > 0 ? '1' : '0');
  }

  // PHÂN HỆ QUẢN LÝ SUẤT ĂN (server/meal.js) — bảng RIÊNG, chỉ ĐỌC chấm công + đăng ký làm thêm, không ghi đè dữ liệu công.
  // Công tắc `meal_enabled` mặc định TẮT (không ghi vào settings: thiếu = '0'), chỉ tài khoản tổng bật. Tắt: không route, không menu.
  db.exec(`
    CREATE TABLE IF NOT EXISTS meal_shifts (          -- 3 ca ăn + giờ chốt (HR đổi được); dòng mặc định tạo khi phân hệ được bật lần đầu
      code       TEXT PRIMARY KEY,                    -- trua | chieu | dem
      name       TEXT NOT NULL,
      from_time  TEXT NOT NULL,                       -- 'HH:MM' bắt đầu khung giờ chốt
      to_time    TEXT NOT NULL,                       -- 'HH:MM' giờ chốt (nhỏ hơn from_time = qua nửa đêm)
      mode       TEXT NOT NULL DEFAULT 'punch',       -- punch = đối chiếu lượt chấm công · ot = đối chiếu đăng ký làm thêm
      enabled    INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS meal_registrations (   -- số suất ăn trưởng bộ phận đăng ký (HR sửa / nhập hộ được)
      department TEXT NOT NULL,
      work_date  TEXT NOT NULL,
      shift      TEXT NOT NULL,
      count      INTEGER NOT NULL,
      note       TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (department, work_date, shift)
    );
    CREATE INDEX IF NOT EXISTS idx_mealreg_date ON meal_registrations(work_date, shift);
    CREATE TABLE IF NOT EXISTS meal_closings (        -- HR đã CHỐT số suất của ngày + ca (khoá sửa; mở lại mới sửa được)
      work_date  TEXT NOT NULL,
      shift      TEXT NOT NULL,
      total      INTEGER NOT NULL DEFAULT 0,
      snapshot   TEXT NOT NULL DEFAULT '',            -- JSON bảng đối chiếu lúc chốt
      closed_by  TEXT NOT NULL DEFAULT '',
      closed_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (work_date, shift)
    );
    CREATE TABLE IF NOT EXISTS meal_dept_heads (      -- ai là TRƯỞNG BỘ PHẬN (được nhập đăng ký cho bộ phận đó và bộ phận con)
      department  TEXT NOT NULL,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      PRIMARY KEY (department, employee_id)
    );
    CREATE TABLE IF NOT EXISTS meal_menu (            -- món của từng ca từng ngày
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      work_date  TEXT NOT NULL,
      shift      TEXT NOT NULL,
      name       TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      UNIQUE(work_date, shift, name)
    );
    CREATE TABLE IF NOT EXISTS meal_orders (          -- món nhân viên đã chọn trên app (tên món lưu kèm để màn hình bếp không mất khi sửa thực đơn)
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      work_date   TEXT NOT NULL,
      shift       TEXT NOT NULL,
      menu_id     INTEGER,
      dish        TEXT NOT NULL,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (employee_id, work_date, shift)
    );
    CREATE INDEX IF NOT EXISTS idx_mealord_date ON meal_orders(work_date, shift);`);
  // Hạn chọn món của từng ca (meal-rules.js orderDeadlineMs): lock_at 'HH:MM' = khoá lúc giờ cố định (muộn hơn giờ bắt đầu = hôm trước);
  // không có lock_at = khoá trước giờ bắt đầu khung ăn lock_before_min phút (0 = đúng lúc bắt đầu, như bản cũ)
  add('meal_shifts', 'lock_before_min', 'INTEGER NOT NULL DEFAULT 0');
  add('meal_shifts', 'lock_at',         "TEXT NOT NULL DEFAULT ''");
  // HR chọn món HỘ nhân viên (quên đăng ký / điện thoại hỏng): set_by = tên HR; '' = nhân viên tự chọn trên app
  add('meal_orders', 'set_by', "TEXT NOT NULL DEFAULT ''");
  db.exec(`
    CREATE TABLE IF NOT EXISTS meal_adjust (          -- HR điều chỉnh SỐ SUẤT của 1 món (+ thêm / − bớt) cho ngày + ca; dish '' = suất không chọn món (mặc định)
      work_date  TEXT NOT NULL,
      shift      TEXT NOT NULL,
      dish       TEXT NOT NULL,
      qty        INTEGER NOT NULL,
      note       TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (work_date, shift, dish)
    );
    CREATE TABLE IF NOT EXISTS meal_adjust_log (      -- LƯU VẾT mọi chỉnh tay của HR (điều chỉnh số suất / chọn món hộ): ai, lúc nào, cũ → mới, lý do
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      at          TEXT NOT NULL DEFAULT (datetime('now')),
      by_name     TEXT NOT NULL DEFAULT '',
      work_date   TEXT NOT NULL,
      shift       TEXT NOT NULL,
      kind        TEXT NOT NULL,                      -- 'adjust' = sửa số suất món · 'order' = chọn món hộ NV
      dish        TEXT NOT NULL DEFAULT '',
      employee_id INTEGER,
      emp_label   TEXT NOT NULL DEFAULT '',           -- "Mã - Họ tên" lúc ghi (NV bị xoá vẫn đọc được)
      old_value   TEXT NOT NULL DEFAULT '',
      new_value   TEXT NOT NULL DEFAULT '',
      reason      TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_mealadjlog_date ON meal_adjust_log(work_date, shift);`);
  // ĐĂNG KÝ ĂN (không chọn món) + NHIỀU BẾP. Mỗi dòng meal_orders = 1 người đăng ký ăn bữa đó; dish '' = chỉ đăng ký ăn, không chọn món.
  //   open_at 'HH:MM' = giờ MỞ đăng ký (lần gần nhất trước hạn khoá; '' = luôn mở như cũ) · custom = bữa HR tự thêm (xoá được)
  add('meal_shifts', 'open_at', "TEXT NOT NULL DEFAULT ''");
  add('meal_shifts', 'custom',  'INTEGER NOT NULL DEFAULT 0');
  add('meal_orders', 'created_at', "TEXT NOT NULL DEFAULT ''");   // giờ đăng ký LẦN ĐẦU (đổi món không đổi giờ này)
  add('meal_orders', 'kitchen_id', 'INTEGER');                     // bếp của NV lúc đăng ký (HR đổi bếp → đơn từ hôm nay trở đi theo bếp mới)
  db.exec(`
    CREATE TABLE IF NOT EXISTS meal_kitchens (        -- danh mục BẾP (VD Bếp 1, Bếp 2); không có bếp nào = 1 bếp chung như cũ
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      serials    TEXT NOT NULL DEFAULT '',            -- máy chấm ăn đặt ở bếp này (serial, cách nhau dấu phẩy); '' = không gán máy
      screen_key TEXT NOT NULL DEFAULT '',            -- mã màn hình bếp RIÊNG của bếp này (/bep/MÃ chỉ hiện người của bếp)
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS meal_emp_kitchen (     -- nhân viên ăn ở bếp nào
      employee_id INTEGER PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
      kitchen_id  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meal_extra (           -- HR THÊM / BỚT SUẤT bằng tay theo bếp (khách, đối tác, NV mới…) — chế độ chỉ đăng ký ăn
      work_date  TEXT NOT NULL,
      shift      TEXT NOT NULL,
      kitchen_id INTEGER NOT NULL DEFAULT 0,          -- 0 = chung / chưa phân bếp
      qty        INTEGER NOT NULL,
      note       TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (work_date, shift, kitchen_id)
    );
    CREATE TABLE IF NOT EXISTS meal_dispatch (        -- lần GỬI BẾP gần nhất của 1 bữa: tổng số + số từng bếp (JSON) + giờ gửi đầu / gần nhất
      work_date  TEXT NOT NULL,
      shift      TEXT NOT NULL,
      total      INTEGER NOT NULL DEFAULT 0,
      detail     TEXT NOT NULL DEFAULT '',            -- JSON { "<kitchen_id>": số suất }
      first_at   TEXT NOT NULL DEFAULT (datetime('now')),
      sent_at    TEXT NOT NULL DEFAULT (datetime('now')),
      sent_by    TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (work_date, shift)
    );`);

  // Cấu hình mặc định
  if (getSetting('weekend_days') == null) setSetting('weekend_days', '7');       // CN
  if (getSetting('weekend_work_as_ot') == null) setSetting('weekend_work_as_ot', '1');   // đi làm ngày cuối tuần = tăng ca (8 giờ = 1 công)
  if (getSetting('workunit_rounding') == null) setSetting('workunit_rounding', '2'); // số lẻ thập phân
  if (getSetting('workunit_rounding_mode') == null) setSetting('workunit_rounding_mode', '0'); // 0=lùi(floor),1=tới(ceil),2=gần nhất(round)
  if (getSetting('pay_period_start_day') == null) setSetting('pay_period_start_day', '1'); // ngày bắt đầu kỳ lương
  // Geofence: '0' = chấm tự do (mặc định); '1' = chỉ cho chấm trong bán kính chi nhánh
  if (getSetting('geofence_enforce') == null) setSetting('geofence_enforce', '0');
  // Máy chấm công (ZKTeco ADMS push): '0' = không dùng (mặc định), '1' = dùng máy chấm công
  if (getSetting('device_enabled') == null) setSetting('device_enabled', '0');
  // Chấm công điện thoại (selfie + định vị GPS): '1' = dùng (mặc định), '0' = tắt (chỉ dùng máy chấm công)
  if (getSetting('phone_enabled') == null) setSetting('phone_enabled', '1');
  // Tính công cho cả tài khoản Admin: '0' = KHÔNG (mặc định, admin là chủ/quản trị), '1' = tính công cả admin
  if (getSetting('payroll_include_admin') == null) setSetting('payroll_include_admin', '0');
  // Tự tạo NV khi máy đăng ký vân tay: '1' = tự tạo NV nháp (mặc định), '0' = chỉ ghi nhận chờ gán tay
  if (getSetting('device_autocreate') == null) setSetting('device_autocreate', '1');
  // Bắt buộc KEY theo máy: '0' = tắt (mặc định, giữ khách cũ chạy), '1' = máy phải có key Digiplus cấp mới duyệt được
  // MẶC ĐỊNH BẬT yêu cầu key nếu bộ cài bật máy chấm công (USE_DEVICE=1) → chống khách mua máy ngoài.
  // Chỉ đặt LẦN ĐẦU (khi null); tài khoản tổng vẫn tắt được sau. Bản cũ/không có USE_DEVICE → '0' như trước.
  if (getSetting('device_key_required') == null) setSetting('device_key_required', process.env.USE_DEVICE === '1' ? '1' : '0');
  // Khoá thiết bị chấm công điện thoại (chống chấm hộ): '0' = tắt (mặc định), '1' = mỗi tài khoản chỉ chấm trên 1 điện thoại đã duyệt
  if (getSetting('device_lock_enabled') == null) setSetting('device_lock_enabled', '0');
  // Bỏ qua lần chấm TRÙNG trong vòng N phút (chống double-tap app + máy quẹt liên tiếp). '0' = tắt.
  // Bỏ lần chấm trùng trong N phút: mặc định 15. Bản cũ mặc định 0 (tắt) → chuyển MỘT LẦN sang 15;
  // sau đó quản trị tự đặt lại 0 thì vẫn được giữ.
  if (getSetting('punch_dedup_default15') == null) {
    const cur = getSetting('punch_dedup_min');
    if (cur == null || String(cur).trim() === '' || String(cur) === '0') setSetting('punch_dedup_min', '15');
    setSetting('punch_dedup_default15', '1');
  }
  // Nhân viên tự chọn ca: '0' = tắt (mặc định), '1' = cho nhân viên tự đăng ký ca trên app
  if (getSetting('self_shift_enabled') == null) setSetting('self_shift_enabled', '0');
  // Chọn ca có cần duyệt không: '1' = phải admin/quản lý duyệt (mặc định), '0' = tự động áp dụng
  if (getSetting('self_shift_approve') == null) setSetting('self_shift_approve', '1');
  // Tự động sao lưu dữ liệu hằng ngày
  if (getSetting('backup_enabled') == null)   setSetting('backup_enabled', '1');   // bật auto-backup
  if (getSetting('backup_hour') == null)      setSetting('backup_hour', '2');      // 2h sáng
  if (getSetting('backup_keep_days') == null) setSetting('backup_keep_days', '7'); // giữ 7 bản gần nhất
  if (getSetting('backup_last_date') == null) setSetting('backup_last_date', '');   // ngày backup gần nhất (chống backup trùng)

  // Nạp bộ phận từ dữ liệu nhân viên đang có (chỉ lần đầu)
  if (db.prepare('SELECT COUNT(*) c FROM departments').get().c === 0) {
    const names = db.prepare("SELECT DISTINCT department FROM employees WHERE department IS NOT NULL AND department != ''").all();
    const ins = db.prepare('INSERT OR IGNORE INTO departments(name) VALUES(?)');
    for (const r of names) ins.run(r.department);
  }

  // Chức năng chấm công đặt SẴN theo bộ cài (config.txt) — KHÔNG cần đăng nhập tài khoản tổng.
  //   USE_DEVICE=1/0 -> bật/tắt máy chấm công ; USE_PHONE=1/0 -> bật/tắt chấm công điện thoại.
  //   Chỉ là GIÁ TRỊ BAN ĐẦU: áp khi config ghi rõ '0'/'1' VÀ khác lần áp trước (mới cài / vừa sửa config.txt).
  //   Sau đó tài khoản tổng đổi trên web (Cài đặt › Hình thức chấm công) thì giữ nguyên qua các lần khởi động lại.
  const applyEnvFlag = (envName, settingName) => {
    const v = process.env[envName];
    if (v !== '0' && v !== '1') return;
    const mark = 'cfg_applied_' + envName;
    if (getSetting(mark) === v) return;
    setSetting(settingName, v);
    setSetting(mark, v);
  };
  applyEnvFlag('USE_DEVICE', 'device_enabled');
  applyEnvFlag('USE_PHONE', 'phone_enabled');
}

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

// Kiểu chấm công THỰC TẾ của 1 nhân viên: đặt riêng ở hồ sơ ('shift' | 'hourly'), không đặt thì theo cài đặt chung.
// → công ty vừa có người chấm theo ca vừa có người chấm theo giờ vẫn tính đúng cho từng người.
// Phòng ban đi làm NGÀY CUỐI TUẦN vẫn tính như ngày thường (VD bảo vệ trực CN) — Cài đặt > Quy tắc tính công
export function weekendNormalDepts() {
  try { const a = JSON.parse(getSetting('weekend_normal_depts', '[]')); return Array.isArray(a) ? a.map(String) : []; } catch { return []; }
}
export function isWeekendNormalEmp(empId) {
  const list = weekendNormalDepts();
  if (!list.length || !empId) return false;
  const e = db.prepare('SELECT department FROM employees WHERE id=?').get(empId);
  return !!(e && list.includes(String(e.department || '')));
}

export const globalAttMode = () => (getSetting('attendance_mode', 'shift') === 'hourly' ? 'hourly' : 'shift');
export function empAttMode(employeeId) {
  const g = globalAttMode();
  if (!employeeId) return g;
  const r = db.prepare('SELECT att_mode FROM employees WHERE id = ?').get(employeeId);
  return r && (r.att_mode === 'shift' || r.att_mode === 'hourly') ? r.att_mode : g;
}
export const empHourly = (employeeId) => empAttMode(employeeId) === 'hourly';
// Công ty hiện có nhân viên chấm theo ca / theo giờ không (giao diện dựa vào đây để hiện mục Ca làm, Phân ca…)
export function attModeMix() {
  const g = globalAttMode();
  const c = db.prepare("SELECT SUM(att_mode='shift') s, SUM(att_mode='hourly') h, COUNT(*) n FROM employees WHERE active=1 AND role<>'admin'").get() || {};
  const s = c.s || 0, h = c.h || 0, rest = (c.n || 0) - s - h;   // rest = số NV theo cài đặt chung
  return {
    any_shift: s > 0 || (g === 'shift' && (rest > 0 || !c.n)),
    any_hourly: h > 0 || (g === 'hourly' && (rest > 0 || !c.n)),
  };
}

export function setSetting(key, value) {
  db.prepare(`INSERT INTO settings(key, value) VALUES(?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(value));
}

// Mệnh đề SQL loại tài khoản Admin khỏi tính công/báo cáo/lương/phân ca.
// Mặc định bỏ Admin; bật setting 'payroll_include_admin'='1' thì TÍNH CÔNG cho cả Admin (trả '').
// col: tên cột role (vd 'role' hoặc 'e.role' khi join có alias).
// Tên các bộ phận + MỌI bộ phận con của chúng (cây departments.parent_id): lọc theo phòng ban cha là gồm cả con
export function deptWithChildren(names) {
  const list = [...new Set((names || []).filter(Boolean))];
  if (!list.length) return list;
  const all = db.prepare('SELECT id, name, parent_id FROM departments').all();
  const kids = new Map();
  for (const d of all) { const k = d.parent_id || 0; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(d); }
  const out = new Set(list);
  const walk = (id, depth) => { if (depth > 20) return; for (const c of kids.get(id) || []) { out.add(c.name); walk(c.id, depth + 1); } };
  const want = new Set(list.map((n) => n.normalize('NFC')));
  for (const d of all) if (want.has(d.name.normalize('NFC'))) walk(d.id, 0);
  for (const n of [...out]) { out.add(n.normalize('NFC')); out.add(n.normalize('NFD')); }   // tên nhập từ Excel có thể ở dạng dấu tách rời (NFD)
  return [...out];
}

export function adminAttWhere(col = 'role') {
  const p = col.includes('.') ? col.slice(0, col.indexOf('.') + 1) : '';
  return (getSetting('payroll_include_admin', '0') === '1' ? '' : ` AND ${col}!='admin'`) + ` AND IFNULL(${p}audit_only,0)=0`;
}

// Điều kiện "NV có đi làm trong kỳ bắt đầu từ ngày ?" cho bảng công / báo cáo / lương: đang làm, HOẶC đã nghỉ việc qua
// phân hệ Nhân sự (có leave_date) SAU ngày đầu kỳ → tháng cuối vẫn còn công. NV khoá kiểu cũ (leave_date rỗng) loại như trước.
// Dùng: `WHERE ${EMP_IN_PERIOD} ...` và truyền ngày đầu kỳ làm tham số ĐẦU TIÊN.
export const EMP_IN_PERIOD = "(active = 1 OR (leave_date <> '' AND leave_date > ?))";

// Danh sách định vị (văn phòng) mà NV được phép chấm. Chưa cấu hình → TẤT CẢ định vị đang bật.
export function allowedOffices(employeeId) {
  const rows = db.prepare(`SELECT o.* FROM employee_offices eo JOIN offices o ON o.id = eo.office_id
    WHERE eo.employee_id = ? AND o.active = 1 ORDER BY o.name`).all(employeeId);
  if (rows.length) return rows;
  return db.prepare('SELECT * FROM offices WHERE active = 1 ORDER BY name').all();
}
