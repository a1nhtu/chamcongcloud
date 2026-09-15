import { Router } from 'express';
import ExcelJS from 'exceljs';
import { db, getSetting } from '../db.js';
import { authRequired, permRequired } from '../auth.js';
import { vnDateStr, humanMinutes } from '../util.js';
import { isWeekendDay, vnWeekday } from '../attendance-calc.js';
import { computePayrollTable } from '../payroll-calc.js';

const r = Router();
r.use(authRequired, permRequired('reports'));

/* ================= Helpers ================= */
function isoToVnHM(iso) {
  if (!iso) return '';
  const d = new Date(iso); if (isNaN(d)) return '';
  const t = new Date(d.getTime() + 7 * 3600 * 1000);
  return `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
}
const WD = { 1: 'T2', 2: 'T3', 3: 'T4', 4: 'T5', 5: 'T6', 6: 'T7', 7: 'CN' };
const fmtDMY = (d) => `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const round2 = (n) => Math.round((n || 0) * 100) / 100;

function monthDays(month) {
  const [y, m] = month.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

// Nạp toàn bộ dữ liệu 1 tháng để các báo cáo dùng chung
function loadMonth(month, dept) {
  const weekend = getSetting('weekend_days', '7');
  let empSql = `SELECT id, code, full_name, department, position, shift_id
                FROM employees WHERE active = 1 AND role != 'admin'`;
  const args = [];
  if (dept) { empSql += ' AND department = ?'; args.push(dept); }
  empSql += ' ORDER BY department, full_name';
  const employees = db.prepare(empSql).all(...args);

  const results = db.prepare(
    `SELECT a.*, e.code, e.full_name, e.department, s.name AS shift_name,
            s.start_time AS shift_start, s.end_time AS shift_end
     FROM attendance a JOIN employees e ON e.id = a.employee_id
     LEFT JOIN shifts s ON s.id = a.shift_id
     WHERE a.work_date LIKE ?`
  ).all(month + '%');
  // shift join fallback: nếu không có phân ca ngày, lấy ca mặc định
  const shiftsById = new Map(db.prepare('SELECT * FROM shifts').all().map((s) => [s.id, s]));
  const empById = new Map(employees.map((e) => [e.id, e]));

  // empId|date -> 1 ô gộp (có thể NHIỀU ca/ngày): cộng công/giờ/OT/muộn/sớm, vào sớm nhất, ra muộn nhất
  const cell = new Map();
  for (const row of results) {
    const key = row.employee_id + '|' + row.work_date;
    const ex = cell.get(key);
    if (!ex) { cell.set(key, { ...row, _shiftNames: row.shift_name ? [row.shift_name] : [], _missingOut: (!row.check_out_at) ? 1 : 0 }); continue; }
    ex.work_unit = (ex.work_unit || 0) + (row.work_unit || 0);
    ex.work_minutes = (ex.work_minutes || 0) + (row.work_minutes || 0);
    ex.ot_min = (ex.ot_min || 0) + (row.ot_min || 0);
    ex.late_min = (ex.late_min || 0) + (row.late_min || 0);
    ex.early_min = (ex.early_min || 0) + (row.early_min || 0);
    if (row.check_in_at && (!ex.check_in_at || row.check_in_at < ex.check_in_at)) ex.check_in_at = row.check_in_at;
    if (row.check_out_at && (!ex.check_out_at || row.check_out_at > ex.check_out_at)) ex.check_out_at = row.check_out_at;
    if (!row.check_out_at) ex._missingOut = 1;
    if (row.shift_name) ex._shiftNames.push(row.shift_name);
    if (row.day_status === 'lam_viec') ex.day_status = 'lam_viec';
  }
  // Ca hiển thị: ghép tên các ca trong ngày (VD "Ca sáng + Ca chiều")
  for (const c of cell.values()) {
    if (c._shiftNames && c._shiftNames.length > 1) c.shift_name = c._shiftNames.join(' + ');
  }

  const assigns = new Map(); // empId|date -> {shift_id,is_off}
  for (const a of db.prepare('SELECT employee_id, work_date, shift_id, is_off FROM daily_shift_assignments WHERE work_date LIKE ?').all(month + '%'))
    assigns.set(a.employee_id + '|' + a.work_date, a);

  const holidays = new Set(db.prepare('SELECT holiday_date FROM public_holidays WHERE holiday_date LIKE ?').all(month + '%').map((h) => h.holiday_date));

  // Nghỉ phép đã duyệt phủ lên từng ngày
  const leaveDays = new Set(); // empId|date
  const leaveRows = db.prepare(
    `SELECT l.*, e.code, e.full_name, e.department FROM leave_requests l JOIN employees e ON e.id=l.employee_id
     WHERE l.from_date <= ? AND l.to_date >= ?`
  ).all(month + '-31', month + '-01');
  for (const l of leaveRows) {
    if (l.status !== 'approved') continue;
    for (const d of monthDays(month)) if (d >= l.from_date && d <= l.to_date) leaveDays.add(l.employee_id + '|' + d);
  }

  // ca theo lịch của 1 NV trong 1 ngày (để xác định ngày công theo lịch)
  const scheduledShift = (empId, date) => {
    const a = assigns.get(empId + '|' + date);
    if (a) { if (a.is_off) return null; if (a.shift_id) return shiftsById.get(a.shift_id) || null; }
    const e = empById.get(empId);
    return e?.shift_id ? shiftsById.get(e.shift_id) || null : null;
  };
  const isScheduled = (empId, date) => {
    if (holidays.has(date)) return false;
    const s = scheduledShift(empId, date);
    if (!s) return false;
    const wd = String(vnWeekday(date));
    const days = (s.work_days || '1,2,3,4,5,6').split(',');
    return days.includes(wd);
  };

  return { month, weekend, employees, cell, holidays, leaveDays, leaveRows, isScheduled, isWeekend: (d) => isWeekendDay(d, weekend) };
}

function symbolOf(ctx, empId, date) {
  const c = ctx.cell.get(empId + '|' + date);
  if (ctx.leaveDays.has(empId + '|' + date)) return 'P';
  if (ctx.holidays.has(date)) return 'L';
  if (!c) return ctx.isScheduled(empId, date) ? 'V' : '';
  if (c.day_status === 'thieu_ra' || !c.check_out_at) return 'O';
  if ((c.late_min || 0) > 0 || (c.early_min || 0) > 0) return 'T';
  if ((c.work_unit || 0) > 0) return 'X';
  return 'V';
}
const OT_LABEL = { thuong: 'Ngày thường', cuoi_tuan: 'Cuối tuần', le: 'Ngày lễ' };
const DS_LABEL = {
  lam_viec: 'Đủ công', thieu_ra: 'Thiếu ra', vang: 'Vắng',
  nghi_le: 'Nghỉ lễ', nghi_phep: 'Nghỉ phép',
};

/* ================= Report builders ================= */
// Trả về { title, columns:[{key,label,weekend?,w?}], rows:[obj] }
function buildReport(type, month, dept) {
  const ctx = loadMonth(month, dept);
  const days = monthDays(month);
  const sortedResults = () => [...ctx.cell.values()].sort((a, b) =>
    a.full_name === b.full_name ? (a.work_date < b.work_date ? -1 : 1) : (a.full_name < b.full_name ? -1 : 1));

  switch (type) {
    /* --- Bảng công ngang (ma trận ngày × NV) --- */
    case 'horizontal': {
      const dayCols = days.map((d) => ({ key: 'd' + d, label: d.slice(8), weekend: ctx.isWeekend(d) }));
      const columns = [
        { key: 'code', label: 'Mã NV', w: 10 }, { key: 'name', label: 'Họ tên', w: 22 },
        { key: 'dept', label: 'Bộ phận', w: 14 }, ...dayCols,
        { key: 'total', label: 'Tổng công', w: 10 }, { key: 'ot', label: 'OT (giờ)', w: 9 },
        { key: 'late', label: 'Trễ (lần)', w: 9 }, { key: 'early', label: 'Sớm (lần)', w: 9 },
        { key: 'absent', label: 'Vắng', w: 8 },
      ];
      const rows = ctx.employees.map((e) => {
        const row = { code: e.code, name: e.full_name, dept: e.department || '' };
        let total = 0, ot = 0, late = 0, early = 0, absent = 0;
        for (const d of days) {
          const c = ctx.cell.get(e.id + '|' + d);
          if (c && c.work_unit > 0) { row['d' + d] = round2(c.work_unit); total += c.work_unit; }
          else row['d' + d] = '';
          if (c) { ot += (c.ot_min || 0); if (c.late_min > 0) late++; if (c.early_min > 0) early++; }
          if (symbolOf(ctx, e.id, d) === 'V') absent++;
        }
        row.total = round2(total); row.ot = round2(ot / 60); row.late = late; row.early = early; row.absent = absent;
        return row;
      });
      return { title: `Bảng công ngang tháng ${month}`, columns, rows };
    }

    /* --- Ký hiệu (X/V/T/P/L/O) --- */
    case 'symbol': {
      const dayCols = days.map((d) => ({ key: 'd' + d, label: d.slice(8), weekend: ctx.isWeekend(d) }));
      const columns = [
        { key: 'code', label: 'Mã NV', w: 10 }, { key: 'name', label: 'Họ tên', w: 22 },
        { key: 'dept', label: 'Bộ phận', w: 14 }, ...dayCols,
        { key: 'X', label: 'X', w: 5 }, { key: 'T', label: 'T', w: 5 }, { key: 'P', label: 'P', w: 5 },
        { key: 'L', label: 'L', w: 5 }, { key: 'V', label: 'V', w: 5 }, { key: 'O', label: 'O', w: 5 },
      ];
      const rows = ctx.employees.map((e) => {
        const row = { code: e.code, name: e.full_name, dept: e.department || '' };
        const cnt = { X: 0, T: 0, P: 0, L: 0, V: 0, O: 0 };
        for (const d of days) { const s = symbolOf(ctx, e.id, d); row['d' + d] = s; if (cnt[s] != null) cnt[s]++; }
        Object.assign(row, cnt);
        return row;
      });
      return { title: `Bảng ký hiệu tháng ${month} (X=làm, T=trễ/sớm, P=phép, L=lễ, V=vắng, O=thiếu ra)`, columns, rows };
    }

    /* --- Chi tiết giờ vào/ra theo ngày (ma trận) --- */
    case 'daytime': {
      const dayCols = days.map((d) => ({ key: 'd' + d, label: d.slice(8), weekend: ctx.isWeekend(d) }));
      const columns = [
        { key: 'code', label: 'Mã NV', w: 10 }, { key: 'name', label: 'Họ tên', w: 22 },
        { key: 'dept', label: 'Bộ phận', w: 14 }, ...dayCols,
        { key: 'total', label: 'Tổng công', w: 10 },
      ];
      const rows = ctx.employees.map((e) => {
        const row = { code: e.code, name: e.full_name, dept: e.department || '' };
        let total = 0;
        for (const d of days) {
          const c = ctx.cell.get(e.id + '|' + d);
          if (c && c.check_in_at) {
            row['d' + d] = isoToVnHM(c.check_in_at) + '-' + (c.check_out_at ? isoToVnHM(c.check_out_at) : '?');
            total += c.work_unit || 0;
          } else row['d' + d] = '';
        }
        row.total = round2(total);
        return row;
      });
      return { title: `Chi tiết giờ vào/ra tháng ${month}`, columns, rows };
    }

    /* --- Tổng hợp theo nhân viên --- */
    case 'summary': {
      const columns = [
        { key: 'code', label: 'Mã NV', w: 10 }, { key: 'name', label: 'Họ tên', w: 22 }, { key: 'dept', label: 'Bộ phận', w: 14 },
        { key: 'cong', label: 'Tổng công', w: 10 }, { key: 'gio', label: 'Tổng giờ', w: 10 }, { key: 'ot', label: 'Tăng ca (giờ)', w: 12 },
        { key: 'lateN', label: 'Trễ (lần)', w: 9 }, { key: 'lateM', label: 'Trễ (phút)', w: 10 },
        { key: 'earlyN', label: 'Sớm (lần)', w: 9 }, { key: 'earlyM', label: 'Sớm (phút)', w: 10 }, { key: 'vang', label: 'Vắng', w: 8 },
      ];
      const rows = ctx.employees.map((e) => {
        let cong = 0, minutes = 0, ot = 0, lateN = 0, lateM = 0, earlyN = 0, earlyM = 0, vang = 0;
        for (const d of days) {
          const c = ctx.cell.get(e.id + '|' + d);
          if (c) {
            cong += (c.work_unit || 0); minutes += (c.work_minutes || 0); ot += (c.ot_min || 0);
            if (c.late_min > 0) { lateN++; lateM += c.late_min; }
            if (c.early_min > 0) { earlyN++; earlyM += c.early_min; }
          }
          if (symbolOf(ctx, e.id, d) === 'V') vang++;
        }
        return {
          code: e.code, name: e.full_name, dept: e.department || '',
          cong: round2(cong), gio: round2(minutes / 60), ot: round2(ot / 60),
          lateN, lateM, earlyN, earlyM, vang,
        };
      });
      return { title: `Tổng hợp chấm công tháng ${month}`, columns, rows };
    }

    /* --- Chi tiết chấm công (từng ngày có dữ liệu) --- */
    case 'detail': {
      const columns = [
        { key: 'date', label: 'Ngày', w: 12 }, { key: 'wd', label: 'Thứ', w: 6 },
        { key: 'code', label: 'Mã NV', w: 10 }, { key: 'name', label: 'Họ tên', w: 20 }, { key: 'dept', label: 'Bộ phận', w: 13 },
        { key: 'shift', label: 'Ca', w: 12 }, { key: 'inCa', label: 'Giờ vào ca', w: 10 }, { key: 'outCa', label: 'Giờ ra ca', w: 10 },
        { key: 'inReal', label: 'Vào thực', w: 9 }, { key: 'outReal', label: 'Ra thực', w: 9 },
        { key: 'late', label: 'Trễ (p)', w: 8 }, { key: 'early', label: 'Sớm (p)', w: 8 }, { key: 'ot', label: 'OT (p)', w: 8 },
        { key: 'cong', label: 'Công', w: 7 }, { key: 'status', label: 'Trạng thái', w: 13 },
      ];
      const rows = sortedResults().map((c) => ({
        date: fmtDMY(c.work_date), wd: WD[vnWeekday(c.work_date)],
        code: c.code, name: c.full_name, dept: c.department || '', shift: c.shift_name || '',
        inCa: c.shift_start || '', outCa: c.shift_end || '',
        inReal: isoToVnHM(c.check_in_at), outReal: isoToVnHM(c.check_out_at),
        late: c.late_min || 0, early: c.early_min || 0, ot: c.ot_min || 0,
        cong: round2(c.work_unit), status: c.check_out_at ? (c.late_min > 0 ? 'Đi muộn' : c.early_min > 0 ? 'Về sớm' : 'Đủ công') : 'Thiếu ra',
      }));
      return { title: `Chi tiết chấm công tháng ${month}`, columns, rows };
    }

    /* --- Chấm công (mọi bản ghi) --- */
    case 'attendance': {
      const columns = [
        { key: 'date', label: 'Ngày', w: 12 }, { key: 'code', label: 'Mã NV', w: 10 }, { key: 'name', label: 'Họ tên', w: 20 },
        { key: 'dept', label: 'Bộ phận', w: 13 }, { key: 'inReal', label: 'Giờ vào', w: 9 }, { key: 'outReal', label: 'Giờ ra', w: 9 },
        { key: 'place', label: 'Nơi chấm', w: 14 }, { key: 'late', label: 'Trễ (p)', w: 8 }, { key: 'early', label: 'Sớm (p)', w: 8 },
        { key: 'gio', label: 'Tổng giờ', w: 9 }, { key: 'ot', label: 'OT (p)', w: 8 }, { key: 'cong', label: 'Công', w: 7 },
      ];
      const rows = sortedResults().map((c) => ({
        date: fmtDMY(c.work_date), code: c.code, name: c.full_name, dept: c.department || '',
        inReal: isoToVnHM(c.check_in_at), outReal: isoToVnHM(c.check_out_at),
        place: c.check_in_outside ? 'Ngoài VP' : 'Trong VP',
        late: c.late_min || 0, early: c.early_min || 0, gio: round2((c.work_minutes || 0) / 60),
        ot: c.ot_min || 0, cong: round2(c.work_unit),
      }));
      return { title: `Báo cáo chấm công tháng ${month}`, columns, rows };
    }

    /* --- Đi muộn / về sớm --- */
    case 'late': {
      const columns = [
        { key: 'date', label: 'Ngày', w: 12 }, { key: 'code', label: 'Mã NV', w: 10 }, { key: 'name', label: 'Họ tên', w: 20 },
        { key: 'dept', label: 'Bộ phận', w: 13 }, { key: 'inReal', label: 'Giờ vào', w: 9 }, { key: 'outReal', label: 'Giờ ra', w: 9 },
        { key: 'late', label: 'Đi muộn (p)', w: 11 }, { key: 'early', label: 'Về sớm (p)', w: 11 },
      ];
      const rows = sortedResults().filter((c) => c.late_min > 0 || c.early_min > 0).map((c) => ({
        date: fmtDMY(c.work_date), code: c.code, name: c.full_name, dept: c.department || '',
        inReal: isoToVnHM(c.check_in_at), outReal: isoToVnHM(c.check_out_at),
        late: c.late_min || 0, early: c.early_min || 0,
      }));
      return { title: `Đi muộn / về sớm tháng ${month}`, columns, rows };
    }

    /* --- Tăng ca --- */
    case 'ot': {
      const columns = [
        { key: 'date', label: 'Ngày', w: 12 }, { key: 'code', label: 'Mã NV', w: 10 }, { key: 'name', label: 'Họ tên', w: 20 },
        { key: 'dept', label: 'Bộ phận', w: 13 }, { key: 'inReal', label: 'Giờ vào', w: 9 }, { key: 'outReal', label: 'Giờ ra', w: 9 },
        { key: 'otp', label: 'Tăng ca (p)', w: 11 }, { key: 'oth', label: 'Tăng ca (giờ)', w: 12 }, { key: 'loai', label: 'Loại OT', w: 14 },
      ];
      const rows = sortedResults().filter((c) => c.ot_min > 0).map((c) => ({
        date: fmtDMY(c.work_date), code: c.code, name: c.full_name, dept: c.department || '',
        inReal: isoToVnHM(c.check_in_at), outReal: isoToVnHM(c.check_out_at),
        otp: c.ot_min || 0, oth: round2((c.ot_min || 0) / 60), loai: OT_LABEL[c.ot_type] || '',
      }));
      return { title: `Tăng ca chi tiết tháng ${month}`, columns, rows };
    }

    /* --- Giờ vào đầu / ra cuối --- */
    case 'firstlast': {
      const columns = [
        { key: 'date', label: 'Ngày', w: 12 }, { key: 'code', label: 'Mã NV', w: 10 }, { key: 'name', label: 'Họ tên', w: 20 },
        { key: 'dept', label: 'Bộ phận', w: 13 }, { key: 'first', label: 'Vào đầu', w: 9 }, { key: 'last', label: 'Ra cuối', w: 9 },
        { key: 'gio', label: 'Số giờ', w: 8 },
      ];
      const rows = sortedResults().filter((c) => c.check_in_at).map((c) => {
        const gio = c.check_out_at ? round2((new Date(c.check_out_at) - new Date(c.check_in_at)) / 3600000) : 0;
        return {
          date: fmtDMY(c.work_date), code: c.code, name: c.full_name, dept: c.department || '',
          first: isoToVnHM(c.check_in_at), last: isoToVnHM(c.check_out_at), gio,
        };
      });
      return { title: `Giờ vào đầu & ra cuối tháng ${month}`, columns, rows };
    }

    /* --- Nghỉ phép / vắng (từ đơn từ) --- */
    case 'leave': {
      const columns = [
        { key: 'code', label: 'Mã NV', w: 10 }, { key: 'name', label: 'Họ tên', w: 20 }, { key: 'dept', label: 'Bộ phận', w: 13 },
        { key: 'type', label: 'Loại đơn', w: 14 }, { key: 'from', label: 'Từ ngày', w: 12 }, { key: 'to', label: 'Đến ngày', w: 12 },
        { key: 'days', label: 'Số ngày', w: 8 }, { key: 'reason', label: 'Lý do', w: 24 }, { key: 'status', label: 'Trạng thái', w: 11 },
      ];
      const stLabel = { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối' };
      const rows = ctx.leaveRows.map((l) => ({
        code: l.code, name: l.full_name, dept: l.department || '', type: l.type,
        from: fmtDMY(l.from_date), to: fmtDMY(l.to_date),
        days: Math.round((new Date(l.to_date) - new Date(l.from_date)) / 86400000) + 1,
        reason: l.reason || '', status: stLabel[l.status] || l.status,
      }));
      return { title: `Nghỉ phép / đơn từ tháng ${month}`, columns, rows };
    }

    /* --- Bảng lương --- */
    case 'payroll': {
      const [y, m] = month.split('-').map(Number);
      const { from, to, rows: pr } = computePayrollTable(y, m, dept);
      const money = (n) => (n || 0).toLocaleString('vi-VN');
      const columns = [
        { key: 'code', label: 'Mã NV', w: 10 }, { key: 'name', label: 'Họ tên', w: 22 }, { key: 'dept', label: 'Bộ phận', w: 14 },
        { key: 'cong', label: 'Ngày công', w: 9 }, { key: 'phep', label: 'Nghỉ phép', w: 9 }, { key: 'ot', label: 'OT (giờ)', w: 9 },
        { key: 'dayrate', label: 'Đơn giá ngày', w: 13 }, { key: 'workpay', label: 'Lương công', w: 13 },
        { key: 'leavepay', label: 'Lương phép', w: 12 }, { key: 'otpay', label: 'Lương OT', w: 12 },
        { key: 'allow', label: 'Phụ cấp', w: 11 }, { key: 'net', label: 'Thực lĩnh', w: 14 },
      ];
      const rows = pr.map(({ emp, pay }) => ({
        code: emp.code, name: emp.full_name, dept: emp.department || '',
        cong: pay.workUnits, phep: pay.paidLeaveDays, ot: pay.otHoursTotal,
        dayrate: money(pay.dailyRate), workpay: money(pay.workSalary), leavepay: money(pay.paidLeaveSalary),
        otpay: money(pay.otSalary), allow: money(pay.allowance), net: money(pay.net),
      }));
      return { title: `Bảng lương tháng ${month} (kỳ ${fmtDMY(from)} - ${fmtDMY(to)})`, columns, rows };
    }

    default:
      return buildReport('horizontal', month, dept);
  }
}

/* ================= Routes ================= */
r.get('/dashboard', (req, res) => {
  const today = vnDateStr();
  const totalEmp = db.prepare("SELECT COUNT(*) c FROM employees WHERE active = 1 AND role != 'admin'").get().c;
  const checkedIn = db.prepare('SELECT COUNT(*) c FROM attendance WHERE work_date = ? AND check_in_at IS NOT NULL').get(today).c;
  const late = db.prepare('SELECT COUNT(*) c FROM attendance WHERE work_date = ? AND late_min > 0').get(today).c;
  const outside = db.prepare('SELECT COUNT(*) c FROM attendance WHERE work_date = ? AND check_in_outside = 1').get(today).c;
  const pendingLeaves = db.prepare("SELECT COUNT(*) c FROM leave_requests WHERE status = 'pending'").get().c;
  res.json({ today, totalEmp, checkedIn, notYet: Math.max(0, totalEmp - checkedIn), late, outside, pendingLeaves });
});

// Dùng cho trang Tổng quan (danh sách hôm nay có ảnh)
r.get('/attendance', (req, res) => {
  const month = (req.query.month || vnDateStr().slice(0, 7)).slice(0, 7);
  const dept = req.query.dept || null;
  let sql = `SELECT a.*, e.code, e.full_name, e.department, oi.name AS in_office
             FROM attendance a JOIN employees e ON e.id=a.employee_id
             LEFT JOIN offices oi ON oi.id=a.check_in_office_id WHERE a.work_date LIKE ?`;
  const args = [month + '%'];
  if (dept) { sql += ' AND e.department = ?'; args.push(dept); }
  sql += ' ORDER BY a.work_date DESC, e.full_name';
  const rows = db.prepare(sql).all(...args).map((a) => ({ ...a, check_in_hm: isoToVnHM(a.check_in_at), check_out_hm: isoToVnHM(a.check_out_at) }));
  res.json({ month, rows });
});

// Danh sách phòng ban (cho filter)
r.get('/departments', (req, res) => {
  const rows = db.prepare("SELECT DISTINCT department FROM employees WHERE active=1 AND department != '' ORDER BY department").all();
  res.json({ rows: rows.map((r) => r.department) });
});

// Báo cáo JSON (generic)
r.get('/data', (req, res) => {
  const month = (req.query.month || vnDateStr().slice(0, 7)).slice(0, 7);
  const dept = req.query.dept || null;
  const type = req.query.type || 'horizontal';
  res.json(buildReport(type, month, dept));
});

// Xuất Excel (generic theo type)
r.get('/export.xlsx', async (req, res) => {
  const month = (req.query.month || vnDateStr().slice(0, 7)).slice(0, 7);
  const dept = req.query.dept || null;
  const type = req.query.type || 'horizontal';
  const company = getSetting('company_name', 'Digiplus');
  const address = getSetting('company_address', '');
  const { title, columns, rows } = buildReport(type, month, dept);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Digiplus';
  const ws = wb.addWorksheet('BaoCao');
  const lastCol = columns.length;
  const thin = { style: 'thin', color: { argb: 'FFBFBFBF' } };
  const allBorder = { top: thin, left: thin, bottom: thin, right: thin };

  // Header công ty + địa chỉ + tiêu đề (giống mẫu)
  ws.mergeCells(1, 1, 1, lastCol);
  Object.assign(ws.getCell(1, 1), { value: 'Công ty: ' + company.toUpperCase(), font: { bold: true, size: 12 } });
  ws.mergeCells(2, 1, 2, lastCol);
  ws.getCell(2, 1).value = 'Địa chỉ: ' + (address || '');
  ws.mergeCells(3, 1, 3, lastCol);
  Object.assign(ws.getCell(3, 1), { value: title.toUpperCase(), font: { size: 14, bold: true }, alignment: { horizontal: 'center' } });
  ws.addRow([]);

  const hr = ws.addRow(columns.map((c) => c.label));
  hr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  hr.eachCell((cell, col) => {
    const meta = columns[col - 1];
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: meta.weekend ? 'FFB45309' : 'FF1E3A5F' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = allBorder;
  });

  for (const row of rows) {
    const r2 = ws.addRow(columns.map((c) => row[c.key] ?? ''));
    r2.eachCell((cell, col) => {
      const meta = columns[col - 1];
      cell.border = allBorder;
      if (meta.weekend) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3E6' } };
      if (col > 3) cell.alignment = { horizontal: 'center' };
    });
  }
  ws.columns.forEach((col, i) => { col.width = columns[i]?.w || 12; });
  ws.views = [{ state: 'frozen', ySplit: 5, xSplit: 2 }];

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="baocao_${type}_${month}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

export default r;
