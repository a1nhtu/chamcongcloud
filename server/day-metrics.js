// Tính chỉ số công cho MỘT ngày/bản ghi — nguồn chân lý DUY NHẤT.
// Gộp phần logic đang lặp ở recompute + computeManual (admin.js) và check-out (attendance.js).
// KHÔNG đổi công thức: vẫn dùng computeLate / computeCheckout / noShiftUnit như cũ.
import { computeLate, computeCheckout, computeNoOut, isWeekendDay, noShiftUnit, sumPairsMinutes, weekendToOt, roundOtMinutes } from './attendance-calc.js';

/**
 * Gói cấu hình tính công cho CẢ MỘT MẺ (đọc settings + ngày lễ MỘT LẦN).
 * Dùng cho vòng lặp (recompute nhiều dòng) để khỏi query lại mỗi dòng.
 * @param {(k:string,d?:string)=>string} getSetting
 * @param {{prepare:Function}} db
 */
// Cách làm tròn tăng ca (Cài đặt > Quy tắc tính công): { decimals, mode, block } — block > 0 = theo khối phút
export function otRoundingFrom(getSetting) {
  const dec = parseInt(getSetting('ot_rounding', '2'), 10);
  const block = getSetting('ot_rounding_type', 'hour') === 'block' ? Math.max(1, parseInt(getSetting('ot_rounding_block', '15'), 10) || 15) : 0;
  return { decimals: Number.isFinite(dec) ? dec : 2, mode: parseInt(getSetting('ot_rounding_mode', '0'), 10) || 0, block };
}
export function payrollCtx(getSetting, db) {
  const hol = new Set(db.prepare('SELECT holiday_date FROM public_holidays').all().map((r) => r.holiday_date));
  return {
    weekend: getSetting('weekend_days', '7'),
    weekendOt: getSetting('weekend_work_as_ot', '1') === '1',   // đi làm ngày cuối tuần = tăng ca
    roundingDecimals: parseInt(getSetting('workunit_rounding', '2'), 10) || 2,
    roundingMode: parseInt(getSetting('workunit_rounding_mode', '0'), 10) || 0,
    otRound: otRoundingFrom(getSetting),
    hourly: getSetting('attendance_mode', 'shift') === 'hourly',
    // Kiểu chấm công của TỪNG nhân viên (đặt riêng ở hồ sơ, không đặt thì theo cài đặt chung) — nạp 1 lần cho cả mẻ
    isHourly: (() => {
      const g = getSetting('attendance_mode', 'shift') === 'hourly';
      let map = null;
      return (empId) => {
        if (!map) map = new Map(db.prepare("SELECT id, att_mode FROM employees WHERE att_mode IN ('shift','hourly')").all().map((e) => [e.id, e.att_mode === 'hourly']));
        return map.has(empId) ? map.get(empId) : g;
      };
    })(),
    isHoliday: (d) => hol.has(d),
  };
}

/**
 * Tính đầy đủ chỉ số công cho 1 bản ghi. `shift` do caller GIẢI SẴN (mỗi nơi dò ca theo cách riêng).
 * Trả về đúng shape mà các UPDATE/INSERT hiện tại cần: { shiftId, late, early_min, ot_min,
 * work_minutes, work_unit, ot_type, day_status }.
 * Công thức giữ NGUYÊN so với code cũ — chỉ gom một chỗ.
 */
// opts.hourly: nhân viên chấm công THEO GIỜ → không đổi ngày cuối tuần thành tăng ca (mẫu theo giờ không có tăng ca)
export function computeDayMetrics(ctx, shift, workDate, inIso, outIso, pairs = null, opts = {}) {
  const flags = {
    isHoliday: ctx.isHoliday(workDate),
    isWeekend: isWeekendDay(workDate, ctx.weekend),
    roundingDecimals: ctx.roundingDecimals,
    roundingMode: ctx.roundingMode,
    pairs,   // quy tắc "Nhiều lần vào/ra": các cặp vào–ra trong ngày (null = tính như cũ)
  };
  const otType = flags.isHoliday ? 'le' : flags.isWeekend ? 'cuoi_tuan' : 'thuong';
  const late = (shift && inIso) ? computeLate(shift, inIso, workDate) : 0;

  let c;
  if (inIso && outIso) {
    if (shift) {
      c = computeCheckout(shift, inIso, outIso, workDate, flags);
    } else {
      // Không ca (chế độ theo giờ): "theo cặp" ≥ 2 cặp → cộng từng cặp; còn lại = ra − vào (FILO)
      const wm = (pairs && pairs.length >= 2) ? sumPairsMinutes(pairs)
        : Math.max(0, Math.round((new Date(outIso) - new Date(inIso)) / 60000));
      c = { early_min: 0, ot_min: 0, work_minutes: wm, work_unit: noShiftUnit(wm, flags), ot_type: otType, day_status: 'lam_viec' };
    }
  } else if (inIso) {
    // Thiếu giờ ra: mặc định 0 công; ca bật "thiếu giờ ra vẫn tính công" → đủ giờ ca trừ phần đi trễ
    c = computeNoOut(shift, inIso, workDate, flags);
  } else {
    c = { early_min: 0, ot_min: 0, work_minutes: 0, work_unit: 0, ot_type: otType, day_status: 'vang' };
  }
  if (ctx.weekendOt && !opts.hourly) c = weekendToOt(c, { ...flags, weekendOt: true });
  if (c.ot_min) { const r = ctx.otRound || {}; c = { ...c, ot_min: roundOtMinutes(c.ot_min, r.decimals ?? 2, r.mode || 0, r.block || 0) }; }   // làm tròn tăng ca (quy tắc chung)
  return { shiftId: shift?.id ?? null, late, ...c };
}
