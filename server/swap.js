// LÀM BÙ (hoán đổi ngày làm việc) + NGHỈ BÙ LỄ — phần thuần (không tự mở CSDL) để day-metrics / báo cáo dùng chung.
//  · Làm bù: NV đi làm vào ngày nghỉ (VD chủ nhật) để nghỉ 1 ngày thường khác (VD thứ 2) — bảng swap_days.
//      ngày LÀM bù  → tính như ngày thường (1 công, 100%; chỉ phần vượt giờ ca mới là tăng ca thường)
//      ngày NGHỈ bù → đơn nghỉ loại "Nghỉ bù" (ký hiệu NB) tự sinh, không cộng thêm công (công đã tính ở ngày làm bù)
//  · Nghỉ bù lễ (public_holidays.kind = 'bu'): lễ trùng ngày nghỉ hằng tuần → nghỉ bù vào ngày làm việc kế tiếp.
//      nghỉ đúng ngày đó → như nghỉ lễ; đi làm → bản chất là ngày nghỉ hằng tuần: cả ngày là tăng ca hệ số ngày nghỉ (200%).
export const SWAP_LEAVE = 'Nghỉ bù';

// Tra loại ngày cho CẢ MỘT MẺ tính công (nạp ngày lễ ngay, ngày làm bù nạp khi cần)
export function dayRules(database) {
  let hol = null, swap = null;
  const holOf = (d) => {
    if (!hol) {
      try { hol = new Map(database.prepare('SELECT holiday_date, kind FROM public_holidays').all().map((r) => [r.holiday_date, r.kind === 'bu' ? 'bu' : 'le'])); }
      catch { hol = new Map(database.prepare('SELECT holiday_date FROM public_holidays').all().map((r) => [r.holiday_date, 'le'])); }   // CSDL bản cũ chưa có cột kind
    }
    return hol.get(d) || '';
  };
  return {
    isHoliday: (d) => holOf(d) === 'le',
    isCompOff: (d) => holOf(d) === 'bu',
    isSwapWork: (empId, d) => {
      if (!empId) return false;
      if (!swap) { try { swap = new Set(database.prepare('SELECT employee_id, work_date FROM swap_days').all().map((r) => r.employee_id + '|' + r.work_date)); } catch { swap = new Set(); } }
      return swap.has(empId + '|' + d);
    },
  };
}
