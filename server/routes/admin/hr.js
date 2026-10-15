// Nhóm route PHÂN HỆ NHÂN SỰ (tham khảo AMIS Thông tin nhân sự): hồ sơ nhân sự, hợp đồng lao động,
// quyết định thuyên chuyển / nghỉ việc. Mọi route cần quyền "hr" (dữ liệu nhạy cảm: CCCD, lương, tài khoản ngân hàng).
import ExcelJS from 'exceljs';
import { mkdirSync, writeFileSync, existsSync, rmSync, createReadStream } from 'node:fs';
import { join, extname } from 'node:path';
import { db, setSetting } from '../../db.js';
import { sendCaughtError } from '../../util.js';
import { isSuperUser } from '../../permission-guard.js';
import {
  HR_FIELDS, HR_GROUPS, HR_FIELD_KEYS, cleanProfile, isDate, contractEndDate, checkContract,
  CONTRACT_TYPES, CONTRACT_TYPE_LABEL, CONTRACT_STATUS_LABEL, TRANSFER_KINDS, RESIGN_KINDS, RESIGN_KIND_LABEL,
  DEFAULT_HANDOVER, noticeWarning, currentContract, dmy,
} from '../../hr-rules.js';
import { hrToday, warnDays, loadContracts, currentContractsByEmp, applyDecision, applyDueDecisions, HR_FILES_DIR } from '../../hr.js';
import { remindEnabled, runHrReminders } from '../../hr-remind.js';

const HR_DIR = HR_FILES_DIR;   // giấy tờ đính kèm: data/hr-files/<employee_id>/ (không phát công khai)
const DOC_EXT = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.doc', '.docx', '.xls', '.xlsx']);
const DOC_KINDS = ['CCCD / CMND', 'Sơ yếu lý lịch', 'Bằng cấp / chứng chỉ', 'Giấy khám sức khoẻ', 'Hợp đồng (bản scan)', 'Quyết định', 'Khác'];
const MIME = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

export const who = (req) => req.user?.full_name || 'Quản lý';
const str = (v, n = 200) => (v == null ? '' : String(v).trim().slice(0, n));
// tiền VNĐ: bỏ dấu chấm / phẩy ngăn cách nghìn ("7.500.000" → 7500000)
const num = (v) => { const n = Number(String(v ?? '').replace(/\D/g, '')); return Number.isFinite(n) && n > 0 ? n : 0; };
const dateOr = (v) => (isDate(v) ? v : '');
export const getEmp = (id) => db.prepare('SELECT id, code, full_name, department, position, phone, role, active, start_date, leave_date, audit_only FROM employees WHERE id = ?').get(+id);
// Quản lý (không phải admin) không được lập quyết định / hợp đồng cho tài khoản Admin
export const adminGuard = (req, emp) => (emp && emp.role === 'admin' && !isSuperUser(req.user) ? 'Bạn không có quyền thao tác hồ sơ của tài khoản Admin' : '');

export function profileOf(empId) {
  return db.prepare('SELECT * FROM hr_profiles WHERE employee_id = ?').get(empId) || {};
}
export function saveProfile(empId, fields, by) {
  const keys = Object.keys(fields).filter((k) => HR_FIELD_KEYS.includes(k));
  db.prepare('INSERT OR IGNORE INTO hr_profiles(employee_id) VALUES (?)').run(empId);
  if (keys.length) db.prepare(`UPDATE hr_profiles SET ${keys.map((k) => k + ' = ?').join(', ')}, updated_by = ?, updated_at = datetime('now') WHERE employee_id = ?`)
    .run(...keys.map((k) => fields[k]), by, empId);
}

// Hồ sơ đủ bao nhiêu % (các trường quan trọng)
const KEY_FIELDS = ['gender', 'birth_date', 'id_number', 'id_issue_date', 'permanent_address', 'tax_code', 'si_number', 'bank_account', 'education_level', 'emergency_phone'];
const completeness = (p, e) => Math.round((KEY_FIELDS.filter((k) => p[k]).length + (e.phone ? 1 : 0) + (e.start_date ? 1 : 0)) / (KEY_FIELDS.length + 2) * 100);

// Trạng thái làm việc của NV cho phân hệ Nhân sự
function workStatus(e, pendingResign, empType) {
  if (!e.active) return { key: 'da_nghi', label: 'Đã nghỉ việc' + (e.leave_date ? ' từ ' + dmy(e.leave_date) : '') };
  if (pendingResign) return { key: 'sap_nghi', label: 'Sắp nghỉ việc (' + dmy(pendingResign.effective_date) + ')' };
  if (empType === 'Thử việc') return { key: 'thu_viec', label: 'Thử việc' };
  if (empType) return { key: 'chinh_thuc', label: empType };
  return { key: 'chua_ro', label: 'Đang làm việc' };   // chưa có HĐ / chưa khai tính chất lao động
}

export function contractInput(b) {
  const c = {
    contract_no: str(b.contract_no, 60), ctype: str(b.ctype, 30), term_months: Math.max(0, Math.min(120, parseInt(b.term_months, 10) || 0)),
    sign_date: dateOr(b.sign_date), start_date: dateOr(b.start_date), end_date: dateOr(b.end_date),
    department: str(b.department), position: str(b.position), work_place: str(b.work_place),
    salary: num(b.salary), insurance_salary: num(b.insurance_salary), allowance: str(b.allowance, 500),
    signer: str(b.signer), note: str(b.note, 1000), parent_id: b.parent_id ? +b.parent_id : null,
  };
  if (c.ctype === 'khong_xac_dinh') { c.end_date = ''; c.term_months = 0; }
  if (!c.end_date && c.term_months && c.start_date && c.ctype !== 'khong_xac_dinh') c.end_date = contractEndDate(c.start_date, c.term_months);
  return c;
}
export const CONTRACT_COLS = ['contract_no', 'ctype', 'term_months', 'sign_date', 'start_date', 'end_date', 'department', 'position', 'work_place',
  'salary', 'insurance_salary', 'allowance', 'signer', 'note', 'parent_id'];

// Ký HĐ xong: điền giúp ngày vào làm / ngày thử việc / ngày chính thức nếu hồ sơ còn trống
export function syncDatesFromContract(empId, c) {
  const emp = getEmp(empId);
  const first = db.prepare('SELECT MIN(start_date) d FROM hr_contracts WHERE employee_id = ?').get(empId).d;
  if (emp && !emp.start_date && first) db.prepare('UPDATE employees SET start_date = ? WHERE id = ?').run(first, empId);
  const p = profileOf(empId);
  const f = {};
  if (c.ctype === 'thu_viec' && !p.probation_date) f.probation_date = c.start_date;
  if ((c.ctype === 'xac_dinh' || c.ctype === 'khong_xac_dinh') && !p.official_date) f.official_date = c.start_date;
  if (Object.keys(f).length) saveProfile(empId, f, 'Hệ thống');
}

function decisionInput(b) {
  const handover = Array.isArray(b.handover) ? b.handover.map((x) => ({ t: str(x?.t, 300), done: !!x?.done })).filter((x) => x.t).slice(0, 30) : null;
  return {
    sub_kind: str(b.sub_kind, 60), decision_no: str(b.decision_no, 60), decision_date: dateOr(b.decision_date),
    effective_date: dateOr(b.effective_date), signer: str(b.signer), to_department: str(b.to_department), to_position: str(b.to_position),
    request_date: dateOr(b.request_date), reason: str(b.reason, 1000), note: str(b.note, 1000), handover,
    end_contract: b.end_contract === undefined ? 1 : b.end_contract ? 1 : 0, lock_account: b.lock_account === undefined ? 1 : b.lock_account ? 1 : 0,
  };
}

async function sendXlsx(res, wb, name) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  await wb.xlsx.write(res);
  res.end();
}
function styleHead(ws, widths) {
  const hr = ws.getRow(1);
  hr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  hr.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } }; c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; });
  ws.columns.forEach((c, i) => { c.width = widths[i] || 16; });
  ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 1 }];
}

// Danh sách hồ sơ + số liệu tổng quan (dùng chung cho trang Hồ sơ và xuất Excel)
function buildProfiles() {
  applyDueDecisions();
  const today = hrToday();
  const emps = db.prepare(`SELECT id, code, full_name, department, position, phone, role, active, start_date, leave_date
      FROM employees WHERE IFNULL(audit_only, 0) = 0 ORDER BY active DESC, department, full_name`).all();
  const profs = new Map(db.prepare('SELECT * FROM hr_profiles').all().map((p) => [p.employee_id, p]));
  const contracts = loadContracts();
  const cc = currentContractsByEmp(contracts);
  const pend = new Map();
  for (const d of db.prepare("SELECT * FROM hr_decisions WHERE status = 'pending' ORDER BY effective_date").all()) {
    if (!pend.has(d.employee_id)) pend.set(d.employee_id, []);
    pend.get(d.employee_id).push(d);
  }
  const nameById = new Map(emps.map((e) => [e.id, e.full_name]));
  const stats = { total: 0, working: 0, probation: 0, official: 0, resigned: 0, no_contract: 0, expiring: 0, expired: 0, pending: 0, leaving: 0 };
  const rows = emps.map((e) => {
    const p = profs.get(e.id) || {};
    const c = cc.get(e.id) || {};
    const pd = pend.get(e.id) || [];
    const pendingResign = pd.find((d) => d.kind === 'resign');
    const empType = c.emp_type || p.emp_type || '';
    const ws = workStatus(e, pendingResign, empType);
    // HĐ cần chú ý: HĐ hiện tại sắp hết hạn, hoặc HĐ mới nhất đã hết hạn mà chưa tái ký
    const watch = c.cur && c.cur.status === 'sap_het_han' ? c.cur : (!c.cur && c.latest && c.latest.status === 'het_han' ? c.latest : null);
    stats.total++;
    if (e.active) {
      stats.working++;
      if (ws.key === 'thu_viec') stats.probation++;
      if (ws.key === 'chinh_thuc') stats.official++;
      if (!c.cur) stats.no_contract++;
      if (watch && watch.status === 'sap_het_han') stats.expiring++;
      if (watch && watch.status === 'het_han') stats.expired++;
      if (pendingResign) stats.leaving++;
    } else stats.resigned++;
    stats.pending += pd.length;
    return {
      id: e.id, code: e.code, full_name: e.full_name, department: e.department, position: e.position, phone: e.phone, active: e.active,
      start_date: e.start_date, leave_date: e.leave_date, gender: p.gender || '', birth_date: p.birth_date || '', id_number: p.id_number || '',
      emp_type: empType, status: ws.key, status_label: ws.label, manager: p.manager_id ? nameById.get(+p.manager_id) || '' : '',
      contract: c.cur ? { id: c.cur.id, ctype: c.cur.ctype, label: CONTRACT_TYPE_LABEL[c.cur.ctype], end_date: c.cur.end_date, status: c.cur.status, days_left: c.cur.days_left, salary: c.cur.eff.salary } : null,
      watch: watch ? { id: watch.id, status: watch.status, end_date: watch.end_date, days_left: watch.days_left } : null,
      pending: pd.map((d) => ({ id: d.id, kind: d.kind, effective_date: d.effective_date })),
      complete: completeness(p, e), profile: p,
    };
  });
  return { today, rows, stats };
}

export function registerHrRoutes(r, { need }) {
  const hr = need('hr');

  // Danh mục cho giao diện (trường hồ sơ, loại HĐ, loại quyết định…)
  r.get('/hr/meta', hr, (req, res) => {
    res.json({
      groups: HR_GROUPS, fields: HR_FIELDS, contract_types: CONTRACT_TYPES, contract_status: CONTRACT_STATUS_LABEL,
      transfer_kinds: TRANSFER_KINDS, resign_kinds: RESIGN_KINDS, handover: DEFAULT_HANDOVER, doc_kinds: DOC_KINDS,
      warn_days: warnDays(), today: hrToday(), remind_push: remindEnabled(),
      departments: db.prepare('SELECT name FROM departments ORDER BY name').all().map((x) => x.name),
      positions: db.prepare('SELECT name FROM positions ORDER BY name').all().map((x) => x.name),
    });
  });
  r.put('/hr/settings', hr, (req, res) => {
    const b = req.body || {};
    if (b.warn_days !== undefined) {
      const d = parseInt(b.warn_days, 10);
      if (!(d >= 1 && d <= 365)) return res.status(400).json({ error: 'Số ngày cảnh báo phải từ 1 đến 365' });
      setSetting('hr_contract_warn_days', String(d));
    }
    if (b.remind_push !== undefined) setSetting('hr_remind_push', b.remind_push ? '1' : '0');
    res.json({ ok: true, warn_days: warnDays(), remind_push: remindEnabled() });
  });
  // Gửi thử nhắc HĐ ngay (gồm cả HĐ đã nhắc) — để kiểm tra thông báo đẩy tới được người có quyền Nhân sự
  r.post('/hr/remind/test', hr, async (req, res) => {
    try { res.json({ ok: true, ...(await runHrReminders({ force: true })) }); }
    catch (e) { sendCaughtError(res, 'POST /admin/hr/remind/test', e); }
  });

  // ---------- HỒ SƠ ----------
  r.get('/hr/profiles', hr, (req, res) => {
    try {
      const { today, rows, stats } = buildProfiles();
      for (const x of rows) delete x.profile;
      res.json({ today, rows, stats, warn_days: warnDays() });
    } catch (e) { sendCaughtError(res, 'GET /admin/hr/profiles', e); }
  });

  // Xuất Excel danh sách hồ sơ
  r.get('/hr/profiles/export.xlsx', hr, async (req, res) => {
    try {
      const { rows } = buildProfiles();
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('HoSoNhanSu');
      const fieldCols = HR_FIELDS.filter(([k]) => k !== 'manager_id' && k !== 'hr_note');
      ws.addRow(['Mã NV', 'Họ tên', 'Bộ phận', 'Chức danh', 'SĐT', 'Ngày vào làm', 'Trạng thái', 'Quản lý trực tiếp', 'Loại HĐ hiện tại', 'HĐ hết hạn', 'Lương HĐ', 'Hồ sơ đủ', ...fieldCols.map((f) => f[1])]);
      for (const x of rows) {
        ws.addRow([x.code, x.full_name, x.department, x.position, x.phone, dmy(x.start_date), x.status_label, x.manager,
          x.contract ? x.contract.label : '', x.contract ? (x.contract.end_date ? dmy(x.contract.end_date) : 'Không thời hạn') : '',
          x.contract ? x.contract.salary || '' : '', x.complete + '%',
          ...fieldCols.map(([k, , t]) => (t === 'date' ? dmy(x.profile[k]) : x.profile[k] || ''))]);
      }
      styleHead(ws, [10, 24, 18, 18, 13, 12, 22, 20, 28, 13, 13, 9]);
      ws.getColumn(11).numFmt = '#,##0';
      await sendXlsx(res, wb, 'ho_so_nhan_su.xlsx');
    } catch (e) { sendCaughtError(res, 'GET /admin/hr/profiles/export', e); }
  });

  r.get('/hr/profiles/:id', hr, (req, res) => {
    applyDueDecisions();
    const e = getEmp(req.params.id);
    if (!e || e.audit_only) return res.status(404).json({ error: 'Không tìm thấy nhân viên' });
    const contracts = loadContracts([e.id]);
    const decisions = db.prepare('SELECT * FROM hr_decisions WHERE employee_id = ? ORDER BY effective_date DESC, id DESC').all(e.id);
    for (const d of decisions) { try { d.handover = JSON.parse(d.handover || '[]'); } catch { d.handover = []; } }
    const today = hrToday();
    // QUÁ TRÌNH CÔNG TÁC: vào làm + hợp đồng + quyết định (mới nhất trên cùng)
    const history = [];
    if (e.start_date) history.push({ date: e.start_date, kind: 'join', text: 'Vào làm việc' });
    for (const c of contracts) {
      history.push({ date: c.start_date, kind: 'contract', text: `Ký ${CONTRACT_TYPE_LABEL[c.ctype] || 'hợp đồng'}${c.contract_no ? ' số ' + c.contract_no : ''}${c.end_date ? ' (đến ' + dmy(c.end_date) + ')' : ''}` });
      for (const a of c.annexes) history.push({ date: a.effective_date || a.sign_date, kind: 'annex', text: `Phụ lục${a.annex_no ? ' ' + a.annex_no : ''} HĐ ${c.contract_no || '#' + c.id}: ${[a.salary ? 'lương ' + a.salary.toLocaleString('vi-VN') + 'đ' : '', a.position ? 'chức danh ' + a.position : '', a.content].filter(Boolean).join(' · ')}` });
      if (c.terminated_date) history.push({ date: c.terminated_date, kind: 'end', text: `Chấm dứt HĐ ${c.contract_no || '#' + c.id}${c.terminate_reason ? ' — ' + c.terminate_reason : ''}` });
    }
    for (const d of decisions.filter((x) => x.status !== 'cancelled')) {
      const pending = d.status === 'pending' ? ' (chờ hiệu lực)' : '';
      if (d.kind === 'transfer') history.push({ date: d.effective_date, kind: 'transfer', text: `${d.sub_kind || 'Thuyên chuyển'}${d.decision_no ? ' (QĐ ' + d.decision_no + ')' : ''}: ${[d.to_department && d.to_department !== d.from_department ? `${d.from_department || '—'} → ${d.to_department}` : '', d.to_position && d.to_position !== d.from_position ? `${d.from_position || '—'} → ${d.to_position}` : ''].filter(Boolean).join(' · ')}${pending}` });
      else history.push({ date: d.effective_date, kind: 'resign', text: `Nghỉ việc — ${RESIGN_KIND_LABEL[d.sub_kind] || ''}${d.reason ? ': ' + d.reason : ''}${pending}` });
    }
    history.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const cur = currentContract(contracts, today);
    res.json({
      employee: e, profile: profileOf(e.id),
      family: db.prepare('SELECT * FROM hr_family WHERE employee_id = ? ORDER BY id').all(e.id),
      documents: db.prepare('SELECT id, kind, title, orig_name, mime, size, uploaded_by, uploaded_at FROM hr_documents WHERE employee_id = ? ORDER BY id DESC').all(e.id),
      contracts, decisions, history, current_contract_id: cur ? cur.id : null,
    });
  });

  // Lưu hồ sơ: các trường hồ sơ + vài trường cơ bản của NV (họ tên, SĐT, ngày vào làm). Bộ phận / chức danh đổi qua Thuyên chuyển.
  r.put('/hr/profiles/:id', hr, (req, res) => {
    const e = getEmp(req.params.id);
    if (!e) return res.status(404).json({ error: 'Không tìm thấy nhân viên' });
    const g = adminGuard(req, e); if (g) return res.status(403).json({ error: g });
    const b = req.body || {};
    const f = cleanProfile(b);
    if (f.manager_id && +f.manager_id === e.id) return res.status(400).json({ error: 'Quản lý trực tiếp không thể là chính nhân viên đó' });
    try {
      db.exec('BEGIN');
      saveProfile(e.id, f, who(req));
      if (b.full_name !== undefined && str(b.full_name)) db.prepare('UPDATE employees SET full_name = ? WHERE id = ?').run(str(b.full_name), e.id);
      if (b.phone !== undefined) db.prepare('UPDATE employees SET phone = ? WHERE id = ?').run(str(b.phone, 30), e.id);
      if (b.start_date !== undefined) db.prepare('UPDATE employees SET start_date = ? WHERE id = ?').run(dateOr(b.start_date), e.id);
      db.exec('COMMIT');
      res.json({ ok: true });
    } catch (err) { try { db.exec('ROLLBACK'); } catch {} sendCaughtError(res, 'PUT /admin/hr/profiles', err); }
  });

  // Người thân / người phụ thuộc
  const famInput = (b) => ({ full_name: str(b.full_name), relation: str(b.relation, 60), birth_date: str(b.birth_date, 10), phone: str(b.phone, 30), job: str(b.job), dependent: b.dependent ? 1 : 0, note: str(b.note, 500) });
  r.post('/hr/profiles/:id/family', hr, (req, res) => {
    const e = getEmp(req.params.id);
    if (!e) return res.status(404).json({ error: 'Không tìm thấy nhân viên' });
    const f = famInput(req.body || {});
    if (!f.full_name) return res.status(400).json({ error: 'Nhập họ tên người thân' });
    const info = db.prepare('INSERT INTO hr_family (employee_id, full_name, relation, birth_date, phone, job, dependent, note) VALUES (?,?,?,?,?,?,?,?)')
      .run(e.id, f.full_name, f.relation, f.birth_date, f.phone, f.job, f.dependent, f.note);
    res.json({ ok: true, id: info.lastInsertRowid });
  });
  r.put('/hr/family/:fid', hr, (req, res) => {
    const f = famInput(req.body || {});
    if (!f.full_name) return res.status(400).json({ error: 'Nhập họ tên người thân' });
    const n = db.prepare('UPDATE hr_family SET full_name=?, relation=?, birth_date=?, phone=?, job=?, dependent=?, note=? WHERE id=?')
      .run(f.full_name, f.relation, f.birth_date, f.phone, f.job, f.dependent, f.note, +req.params.fid).changes;
    res.json({ ok: n > 0 });
  });
  r.delete('/hr/family/:fid', hr, (req, res) => {
    db.prepare('DELETE FROM hr_family WHERE id = ?').run(+req.params.fid);
    res.json({ ok: true });
  });

  // Giấy tờ đính kèm: {kind, title, fileName, fileBase64} — tối đa ~4MB
  r.post('/hr/profiles/:id/documents', hr, (req, res) => {
    const e = getEmp(req.params.id);
    if (!e) return res.status(404).json({ error: 'Không tìm thấy nhân viên' });
    const b = req.body || {};
    const ext = extname(String(b.fileName || '')).toLowerCase();
    if (!DOC_EXT.has(ext)) return res.status(400).json({ error: 'Chỉ nhận file PDF, ảnh (JPG/PNG/WEBP), Word hoặc Excel' });
    const buf = Buffer.from(String(b.fileBase64 || '').replace(/^data:.*;base64,/, ''), 'base64');
    if (!buf.length) return res.status(400).json({ error: 'File rỗng' });
    if (buf.length > 4.2 * 1024 * 1024) return res.status(400).json({ error: 'File quá lớn (tối đa 4MB)' });
    try {
      const dir = join(HR_DIR, String(e.id));
      mkdirSync(dir, { recursive: true });
      const name = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}${ext}`;
      writeFileSync(join(dir, name), buf);
      const info = db.prepare('INSERT INTO hr_documents (employee_id, kind, title, file_name, orig_name, mime, size, uploaded_by) VALUES (?,?,?,?,?,?,?,?)')
        .run(e.id, str(b.kind, 60), str(b.title) || str(b.fileName), name, str(b.fileName), MIME[ext] || 'application/octet-stream', buf.length, who(req));
      res.json({ ok: true, id: info.lastInsertRowid });
    } catch (err) { sendCaughtError(res, 'POST /admin/hr/documents', err); }
  });
  r.get('/hr/documents/:docId/file', hr, (req, res) => {
    const d = db.prepare('SELECT * FROM hr_documents WHERE id = ?').get(+req.params.docId);
    if (!d || !/^[\w.-]+$/.test(d.file_name)) return res.status(404).json({ error: 'Không tìm thấy file' });
    const p = join(HR_DIR, String(d.employee_id), d.file_name);
    if (!existsSync(p)) return res.status(404).json({ error: 'File đã bị xoá khỏi máy chủ' });
    res.setHeader('Content-Type', d.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(d.orig_name || d.file_name)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    createReadStream(p).pipe(res);
  });
  r.delete('/hr/documents/:docId', hr, (req, res) => {
    const d = db.prepare('SELECT * FROM hr_documents WHERE id = ?').get(+req.params.docId);
    if (!d) return res.json({ ok: true });
    if (/^[\w.-]+$/.test(d.file_name)) { try { rmSync(join(HR_DIR, String(d.employee_id), d.file_name), { force: true }); } catch {} }
    db.prepare('DELETE FROM hr_documents WHERE id = ?').run(d.id);
    res.json({ ok: true });
  });

  // ---------- HỢP ĐỒNG ----------
  r.get('/hr/contracts', hr, (req, res) => {
    applyDueDecisions();
    const rows = loadContracts();
    res.json({ rows, warn_days: warnDays(), today: hrToday(), remind_push: remindEnabled() });
  });

  // Kiểm tra trước khi lưu (giao diện gọi để hiện cảnh báo luật ngay khi nhập)
  r.post('/hr/contracts/check', hr, (req, res) => {
    const b = req.body || {};
    const c = contractInput(b);
    const hist = b.employee_id ? db.prepare('SELECT * FROM hr_contracts WHERE employee_id = ? AND id <> ?').all(+b.employee_id, +b.id || 0) : [];
    res.json({ ...checkContract(c, hist), end_date: c.end_date });
  });

  r.post('/hr/contracts', hr, (req, res) => {
    const b = req.body || {};
    const e = getEmp(b.employee_id);
    if (!e) return res.status(400).json({ error: 'Chưa chọn nhân viên' });
    const g = adminGuard(req, e); if (g) return res.status(403).json({ error: g });
    const c = contractInput(b);
    if (!c.department) c.department = e.department || '';
    if (!c.position) c.position = e.position || '';
    if (c.parent_id && !db.prepare('SELECT 1 FROM hr_contracts WHERE id = ? AND employee_id = ?').get(c.parent_id, e.id)) c.parent_id = null;
    const hist = db.prepare('SELECT * FROM hr_contracts WHERE employee_id = ?').all(e.id);
    const chk = checkContract(c, hist);
    if (chk.errors.length) return res.status(400).json({ error: chk.errors.join('. ') });
    if (c.contract_no && db.prepare('SELECT 1 FROM hr_contracts WHERE contract_no = ?').get(c.contract_no))
      return res.status(400).json({ error: `Số hợp đồng "${c.contract_no}" đã có` });
    try {
      const info = db.prepare(`INSERT INTO hr_contracts (employee_id, ${CONTRACT_COLS.join(', ')}, created_by) VALUES (?, ${CONTRACT_COLS.map(() => '?').join(', ')}, ?)`)
        .run(e.id, ...CONTRACT_COLS.map((k) => c[k]), who(req));
      syncDatesFromContract(e.id, c);
      res.json({ ok: true, id: info.lastInsertRowid, warnings: chk.warnings });
    } catch (err) { sendCaughtError(res, 'POST /admin/hr/contracts', err); }
  });

  r.put('/hr/contracts/:id', hr, (req, res) => {
    const old = db.prepare('SELECT * FROM hr_contracts WHERE id = ?').get(+req.params.id);
    if (!old) return res.status(404).json({ error: 'Không tìm thấy hợp đồng' });
    const g = adminGuard(req, getEmp(old.employee_id)); if (g) return res.status(403).json({ error: g });
    const c = contractInput({ ...req.body, parent_id: old.parent_id });
    const hist = db.prepare('SELECT * FROM hr_contracts WHERE employee_id = ? AND id <> ?').all(old.employee_id, old.id);
    const chk = checkContract(c, hist);
    if (chk.errors.length) return res.status(400).json({ error: chk.errors.join('. ') });
    if (c.contract_no && db.prepare('SELECT 1 FROM hr_contracts WHERE contract_no = ? AND id <> ?').get(c.contract_no, old.id))
      return res.status(400).json({ error: `Số hợp đồng "${c.contract_no}" đã có` });
    db.prepare(`UPDATE hr_contracts SET ${CONTRACT_COLS.map((k) => k + ' = ?').join(', ')} WHERE id = ?`).run(...CONTRACT_COLS.map((k) => c[k]), old.id);
    res.json({ ok: true, warnings: chk.warnings });
  });

  r.post('/hr/contracts/:id/terminate', hr, (req, res) => {
    const c = db.prepare('SELECT * FROM hr_contracts WHERE id = ?').get(+req.params.id);
    if (!c) return res.status(404).json({ error: 'Không tìm thấy hợp đồng' });
    const g = adminGuard(req, getEmp(c.employee_id)); if (g) return res.status(403).json({ error: g });
    const b = req.body || {};
    if (b.undo) { db.prepare("UPDATE hr_contracts SET terminated_date = '', terminate_reason = '' WHERE id = ?").run(c.id); return res.json({ ok: true }); }
    if (!isDate(b.date)) return res.status(400).json({ error: 'Chọn ngày chấm dứt' });
    if (b.date < c.start_date) return res.status(400).json({ error: 'Ngày chấm dứt phải sau ngày hiệu lực của hợp đồng' });
    db.prepare('UPDATE hr_contracts SET terminated_date = ?, terminate_reason = ? WHERE id = ?').run(b.date, str(b.reason, 500), c.id);
    res.json({ ok: true });
  });

  r.delete('/hr/contracts/:id', hr, (req, res) => {
    const c = db.prepare('SELECT * FROM hr_contracts WHERE id = ?').get(+req.params.id);
    if (!c) return res.json({ ok: true });
    const g = adminGuard(req, getEmp(c.employee_id)); if (g) return res.status(403).json({ error: g });
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE hr_contracts SET parent_id = ? WHERE parent_id = ?').run(c.parent_id, c.id);   // giữ chuỗi tái ký liền mạch
      db.prepare('DELETE FROM hr_contracts WHERE id = ?').run(c.id);
      db.exec('COMMIT');
    } catch (err) { db.exec('ROLLBACK'); return sendCaughtError(res, 'DELETE /admin/hr/contracts', err); }
    res.json({ ok: true });
  });

  // Phụ lục hợp đồng (điều chỉnh lương / chức danh / điều khoản — KHÔNG đổi thời hạn HĐ, Điều 22 BLLĐ 2019)
  r.post('/hr/contracts/:id/annexes', hr, (req, res) => {
    const c = db.prepare('SELECT * FROM hr_contracts WHERE id = ?').get(+req.params.id);
    if (!c) return res.status(404).json({ error: 'Không tìm thấy hợp đồng' });
    const g = adminGuard(req, getEmp(c.employee_id)); if (g) return res.status(403).json({ error: g });
    const b = req.body || {};
    const a = { annex_no: str(b.annex_no, 60), sign_date: dateOr(b.sign_date), effective_date: dateOr(b.effective_date) || dateOr(b.sign_date), salary: num(b.salary), position: str(b.position), content: str(b.content, 2000) };
    if (!a.salary && !a.position && !a.content) return res.status(400).json({ error: 'Nhập nội dung điều chỉnh (lương mới, chức danh mới hoặc nội dung)' });
    if (!a.effective_date) return res.status(400).json({ error: 'Chọn ngày hiệu lực của phụ lục' });
    if (a.effective_date < c.start_date || (c.end_date && a.effective_date > c.end_date)) return res.status(400).json({ error: 'Ngày hiệu lực phụ lục phải nằm trong thời hạn hợp đồng' });
    const info = db.prepare('INSERT INTO hr_contract_annexes (contract_id, annex_no, sign_date, effective_date, salary, position, content, created_by) VALUES (?,?,?,?,?,?,?,?)')
      .run(c.id, a.annex_no, a.sign_date, a.effective_date, a.salary, a.position, a.content, who(req));
    res.json({ ok: true, id: info.lastInsertRowid });
  });
  r.delete('/hr/annexes/:aid', hr, (req, res) => {
    db.prepare('DELETE FROM hr_contract_annexes WHERE id = ?').run(+req.params.aid);
    res.json({ ok: true });
  });

  r.get('/hr/contracts/export.xlsx', hr, async (req, res) => {
    try {
      const rows = loadContracts();
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('HopDong');
      ws.addRow(['Số HĐ', 'Mã NV', 'Họ tên', 'Bộ phận', 'Chức danh', 'Loại hợp đồng', 'Ngày ký', 'Hiệu lực từ', 'Đến ngày', 'Còn (ngày)', 'Trạng thái',
        'Lương thoả thuận', 'Lương đóng BHXH', 'Phụ cấp', 'Người ký', 'Số phụ lục', 'Ngày chấm dứt', 'Lý do chấm dứt', 'Ghi chú']);
      for (const c of rows) {
        ws.addRow([c.contract_no, c.emp_code, c.emp_name, c.department, c.eff.position, CONTRACT_TYPE_LABEL[c.ctype] || c.ctype, dmy(c.sign_date), dmy(c.start_date),
          c.end_date ? dmy(c.end_date) : 'Không thời hạn', c.days_left ?? '', CONTRACT_STATUS_LABEL[c.status] || c.status, c.eff.salary || '', c.insurance_salary || '',
          c.allowance, c.signer, c.annexes.length || '', dmy(c.terminated_date), c.terminate_reason, c.note]);
      }
      styleHead(ws, [14, 10, 24, 18, 18, 28, 11, 11, 13, 9, 14, 14, 14, 20, 18, 9, 12, 24, 24]);
      ws.getColumn(12).numFmt = '#,##0'; ws.getColumn(13).numFmt = '#,##0';
      await sendXlsx(res, wb, 'hop_dong_lao_dong.xlsx');
    } catch (e) { sendCaughtError(res, 'GET /admin/hr/contracts/export', e); }
  });

  // ---------- QUYẾT ĐỊNH THUYÊN CHUYỂN / NGHỈ VIỆC ----------
  r.get('/hr/decisions', hr, (req, res) => {
    applyDueDecisions();
    const rows = db.prepare(`SELECT d.*, e.code AS emp_code, e.full_name AS emp_name, e.department AS emp_department, e.active AS emp_active
        FROM hr_decisions d JOIN employees e ON e.id = d.employee_id ORDER BY d.effective_date DESC, d.id DESC`).all();
    for (const d of rows) { try { d.handover = JSON.parse(d.handover || '[]'); } catch { d.handover = []; } }
    res.json({ rows, today: hrToday() });
  });

  // Cảnh báo báo trước khi nghỉ việc (giao diện gọi khi nhập)
  r.post('/hr/decisions/check', hr, (req, res) => {
    const b = req.body || {};
    const list = b.employee_id ? db.prepare('SELECT * FROM hr_contracts WHERE employee_id = ?').all(+b.employee_id) : [];
    const cur = isDate(b.request_date) ? currentContract(list, b.request_date) : null;
    const w = noticeWarning(b.sub_kind, cur, b.request_date, b.effective_date);
    res.json({ warnings: w ? [w] : [] });
  });

  r.post('/hr/decisions', hr, (req, res) => {
    const b = req.body || {};
    const kind = b.kind === 'resign' ? 'resign' : b.kind === 'transfer' ? 'transfer' : '';
    if (!kind) return res.status(400).json({ error: 'Loại quyết định không hợp lệ' });
    const e = getEmp(b.employee_id);
    if (!e) return res.status(400).json({ error: 'Chưa chọn nhân viên' });
    const g = adminGuard(req, e); if (g) return res.status(403).json({ error: g });
    if (kind === 'resign' && !isSuperUser(req.user) && Number(req.user?.id) === e.id) return res.status(403).json({ error: 'Không thể tự lập quyết định nghỉ việc cho chính mình' });
    const d = decisionInput(b);
    if (!d.effective_date) return res.status(400).json({ error: 'Chọn ngày hiệu lực' });
    const warnings = [];
    if (kind === 'transfer') {
      const deptChange = d.to_department && d.to_department !== e.department;
      const posChange = d.to_position && d.to_position !== e.position;
      if (!deptChange && !posChange) return res.status(400).json({ error: 'Chọn bộ phận mới hoặc chức danh mới (khác hiện tại)' });
      if (!deptChange) d.to_department = '';
      if (!posChange) d.to_position = '';
    } else {
      if (!e.active) return res.status(400).json({ error: 'Nhân viên này đã nghỉ việc' });
      if (db.prepare("SELECT 1 FROM hr_decisions WHERE employee_id = ? AND kind = 'resign' AND status = 'pending'").get(e.id))
        return res.status(400).json({ error: 'Nhân viên đã có quyết định nghỉ việc đang chờ hiệu lực' });
      if (!RESIGN_KIND_LABEL[d.sub_kind]) d.sub_kind = 'tu_nguyen';
      if (!d.handover) d.handover = DEFAULT_HANDOVER.map((t) => ({ t, done: false }));
      const list = db.prepare('SELECT * FROM hr_contracts WHERE employee_id = ?').all(e.id);
      const w = noticeWarning(d.sub_kind, d.request_date ? currentContract(list, d.request_date) : null, d.request_date, d.effective_date);
      if (w) warnings.push(w);
    }
    try {
      const info = db.prepare(`INSERT INTO hr_decisions (employee_id, kind, sub_kind, decision_no, decision_date, effective_date, signer,
          from_department, to_department, from_position, to_position, request_date, reason, note, handover, end_contract, lock_account, created_by)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(e.id, kind, d.sub_kind, d.decision_no, d.decision_date, d.effective_date, d.signer,
        e.department || '', d.to_department, e.position || '', d.to_position, d.request_date, d.reason, d.note, JSON.stringify(d.handover || []),
        d.end_contract, d.lock_account, who(req));
      let applied = false;
      if (d.effective_date <= hrToday()) { applyDecision(db.prepare('SELECT * FROM hr_decisions WHERE id = ?').get(info.lastInsertRowid), who(req)); applied = true; }
      res.json({ ok: true, id: info.lastInsertRowid, applied, warnings });
    } catch (err) { sendCaughtError(res, 'POST /admin/hr/decisions', err); }
  });

  // Sửa quyết định: chờ hiệu lực → sửa được hết; đã áp dụng → chỉ sửa số QĐ, người ký, ghi chú, việc bàn giao
  r.put('/hr/decisions/:id', hr, (req, res) => {
    const old = db.prepare('SELECT * FROM hr_decisions WHERE id = ?').get(+req.params.id);
    if (!old) return res.status(404).json({ error: 'Không tìm thấy quyết định' });
    const e = getEmp(old.employee_id);
    const g = adminGuard(req, e); if (g) return res.status(403).json({ error: g });
    const d = decisionInput(req.body || {});
    const handover = JSON.stringify(d.handover || JSON.parse(old.handover || '[]'));
    if (old.status !== 'pending') {
      db.prepare('UPDATE hr_decisions SET decision_no = ?, decision_date = ?, signer = ?, note = ?, reason = ?, handover = ? WHERE id = ?')
        .run(d.decision_no, d.decision_date, d.signer, d.note, d.reason, handover, old.id);
      return res.json({ ok: true });
    }
    if (!d.effective_date) return res.status(400).json({ error: 'Chọn ngày hiệu lực' });
    if (old.kind === 'transfer' && !d.to_department && !d.to_position) return res.status(400).json({ error: 'Chọn bộ phận mới hoặc chức danh mới' });
    db.prepare(`UPDATE hr_decisions SET sub_kind=?, decision_no=?, decision_date=?, effective_date=?, signer=?, to_department=?, to_position=?,
        request_date=?, reason=?, note=?, handover=?, end_contract=?, lock_account=? WHERE id=?`)
      .run(old.kind === 'resign' && !RESIGN_KIND_LABEL[d.sub_kind] ? old.sub_kind : d.sub_kind, d.decision_no, d.decision_date, d.effective_date, d.signer,
        d.to_department, d.to_position, d.request_date, d.reason, d.note, handover, d.end_contract, d.lock_account, old.id);
    let applied = false;
    if (d.effective_date <= hrToday()) { applyDecision(db.prepare('SELECT * FROM hr_decisions WHERE id = ?').get(old.id), who(req)); applied = true; }
    res.json({ ok: true, applied });
  });

  r.post('/hr/decisions/:id/cancel', hr, (req, res) => {
    const d = db.prepare('SELECT * FROM hr_decisions WHERE id = ?').get(+req.params.id);
    if (!d) return res.status(404).json({ error: 'Không tìm thấy quyết định' });
    if (d.status !== 'pending') return res.status(400).json({ error: 'Chỉ huỷ được quyết định CHƯA tới ngày hiệu lực. Quyết định đã áp dụng thì lập quyết định mới (hoặc mở khoá lại nhân viên ở trang Nhân viên).' });
    db.prepare("UPDATE hr_decisions SET status = 'cancelled' WHERE id = ?").run(d.id);
    res.json({ ok: true });
  });
  r.delete('/hr/decisions/:id', hr, (req, res) => {
    const d = db.prepare('SELECT * FROM hr_decisions WHERE id = ?').get(+req.params.id);
    if (!d) return res.json({ ok: true });
    if (d.status === 'applied') return res.status(400).json({ error: 'Quyết định đã áp dụng thì không xoá được (giữ lịch sử công tác)' });
    db.prepare('DELETE FROM hr_decisions WHERE id = ?').run(d.id);
    res.json({ ok: true });
  });
}
