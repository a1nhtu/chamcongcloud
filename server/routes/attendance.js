import { Router } from 'express';
import { db, getSetting, allowedOffices } from '../db.js';
import { resolveEffectiveShift, resolveDayShifts } from '../shift-resolver.js';
import { authRequired } from '../auth.js';
import { savePhoto } from '../storage.js';
import { vnDateStr, nowIso, distanceMeters } from '../util.js';
import { computeLate, computeCheckout, isWeekendDay, vnWeekday, noShiftUnit } from '../attendance-calc.js';
import { notifyManagers } from '../push.js';

const r = Router();
r.use(authRequired);

// Giờ VN HH:mm từ ISO
function vnHm(iso) { const t = new Date(new Date(iso).getTime() + 7 * 3600000); return String(t.getUTCHours()).padStart(2, '0') + ':' + String(t.getUTCMinutes()).padStart(2, '0'); }
// Dòng mô tả vị trí cho thông báo
function pushLoc(office, distance, lat, lng) {
  if (office) return office.name + (distance != null && distance > office.radius_m ? ` (ngoài ${distance}m)` : '');
  return `GPS ${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
}

function isHoliday(date) {
  return !!db.prepare('SELECT 1 FROM public_holidays WHERE holiday_date = ?').get(date);
}
function dayFlags(date) {
  return {
    isHoliday: isHoliday(date),
    isWeekend: isWeekendDay(date, getSetting('weekend_days', '7')),
    roundingDecimals: parseInt(getSetting('workunit_rounding', '2'), 10) || 2,
    roundingMode: parseInt(getSetting('workunit_rounding_mode', '0'), 10) || 0,
  };
}
function otTypeOf(date) {
  const f = dayFlags(date);
  return f.isHoliday ? 'le' : f.isWeekend ? 'cuoi_tuan' : 'thuong';
}

// Định vị GẦN NHẤT trong danh sách NV được phép chấm (chưa cấu hình → tất cả định vị).
// Trả { office, distance, outside } — outside=1 nếu xa hơn bán kính của định vị gần nhất.
function nearestAllowedOffice(employeeId, lat, lng) {
  const offices = allowedOffices(employeeId);
  if (!offices.length) return { office: null, distance: null, outside: 0 };
  let best = null;
  for (const o of offices) {
    const d = distanceMeters(lat, lng, o.lat, o.lng);
    if (!best || d < best.distance) best = { office: o, distance: d };
  }
  return { office: best.office, distance: best.distance, outside: best.distance > best.office.radius_m ? 1 : 0 };
}

// ---- Khoá thiết bị (chống chấm hộ) ----
const deviceLockOn = () => getSetting('device_lock_enabled', '0') === '1';
const reqDeviceId = (req) => (req.headers['x-device-id'] || req.body?.device_id || '').toString().trim();
const reqDeviceLabel = (req) => (req.headers['user-agent'] || '').toString().slice(0, 120);

// Kiểm tra thiết bị trước khi cho chấm công.
// Trả về {ok:true} hoặc {block:true, code, error}. Thiết bị đầu tiên tự gắn (auto-approve).
function checkDevice(req) {
  if (!deviceLockOn()) return { ok: true };
  const devId = reqDeviceId(req);
  if (!devId) return { block: true, code: 'DEVICE_REQUIRED', error: 'Không nhận được mã thiết bị. Vui lòng tải lại ứng dụng rồi thử lại.' };
  const emp = db.prepare('SELECT device_id FROM employees WHERE id=?').get(req.user.id);
  if (!emp.device_id) { // lần đầu → gắn luôn điện thoại này cho tài khoản
    db.prepare('UPDATE employees SET device_id=?, device_label=? WHERE id=?').run(devId, reqDeviceLabel(req), req.user.id);
    return { ok: true };
  }
  if (emp.device_id === devId) return { ok: true };
  return { block: true, code: 'DEVICE_MISMATCH', error: 'Tài khoản này đã gắn với một điện thoại khác. Bạn đang dùng máy lạ nên không thể chấm công. Hãy gửi yêu cầu đổi thiết bị để admin duyệt.' };
}

// NV xin dùng điện thoại hiện tại (chờ admin duyệt đổi)
r.post('/request-device', (req, res) => {
  const devId = reqDeviceId(req);
  if (!devId) return res.status(400).json({ error: 'Không nhận được mã thiết bị' });
  db.prepare('UPDATE employees SET pending_device=?, device_label=? WHERE id=?').run(devId, reqDeviceLabel(req), req.user.id);
  res.json({ ok: true });
});

// Bản ghi chấm công hôm nay (hỗ trợ nhiều ca/ngày)
r.get('/today', (req, res) => {
  const date = vnDateStr();
  const mode = getSetting('attendance_mode', 'shift');
  const rows = db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND work_date = ? ORDER BY check_in_at').all(req.user.id, date);
  // Ca đang mở (đã vào, chưa ra) — hôm nay hoặc ca đêm hôm qua
  let openRow = rows.find((r) => r.check_in_at && !r.check_out_at) || null;
  if (!openRow) {
    const yRow = db.prepare("SELECT * FROM attendance WHERE employee_id = ? AND work_date = date(?, '-1 day') AND check_in_at IS NOT NULL AND check_out_at IS NULL ORDER BY check_in_at DESC LIMIT 1").get(req.user.id, date);
    if (yRow) openRow = yRow;
  }
  const completed = rows.filter((r) => r.check_in_at && r.check_out_at).length;

  // Ca dự kiến hôm nay (có thể nhiều ca)
  let shift = null, autoDetect = false, dayOff = false, dayShiftNames = [], expected = 0;
  if (mode !== 'hourly') {
    const plan = resolveDayShifts(req.user.id, date);
    dayOff = plan.off;
    dayShiftNames = plan.shifts.map((s) => s.name);
    expected = plan.shifts.length;
    if (plan.shifts.length === 1) { const s = plan.shifts[0]; shift = { id: s.id, name: s.name, start_time: s.start_time, end_time: s.end_time }; }
    else if (plan.shifts.length === 0 && !plan.off) autoDetect = true;
  }
  // Trạng thái nút cho app: off | can_out (đang mở ca) | done (xong hết ca dự kiến) | can_in
  let state;
  if (dayOff) state = 'off';
  else if (openRow) state = 'can_out';
  else if (expected > 0 && completed >= expected) state = 'done';
  else state = 'can_in';
  const row = openRow || (rows.length ? rows[rows.length - 1] : null);

  const office = req.user.office_id ? db.prepare('SELECT name, radius_m FROM offices WHERE id = ?').get(req.user.office_id) : null;
  const geofence = {
    enforce: getSetting('geofence_enforce', '0') === '1',
    office_name: office?.name || null,
    radius_m: office?.radius_m ?? null,
  };
  let device = { lock: deviceLockOn(), state: 'ok' };
  if (device.lock) {
    const devId = reqDeviceId(req);
    const emp = db.prepare('SELECT device_id, pending_device FROM employees WHERE id = ?').get(req.user.id);
    if (!emp.device_id || emp.device_id === devId) device.state = 'ok';
    else if (emp.pending_device && emp.pending_device === devId) device.state = 'pending';
    else device.state = 'mismatch';
  }
  res.json({ date, attendance: row || null, todayRows: rows, state, expected, completed, dayShiftNames,
    todayShift: shift, dayOff, autoDetect, mode, geofence, device });
});

// Chấm VÀO CA
r.post('/check-in', (req, res) => {
  const { lat, lng, photo, accuracy } = req.body || {};
  if (lat == null || lng == null) return res.status(400).json({ error: 'Không lấy được vị trí GPS' });
  if (!photo) return res.status(400).json({ error: 'Cần chụp ảnh xác nhận' });
  const dchk = checkDevice(req);
  if (dchk.block) return res.status(403).json({ error: dchk.error, code: dchk.code });

  const date = vnDateStr();
  const at = nowIso();
  // Chế độ chấm công: 'hourly' = chỉ tính giờ, không ca, không muộn/sớm
  const hourly = getSetting('attendance_mode', 'shift') === 'hourly';
  // TỰ ĐỘNG tìm ca theo giờ chấm (phân ca thủ công đè) → xác định ca đang VÀO (cho phép nhiều ca/ngày)
  const rs = hourly ? { shift: null, source: 'hourly' } : resolveEffectiveShift(req.user.id, date, at);
  const shift = rs.shift;
  const shiftKey = shift?.id ?? 0;
  // Dòng công của ĐÚNG ca này hôm nay
  const existing = db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND work_date = ? AND COALESCE(shift_id,0) = ?')
    .get(req.user.id, date, shiftKey);
  const shiftLabel = shift ? `ca ${shift.name}` : 'ca';
  if (existing && existing.check_in_at && !existing.check_out_at)
    return res.status(400).json({ error: `Bạn đang trong ${shiftLabel}, chưa chấm ra. Hãy chấm RA trước.` });
  if (existing && existing.check_in_at && existing.check_out_at)
    return res.status(400).json({ error: `Bạn đã hoàn thành ${shiftLabel} hôm nay rồi` });
  // Chống bấm nhầm 2 lần liền: nếu vừa chấm (vào/ra) trong vòng N phút → chặn
  const dedupMinIn = parseInt(getSetting('punch_dedup_min', '0'), 10) || 0;
  if (dedupMinIn > 0) {
    const last = db.prepare(`SELECT MAX(t) mt FROM (
      SELECT check_in_at t FROM attendance WHERE employee_id=? AND work_date=?
      UNION ALL SELECT check_out_at t FROM attendance WHERE employee_id=? AND work_date=?)`).get(req.user.id, date, req.user.id, date);
    if (last && last.mt && (Date.now() - new Date(last.mt)) < dedupMinIn * 60000)
      return res.status(400).json({ error: `Bạn vừa chấm cách đây chưa tới ${dedupMinIn} phút. Vui lòng chờ (chống bấm nhầm).` });
  }

  // Định vị GẦN NHẤT trong các định vị NV được phép chấm
  const { office, distance, outside } = nearestAllowedOffice(req.user.id, lat, lng);
  // Nếu bật "chỉ cho chấm trong bán kính" → chặn khi ở ngoài phạm vi định vị gần nhất
  if (office && outside && getSetting('geofence_enforce', '0') === '1') {
    return res.status(400).json({ error: `Bạn đang cách "${office.name}" khoảng ${distance}m, ngoài phạm vi cho phép (${office.radius_m}m). Vui lòng tới gần một định vị được phép để chấm công.` });
  }

  const late = shift ? computeLate(shift, at, date) : 0;
  const otType = otTypeOf(date);

  let photoPath;
  try { photoPath = savePhoto(photo, `in_${req.user.code}`); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  if (existing) {
    db.prepare(`UPDATE attendance SET check_in_at=?, check_in_lat=?, check_in_lng=?, check_in_photo=?,
      check_in_office_id=?, check_in_distance_m=?, check_in_outside=?, late_min=?, day_status=?, ot_type=?,
      shift_id=?, shift_source=? WHERE id=?`)
      .run(at, lat, lng, photoPath, office?.id ?? null, distance, outside, late, 'thieu_ra', otType,
           shift?.id ?? null, rs.source, existing.id);
  } else {
    db.prepare(`INSERT INTO attendance
      (employee_id, work_date, check_in_at, check_in_lat, check_in_lng, check_in_photo,
       check_in_office_id, check_in_distance_m, check_in_outside, late_min, day_status, ot_type,
       shift_id, shift_source)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(req.user.id, date, at, lat, lng, photoPath, office?.id ?? null, distance, outside, late, 'thieu_ra', otType,
           shift?.id ?? null, rs.source);
  }

  const row = db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND work_date = ? AND COALESCE(shift_id,0) = ?')
    .get(req.user.id, date, shiftKey);
  res.json({ ok: true, attendance: row, meta: { distance, outside: !!outside, late } });
  // Thông báo cho quản lý (không chặn phản hồi)
  notifyManagers({
    title: '🟢 ' + req.user.full_name + ' vừa VÀO ca',
    body: `${vnHm(at)} · ${pushLoc(office, distance, lat, lng)}` + (late > 0 ? ` · muộn ${late} phút` : ''),
    url: '/admin', tag: 'in-' + req.user.id,
  }, req.user.id).catch(() => {});
});

// Chấm RA CA
r.post('/check-out', (req, res) => {
  const { lat, lng, photo } = req.body || {};
  if (lat == null || lng == null) return res.status(400).json({ error: 'Không lấy được vị trí GPS' });
  if (!photo) return res.status(400).json({ error: 'Cần chụp ảnh xác nhận' });
  const dchk = checkDevice(req);
  if (dchk.block) return res.status(403).json({ error: dchk.error, code: dchk.code });

  const date = vnDateStr();
  // Tìm CA ĐANG MỞ hôm nay (đã vào, chưa ra) — mới nhất trước (hỗ trợ nhiều ca/ngày)
  let row = db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND work_date = ? AND check_in_at IS NOT NULL AND check_out_at IS NULL ORDER BY check_in_at DESC LIMIT 1').get(req.user.id, date);
  // CA ĐÊM: nếu hôm nay không có ca mở, tìm ca HÔM QUA đã VÀO mà CHƯA RA
  if (!row) {
    const yRow = db.prepare("SELECT * FROM attendance WHERE employee_id = ? AND work_date = date(?, '-1 day') AND check_in_at IS NOT NULL AND check_out_at IS NULL ORDER BY check_in_at DESC LIMIT 1").get(req.user.id, date);
    if (yRow) row = yRow;
  }
  if (!row) return res.status(400).json({ error: 'Chưa có ca nào đang mở để chấm ra (hôm nay hoặc ca đêm hôm qua)' });
  // Chống bấm nhầm: chấm RA quá sát giờ chấm VÀO (trong N phút) → chặn
  const dedupMinOut = parseInt(getSetting('punch_dedup_min', '0'), 10) || 0;
  if (dedupMinOut > 0 && (Date.now() - new Date(row.check_in_at)) < dedupMinOut * 60000)
    return res.status(400).json({ error: `Bạn vừa chấm vào cách đây chưa tới ${dedupMinOut} phút — chưa thể chấm ra ngay (chống bấm nhầm).` });

  const wdate = row.work_date;   // ngày công của bản ghi (ca đêm = hôm qua)
  const at = nowIso();
  const hourly = getSetting('attendance_mode', 'shift') === 'hourly';
  // DÒ LẠI ca bằng CẢ giờ vào + giờ ra (phân biệt ca cùng giờ vào: Sáng/Hành chính; và ca đêm)
  const rs = hourly ? { shift: null, source: 'hourly' } : resolveEffectiveShift(req.user.id, wdate, row.check_in_at, at);
  const shift = rs.shift;

  // Định vị GẦN NHẤT trong các định vị NV được phép chấm
  const { office, distance } = nearestAllowedOffice(req.user.id, lat, lng);
  if (office && distance > office.radius_m && getSetting('geofence_enforce', '0') === '1') {
    return res.status(400).json({ error: `Bạn đang cách "${office.name}" khoảng ${distance}m, ngoài phạm vi cho phép (${office.radius_m}m). Vui lòng tới gần một định vị được phép để chấm ra ca.` });
  }

  let photoPath;
  try { photoPath = savePhoto(photo, `out_${req.user.code}`); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  // Tính đầy đủ chỉ số công (theo ngày công của bản ghi — ca đêm dùng ngày hôm qua)
  let calc;
  if (shift) {
    calc = computeCheckout(shift, row.check_in_at, at, wdate, dayFlags(wdate));
  } else {
    const wm = Math.max(0, Math.round((new Date(at) - new Date(row.check_in_at)) / 60000));
    calc = { early_min: 0, ot_min: 0, work_minutes: wm, work_unit: noShiftUnit(wm, dayFlags(wdate)), ot_type: otTypeOf(wdate), day_status: 'lam_viec' };
  }
  // Dò lại ca có thể đổi ca so với lúc vào → cập nhật luôn shift_id + tính lại đi muộn theo ca cuối
  const finalShiftId = shift ? shift.id : row.shift_id;
  const finalSource = shift ? rs.source : (row.shift_source || '');
  const finalLate = shift ? computeLate(shift, row.check_in_at, wdate) : row.late_min;

  db.prepare(`UPDATE attendance SET check_out_at=?, check_out_lat=?, check_out_lng=?,
    check_out_photo=?, check_out_distance_m=?, work_minutes=?, early_min=?, ot_min=?,
    work_unit=?, day_status=?, ot_type=?, shift_id=?, shift_source=?, late_min=? WHERE id=?`)
    .run(at, lat, lng, photoPath, distance, calc.work_minutes, calc.early_min, calc.ot_min,
         calc.work_unit, calc.day_status, calc.ot_type, finalShiftId, finalSource, finalLate, row.id);

  const updated = db.prepare('SELECT * FROM attendance WHERE id = ?').get(row.id);
  res.json({ ok: true, attendance: updated, meta: calc });
  notifyManagers({
    title: '🔴 ' + req.user.full_name + ' vừa RA ca',
    body: `${vnHm(at)} · ${pushLoc(office, distance, lat, lng)}`,
    url: '/admin', tag: 'out-' + req.user.id,
  }, req.user.id).catch(() => {});
});

// Bảng công của tôi theo tháng (?month=YYYY-MM)
r.get('/mine', (req, res) => {
  const month = (req.query.month || vnDateStr().slice(0, 7)).slice(0, 7);
  const rows = db.prepare(
    `SELECT * FROM attendance WHERE employee_id = ? AND work_date LIKE ? ORDER BY work_date DESC`
  ).all(req.user.id, month + '%');
  res.json({ month, rows });
});

// Lịch chấm công cá nhân đủ tháng (đánh dấu từng ngày)
r.get('/calendar', (req, res) => {
  const month = (req.query.month || vnDateStr().slice(0, 7)).slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const nDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = Array.from({ length: nDays }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  const today = vnDateStr();
  const weekend = getSetting('weekend_days', '7');

  const cell = new Map();
  for (const a of db.prepare('SELECT * FROM attendance WHERE employee_id=? AND work_date LIKE ?').all(req.user.id, month + '%'))
    cell.set(a.work_date, a);
  const holidays = new Set(db.prepare('SELECT holiday_date FROM public_holidays WHERE holiday_date LIKE ?').all(month + '%').map((h) => h.holiday_date));
  const offDays = new Set(db.prepare('SELECT work_date FROM daily_shift_assignments WHERE employee_id=? AND is_off=1 AND work_date LIKE ?').all(req.user.id, month + '%').map((r) => r.work_date));
  const leaveDays = new Set();
  for (const l of db.prepare("SELECT type, from_date, to_date FROM leave_requests WHERE employee_id=? AND status='approved' AND from_date<=? AND to_date>=?").all(req.user.id, month + '-31', month + '-01'))
    for (const d of days) if (d >= l.from_date && d <= l.to_date) leaveDays.add(d);

  const empShift = req.user.shift_id ? db.prepare('SELECT * FROM shifts WHERE id=?').get(req.user.shift_id) : null;
  const scheduled = (date) => {
    if (holidays.has(date) || offDays.has(date)) return false;
    const s = empShift; if (!s) return false;
    return (s.work_days || '1,2,3,4,5,6').split(',').includes(String(vnWeekday(date)));
  };

  const out = days.map((d) => {
    const c = cell.get(d);
    let status;
    if (leaveDays.has(d)) status = 'phep';
    else if (holidays.has(d)) status = 'le';
    else if (offDays.has(d)) status = 'nghi';
    else if (c) {
      if (!c.check_out_at) status = 'thieu_ra';
      else if ((c.late_min || 0) > 0 || (c.early_min || 0) > 0) status = 'muon_som';
      else if ((c.work_unit || 0) > 0) status = 'du_cong';
      else status = 'vang';
    } else if (d > today) status = 'chua_toi';
    else if (scheduled(d)) status = 'vang';
    else status = 'ngoai_lich';
    return {
      date: d, day: +d.slice(8), wd: vnWeekday(d), weekend: isWeekendDay(d, weekend),
      status,
      check_in: c?.check_in_at || null, check_out: c?.check_out_at || null,
      work_minutes: c?.work_minutes || 0, work_unit: c?.work_unit || 0,
      late_min: c?.late_min || 0, early_min: c?.early_min || 0, ot_min: c?.ot_min || 0,
    };
  });
  res.json({ month, days: out });
});

// Tổng hợp tháng
r.get('/summary', (req, res) => {
  const month = (req.query.month || vnDateStr().slice(0, 7)).slice(0, 7);
  const rows = db.prepare(
    `SELECT * FROM attendance WHERE employee_id = ? AND work_date LIKE ?`
  ).all(req.user.id, month + '%');
  const days = rows.filter((x) => x.check_in_at).length;
  const totalMin = rows.reduce((s, x) => s + (x.work_minutes || 0), 0);
  const totalUnit = rows.reduce((s, x) => s + (x.work_unit || 0), 0);
  const otMin = rows.reduce((s, x) => s + (x.ot_min || 0), 0);
  const lateCount = rows.filter((x) => (x.late_min || 0) > 0).length;
  const earlyCount = rows.filter((x) => (x.early_min || 0) > 0).length;
  res.json({
    month, days,
    totalMinutes: totalMin,
    totalWorkUnit: Math.round(totalUnit * 100) / 100,
    otMinutes: otMin,
    lateCount, earlyCount,
  });
});

export default r;
