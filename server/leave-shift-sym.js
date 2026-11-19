// GHÉP MÃ CA + KÝ HIỆU NGHỈ trên bảng công — công tắc leave_sym_shift, mặc định TẮT (khách may Hualida 19/11/2026,
// bảng mã cũ của họ có sẵn các mã ghép): ngày nghỉ hiện mã ca của ngày đó + ký hiệu nghỉ,
// VD ca HC + phép năm PN → "HCPN", ca đêm D + phép bệnh PB → "DPB", ca C + việc riêng P → "CP".
// Ca của ngày nghỉ lấy theo thứ tự:
//   1. ca ghi trên dòng công của chính ngày đó (nghỉ nửa ngày, ngày có dòng công)
//   2. ca đã phân / gán cho ngày đó (phân ca ngày, gán ca NV / phòng ban, ca mặc định) — chỉ khi xác định đúng 1 ca
//   3. bộ phận TỰ NHẬN CA theo giờ chấm: ca NV làm gần nhất trong 7 ngày trước
// Không tìm được ca (hoặc ca không có mã) → giữ nguyên ký hiệu nghỉ như cũ. Chỉ đổi CHỮ hiển thị; đếm ngày nghỉ, cột theo loại nghỉ không đổi.
import { db, getSetting } from './db.js';
import { resolveShift } from './shift-resolver.js';

export const leaveShiftSymOn = () => getSetting('leave_sym_shift', '0') === '1';

const minus7 = (d) => new Date(new Date(d + 'T00:00:00Z').getTime() - 7 * 86400000).toISOString().slice(0, 10);

// Hàm (empId, ngày) → mã ca của ngày nghỉ ('' = không xác định). Mỗi báo cáo tạo 1 lần (có nhớ đệm).
export function leaveShiftCoder() {
  const dayRow = db.prepare(`SELECT s.code FROM attendance a JOIN shifts s ON s.id = a.shift_id
    WHERE a.employee_id = ? AND a.work_date = ? AND TRIM(COALESCE(s.code, '')) <> '' ORDER BY a.check_in_at LIMIT 1`);
  const lastRow = db.prepare(`SELECT s.code FROM attendance a JOIN shifts s ON s.id = a.shift_id
    WHERE a.employee_id = ? AND a.work_date < ? AND a.work_date >= ? AND a.work_minutes > 0 AND TRIM(COALESCE(s.code, '')) <> ''
    ORDER BY a.work_date DESC, a.check_in_at DESC LIMIT 1`);
  const memo = new Map();
  return (empId, date) => {
    const key = empId + '|' + date;
    if (memo.has(key)) return memo.get(key);
    let code = dayRow.get(empId, date)?.code || '';
    if (!code) {
      const r = resolveShift(empId, date);
      if (!r.off && r.shift) code = r.shift.code || '';
      else if (!r.off) code = lastRow.get(empId, date, minus7(date))?.code || '';
    }
    code = String(code).trim();
    memo.set(key, code);
    return code;
  };
}

// Ghép: "HC" + "PN" → "HCPN"; không có mã ca → ký hiệu nghỉ giữ nguyên
export const joinLeaveSym = (code, sym) => (code && sym ? code + sym : sym);
