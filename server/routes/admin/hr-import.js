// Nhóm route NHẬP EXCEL cho phân hệ Nhân sự: hồ sơ nhân sự và hợp đồng lao động (tải file mẫu + nhập).
// Chế độ "Thêm mới" / "Cập nhật" giống trang Nhân viên. Mỗi dòng được kiểm như nhập tay (luật BLLĐ 2019 cho hợp đồng):
// dòng lỗi thì bỏ qua, dòng chỉ có cảnh báo vẫn nhập. Cả file chạy trong 1 transaction (lỗi hệ thống → không ghi dở dang).
import ExcelJS from 'exceljs';
import { db } from '../../db.js';
import { sendCaughtError } from '../../util.js';
import { passwordHasher, hasPerm } from '../../auth.js';
import { licenseState } from '../../license.js';
import { HR_FIELDS, checkContract, daysBetween } from '../../hr-rules.js';
import {
  PROFILE_COLS, CONTRACT_COLS_X, headerMap, cellText, cellRaw, parseDateCell, parseMoneyCell, mapContractType, matchOption,
  fixIdNumber, fixPhone, normText,
} from '../../hr-import.js';
import { who, adminGuard, saveProfile, contractInput, CONTRACT_COLS, syncDatesFromContract } from './hr.js';

const FIELD = Object.fromEntries(HR_FIELDS.map((f) => [f[0], f]));
const MAX_MSG = 300;

async function sendXlsx(res, wb, name) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  await wb.xlsx.write(res);
  res.end();
}
// Trang tính đầu tiên → mảng dòng (mỗi dòng = row.values, cột tính từ 1)
async function readRows(b64) {
  const buf = Buffer.from(String(b64 || '').replace(/^data:.*;base64,/, ''), 'base64');
  if (!buf.length) throw Object.assign(new Error('Thiếu file'), { user: true });
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf); } catch { throw Object.assign(new Error('File Excel không đọc được (cần file .xlsx)'), { user: true }); }
  const ws = wb.worksheets[0];
  if (!ws) throw Object.assign(new Error('File rỗng'), { user: true });
  const rows = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => { rows[n - 1] = row.values; });
  return rows;
}
// Tiêu đề xanh đậm + cột định dạng chữ (giữ số 0 đầu, ngày gõ dd/mm/yyyy không bị Excel đảo ngày/tháng) + danh sách thả xuống
function styleTemplate(ws, cols, { textCols = [], lists = {} } = {}) {
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.height = 32;
  head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } }; c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; });
  cols.forEach(([k], i) => {
    const col = ws.getColumn(i + 1);
    col.width = k === 'code' ? 11 : /address|note|certificates|allowance/.test(k) ? 30 : 17;
    if (textCols.includes(k)) col.numFmt = '@';
    const letter = col.letter;
    if (lists[k]) ws.dataValidations.add(`${letter}2:${letter}2000`, { type: 'list', allowBlank: true, showErrorMessage: false, formulae: [`"${lists[k].join(',')}"`] });
  });
  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];
}
function guideSheet(wb, title, lines) {
  const g = wb.addWorksheet('HuongDan');
  g.addRow([title]).font = { bold: true, size: 13 };
  for (const l of lines) g.addRow(l);
  g.getColumn(1).width = 30; g.getColumn(2).width = 90;
  g.eachRow((r) => { r.alignment = { wrapText: true, vertical: 'top' }; });
}

export function registerHrImportRoutes(r, { need }) {
  const hr = need('hr');

  /* ------------------------------ HỒ SƠ ------------------------------ */
  r.get('/hr/import/profiles-template.xlsx', hr, async (req, res) => {
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('HoSoNhanSu');
      ws.addRow(PROFILE_COLS.map((c) => c[1]));
      const ex = { code: 'NV025', full_name: 'Trần Thị Bình', department: 'Kế toán', position: 'Kế toán viên', phone: '0901234567', start_date: '01/03/2026',
        gender: 'Nữ', birth_date: '20/05/1995', birth_place: 'Hà Nội', nationality: 'Việt Nam', ethnicity: 'Kinh', marital_status: 'Độc thân',
        id_number: '001195012345', id_issue_date: '10/08/2021', id_issue_place: 'Cục Cảnh sát QLHC về TTXH', permanent_address: '5 Lê Lợi, TP. Nam Định',
        emp_type: 'Chính thức', education_level: 'Đại học', major: 'Kế toán', bank_account: '0123456789', bank_name: 'Vietcombank' };
      ws.addRow(PROFILE_COLS.map(([k]) => ex[k] || ''));
      const dates = HR_FIELDS.filter((f) => f[2] === 'date').map((f) => f[0]);
      const lists = Object.fromEntries(HR_FIELDS.filter((f) => f[2] === 'select').map((f) => [f[0], f[4]]));
      styleTemplate(ws, PROFILE_COLS, { textCols: ['code', 'phone', 'start_date', 'id_number', 'tax_code', 'si_number', 'bank_account', 'emergency_phone', 'graduation_year', 'manager_id', ...dates], lists });
      guideSheet(wb, 'HƯỚNG DẪN NHẬP HỒ SƠ NHÂN SỰ', [
        ['• Mã NV *', 'Bắt buộc — dùng để đối chiếu nhân viên. Có thể xoá bớt cột không dùng, đổi thứ tự cột thoải mái (phần mềm nhận cột theo tiêu đề).'],
        ['• Ngày', 'Gõ dạng ngày/tháng/năm, VD 20/05/1995 (các cột ngày đã định dạng sẵn kiểu chữ để Excel không đảo ngày – tháng).'],
        ['• Ô có danh sách', 'Giới tính, Tình trạng hôn nhân, Tính chất lao động, Trình độ: chọn trong danh sách thả xuống.'],
        ['• Quản lý trực tiếp', 'Gõ MÃ NV của người quản lý.'],
        ['• Số CCCD, tài khoản…', 'Cột đã định dạng kiểu chữ để giữ số 0 ở đầu.'],
        ['', ''],
        ['CHẾ ĐỘ THÊM MỚI', 'Tạo nhân viên MỚI (mã chưa có) kèm hồ sơ: tài khoản đăng nhập = mã NV, mật khẩu 123456. Cần thêm quyền Nhân viên. Mã đã có → bỏ qua.'],
        ['CHẾ ĐỘ CẬP NHẬT', 'Điền / sửa hồ sơ của nhân viên ĐÃ CÓ theo mã. Ô để trống = giữ nguyên. Bộ phận / chức danh KHÔNG đổi ở đây (đổi qua Thuyên chuyển để lưu quá trình công tác).'],
        ['', ''],
        ['Mẹo', 'File "Xuất Excel" ở trang Hồ sơ nhân sự nhập lại được bằng chế độ Cập nhật (sửa trên file xuất rồi nhập lại).'],
      ]);
      await sendXlsx(res, wb, 'mau_ho_so_nhan_su.xlsx');
    } catch (e) { sendCaughtError(res, 'GET /admin/hr/import/profiles-template', e); }
  });

  r.post('/hr/import/profiles', hr, async (req, res) => {
    const mode = req.body?.mode === 'update' ? 'update' : 'add';
    let rows;
    try { rows = await readRows(req.body?.fileBase64); } catch (e) { return e.user ? res.status(400).json({ error: e.message }) : sendCaughtError(res, 'POST /admin/hr/import/profiles', e); }
    const hm = headerMap(rows, PROFILE_COLS);
    if (!hm) return res.status(400).json({ error: 'Không thấy cột "Mã NV" ở dòng tiêu đề — dùng file mẫu của phần mềm' });
    if (mode === 'add' && !hasPerm(req.user, 'employees')) return res.status(403).json({ error: 'Chế độ Thêm mới tạo nhân viên mới — cần thêm quyền Nhân viên. Dùng chế độ Cập nhật cho nhân viên đã có.' });
    const { map, headerRow } = hm;
    const at = (row, k) => (map.has(k) ? row[map.get(k)] : undefined);
    const emps = db.prepare('SELECT id, code, full_name, role, active, username FROM employees').all();
    const byCode = new Map(emps.map((e) => [normText(e.code), e]));
    const byName = new Map();
    for (const e of emps) { const n = normText(e.full_name); byName.set(n, byName.has(n) ? null : e); }   // trùng tên → không đoán
    const msgs = [];
    const say = (row, type, msg) => { if (msgs.length < MAX_MSG) msgs.push({ row, type, msg }); };
    let added = 0, updated = 0, skipped = 0;
    const lic = licenseState();
    let activeCount = db.prepare("SELECT COUNT(*) c FROM employees WHERE active = 1 AND role != 'admin'").get().c;
    const pwHash = passwordHasher();
    const insDept = db.prepare('INSERT OR IGNORE INTO departments(name) VALUES (?)');
    const insPos = db.prepare('INSERT OR IGNORE INTO positions(name) VALUES (?)');

    db.exec('BEGIN');
    try {
      for (let i = headerRow + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;
        const R = i + 1;
        const code = cellText(at(row, 'code'));
        if (!code) continue;
        // các trường hồ sơ (ô trống = không đổi)
        const f = {};
        for (const [k] of HR_FIELDS) {
          if (!map.has(k)) continue;
          const raw = cellRaw(at(row, k));
          if (raw === '' || raw == null) continue;
          const [, label, type, , opts] = FIELD[k];
          if (type === 'date') {
            const d = parseDateCell(raw);
            if (d) f[k] = d; else say(R, 'warn', `${label} "${cellText(raw)}" không phải ngày (dd/mm/yyyy) — bỏ qua ô này`);
          } else if (type === 'select') {
            const o = matchOption(raw, opts);
            if (o) f[k] = o; else say(R, 'warn', `${label} "${cellText(raw)}" không có trong danh sách (${opts.join(', ')}) — bỏ qua ô này`);
          } else if (type === 'employee') {
            const t = normText(cellText(raw));
            const m = byCode.get(t) || byName.get(t);
            if (m) f[k] = String(m.id); else say(R, 'warn', `Không tìm thấy quản lý "${cellText(raw)}" (gõ mã NV) — bỏ qua ô này`);
          } else if (k === 'id_number') f[k] = fixIdNumber(raw).slice(0, 200);
          else if (k === 'emergency_phone') f[k] = fixPhone(raw).slice(0, 200);
          else f[k] = cellText(raw).slice(0, type === 'textarea' ? 2000 : 200);
        }
        const name = cellText(at(row, 'full_name')).slice(0, 200);
        const phone = map.has('phone') ? fixPhone(at(row, 'phone')).slice(0, 30) : '';
        const startRaw = at(row, 'start_date');
        let start = '';
        if (startRaw !== undefined && cellText(startRaw)) { start = parseDateCell(startRaw) || ''; if (!start) say(R, 'warn', `Ngày vào làm "${cellText(startRaw)}" không phải ngày — bỏ qua ô này`); }
        let e = byCode.get(normText(code));

        if (mode === 'add') {
          if (e) { say(R, 'err', `Mã "${code}" đã có — dùng chế độ Cập nhật để điền hồ sơ`); skipped++; continue; }
          if (!name) { say(R, 'err', 'Thiếu Họ tên — bỏ qua'); skipped++; continue; }
          if (lic.maxEmp && activeCount >= lic.maxEmp) { say(R, 'err', `Vượt giới hạn bản quyền ${lic.maxEmp} nhân viên — bỏ qua`); skipped++; continue; }
          if (byCode.has(normText(code)) || emps.some((x) => normText(x.username) === normText(code))) { say(R, 'err', `Tài khoản "${code}" đã có người dùng — bỏ qua`); skipped++; continue; }
          const dept = cellText(at(row, 'department')).slice(0, 200), pos = cellText(at(row, 'position')).slice(0, 200);
          if (dept) insDept.run(dept);
          if (pos) insPos.run(pos);
          const info = db.prepare(`INSERT INTO employees (code, full_name, department, position, phone, role, username, password_hash, permissions, active, start_date)
              VALUES (?,?,?,?,?,'employee',?,?,NULL,1,?)`).run(code, name, dept, pos, phone, code, pwHash('123456'), start);
          e = { id: Number(info.lastInsertRowid), code, full_name: name, role: 'employee', active: 1, username: code };
          emps.push(e); byCode.set(normText(code), e);
          activeCount++;
          saveProfile(e.id, f, who(req));
          added++;
        } else {
          if (!e) { say(R, 'err', `Mã "${code}" chưa có — dùng chế độ Thêm mới`); skipped++; continue; }
          const g = adminGuard(req, e); if (g) { say(R, 'err', g); skipped++; continue; }
          if (f.manager_id && +f.manager_id === e.id) { say(R, 'warn', 'Quản lý trực tiếp không thể là chính nhân viên đó — bỏ qua ô này'); delete f.manager_id; }
          saveProfile(e.id, f, who(req));
          if (name) db.prepare('UPDATE employees SET full_name = ? WHERE id = ?').run(name, e.id);
          if (phone) db.prepare('UPDATE employees SET phone = ? WHERE id = ?').run(phone, e.id);
          if (start) db.prepare('UPDATE employees SET start_date = ? WHERE id = ?').run(start, e.id);
          updated++;
        }
      }
      db.exec('COMMIT');
    } catch (e) { try { db.exec('ROLLBACK'); } catch {} return sendCaughtError(res, 'POST /admin/hr/import/profiles', e); }
    res.json({ ok: true, mode, added, updated, skipped, messages: msgs });
  });

  /* ------------------------------ HỢP ĐỒNG ------------------------------ */
  r.get('/hr/import/contracts-template.xlsx', hr, async (req, res) => {
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('HopDong');
      ws.addRow(CONTRACT_COLS_X.map((c) => c[1]));
      ws.addRow(['NV025', '07/2026/HĐTV', 'Thử việc', '27/02/2026', '01/03/2026', '29/04/2026', '', 'Kế toán', 'Kế toán viên', 'Văn phòng TP.HCM', 7650000, '', 'Ăn trưa 730.000đ', 'Nguyễn Văn Giám', '']);
      ws.addRow(['NV025', '15/2026/HĐLĐ', 'Xác định thời hạn', '28/04/2026', '30/04/2026', '', 12, 'Kế toán', 'Kế toán viên', 'Văn phòng TP.HCM', 9000000, 6000000, 'Ăn trưa 730.000đ', 'Nguyễn Văn Giám', '']);
      styleTemplate(ws, CONTRACT_COLS_X, { textCols: ['code', 'contract_no', 'sign_date', 'start_date', 'end_date'],
        lists: { ctype: ['Thử việc', 'Xác định thời hạn', 'Không xác định thời hạn', 'Dịch vụ'] } });
      ws.getColumn(11).numFmt = '#,##0'; ws.getColumn(12).numFmt = '#,##0';
      guideSheet(wb, 'HƯỚNG DẪN NHẬP HỢP ĐỒNG LAO ĐỘNG', [
        ['• Mã NV *', 'Nhân viên phải có sẵn trong phần mềm.'],
        ['• Loại HĐ *', 'Thử việc / Xác định thời hạn / Không xác định thời hạn / Dịch vụ (chọn trong danh sách).'],
        ['• Hiệu lực từ *', 'Ngày bắt đầu, dạng ngày/tháng/năm.'],
        ['• Đến ngày / Thời hạn', 'Điền NGÀY HẾT HẠN hoặc SỐ THÁNG (VD 12 → tự tính ngày hết hạn). HĐ không xác định thời hạn: để trống cả hai.'],
        ['• Số HĐ', 'Không trùng. Chế độ Cập nhật tìm hợp đồng theo Số HĐ.'],
        ['• Lương', 'Gõ số (VD 9000000 hoặc 9.000.000).'],
        ['', ''],
        ['KIỂM TRA LUẬT', 'Mỗi dòng được kiểm như nhập tay theo BLLĐ 2019 (tối đa 36 tháng, thử việc tối đa 180 ngày…). Dòng sai luật bị bỏ qua; dòng chỉ có cảnh báo vẫn nhập và được liệt kê để xem lại.'],
        ['TÁI KÝ', 'Nhiều HĐ của cùng 1 người: HĐ bắt đầu trong vòng 31 ngày sau khi HĐ trước hết hạn được tự nối thành "tái ký" (HĐ cũ không bị báo hết hạn).'],
        ['CHẾ ĐỘ THÊM MỚI', 'Thêm hợp đồng mới. Số HĐ đã có → bỏ qua.'],
        ['CHẾ ĐỘ CẬP NHẬT', 'Sửa hợp đồng theo Số HĐ. Ô để trống = giữ nguyên.'],
      ]);
      await sendXlsx(res, wb, 'mau_hop_dong_lao_dong.xlsx');
    } catch (e) { sendCaughtError(res, 'GET /admin/hr/import/contracts-template', e); }
  });

  r.post('/hr/import/contracts', hr, async (req, res) => {
    const mode = req.body?.mode === 'update' ? 'update' : 'add';
    let rows;
    try { rows = await readRows(req.body?.fileBase64); } catch (e) { return e.user ? res.status(400).json({ error: e.message }) : sendCaughtError(res, 'POST /admin/hr/import/contracts', e); }
    const hm = headerMap(rows, CONTRACT_COLS_X);
    if (!hm) return res.status(400).json({ error: 'Không thấy cột "Mã NV" ở dòng tiêu đề — dùng file mẫu của phần mềm' });
    const { map, headerRow } = hm;
    const at = (row, k) => (map.has(k) ? row[map.get(k)] : undefined);
    const emps = db.prepare('SELECT id, code, full_name, department, position, role FROM employees').all();
    const byCode = new Map(emps.map((e) => [normText(e.code), e]));
    const msgs = [];
    const say = (row, type, msg) => { if (msgs.length < MAX_MSG) msgs.push({ row, type, msg }); };
    let added = 0, updated = 0, skipped = 0, linked = 0;

    // Đọc + kiểm từng dòng trước (ngày, loại HĐ, mã NV)
    const items = [];
    for (let i = headerRow + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const R = i + 1;
      const code = cellText(at(row, 'code'));
      if (!code) continue;
      const e = byCode.get(normText(code));
      if (!e) { say(R, 'err', `Mã NV "${code}" chưa có trong phần mềm — bỏ qua`); skipped++; continue; }
      const g = adminGuard(req, e); if (g) { say(R, 'err', g); skipped++; continue; }
      const b = {};   // chỉ những ô có giá trị
      let bad = '';
      for (const [k, label] of CONTRACT_COLS_X) {
        if (k === 'code' || !map.has(k)) continue;
        const raw = cellRaw(at(row, k));
        if (raw === '' || raw == null) continue;
        if (k === 'ctype') { const t = mapContractType(raw); if (t) b.ctype = t; else bad = `Loại HĐ "${cellText(raw)}" không rõ (Thử việc / Xác định thời hạn / Không xác định thời hạn / Dịch vụ)`; }
        else if (['sign_date', 'start_date', 'end_date'].includes(k)) {
          if (k === 'end_date' && normText(cellText(raw)).includes('khong')) { b.end_date = ''; continue; }   // "Không thời hạn" (file xuất)
          const d = parseDateCell(raw);
          if (d) b[k] = d; else bad = `${label.replace(' *', '')} "${cellText(raw)}" không phải ngày (dd/mm/yyyy)`;
        } else if (k === 'salary' || k === 'insurance_salary') b[k] = parseMoneyCell(raw);
        else if (k === 'term_months') { const n = parseInt(cellText(raw).replace(/\D/g, ''), 10); if (n > 0) b.term_months = n; }
        else b[k] = cellText(raw);
      }
      if (bad) { say(R, 'err', bad + ' — bỏ qua dòng'); skipped++; continue; }
      items.push({ R, e, b });
    }
    // Thêm mới: xếp theo NV + ngày hiệu lực để nối tái ký và kiểm lịch sử HĐ đúng thứ tự
    if (mode === 'add') items.sort((x, y) => (x.e.id - y.e.id) || String(x.b.start_date || '').localeCompare(String(y.b.start_date || '')) || x.R - y.R);

    db.exec('BEGIN');
    try {
      for (const { R, e, b } of items) {
        if (mode === 'add') {
          if (!b.ctype) { say(R, 'err', 'Thiếu Loại HĐ — bỏ qua'); skipped++; continue; }
          if (!b.start_date) { say(R, 'err', 'Thiếu ngày Hiệu lực từ — bỏ qua'); skipped++; continue; }
          const c = contractInput(b);
          if (!c.department) c.department = e.department || '';
          if (!c.position) c.position = e.position || '';
          if (c.contract_no && db.prepare('SELECT 1 FROM hr_contracts WHERE contract_no = ?').get(c.contract_no)) { say(R, 'err', `Số HĐ "${c.contract_no}" đã có — bỏ qua`); skipped++; continue; }
          const hist = db.prepare('SELECT * FROM hr_contracts WHERE employee_id = ?').all(e.id);
          // tự nối "tái ký": HĐ trước (chưa chấm dứt, chưa ai nối) hết hạn trong vòng 31 ngày trước ngày bắt đầu
          const prev = hist.filter((h) => h.end_date && h.end_date < c.start_date && !h.terminated_date && daysBetween(h.end_date, c.start_date) <= 31
            && !hist.some((x) => x.parent_id === h.id)).sort((p, q) => (p.end_date < q.end_date ? 1 : -1))[0];
          if (prev) c.parent_id = prev.id;
          const chk = checkContract(c, hist);
          if (chk.errors.length) { say(R, 'err', chk.errors.join('. ') + ' — bỏ qua'); skipped++; continue; }
          for (const w of chk.warnings) say(R, 'warn', w);
          db.prepare(`INSERT INTO hr_contracts (employee_id, ${CONTRACT_COLS.join(', ')}, created_by) VALUES (?, ${CONTRACT_COLS.map(() => '?').join(', ')}, ?)`)
            .run(e.id, ...CONTRACT_COLS.map((k) => c[k]), who(req));
          syncDatesFromContract(e.id, c);
          if (prev) linked++;
          added++;
        } else {
          if (!b.contract_no) { say(R, 'err', 'Chế độ Cập nhật cần Số HĐ để tìm hợp đồng — bỏ qua'); skipped++; continue; }
          const old = db.prepare('SELECT * FROM hr_contracts WHERE contract_no = ?').get(b.contract_no);
          if (!old) { say(R, 'err', `Không có hợp đồng số "${b.contract_no}" — dùng chế độ Thêm mới`); skipped++; continue; }
          if (old.employee_id !== e.id) { say(R, 'err', `Hợp đồng "${b.contract_no}" thuộc nhân viên khác — bỏ qua`); skipped++; continue; }
          const merged = { ...old, ...b, parent_id: old.parent_id };
          if (b.term_months && b.end_date === undefined) merged.end_date = '';   // đổi số tháng → tính lại ngày hết hạn
          if (b.salary === 0) merged.salary = old.salary;
          const c = contractInput(merged);
          const hist = db.prepare('SELECT * FROM hr_contracts WHERE employee_id = ? AND id <> ?').all(e.id, old.id);
          const chk = checkContract(c, hist);
          if (chk.errors.length) { say(R, 'err', chk.errors.join('. ') + ' — bỏ qua'); skipped++; continue; }
          for (const w of chk.warnings) say(R, 'warn', w);
          db.prepare(`UPDATE hr_contracts SET ${CONTRACT_COLS.map((k) => k + ' = ?').join(', ')} WHERE id = ?`).run(...CONTRACT_COLS.map((k) => c[k]), old.id);
          updated++;
        }
      }
      db.exec('COMMIT');
    } catch (err) { try { db.exec('ROLLBACK'); } catch {} return sendCaughtError(res, 'POST /admin/hr/import/contracts', err); }
    res.json({ ok: true, mode, added, updated, skipped, linked, messages: msgs.sort((a, b) => a.row - b.row) });
  });
}
