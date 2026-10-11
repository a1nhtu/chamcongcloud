// CHẾ ĐỘ ƯU ĐÃI (thai sản, nuôi con nhỏ…): trong khoảng ngày áp dụng, nhân viên được ưu đãi số phút ở 4 vị trí
//   đầu ca được đến muộn · trước nghỉ trưa được về sớm · sau nghỉ trưa được đến muộn · cuối ca được về sớm.
// Phần đến muộn / về sớm nằm trong số phút ưu đãi KHÔNG tính trễ/sớm và KHÔNG trừ giờ công (vẫn hưởng đủ công).
// Luật: mang thai từ tháng 7 (tháng 6 ở vùng khó khăn) và nuôi con dưới 12 tháng được 60 phút/ngày.
// (Module không tự mở CSDL — nhận `db` từ nơi gọi, để test tính công chạy được với CSDL giả.)

export const PRIV_KINDS = ['Mang thai', 'Nuôi con nhỏ', 'Khác'];

const active = (r, date) => r.from_date <= date && (!r.to_date || r.to_date >= date);
function sum(rows) {
  if (!rows.length) return null;
  const p = { late: 0, midOut: 0, midIn: 0, early: 0 };
  for (const r of rows) { p.late += r.late_min || 0; p.midOut += r.mid_out_min || 0; p.midIn += r.mid_in_min || 0; p.early += r.early_min || 0; }
  return p.late || p.midOut || p.midIn || p.early ? p : null;
}

// Ưu đãi đang áp cho NV vào ngày date (nhiều dòng trùng ngày → cộng dồn từng vị trí); null nếu không có
export function privilegeFor(db, empId, date) {
  if (!empId || !date) return null;
  try {
    return sum(db.prepare('SELECT * FROM employee_privileges WHERE employee_id=? AND from_date<=?').all(empId, date).filter((r) => active(r, date)));
  } catch { return null; }
}

// Bộ tra nhanh cho cả mẻ tính lại (nạp 1 lần, khi cần lần đầu)
export function privilegeLookup(db) {
  let byEmp = null;
  return (empId, date) => {
    if (!empId || !date) return null;
    if (!byEmp) {
      byEmp = new Map();
      try {
        for (const r of db.prepare('SELECT * FROM employee_privileges').all()) {
          if (!byEmp.has(r.employee_id)) byEmp.set(r.employee_id, []);
          byEmp.get(r.employee_id).push(r);
        }
      } catch { /* CSDL chưa có bảng (test) */ }
    }
    return sum((byEmp.get(empId) || []).filter((r) => active(r, date)));
  };
}

// Đơn NGHỈ PHÉP NỬA NGÀY đã duyệt của NV trong ngày: 'sang' | 'chieu' | '' (để không tính trễ / sớm phần nghỉ)
const HALF_SQL = "SELECT employee_id, from_date, half FROM leave_requests WHERE status='approved' AND half IN ('sang','chieu') AND from_date=to_date";
export function halfLeaveFor(db, empId, date) {
  if (!empId || !date) return '';
  try { return (db.prepare(HALF_SQL + ' AND employee_id=? AND from_date=?').get(empId, date) || {}).half || ''; } catch { return ''; }
}
export function halfLeaveLookup(db) {
  let map = null;
  return (empId, date) => {
    if (!empId || !date) return '';
    if (!map) { map = new Map(); try { for (const r of db.prepare(HALF_SQL).all()) map.set(r.employee_id + '|' + r.from_date, r.half); } catch { /* chưa có bảng */ } }
    return map.get(empId + '|' + date) || '';
  };
}
