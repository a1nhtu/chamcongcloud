// CHUYỂN DỮ LIỆU TỪ PHẦN MỀM CHẤM CÔNG CŨ sang Digiplus: Wise Eye On39 / Ronald Jack Pro (file Access .mdb).
// Lấy 3 thứ: BỘ PHẬN (cây cha – con) · NHÂN VIÊN (mã, tên, Số ID máy, bộ phận, chức danh, SĐT, ngày vào làm, thẻ…) · LƯỢT CHẤM.
//  - Đọc file bằng mdb-reader (JS thuần, server/vendor) → chạy được cả Windows lẫn VPS Linux, không cần cài Access/ODBC.
//    Mật khẩu Access (On39 mặc định 12112009) chỉ là lớp khoá ngoài, dữ liệu không mã hoá nên đọc được cả khi không nhập.
//  - normalizeOn39 / normalizeRj: hàm thuần, đổi bảng của từng phần mềm về 1 dạng chung → test không cần DB.
//  - applyLegacy: ghi vào DB. Lượt chấm đi qua ingestAttlog như máy chấm công gửi về (chống trùng, tự dựng lại ngày công),
//    gắn đúng số serial máy cũ → sau này nối máy qua ADMS, máy gửi lại log cũ cũng không bị nhân đôi.
//  - Nhập lại nhiều lần được: bộ phận / NV đã có thì bỏ qua (hoặc cập nhật nếu chọn), lượt chấm trùng tự bỏ.
import MDBReader from './vendor/mdb-reader.mjs';
import { db } from './db.js';
import { ingestAttlog } from './device-sync.js';
import { defaultPasswordHash } from './auth.js';

export const LEGACY_LABEL = { on39: 'Wise Eye On39', rj: 'Ronald Jack Pro' };

/* ------------------------------ đọc file ------------------------------ */
// mdb-reader trả ngày giờ Access thành Date "UTC" mang đúng giờ đồng hồ ghi trong file (= giờ VN) → lấy thẳng các số
const okDate = (d) => d instanceof Date && !isNaN(d) && d.getUTCFullYear() > 1900;
const ymd = (d) => (okDate(d) ? d.toISOString().slice(0, 10) : '');
const stamp = (d) => (okDate(d) ? d.toISOString().slice(0, 19).replace('T', ' ') : '');
const str = (v) => (v == null ? '' : String(v).trim());
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
      const full = str(u.UserFullName);
      const hire = ymd(u.UserHireDay);
      return {
        pin, code: str(u.UserFullCode) || pin,
        // Nhiều nơi chỉ gõ tên ở "Tên chấm công" (UserEnrollName), còn Họ tên để bằng mã số → lấy tên có chữ
        name: (hasLetter(full) ? full : '') || str(u.UserEnrollName) || str(u.UserLastName) || full,
        dept: deptKeys.has('D' + u.UserIDD) ? 'D' + u.UserIDD : null,
        position: titles.get(u.UserIDTitle) || '', phone: str(u.UserPhoneNumber), card: card(u.UserCardNo),
        start_date: hire, birth_date: birth(textDate(u.UserBirthDay), hire), id_number: idNo(u.UserIDCard),
        address: str(u.UserAddress), email: '', active: true,
      };
    });
  const mach = table('Machines', ['MachineID', 'MachineName', 'SerialNumber']);
  const serialOf = new Map(mach.map((m) => [m.MachineID, str(m.SerialNumber) || 'ON39_MAY' + m.MachineID]));
  const punches = [];
  for (const c of table('CheckInOut', ['UserEnrollNumber', 'TimeStr', 'OriginType', 'MachineNo'])) {
    const time = stamp(c.TimeStr);
    if (!time || !(c.UserEnrollNumber > 0)) continue;
    punches.push({ pin: String(c.UserEnrollNumber), time, status: str(c.OriginType).toUpperCase() === 'O' ? 1 : 0,
      serial: serialOf.get(c.MachineNo) || 'ON39_MAY' + (c.MachineNo || 0) });
  }
  return { kind: 'on39', company, depts, emps, punches,
    machines: mach.map((m) => ({ serial: serialOf.get(m.MachineID), name: str(m.MachineName) })) };
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
        pin, code: str(n.MaNhanVien) || pin, name: str(n.TenNhanVien) || str(n.TenChamCong),
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
  if (expect && LEGACY_LABEL[expect] && expect !== kind)
    throw new Error(`File này là dữ liệu ${LEGACY_LABEL[kind]}, không phải ${LEGACY_LABEL[expect]} — chọn lại đúng phần mềm hoặc đúng file`);
  return kind === 'on39' ? normalizeOn39(table) : normalizeRj(table);
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
    emps: data.emps.length, emps_existing: existing, emps_new: data.emps.length - existing,
    emps_no_dept: data.emps.filter((e) => !e.dept).length,
    punches: data.punches.length, first_date: first.slice(0, 10), last_date: last.slice(0, 10),
    machines: data.machines,
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

// opts: { depts, emps, punches (true/false), overwrite (ghi đè thông tin NV đã có), from, to ('YYYY-MM-DD', rỗng = tất cả) }
// prog(%, chữ). Trả số liệu đã làm.
export async function applyLegacy(data, opts = {}, prog = () => {}) {
  const o = { depts: true, emps: true, punches: true, overwrite: false, from: '', to: '', ...opts };
  const out = { depts_created: 0, emps_created: 0, emps_updated: 0, emps_linked: 0, punches_read: 0, punches_new: 0 };

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
            const name = e.name || `NV ${e.pin}`;
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
          const draft = cur.full_name === `NV ${e.pin}` || cur.full_name === `NV ${cur.device_pin}`;   // NV nháp máy tự tạo
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
    }
  }

  // 3) LƯỢT CHẤM — theo từng máy, xếp theo Số ID + giờ; mỗi đợt 1 giao dịch rồi nhả luồng
  if (o.punches && data.punches.length) {
    const from = o.from || '0000', to = o.to ? o.to + ' 99' : '9999';
    const list = data.punches.filter((p) => p.time >= from && p.time <= to);
    out.punches_read = list.length;
    const before = db.prepare('SELECT COUNT(*) c FROM device_punches').get().c;
    const bySerial = new Map();
    for (const p of list) { if (!bySerial.has(p.serial)) bySerial.set(p.serial, []); bySerial.get(p.serial).push(p); }
    const CHUNK = 2000, total = list.length;
    let doneN = 0;
    const noAsk = () => {};   // NV đã tạo ở bước 2; Số ID không có NV thì giữ lượt chấm chờ (không hỏi máy)
    for (const [serial, arr] of bySerial) {
      arr.sort((a, b) => (a.pin === b.pin ? (a.time < b.time ? -1 : a.time > b.time ? 1 : 0) : (+a.pin - +b.pin) || (a.pin < b.pin ? -1 : 1)));
      for (let i = 0; i < arr.length; i += CHUNK) {
        const part = arr.slice(i, i + CHUNK);
        tx(() => ingestAttlog(serial, part.map((p) => `${p.pin}\t${p.time}\t${p.status}\t0`).join('\n'), { ask: noAsk }));
        doneN += part.length;
        prog(20 + 80 * doneN / total, `Lượt chấm ${doneN.toLocaleString('vi')} / ${total.toLocaleString('vi')} (đang tính lại công)`);
        await tick();
      }
    }
    out.punches_new = db.prepare('SELECT COUNT(*) c FROM device_punches').get().c - before;
  }
  if (lockLater.length) tx(() => { for (const id of lockLater) db.prepare('UPDATE employees SET active=0 WHERE id=?').run(id); });
  prog(100, 'Xong');
  return out;
}
