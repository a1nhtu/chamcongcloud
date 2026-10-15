// "Bảng theo dõi chấm công" — 6 dòng / người / ngày: Vào 1 · Ra 1 · Vào 2 · Ra 2 · Giờ HC · Giờ TC (mẫu khách chấm 4 lần/ngày, VD Hoa Hồng).
// Thuần hàm (không CSDL) để test; reports.js gọi để dựng từng ô ngày.
import { realFourTimes } from './k-times.js';

// Nhãn 6 dòng theo thứ tự
export const TRACK_ROWS = [['v1', 'Vào 1'], ['r1', 'Ra 1'], ['v2', 'Vào 2'], ['r2', 'Ra 2'], ['hc', 'Giờ HC'], ['tc', 'Giờ TC']];

const hhmm = (ms) => (ms == null || !Number.isFinite(ms) ? '' : new Date(ms + 7 * 3600e3).toISOString().slice(11, 16));
const round2 = (n) => Math.round((n || 0) * 100) / 100;

/**
 * 4 mốc giờ của 1 ô NV × ngày (ms hoặc null):
 *  - công ảo (virt): Vào 1 = giờ vào ảo, Ra 1 / Vào 2 = giờ trưa ảo kiểu K (k_ra / k_vao; không bật K → trống, không lộ lượt thật), Ra 2 = giờ ra ảo
 *  - công thật: từ các lượt quẹt thật trong ngày (4 lần = Đến, Ra, Vào, Về; số lần khác 4: Ra = Vào như HR-ERP; 2 lần: chỉ Đến + Về)
 *    không có lượt quẹt (chấm điện thoại / sửa tay) → giờ vào / ra của dòng công
 * c: ô công (check_in_at, check_out_at, k_ra, k_vao) · punches: các lượt quẹt thật (ms) · breakStart: giờ bắt đầu nghỉ trưa (ms, hoặc null)
 */
export function trackTimes({ virt, c, punches, breakStart }) {
  const ms = (iso) => (iso ? Date.parse(iso) : null);
  if (virt) return { v1: ms(c && c.check_in_at), r1: ms(c && c.k_ra), v2: ms(c && c.k_vao), r2: ms(c && c.check_out_at) };
  if (punches && punches.length) {
    const t = realFourTimes(punches, breakStart);
    return { v1: t.den, r1: t.ra, v2: t.vao, r2: t.ve };
  }
  return { v1: ms(c && c.check_in_at), r1: null, v2: null, r2: ms(c && c.check_out_at) };
}

/**
 * Giá trị 6 dòng của 1 ngày: { v1, r1, v2, r2 : 'HH:MM', hc, tc : giờ (số) }.
 * leaveSym: ký hiệu nghỉ khi không có ô công (hiện ở dòng Vào 1). Ngày nghỉ hằng tuần: Giờ HC = 0, Giờ TC = giờ tăng ca.
 */
export function trackCell({ virt, c, punches, breakStart, leaveSym }) {
  if (!c || !c.check_in_at) return { v1: leaveSym || '', r1: '', v2: '', r2: '', hc: '', tc: '' };
  const t = trackTimes({ virt, c, punches, breakStart });
  return { v1: hhmm(t.v1), r1: hhmm(t.r1), v2: hhmm(t.v2), r2: hhmm(t.r2), hc: round2((c.work_minutes || 0) / 60), tc: round2((c.ot_min || 0) / 60) };
}
