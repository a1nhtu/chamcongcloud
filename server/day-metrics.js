// Tính chỉ số công cho MỘT ngày/bản ghi — nguồn chân lý DUY NHẤT.
// Gộp phần logic đang lặp ở recompute + computeManual (admin.js) và check-out (attendance.js).
// KHÔNG đổi công thức: vẫn dùng computeLate / computeCheckout / noShiftUnit như cũ.
import { computeLate, computeCheckout, computeNoOut, computeSinglePunch, singlePunchFull, isWeekendDay, noShiftUnit, sumPairsMinutes, weekendToOt, roundOtParts, halfLeavePriv } from './attendance-calc.js';
import { privilegeLookup, halfLeaveLookup } from './privilege.js';
import { otRegCapper } from './ot-cap.js';
import { dayRules } from './swap.js';

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
  const rules = dayRules(db);   // ngày lễ / nghỉ bù lễ / ngày làm bù
  return {
    weekend: getSetting('weekend_days', '7'),
    weekendOt: getSetting('weekend_work_as_ot', '1') === '1',   // đi làm ngày cuối tuần = tăng ca
    weekendOtBefore: getSetting('weekend_ot_before', '0') === '1',   // ngày nghỉ: tăng ca tính cả phần đến sớm trước giờ vào ca
    pairsFixedBreak: getSetting('pairs_fixed_break', '0') === '1',   // nhiều lần vào/ra + nghỉ trưa cố định (kiểu HR-ERP 4 lần quẹt)
    weekendNeedPairs: getSetting('weekend_need_pairs', '0') === '1',   // ngày nghỉ: chỉ 2 lần quẹt thì không tính giờ làm trong ca
    weekendWorkExact: getSetting('weekend_work_exact', '0') === '1',   // ngày nghỉ: giờ làm trong ca giữ đúng số phút, chỉ làm tròn phần ngoài ca
    roundingDecimals: parseInt(getSetting('workunit_rounding', '2'), 10) || 2,
    roundingMode: parseInt(getSetting('workunit_rounding_mode', '0'), 10) || 0,
    otRound: otRoundingFrom(getSetting),
    lateBlock: Math.max(0, parseInt(getSetting('late_round_block', '0'), 10) || 0),   // làm tròn đi trễ / về sớm theo khối phút (0 = không)
    // NV thuộc phòng ban "đi làm cuối tuần tính như ngày thường" (VD bảo vệ) — nạp 1 lần cho cả mẻ
    weekendNormal: (() => {
      let set = null;
      return (empId) => {
        if (!set) {
          let list = [];
          try { list = JSON.parse(getSetting('weekend_normal_depts', '[]')) || []; } catch {}
          set = new Set(list.length ? db.prepare(`SELECT id FROM employees WHERE department IN (${list.map(() => '?').join(',')})`).all(...list.map(String)).map((e) => e.id) : []);
        }
        return !!empId && set.has(empId);
      };
    })(),
    privOf: privilegeLookup(db),   // chế độ ưu đãi (thai sản…) của NV theo ngày — nạp 1 lần cho cả mẻ
    halfOf: halfLeaveLookup(db),   // đơn nghỉ phép NỬA NGÀY đã duyệt ('sang' | 'chieu')
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
    isHoliday: rules.isHoliday, isCompOff: rules.isCompOff, isSwapWork: rules.isSwapWork,
    otReg: otRegCapper(db, getSetting),   // ĐĂNG KÝ LÀM THÊM: (NV, ngày, phút thực tế) → phút được tính
  };
}

/**
 * Tính đầy đủ chỉ số công cho 1 bản ghi. `shift` do caller GIẢI SẴN (mỗi nơi dò ca theo cách riêng).
 * Trả về đúng shape mà các UPDATE/INSERT hiện tại cần: { shiftId, late, early_min, ot_min,
 * work_minutes, work_unit, ot_type, day_status, ot_raw }.
 * ot_raw = tăng ca THỰC TẾ; ot_min = tăng ca ĐƯỢC TÍNH sau khi chặn theo đăng ký làm thêm (không đăng ký → bằng nhau).
 * Công thức giữ NGUYÊN so với code cũ — chỉ gom một chỗ.
 */
// opts.hourly: nhân viên chấm công THEO GIỜ → không đổi ngày cuối tuần thành tăng ca (mẫu theo giờ không có tăng ca)
export function computeDayMetrics(ctx, shift, workDate, inIso, outIso, pairs = null, opts = {}) {
  // LÀM BÙ: ngày làm bù tính như ngày thường. NGHỈ BÙ LỄ mà đi làm: bản chất là ngày nghỉ hằng tuần → cả ngày là tăng ca hệ số ngày nghỉ.
  const swapWork = !!(opts.empId && ctx.isSwapWork && ctx.isSwapWork(opts.empId, workDate));
  const compOff = !swapWork && !!(ctx.isCompOff && ctx.isCompOff(workDate));
  const flags = {
    isHoliday: ctx.isHoliday(workDate),
    isWeekend: compOff || (!swapWork && isWeekendDay(workDate, ctx.weekend) && !(opts.empId && ctx.weekendNormal && ctx.weekendNormal(opts.empId))),
    roundingDecimals: ctx.roundingDecimals,
    roundingMode: ctx.roundingMode,
    lateBlock: ctx.lateBlock || 0,
    pairsFixedBreak: !!ctx.pairsFixedBreak,   // nhiều lần vào/ra + nghỉ trưa cố định: mỗi cặp trừ giờ nghỉ
    weekendOtBefore: !!ctx.weekendOtBefore,   // ngày nghỉ: đến sớm trước ca cũng là tăng ca
    pairs,   // quy tắc "Nhiều lần vào/ra": các cặp vào–ra trong ngày (null = tính như cũ)
    priv: opts.empId && ctx.privOf ? ctx.privOf(opts.empId, workDate) : null,   // ưu đãi đến muộn / về sớm (thai sản…)
  };
  const otType = flags.isHoliday ? 'le' : flags.isWeekend ? 'cuoi_tuan' : 'thuong';
  // nghỉ phép nửa ngày: nửa nghỉ không tính trễ / sớm (giờ công vẫn tính theo flags.priv gốc = đúng phần đã làm)
  const half = shift && opts.empId && ctx.halfOf ? ctx.halfOf(opts.empId, workDate) : '';
  const lePriv = half ? halfLeavePriv(shift, workDate, half, flags.priv) : flags.priv;
  // Ca chọn "Chấm 1 lần: có mặt là tính đủ công": chỉ có giờ vào hoặc chỉ có giờ ra → đủ công, không đi muộn
  const single = !!shift && singlePunchFull(shift) && !inIso !== !outIso;
  const late = (shift && inIso && !single) ? computeLate(shift, inIso, workDate, ctx.lateBlock || 0, lePriv) : 0;

  let c;
  if (single) {
    c = computeSinglePunch(shift, workDate, flags);
  } else if (inIso && outIso) {
    if (shift) {
      c = computeCheckout(shift, inIso, outIso, workDate, flags);
      if (half) c.early_min = computeCheckout(shift, inIso, outIso, workDate, { ...flags, priv: lePriv }).early_min;
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
  // Ngày nghỉ + ca nghỉ trưa cố định + chỉ 1 cặp quẹt (2 lần): HR-ERP không tính giờ làm trong ca (chỉ tăng ca ngoài ca) — cài đặt weekend_need_pairs
  if (flags.isWeekend && ctx.weekendNeedPairs && shift && shift.break_start && pairs && pairs.length === 1 && c.work_minutes) c = { ...c, work_minutes: 0, work_unit: 0 };
  const beforeWk = c;
  if ((ctx.weekendOt || compOff) && !opts.hourly) c = weekendToOt(c, { ...flags, weekendOt: true });
  // chấm 1 lần ngày nghỉ (đi làm tính tăng ca): không có giờ ra → không tính tăng ca
  if (single && c !== beforeWk) c = { ...c, ot_min: 0, day_status: 'thieu_ra' };
  const wkExact = c !== beforeWk ? (beforeWk.work_minutes || 0) : 0;   // giờ làm trong ca vừa chuyển thành tăng ca ngày nghỉ
  // làm tròn tăng ca (quy tắc chung) — từng đoạn trước ca / sau ca làm tròn riêng
  if (c.ot_min) { const r = ctx.otRound || {}; c = { ...c, ot_min: roundOtParts(c.ot_min, c.ot_parts, r.decimals ?? 2, r.mode || 0, r.block || 0, ctx.weekendWorkExact ? wkExact : 0) }; }
  delete c.ot_parts;
  const ot_raw = c.ot_min || 0;
  if (ot_raw && opts.empId && ctx.otReg) c = { ...c, ot_min: ctx.otReg(opts.empId, workDate, ot_raw) };
  return { shiftId: shift?.id ?? null, late, ...c, ot_raw };
}
