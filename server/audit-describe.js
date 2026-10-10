// Dịch một thao tác quản trị (method + đường dẫn + dữ liệu gửi lên) thành CÂU TIẾNG VIỆT dễ đọc cho cột "Chi tiết"
// của Nhật ký thao tác — VD "Gán ca Ca chiều (CH) cho Cat, Dat · từ 10/10/2026". Gọi TRƯỚC khi thao tác chạy để
// còn đọc được tên của thứ sắp bị sửa / xoá. Trả '' nếu không có gì đáng ghi; null nếu không nhận ra thao tác
// (khi đó nhật ký dùng bản tóm tắt chung).
import { db } from './db.js';

const one = (sql, ...a) => { try { return db.prepare(sql).get(...a) || null; } catch { return null; } };
const all = (sql, ...a) => { try { return db.prepare(sql).all(...a); } catch { return []; } };
const dmy = (d) => (/^\d{4}-\d{2}-\d{2}/.test(String(d || '')) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : String(d || ''));
const dm = (d) => (/^\d{4}-\d{2}-\d{2}/.test(String(d || '')) ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : String(d || ''));
const yes = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 'Có' : 'Không');
const money = (v) => Number(v || 0).toLocaleString('vi-VN') + 'đ';
const ids = (v) => (Array.isArray(v) ? v : v != null && v !== '' ? [v] : []).map(Number).filter(Boolean);
const join = (parts) => parts.filter((x) => x != null && x !== '').join(' · ');

// Tên người: tối đa 4 tên rồi "… và N người khác"
function empNames(list) {
  const a = ids(list);
  if (!a.length) return '';
  const rows = all(`SELECT id, full_name, code FROM employees WHERE id IN (${a.map(() => '?').join(',')})`, ...a);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const names = a.map((i) => byId.get(i)).filter(Boolean).map((r) => r.full_name || r.code);
  if (!names.length) return a.length + ' nhân viên';
  return names.length > 4 ? `${names.slice(0, 4).join(', ')} và ${names.length - 4} người khác` : names.join(', ');
}
const empName = (id) => { const r = one('SELECT full_name, code FROM employees WHERE id = ?', +id); return r ? (r.full_name || r.code) : 'NV #' + id; };
const shiftLabel = (id) => { const s = one('SELECT name, code, start_time, end_time FROM shifts WHERE id = ?', +id); return s ? `${s.name}${s.code ? ' (' + s.code + ')' : ''} ${s.start_time}–${s.end_time}` : 'ca #' + id; };
const schedLabel = (id) => { const s = one('SELECT name FROM work_schedules WHERE id = ?', +id); return s ? `lịch trình "${s.name}"` : 'lịch trình #' + id; };
const ioLabel = (id) => { const s = one('SELECT name FROM inout_schedules WHERE id = ?', +id); return s ? s.name : ''; };
const listShort = (arr, n = 4) => (arr.length > n ? `${arr.slice(0, n).join(', ')} và ${arr.length - n} mục khác` : arr.join(', '));
const range = (f, t) => (f && t ? (f === t ? dmy(f) : `${dmy(f)} → ${dmy(t)}`) : f ? `từ ${dmy(f)} (không thời hạn)` : '');
const what = (b) => (b.is_off ? 'Nghỉ' : b.work_schedule_id || b.mode === 'schedule' ? schedLabel(b.work_schedule_id) : b.shift_id ? 'ca ' + shiftLabel(b.shift_id) : '');

// Nhãn + cách hiển thị từng trường khi so "trước → sau"
const SHIFT_F = {
  name: ['Tên ca'], code: ['Mã ca'], start_time: ['Giờ vào'], end_time: ['Giờ ra'],
  late_grace_min: ['Cho phép đi muộn', 'phút'], early_grace_min: ['Cho phép về sớm', 'phút'], break_minutes: ['Nghỉ giữa ca', 'phút'],
  work_unit_value: ['Số công của ca'], allow_ot: ['Tính tăng ca', 'yn'], ot_start_after_min: ['Ở lại tối thiểu mới tính tăng ca', 'phút'],
  check_in_start: ['Bắt đầu vào'], check_in_end: ['Kết thúc vào'], check_out_start: ['Bắt đầu ra'], check_out_end: ['Kết thúc ra'],
  ot_before: ['Tăng ca trước giờ vào', 'yn'], ot_before_min: ['Đến sớm tối thiểu', 'phút'], holiday_as_ot: ['Cả ca là tăng ca ngày lễ', 'yn'],
  shift_as_ot: ['Ca tăng ca', 'yn'], compensate_late: ['Tính bù trừ', 'yn'], no_out_credit: ['Thiếu giờ ra vẫn tính công', 'yn'],
  grace_deduct: ['Chỉ tính phần vượt mức cho phép', 'yn'], ot_tier1_min: ['Giới hạn TC1', 'phút'], ot_tier2_min: ['Giới hạn TC2', 'phút'],
  ot_tier3_min: ['Giới hạn TC3', 'phút'], ot_tier2_rate: ['Hệ số TC2'], ot_tier3_rate: ['Hệ số TC3'], ot_tier4_rate: ['Hệ số TC4'],
  active: ['Đang dùng', 'yn'],
};
const EMP_F = {
  full_name: ['Họ tên'], code: ['Mã NV'], department: ['Bộ phận'], position: ['Chức danh'], phone: ['SĐT'], role: ['Vai trò', 'role'],
  device_pin: ['Số ID máy'], active: ['Đang làm', 'yn'], username: ['Tài khoản'], att_mode: ['Kiểu chấm công', 'att'],
  shift_id: ['Ca mặc định', 'shift'], email: ['Email'],
};
const SET_F = {
  company_name: ['Tên công ty'], company_address: ['Địa chỉ công ty'], weekend_days: ['Ngày cuối tuần', 'wd'], weekend_work_as_ot: ['Đi làm cuối tuần là tăng ca', 'yn'],
  workunit_rounding: ['Làm tròn công (số lẻ)'], workunit_rounding_mode: ['Kiểu làm tròn công', 'rm'], ot_rounding: ['Làm tròn tăng ca (số lẻ)'],
  ot_rounding_mode: ['Kiểu làm tròn tăng ca', 'rm'], ot_rounding_type: ['Làm tròn tăng ca theo', 'rt'], ot_rounding_block: ['Khối phút tăng ca', 'phút'],
  ot_rate_weekday: ['Hệ số TC ngày thường'], ot_rate_weekend: ['Hệ số TC cuối tuần'], ot_rate_holiday: ['Hệ số TC ngày lễ'],
  pay_period_start_day: ['Ngày bắt đầu kỳ lương'], punch_dedup_min: ['Bỏ qua lần chấm trùng', 'phút'], attendance_mode: ['Kiểu chấm công chung', 'att'],
  geofence_enforce: ['Bắt buộc trong bán kính', 'yn'], device_autocreate: ['Tự tạo NV khi đăng ký trên máy', 'yn'], shift_self_select: ['NV tự chọn ca', 'yn'],
};
const ROLE_VI = { admin: 'Quản trị viên', manager: 'Quản lý', employee: 'Nhân viên', master: 'Tài khoản tổng' };
const WD_VI = { 1: 'T2', 2: 'T3', 3: 'T4', 4: 'T5', 5: 'T6', 6: 'T7', 7: 'CN' };
function fmtVal(v, kind) {
  if (v == null || v === '') return '(trống)';
  if (kind === 'yn') return yes(v);
  if (kind === 'phút') return v + ' phút';
  if (kind === 'role') return ROLE_VI[v] || v;
  if (kind === 'att') return v === 'hourly' ? 'Theo giờ' : v === 'shift' ? 'Theo ca' : 'Theo cài đặt chung';
  if (kind === 'shift') return v ? shiftLabel(v) : 'Không';
  if (kind === 'wd') return String(v).split(',').filter(Boolean).map((d) => WD_VI[d] || d).join(', ') || 'Không';
  if (kind === 'rm') return String(v) === '1' ? 'Làm tròn tới' : String(v) === '2' ? 'Gần nhất' : 'Làm tròn lùi';
  if (kind === 'rt') return v === 'block' ? 'Khối phút' : 'Số lẻ của giờ';
  return String(v);
}
const same = (a, b) => String(a ?? '') === String(b ?? '') || (typeof b === 'boolean' && String(+b) === String(a ?? '')) || (Number(a) === Number(b) && a !== '' && b !== '' && a != null && b != null && !isNaN(Number(a)));
// So dữ liệu gửi lên với bản ghi cũ → "Giờ ra: 17:00 → 17:30; Cho phép đi muộn: 5 phút → 10 phút"
function changes(old, body, fields) {
  const out = [];
  for (const [k, [label, kind]] of Object.entries(fields)) {
    if (!(k in (body || {}))) continue;
    const nv = body[k];
    if (old && same(old[k], nv)) continue;
    out.push(old && old[k] != null ? `${label}: ${fmtVal(old[k], kind)} → ${fmtVal(nv, kind)}` : `${label}: ${fmtVal(nv, kind)}`);
  }
  return out;
}

// [method, regex đường dẫn (sau /api/admin), hàm (req, khớp) → chuỗi]
const RULES = [
  // ----- Ca làm / lịch trình -----
  ['POST', /^\/shifts$/, (r) => { const b = r.body || {}; return join([`Ca "${b.name || ''}"${b.code ? ' (' + b.code + ')' : ''} ${b.start_time || ''}–${b.end_time || ''}`, `cho phép muộn ${b.late_grace_min || 0}′ / sớm ${b.early_grace_min ?? 15}′`, b.allow_ot ? 'có tính tăng ca' : '']); }],
  ['PUT', /^\/shifts\/(\d+)$/, (r, m) => { const old = one('SELECT * FROM shifts WHERE id = ?', +m[1]); const c = changes(old, r.body, SHIFT_F); return `Ca "${old ? old.name : '#' + m[1]}": ` + (c.length ? c.join('; ') : 'không đổi gì'); }],
  ['DELETE', /^\/shifts\/(\d+)$/, (r, m) => `Ca "${(one('SELECT name FROM shifts WHERE id = ?', +m[1]) || {}).name || '#' + m[1]}"`],
  ['POST', /^\/shifts\/(\d+)\/clear-merge-rule$/, (r, m) => `Bỏ cách ghép giờ riêng của ca "${(one('SELECT name FROM shifts WHERE id = ?', +m[1]) || {}).name || ''}"`],
  ['POST', /^\/schedules$/, (r) => `Lịch trình "${r.body?.name || ''}"`],
  ['PUT', /^\/schedules\/(\d+)$/, (r, m) => `Lịch trình "${(one('SELECT name FROM work_schedules WHERE id = ?', +m[1]) || {}).name || ''}"${r.body?.name ? ' → "' + r.body.name + '"' : ''}`],
  ['DELETE', /^\/schedules\/(\d+)$/, (r, m) => `Lịch trình "${(one('SELECT name FROM work_schedules WHERE id = ?', +m[1]) || {}).name || '#' + m[1]}"`],
  ['POST', /^\/inout-schedules$/, (r) => `Lịch trình vào ra "${r.body?.name || ''}"`],
  ['PUT', /^\/inout-schedules\/(\d+)$/, (r, m) => `Lịch trình vào ra "${(one('SELECT name FROM inout_schedules WHERE id = ?', +m[1]) || {}).name || ''}"`],
  ['DELETE', /^\/inout-schedules\/(\d+)$/, (r, m) => `Lịch trình vào ra "${(one('SELECT name FROM inout_schedules WHERE id = ?', +m[1]) || {}).name || '#' + m[1]}"`],

  // ----- Phân ca -----
  ['POST', /^\/assignments$/, (r) => { const b = r.body || {}; return `${empName(b.employee_id)} ngày ${dmy(b.work_date)}: ${b.is_off ? 'Nghỉ' : b.shift_id ? 'ca ' + shiftLabel(b.shift_id) : 'về tự động'}`; }],
  ['POST', /^\/assignments\/cells$/, (r) => {
    const cells = Array.isArray(r.body?.cells) ? r.body.cells : [];
    if (!cells.length) return '';
    const v = (x) => (String(x.value ?? '').trim() === '' || String(x.value).trim() === '-' ? 'về tự động' : String(x.value).trim());
    if (cells.length <= 3) return 'Bảng Excel: ' + cells.map((x) => `${empName(x.employee_id)} ${dm(x.date)} → ${v(x)}`).join('; ');
    const dates = cells.map((x) => String(x.date)).sort(), emps = new Set(cells.map((x) => x.employee_id));
    const cnt = new Map(); for (const x of cells) cnt.set(v(x), (cnt.get(v(x)) || 0) + 1);
    return `Bảng Excel: sửa ${cells.length} ô · ${emps.size} nhân viên · ${range(dates[0], dates[dates.length - 1])} · ` + [...cnt].map(([k, n]) => `${k}: ${n} ô`).join(', ');
  }],
  ['POST', /^\/assignments\/bulk$/, (r) => { const b = r.body || {}; const w = what(b) || 'bỏ lịch tạm thời'; return join([`Lịch trình tạm thời: ${w}`, ids(b.employee_ids).length ? 'NV: ' + empNames(b.employee_ids) : '', (b.departments || []).length ? 'Phòng ban: ' + listShort(b.departments) + (b.include_children === false ? '' : ' (kèm cấp dưới)') : '', range(b.from, b.to), b.skip_off ? 'bỏ qua ngày nghỉ' : '']); }],
  ['POST', /^\/assignments\/clear$/, (r) => { const it = Array.isArray(r.body?.items) ? r.body.items : []; const src = it[0]?.source === 'temp' ? 'lịch tạm thời' : it[0]?.source === 'sheet' ? 'ô nhập ở bảng Excel' : 'phân ca theo ngày'; return `Xoá ${it.length} dòng ${src}: ` + listShort(it.map((x) => `${empName(x.employee_id)} ${dm(x.date)}`), 3); }],
  ['POST', /^\/assignments\/import$/, (r) => `Nhập file Excel phân ca${r.body?.from ? ' · ' + range(r.body.from, r.body.to) : r.body?.month ? ' · tháng ' + r.body.month.slice(5, 7) + '/' + r.body.month.slice(0, 4) : ''}`],
  ['POST', /^\/shift-assignments$/, (r) => { const b = r.body || {}; const io = b.inout_schedule_id ? ioLabel(b.inout_schedule_id) : ''; return join([`Gán ${what(b)}`, 'cho ' + (b.scope === 'all' ? 'tất cả nhân viên' : b.scope === 'dept' ? 'phòng ' + b.department : empNames(b.employee_ids?.length ? b.employee_ids : b.employee_id)), range(b.from_date, b.to_date), io ? 'vào ra: ' + io : '']); }],
  ['POST', /^\/shift-assignments\/delete$/, (r) => describeRangedDelete(ids(r.body?.ids))],
  ['DELETE', /^\/shift-assignments\/(\d+)$/, (r, m) => describeRangedDelete([+m[1]])],
  ['POST', /^\/dept-shift-assignments$/, (r) => { const b = r.body || {}; const io = b.inout_schedule_id ? ioLabel(b.inout_schedule_id) : ''; return join([`Gán ${what(b)}`, 'cho phòng ban: ' + listShort(b.departments || []) + (b.include_children === false ? '' : ' (kèm cấp dưới)'), range(b.from_date, b.to_date), io ? 'vào ra: ' + io : '']); }],
  ['POST', /^\/dept-shift-assignments\/delete$/, (r) => { const a = ids(r.body?.ids); const rows = a.length ? all(`SELECT department, shift_id, work_schedule_id, mode, from_date FROM dept_shift_assignments WHERE id IN (${a.map(() => '?').join(',')})`, ...a) : []; return `Xoá ${a.length} dòng gán ca phòng ban: ` + listShort(rows.map((x) => `${x.department} – ${what(x)} (từ ${dmy(x.from_date)})`), 3); }],

  // ----- Nhân viên -----
  ['POST', /^\/employees$/, (r) => { const b = r.body || {}; return join([`${b.full_name || ''} (mã ${b.code || ''})`, b.department ? 'Bộ phận: ' + b.department : '', b.role ? 'Vai trò: ' + (ROLE_VI[b.role] || b.role) : '', b.device_pin ? 'Số ID máy: ' + b.device_pin : '']); }],
  ['PUT', /^\/employees\/(\d+)$/, (r, m) => { const old = one('SELECT * FROM employees WHERE id = ?', +m[1]); const c = changes(old, r.body, EMP_F); if (r.body?.password) c.push('Đổi mật khẩu'); if (r.body?.permissions) c.push('Cập nhật quyền'); return `${old ? old.full_name : 'NV #' + m[1]}: ` + (c.length ? c.join('; ') : 'không đổi gì'); }],
  ['DELETE', /^\/employees\/(\d+)(\/purge)?$/, (r, m) => empName(m[1])],
  ['POST', /^\/employees\/(\d+)\/(approve-device|reset-device)$/, (r, m) => empName(m[1])],
  ['POST', /^\/employees\/import$/, (r) => `Nhập file Excel nhân viên (${r.body?.mode === 'update' ? 'cập nhật' : 'thêm mới'})`],
  ['POST', /^\/employees\/att-mode$/, (r) => { const b = r.body || {}; return join([`Kiểu chấm công: ${fmtVal(b.att_mode || b.mode, 'att')}`, ids(b.ids || b.employee_ids).length ? 'NV: ' + empNames(b.ids || b.employee_ids) : '', b.department ? 'Phòng ban: ' + b.department : '']); }],
  ['PUT', /^\/salary\/(\d+)$/, (r, m) => { const b = r.body || {}; return join([`Lương ${empName(m[1])}`, b.basic_salary != null ? 'Lương cơ bản ' + money(b.basic_salary) : '', b.hourly_rate ? 'Đơn giá giờ ' + money(b.hourly_rate) : '', b.allowance ? 'Phụ cấp ' + money(b.allowance) : '', b.ot_rate_weekday ? `Hệ số TC ${b.ot_rate_weekday} / ${b.ot_rate_weekend} / ${b.ot_rate_holiday}` : '']); }],

  // ----- Cài đặt -----
  ['PUT', /^\/settings$/, (r) => {
    const b = r.body || {};
    const old = {}; for (const k of Object.keys(b)) old[k] = (one('SELECT value FROM settings WHERE key = ?', k) || {}).value;
    const c = changes(old, b, SET_F);
    const other = Object.keys(b).filter((k) => !SET_F[k] && !/pass|token|key|secret/i.test(k));
    if (other.length) c.push(`${other.length} cài đặt khác`);
    return c.length ? c.join('; ') : 'không đổi gì';
  }],

  // ----- Giờ chấm -----
  ['POST', /^\/attendance$/, (r) => { const b = r.body || {}; return join([`${empName(b.employee_id)} ngày ${dmy(b.work_date)}`, `vào ${b.check_in || '—'}, ra ${b.check_out || '—'}`, b.note ? 'Lý do: ' + b.note : '']); }],
  ['PUT', /^\/attendance\/(\d+)$/, (r, m) => { const a = one('SELECT employee_id, work_date FROM attendance WHERE id = ?', +m[1]) || {}; const b = r.body || {}; return join([`${empName(a.employee_id)} ngày ${dmy(a.work_date)}`, b.check_in !== undefined ? 'vào ' + (b.check_in || '—') : '', b.check_out !== undefined ? 'ra ' + (b.check_out || '—') : '', b.note ? 'Lý do: ' + b.note : '']); }],
  ['DELETE', /^\/attendance\/(\d+)$/, (r, m) => { const a = one('SELECT employee_id, work_date FROM attendance WHERE id = ?', +m[1]) || {}; return `${empName(a.employee_id)} ngày ${dmy(a.work_date)}`; }],
  ['POST', /^\/attendance\/clear-range$/, (r) => `Xoá giờ chấm ${range(r.body?.from, r.body?.to)}`],
  ['POST', /^\/recompute$/, (r) => { const q = r.query || {}; return join([q.from ? range(q.from, q.to) : q.month ? 'tháng ' + q.month : 'toàn bộ dữ liệu', q.ids ? 'NV: ' + empNames(String(q.ids).split(',')) : '', q.depts || q.dept ? 'Phòng ban: ' + (q.depts || q.dept) : '']); }],

  // ----- Danh mục -----
  ['POST', /^\/(departments|positions|offices)$/, (r) => `"${r.body?.name || ''}"`],
  ['PUT', /^\/(departments|offices)\/(\d+)$/, (r, m) => { const o = one(`SELECT name FROM ${m[1]} WHERE id = ?`, +m[2]) || {}; return `"${o.name || ''}"${r.body?.name && r.body.name !== o.name ? ' → "' + r.body.name + '"' : ''}`; }],
  ['DELETE', /^\/(departments|positions|offices)\/(\d+)/, (r, m) => `"${(one(`SELECT name FROM ${m[1]} WHERE id = ?`, +m[2]) || {}).name || '#' + m[2]}"`],
  ['POST', /^\/holidays$/, (r) => `${dmy(r.body?.holiday_date || r.body?.date)}${r.body?.name ? ' – ' + r.body.name : ''}`],
  ['DELETE', /^\/holidays\/(\d+)$/, (r, m) => { const h = one('SELECT holiday_date, name FROM public_holidays WHERE id = ?', +m[1]) || {}; return `${dmy(h.holiday_date)}${h.name ? ' – ' + h.name : ''}`; }],

  // ----- Máy chấm công -----
  ['PUT', /^\/devices\/(\d+)$/, (r, m) => { const d = one('SELECT name, serial FROM push_devices WHERE id = ?', +m[1]) || {}; return `Máy ${d.name || d.serial || '#' + m[1]}${r.body?.name && r.body.name !== d.name ? ' → tên "' + r.body.name + '"' : ''}`; }],
  ['POST', /^\/devices\/(\d+)\//, (r, m) => { const d = one('SELECT name, serial FROM push_devices WHERE id = ?', +m[1]) || {}; return `Máy ${d.name || d.serial || '#' + m[1]}${d.name && d.serial ? ' (' + d.serial + ')' : ''}`; }],
  ['DELETE', /^\/devices\/(\d+)$/, (r, m) => { const d = one('SELECT name, serial FROM push_devices WHERE id = ?', +m[1]) || {}; return `Máy ${d.name || d.serial || '#' + m[1]}`; }],
];

function describeRangedDelete(a) {
  if (!a.length) return '';
  const rows = all(`SELECT employee_id, shift_id, work_schedule_id, mode, from_date FROM shift_assignments WHERE id IN (${a.map(() => '?').join(',')})`, ...a);
  return `Xoá ${a.length} dòng gán ca: ` + listShort(rows.map((x) => `${empName(x.employee_id)} – ${what(x)} (từ ${dmy(x.from_date)})`), 3);
}

export function describeAction(req) {
  const p = req.path || '';
  for (const [m, re, fn] of RULES) {
    if (m !== req.method) continue;
    const mm = re.exec(p);
    if (!mm) continue;
    try { const s = fn(req, mm); return s == null ? null : String(s).slice(0, 600); } catch { return null; }
  }
  return null;
}
