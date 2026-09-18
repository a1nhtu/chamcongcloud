// Lớp truy cập dữ liệu — dùng SQLite tích hợp sẵn của Node (node:sqlite)
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, copyFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
export const DATA_DIR = join(ROOT, 'data');
mkdirSync(DATA_DIR, { recursive: true });

export const DB_PATH = process.env.DB_PATH || join(DATA_DIR, 'digiplus.db');

// PHỤC HỒI: nếu có file chờ (.restore) → thay CSDL trước khi mở (an toàn, làm 1 lần lúc khởi động)
const RESTORE_FILE = DB_PATH + '.restore';
if (existsSync(RESTORE_FILE)) {
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
  // Lương theo giờ (dùng cho chế độ chấm công 'hourly')
  add('salary_configs', 'hourly_rate', 'REAL NOT NULL DEFAULT 0');
  // Đánh dấu bản ghi chấm công do admin thêm/sửa tay + ghi chú lý do
  add('attendance', 'manual', 'INTEGER NOT NULL DEFAULT 0');   // 1 = sửa/thêm bằng tay
  add('attendance', 'note',   "TEXT DEFAULT ''");               // lý do (quên chấm, công tác…)

  // GĐ1: cấu hình tính công cho ca
  add('shifts', 'break_minutes',      'INTEGER NOT NULL DEFAULT 0');   // nghỉ giữa ca (phút)
  add('shifts', 'early_grace_min',    'INTEGER NOT NULL DEFAULT 15');  // ngưỡng về sớm
  add('shifts', 'work_unit_value',    'REAL NOT NULL DEFAULT 1.0');    // 1 ca/ngày=1.0, 2 ca/ngày=0.5
  add('shifts', 'allow_ot',           'INTEGER NOT NULL DEFAULT 0');   // ca này có tính OT?
  add('shifts', 'ot_start_after_min', 'INTEGER NOT NULL DEFAULT 30');  // ở lại tối thiểu để tính OT
  add('shifts', 'ot_rounding_unit',   'INTEGER NOT NULL DEFAULT 0');   // làm tròn OT (phút), 0=không

  // Phân ca làm việc: quy tắc ghép log máy + ca đêm (dùng cho ghép punch máy ZKTeco)
  add('shifts', 'merge_rule',    "TEXT NOT NULL DEFAULT 'filo'");   // filo|tdhc|idm|tdqd — quy tắc ghép log mặc định của ca
  add('shifts', 'cross_midnight', 'INTEGER NOT NULL DEFAULT 0');    // 1 = ca đêm qua ngày hôm sau
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

  // Máy chấm công: mốc OperLog đã nhận (để máy chỉ đẩy thao tác/vân tay mới hơn)
  add('push_devices', 'oper_stamp', "TEXT DEFAULT '0'");
  // Nhóm đồng bộ máy↔máy: các máy cùng nhãn nhóm sẽ tự đồng bộ NV/vân tay/thẻ/mật mã/khuôn mặt cho nhau (rỗng=không đồng bộ)
  add('push_devices', 'sync_group', "TEXT DEFAULT ''");
  // Máy có chức năng kiểm soát cửa (access control) → hiện nút "Mở cửa từ xa" (lệnh ADMS AC_UNLOCK)
  add('push_devices', 'access_control', 'INTEGER NOT NULL DEFAULT 0');
  // Lệnh đồng bộ mang theo "đối tượng" để CHỈ cộng số đếm khi máy XÁC NHẬN đã nhận (chống đếm khống)
  add('push_device_commands', 'pin',      "TEXT DEFAULT ''");
  add('push_device_commands', 'bio_type', 'INTEGER');
  add('push_device_commands', 'idx',      'INTEGER');
  add('push_device_commands', 'mkind',    "TEXT DEFAULT ''");   // 'user' | 'bio' | 'photo' (mirror khi ack OK)
  // Index khớp NV theo Số ID máy
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_emp_device_pin ON employees(device_pin)'); } catch {}

  // Cấu hình mặc định
  if (getSetting('weekend_days') == null) setSetting('weekend_days', '7');       // CN
  if (getSetting('workunit_rounding') == null) setSetting('workunit_rounding', '2'); // số lẻ thập phân
  if (getSetting('workunit_rounding_mode') == null) setSetting('workunit_rounding_mode', '0'); // 0=lùi(floor),1=tới(ceil),2=gần nhất(round)
  if (getSetting('pay_period_start_day') == null) setSetting('pay_period_start_day', '1'); // ngày bắt đầu kỳ lương
  // Geofence: '0' = chấm tự do (mặc định); '1' = chỉ cho chấm trong bán kính chi nhánh
  if (getSetting('geofence_enforce') == null) setSetting('geofence_enforce', '0');
  // Máy chấm công (ZKTeco ADMS push): '0' = không dùng (mặc định), '1' = dùng máy chấm công
  if (getSetting('device_enabled') == null) setSetting('device_enabled', '0');
  // Tự tạo NV khi máy đăng ký vân tay: '1' = tự tạo NV nháp (mặc định), '0' = chỉ ghi nhận chờ gán tay
  if (getSetting('device_autocreate') == null) setSetting('device_autocreate', '1');
  // Khoá thiết bị chấm công điện thoại (chống chấm hộ): '0' = tắt (mặc định), '1' = mỗi tài khoản chỉ chấm trên 1 điện thoại đã duyệt
  if (getSetting('device_lock_enabled') == null) setSetting('device_lock_enabled', '0');
  // Bỏ qua lần chấm TRÙNG trong vòng N phút (chống double-tap app + máy quẹt liên tiếp). '0' = tắt.
  if (getSetting('punch_dedup_min') == null) setSetting('punch_dedup_min', '0');
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
}

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare(`INSERT INTO settings(key, value) VALUES(?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(value));
}

// Danh sách định vị (văn phòng) mà NV được phép chấm. Chưa cấu hình → TẤT CẢ định vị đang bật.
export function allowedOffices(employeeId) {
  const rows = db.prepare(`SELECT o.* FROM employee_offices eo JOIN offices o ON o.id = eo.office_id
    WHERE eo.employee_id = ? AND o.active = 1 ORDER BY o.name`).all(employeeId);
  if (rows.length) return rows;
  return db.prepare('SELECT * FROM offices WHERE active = 1 ORDER BY name').all();
}
