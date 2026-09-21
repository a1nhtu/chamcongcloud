// Tính lương (GĐ4) — theo công thức phần mềm mẫu ChamCongApp.
import { db, getSetting } from './db.js';

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

const DEFAULT_CFG = {
  basic_salary: 0, daily_rate: null, working_days_per_month: 26,
  ot_rate_weekday: 1.5, ot_rate_weekend: 2.0, ot_rate_holiday: 3.0, allowance: 0, hourly_rate: 0,
};

export function getSalaryConfig(employeeId) {
  return db.prepare('SELECT * FROM salary_configs WHERE employee_id = ?').get(employeeId) || { employee_id: employeeId, ...DEFAULT_CFG };
}

// Tính lương 1 nhân viên trong kỳ [from,to]
export function computePayrollForEmployee(employeeId, from, to) {
  const cfg = getSalaryConfig(employeeId);
  const workingDays = cfg.working_days_per_month || 26;
  const dailyRate = (cfg.daily_rate != null && cfg.daily_rate > 0) ? cfg.daily_rate : (cfg.basic_salary || 0) / workingDays;
  const hourlyRate = dailyRate / 8;

  const rows = db.prepare(
    'SELECT work_unit, work_minutes, ot_min, ot_type FROM attendance WHERE employee_id = ? AND work_date >= ? AND work_date <= ?'
  ).all(employeeId, from, to);

  // Chế độ tính công theo GIỜ: lương = tổng giờ làm × đơn giá giờ + phụ cấp
  if (getSetting('attendance_mode', 'shift') === 'hourly') {
    const totalMin = rows.reduce((s, r) => s + (r.work_minutes || 0), 0);
    const daysWorked = rows.filter((r) => (r.work_minutes || 0) > 0).length;
    const hrs = totalMin / 60;
    const rate = cfg.hourly_rate || 0;
    const workSalary = hrs * rate;
    const gross = workSalary + (cfg.allowance || 0);
    return {
      hourly: true, totalHours: round2(hrs), daysWorked, hourlyRate: round0(rate),
      workUnits: round2(daysWorked), paidLeaveDays: 0,
      otHoursWeekday: 0, otHoursWeekend: 0, otHoursHoliday: 0, otHoursTotal: 0,
      basicSalary: 0, dailyRate: 0,
      workSalary: round0(workSalary), paidLeaveSalary: 0, otSalary: 0,
      allowance: round0(cfg.allowance || 0), gross: round0(gross), net: round0(gross),
    };
  }

  let workUnits = 0, otMinW = 0, otMinE = 0, otMinH = 0;
  for (const r of rows) {
    workUnits += r.work_unit || 0;
    if (r.ot_type === 'cuoi_tuan') otMinE += r.ot_min || 0;
    else if (r.ot_type === 'le') otMinH += r.ot_min || 0;
    else otMinW += r.ot_min || 0;
  }
  const otH_w = otMinW / 60, otH_e = otMinE / 60, otH_h = otMinH / 60;

  // Nghỉ phép có lương (đã duyệt, khác "không lương") — số ngày trong kỳ
  let paidLeaveDays = 0;
  const leaves = db.prepare(
    "SELECT type, from_date, to_date FROM leave_requests WHERE employee_id = ? AND status='approved' AND from_date <= ? AND to_date >= ?"
  ).all(employeeId, to, from);
  for (const l of leaves) {
    if ((l.type || '').includes('không lương')) continue;
    const f = l.from_date < from ? from : l.from_date;
    const t = l.to_date > to ? to : l.to_date;
    if (t >= f) paidLeaveDays += Math.round((new Date(t) - new Date(f)) / 86400000) + 1;
  }

  const workSalary = workUnits * dailyRate;
  const paidLeaveSalary = paidLeaveDays * dailyRate;
  const otSalary = otH_w * hourlyRate * cfg.ot_rate_weekday
                 + otH_e * hourlyRate * cfg.ot_rate_weekend
                 + otH_h * hourlyRate * cfg.ot_rate_holiday;
  const gross = workSalary + paidLeaveSalary + otSalary + (cfg.allowance || 0);

  return {
    workUnits: round2(workUnits), paidLeaveDays: round2(paidLeaveDays),
    otHoursWeekday: round2(otH_w), otHoursWeekend: round2(otH_e), otHoursHoliday: round2(otH_h),
    otHoursTotal: round2(otH_w + otH_e + otH_h),
    basicSalary: round0(cfg.basic_salary), dailyRate: round0(dailyRate),
    workSalary: round0(workSalary), paidLeaveSalary: round0(paidLeaveSalary),
    otSalary: round0(otSalary), allowance: round0(cfg.allowance || 0),
    gross: round0(gross), net: round0(gross),
  };
}

// Bảng lương cho tất cả NV theo "tháng lương"
// filter: string dept (cũ) HOẶC {dept, depts:[], ids:[]} — ưu tiên ids > depts > dept.
export function computePayrollTable(year, month, filter) {
  const startDay = parseInt(getSetting('pay_period_start_day', '1'), 10) || 1;
  const { from, to } = payPeriod(year, month, startDay);
  const f = typeof filter === 'string' ? { dept: filter } : (filter || {});
  const ids = (f.ids || []).map(Number).filter(Boolean);
  const depts = (f.depts || []).filter(Boolean);
  let sql = "SELECT id, code, full_name, department FROM employees WHERE active=1 AND role!='admin'";
  const args = [];
  if (ids.length) { sql += ` AND id IN (${ids.map(() => '?').join(',')})`; args.push(...ids); }
  else if (depts.length) { sql += ` AND department IN (${depts.map(() => '?').join(',')})`; args.push(...depts); }
  else if (f.dept) { sql += ' AND department = ?'; args.push(f.dept); }
  sql += ' ORDER BY department, full_name';
  const emps = db.prepare(sql).all(...args);
  const rows = emps.map((e) => ({ emp: e, pay: computePayrollForEmployee(e.id, from, to) }));
  return { from, to, rows };
}
