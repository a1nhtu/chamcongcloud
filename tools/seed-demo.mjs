// Sinh dữ liệu DEMO cho khách xem: tài khoản demo + nhân viên mẫu + chấm công đẹp.
// Chạy: node tools/seed-demo.mjs   (nên tắt server trước khi chạy để tránh khoá file)
// An toàn: bỏ qua bản ghi đã có; KHÔNG đụng dữ liệu shipped (dist-khach không kèm data/).
import { db, initSchema, getSetting } from '../server/db.js';
import { hashPassword } from '../server/auth.js';
import { computeLate, computeCheckout, isWeekendDay, vnWeekday } from '../server/attendance-calc.js';
import { vnDateStr, nowIso } from '../server/util.js';

initSchema();
db.exec('PRAGMA busy_timeout = 8000'); // chờ nếu app đang ghi → chạy được cả khi app đang bật

const office = db.prepare('SELECT * FROM offices ORDER BY id LIMIT 1').get();
const shift = db.prepare("SELECT * FROM shifts WHERE name='Hành chính' ORDER BY id LIMIT 1").get() || db.prepare('SELECT * FROM shifts ORDER BY id LIMIT 1').get();
const officeId = office.id, shiftId = shift.id;
// Demo: BẬT tăng ca cho ca này để dữ liệu có OT trực quan (mặc định ca hành chính tắt OT)
db.prepare('UPDATE shifts SET allow_ot=1, ot_start_after_min=30 WHERE id=?').run(shiftId);
shift.allow_ot = 1; shift.ot_start_after_min = 30;
const weekend = getSetting('weekend_days', '7');
const roundingDecimals = parseInt(getSetting('workunit_rounding', '2'), 10) || 2;
const adminId = db.prepare("SELECT id FROM employees WHERE username='admin'").get()?.id || null;

const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const iso = (date, m) => new Date(`${date}T${hhmm(m)}:00+07:00`).toISOString();

/* ---------------- 1) Tài khoản DEMO cho khách nghịch ---------------- */
function upsertEmp({ code, name, dept, pos, user, pass, role }) {
  const ex = db.prepare('SELECT id FROM employees WHERE username = ?').get(user);
  if (ex) {
    db.prepare(`UPDATE employees SET code=?, full_name=?, department=?, position=?, role=?, office_id=?, shift_id=?, active=1 WHERE id=?`)
      .run(code, name, dept, pos, role, officeId, role === 'admin' ? shiftId : shiftId, ex.id);
    return ex.id;
  }
  return db.prepare(`INSERT INTO employees(code, full_name, department, position, role, username, password_hash, office_id, shift_id)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(code, name, dept, pos, role, user, hashPassword(pass), officeId, shiftId).lastInsertRowid;
}

const demoId = upsertEmp({ code: 'DEMO', name: 'Tài khoản Demo', dept: 'Ban giám đốc', pos: 'Dùng thử', user: 'demo', pass: 'demo123', role: 'admin' });
console.log('✓ Tài khoản demo:  demo / demo123  (toàn quyền, khách nghịch thoải mái)');

/* ---------------- 2) Nhân viên mẫu ---------------- */
// today: {in,out,outside} cho hôm nay; null = hôm nay chưa chấm
const EMP = [
  { code: 'NV001', name: 'Nguyễn Việt Hoàng', dept: 'Kinh doanh', pos: 'Nhân viên · Sale', user: 'nv001', today: { in: '07:58', out: null, outside: false } },
  { code: 'NV002', name: 'Trần Thị Mai Anh', dept: 'Kinh doanh', pos: 'Trưởng nhóm Sale', user: 'nv002', today: { in: '08:22', out: null, outside: false } }, // đi muộn
  { code: 'NV003', name: 'Lê Minh Quân', dept: 'Kỹ thuật', pos: 'Kỹ thuật viên', user: 'nv003', today: { in: '07:46', out: '19:50', outside: false } }, // tăng ca hôm nay
  { code: 'NV004', name: 'Phạm Thu Hà', dept: 'Kế toán', pos: 'Kế toán viên', user: 'nv004', today: { in: '08:02', out: null, outside: false } },
  { code: 'NV005', name: 'Hoàng Văn Dũng', dept: 'Kỹ thuật', pos: 'Kỹ thuật viên', user: 'nv005', today: { in: '08:05', out: null, outside: true } }, // ngoài VP
  { code: 'NV006', name: 'Vũ Thị Lan', dept: 'Marketing', pos: 'Nhân viên Marketing', user: 'nv006', today: null }, // chưa chấm
  { code: 'NV007', name: 'Đặng Quốc Bảo', dept: 'Kinh doanh', pos: 'Nhân viên · Sale', user: 'nv007', today: null }, // chưa chấm
];
for (const e of EMP) e.id = upsertEmp({ ...e, pass: '123456', role: 'employee' });
console.log(`✓ ${EMP.length} nhân viên mẫu (nv001..nv007 / 123456)`);

/* ---------------- 3) Cấu hình lương ---------------- */
const SALARY = {
  NV001: [9000000, 800000], NV002: [13000000, 1500000], NV003: [11000000, 1000000],
  NV004: [10000000, 700000], NV005: [11000000, 1000000], NV006: [9500000, 600000], NV007: [8500000, 500000],
};
const upSal = db.prepare(`INSERT INTO salary_configs(employee_id, basic_salary, working_days_per_month, allowance)
  VALUES (?,?,26,?) ON CONFLICT(employee_id) DO UPDATE SET basic_salary=excluded.basic_salary, allowance=excluded.allowance`);
for (const e of EMP) { const s = SALARY[e.code]; if (s) upSal.run(e.id, s[0], s[1]); }
console.log('✓ Cấu hình lương cho nhân viên mẫu');

/* ---------------- 4) Đơn nghỉ phép (1 đã duyệt + 1 chờ duyệt) ---------------- */
const today = vnDateStr();
const [ty, tm, td] = today.split('-').map(Number);
const dstr = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
// khoảng tháng trước
const pm = tm === 1 ? 12 : tm - 1, py = tm === 1 ? ty - 1 : ty;
const leaveSkip = new Set(); // 'empId|date' — không sinh chấm công cho ngày nghỉ phép
function addLeave(empId, type, from, to, reason, status) {
  const ex = db.prepare('SELECT id FROM leave_requests WHERE employee_id=? AND from_date=? AND to_date=?').get(empId, from, to);
  if (ex) return;
  db.prepare(`INSERT INTO leave_requests(employee_id, type, from_date, to_date, reason, status, reviewed_by, reviewed_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(empId, type, from, to, reason,
    status, status === 'approved' ? adminId : null, status === 'approved' ? nowIso() : null);
}
const nv004 = EMP.find(e => e.code === 'NV004');
addLeave(nv004.id, 'Nghỉ phép', dstr(py, pm, 18), dstr(py, pm, 19), 'Về quê có việc gia đình', 'approved');
for (const d of [18, 19]) leaveSkip.add(nv004.id + '|' + dstr(py, pm, d));
const nv002 = EMP.find(e => e.code === 'NV002');
const fut = new Date(`${today}T00:00:00+07:00`); fut.setUTCDate(fut.getUTCDate() + 5);
const futStr = fut.toISOString().slice(0, 10);
addLeave(nv002.id, 'Nghỉ phép', futStr, futStr, 'Khám sức khỏe định kỳ', 'pending');
console.log('✓ Đơn từ: 1 đã duyệt + 1 chờ duyệt');

/* ---------------- 5) Dữ liệu chấm công ---------------- */
const otTypeOf = (date) => isWeekendDay(date, weekend) ? 'cuoi_tuan' : 'thuong'; // không có ngày lễ trong demo
const insAtt = db.prepare(`INSERT INTO attendance
  (employee_id, work_date, check_in_at, check_in_lat, check_in_lng, check_in_photo, check_in_office_id,
   check_in_distance_m, check_in_outside, late_min, day_status, ot_type, shift_id, shift_source,
   check_out_at, check_out_lat, check_out_lng, check_out_photo, check_out_distance_m,
   work_minutes, early_min, ot_min, work_unit)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const hasAtt = db.prepare('SELECT 1 FROM attendance WHERE employee_id=? AND work_date=?');

function place(outside) {
  const distance = outside ? randInt(300, 700) : randInt(20, 160);
  const lat = office.lat + (Math.random() - 0.5) * (outside ? 0.02 : 0.001);
  const lng = office.lng + (Math.random() - 0.5) * (outside ? 0.02 : 0.001);
  return { distance, lat, lng, outside: outside ? 1 : 0 };
}
function writeDay(empId, date, ci, co, outside) {
  if (hasAtt.get(empId, date)) return false;
  const ciIso = iso(date, ci);
  const p = place(outside);
  const late = computeLate(shift, ciIso, date);
  let calc, coIso = null, coP = null;
  if (co != null) {
    coIso = iso(date, co);
    coP = place(outside); // vị trí lúc ra (xấp xỉ)
    calc = computeCheckout(shift, ciIso, coIso, date, { isHoliday: false, isWeekend: isWeekendDay(date, weekend), roundingDecimals });
  } else {
    calc = { early_min: 0, ot_min: 0, work_minutes: 0, work_unit: 0, ot_type: otTypeOf(date), day_status: 'thieu_ra' };
  }
  insAtt.run(empId, date, ciIso, p.lat, p.lng, null, officeId, p.distance, p.outside, late,
    calc.day_status, calc.ot_type, shiftId, 'default',
    coIso, coP?.lat ?? null, coP?.lng ?? null, null, coP?.distance ?? null,
    calc.work_minutes, calc.early_min, calc.ot_min, calc.work_unit);
  return true;
}

// Sinh 1 ngày ngẫu nhiên "đẹp" (đa số đúng giờ, ít muộn/sớm/thiếu ra)
function randomDay(empId, date) {
  if (leaveSkip.has(empId + '|' + date)) return;         // ngày nghỉ phép → để trống (báo cáo hiện 'P')
  if (Math.random() < 0.04) return;                       // ~4% vắng
  const r = Math.random();
  let ci;
  if (r < 0.72) ci = 480 + randInt(-13, 3);               // đúng giờ (07:47–08:03)
  else if (r < 0.90) ci = 480 + randInt(8, 27);           // đi muộn
  else ci = 480 + randInt(-27, -15);                      // đến sớm
  const noOut = Math.random() < 0.05;                     // ~5% quên ra
  let co = null;
  if (!noOut) {
    const ro = Math.random();
    if (ro < 0.60) co = 1050 + randInt(-2, 25);           // ra đúng giờ (17:28–17:55) ~60%
    else if (ro < 0.78) co = 1050 - randInt(18, 42);      // về sớm ~18%
    else co = 1050 + randInt(75, 210);                     // ở lại TĂNG CA ~22% (18:45–21:00 → OT 1–3h)
  }
  const outside = Math.random() < 0.08;
  writeDay(empId, date, ci, co, outside);
}

// Dọn các bản ghi demo sinh tự động cũ (giữ nguyên lần chấm THẬT có ảnh) để chạy lại sạch
const delOld = db.prepare("DELETE FROM attendance WHERE employee_id=? AND work_date<=? AND check_in_photo IS NULL AND shift_source='default'");
for (const e of EMP) delOld.run(e.id, today);

// Danh sách ngày (theo LỊCH, mốc trưa UTC để không lệch múi giờ) từ đầu tháng trước tới HÔM QUA
const dates = [];
const endCal = new Date(Date.UTC(ty, tm - 1, td, 12, 0, 0)); // hôm nay (xử lý riêng)
for (let t = new Date(Date.UTC(py, pm - 1, 1, 12, 0, 0)); t < endCal; t.setUTCDate(t.getUTCDate() + 1))
  dates.push(t.toISOString().slice(0, 10));

db.exec('BEGIN');
let n = 0;
for (const e of EMP) {
  for (const d of dates) {
    if (vnWeekday(d) === 7) continue;   // Chủ nhật nghỉ (không thuộc work_days)
    const before = hasAtt.get(e.id, d);
    randomDay(e.id, d);
    if (!before && hasAtt.get(e.id, d)) n++;
  }
  // HÔM NAY: theo kịch bản cố định cho bảng Tổng quan sinh động
  if (e.today && vnWeekday(today) !== 7) {
    const t = e.today;
    const ci = (+t.in.slice(0, 2)) * 60 + (+t.in.slice(3, 5));
    const co = t.out ? (+t.out.slice(0, 2)) * 60 + (+t.out.slice(3, 5)) : null;
    if (writeDay(e.id, today, ci, co, t.outside)) n++;
  }
}
db.exec('COMMIT');
console.log(`✓ Đã sinh ${n} bản ghi chấm công (${dstr(py, pm, 1)} → ${today})`);

// Tổng kết hôm nay để đối chiếu dashboard
const ci = db.prepare('SELECT COUNT(*) c FROM attendance WHERE work_date=? AND check_in_at IS NOT NULL').get(today).c;
const lateN = db.prepare('SELECT COUNT(*) c FROM attendance WHERE work_date=? AND late_min>0').get(today).c;
const outN = db.prepare('SELECT COUNT(*) c FROM attendance WHERE work_date=? AND check_in_outside=1').get(today).c;
console.log(`  Hôm nay: đã chấm ${ci}/${EMP.length} · đi muộn ${lateN} · ngoài VP ${outN}`);
db.close();
console.log('\nXONG. Mở lại trang Tổng quan (F5) để thấy dữ liệu mới — không cần khởi động lại app.');
