// DẤU * "giờ sửa / thêm bằng tay" nằm cạnh ĐÚNG ô giờ vào / giờ ra được sửa (khách mythuatlt 25/11/2026: thêm / sửa giờ ra 17:30
// mà * hiện cạnh giờ vào 06:47 quẹt máy).
// Giờ là "thật" khi trùng PHÚT với 1 lượt quẹt máy / chấm điện thoại (không phải lượt thêm tay TAY_*); giờ không trùng lượt thật nào là
// giờ sửa / thêm tay. Đúng cho mọi đường sửa: Thêm giờ (lượt TAY_*), nút Sửa / gõ thẳng ô (dòng manual — không lưu ô nào đổi, giây bị
// cắt về :00) và cả dữ liệu sửa từ trước. Giờ ra sáng hôm sau nằm ở ngày khác → hỏi theo giờ, không theo ngày.
import { db } from './db.js';

// Gọi 1 lần cho mỗi yêu cầu (chế độ nhiều công ty: CSDL theo công ty đang phục vụ — không giữ câu lệnh đã prepare giữa các yêu cầu).
// Trả hàm (dòng công { employee_id, work_date, check_in_at, check_out_at }) → { man_in, man_out } (0/1).
// Ngày không có lượt quẹt thật nào (chỉ chấm điện thoại / chỉ nhập tay) hoặc cả 2 giờ đều trùng lượt thật → không rõ ô nào → 0/0
// (giao diện để * cạnh giờ vào như cũ).
export function handMarker() {
  const realMin = db.prepare("SELECT 1 FROM att_punches WHERE employee_id=? AND punch_at>=? AND punch_at<? AND serial NOT LIKE 'TAY\\_%' ESCAPE '\\' LIMIT 1");
  const dayReal = db.prepare("SELECT 1 FROM att_punches WHERE employee_id=? AND work_date=? AND serial NOT LIKE 'TAY\\_%' ESCAPE '\\' LIMIT 1");
  const isHand = (eid, iso) => {
    if (!iso) return false;
    const m0 = Math.floor(Date.parse(iso) / 60000) * 60000;
    return !realMin.get(eid, new Date(m0).toISOString(), new Date(m0 + 60000).toISOString());
  };
  return (a) => {
    if (!dayReal.get(a.employee_id, a.work_date)) return { man_in: 0, man_out: 0 };
    return { man_in: isHand(a.employee_id, a.check_in_at) ? 1 : 0, man_out: isHand(a.employee_id, a.check_out_at) ? 1 : 0 };
  };
}
