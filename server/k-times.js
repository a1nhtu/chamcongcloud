// Giờ ĐẾN – RA (trưa) – VÀO (sau trưa) kiểu "công khách K" của HR-ERP (khách Hoa Hồng: sphrmvn_TimeKeepingForPart_K).
// Thuần hàm, KHÔNG đụng CSDL → test được. Dùng bởi virtual-att.js khi bật "Giờ trưa & đi trễ kiểu K" cho một mức công ảo.
// Mọi mốc là mili-giây (epoch). Số ngẫu nhiên CỐ ĐỊNH theo NV + ngày + mức (xem lại / in lại vẫn ra đúng giờ đó).

// Bộ sinh số "ngẫu nhiên" cố định từ seed: rnd(n) → 0 … n-1
export function seededRnd(seed) {
  let h = seed >>> 0;
  return (n) => { h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return Math.floor(h / 4294967296 * n); };
}
export const kSeed = (empId, workDate, level) => ((empId * 2654435761) + (Date.parse(workDate + 'T12:00:00Z') / 86400000) * 40503 + level * 131 + 7) >>> 0;

const mn = (t) => Math.floor(t / 60000);   // HR-ERP so theo PHÚT TRÒN (DATEDIFF(MINUTE…))

/**
 * spec: { start, breakStart, breakEnd, den, ra, vao }  (ms; thiếu = null)
 * K:    { early, lateMax, outGap, inGap }  (phút; 0 = tắt riêng quy tắc đó)
 * Trả { den, ra, vao, lateHidden } — giá trị không đổi thì giữ nguyên.
 *  - ĐẾN: thật sớm từ `early` phút trở lên HOẶC trễ 1…`lateMax` phút → hiện 1…14 phút trước giờ vào ca (cộng số giây lẻ); trễ hơn `lateMax` giữ thật.
 *         lateHidden = true khi là trường hợp ĐI TRỄ được che (nơi gọi trả lại phút trễ vào giờ công).
 *  - RA:   thật muộn hơn giờ bắt đầu nghỉ từ `outGap` phút trở lên → hiện 0…11 phút sau giờ bắt đầu nghỉ.
 *  - VÀO:  thật sớm hơn giờ hết nghỉ quá `inGap` phút → hiện trong 5 phút cuối của giờ nghỉ (12:55–13:00 với nghỉ tới 13:00); vào muộn hơn thì giữ thật.
 */
export function kDayTimes(spec, K, seed) {
  const { start, breakStart, breakEnd } = spec;
  let { den, ra, vao } = spec;
  let lateHidden = false;
  const r = seededRnd(seed);
  if (den != null && start != null) {
    const early = mn(start) - mn(den), late = mn(den) - mn(start);
    const hideEarly = K.early > 0 && early >= K.early;
    const hideLate = K.lateMax > 0 && late >= 1 && late <= K.lateMax;
    if (hideEarly || hideLate) { den = start - (1 + r(14)) * 60000 + r(60) * 1000; lateHidden = hideLate; }
  }
  if (ra != null && breakStart != null && K.outGap > 0 && mn(ra) - mn(breakStart) >= K.outGap) ra = breakStart + r(12) * 60000 + r(60) * 1000;
  if (vao != null && breakEnd != null && K.inGap > 0 && mn(breakEnd) - mn(vao) > K.inGap) vao = breakEnd - r(6) * 60000 + r(60) * 1000;
  return { den, ra, vao, lateHidden };
}

/**
 * Từ các lượt quẹt thật trong ngày (ms, đã sắp xếp) → { den, ra, vao, ve } như HR-ERP:
 *  - 4 lần: Đến, Ra, Vào, Về. Số lần khác 4: Ra = Vào = lượt đầu tiên từ giờ bắt đầu nghỉ trở đi (HR-ERP gán Ra = Vào); không có lượt giữa → Ra / Vào trống.
 */
export function realFourTimes(punches, breakStart) {
  const p = [...punches].sort((a, b) => a - b).filter((t, i, a) => i === 0 || t - a[i - 1] >= 1000);
  if (!p.length) return { den: null, ra: null, vao: null, ve: null };
  const den = p[0], ve = p.length > 1 ? p[p.length - 1] : null;
  const mids = p.slice(1, p.length - 1);
  let ra = null, vao = null;
  if (mids.length === 2) { ra = mids[0]; vao = mids[1]; }
  else if (mids.length > 0) { const m = (breakStart != null ? mids.find((t) => t >= breakStart) : null) ?? mids[0]; ra = m; vao = m; }
  return { den, ra, vao, ve };
}
