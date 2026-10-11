// PHÉP NĂM: loại đơn, số ngày của 1 đơn (có nửa ngày), quỹ phép năm từng nhân viên.
// Mặc định theo Bộ luật Lao động 2019 (Điều 113–114): 12 ngày/năm, cứ đủ 5 năm làm việc +1 ngày,
// làm chưa đủ 12 tháng thì tính theo tỷ lệ số tháng. Mọi thông số chỉnh ở Cài đặt › Phép năm.
import { db, getSetting } from './db.js';

// Loại đơn: paid = có lương · quota = trừ vào quỹ phép năm · sym = ký hiệu trên bảng công
export const LEAVE_TYPES = [
  { type: 'Nghỉ phép', sym: 'P', paid: true, quota: true, label: 'Nghỉ phép năm (có lương, trừ phép)' },
  { type: 'Nghỉ có lương', sym: 'R', paid: true, quota: false, label: 'Nghỉ có lương (cưới, tang… không trừ phép)' },
  { type: 'Nghỉ không lương', sym: 'KL', paid: false, quota: false, label: 'Nghỉ không lương' },
  { type: 'Công tác', sym: 'CT', paid: true, quota: false, label: 'Công tác' },
  { type: 'Thai sản', sym: 'TS', paid: false, quota: false, label: 'Nghỉ thai sản (BHXH chi trả, công ty không tính lương)' },
  { type: 'Khác', sym: 'K', paid: true, quota: false, label: 'Khác' },
];
const typeNamed = (n) => LEAVE_TYPES.find((x) => x.type === n);
export const leaveTypeOf = (t) => typeNamed(t)
  || (String(t || '').toLowerCase().includes('không lương') ? typeNamed('Nghỉ không lương') : typeNamed('Khác'));
export const HALF_LABEL = { '': 'Cả ngày', sang: 'Nửa ngày sáng', chieu: 'Nửa ngày chiều' };

const DAY = 86400000;
const dnum = (d) => Math.round(Date.parse(d + 'T00:00:00Z') / DAY);
// Số ngày của đơn nằm trong [from, to] (nửa ngày = 0,5). Không trừ ngày cuối tuần/lễ (đơn khai đúng ngày cần nghỉ).
export function leaveDaysIn(l, from, to) {
  const f = l.from_date < from ? from : l.from_date, t = l.to_date > to ? to : l.to_date;
  if (t < f) return 0;
  const n = dnum(t) - dnum(f) + 1;
  return l.half && l.from_date === l.to_date ? 0.5 : n;
}

export function leaveSettings() {
  const num = (k, d) => { const v = parseFloat(getSetting(k, String(d))); return Number.isFinite(v) ? v : d; };
  return {
    perYear: num('leave_days_per_year', 12),
    senYears: num('leave_seniority_years', 5),          // cứ đủ N năm làm việc
    senAdd: num('leave_seniority_add', 1),              // … được cộng thêm M ngày (0 = không cộng)
    accrual: getSetting('leave_accrual', 'year') === 'month' ? 'month' : 'year',   // cấp đủ đầu năm | cộng dồn theo tháng
    prorate: getSetting('leave_prorate_new', '1') === '1',                         // năm đầu vào làm tính theo số tháng
    carryMax: num('leave_carry_max', 0),                // số ngày phép còn dư được chuyển sang năm sau (0 = không chuyển)
    carryUntil: num('leave_carry_until_month', 3),      // phép chuyển sang dùng đến hết tháng này (0 = cả năm)
    allowOver: getSetting('leave_allow_over', '0') === '1',   // cho nghỉ phép năm vượt số còn lại
  };
}

// Số tháng làm việc trong năm y tính đến hết tháng `uptoMonth` (vào làm từ ngày 16 trở đi thì tháng đó không tính)
function monthsWorked(start, y, uptoMonth) {
  let first = 1;
  if (start) {
    const sy = +start.slice(0, 4), sm = +start.slice(5, 7), sd = +start.slice(8, 10);
    if (sy > y) return 0;
    if (sy === y) first = sd > 15 ? sm + 1 : sm;
  }
  return Math.max(0, uptoMonth - first + 1);
}

// Phép được hưởng CẢ NĂM y (chưa xét cộng dồn): mức riêng của NV hoặc mức chung + thâm niên, năm đầu theo tỷ lệ tháng
function entitledYear(emp, y, S) {
  const base = emp.leave_days_year != null && emp.leave_days_year !== '' ? +emp.leave_days_year : S.perYear;
  let sen = 0;
  if (emp.start_date && S.senYears > 0 && S.senAdd > 0) {
    const yrs = Math.floor((dnum(`${y}-01-01`) - dnum(emp.start_date)) / 365.25);   // số năm làm việc tính đến đầu năm
    if (yrs > 0) sen = Math.floor(yrs / S.senYears) * S.senAdd;
  }
  let full = base + sen;
  if (S.prorate && emp.start_date && +emp.start_date.slice(0, 4) === y) full = full * monthsWorked(emp.start_date, y, 12) / 12;
  if (emp.start_date && +emp.start_date.slice(0, 4) > y) full = 0;
  return Math.round(full * 2) / 2;   // làm tròn tới nửa ngày
}

function usedIn(empId, from, to, status) {
  const rows = db.prepare(`SELECT type, from_date, to_date, half FROM leave_requests WHERE employee_id=? AND status=? AND from_date<=? AND to_date>=?`).all(empId, status, to, from);
  return rows.filter((l) => leaveTypeOf(l.type).quota).reduce((a, l) => a + leaveDaysIn(l, from, to), 0);
}

// Quỹ phép năm của 1 NV trong năm y, tính đến ngày asOf (mặc định hôm nay / cuối năm nếu năm đã qua)
export function leaveBalance(empId, y, asOf = null) {
  const S = leaveSettings();
  const emp = db.prepare('SELECT id, start_date, leave_days_year FROM employees WHERE id=?').get(empId);
  if (!emp) return null;
  const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  const at = asOf || (String(y) < today.slice(0, 4) ? `${y}-12-31` : today);
  const full = entitledYear(emp, y, S);
  // cộng dồn theo tháng: được hưởng tới tháng hiện tại = cả năm × số tháng đã làm / số tháng làm cả năm
  let accrued = full;
  if (S.accrual === 'month') {
    const upto = String(y) < at.slice(0, 4) ? 12 : +at.slice(5, 7);
    const total = monthsWorked(emp.start_date, y, 12) || 12;
    accrued = Math.floor(full * monthsWorked(emp.start_date, y, upto) / total * 2) / 2;
  }
  // phép năm trước còn dư → chuyển sang (tối đa carryMax), chỉ dùng đến hết tháng carryUntil
  let carry = 0;
  if (S.carryMax > 0) {
    const prevFull = entitledYear(emp, y - 1, S);
    const prevUsed = usedIn(empId, `${y - 1}-01-01`, `${y - 1}-12-31`, 'approved');
    carry = Math.max(0, Math.min(S.carryMax, prevFull - prevUsed));
    if (carry && S.carryUntil > 0 && +at.slice(5, 7) > S.carryUntil && at.slice(0, 4) === String(y)) {
      // hết hạn dùng phép chuyển: chỉ giữ phần đã dùng trong hạn
      const usedInWindow = usedIn(empId, `${y}-01-01`, `${y}-${String(S.carryUntil).padStart(2, '0')}-31`, 'approved');
      carry = Math.min(carry, usedInWindow);
    }
  }
  const used = usedIn(empId, `${y}-01-01`, `${y}-12-31`, 'approved');
  const pending = usedIn(empId, `${y}-01-01`, `${y}-12-31`, 'pending');
  const r1 = (n) => Math.round(n * 10) / 10;
  return { year: y, start_date: emp.start_date || '', own: emp.leave_days_year != null && emp.leave_days_year !== '' ? +emp.leave_days_year : null,
    full: r1(full), accrued: r1(accrued), carry: r1(carry), used: r1(used), pending: r1(pending), remaining: r1(accrued + carry - used) };
}

// Kiểm tra trước khi thêm/duyệt đơn phép năm: trả câu báo nếu vượt số phép còn lại, '' nếu được
export function overQuotaMsg(empId, l, excludeId = null) {
  if (!leaveTypeOf(l.type).quota) return '';
  const y = +l.from_date.slice(0, 4);
  const b = leaveBalance(empId, y, l.to_date);
  if (!b) return '';
  const need = leaveDaysIn(l, l.from_date, l.to_date);
  let used = b.used;
  if (excludeId) { const self = db.prepare('SELECT * FROM leave_requests WHERE id=? AND status=?').get(excludeId, 'approved'); if (self) used -= leaveDaysIn(self, `${y}-01-01`, `${y}-12-31`); }
  const left = Math.round((b.accrued + b.carry - used) * 10) / 10;
  return need > left ? `Chỉ còn ${left} ngày phép năm ${y} (xin ${need} ngày).` : '';
}
