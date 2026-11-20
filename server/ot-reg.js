// ĐĂNG KÝ LÀM THÊM (tăng ca có đăng ký).
// Mỗi NV mỗi ngày 1 số phút đăng ký (bảng ot_registrations). Quy tắc:
//   · làm thêm NHIỀU hơn đăng ký → chỉ tính đúng số phút đăng ký
//   · làm thêm ÍT hơn đăng ký    → tính theo thực tế
//   · ngày KHÔNG đăng ký          → tính thực tế (mặc định) hoặc 0 nếu bật "Phải đăng ký mới tính tăng ca" (ot_reg_required)
// attendance.ot_min = tăng ca ĐƯỢC TÍNH (đã chặn); attendance.ot_raw_min = tăng ca THỰC TẾ (trước khi chặn) — để soát
// "làm thêm quá đăng ký" và để đổi đăng ký là áp lại ngay, không phải tính lại công.
// TĂNG CA TRƯA THEO GIỜ (công tắc ot_lunch_reg, mặc định TẮT): mỗi NV mỗi ngày 1 khung giờ (bảng ot_lunch_reg) → phút có mặt trong khung,
// chỉ phần nằm trong giờ nghỉ giữa ca, CỘNG THÊM vào tăng ca được tính (xem lunchOtMinutes). Công tắc tắt → y như cũ.
// NV TỰ ĐĂNG KÝ trên app (công tắc ot_self_reg, mặc định TẮT): đơn ot_requests, quản lý duyệt → ghi vào 2 bảng trên.
import { db, getSetting } from './db.js';
import { breakOtAvail, lunchOtMinutes } from './attendance-calc.js';
export { capOt, otRegCapper, otLuncher } from './ot-cap.js';

export const otRegRequired = () => getSetting('ot_reg_required', '0') === '1';
export const otLunchOn = () => getSetting('ot_lunch_reg', '0') === '1';
export const otSelfOn = () => getSetting('ot_self_reg', '0') === '1';

// Áp lại đăng ký lên các dòng công ĐÃ CÓ trong [from, to] (sau khi đổi đăng ký / đổi cài đặt) — không tính lại công.
// Ngày có nhiều dòng công (nhiều ca): số phút đăng ký là của CẢ NGÀY, trừ dần theo thứ tự giờ vào.
// empIds = null → mọi nhân viên. Trả số dòng công đã đổi.
export function syncOtReg(empIds, from, to) {
  const required = otRegRequired();
  const lunchOn = otLunchOn();
  const upd = db.prepare('UPDATE attendance SET ot_min=? WHERE id=?');
  const punchesOf = db.prepare('SELECT punch_at FROM device_punches WHERE employee_id=? AND punch_at>=? AND punch_at<=? ORDER BY punch_at');
  let changed = 0;
  const run = (ids) => {
    // dòng có tăng ca, dòng của ca bật TĂNG CA TRƯA (giờ nghỉ có mặt bù phần đăng ký — kể cả khi không có tăng ca ngoài ca),
    // hoặc (công tắc trưa theo giờ bật) ngày có đăng ký tăng ca trưa
    const rows = db.prepare(`SELECT a.id, a.employee_id, a.work_date, a.ot_min, a.ot_raw_min, a.check_in_at, a.check_out_at, a.day_status, g.minutes reg,
        l.from_hm lunch_from, l.to_hm lunch_to,
        s.break_ot, s.allow_ot, s.break_start, s.break_minutes, s.start_time, s.end_time, s.cross_midnight
      FROM attendance a LEFT JOIN ot_registrations g ON g.employee_id=a.employee_id AND g.work_date=a.work_date
        LEFT JOIN ot_lunch_reg l ON l.employee_id=a.employee_id AND l.work_date=a.work_date
        LEFT JOIN shifts s ON s.id=a.shift_id
      WHERE a.work_date>=? AND a.work_date<=?${ids ? ` AND a.employee_id IN (${ids.map(() => '?').join(',')})` : ''}
        AND (a.ot_min>0 OR a.ot_raw_min>0 OR (s.break_ot=1 AND s.allow_ot=1) OR l.employee_id IS NOT NULL)
      ORDER BY a.employee_id, a.work_date, a.check_in_at`).all(from, to, ...(ids || []));
    let key = '', left = 0;
    for (const r of rows) {
      const k = r.employee_id + '|' + r.work_date;
      if (k !== key) { key = k; left = r.reg == null ? (required ? 0 : Infinity) : r.reg; }
      const raw = r.ot_raw_min ?? r.ot_min ?? 0;
      let v;
      if (lunchOn) {
        // trưa theo giờ: phần ngoài ca chặn theo đăng ký phút, tăng ca trưa theo khung giờ cộng thêm (giờ nghỉ không bù số phút)
        const o = Math.min(raw, left); left -= o;
        const ok = r.lunch_from && r.start_time && r.day_status === 'lam_viec' && r.check_in_at && r.check_out_at;
        const lunch = ok ? lunchOtMinutes(r, r.work_date, r.check_in_at, r.check_out_at, r.lunch_from, r.lunch_to,
          punchesOf.all(r.employee_id, r.check_in_at, r.check_out_at).map((x) => x.punch_at)) : 0;
        v = o + lunch;
      } else {
        // tăng ca trưa: chỉ khi ngày có đăng ký (left hữu hạn) mới bù giờ nghỉ có mặt vào phần đăng ký còn thiếu
        const brk = r.reg != null && r.break_ot && r.day_status === 'lam_viec' ? breakOtAvail(r, r.work_date, r.check_in_at, r.check_out_at) : 0;
        v = Math.min(raw + brk, left); left -= v;
      }
      if (v !== (r.ot_min || 0)) { upd.run(v, r.id); changed++; }
    }
  };
  if (!empIds) run(null);
  else for (let i = 0; i < empIds.length; i += 400) run(empIds.slice(i, i + 400));
  return changed;
}
// 1 ngày của 1 NV (gọi sau khi dựng lại công ngày có nhiều dòng)
export const syncOtRegDay = (empId, workDate) => syncOtReg([empId], workDate, workDate);

// ---------- giờ 'HH:MM' gõ tay / chọn trên app ----------
// '' → '' · '7' → '07:00' · '730' / '7:30' / '07:30' → '07:30' · sai dạng → null
export function normHm(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const m = /^([01]?\d|2[0-3])(?::?([0-5]\d))?$/.exec(s);
  return m ? m[1].padStart(2, '0') + ':' + (m[2] || '00') : null;
}
// số phút từ 'HH:MM' tới 'HH:MM' (qua nửa đêm được: 22:00 → 01:00 = 180); bằng nhau → 0
export const hmSpan = (f, t) => { const n = (x) => +x.slice(0, 2) * 60 + +x.slice(3, 5); return (n(t) - n(f) + 1440) % 1440; };

// ---------- ĐƠN NV TỰ ĐĂNG KÝ (ot_requests) ----------
export const OT_REQ_KIND = { ot: 'Làm thêm', lunch: 'Tăng ca trưa' };
// Duyệt 1 đơn (đang chờ) — gọi trong giao dịch của nơi gọi. Làm thêm: CỘNG số phút vào đăng ký của ngày (nhiều đơn cùng ngày cộng dồn);
// tăng ca trưa: ghi khung giờ của ngày. Rồi áp ngay lên dòng công đã có. Trả số dòng công đã đổi.
export function approveOtRequest(row, by) {
  if (row.kind === 'lunch') {
    db.prepare(`INSERT INTO ot_lunch_reg(employee_id, work_date, from_hm, to_hm, updated_by, updated_at) VALUES (?,?,?,?,?,datetime('now'))
      ON CONFLICT(employee_id, work_date) DO UPDATE SET from_hm=excluded.from_hm, to_hm=excluded.to_hm, updated_by=excluded.updated_by, updated_at=excluded.updated_at`)
      .run(row.employee_id, row.work_date, row.from_hm, row.to_hm, by);
  } else {
    db.prepare(`INSERT INTO ot_registrations(employee_id, work_date, minutes, updated_by, updated_at) VALUES (?,?,?,?,datetime('now'))
      ON CONFLICT(employee_id, work_date) DO UPDATE SET minutes=MIN(1440, ot_registrations.minutes + excluded.minutes), updated_by=excluded.updated_by, updated_at=excluded.updated_at`)
      .run(row.employee_id, row.work_date, row.minutes, by);
  }
  return syncOtReg([row.employee_id], row.work_date, row.work_date);
}
