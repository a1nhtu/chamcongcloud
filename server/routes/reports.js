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
// Mảng ngày YYYY-MM-DD trong khoảng [from, to] (bao gồm 2 đầu)
function daysBetween(from, to) {
  const out = [];
  for (let d = new Date(from + 'T12:00:00Z'); d <= new Date(to + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1))
    out.push(d.toISOString().slice(0, 10));
  return out;
}
// Từ query: ưu tiên from/to; nếu thiếu thì suy ra từ month (cả tháng). Tự đảo nếu to < from.
function resolvePeriod(q) {
  let from = (q.from || '').slice(0, 10), to = (q.to || '').slice(0, 10);
  if (!from || !to) {
    const month = (q.month || vnDateStr().slice(0, 7)).slice(0, 7);
    const ds = monthDays(month);
    from = ds[0]; to = ds[ds.length - 1];
  }
  if (to < from) { const t = from; from = to; to = t; }
  return { from, to };
}
// Nhãn kỳ: nếu đúng trọn 1 tháng → "tháng MM/YYYY", ngược lại → "kỳ DD/MM/YYYY – DD/MM/YYYY"
function periodLabel(from, to) {
  if (from.slice(0, 7) === to.slice(0, 7)) {
    const md = monthDays(from.slice(0, 7));
    if (from === md[0] && to === md[md.length - 1]) return `tháng ${from.slice(5, 7)}/${from.slice(0, 4)}`;
  }
  return `kỳ ${fmtDMY(from)} – ${fmtDMY(to)}`;
}

// Bộ lọc nhân viên dùng chung: nhận string dept (cũ) HOẶC object {dept, depts:[], ids:[]}.
// Ưu tiên: ids (chọn NV cụ thể) > depts (nhiều phòng ban) > dept (1 phòng ban, tương thích cũ).
export function empFilterSql(filter) {
  const f = typeof filter === 'string' ? { dept: filter } : (filter || {});
  const ids = (f.ids || []).map(Number).filter(Boolean);
  const depts = (f.depts || []).filter(Boolean);
  if (ids.length) return { where: ` AND id IN (${ids.map(() => '?').join(',')})`, args: ids };
  if (depts.length) return { where: ` AND department IN (${depts.map(() => '?').join(',')})`, args: depts };
  if (f.dept) return { where: ' AND department = ?', args: [f.dept] };
  return { where: '', args: [] };
}

// Nạp toàn bộ dữ liệu 1 khoảng ngày [from, to] để các báo cáo dùng chung
function loadRange(from, to, filter) {
  const weekend = getSetting('weekend_days', '7');
  const ef = empFilterSql(filter);
  const empSql = `SELECT id, code, full_name, department, position, shift_id
                FROM employees WHERE active = 1 AND role != 'admin'${ef.where} ORDER BY department, full_name`;
  const employees = db.prepare(empSql).all(...ef.args);

  const results = db.prepare(
    `SELECT a.*, e.code, e.full_name, e.department, s.name AS shift_name,
            s.start_time AS shift_start, s.end_time AS shift_end
     FROM attendance a JOIN employees e ON e.id = a.employee_id
     LEFT JOIN shifts s ON s.id = a.shift_id
     WHERE a.work_date >= ? AND a.work_date <= ?`
  ).all(from, to);
  // shift join fallback: nếu không có phân ca ngày, lấy ca mặc định
  const shiftsById = new Map(db.prepare('SELECT * FROM shifts').all().map((s) => [s.id, s]));
  const empById = new Map(employees.map((e) => [e.id, e]));

  // empId|date -> 1 ô gộp (có thể NHIỀU ca/ngày): cộng công/giờ/OT/muộn/sớm, vào sớm nhất, ra muộn nhất
  const cell = new Map();
  for (const row of results) {
    if (!empById.has(row.employee_id)) continue; // chỉ giữ NV trong bộ lọc (phòng ban/NV cụ thể)
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
  for (const a of db.prepare('SELECT employee_id, work_date, shift_id, is_off FROM daily_shift_assignments WHERE work_date >= ? AND work_date <= ?').all(from, to))
    assigns.set(a.employee_id + '|' + a.work_date, a);

  const holidays = new Set(db.prepare('SELECT holiday_date FROM public_holidays WHERE holiday_date >= ? AND holiday_date <= ?').all(from, to).map((h) => h.holiday_date));

  // Nghỉ phép đã duyệt phủ lên từng ngày
  const leaveDays = new Set(); // empId|date
  const leaveRows = db.prepare(
    `SELECT l.*, e.code, e.full_name, e.department FROM leave_requests l JOIN employees e ON e.id=l.employee_id
     WHERE l.from_date <= ? AND l.to_date >= ?`
  ).all(to, from).filter((l) => empById.has(l.employee_id)); // chỉ NV trong bộ lọc
  const rangeDays = daysBetween(from, to);
  for (const l of leaveRows) {
    if (l.status !== 'approved') continue;
    for (const d of rangeDays) if (d >= l.from_date && d <= l.to_date) leaveDays.add(l.employee_id + '|' + d);
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

  return { from, to, weekend, employees, cell, holidays, leaveDays, leaveRows, isScheduled, isWeekend: (d) => isWeekendDay(d, weekend) };
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
function buildReport(type, from, to, filter) {
  const ctx = loadRange(from, to, filter);
  const days = daysBetween(from, to);
  const PERIOD = periodLabel(from, to);
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
      return { title: `Bảng công ngang ${PERIOD}`, columns, rows };
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
      return { title: `Bảng ký hiệu ${PERIOD} (X=làm, T=trễ/sớm, P=phép, L=lễ, V=vắng, O=thiếu ra)`, columns, rows };
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
      return { title: `Chi tiết giờ vào/ra ${PERIOD}`, columns, rows };
    }

    /* --- Giờ công / giờ tăng ca theo ngày (ma trận) — mẫu GioChamGioCongGioTangCa --- */
    case 'workhours': {
      const dayCols = days.map((d) => ({ key: 'd' + d, label: d.slice(8), weekend: ctx.isWeekend(d) }));
      const columns = [
        { key: 'code', label: 'Mã NV', w: 10 }, { key: 'name', label: 'Họ tên', w: 22 },
        { key: 'dept', label: 'Bộ phận', w: 14 }, ...dayCols,
        { key: 'totalh', label: 'Tổng giờ', w: 10 }, { key: 'oth', label: 'Tăng ca (giờ)', w: 12 }, { key: 'cong', label: 'Tổng công', w: 10 },
      ];
      const rows = ctx.employees.map((e) => {
        const row = { code: e.code, name: e.full_name, dept: e.department || '' };
        let totalMin = 0, otMin = 0, cong = 0;
        for (const d of days) {
          const c = ctx.cell.get(e.id + '|' + d);
          if (c && (c.work_minutes || 0) > 0) { row['d' + d] = round2((c.work_minutes || 0) / 60); totalMin += c.work_minutes || 0; }
          else row['d' + d] = '';
          if (c) { otMin += c.ot_min || 0; cong += c.work_unit || 0; }
        }
        row.totalh = round2(totalMin / 60); row.oth = round2(otMin / 60); row.cong = round2(cong);
        return row;
      });
      return { title: `Giờ công & tăng ca ${PERIOD}`, columns, rows };
    }

    /* --- Vắng mặt / nghỉ phép — mẫu VangMatNghiPhep --- */
    case 'absence': {
      const columns = [
        { key: 'code', label: 'Mã NV', w: 10 }, { key: 'name', label: 'Họ tên', w: 22 }, { key: 'dept', label: 'Bộ phận', w: 14 },
        { key: 'work', label: 'Ngày làm', w: 10 }, { key: 'absent', label: 'Vắng', w: 8 }, { key: 'leave', label: 'Nghỉ phép', w: 10 },
        { key: 'holiday', label: 'Nghỉ lễ', w: 9 }, { key: 'missing', label: 'Thiếu ra', w: 9 },
      ];
      const rows = ctx.employees.map((e) => {
        const cnt = { X: 0, T: 0, P: 0, L: 0, V: 0, O: 0 };
        for (const d of days) { const s = symbolOf(ctx, e.id, d); if (cnt[s] != null) cnt[s]++; }
        return { code: e.code, name: e.full_name, dept: e.department || '', work: cnt.X + cnt.T, absent: cnt.V, leave: cnt.P, holiday: cnt.L, missing: cnt.O };
      });
      return { title: `Vắng mặt / nghỉ phép ${PERIOD}`, columns, rows };
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
          id: e.id, code: e.code, name: e.full_name, dept: e.department || '',
          cong: round2(cong), gio: round2(minutes / 60), ot: round2(ot / 60),
          lateN, lateM, earlyN, earlyM, vang,
        };
      });
      return { title: `Tổng hợp chấm công ${PERIOD}`, columns, rows };
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
      return { title: `Chi tiết chấm công ${PERIOD}`, columns, rows };
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
      return { title: `Báo cáo chấm công ${PERIOD}`, columns, rows };
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
      return { title: `Đi muộn / về sớm ${PERIOD}`, columns, rows };
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
      return { title: `Tăng ca chi tiết ${PERIOD}`, columns, rows };
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
      return { title: `Giờ vào đầu & ra cuối ${PERIOD}`, columns, rows };
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
      return { title: `Nghỉ phép / đơn từ ${PERIOD}`, columns, rows };
    }

    /* --- Bảng lương (luôn theo THÁNG chứa ngày bắt đầu) --- */
    case 'payroll': {
      const [y, m] = from.split('-').map(Number);
      const { from: pFrom, to: pTo, rows: pr } = computePayrollTable(y, m, filter);
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
      return { title: `Bảng lương tháng ${String(m).padStart(2, '0')}/${y} (kỳ ${fmtDMY(pFrom)} - ${fmtDMY(pTo)})`, columns, rows };
    }

    default:
      return buildReport('horizontal', from, to, filter);
  }
}

/* ===== Xuất Excel "Giờ công & tăng ca" — mẫu chi tiết 3 dòng/NV (giống file mẫu) ===== */
const WD_LABEL = { 0: 'CN', 1: 'T.2', 2: 'T.3', 3: 'T.4', 4: 'T.5', 5: 'T.6', 6: 'T.7' };
async function exportWorkhoursXlsx(res, from, to, filter, company, address) {
  const ctx = loadRange(from, to, filter);
  const days = daysBetween(from, to);
  const PERIOD = periodLabel(from, to).toUpperCase();
  const FIXED = 5;                 // STT, Phòng ban, Mã NV, Tên NV, Ngày vào làm
  const totalCols = FIXED + days.length * 2;
  const wb = new ExcelJS.Workbook(); wb.creator = 'Digiplus';
  const ws = wb.addWorksheet('GioCong');
  const thin = { style: 'thin', color: { argb: 'FFBFBFBF' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const teal = 'FF0F7D7D', pink = 'FFFFE0EC';

  // Header công ty / địa chỉ / tiêu đề + chú thích
  ws.mergeCells(1, 1, 1, totalCols); Object.assign(ws.getCell(1, 1), { value: 'Công ty: ' + company.toUpperCase(), font: { bold: true, size: 12 } });
  ws.mergeCells(2, 1, 2, totalCols); ws.getCell(2, 1).value = 'Địa chỉ: ' + (address || '');
  ws.mergeCells(3, 1, 3, totalCols); Object.assign(ws.getCell(3, 1), { value: `BẢNG CHẤM CÔNG CHI TIẾT GIỜ CÔNG & TĂNG CA ${PERIOD}`, font: { size: 14, bold: true }, alignment: { horizontal: 'center' } });
  ws.mergeCells(4, 1, 4, totalCols); Object.assign(ws.getCell(4, 1), { value: 'Mỗi nhân viên gồm 3 dòng: (1) Giờ chấm Vào–Ra · (2) Giờ công · (3) Giờ tăng ca', font: { italic: true, size: 10, color: { argb: 'FF666666' } } });

  // 2 dòng tiêu đề cột (dòng số ngày + dòng thứ)
  const H = 5;
  const fixedLabels = ['STT', 'Phòng ban', 'Mã nhân viên', 'Tên nhân viên', 'Ngày vào làm'];
  fixedLabels.forEach((lab, i) => { ws.mergeCells(H, i + 1, H + 1, i + 1); ws.getCell(H, i + 1).value = lab; });
  days.forEach((d, di) => {
    const c1 = FIXED + di * 2 + 1;
    ws.mergeCells(H, c1, H, c1 + 1); ws.getCell(H, c1).value = +d.slice(8);
    ws.mergeCells(H + 1, c1, H + 1, c1 + 1); ws.getCell(H + 1, c1).value = WD_LABEL[new Date(d + 'T12:00:00Z').getUTCDay()];
  });
  for (let r = H; r <= H + 1; r++) {
    for (let c = 1; c <= totalCols; c++) {
      const cell = ws.getCell(r, c);
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: teal } };
      cell.border = border;
    }
  }

  // Mỗi NV = 3 dòng
  let r = H + 2, stt = 0;
  const hireDate = () => ''; // chưa lưu ngày vào làm
  for (const e of ctx.employees) {
    stt++;
    const rIn = r, rCong = r + 1, rOt = r + 2;
    const fixedVals = [stt, e.department || '', e.code, e.full_name, hireDate()];
    fixedVals.forEach((v, i) => { ws.mergeCells(rIn, i + 1, rOt, i + 1); Object.assign(ws.getCell(rIn, i + 1), { value: v, alignment: { vertical: 'middle', horizontal: i === 3 ? 'left' : 'center' } }); });
    for (let di = 0; di < days.length; di++) {
      const d = days[di], c1 = FIXED + di * 2 + 1;
      const c = ctx.cell.get(e.id + '|' + d);
      const weekend = ctx.isWeekend(d);
      ws.getCell(rIn, c1).value = c && c.check_in_at ? isoToVnHM(c.check_in_at) : '';
      ws.getCell(rIn, c1 + 1).value = c && c.check_out_at ? isoToVnHM(c.check_out_at) : '';
      ws.mergeCells(rCong, c1, rCong, c1 + 1); ws.getCell(rCong, c1).value = c && c.work_minutes ? round2(c.work_minutes / 60) : 0;
      ws.mergeCells(rOt, c1, rOt, c1 + 1); ws.getCell(rOt, c1).value = c && c.ot_min ? round2(c.ot_min / 60) : 0;
      for (const [rr, cc] of [[rIn, c1], [rIn, c1 + 1], [rCong, c1], [rOt, c1]]) {
        const cell = ws.getCell(rr, cc);
        cell.alignment = { horizontal: 'center' };
        cell.border = border;
        if (weekend) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: pink } };
      }
    }
    for (let i = 1; i <= FIXED; i++) ws.getCell(rIn, i).border = border;
    r += 3;
  }
  if (!ctx.employees.length) { ws.mergeCells(r, 1, r, totalCols); ws.getCell(r, 1).value = 'Không có dữ liệu.'; }

  ws.getColumn(1).width = 5; ws.getColumn(2).width = 14; ws.getColumn(3).width = 12; ws.getColumn(4).width = 20; ws.getColumn(5).width = 12;
  for (let i = 0; i < days.length; i++) { ws.getColumn(FIXED + i * 2 + 1).width = 7; ws.getColumn(FIXED + i * 2 + 2).width = 7; }
  ws.views = [{ state: 'frozen', ySplit: H + 1, xSplit: FIXED }];

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="giocong_tangca_${from}_${to}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

/* ===== Xuất Excel "Chi tiết giờ vào/ra" — ma trận 2 cột/ngày (Vào|Ra), 1 dòng/NV (mẫu ChiTietThoiGianLamViec) ===== */
async function exportDaytimeXlsx(res, from, to, filter, company, address) {
  const ctx = loadRange(from, to, filter);
  const days = daysBetween(from, to);
  const PERIOD = periodLabel(from, to).toUpperCase();
  const FIXED = 5;
  const totalCols = FIXED + days.length * 2 + 1;   // + cột Tổng công
  const congCol = totalCols;
  const wb = new ExcelJS.Workbook(); wb.creator = 'Digiplus';
  const ws = wb.addWorksheet('GioVaoRa');
  const thin = { style: 'thin', color: { argb: 'FFBFBFBF' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const teal = 'FF0F7D7D', pink = 'FFFFE0EC';

  ws.mergeCells(1, 1, 1, totalCols); Object.assign(ws.getCell(1, 1), { value: 'Công ty: ' + company.toUpperCase(), font: { bold: true, size: 12 } });
  ws.mergeCells(2, 1, 2, totalCols); ws.getCell(2, 1).value = 'Địa chỉ: ' + (address || '');
  ws.mergeCells(3, 1, 3, totalCols); Object.assign(ws.getCell(3, 1), { value: `BẢNG CHẤM CÔNG CHI TIẾT THỜI GIAN LÀM VIỆC ${PERIOD}`, font: { size: 14, bold: true }, alignment: { horizontal: 'center' } });
  ws.mergeCells(4, 1, 4, totalCols); Object.assign(ws.getCell(4, 1), { value: 'Mỗi ngày gồm 2 cột: Giờ Vào | Giờ Ra', font: { italic: true, size: 10, color: { argb: 'FF666666' } } });

  const H = 5;
  const fixedLabels = ['STT', 'Phòng ban', 'Mã nhân viên', 'Tên nhân viên', 'Ngày vào làm'];
  fixedLabels.forEach((lab, i) => { ws.mergeCells(H, i + 1, H + 1, i + 1); ws.getCell(H, i + 1).value = lab; });
  days.forEach((d, di) => {
    const c1 = FIXED + di * 2 + 1;
    ws.mergeCells(H, c1, H, c1 + 1); ws.getCell(H, c1).value = +d.slice(8);
    ws.getCell(H + 1, c1).value = 'Vào'; ws.getCell(H + 1, c1 + 1).value = 'Ra';
  });
  ws.mergeCells(H, congCol, H + 1, congCol); ws.getCell(H, congCol).value = 'Tổng công';
  for (let r = H; r <= H + 1; r++) for (let c = 1; c <= totalCols; c++) {
    const cell = ws.getCell(r, c);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: teal } };
    cell.border = border;
  }

  let r = H + 2, stt = 0;
  for (const e of ctx.employees) {
    stt++;
    [stt, e.department || '', e.code, e.full_name, ''].forEach((v, i) => {
      const cell = ws.getCell(r, i + 1); cell.value = v; cell.border = border;
      cell.alignment = { vertical: 'middle', horizontal: i === 3 ? 'left' : 'center' };
    });
    let cong = 0;
    for (let di = 0; di < days.length; di++) {
      const d = days[di], c1 = FIXED + di * 2 + 1;
      const c = ctx.cell.get(e.id + '|' + d);
      const weekend = ctx.isWeekend(d);
      ws.getCell(r, c1).value = c && c.check_in_at ? isoToVnHM(c.check_in_at) : '';
      ws.getCell(r, c1 + 1).value = c && c.check_out_at ? isoToVnHM(c.check_out_at) : '';
      if (c) cong += c.work_unit || 0;
      for (const cc of [c1, c1 + 1]) { const x = ws.getCell(r, cc); x.alignment = { horizontal: 'center' }; x.border = border; if (weekend) x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: pink } }; }
    }
    const cc = ws.getCell(r, congCol); cc.value = round2(cong); cc.alignment = { horizontal: 'center' }; cc.border = border;
    r++;
  }
  if (!ctx.employees.length) { ws.mergeCells(r, 1, r, totalCols); ws.getCell(r, 1).value = 'Không có dữ liệu.'; }

  ws.getColumn(1).width = 5; ws.getColumn(2).width = 14; ws.getColumn(3).width = 12; ws.getColumn(4).width = 20; ws.getColumn(5).width = 12;
  for (let i = 0; i < days.length; i++) { ws.getColumn(FIXED + i * 2 + 1).width = 7; ws.getColumn(FIXED + i * 2 + 2).width = 7; }
  ws.getColumn(congCol).width = 10;
  ws.views = [{ state: 'frozen', ySplit: H + 1, xSplit: FIXED }];

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="chitiet_giovaora_${from}_${to}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
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

// Danh sách phòng ban (cho filter) = danh mục Bộ phận đã khai (master) GỘP phòng ban đang gán ở NV
r.get('/departments', (req, res) => {
  const master = db.prepare('SELECT name FROM departments').all().map((r) => r.name);
  const used = db.prepare("SELECT DISTINCT department FROM employees WHERE active=1 AND department != ''").all().map((r) => r.department);
  const rows = [...new Set([...master, ...used].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));
  res.json({ rows });
});

// Báo cáo JSON (generic) — hỗ trợ ?month=YYYY-MM hoặc ?from=YYYY-MM-DD&to=YYYY-MM-DD
// Bộ lọc NV từ query: ?ids=1,2,3 (NV cụ thể) hoặc ?depts=A,B (nhiều phòng ban) hoặc ?dept=A (cũ)
function filterFromQuery(q) {
  const ids = String(q.ids || '').split(',').map(Number).filter(Boolean);
  const depts = String(q.depts || '').split(',').map((s) => s.trim()).filter(Boolean);
  return { ids, depts, dept: q.dept || null };
}

r.get('/data', (req, res) => {
  const { from, to } = resolvePeriod(req.query);
  const type = req.query.type || 'horizontal';
  res.json(buildReport(type, from, to, filterFromQuery(req.query)));
});

// Xuất Excel (generic theo type) — hỗ trợ ?month hoặc ?from&to
r.get('/export.xlsx', async (req, res) => {
  const { from, to } = resolvePeriod(req.query);
  const filter = filterFromQuery(req.query);
  const type = req.query.type || 'horizontal';
  const company = getSetting('company_name', 'Digiplus');
  const address = getSetting('company_address', '');

  // Mẫu chi tiết dạng ma trận 2 cột/ngày (giống file mẫu)
  if (type === 'workhours') return exportWorkhoursXlsx(res, from, to, filter, company, address);
  if (type === 'daytime') return exportDaytimeXlsx(res, from, to, filter, company, address);

  const { title, columns, rows } = buildReport(type, from, to, filter);

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
  res.setHeader('Content-Disposition', `attachment; filename="baocao_${type}_${from}_${to}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

export default r;
