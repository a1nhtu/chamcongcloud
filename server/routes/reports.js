import { Router } from 'express';
import ExcelJS from 'exceljs';
import { db, getSetting, adminAttWhere } from '../db.js';
import { authRequired, permRequired } from '../auth.js';
import { vnDateStr, humanMinutes } from '../util.js';
import { isWeekendDay, vnWeekday, splitOtTiers, dropRepeatPunches } from '../attendance-calc.js';
import { computePayrollTable } from '../payroll-calc.js';
import { resolveEffectiveShift } from '../shift-resolver.js';

const r = Router();
r.use(authRequired, permRequired('reports'));

/* ================= Helpers ================= */
function isoToVnHM(iso) {
  if (!iso) return '';
  const d = new Date(iso); if (isNaN(d)) return '';
  const t = new Date(d.getTime() + 7 * 3600 * 1000);
  return `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
}
const WD_LABEL = { 0: 'CN', 1: 'T.2', 2: 'T.3', 3: 'T.4', 4: 'T.5', 5: 'T.6', 6: 'T.7' };
const WD = { 1: 'T2', 2: 'T3', 3: 'T4', 4: 'T5', 5: 'T6', 6: 'T7', 7: 'CN' };
const fmtDMY = (d) => `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const round2 = (n) => Math.round((n || 0) * 100) / 100;

function monthDays(month) {
  const [y, m] = month.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}
// Mảng ngày YYYY-MM-DD trong khoảng [from, to] (bao gồm 2 đầu)
function daysBetween(from, to) {
  const out = [];
  for (let d = new Date(from + 'T12:00:00Z'); d <= new Date(to + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1))
    out.push(d.toISOString().slice(0, 10));
  return out;
}
// Từ query: ưu tiên from/to; nếu thiếu thì suy ra từ month (cả tháng). Tự đảo nếu to < from.
function resolvePeriod(q) {
  let from = (q.from || '').slice(0, 10), to = (q.to || '').slice(0, 10);
  if (!from || !to) {
    const month = (q.month || vnDateStr().slice(0, 7)).slice(0, 7);
    const ds = monthDays(month);
    from = ds[0]; to = ds[ds.length - 1];
  }
  if (to < from) { const t = from; from = to; to = t; }
  return { from, to };
}
// Nhãn kỳ: nếu đúng trọn 1 tháng → "tháng MM/YYYY", ngược lại → "kỳ DD/MM/YYYY – DD/MM/YYYY"
function periodLabel(from, to) {
  if (from.slice(0, 7) === to.slice(0, 7)) {
    const md = monthDays(from.slice(0, 7));
    if (from === md[0] && to === md[md.length - 1]) return `tháng ${from.slice(5, 7)}/${from.slice(0, 4)}`;
  }
  return `kỳ ${fmtDMY(from)} – ${fmtDMY(to)}`;
}

// Bộ lọc nhân viên dùng chung: nhận string dept (cũ) HOẶC object {dept, depts:[], ids:[]}.
// Ưu tiên: ids (chọn NV cụ thể) > depts (nhiều phòng ban) > dept (1 phòng ban, tương thích cũ).
export function empFilterSql(filter) {
  const f = typeof filter === 'string' ? { dept: filter } : (filter || {});
  const ids = (f.ids || []).map(Number).filter(Boolean);
  const depts = (f.depts || []).filter(Boolean);
  if (ids.length) return { where: ` AND id IN (${ids.map(() => '?').join(',')})`, args: ids };
  if (depts.length) return { where: ` AND department IN (${depts.map(() => '?').join(',')})`, args: depts };
  if (f.dept) return { where: ' AND department = ?', args: [f.dept] };
  return { where: '', args: [] };
}

// Các lần chấm trong ngày của từng NV (dùng cho báo cáo hiện NHIỀU lần vào/ra):
//  - ngày có giờ admin SỬA TAY → theo bản ghi công (tôn trọng chỉnh sửa)
//  - có lượt quẹt máy → từng lượt quẹt theo thời gian
//  - còn lại (chấm điện thoại) → mỗi phiên = 1 cặp vào/ra
// Bỏ lượt trùng trong vòng 1 phút. Trả hàm timesOf(empId, date) → [iso...] đã sắp xếp.
function dayTimesLoader(from, to, empIds) {
  const dupMin = Math.max(1, parseInt(getSetting('pair_dup_min', '5'), 10) || 5);
  const punches = new Map(), sessions = new Map();
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  for (const p of db.prepare('SELECT employee_id, work_date, punch_at FROM device_punches WHERE employee_id IS NOT NULL AND work_date >= ? AND work_date <= ? ORDER BY punch_at').all(from, to))
    if (empIds.has(p.employee_id)) push(punches, p.employee_id + '|' + p.work_date, p.punch_at);
  for (const a of db.prepare('SELECT employee_id, work_date, check_in_at, check_out_at, manual FROM attendance WHERE work_date >= ? AND work_date <= ? ORDER BY check_in_at').all(from, to))
    if (empIds.has(a.employee_id)) push(sessions, a.employee_id + '|' + a.work_date, a);
  return (empId, date) => {
    const k = empId + '|' + date;
    const ss = sessions.get(k) || [];
    let list;
    if (ss.some((x) => x.manual) || !punches.has(k)) {
      list = [];
      for (const x of ss) { if (x.check_in_at) list.push(x.check_in_at); if (x.check_out_at) list.push(x.check_out_at); }
    } else list = punches.get(k).slice();
    // bỏ lượt quẹt lặp theo CÙNG ngưỡng với lúc tính công → các cặp hiện trên báo cáo khớp với giờ đã tính
    return dropRepeatPunches(list, dupMin);
  };
}
// [t0,t1,t2,t3,t4] → [[t0,t1],[t2,t3],[t4,null]]
const toPairs = (ts) => { const r = []; for (let i = 0; i < ts.length; i += 2) r.push([ts[i], ts[i + 1] || null]); return r; };

// Giờ vào/ra HIỂN THỊ của 1 ô NV×ngày theo quy tắc ghép log đang áp dụng (báo cáo "đầu/cuối" không dùng hàm này):
//  - quy tắc "Nhiều lần vào/ra" (ca chọn "pairs", hoặc chế độ theo giờ chọn "theo cặp") và ngày có > 2 lần chấm
//    → liệt kê từng cặp: cin/cout nhiều dòng, pairs = [[vào, ra], ...]
//  - còn lại (FILO, IDM…) → giờ vào/ra của bản ghi công (đầu–cuối), pairs = null
function inOutResolver(employees, from, to) {
  const hourly = getSetting('attendance_mode', 'shift') === 'hourly';
  const hourlyRule = getSetting('hourly_merge_rule', 'filo');
  let timesOf = null;
  const memo = new Map();   // empId|date → kết quả (nhiều cột cùng gọi 1 ô)
  return (empId, date, c) => {
    const mk = empId + '|' + date;
    if (!memo.has(mk)) memo.set(mk, calc(empId, date, c));
    return memo.get(mk);
  };
  function calc(empId, date, c) {
    const single = { cin: c && c.check_in_at ? isoToVnHM(c.check_in_at) : '', cout: c && c.check_out_at ? isoToVnHM(c.check_out_at) : '', pairs: null };
    if (!c || !c.check_in_at) return single;
    if (!timesOf) timesOf = dayTimesLoader(from, to, new Set(employees.map((e) => e.id)));
    const ts = timesOf(empId, date);
    if (ts.length <= 2) return single;
    const rule = hourly ? hourlyRule : (resolveEffectiveShift(empId, date, c.check_in_at, c.check_out_at || null).mergeRule || 'filo');
    if (rule !== 'pairs') return single;
    const ps = toPairs(ts);
    return { cin: ps.map(([a]) => isoToVnHM(a)).join('\n'), cout: ps.map(([, b]) => (b ? isoToVnHM(b) : '?')).join('\n'), pairs: ps };
  }
}

// Nạp toàn bộ dữ liệu 1 khoảng ngày [from, to] để các báo cáo dùng chung
function loadRange(from, to, filter) {
  const weekend = getSetting('weekend_days', '7');
  const ef = empFilterSql(filter);
  const empSql = `SELECT id, code, full_name, department, position, shift_id
                FROM employees WHERE active = 1${adminAttWhere()}${ef.where} ORDER BY department, full_name`;
  const employees = db.prepare(empSql).all(...ef.args);

  const results = db.prepare(
    `SELECT a.*, e.code, e.full_name, e.department, s.name AS shift_name,
            s.start_time AS shift_start, s.end_time AS shift_end
     FROM attendance a JOIN employees e ON e.id = a.employee_id
     LEFT JOIN shifts s ON s.id = a.shift_id
     WHERE a.work_date >= ? AND a.work_date <= ?`
  ).all(from, to);
  // shift join fallback: nếu không có phân ca ngày, lấy ca mặc định
  const shiftsById = new Map(db.prepare('SELECT * FROM shifts').all().map((s) => [s.id, s]));
  const empById = new Map(employees.map((e) => [e.id, e]));

  // empId|date -> 1 ô gộp (có thể NHIỀU ca/ngày): cộng công/giờ/OT/muộn/sớm, vào sớm nhất, ra muộn nhất
  const cell = new Map();
  for (const row of results) {
    if (!empById.has(row.employee_id)) continue; // chỉ giữ NV trong bộ lọc (phòng ban/NV cụ thể)
    const key = row.employee_id + '|' + row.work_date;
    // Tăng ca ngày thường chia mức TC1→TC4 theo giới hạn của ca
    row._tiers = (row.ot_type || 'thuong') === 'thuong' ? splitOtTiers(row.ot_min || 0, shiftsById.get(row.shift_id)) : [0, 0, 0, 0];
    const ex = cell.get(key);
    if (!ex) { cell.set(key, { ...row, _shiftNames: row.shift_name ? [row.shift_name] : [], _missingOut: (!row.check_out_at) ? 1 : 0 }); continue; }
    ex.work_unit = (ex.work_unit || 0) + (row.work_unit || 0);
    ex.work_minutes = (ex.work_minutes || 0) + (row.work_minutes || 0);
    ex.ot_min = (ex.ot_min || 0) + (row.ot_min || 0);
    ex._tiers = ex._tiers.map((m, i) => m + row._tiers[i]);
    ex.late_min = (ex.late_min || 0) + (row.late_min || 0);
    ex.early_min = (ex.early_min || 0) + (row.early_min || 0);
    if (row.check_in_at && (!ex.check_in_at || row.check_in_at < ex.check_in_at)) ex.check_in_at = row.check_in_at;
    if (row.check_out_at && (!ex.check_out_at || row.check_out_at > ex.check_out_at)) ex.check_out_at = row.check_out_at;
    if (!row.check_out_at) ex._missingOut = 1;
    if (row.shift_name) ex._shiftNames.push(row.shift_name);
    if (row.day_status === 'lam_viec') ex.day_status = 'lam_viec';
  }
  // Ca hiển thị: ghép tên các ca trong ngày (VD "Ca sáng + Ca chiều")
  for (const c of cell.values()) {
    if (c._shiftNames && c._shiftNames.length > 1) c.shift_name = c._shiftNames.join(' + ');
  }

  const assigns = new Map(); // empId|date -> {shift_id,is_off}
  for (const a of db.prepare('SELECT employee_id, work_date, shift_id, is_off FROM daily_shift_assignments WHERE work_date >= ? AND work_date <= ?').all(from, to))
    assigns.set(a.employee_id + '|' + a.work_date, a);

  const holidays = new Set(db.prepare('SELECT holiday_date FROM public_holidays WHERE holiday_date >= ? AND holiday_date <= ?').all(from, to).map((h) => h.holiday_date));

  // Nghỉ đã duyệt phủ lên từng ngày: empId|date → loại nghỉ (1 mục trong LEAVE_KINDS)
  const leaveDays = new Map();
  const leaveRows = db.prepare(
    `SELECT l.*, e.code, e.full_name, e.department FROM leave_requests l JOIN employees e ON e.id=l.employee_id
     WHERE l.from_date <= ? AND l.to_date >= ?`
  ).all(to, from).filter((l) => empById.has(l.employee_id)); // chỉ NV trong bộ lọc
  const rangeDays = daysBetween(from, to);
  const usedKinds = new Set();
  for (const l of leaveRows) {
    if (l.status !== 'approved') continue;
    const kind = leaveKind(l.type);
    for (const d of rangeDays) if (d >= l.from_date && d <= l.to_date) { leaveDays.set(l.employee_id + '|' + d, kind); usedKinds.add(kind.key); }
  }
  // Các loại nghỉ có phát sinh trong kỳ (giữ đúng thứ tự LEAVE_KINDS) → báo cáo thêm cột cho từng loại
  const leaveKinds = LEAVE_KINDS.filter((k) => usedKinds.has(k.key));

  // ca theo lịch của 1 NV trong 1 ngày (để xác định ngày công theo lịch)
  const scheduledShift = (empId, date) => {
    const a = assigns.get(empId + '|' + date);
    if (a) { if (a.is_off) return null; if (a.shift_id) return shiftsById.get(a.shift_id) || null; }
    const e = empById.get(empId);
    return e?.shift_id ? shiftsById.get(e.shift_id) || null : null;
  };
  const isScheduled = (empId, date) => {
    if (holidays.has(date)) return false;
    const s = scheduledShift(empId, date);
    if (!s) return false;
    const wd = String(vnWeekday(date));
    const days = (s.work_days || '1,2,3,4,5,6').split(',');
    return days.includes(wd);
  };

  // Có ca nào đặt giới hạn mức tăng ca → báo cáo tách cột TC1…TC4
  const hasTiers = [...shiftsById.values()].some((x) => (x.ot_tier1_min || 0) > 0);
  return { from, to, weekend, employees, cell, holidays, leaveDays, leaveRows, leaveKinds, hasTiers, isScheduled, isWeekend: (d) => isWeekendDay(d, weekend) };
}

// Loại nghỉ theo đơn từ (cột "type" của leave_requests). Loại lạ → "Nghỉ khác".
const LEAVE_KINDS = [
  { key: 'lvP', type: 'Nghỉ phép', label: 'Nghỉ phép', sym: 'P' },
  { key: 'lvKL', type: 'Nghỉ không lương', label: 'Không lương', sym: 'KL' },
  { key: 'lvCT', type: 'Công tác', label: 'Công tác', sym: 'CT' },
  { key: 'lvK', type: 'Khác', label: 'Nghỉ khác', sym: 'K' },
];
function leaveKind(type) {
  const t = String(type || '').trim().toLowerCase();
  return LEAVE_KINDS.find((k) => k.type.toLowerCase() === t)
    || (t.includes('không lương') ? LEAVE_KINDS[1] : t.includes('công tác') ? LEAVE_KINDS[2] : t.includes('phép') ? LEAVE_KINDS[0] : LEAVE_KINDS[3]);
}
// Cột số ngày nghỉ từng loại (chỉ những loại có phát sinh trong kỳ; `always` = luôn có cột Nghỉ phép)
function leaveCols(ctx, always = false) {
  const ks = always && !ctx.leaveKinds.includes(LEAVE_KINDS[0]) ? [LEAVE_KINDS[0], ...ctx.leaveKinds] : ctx.leaveKinds;
  return ks.map((k) => ({ key: k.key, label: k.label, w: 10 }));
}
// Đếm số ngày nghỉ từng loại của 1 NV trong danh sách ngày → { lvP: n, lvKL: n, ... }
function leaveCounts(ctx, empId, days) {
  const out = Object.fromEntries(LEAVE_KINDS.map((k) => [k.key, 0]));
  for (const d of days) { const k = ctx.leaveDays.get(empId + '|' + d); if (k) out[k.key]++; }
  return out;
}

// Cột tăng ca dùng chung: ca có đặt mức → TC1…TC4 (ngày thường) + TC CN + TC lễ; không → TC thường / TC CN / TC lễ
function otColDefs(ctx) {
  return ctx.hasTiers
    ? [['ot1', 'TC1'], ['ot2', 'TC2'], ['ot3', 'TC3'], ['ot4', 'TC4'], ['otE', 'TC CN'], ['otH', 'TC lễ']]
    : [['ot1', 'TC thường'], ['otE', 'TC CN'], ['otH', 'TC lễ']];
}
// Số phút tăng ca của 1 ô (NV×ngày) theo từng cột ở trên
function otCellMin(c) {
  const t = (c && c._tiers) || [0, 0, 0, 0];
  return { ot1: t[0], ot2: t[1], ot3: t[2], ot4: t[3],
    otE: c && c.ot_type === 'cuoi_tuan' ? (c.ot_min || 0) : 0, otH: c && c.ot_type === 'le' ? (c.ot_min || 0) : 0 };
}

function symbolOf(ctx, empId, date) {
  const c = ctx.cell.get(empId + '|' + date);
  if (ctx.leaveDays.has(empId + '|' + date)) return 'P';
  if (ctx.holidays.has(date)) return 'L';
  if (!c) return ctx.isScheduled(empId, date) ? 'V' : '';
  if (c.day_status === 'thieu_ra' || !c.check_out_at) return 'O';
  if ((c.late_min || 0) > 0 || (c.early_min || 0) > 0) return 'T';
  if ((c.work_unit || 0) > 0 || (c.ot_min || 0) > 0) return 'X';   // ca tính cả ca là tăng ca: công 0 nhưng có làm
  return 'V';
}
const OT_LABEL = { thuong: 'Ngày thường', cuoi_tuan: 'Cuối tuần', le: 'Ngày lễ' };
const DS_LABEL = {
  lam_viec: 'Đủ công', thieu_ra: 'Thiếu ra', vang: 'Vắng',
  nghi_le: 'Nghỉ lễ', nghi_phep: 'Nghỉ phép',
};

/* ================= Report builders ================= */
// Báo cáo GIỜ SỬA/THÊM BẰNG TAY — lấy từ nhật ký thao tác (có vết ai sửa, khi nào)
function buildManualTime(from, to) {
  const columns = [
    { key: 'at', label: 'Thời gian sửa', w: 18 }, { key: 'user', label: 'Người thực hiện', w: 20 },
    { key: 'role', label: 'Vai trò', w: 13 }, { key: 'action', label: 'Thao tác', w: 16 },
    { key: 'emp', label: 'Nhân viên', w: 22 }, { key: 'day', label: 'Ngày công', w: 11 },
    { key: 'gio', label: 'Giờ vào – ra', w: 14 }, { key: 'note', label: 'Ghi chú', w: 18 },
  ];
  const acts = ['Thêm giờ chấm (tay)', 'Sửa giờ chấm', 'Xóa giờ chấm'];
  const logs = db.prepare(`SELECT datetime(at,'+7 hours') at, user_name, username, role, action, detail
    FROM audit_logs WHERE action IN (${acts.map(() => '?').join(',')})
      AND date(at,'+7 hours') >= ? AND date(at,'+7 hours') <= ? ORDER BY at DESC`).all(...acts, from, to);
  const empName = new Map(db.prepare('SELECT id, code, full_name FROM employees').all().map((e) => [e.id, `${e.full_name} (${e.code})`]));
  const roleVi = { admin: 'Quản trị viên', manager: 'Quản lý', master: 'Tài khoản tổng' };
  const rows = logs.map((l) => {
    let emp = '', day = '', gio = '', note = '';
    try {
      const o = JSON.parse(l.detail || '{}'); const d = o.data || o;
      let eid = d.employee_id;
      if (!eid && o.id) { const a = db.prepare('SELECT employee_id, work_date FROM attendance WHERE id=?').get(o.id); if (a) { eid = a.employee_id; day = fmtDMY(a.work_date); } }
      const dw = d.work_date || d.date;
      if (dw) day = String(dw).length === 10 ? fmtDMY(dw) : String(dw);
      emp = eid ? (empName.get(+eid) || ('NV#' + eid)) : '';
      const ci = d.check_in || d.check_in_at || '', co = d.check_out || d.check_out_at || '';
      gio = [ci, co].filter(Boolean).join(' – ');
      note = d.note || '';
    } catch {}
    return { at: l.at, user: l.user_name || l.username || '—', role: roleVi[l.role] || l.role || '', action: l.action, emp, day, gio, note };
  });
  return { title: `Giờ sửa/thêm bằng tay ${periodLabel(from, to)}`, columns, rows };
}

// Trả về { title, columns:[{key,label,weekend?,w?}], rows:[obj] }
// Chế độ chấm "theo giờ": các báo cáo danh sách bỏ cột Công và Tăng ca (chỉ ý nghĩa khi theo ca)
const HOURLY_HIDE = { attendance: ['cong', 'ot'], detail: ['cong', 'ot'], detaillist: ['cong', 'ot'], detailmulti: ['cong', 'ot'], empsheet: ['cong', 'ot'], empsheetlate: ['cong', 'ot'] };
function buildReport(type, from, to, filter) {
  const rep = buildReportRaw(type, from, to, filter);
  const hide = HOURLY_HIDE[type];
  if (hide && rep && Array.isArray(rep.columns) && getSetting('attendance_mode', 'shift') === 'hourly')
    rep.columns = rep.columns.filter((c) => !hide.includes(c.key));
  return rep;
}

function buildReportRaw(type, from, to, filter) {
  if (type === 'manualtime') return buildManualTime(from, to);
  const ctx = loadRange(from, to, filter);
  const days = daysBetween(from, to);
  const PERIOD = periodLabel(from, to);
  const ioOf = inOutResolver(ctx.employees, days[0], days[days.length - 1]);   // giờ vào/ra theo quy tắc ghép log
  const HOURLY = getSetting('attendance_mode', 'shift') === 'hourly';   // chế độ theo giờ: bỏ công/tăng ca, dùng tổng giờ
  const sortedResults = () => [...ctx.cell.values()].sort((a, b) =>
    a.full_name === b.full_name ? (a.work_date < b.work_date ? -1 : 1) : (a.full_name < b.full_name ? -1 : 1));

  switch (type) {
    /* --- Bảng công ngang (ma trận ngày × NV) --- */
    case 'horizontal': {
      const dayCols = days.map((d) => ({ key: 'd' + d, label: d.slice(8), weekend: ctx.isWeekend(d) }));
      const columns = [
        { key: 'code', label: 'Mã NV', w: 10 }, { key: 'name', label: 'Họ tên', w: 22 },
        { key: 'dept', label: 'Bộ phận', w: 14 }, ...dayCols,
        { key: 'total', label: 'Tổng công', w: 10 }, ...(HOURLY ? [] : [{ key: 'ot', label: 'OT (giờ)', w: 9 }]),
        { key: 'late', label: 'Trễ (lần)', w: 9 }, { key: 'early', label: 'Sớm (lần)', w: 9 },
        { key: 'absent', label: 'Vắng', w: 8 }, ...leaveCols(ctx),
      ];
      const rows = ctx.employees.map((e) => {
        const row = { code: e.code, name: e.full_name, dept: e.department || '', ...leaveCounts(ctx, e.id, days) };
        let total = 0, ot = 0, late = 0, early = 0, absent = 0;
        for (const d of days) {
          const c = ctx.cell.get(e.id + '|' + d);
          // Bảng công: ô luôn là SỐ CÔNG (số giờ xem ở "Bảng thống kê chấm công (giờ)")
          if (c && c.work_unit > 0) { row['d' + d] = round2(c.work_unit); total += c.work_unit; }
          else row['d' + d] = '';
          if (row['d' + d] === '' && ctx.leaveDays.has(e.id + '|' + d)) row['d' + d] = ctx.leaveDays.get(e.id + '|' + d).sym;   // ngày nghỉ → ký hiệu loại nghỉ
          if (c) { ot += (c.ot_min || 0); if (c.late_min > 0) late++; if (c.early_min > 0) early++; }
          if (symbolOf(ctx, e.id, d) === 'V') absent++;
        }
        row.total = round2(total); row.ot = round2(ot / 60); row.late = late; row.early = early; row.absent = absent;
        return row;
      });
      return { title: `Bảng công ngang ${PERIOD}`, columns, rows };
    }

    /* --- Bảng thống kê chấm công (GIỜ): ma trận ngày × NV, mỗi ô = số giờ làm (mẫu "BẢNG THỐNG KÊ CHẤM CÔNG (GIỜ)") ---
     * Cột: STT, Phòng ban, Mã, Tên, Ngày vào làm, từng ngày (số giờ; ngày nghỉ = ký hiệu loại nghỉ),
     * Giờ công, Tăng ca TC1 (ngày thường) / TC2 (cuối tuần) / TC3 (lễ), V (vắng), nghỉ từng loại, Trễ, Sớm (số lần).
     * Chế độ theo giờ: bỏ nhóm Tăng ca. */
    case 'hourstat': {
      const dayCols = days.map((d) => ({ key: 'd' + d, label: d.slice(8), sub: WD_LABEL[new Date(d + 'T12:00:00Z').getUTCDay()], weekend: ctx.isWeekend(d), w: 6 }));
      const columns = [
        { key: 'stt', label: 'STT', w: 5 }, { key: 'dept', label: 'Phòng ban', w: 14 },
        { key: 'code', label: 'Mã nhân viên', w: 12 }, { key: 'name', label: 'Tên nhân viên', w: 20 },
        { key: 'hire', label: 'Ngày vào làm', w: 11 }, ...dayCols,
        { key: 'gio', label: 'Giờ công', w: 9 },
        ...(HOURLY ? [] : otColDefs(ctx).map(([key, label]) => ({ key, label, grp: 'Tăng ca', w: 7 }))),
        { key: 'V', label: 'V', w: 6 }, ...leaveCols(ctx, true).map((c) => ({ ...c, w: 8 })),
        { key: 'lateN', label: 'Trễ', w: 6 }, { key: 'earlyN', label: 'Sớm', w: 6 },
      ];
      let stt = 0;
      const rows = ctx.employees.map((e) => {
        const row = { stt: ++stt, dept: e.department || '', code: e.code, name: e.full_name, hire: '', ...leaveCounts(ctx, e.id, days) };
        let mins = 0, V = 0, lateN = 0, earlyN = 0;
        const ot = { ot1: 0, ot2: 0, ot3: 0, ot4: 0, otE: 0, otH: 0 };
        for (const d of days) {
          const c = ctx.cell.get(e.id + '|' + d);
          const lv = ctx.leaveDays.get(e.id + '|' + d);
          row['d' + d] = c && c.work_minutes > 0 ? round2(c.work_minutes / 60) : (lv ? lv.sym : 0);
          if (c) {
            mins += c.work_minutes || 0;
            const om = otCellMin(c); for (const k in ot) ot[k] += om[k];
            if (c.late_min > 0) lateN++;
            if (c.early_min > 0) earlyN++;
          }
          if (symbolOf(ctx, e.id, d) === 'V') V++;
        }
        for (const k in ot) row[k] = round2(ot[k] / 60);
        Object.assign(row, { gio: round2(mins / 60), V, lateN, earlyN });
        return row;
      });
      return { title: `Bảng thống kê chấm công (giờ) ${PERIOD}`, columns, rows };
    }

    /* --- Ký hiệu (X/V/T/P/L/O) --- */
    case 'symbol': {
      const dayCols = days.map((d) => ({ key: 'd' + d, label: d.slice(8), weekend: ctx.isWeekend(d) }));
      const columns = [
        { key: 'code', label: 'Mã NV', w: 10 }, { key: 'name', label: 'Họ tên', w: 22 },
        { key: 'dept', label: 'Bộ phận', w: 14 }, ...dayCols,
        { key: 'X', label: 'X', w: 5 }, { key: 'T', label: 'T', w: 5 },
        ...(ctx.leaveKinds.length ? ctx.leaveKinds.map((k) => ({ key: k.key, label: k.sym, w: 5 })) : [{ key: 'P', label: 'P', w: 5 }]),
        { key: 'L', label: 'L', w: 5 }, { key: 'V', label: 'V', w: 5 }, { key: 'O', label: 'O', w: 5 },
        ...(HOURLY ? [{ key: 'gio', label: 'Tổng giờ', w: 9 }] : []),
      ];
      const rows = ctx.employees.map((e) => {
        const row = { code: e.code, name: e.full_name, dept: e.department || '', ...leaveCounts(ctx, e.id, days) };
        const cnt = { X: 0, T: 0, P: 0, L: 0, V: 0, O: 0 };
        let mins = 0;
        for (const d of days) {
          const s = symbolOf(ctx, e.id, d);
          row['d' + d] = s === 'P' ? ctx.leaveDays.get(e.id + '|' + d).sym : s;   // P / KL / CT / K
          if (cnt[s] != null) cnt[s]++; mins += (ctx.cell.get(e.id + '|' + d)?.work_minutes || 0);
        }
        Object.assign(row, cnt);
        if (HOURLY) row.gio = round2(mins / 60);
        return row;
      });
      return { title: `Bảng ký hiệu ${PERIOD} (X=làm, T=trễ/sớm, P=phép, KL=không lương, CT=công tác, K=nghỉ khác, L=lễ, V=vắng, O=thiếu ra)`, columns, rows };
    }

    /* --- Chi tiết giờ vào/ra theo ngày (ma trận) --- */
    case 'daytime': {
      const dayCols = days.map((d) => ({ key: 'd' + d, label: d.slice(8), weekend: ctx.isWeekend(d) }));
      const columns = [
        { key: 'code', label: 'Mã NV', w: 10 }, { key: 'name', label: 'Họ tên', w: 22 },
        { key: 'dept', label: 'Bộ phận', w: 14 }, ...dayCols,
        { key: 'total', label: 'Tổng công', w: 10 },
      ];
      const rows = ctx.employees.map((e) => {
        const row = { code: e.code, name: e.full_name, dept: e.department || '' };
        let total = 0;
        for (const d of days) {
          const c = ctx.cell.get(e.id + '|' + d);
          if (c && c.check_in_at) {
            const io = ioOf(e.id, d, c);
            row['d' + d] = io.pairs ? io.pairs.map(([a, b]) => isoToVnHM(a) + '-' + (b ? isoToVnHM(b) : '?')).join('\n') : io.cin + '-' + (io.cout || '?');
            total += c.work_unit || 0;
          } else row['d' + d] = ctx.leaveDays.has(e.id + '|' + d) ? ctx.leaveDays.get(e.id + '|' + d).sym : '';
        }
        row.total = round2(total);
        return row;
      });
      return { title: `Chi tiết giờ vào/ra ${PERIOD}`, columns, rows };
    }

    /* --- Giờ công / giờ tăng ca theo ngày (ma trận) — mẫu GioChamGioCongGioTangCa --- */
    case 'workhours': {
      // Mỗi NV = 3 dòng (giống mẫu + bản xuất Excel): Giờ Vào–Ra / Giờ công / Giờ tăng ca.
      // Mỗi ngày tách 2 cột: Vào | Ra.
      const dayCols = [];
      for (const d of days) {
        const wk = ctx.isWeekend(d);
        dayCols.push({ key: 'd' + d + 'i', label: d.slice(8), weekend: wk });
        dayCols.push({ key: 'd' + d + 'o', label: 'Ra', weekend: wk });
      }
      const columns = [
        { key: 'code', label: 'Mã NV', w: 10 }, { key: 'name', label: 'Họ tên', w: 20 },
        { key: 'dept', label: 'Bộ phận', w: 12 }, { key: 'loai', label: 'Chỉ tiêu', w: 12 },
        ...dayCols, { key: 'total', label: 'Tổng', w: 9 },
      ];
      const rows = [];
      for (const e of ctx.employees) {
        const rIn = { code: e.code, name: e.full_name, dept: e.department || '', loai: 'Giờ Vào–Ra' };
        const rCong = { code: '', name: '', dept: '', loai: 'Giờ công' };
        const rOt = { code: '', name: '', dept: '', loai: 'Giờ tăng ca' };
        let totalMin = 0, otMin = 0;
        for (const d of days) {
          const c = ctx.cell.get(e.id + '|' + d);
          const io = ioOf(e.id, d, c);
          rIn['d' + d + 'i'] = io.cin;
          rIn['d' + d + 'o'] = io.cout;
          rCong['d' + d + 'i'] = c ? round2((c.work_minutes || 0) / 60) : ''; rCong['d' + d + 'o'] = '';
          rOt['d' + d + 'i'] = c ? round2((c.ot_min || 0) / 60) : ''; rOt['d' + d + 'o'] = '';
          if (c) { totalMin += c.work_minutes || 0; otMin += c.ot_min || 0; }
        }
        rIn.total = ''; rCong.total = round2(totalMin / 60); rOt.total = round2(otMin / 60);
        rows.push(rIn, rCong, rOt);
      }
      return { title: `Giờ công & tăng ca ${PERIOD}`, columns, rows };
    }

    /* --- Vắng mặt / nghỉ phép — mẫu VangMatNghiPhep --- */
    case 'absence': {
      const columns = [
        { key: 'code', label: 'Mã NV', w: 10 }, { key: 'name', label: 'Họ tên', w: 22 }, { key: 'dept', label: 'Bộ phận', w: 14 },
        { key: 'work', label: 'Ngày làm', w: 10 }, { key: 'absent', label: 'Vắng', w: 8 },
        ...leaveCols(ctx, true), ...(ctx.leaveKinds.length > 1 ? [{ key: 'leave', label: 'Tổng nghỉ', w: 10 }] : []),
        { key: 'holiday', label: 'Nghỉ lễ', w: 9 }, { key: 'missing', label: 'Thiếu ra', w: 9 },
      ];
      const rows = ctx.employees.map((e) => {
        const cnt = { X: 0, T: 0, P: 0, L: 0, V: 0, O: 0 };
        for (const d of days) { const s = symbolOf(ctx, e.id, d); if (cnt[s] != null) cnt[s]++; }
        return { code: e.code, name: e.full_name, dept: e.department || '', work: cnt.X + cnt.T, absent: cnt.V, leave: cnt.P, holiday: cnt.L, missing: cnt.O, ...leaveCounts(ctx, e.id, days) };
      });
      return { title: `Vắng mặt / nghỉ phép ${PERIOD}`, columns, rows };
    }

    /* --- Tổng hợp theo nhân viên --- */
    case 'summary': {
      const columns = [
        { key: 'code', label: 'Mã NV', w: 10 }, { key: 'name', label: 'Họ tên', w: 22 }, { key: 'dept', label: 'Bộ phận', w: 14 },
        ...(HOURLY ? [{ key: 'gio', label: 'Tổng giờ', w: 10 }]
          : [{ key: 'cong', label: 'Tổng công', w: 10 }, { key: 'gio', label: 'Tổng giờ', w: 10 }, { key: 'ot', label: 'Tăng ca (giờ)', w: 12 }]),
        { key: 'lateN', label: 'Trễ (lần)', w: 9 }, { key: 'lateM', label: 'Trễ (phút)', w: 10 },
        { key: 'earlyN', label: 'Sớm (lần)', w: 9 }, { key: 'earlyM', label: 'Sớm (phút)', w: 10 }, { key: 'vang', label: 'Vắng', w: 8 },
        ...leaveCols(ctx),
      ];
      const rows = ctx.employees.map((e) => {
        let cong = 0, minutes = 0, ot = 0, lateN = 0, lateM = 0, earlyN = 0, earlyM = 0, vang = 0;
        for (const d of days) {
          const c = ctx.cell.get(e.id + '|' + d);
          if (c) {
            cong += (c.work_unit || 0); minutes += (c.work_minutes || 0); ot += (c.ot_min || 0);
            if (c.late_min > 0) { lateN++; lateM += c.late_min; }
            if (c.early_min > 0) { earlyN++; earlyM += c.early_min; }
          }
          if (symbolOf(ctx, e.id, d) === 'V') vang++;
        }
        return {
          id: e.id, code: e.code, name: e.full_name, dept: e.department || '',
          cong: round2(cong), gio: round2(minutes / 60), ot: round2(ot / 60),
          lateN, lateM, earlyN, earlyM, vang, ...leaveCounts(ctx, e.id, days),
        };
      });
      return { title: `Tổng hợp chấm công ${PERIOD}`, columns, rows };
    }

    /* --- Chi tiết chấm công (từng ngày có dữ liệu) --- */
    case 'detail': {
      const columns = [
        { key: 'date', label: 'Ngày', w: 12 }, { key: 'wd', label: 'Thứ', w: 6 },
        { key: 'code', label: 'Mã NV', w: 10 }, { key: 'name', label: 'Họ tên', w: 20 }, { key: 'dept', label: 'Bộ phận', w: 13 },
        { key: 'shift', label: 'Ca', w: 12 }, { key: 'inCa', label: 'Giờ vào ca', w: 10 }, { key: 'outCa', label: 'Giờ ra ca', w: 10 },
        { key: 'inReal', label: 'Vào thực', w: 9 }, { key: 'outReal', label: 'Ra thực', w: 9 },
        { key: 'late', label: 'Trễ (p)', w: 8 }, { key: 'early', label: 'Sớm (p)', w: 8 }, { key: 'ot', label: 'OT (p)', w: 8 },
        { key: 'cong', label: 'Công', w: 7 }, { key: 'status', label: 'Trạng thái', w: 13 },
      ];
      const rows = sortedResults().map((c) => ({
        date: fmtDMY(c.work_date), wd: WD[vnWeekday(c.work_date)],
        code: c.code, name: c.full_name, dept: c.department || '', shift: c.shift_name || '',
        inCa: c.shift_start || '', outCa: c.shift_end || '',
        inReal: ioOf(c.employee_id, c.work_date, c).cin, outReal: ioOf(c.employee_id, c.work_date, c).cout,
        late: c.late_min || 0, early: c.early_min || 0, ot: c.ot_min || 0,
        cong: round2(c.work_unit), status: c.check_out_at ? (c.late_min > 0 ? 'Đi muộn' : c.early_min > 0 ? 'Về sớm' : 'Đủ công') : 'Thiếu ra',
      }));
      return { title: `Chi tiết chấm công ${PERIOD}`, columns, rows };
    }

    /* --- Chi tiết chấm công (danh sách: mỗi NV × mỗi ngày 1 dòng) — mẫu BCC --- */
    case 'detaillist': {
      const columns = [
        { key: 'stt', label: 'STT', w: 6 }, { key: 'code', label: 'Mã nhân viên', w: 12 },
        { key: 'name', label: 'Tên nhân viên', w: 22 }, { key: 'dept', label: 'Phòng ban', w: 14 },
        { key: 'date', label: 'Ngày', w: 12 }, { key: 'wd', label: 'Thứ', w: 6 },
        { key: 'cin', label: 'Giờ vào', w: 9 }, { key: 'cout', label: 'Giờ ra', w: 9 },
        { key: 'late', label: 'Trễ', w: 7 }, { key: 'early', label: 'Sớm', w: 7 },
        { key: 'cong', label: 'Công', w: 7 }, { key: 'gio', label: 'Tổng giờ', w: 9 },
        { key: 'ot', label: 'Tăng ca', w: 9 }, { key: 'gross', label: 'Tổng toàn bộ', w: 12 },
        { key: 'ca', label: 'Ca', w: 8 },
      ];
      const rows = [];
      let stt = 0;
      for (const e of ctx.employees) {
        for (const d of days) {
          const c = ctx.cell.get(e.id + '|' + d);
          const isLeave = ctx.leaveDays.has(e.id + '|' + d);
          if (!c && !ctx.isScheduled(e.id, d) && !isLeave) continue; // bỏ ngày không lịch, không chấm, không nghỉ
          stt++;
          const gross = (c && c.check_in_at && c.check_out_at)
            ? round2((new Date(c.check_out_at) - new Date(c.check_in_at)) / 3600000) : 0;
          rows.push({
            stt, code: e.code, name: e.full_name, dept: e.department || '',
            date: fmtDMY(d), wd: WD[vnWeekday(d)],
            cin: ioOf(e.id, d, c).cin, cout: ioOf(e.id, d, c).cout,
            late: c ? (c.late_min || 0) : 0, early: c ? (c.early_min || 0) : 0,
            cong: c ? round2(c.work_unit) : 0, gio: c ? round2((c.work_minutes || 0) / 60) : 0,
            ot: c ? round2((c.ot_min || 0) / 60) : 0, gross,
            ca: c ? (c.shift_name || 'HC') : (isLeave ? ctx.leaveDays.get(e.id + '|' + d).label : (symbolOf(ctx, e.id, d) || 'V')),
          });
        }
      }
      return { title: `Chi tiết chấm công ${PERIOD}`, columns, rows };
    }

    /* --- Bảng chi tiết từng NV (in A4): màn hình xem dạng danh sách; Excel mới chia mỗi NV 1 trang --- */
    case 'empsheet':
      return { ...buildReportRaw('detailmulti', from, to, filter), title: `Bảng chi tiết chấm công từng nhân viên ${PERIOD} — bấm Xuất Excel để in mỗi người 1 trang A4` };
    case 'empsheetlate': {
      const base = buildReportRaw('detailmulti', from, to, filter);
      const rows = base.rows.filter((w) => (w.late || 0) > 0 || (w.early || 0) > 0);
      return { ...base, rows, title: `Đi muộn / về sớm theo nhân viên ${PERIOD} — bấm Xuất Excel để in mỗi người 1 trang A4` };
    }

    /* --- Chi tiết chấm công NHIỀU LẦN VÀO/RA: mỗi NV × mỗi ngày 1 dòng, các lần chấm xếp vào Vào1/Ra1 … Vào4/Ra4 --- */
    case 'detailmulti': {
      const PAIRS = 4;
      const columns = [
        { key: 'stt', label: 'STT', w: 6 }, { key: 'code', label: 'Mã nhân viên', w: 12 },
        { key: 'name', label: 'Tên nhân viên', w: 22 }, { key: 'dept', label: 'Phòng ban', w: 14 },
        { key: 'date', label: 'Ngày', w: 12 }, { key: 'wd', label: 'Thứ', w: 6 },
      ];
      for (let i = 1; i <= PAIRS; i++) columns.push({ key: 'in' + i, label: 'Giờ vào ' + i, w: 9 }, { key: 'out' + i, label: 'Giờ ra ' + i, w: 9 });
      columns.push({ key: 'late', label: 'Trễ', w: 7 }, { key: 'early', label: 'Sớm', w: 7 }, { key: 'gio', label: 'Tổng giờ', w: 9 },
        { key: 'cong', label: 'Công', w: 7 }, { key: 'ot', label: 'Tăng ca', w: 9 });
      if (ctx.leaveKinds.length) columns.push({ key: 'note', label: 'Nghỉ', w: 11 });


      const rows = [];
      let stt = 0;
      for (const e of ctx.employees) {
        for (const d of days) {
          const k = e.id + '|' + d;
          const c = ctx.cell.get(k);
          const isLeave = ctx.leaveDays.has(k);
          if (!c && !ctx.isScheduled(e.id, d) && !isLeave) continue; // bỏ ngày không lịch, không chấm, không nghỉ
          stt++;
          const row = { stt, code: e.code, name: e.full_name, dept: e.department || '', date: fmtDMY(d), wd: WD[vnWeekday(d)] };
          const io = c ? ioOf(e.id, d, c) : null;
          const ts = !io ? [] : io.pairs ? io.pairs.flat().filter(Boolean) : [c.check_in_at, c.check_out_at].filter(Boolean);
          for (let i = 0; i < PAIRS * 2; i++) row[(i % 2 ? 'out' : 'in') + (Math.floor(i / 2) + 1)] = ts[i] ? isoToVnHM(ts[i]) : '';
          Object.assign(row, {
            late: c ? (c.late_min || 0) : 0, early: c ? (c.early_min || 0) : 0,
            gio: c ? round2((c.work_minutes || 0) / 60) : 0, cong: c ? round2(c.work_unit) : 0,
            ot: c ? round2((c.ot_min || 0) / 60) : 0,
            note: isLeave ? ctx.leaveDays.get(k).label : '',
          });
          rows.push(row);
        }
      }
      return { title: `Chi tiết chấm công ${PERIOD}`, columns, rows };
    }

    /* --- Chấm công (mọi bản ghi) --- */
    case 'attendance': {
      const columns = [
        { key: 'date', label: 'Ngày', w: 12 }, { key: 'code', label: 'Mã NV', w: 10 }, { key: 'name', label: 'Họ tên', w: 20 },
        { key: 'dept', label: 'Bộ phận', w: 13 }, { key: 'inReal', label: 'Giờ vào', w: 9 }, { key: 'outReal', label: 'Giờ ra', w: 9 },
        { key: 'place', label: 'Nơi chấm', w: 14 }, { key: 'late', label: 'Trễ (p)', w: 8 }, { key: 'early', label: 'Sớm (p)', w: 8 },
        { key: 'gio', label: 'Tổng giờ', w: 9 }, { key: 'phut', label: 'Tổng phút', w: 9 }, { key: 'ot', label: 'OT (p)', w: 8 }, { key: 'cong', label: 'Công', w: 7 },
      ];
      const rows = sortedResults().map((c) => ({
        date: fmtDMY(c.work_date), code: c.code, name: c.full_name, dept: c.department || '',
        inReal: ioOf(c.employee_id, c.work_date, c).cin, outReal: ioOf(c.employee_id, c.work_date, c).cout,
        place: c.check_in_outside ? 'Ngoài VP' : 'Trong VP',
        late: c.late_min || 0, early: c.early_min || 0, gio: round2((c.work_minutes || 0) / 60), phut: Math.round(c.work_minutes || 0),
        ot: c.ot_min || 0, cong: round2(c.work_unit),
      }));
      return { title: `Báo cáo chấm công ${PERIOD}`, columns, rows };
    }

    /* --- Đi muộn / về sớm --- */
    case 'late': {
      const columns = [
        { key: 'date', label: 'Ngày', w: 12 }, { key: 'code', label: 'Mã NV', w: 10 }, { key: 'name', label: 'Họ tên', w: 20 },
        { key: 'dept', label: 'Bộ phận', w: 13 }, { key: 'inReal', label: 'Giờ vào', w: 9 }, { key: 'outReal', label: 'Giờ ra', w: 9 },
        { key: 'late', label: 'Đi muộn (p)', w: 11 }, { key: 'early', label: 'Về sớm (p)', w: 11 },
      ];
      const rows = sortedResults().filter((c) => c.late_min > 0 || c.early_min > 0).map((c) => ({
        date: fmtDMY(c.work_date), code: c.code, name: c.full_name, dept: c.department || '',
        inReal: ioOf(c.employee_id, c.work_date, c).cin, outReal: ioOf(c.employee_id, c.work_date, c).cout,
        late: c.late_min || 0, early: c.early_min || 0,
      }));
      return { title: `Đi muộn / về sớm ${PERIOD}`, columns, rows };
    }

    /* --- Tăng ca --- */
    case 'ot': {
      if (HOURLY) {   // theo giờ không có tăng ca → liệt kê tổng giờ làm từng ngày
        const columns = [
          { key: 'date', label: 'Ngày', w: 12 }, { key: 'code', label: 'Mã NV', w: 10 }, { key: 'name', label: 'Họ tên', w: 20 },
          { key: 'dept', label: 'Bộ phận', w: 13 }, { key: 'inReal', label: 'Giờ vào', w: 9 }, { key: 'outReal', label: 'Giờ ra', w: 9 },
          { key: 'gio', label: 'Tổng giờ', w: 9 }, { key: 'phut', label: 'Tổng phút', w: 9 },
        ];
        const rows = sortedResults().filter((c) => c.work_minutes > 0).map((c) => ({
          date: fmtDMY(c.work_date), code: c.code, name: c.full_name, dept: c.department || '',
          inReal: ioOf(c.employee_id, c.work_date, c).cin, outReal: ioOf(c.employee_id, c.work_date, c).cout,
          gio: round2((c.work_minutes || 0) / 60), phut: Math.round(c.work_minutes || 0),
        }));
        return { title: `Tổng giờ làm chi tiết ${PERIOD}`, columns, rows };
      }
      const columns = [
        { key: 'date', label: 'Ngày', w: 12 }, { key: 'code', label: 'Mã NV', w: 10 }, { key: 'name', label: 'Họ tên', w: 20 },
        { key: 'dept', label: 'Bộ phận', w: 13 }, { key: 'inReal', label: 'Giờ vào', w: 9 }, { key: 'outReal', label: 'Giờ ra', w: 9 },
        { key: 'otp', label: 'Tăng ca (p)', w: 11 }, { key: 'oth', label: 'Tăng ca (giờ)', w: 12 }, { key: 'loai', label: 'Loại OT', w: 14 },
        ...(ctx.hasTiers ? ['TC1', 'TC2', 'TC3', 'TC4'].map((l, i) => ({ key: 'tier' + i, label: l + ' (giờ)', w: 9 })) : []),
      ];
      const rows = sortedResults().filter((c) => c.ot_min > 0).map((c) => ({
        date: fmtDMY(c.work_date), code: c.code, name: c.full_name, dept: c.department || '',
        inReal: ioOf(c.employee_id, c.work_date, c).cin, outReal: ioOf(c.employee_id, c.work_date, c).cout,
        otp: c.ot_min || 0, oth: round2((c.ot_min || 0) / 60), loai: OT_LABEL[c.ot_type] || '',
        ...Object.fromEntries((c._tiers || [0, 0, 0, 0]).map((m, i) => ['tier' + i, round2(m / 60)])),
      }));
      return { title: `Tăng ca chi tiết ${PERIOD}`, columns, rows };
    }

    /* --- Giờ vào đầu / ra cuối --- */
    case 'firstlast': {
      const columns = [
        { key: 'date', label: 'Ngày', w: 12 }, { key: 'code', label: 'Mã NV', w: 10 }, { key: 'name', label: 'Họ tên', w: 20 },
        { key: 'dept', label: 'Bộ phận', w: 13 }, { key: 'first', label: 'Vào đầu', w: 9 }, { key: 'last', label: 'Ra cuối', w: 9 },
        { key: 'punches', label: 'Số lần chấm', w: 11 }, { key: 'phut', label: 'Số phút', w: 9 }, { key: 'gio', label: 'Số giờ', w: 8 },
      ];
      // Số lần chấm: ưu tiên đếm từ máy (device_punches); NV chấm điện thoại thì đếm vào/ra
      const pcMap = new Map();
      for (const p of db.prepare('SELECT employee_id, work_date, COUNT(*) c FROM device_punches WHERE work_date >= ? AND work_date <= ? GROUP BY employee_id, work_date').all(from, to))
        pcMap.set(p.employee_id + '|' + p.work_date, p.c);
      const rows = sortedResults().filter((c) => c.check_in_at).map((c) => {
        const mins = c.check_out_at ? Math.round((new Date(c.check_out_at) - new Date(c.check_in_at)) / 60000) : 0;
        const punches = pcMap.get(c.employee_id + '|' + c.work_date) || ((c.check_in_at ? 1 : 0) + (c.check_out_at ? 1 : 0));
        return {
          date: fmtDMY(c.work_date), code: c.code, name: c.full_name, dept: c.department || '',
          first: isoToVnHM(c.check_in_at), last: isoToVnHM(c.check_out_at),
          punches, phut: mins, gio: round2(mins / 60),
        };
      });
      return { title: `Giờ vào đầu & ra cuối ${PERIOD}`, columns, rows };
    }

    /* --- Nghỉ phép / vắng (từ đơn từ) --- */
    case 'leave': {
      const columns = [
        { key: 'code', label: 'Mã NV', w: 10 }, { key: 'name', label: 'Họ tên', w: 20 }, { key: 'dept', label: 'Bộ phận', w: 13 },
        { key: 'type', label: 'Loại đơn', w: 14 }, { key: 'from', label: 'Từ ngày', w: 12 }, { key: 'to', label: 'Đến ngày', w: 12 },
        { key: 'days', label: 'Số ngày', w: 8 }, { key: 'reason', label: 'Lý do', w: 24 }, { key: 'status', label: 'Trạng thái', w: 11 },
      ];
      const stLabel = { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối' };
      const rows = ctx.leaveRows.map((l) => ({
        code: l.code, name: l.full_name, dept: l.department || '', type: l.type,
        from: fmtDMY(l.from_date), to: fmtDMY(l.to_date),
        days: Math.round((new Date(l.to_date) - new Date(l.from_date)) / 86400000) + 1,
        reason: l.reason || '', status: stLabel[l.status] || l.status,
      }));
      return { title: `Nghỉ phép / đơn từ ${PERIOD}`, columns, rows };
    }

    /* --- Bảng lương (luôn theo THÁNG chứa ngày bắt đầu) --- */
    case 'payroll': {
      const [y, m] = from.split('-').map(Number);
      const { from: pFrom, to: pTo, rows: pr } = computePayrollTable(y, m, filter);
      const money = (n) => (n || 0).toLocaleString('vi-VN');
      if (HOURLY) {   // theo giờ: lương = tổng giờ × đơn giá giờ + phụ cấp
        const columns = [
          { key: 'code', label: 'Mã NV', w: 10 }, { key: 'name', label: 'Họ tên', w: 22 }, { key: 'dept', label: 'Bộ phận', w: 14 },
          { key: 'days', label: 'Số ngày làm', w: 10 }, { key: 'gio', label: 'Tổng giờ', w: 10 }, { key: 'rate', label: 'Đơn giá giờ', w: 12 },
          { key: 'workpay', label: 'Lương theo giờ', w: 14 }, { key: 'allow', label: 'Phụ cấp', w: 11 }, { key: 'net', label: 'Thực lĩnh', w: 14 },
        ];
        const rows = pr.map(({ emp, pay }) => ({
          code: emp.code, name: emp.full_name, dept: emp.department || '',
          days: pay.daysWorked ?? pay.workUnits, gio: pay.totalHours ?? 0, rate: money(pay.hourlyRate),
          workpay: money(pay.workSalary), allow: money(pay.allowance), net: money(pay.net),
        }));
        return { title: `Bảng lương theo giờ tháng ${String(m).padStart(2, '0')}/${y} (kỳ ${fmtDMY(pFrom)} - ${fmtDMY(pTo)})`, columns, rows };
      }
      const columns = [
        { key: 'code', label: 'Mã NV', w: 10 }, { key: 'name', label: 'Họ tên', w: 22 }, { key: 'dept', label: 'Bộ phận', w: 14 },
        { key: 'cong', label: 'Ngày công', w: 9 }, { key: 'phep', label: 'Nghỉ phép', w: 9 }, { key: 'ot', label: 'OT (giờ)', w: 9 },
        { key: 'dayrate', label: 'Đơn giá ngày', w: 13 }, { key: 'workpay', label: 'Lương công', w: 13 },
        { key: 'leavepay', label: 'Lương phép', w: 12 }, { key: 'otpay', label: 'Lương OT', w: 12 },
        { key: 'allow', label: 'Phụ cấp', w: 11 }, { key: 'net', label: 'Thực lĩnh', w: 14 },
      ];
      const rows = pr.map(({ emp, pay }) => ({
        code: emp.code, name: emp.full_name, dept: emp.department || '',
        cong: pay.workUnits, phep: pay.paidLeaveDays, ot: pay.otHoursTotal,
        dayrate: money(pay.dailyRate), workpay: money(pay.workSalary), leavepay: money(pay.paidLeaveSalary),
        otpay: money(pay.otSalary), allow: money(pay.allowance), net: money(pay.net),
      }));
      return { title: `Bảng lương tháng ${String(m).padStart(2, '0')}/${y} (kỳ ${fmtDMY(pFrom)} - ${fmtDMY(pTo)})`, columns, rows };
    }

    default:
      return buildReport('horizontal', from, to, filter);
  }
}

/* ===== "Bảng chi tiết chấm công" từng nhân viên — mỗi NV 1 trang A4 (in ký xác nhận) =====
 * onlyLateEarly = true: chỉ NV có đi muộn/về sớm, và chỉ những ngày đó ("Đi muộn / về sớm theo NV").
 * Giờ vào/ra theo quy tắc ghép log (theo cặp → nhiều cặp; FILO → cặp 1 = đầu/cuối).
 * Chế độ theo giờ: bỏ Công + Tăng ca. */
async function exportEmpSheetXlsx(res, from, to, filter, company, onlyLateEarly) {
  const ctx = loadRange(from, to, filter);
  const days = daysBetween(from, to);
  const ioOf = inOutResolver(ctx.employees, from, to);
  const HOURLY = getSetting('attendance_mode', 'shift') === 'hourly';
  const PAIRS = 4;
  const TITLE = onlyLateEarly ? 'BẢNG ĐI MUỘN / VỀ SỚM' : 'BẢNG CHI TIẾT CHẤM CÔNG';
  const vnMs = (iso) => new Date(iso).getTime();
  const endOfShift = (d, hm) => new Date(`${d}T${hm}:00+07:00`).getTime();

  // Cột phần chi tiết (dựng động: theo giờ thì bỏ Công/Tăng ca)
  const cols = [{ k: 'date', h: 'Ngày', w: 11 }, { k: 'wd', h: 'Thứ', w: 5 }];
  for (let i = 1; i <= PAIRS; i++) cols.push({ k: 'in' + i, h: 'Vào', grp: String(i), w: 6.3 }, { k: 'out' + i, h: 'Ra', grp: String(i), w: 6.3 });
  cols.push({ k: 'late', h: 'Trễ', w: 5.5 }, { k: 'early', h: 'Sớm', w: 5.5 }, { k: 'over', h: 'Về trễ', w: 6 }, { k: 'gio', h: 'Giờ', w: 6 });
  if (!HOURLY) cols.push({ k: 'cong', h: 'Công', w: 6 }, ...otColDefs(ctx).map(([k, h]) => ({ k, h, w: 6 })));
  cols.push({ k: 'sym', h: 'Ký hiệu', w: 7 });
  const NC = cols.length;

  const wb = new ExcelJS.Workbook(); wb.creator = 'Digiplus';
  const ws = wb.addWorksheet(onlyLateEarly ? 'DiMuonVeSom' : 'ChiTietTungNV', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      horizontalCentered: true, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
  });
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.w; });
  const thin = { style: 'thin', color: { argb: 'FF000000' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  const box = (r1, c1, r2, c2, value, style = {}) => {
    if (r1 !== r2 || c1 !== c2) ws.mergeCells(r1, c1, r2, c2);
    const cell = ws.getCell(r1, c1);
    cell.value = value;
    Object.assign(cell, style);
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) ws.getCell(r, c).border = border;
    return cell;
  };
  const C = { horizontal: 'center', vertical: 'middle', wrapText: true };
  const L = { horizontal: 'left', vertical: 'middle' };
  const R = { horizontal: 'right', vertical: 'middle' };

  let r = 1, printed = 0;
  for (const e of ctx.employees) {
    // Dữ liệu từng ngày
    const lines = [];
    let mins = 0, cong = 0, otMin = 0, lateN = 0, lateM = 0, earlyN = 0, earlyM = 0, vangKP = 0, vangCP = 0;
    for (const d of days) {
      const c = ctx.cell.get(e.id + '|' + d);
      const sym = symbolOf(ctx, e.id, d);
      if (sym === 'V') vangKP++;
      if (sym === 'P') vangCP++;
      if (c) {
        mins += c.work_minutes || 0; cong += c.work_unit || 0; otMin += c.ot_min || 0;
        if (c.late_min > 0) { lateN++; lateM += c.late_min; }
        if (c.early_min > 0) { earlyN++; earlyM += c.early_min; }
      }
      if (onlyLateEarly && !(c && (c.late_min > 0 || c.early_min > 0))) continue;
      const io = c ? ioOf(e.id, d, c) : null;
      const ps = !io || !c.check_in_at ? [] : io.pairs ? io.pairs : [[c.check_in_at, c.check_out_at]];
      const row = { date: fmtDMY(d), wd: WD[vnWeekday(d)], weekend: ctx.isWeekend(d), sym: sym === 'P' ? ctx.leaveDays.get(e.id + '|' + d).sym : sym };
      for (let i = 0; i < PAIRS; i++) {
        row['in' + (i + 1)] = ps[i] && ps[i][0] ? isoToVnHM(ps[i][0]) : '';
        row['out' + (i + 1)] = ps[i] && ps[i][1] ? isoToVnHM(ps[i][1]) : '';
      }
      const over = (!HOURLY && c && c.check_out_at && c.shift_end) ? Math.max(0, Math.round((vnMs(c.check_out_at) - endOfShift(d, c.shift_end)) / 60000)) : 0;
      Object.assign(row, {
        late: c ? (c.late_min || 0) : 0, early: c ? (c.early_min || 0) : 0, over: over > 0 && over < 12 * 60 ? over : 0,
        gio: c ? round2((c.work_minutes || 0) / 60) : 0, cong: c ? round2(c.work_unit) : 0,
        ...Object.fromEntries(Object.entries(otCellMin(c)).map(([k, m]) => [k, round2(m / 60)])),
      });
      lines.push(row);
    }
    if (onlyLateEarly && !lines.length) continue;   // NV không đi muộn/về sớm ngày nào → bỏ

    if (printed) ws.getRow(r - 1).addPageBreak();   // mỗi NV 1 trang
    printed++;
    const top = r;
    // Tiêu đề + dòng thông tin NV
    box(r, 1, r, NC, TITLE, { font: { bold: true, size: 16 }, alignment: C }); ws.getRow(r).height = 26; r++;
    box(r, 1, r, NC, `Mã: ${e.code}     Tên: ${e.full_name}     Phòng ban: ${e.department || '---'}     Kỳ: ${fmtDMY(from)} – ${fmtDMY(to)}`,
      { font: { bold: true, size: 12 }, alignment: L, fill: fill('FFFFFF00') }); ws.getRow(r).height = 20; r++;
    // 3 khối tổng hợp
    const third = Math.floor(NC / 3);
    const blocks = [
      HOURLY ? [['Tổng giờ', round2(mins / 60)], ['Số ngày làm', lines.length && !onlyLateEarly ? days.filter((d) => (ctx.cell.get(e.id + '|' + d)?.work_minutes || 0) > 0).length : '']]
        : [['Tổng giờ', round2(mins / 60)], ['Tổng công', round2(cong)], ['Tăng ca (giờ)', round2(otMin / 60)]],
      [['Số lần trễ', lateN], ['Số lần sớm', earlyN], ['Vắng không phép', vangKP]],
      [['Số phút trễ', lateM], ['Số phút sớm', earlyM], ['Vắng có phép', vangCP]],
    ];
    // Kỳ có nghỉ → thêm số ngày nghỉ TỪNG LOẠI (xếp lần lượt vào 3 khối)
    const lc = leaveCounts(ctx, e.id, days);
    ctx.leaveKinds.forEach((k, i) => blocks[i % 3].push([k.label, lc[k.key]]));
    const nBlockRows = Math.max(...blocks.map((b) => b.length));
    for (let i = 0; i < nBlockRows; i++) {
      const rr = r + i;
      for (let b = 0; b < 3; b++) {
        const c1 = 1 + b * third, c2 = b === 2 ? NC : c1 + third - 1;
        const item = blocks[b][i];
        const mid = c2 - 1;
        box(rr, c1, rr, mid, item ? item[0] : '', { font: { bold: true }, alignment: L });
        box(rr, c2, rr, c2, item ? item[1] : '', { font: { bold: true }, alignment: R });
      }
    }
    r += nBlockRows;
    box(r, 1, r, NC, onlyLateEarly ? 'Chi tiết các ngày đi muộn / về sớm' : 'Chi tiết', { font: { bold: true }, alignment: C }); r++;
    // Tiêu đề bảng 2 dòng
    for (let i = 0; i < NC; i++) {
      const c = cols[i];
      if (c.grp) {
        if (c.k.startsWith('in')) box(r, i + 1, r, i + 2, Number(c.grp), { font: { bold: true }, alignment: C });
        box(r + 1, i + 1, r + 1, i + 1, c.h, { font: { bold: true }, alignment: C });
      } else box(r, i + 1, r + 1, i + 1, c.h, { font: { bold: true }, alignment: C });
    }
    r += 2;
    // Dòng từng ngày
    for (const row of lines) {
      for (let i = 0; i < NC; i++) {
        const c = cols[i];
        const cell = ws.getCell(r, i + 1);
        cell.value = row[c.k] ?? '';
        cell.border = border;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        if (row.weekend) cell.fill = fill('FF9BE7F5');
      }
      r++;
    }
    if (!lines.length) { box(r, 1, r, NC, 'Không có dữ liệu trong kỳ.', { alignment: C }); r++; }
    // Ký tên
    r++;
    const sc1 = NC - 5;
    ws.mergeCells(r, sc1, r, NC); Object.assign(ws.getCell(r, sc1), { value: 'Kí tên', font: { bold: true }, alignment: C });
    r += 4;
    ws.mergeCells(r, sc1, r, NC); Object.assign(ws.getCell(r, sc1), { value: e.full_name, font: { bold: true }, alignment: C });
    r += 2;
    void top;
  }
  if (!printed) { box(1, 1, 1, NC, onlyLateEarly ? 'Không có nhân viên nào đi muộn / về sớm trong kỳ.' : 'Không có dữ liệu.', { alignment: C }); }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${onlyLateEarly ? 'dimuon_vesom_theonv' : 'chitiet_tung_nv'}_${from}_${to}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

/* ===== Xuất Excel "BẢNG THỐNG KÊ CHẤM CÔNG (GIỜ)" — tiêu đề 2 dòng như mẫu:
 * cột ngày: dòng trên = số ngày, dòng dưới = thứ; nhóm "Tăng ca" gộp trên TC1–TC3; cột khác gộp 2 dòng. */
async function exportHourStatXlsx(res, from, to, filter, company, address) {
  const { title, columns, rows } = buildReport('hourstat', from, to, filter);
  const N = columns.length;
  const wb = new ExcelJS.Workbook(); wb.creator = 'Digiplus';
  const ws = wb.addWorksheet('ThongKeGio', { pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const thin = { style: 'thin', color: { argb: 'FF000000' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const C = { horizontal: 'center', vertical: 'middle', wrapText: true };
  const weekendFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3E6' } };

  ws.mergeCells(1, 1, 1, N); Object.assign(ws.getCell(1, 1), { value: 'Công ty: ' + company.toUpperCase() });
  ws.mergeCells(2, 1, 2, N); ws.getCell(2, 1).value = 'Địa chỉ: ' + (address || '');
  ws.mergeCells(3, 1, 3, N); Object.assign(ws.getCell(3, 1), { value: 'BẢNG THỐNG KÊ CHẤM CÔNG (GIỜ)', font: { name: 'Times New Roman', size: 16, bold: true }, alignment: C });
  ws.mergeCells(4, 1, 4, N); Object.assign(ws.getCell(4, 1), { value: title.replace(/^Bảng thống kê chấm công \(giờ\)\s*/i, '').replace(/^./, (x) => x.toUpperCase()), font: { italic: true }, alignment: C });

  const H = 5;
  for (let i = 0; i < N; i++) {
    const c = columns[i], col = i + 1;
    if (c.sub) {          // cột ngày: số ngày / thứ
      ws.getCell(H, col).value = +c.label; ws.getCell(H + 1, col).value = c.sub;
    } else if (c.grp) {   // nhóm Tăng ca
      if (!columns[i - 1] || columns[i - 1].grp !== c.grp) {
        let j = i; while (columns[j + 1] && columns[j + 1].grp === c.grp) j++;
        ws.mergeCells(H, col, H, j + 1); ws.getCell(H, col).value = c.grp;
      }
      ws.getCell(H + 1, col).value = c.label;
    } else { ws.mergeCells(H, col, H + 1, col); ws.getCell(H, col).value = c.label; }
  }
  for (let rr = H; rr <= H + 1; rr++) for (let col = 1; col <= N; col++) {
    const cell = ws.getCell(rr, col);
    cell.font = { name: 'Times New Roman', bold: true }; cell.alignment = C; cell.border = border;
    if (columns[col - 1].weekend) cell.fill = weekendFill;
  }
  let r = H + 2;
  for (const row of rows) {
    for (let i = 0; i < N; i++) {
      const c = columns[i], cell = ws.getCell(r, i + 1);
      cell.value = row[c.key] ?? '';
      cell.border = border;
      cell.alignment = { horizontal: c.key === 'name' || c.key === 'dept' ? 'left' : 'center', vertical: 'middle' };
      if (c.weekend) cell.fill = weekendFill;
    }
    r++;
  }
  if (!rows.length) { ws.mergeCells(r, 1, r, N); ws.getCell(r, 1).value = 'Không có dữ liệu.'; }
  columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.w || 8; });
  ws.views = [{ state: 'frozen', ySplit: H + 1, xSplit: 4 }];

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="thongke_chamcong_gio_${from}_${to}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

/* ===== Xuất Excel "Giờ công & tăng ca" — mẫu chi tiết 3 dòng/NV (giống file mẫu) ===== */
async function exportWorkhoursXlsx(res, from, to, filter, company, address) {
  const ctx = loadRange(from, to, filter);
  const days = daysBetween(from, to);
  const ioOf = inOutResolver(ctx.employees, from, to);   // giờ vào/ra theo quy tắc ghép log
  const PERIOD = periodLabel(from, to).toUpperCase();
  const FIXED = 5;                 // STT, Phòng ban, Mã NV, Tên NV, Ngày vào làm
  const totalCols = FIXED + days.length * 2;
  const wb = new ExcelJS.Workbook(); wb.creator = 'Digiplus';
  const ws = wb.addWorksheet('GioCong');
  const thin = { style: 'thin', color: { argb: 'FFBFBFBF' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const teal = 'FF0F7D7D', pink = 'FFFFE0EC';

  // Header công ty / địa chỉ / tiêu đề + chú thích
  ws.mergeCells(1, 1, 1, totalCols); Object.assign(ws.getCell(1, 1), { value: 'Công ty: ' + company.toUpperCase(), font: { bold: true, size: 12 } });
  ws.mergeCells(2, 1, 2, totalCols); ws.getCell(2, 1).value = 'Địa chỉ: ' + (address || '');
  ws.mergeCells(3, 1, 3, totalCols); Object.assign(ws.getCell(3, 1), { value: `BẢNG CHẤM CÔNG CHI TIẾT GIỜ CÔNG & TĂNG CA ${PERIOD}`, font: { size: 14, bold: true }, alignment: { horizontal: 'center' } });
  ws.mergeCells(4, 1, 4, totalCols); Object.assign(ws.getCell(4, 1), { value: 'Mỗi nhân viên gồm 3 dòng: (1) Giờ chấm Vào–Ra · (2) Giờ công · (3) Giờ tăng ca', font: { italic: true, size: 10, color: { argb: 'FF666666' } } });

  // 2 dòng tiêu đề cột (dòng số ngày + dòng thứ)
  const H = 5;
  const fixedLabels = ['STT', 'Phòng ban', 'Mã nhân viên', 'Tên nhân viên', 'Ngày vào làm'];
  fixedLabels.forEach((lab, i) => { ws.mergeCells(H, i + 1, H + 1, i + 1); ws.getCell(H, i + 1).value = lab; });
  days.forEach((d, di) => {
    const c1 = FIXED + di * 2 + 1;
    ws.mergeCells(H, c1, H, c1 + 1); ws.getCell(H, c1).value = +d.slice(8);
    ws.mergeCells(H + 1, c1, H + 1, c1 + 1); ws.getCell(H + 1, c1).value = WD_LABEL[new Date(d + 'T12:00:00Z').getUTCDay()];
  });
  for (let r = H; r <= H + 1; r++) {
    for (let c = 1; c <= totalCols; c++) {
      const cell = ws.getCell(r, c);
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: teal } };
      cell.border = border;
    }
  }

  // Mỗi NV = 3 dòng
  let r = H + 2, stt = 0;
  const hireDate = () => ''; // chưa lưu ngày vào làm
  for (const e of ctx.employees) {
    stt++;
    const rIn = r, rCong = r + 1, rOt = r + 2;
    const fixedVals = [stt, e.department || '', e.code, e.full_name, hireDate()];
    fixedVals.forEach((v, i) => { ws.mergeCells(rIn, i + 1, rOt, i + 1); Object.assign(ws.getCell(rIn, i + 1), { value: v, alignment: { vertical: 'middle', horizontal: i === 3 ? 'left' : 'center' } }); });
    for (let di = 0; di < days.length; di++) {
      const d = days[di], c1 = FIXED + di * 2 + 1;
      const c = ctx.cell.get(e.id + '|' + d);
      const weekend = ctx.isWeekend(d);
      const io = ioOf(e.id, d, c);
      ws.getCell(rIn, c1).value = io.cin;
      ws.getCell(rIn, c1 + 1).value = io.cout;
      if (io.pairs) { ws.getCell(rIn, c1).alignment = ws.getCell(rIn, c1 + 1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        ws.getRow(rIn).height = Math.max(ws.getRow(rIn).height || 15, 15 * io.pairs.length); }
      ws.mergeCells(rCong, c1, rCong, c1 + 1); ws.getCell(rCong, c1).value = c && c.work_minutes ? round2(c.work_minutes / 60) : 0;
      ws.mergeCells(rOt, c1, rOt, c1 + 1); ws.getCell(rOt, c1).value = c && c.ot_min ? round2(c.ot_min / 60) : 0;
      for (const [rr, cc] of [[rIn, c1], [rIn, c1 + 1], [rCong, c1], [rOt, c1]]) {
        const cell = ws.getCell(rr, cc);
        cell.alignment = { horizontal: 'center' };
        cell.border = border;
        if (weekend) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: pink } };
      }
    }
    for (let i = 1; i <= FIXED; i++) ws.getCell(rIn, i).border = border;
    r += 3;
  }
  if (!ctx.employees.length) { ws.mergeCells(r, 1, r, totalCols); ws.getCell(r, 1).value = 'Không có dữ liệu.'; }

  ws.getColumn(1).width = 5; ws.getColumn(2).width = 14; ws.getColumn(3).width = 12; ws.getColumn(4).width = 20; ws.getColumn(5).width = 12;
  for (let i = 0; i < days.length; i++) { ws.getColumn(FIXED + i * 2 + 1).width = 7; ws.getColumn(FIXED + i * 2 + 2).width = 7; }
  ws.views = [{ state: 'frozen', ySplit: H + 1, xSplit: FIXED }];

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="giocong_tangca_${from}_${to}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

/* ===== Xuất Excel "Chi tiết giờ vào/ra" — ma trận 2 cột/ngày (Vào|Ra), 1 dòng/NV (mẫu ChiTietThoiGianLamViec) ===== */
async function exportDaytimeXlsx(res, from, to, filter, company, address) {
  const ctx = loadRange(from, to, filter);
  const days = daysBetween(from, to);
  const PERIOD = periodLabel(from, to).toUpperCase();
  const FIXED = 5;
  const totalCols = FIXED + days.length * 2 + 1;   // + cột Tổng công
  const congCol = totalCols;
  const wb = new ExcelJS.Workbook(); wb.creator = 'Digiplus';
  const ws = wb.addWorksheet('GioVaoRa');
  const thin = { style: 'thin', color: { argb: 'FFBFBFBF' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const teal = 'FF0F7D7D', pink = 'FFFFE0EC';

  ws.mergeCells(1, 1, 1, totalCols); Object.assign(ws.getCell(1, 1), { value: 'Công ty: ' + company.toUpperCase(), font: { bold: true, size: 12 } });
  ws.mergeCells(2, 1, 2, totalCols); ws.getCell(2, 1).value = 'Địa chỉ: ' + (address || '');
  ws.mergeCells(3, 1, 3, totalCols); Object.assign(ws.getCell(3, 1), { value: `BẢNG CHẤM CÔNG CHI TIẾT THỜI GIAN LÀM VIỆC ${PERIOD}`, font: { size: 14, bold: true }, alignment: { horizontal: 'center' } });
  ws.mergeCells(4, 1, 4, totalCols); Object.assign(ws.getCell(4, 1), { value: 'Mỗi ngày gồm 2 cột: Giờ Vào | Giờ Ra', font: { italic: true, size: 10, color: { argb: 'FF666666' } } });

  const H = 5;
  const fixedLabels = ['STT', 'Phòng ban', 'Mã nhân viên', 'Tên nhân viên', 'Ngày vào làm'];
  fixedLabels.forEach((lab, i) => { ws.mergeCells(H, i + 1, H + 1, i + 1); ws.getCell(H, i + 1).value = lab; });
  days.forEach((d, di) => {
    const c1 = FIXED + di * 2 + 1;
    ws.mergeCells(H, c1, H, c1 + 1); ws.getCell(H, c1).value = +d.slice(8);
    ws.getCell(H + 1, c1).value = 'Vào'; ws.getCell(H + 1, c1 + 1).value = 'Ra';
  });
  ws.mergeCells(H, congCol, H + 1, congCol); ws.getCell(H, congCol).value = 'Tổng công';
  for (let r = H; r <= H + 1; r++) for (let c = 1; c <= totalCols; c++) {
    const cell = ws.getCell(r, c);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: teal } };
    cell.border = border;
  }

  const ioOf = inOutResolver(ctx.employees, from, to);
  let r = H + 2, stt = 0;
  for (const e of ctx.employees) {
    stt++;
    let lines = 1;
    [stt, e.department || '', e.code, e.full_name, ''].forEach((v, i) => {
      const cell = ws.getCell(r, i + 1); cell.value = v; cell.border = border;
      cell.alignment = { vertical: 'middle', horizontal: i === 3 ? 'left' : 'center' };
    });
    let cong = 0;
    for (let di = 0; di < days.length; di++) {
      const d = days[di], c1 = FIXED + di * 2 + 1;
      const c = ctx.cell.get(e.id + '|' + d);
      const weekend = ctx.isWeekend(d);
      const io = ioOf(e.id, d, c);   // theo quy tắc ghép log: nhiều cặp → mỗi lần 1 dòng trong ô
      ws.getCell(r, c1).value = io.cin;
      ws.getCell(r, c1 + 1).value = io.cout;
      if (io.pairs) lines = Math.max(lines, io.pairs.length);
      if (c) cong += c.work_unit || 0;
      for (const cc of [c1, c1 + 1]) { const x = ws.getCell(r, cc); x.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; x.border = border; if (weekend) x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: pink } }; }
    }
    const cc = ws.getCell(r, congCol); cc.value = round2(cong); cc.alignment = { horizontal: 'center' }; cc.border = border;
    if (lines > 1) ws.getRow(r).height = 15 * lines;
    r++;
  }
  if (!ctx.employees.length) { ws.mergeCells(r, 1, r, totalCols); ws.getCell(r, 1).value = 'Không có dữ liệu.'; }

  ws.getColumn(1).width = 5; ws.getColumn(2).width = 14; ws.getColumn(3).width = 12; ws.getColumn(4).width = 20; ws.getColumn(5).width = 12;
  for (let i = 0; i < days.length; i++) { ws.getColumn(FIXED + i * 2 + 1).width = 7; ws.getColumn(FIXED + i * 2 + 2).width = 7; }
  ws.getColumn(congCol).width = 10;
  ws.views = [{ state: 'frozen', ySplit: H + 1, xSplit: FIXED }];

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="chitiet_giovaora_${from}_${to}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

/* ================= Routes ================= */
r.get('/dashboard', (req, res) => {
  const q = String(req.query.date || '').slice(0, 10);
  const today = /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : vnDateStr();  // xem lại ngày bất kỳ
  const totalEmp = db.prepare("SELECT COUNT(*) c FROM employees WHERE active = 1" + adminAttWhere()).get().c;
  // Đếm SỐ NGƯỜI distinct đã chấm (1 NV chấm nhiều phiên/ngày vẫn tính 1), cùng bộ lọc vai trò với totalEmp
  const checkedIn = db.prepare(
    "SELECT COUNT(DISTINCT a.employee_id) c FROM attendance a JOIN employees e ON e.id = a.employee_id" +
    " WHERE a.work_date = ? AND a.check_in_at IS NOT NULL AND e.active = 1" + adminAttWhere('e.role')
  ).get(today).c;
  const late = db.prepare('SELECT COUNT(*) c FROM attendance WHERE work_date = ? AND late_min > 0').get(today).c;
  const outside = db.prepare('SELECT COUNT(*) c FROM attendance WHERE work_date = ? AND check_in_outside = 1').get(today).c;
  const pendingLeaves = db.prepare("SELECT COUNT(*) c FROM leave_requests WHERE status = 'pending'").get().c;
  // includeAdmin: popup "Chưa chấm" phải dùng CÙNG bộ lọc vai trò với totalEmp (bật "Tính công cho cả Admin" thì kể cả admin)
  res.json({ today, totalEmp, checkedIn, notYet: Math.max(0, totalEmp - checkedIn), late, outside, pendingLeaves, includeAdmin: adminAttWhere() === '' });
});

// Dùng cho trang Tổng quan (danh sách hôm nay có ảnh)
r.get('/attendance', (req, res) => {
  const month = (req.query.month || vnDateStr().slice(0, 7)).slice(0, 7);
  const dept = req.query.dept || null;
  let sql = `SELECT a.*, e.code, e.full_name, e.department, oi.name AS in_office
             FROM attendance a JOIN employees e ON e.id=a.employee_id
             LEFT JOIN offices oi ON oi.id=a.check_in_office_id WHERE a.work_date LIKE ?`;
  const args = [month + '%'];
  if (dept) { sql += ' AND e.department = ?'; args.push(dept); }
  sql += ' ORDER BY a.work_date DESC, e.full_name';
  const rows = db.prepare(sql).all(...args).map((a) => ({ ...a, check_in_hm: isoToVnHM(a.check_in_at), check_out_hm: isoToVnHM(a.check_out_at) }));
  res.json({ month, rows });
});

// Danh sách phòng ban (cho filter) = danh mục Bộ phận đã khai (master) GỘP phòng ban đang gán ở NV
r.get('/departments', (req, res) => {
  const master = db.prepare('SELECT name FROM departments').all().map((r) => r.name);
  const used = db.prepare("SELECT DISTINCT department FROM employees WHERE active=1 AND department != ''").all().map((r) => r.department);
  const rows = [...new Set([...master, ...used].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));
  res.json({ rows });
});

// Báo cáo JSON (generic) — hỗ trợ ?month=YYYY-MM hoặc ?from=YYYY-MM-DD&to=YYYY-MM-DD
// Bộ lọc NV từ query: ?ids=1,2,3 (NV cụ thể) hoặc ?depts=A,B (nhiều phòng ban) hoặc ?dept=A (cũ)
function filterFromQuery(q) {
  const ids = String(q.ids || '').split(',').map(Number).filter(Boolean);
  const depts = String(q.depts || '').split(',').map((s) => s.trim()).filter(Boolean);
  return { ids, depts, dept: q.dept || null };
}

r.get('/data', (req, res) => {
  const { from, to } = resolvePeriod(req.query);
  const type = req.query.type || 'horizontal';
  res.json(buildReport(type, from, to, filterFromQuery(req.query)));
});

// Xuất Excel (generic theo type) — hỗ trợ ?month hoặc ?from&to
r.get('/export.xlsx', async (req, res) => {
  const { from, to } = resolvePeriod(req.query);
  const filter = filterFromQuery(req.query);
  const type = req.query.type || 'horizontal';
  const company = getSetting('company_name', 'Digiplus');
  const address = getSetting('company_address', '');

  // Mẫu chi tiết dạng ma trận 2 cột/ngày (giống file mẫu)
  if (type === 'workhours') return exportWorkhoursXlsx(res, from, to, filter, company, address);
  if (type === 'daytime') return exportDaytimeXlsx(res, from, to, filter, company, address);
  if (type === 'hourstat') return exportHourStatXlsx(res, from, to, filter, company, address);
  if (type === 'empsheet') return exportEmpSheetXlsx(res, from, to, filter, company, false);
  if (type === 'empsheetlate') return exportEmpSheetXlsx(res, from, to, filter, company, true);

  const { title, columns, rows } = buildReport(type, from, to, filter);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Digiplus';
  const ws = wb.addWorksheet('BaoCao');
  const lastCol = columns.length;
  const thin = { style: 'thin', color: { argb: 'FFBFBFBF' } };
  const allBorder = { top: thin, left: thin, bottom: thin, right: thin };

  // Header công ty + địa chỉ + tiêu đề (giống mẫu)
  ws.mergeCells(1, 1, 1, lastCol);
  Object.assign(ws.getCell(1, 1), { value: 'Công ty: ' + company.toUpperCase(), font: { bold: true, size: 12 } });
  ws.mergeCells(2, 1, 2, lastCol);
  ws.getCell(2, 1).value = 'Địa chỉ: ' + (address || '');
  ws.mergeCells(3, 1, 3, lastCol);
  Object.assign(ws.getCell(3, 1), { value: title.toUpperCase(), font: { size: 14, bold: true }, alignment: { horizontal: 'center' } });
  ws.addRow([]);

  const hr = ws.addRow(columns.map((c) => c.label));
  hr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  hr.eachCell((cell, col) => {
    const meta = columns[col - 1];
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: meta.weekend ? 'FFB45309' : 'FF1E3A5F' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = allBorder;
  });

  for (const row of rows) {
    const r2 = ws.addRow(columns.map((c) => row[c.key] ?? ''));
    let lines = 1;
    r2.eachCell((cell, col) => {
      const meta = columns[col - 1];
      cell.border = allBorder;
      if (meta.weekend) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3E6' } };
      const multi = typeof cell.value === 'string' && cell.value.includes('\n');
      if (multi) lines = Math.max(lines, cell.value.split('\n').length);
      if (col > 3 || multi) cell.alignment = { horizontal: col > 3 ? 'center' : 'left', vertical: 'middle', wrapText: multi };
    });
    if (lines > 1) r2.height = 15 * lines;
  }
  ws.columns.forEach((col, i) => { col.width = columns[i]?.w || 12; });
  ws.views = [{ state: 'frozen', ySplit: 5, xSplit: 2 }];

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="baocao_${type}_${from}_${to}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

export default r;
