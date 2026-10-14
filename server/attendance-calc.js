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
// Giờ chấm chỉ tính tới PHÚT (bỏ giây lẻ) — quẹt 08:05:40 là "08:05", khớp với giờ hiện trên báo cáo
// (nếu để nguyên giây: 08:05:40 so với ca 08:00 làm tròn thành trễ 6 phút dù báo cáo ghi 08:05).
const toMinute = (iso) => new Date(Math.floor(new Date(iso).getTime() / 60000) * 60000);

// Tính đi muộn (phút) khi VÀO ca.
// Dung sai (late_grace_min) chỉ là NGƯỠNG: trễ trong ngưỡng → bỏ qua (0);
// vượt ngưỡng → ghi ĐÚNG số phút trễ thực tế (KHÔNG trừ dung sai).
// Làm tròn LÊN theo khối phút (quy tắc chung "Làm tròn đi trễ / về sớm", 0 = không làm tròn)
// VD khối 15': trễ 1' → 15', trễ 16' → 30' (giống "đơn vị chấm công" của HR-ERP)
export function roundUpBlock(m, block = 0) {
  const v = Number(m) || 0;
  if (v <= 0 || !(block > 0)) return Math.max(0, v);
  return Math.ceil(v / block - 1e-9) * block;
}

// Khung NGHỈ GIỮA CA cố định giờ (ca có khai "Nghỉ giữa ca bắt đầu lúc"): [bs, be]; không khai → null
export function breakWindow(workDate, shift, start) {
  if (!shift || !shift.break_start || !(shift.break_minutes > 0)) return null;
  let bs = vnInstant(workDate, shift.break_start);
  if (bs < start) bs = new Date(bs.getTime() + 24 * HH);   // ca đêm: giờ nghỉ sau nửa đêm
  return { bs, be: new Date(bs.getTime() + shift.break_minutes * 60000) };
}
// Số phút khoảng [a, b] trùng với giờ nghỉ (để đi trễ / về sớm / giờ công KHÔNG tính thời gian nghỉ)
function breakOverlap(brk, a, b) {
  if (!brk || !(b > a)) return 0;
  const s = a > brk.bs ? a : brk.bs, e = b < brk.be ? b : brk.be;
  return e > s ? mins(s, e) : 0;
}

// CHẾ ĐỘ ƯU ĐÃI (thai sản, nuôi con nhỏ… — server/privilege.js): priv = { late, midOut, midIn, early } phút.
// Số phút được ưu đãi trừ thẳng vào phút đi trễ / về sớm, đúng ĐOẠN của ca:
//  - vào trước giờ nghỉ trưa → trừ `late` (đầu ca được đến muộn)
//  - vào sau giờ nghỉ trưa (chỉ làm chiều) → trừ `midIn` vào phần trễ của buổi chiều; buổi sáng vắng vẫn tính đủ
//  - ra sau giờ nghỉ trưa → trừ `early` (cuối ca được về sớm)
//  - ra trước/trong giờ nghỉ trưa (chỉ làm sáng) → trừ `midOut` vào phần về sớm của buổi sáng
// Ca không khai giờ nghỉ cố định: chỉ dùng `late` / `early` (midOut / midIn áp ở chế độ nhiều lần vào/ra).
// halfIn / halfOut: phần ca thuộc nửa ngày NGHỈ PHÉP (xem halfLeavePriv) — trừ ở mọi đoạn
function privAllowIn(priv, brk, t) {
  if (!priv) return 0;
  const h = priv.halfIn || 0;
  if (brk && t > brk.bs) return h + Math.min(priv.midIn || 0, Math.max(0, mins(brk.be, t)));
  return h + (priv.late || 0);
}
function privAllowOut(priv, brk, t) {
  if (!priv) return 0;
  const h = priv.halfOut || 0;
  if (brk && t < brk.be) return h + Math.min(priv.midOut || 0, Math.max(0, mins(t, brk.bs)));
  return h + (priv.early || 0);
}

// NGHỈ PHÉP NỬA NGÀY (đơn đã duyệt, half = 'sang' | 'chieu'): nửa ngày nghỉ KHÔNG tính đi trễ / về sớm.
//  - nghỉ sáng: được "đến muộn" tới đầu buổi chiều · nghỉ chiều: được "về sớm" từ cuối buổi sáng
//  - đầu/cuối buổi: theo giờ nghỉ trưa cố định của ca; ca không khai → nửa giờ chuẩn + thời gian nghỉ (HC 8–17 nghỉ 60' → 13:00 / 12:00)
// Trả priv đã gộp (giữ ưu đãi thai sản nếu có). CHỈ dùng để tính số phút trễ / sớm — giờ công vẫn tính đúng phần đã làm
// (nửa ngày nghỉ do đơn nghỉ phép trả), nên nơi gọi tính giờ công bằng priv gốc.
export function halfLeavePriv(shift, workDate, half, priv = null) {
  if (!shift || (half !== 'sang' && half !== 'chieu')) return priv;
  const { start, end } = shiftBounds(workDate, shift);
  const brk = breakWindow(workDate, shift, start);
  const brkMin = shift.break_minutes || 0;
  const halfStd = Math.round(Math.max(0, mins(start, end) - brkMin) / 2) + brkMin;
  const p = { late: 0, midOut: 0, midIn: 0, early: 0, ...(priv || {}) };
  if (half === 'sang') p.halfIn = brk ? mins(start, brk.bs) : halfStd;
  else p.halfOut = brk ? mins(brk.be, end) : halfStd;
  return p;
}

export function computeLate(shift, checkInIso, workDate, block = 0, priv = null) {
  if (!shift || !checkInIso) return 0;
  const { start } = shiftBounds(workDate, shift);
  const ciT = toMinute(checkInIso);
  const brk = breakWindow(workDate, shift, start);
  const raw = mins(start, ciT) - (ciT > start ? breakOverlap(brk, start, ciT) : 0) - (ciT > start ? privAllowIn(priv, brk, ciT) : 0);
  const grace = shift.late_grace_min || 0;
  if (raw <= grace) return 0;
  return roundUpBlock(shift.grace_deduct ? raw - grace : raw, block);   // tùy chọn của ca: chỉ tính phần VƯỢT số phút cho phép
}

// Làm tròn TĂNG CA theo quy tắc chung của công ty (Cài đặt > Quy tắc tính công), mode 0 = lùi (xuống), 1 = tới (lên):
//  - block > 0: theo KHỐI PHÚT — VD khối 15', 47 phút → lùi 45 · tới 60
//  - còn lại: số giờ giữ `decimals` chữ số thập phân — VD 40 phút = 0,666 giờ → 2 số lẻ: lùi 0,66 giờ (39,6 phút) · tới 0,67 giờ
// Trả lại số PHÚT.
// Làm tròn tổng tăng ca gồm nhiều ĐOẠN (trước ca / sau ca / cả ca ngày nghỉ): làm tròn từng đoạn rồi cộng.
// parts thiếu hoặc không khớp tổng → làm tròn cả tổng như cũ.
// exact (tùy chọn): số phút được GIỮ NGUYÊN, không làm tròn (VD giờ làm trong ca ngày nghỉ khi bật weekend_work_exact) — chỉ làm tròn phần còn lại
export function roundOtParts(total, parts, decimals = 2, mode = 0, block = 0, exact = 0) {
  const ex = Math.max(0, Math.min(Number(exact) || 0, Number(total) || 0));
  if (ex > 0) return roundOtParts((Number(total) || 0) - ex, parts, decimals, mode, block) + ex;
  const t = Number(total) || 0;
  const ps = (parts || []).map(Number).filter((x) => x > 0);
  const sum = ps.reduce((a, b) => a + b, 0);
  if (!ps.length || sum > t + 1e-9) return roundOtMinutes(t, decimals, mode, block);
  if (t - sum > 1e-9) ps.push(t - sum);   // phần cộng thêm sau (VD làm ngày nghỉ: cả giờ làm thành tăng ca)
  return ps.reduce((a, p) => a + roundOtMinutes(p, decimals, mode, block), 0);
}

export function roundOtMinutes(minutes, decimals = 2, mode = 0, block = 0) {
  const m = Number(minutes) || 0;
  if (m <= 0) return 0;
  if (block > 0) { const q = m / block; return (mode === 1 ? Math.ceil(q - 1e-9) : Math.floor(q + 1e-9)) * block; }
  const f = Math.pow(10, Math.max(0, Math.min(3, decimals | 0)));
  const h = m / 60 * f;
  const r = (mode === 1 ? Math.ceil(h - 1e-9) : Math.floor(h + 1e-9)) / f;
  return Math.round(r * 60 * 1000) / 1000;
}

/**
 * Tính đầy đủ chỉ số khi RA ca.
 * @returns {early_min, ot_min, work_minutes, work_unit, ot_type, day_status}
 */
// Số công khi KHÔNG có ca (không xác định được giờ chuẩn theo ca):
// tính theo TỈ LỆ so với 1 ngày công chuẩn (mặc định 8 giờ) → tránh cảnh 6 phút = 1 công.
// Làm việc >= 1 ngày chuẩn thì tối đa 1 công.
export function noShiftUnit(work_minutes, opts = {}) {
  const { roundingDecimals = 2, roundingMode = 0, standardMinutes = 480 } = opts;
  const std = Math.max(1, standardMinutes);
  const factor = Math.pow(10, roundingDecimals);
  const roundFn = roundingMode === 1 ? Math.ceil : roundingMode === 2 ? Math.round : Math.floor; // 0=lùi,1=tới,2=gần nhất
  return Math.min(1, Math.max(0, roundFn((work_minutes / std) * factor) / factor));
}

export function computeCheckout(shift, checkInIso, checkOutIso, workDate, opts = {}) {
  const { isHoliday = false, isWeekend = false, roundingDecimals = 2, roundingMode = 0, pairs = null, lateBlock = 0, priv = null, weekendOtBefore = false, pairsFixedBreak = false } = opts;
  const ci = toMinute(checkInIso);
  const co = toMinute(checkOutIso);
  const { start, end } = shiftBounds(workDate, shift);

  const brk = breakWindow(workDate, shift, start);
  // Về sớm — cùng cách với đi muộn: dung sai chỉ là NGƯỠNG; vượt ngưỡng → ghi ĐỦ số phút về sớm thực tế
  const earlyRaw = mins(co, end) - (co < end ? breakOverlap(brk, co, end) + privAllowOut(priv, brk, co) : 0);
  const earlyGrace = shift.early_grace_min ?? 15;
  const early_min = earlyRaw > earlyGrace ? roundUpBlock(shift.grace_deduct ? earlyRaw - earlyGrace : earlyRaw, lateBlock) : 0;

  // Trễ/sớm NẰM TRONG dung sai thì coi như đúng giờ: KHÔNG trừ giờ công (giống Ronald Jack/WiseEye:
  // giờ = giờ ca − phút trễ − phút sớm đã tính). Vượt dung sai → trừ đủ.
  const lateGrace = shift.late_grace_min || 0;
  // phút trễ / sớm đã TRỪ phần được ưu đãi (chế độ thai sản…)
  const lateOf = (t) => mins(start, t) - (t > start ? privAllowIn(priv, brk, t) : 0);
  const earlyOf = (t) => mins(t, end) - (t < end ? privAllowOut(priv, brk, t) : 0);
  const inGraceIn = (t) => { const raw = lateOf(t); return raw <= 0 || raw <= lateGrace; };
  const inGraceOut = (t) => { const raw = earlyOf(t); return raw <= 0 || raw <= earlyGrace; };

  // Giờ công thực: kẹp trong khung ca, trừ nghỉ giữa ca nếu có mặt >= nửa ca
  // Ca bật "chỉ tính phần vượt số phút cho phép": giờ công cũng chỉ bị trừ phần vượt
  // Làm tròn đi trễ / về sớm theo khối (quy tắc chung): giờ công trừ ĐÚNG số phút trễ/sớm đã làm tròn
  const gIn = shift.grace_deduct ? lateGrace : 0, gOut = shift.grace_deduct ? earlyGrace : 0;
  const adjIn = (t) => (t < start || inGraceIn(t) ? start : new Date(start.getTime() + roundUpBlock(lateOf(t) - gIn, lateBlock) * 60000));
  const adjOut = (t) => (t > end || inGraceOut(t) ? end : new Date(end.getTime() - roundUpBlock(earlyOf(t) - gOut, lateBlock) * 60000));
  const effIn = adjIn(ci);
  const effOut = adjOut(co);
  const inShift = Math.max(0, mins(effIn, effOut));
  const shiftLen = mins(start, end);
  const halfShift = Math.floor(shiftLen / 2);
  let work_minutes;
  if (pairs && pairs.length >= 2) {
    // Quy tắc "Nhiều lần vào/ra": cộng từng cặp vào–ra (kẹp trong khung ca); thời gian ra ngoài giữa các cặp
    // chính là giờ nghỉ nên KHÔNG trừ thêm nghỉ giữa ca.
    work_minutes = 0;
    const full = pairs.filter(([pi, po]) => pi && po);
    for (const [k, [pi, po]] of full.entries()) {
      let a = toMinute(pi), b = toMinute(po);
      if (k === 0) a = adjIn(a);                 // lượt vào đầu: áp số phút cho phép đi trễ
      if (k === full.length - 1) b = adjOut(b);  // lượt ra cuối: áp số phút cho phép về sớm
      const a2 = a < start ? start : a, b2 = b > end ? end : b;
      // (cài đặt pairs_fixed_break) ca có nghỉ trưa CỐ ĐỊNH giờ: phần của cặp rơi vào giờ nghỉ không phải giờ làm (HR-ERP: giao với khung sáng + khung chiều)
      work_minutes += Math.max(0, mins(a2, b2) - (pairsFixedBreak ? breakOverlap(brk, a2, b2) : 0));
    }
    // Ưu đãi "về giữa giờ / đến muộn giữa giờ": phần ra ngoài giữa các cặp (trong khung ca, ngoài giờ nghỉ của ca)
    // được bù lại tối đa midOut + midIn phút
    if (priv && (priv.midOut || priv.midIn)) {
      let gap = 0;
      for (let k = 1; k < full.length; k++) {
        const a = toMinute(full[k - 1][1]), b = toMinute(full[k][0]);
        gap += Math.max(0, mins(a < start ? start : a, b > end ? end : b));
      }
      const extra = Math.max(0, gap - (shift.break_minutes || 0));
      work_minutes += Math.min(extra, (priv.midOut || 0) + (priv.midIn || 0));
    }
  } else if (brk) {
    // Nghỉ giữa ca CỐ ĐỊNH giờ: giờ công = giờ chuẩn − đi trễ − về sớm (đều đã bỏ phần trùng giờ nghỉ)
    // VD ca 8–17 nghỉ 12–13: vào 12:19 → trễ 240' → đủ 4 tiếng chiều (như HR-ERP)
    const lateRawB = ci > start ? mins(start, ci) - breakOverlap(brk, start, ci) - privAllowIn(priv, brk, ci) : 0;
    const lateDed = lateRawB > lateGrace ? roundUpBlock(lateRawB - gIn, lateBlock) : 0;
    const earlyDed = early_min;
    const stdB = Math.max(0, shiftLen - (shift.break_minutes || 0));
    work_minutes = (ci >= end || co <= start || co <= ci) ? 0 : Math.max(0, stdB - lateDed - earlyDed);
  } else {
    const breakDed = inShift >= halfShift ? (shift.break_minutes || 0) : 0;
    work_minutes = Math.max(0, inShift - breakDed);
  }

  // Tăng ca SAU giờ tan ca: ở lại >= ngưỡng
  // (vào SAU giờ tan ca → chỉ tính từ lúc có mặt, không tính từ giờ tan ca)
  let otAfterRaw = Math.max(0, mins(ci > end ? ci : end, co));
  // Bù trừ (tùy chọn của ca): đi trễ quá dung sai thì phần ở lại sau giờ tan ca được BÙ vào giờ công
  // (tối đa bằng số phút trễ; phần dùng để bù KHÔNG tính tăng ca; giờ công không vượt giờ chuẩn của ca)
  const standard = Math.max(1, shiftLen - (shift.break_minutes || 0));
  let compensated = 0;
  if (shift.compensate_late) {
    const lateRaw = mins(start, ci);
    if (lateRaw > lateGrace && otAfterRaw > 0) {
      compensated = Math.min(lateRaw, otAfterRaw, Math.max(0, standard - work_minutes));
      work_minutes += compensated;
      otAfterRaw -= compensated;
    }
  }
  let ot_min = 0;
  const ot_parts = [];   // từng ĐOẠN tăng ca (sau ca, trước ca) → làm tròn RIÊNG từng đoạn như HR-ERP / Ronald Jack
  if (shift.allow_ot) {
    const after = shift.ot_start_after_min ?? 30;
    if (otAfterRaw >= after && otAfterRaw > 0) { ot_min += otAfterRaw; ot_parts.push(otAfterRaw); }
    // Tăng ca TRƯỚC giờ vào ca (tùy chọn): đến sớm >= ngưỡng
    // (cài đặt chung weekend_ot_before: ngày nghỉ hằng tuần đến sớm cũng là tăng ca dù ca không bật — HR-ERP Hoa Hồng)
    if (shift.ot_before || (isWeekend && weekendOtBefore)) {
      const beforeRaw = Math.max(0, mins(ci, co < start ? co : start));   // ra trước giờ vào ca → chỉ tính tới lúc ra
      if (beforeRaw > 0 && beforeRaw >= (shift.ot_before_min ?? 30)) { ot_min += beforeRaw; ot_parts.push(beforeRaw); }
    }
  }

  // Số công
  const baseUnit = shift.work_unit_value ?? 1.0;
  const factor = Math.pow(10, roundingDecimals);
  const rawUnit = baseUnit * work_minutes / standard;
  const roundFn = roundingMode === 1 ? Math.ceil : roundingMode === 2 ? Math.round : Math.floor; // 0=lùi,1=tới,2=gần nhất
  let work_unit = Math.min(baseUnit, roundFn(rawUnit * factor) / factor);

  const ot_type = isHoliday ? 'le' : isWeekend ? 'cuoi_tuan' : 'thuong';

  // "Xem cả ca là tăng ca" khi làm ca này vào ngày lễ / cuối tuần (tùy chọn của ca):
  // không tính công, toàn bộ giờ làm trong ca + giờ tăng ca → tăng ca loại lễ / cuối tuần.
  if (shiftIsOt(shift, isHoliday, isWeekend)) {
    ot_min += work_minutes;
    work_minutes = 0;
    work_unit = 0;
  }

  return { early_min, ot_min, work_minutes, work_unit, ot_type, day_status: 'lam_viec', compensated, ot_parts };
}

// Ca được xem là TĂNG CA cả ca: ca đánh dấu "ca này là ca tăng ca" (mọi ngày), hoặc làm vào ngày lễ mà ca bật tùy chọn.
// (Ngày CUỐI TUẦN = tăng ca nay theo quy tắc chung của công ty ở Cài đặt — weekendToOt — không đặt theo từng ca nữa.)
function shiftIsOt(shift, isHoliday, isWeekend) {
  return !!(shift.shift_as_ot || (isHoliday && shift.holiday_as_ot));
}

// Đi làm vào NGÀY CUỐI TUẦN (Cài đặt > Ngày cuối tuần, mặc định CN) khi bật "đi làm cuối tuần tính là tăng ca":
// toàn bộ thời gian làm thành TĂNG CA CUỐI TUẦN, không tính công thường. Ngày lễ không áp (đã có tăng ca lễ riêng).
// Báo cáo quy đổi: OT_DAY_MIN phút (8 giờ) tăng ca = 1 công.
export const OT_DAY_MIN = 480;
export function weekendToOt(c, flags = {}) {
  if (!c || !flags.weekendOt || !flags.isWeekend || flags.isHoliday) return c;
  const wm = c.work_minutes || 0;
  return { ...c, ot_min: (c.ot_min || 0) + wm, work_minutes: 0, work_unit: 0, ot_type: 'cuoi_tuan' };
}

// Chỉ có giờ VÀO, thiếu giờ RA. Mặc định 0 công (trạng thái "thiếu ra").
// Ca bật "thiếu giờ ra vẫn tính công": tính đủ giờ chuẩn của ca TRỪ phần đi trễ (vượt dung sai) — như Ronald Jack.
export function computeNoOut(shift, checkInIso, workDate, opts = {}) {
  const { isHoliday = false, isWeekend = false, roundingDecimals = 2, roundingMode = 0, lateBlock = 0, priv = null } = opts;
  const ot_type = isHoliday ? 'le' : isWeekend ? 'cuoi_tuan' : 'thuong';
  const base = { early_min: 0, ot_min: 0, work_minutes: 0, work_unit: 0, ot_type, day_status: 'thieu_ra' };
  if (!shift || !checkInIso || !shift.no_out_credit) return base;
  const { start, end } = shiftBounds(workDate, shift);
  const standard = Math.max(1, mins(start, end) - (shift.break_minutes || 0));
  const late = computeLate(shift, checkInIso, workDate, lateBlock, priv);
  const work_minutes = Math.max(0, standard - late);
  const baseUnit = shift.work_unit_value ?? 1.0;
  const factor = Math.pow(10, roundingDecimals);
  const roundFn = roundingMode === 1 ? Math.ceil : roundingMode === 2 ? Math.round : Math.floor;
  const work_unit = Math.min(baseUnit, roundFn(baseUnit * work_minutes / standard * factor) / factor);
  if (shiftIsOt(shift, isHoliday, isWeekend)) return { ...base, ot_min: work_minutes };
  return { ...base, work_minutes, work_unit };
}

// Chia số phút tăng ca NGÀY THƯỜNG thành 4 mức TC1→TC4 theo giới hạn của ca (như Ronald Jack):
// TC1 tối đa ot_tier1_min phút, tiếp theo TC2 tối đa ot_tier2_min, TC3 tối đa ot_tier3_min, còn dư → TC4.
// Giới hạn = 0 nghĩa là mức đó nhận hết phần còn lại. Ca không đặt giới hạn → tất cả là TC1.
export function splitOtTiers(otMin, shift) {
  const out = [0, 0, 0, 0];
  let left = Math.max(0, otMin || 0);
  const lim = [shift?.ot_tier1_min || 0, shift?.ot_tier2_min || 0, shift?.ot_tier3_min || 0];
  for (let i = 0; i < 3 && left > 0; i++) {
    const take = lim[i] > 0 ? Math.min(left, lim[i]) : left;
    out[i] = take; left -= take;
  }
  out[3] = left;
  return out;
}

/* ===================== GHÉP LOG MÁY → GIỜ VÀO / RA (4 quy tắc) =====================
 * Theo phần mềm mẫu ChamCongApp (Rules/*Processor.cs):
 *   filo — Vào trước, ra sau: sớm nhất/muộn nhất trong cửa sổ ca.
 *   tdhc — Phân theo giờ (như Ronald Jack): lượt quẹt trong khung vào = VÀO, trong khung ra = RA; lượt nằm ngoài cả hai khung bỏ qua.
 *   idm  — Máy lẻ vào / máy chẵn ra: VÀO = log máy lẻ sớm nhất; RA = log máy chẵn muộn nhất.
 *   tdqd — Qua đêm: cửa sổ xuyên đêm; con: pair (như filo) hoặc idm.
 *   pairs — Nhiều lần vào/ra: giờ Vào/Ra như FILO, kèm danh sách cặp (lượt 1-2, 3-4…) để tính giờ công
 *           = tổng các cặp (lượt lẻ cuối không có cặp thì bỏ).
 * punches: [{ punch_at: ISO, serial }] (đã lấy trong cửa sổ rộng). machineMap: { serial: số máy }.
 */
const HH = 3600000;

// Cửa sổ nhận log của 1 ca: [start-2h, cửa-sổ-ra-kết-thúc hoặc end+4h]. Trả kèm mốc start/end ca.
// opts.toDayEnd: ca NGÀY chạy 1 ca/ngày → nhận lượt quẹt tới HẾT NGÀY (tăng ca về rất muộn vẫn lấy được giờ ra,
// như FILO của Ronald Jack: lượt cuối cùng trong ngày là giờ ra).
export function ruleWindow(workDate, shift, opts = {}) {
  const { start, end } = shiftBounds(workDate, shift);
  let winEnd;
  if (shift.check_out_end) {
    winEnd = vnInstant(workDate, shift.check_out_end);
    if (winEnd < end) winEnd = new Date(winEnd.getTime() + 24 * HH); // cửa sổ ra qua đêm
  } else {
    winEnd = new Date(end.getTime() + 4 * HH);
  }
  const night = shift.cross_midnight || shift.end_time <= shift.start_time;
  if (opts.toDayEnd && !night && !shift.check_out_end) {   // ca đã khai "Kết thúc ra" → theo đúng khung đã khai
    const dayEnd = new Date(vnInstant(workDate, '23:59').getTime() + 59999);
    if (dayEnd > winEnd) winEnd = dayEnd;
  }
  // Nhận lượt VÀO sớm nhất: theo "Bắt đầu vào" của ca nếu có khai (như "quét trước ca" của HR-ERP);
  // không khai → có tăng ca trước ca thì sớm hơn (ca đêm 22h làm từ 18h = 4 tiếng TC trước ca, đến sớm vài phút vẫn nhận → 6 tiếng)
  let winStart;
  if (shift.check_in_start) {
    winStart = vnInstant(workDate, shift.check_in_start);
    if (winStart - start > 12 * HH) winStart = new Date(winStart.getTime() - 24 * HH);   // VD ca 00:30 nhận vào từ 22:00 hôm trước
    else if (winStart > start) winStart = start;
  } else {
    const before = shift.allow_ot && shift.ot_before ? (night ? 6 : 4) * HH : 2 * HH;
    winStart = new Date(start.getTime() - before);
  }
  // Ca NGÀY 1 ca/ngày: nhận cả lượt quẹt từ ĐẦU NGÀY (xếp Ca chiều mà đến từ 8h sáng → giờ vào là 8h, không thành "trễ 240' + thiếu ra").
  // Lượt quẹt sáng sớm là giờ ra ca đêm hôm trước đã được loại trước khi gọi (consumedByPrevDay).
  // (ca đã khai "Bắt đầu vào" → theo đúng khung đã khai, như "quét trước ca" của HR-ERP)
  if (opts.toDayEnd && !night && !shift.check_in_start) { const dayStart = vnInstant(workDate, '00:00'); if (dayStart < winStart) winStart = dayStart; }
  return { winStart, winEnd, start, end };
}

// Lịch trình có NHIỀU ca trong 1 ngày (VD Sáng / Chiều / Hành chính, hoặc ca gãy Sáng + Chiều):
// chọn bộ ca nhân viên THỰC SỰ làm theo giờ chấm, thay vì coi như làm hết mọi ca của lịch.
// Thử mọi tổ hợp ca KHÔNG chồng giờ nhau; mỗi lượt quẹt gán cho ca gần nhất trong tổ hợp (ca nào không có lượt quẹt → loại tổ hợp);
// độ lệch của 1 ca = |vào − đầu ca| + |ra − cuối ca| (thiếu giờ ra: phạt 240').
// Chọn tổ hợp lệch ít nhất; bằng nhau thì ưu tiên tổ hợp dùng NHIỀU lượt quẹt làm giờ vào/ra hơn (ca gãy 08-12 / 13-17), rồi ít ca hơn.
// Trả [{ shift, punches }] theo thứ tự giờ; punches = các lượt quẹt (object có punch_at) thuộc ca đó.
export function pickShiftSet(cands, punches, workDate) {
  const list = (cands || []).slice(0, 10).map((shift) => ({ shift, ...shiftBounds(workDate, shift) }));
  const ps = [...(punches || [])].sort((a, b) => new Date(a.punch_at) - new Date(b.punch_at));
  if (!list.length || !ps.length) return [];
  const t = (p) => toMinute(p.punch_at).getTime();
  const vnDay = (p) => new Date(new Date(p.punch_at).getTime() + 7 * HH).toISOString().slice(0, 10);   // ngày (giờ VN) của lượt quẹt
  const dayEnd = vnInstant(workDate, '00:00').getTime() + 24 * HH;   // nửa đêm cuối ngày làm việc
  let best = null;
  for (let mask = 1; mask < (1 << list.length); mask++) {
    const set = list.filter((_, i) => mask & (1 << i)).sort((a, b) => a.start - b.start);
    if (set.some((x, i) => i && x.start < set[i - 1].end)) continue;          // chồng giờ nhau → không cùng làm được
    const got = set.map(() => []);
    for (const p of ps) {
      // Lượt quẹt của NGÀY HÔM SAU chỉ thuộc ca có giờ ra sang hôm sau (ca đêm); tổ hợp không có ca đêm thì bỏ qua lượt đó
      const nextDay = vnDay(p) > workDate;
      let bi = -1, bd = Infinity;
      set.forEach((x, i) => {
        if (nextDay && !(x.end > dayEnd)) return;
        const v = t(p); const d = v >= x.start && v <= x.end ? 0 : Math.min(Math.abs(v - x.start), Math.abs(v - x.end)); if (d < bd) { bd = d; bi = i; }
      });
      if (bi >= 0) got[bi].push(p);
    }
    if (got.some((g) => !g.length)) continue;
    // Giờ VÀO của mỗi ca phải thuộc ngày này và không sớm hơn giờ vào ca quá 8 tiếng
    // (trước đây: làm ca sáng 05:52–11:33 thì lượt 05:55 sáng hôm sau bị lấy làm "vào Ca đêm" → 1 lượt dùng cho 2 ngày)
    if (got.some((g, i) => vnDay(g[0]) > workDate || t(g[0]) < set[i].start - 8 * HH)) continue;
    let dev = 0, used = 0;
    set.forEach((x, i) => {
      const g = got[i], a = t(g[0]), b = g.length > 1 ? t(g[g.length - 1]) : null;
      dev += Math.abs(a - x.start) / 60000 + (b == null ? 240 : Math.abs(b - x.end) / 60000);
      used += b == null ? 1 : 2;
    });
    const score = [dev, -used, set.length];
    if (!best || score[0] < best.score[0] - 1e-9 || (Math.abs(score[0] - best.score[0]) < 1e-9 && (score[1] < best.score[1] || (score[1] === best.score[1] && score[2] < best.score[2]))))
      best = { score, out: set.map((x, i) => ({ shift: x.shift, punches: got[i] })) };
  }
  return best ? best.out : [];
}

export function mergeDayPunches(punches, shift, rule, machineMap = {}, workDate, opts = {}) {
  if (!punches || !punches.length || !shift) {
    const s = (punches || []).map((p) => p.punch_at).sort();
    return { inIso: s[0] || null, outIso: s.length > 1 ? s[s.length - 1] : null };
  }
  rule = rule || 'filo';
  const at = (p) => new Date(p.punch_at);
  const all = [...punches].sort((a, b) => at(a) - at(b));
  const { winStart, winEnd, start, end } = ruleWindow(workDate, shift, opts);
  const inWin = all.filter((p) => at(p) >= winStart && at(p) <= winEnd);
  const iso = (p) => (p ? p.punch_at : null);
  // ngưỡng quẹt lặp: lượt ra phải cách lượt vào ít nhất chừng này. NV có "Lịch trình vào ra" → dupMin là { min, gap, max }
  // (lấy `min` = thời gian vào–ra nhỏ nhất); trước đây Number(object) = NaN → 0 nên quẹt 08:00 + 08:03 thành 1 cặp làm 3 phút
  const dupRaw = opts.dupMin && typeof opts.dupMin === 'object' ? (opts.dupMin.min ?? opts.dupMin.gap) : opts.dupMin;
  const dupMs = Math.max(0, Number(dupRaw) || 0) * 60000;

  // IDM (hoặc TĐ-QĐ/idm): máy lẻ = VÀO sớm nhất, máy chẵn = RA muộn nhất
  const useIdm = rule === 'idm' || (rule === 'tdqd' && (shift.tdqd_mode || 'pair') === 'idm');
  if (useIdm) {
    const mnum = (p) => machineMap[p.serial] || 0;
    const ins = inWin.filter((p) => mnum(p) % 2 === 1);
    const outs = inWin.filter((p) => mnum(p) % 2 === 0);
    return { inIso: iso(ins[0] || null), outIso: iso(outs.length ? outs[outs.length - 1] : null) };
  }

  // "Chọn từ máy": VÀO/RA theo phím trạng thái nhân viên bấm trên máy (0 Check-In, 3 Break-In, 4 OT-In = VÀO; 1 Check-Out, 2 Break-Out, 5 OT-Out = RA)
  if (rule === 'state') {
    const st = (p) => Number(p.status) || 0;
    const ins = inWin.filter((p) => [0, 3, 4].includes(st(p)));
    const outs = inWin.filter((p) => [1, 2, 5].includes(st(p)));
    return { inIso: iso(ins[0] || null), outIso: iso(outs.length ? outs[outs.length - 1] : null) };
  }

  // Phân theo giờ: VÀO = lượt đầu trong khung vào; RA = lượt CUỐI trong khung ra (sau giờ vào).
  // Lượt nằm ngoài cả 2 khung (VD ra ăn trưa 12h) bỏ qua — trước đây lấy "lượt kế tiếp" nên quẹt trưa làm mất giờ ra.
  if (rule === 'tdhc') {
    let ci;
    if (shift.check_in_start && shift.check_in_end) {
      const cs = vnInstant(workDate, shift.check_in_start);
      let ce = vnInstant(workDate, shift.check_in_end);
      if (ce < cs) ce = new Date(ce.getTime() + 24 * HH);
      ci = all.find((p) => at(p) >= cs && at(p) <= ce);
    } else ci = inWin[0];
    if (!ci) return { inIso: null, outIso: null };
    let cos, coe;
    if (shift.check_out_start && shift.check_out_end) {
      cos = vnInstant(workDate, shift.check_out_start);
      coe = vnInstant(workDate, shift.check_out_end);
      if (coe < cos) coe = new Date(coe.getTime() + 24 * HH);
    } else { cos = new Date(end.getTime() - HH); coe = new Date(end.getTime() + 8 * HH); }
    const outs = all.filter((p) => at(p) - at(ci) >= dupMs && at(p) > at(ci) && at(p) >= cos && at(p) <= coe);
    return { inIso: iso(ci), outIso: outs.length ? iso(outs[outs.length - 1]) : null };
  }

  // FILO (mặc định) & TĐ-QĐ/pair: sớm nhất VÀO, muộn nhất RA trong cửa sổ
  const ci = inWin[0];
  if (!ci) return { inIso: null, outIso: null };
  let co = inWin.length > 1 ? inWin[inWin.length - 1] : null;
  if (co && at(co) - at(ci) < dupMs) co = null;   // cả ngày chỉ 1 cụm quẹt lặp → vẫn là thiếu giờ ra
  const res = { inIso: iso(ci), outIso: iso(co && co !== ci ? co : null) };
  if (rule === 'pairs') {
    res.pairs = punchPairs(inWin.map((p) => p.punch_at), opts.dupMin);
    // (cài đặt pairs_fixed_break) Ca có nghỉ trưa CỐ ĐỊNH và số lần quẹt LẺ (3, 5…): HR-ERP không ghép cặp mà lấy đầu → cuối trừ giờ nghỉ
    if (opts.pairsFixedBreak && shift.break_start && inWin.length >= 3 && inWin.length % 2 === 1) res.pairs = null;
  }
  return res;
}

// Bỏ lượt QUẸT LẶP: lượt cách lượt hợp lệ ngay trước dưới dupMin phút thì bỏ (giữ lượt đầu).
// Giống "thời gian nhỏ nhất / khoảng cách giữa 2 cặp vào ra" của Ronald Jack — nếu không lọc, một lần quẹt 2 phát
// (08:00, 08:02) sẽ bị ghép thành 1 cặp vào–ra 2 phút và làm LỆCH toàn bộ các cặp phía sau.
export const PAIR_DUP_DEFAULT = 5;
export function dropRepeatPunches(isoList, dupMin = PAIR_DUP_DEFAULT) {
  const gap = Math.max(1, Number(dupMin) || PAIR_DUP_DEFAULT) * 60000;
  const ts = [...(isoList || [])].filter(Boolean).sort();
  const out = [];
  for (const t of ts) if (!out.length || new Date(t) - new Date(out[out.length - 1]) >= gap) out.push(t);
  return out;
}
// Chia lượt quẹt thành cặp vào–ra theo đúng cách của Ronald Jack ("Lịch trình vào ra"):
//   lượt 1 = VÀO, lượt kế = RA, rồi lại VÀO…; lượt lẻ cuối không có cặp → bỏ.
//   - RA cách VÀO dưới `min` phút  → coi là quẹt lặp, bỏ (vẫn chờ lượt RA thật)
//   - VÀO mới cách RA trước dưới `gap` phút → quẹt lặp, bỏ
//   - cặp dài hơn `max` phút (quên quẹt ra) → bỏ lượt VÀO cũ, lấy lượt này làm VÀO mới
// opt: số phút (dùng chung cho min và gap) HOẶC { min, gap, max }.
export function punchPairs(isoList, opt = PAIR_DUP_DEFAULT) {
  const o = opt && typeof opt === 'object' ? opt : { min: opt, gap: opt };
  const min = Math.max(1, Number(o.min) || PAIR_DUP_DEFAULT) * 60000;
  const gap = Math.max(1, Number(o.gap) || PAIR_DUP_DEFAULT) * 60000;
  const maxMs = Number(o.max) > 0 ? Number(o.max) * 60000 : Infinity;
  const ts = [...(isoList || [])].filter(Boolean).sort();
  const out = [];
  let inT = null, lastOut = null;
  for (const t of ts) {
    const x = new Date(t).getTime();
    // quẹt lặp ngay sau lượt RA → lấy lượt CUỐI của cụm làm giờ ra (17:59, 18:00 → ra 18:00)
    if (inT == null) { if (lastOut != null && x - lastOut < gap) { out[out.length - 1][1] = t; continue; } inT = t; continue; }
    const d = x - new Date(inT).getTime();
    if (d < min) continue;
    if (d > maxMs) { inT = t; continue; }
    out.push([inT, t]); lastOut = x; inT = null;
  }
  return out;
}

// Tổng phút của các cặp vào–ra (chế độ theo giờ, quy tắc "theo cặp")
export function sumPairsMinutes(pairs) {
  let m = 0;
  for (const [a, b] of pairs || []) if (a && b) m += Math.max(0, mins(toMinute(a), toMinute(b)));
  return m;
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
