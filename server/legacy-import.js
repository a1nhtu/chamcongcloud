// CHUYỂN DỮ LIỆU TỪ PHẦN MỀM CHẤM CÔNG CŨ sang Digiplus: Wise Eye On39 / V5.1 / Ronald Jack Pro (file Access .mdb).
// Lấy: BỘ PHẬN (cây cha – con) · NHÂN VIÊN (mã, tên, Số ID máy, bộ phận, chức danh, SĐT, ngày vào làm, thẻ…) · LƯỢT CHẤM
// · với Wise Eye: thêm CA + LỊCH TRÌNH VÀO RA + LỊCH TRÌNH CA + gán lịch trình cho NV (normalizeOn39Shifts / applyShifts).
//  - Đọc file bằng mdb-reader (JS thuần, server/vendor) → chạy được cả Windows lẫn VPS Linux, không cần cài Access/ODBC.
//    Mật khẩu Access (On39 mặc định 12112009) chỉ là lớp khoá ngoài, dữ liệu không mã hoá nên đọc được cả khi không nhập.
//  - normalizeOn39 / normalizeRj: hàm thuần, đổi bảng của từng phần mềm về 1 dạng chung → test không cần DB.
//  - applyLegacy: ghi vào DB. Lượt chấm đi qua ingestAttlog như máy chấm công gửi về (chống trùng, tự dựng lại ngày công),
//    gắn đúng số serial máy cũ → sau này nối máy qua ADMS, máy gửi lại log cũ cũng không bị nhân đôi.
//  - Nhập lại nhiều lần được: bộ phận / NV đã có thì bỏ qua (hoặc cập nhật nếu chọn), lượt chấm trùng tự bỏ.
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import MDBReader from './vendor/mdb-reader.mjs';
import { db, getSetting, setSetting } from './db.js';
import { ingestAttlog, rebuildDays } from './device-sync.js';
import { defaultPasswordHash } from './auth.js';
import { cleanName, isJunkName } from './ten-nv.js';

// Wise Eye V5.1 (we51) cùng cấu trúc bảng + mật khẩu file với On39 → đọc chung, chỉ khác tên hiện ra
export const LEGACY_LABEL = { on39: 'Wise Eye On39', we51: 'Wise Eye V5.1', rj: 'Ronald Jack Pro' };

/* ------------------------------ đọc file ------------------------------ */
// File tải lên: trình duyệt nén gzip trước khi gửi (nhận ra bằng 2 byte đầu 1F 8B — file Access luôn bắt đầu 00 01 00 00) → giải nén.
// File thô (trình duyệt cũ không có CompressionStream) thì trả nguyên. Giới hạn 1 GB sau giải nén như giới hạn tải lên.
const gunzipAsync = promisify(gunzip);
export async function unpackUpload(buf) {
  if (buf.length < 2 || buf[0] !== 0x1f || buf[1] !== 0x8b) return buf;
  try { return await gunzipAsync(buf, { maxOutputLength: 1024 * 1048576 }); }
  catch (e) { throw new Error('File gửi lên bị lỗi khi giải nén — chọn lại file: ' + e.message); }
}
// mdb-reader trả ngày giờ Access thành Date "UTC" mang đúng giờ đồng hồ ghi trong file (= giờ VN) → lấy thẳng các số
const okDate = (d) => d instanceof Date && !isNaN(d) && d.getUTCFullYear() > 1900;
const ymd = (d) => (okDate(d) ? d.toISOString().slice(0, 10) : '');
const stamp = (d) => (okDate(d) ? d.toISOString().slice(0, 19).replace('T', ' ') : '');
const str = (v) => (v == null ? '' : String(v).trim());
const ON39_STATUS = { I: 0, O: 1, OTI: 4, OTO: 5 };   // OriginType của On39 → mã phím ZKTeco (0,3,4 vào · 1,2,5 ra)
const hasLetter = (s) => /\p{L}/u.test(s);
const card = (v) => { const s = str(v); return /^0*$/.test(s) ? '' : s; };   // '0000000000' = chưa có thẻ
// Ngày sinh: bỏ giá trị mặc định (trùng ngày vào làm, hoặc chưa đủ 14 tuổi) — phần mềm cũ hay để sẵn ngày hôm nay
const birth = (b, hire) => (!b || b === hire || +b.slice(0, 4) > new Date().getFullYear() - 14 ? '' : b);
// CCCD / CMND: bỏ số để sẵn kiểu 123456789…, 000…
const idNo = (v) => { const s = str(v); return !s || /^(0+|1234567890?\d*)$/.test(s) ? '' : s; };
// Ngày dạng chữ (On39 lưu UserBirthDay là chữ): dd/MM/yyyy hoặc yyyy-MM-dd
function textDate(v) {
  const s = str(v);
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}

export function openMdb(buf, password = '') {
  let r;
  try { r = new MDBReader(buf, password ? { password } : {}); }
  catch (e) { throw new Error('Không đọc được file Access (.mdb) — file hỏng hoặc không phải file dữ liệu: ' + e.message); }
  const names = new Set(r.getTableNames());
  const kind = names.has('UserInfo') && names.has('CheckInOut') && names.has('RelationDept') ? 'on39'
    : names.has('NHANVIEN') && names.has('CheckInOut') && names.has('PHONGBAN') ? 'rj' : '';
  if (!kind) throw new Error('File này không phải dữ liệu Wise Eye On39 hay Ronald Jack Pro (thiếu bảng nhân viên / chấm công)');
  // Bảng có thể thiếu ở bản cũ → trả mảng rỗng; columns: chỉ lấy cột cần (bảng chấm công lớn đỡ tốn bộ nhớ)
  const table = (name, columns) => {
    if (!names.has(name)) return [];
    const t = r.getTable(name);
    const have = new Set(t.getColumnNames());
    return t.getData(columns ? { columns: columns.filter((c) => have.has(c)) } : undefined);
  };
  return { kind, table };
}

// Dạng chung: { kind, company, depts:[{key,name,parent}], emps:[…], punches:[{pin,time,status,serial}], machines:[{serial,name}] }
export function normalizeOn39(table) {
  const company = str(table('Company', ['CompName'])[0]?.CompName);
  const rel = table('RelationDept', ['ID', 'Description', 'RelationID', 'DeptCode']);
  // Gốc cây (RelationID 0 / mã 'root') là tên công ty → không tạo thành bộ phận; con của gốc thành bộ phận cấp trên cùng
  const roots = new Set(rel.filter((d) => !d.RelationID || str(d.DeptCode).toLowerCase() === 'root').map((d) => d.ID));
  const depts = rel.filter((d) => !roots.has(d.ID) && str(d.Description))
    .map((d) => ({ key: 'D' + d.ID, name: str(d.Description), parent: roots.has(d.RelationID) ? null : 'D' + d.RelationID }));
  const deptKeys = new Set(depts.map((d) => d.key));
  const titles = new Map(table('Title', ['IDT', 'TitleName']).map((t) => [t.IDT, str(t.TitleName)]));
  const emps = table('UserInfo', ['UserEnrollNumber', 'UserFullCode', 'UserFullName', 'UserLastName', 'UserEnrollName', 'UserCardNo',
    'UserHireDay', 'UserBirthDay', 'UserIDTitle', 'UserIDD', 'UserPhoneNumber', 'UserIDCard', 'UserAddress'])
    .filter((u) => u.UserEnrollNumber > 0)
    .map((u) => {
      const pin = String(u.UserEnrollNumber);
      const full = cleanName(u.UserFullName);   // tên rác (phần mềm cũ đọc hỏng tên dài) → bỏ
      const hire = ymd(u.UserHireDay);
      return {
        pin, code: str(u.UserFullCode) || pin,
        // Nhiều nơi chỉ gõ tên ở "Tên chấm công" (UserEnrollName), còn Họ tên để bằng mã số → lấy tên có chữ
        name: (hasLetter(full) ? full : '') || cleanName(u.UserEnrollName) || cleanName(u.UserLastName) || full,
        dept: deptKeys.has('D' + u.UserIDD) ? 'D' + u.UserIDD : null,
        position: titles.get(u.UserIDTitle) || '', phone: str(u.UserPhoneNumber), card: card(u.UserCardNo),
        start_date: hire, birth_date: birth(textDate(u.UserBirthDay), hire), id_number: idNo(u.UserIDCard),
        address: str(u.UserAddress), email: '', active: true,
      };
    });
  const mach = table('Machines', ['MachineID', 'MachineName', 'SerialNumber']);
  const serialOf = new Map(mach.map((m) => [m.MachineID, str(m.SerialNumber) || 'ON39_MAY' + m.MachineID]));
  const punches = [];
  // Phím vào / ra của On39 (OriginType) → mã phím ZKTeco mà "Chọn từ máy" hiểu: I vào 0 · O ra 1 · OTI vào tăng ca 4 · OTO ra tăng ca 5
  // (trước đây chỉ 'O' là ra → 'OTO' thành VÀO; file Data_on39_CaDem có 10.055 lượt OTO)
  for (const c of table('CheckInOut', ['UserEnrollNumber', 'TimeStr', 'OriginType', 'MachineNo'])) {
    const time = stamp(c.TimeStr);
    if (!time || !(c.UserEnrollNumber > 0)) continue;
    punches.push({ pin: String(c.UserEnrollNumber), time, status: ON39_STATUS[str(c.OriginType).toUpperCase()] ?? 0,
      serial: serialOf.get(c.MachineNo) || 'ON39_MAY' + (c.MachineNo || 0) });
  }
  return { kind: 'on39', company, depts, emps, punches,
    machines: mach.map((m) => ({ serial: serialOf.get(m.MachineID), name: str(m.MachineName) })), ...normalizeOn39Shifts(table) };
}

// Giờ 'HH:MM' từ chữ ('7:30', '07:30:00') hoặc kiểu giờ của Access (Date ngày 30/12/1899 mang đúng giờ ghi trong file)
const hmOf = (v) => {
  if (v instanceof Date) return isNaN(v) ? '' : v.toISOString().slice(11, 16);
  const m = /^(\d{1,2}):(\d{2})/.exec(str(v));
  return m && +m[1] < 24 && +m[2] < 60 ? m[1].padStart(2, '0') + ':' + m[2] : '';
};
const minOf = (hm) => +hm.slice(0, 2) * 60 + +hm.slice(3, 5);
const hmFrom = (m) => { m = ((m % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const nn = (v) => Math.max(0, Math.round(Number(v) || 0));
const IO_RULE = { 1: 'tdhc', 2: 'idm', 3: 'filo', 4: 'state' };   // InOutMode On39 → quy tắc Digiplus; 0 = Tự động (tdqd nếu qua đêm, không thì pairs)

// CA + LỊCH TRÌNH của Wise Eye On39 / V5.1 → dạng chung (Anh duyệt 18/11/2026, mục L6 báo cáo đối chiếu On39):
//  - Ca (Shifts): khung nhận VÀO = Giờ vào − OnTimeIn … Giờ vào + CutIn; khung nhận RA = Giờ ra − OnTimeOut … Giờ ra + CutOut
//    (cách chép này đã đối chiếu bảng công On39 trên file Data_on39_CaDem: lịch 1 ca HC-CN khớp 100%).
//  - Lịch trình vào ra (InOutArr): InOutMode 0 Tự động (DayCount > 0 = qua đêm; EndTime = "Mốc kết thúc ra hôm sau") · 1 theo khoảng giờ
//    · 2 theo số máy · 3 giờ đầu – giờ cuối · 4 theo phím vào / ra.
//  - Lịch trình ca (Schedule): chu kỳ tuần = WSchedules (DayID 1 = CN, 2 = T2 … 7 = T7; 8 = ngày lễ → bỏ) · tháng = MSchedules
//    (DayID = ngày 1..31; 32 = lễ → bỏ) · năm = YSchedules → Digiplus không có chu kỳ năm nên chép thành "tự dò" trong các ca của lịch.
//    Một ngày có nhiều ca = Digiplus tự dò ca theo giờ chấm, như On39 thử lần lượt từng ca của ngày.
//  - Gán NV: UserInfo.SchID = lịch trình chính · UserTempSch = lịch trình tạm theo khoảng ngày.
export function normalizeOn39Shifts(table) {
  const shifts = [];
  for (const s of table('Shifts', ['ShiftID', 'ShiftCode', 'Onduty', 'Offduty', 'DayCount', 'OnTimeIn', 'OnTimeOut', 'CutIn', 'CutOut', 'OnLunch', 'OffLunch',
    'Workingday', 'LateGrace', 'EarlyGrace', 'IsAfterOT', 'MinAfterOT', 'IsBeforeOT', 'MinBeforeOT'])) {
    const code = str(s.ShiftCode), on = hmOf(s.Onduty), off = hmOf(s.Offduty);
    if (!code || !on || !off) continue;
    const st = minOf(on), en = minOf(off), l1 = hmOf(s.OnLunch), l2 = hmOf(s.OffLunch);
    const brk = l1 && l2 && l1 !== l2 ? (minOf(l2) - minOf(l1) + 1440) % 1440 : 0;
    shifts.push({ key: 'S' + s.ShiftID, code, start_time: on, end_time: off, cross_midnight: nn(s.DayCount) > 0 || en <= st ? 1 : 0,
      break_minutes: brk, break_start: brk ? l1 : '',
      check_in_start: hmFrom(st - nn(s.OnTimeIn)), check_in_end: hmFrom(st + nn(s.CutIn)),
      check_out_start: hmFrom(en - nn(s.OnTimeOut)), check_out_end: hmFrom(en + nn(s.CutOut)),
      late_grace_min: nn(s.LateGrace), early_grace_min: nn(s.EarlyGrace), work_unit_value: Number(s.Workingday) > 0 ? Number(s.Workingday) : 1,
      allow_ot: s.IsAfterOT ? 1 : 0, ot_start_after_min: nn(s.MinAfterOT), ot_before: s.IsBeforeOT ? 1 : 0, ot_before_min: nn(s.MinBeforeOT) });
  }
  const shiftKeys = new Set(shifts.map((s) => s.key));
  const inouts = table('InOutArr', ['InOutID', 'InOutCode', 'InOutName', 'AutoMax', 'AutoMin', 'AutoInterval', 'InOutMode', 'DayCount', 'EndTime'])
    .filter((a) => str(a.InOutCode) || str(a.InOutName))
    .map((a) => {
      const rule = IO_RULE[Number(a.InOutMode)] || (nn(a.DayCount) > 0 ? 'tdqd' : 'pairs');
      const end = hmOf(a.EndTime);
      return { key: 'IO' + a.InOutID, code: str(a.InOutCode) || str(a.InOutName), name: str(a.InOutName) || str(a.InOutCode), rule,
        min_minutes: nn(a.AutoMin) || 30, max_minutes: nn(a.AutoMax) || 960, gap_minutes: nn(a.AutoInterval) || 30,
        next_out_end: rule === 'tdqd' && end && end !== '23:59' && end !== '00:00' ? end : '' };
    });
  const ioKeys = new Set(inouts.map((a) => a.key));
  const rows = (name) => table(name, ['ID', 'SchID', 'DayID', 'ShiftID', 'MonthID']).filter((r) => shiftKeys.has('S' + r.ShiftID))
    .sort((a, b) => (a.ID || 0) - (b.ID || 0));
  const W = rows('WSchedules'), M = rows('MSchedules'), Y = rows('YSchedules');
  const schedules = [];
  for (const sc of table('Schedule', ['SchID', 'SchName', 'InOutID', 'CycleMode'])) {
    const name = str(sc.SchName);
    if (!name) continue;
    const w = W.filter((r) => r.SchID === sc.SchID && r.DayID >= 1 && r.DayID <= 7);
    const m = M.filter((r) => r.SchID === sc.SchID && r.DayID >= 1 && r.DayID <= 31);
    const y = Y.filter((r) => r.SchID === sc.SchID);
    // CycleMode 0 tuần · 1 tháng · 2 năm; chu kỳ đang chọn không có ca (dữ liệu sót) → lấy chu kỳ nào có ca
    const cyc = Number(sc.CycleMode) || 0;
    const unit = cyc === 1 && m.length ? 'month' : cyc === 2 && y.length ? 'auto' : w.length ? 'week' : m.length ? 'month' : 'auto';
    const src = unit === 'week' ? w : unit === 'month' ? m : y;
    const used = [...new Set(src.map((r) => 'S' + r.ShiftID))];
    if (!used.length) continue;
    // Digiplus: ô tuần 0 = Thứ Hai … 6 = Chủ Nhật · ô tháng = ngày − 1
    const cells = unit === 'week' ? w.map((r) => [r.DayID === 1 ? 6 : r.DayID - 2, 'S' + r.ShiftID])
      : unit === 'month' ? m.map((r) => [r.DayID - 1, 'S' + r.ShiftID]) : [];
    schedules.push({ key: 'W' + sc.SchID, name, unit, cells, shifts: used, io: ioKeys.has('IO' + sc.InOutID) ? 'IO' + sc.InOutID : null });
  }
  const schKeys = new Set(schedules.map((s) => s.key));
  const assign = table('UserInfo', ['UserEnrollNumber', 'SchID'])
    .filter((u) => u.UserEnrollNumber > 0 && schKeys.has('W' + u.SchID)).map((u) => ({ pin: String(u.UserEnrollNumber), sch: 'W' + u.SchID }));
  const temp_sch = [];
  for (const t of table('UserTempSch', ['UserEnrollNumber', 'StartDate', 'EndDate', 'SchID'])) {
    const from = ymd(t.StartDate), to = ymd(t.EndDate) || null;
    if (!(t.UserEnrollNumber > 0) || !schKeys.has('W' + t.SchID) || !from || (to && to < from)) continue;
    temp_sch.push({ pin: String(t.UserEnrollNumber), sch: 'W' + t.SchID, from, to });
  }
  temp_sch.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  return { shifts, inouts, schedules, assign, temp_sch };
}

export function normalizeRj(table) {
  const company = str(table('CONGTY', ['TenCongTy'])[0]?.TenCongTy);
  // Cây Ronald Jack: Công ty › Khu vực › Phòng ban. Chỉ 1 khu vực (hay gặp) → bỏ cấp khu vực cho gọn
  const kv = table('KHUVUC', ['MaKhuVuc', 'TenKhuVuc']).filter((k) => str(k.MaKhuVuc) && str(k.TenKhuVuc));
  const multiKV = kv.length > 1;
  const depts = multiKV ? kv.map((k) => ({ key: 'K' + str(k.MaKhuVuc), name: str(k.TenKhuVuc), parent: null })) : [];
  const kvKeys = new Set(depts.map((d) => d.key));
  for (const p of table('PHONGBAN', ['MaPhongBan', 'MaKhuVuc', 'TenPhongBan'])) {
    if (!str(p.MaPhongBan) || !str(p.TenPhongBan)) continue;
    const par = 'K' + str(p.MaKhuVuc);
    depts.push({ key: 'P' + str(p.MaPhongBan), name: str(p.TenPhongBan), parent: kvKeys.has(par) ? par : null });
  }
  const deptKeys = new Set(depts.map((d) => d.key));
  const chucVu = new Map([...table('CHUCVUNHANVIEN', ['MaChucVuNhanVien', 'TenChucVuNhanVien']).map((c) => [str(c.MaChucVuNhanVien), str(c.TenChucVuNhanVien)]),
    ...table('CHUCVU', ['MaChucVu', 'TenChucVu']).map((c) => [str(c.MaChucVu), str(c.TenChucVu)])]);
  const emps = table('NHANVIEN', ['MaNhanVien', 'TenNhanVien', 'MaChamCong', 'TenChamCong', 'MaThe', 'NgayVaoLamViec', 'ChucVu', 'NgaySinh',
    'CMND', 'DienThoaiLienHe', 'Email', 'NghiViecTamThoi', 'MaKhuVuc', 'MaPhongBan', 'MaChucVu'])
    .filter((n) => n.MaChamCong > 0)
    .map((n) => {
      const pin = String(n.MaChamCong);
      const hire = ymd(n.NgayVaoLamViec);
      const pb = 'P' + str(n.MaPhongBan), k = 'K' + str(n.MaKhuVuc);
      return {
        pin, code: str(n.MaNhanVien) || pin, name: cleanName(n.TenNhanVien) || cleanName(n.TenChamCong),   // tên rác → bỏ
        dept: deptKeys.has(pb) ? pb : deptKeys.has(k) ? k : null,
        position: str(n.ChucVu) || chucVu.get(str(n.MaChucVu)) || '', phone: str(n.DienThoaiLienHe), card: card(n.MaThe),
        start_date: hire, birth_date: birth(ymd(n.NgaySinh), hire), id_number: idNo(n.CMND),
        address: '', email: str(n.Email), active: !n.NghiViecTamThoi,
      };
    });
  const mach = table('MAYCHAMCONG', ['IDMCC', 'TenMCC', 'Serial']);
  const serialOf = new Map(mach.map((m) => [m.IDMCC, str(m.Serial) || 'RJ_MAY' + m.IDMCC]));
  const punches = [];
  for (const c of table('CheckInOut', ['MaChamCong', 'GioCham', 'KieuCham', 'NguonCham', 'MaSoMay'])) {
    const time = stamp(c.GioCham);
    if (!time || !(c.MaChamCong > 0)) continue;
    const status = str(c.KieuCham) === '1' ? 1 : 0;
    // Nguồn 10 = "THÊM GIỜ" (thêm tay trong Ronald Jack) → máy ảo thêm tay của Digiplus (TAY_VAO lẻ = Vào, TAY_RA chẵn = Ra)
    const serial = str(c.NguonCham) === '10' ? (status ? 'TAY_RA' : 'TAY_VAO') : (serialOf.get(c.MaSoMay) || 'RJ_MAY' + (c.MaSoMay || 0));
    punches.push({ pin: String(c.MaChamCong), time, status, serial });
  }
  return { kind: 'rj', company, depts, emps, punches,
    machines: mach.map((m) => ({ serial: serialOf.get(m.IDMCC), name: str(m.TenMCC) })) };
}

// expect: 'on39' | 'rj' = phần mềm người dùng đã chọn → file của phần mềm kia thì báo chọn lại (không đọc nhầm)
export function readLegacy(buf, password = '', expect = '') {
  const { kind, table } = openMdb(buf, password);
  const want = expect === 'we51' ? 'on39' : expect;
  if (want && LEGACY_LABEL[want] && want !== kind)
    throw new Error(`File này là dữ liệu ${kind === 'on39' ? 'Wise Eye (On39 / V5.1)' : LEGACY_LABEL[kind]}, không phải ${LEGACY_LABEL[expect]} — chọn lại đúng phần mềm hoặc đúng file`);
  if (kind !== 'on39') return normalizeRj(table);
  const data = normalizeOn39(table);
  return expect === 'we51' ? { ...data, kind: 'we51' } : data;
}

/* ------------------------------ xem trước ------------------------------ */
// Khớp NV phần mềm cũ ↔ NV Digiplus: theo Số ID máy, rồi theo mã NV / mã = Số ID (NV chưa gắn Số ID)
function matchEmp(e) {
  return db.prepare("SELECT * FROM employees WHERE device_pin=? AND device_pin!=''").get(e.pin)
    || db.prepare("SELECT * FROM employees WHERE code=? AND COALESCE(device_pin,'')=''").get(e.code)
    || db.prepare("SELECT * FROM employees WHERE code=? AND COALESCE(device_pin,'')=''").get(e.pin);
}

export function summarize(data) {
  let first = '', last = '';
  for (const p of data.punches) { if (!first || p.time < first) first = p.time; if (!last || p.time > last) last = p.time; }
  const hasDept = new Set(db.prepare('SELECT name FROM departments').all().map((d) => d.name.toLowerCase()));
  const existing = data.emps.filter((e) => matchEmp(e)).length;
  return {
    kind: data.kind, label: LEGACY_LABEL[data.kind], company: data.company,
    depts: data.depts.length, depts_new: data.depts.filter((d) => !hasDept.has(d.name.toLowerCase())).length,
    dept_names: data.depts.map((d) => d.name).slice(0, 30),
    // Từng bộ phận + số NV → giao diện cho bỏ tick bộ phận không lấy (VD "Nghỉ việc")
    dept_list: data.depts.map((d) => ({ key: d.key, name: d.name, emps: data.emps.filter((e) => e.dept === d.key).length })),
    emps: data.emps.length, emps_existing: existing, emps_new: data.emps.length - existing,
    emps_no_dept: data.emps.filter((e) => !e.dept).length,
    punches: data.punches.length, first_date: first.slice(0, 10), last_date: last.slice(0, 10),
    machines: data.machines,
    // Ca + lịch trình (chỉ Wise Eye): số lượng + tên để hiện ở bước xem trước
    shifts: (data.shifts || []).length, shift_names: (data.shifts || []).map((s) => `${s.code} ${s.start_time}–${s.end_time}`),
    inouts: (data.inouts || []).length, schedules: (data.schedules || []).length,
    schedule_names: (data.schedules || []).map((s) => s.name),
    sch_emps: (data.assign || []).length, temp_sch: (data.temp_sch || []).length,
  };
}

/* ------------------------------ ghi vào Digiplus ------------------------------ */
const tick = () => new Promise((ok) => setImmediate(ok));   // nhả luồng chính giữa các đợt → máy chủ vẫn nhận máy chấm công / trả tiến độ
function uniqueValue(column, base) {
  let v = base, i = 1;
  const q = db.prepare(`SELECT 1 FROM employees WHERE ${column}=?`);
  while (q.get(v)) v = `${base}_${i++}`;
  return v;
}
function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Bỏ bộ phận không lấy (skip_depts: mảng key) + NV của bộ phận đó; skip_no_dept: bỏ NV chưa có bộ phận.
// Lượt chấm chỉ giữ của NV còn lại. Không bỏ gì → trả nguyên dữ liệu (như cũ).
export function filterLegacy(data, skipDepts = [], skipNoDept = false) {
  const skip = new Set(skipDepts);
  if (!skip.size && !skipNoDept) return data;
  const emps = data.emps.filter((e) => (e.dept ? !skip.has(e.dept) : !skipNoDept));
  const pins = new Set(emps.map((e) => e.pin));
  const own = (list) => (list ? list.filter((x) => pins.has(x.pin)) : list);
  return { ...data, depts: data.depts.filter((d) => !skip.has(d.key)), emps, punches: data.punches.filter((p) => pins.has(p.pin)),
    assign: own(data.assign), temp_sch: own(data.temp_sch) };
}

// CA + LỊCH TRÌNH (Wise Eye) → Digiplus. Không đụng ca / lịch trình đang có của khách:
//  - ca trùng MÃ + giờ vào + giờ ra → dùng lại ca đó; trùng mã mà khác giờ → tạo ca mới tên "<mã> (On39)"
//  - lịch trình vào ra trùng mã + cùng thông số → dùng lại; lịch trình ca đã chép lần trước (cùng tên, mô tả "Chép từ …") → dùng lại
//  - gán NV: lịch trình chính từ ngày đầu tiên có lượt chấm, không ngày kết thúc; lịch trình tạm có từ ngày – đến ngày, ghi SAU
//    (dòng gán mới nhất thắng → trong khoảng ngày tạm theo lịch tạm, ngoài khoảng theo lịch chính). NV đã có dòng gán tự khai
//    ở Digiplus thì giữ nguyên, trừ khi chọn "Ghi đè".
// Trả danh sách id NV vừa được gán (để tính lại công nếu lượt chấm của họ đã có từ trước).
function applyShifts(data, o, out) {
  const tag = data.kind === 'we51' ? 'V5.1' : 'On39';
  const mark = `Chép từ ${LEGACY_LABEL[data.kind] || 'phần mềm cũ'}`;
  // Tên / mã chưa dùng: "X" → "X (On39)" → "X (On39 2)" …
  const freeName = (base, taken) => { if (!taken(base)) return base; for (let i = 1; ; i++) { const v = `${base} (${tag}${i > 1 ? ' ' + i : ''})`; if (!taken(v)) return v; } };
  const shiftId = {}, ioId = {}, wsId = {};
  for (const s of data.shifts) {
    const same = db.prepare('SELECT id FROM shifts WHERE active=1 AND lower(code)=lower(?) AND start_time=? AND end_time=?').get(s.code, s.start_time, s.end_time);
    if (same) { shiftId[s.key] = same.id; continue; }
    const code = freeName(s.code, (v) => db.prepare('SELECT 1 FROM shifts WHERE active=1 AND (lower(code)=lower(?) OR lower(name)=lower(?))').get(v, v));
    const row = { ...s, code, name: code, work_days: '1,2,3,4,5,6,7', active: 1 };
    delete row.key;
    const k = Object.keys(row);
    shiftId[s.key] = Number(db.prepare(`INSERT INTO shifts(${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`).run(...k.map((x) => row[x])).lastInsertRowid);
    out.shifts_created++;
  }
  for (const a of data.inouts) {
    const same = db.prepare(`SELECT id FROM inout_schedules WHERE active=1 AND lower(code)=lower(?) AND rule=? AND min_minutes=? AND max_minutes=?
      AND gap_minutes=? AND COALESCE(next_out_end,'')=?`).get(a.code, a.rule, a.min_minutes, a.max_minutes, a.gap_minutes, a.next_out_end);
    if (same) { ioId[a.key] = same.id; continue; }
    const code = freeName(a.code, (v) => db.prepare('SELECT 1 FROM inout_schedules WHERE active=1 AND lower(code)=lower(?)').get(v));
    ioId[a.key] = Number(db.prepare('INSERT INTO inout_schedules(code, name, rule, min_minutes, max_minutes, gap_minutes, next_out_end, is_default) VALUES (?,?,?,?,?,?,?,0)')
      .run(code, a.name, a.rule, a.min_minutes, a.max_minutes, a.gap_minutes, a.next_out_end).lastInsertRowid);
    out.inouts_created++;
  }
  for (const w of data.schedules) {
    const same = db.prepare('SELECT id FROM work_schedules WHERE active=1 AND lower(name)=lower(?) AND description=?').get(w.name, mark);
    if (same) { wsId[w.key] = same.id; continue; }
    const name = freeName(w.name, (v) => db.prepare('SELECT 1 FROM work_schedules WHERE active=1 AND lower(name)=lower(?)').get(v));
    const id = Number(db.prepare('INSERT INTO work_schedules(code, name, description, unit, cycle, is_default) VALUES (?,?,?,?,1,0)')
      .run(name, name, mark, w.unit).lastInsertRowid);
    w.shifts.forEach((k, i) => db.prepare('INSERT OR IGNORE INTO work_schedule_shifts(work_schedule_id, shift_id, sort_order) VALUES (?,?,?)').run(id, shiftId[k], i));
    for (const [idx, k] of w.cells) db.prepare('INSERT OR IGNORE INTO work_schedule_days(work_schedule_id, idx, shift_id) VALUES (?,?,?)').run(id, idx, shiftId[k]);
    wsId[w.key] = id;
    out.schedules_created++;
  }

  const ioOf = new Map(data.schedules.map((w) => [w.key, w.io ? ioId[w.io] || null : null]));
  let base = '';
  for (const p of data.punches) if (!base || p.time < base) base = p.time;
  base = base.slice(0, 10) || new Date().toISOString().slice(0, 10);
  const empOf = (pin) => db.prepare("SELECT id FROM employees WHERE device_pin=? AND device_pin<>''").get(pin)?.id;
  const ownRows = db.prepare('SELECT * FROM shift_assignments WHERE employee_id=? AND active=1');
  const insA = db.prepare(`INSERT INTO shift_assignments(employee_id, mode, work_schedule_id, from_date, to_date, shift_type, merge_rule, inout_schedule_id, note, active)
    VALUES (?, 'schedule', ?, ?, ?, 'fixed', 'default', ?, ?, 1)`);
  const touched = new Set(), skipped = new Set();
  // NV có dòng gán tự khai ở Digiplus (không phải dòng chép) → không đụng, trừ khi chọn ghi đè
  const keepOwn = (eid) => !o.overwrite && ownRows.all(eid).some((r) => r.note !== mark);
  for (const a of data.assign) {
    const eid = empOf(a.pin), ws = wsId[a.sch];
    if (!eid || !ws) continue;
    if (keepOwn(eid)) { skipped.add(eid); continue; }
    if (ownRows.all(eid).some((r) => r.note === mark && r.work_schedule_id === ws && !r.to_date)) continue;   // đã chép lần trước
    insA.run(eid, ws, base, null, ioOf.get(a.sch), mark);
    touched.add(eid); out.assign_created++;
  }
  // Lịch tạm: xoá dòng tạm đã chép giống hệt rồi ghi lại → luôn nằm trên dòng lịch chính (dòng mới nhất thắng)
  const delSame = db.prepare("DELETE FROM shift_assignments WHERE employee_id=? AND work_schedule_id=? AND from_date=? AND COALESCE(to_date,'')=? AND note=?");
  for (const t of data.temp_sch) {
    const eid = empOf(t.pin), ws = wsId[t.sch];
    if (!eid || !ws) continue;
    if (keepOwn(eid)) { skipped.add(eid); continue; }
    const had = delSame.run(eid, ws, t.from, t.to || '', mark).changes;
    insA.run(eid, ws, t.from, t.to, ioOf.get(t.sch), mark);
    if (!had) { touched.add(eid); out.temp_created++; }
  }
  out.assign_skipped = skipped.size;
  return [...touched];
}

// opts: { depts, emps, punches, shifts (true/false), overwrite (ghi đè thông tin NV / dòng gán ca đã có), from, to ('YYYY-MM-DD', rỗng = tất cả),
//         skip_depts (key bộ phận không lấy), skip_no_dept (bỏ NV chưa có bộ phận) }
// prog(%, chữ). shouldStop(): true = người dùng bấm Dừng → dừng ở đợt kế tiếp, trả { ..., stopped: true }. Trả số liệu đã làm.
//
// NGÀY CHỜ TÍNH CÔNG (setting legacy_rebuild_pending = { empId: [ngày đầu, ngày cuối] }): lượt chấm nhập trước, công tính sau cùng
// → bấm Dừng / máy chủ khởi động lại giữa chừng thì các ngày đã nhập chưa có công. Ghi lại khoảng ngày từng NV; lần chuyển sau
// (lượt đã có tự bỏ qua nên không tự sinh ngày cần tính) tính bù các khoảng này rồi mới xoá.
const PENDING_KEY = 'legacy_rebuild_pending';
function loadPending() { try { return JSON.parse(getSetting(PENDING_KEY, '') || '{}') || {}; } catch { return {}; } }
export const legacyPendingCount = () => Object.keys(loadPending()).length;
function addPending(pend, keys) {
  for (const k of keys) {
    const [eid, d] = k.split('|');
    const r = pend[eid];
    if (!r) pend[eid] = [d, d]; else { if (d < r[0]) r[0] = d; if (d > r[1]) r[1] = d; }
  }
}
// MỖI GIAO DỊCH TỐI ĐA ~BUDGET_MS rồi nhả luồng chính (setTimeout) → máy chủ vẫn trả lời máy chấm công + giao diện. Số dòng mỗi đợt
// tự co giãn theo tốc độ thật của máy chủ (khách pretty 28/11/2026 chậm gấp ~30 lần máy thử: đợt 2.000 lượt giữ luồng 4–5 giây →
// phần mềm "treo đơ", Cloudflare trả 502).
const BUDGET_MS = 300;
const breathe = () => new Promise((ok) => setTimeout(ok, 25));
const fit = (size, ms, min, max) => Math.max(min, Math.min(max, Math.round(size * BUDGET_MS / Math.max(ms, 1))));
// Bộ nhớ đệm CSDL lúc chuyển: mặc định 2 MB → CSDL khách lớn, mỗi lượt ghi vào 6 chỉ mục phải đọc lại trang từ ổ đĩa (nguyên nhân
// chính máy khách chậm). Tăng tạm 200 MB, xong trả lại như cũ.
export async function applyLegacy(data, opts = {}, prog = () => {}, shouldStop = () => false) {
  const old = parseInt(db.prepare('PRAGMA cache_size').get()?.cache_size, 10) || -2000;
  db.exec('PRAGMA cache_size = -200000');
  try { return await applyLegacyRun(data, opts, prog, shouldStop); }
  finally { try { db.exec(`PRAGMA cache_size = ${old}`); } catch {} }
}
async function applyLegacyRun(data, opts = {}, prog = () => {}, shouldStop = () => false) {
  const o = { depts: true, emps: true, punches: true, shifts: true, overwrite: false, from: '', to: '', ...opts };
  data = filterLegacy(data, o.skip_depts || [], !!o.skip_no_dept);
  const out = { depts_created: 0, emps_created: 0, emps_updated: 0, emps_linked: 0, punches_read: 0, punches_new: 0,
    shifts_created: 0, inouts_created: 0, schedules_created: 0, assign_created: 0, temp_created: 0, assign_skipped: 0, recomputed_emps: 0 };

  // 1) BỘ PHẬN — cha trước con; trùng tên (không phân biệt hoa thường) thì dùng bộ phận có sẵn, không đổi chỗ trong cây
  prog(2, 'Đang tạo bộ phận…');
  const deptName = new Map(data.depts.map((d) => [d.key, d.name]));
  if (o.depts && data.depts.length) tx(() => {
    const idOf = (name) => db.prepare('SELECT id FROM departments WHERE lower(name)=lower(?)').get(name)?.id;
    const ins = db.prepare('INSERT INTO departments(name, parent_id) VALUES (?, ?)');
    const byKey = new Map(data.depts.map((d) => [d.key, d]));
    const done = new Set();
    const make = (d, depth = 0) => {
      if (done.has(d.key) || depth > 20) return; done.add(d.key);
      const par = d.parent && byKey.get(d.parent);
      if (par) make(par, depth + 1);
      if (idOf(d.name)) return;
      ins.run(d.name, par ? idOf(par.name) || null : null);
      out.depts_created++;
    };
    for (const d of data.depts) make(d);
  });
  // Tên bộ phận ghi vào NV: lấy đúng cách viết của bộ phận đang có trong Digiplus; chưa có (không chọn tạo bộ phận) → để trống
  const deptFor = (key) => {
    const n = key && deptName.get(key);
    return n ? db.prepare('SELECT name FROM departments WHERE lower(name)=lower(?)').get(n)?.name || '' : '';
  };

  // 2) NHÂN VIÊN — NV đã nghỉ ở phần mềm cũ: tạo đang hoạt động để nhận lượt chấm cũ (máy chỉ gắn lượt chấm cho NV đang làm), cuối cùng mới khoá
  const lockLater = [];
  const pend = loadPending();   // khoảng ngày chờ tính (lần trước bị dừng + lần này), xem PENDING_KEY
  // Dừng giữa chừng: vẫn khoá NV nghỉ việc đã tạo, ghi lại khoảng ngày chờ tính
  const stopNow = (extra = {}) => {
    if (lockLater.length) tx(() => { for (const id of lockLater) db.prepare('UPDATE employees SET active=0 WHERE id=?').run(id); });
    setSetting(PENDING_KEY, Object.keys(pend).length ? JSON.stringify(pend) : '');
    return { ...out, ...extra, stopped: true };
  };
  if (o.emps && data.emps.length) {
    const pwHash = defaultPasswordHash();
    const hrCols = new Set(db.prepare('PRAGMA table_info(hr_profiles)').all().map((c) => c.name));
    const setProfile = (empId, e) => {
      const vals = { birth_date: e.birth_date, id_number: e.id_number, permanent_address: e.address, personal_email: e.email };
      const keys = Object.keys(vals).filter((k) => vals[k] && hrCols.has(k));
      if (!keys.length) return;
      db.prepare('INSERT OR IGNORE INTO hr_profiles(employee_id) VALUES (?)').run(empId);
      const cur = db.prepare('SELECT * FROM hr_profiles WHERE employee_id=?').get(empId);
      const upd = keys.filter((k) => o.overwrite || !cur[k]);
      if (upd.length) db.prepare(`UPDATE hr_profiles SET ${upd.map((k) => k + '=?').join(', ')}, updated_by='Chuyển dữ liệu', updated_at=datetime('now') WHERE employee_id=?`)
        .run(...upd.map((k) => vals[k]), empId);
    };
    // Thẻ từ: lưu vào thông tin user trên máy để lúc đồng bộ / đẩy NV xuống máy mang theo thẻ
    const setCard = (e) => {
      if (!e.card) return;
      const cur = db.prepare('SELECT card FROM device_users WHERE pin=?').get(e.pin);
      if (!cur) db.prepare('INSERT INTO device_users(pin, name, card) VALUES (?,?,?)').run(e.pin, e.name.slice(0, 24), e.card);
      else if (!cur.card || o.overwrite) db.prepare("UPDATE device_users SET card=?, updated_at=datetime('now') WHERE pin=?").run(e.card, e.pin);
    };
    const CHUNK = 300;
    for (let i = 0; i < data.emps.length; i += CHUNK) {
      tx(() => {
        for (const e of data.emps.slice(i, i + CHUNK)) {
          const dept = deptFor(e.dept);
          const cur = matchEmp(e);
          if (!cur) {
            // tên rác / trống: lấy tên máy đã gửi lên (nếu có), không thì tên tạm — máy gửi tên thật sau sẽ thay
            const name = e.name || cleanName(db.prepare('SELECT name FROM device_users WHERE pin=?').get(e.pin)?.name) || `NV ${e.pin}`;
            const info = db.prepare(`INSERT INTO employees (code, full_name, department, position, phone, role, username, password_hash, device_pin, start_date, active)
              VALUES (?,?,?,?,?,'employee',?,?,?,?,1)`)
              .run(uniqueValue('code', e.code), name, dept, e.position, e.phone, uniqueValue('username', `nv${e.pin}`), pwHash, e.pin, e.start_date);
            const id = Number(info.lastInsertRowid);
            if (!e.active) lockLater.push(id);
            db.prepare('UPDATE device_punches SET employee_id=? WHERE pin=? AND employee_id IS NULL').run(id, e.pin);   // lượt chấm có trước khi có NV
            setProfile(id, e); setCard(e);
            out.emps_created++;
            continue;
          }
          const set = {};
          if (!cur.device_pin) { set.device_pin = e.pin; out.emps_linked++; }
          const draft = cur.full_name === `NV ${e.pin}` || cur.full_name === `NV ${cur.device_pin}` || isJunkName(cur.full_name);   // NV nháp máy tự tạo / tên rác
          const fill = (col, val) => { if (val && val !== cur[col] && (o.overwrite || !cur[col])) set[col] = val; };
          if (e.name && e.name !== cur.full_name && (o.overwrite || draft || !cur.full_name)) set.full_name = e.name;
          fill('department', dept); fill('position', e.position); fill('phone', e.phone); fill('start_date', e.start_date);
          const keys = Object.keys(set);
          if (keys.length) {
            db.prepare(`UPDATE employees SET ${keys.map((k) => k + '=?').join(', ')} WHERE id=?`).run(...keys.map((k) => set[k]), cur.id);
            if (set.device_pin) db.prepare('UPDATE device_punches SET employee_id=? WHERE pin=? AND employee_id IS NULL').run(cur.id, e.pin);
            if (keys.some((k) => k !== 'device_pin')) out.emps_updated++;
          }
          setProfile(cur.id, e); setCard(e);
        }
      });
      prog(5 + 15 * Math.min(1, (i + CHUNK) / data.emps.length), `Nhân viên ${Math.min(i + CHUNK, data.emps.length)} / ${data.emps.length}`);
      await tick();
      if (shouldStop()) return stopNow();
    }
  }

  // 2b) CA + LỊCH TRÌNH (Wise Eye) — làm TRƯỚC lượt chấm để công tính ngay theo đúng ca. NV được gán mà lượt chấm đã có sẵn
  //     (chuyển lần trước, máy đã gửi) thì lượt trùng không dựng lại ngày → tính lại riêng ở cuối.
  let regEmps = [];
  const dirty = new Set();   // 'empId|ngày' cần tính công lại — gom suốt lúc nhập, tính 1 lần ở bước 4
  if (o.shifts && data.shifts?.length) {
    prog(20, 'Đang chép ca + lịch trình…');
    const touched = tx(() => applyShifts(data, o, out));
    const has = db.prepare('SELECT 1 FROM device_punches WHERE employee_id=? LIMIT 1');
    regEmps = touched.filter((id) => has.get(id));
    await tick();
  }

  // 3) LƯỢT CHẤM — theo từng máy, xếp theo Số ID + giờ; mỗi đợt 1 giao dịch rồi nhả luồng
  if (o.punches && data.punches.length) {
    const from = o.from || '0000', to = o.to ? o.to + ' 99' : '9999';
    const list = data.punches.filter((p) => p.time >= from && p.time <= to);
    out.punches_read = list.length;
    const before = db.prepare('SELECT COUNT(*) c FROM device_punches').get().c;
    const bySerial = new Map();
    for (const p of list) { if (!bySerial.has(p.serial)) bySerial.set(p.serial, []); bySerial.get(p.serial).push(p); }
    const total = list.length, t0 = Date.now();
    let doneN = 0, chunkN = 0, size = 300;
    const noAsk = () => {};   // NV đã tạo ở bước 2; Số ID không có NV thì giữ lượt chấm chờ (không hỏi máy)
    // NHẬP HẾT lượt chấm trước, tính công MỘT lần ở bước 4 (dirty). Trước đây mỗi đợt 2.000 lượt tính lại ngay các ngày đó → cùng
    // 1 ngày của NV chấm nhiều máy bị dựng lại nhiều lần; 1,5 triệu lượt On39 chạy hàng giờ, máy chủ trả lời 13–27 giây (pretty 28/11/2026).
    for (const [serial, arr] of bySerial) {
      arr.sort((a, b) => (a.pin === b.pin ? (a.time < b.time ? -1 : a.time > b.time ? 1 : 0) : (+a.pin - +b.pin) || (a.pin < b.pin ? -1 : 1)));
      for (let i = 0; i < arr.length;) {
        const part = arr.slice(i, i + size), got = new Set();
        i += part.length;
        const ts = Date.now();
        tx(() => ingestAttlog(serial, part.map((p) => `${p.pin}\t${p.time}\t${p.status}\t0`).join('\n'), { ask: noAsk, collect: got }));
        size = fit(part.length, Date.now() - ts, 50, 5000);
        for (const k of got) dirty.add(k);
        addPending(pend, got);
        doneN += part.length;
        if (++chunkN % 10 === 0) setSetting(PENDING_KEY, JSON.stringify(pend));   // máy chủ tắt giữa chừng vẫn còn ghi nhớ
        const rate = Math.round(doneN / Math.max(1, (Date.now() - t0) / 1000));
        prog(20 + 60 * doneN / total, `Lượt chấm ${doneN.toLocaleString('vi')} / ${total.toLocaleString('vi')} (${rate.toLocaleString('vi')} lượt/giây)`);
        await breathe();
        if (shouldStop()) return stopNow({ punches_new: db.prepare('SELECT COUNT(*) c FROM device_punches').get().c - before });
      }
    }
    out.punches_new = db.prepare('SELECT COUNT(*) c FROM device_punches').get().c - before;
    setSetting(PENDING_KEY, JSON.stringify(pend));
    // NV chấm ở NHIỀU máy: lượt nạp theo từng máy → lúc dựng ngày còn thiếu lượt của máy nạp sau; lịch ghép cặp theo thứ tự giờ
    // (L1) dây chuyền lệch sang các ngày sau (file On39 Data_on39_CaDem: 236 NV chấm 2 máy, có NV lệch pha cả tháng) → dựng lại ở bước 4
    const serials = new Map();
    for (const p of list) { if (!serials.has(p.pin)) serials.set(p.pin, new Set()); serials.get(p.pin).add(p.serial); }
    const idOf = db.prepare("SELECT id FROM employees WHERE device_pin=? AND device_pin<>''");
    const multi = [...serials].filter(([, s]) => s.size > 1).map(([pin]) => idOf.get(pin)?.id).filter(Boolean);
    regEmps = [...new Set([...regEmps, ...multi])];
  }
  // 4) TÍNH CÔNG MỘT LẦN, từng NV theo thứ tự ngày (ca đêm lấy đúng giờ ra sáng hôm sau): các ngày có lượt vừa nhập + mọi ngày
  // của NV vừa được gán ca mà lượt chấm có từ trước + NV chấm nhiều máy. Mỗi NV 1 giao dịch, nhả luồng sau vài NV.
  if (regEmps.length) {
    const dates = db.prepare('SELECT DISTINCT work_date FROM device_punches WHERE employee_id=?');
    for (const id of regEmps) for (const { work_date } of dates.all(id)) dirty.add(id + '|' + work_date);
  }
  // khoảng ngày còn chờ tính từ lần chuyển trước bị Dừng / máy chủ khởi động lại giữa chừng
  const inRange = db.prepare('SELECT DISTINCT work_date FROM device_punches WHERE employee_id=? AND work_date BETWEEN ? AND ?');
  for (const [eid, r] of Object.entries(pend)) for (const { work_date } of inRange.all(+eid, r[0], r[1])) dirty.add(eid + '|' + work_date);
  if (dirty.size) {
    const byEmp = new Map();
    for (const k of dirty) { const eid = k.split('|')[0]; if (!byEmp.has(eid)) byEmp.set(eid, []); byEmp.get(eid).push(k); }
    const emps = [...byEmp.keys()];
    let days = 30;
    for (let i = 0; i < emps.length; i++) {
      // từng NV theo thứ tự ngày (ca đêm cần ngày trước dựng trước); mỗi giao dịch ~BUDGET_MS rồi nhả luồng
      const keys = byEmp.get(emps[i]).sort((a, b) => (a < b ? -1 : 1));
      for (let k = 0; k < keys.length;) {
        const part = keys.slice(k, k + days);
        k += part.length;
        const ts = Date.now();
        tx(() => rebuildDays(part));
        days = fit(part.length, Date.now() - ts, 1, 120);
        await breathe();
      }
      out.recomputed_emps++;
      if (i % 5 === 4 || i === emps.length - 1) {
        prog(80 + 20 * (i + 1) / emps.length, `Tính công: ${(i + 1).toLocaleString('vi')} / ${emps.length.toLocaleString('vi')} NV`);
        await tick();
        if (shouldStop()) return stopNow();   // khoảng ngày chờ tính vẫn giữ → lần chuyển sau tính tiếp
      }
    }
  }
  setSetting(PENDING_KEY, '');
  if (lockLater.length) tx(() => { for (const id of lockLater) db.prepare('UPDATE employees SET active=0 WHERE id=?').run(id); });
  prog(100, 'Xong');
  return out;
}
