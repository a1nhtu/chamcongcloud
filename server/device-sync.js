// Xử lý dữ liệu chấm công đẩy về từ máy ZKTeco (ADMS Push).
// Parse dòng ATTLOG → lưu punch → dựng lại bản ghi chấm công (vào sớm nhất / ra muộn nhất).
import { db, getSetting, resolveEffectiveShift, resolveDayShifts } from './db.js';
import { computeLate, computeCheckout, isWeekendDay, mergeDayPunches, ruleWindow } from './attendance-calc.js';
import { hashPassword } from './auth.js';

// Tìm NV theo Số ID máy (device_pin) trước, sau đó fallback theo mã NV (code).
function findEmpByPin(pin) {
  return db.prepare("SELECT id, from_device FROM employees WHERE device_pin=? AND device_pin!='' AND active=1").get(pin)
      || db.prepare('SELECT id, from_device FROM employees WHERE code=? AND active=1').get(pin);
}

// Sinh giá trị chưa trùng cho cột UNIQUE (code / username)
function uniqueValue(column, base) {
  let v = base, i = 1;
  const q = db.prepare(`SELECT 1 FROM employees WHERE ${column}=?`);
  while (q.get(v)) v = `${base}_${i++}`;
  return v;
}

// Tự tạo / cập nhật NV từ dữ liệu máy đẩy về (đăng ký vân tay hoặc USERINFO).
// Trả về id NV (hoặc null nếu tắt auto-create và chưa có NV).
export function upsertEmployeeFromDevice(pin, name, force = false) {
  pin = String(pin || '').trim();
  if (!pin) return null;
  name = (name || '').trim();

  // Đã có NV khớp Số ID
  let emp = db.prepare("SELECT id, full_name, from_device FROM employees WHERE device_pin=? AND device_pin!=''").get(pin);
  if (emp) {
    // Chỉ cập nhật tên nếu là NV nháp từ máy và máy gửi tên thật khác placeholder
    if (emp.from_device && name && name !== `NV ${pin}` && emp.full_name === `NV ${pin}`)
      db.prepare('UPDATE employees SET full_name=? WHERE id=?').run(name, emp.id);
    return emp.id;
  }

  // NV cũ trùng mã (code) nhưng chưa gán Số ID → gán liên kết
  const byCode = db.prepare("SELECT id FROM employees WHERE code=? AND (device_pin IS NULL OR device_pin='')").get(pin);
  if (byCode) {
    db.prepare('UPDATE employees SET device_pin=? WHERE id=?').run(pin, byCode.id);
    return byCode.id;
  }

  // Tự tạo NV nháp (force=true khi nhập từ USB — luôn tạo dù tắt auto-create)
  if (!force && getSetting('device_autocreate', '1') !== '1') return null;
  const code = uniqueValue('code', pin);
  const username = uniqueValue('username', `nv${pin}`);
  const fullName = name || `NV ${pin}`;
  const info = db.prepare(`INSERT INTO employees
    (code, full_name, department, position, phone, role, username, password_hash, device_pin, from_device, active)
    VALUES (?,?, '', '', '', 'employee', ?, ?, ?, 1, 1)`)
    .run(code, fullName, username, hashPassword('123456'), pin);
  return Number(info.lastInsertRowid);
}

// Parse khối dữ liệu USER/USERINFO/FP (đăng ký vân tay real-time) → tạo/cập nhật NV.
// Máy gửi các dòng: "USER PIN=1\tName=..\tPri=0\t..", "FP PIN=1\tFID=0\t..\tTMP=..", hoặc "PIN=1\tName=.." (bảng USERINFO).
// Trả về số NV đã đụng tới.
export function ingestUserData(serial, table, rawBody) {
  const lines = String(rawBody || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const seen = new Set();
  for (let line of lines) {
    // Bỏ tiền tố loại dòng nếu có (USER / FP / USERINFO)
    const m = line.match(/^(USER|FP|USERINFO|FACE|BIODATA)\b\s*/i);
    if (m) line = line.slice(m[0].length);
    const kv = {};
    for (const part of line.split('\t')) {
      const eq = part.indexOf('=');
      if (eq > 0) kv[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
    }
    const pin = (kv.pin || '').trim();
    if (!pin || pin.includes(' ') || pin.length > 20) continue; // bỏ dòng rác
    let name = kv.name || '';
    if (name.includes('=') || name.length > 80) name = ''; // tên rác (firmware nhét FileName=/Content=)
    const card = kv.card && kv.card !== '0' ? kv.card : '';
    const passwd = kv.passwd && kv.passwd !== '0' ? kv.passwd : '';
    const pri = parseInt(kv.pri || '0', 10) || 0;
    upsertDeviceUser(pin, name, card, passwd, pri);   // lưu để đồng bộ tên/thẻ/mật mã
    upsertDeviceUserSerial(serial, pin, name, card);  // ghi theo từng máy (đếm NV/thẻ)
    const id = upsertEmployeeFromDevice(pin, name);
    if (id) seen.add(pin);
  }
  return seen;   // Set các PIN đã đụng tới (dùng để đồng bộ nhóm)
}

/* ============================ ĐỒNG BỘ MÁY ↔ MÁY ============================ */
// Lưu thông tin user trên máy (tên/thẻ/mật mã/quyền) để đẩy kèm khi đồng bộ
function upsertDeviceUser(pin, name, card, passwd, pri) {
  const u = db.prepare('SELECT pin FROM device_users WHERE pin=?').get(pin);
  if (u) {
    db.prepare(`UPDATE device_users SET
      name=CASE WHEN ?<>'' THEN ? ELSE name END,
      card=CASE WHEN ?<>'' THEN ? ELSE card END,
      passwd=CASE WHEN ?<>'' THEN ? ELSE passwd END,
      privilege=?, updated_at=datetime('now') WHERE pin=?`)
      .run(name, name, card, card, passwd, passwd, pri, pin);
  } else {
    db.prepare('INSERT INTO device_users(pin,name,card,passwd,privilege) VALUES(?,?,?,?,?)')
      .run(pin, name || '', card || '', passwd || '', pri || 0);
  }
}

// Ghi/nhật ký user theo TỪNG máy (đếm số NV/thẻ mỗi máy). Chỉ cập nhật name/card khi có giá trị mới.
function upsertDeviceUserSerial(serial, pin, name, card) {
  db.prepare(`INSERT INTO device_users_serial(serial,pin,name,card) VALUES(?,?,?,?)
    ON CONFLICT(serial,pin) DO UPDATE SET
      name=CASE WHEN excluded.name<>'' THEN excluded.name ELSE device_users_serial.name END,
      card=CASE WHEN excluded.card<>'' THEN excluded.card ELSE device_users_serial.card END,
      updated_at=datetime('now')`)
    .run(serial, pin, name || '', card || '');
}

// Ghi nhận máy đích ĐÃ có template này (mirror) để bảng đếm phản ánh đúng ngay sau khi đồng bộ.
function mirrorTemplateTo(targetSerial, tp) {
  db.prepare(`INSERT INTO device_bio_templates(serial,pin,bio_type,idx,valid,duress,major_ver,minor_ver,tmp)
    VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(serial,pin,bio_type,idx) DO UPDATE SET valid=excluded.valid,duress=excluded.duress,
      major_ver=excluded.major_ver,minor_ver=excluded.minor_ver,tmp=excluded.tmp,received_at=datetime('now')`)
    .run(targetSerial, tp.pin, tp.bio_type, tp.idx, tp.valid, tp.duress, tp.major_ver, tp.minor_ver, tp.tmp);
}

const kvOf = (line) => {
  const kv = {};
  for (const part of String(line).split('\t')) {
    const eq = part.indexOf('=');
    if (eq > 0) kv[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
  }
  return kv;
};

// Nạp template sinh trắc từ máy đẩy về (bảng BIODATA / FINGERTMP / FP) → lưu + tạo NV nếu chưa có.
// Trả về Set các PIN vừa đụng tới (để đồng bộ sang máy khác).
export function storeTemplates(serial, table, rawBody) {
  const isFinger9 = /FINGERTMP|FP/i.test(table);
  const pins = new Set();
  const up = db.prepare(`INSERT INTO device_bio_templates(serial,pin,bio_type,idx,valid,duress,major_ver,minor_ver,tmp)
    VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(serial,pin,bio_type,idx) DO UPDATE SET valid=excluded.valid,duress=excluded.duress,
      major_ver=excluded.major_ver,minor_ver=excluded.minor_ver,tmp=excluded.tmp,received_at=datetime('now')`);
  for (let line of String(rawBody || '').split('\n').map((l) => l.trim()).filter(Boolean)) {
    const m = line.match(/^(BIODATA|FINGERTMP|FP)\b\s*/i);
    if (m) line = line.slice(m[0].length);
    const kv = kvOf(line);
    const pin = (kv.pin || '').trim();
    const tmp = kv.tmp || '';
    if (!pin || !tmp || pin.includes(' ') || pin.length > 20) continue;
    let bioType, idx, major;
    if (isFinger9) { bioType = 1; idx = parseInt(kv.fid || kv.no || kv.index || '0', 10) || 0; major = parseInt(kv.majorver || '9', 10) || 9; }
    else { bioType = parseInt(kv.type || '1', 10) || 1; idx = parseInt(kv.no || kv.index || kv.fid || '0', 10) || 0; major = parseInt(kv.majorver || '10', 10) || 10; }
    const valid = parseInt(kv.valid ?? '1', 10); const duress = parseInt(kv.duress || '0', 10) || 0;
    const minor = parseInt(kv.minorver || '0', 10) || 0;
    try { up.run(serial, pin, bioType, idx, isNaN(valid) ? 1 : valid, duress, major, minor, tmp); } catch {}
    upsertDeviceUserSerial(serial, pin, '', '');   // ghi user theo máy (đếm NV)
    upsertEmployeeFromDevice(pin, '');   // đăng ký vân tay-only vẫn tạo NV nháp
    pins.add(pin);
  }
  return pins;
}

// Xếp 1 lệnh xuống máy đích (chống trùng: bỏ qua nếu đã có lệnh y hệt đang chờ gửi)
function queueCmd(serial, content) {
  const dup = db.prepare("SELECT 1 FROM push_device_commands WHERE serial=? AND content=? AND trans_time IS NULL").get(serial, content);
  if (dup) return;
  db.prepare('INSERT INTO push_device_commands(serial,content) VALUES(?,?)').run(serial, content);
}

function buildUserCommand(pin) {
  const u = db.prepare('SELECT * FROM device_users WHERE pin=?').get(pin) || {};
  const card = u.card && u.card !== '0' ? `\tCard=${u.card}` : '';
  return `DATA UPDATE USERINFO PIN=${pin}\tName=${u.name || pin}\tPasswd=${u.passwd || ''}${card}\tPri=${u.privilege || 0}\tGrp=1\tTZ=1\tVerify=0`;
}

/* ============================ XÓA DỮ LIỆU TRÊN MÁY (ADMS) ============================ */
// Danh sách user trên 1 máy (để chọn xóa)
export function deviceUserList(serial) {
  return db.prepare(`SELECT s.pin, COALESCE(NULLIF(s.name,''), u.name, '') AS name, u.privilege
    FROM device_users_serial s LEFT JOIN device_users u ON u.pin = s.pin
    WHERE s.serial = ? ORDER BY CAST(s.pin AS INTEGER), s.pin`).all(serial);
}
// Kéo (tải) danh sách nhân viên + vân tay/khuôn mặt TỪ MÁY về phần mềm.
// Gửi lệnh ADMS DATA QUERY để máy đẩy toàn bộ USERINFO + FINGERTMP + BIODATA lên;
// server nhận sẽ tự tạo/cập nhật NV (upsertEmployeeFromDevice). Dùng khi cần tải lại NV từ máy.
export function queryDeviceUsers(serial) {
  queueCmd(serial, 'DATA QUERY USERINFO');
  queueCmd(serial, 'DATA QUERY FINGERTMP');
  queueCmd(serial, 'DATA QUERY BIODATA');
  return 1;
}
// Mở cửa từ xa (máy kiểm soát cửa) — lệnh ADMS "AC_UNLOCK" (mục 12.7.2 Attendance PUSH Protocol),
// máy kích relay mở khóa cửa; nextCommand bọc thành C:<id>:AC_UNLOCK. Máy phản hồi Return=0 nếu OK.
export function openDoor(serial) { queueCmd(serial, 'AC_UNLOCK'); return 1; }
// Xóa toàn bộ log chấm công trên máy
export function clearDeviceLog(serial) { queueCmd(serial, 'CLEAR LOG'); return 1; }
// Xóa TOÀN BỘ dữ liệu trên máy (NV + vân tay + log) + dọn mirror local để đếm đúng
export function clearDeviceAll(serial) {
  queueCmd(serial, 'CLEAR DATA');
  db.prepare('DELETE FROM device_bio_templates WHERE serial=?').run(serial);
  db.prepare('DELETE FROM device_users_serial WHERE serial=?').run(serial);
  return 1;
}
// Xóa nhân viên trên máy theo Số ID (PIN)
export function deleteDeviceUsers(serial, pins) {
  let n = 0;
  for (const pin of (pins || [])) {
    const p = String(pin).trim(); if (!p) continue;
    queueCmd(serial, `DATA DELETE USERINFO\tPIN=${p}`);
    db.prepare('DELETE FROM device_bio_templates WHERE serial=? AND pin=?').run(serial, p);
    db.prepare('DELETE FROM device_users_serial WHERE serial=? AND pin=?').run(serial, p);
    n++;
  }
  return n;
}
// Xóa quyền quản trị: hạ tất cả user đang là admin (Pri>0) trên máy về user thường (Pri=0)
export function clearDeviceAdmins(serial) {
  const onDevice = db.prepare('SELECT pin FROM device_users_serial WHERE serial=?').all(serial).map((r) => r.pin);
  const set = new Set(onDevice);
  const admins = db.prepare('SELECT pin, name, passwd, card FROM device_users WHERE privilege>0').all()
    .filter((u) => !set.size || set.has(u.pin));
  let n = 0;
  for (const u of admins) {
    const card = u.card && u.card !== '0' ? `\tCard=${u.card}` : '';
    queueCmd(serial, `DATA UPDATE USERINFO PIN=${u.pin}\tName=${u.name || u.pin}\tPasswd=${u.passwd || ''}${card}\tPri=0\tGrp=1\tTZ=1\tVerify=0`);
    db.prepare('UPDATE device_users SET privilege=0 WHERE pin=?').run(u.pin);
    n++;
  }
  return n;
}
function buildBioCommand(t) {
  if (t.bio_type === 1 && (t.major_ver || 10) < 10) // vân tay ZKFinger 9.0
    return `DATA UPDATE FINGERTMP PIN=${t.pin}\tFID=${t.idx}\tSize=${(t.tmp || '').length}\tValid=${t.valid}\tTMP=${t.tmp}`;
  // vân tay ZKFinger 10.0 hoặc khuôn mặt (type 2/9)
  return `DATA UPDATE BIODATA Pin=${t.pin}\tNo=${t.idx}\tIndex=${t.idx}\tValid=${t.valid}\tDuress=${t.duress}\tType=${t.bio_type}\tMajorVer=${t.major_ver}\tMinorVer=${t.minor_ver}\tFormat=0\tTmp=${t.tmp}`;
}

// Sau khi 1 máy đẩy user/template về → đẩy các PIN đó sang MỌI máy cùng nhóm (real-time).
export function syncPinsToGroup(sourceSerial, pins) {
  if (!pins || !pins.size) return 0;
  const src = db.prepare('SELECT sync_group FROM push_devices WHERE serial=?').get(sourceSerial);
  if (!src || !src.sync_group) return 0;
  const targets = db.prepare("SELECT serial FROM push_devices WHERE sync_group=? AND serial<>? AND active=1")
    .all(src.sync_group, sourceSerial);
  if (!targets.length) return 0;
  let n = 0;
  for (const t of targets) {
    for (const pin of pins) {
      queueCmd(t.serial, buildUserCommand(pin));
      const u = db.prepare('SELECT name,card FROM device_users WHERE pin=?').get(pin) || {};
      upsertDeviceUserSerial(t.serial, pin, u.name, u.card);
      const tmps = db.prepare('SELECT * FROM device_bio_templates WHERE serial=? AND pin=?').all(sourceSerial, pin);
      for (const tp of tmps) { queueCmd(t.serial, buildBioCommand(tp)); mirrorTemplateTo(t.serial, tp); n++; }
    }
  }
  return n;
}

// Khi 1 máy kết nối: kéo template hiện có của nó về (DATA QUERY) + đẩy những gì nhóm đã có mà máy này thiếu.
export function syncFillDevice(serial) {
  const dev = db.prepare('SELECT sync_group FROM push_devices WHERE serial=?').get(serial);
  if (!dev || !dev.sync_group) return;
  // 1) kéo template hiện có trên máy này về server (học dữ liệu sẵn có)
  queueCmd(serial, 'DATA QUERY FINGERTMP');
  queueCmd(serial, 'DATA QUERY BIODATA');
  // 2) đẩy template của nhóm mà máy này CHƯA có
  const mine = new Set(db.prepare("SELECT pin||'|'||bio_type||'|'||idx k FROM device_bio_templates WHERE serial=?").all(serial).map((r) => r.k));
  const groupSerials = db.prepare("SELECT serial FROM push_devices WHERE sync_group=? AND serial<>?").all(dev.sync_group, serial).map((r) => r.serial);
  if (!groupSerials.length) return;
  const ph = groupSerials.map(() => '?').join(',');
  const others = db.prepare(`SELECT * FROM device_bio_templates WHERE serial IN (${ph})`).all(...groupSerials);
  const pushedPins = new Set();
  for (const t of others) {
    const key = `${t.pin}|${t.bio_type}|${t.idx}`;
    if (mine.has(key)) continue;
    if (!pushedPins.has(t.pin)) {
      queueCmd(serial, buildUserCommand(t.pin));
      const u = db.prepare('SELECT name,card FROM device_users WHERE pin=?').get(t.pin) || {};
      upsertDeviceUserSerial(serial, t.pin, u.name, u.card);
      pushedPins.add(t.pin);
    }
    queueCmd(serial, buildBioCommand(t));
    mirrorTemplateTo(serial, t);
  }
}

// Đồng bộ NGAY (bấm nút): mỗi máy trong nhóm (>=2 máy) học template sẵn có + nhận template nhóm còn thiếu.
// Không cần khởi động lại máy. Trả số nhóm/máy/lệnh đã xếp.
export function resyncNow() {
  const rows = db.prepare("SELECT serial, sync_group FROM push_devices WHERE sync_group<>'' AND active=1").all();
  const groups = new Set();
  let devices = 0;
  const before = db.prepare('SELECT COUNT(*) c FROM push_device_commands WHERE trans_time IS NULL').get().c;
  for (const r of rows) {
    const cnt = db.prepare("SELECT COUNT(*) c FROM push_devices WHERE sync_group=? AND active=1").get(r.sync_group).c;
    if (cnt < 2) continue;              // nhóm chỉ 1 máy thì không cần đồng bộ
    groups.add(r.sync_group);
    syncFillDevice(r.serial);
    devices++;
  }
  const queued = db.prepare('SELECT COUNT(*) c FROM push_device_commands WHERE trans_time IS NULL').get().c - before;
  return { groups: groups.size, devices, queued };
}

// /getrequest: lấy lệnh kế tiếp cho máy (đánh dấu đã gửi). Trả 'C:<id>:<content>' hoặc ''.
export function nextCommand(serial) {
  const cmd = db.prepare('SELECT id,content FROM push_device_commands WHERE serial=? AND trans_time IS NULL ORDER BY id LIMIT 1').get(serial);
  if (!cmd) return '';
  db.prepare("UPDATE push_device_commands SET trans_time=datetime('now') WHERE id=?").run(cmd.id);
  return `C:${cmd.id}:${cmd.content}`;
}

// /devicecmd: máy báo kết quả thực hiện lệnh
export function ackCommand(id, ret) {
  db.prepare("UPDATE push_device_commands SET return_value=?, response_at=datetime('now') WHERE id=?").run(String(ret), id);
}

// Tính chỉ số công cho 1 ngày (giống computeManual ở admin.js).
// presetShift: nếu truyền (kể cả null) thì dùng luôn, không tự dò lại ca (dùng khi tách nhiều ca/ngày).
function metrics(employeeId, workDate, inIso, outIso, presetShift) {
  const weekend = getSetting('weekend_days', '7');
  const roundingDecimals = parseInt(getSetting('workunit_rounding', '2'), 10) || 2;
  const isHol = (d) => !!db.prepare('SELECT 1 FROM public_holidays WHERE holiday_date=?').get(d);
  const hourly = getSetting('attendance_mode', 'shift') === 'hourly';
  const shift = presetShift !== undefined ? presetShift
    : (hourly ? null : resolveEffectiveShift(employeeId, workDate, inIso || `${workDate}T00:00:00Z`, outIso || null).shift);
  const roundingMode = parseInt(getSetting('workunit_rounding_mode', '0'), 10) || 0;
  const flags = { isHoliday: isHol(workDate), isWeekend: isWeekendDay(workDate, weekend), roundingDecimals, roundingMode };
  const otType = flags.isHoliday ? 'le' : flags.isWeekend ? 'cuoi_tuan' : 'thuong';
  const late = (!hourly && shift && inIso) ? computeLate(shift, inIso, workDate) : 0;
  let c;
  if (inIso && outIso) {
    if (shift && !hourly) c = computeCheckout(shift, inIso, outIso, workDate, flags);
    else { const wm = Math.max(0, Math.round((new Date(outIso) - new Date(inIso)) / 60000)); c = { early_min: 0, ot_min: 0, work_minutes: wm, work_unit: wm > 0 ? 1 : 0, ot_type: otType, day_status: 'lam_viec' }; }
  } else {
    c = { early_min: 0, ot_min: 0, work_minutes: 0, work_unit: 0, ot_type: otType, day_status: inIso ? 'thieu_ra' : 'vang' };
  }
  return { shiftId: shift?.id ?? null, late, ...c };
}

// Map serial → số máy (IDM: máy lẻ VÀO / chẵn RA)
function deviceMachineMap() {
  const map = {};
  for (const d of db.prepare('SELECT serial, machine_number FROM push_devices').all()) map[d.serial] = d.machine_number || 0;
  return map;
}

// Ghi 1 dòng công (insert mới hoặc update dòng có sẵn theo existingId)
function upsertRow(employeeId, workDate, shiftId, inIso, outIso, m, existingId) {
  if (existingId) {
    db.prepare(`UPDATE attendance SET check_in_at=?, check_out_at=?, late_min=?, early_min=?, ot_min=?,
      work_minutes=?, work_unit=?, day_status=?, ot_type=?, shift_id=?, shift_source='device' WHERE id=?`)
      .run(inIso, outIso, m.late, m.early_min, m.ot_min, m.work_minutes, m.work_unit, m.day_status, m.ot_type, shiftId, existingId);
  } else {
    db.prepare(`INSERT INTO attendance
      (employee_id, work_date, check_in_at, check_out_at, late_min, early_min, ot_min, work_minutes, work_unit, day_status, ot_type, shift_id, shift_source)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'device')`)
      .run(employeeId, workDate, inIso, outIso, m.late, m.early_min, m.ot_min, m.work_minutes, m.work_unit, m.day_status, m.ot_type, shiftId);
  }
}

// Dựng lại 1 ngày công của 1 NV từ các punch của máy (KHÔNG đè bản ghi admin sửa tay).
// Nếu gán LỊCH TRÌNH nhiều ca → tách punch theo cửa sổ từng ca thành nhiều dòng công/ngày.
export function rebuildDay(employeeId, workDate) {
  const prov = db.prepare('SELECT punch_at, serial FROM device_punches WHERE employee_id=? AND work_date=? ORDER BY punch_at').all(employeeId, workDate);
  if (!prov.length) return;
  const hourly = getSetting('attendance_mode', 'shift') === 'hourly';
  const machineMap = deviceMachineMap();
  const punchesInWin = (winStart, winEnd) => db.prepare('SELECT punch_at, serial FROM device_punches WHERE employee_id=? AND punch_at>=? AND punch_at<=? ORDER BY punch_at')
    .all(employeeId, winStart.toISOString(), winEnd.toISOString());

  const plan = hourly ? { off: false, shifts: [], mergeRule: null, isSchedule: false } : resolveDayShifts(employeeId, workDate);
  if (plan.off) return; // ngày nghỉ → không dựng

  // NHIỀU ca/ngày (lịch trình ≥ 2 ca): tách punch theo cửa sổ từng ca → mỗi ca 1 dòng
  if (plan.isSchedule && plan.shifts.length > 1) {
    db.prepare("DELETE FROM attendance WHERE employee_id=? AND work_date=? AND (manual IS NULL OR manual=0)").run(employeeId, workDate);
    for (const shift of plan.shifts) {
      const { winStart, winEnd } = ruleWindow(workDate, shift);
      const punches = punchesInWin(winStart, winEnd);
      if (!punches.length) continue;
      // Tách nhiều ca cần cửa sổ giờ để không lẫn punch giữa các ca → ưu tiên TĐ-HC khi có cửa sổ
      const rule = (shift.check_in_start && shift.check_out_start) ? 'tdhc' : (plan.mergeRule || shift.merge_rule || 'filo');
      const { inIso, outIso } = mergeDayPunches(punches, shift, rule, machineMap, workDate);
      if (!inIso) continue;
      if (db.prepare('SELECT 1 FROM attendance WHERE employee_id=? AND work_date=? AND shift_id=? AND manual=1').get(employeeId, workDate, shift.id)) continue;
      upsertRow(employeeId, workDate, shift.id, inIso, outIso, metrics(employeeId, workDate, inIso, outIso, shift));
    }
    return;
  }

  // 1 ca/ngày (gán ca / ca mặc định / tự dò): giữ 1 dòng/ngày
  let shift = plan.shifts[0] || null;
  let mergeRule = plan.mergeRule;
  if (!shift && !hourly) { const eff = resolveEffectiveShift(employeeId, workDate, prov[0].punch_at, prov[prov.length - 1].punch_at); shift = eff.shift; mergeRule = eff.mergeRule; }
  let inIso, outIso;
  if (shift) {
    const { winStart, winEnd } = ruleWindow(workDate, shift);
    let punches = punchesInWin(winStart, winEnd);
    if (!punches.length) punches = prov;
    ({ inIso, outIso } = mergeDayPunches(punches, shift, mergeRule, machineMap, workDate));
    if (!inIso) {
      // Ca đêm: punch lẻ (thường là giờ RA sáng hôm sau) thuộc ca đêm NGÀY TRƯỚC → không tạo dòng rác ở ngày này
      const night = shift.cross_midnight || shift.end_time <= shift.start_time;
      if (night) return;
      inIso = prov[0].punch_at; outIso = prov.length > 1 ? prov[prov.length - 1].punch_at : null;
    }
  } else {
    inIso = prov[0].punch_at;
    outIso = prov.length > 1 ? prov[prov.length - 1].punch_at : null;
  }
  const existing = db.prepare('SELECT id, manual FROM attendance WHERE employee_id=? AND work_date=?').get(employeeId, workDate);
  if (existing && existing.manual) return; // tôn trọng sửa tay của admin
  upsertRow(employeeId, workDate, shift?.id ?? null, inIso, outIso, metrics(employeeId, workDate, inIso, outIso, shift), existing?.id);
}

// Nạp khối ATTLOG (nhiều dòng), mỗi dòng: PIN \t Time \t Status \t Verify \t WorkCode
// Trả số dòng hợp lệ đã nhận.
export function ingestAttlog(serial, rawBody) {
  const lines = String(rawBody || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const touched = new Set();
  let n = 0;
  const ins = db.prepare('INSERT OR IGNORE INTO device_punches(serial,pin,punch_at,work_date,status,verify,employee_id) VALUES(?,?,?,?,?,?,?)');
  for (const line of lines) {
    const p = line.split('\t');
    if (p.length < 2) continue;
    const pin = (p[0] || '').trim();
    const timeStr = (p[1] || '').trim();          // 'yyyy-MM-dd HH:mm:ss'
    if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(timeStr)) continue;
    const status = parseInt(p[2] || '0', 10) || 0;
    const verify = parseInt(p[3] || '0', 10) || 0;
    const d = new Date(timeStr.replace(' ', 'T') + '+07:00');   // giờ máy = giờ VN
    if (isNaN(d)) continue;
    const punchIso = d.toISOString();
    const workDate = timeStr.slice(0, 10);
    const emp = findEmpByPin(pin);
    const empId = emp?.id ?? null;
    try { ins.run(serial, pin, punchIso, workDate, status, verify, empId); } catch {}
    n++;
    if (empId) touched.add(empId + '|' + workDate);
  }
  // Dựng lại ngày có punch + NGÀY HÔM TRƯỚC (punch sáng sớm có thể là giờ RA của ca đêm hôm trước)
  const toRebuild = new Set();
  for (const key of touched) {
    const [eid, date] = key.split('|');
    toRebuild.add(key);
    const prev = new Date(date + 'T12:00:00Z'); prev.setUTCDate(prev.getUTCDate() - 1);
    toRebuild.add(eid + '|' + prev.toISOString().slice(0, 10));
  }
  for (const key of toRebuild) { const [eid, date] = key.split('|'); rebuildDay(+eid, date); }
  return n;
}

/* ============================ NHẬP TỪ USB ============================ */
// Tìm NV theo Số ID máy hoặc mã; tự tạo (force) nếu chưa có.
function ensureEmpByPin(pin) {
  const e = db.prepare("SELECT id FROM employees WHERE device_pin=? AND device_pin!='' AND active=1").get(pin)
    || db.prepare('SELECT id FROM employees WHERE code=? AND active=1').get(pin);
  if (e) return { id: e.id, created: false };
  const before = db.prepare('SELECT COUNT(*) c FROM employees').get().c;
  const id = upsertEmployeeFromDevice(pin, '', true);
  const created = id && db.prepare('SELECT COUNT(*) c FROM employees').get().c > before;
  return { id, created: !!created };
}

// Nhập file chấm công từ USB (*_attlog.dat / .txt): mỗi dòng "PIN ... yyyy-MM-dd HH:mm:ss ..."
// Tách PIN = token đầu, thời gian = regex; tự tạo NV cho PIN chưa có → tạo punch → dựng lại ngày công.
export function importUsbAttlog(rawBody) {
  const lines = String(rawBody || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const touched = new Set();
  let n = 0; const newEmps = new Set();
  const ins = db.prepare('INSERT OR IGNORE INTO device_punches(serial,pin,punch_at,work_date,status,verify,employee_id) VALUES(?,?,?,?,?,?,?)');
  for (const line of lines) {
    const pin = (line.split(/\s+/)[0] || '').trim();
    if (!/^\d{1,20}$/.test(pin)) continue;
    const m = line.match(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?/);
    if (!m) continue;
    const timeStr = m[0].replace('T', ' ');
    const d = new Date(timeStr.replace(' ', 'T') + '+07:00'); if (isNaN(d)) continue;
    const workDate = timeStr.slice(0, 10);
    const { id: empId, created } = ensureEmpByPin(pin);
    if (created) newEmps.add(pin);
    try { ins.run('USB', pin, d.toISOString(), workDate, 0, 0, empId); } catch {}
    n++;
    if (empId) touched.add(empId + '|' + workDate);
  }
  const toRebuild = new Set();
  for (const key of touched) {
    const [eid, date] = key.split('|'); toRebuild.add(key);
    const prev = new Date(date + 'T12:00:00Z'); prev.setUTCDate(prev.getUTCDate() - 1);
    toRebuild.add(eid + '|' + prev.toISOString().slice(0, 10));
  }
  for (const key of toRebuild) { const [eid, date] = key.split('|'); rebuildDay(+eid, date); }
  return { punches: n, newEmps: newEmps.size };
}

// Nhập danh sách nhân viên từ USB (user.txt / .csv): mỗi dòng "PIN[TAB/,/;]Tên".
export function importUsbUsers(rawBody) {
  const lines = String(rawBody || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let total = 0, created = 0;
  for (const line of lines) {
    if (/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(line)) continue; // bỏ dòng chấm công
    const parts = line.split(/\t|,|;| {2,}/).map((s) => s.trim()).filter(Boolean);
    const pin = (parts[0] || '').replace(/^PIN[:=]?/i, '').trim();
    if (!/^\d{1,20}$/.test(pin)) continue;
    const name = (parts[1] || '').replace(/^Name[:=]?/i, '').trim();
    const before = db.prepare('SELECT COUNT(*) c FROM employees').get().c;
    const id = upsertEmployeeFromDevice(pin, name, true);
    if (id) { total++; if (db.prepare('SELECT COUNT(*) c FROM employees').get().c > before) created++; }
  }
  return { total, created };
}
