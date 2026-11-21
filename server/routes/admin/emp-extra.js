// THÔNG TIN THÊM CỦA NHÂN VIÊN (CCCD, quê quán, liên hệ, học vấn, ngân hàng, gia cảnh / người phụ thuộc)
// — tab "🧾 Thông tin thêm" trong form Sửa nhân viên. Dùng CHUNG bảng hr_profiles + hr_family với phân hệ Nhân sự
// (bật Nhân sự sau này vẫn thấy đủ dữ liệu đã nhập), nhưng có công tắc RIÊNG `emp_extra_info`:
//   mặc định TẮT (= như cũ: không có tab, API trả 403) · chỉ tài khoản tổng bật (Cài đặt → Cấu hình hiển thị)
//   · người dùng cần quyền "Nhân viên" (employees), không cần quyền Nhân sự.
import ExcelJS from 'exceljs';
import { db, getSetting } from '../../db.js';
import { sendCaughtError } from '../../util.js';
import { HR_FIELDS, cleanProfile, isDate, dmy } from '../../hr-rules.js';
import { profileOf, saveProfile, adminGuard, getEmp, who } from './hr.js';

export const extraEnabled = () => getSetting('emp_extra_info', '0') === '1';
function extraGate(req, res, next) {
  if (extraEnabled()) return next();
  res.status(403).json({ error: 'Chức năng "Thông tin thêm của nhân viên" chưa được bật (chỉ tài khoản tổng bật được trong Cài đặt).' });
}

// Trường hiện ở tab: bỏ các trường chỉ phân hệ Nhân sự dùng (quản lý trực tiếp, tính chất lao động, ngày thử việc / chính thức…)
const SKIP = new Set(['manager_id', 'emp_type', 'probation_date', 'official_date', 'work_location']);
export const EXTRA_GROUPS = [
  ['chung', 'Thông tin cơ bản'],
  ['lienhe', 'Địa chỉ & liên hệ'],
  ['hocvan', 'Học vấn'],
  ['nganhang', 'Tài khoản ngân hàng'],
  ['congviec', 'Ghi chú'],
];
export const EXTRA_FIELDS = HR_FIELDS.filter(([k]) => !SKIP.has(k)).map((f) => (f[0] === 'hr_note' ? [f[0], 'Ghi chú', f[2], f[3]] : f));
const EXTRA_KEYS = new Set(EXTRA_FIELDS.map((f) => f[0]));
export const RELATIONS = ['Bố', 'Mẹ', 'Vợ', 'Chồng', 'Con', 'Anh', 'Chị', 'Em', 'Ông', 'Bà', 'Khác'];

const str = (v, n = 200) => (v == null ? '' : String(v).trim().slice(0, n));
// Gia cảnh gửi lên: bỏ dòng không có họ tên, tối đa 30 người
export function cleanFamily(list) {
  if (!Array.isArray(list)) return null;
  return list.map((x) => ({
    full_name: str(x?.full_name, 120), relation: str(x?.relation, 40), birth_date: isDate(x?.birth_date) ? x.birth_date : '',
    phone: str(x?.phone, 30), job: str(x?.job, 120), dependent: x?.dependent ? 1 : 0, note: str(x?.note, 300),
  })).filter((x) => x.full_name).slice(0, 30);
}

export function registerEmpExtraRoutes(r, { need }) {
  const g = [extraGate, need('employees')];

  // Khung trống cho form THÊM MỚI nhân viên (chưa có id): nhóm, trường, quan hệ — lưu sau khi tạo NV bằng PUT /employees/:id/extra
  r.get('/employees/extra/meta', g, (req, res) => {
    const profile = {};
    for (const k of EXTRA_KEYS) profile[k] = '';
    res.json({ groups: EXTRA_GROUPS, fields: EXTRA_FIELDS, relations: RELATIONS, profile, family: [], updated_by: '', updated_at: '' });
  });

  r.get('/employees/:id/extra', g, (req, res) => {
    const e = getEmp(req.params.id);
    if (!e) return res.status(404).json({ error: 'Không tìm thấy nhân viên' });
    const p = profileOf(e.id);
    const profile = {};
    for (const k of EXTRA_KEYS) profile[k] = p[k] || '';
    res.json({
      groups: EXTRA_GROUPS, fields: EXTRA_FIELDS, relations: RELATIONS, profile,
      family: db.prepare('SELECT id, full_name, relation, birth_date, phone, job, dependent, note FROM hr_family WHERE employee_id = ? ORDER BY id').all(e.id),
      updated_by: p.updated_by || '', updated_at: p.updated_at || '',
    });
  });

  // Lưu: {profile:{…}, family:[…]} — family gửi lên = THAY cả danh sách gia cảnh của NV
  r.put('/employees/:id/extra', g, (req, res) => {
    const e = getEmp(req.params.id);
    if (!e) return res.status(404).json({ error: 'Không tìm thấy nhân viên' });
    const ag = adminGuard(req, e); if (ag) return res.status(403).json({ error: ag });
    const b = req.body || {};
    const f = cleanProfile(b.profile || {});
    for (const k of Object.keys(f)) if (!EXTRA_KEYS.has(k)) delete f[k];
    const fam = cleanFamily(b.family);
    try {
      db.exec('BEGIN');
      if (Object.keys(f).length) saveProfile(e.id, f, who(req));
      if (fam) {
        db.prepare('DELETE FROM hr_family WHERE employee_id = ?').run(e.id);
        const ins = db.prepare('INSERT INTO hr_family (employee_id, full_name, relation, birth_date, phone, job, dependent, note) VALUES (?,?,?,?,?,?,?,?)');
        for (const x of fam) ins.run(e.id, x.full_name, x.relation, x.birth_date, x.phone, x.job, x.dependent, x.note);
      }
      db.exec('COMMIT');
      res.json({ ok: true, dependents: fam ? fam.filter((x) => x.dependent).length : undefined });
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* đã rollback */ }
      sendCaughtError(res, 'PUT /admin/employees/:id/extra', err);
    }
  });

  // Xuất Excel: sheet Thông tin thêm (1 NV / dòng) + sheet Gia cảnh (1 người thân / dòng)
  r.get('/employees/extra/export.xlsx', g, async (req, res) => {
    try {
      const emps = db.prepare("SELECT id, code, full_name, department, position, phone, active FROM employees WHERE IFNULL(audit_only,0) = 0 AND role <> 'master' ORDER BY active DESC, department, full_name").all();
      const profs = new Map(db.prepare('SELECT * FROM hr_profiles').all().map((p) => [p.employee_id, p]));
      const fams = db.prepare('SELECT * FROM hr_family ORDER BY employee_id, id').all();
      const dep = new Map();
      for (const x of fams) if (x.dependent) dep.set(x.employee_id, (dep.get(x.employee_id) || 0) + 1);
      const wb = new ExcelJS.Workbook();
      const head = (ws, widths) => {
        const h = ws.getRow(1);
        h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        h.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8541E' } }; c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; });
        ws.columns.forEach((c, i) => { c.width = widths[i] || 18; });
        ws.views = [{ state: 'frozen', ySplit: 1, xSplit: 2 }];
      };
      const ws = wb.addWorksheet('ThongTinThem');
      ws.addRow(['Mã NV', 'Họ tên', 'Bộ phận', 'Chức danh', 'SĐT', 'Trạng thái', ...EXTRA_FIELDS.map((f) => f[1]), 'Số người phụ thuộc']);
      for (const e of emps) {
        const p = profs.get(e.id) || {};
        ws.addRow([e.code, e.full_name, e.department || '', e.position || '', e.phone || '', e.active ? 'Đang làm' : 'Đã khoá',
          ...EXTRA_FIELDS.map(([k, , t]) => (t === 'date' ? dmy(p[k]) : p[k] || '')), dep.get(e.id) || 0]);
      }
      head(ws, [10, 24, 18, 18, 13, 10]);
      const byId = new Map(emps.map((e) => [e.id, e]));
      const wf = wb.addWorksheet('GiaCanh');
      wf.addRow(['Mã NV', 'Họ tên NV', 'Họ tên người thân', 'Quan hệ', 'Ngày sinh', 'SĐT', 'Nghề nghiệp', 'Người phụ thuộc (giảm trừ)', 'Ghi chú']);
      for (const x of fams) {
        const e = byId.get(x.employee_id); if (!e) continue;
        wf.addRow([e.code, e.full_name, x.full_name, x.relation, dmy(x.birth_date), x.phone, x.job, x.dependent ? 'Có' : '', x.note]);
      }
      head(wf, [10, 24, 24, 10, 12, 13, 18, 14, 24]);
      const d = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="thong_tin_them_nhan_vien_${d}.xlsx"`);
      await wb.xlsx.write(res);
      res.end();
    } catch (err) { sendCaughtError(res, 'GET /admin/employees/extra/export.xlsx', err); }
  });
}

/* ===== Excel NHÂN VIÊN (File mẫu · Xuất danh sách · Nhập mới / Cập nhật từ Excel) khi BẬT công tắc =====
 * Tắt công tắc: các file y như cũ (10 cột), cột lạ trong file nhập bị bỏ qua.
 * Bật: sheet đầu thêm các cột thông tin thêm SAU các cột cũ (nhận theo TÊN CỘT ở dòng 1, không theo vị trí),
 * thêm sheet "GiaCanh" (1 người thân / dòng, theo Mã NV). Nhập: ô trống = giữ nguyên; NV có dòng ở GiaCanh thì
 * danh sách gia cảnh được THAY bằng các dòng trong file (NV không có dòng nào → giữ nguyên). */
const XL_LABEL = { emergency_relation: 'Quan hệ (liên hệ khẩn cấp)', hr_note: 'Ghi chú hồ sơ' };
const xlLabel = (f) => XL_LABEL[f[0]] || f[1];
export const extraXlHeads = () => EXTRA_FIELDS.map(xlLabel);
export const extraXlRow = (p = {}) => EXTRA_FIELDS.map(([k, , t]) => (t === 'date' ? dmy(p[k]) : p[k] || ''));
export const FAM_XL_HEAD = ['Mã NV', 'Họ tên NV', 'Họ tên người thân', 'Quan hệ', 'Ngày sinh', 'SĐT', 'Nghề nghiệp', 'Người phụ thuộc (giảm trừ)', 'Ghi chú'];
const normH = (s) => String(s || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

// Giá trị ô Excel → chuỗi (rich text, công thức, liên kết, ngày)
export function xlText(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((x) => x.text || '').join('').trim();
    if (v.result != null) return xlText(v.result);
    if (v.text != null) return xlText(v.text);
    return '';
  }
  return String(v).trim();
}
// Ô ngày: ô kiểu ngày của Excel, số seri, 'dd/mm/yyyy', 'd-m-yyyy', 'yyyy-mm-dd'. Trả 'YYYY-MM-DD', '' (trống) hoặc null (sai)
export function xlDate(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) return isNaN(v) ? null : v.toISOString().slice(0, 10);
  if (typeof v === 'number') { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000); return v > 0 && !isNaN(d) ? d.toISOString().slice(0, 10) : null; }
  const s = xlText(v);
  if (!s) return '';
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  let y, mo, d;
  if (m) [, y, mo, d] = m; else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) [, d, mo, y] = m; else return null;
  const out = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isDate(out) && new Date(out + 'T00:00:00Z').getUTCDate() === +d ? out : null;
}

// Thêm cột thông tin thêm vào sheet NV (dòng tiêu đề đã có) — định dạng chữ để CCCD / số TK không mất số 0 đầu
export function styleExtraCols(ws, fromCol) {
  EXTRA_FIELDS.forEach(([, , t], i) => {
    const c = ws.getColumn(fromCol + i);
    c.width = t === 'textarea' ? 28 : 16;
    if (t !== 'date') c.numFmt = '@';
  });
  ws.getRow(1).eachCell((c, n) => { if (n >= fromCol) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8541E' } }; });
}
export function addFamilySheet(wb, rows) {
  const wf = wb.addWorksheet('GiaCanh');
  wf.addRow(FAM_XL_HEAD);
  for (const r of rows) wf.addRow(r);
  const h = wf.getRow(1);
  h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  h.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8541E' } }; c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; });
  [10, 24, 24, 10, 12, 13, 18, 14, 24].forEach((w, i) => { wf.getColumn(i + 1).width = w; });
  wf.getColumn(1).numFmt = '@'; wf.getColumn(6).numFmt = '@';
  wf.views = [{ state: 'frozen', ySplit: 1 }];
  return wf;
}
// Gia cảnh của các NV (đã sắp theo NV) → các dòng sheet GiaCanh
export function familyXlRows(empIds) {
  const want = new Set(empIds);
  const emps = new Map(db.prepare('SELECT id, code, full_name FROM employees').all().map((e) => [e.id, e]));
  return db.prepare('SELECT * FROM hr_family ORDER BY employee_id, id').all().filter((x) => want.has(x.employee_id)).map((x) => {
    const e = emps.get(x.employee_id);
    return [e.code, e.full_name, x.full_name, x.relation, dmy(x.birth_date), x.phone, x.job, x.dependent ? 'Có' : '', x.note];
  });
}

// Đọc file nhập: cột thông tin thêm ở sheet đầu (theo tên cột) + sheet GiaCanh
export function readExtraXl(wb, ws) {
  const byHead = new Map();
  for (const f of EXTRA_FIELDS) { byHead.set(normH(xlLabel(f)), f); if (!byHead.has(normH(f[1]))) byHead.set(normH(f[1]), f); }
  const cols = [];   // [số cột, field]
  ws.getRow(1).eachCell((c, n) => { if (n > 10) { const f = byHead.get(normH(xlText(c.value))); if (f) cols.push([n, f]); } });
  const fam = new Map();   // MÃ NV (in hoa) → [{dòng, người thân}]
  const famErr = [];
  const wf = wb.getWorksheet('GiaCanh');
  if (wf) {
    for (let r = 2; r <= wf.rowCount; r++) {
      const row = wf.getRow(r);
      const code = xlText(row.getCell(1).value);
      const name = xlText(row.getCell(3).value);
      if (!code && !name) continue;
      if (!code || !name) { famErr.push(`Gia cảnh dòng ${r}: thiếu ${code ? 'họ tên người thân' : 'Mã NV'} — bỏ qua`); continue; }
      const bd = xlDate(row.getCell(5).value);
      if (bd === null) famErr.push(`Gia cảnh dòng ${r}: ngày sinh "${xlText(row.getCell(5).value)}" không đúng (dd/mm/yyyy) — để trống`);
      const dep = normH(xlText(row.getCell(8).value));
      const x = { full_name: name, relation: xlText(row.getCell(4).value), birth_date: bd || '', phone: xlText(row.getCell(6).value),
        job: xlText(row.getCell(7).value), dependent: ['có', 'co', 'x', '1', 'yes', 'phụ thuộc', 'v', '✓'].includes(dep), note: xlText(row.getCell(9).value) };
      const K = code.toUpperCase();
      if (!fam.has(K)) fam.set(K, []);
      fam.get(K).push(x);
    }
  }
  // 1 dòng NV → các trường có điền (ô trống = giữ nguyên); ngày sai → báo lỗi, bỏ ô
  const rowProfile = (row, r2, errors) => {
    const out = {};
    for (const [n, [k, label, t]] of cols) {
      const raw = row.getCell(n).value;
      if (t === 'date') {
        const d = xlDate(raw);
        if (d === null) { errors.push(`Dòng ${r2}: ${label} "${xlText(raw)}" không đúng (dd/mm/yyyy) — bỏ qua ô này`); continue; }
        if (d) out[k] = d;
      } else { const s = xlText(raw); if (s) out[k] = s; }
    }
    return cleanProfile(out);
  };
  return { cols: cols.length, rowProfile, fam, famErr };
}
// Lưu phần thông tin thêm của 1 NV khi nhập Excel (trong transaction của nơi gọi)
export function saveExtraXl(empId, profile, family, by) {
  let did = false;
  if (profile && Object.keys(profile).length) { saveProfile(empId, profile, by); did = true; }
  if (family) {
    const fam = cleanFamily(family);
    db.prepare('DELETE FROM hr_family WHERE employee_id = ?').run(empId);
    const ins = db.prepare('INSERT INTO hr_family (employee_id, full_name, relation, birth_date, phone, job, dependent, note) VALUES (?,?,?,?,?,?,?,?)');
    for (const x of fam) ins.run(empId, x.full_name, x.relation, x.birth_date, x.phone, x.job, x.dependent, x.note);
    did = true;
  }
  return did;
}
