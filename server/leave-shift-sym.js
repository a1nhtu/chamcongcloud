// BẢNG MÃ KIỂU MAY MẶC — công tắc leave_sym_shift, mặc định TẮT (khách may Hualida, bảng công tháng 11/2026 của họ):
//  · ngày VỪA LÀM VỪA NGHỈ (nghỉ nửa ngày / theo giờ): mã ca + ký hiệu nghỉ, VD làm ca HC 7 giờ + phép năm → "HCPN",
//    ca đêm D + phép bệnh → "DPB". Nghỉ CẢ NGÀY vẫn chỉ hiện ký hiệu nghỉ ("PN") như cũ.
//  · Bảng công theo mã ca (báo cáo shiftcode): làm ngày nghỉ hằng tuần → mã ca + "k" (HCk), nghỉ hằng tuần "L", lễ "NL".
// Chỉ đổi CHỮ hiển thị; đếm ngày nghỉ, cột theo loại nghỉ, giờ công, tăng ca không đổi.
import { getSetting } from './db.js';

export const leaveShiftSymOn = () => getSetting('leave_sym_shift', '0') === '1';

// Ngày có làm (giờ công / tăng ca / có chấm vào) → mới ghép mã ca
export const workedCell = (c) => !!(c && ((c.work_minutes || 0) > 0 || (c.ot_min || 0) > 0));

// Ghép: "HC" + "PN" → "HCPN"; không có mã ca → ký hiệu nghỉ giữ nguyên
export const joinLeaveSym = (code, sym) => {
  const c = String(code || '').trim();
  return c && sym ? c + sym : sym;
};
