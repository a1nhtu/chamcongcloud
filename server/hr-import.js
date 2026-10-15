// PHÂN HỆ NHÂN SỰ — NHẬP EXCEL hồ sơ / hợp đồng: các hàm THUẦN đọc ô Excel (không đụng CSDL → test độc lập).
// Cột được nhận theo TIÊU ĐỀ (không theo vị trí) → người dùng đổi thứ tự / xoá bớt cột vẫn nhập được,
// và nhập lại được chính file "Xuất Excel" của trang Hồ sơ / Hợp đồng.
import { HR_FIELDS, CONTRACT_TYPES, isDate } from './hr-rules.js';

// Bỏ dấu, chữ thường, gọn khoảng trắng, bỏ dấu * (cột bắt buộc)
export const normText = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
  .toLowerCase().replace(/\*/g, '').replace(/\s+/g, ' ').trim();

// Giá trị thô của 1 ô ExcelJS (rich text, công thức, link…) → string | number | Date | ''
export function cellRaw(v) {
  if (v == null) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return cellRaw(v.result);
    if ('text' in v) return cellRaw(v.text);
    if ('error' in v) return '';
    return '';
  }
  return v;
}
export const cellText = (v) => { const r = cellRaw(v); return r instanceof Date ? r.toISOString().slice(0, 10) : String(r).trim(); };

const pad = (n) => String(n).padStart(2, '0');
// Ngày: ô ngày Excel (Date / số serial) hoặc chữ dd/mm/yyyy, d-m-yyyy, dd.mm.yyyy, yyyy-mm-dd.
// Trả 'YYYY-MM-DD'; '' nếu ô trống; null nếu không hiểu được.
export function parseDateCell(v) {
  const r = cellRaw(v);
  if (r === '' || r == null) return '';
  if (r instanceof Date) return isNaN(r) ? null : `${r.getUTCFullYear()}-${pad(r.getUTCMonth() + 1)}-${pad(r.getUTCDate())}`;
  if (typeof r === 'number') {
    if (!(r > 1 && r < 2958466)) return null;   // số serial ngày của Excel (1900 → 9999)
    const d = new Date(Math.round((r - 25569) * 86400000));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = String(r).trim();
  let m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  let out = m ? `${m[3]}-${pad(m[2])}-${pad(m[1])}` : null;
  if (!out) { m = s.match(/^(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})$/); if (m) out = `${m[1]}-${pad(m[2])}-${pad(m[3])}`; }
  if (!out || !isDate(out)) return null;
  const [y, mo, d] = out.split('-').map(Number);
  const back = new Date(Date.UTC(y, mo - 1, d));
  return back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? out : null;   // chặn 31/02
}
// Tiền: số giữ nguyên; chữ "7.500.000" / "7,500,000 đ" → bỏ mọi ký tự không phải số
export function parseMoneyCell(v) {
  const r = cellRaw(v);
  if (typeof r === 'number') return r > 0 ? Math.round(r) : 0;
  const n = Number(String(r).replace(/\D/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}
// Loại hợp đồng từ chữ: nhận tên đầy đủ, tên ngắn ("Thử việc", "Xác định thời hạn", "1 năm"…) hoặc mã
export function mapContractType(v) {
  const t = normText(cellText(v));
  if (!t) return '';
  if (CONTRACT_TYPES.some(([k]) => k === t)) return t;
  if (t.includes('thu viec')) return 'thu_viec';
  if (t.includes('khong xac dinh') || t.includes('khong thoi han') || t === 'kxd' || t === 'kxdth') return 'khong_xac_dinh';
  if (t.includes('xac dinh') || t === 'xd' || t === 'xdth' || /^\d+ (thang|nam)$/.test(t) || t.includes('co thoi han')) return 'xac_dinh';
  if (t.includes('dich vu') || t.includes('cong tac vien') || t === 'ctv' || t.includes('khoan viec')) return 'dich_vu';
  return null;
}
// Chọn đúng 1 lựa chọn (không phân biệt hoa thường / dấu) — null nếu không khớp
export function matchOption(v, options) {
  const t = normText(cellText(v));
  if (!t) return '';
  return options.find((o) => normText(o) === t) || null;
}
// Chuẩn hoá ô số giấy tờ: Excel hay biến "001195012345" thành số 1195012345 (mất số 0 đầu)
export function fixIdNumber(v) {
  const r = cellRaw(v);
  let s = typeof r === 'number' ? String(Math.round(r)) : cellText(r).replace(/\s+/g, '');
  if (typeof r === 'number' && (s.length === 11 || s.length === 8)) s = '0' + s;   // CCCD 12 số / CMND 9 số
  return s;
}
export function fixPhone(v) {
  const r = cellRaw(v);
  let s = typeof r === 'number' ? String(Math.round(r)) : cellText(r);
  if (typeof r === 'number' && s.length === 9) s = '0' + s;
  return s;
}

// ---------- Cột của file mẫu ----------
// [key, tiêu đề trong file mẫu, các tên khác được chấp nhận (đã normText)]
export const PROFILE_COLS = [
  ['code', 'Mã NV *', ['ma nv', 'ma nhan vien']],
  ['full_name', 'Họ tên', ['ho ten', 'ho va ten']],
  ['department', 'Bộ phận', ['bo phan', 'phong ban']],
  ['position', 'Chức danh', ['chuc danh', 'chuc vu']],
  ['phone', 'SĐT', ['sdt', 'so dien thoai', 'dien thoai']],
  ['start_date', 'Ngày vào làm', ['ngay vao lam']],
  ...HR_FIELDS.map(([k, label]) => (k === 'manager_id'
    ? [k, 'Quản lý trực tiếp (mã NV)', ['quan ly truc tiep (ma nv)', 'quan ly truc tiep']]
    : [k, label, [normText(label)]])),
];
export const CONTRACT_COLS_X = [
  ['code', 'Mã NV *', ['ma nv', 'ma nhan vien']],
  ['contract_no', 'Số HĐ', ['so hd', 'so hop dong']],
  ['ctype', 'Loại HĐ *', ['loai hd', 'loai hop dong']],
  ['sign_date', 'Ngày ký', ['ngay ky']],
  ['start_date', 'Hiệu lực từ *', ['hieu luc tu', 'tu ngay', 'ngay hieu luc', 'ngay bat dau']],
  ['end_date', 'Đến ngày', ['den ngay', 'ngay het han']],
  ['term_months', 'Thời hạn (tháng)', ['thoi han (thang)', 'thoi han', 'so thang']],
  ['department', 'Bộ phận', ['bo phan']],
  ['position', 'Chức danh', ['chuc danh']],
  ['work_place', 'Nơi làm việc', ['noi lam viec', 'dia diem lam viec']],
  ['salary', 'Lương thoả thuận', ['luong thoa thuan', 'luong', 'muc luong']],
  ['insurance_salary', 'Lương đóng BHXH', ['luong dong bhxh', 'luong bhxh']],
  ['allowance', 'Phụ cấp', ['phu cap']],
  ['signer', 'Người ký', ['nguoi ky', 'nguoi dai dien ky']],
  ['note', 'Ghi chú', ['ghi chu']],
];
// Dò dòng tiêu đề (1 trong 5 dòng đầu, dòng có cột "Mã NV") → Map key → số cột
export function headerMap(rows, cols) {
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const map = new Map();
    (rows[i] || []).forEach((v, c) => {
      const t = normText(cellText(v));
      if (!t) return;
      const col = cols.find(([, label, alts]) => normText(label) === t || alts.includes(t));
      if (col && !map.has(col[0])) map.set(col[0], c);
    });
    if (map.has('code')) return { map, headerRow: i };
  }
  return null;
}
