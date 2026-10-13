// ĐĂNG KÝ LÀM THÊM (tăng ca có đăng ký).
// Mỗi NV mỗi ngày 1 số phút đăng ký (bảng ot_registrations). Quy tắc:
//   · làm thêm NHIỀU hơn đăng ký → chỉ tính đúng số phút đăng ký
//   · làm thêm ÍT hơn đăng ký    → tính theo thực tế
//   · ngày KHÔNG đăng ký          → tính thực tế (mặc định) hoặc 0 nếu bật "Phải đăng ký mới tính tăng ca" (ot_reg_required)
// attendance.ot_min = tăng ca ĐƯỢC TÍNH (đã chặn); attendance.ot_raw_min = tăng ca THỰC TẾ (trước khi chặn) — để soát
// "làm thêm quá đăng ký" và để đổi đăng ký là áp lại ngay, không phải tính lại công.
import { db, getSetting } from './db.js';
export { capOt, otRegCapper } from './ot-cap.js';

export const otRegRequired = () => getSetting('ot_reg_required', '0') === '1';

// Áp lại đăng ký lên các dòng công ĐÃ CÓ trong [from, to] (sau khi đổi đăng ký / đổi cài đặt) — không tính lại công.
// Ngày có nhiều dòng công (nhiều ca): số phút đăng ký là của CẢ NGÀY, trừ dần theo thứ tự giờ vào.
// empIds = null → mọi nhân viên. Trả số dòng công đã đổi.
export function syncOtReg(empIds, from, to) {
  const required = otRegRequired();
  const upd = db.prepare('UPDATE attendance SET ot_min=? WHERE id=?');
  let changed = 0;
  const run = (ids) => {
    const rows = db.prepare(`SELECT a.id, a.employee_id, a.work_date, a.ot_min, a.ot_raw_min, g.minutes reg
      FROM attendance a LEFT JOIN ot_registrations g ON g.employee_id=a.employee_id AND g.work_date=a.work_date
      WHERE a.work_date>=? AND a.work_date<=?${ids ? ` AND a.employee_id IN (${ids.map(() => '?').join(',')})` : ''}
        AND (a.ot_min>0 OR a.ot_raw_min>0)
      ORDER BY a.employee_id, a.work_date, a.check_in_at`).all(from, to, ...(ids || []));
    let key = '', left = 0;
    for (const r of rows) {
      const k = r.employee_id + '|' + r.work_date;
      if (k !== key) { key = k; left = r.reg == null ? (required ? 0 : Infinity) : r.reg; }
      const raw = r.ot_raw_min ?? r.ot_min ?? 0;
      const v = Math.min(raw, left); left -= v;
      if (v !== (r.ot_min || 0)) { upd.run(v, r.id); changed++; }
    }
  };
  if (!empIds) run(null);
  else for (let i = 0; i < empIds.length; i += 400) run(empIds.slice(i, i + 400));
  return changed;
}
// 1 ngày của 1 NV (gọi sau khi dựng lại công ngày có nhiều dòng)
export const syncOtRegDay = (empId, workDate) => syncOtReg([empId], workDate, workDate);
