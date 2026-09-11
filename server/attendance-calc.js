// Động cơ tính công (GĐ1) — công thức theo phần mềm mẫu ChamCongApp.
// Giờ ca là 'HH:MM' theo giờ VN; mốc chấm là ISO UTC. Ghép bằng offset +07:00.

const VN = '+07:00';

// Tạo Date (UTC instant) từ ngày làm việc VN + giờ 'HH:MM'
function vnInstant(workDate, hhmm, addDays = 0) {
  const d = new Date(`${workDate}T${hhmm}:00${VN}`);
  if (addDays) d.setUTCDate(d.getUTCDate() + addDays);
  return d;
}

// Mốc bắt đầu/kết thúc ca cho 1 ngày làm việc (xử lý ca đêm qua ngày)
export function shiftBounds(workDate, shift) {
  const start = vnInstant(workDate, shift.start_time);
  let end = vnInstant(workDate, shift.end_time);
  if (end <= start) end = new Date(end.getTime() + 24 * 3600 * 1000); // ca đêm
  return { start, end };
}

const mins = (a, b) => Math.round((b - a) / 60000);

// Tính đi muộn (phút) khi VÀO ca
export function computeLate(shift, checkInIso, workDate) {
  if (!shift || !checkInIso) return 0;
  const { start } = shiftBounds(workDate, shift);
  const raw = mins(start, new Date(checkInIso));
  const grace = shift.late_grace_min || 0;
  return raw > grace ? raw - grace : 0;
}

function roundOt(minutes, unit) {
  if (!unit || unit <= 0) return minutes;
  return Math.floor(minutes / unit) * unit; // làm tròn xuống theo đơn vị
}

/**
 * Tính đầy đủ chỉ số khi RA ca.
 * @returns {early_min, ot_min, work_minutes, work_unit, ot_type, day_status}
 */
export function computeCheckout(shift, checkInIso, checkOutIso, workDate, opts = {}) {
  const { isHoliday = false, isWeekend = false, roundingDecimals = 2 } = opts;
  const ci = new Date(checkInIso);
  const co = new Date(checkOutIso);
  const { start, end } = shiftBounds(workDate, shift);

  // Về sớm
  const earlyRaw = mins(co, end);
  const earlyGrace = shift.early_grace_min ?? 15;
  const early_min = earlyRaw > earlyGrace ? earlyRaw - earlyGrace : 0;

  // Giờ công thực: kẹp trong khung ca, trừ nghỉ giữa ca nếu có mặt >= nửa ca
  const effIn = ci < start ? start : ci;
  const effOut = co > end ? end : co;
  const inShift = Math.max(0, mins(effIn, effOut));
  const shiftLen = mins(start, end);
  const halfShift = Math.floor(shiftLen / 2);
  const breakDed = inShift >= halfShift ? (shift.break_minutes || 0) : 0;
  const work_minutes = Math.max(0, inShift - breakDed);

  // Tăng ca: ở lại sau tan ca >= ngưỡng
  let ot_min = 0;
  if (shift.allow_ot) {
    const otRaw = mins(end, co);
    const after = shift.ot_start_after_min ?? 30;
    if (otRaw >= after) ot_min = roundOt(otRaw, shift.ot_rounding_unit || 0);
  }

  // Số công
  const standard = Math.max(1, shiftLen - (shift.break_minutes || 0));
  const baseUnit = shift.work_unit_value ?? 1.0;
  const factor = Math.pow(10, roundingDecimals);
  const rawUnit = baseUnit * work_minutes / standard;
  const work_unit = Math.min(baseUnit, Math.floor(rawUnit * factor) / factor);

  const ot_type = isHoliday ? 'le' : isWeekend ? 'cuoi_tuan' : 'thuong';

  return { early_min, ot_min, work_minutes, work_unit, ot_type, day_status: 'lam_viec' };
}

// Thứ trong tuần của ngày lịch (workDate = 'YYYY-MM-DD'): 1=T2 .. 7=CN.
// Dùng 12:00 UTC để tránh lệch ngày do múi giờ.
export function vnWeekday(workDate) {
  const dow = new Date(`${workDate}T12:00:00Z`).getUTCDay(); // 0=CN
  return dow === 0 ? 7 : dow;
}

export function isWeekendDay(workDate, weekendDaysCsv) {
  const set = new Set((weekendDaysCsv || '7').split(',').map((x) => x.trim()).filter(Boolean));
  return set.has(String(vnWeekday(workDate)));
}
