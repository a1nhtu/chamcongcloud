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
