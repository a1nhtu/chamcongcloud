// Chặn tăng ca theo ĐĂNG KÝ LÀM THÊM — phần thuần (không tự mở CSDL) để day-metrics dùng. Xem server/ot-reg.js.
// Số phút tăng ca được tính từ thực tế `raw` + đăng ký `reg` (null = không đăng ký)
export const capOt = (raw, reg, required) => (reg == null ? (required ? 0 : raw) : Math.min(raw, reg));

// Hàm chặn dùng trong lúc tính công (nạp cài đặt 1 lần cho cả mẻ): (empId, ngày, phút thực tế) → phút được tính
export function otRegCapper(database, getS) {
  const required = getS('ot_reg_required', '0') === '1';
  let st = null, dead = false;
  return (empId, workDate, raw) => {
    if (dead || !raw) return raw;
    try { st ||= database.prepare('SELECT minutes FROM ot_registrations WHERE employee_id=? AND work_date=?'); }
    catch { dead = true; return raw; }   // CSDL chưa có bảng (bản cũ / bài test) → như chưa đăng ký
    const r = st.get(empId, workDate);
    return capOt(raw, r ? r.minutes : null, required);
  };
}
