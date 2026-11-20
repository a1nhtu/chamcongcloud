// Chặn tăng ca theo ĐĂNG KÝ LÀM THÊM — phần thuần (không tự mở CSDL) để day-metrics dùng. Xem server/ot-reg.js.
import { lunchOtMinutes } from './attendance-calc.js';
// Số phút tăng ca được tính từ thực tế `raw` + đăng ký `reg` (null = không đăng ký).
// `brk` = phút GIỜ NGHỈ GIỮA CA có mặt của ca bật "tăng ca trưa": chỉ khi CÓ đăng ký mới được dùng để bù phần đăng ký còn thiếu
// (raw + brk, không quá số đăng ký). Không đăng ký → giờ nghỉ không bao giờ thành tăng ca.
export const capOt = (raw, reg, required, brk = 0) => (reg == null ? (required ? 0 : raw) : Math.min(raw + (brk > 0 ? brk : 0), reg));

// TĂNG CA TRƯA THEO GIỜ ĐĂNG KÝ (công tắc ot_lunch_reg, mặc định TẮT). Trả null khi công tắc TẮT → nơi gọi tính y như cũ
// (giờ nghỉ có mặt bù phần đăng ký — ca bật break_ot). BẬT: tăng ca trưa CHỈ lấy theo khung giờ đã đăng ký (lunchOtMinutes),
// cộng thêm vào tăng ca được tính; giờ nghỉ không còn dùng để bù số phút đăng ký làm thêm ngoài ca.
// Hàm trả về: (empId, ngày, ca, giờ vào, giờ ra, trạng thái ngày) → phút tăng ca trưa (0 = ngày không đăng ký trưa).
export function otLuncher(database, getS) {
  if (getS('ot_lunch_reg', '0') !== '1') return null;
  let stReg = null, stPunch = null, dead = false;
  return (empId, workDate, shift, inIso, outIso, dayStatus) => {
    if (dead || !empId || !shift || !inIso || !outIso || dayStatus !== 'lam_viec') return 0;
    try {
      stReg ||= database.prepare('SELECT from_hm, to_hm FROM ot_lunch_reg WHERE employee_id=? AND work_date=?');
      stPunch ||= database.prepare('SELECT punch_at FROM device_punches WHERE employee_id=? AND punch_at>=? AND punch_at<=? ORDER BY punch_at');
    } catch { dead = true; return 0; }   // CSDL chưa có bảng (bản cũ / bài test) → như chưa đăng ký
    const r = stReg.get(empId, workDate);
    if (!r) return 0;
    const p = stPunch.all(empId, new Date(inIso).toISOString(), new Date(outIso).toISOString()).map((x) => x.punch_at);
    return lunchOtMinutes(shift, workDate, inIso, outIso, r.from_hm, r.to_hm, p);
  };
}

// Hàm chặn dùng trong lúc tính công (nạp cài đặt 1 lần cho cả mẻ): (empId, ngày, phút thực tế) → phút được tính
export function otRegCapper(database, getS) {
  const required = getS('ot_reg_required', '0') === '1';
  let st = null, dead = false;
  return (empId, workDate, raw, brk = 0) => {
    if (dead || (!raw && !(brk > 0))) return raw;
    try { st ||= database.prepare('SELECT minutes FROM ot_registrations WHERE employee_id=? AND work_date=?'); }
    catch { dead = true; return raw; }   // CSDL chưa có bảng (bản cũ / bài test) → như chưa đăng ký
    const r = st.get(empId, workDate);
    return capOt(raw, r ? r.minutes : null, required, brk);
  };
}
