// Bộ GIẢI CA — quy tắc nghiệp vụ chọn ca cho 1 NV/ngày (tách khỏi db.js để db.js chỉ còn schema+data).
// Thứ tự ưu tiên xuyên suốt: phân ca NGÀY (đè) → phân ca KHOẢNG → lịch trình → ca mặc định của NV → tự dò theo giờ.
// Phụ thuộc MỘT CHIỀU vào db.js (chỉ đọc dữ liệu) — không có vòng import ngược.
import { db } from './db.js';

const getShift = (id) => db.prepare('SELECT * FROM shifts WHERE id = ?').get(id);
const hhmm2min = (s) => { const [h, m] = String(s || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
function checkinMinVN(iso) { const d = new Date(iso); const t = new Date(d.getTime() + 7 * 3600000); return t.getUTCHours() * 60 + t.getUTCMinutes(); }
function inWindow(min, start, end) { return start <= end ? (min >= start && min <= end) : (min >= start || min <= end); }

// Các ca thuộc 1 lịch trình (đang hoạt động), theo thứ tự.
export function scheduleShifts(scheduleId) {
  return db.prepare(`SELECT s.* FROM work_schedule_shifts wss JOIN shifts s ON s.id = wss.shift_id
    WHERE wss.work_schedule_id = ? AND s.active = 1 ORDER BY wss.sort_order`).all(scheduleId);
}

// Cửa sổ nhận RA của 1 ca: dùng cửa sổ khai báo; nếu chưa khai → suy từ Giờ ra (end-1h .. end+8h).
// (giống phần mềm mẫu). Trả [startMin, endMin]; inWindow tự xử lý ca đêm (wrap qua nửa đêm).
function outWin(s) {
  if (s.check_out_start && s.check_out_end) return [hhmm2min(s.check_out_start), hhmm2min(s.check_out_end)];
  const e = hhmm2min(s.end_time);
  return [((e - 60) % 1440 + 1440) % 1440, (e + 480) % 1440];
}
// Tự động tìm ca theo GIỜ VÀO (+ GIỜ RA nếu biết, để phân biệt các ca cùng giờ vào — VD Sáng vs Hành chính).
// candidates = danh sách ca ứng viên (VD của 1 lịch trình); bỏ trống = mọi ca active có cửa sổ.
export function autoDetectShift(checkInIso, candidates, checkOutIso) {
  if (!checkInIso) return null;
  const inMin = checkinMinVN(checkInIso);
  const outMin = checkOutIso ? checkinMinVN(checkOutIso) : null;
  const all = candidates || db.prepare("SELECT * FROM shifts WHERE active = 1 AND check_in_start IS NOT NULL AND check_in_start != ''").all();
  if (!all.length) return null;
  const withWin = all.filter((s) => s.check_in_start && s.check_in_end);
  // Khớp cửa sổ VÀO
  const ciMatch = withWin.filter((s) => inWindow(inMin, hhmm2min(s.check_in_start), hhmm2min(s.check_in_end)));
  const pool = ciMatch.length ? ciMatch : (candidates ? all : []);
  if (!pool.length) return null;
  const nearIn = (list) => [...list].sort((a, b) => Math.abs(hhmm2min(a.start_time) - inMin) - Math.abs(hhmm2min(b.start_time) - inMin))[0];
  // Chưa biết giờ RA (lúc chấm VÀO) hoặc chỉ 1 ứng viên → chọn theo giờ vào gần nhất
  if (outMin == null || pool.length === 1) return nearIn(pool);
  // Có giờ RA + nhiều ca cùng khớp giờ vào → chấm điểm bằng cửa sổ RA (ưu tiên cửa sổ khai báo)
  const scored = pool.map((s) => {
    const explicit = !!(s.check_out_start && s.check_out_end);
    const [coS, coE] = outWin(s);
    const outOk = inWindow(outMin, coS, coE);
    return { s, score: outOk ? (explicit ? 3 : 2) : 0, outDist: Math.abs(hhmm2min(s.end_time) - outMin), inDist: Math.abs(hhmm2min(s.start_time) - inMin) };
  });
  scored.sort((a, b) => b.score - a.score || a.outDist - b.outDist || a.inDist - b.inDist);
  return scored[0].s;
}

// Chuỗi phòng ban từ phòng của NV lên các cấp cha: [phòng, cha, ông…]
function deptChain(name) {
  const out = [], seen = new Set();
  let cur = db.prepare('SELECT id, name, parent_id FROM departments WHERE name = ?').get(name);
  if (!cur) return name ? [name] : [];
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id); out.push(cur.name);
    cur = cur.parent_id ? db.prepare('SELECT id, name, parent_id FROM departments WHERE id = ?').get(cur.parent_id) : null;
  }
  return out;
}
// Lịch trình gán cho PHÒNG BAN phủ ngày này: phòng của NV trước, rồi tới phòng cấp trên có bật "bao gồm cấp dưới".
export function deptShiftAssignment(employeeId, workDate) {
  const e = db.prepare('SELECT department FROM employees WHERE id = ?').get(employeeId);
  const dept = (e?.department || '').trim();
  if (!dept) return null;
  const chain = deptChain(dept);
  for (let i = 0; i < chain.length; i++) {
    const r = db.prepare(`SELECT * FROM dept_shift_assignments
      WHERE department = ? AND active = 1 AND from_date <= ? AND (to_date IS NULL OR to_date = '' OR to_date >= ?)
        ${i > 0 ? 'AND include_children = 1' : ''}
      ORDER BY id DESC LIMIT 1`).get(chain[i], workDate, workDate);
    if (r) return r;
  }
  return null;
}

// Phân ca theo KHOẢNG NGÀY phủ ngày này — lịch RIÊNG của NV (shift_assignments, bản ghi mới nhất thắng);
// NV không có lịch riêng thì theo lịch trình của PHÒNG BAN.
export function rangedShiftAssignment(employeeId, workDate) {
  const own = db.prepare(`SELECT * FROM shift_assignments
    WHERE employee_id = ? AND active = 1 AND from_date <= ?
      AND (to_date IS NULL OR to_date = '' OR to_date >= ?)
    ORDER BY id DESC LIMIT 1`).get(employeeId, workDate, workDate);
  const r = own || deptShiftAssignment(employeeId, workDate);
  // Dòng gán có kèm "Lịch trình vào ra" → cách ghép giờ lấy theo lịch trình vào ra đó
  if (r && r.inout_schedule_id) { const io = ioSchedule(r.inout_schedule_id); if (io) { r._io = io; r.merge_rule = io.rule; } }
  return r;
}

// ----- Lịch trình vào ra (cách xác định lượt VÀO / RA), khai báo riêng như Ronald Jack -----
function ioSchedule(id) { return id ? (db.prepare('SELECT * FROM inout_schedules WHERE id = ? AND active = 1').get(id) || null) : null; }
export function defaultIoSchedule() { return db.prepare('SELECT * FROM inout_schedules WHERE active = 1 AND is_default = 1 ORDER BY id LIMIT 1').get() || null; }
// Lịch trình vào ra đang áp cho 1 NV trong 1 ngày: của dòng gán (NV → phòng ban), không có thì lấy lịch trình mặc định.
export function ioScheduleFor(employeeId, workDate) {
  const ra = rangedShiftAssignment(employeeId, workDate);
  return (ra && ra._io) || defaultIoSchedule();
}
// Ngưỡng ghép cặp của lịch trình vào ra đó → { min, gap, max } (phút); null = chưa khai lịch trình vào ra nào
export function ioParamsFor(employeeId, workDate) {
  const io = ioScheduleFor(employeeId, workDate);
  return io ? { min: io.min_minutes, gap: io.gap_minutes, max: io.max_minutes } : null;
}

// Cách ghép giờ thực tế, theo thứ tự: lịch trình vào ra của dòng gán → quy tắc RIÊNG còn lưu ở ca (kiểu cũ, khác FILO)
// → lịch trình vào ra MẶC ĐỊNH → FILO (giờ đầu vào, giờ cuối ra).
function effectiveMergeRule(shift, override) {
  if (override && override !== 'default') return override;
  const legacy = shift && shift.merge_rule && shift.merge_rule !== 'filo' && shift.merge_rule !== 'default' ? shift.merge_rule : null;
  if (legacy) return legacy;
  const d = defaultIoSchedule();
  return d ? d.rule : 'filo';
}

// Phân ca ngày của 1 NV trong 1 ngày — có thể NHIỀU ca (NV tự chọn 2-3 ca gãy).
function dailyAssignments(employeeId, workDate) {
  return db.prepare('SELECT shift_id, is_off FROM daily_shift_assignments WHERE employee_id = ? AND work_date = ?').all(employeeId, workDate);
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
  const ws = db.prepare('SELECT unit, cycle FROM work_schedules WHERE id = ?').get(scheduleId);
  const unit = ws?.unit || 'auto';
  if (unit === 'auto') return { pattern: false, off: false, shifts: scheduleShifts(scheduleId) };
  const idx = scheduleSlot(unit, ws.cycle, workDate, anchor);
  const shifts = db.prepare(`SELECT s.* FROM work_schedule_days d JOIN shifts s ON s.id = d.shift_id
    WHERE d.work_schedule_id = ? AND d.idx = ? AND s.active = 1 ORDER BY s.start_time`).all(scheduleId, idx);
  return { pattern: true, off: !shifts.length, shifts };
}

export function resolveShift(employeeId, workDate) {
  const da = dailyAssignments(employeeId, workDate);
  if (da.length) {
    if (da.some((x) => x.is_off)) return { off: true, shift: null, source: 'manual' };
    const shifts = dailyShiftObjs(da);
    if (shifts.length > 1) return { off: false, shift: null, source: 'schedule', scheduleName: shifts.length + ' ca đã chọn' };
    if (shifts.length === 1) return { off: false, shift: shifts[0], source: 'manual' };
  }
  const ra = rangedShiftAssignment(employeeId, workDate);
  if (ra) {
    if (ra.mode === 'shift' && ra.shift_id) { const s = getShift(ra.shift_id); if (s) return { off: false, shift: s, source: 'assign' }; }
    if (ra.mode === 'schedule' && ra.work_schedule_id) {
      const sd = schedDay(ra.work_schedule_id, workDate, ra.from_date);
      const scheduleName = db.prepare('SELECT name FROM work_schedules WHERE id = ?').get(ra.work_schedule_id)?.name || '';
      if (sd.off) return { off: true, shift: null, source: 'schedule', scheduleName };                       // ô trống trong chu kỳ = ngày nghỉ
      if (sd.pattern && sd.shifts.length === 1) return { off: false, shift: sd.shifts[0], source: 'assign', scheduleName };
      if (sd.shifts.length) return { off: false, shift: null, source: 'schedule', scheduleName };
    }
  }
  const emp = db.prepare('SELECT shift_id, work_schedule_id FROM employees WHERE id = ?').get(employeeId);
  if (emp?.work_schedule_id) {
    const sd = schedDay(emp.work_schedule_id, workDate, null);
    const scheduleName = db.prepare('SELECT name FROM work_schedules WHERE id = ?').get(emp.work_schedule_id)?.name || '';
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
  const emp = db.prepare('SELECT shift_id, work_schedule_id FROM employees WHERE id = ?').get(employeeId);
  if (emp?.work_schedule_id) {
    const sd = schedDay(emp.work_schedule_id, workDate, null);
    if (sd.off) return { off: false, shift: null, source: 'none', mergeRule: 'pairs' };
    const cands = sd.shifts;
    if (cands.length) {
      const s = autoDetectShift(checkInIso, cands, checkOutIso) || cands[0];
      return { off: false, shift: s, source: 'schedule', mergeRule: effectiveMergeRule(s, null) };
    }
  }
  if (emp?.shift_id) { const s = getShift(emp.shift_id); if (s) return { off: false, shift: s, source: 'default', mergeRule: effectiveMergeRule(s, null) }; }
  const auto = autoDetectShift(checkInIso, null, checkOutIso);
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
      if (cands.length) return { off: false, shifts: cands, mergeRule: (override && override !== 'default') ? override : null, source: 'schedule', isSchedule: true };
    }
  }
  const emp = db.prepare('SELECT shift_id, work_schedule_id FROM employees WHERE id = ?').get(employeeId);
  if (emp?.work_schedule_id) {
    const sd = schedDay(emp.work_schedule_id, workDate, null);
    if (sd.off) return { off: false, shifts: [], mergeRule: null, source: 'auto', isSchedule: false, patternOff: true };
    const cands = sd.shifts;
    if (cands.length) return { off: false, shifts: cands, mergeRule: null, source: 'schedule', isSchedule: true };
  }
  if (emp?.shift_id) { const s = getShift(emp.shift_id); if (s) return { off: false, shifts: [s], mergeRule: effectiveMergeRule(s, null), source: 'default', isSchedule: false }; }
  return { off: false, shifts: [], mergeRule: null, source: 'auto', isSchedule: false };
}
