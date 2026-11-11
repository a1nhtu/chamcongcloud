// Tính lương (GĐ4) — theo công thức phần mềm mẫu ChamCongApp.
import { db, getSetting, adminAttWhere, EMP_IN_PERIOD, empHourly, deptWithChildren } from './db.js';
import { leaveTypeOf, leaveDaysIn } from './leave-quota.js';
import { splitOtTiers, nightMinutes, shiftBounds } from './attendance-calc.js';
import { virtualOt, applyVirtual } from './virtual-att.js';

const pad = (n) => String(n).padStart(2, '0');
const round0 = (n) => Math.round(n || 0);
const round2 = (n) => Math.round((n || 0) * 100) / 100;

// Khoảng kỳ lương cho "tháng lương" month (1..12), year.
export function payPeriod(year, month, startDay) {
  if (!startDay || startDay <= 1) {
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(days)}` };
  }
  // VD startDay=26 → 26 tháng trước đến 25 tháng này
  const prev = new Date(Date.UTC(year, month - 1, 1)); prev.setUTCMonth(prev.getUTCMonth() - 1);
  const py = prev.getUTCFullYear(), pm = prev.getUTCMonth() + 1;
  return { from: `${py}-${pad(pm)}-${pad(startDay)}`, to: `${year}-${pad(month)}-${pad(startDay - 1)}` };
}

// Báo cáo Bảng lương: chọn TRỌN 1 tháng dương lịch = kỳ lương đã cài (Cài đặt › Lương, như trước đây);
// chọn khoảng khác (VD 05/10 → 04/11) = tính đúng từ ngày đến ngày đó.
export function reportPayRange(from, to, startDay) {
  const y = +from.slice(0, 4), m = +from.slice(5, 7);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const wholeMonth = from === `${y}-${pad(m)}-01` && to === `${y}-${pad(m)}-${pad(days)}`;
  return wholeMonth ? { ...payPeriod(y, m, startDay), custom: false } : { from, to, custom: true };
}

const DEFAULT_CFG = {
  basic_salary: 0, daily_rate: null, working_days_per_month: 26,
  ot_rate_weekday: 1.5, ot_rate_weekend: 2.0, ot_rate_holiday: 3.0, allowance: 0, hourly_rate: 0,
};

// Số giờ chuẩn của 1 ngày công (Cài đặt > Quy tắc tính công) — đơn giá giờ = đơn giá ngày ÷ số này. Mặc định 8 = như trước đây.
export function hoursPerDay() { const v = parseFloat(getSetting('pay_hours_per_day', '8')); return Number.isFinite(v) && v >= 1 && v <= 24 ? v : 8; }

// PHỤ CẤP LÀM ĐÊM (công tắc night_pay, mặc định TẮT = bảng lương y như cũ). Điều 98 BLLĐ 2019 + Điều 55–57 NĐ 145/2020:
//   · giờ làm trong ca rơi vào 22:00–06:00: trả thêm ít nhất 30% đơn giá giờ
//   · giờ TĂNG CA rơi vào 22:00–06:00: ngoài tiền tăng ca, trả thêm 30% + 20% × lương giờ ban ngày của ngày đó
//     (ngày thường 100% · ngày nghỉ = hệ số tăng ca ngày nghỉ · ngày lễ = hệ số tăng ca ngày lễ) → mức chuẩn 200% / 270% / 390%.
//     Ngày thường đã tăng ca ban ngày rồi mới tăng ca đêm thì luật tính 210% — phần mềm tính mức 200%, chênh thì cộng tay.
export function nightPayCfg() {
  const pct = (k, d) => { const v = parseFloat(getSetting(k, String(d))); return Number.isFinite(v) && v >= 0 && v <= 300 ? v : d; };
  return { on: getSetting('night_pay', '0') === '1', pct: pct('night_pct', 30), otPct: pct('night_ot_pct', 20) };
}
// Số phút làm đêm của 1 dòng công: reg = trong giờ ca · ot = phần tăng ca. Không vượt quá giờ công / phút tăng ca đã tính của dòng đó.
export function nightSplit(r) {
  if (!r.check_in_at || !r.check_out_at) return { reg: 0, ot: 0 };
  const inAt = new Date(r.check_in_at).getTime(), outAt = new Date(r.check_out_at).getTime();
  const all = nightMinutes(inAt, outAt);
  if (!all) return { reg: 0, ot: 0 };
  const work = r.work_minutes || 0, otMin = r.ot_min || 0;
  if (!work) return { reg: 0, ot: Math.min(otMin, all) };                         // cả ngày là tăng ca (ngày nghỉ / lễ)
  if (!r.start_time || !r.end_time) return { reg: Math.min(work, all), ot: 0 };   // không rõ ca → coi là giờ làm thường
  const { start, end } = shiftBounds(r.work_date, r);
  const s = start.getTime(), e = end.getTime();
  const inShift = nightMinutes(Math.max(inAt, s), Math.min(outAt, e));
  const outShift = nightMinutes(inAt, Math.min(outAt, s)) + nightMinutes(Math.max(inAt, e), outAt);
  return { reg: Math.min(work, inShift), ot: Math.min(otMin, outShift) };
}

// Hệ số tăng ca CHUNG của công ty (Cài đặt > Quy tắc tính công) — dùng cho NV chưa đặt lương riêng
export function companyOtRates() {
  const num = (k, d) => { const v = parseFloat(getSetting(k, String(d))); return Number.isFinite(v) && v > 0 ? v : d; };
  return { ot_rate_weekday: num('ot_rate_weekday', 1.5), ot_rate_weekend: num('ot_rate_weekend', 2.0), ot_rate_holiday: num('ot_rate_holiday', 3.0) };
}
export function getSalaryConfig(employeeId) {
  return db.prepare('SELECT * FROM salary_configs WHERE employee_id = ?').get(employeeId) || { employee_id: employeeId, ...DEFAULT_CFG, ...companyOtRates() };
}

// SỬA LƯƠNG HÀNG LOẠT: đặt các ô trong `fields` cho mọi NV đang làm của bộ phận `dept` (gồm bộ phận con; rỗng = tất cả).
// Chỉ ghi đè ô có trong `fields`; ô khác giữ nguyên cấu hình cũ (NV chưa có cấu hình → mặc định như getSalaryConfig).
// daily_rate = null nghĩa là "tự tính" (lương CB ÷ ngày công chuẩn). Trả về số NV đã cập nhật.
const BULK_KEYS = ['basic_salary', 'daily_rate', 'working_days_per_month', 'ot_rate_weekday', 'ot_rate_weekend', 'ot_rate_holiday', 'allowance', 'hourly_rate'];
export function bulkSetSalary({ dept = '', fields = {} } = {}) {
  const set = {};
  for (const k of BULK_KEYS) {
    if (!(k in fields)) continue;
    const v = fields[k];
    if (k === 'daily_rate') { set[k] = v === null || v === '' || !(+v > 0) ? null : +v; continue; }
    const n = +v;
    if (!Number.isFinite(n) || n < 0) throw new Error('Giá trị không hợp lệ: ' + k);
    if (k === 'working_days_per_month' && !(n >= 1 && n <= 31)) throw new Error('Ngày công chuẩn phải từ 1 đến 31');
    if (k.startsWith('ot_rate_') && !(n > 0)) throw new Error('Hệ số tăng ca phải lớn hơn 0');
    set[k] = n;
  }
  if (!Object.keys(set).length) throw new Error('Chưa chọn ô nào để sửa');
  const depts = deptWithChildren(dept ? [dept] : []);
  const emps = db.prepare(`SELECT id FROM employees WHERE active = 1${adminAttWhere('role')}` + (depts.length ? ` AND department IN (${depts.map(() => '?').join(',')})` : '')).all(...depts);
  const up = db.prepare(`INSERT INTO salary_configs
      (employee_id, basic_salary, daily_rate, working_days_per_month, ot_rate_weekday, ot_rate_weekend, ot_rate_holiday, allowance, hourly_rate, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?, datetime('now'))
    ON CONFLICT(employee_id) DO UPDATE SET
      basic_salary=excluded.basic_salary, daily_rate=excluded.daily_rate, working_days_per_month=excluded.working_days_per_month,
      ot_rate_weekday=excluded.ot_rate_weekday, ot_rate_weekend=excluded.ot_rate_weekend, ot_rate_holiday=excluded.ot_rate_holiday,
      allowance=excluded.allowance, hourly_rate=excluded.hourly_rate, updated_at=datetime('now')`);
  db.exec('BEGIN');
  try {
    for (const { id } of emps) {
      const c = { ...getSalaryConfig(id), ...set };
      up.run(id, c.basic_salary || 0, c.daily_rate || null, c.working_days_per_month || 26,
        c.ot_rate_weekday, c.ot_rate_weekend, c.ot_rate_holiday, c.allowance || 0, c.hourly_rate || 0);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return emps.length;
}

// Tính lương 1 nhân viên trong kỳ [from,to]. opts.virt = LƯƠNG ẢO (tăng ca theo công ảo); opts.vmap = map công ảo nạp sẵn
export function computePayrollForEmployee(employeeId, from, to, opts = {}) {
  const cfg = getSalaryConfig(employeeId);
  const workingDays = cfg.working_days_per_month || 26;
  const dailyRate = (cfg.daily_rate != null && cfg.daily_rate > 0) ? cfg.daily_rate : (cfg.basic_salary || 0) / workingDays;
  const hourlyRate = dailyRate / hoursPerDay();

  let rows = db.prepare(
    `SELECT a.id, a.employee_id, a.work_date, a.work_unit, a.work_minutes, a.ot_min, a.ot_type, a.check_in_at, a.check_out_at,
            s.start_time, s.end_time, s.ot_tier1_min, s.ot_tier2_min, s.ot_tier3_min, s.ot_tier2_rate, s.ot_tier3_rate, s.ot_tier4_rate
     FROM attendance a LEFT JOIN shifts s ON s.id = a.shift_id
     WHERE a.employee_id = ? AND a.work_date >= ? AND a.work_date <= ?`
  ).all(employeeId, from, to);
  if (opts.virt) {   // lương ảo: số phút tăng ca lấy theo công ảo
    const vm = opts.vmap || virtualOt([employeeId], from, to, false, opts.virt);
    rows = applyVirtual(rows, vm, employeeId);   // tăng ca theo công ảo; tháng đã chốt = đúng bản chốt
  }

  // Chế độ tính công theo GIỜ: lương = tổng giờ làm × đơn giá giờ + phụ cấp
  if (empHourly(employeeId)) {
    const totalMin = rows.reduce((s, r) => s + (r.work_minutes || 0), 0);
    // Nhiều phiên/ngày vẫn tính 1 NGÀY công (đếm theo ngày distinct, không theo số dòng)
    const daysWorked = new Set(rows.filter((r) => (r.work_minutes || 0) > 0).map((r) => r.work_date)).size;
    const hrs = totalMin / 60;
    const rate = cfg.hourly_rate || 0;
    const workSalary = hrs * rate;
    const N = nightPayCfg();
    const nightMin = N.on ? rows.reduce((s, r) => s + Math.min(r.work_minutes || 0, r.check_in_at && r.check_out_at ? nightMinutes(r.check_in_at, r.check_out_at) : 0), 0) : 0;
    const nightPay = nightMin / 60 * rate * N.pct / 100;
    const gross = workSalary + nightPay + (cfg.allowance || 0);
    return {
      ...(N.on ? { nightHours: round2(nightMin / 60), nightOtHours: 0, nightPay: round0(nightPay) } : {}),
      hourly: true, totalHours: round2(hrs), daysWorked, hourlyRate: round0(rate),
      workUnits: round2(daysWorked), paidLeaveDays: 0,
      otHoursWeekday: 0, otHoursWeekend: 0, otHoursHoliday: 0, otHoursTotal: 0,
      basicSalary: 0, dailyRate: 0,
      workSalary: round0(workSalary), paidLeaveSalary: 0, otSalary: 0,
      allowance: round0(cfg.allowance || 0), gross: round0(gross), net: round0(gross),
    };
  }

  const N = nightPayCfg();
  let nightReg = 0, nightOt = 0, nightPay = 0;
  let workUnits = 0, otMinW = 0, otMinE = 0, otMinH = 0;
  // Tăng ca ngày thường chia mức TC1→TC4 theo giới hạn của ca; tiền OT ngày thường = Σ giờ mức × hệ số mức
  // (TC1 dùng hệ số OT ngày thường của NV; TC2–TC4 dùng hệ số đặt ở ca, để 0 = cũng theo hệ số ngày thường)
  const tierMin = [0, 0, 0, 0];
  let otPayWeekdayUnits = 0;   // Σ (phút × hệ số)
  for (const r of rows) {
    if (N.on) {
      const n = nightSplit(r);
      const dayRate = r.ot_type === 'cuoi_tuan' ? cfg.ot_rate_weekend : r.ot_type === 'le' ? cfg.ot_rate_holiday : 1;
      nightReg += n.reg; nightOt += n.ot;
      nightPay += n.reg / 60 * hourlyRate * N.pct / 100 + n.ot / 60 * hourlyRate * (N.pct + N.otPct * dayRate) / 100;
    }
    workUnits += r.work_unit || 0;
    if (r.ot_type === 'cuoi_tuan') otMinE += r.ot_min || 0;
    else if (r.ot_type === 'le') otMinH += r.ot_min || 0;
    else {
      otMinW += r.ot_min || 0;
      const t = splitOtTiers(r.ot_min || 0, r);
      const rates = [cfg.ot_rate_weekday, r.ot_tier2_rate || cfg.ot_rate_weekday, r.ot_tier3_rate || cfg.ot_rate_weekday, r.ot_tier4_rate || cfg.ot_rate_weekday];
      t.forEach((m, i) => { tierMin[i] += m; otPayWeekdayUnits += m * rates[i]; });
    }
  }
  const otH_w = otMinW / 60, otH_e = otMinE / 60, otH_h = otMinH / 60;

  // Nghỉ phép có lương (đã duyệt, khác "không lương") — số ngày trong kỳ
  let paidLeaveDays = 0;
  const leaves = db.prepare(
    "SELECT type, from_date, to_date, half FROM leave_requests WHERE employee_id = ? AND status='approved' AND from_date <= ? AND to_date >= ?"
  ).all(employeeId, to, from);
  for (const l of leaves) {
    if (!leaveTypeOf(l.type).paid) continue;          // nghỉ không lương
    paidLeaveDays += leaveDaysIn(l, from, to);        // nửa ngày = 0,5
  }

  const workSalary = workUnits * dailyRate;
  const paidLeaveSalary = paidLeaveDays * dailyRate;
  const otSalary = (otPayWeekdayUnits / 60) * hourlyRate
                 + otH_e * hourlyRate * cfg.ot_rate_weekend
                 + otH_h * hourlyRate * cfg.ot_rate_holiday;
  const gross = workSalary + paidLeaveSalary + otSalary + nightPay + (cfg.allowance || 0);

  return {
    ...(N.on ? { nightHours: round2(nightReg / 60), nightOtHours: round2(nightOt / 60), nightPay: round0(nightPay) } : {}),
    workUnits: round2(workUnits), paidLeaveDays: round2(paidLeaveDays),
    otHoursWeekday: round2(otH_w), otHoursWeekend: round2(otH_e), otHoursHoliday: round2(otH_h),
    otHoursTotal: round2(otH_w + otH_e + otH_h),
    otTierHours: tierMin.map((m) => round2(m / 60)),
    basicSalary: round0(cfg.basic_salary), dailyRate: round0(dailyRate),
    workSalary: round0(workSalary), paidLeaveSalary: round0(paidLeaveSalary),
    otSalary: round0(otSalary), allowance: round0(cfg.allowance || 0),
    gross: round0(gross), net: round0(gross),
  };
}

// Bảng lương cho tất cả NV theo "tháng lương"
// filter: string dept (cũ) HOẶC {dept, depts:[], ids:[]} — ưu tiên ids > depts > dept.
// filter.from + filter.to: tính đúng khoảng ngày này thay cho kỳ lương của tháng.
export function computePayrollTable(year, month, filter) {
  const f = typeof filter === 'string' ? { dept: filter } : (filter || {});
  const startDay = parseInt(getSetting('pay_period_start_day', '1'), 10) || 1;
  const { from, to } = f.from && f.to ? { from: f.from, to: f.to } : payPeriod(year, month, startDay);
  const ids = (f.ids || []).map(Number).filter(Boolean);
  const depts = deptWithChildren((f.depts || []).length ? f.depts : f.dept ? [f.dept] : []);   // gồm cả bộ phận con
  let sql = `SELECT id, code, full_name, department FROM employees WHERE ${EMP_IN_PERIOD}` + adminAttWhere();
  const args = [from];
  if (ids.length) { sql += ` AND id IN (${ids.map(() => '?').join(',')})`; args.push(...ids); }
  else if (depts.length) { sql += ` AND department IN (${depts.map(() => '?').join(',')})`; args.push(...depts); }
  else if (f.dept) { sql += ' AND department = ?'; args.push(f.dept); }
  sql += ' ORDER BY department, full_name';
  const emps = db.prepare(sql).all(...args);
  const vmap = f.virt ? virtualOt(emps.map((e) => e.id), from, to, !!f.force, f.virt) : null;   // lương ảo: nạp công ảo 1 lần cho cả bảng
  const rows = emps.map((e) => ({ emp: e, pay: computePayrollForEmployee(e.id, from, to, { virt: f.virt || 0, vmap }) }));
  return { from, to, rows };
}
