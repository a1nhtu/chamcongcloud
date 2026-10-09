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

// Tính đi muộn (phút) khi VÀO ca.
// Dung sai (late_grace_min) chỉ là NGƯỠNG: trễ trong ngưỡng → bỏ qua (0);
// vượt ngưỡng → ghi ĐÚNG số phút trễ thực tế (KHÔNG trừ dung sai).
export function computeLate(shift, checkInIso, workDate) {
  if (!shift || !checkInIso) return 0;
  const { start } = shiftBounds(workDate, shift);
  const raw = mins(start, new Date(checkInIso));
  const grace = shift.late_grace_min || 0;
  return raw > grace ? raw : 0;
}

function roundOt(minutes, unit) {
  if (!unit || unit <= 0) return minutes;
  return Math.floor(minutes / unit) * unit; // làm tròn xuống theo đơn vị
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
  const { isHoliday = false, isWeekend = false, roundingDecimals = 2, roundingMode = 0, pairs = null } = opts;
  const ci = new Date(checkInIso);
  const co = new Date(checkOutIso);
  const { start, end } = shiftBounds(workDate, shift);

  // Về sớm — cùng cách với đi muộn: dung sai chỉ là NGƯỠNG; vượt ngưỡng → ghi ĐỦ số phút về sớm thực tế
  const earlyRaw = mins(co, end);
  const earlyGrace = shift.early_grace_min ?? 15;
  const early_min = earlyRaw > earlyGrace ? earlyRaw : 0;

  // Trễ/sớm NẰM TRONG dung sai thì coi như đúng giờ: KHÔNG trừ giờ công (giống Ronald Jack/WiseEye:
  // giờ = giờ ca − phút trễ − phút sớm đã tính). Vượt dung sai → trừ đủ.
  const lateGrace = shift.late_grace_min || 0;
  const inGraceIn = (t) => { const raw = mins(start, t); return raw > 0 && raw <= lateGrace; };
  const inGraceOut = (t) => { const raw = mins(t, end); return raw > 0 && raw <= earlyGrace; };

  // Giờ công thực: kẹp trong khung ca, trừ nghỉ giữa ca nếu có mặt >= nửa ca
  const effIn = ci < start || inGraceIn(ci) ? start : ci;
  const effOut = co > end || inGraceOut(co) ? end : co;
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
      let a = new Date(pi), b = new Date(po);
      if (k === 0 && inGraceIn(a)) a = start;                 // lượt vào đầu trễ trong dung sai
      if (k === full.length - 1 && inGraceOut(b)) b = end;    // lượt ra cuối sớm trong dung sai
      work_minutes += Math.max(0, mins(a < start ? start : a, b > end ? end : b));
    }
  } else {
    const breakDed = inShift >= halfShift ? (shift.break_minutes || 0) : 0;
    work_minutes = Math.max(0, inShift - breakDed);
  }

  // Tăng ca SAU giờ tan ca: ở lại >= ngưỡng
  let otAfterRaw = Math.max(0, mins(end, co));
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
  if (shift.allow_ot) {
    const after = shift.ot_start_after_min ?? 30;
    if (otAfterRaw >= after && otAfterRaw > 0) ot_min += roundOt(otAfterRaw, shift.ot_rounding_unit || 0);
    // Tăng ca TRƯỚC giờ vào ca (tùy chọn): đến sớm >= ngưỡng
    if (shift.ot_before) {
      const beforeRaw = Math.max(0, mins(ci, start));
      if (beforeRaw > 0 && beforeRaw >= (shift.ot_before_min ?? 30)) ot_min += roundOt(beforeRaw, shift.ot_rounding_unit || 0);
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
  if ((isHoliday && shift.holiday_as_ot) || (!isHoliday && isWeekend && shift.weekend_as_ot)) {
    ot_min += work_minutes;
    work_minutes = 0;
    work_unit = 0;
  }

  return { early_min, ot_min, work_minutes, work_unit, ot_type, day_status: 'lam_viec', compensated };
}

// Chỉ có giờ VÀO, thiếu giờ RA. Mặc định 0 công (trạng thái "thiếu ra").
// Ca bật "thiếu giờ ra vẫn tính công": tính đủ giờ chuẩn của ca TRỪ phần đi trễ (vượt dung sai) — như Ronald Jack.
export function computeNoOut(shift, checkInIso, workDate, opts = {}) {
  const { isHoliday = false, isWeekend = false, roundingDecimals = 2, roundingMode = 0 } = opts;
  const ot_type = isHoliday ? 'le' : isWeekend ? 'cuoi_tuan' : 'thuong';
  const base = { early_min: 0, ot_min: 0, work_minutes: 0, work_unit: 0, ot_type, day_status: 'thieu_ra' };
  if (!shift || !checkInIso || !shift.no_out_credit) return base;
  const { start, end } = shiftBounds(workDate, shift);
  const standard = Math.max(1, mins(start, end) - (shift.break_minutes || 0));
  const late = computeLate(shift, checkInIso, workDate);
  const work_minutes = Math.max(0, standard - late);
  const baseUnit = shift.work_unit_value ?? 1.0;
  const factor = Math.pow(10, roundingDecimals);
  const roundFn = roundingMode === 1 ? Math.ceil : roundingMode === 2 ? Math.round : Math.floor;
  const work_unit = Math.min(baseUnit, roundFn(baseUnit * work_minutes / standard * factor) / factor);
  if ((isHoliday && shift.holiday_as_ot) || (!isHoliday && isWeekend && shift.weekend_as_ot))
    return { ...base, ot_min: work_minutes };
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
 *   tdhc — Theo cửa sổ thời gian: VÀO trong cửa sổ vào; RA = log kế tiếp, phải nằm trong cửa sổ ra.
 *   idm  — Máy lẻ vào / máy chẵn ra: VÀO = log máy lẻ sớm nhất; RA = log máy chẵn muộn nhất.
 *   tdqd — Qua đêm: cửa sổ xuyên đêm; con: pair (như filo) hoặc idm.
 *   pairs — Nhiều lần vào/ra: giờ Vào/Ra như FILO, kèm danh sách cặp (lượt 1-2, 3-4…) để tính giờ công
 *           = tổng các cặp (lượt lẻ cuối không có cặp thì bỏ).
 * punches: [{ punch_at: ISO, serial }] (đã lấy trong cửa sổ rộng). machineMap: { serial: số máy }.
 */
const HH = 3600000;

// Cửa sổ nhận log của 1 ca: [start-2h, cửa-sổ-ra-kết-thúc hoặc end+4h]. Trả kèm mốc start/end ca.
export function ruleWindow(workDate, shift) {
  const { start, end } = shiftBounds(workDate, shift);
  let winEnd;
  if (shift.check_out_end) {
    winEnd = vnInstant(workDate, shift.check_out_end);
    if (winEnd < end) winEnd = new Date(winEnd.getTime() + 24 * HH); // cửa sổ ra qua đêm
  } else {
    winEnd = new Date(end.getTime() + 4 * HH);
  }
  const before = shift.allow_ot && shift.ot_before ? 4 * HH : 2 * HH;   // có tăng ca trước giờ vào → nhận log sớm hơn
  return { winStart: new Date(start.getTime() - before), winEnd, start, end };
}

export function mergeDayPunches(punches, shift, rule, machineMap = {}, workDate) {
  if (!punches || !punches.length || !shift) {
    const s = (punches || []).map((p) => p.punch_at).sort();
    return { inIso: s[0] || null, outIso: s.length > 1 ? s[s.length - 1] : null };
  }
  rule = rule || 'filo';
  const at = (p) => new Date(p.punch_at);
  const all = [...punches].sort((a, b) => at(a) - at(b));
  const { winStart, winEnd, start, end } = ruleWindow(workDate, shift);
  const inWin = all.filter((p) => at(p) >= winStart && at(p) <= winEnd);
  const iso = (p) => (p ? p.punch_at : null);

  // IDM (hoặc TĐ-QĐ/idm): máy lẻ = VÀO sớm nhất, máy chẵn = RA muộn nhất
  const useIdm = rule === 'idm' || (rule === 'tdqd' && (shift.tdqd_mode || 'pair') === 'idm');
  if (useIdm) {
    const mnum = (p) => machineMap[p.serial] || 0;
    const ins = inWin.filter((p) => mnum(p) % 2 === 1);
    const outs = inWin.filter((p) => mnum(p) % 2 === 0);
    return { inIso: iso(ins[0] || null), outIso: iso(outs.length ? outs[outs.length - 1] : null) };
  }

  // TĐ-HC: VÀO trong cửa sổ vào; RA = log KẾ TIẾP, phải nằm trong cửa sổ ra (nếu lệch → bỏ RA)
  if (rule === 'tdhc') {
    let ci;
    if (shift.check_in_start && shift.check_in_end) {
      const cs = vnInstant(workDate, shift.check_in_start);
      let ce = vnInstant(workDate, shift.check_in_end);
      if (ce < cs) ce = new Date(ce.getTime() + 24 * HH);
      ci = all.find((p) => at(p) >= cs && at(p) <= ce);
    } else ci = inWin[0];
    if (!ci) return { inIso: null, outIso: null };
    const co = all.find((p) => at(p) > at(ci));
    if (!co) return { inIso: iso(ci), outIso: null };
    let cos, coe;
    if (shift.check_out_start && shift.check_out_end) {
      cos = vnInstant(workDate, shift.check_out_start);
      coe = vnInstant(workDate, shift.check_out_end);
      if (coe < cos) coe = new Date(coe.getTime() + 24 * HH);
    } else { cos = new Date(end.getTime() - HH); coe = new Date(end.getTime() + 8 * HH); }
    if (at(co) < cos || at(co) > coe) return { inIso: iso(ci), outIso: null };
    return { inIso: iso(ci), outIso: iso(co) };
  }

  // FILO (mặc định) & TĐ-QĐ/pair: sớm nhất VÀO, muộn nhất RA trong cửa sổ
  const ci = inWin[0];
  if (!ci) return { inIso: null, outIso: null };
  const co = inWin.length > 1 ? inWin[inWin.length - 1] : null;
  const res = { inIso: iso(ci), outIso: iso(co && co !== ci ? co : null) };
  if (rule === 'pairs') res.pairs = punchPairs(inWin.map((p) => p.punch_at));
  return res;
}

// Chia lượt quẹt thành cặp vào–ra: bỏ lượt trùng trong 1 phút, ghép (1,2), (3,4)…; lượt lẻ cuối không có cặp → bỏ.
export function punchPairs(isoList) {
  const ts = [...(isoList || [])].filter(Boolean).sort();
  const uniq = [];
  for (const t of ts) if (!uniq.length || new Date(t) - new Date(uniq[uniq.length - 1]) >= 60000) uniq.push(t);
  const out = [];
  for (let i = 0; i + 1 < uniq.length; i += 2) out.push([uniq[i], uniq[i + 1]]);
  return out;
}

// Tổng phút của các cặp vào–ra (chế độ theo giờ, quy tắc "theo cặp")
export function sumPairsMinutes(pairs) {
  let m = 0;
  for (const [a, b] of pairs || []) if (a && b) m += Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000));
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
