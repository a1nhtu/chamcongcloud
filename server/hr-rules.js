// PHÂN HỆ NHÂN SỰ — các quy tắc THUẦN (không đụng CSDL) để test được độc lập:
// danh mục trường hồ sơ, loại hợp đồng, trạng thái hợp đồng, cảnh báo theo Bộ luật Lao động 2019 (BLLĐ),
// quyết định thuyên chuyển / nghỉ việc. Tham khảo luồng AMIS Thông tin nhân sự.

// ---------- Trường hồ sơ (lưu bảng hr_profiles, mỗi trường 1 cột TEXT) ----------
// [key, nhãn, kiểu, nhóm, lựa chọn?]  — kiểu: text | date | select | textarea | employee
export const HR_GROUPS = [
  ['chung', 'Thông tin chung'],
  ['lienhe', 'Liên hệ'],
  ['congviec', 'Công việc'],
  ['hocvan', 'Học vấn'],
  ['nganhang', 'Ngân hàng'],
];
export const HR_FIELDS = [
  ['gender', 'Giới tính', 'select', 'chung', ['Nam', 'Nữ', 'Khác']],
  ['birth_date', 'Ngày sinh', 'date', 'chung'],
  ['birth_place', 'Nơi sinh', 'text', 'chung'],
  ['hometown', 'Quê quán', 'text', 'chung'],
  ['ethnicity', 'Dân tộc', 'text', 'chung'],
  ['religion', 'Tôn giáo', 'text', 'chung'],
  ['nationality', 'Quốc tịch', 'text', 'chung'],
  ['marital_status', 'Tình trạng hôn nhân', 'select', 'chung', ['Độc thân', 'Đã kết hôn', 'Ly hôn', 'Góa']],
  ['id_number', 'Số CCCD / CMND', 'text', 'chung'],
  ['id_issue_date', 'Ngày cấp', 'date', 'chung'],
  ['id_issue_place', 'Nơi cấp', 'text', 'chung'],
  ['tax_code', 'Mã số thuế cá nhân', 'text', 'chung'],
  ['si_number', 'Số sổ BHXH', 'text', 'chung'],
  ['personal_email', 'Email cá nhân', 'text', 'lienhe'],
  ['work_email', 'Email công ty', 'text', 'lienhe'],
  ['permanent_address', 'Địa chỉ thường trú', 'textarea', 'lienhe'],
  ['current_address', 'Chỗ ở hiện nay', 'textarea', 'lienhe'],
  ['emergency_name', 'Người liên hệ khẩn cấp', 'text', 'lienhe'],
  ['emergency_relation', 'Quan hệ', 'text', 'lienhe'],
  ['emergency_phone', 'SĐT khẩn cấp', 'text', 'lienhe'],
  ['emp_type', 'Tính chất lao động (khi chưa có HĐ)', 'select', 'congviec', ['Thử việc', 'Chính thức', 'Học việc', 'Thời vụ', 'Cộng tác viên']],
  ['manager_id', 'Quản lý trực tiếp', 'employee', 'congviec'],
  ['work_location', 'Nơi làm việc', 'text', 'congviec'],
  ['probation_date', 'Ngày bắt đầu thử việc', 'date', 'congviec'],
  ['official_date', 'Ngày làm chính thức', 'date', 'congviec'],
  ['hr_note', 'Ghi chú hồ sơ', 'textarea', 'congviec'],
  ['education_level', 'Trình độ', 'select', 'hocvan', ['THCS', 'THPT', 'Sơ cấp', 'Trung cấp', 'Cao đẳng', 'Đại học', 'Thạc sĩ', 'Tiến sĩ', 'Khác']],
  ['major', 'Chuyên ngành', 'text', 'hocvan'],
  ['school', 'Trường', 'text', 'hocvan'],
  ['graduation_year', 'Năm tốt nghiệp', 'text', 'hocvan'],
  ['certificates', 'Chứng chỉ / kỹ năng khác', 'textarea', 'hocvan'],
  ['bank_account', 'Số tài khoản', 'text', 'nganhang'],
  ['bank_name', 'Ngân hàng', 'text', 'nganhang'],
  ['bank_branch', 'Chi nhánh', 'text', 'nganhang'],
];
export const HR_FIELD_KEYS = HR_FIELDS.map((f) => f[0]);

// Chỉ giữ trường hợp lệ, cắt chuỗi quá dài, ngày phải đúng YYYY-MM-DD (sai thì để trống)
export function cleanProfile(body) {
  const out = {};
  for (const [k, , type] of HR_FIELDS) {
    if (body == null || body[k] === undefined) continue;
    let v = body[k] == null ? '' : String(body[k]).trim().slice(0, type === 'textarea' ? 2000 : 200);
    if (type === 'date' && v && !isDate(v)) v = '';
    out[k] = v;
  }
  return out;
}

// ---------- Ngày ----------
export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(Date.parse(s + 'T00:00:00Z'));
const toUtc = (s) => new Date(s + 'T00:00:00Z');
const fmt = (d) => d.toISOString().slice(0, 10);
export function addDays(s, n) { const d = toUtc(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); }
export function daysBetween(a, b) { return Math.round((toUtc(b) - toUtc(a)) / 86400000); }   // b - a (ngày)
// Ngày hết hạn của HĐ n tháng bắt đầu từ `start`: VD 2026-01-15 + 12 tháng → 2027-01-14
export function contractEndDate(start, months) {
  if (!isDate(start) || !(months > 0)) return '';
  const d = toUtc(start);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  if (day > last) { d.setUTCDate(last); return fmt(d); }   // VD 31/01 + 1 tháng → hết hạn 28/02
  d.setUTCDate(day - 1);
  return fmt(d);
}
export const dmy = (s) => (isDate(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '');

// ---------- Hợp đồng ----------
export const CONTRACT_TYPES = [
  ['thu_viec', 'Hợp đồng thử việc'],
  ['xac_dinh', 'HĐLĐ xác định thời hạn'],
  ['khong_xac_dinh', 'HĐLĐ không xác định thời hạn'],
  ['dich_vu', 'Hợp đồng dịch vụ / cộng tác viên'],
];
export const CONTRACT_TYPE_LABEL = Object.fromEntries(CONTRACT_TYPES);
// Tính chất lao động suy ra từ loại HĐ đang hiệu lực
export const EMP_TYPE_BY_CONTRACT = { thu_viec: 'Thử việc', xac_dinh: 'Chính thức', khong_xac_dinh: 'Chính thức', dich_vu: 'Cộng tác viên' };

export const CONTRACT_STATUS_LABEL = {
  chua_hieu_luc: 'Chưa hiệu lực',
  hieu_luc: 'Còn hiệu lực',
  sap_het_han: 'Sắp hết hạn',
  het_han: 'Đã hết hạn',
  da_tai_ky: 'Đã tái ký',
  cham_dut: 'Đã chấm dứt',
};

// Trạng thái 1 hợp đồng tại ngày `today`. renewed = đã có HĐ tái ký nối tiếp.
export function contractStatus(c, today, warnDays = 30, renewed = false) {
  if (c.terminated_date && c.terminated_date <= today) return 'cham_dut';
  if (c.start_date && c.start_date > today) return 'chua_hieu_luc';
  if (!c.end_date) return 'hieu_luc';
  const left = daysBetween(today, c.end_date);   // còn bao nhiêu ngày (âm = đã hết)
  if (left < 0) return renewed ? 'da_tai_ky' : 'het_han';
  if (left <= warnDays) return renewed ? 'da_tai_ky' : 'sap_het_han';
  return 'hieu_luc';
}

// HĐ đang hiệu lực của 1 NV (mới nhất theo ngày bắt đầu) — null nếu không có
export function currentContract(list, today) {
  const ok = list.filter((c) => (!c.terminated_date || c.terminated_date > today) && c.start_date <= today && (!c.end_date || c.end_date >= today));
  ok.sort((a, b) => (a.start_date < b.start_date ? 1 : a.start_date > b.start_date ? -1 : b.id - a.id));
  return ok[0] || null;
}

// Kiểm tra 1 HĐ sắp lưu. Trả { errors:[], warnings:[] } — errors chặn lưu, warnings chỉ nhắc.
// history = các HĐ khác của cùng NV (không gồm HĐ đang sửa).
export function checkContract(c, history = []) {
  const errors = [], warnings = [];
  if (!CONTRACT_TYPE_LABEL[c.ctype]) errors.push('Chưa chọn loại hợp đồng');
  if (!isDate(c.start_date)) errors.push('Chưa nhập ngày hiệu lực (từ ngày)');
  if (c.end_date && !isDate(c.end_date)) errors.push('Ngày hết hạn không hợp lệ');
  if (isDate(c.start_date) && isDate(c.end_date) && c.end_date < c.start_date) errors.push('Ngày hết hạn phải sau ngày hiệu lực');
  if (c.ctype === 'khong_xac_dinh' && c.end_date) errors.push('HĐ không xác định thời hạn thì không có ngày hết hạn');
  if ((c.ctype === 'xac_dinh' || c.ctype === 'thu_viec') && !c.end_date && !errors.length) errors.push('Loại hợp đồng này phải có ngày hết hạn (hoặc số tháng)');
  if (errors.length) return { errors, warnings };

  const span = c.end_date ? daysBetween(c.start_date, c.end_date) + 1 : 0;
  if (c.ctype === 'xac_dinh' && c.end_date > contractEndDate(c.start_date, 36))
    errors.push('HĐLĐ xác định thời hạn tối đa 36 tháng (khoản 1 Điều 20 BLLĐ 2019) — dài hơn thì ký HĐ không xác định thời hạn');
  if (c.ctype === 'thu_viec' && span > 180)
    errors.push('Thử việc tối đa 180 ngày, và mức 180 ngày chỉ dành cho người quản lý doanh nghiệp (Điều 25 BLLĐ 2019)');
  else if (c.ctype === 'thu_viec' && span > 60)
    warnings.push('Thử việc trên 60 ngày chỉ được áp dụng cho người quản lý doanh nghiệp (tối đa 180 ngày). Trình độ cao đẳng trở lên: tối đa 60 ngày; trung cấp, công nhân kỹ thuật, nhân viên nghiệp vụ: 30 ngày; công việc khác: 6 ngày làm việc (Điều 25 BLLĐ 2019)');
  if (c.ctype === 'thu_viec' && history.some((h) => h.ctype === 'thu_viec' && (h.position || '') === (c.position || '')))
    warnings.push('Nhân viên đã có hợp đồng thử việc cho cùng công việc này — mỗi công việc chỉ được thử việc 1 lần (khoản 1 Điều 25 BLLĐ 2019)');
  if (c.ctype === 'xac_dinh') {
    const fixed = history.filter((h) => h.ctype === 'xac_dinh' && h.start_date < c.start_date).length;
    if (fixed >= 2)
      warnings.push(`Nhân viên đã ký ${fixed} HĐ xác định thời hạn — theo điểm c khoản 2 Điều 20 BLLĐ 2019 chỉ được ký thêm 1 lần, lần tiếp theo phải là HĐ không xác định thời hạn (trừ vài trường hợp luật cho phép: người cao tuổi, lao động nước ngoài, thành viên ban lãnh đạo công đoàn cơ sở…)`);
  }
  // Ký HĐ mới quá 30 ngày sau khi HĐ xác định thời hạn trước hết hạn mà vẫn làm liên tục
  const prev = history.filter((h) => h.ctype === 'xac_dinh' && h.end_date && h.end_date < c.start_date && !h.terminated_date)
    .sort((a, b) => (a.end_date < b.end_date ? 1 : -1))[0];
  if (prev && daysBetween(prev.end_date, c.start_date) > 31)
    warnings.push(`HĐ trước hết hạn ngày ${dmy(prev.end_date)}, cách HĐ này hơn 30 ngày — nếu nhân viên vẫn làm việc liên tục trong khoảng đó thì HĐ cũ đã tự trở thành HĐ không xác định thời hạn (điểm b khoản 2 Điều 20 BLLĐ 2019)`);
  if (!history.length && c.ctype !== 'dich_vu' && isDate(c.sign_date) && c.sign_date > c.start_date)
    warnings.push('Ngày ký sau ngày bắt đầu làm việc — phải giao kết hợp đồng TRƯỚC khi nhận người lao động vào làm (khoản 2 Điều 13 BLLĐ 2019)');
  if (c.ctype === 'dich_vu')
    warnings.push('Hợp đồng dịch vụ / cộng tác viên là hợp đồng dân sự — nếu có trả lương, có quản lý, điều hành, giám sát thì về bản chất vẫn là hợp đồng lao động (khoản 1 Điều 13 BLLĐ 2019)');
  return { errors, warnings };
}

// Cảnh báo HĐ ĐÃ hết hạn quá 30 ngày mà NV vẫn đang làm, chưa tái ký / chấm dứt
export function expiredTooLong(c, today, renewed, active) {
  return active && c.ctype === 'xac_dinh' && c.end_date && !c.terminated_date && !renewed && daysBetween(c.end_date, today) > 30;
}

// ---------- Quyết định thuyên chuyển / nghỉ việc ----------
export const TRANSFER_KINDS = ['Điều chuyển', 'Bổ nhiệm', 'Thăng chức', 'Miễn nhiệm', 'Giáng chức', 'Biệt phái', 'Khác'];
export const RESIGN_KINDS = [
  ['tu_nguyen', 'Nhân viên xin nghỉ (đơn phương)'],
  ['thoa_thuan', 'Hai bên thoả thuận'],
  ['het_han_hd', 'Hết hạn hợp đồng, không tái ký'],
  ['cho_thoi_viec', 'Công ty cho thôi việc / đơn phương chấm dứt'],
  ['sa_thai', 'Sa thải (kỷ luật)'],
  ['huu_tri', 'Nghỉ hưu'],
  ['khac', 'Khác'],
];
export const RESIGN_KIND_LABEL = Object.fromEntries(RESIGN_KINDS);
export const DEFAULT_HANDOVER = [
  'Bàn giao công việc, hồ sơ, tài liệu',
  'Thu hồi tài sản, thiết bị, thẻ ra vào, đồng phục',
  'Xoá vân tay / khuôn mặt trên máy chấm công',
  'Chốt công, quyết toán lương và các khoản (trong 14 ngày làm việc — Điều 48 BLLĐ 2019)',
  'Chốt sổ BHXH, trả lại sổ và giấy tờ bản chính',
];

// NV xin nghỉ (đơn phương): đủ thời hạn báo trước chưa? (khoản 1 Điều 35 BLLĐ 2019)
// cur = HĐ đang hiệu lực (null = không rõ). Trả câu cảnh báo hoặc ''.
export function noticeWarning(kind, cur, requestDate, leaveDate) {
  if (kind !== 'tu_nguyen' || !isDate(requestDate) || !isDate(leaveDate) || !cur) return '';
  const given = daysBetween(requestDate, leaveDate);
  let need = 0, txt = '';
  if (cur.ctype === 'khong_xac_dinh') { need = 45; txt = '45 ngày (HĐ không xác định thời hạn)'; }
  else if (cur.ctype === 'xac_dinh') {
    const months = cur.end_date ? daysBetween(cur.start_date, cur.end_date) / 30.4 : 0;
    if (months >= 11.5) { need = 30; txt = '30 ngày (HĐ xác định thời hạn 12–36 tháng)'; }
    else { need = 3; txt = '3 ngày làm việc (HĐ dưới 12 tháng)'; }
  } else return '';
  if (given >= need) return '';
  return `Đơn nộp trước ${given} ngày — chưa đủ thời hạn báo trước ${txt} theo khoản 1 Điều 35 BLLĐ 2019 (trừ các trường hợp được nghỉ không cần báo trước ở khoản 2 Điều 35)`;
}

// Quyết định đã tới ngày hiệu lực, chờ áp dụng
export const decisionDue = (d, today) => d.status === 'pending' && isDate(d.effective_date) && d.effective_date <= today;

// ---------- Nhắc hợp đồng sắp hết hạn / hết thử việc (thông báo đẩy) ----------
// Mốc nhắc của 1 HĐ (đã có status / days_left / emp_active từ loadContracts). Mỗi mốc chỉ gửi 1 lần (bảng hr_reminders):
//  warn = vừa vào ngưỡng cảnh báo (hr_contract_warn_days) · d7 = còn ≤ 7 ngày · expired = đã hết hạn chưa tái ký (trong 7 ngày đầu)
// Bỏ qua: HĐ không thời hạn, đã tái ký, đã / sẽ chấm dứt, NV đã nghỉ hoặc có QĐ nghỉ việc trước khi HĐ hết hạn.
export function reminderStage(c, warnDays = 30, { leavingOn = '' } = {}) {
  if (!c.end_date || c.terminated_date || c.emp_active !== 1 || c.days_left == null) return null;
  if (c.status === 'da_tai_ky' || c.status === 'cham_dut' || c.status === 'chua_hieu_luc') return null;
  if (leavingOn && leavingOn <= addDays(c.end_date, 1)) return null;
  const left = c.days_left;
  if (left < 0) return left >= -7 ? 'expired' : null;
  if (left <= 7 && warnDays > 7) return 'd7';
  if (left <= warnDays) return 'warn';
  return null;
}
// Gộp các HĐ cần nhắc thành 1 thông báo. items: [{ name, code, ctype, days_left, end_date }]
export function reminderDigest(items) {
  const line = (i) => {
    const what = i.ctype === 'thu_viec' ? 'hết thử việc' : 'HĐ hết hạn';
    const when = i.days_left < 0 ? `đã quá ${-i.days_left} ngày` : i.days_left === 0 ? 'hôm nay' : `còn ${i.days_left} ngày`;
    return `${i.name} (${i.code}): ${what} ${when}${i.end_date ? ' — ' + dmy(i.end_date) : ''}`;
  };
  const probation = items.filter((i) => i.ctype === 'thu_viec').length;
  const title = items.length === 1
    ? (probation ? '⏳ Sắp hết thử việc' : items[0].days_left < 0 ? '⛔ Hợp đồng đã hết hạn' : '📄 Hợp đồng sắp hết hạn')
    : `📄 ${items.length} hợp đồng cần xử lý${probation ? ` (${probation} hết thử việc)` : ''}`;
  const lines = items.slice(0, 4).map(line);
  if (items.length > 4) lines.push(`… và ${items.length - 4} người khác`);
  if (items.length === 1) lines.push(probation ? 'Đánh giá kết quả thử việc và ký HĐ chính thức.' : 'Tái ký hoặc lập quyết định nghỉ việc.');
  return { title, body: lines.join('\n') };
}
