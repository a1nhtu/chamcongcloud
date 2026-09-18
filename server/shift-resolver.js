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

// Phân ca theo KHOẢNG NGÀY (bảng shift_assignments) phủ ngày này — bản ghi mới nhất thắng.
export function rangedShiftAssignment(employeeId, workDate) {
  return db.prepare(`SELECT * FROM shift_assignments
    WHERE employee_id = ? AND active = 1 AND from_date <= ?
      AND (to_date IS NULL OR to_date = '' OR to_date >= ?)
    ORDER BY id DESC LIMIT 1`).get(employeeId, workDate, workDate);
}

// Quy tắc ghép log thực tế: ưu tiên ghi đè từ phân ca → quy tắc của ca → 'filo'.
function effectiveMergeRule(shift, override) {
  const r = (override && override !== 'default') ? override : (shift && shift.merge_rule) || 'filo';
  return r === 'default' ? 'filo' : r;
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
    if (ra.mode === 'schedule' && ra.work_schedule_id && scheduleShifts(ra.work_schedule_id).length) {
      const ws = db.prepare('SELECT name FROM work_schedules WHERE id = ?').get(ra.work_schedule_id);
      return { off: false, shift: null, source: 'schedule', scheduleName: ws?.name || '' };
    }
  }
  const emp = db.prepare('SELECT shift_id, work_schedule_id FROM employees WHERE id = ?').get(employeeId);
  if (emp?.work_schedule_id && scheduleShifts(emp.work_schedule_id).length) {
    const ws = db.prepare('SELECT name FROM work_schedules WHERE id = ?').get(emp.work_schedule_id);
    return { off: false, shift: null, source: 'schedule', scheduleName: ws?.name || '' };
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
      const cands = scheduleShifts(ra.work_schedule_id);
      if (cands.length) { const s = autoDetectShift(checkInIso, cands, checkOutIso) || cands[0]; return { off: false, shift: s, source: 'schedule', mergeRule: effectiveMergeRule(s, override) }; }
    }
  }
  const emp = db.prepare('SELECT shift_id, work_schedule_id FROM employees WHERE id = ?').get(employeeId);
  if (emp?.work_schedule_id) {
    const cands = scheduleShifts(emp.work_schedule_id);
    if (cands.length) {
      const s = autoDetectShift(checkInIso, cands, checkOutIso) || cands[0];
      return { off: false, shift: s, source: 'schedule', mergeRule: effectiveMergeRule(s, null) };
    }
  }
  if (emp?.shift_id) { const s = getShift(emp.shift_id); if (s) return { off: false, shift: s, source: 'default', mergeRule: effectiveMergeRule(s, null) }; }
  const auto = autoDetectShift(checkInIso, null, checkOutIso);
  if (auto) return { off: false, shift: auto, source: 'auto', mergeRule: effectiveMergeRule(auto, null) };
  return { off: false, shift: null, source: 'none', mergeRule: null };
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
      const cands = scheduleShifts(ra.work_schedule_id);
      if (cands.length) return { off: false, shifts: cands, mergeRule: (override && override !== 'default') ? override : null, source: 'schedule', isSchedule: true };
    }
  }
  const emp = db.prepare('SELECT shift_id, work_schedule_id FROM employees WHERE id = ?').get(employeeId);
  if (emp?.work_schedule_id) {
    const cands = scheduleShifts(emp.work_schedule_id);
    if (cands.length) return { off: false, shifts: cands, mergeRule: null, source: 'schedule', isSchedule: true };
  }
  if (emp?.shift_id) { const s = getShift(emp.shift_id); if (s) return { off: false, shifts: [s], mergeRule: effectiveMergeRule(s, null), source: 'default', isSchedule: false }; }
  return { off: false, shifts: [], mergeRule: null, source: 'auto', isSchedule: false };
}
