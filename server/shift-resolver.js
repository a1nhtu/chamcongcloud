// Bộ GIẢI CA — quy tắc nghiệp vụ chọn ca cho 1 NV/ngày (tách khỏi db.js để db.js chỉ còn schema+data).
// Thứ tự ưu tiên xuyên suốt: phân ca NGÀY (đè) → phân ca KHOẢNG → lịch trình → ca mặc định của NV → lịch trình MẶC ĐỊNH
// (NV chưa gán gì) → tự dò theo giờ.
// Phụ thuộc MỘT CHIỀU vào db.js (chỉ đọc dữ liệu) — không có vòng import ngược.
import { db } from './db.js';
// Câu lệnh SQL biên dịch MỘT LẦN rồi dùng lại (bảng Excel cả công ty gọi giải ca hàng chục nghìn lần) — db.prepare đã tự nhớ
// theo TỪNG CSDL (db.js), không nhớ riêng ở đây để máy chủ nhiều công ty không dùng nhầm câu lệnh của công ty khác.
const q = (sql) => db.prepare(sql);

// NHỚ TẠM trong MỘT lần dựng công (rebuildDays / Tính lại — chạy liền một mạch, không nhường luồng): ca, lịch trình, phân ca,
// phòng ban, lịch trình vào ra KHÔNG đổi giữa chừng nhưng trước đây mỗi ngày công tra lại hàng chục lần (pretty 28/11/2026:
// 1/3 thời gian Tính lại là tra cấu hình). Ngoài withResolverCache thì không nhớ gì — kết quả y như cũ.
let _memo = null;
const memo = (key, fn) => {
  if (!_memo) return fn();
  if (_memo.has(key)) return _memo.get(key);
  const v = fn(); _memo.set(key, v); return v;
};
// Chạy fn (ĐỒNG BỘ) với bộ nhớ tạm; lồng nhau thì dùng chung bộ nhớ của lớp ngoài.
export function withResolverCache(fn) {
  if (_memo) return fn();
  _memo = new Map();
  try { return fn(); } finally { _memo = null; }
}

export const getShift = (id) => memo('sh|' + id, () => q('SELECT * FROM shifts WHERE id = ?').get(id));
const hhmm2min = (s) => { const [h, m] = String(s || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
function checkinMinVN(iso) { const d = new Date(iso); const t = new Date(d.getTime() + 7 * 3600000); return t.getUTCHours() * 60 + t.getUTCMinutes(); }
function inWindow(min, start, end) { return start <= end ? (min >= start && min <= end) : (min >= start || min <= end); }
// Khoảng cách 2 giờ trong ngày (phút) theo VÒNG 24 giờ: 00:30 cách 22:00 là 150 phút (không phải 1.290). Chỉ khác |a − b| khi hai
// giờ cách nhau quá 12 tiếng — các trường hợp trong ngày giữ nguyên kết quả như cũ.
const minDist = (a, b) => { const d = Math.abs(a - b) % 1440; return Math.min(d, 1440 - d); };

// Các ca thuộc 1 lịch trình (đang hoạt động), theo thứ tự.
export function scheduleShifts(scheduleId) {
  return memo('ss|' + scheduleId, () => q(`SELECT s.* FROM work_schedule_shifts wss JOIN shifts s ON s.id = wss.shift_id
    WHERE wss.work_schedule_id = ? AND s.active = 1 ORDER BY wss.sort_order`).all(scheduleId));
}

// Khung VÀO / RA của 1 ca (phút trong ngày; inWindow tự xử lý ca đêm qua nửa đêm): dùng khung đã khai; chưa khai → khung mặc định
// GIỐNG chọn ca nhiều ca (fitWindows, attendance-calc): vào [đầu ca − 2h, đầu ca + min(1h, ¼ ca)], ra [cuối ca − min(1h, ¼ ca), cuối ca + 2h].
const shiftLen = (s) => { const a = hhmm2min(s.start_time); let b = hhmm2min(s.end_time); if (b <= a) b += 1440; return b - a; };
const wrap = (m) => ((m % 1440) + 1440) % 1440;
function inWin(s) {
  if (s.check_in_start && s.check_in_end) return [hhmm2min(s.check_in_start), hhmm2min(s.check_in_end)];
  const a = hhmm2min(s.start_time), h = Math.min(60, shiftLen(s) / 4);
  return [wrap(a - 120), wrap(a + h)];
}
function outWin(s) {
  if (s.check_out_start && s.check_out_end) return [hhmm2min(s.check_out_start), hhmm2min(s.check_out_end)];
  const e = hhmm2min(s.end_time), h = Math.min(60, shiftLen(s) / 4);
  return [wrap(e - h), wrap(e + 120)];
}
// TỰ TÌM 1 CA theo khung vào / ra của ca như Wise Eye On39 (Anh chốt 16/11/2026, v1.35.10):
//   (1) giờ vào trong khung vào VÀ giờ ra trong khung ra  (2) giờ vào trong khung vào  (3) giờ vào ngoài khung vào của MỌI ca (vào trễ
//   quá khung / ca chưa khai khung) → cách đo cũ (nearestShift: ra trong khung ra, cuối ca gần giờ ra, đầu ca gần giờ vào — vòng 24 giờ)
// Nhiều ca cùng khớp một bước → ca đứng trước trong danh sách (thứ tự ca của lịch trình). candidates = các ca của lịch trình (theo thứ tự);
// bỏ trống = mọi ca đang dùng ĐÃ KHAI khung vào (NV chưa gán ca / lịch) — không khớp khung vào ca nào thì không gán ca (null).
export function autoDetectShift(checkInIso, candidates, checkOutIso) {
  if (!checkInIso) return null;
  const inMin = checkinMinVN(checkInIso);
  const outMin = checkOutIso ? checkinMinVN(checkOutIso) : null;
  const all = candidates || q("SELECT * FROM shifts WHERE active = 1 AND check_in_start IS NOT NULL AND check_in_start != '' ORDER BY id").all();
  if (!all.length) return null;
  const okIn = (s) => inWindow(inMin, ...inWin(s)), okOut = (s) => outMin != null && inWindow(outMin, ...outWin(s));
  return all.find((s) => okIn(s) && okOut(s)) || all.find(okIn) || (candidates ? nearestShift(all, inMin, outMin) : null);
}
// Bước 3 khi giờ vào không trong khung vào của ca nào (vào trễ quá khung mặc định / ca chưa khai khung): cách đo cũ (v1.33.10) —
// ra trong khung ra (khai báo trước), rồi cuối ca gần giờ ra nhất, rồi đầu ca gần giờ vào nhất (đo vòng 24 giờ).
function nearestShift(all, inMin, outMin) {
  const oldOut = (s) => (s.check_out_start && s.check_out_end ? [hhmm2min(s.check_out_start), hhmm2min(s.check_out_end)]
    : [wrap(hhmm2min(s.end_time) - 60), wrap(hhmm2min(s.end_time) + 480)]);
  const nearIn = [...all].sort((a, b) => minDist(hhmm2min(a.start_time), inMin) - minDist(hhmm2min(b.start_time), inMin))[0];
  if (outMin == null || all.length === 1) return nearIn;
  return all.map((s) => ({ s, sc: inWindow(outMin, ...oldOut(s)) ? (s.check_out_start && s.check_out_end ? 3 : 2) : 0,
    od: minDist(hhmm2min(s.end_time), outMin), id: minDist(hhmm2min(s.start_time), inMin) }))
    .sort((a, b) => b.sc - a.sc || a.od - b.od || a.id - b.id)[0].s;
}

// Không gán ca, dòng công của NGÀY D mà giờ vào nằm ở RẠNG SÁNG HÔM SAU (ca đêm vào trễ sau nửa đêm — device-sync lateNightInPunches
// dựng như vậy): dò theo giờ vào không ra ca nào (00:30 không nằm trong khung vào ca nào) → ca ĐÊM có khai khung giờ vào / ra, còn đang
// chạy lúc vào (vào trước giờ kết thúc ca) và giờ ra nằm trong khung ra — đúng điều kiện lúc dựng, để "Tính lại" không làm mất ca.
function lateNightAutoShift(workDate, checkInIso, checkOutIso) {
  if (!workDate || !checkInIso || !checkOutIso) return null;
  const nx = new Date(workDate + 'T12:00:00Z'); nx.setUTCDate(nx.getUTCDate() + 1);
  if (new Date(Date.parse(checkInIso) + 7 * 3600000).toISOString().slice(0, 10) !== nx.toISOString().slice(0, 10)) return null;
  const inMin = checkinMinVN(checkInIso), outMin = checkinMinVN(checkOutIso);
  if (!(Date.parse(checkOutIso) > Date.parse(checkInIso))) return null;
  const cands = q("SELECT * FROM shifts WHERE active = 1 AND check_in_start IS NOT NULL AND check_in_start != ''").all()
    .filter((s) => (s.cross_midnight || s.end_time <= s.start_time) && s.check_in_end && s.check_out_start && s.check_out_end)
    .filter((s) => inMin < hhmm2min(s.end_time) && inWindow(outMin, hhmm2min(s.check_out_start), hhmm2min(s.check_out_end)));
  if (!cands.length) return null;
  const dIn = (s) => (inMin - hhmm2min(s.start_time) + 1440) % 1440;   // số phút từ đầu ca (tối hôm trước) tới giờ vào
  return [...cands].sort((a, b) => minDist(hhmm2min(a.end_time), outMin) - minDist(hhmm2min(b.end_time), outMin) || dIn(a) - dIn(b))[0];
}

// Chuỗi phòng ban từ phòng của NV lên các cấp cha: [phòng, cha, ông…]
function deptChain(name) { return memo('dc|' + name, () => deptChainRaw(name)); }
function deptChainRaw(name) {
  const out = [], seen = new Set();
  let cur = q('SELECT id, name, parent_id FROM departments WHERE name = ?').get(name);
  if (!cur) return name ? [name] : [];
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id); out.push(cur.name);
    cur = cur.parent_id ? q('SELECT id, name, parent_id FROM departments WHERE id = ?').get(cur.parent_id) : null;
  }
  return out;
}
// Lịch trình gán cho PHÒNG BAN phủ ngày này: phòng của NV trước, rồi tới phòng cấp trên có bật "bao gồm cấp dưới",
// cuối cùng là lịch "Tất cả phòng ban" (department = '*', áp cả NV chưa có phòng ban).
export function deptShiftAssignment(employeeId, workDate) {
  const dept = memo('ed|' + employeeId, () => (q('SELECT department FROM employees WHERE id = ?').get(employeeId)?.department || '').trim());
  return memo('dsa|' + dept + '|' + workDate, () => deptAssignRaw(dept, workDate));
}
function deptAssignRaw(dept, workDate) {
  const chain = dept ? deptChain(dept) : [];
  for (let i = 0; i < chain.length; i++) {
    const r = q(`SELECT * FROM dept_shift_assignments
      WHERE department = ? AND active = 1 AND from_date <= ? AND (to_date IS NULL OR to_date = '' OR to_date >= ?)
        ${i > 0 ? 'AND include_children = 1' : ''}
      ORDER BY id DESC LIMIT 1`).get(chain[i], workDate, workDate);
    if (r) return r;
  }
  return q(`SELECT * FROM dept_shift_assignments
    WHERE department = '*' AND active = 1 AND from_date <= ? AND (to_date IS NULL OR to_date = '' OR to_date >= ?)
    ORDER BY id DESC LIMIT 1`).get(workDate, workDate) || null;
}

// Phân ca theo KHOẢNG NGÀY phủ ngày này — lịch RIÊNG của NV (shift_assignments, bản ghi mới nhất thắng);
// NV không có lịch riêng thì theo lịch trình của PHÒNG BAN.
export function rangedShiftAssignment(employeeId, workDate) {
  return memo('rsa|' + employeeId + '|' + workDate, () => rangedRaw(employeeId, workDate));
}
function rangedRaw(employeeId, workDate) {
  const own = q(`SELECT * FROM shift_assignments
    WHERE employee_id = ? AND active = 1 AND from_date <= ?
      AND (to_date IS NULL OR to_date = '' OR to_date >= ?)
    ORDER BY id DESC LIMIT 1`).get(employeeId, workDate, workDate);
  const r = own || deptShiftAssignment(employeeId, workDate);
  // Dòng gán có kèm "Lịch trình vào ra" → cách ghép giờ lấy theo lịch trình vào ra đó
  if (r && r.inout_schedule_id) { const io = ioSchedule(r.inout_schedule_id); if (io) { r._io = io; r.merge_rule = io.rule; } }
  return r;
}

// ----- Lịch trình vào ra (cách xác định lượt VÀO / RA), khai báo riêng như Ronald Jack -----
function ioSchedule(id) { return id ? memo('io|' + id, () => q('SELECT * FROM inout_schedules WHERE id = ? AND active = 1').get(id) || null) : null; }
export function defaultIoSchedule() { return memo('io0', () => q('SELECT * FROM inout_schedules WHERE active = 1 AND is_default = 1 ORDER BY id LIMIT 1').get() || null); }
// Lịch trình vào ra đang áp cho 1 NV trong 1 ngày: của dòng gán (NV → phòng ban), không có thì lấy lịch trình mặc định.
export function ioScheduleFor(employeeId, workDate) {
  const ra = rangedShiftAssignment(employeeId, workDate);
  return (ra && ra._io) || defaultIoSchedule();
}
// Ngưỡng ghép cặp của lịch trình vào ra đó → { min, gap, max } (phút); null = chưa khai lịch trình vào ra nào
export function ioParamsFor(employeeId, workDate) {
  const io = ioScheduleFor(employeeId, workDate);
  return io ? { min: io.min_minutes, gap: io.gap_minutes, max: io.max_minutes, nextEnd: io.next_out_end || '' } : null;
}

// Cách ghép giờ thực tế, theo thứ tự: lịch trình vào ra của dòng gán → quy tắc RIÊNG còn lưu ở ca (kiểu cũ, khác FILO)
// → lịch trình vào ra MẶC ĐỊNH → FILO (giờ đầu vào, giờ cuối ra).
export function effectiveMergeRule(shift, override) {
  if (override && override !== 'default') return override;
  const legacy = shift && shift.merge_rule && shift.merge_rule !== 'filo' && shift.merge_rule !== 'default' ? shift.merge_rule : null;
  if (legacy) return legacy;
  const d = defaultIoSchedule();
  return d ? d.rule : 'filo';
}

// Phân ca ngày của 1 NV trong 1 ngày — có thể NHIỀU ca (NV tự chọn 2-3 ca gãy).
// Phân ca theo NGÀY có 2 lớp: ô nhập ở bảng Excel ('sheet', ưu tiên cao nhất) đè lên lịch trình tạm thời ('temp').
// opts.ignoreSheet = bỏ qua lớp Excel → ca phần mềm tự tìm nếu không có ô Excel (để bảng Excel hiện lớp bên dưới).
function dailyAssignments(employeeId, workDate, opts = {}) {
  const rows = memo('da|' + employeeId + '|' + workDate, () => q('SELECT shift_id, is_off, source FROM daily_shift_assignments WHERE employee_id = ? AND work_date = ?').all(employeeId, workDate));
  const temp = rows.filter((x) => x.source === 'temp');
  if (opts.ignoreSheet) return temp;
  return rows.length > temp.length ? rows.filter((x) => x.source !== 'temp') : temp;
}
// Danh sách ca (object) từ phân ca ngày; [] nếu không có / toàn null.
function dailyShiftObjs(da) {
  return da.map((x) => x.shift_id).filter(Boolean).map((id) => getShift(id)).filter(Boolean);
}

// Ca hiển thị (chưa biết giờ chấm): phân ca ngày → phân ca khoảng → lịch trình (auto) → ca mặc định.
// Ca của 1 lịch trình trong MỘT NGÀY cụ thể.
//  - lịch trình kiểu cũ (unit 'auto'): trả cả nhóm ca, để tự dò theo giờ chấm → { pattern:false, off:false, shifts }
//  - lịch trình theo chu kỳ (tuần / ngày / tháng): tra đúng ô của ngày đó; ô trống = NGÀY NGHỈ → { pattern:true, off, shifts }
// anchor = ngày bắt đầu áp dụng (mốc đếm chu kỳ); không có thì lấy mốc cố định Thứ Hai 01/01/2024.
const SCHED_ANCHOR = '2024-01-01';
const dayNum = (d) => Math.round(Date.parse(d + 'T00:00:00Z') / 86400000);
const wdOf = (d) => { const w = new Date(d + 'T12:00:00Z').getUTCDay(); return w === 0 ? 7 : w; };   // 1=T2 … 7=CN
const mod = (a, n) => ((a % n) + n) % n;
export function scheduleSlot(unit, cycle, workDate, anchor) {
  const a = String(anchor || SCHED_ANCHOR).slice(0, 10);
  const n = Math.max(1, cycle || 1);
  if (unit === 'day') return mod(dayNum(workDate) - dayNum(a), n);
  if (unit === 'month') {
    const mi = (+workDate.slice(0, 4) * 12 + +workDate.slice(5, 7)) - (+a.slice(0, 4) * 12 + +a.slice(5, 7));
    return mod(mi, n) * 31 + (+workDate.slice(8, 10) - 1);
  }
  const monday = (d) => dayNum(d) - (wdOf(d) - 1);
  return mod(Math.floor((monday(workDate) - monday(a)) / 7), n) * 7 + (wdOf(workDate) - 1);
}
export function schedDay(scheduleId, workDate, anchor) {
  return memo('sd|' + scheduleId + '|' + workDate + '|' + (anchor || ''), () => schedDayRaw(scheduleId, workDate, anchor));
}
function schedDayRaw(scheduleId, workDate, anchor) {
  const ws = q('SELECT unit, cycle FROM work_schedules WHERE id = ?').get(scheduleId);
  const unit = ws?.unit || 'auto';
  if (unit === 'auto') return { pattern: false, off: false, shifts: scheduleShifts(scheduleId) };
  const idx = scheduleSlot(unit, ws.cycle, workDate, anchor);
  const shifts = q(`SELECT s.* FROM work_schedule_days d JOIN shifts s ON s.id = d.shift_id
    WHERE d.work_schedule_id = ? AND d.idx = ? AND s.active = 1 ORDER BY s.start_time`).all(scheduleId, idx);
  return { pattern: true, off: !shifts.length, shifts };
}

// Lịch trình ca MẶC ĐỊNH (work_schedules.is_default = 1) — áp cho NV CHƯA được gán gì: không phân ca ngày / khoảng / phòng ban,
// không có lịch trình riêng và cũng không có ca mặc định riêng (shift_id). Khách chưa chọn lịch trình mặc định nào → null = như cũ
// (tự dò ca theo giờ chấm trên mọi ca có khai khung vào).
export function defaultWorkScheduleId() {
  return memo('ws0', () => q('SELECT id FROM work_schedules WHERE active = 1 AND is_default = 1 ORDER BY id LIMIT 1').get()?.id || null);
}
// Lịch trình áp cho NV khi không có phân ca nào: lịch trình riêng của NV → (chưa có cả ca riêng) lịch trình mặc định.
const empShiftRow = (employeeId) => memo('es|' + employeeId, () => q('SELECT shift_id, work_schedule_id FROM employees WHERE id = ?').get(employeeId));
function empScheduleId(emp) {
  if (!emp) return null;
  return emp.work_schedule_id || (emp.shift_id ? null : defaultWorkScheduleId());
}

export function resolveShift(employeeId, workDate, opts = {}) {
  const da = dailyAssignments(employeeId, workDate, opts);
  if (da.length) {
    const layer = da[0].source === 'temp' ? 'temp' : 'sheet';
    if (da.some((x) => x.is_off)) return { off: true, shift: null, source: 'manual', layer };
    const shifts = dailyShiftObjs(da);
    if (shifts.length > 1) return { off: false, shift: null, source: 'schedule', scheduleName: shifts.length + ' ca đã chọn', layer, shifts };
    if (shifts.length === 1) return { off: false, shift: shifts[0], source: 'manual', layer };
  }
  const ra = rangedShiftAssignment(employeeId, workDate);
  if (ra) {
    if (ra.mode === 'shift' && ra.shift_id) { const s = getShift(ra.shift_id); if (s) return { off: false, shift: s, source: 'assign' }; }
    if (ra.mode === 'schedule' && ra.work_schedule_id) {
      const sd = schedDay(ra.work_schedule_id, workDate, ra.from_date);
      const scheduleName = q('SELECT name FROM work_schedules WHERE id = ?').get(ra.work_schedule_id)?.name || '';
      if (sd.off) return { off: true, shift: null, source: 'schedule', scheduleName };                       // ô trống trong chu kỳ = ngày nghỉ
      if (sd.pattern && sd.shifts.length === 1) return { off: false, shift: sd.shifts[0], source: 'assign', scheduleName };
      if (sd.shifts.length) return { off: false, shift: null, source: 'schedule', scheduleName };
    }
  }
  const emp = empShiftRow(employeeId);
  const wsId = empScheduleId(emp);
  if (wsId) {
    const sd = schedDay(wsId, workDate, null);
    const scheduleName = q('SELECT name FROM work_schedules WHERE id = ?').get(wsId)?.name || '';
    if (sd.off) return { off: true, shift: null, source: 'schedule', scheduleName };
    if (sd.pattern && sd.shifts.length === 1) return { off: false, shift: sd.shifts[0], source: 'default', scheduleName };
    if (sd.shifts.length) return { off: false, shift: null, source: 'schedule', scheduleName };
  }
  const shift = emp?.shift_id ? getShift(emp.shift_id) : null;
  return { off: false, shift, source: shift ? 'default' : 'none' };
}

// Ca thực tế khi chấm: phân ca ngày (đè) → phân ca khoảng → lịch trình (auto theo giờ) → ca mặc định → auto toàn cục.
// Trả kèm mergeRule = quy tắc ghép log máy áp dụng cho ca này (null nếu ngày nghỉ / không có ca).
export function resolveEffectiveShift(employeeId, workDate, checkInIso, checkOutIso = null) {
  const da = dailyAssignments(employeeId, workDate);
  if (da.length) {
    if (da.some((x) => x.is_off)) return { off: true, shift: null, source: 'manual', mergeRule: null };
    const shifts = dailyShiftObjs(da);
    if (shifts.length) {
      const s = shifts.length === 1 ? shifts[0] : (autoDetectShift(checkInIso, shifts, checkOutIso) || shifts[0]);
      return { off: false, shift: s, source: 'manual', mergeRule: effectiveMergeRule(s, null) };
    }
  }
  const ra = rangedShiftAssignment(employeeId, workDate);
  if (ra) {
    const override = ra.merge_rule;
    if (ra.mode === 'shift' && ra.shift_id) { const s = getShift(ra.shift_id); if (s) return { off: false, shift: s, source: 'assign', mergeRule: effectiveMergeRule(s, override) }; }
    if (ra.mode === 'schedule' && ra.work_schedule_id) {
      const sd = schedDay(ra.work_schedule_id, workDate, ra.from_date);
      if (sd.off) return { off: false, shift: null, source: 'none', mergeRule: 'pairs' };   // ngày nghỉ theo chu kỳ: nếu vẫn có lượt quẹt thì tính như ngày không ca, không bỏ dữ liệu
      const cands = sd.shifts;
      if (cands.length) { const s = autoDetectShift(checkInIso, cands, checkOutIso) || cands[0]; return { off: false, shift: s, source: 'schedule', mergeRule: effectiveMergeRule(s, override) }; }
    }
  }
  const emp = empShiftRow(employeeId);
  const wsId = empScheduleId(emp);
  if (wsId) {
    const sd = schedDay(wsId, workDate, null);
    if (sd.off) return { off: false, shift: null, source: 'none', mergeRule: 'pairs' };
    const cands = sd.shifts;
    if (cands.length) {
      const s = autoDetectShift(checkInIso, cands, checkOutIso) || cands[0];
      return { off: false, shift: s, source: 'schedule', mergeRule: effectiveMergeRule(s, null) };
    }
  }
  if (emp?.shift_id) { const s = getShift(emp.shift_id); if (s) return { off: false, shift: s, source: 'default', mergeRule: effectiveMergeRule(s, null) }; }
  const auto = autoDetectShift(checkInIso, null, checkOutIso) || lateNightAutoShift(workDate, checkInIso, checkOutIso);
  if (auto) return { off: false, shift: auto, source: 'auto', mergeRule: effectiveMergeRule(auto, null) };
  // Không tìm được ca nào → tính theo các cặp vào/ra (1-2, 3-4…) thay vì đầu–cuối
  return { off: false, shift: null, source: 'none', mergeRule: 'pairs' };
}

// DANH SÁCH ca của 1 ngày (để tách nhiều ca/ngày khi gán lịch trình). Ưu tiên như resolveEffectiveShift.
// Trả { off, shifts:[ca...], mergeRule, source, isSchedule }. shifts rỗng + source='auto' = để tự dò 1 ca theo giờ.
export function resolveDayShifts(employeeId, workDate) {
  const da = dailyAssignments(employeeId, workDate);
  if (da.length) {
    if (da.some((x) => x.is_off)) return { off: true, shifts: [], mergeRule: null, source: 'manual', isSchedule: false };
    const shifts = dailyShiftObjs(da);
    if (shifts.length) return { off: false, shifts, mergeRule: shifts.length === 1 ? effectiveMergeRule(shifts[0], null) : null, source: 'manual', isSchedule: shifts.length > 1 };
  }
  const ra = rangedShiftAssignment(employeeId, workDate);
  if (ra) {
    const override = ra.merge_rule;
    if (ra.mode === 'shift' && ra.shift_id) { const s = getShift(ra.shift_id); if (s) return { off: false, shifts: [s], mergeRule: effectiveMergeRule(s, override), source: 'assign', isSchedule: false }; }
    if (ra.mode === 'schedule' && ra.work_schedule_id) {
      const sd = schedDay(ra.work_schedule_id, workDate, ra.from_date);
      if (sd.off) return { off: false, shifts: [], mergeRule: null, source: 'auto', isSchedule: false, patternOff: true };   // ngày nghỉ theo chu kỳ: nếu vẫn có lượt quẹt thì tính như ngày không ca, không bỏ dữ liệu
      const cands = sd.shifts;
      // lịch 1 ca/ngày → dựng như ca đơn: cách ghép theo lịch trình vào ra của dòng gán, không chọn thì theo lịch trình MẶC ĐỊNH
      // (trước đây trả null → luôn thành "Giờ đầu - Giờ cuối", bỏ qua lịch trình vào ra mặc định)
      if (cands.length) return { off: false, shifts: cands, mergeRule: cands.length === 1 ? effectiveMergeRule(cands[0], override) : ((override && override !== 'default') ? override : null), source: 'schedule', isSchedule: true };
    }
  }
  const emp = empShiftRow(employeeId);
  const wsId = empScheduleId(emp);
  if (wsId) {
    const sd = schedDay(wsId, workDate, null);
    if (sd.off) return { off: false, shifts: [], mergeRule: null, source: 'auto', isSchedule: false, patternOff: true };
    const cands = sd.shifts;
    if (cands.length) return { off: false, shifts: cands, mergeRule: cands.length === 1 ? effectiveMergeRule(cands[0], null) : null, source: 'schedule', isSchedule: true };
  }
  if (emp?.shift_id) { const s = getShift(emp.shift_id); if (s) return { off: false, shifts: [s], mergeRule: effectiveMergeRule(s, null), source: 'default', isSchedule: false }; }
  return { off: false, shifts: [], mergeRule: null, source: 'auto', isSchedule: false };
}
