// ĐĂNG KÝ LÀM THÊM (lưới NV × ngày, số phút) + CHẤM CÔNG BẤT THƯỜNG (đi muộn / về sớm / làm thêm quá đăng ký…).
// Quy tắc chặn tăng ca theo đăng ký: xem server/ot-reg.js. Đổi đăng ký → áp ngay lên dòng công đã có (không cần "Tính lại").
import ExcelJS from 'exceljs';
import { db, getSetting, setSetting, adminAttWhere, deptWithChildren } from '../../db.js';
import { syncOtReg, otRegRequired } from '../../ot-reg.js';
import { vnDateStr, sendCaughtError } from '../../util.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86400000;
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
const spanDays = (f, t) => Math.round((Date.parse(t) - Date.parse(f)) / DAY) + 1;
// phút: '' / null → null (xoá đăng ký); số 0..1440 (0 = đăng ký "không làm thêm")
const minutesOf = (v) => {
  if (v === '' || v == null) return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= 1440 ? n : undefined;
};
const vnHM = (iso) => { if (!iso) return ''; const t = new Date(new Date(iso).getTime() + 7 * 3600000); return String(t.getUTCHours()).padStart(2, '0') + ':' + String(t.getUTCMinutes()).padStart(2, '0'); };

// Các loại bất thường (thứ tự hiển thị)
export const ABN_KINDS = [
  ['late', 'Đi muộn'],
  ['early', 'Về sớm'],
  ['ot_over', 'Làm thêm quá đăng ký'],
  ['ot_noreg', 'Làm thêm không đăng ký'],
  ['ot_under', 'Làm thêm thiếu so với đăng ký'],
  ['no_out', 'Thiếu giờ ra'],
];

// Dựng danh sách bất thường trong [from, to] theo phạm vi (phòng ban gồm bộ phận con / vài NV)
function buildAbnormal(q) {
  const from = String(q.from || '').slice(0, 10), to = String(q.to || '').slice(0, 10);
  if (!ISO.test(from) || !ISO.test(to) || to < from) throw Object.assign(new Error('Khoảng ngày không hợp lệ'), { status: 400 });
  if (spanDays(from, to) > 93) throw Object.assign(new Error('Xem tối đa 3 tháng một lần'), { status: 400 });
  const depts = deptWithChildren(String(q.depts || '').split(',').map((s) => s.trim()).filter(Boolean));
  const ids = String(q.ids || '').split(',').map((s) => parseInt(s, 10)).filter(Boolean);
  const minLate = Math.max(1, parseInt(q.min_late, 10) || 1), minEarly = Math.max(1, parseInt(q.min_early, 10) || 1), minOt = Math.max(1, parseInt(q.min_ot, 10) || 1);
  let w = `e.active=1${adminAttWhere('e.role')}`; const args = [];
  if (ids.length) { w += ` AND e.id IN (${ids.map(() => '?').join(',')})`; args.push(...ids); }
  else if (depts.length) { w += ` AND e.department IN (${depts.map(() => '?').join(',')})`; args.push(...depts); }
  const today = vnDateStr();
  const required = otRegRequired();
  const att = db.prepare(`SELECT a.employee_id, a.work_date, a.check_in_at, a.check_out_at, a.late_min, a.early_min, a.ot_min,
      COALESCE(a.ot_raw_min, a.ot_min, 0) raw, a.manual, a.day_status, s.name shift_name, s.start_time, s.end_time, g.minutes reg,
      e.code, e.full_name, e.department
    FROM attendance a JOIN employees e ON e.id=a.employee_id LEFT JOIN shifts s ON s.id=a.shift_id
      LEFT JOIN ot_registrations g ON g.employee_id=a.employee_id AND g.work_date=a.work_date
    WHERE a.work_date>=? AND a.work_date<=? AND ${w}
      AND (a.late_min>0 OR a.early_min>0 OR a.ot_min>0 OR a.ot_raw_min>0 OR g.minutes IS NOT NULL OR (a.check_in_at IS NOT NULL AND a.check_out_at IS NULL))
    ORDER BY a.work_date, e.department, e.code, a.check_in_at`).all(from, to, ...args);
  // gộp các dòng cùng NV-ngày (nhiều ca): tăng ca cộng lại để so với đăng ký của CẢ NGÀY
  const dayRaw = new Map(), dayOt = new Map();
  for (const a of att) { const k = a.employee_id + '|' + a.work_date; dayRaw.set(k, (dayRaw.get(k) || 0) + (a.raw || 0)); dayOt.set(k, (dayOt.get(k) || 0) + (a.ot_min || 0)); }
  const seenDay = new Set();
  const rows = [];
  const push = (a, o) => rows.push({ id: a.employee_id, code: a.code || '', name: a.full_name, dept: a.department || '', date: a.work_date, ...o });
  for (const a of att) {
    const k = a.employee_id + '|' + a.work_date, kinds = [];
    if ((a.late_min || 0) >= minLate) kinds.push('late');
    if ((a.early_min || 0) >= minEarly) kinds.push('early');
    if (a.check_in_at && !a.check_out_at && a.day_status !== 'mot_lan' && a.work_date < today) kinds.push('no_out');
    let raw = null, reg = null, ot = null;
    if (!seenDay.has(k)) {   // phần tăng ca: 1 lần cho mỗi NV-ngày (ghi ở dòng đầu)
      seenDay.add(k);
      raw = dayRaw.get(k) || 0; ot = dayOt.get(k) || 0; reg = a.reg;
      if (reg != null && raw - reg >= minOt) kinds.push('ot_over');
      else if (reg == null && raw >= minOt) kinds.push('ot_noreg');
      else if (reg != null && reg > 0 && reg - raw >= minOt && a.work_date < today) kinds.push('ot_under');
    }
    if (!kinds.length) continue;
    push(a, { shift: a.shift_name ? `${a.shift_name} (${a.start_time}–${a.end_time})` : '', in: vnHM(a.check_in_at), out: vnHM(a.check_out_at),
      late: a.late_min || 0, early: a.early_min || 0, raw, reg, ot, manual: a.manual ? 1 : 0, kinds });
  }
  // đã đăng ký làm thêm nhưng KHÔNG có dòng công nào ngày đó
  const lone = db.prepare(`SELECT g.employee_id, g.work_date, g.minutes reg, e.code, e.full_name, e.department
    FROM ot_registrations g JOIN employees e ON e.id=g.employee_id
    WHERE g.work_date>=? AND g.work_date<=? AND g.work_date<? AND g.minutes>=? AND ${w}
      AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.employee_id=g.employee_id AND a.work_date=g.work_date)`).all(from, to, today, minOt, ...args);
  for (const g of lone) push(g, { shift: '', in: '', out: '', late: 0, early: 0, raw: 0, reg: g.reg, ot: 0, manual: 0, kinds: ['ot_under'], absent: 1 });
  rows.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : (x.dept + x.code).localeCompare(y.dept + y.code)));
  const counts = Object.fromEntries(ABN_KINDS.map(([k]) => [k, 0]));
  for (const r of rows) for (const k of r.kinds) counts[k]++;
  return { from, to, required, kinds: ABN_KINDS, counts, rows };
}

export function registerOtRegRoutes(r, { need }) {
  // ---------- ĐĂNG KÝ LÀM THÊM ----------
  // Lưới [from, to] (tối đa 31 ngày): đăng ký + tăng ca THỰC TẾ từng NV-ngày (để thấy ngay ai làm quá / thiếu)
  r.get('/ot-reg', need('attendance_edit'), (req, res) => {
    const { from, to } = req.query;
    if (!ISO.test(from || '') || !ISO.test(to || '') || to < from) return res.status(400).json({ error: 'Khoảng ngày không hợp lệ' });
    if (spanDays(from, to) > 31) return res.status(400).json({ error: 'Xem tối đa 31 ngày một lần' });
    const emps = db.prepare(`SELECT id, code, full_name, department FROM employees WHERE active=1${adminAttWhere('role')} ORDER BY department, code`).all();
    const cells = db.prepare('SELECT employee_id, work_date, minutes FROM ot_registrations WHERE work_date>=? AND work_date<=?').all(from, to).map((c) => [c.employee_id, c.work_date, c.minutes]);
    const actual = db.prepare(`SELECT employee_id, work_date, SUM(COALESCE(ot_raw_min, ot_min, 0)) raw FROM attendance
      WHERE work_date>=? AND work_date<=? AND (ot_min>0 OR ot_raw_min>0) GROUP BY employee_id, work_date`).all(from, to).map((a) => [a.employee_id, a.work_date, a.raw]);
    res.json({ required: otRegRequired(), emps, cells, actual });
  });

  // "Phải đăng ký mới tính tăng ca" (ngày không đăng ký → tăng ca = 0). Đổi xong áp lại cho TOÀN BỘ dòng công.
  r.put('/ot-reg/settings', need('settings'), (req, res) => {
    const on = req.body && (req.body.required === true || req.body.required === '1' || req.body.required === 1);
    if (on === otRegRequired()) return res.json({ ok: true, required: on, changed: 0 });
    db.exec('BEGIN');
    try {
      setSetting('ot_reg_required', on ? '1' : '0');
      const changed = syncOtReg(null, '0000-01-01', '9999-12-31');
      db.exec('COMMIT');
      res.json({ ok: true, required: on, changed });
    } catch (e) { db.exec('ROLLBACK'); return sendCaughtError(res, 'PUT /admin/ot-reg/settings', e); }
  });

  // Ghi 1 loạt ô rồi áp lại lên dòng công các NV-ngày đó
  const save = (list, by) => {
    const up = db.prepare(`INSERT INTO ot_registrations(employee_id, work_date, minutes, updated_by, updated_at) VALUES (?,?,?,?,datetime('now'))
      ON CONFLICT(employee_id, work_date) DO UPDATE SET minutes=excluded.minutes, updated_by=excluded.updated_by, updated_at=excluded.updated_at`);
    const del = db.prepare('DELETE FROM ot_registrations WHERE employee_id=? AND work_date=?');
    const ids = new Set(); let lo = '9999-12-31', hi = '0000-01-01';
    for (const [id, d, m] of list) {
      if (m == null) del.run(id, d); else up.run(id, d, m, by);
      ids.add(id); if (d < lo) lo = d; if (d > hi) hi = d;
    }
    return list.length ? syncOtReg([...ids], lo, hi) : 0;
  };

  // Sửa từng ô / dán từ Excel: [{ employee_id, date, minutes }] (minutes rỗng = xoá đăng ký)
  r.post('/ot-reg/cells', need('attendance_edit'), (req, res) => {
    const src = Array.isArray(req.body?.cells) ? req.body.cells : [];
    if (!src.length) return res.json({ ok: true, saved: 0 });
    if (src.length > 100000) return res.status(400).json({ error: 'Quá nhiều ô một lần (tối đa 100.000)' });
    const empOk = new Set(db.prepare('SELECT id FROM employees').all().map((e) => e.id));
    const list = []; let bad = 0;
    for (const c of src) {
      const id = +c.employee_id, d = String(c.date || ''), m = minutesOf(c.minutes);
      if (!empOk.has(id) || !ISO.test(d) || m === undefined) { bad++; continue; }
      list.push([id, d, m]);
    }
    db.exec('BEGIN');
    try { const changed = save(list, req.user.full_name || req.user.username || ''); db.exec('COMMIT'); res.json({ ok: true, saved: list.length, errorCount: bad, changed }); }
    catch (e) { db.exec('ROLLBACK'); return sendCaughtError(res, 'POST /admin/ot-reg/cells', e); }
  });

  // Áp nhanh: nhiều NV × khoảng ngày × 1 số phút (rỗng = xoá đăng ký). skip_sun / skip_sat: bỏ qua chủ nhật / thứ 7.
  r.post('/ot-reg/apply', need('attendance_edit'), (req, res) => {
    const b = req.body || {};
    const ids = [...new Set((b.employee_ids || []).map(Number).filter(Boolean))];
    if (!ids.length) return res.status(400).json({ error: 'Chọn ít nhất 1 nhân viên' });
    const m = minutesOf(b.minutes);
    if (m === undefined) return res.status(400).json({ error: 'Số phút phải từ 0 đến 1440 (để trống = xoá đăng ký)' });
    if (!ISO.test(b.from || '') || !ISO.test(b.to || '') || b.to < b.from) return res.status(400).json({ error: 'Khoảng ngày không hợp lệ' });
    if (spanDays(b.from, b.to) > 366) return res.status(400).json({ error: 'Tối đa 1 năm một lần' });
    const days = [];
    for (let d = b.from; d <= b.to; d = addDays(d, 1)) {
      const wd = new Date(d + 'T12:00:00Z').getUTCDay();
      if ((b.skip_sun && wd === 0) || (b.skip_sat && wd === 6)) continue;
      days.push(d);
    }
    if (ids.length * days.length > 1200000) return res.status(400).json({ error: 'Quá nhiều ô một lần — chia nhỏ khoảng ngày hoặc số nhân viên' });
    const empOk = new Set(db.prepare('SELECT id FROM employees').all().map((e) => e.id));
    const list = []; for (const id of ids) if (empOk.has(id)) for (const d of days) list.push([id, d, m]);
    db.exec('BEGIN');
    try { const changed = save(list, req.user.full_name || req.user.username || ''); db.exec('COMMIT'); res.json({ ok: true, cells: list.length, people: ids.length, days: days.length, changed }); }
    catch (e) { db.exec('ROLLBACK'); return sendCaughtError(res, 'POST /admin/ot-reg/apply', e); }
  });

  // ---------- XUẤT MẪU / NHẬP EXCEL ----------
  // Xuất file mẫu: mỗi dòng 1 NV, mỗi cột 1 ngày trong [from, to] (tối đa 62 ngày), ô = số phút đã đăng ký (trống = chưa đăng ký).
  // Body: { from, to, ids? } — ids rỗng = mọi NV. Điền / sửa số phút rồi nhập lại bằng /ot-reg/import.
  r.post('/ot-reg/export.xlsx', need('attendance_edit'), async (req, res) => {
    const b = req.body || {}, from = String(b.from || ''), to = String(b.to || '');
    if (!ISO.test(from) || !ISO.test(to) || to < from) return res.status(400).json({ error: 'Khoảng ngày không hợp lệ' });
    if (spanDays(from, to) > 62) return res.status(400).json({ error: 'Xuất mẫu tối đa 62 ngày một lần' });
    const idSet = new Set((Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean));
    const emps = db.prepare(`SELECT id, code, full_name, department FROM employees WHERE active=1${adminAttWhere('role')} ORDER BY department, code`).all()
      .filter((e) => !idSet.size || idSet.has(e.id));
    const days = []; for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
    const reg = new Map(db.prepare('SELECT employee_id, work_date, minutes FROM ot_registrations WHERE work_date>=? AND work_date<=?').all(from, to).map((c) => [c.employee_id + '|' + c.work_date, c.minutes]));
    const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    const vn = (s) => s.slice(8) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('DangKyLamThem', { views: [{ state: 'frozen', xSplit: 3, ySplit: 4 }] });
    ws.addRow(['ĐĂNG KÝ LÀM THÊM (số PHÚT mỗi ngày)']).font = { bold: true, size: 14 };
    ws.addRow([`Từ ${vn(from)} đến ${vn(to)} · Điền số phút vào ô ngày (0 = không cho làm thêm, để trống = không đăng ký). KHÔNG sửa cột Mã NV và dòng ngày. Xong vào Đăng ký làm thêm › ⬆ Nhập Excel.`]).font = { italic: true, color: { argb: 'FF64748B' } };
    const wdRow = ws.addRow(['', '', '', ...days.map((d) => WD[new Date(d + 'T12:00:00Z').getUTCDay()])]);
    const head = ws.addRow(['Mã NV', 'Họ tên', 'Bộ phận', ...days.map(vn)]);
    const thin = { style: 'thin', color: { argb: 'FFCBD5E1' } }, border = { top: thin, bottom: thin, left: thin, right: thin };
    for (const row of [wdRow, head]) row.eachCell((c, i) => {
      c.font = { bold: true, color: i > 3 && wdRow.getCell(i).value === 'CN' ? { argb: 'FFDC2626' } : undefined }; c.alignment = { horizontal: 'center', vertical: 'middle' };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5EDF7' } }; c.border = border;
    });
    for (const e of emps) {
      const row = ws.addRow([e.code || '', e.full_name, e.department || '', ...days.map((d) => reg.get(e.id + '|' + d) ?? null)]);
      row.eachCell({ includeEmpty: true }, (c, i) => { c.border = border; if (i > 3) c.alignment = { horizontal: 'center' }; });
    }
    ws.getColumn(1).width = 12; ws.getColumn(2).width = 26; ws.getColumn(3).width = 24;
    for (let i = 0; i < days.length; i++) ws.getColumn(4 + i).width = 12;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="dang_ky_lam_them_${from}_${to}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  });

  // Nhập Excel theo mẫu trên: { fileBase64, clear_blank? } — clear_blank: ô để trống = XOÁ đăng ký ngày đó (mặc định: bỏ qua ô trống).
  // Tìm dòng tiêu đề có "Mã NV" ở cột A; cột ngày đọc từ tiêu đề (dd/mm/yyyy hoặc ô kiểu ngày). NV tìm theo Mã NV.
  r.post('/ot-reg/import', need('attendance_edit'), async (req, res) => {
    const b64 = req.body?.fileBase64 || '';
    if (!b64) return res.status(400).json({ error: 'Thiếu file' });
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(Buffer.from(b64.replace(/^data:.*;base64,/, ''), 'base64')); } catch { return res.status(400).json({ error: 'File Excel không đọc được (phải là file .xlsx)' }); }
    const ws = wb.worksheets[0];
    if (!ws) return res.status(400).json({ error: 'File rỗng' });
    const txt = (v) => (v == null ? '' : typeof v === 'object' && !(v instanceof Date) ? String(v.text ?? v.result ?? (v.richText ? v.richText.map((x) => x.text).join('') : '')) : v instanceof Date ? v : String(v)).toString().trim();
    const toIso = (v) => {
      if (v instanceof Date && !isNaN(v)) return new Date(v.getTime() + 12 * 3600e3).toISOString().slice(0, 10);   // ô kiểu ngày (Excel lưu 00:00 UTC)
      if (typeof v === 'number' && v > 36526 && v < 73051) return new Date(Math.round((v - 25569) * 86400e3) + 12 * 3600e3).toISOString().slice(0, 10);   // số thứ tự ngày của Excel (ô ngày mất định dạng)
      const s = String(v == null ? '' : (v.text ?? v.result ?? v)).trim();
      let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? s : '';
    };
    let headRow = 0;
    for (let i = 1; i <= Math.min(ws.rowCount, 15); i++) if (/^mã\s*nv$/i.test(txt(ws.getRow(i).getCell(1).value).normalize('NFC'))) { headRow = i; break; }
    if (!headRow) return res.status(400).json({ error: 'Không thấy dòng tiêu đề có "Mã NV" ở cột A — hãy dùng file mẫu xuất từ phần mềm.' });
    const cols = [];   // [{ col, date }]
    ws.getRow(headRow).eachCell((c, i) => { if (i <= 1) return; const d = toIso(c.value); if (d && ISO.test(d)) cols.push({ col: i, date: d }); });
    if (!cols.length) return res.status(400).json({ error: 'Không thấy cột ngày nào ở dòng tiêu đề (dạng 24/08/2026).' });
    if (cols.length > 92) return res.status(400).json({ error: 'File có quá nhiều cột ngày (tối đa 92).' });
    const empByCode = new Map(db.prepare('SELECT id, code FROM employees WHERE active=1').all().map((e) => [String(e.code).trim().toUpperCase(), e.id]));
    const clearBlank = !!req.body?.clear_blank;
    const list = [], unknown = [], badCells = []; let people = 0;
    for (let i = headRow + 1; i <= ws.rowCount; i++) {
      const row = ws.getRow(i), code = txt(row.getCell(1).value);
      if (!code) continue;
      const id = empByCode.get(code.toUpperCase());
      if (!id) { if (unknown.length < 30) unknown.push(code); continue; }
      let touched = false;
      for (const { col, date } of cols) {
        const raw = row.getCell(col).value, s = txt(raw);
        if (s === '') { if (clearBlank) { list.push([id, date, null]); touched = true; } continue; }
        const m = minutesOf(s.replace(',', '.'));
        if (m === undefined || m === null || !/^\d+([.,]0+)?$/.test(s)) { if (badCells.length < 30) badCells.push(`${code} ngày ${date.slice(8)}/${date.slice(5, 7)}: "${s.slice(0, 20)}"`); continue; }
        list.push([id, date, m]); touched = true;
      }
      if (touched) people++;
    }
    db.exec('BEGIN');
    try {
      const changed = save(list, req.user.full_name || req.user.username || '');
      db.exec('COMMIT');
      res.json({ ok: true, saved: list.filter((x) => x[2] != null).length, cleared: list.filter((x) => x[2] == null).length, people, days: cols.length, from: cols.map((c) => c.date).sort()[0], to: cols.map((c) => c.date).sort().pop(), unknown, badCells, changed });
    } catch (e) { db.exec('ROLLBACK'); return sendCaughtError(res, 'POST /admin/ot-reg/import', e); }
  });

  // ---------- CHẤM CÔNG BẤT THƯỜNG ----------
  r.get('/abnormal', need('reports'), (req, res) => {
    try { res.json(buildAbnormal(req.query)); }
    catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); return sendCaughtError(res, 'GET /admin/abnormal', e); }
  });

  r.get('/abnormal.xlsx', need('reports'), async (req, res) => {
    let d;
    try { d = buildAbnormal(req.query); }
    catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); return sendCaughtError(res, 'GET /admin/abnormal.xlsx', e); }
    const want = new Set(String(req.query.kinds || '').split(',').filter(Boolean));
    const rows = want.size ? d.rows.filter((x) => x.kinds.some((k) => want.has(k))) : d.rows;
    const label = Object.fromEntries(ABN_KINDS);
    const vn = (s) => s.slice(8) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Bat thuong', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.addRow([getSetting('company_name', 'Digiplus')]).font = { bold: true, size: 12 };
    ws.addRow(['CHẤM CÔNG BẤT THƯỜNG']).font = { bold: true, size: 14 };
    ws.addRow([`Từ ${vn(d.from)} đến ${vn(d.to)} · ${rows.length} dòng` + (want.size ? ' · ' + [...want].map((k) => label[k] || k).join(', ') : '')]);
    const head = ws.addRow(['STT', 'Ngày', 'Mã NV', 'Họ tên', 'Bộ phận', 'Ca', 'Giờ vào', 'Giờ ra', 'Đi muộn (phút)', 'Về sớm (phút)', 'Đăng ký làm thêm (phút)', 'Làm thêm thực tế (phút)', 'Làm thêm được tính (phút)', 'Vượt đăng ký (phút)', 'Bất thường']);
    head.font = { bold: true }; head.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; head.height = 32;
    head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5EDF7' } }; c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }; });
    // chỉ ghi số + nhãn của các loại ĐANG CHỌN (không chọn "Đi muộn" thì dòng xuất vì lý do khác không kèm số đi muộn)
    const on = (x, k) => (!want.size || want.has(k)) && x.kinds.includes(k);
    rows.forEach((x, i) => ws.addRow([i + 1, vn(x.date), x.code, x.name, x.dept, x.shift, x.in, x.out, on(x, 'late') ? x.late : null, on(x, 'early') ? x.early : null,
      x.reg, x.raw, x.ot, on(x, 'ot_over') ? x.raw - x.reg : null, x.kinds.filter((k) => !want.size || want.has(k)).map((k) => label[k]).join('; ') + (x.absent ? ' (không đi làm)' : '')]));
    [6, 12, 11, 26, 24, 24, 9, 9, 10, 10, 12, 12, 12, 11, 44].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="cham_cong_bat_thuong_${d.from}_${d.to}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  });
}
