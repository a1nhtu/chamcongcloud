// Tính chỉ số công cho MỘT ngày/bản ghi — nguồn chân lý DUY NHẤT.
// Gộp phần logic đang lặp ở recompute + computeManual (admin.js) và check-out (attendance.js).
// KHÔNG đổi công thức: vẫn dùng computeLate / computeCheckout / noShiftUnit như cũ.
import { computeLate, computeCheckout, isWeekendDay, noShiftUnit } from './attendance-calc.js';

/**
 * Gói cấu hình tính công cho CẢ MỘT MẺ (đọc settings + ngày lễ MỘT LẦN).
 * Dùng cho vòng lặp (recompute nhiều dòng) để khỏi query lại mỗi dòng.
 * @param {(k:string,d?:string)=>string} getSetting
 * @param {{prepare:Function}} db
 */
export function payrollCtx(getSetting, db) {
  const hol = new Set(db.prepare('SELECT holiday_date FROM public_holidays').all().map((r) => r.holiday_date));
  return {
    weekend: getSetting('weekend_days', '7'),
    roundingDecimals: parseInt(getSetting('workunit_rounding', '2'), 10) || 2,
    roundingMode: parseInt(getSetting('workunit_rounding_mode', '0'), 10) || 0,
    hourly: getSetting('attendance_mode', 'shift') === 'hourly',
    isHoliday: (d) => hol.has(d),
  };
}

/**
 * Tính đầy đủ chỉ số công cho 1 bản ghi. `shift` do caller GIẢI SẴN (mỗi nơi dò ca theo cách riêng).
 * Trả về đúng shape mà các UPDATE/INSERT hiện tại cần: { shiftId, late, early_min, ot_min,
 * work_minutes, work_unit, ot_type, day_status }.
 * Công thức giữ NGUYÊN so với code cũ — chỉ gom một chỗ.
 */
export function computeDayMetrics(ctx, shift, workDate, inIso, outIso) {
  const flags = {
    isHoliday: ctx.isHoliday(workDate),
    isWeekend: isWeekendDay(workDate, ctx.weekend),
    roundingDecimals: ctx.roundingDecimals,
    roundingMode: ctx.roundingMode,
  };
  const otType = flags.isHoliday ? 'le' : flags.isWeekend ? 'cuoi_tuan' : 'thuong';
  const late = (shift && inIso) ? computeLate(shift, inIso, workDate) : 0;

  let c;
  if (inIso && outIso) {
    if (shift) {
      c = computeCheckout(shift, inIso, outIso, workDate, flags);
    } else {
      const wm = Math.max(0, Math.round((new Date(outIso) - new Date(inIso)) / 60000));
      c = { early_min: 0, ot_min: 0, work_minutes: wm, work_unit: noShiftUnit(wm, flags), ot_type: otType, day_status: 'lam_viec' };
    }
  } else {
    c = { early_min: 0, ot_min: 0, work_minutes: 0, work_unit: 0, ot_type: otType, day_status: inIso ? 'thieu_ra' : 'vang' };
  }
  return { shiftId: shift?.id ?? null, late, ...c };
}
