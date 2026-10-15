// PHÂN HỆ NHÂN SỰ — IN GIẤY TỜ theo mẫu Word (hàm THUẦN, không đụng CSDL → test được độc lập):
// danh mục mẫu, danh mục trường tự điền, đọc số tiền thành chữ, ngày "ngày … tháng … năm …",
// dựng dữ liệu điền cho hợp đồng / phụ lục / quyết định, và nội dung 6 MẪU MẶC ĐỊNH (theo BLLĐ 2019).
import { CONTRACT_TYPE_LABEL, RESIGN_KIND_LABEL, dmy, isDate, addDays, daysBetween } from './hr-rules.js';

// ---------- Danh mục mẫu ----------
// [key, tên, loại đối tượng in]
export const DOC_TEMPLATES = [
  ['hd_thu_viec', 'Hợp đồng thử việc', 'contract'],
  ['hd_lao_dong', 'Hợp đồng lao động (xác định / không xác định thời hạn)', 'contract'],
  ['hd_dich_vu', 'Hợp đồng dịch vụ / cộng tác viên', 'contract'],
  ['phu_luc', 'Phụ lục hợp đồng lao động', 'annex'],
  ['qd_thuyen_chuyen', 'Quyết định thuyên chuyển / bổ nhiệm', 'transfer'],
  ['qd_nghi_viec', 'Quyết định nghỉ việc (chấm dứt HĐLĐ)', 'resign'],
];
export const DOC_TEMPLATE_KEYS = DOC_TEMPLATES.map((t) => t[0]);
export const templateForContract = (ctype) => (ctype === 'thu_viec' ? 'hd_thu_viec' : ctype === 'dich_vu' ? 'hd_dich_vu' : 'hd_lao_dong');

// ---------- Danh mục trường ----------
// [nhóm, tiêu đề nhóm, các loại đối tượng dùng được, [[key, ý nghĩa, ví dụ], …]]
export const DOC_FIELD_GROUPS = [
  ['cty', 'Công ty', ['contract', 'annex', 'transfer', 'resign'], [
    ['cong_ty', 'Tên công ty', 'Công ty TNHH ABC'], ['cong_ty_hoa', 'Tên công ty (CHỮ HOA)', 'CÔNG TY TNHH ABC'],
    ['dia_chi_cong_ty', 'Địa chỉ công ty', '12 Nguyễn Huệ, Q.1, TP.HCM'], ['mst_cong_ty', 'Mã số thuế công ty', '0312345678'],
    ['dien_thoai_cong_ty', 'Điện thoại công ty', '028 1234 5678'], ['dai_dien', 'Người đại diện ký (hợp đồng: người ký trên HĐ nếu có)', 'Nguyễn Văn Giám'],
    ['chuc_vu_dai_dien', 'Chức vụ người đại diện', 'Giám đốc'], ['chuc_vu_dai_dien_hoa', 'Chức vụ người đại diện (CHỮ HOA)', 'GIÁM ĐỐC'],
    ['dia_danh', 'Địa danh ghi trước ngày tháng', 'TP. Hồ Chí Minh'], ['ngay_hom_nay', 'Ngày in', '15/10/2026'], ['ngay_hom_nay_chu', 'Ngày in bằng chữ', 'ngày 15 tháng 10 năm 2026'],
  ]],
  ['nv', 'Nhân viên', ['contract', 'annex', 'transfer', 'resign'], [
    ['ma_nv', 'Mã nhân viên', 'NV025'], ['ho_ten', 'Họ và tên', 'Trần Thị Bình'], ['ho_ten_hoa', 'Họ và tên (CHỮ HOA)', 'TRẦN THỊ BÌNH'],
    ['xung_ho', 'Ông / Bà (theo giới tính)', 'Bà'], ['gioi_tinh', 'Giới tính', 'Nữ'], ['ngay_sinh', 'Ngày sinh', '20/05/1995'],
    ['noi_sinh', 'Nơi sinh', 'Hà Nội'], ['que_quan', 'Quê quán', 'Nam Định'], ['dan_toc', 'Dân tộc', 'Kinh'], ['quoc_tich', 'Quốc tịch', 'Việt Nam'],
    ['cccd', 'Số CCCD / CMND', '001195012345'], ['ngay_cap', 'Ngày cấp CCCD', '10/08/2021'], ['noi_cap', 'Nơi cấp CCCD', 'Cục Cảnh sát QLHC về TTXH'],
    ['mst_ca_nhan', 'Mã số thuế cá nhân', '8123456789'], ['so_bhxh', 'Số sổ BHXH', '7912345678'],
    ['dia_chi_thuong_tru', 'Địa chỉ thường trú', '5 Lê Lợi, Nam Định'], ['cho_o_hien_nay', 'Chỗ ở hiện nay', '20 Võ Văn Tần, Q.3, TP.HCM'],
    ['dien_thoai', 'Số điện thoại', '0901234567'], ['email', 'Email', 'binh@gmail.com'], ['trinh_do', 'Trình độ', 'Đại học'], ['chuyen_nganh', 'Chuyên ngành', 'Kế toán'],
    ['so_tai_khoan', 'Số tài khoản ngân hàng', '0123456789'], ['ngan_hang', 'Ngân hàng – chi nhánh', 'Vietcombank – CN Sài Gòn'],
    ['bo_phan', 'Bộ phận (hợp đồng: bộ phận ghi trên HĐ)', 'Kế toán'], ['chuc_danh', 'Chức danh (hợp đồng: chức danh ghi trên HĐ)', 'Kế toán viên'],
    ['ngay_vao_lam', 'Ngày vào làm', '01/03/2026'], ['quan_ly', 'Quản lý trực tiếp', 'Lê Văn Cường'],
  ]],
  ['hd', 'Hợp đồng', ['contract', 'annex', 'resign'], [
    ['so_hd', 'Số hợp đồng', '15/2026/HĐLĐ'], ['loai_hd', 'Loại hợp đồng', 'HĐLĐ xác định thời hạn'],
    ['ngay_ky', 'Ngày ký hợp đồng', '28/02/2026'], ['ngay_ky_chu', 'Ngày ký bằng chữ', 'ngày 28 tháng 02 năm 2026'],
    ['tu_ngay', 'Hiệu lực từ ngày', '01/03/2026'], ['den_ngay', 'Đến ngày', '28/02/2027'],
    ['thoi_han', 'Thời hạn (câu đầy đủ)', '12 tháng, từ ngày 01/03/2026 đến hết ngày 28/02/2027'], ['so_thang', 'Số tháng', '12'], ['so_ngay', 'Số ngày (thử việc)', '60'],
    ['noi_lam_viec', 'Địa điểm làm việc', 'Văn phòng TP.HCM'], ['luong', 'Mức lương (số)', '9.000.000'], ['luong_bang_chu', 'Mức lương bằng chữ', 'Chín triệu đồng'],
    ['luong_bhxh', 'Lương đóng BHXH (số)', '6.000.000'], ['luong_bhxh_bang_chu', 'Lương đóng BHXH bằng chữ', 'Sáu triệu đồng'],
    ['phu_cap', 'Phụ cấp', 'Ăn trưa 730.000đ/tháng'], ['ghi_chu', 'Ghi chú', ''], ['nguoi_ky', 'Người ký', 'Nguyễn Văn Giám'],
    ['ngay_ky_hd', 'Ngày ký HĐ (dùng trong phụ lục / QĐ nghỉ việc)', '28/02/2026'],
  ]],
  ['pl', 'Phụ lục hợp đồng', ['annex'], [
    ['so_phu_luc', 'Số phụ lục', '01/2026/PLHĐ'], ['ngay_ky_pl', 'Ngày ký phụ lục', '01/09/2026'], ['ngay_ky_pl_chu', 'Ngày ký phụ lục bằng chữ', 'ngày 01 tháng 9 năm 2026'],
    ['ngay_hieu_luc', 'Ngày hiệu lực phụ lục', '01/09/2026'], ['chuc_danh_moi', 'Chức danh mới (hoặc "Giữ nguyên…")', 'Kế toán tổng hợp'],
    ['luong_moi', 'Lương mới kèm bằng chữ (hoặc "Giữ nguyên…")', '11.000.000 đồng/tháng (Bằng chữ: Mười một triệu đồng)'],
    ['luong_moi_so', 'Lương mới (số)', '11.000.000'], ['luong_moi_bang_chu', 'Lương mới bằng chữ', 'Mười một triệu đồng'], ['noi_dung', 'Nội dung điều chỉnh khác', 'Bổ sung phụ cấp điện thoại'],
  ]],
  ['qd', 'Quyết định', ['transfer', 'resign'], [
    ['so_qd', 'Số quyết định', '08/2026/QĐ-ĐC'], ['ngay_qd', 'Ngày ký quyết định', '20/10/2026'], ['ngay_qd_chu', 'Ngày ký QĐ bằng chữ', 'ngày 20 tháng 10 năm 2026'],
    ['ngay_hieu_luc', 'Ngày hiệu lực', '01/11/2026'], ['ngay_hieu_luc_chu', 'Ngày hiệu lực bằng chữ', 'ngày 01 tháng 11 năm 2026'],
    ['ly_do', 'Lý do', 'Theo nhu cầu công việc'], ['ghi_chu', 'Ghi chú', ''], ['nguoi_ky', 'Người ký quyết định', 'Nguyễn Văn Giám'],
  ]],
  ['tc', 'Thuyên chuyển', ['transfer'], [
    ['loai_qd', 'Loại quyết định', 'Điều chuyển'], ['loai_qd_thuong', 'Loại quyết định (chữ thường)', 'điều chuyển'],
    ['bo_phan_cu', 'Bộ phận cũ', 'Kế toán'], ['bo_phan_moi', 'Bộ phận mới', 'Kinh doanh'], ['chuc_danh_cu', 'Chức danh cũ', 'Kế toán viên'], ['chuc_danh_moi', 'Chức danh mới', 'Trưởng nhóm'],
  ]],
  ['nghi', 'Nghỉ việc', ['resign'], [
    ['tieu_de_qd_nghi', 'Trích yếu quyết định', 'Về việc chấm dứt hợp đồng lao động'], ['hinh_thuc_nghi', 'Hình thức nghỉ', 'Nhân viên xin nghỉ (đơn phương)'],
    ['ngay_nop_don', 'Ngày nộp đơn', '01/10/2026'], ['ngay_nghi', 'Nghỉ việc kể từ ngày', '01/11/2026'], ['ngay_lam_cuoi', 'Ngày làm việc cuối cùng', '31/10/2026'],
    ['can_cu_nghi', 'Căn cứ nghỉ việc (tự theo hình thức)', 'Đơn xin nghỉ việc của Bà Trần Thị Bình ngày 01/10/2026'],
    ['viec_ban_giao', 'Danh sách việc bàn giao (mỗi việc 1 dòng)', '- Bàn giao công việc, hồ sơ, tài liệu'],
  ]],
];
// Trường hợp lệ cho 1 mẫu (để báo trường gõ sai khi tải mẫu riêng lên)
export function fieldsForTemplate(tplKey) {
  const kind = (DOC_TEMPLATES.find((t) => t[0] === tplKey) || [])[2];
  const out = new Set();
  for (const [, , kinds, fields] of DOC_FIELD_GROUPS) if (kinds.includes(kind)) for (const [k] of fields) out.add(k);
  return out;
}
export const fieldLabel = (k) => { for (const g of DOC_FIELD_GROUPS) for (const f of g[3]) if (f[0] === k) return f[1]; return k; };

// ---------- Chữ ----------
const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
function read3(n, full) {   // full = nhóm không đứng đầu → đọc đủ "không trăm", "lẻ"
  const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), u = n % 10, out = [];
  if (h || full) out.push(DIGITS[h], 'trăm');
  if (t > 1) { out.push(DIGITS[t], 'mươi'); if (u === 1) out.push('mốt'); else if (u === 4) out.push('tư'); else if (u === 5) out.push('lăm'); else if (u) out.push(DIGITS[u]); }
  else if (t === 1) { out.push('mười'); if (u === 5) out.push('lăm'); else if (u) out.push(DIGITS[u]); }
  else if (u) { if (h || full) out.push('lẻ'); out.push(DIGITS[u]); }
  return out.join(' ');
}
// 9500000 → "Chín triệu năm trăm nghìn đồng"
export function moneyWords(amount) {
  let n = Math.round(Number(amount) || 0);
  if (n <= 0) return 'Không đồng';
  const UNITS = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ'];
  const groups = [];
  while (n > 0) { groups.push(n % 1000); n = Math.floor(n / 1000); }
  const parts = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (!groups[i]) continue;
    parts.push(read3(groups[i], i < groups.length - 1) + (UNITS[i] ? ' ' + UNITS[i] : ''));
  }
  const s = parts.join(' ') + ' đồng';
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export const money = (n) => (Number(n) > 0 ? Math.round(Number(n)).toLocaleString('vi-VN').replace(/,/g, '.') : '');
// "ngày 05 tháng 02 năm 2026" — ngày < 10 và tháng 1, 2 thêm số 0 (Nghị định 30/2020/NĐ-CP)
export function dateWords(s) {
  if (!isDate(s)) return 'ngày …… tháng …… năm ……';
  const d = +s.slice(8, 10), m = +s.slice(5, 7);
  return `ngày ${d < 10 ? '0' + d : d} tháng ${m <= 2 ? '0' + m : m} năm ${s.slice(0, 4)}`;
}
const upper = (s) => String(s || '').toLocaleUpperCase('vi-VN');
const lowerFirst = (s) => (s ? s.charAt(0).toLocaleLowerCase('vi-VN') + s.slice(1) : '');

// ---------- Dữ liệu điền ----------
// co = { name, address, tax, phone, rep, rep_title, place }
const strs = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v ?? '']));   // undefined → '' (vẫn là trường đã biết)
export function companyFields(co, today) {
  return strs({
    cong_ty: co.name, cong_ty_hoa: upper(co.name), dia_chi_cong_ty: co.address, mst_cong_ty: co.tax, dien_thoai_cong_ty: co.phone,
    dai_dien: co.rep, chuc_vu_dai_dien: co.rep_title, chuc_vu_dai_dien_hoa: upper(co.rep_title), dia_danh: co.place,
    ngay_hom_nay: dmy(today), ngay_hom_nay_chu: dateWords(today),
  });
}
// e = dòng employees, p = hr_profiles, mgr = tên quản lý trực tiếp
export function employeeFields(e, p = {}, mgr = '') {
  const g = p.gender || '';
  return strs({
    ma_nv: e.code, ho_ten: e.full_name, ho_ten_hoa: upper(e.full_name), xung_ho: g === 'Nữ' ? 'Bà' : g === 'Nam' ? 'Ông' : 'Ông/Bà',
    gioi_tinh: g, ngay_sinh: dmy(p.birth_date), noi_sinh: p.birth_place, que_quan: p.hometown, dan_toc: p.ethnicity, quoc_tich: p.nationality || 'Việt Nam',
    cccd: p.id_number, ngay_cap: dmy(p.id_issue_date), noi_cap: p.id_issue_place, mst_ca_nhan: p.tax_code, so_bhxh: p.si_number,
    dia_chi_thuong_tru: p.permanent_address, cho_o_hien_nay: p.current_address || p.permanent_address, dien_thoai: e.phone,
    email: p.personal_email || p.work_email, trinh_do: p.education_level, chuyen_nganh: p.major, so_tai_khoan: p.bank_account,
    ngan_hang: [p.bank_name, p.bank_branch].filter(Boolean).join(' – '), bo_phan: e.department, chuc_danh: e.position,
    ngay_vao_lam: dmy(e.start_date), quan_ly: mgr,
  });
}
// Câu thời hạn hợp đồng
export function termText(c) {
  const from = dmy(c.start_date), to = dmy(c.end_date);
  if (c.ctype === 'khong_xac_dinh' || !c.end_date) return `Không xác định thời hạn, kể từ ngày ${from}`;
  if (c.ctype === 'thu_viec') return `${daysBetween(c.start_date, c.end_date) + 1} ngày, từ ngày ${from} đến hết ngày ${to}`;
  if (c.term_months > 0) return `${c.term_months} tháng, từ ngày ${from} đến hết ngày ${to}`;
  return `Từ ngày ${from} đến hết ngày ${to}`;
}
// Hợp đồng (dùng lương / chức danh GỐC ghi trên HĐ; phụ lục in riêng)
export function contractFields(c, co = {}) {
  return {
    so_hd: c.contract_no, loai_hd: CONTRACT_TYPE_LABEL[c.ctype] || '', ngay_ky: dmy(c.sign_date), ngay_ky_chu: dateWords(c.sign_date), ngay_ky_hd: dmy(c.sign_date),
    tu_ngay: dmy(c.start_date), den_ngay: c.end_date ? dmy(c.end_date) : 'Không xác định thời hạn', thoi_han: termText(c),
    so_thang: c.term_months > 0 ? String(c.term_months) : '', so_ngay: c.end_date && c.start_date ? String(daysBetween(c.start_date, c.end_date) + 1) : '',
    bo_phan: c.department || undefined, chuc_danh: c.position || undefined, noi_lam_viec: c.work_place || co.address || '',
    luong: money(c.salary), luong_bang_chu: c.salary > 0 ? moneyWords(c.salary) : '', luong_bhxh: money(c.insurance_salary),
    luong_bhxh_bang_chu: c.insurance_salary > 0 ? moneyWords(c.insurance_salary) : '', phu_cap: c.allowance || 'Không',
    ghi_chu: c.note, dai_dien: c.signer || co.rep, nguoi_ky: c.signer || co.rep,
  };
}
export function annexFields(a) {
  const keep = 'Giữ nguyên như hợp đồng';
  return {
    so_phu_luc: a.annex_no, ngay_ky_pl: dmy(a.sign_date), ngay_ky_pl_chu: dateWords(a.sign_date),
    ngay_hieu_luc: dmy(a.effective_date), ngay_hieu_luc_chu: dateWords(a.effective_date),
    chuc_danh_moi: a.position || keep, luong_moi: a.salary > 0 ? `${money(a.salary)} đồng/tháng (Bằng chữ: ${moneyWords(a.salary)})` : keep,
    luong_moi_so: money(a.salary), luong_moi_bang_chu: a.salary > 0 ? moneyWords(a.salary) : '', noi_dung: a.content || 'Không',
  };
}
const RESIGN_TITLE = { sa_thai: 'Về việc thi hành kỷ luật sa thải', huu_tri: 'Về việc nghỉ hưu' };
// d = hr_decisions, ef = employeeFields, cur = HĐ đang hiệu lực khi nghỉ (có thể null)
export function decisionFields(d, ef = {}, co = {}, cur = null) {
  const out = {
    so_qd: d.decision_no, ngay_qd: dmy(d.decision_date), ngay_qd_chu: dateWords(d.decision_date),
    ngay_hieu_luc: dmy(d.effective_date), ngay_hieu_luc_chu: dateWords(d.effective_date),
    ly_do: d.reason, ghi_chu: d.note, nguoi_ky: d.signer || co.rep,
  };
  if (d.kind === 'transfer') {
    const sub = d.sub_kind || 'Điều chuyển';
    Object.assign(out, {
      loai_qd: sub, loai_qd_thuong: lowerFirst(sub), bo_phan_cu: d.from_department, bo_phan_moi: d.to_department || d.from_department,
      chuc_danh_cu: d.from_position, chuc_danh_moi: d.to_position || d.from_position,
    });
    if (!out.ly_do) out.ly_do = 'Theo nhu cầu công việc';
  } else {
    const who = `${ef.xung_ho || 'Ông/Bà'} ${ef.ho_ten || ''}`.trim();
    const CAN_CU = {
      tu_nguyen: `Đơn xin nghỉ việc của ${who}${d.request_date ? ' ngày ' + dmy(d.request_date) : ''}`,
      thoa_thuan: 'Biên bản thoả thuận chấm dứt hợp đồng lao động giữa công ty và người lao động',
      het_han_hd: cur && cur.end_date ? `Hợp đồng lao động hết hạn ngày ${dmy(cur.end_date)}` : 'Thông báo hết hạn hợp đồng lao động',
      cho_thoi_viec: 'Thông báo đơn phương chấm dứt hợp đồng lao động của công ty theo Điều 36 Bộ luật Lao động 2019',
      sa_thai: 'Biên bản họp xử lý kỷ luật lao động theo Điều 122 Bộ luật Lao động 2019',
      huu_tri: 'Người lao động đủ điều kiện hưởng lương hưu theo Điều 169 Bộ luật Lao động 2019',
    };
    const ho = Array.isArray(d.handover) ? d.handover : (() => { try { return JSON.parse(d.handover || '[]'); } catch { return []; } })();
    Object.assign(out, {
      tieu_de_qd_nghi: RESIGN_TITLE[d.sub_kind] || 'Về việc chấm dứt hợp đồng lao động', hinh_thuc_nghi: RESIGN_KIND_LABEL[d.sub_kind] || '',
      ngay_nop_don: dmy(d.request_date), ngay_nghi: dmy(d.effective_date), ngay_lam_cuoi: isDate(d.effective_date) ? dmy(addDays(d.effective_date, -1)) : '',
      can_cu_nghi: CAN_CU[d.sub_kind] || 'Đề nghị của bộ phận quản lý', viec_ban_giao: ho.map((x) => '- ' + x.t).join('\n'),
      so_hd: cur ? cur.contract_no : '', ngay_ky_hd: cur ? dmy(cur.sign_date || cur.start_date) : '',
    });
  }
  return out;
}
// Gộp: giá trị undefined của lớp sau KHÔNG đè lớp trước
export function mergeFields(...layers) {
  const out = {};
  for (const l of layers) for (const [k, v] of Object.entries(l || {})) if (v !== undefined) out[k] = v == null ? '' : String(v);
  return out;
}

/* =====================================================================
 * MẪU MẶC ĐỊNH (khối nội dung cho buildDocx) — chuẩn Bộ luật Lao động 2019
 * ===================================================================== */
const P = (p, o = {}) => ({ p, align: 'both', ...o });
const H = (p, o = {}) => ({ p, bold: true, before: 6, align: 'both', keepNext: true, ...o });   // tiêu đề Điều (dính với dòng sau)
const C = (p, o = {}) => ({ p, align: 'center', ...o });
const BLANK = { p: '' };
// Đầu văn bản: tên công ty + số văn bản | Quốc hiệu, tiêu ngữ, địa danh ngày tháng
const header = (noField, dateField) => ({ table: [
  [C('{cong_ty_hoa}', { bold: true, size: 12 }), C(`Số: {${noField}}`, { size: 12, before: 4 })],
  [C('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', { bold: true, size: 12 }), C('Độc lập - Tự do - Hạnh phúc', { bold: true, underline: true }),
    C(`{dia_danh}, {${dateField}}`, { italic: true, before: 6 })],
] });
const signs = (lt, lsub, lname, rt, rsub, rname) => ({ table: [
  [C(lt, { bold: true, before: 12 }), C(lsub, { italic: true, size: 12 }), BLANK, BLANK, BLANK, C(lname, { bold: true })],
  [C(rt, { bold: true, before: 12 }), C(rsub, { italic: true, size: 12 }), BLANK, BLANK, BLANK, C(rname, { bold: true })],
], widths: [4535, 4536] });
const partyA = (label = 'Bên A – Người sử dụng lao động') => [
  P(`**${label}:** {cong_ty}`), P('Địa chỉ: {dia_chi_cong_ty}'), P('Mã số thuế: {mst_cong_ty}\tĐiện thoại: {dien_thoai_cong_ty}', { tab: 9 }),
  P('Đại diện: Ông/Bà {dai_dien}\tChức vụ: {chuc_vu_dai_dien}', { tab: 9 }),
];
const partyB = (label = 'Bên B – Người lao động') => [
  P(`**${label}:** {xung_ho} {ho_ten}`, { before: 4 }),   // họ tên đứng riêng 1 dòng: tên dài không dính sang cột phải
  P('Mã nhân viên: {ma_nv}\tGiới tính: {gioi_tinh}', { tab: 9 }), P('Ngày sinh: {ngay_sinh}\tQuốc tịch: {quoc_tich}', { tab: 9 }),
  P('Điện thoại: {dien_thoai}'),
  P('Số CCCD/CMND: {cccd}\tCấp ngày: {ngay_cap}', { tab: 9 }), P('Nơi cấp: {noi_cap}'),
  P('Nơi cư trú: {dia_chi_thuong_tru}'), P('Chỗ ở hiện nay: {cho_o_hien_nay}'), P('Mã số thuế cá nhân: {mst_ca_nhan}\tSố sổ BHXH: {so_bhxh}', { tab: 9 }),
];
const LAW_BASE = [
  P('- Căn cứ Bộ luật Lao động số 45/2019/QH14 ngày 20 tháng 11 năm 2019;', { italic: true }),
  P('- Căn cứ Nghị định số 145/2020/NĐ-CP ngày 14 tháng 12 năm 2020 của Chính phủ quy định chi tiết và hướng dẫn thi hành một số điều của Bộ luật Lao động về điều kiện lao động và quan hệ lao động;', { italic: true }),
];

const TPL_HD_LAO_DONG = () => [
  header('so_hd', 'ngay_ky_chu'),
  C('HỢP ĐỒNG LAO ĐỘNG', { bold: true, size: 16, before: 18, after: 2 }), C('({loai_hd})', { italic: true, after: 10 }),
  ...LAW_BASE,
  P('- Căn cứ Thông tư số 10/2020/TT-BLĐTBXH ngày 12 tháng 11 năm 2020 của Bộ Lao động – Thương binh và Xã hội quy định nội dung của hợp đồng lao động;', { italic: true }),
  P('- Căn cứ nhu cầu và năng lực của hai bên,', { italic: true }),
  P('Hôm nay, {ngay_ky_chu}, tại {cong_ty}, chúng tôi gồm:', { before: 6 }),
  ...partyA(), ...partyB(),
  P('Hai bên thỏa thuận ký kết hợp đồng lao động và cam kết thực hiện đúng các điều khoản sau đây:', { before: 4 }),
  H('Điều 1. Công việc, địa điểm làm việc và thời hạn hợp đồng'),
  P('1. Loại hợp đồng: {loai_hd}.'), P('2. Thời hạn hợp đồng: {thoi_han}.'),
  P('3. Bộ phận: {bo_phan}. Chức danh / công việc: {chuc_danh}.'), P('4. Địa điểm làm việc: {noi_lam_viec}.'),
  P('5. Nhiệm vụ: thực hiện công việc theo chức danh, bản mô tả công việc và sự phân công, điều hành hợp pháp của người quản lý trực tiếp.'),
  H('Điều 2. Thời giờ làm việc, thời giờ nghỉ ngơi'),
  P('1. Thời giờ làm việc bình thường không quá 08 giờ/ngày và không quá 48 giờ/tuần, theo ca làm việc và nội quy lao động của Bên A (Điều 105 Bộ luật Lao động 2019).'),
  P('2. Làm thêm giờ: khi có nhu cầu và được Bên B đồng ý, trong giới hạn tại Điều 107 Bộ luật Lao động 2019; tiền lương làm thêm giờ trả theo Điều 98 Bộ luật Lao động 2019.'),
  P('3. Bên B được nghỉ hằng tuần, nghỉ lễ, tết, nghỉ hằng năm, nghỉ việc riêng có hưởng lương và nghỉ không hưởng lương theo các Điều 111 đến Điều 115 Bộ luật Lao động 2019 và nội quy lao động.'),
  H('Điều 3. Tiền lương, phụ cấp và hình thức trả lương'),
  P('1. Mức lương theo công việc hoặc chức danh: {luong} đồng/tháng (Bằng chữ: {luong_bang_chu}).'),
  P('2. Phụ cấp lương và các khoản bổ sung khác: {phu_cap}.'),
  P('3. Hình thức trả lương: chuyển khoản vào tài khoản số {so_tai_khoan} tại {ngan_hang}, hoặc tiền mặt.'),
  P('4. Kỳ hạn trả lương: mỗi tháng 01 lần, vào ngày …… hằng tháng. Trường hợp ngày trả lương trùng ngày nghỉ thì trả vào ngày làm việc liền kề.'),
  P('5. Chế độ nâng bậc, nâng lương: theo quy chế tiền lương, kết quả đánh giá công việc của Bên A và thỏa thuận của hai bên.'),
  H('Điều 4. Bảo hiểm xã hội, bảo hiểm y tế, bảo hiểm thất nghiệp'),
  P('1. Tiền lương làm căn cứ đóng bảo hiểm xã hội, bảo hiểm y tế, bảo hiểm thất nghiệp: {luong_bhxh} đồng/tháng.'),
  P('2. Bên A đóng phần thuộc trách nhiệm của người sử dụng lao động; Bên B đóng phần thuộc trách nhiệm của người lao động, Bên A trích từ tiền lương hằng tháng của Bên B để nộp cùng lúc theo quy định của pháp luật.'),
  H('Điều 5. Trang bị bảo hộ lao động; đào tạo, bồi dưỡng'),
  P('1. Bên B được trang bị phương tiện bảo vệ cá nhân phù hợp với công việc theo quy định về an toàn, vệ sinh lao động.'),
  P('2. Bên B được đào tạo, bồi dưỡng, nâng cao trình độ, kỹ năng nghề theo kế hoạch của Bên A; quyền lợi và nghĩa vụ khi được đào tạo thực hiện theo thỏa thuận riêng (nếu có).'),
  H('Điều 6. Quyền và nghĩa vụ của Bên B'),
  P('1. Quyền: được bố trí công việc, trả lương đầy đủ, đúng hạn; hưởng các chế độ theo hợp đồng, nội quy lao động và quy định của pháp luật; đơn phương chấm dứt hợp đồng theo Điều 35 Bộ luật Lao động 2019.'),
  P('2. Nghĩa vụ: hoàn thành công việc được giao; chấp hành nội quy lao động, quy chế và sự điều hành hợp pháp của Bên A; bảo vệ tài sản, giữ bí mật kinh doanh, công nghệ của Bên A; bồi thường thiệt hại khi vi phạm theo quy định.'),
  H('Điều 7. Quyền và nghĩa vụ của Bên A'),
  P('1. Quyền: điều hành, bố trí công việc theo hợp đồng; khen thưởng, xử lý kỷ luật lao động theo nội quy lao động; đơn phương chấm dứt hợp đồng theo Điều 36 Bộ luật Lao động 2019.'),
  P('2. Nghĩa vụ: bảo đảm việc làm và điều kiện làm việc theo hợp đồng; trả lương đầy đủ, đúng hạn; đóng bảo hiểm xã hội, bảo hiểm y tế, bảo hiểm thất nghiệp cho Bên B; thực hiện đầy đủ các chế độ theo quy định của pháp luật.'),
  H('Điều 8. Điều khoản thi hành'),
  P('1. Những vấn đề về lao động không ghi trong hợp đồng này được thực hiện theo nội quy lao động, thỏa ước lao động tập thể (nếu có) và quy định của pháp luật lao động.'),
  P('2. Phụ lục hợp đồng do hai bên ký kết là một bộ phận của hợp đồng này.'),
  P('3. Hợp đồng được lập thành 02 bản có giá trị pháp lý như nhau, mỗi bên giữ 01 bản và có hiệu lực kể từ ngày {tu_ngay}.'),
  signs('NGƯỜI LAO ĐỘNG', '(Ký, ghi rõ họ tên)', '{ho_ten}', 'NGƯỜI SỬ DỤNG LAO ĐỘNG', '(Ký, ghi rõ họ tên, đóng dấu)', '{dai_dien}'),
];

const TPL_HD_THU_VIEC = () => [
  header('so_hd', 'ngay_ky_chu'),
  C('HỢP ĐỒNG THỬ VIỆC', { bold: true, size: 16, before: 18, after: 10 }),
  ...LAW_BASE,
  P('- Căn cứ nhu cầu tuyển dụng của Bên A và đề nghị của người lao động,', { italic: true }),
  P('Hôm nay, {ngay_ky_chu}, tại {cong_ty}, chúng tôi gồm:', { before: 6 }),
  ...partyA(), ...partyB(),
  P('Hai bên thỏa thuận ký kết hợp đồng thử việc với các điều khoản sau đây (Điều 24 đến Điều 27 Bộ luật Lao động 2019):', { before: 4 }),
  H('Điều 1. Công việc, địa điểm và thời gian thử việc'),
  P('1. Bộ phận: {bo_phan}. Chức danh / công việc thử việc: {chuc_danh}.'), P('2. Địa điểm làm việc: {noi_lam_viec}.'),
  P('3. Thời gian thử việc: {thoi_han}.'),
  P('Thời gian thử việc không quá 180 ngày đối với người quản lý doanh nghiệp; 60 ngày đối với công việc cần trình độ cao đẳng trở lên; 30 ngày đối với công việc cần trình độ trung cấp, công nhân kỹ thuật, nhân viên nghiệp vụ; 06 ngày làm việc đối với công việc khác (Điều 25). Mỗi công việc chỉ được thử việc 01 lần.', { italic: true, size: 12 }),
  H('Điều 2. Thời giờ làm việc, thời giờ nghỉ ngơi'),
  P('Thực hiện theo nội quy lao động của Bên A, không quá 08 giờ/ngày và 48 giờ/tuần.'),
  H('Điều 3. Tiền lương thử việc'),
  P('1. Mức lương thử việc: {luong} đồng/tháng (Bằng chữ: {luong_bang_chu}), không thấp hơn 85% mức lương của công việc đó (Điều 26 Bộ luật Lao động 2019).'),
  P('2. Phụ cấp và các khoản bổ sung khác: {phu_cap}.'),
  P('3. Hình thức trả lương: chuyển khoản vào tài khoản số {so_tai_khoan} tại {ngan_hang}, hoặc tiền mặt; trả cùng kỳ lương của Bên A.'),
  H('Điều 4. Kết thúc thời gian thử việc'),
  P('1. Khi kết thúc thời gian thử việc, Bên A thông báo kết quả thử việc cho Bên B (Điều 27 Bộ luật Lao động 2019).'),
  P('2. Trường hợp thử việc đạt yêu cầu, hai bên giao kết hợp đồng lao động. Trường hợp không đạt yêu cầu thì chấm dứt hợp đồng thử việc.'),
  P('3. Trong thời gian thử việc, mỗi bên có quyền hủy bỏ hợp đồng thử việc mà không cần báo trước và không phải bồi thường.'),
  H('Điều 5. Quyền và nghĩa vụ của hai bên'),
  P('1. Bên B hoàn thành công việc được giao, chấp hành nội quy lao động và sự điều hành hợp pháp của Bên A; được trả lương thử việc đầy đủ, đúng hạn.'),
  P('2. Bên A bố trí công việc, hướng dẫn, đánh giá kết quả thử việc và trả lương thử việc theo hợp đồng này.'),
  H('Điều 6. Điều khoản thi hành'),
  P('Hợp đồng được lập thành 02 bản có giá trị pháp lý như nhau, mỗi bên giữ 01 bản và có hiệu lực kể từ ngày {tu_ngay}.'),
  signs('NGƯỜI LAO ĐỘNG', '(Ký, ghi rõ họ tên)', '{ho_ten}', 'NGƯỜI SỬ DỤNG LAO ĐỘNG', '(Ký, ghi rõ họ tên, đóng dấu)', '{dai_dien}'),
];

const TPL_HD_DICH_VU = () => [
  header('so_hd', 'ngay_ky_chu'),
  C('HỢP ĐỒNG DỊCH VỤ', { bold: true, size: 16, before: 18, after: 10 }),
  P('- Căn cứ Bộ luật Dân sự số 91/2015/QH13 ngày 24 tháng 11 năm 2015 (Điều 513 đến Điều 521 về hợp đồng dịch vụ);', { italic: true }),
  P('- Căn cứ nhu cầu và khả năng của hai bên,', { italic: true }),
  P('Hôm nay, {ngay_ky_chu}, chúng tôi gồm:', { before: 6 }),
  ...partyA('Bên A – Bên thuê dịch vụ'), ...partyB('Bên B – Bên cung ứng dịch vụ'),
  P('Hai bên thỏa thuận ký kết hợp đồng dịch vụ với các điều khoản sau đây:', { before: 4 }),
  H('Điều 1. Nội dung công việc'),
  P('Bên B thực hiện cho Bên A công việc: {chuc_danh} (bộ phận {bo_phan}), tại {noi_lam_viec}. Bên B tự chủ về cách thức thực hiện và chịu trách nhiệm về kết quả công việc.'),
  H('Điều 2. Thời hạn hợp đồng'), P('{thoi_han}.'),
  H('Điều 3. Thù lao và phương thức thanh toán'),
  P('1. Thù lao: {luong} đồng/tháng (Bằng chữ: {luong_bang_chu}). Khoản khác (nếu có): {phu_cap}.'),
  P('2. Thanh toán bằng chuyển khoản vào tài khoản số {so_tai_khoan} tại {ngan_hang}, hoặc tiền mặt, sau khi nghiệm thu kết quả công việc.'),
  P('3. Bên A khấu trừ thuế thu nhập cá nhân của Bên B (nếu có) theo quy định của pháp luật về thuế.'),
  H('Điều 4. Quyền và nghĩa vụ của Bên A'),
  P('Cung cấp thông tin, tài liệu và phương tiện cần thiết để Bên B thực hiện công việc; thanh toán thù lao đầy đủ, đúng hạn; có quyền yêu cầu Bên B thực hiện đúng chất lượng, số lượng, thời hạn đã thỏa thuận (Điều 515, 516 Bộ luật Dân sự 2015).'),
  H('Điều 5. Quyền và nghĩa vụ của Bên B'),
  P('Thực hiện công việc đúng chất lượng, số lượng, thời hạn và các thỏa thuận khác; không giao cho người khác làm thay khi chưa được Bên A đồng ý; bảo quản tài liệu, phương tiện được giao; giữ bí mật thông tin (Điều 517, 518 Bộ luật Dân sự 2015).'),
  H('Điều 6. Đơn phương chấm dứt hợp đồng'),
  P('Mỗi bên có quyền đơn phương chấm dứt hợp đồng theo Điều 520 Bộ luật Dân sự 2015, nhưng phải báo trước cho bên kia một thời gian hợp lý và bồi thường thiệt hại (nếu có).'),
  H('Điều 7. Điều khoản chung'),
  P('Hợp đồng này là hợp đồng dân sự, không phải hợp đồng lao động. Hợp đồng được lập thành 02 bản có giá trị pháp lý như nhau, mỗi bên giữ 01 bản và có hiệu lực kể từ ngày {tu_ngay}.'),
  signs('BÊN B', '(Ký, ghi rõ họ tên)', '{ho_ten}', 'BÊN A', '(Ký, ghi rõ họ tên, đóng dấu)', '{dai_dien}'),
];

const TPL_PHU_LUC = () => [
  header('so_phu_luc', 'ngay_ky_pl_chu'),
  C('PHỤ LỤC HỢP ĐỒNG LAO ĐỘNG', { bold: true, size: 16, before: 18, after: 10 }),
  P('- Căn cứ Bộ luật Lao động số 45/2019/QH14 ngày 20 tháng 11 năm 2019 (Điều 22 về phụ lục hợp đồng lao động);', { italic: true }),
  P('- Căn cứ Hợp đồng lao động số {so_hd} ký ngày {ngay_ky_hd} giữa {cong_ty} và {xung_ho} {ho_ten};', { italic: true }),
  P('- Căn cứ nhu cầu công việc và thỏa thuận của hai bên,', { italic: true }),
  P('Hôm nay, {ngay_ky_pl_chu}, chúng tôi gồm:', { before: 6 }),
  ...partyA(),
  P('**Bên B – Người lao động:** {xung_ho} {ho_ten}', { before: 4 }),
  P('Mã nhân viên: {ma_nv}\tNgày sinh: {ngay_sinh}', { tab: 9 }),
  P('Số CCCD/CMND: {cccd}\tCấp ngày: {ngay_cap}', { tab: 9 }),
  P('Hai bên thỏa thuận sửa đổi, bổ sung hợp đồng lao động số {so_hd} như sau:', { before: 4 }),
  H('Điều 1. Nội dung sửa đổi, bổ sung'),
  P('1. Chức danh / công việc: {chuc_danh_moi}.'), P('2. Mức lương: {luong_moi}.'), P('3. Nội dung khác: {noi_dung}.'),
  H('Điều 2. Thời gian thực hiện'),
  P('Phụ lục này có hiệu lực kể từ ngày {ngay_hieu_luc}. Các điều khoản khác của hợp đồng lao động số {so_hd} giữ nguyên. Phụ lục không sửa đổi thời hạn của hợp đồng lao động (khoản 2 Điều 22 Bộ luật Lao động 2019).'),
  P('Phụ lục là một bộ phận không tách rời của hợp đồng lao động, được lập thành 02 bản có giá trị như nhau, mỗi bên giữ 01 bản.'),
  signs('NGƯỜI LAO ĐỘNG', '(Ký, ghi rõ họ tên)', '{ho_ten}', 'NGƯỜI SỬ DỤNG LAO ĐỘNG', '(Ký, ghi rõ họ tên, đóng dấu)', '{dai_dien}'),
];

const decisionSigns = () => ({ table: [
  [P('**Nơi nhận:**', { italic: true, size: 12, before: 12, align: 'left' }), P('- Như Điều 3;', { size: 11, align: 'left', after: 0 }), P('- Lưu: Hành chính – Nhân sự.', { size: 11, align: 'left' })],
  [C('{chuc_vu_dai_dien_hoa}', { bold: true, before: 12 }), C('(Ký, ghi rõ họ tên, đóng dấu)', { italic: true, size: 12 }), BLANK, BLANK, BLANK, C('{nguoi_ky}', { bold: true })],
], widths: [4000, 5071] });

const TPL_QD_THUYEN_CHUYEN = () => [
  header('so_qd', 'ngay_qd_chu'),
  C('QUYẾT ĐỊNH', { bold: true, size: 14, before: 12, after: 0 }), C('Về việc {loai_qd_thuong} nhân sự', { bold: true, after: 2 }),
  C('______________', { after: 4 }),
  C('{chuc_vu_dai_dien_hoa} {cong_ty_hoa}', { bold: true, after: 8 }),
  P('- Căn cứ Bộ luật Lao động số 45/2019/QH14 ngày 20 tháng 11 năm 2019;', { italic: true }),
  P('- Căn cứ Điều lệ tổ chức và hoạt động của {cong_ty};', { italic: true }),
  P('- Căn cứ hợp đồng lao động đã ký với người lao động và nội quy lao động của công ty;', { italic: true }),
  P('- Căn cứ nhu cầu công việc và năng lực của nhân viên,', { italic: true }),
  C('QUYẾT ĐỊNH:', { bold: true, before: 6, after: 4 }),
  P('**Điều 1.** {loai_qd} {xung_ho} {ho_ten}, mã nhân viên {ma_nv}, hiện đang làm việc tại bộ phận {bo_phan_cu}, chức danh {chuc_danh_cu}, đến nhận nhiệm vụ tại bộ phận {bo_phan_moi}, chức danh {chuc_danh_moi}, kể từ ngày {ngay_hieu_luc}.', { indent: true }),
  P('Lý do: {ly_do}.', { indent: true }),
  P('**Điều 2.** Tiền lương và các chế độ khác của {xung_ho} {ho_ten} thực hiện theo hợp đồng lao động, phụ lục hợp đồng (nếu có) và quy chế của công ty.', { indent: true }),
  P('**Điều 3.** Bộ phận Hành chính – Nhân sự, Kế toán, các bộ phận có liên quan và {xung_ho} {ho_ten} chịu trách nhiệm thi hành Quyết định này. Quyết định có hiệu lực kể từ ngày {ngay_hieu_luc}.', { indent: true }),
  decisionSigns(),
];

const TPL_QD_NGHI_VIEC = () => [
  header('so_qd', 'ngay_qd_chu'),
  C('QUYẾT ĐỊNH', { bold: true, size: 14, before: 12, after: 0 }), C('{tieu_de_qd_nghi}', { bold: true, after: 2 }),
  C('______________', { after: 4 }),
  C('{chuc_vu_dai_dien_hoa} {cong_ty_hoa}', { bold: true, after: 8 }),
  P('- Căn cứ Bộ luật Lao động số 45/2019/QH14 ngày 20 tháng 11 năm 2019;', { italic: true }),
  P('- Căn cứ Điều lệ tổ chức và hoạt động của {cong_ty};', { italic: true }),
  P('- Căn cứ Hợp đồng lao động số {so_hd} ký ngày {ngay_ky_hd};', { italic: true }),
  P('- Căn cứ {can_cu_nghi},', { italic: true }),
  C('QUYẾT ĐỊNH:', { bold: true, before: 6, after: 4 }),
  P('**Điều 1.** Chấm dứt hợp đồng lao động đối với {xung_ho} {ho_ten}, mã nhân viên {ma_nv}, chức danh {chuc_danh}, bộ phận {bo_phan}. {xung_ho} {ho_ten} được nghỉ việc kể từ ngày {ngay_nghi} (ngày làm việc cuối cùng: {ngay_lam_cuoi}).', { indent: true }),
  P('Hình thức: {hinh_thuc_nghi}. Lý do: {ly_do}.', { indent: true }),
  P('**Điều 2.** {xung_ho} {ho_ten} có trách nhiệm bàn giao đầy đủ công việc, tài sản, hồ sơ, tài liệu trước ngày nghỉ việc:', { indent: true }),
  P('{viec_ban_giao}', { align: 'left', left: 1 }),   // căn TRÁI, thụt cả khối: mỗi việc 1 dòng, không bị dàn chữ
  P('Công ty có trách nhiệm thanh toán đầy đủ tiền lương và các khoản liên quan đến quyền lợi của người lao động trong thời hạn 14 ngày làm việc kể từ ngày chấm dứt hợp đồng lao động; hoàn thành thủ tục xác nhận thời gian đóng bảo hiểm xã hội, bảo hiểm thất nghiệp và trả lại giấy tờ bản chính (nếu có) cho người lao động (Điều 48 Bộ luật Lao động 2019).', { indent: true }),
  P('**Điều 3.** Bộ phận Hành chính – Nhân sự, Kế toán, các bộ phận có liên quan và {xung_ho} {ho_ten} chịu trách nhiệm thi hành Quyết định này. Quyết định có hiệu lực kể từ ngày ký.', { indent: true }),
  decisionSigns(),
];

// Quyết định: giãn dòng ĐƠN (Nghị định 30/2020 cho phép từ dòng đơn đến 1,5 dòng) → gọn 1 trang, chữ ký không bị đẩy sang trang 2
const single = (tpl) => () => tpl().map((b) => (b.table ? { ...b, table: b.table.map((col) => col.map((x) => ({ line: 240, ...x }))) } : { line: 240, ...b }));
const TPL_BLOCKS = {
  hd_thu_viec: TPL_HD_THU_VIEC, hd_lao_dong: TPL_HD_LAO_DONG, hd_dich_vu: TPL_HD_DICH_VU,
  phu_luc: TPL_PHU_LUC, qd_thuyen_chuyen: single(TPL_QD_THUYEN_CHUYEN), qd_nghi_viec: single(TPL_QD_NGHI_VIEC),
};
export const defaultTemplateBlocks = (key) => (TPL_BLOCKS[key] ? TPL_BLOCKS[key]() : null);
