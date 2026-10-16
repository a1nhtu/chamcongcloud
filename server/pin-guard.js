// CẢNH BÁO TRÙNG SỐ ID giữa các máy chấm công (công tắc device_pin_guard, mặc định BẬT — Anh chốt 16/10/2026)
// + ĐẨY TÊN NV từ phần mềm xuống máy (công tắc device_push_names, mặc định BẬT).
//
// Số ID (PIN) là toàn cục: ID 1 ở mọi máy = 1 người. Máy B lỡ đăng ký người khác vào Số ID đang có chủ thì
// lượt quẹt dồn nhầm + vân tay người lạ bị đồng bộ đè sang máy khác. Khi bật công tắc:
//   1) guardIncoming: máy vừa gửi dữ liệu NV/vân tay lên → kiểm TRƯỚC khi lưu; nghi trùng thì ghi 1 dòng
//      device_pin_conflicts (status 'open') + 1 quy tắc device_pin_remaps (lượt quẹt Số ID đó ở máy đó → số tạm "pin#id").
//   2) Trong lúc chờ xử lý (heldSet): Số ID đó không đồng bộ từ/xuống máy B, tên/thẻ/ảnh máy B gửi không ghi đè dữ liệu chung,
//      lượt quẹt ở máy B mang số tạm → không gắn vào NV nào.
//   3) Admin chọn: resolveSame (cùng 1 người) / resolveOther (người khác → cấp Số ID mới, giữ nguyên sinh trắc,
//      chuyển lượt quẹt; máy xác nhận tạo số mới OK mới xoá số cũ — onUserAck).
import { db, getSetting } from './db.js';
import {
  queueCmd, buildUserCommand, buildBioCommand, buildPhotoCommand, createDraftEmployee, upsertEmployeeFromDevice,
  relinkPunchesForPin, rebuildDays, syncPinsToGroup, syncFillDevice,
} from './device-sync.js';

export const guardOn = () => getSetting('device_pin_guard', '1') === '1';
const HOLD = "('open','moving','failed')";
export const holdPin = (pin, id) => `${pin}#${id}`;
const err = (m) => Object.assign(new Error(m), { status: 400 });

/* ---------------- so tên ---------------- */
export const normName = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd')
  .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
// Tên rỗng / "NV 5" / chính Số ID → coi như máy không gửi tên
const placeholder = (name, pin) => { const n = normName(name); return !n || n === normName(`NV ${pin}`) || n === normName(pin); };
// Hai tên chắc chắn KHÁC người? So bỏ dấu; tên gọi (chữ cuối) của bên này có trong bên kia → coi là cùng người
// ("Nguyen V An" = "Nguyễn Văn An", "Huong KT" = "Trần Thị Hương"). Thiếu 1 bên → không đủ căn cứ.
export function namesDiffer(a, b) {
  const na = normName(a), nb = normName(b);
  if (!na || !nb || na === nb || na.includes(nb) || nb.includes(na)) return false;
  const ta = na.split(' '), tb = nb.split(' ');
  return !(tb.includes(ta[ta.length - 1]) || ta.includes(tb[tb.length - 1]));
}

/* ---------------- dải Số ID theo máy ---------------- */
export function parseRange(s) {
  const m = /^\s*(\d{1,9})\s*-\s*(\d{1,9})\s*$/.exec(String(s || ''));
  if (!m) return null;
  const a = +m[1], b = +m[2];
  return a <= b ? [a, b] : null;
}
const outOfRange = (pin, range) => { const r = parseRange(range); return !!r && /^\d+$/.test(pin) && (+pin < r[0] || +pin > r[1]); };

/* ---------------- trạng thái giữ ---------------- */
// Các cặp "serial|pin" đang chờ xử lý → không đồng bộ, không ghi đè, lượt quẹt bị giữ
export function heldSet() {
  return new Set(db.prepare(`SELECT serial, pin FROM device_pin_conflicts WHERE status IN ${HOLD}`).all().map((r) => r.serial + '|' + r.pin));
}
const openConflict = (serial, pin) => db.prepare(`SELECT id FROM device_pin_conflicts WHERE serial=? AND pin=? AND status IN ${HOLD} ORDER BY id DESC LIMIT 1`).get(serial, pin);

// Đổi Số ID lượt quẹt theo quy tắc (giữ lại / chuyển sang Số ID mới). null = máy này không có quy tắc nào.
export function remapLoader(serial) {
  const rules = db.prepare('SELECT pin, from_at, to_at, new_pin FROM device_pin_remaps WHERE serial=?').all(serial);
  if (!rules.length) return null;
  return (pin, iso) => {
    for (const r of rules) if (r.pin === pin && iso >= r.from_at && (!r.to_at || iso < r.to_at)) return r.new_pin;
    return pin;
  };
}

/* ---------------- phát hiện ---------------- */
const kvOf = (line) => {
  const kv = {};
  for (const part of String(line).split('\t')) { const eq = part.indexOf('='); if (eq > 0) kv[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim(); }
  return kv;
};
const ENROLL_OPS = new Set([6, 7, 8, 29, 30, 34]);   // đăng ký vân tay / mật khẩu / thẻ / người dùng mới / đổi vân tay / khuôn mặt
// Đọc khối dữ liệu máy gửi: thông tin từng Số ID + các Số ID vừa được ĐĂNG KÝ trên máy (dòng OPLOG)
function parseBody(table, body) {
  const info = new Map(), enrolled = new Map();   // enrolled: Số ID → giờ đăng ký (ISO, theo đồng hồ MÁY)
  const T = String(table || '').toUpperCase();
  const get = (pin) => { if (!info.has(pin)) info.set(pin, {}); return info.get(pin); };
  for (let line of String(body || '').split('\n').map((l) => l.trim()).filter(Boolean)) {
    const m = line.match(/^(USERINFO|USER|FP|FINGERTMP|BIODATA|FACE|USERPIC|BIOPHOTO|OPLOG)\b\s*/i);
    let kind = m ? m[1].toUpperCase() : (/USER/.test(T) ? 'USER' : /FINGERTMP|^FP$|BIODATA/.test(T) ? 'FP' : /BIOPHOTO|USERPIC/.test(T) ? T : '');
    if (m) line = line.slice(m[0].length);
    if (kind === 'OPLOG') {
      const parts = line.split('\t').map((s) => s.trim()).filter((s) => s !== '');
      const ti = parts.findIndex((p) => /^\d{4}[-/]\d\d[-/]\d\d[ T]\d\d:\d\d/.test(p));
      const others = parts.filter((_, i) => i !== ti);
      const op = parseInt(others[0], 10), who = (others[2] || '').trim();
      if (ENROLL_OPS.has(op) && who && who !== '0' && !who.includes(' ') && who.length <= 20) {
        const t = ti >= 0 ? new Date(parts[ti].replace(/\//g, '-').replace(' ', 'T') + '+07:00') : null;
        const iso = t && !isNaN(t) ? t.toISOString() : '';
        if (!enrolled.has(who) || (iso && (!enrolled.get(who) || iso < enrolled.get(who)))) enrolled.set(who, iso);
      }
      continue;
    }
    const kv = kvOf(line);
    const pin = (kv.pin || '').trim();
    if (!pin || pin.includes(' ') || pin.length > 20) continue;
    const it = get(pin);
    if (kind === 'USER' || kind === 'USERINFO') {
      const name = kv.name || '';
      if (name && !name.includes('=') && name.length <= 80) it.name = name;
      if (kv.card && kv.card !== '0') it.card = kv.card;
      if (kv.passwd && kv.passwd !== '0') it.passwd = kv.passwd;
      if (kv.pri !== undefined) it.pri = parseInt(kv.pri, 10) || 0;
    } else if (kind === 'USERPIC' || kind === 'BIOPHOTO') {
      const content = (kv.content || '').trim();
      if (content.length >= 100) it.photo = { kind: kind === 'BIOPHOTO' ? 'face' : 'user', faceType: kind === 'BIOPHOTO' ? (parseInt(kv.type || '9', 10) || 9) : 0, content };
    } else it.tmpl = true;
  }
  return { info, enrolled };
}

// Ghi thông tin máy B gửi (tên/thẻ/mật mã/quyền/ảnh) vào dòng cảnh báo — KHÔNG ghi vào dữ liệu chung của Số ID
function captureInto(id, it) {
  if (it.name) db.prepare('UPDATE device_pin_conflicts SET dev_name=? WHERE id=?').run(it.name, id);
  if (it.card) db.prepare('UPDATE device_pin_conflicts SET dev_card=? WHERE id=?').run(it.card, id);
  if (it.passwd) db.prepare('UPDATE device_pin_conflicts SET dev_passwd=? WHERE id=?').run(it.passwd, id);
  if (it.pri != null) db.prepare('UPDATE device_pin_conflicts SET dev_pri=? WHERE id=?').run(it.pri > 0 ? it.pri : 0, id);
  if (it.photo) db.prepare('UPDATE device_pin_conflicts SET dev_photo=?, dev_photo_kind=?, dev_face_type=? WHERE id=?').run(it.photo.content, it.photo.kind, it.photo.faceType, id);
}

// Có nghi trùng không? → { reason, refName } | null
function detect(dev, pin, it, enrolledNow, realtime) {
  const serial = dev.serial;
  const prior = db.prepare('SELECT name FROM device_users_serial WHERE serial=? AND pin=?').get(serial, pin);
  // máy này đã NHẬN Số ID này từ phần mềm (đồng bộ) và xác nhận OK → không phải tự đăng ký
  const syncedIn = !!db.prepare("SELECT 1 FROM push_device_commands WHERE serial=? AND pin=? AND mkind='user' AND TRIM(return_value)='0' LIMIT 1").get(serial, pin);
  const accepted = db.prepare("SELECT dev_name FROM device_pin_conflicts WHERE serial=? AND pin=? AND status='same' ORDER BY id DESC LIMIT 1").get(serial, pin);
  const emp = db.prepare("SELECT full_name FROM employees WHERE device_pin=? AND device_pin<>''").get(pin);
  const others = db.prepare(`SELECT s.name FROM device_users_serial s JOIN push_devices d ON d.serial=s.serial
    WHERE s.pin=? AND s.serial<>? AND d.active=1`).all(pin, serial);
  // Máy khác đã có SINH TRẮC của Số ID này (chỉ có tên do phần mềm đẩy xuống thì không tính — đó là quy trình
  // "khai trên phần mềm → đẩy xuống máy → đăng ký vân tay tại 1 máy", không phải trùng)
  const othersBio = db.prepare(`SELECT COUNT(*) c FROM device_bio_templates b JOIN push_devices d ON d.serial=b.serial
    WHERE b.pin=? AND b.serial<>? AND d.active=1`).get(pin, serial).c;
  const refName = (emp && !placeholder(emp.full_name, pin)) ? emp.full_name
    : (others.map((o) => o.name).find((n) => !placeholder(n, pin)) || '');
  const incName = placeholder(it.name, pin) ? '' : it.name;
  const isNewHere = !prior || enrolledNow;
  // 1) Máy này vừa TỰ đăng ký Số ID mà máy khác đang giữ sinh trắc (tên trùng khớp thì bỏ qua)
  if (realtime && isNewHere && !syncedIn && !accepted && othersBio > 0
      && !(incName && refName && !namesDiffer(incName, refName))) return { reason: 'enroll', refName };
  // 2) Tên máy gửi khác hẳn tên đang dùng Số ID này (đã thấy đúng tên này trước đó / đã xác nhận cùng người → bỏ qua)
  if (incName && refName && namesDiffer(incName, refName)
      && !(prior && normName(prior.name) === normName(incName))
      && !(accepted && normName(accepted.dev_name) === normName(incName))) return { reason: 'name', refName };
  // 3) Số ID nằm ngoài dải đã khai cho máy này
  if (realtime && isNewHere && !syncedIn && !accepted && dev.pin_range && outOfRange(pin, dev.pin_range)) return { reason: 'range', refName };
  return null;
}

// Gọi TRƯỚC khi lưu dữ liệu NV/vân tay/ảnh máy gửi lên. realtime: dữ liệu đăng ký/sửa ngay trên máy (OPERLOG sau lần
// tải đầu) — khác với lúc máy gửi lại cả danh sách (tải NV từ máy, đọc lại thông tin, lần kết nối đầu).
export function guardIncoming(serial, table, body, opts = {}) {
  if (!guardOn() || !serial) return 0;
  const dev = db.prepare('SELECT serial, oper_stamp, pin_range FROM push_devices WHERE serial=?').get(serial);
  if (!dev) return 0;
  const realtime = opts.realtime != null ? !!opts.realtime
    : String(table || '').toUpperCase() === 'OPERLOG' && !['', '0'].includes(String(dev.oper_stamp || '').trim());
  const { info, enrolled } = parseBody(table, body);
  for (const pin of enrolled.keys()) if (!info.has(pin)) info.set(pin, {});
  let n = 0;
  for (const [pin, it] of info) {
    const open = openConflict(serial, pin);
    if (open) { captureInto(open.id, it); continue; }
    const r = detect(dev, pin, it, enrolled.has(pin), realtime);
    if (!r) continue;
    // Mốc giữ lượt quẹt: giờ đăng ký ghi trên MÁY (cùng đồng hồ với lượt quẹt máy gửi), không có thì giờ máy chủ
    const nowIso = new Date().toISOString(), devIso = enrolled.get(pin) || '';
    const now = devIso && devIso < nowIso ? devIso : nowIso;
    const id = Number(db.prepare('INSERT INTO device_pin_conflicts(serial,pin,reason,ref_name,since) VALUES(?,?,?,?,?)')
      .run(serial, pin, r.reason, r.refName || '', now).lastInsertRowid);
    db.prepare('INSERT INTO device_pin_remaps(serial,pin,from_at,to_at,new_pin,conflict_id) VALUES(?,?,?,NULL,?,?)').run(serial, pin, now, holdPin(pin, id), id);
    captureInto(id, it);
    // bỏ lệnh đồng bộ đang chờ của Số ID này xuống máy này (khỏi ghi đè người vừa đăng ký)
    db.prepare("DELETE FROM push_device_commands WHERE serial=? AND pin=? AND trans_time IS NULL AND mkind IN ('user','bio','photo')").run(serial, pin);
    n++;
  }
  return n;
}

/* ---------------- danh sách cho giao diện ---------------- */
const usedPins = () => {
  const used = new Set();
  for (const q of ["SELECT device_pin p FROM employees WHERE device_pin IS NOT NULL AND device_pin<>''", 'SELECT code p FROM employees',
    'SELECT pin p FROM device_users', 'SELECT pin p FROM device_users_serial', 'SELECT DISTINCT pin p FROM device_bio_templates',
    "SELECT new_pin p FROM device_pin_conflicts WHERE new_pin<>''"]) for (const r of db.prepare(q).all()) used.add(String(r.p ?? '').trim());
  return used;
};
// Gợi ý Số ID còn trống: trong dải của máy (nếu có), không thì số lớn nhất đang dùng + 1
export function suggestPin(serial) {
  const used = usedPins();
  const dev = db.prepare('SELECT pin_range FROM push_devices WHERE serial=?').get(serial);
  const rg = parseRange(dev && dev.pin_range);
  if (rg) { for (let n = rg[0]; n <= rg[1]; n++) if (!used.has(String(n))) return String(n); return ''; }
  // số lớn nhất theo Số ID máy (không tính mã NV dạng số) + 1, bỏ qua số đã bị dùng ở bất kỳ đâu
  let max = 0;
  for (const q of ["SELECT device_pin p FROM employees WHERE device_pin IS NOT NULL AND device_pin<>''", 'SELECT pin p FROM device_users', 'SELECT pin p FROM device_users_serial'])
    for (const r of db.prepare(q).all()) { const p = String(r.p ?? '').trim(); if (/^\d{1,9}$/.test(p)) max = Math.max(max, +p); }
  let n = max + 1;
  while (used.has(String(n))) n++;
  return String(n);
}

export function countConflicts() { return db.prepare(`SELECT COUNT(*) c FROM device_pin_conflicts WHERE status IN ${HOLD}`).get().c; }

export function listConflicts() {
  const rows = db.prepare(`SELECT c.*, COALESCE(NULLIF(d.name,''), c.serial) AS dev_label, d.conn_type
    FROM device_pin_conflicts c LEFT JOIN push_devices d ON d.serial=c.serial WHERE c.status IN ${HOLD} ORDER BY c.id`).all();
  const fp = db.prepare('SELECT COUNT(DISTINCT idx) c FROM device_bio_templates WHERE serial=? AND pin=? AND bio_type=1');
  const face = db.prepare('SELECT COUNT(DISTINCT idx) c FROM device_bio_templates WHERE serial=? AND pin=? AND bio_type IN (2,9)');
  return rows.map((c) => {
    const devPin = c.status === 'open' ? c.pin : (c.new_pin || c.pin);
    const emp = db.prepare("SELECT id, code, full_name, department, active FROM employees WHERE device_pin=? AND device_pin<>''").get(c.pin);
    const others = db.prepare(`SELECT s.serial, COALESCE(NULLIF(d.name,''), s.serial) AS n FROM device_users_serial s LEFT JOIN push_devices d ON d.serial=s.serial
      WHERE s.pin=? AND s.serial<>?`).all(c.pin, c.serial);
    const refFp = db.prepare('SELECT COUNT(DISTINCT idx) c FROM device_bio_templates WHERE pin=? AND serial<>? AND bio_type=1').get(c.pin, c.serial).c;
    const refCard = !!(db.prepare('SELECT card FROM device_users WHERE pin=?').get(c.pin)?.card);
    const last = emp ? db.prepare(`SELECT p.punch_at, COALESCE(NULLIF(d.name,''), p.serial) AS dev FROM device_punches p LEFT JOIN push_devices d ON d.serial=p.serial
      WHERE p.employee_id=? ORDER BY p.punch_at DESC LIMIT 1`).get(emp.id) : null;
    const held = db.prepare('SELECT COUNT(*) c FROM device_punches WHERE serial=? AND pin=?').get(c.serial, holdPin(c.pin, c.id)).c;
    return {
      id: c.id, serial: c.serial, dev_label: c.dev_label, tcp: c.conn_type === 'tcp', pin: c.pin, reason: c.reason, status: c.status, note: c.note,
      since: c.since, new_pin: c.new_pin,
      ref: { name: emp ? emp.full_name : c.ref_name, emp_id: emp ? emp.id : null, code: emp ? emp.code : '', department: emp ? emp.department : '',
        devices: others.map((o) => o.n), fp: refFp, card: refCard, last_at: last ? last.punch_at : null, last_dev: last ? last.dev : '',
        photo: (() => { const ph = db.prepare('SELECT photo FROM device_user_photos WHERE pin=?').get(c.pin); return ph && ph.photo ? 'data:image/jpeg;base64,' + ph.photo : ''; })() },
      dev: { name: c.dev_name, fp: fp.get(c.serial, devPin).c, face: face.get(c.serial, devPin).c, card: !!c.dev_card, passwd: !!c.dev_passwd,
        photo: c.dev_photo ? 'data:image/jpeg;base64,' + c.dev_photo : '', held },
      suggest_pin: c.status === 'open' ? suggestPin(c.serial) : '',
    };
  });
}

/* ---------------- xử lý ---------------- */
const getConflict = (id) => db.prepare('SELECT * FROM device_pin_conflicts WHERE id=?').get(id);

// CÙNG 1 NGƯỜI: bỏ giữ, lượt quẹt đang giữ tính cho NV đang dùng Số ID, đồng bộ lại bình thường
export function resolveSame(id, by = '') {
  const c = getConflict(id);
  if (!c || c.status !== 'open') throw err('Cảnh báo này đã được xử lý hoặc đang xử lý.');
  const hold = holdPin(c.pin, c.id);
  db.exec('SAVEPOINT pg_same');
  try {
    db.prepare('DELETE FROM device_pin_remaps WHERE conflict_id=?').run(c.id);
    db.prepare('UPDATE OR IGNORE device_punches SET pin=? WHERE serial=? AND pin=?').run(c.pin, c.serial, hold);
    db.prepare('DELETE FROM device_punches WHERE serial=? AND pin=?').run(c.serial, hold);   // trùng giờ với lượt đã có
    // thông tin máy gửi: chỉ bổ sung chỗ dữ liệu chung còn trống
    const u = db.prepare('SELECT * FROM device_users WHERE pin=?').get(c.pin);
    if (!u) db.prepare('INSERT INTO device_users(pin,name,card,passwd,privilege) VALUES(?,?,?,?,0)').run(c.pin, c.dev_name || '', c.dev_card || '', c.dev_passwd || '');
    else db.prepare(`UPDATE device_users SET name=CASE WHEN name='' THEN ? ELSE name END, card=CASE WHEN card='' THEN ? ELSE card END,
      passwd=CASE WHEN passwd='' THEN ? ELSE passwd END WHERE pin=?`).run(c.dev_name || '', c.dev_card || '', c.dev_passwd || '', c.pin);
    if (c.dev_photo) db.prepare('INSERT OR IGNORE INTO device_user_photos(pin,kind,face_type,photo) VALUES(?,?,?,?)').run(c.pin, c.dev_photo_kind || 'user', c.dev_face_type || 0, c.dev_photo);
    db.prepare("UPDATE device_pin_conflicts SET status='same', resolved_at=datetime('now'), resolved_by=?, note='Xác nhận cùng 1 người' WHERE id=?").run(by, c.id);
    db.exec('RELEASE pg_same');
  } catch (e) { db.exec('ROLLBACK TO pg_same'); db.exec('RELEASE pg_same'); throw e; }
  const empId = upsertEmployeeFromDevice(c.pin, c.dev_name || '', true);
  const relinked = empId ? relinkPunchesForPin(empId, c.pin) : 0;
  try { syncPinsToGroup(c.serial, new Set([c.pin])); syncFillDevice(c.serial); } catch (e) { console.error('[pin-guard] đồng bộ lại lỗi:', e.message); }
  return { ok: true, emp_id: empId, relinked };
}

function pinTaken(p) { return usedPins().has(p) || !!db.prepare("SELECT 1 FROM device_punches WHERE pin=? LIMIT 1").get(p); }

// Xếp lệnh tạo Số ID mới (thông tin + sinh trắc + ảnh) xuống máy của cảnh báo
function queueNewPin(c, newPin) {
  queueCmd(c.serial, buildUserCommand(newPin, c.serial, c.dev_pri > 0 ? c.dev_pri : 0), { pin: newPin, mkind: 'user' });
  for (const t of db.prepare('SELECT * FROM device_bio_templates WHERE serial=? AND pin=?').all(c.serial, newPin))
    queueCmd(c.serial, buildBioCommand(t), { pin: newPin, bio_type: t.bio_type, idx: t.idx, mkind: 'bio' });
  const pc = buildPhotoCommand(newPin); if (pc) queueCmd(c.serial, pc, { pin: newPin, mkind: 'photo' });
}

// NGƯỜI KHÁC: cấp Số ID mới cho người vừa đăng ký ở máy này — giữ nguyên vân tay/mặt/thẻ/mật mã, tạo NV nháp,
// chuyển lượt quẹt đang giữ (và cả khi tải lại log sau này). Máy xác nhận tạo số mới OK mới xoá số cũ (onUserAck).
export function resolveOther(id, newPin, by = '') {
  const c = getConflict(id);
  if (!c || c.status !== 'open') throw err('Cảnh báo này đã được xử lý hoặc đang xử lý.');
  const dev = db.prepare('SELECT conn_type FROM push_devices WHERE serial=?').get(c.serial);
  if (dev && dev.conn_type === 'tcp') throw err('Máy kết nối TCP/IP chưa tự đổi số được: đổi Số ID ngay trên máy rồi bấm "Tải nhân viên", sau đó chọn "Cùng 1 người" hoặc xoá cảnh báo.');
  newPin = String(newPin || '').trim();
  if (!/^\d{1,9}$/.test(newPin)) throw err('Số ID mới phải là số (tối đa 9 chữ số).');
  if (newPin === c.pin || pinTaken(newPin)) throw err(`Số ID ${newPin} đã có người dùng — chọn số khác.`);
  const hold = holdPin(c.pin, c.id);
  let empId, moved = 0;
  db.exec('SAVEPOINT pg_other');
  try {
    empId = createDraftEmployee(newPin, c.dev_name || '');
    db.prepare('INSERT OR REPLACE INTO device_users(pin,name,card,passwd,privilege) VALUES(?,?,?,?,0)').run(newPin, c.dev_name || '', c.dev_card || '', c.dev_passwd || '');
    // sinh trắc người mới: chuyển từ Số ID cũ sang Số ID mới (vẫn thuộc máy này)
    db.prepare(`INSERT OR REPLACE INTO device_bio_templates(serial,pin,bio_type,idx,valid,duress,major_ver,minor_ver,tmp)
      SELECT serial, ?, bio_type, idx, valid, duress, major_ver, minor_ver, tmp FROM device_bio_templates WHERE serial=? AND pin=?`).run(newPin, c.serial, c.pin);
    db.prepare('DELETE FROM device_bio_templates WHERE serial=? AND pin=?').run(c.serial, c.pin);
    db.prepare('DELETE FROM device_users_serial WHERE serial=? AND pin=?').run(c.serial, c.pin);
    if (c.dev_photo) db.prepare('INSERT OR REPLACE INTO device_user_photos(pin,kind,face_type,photo) VALUES(?,?,?,?)').run(newPin, c.dev_photo_kind || 'user', c.dev_face_type || 0, c.dev_photo);
    // lượt quẹt: Số ID cũ ở máy này từ lúc phát hiện → Số ID mới (cho tới khi máy đổi xong — onUserAck chốt mốc cuối)
    db.prepare('UPDATE device_pin_remaps SET new_pin=? WHERE conflict_id=?').run(newPin, c.id);
    moved = db.prepare('UPDATE OR IGNORE device_punches SET pin=?, employee_id=? WHERE serial=? AND pin=?').run(newPin, empId, c.serial, hold).changes;
    db.prepare("UPDATE device_pin_conflicts SET status='moving', new_pin=?, new_emp_id=?, resolved_by=?, note=? WHERE id=?")
      .run(newPin, empId, by, 'Đã gửi lệnh tạo Số ID ' + newPin + ' xuống máy — chờ máy xác nhận', c.id);
    queueNewPin(c, newPin);
    db.exec('RELEASE pg_other');
  } catch (e) { db.exec('ROLLBACK TO pg_other'); db.exec('RELEASE pg_other'); throw e; }
  const days = db.prepare('SELECT DISTINCT work_date FROM device_punches WHERE employee_id=?').all(empId).map((r) => empId + '|' + r.work_date);
  if (days.length) rebuildDays(new Set(days));
  return { ok: true, new_pin: newPin, emp_id: empId, moved };
}

// Máy báo lỗi lúc tạo Số ID mới → gửi lại
export function retryMove(id) {
  const c = getConflict(id);
  if (!c || c.status !== 'failed' || !c.new_pin) throw err('Không có gì để gửi lại.');
  db.prepare("UPDATE device_pin_conflicts SET status='moving', note=? WHERE id=?").run('Đã gửi lại lệnh tạo Số ID ' + c.new_pin + ' — chờ máy xác nhận', c.id);
  queueNewPin(c, c.new_pin);
  return { ok: true };
}

// Máy xác nhận lệnh ghi USERINFO (gọi từ ackCommand). Lệnh tạo Số ID mới OK → xoá số cũ trên máy này, trả người đang
// dùng số cũ về lại máy (nếu nhóm đồng bộ có), đẩy người mới sang các máy cùng nhóm.
export function onUserAck(serial, pin, ok) {
  const c = db.prepare("SELECT * FROM device_pin_conflicts WHERE serial=? AND new_pin=? AND status='moving'").get(serial, pin);
  if (!c) return;
  if (!ok) {
    db.prepare("UPDATE device_pin_conflicts SET status='failed', note=? WHERE id=?").run('Máy báo lỗi khi tạo Số ID ' + c.new_pin + ' — chưa xoá gì trên máy. Bấm "Gửi lại".', c.id);
    return;
  }
  // Mốc cuối: lúc máy xác nhận, nhưng không sớm hơn lượt quẹt cuối của người mới (đồng hồ máy có thể chạy nhanh)
  const lastNew = db.prepare('SELECT MAX(punch_at) m FROM device_punches WHERE serial=? AND pin=?').get(serial, c.new_pin)?.m;
  let toAt = new Date().toISOString();
  if (lastNew && lastNew >= toAt) toAt = new Date(Date.parse(lastNew) + 1000).toISOString();
  db.prepare('UPDATE device_pin_remaps SET to_at=? WHERE conflict_id=? AND to_at IS NULL').run(toAt, c.id);
  db.prepare("DELETE FROM push_device_commands WHERE serial=? AND pin=? AND trans_time IS NULL AND mkind IN ('user','bio','photo')").run(serial, c.pin);
  queueCmd(serial, `DATA DELETE USERINFO\tPIN=${c.pin}`);
  db.prepare("UPDATE device_pin_conflicts SET status='moved', resolved_at=datetime('now'), note=? WHERE id=?")
    .run(`Đã chuyển sang Số ID ${c.new_pin}; Số ID ${c.pin} trả lại cho người đang dùng`, c.id);
  try { syncFillDevice(serial); syncPinsToGroup(serial, new Set([c.new_pin])); } catch (e) { console.error('[pin-guard] đồng bộ sau đổi số lỗi:', e.message); }
}

// Xoá NV trên máy (người dùng tự xoá) → đóng các cảnh báo đang mở của Số ID đó trên máy đó
export function dropConflicts(serial, pins) {
  const now = new Date().toISOString();
  for (const p of pins || []) {
    const c = openConflict(serial, String(p).trim());
    if (!c) continue;
    db.prepare("UPDATE device_pin_conflicts SET status='dropped', resolved_at=datetime('now'), note='Đã xoá Số ID này trên máy' WHERE id=?").run(c.id);
    db.prepare('UPDATE device_pin_remaps SET to_at=? WHERE conflict_id=? AND to_at IS NULL').run(now, c.id);
  }
}

/* ---------------- ĐẨY TÊN NV TỪ PHẦN MỀM XUỐNG MÁY ---------------- */
export const pushNamesOn = () => getSetting('device_push_names', '1') === '1';
// Tên ghi xuống máy: bỏ ký tự cấm, (tuỳ chọn) bỏ dấu, tối đa 24 ký tự
export function deviceName(s) {
  let n = String(s || '').replace(/[\t\r\n=]/g, ' ').replace(/\s+/g, ' ').trim();
  if (getSetting('device_name_ascii', '1') === '1') n = n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
  return n.slice(0, 24).trim();
}
// Tên NV phần mềm cho Số ID (null = không áp: chưa bật / không có NV đang làm)
export function pmNameFor(pin, force = false) {
  if (!force && !pushNamesOn()) return null;
  const e = db.prepare("SELECT full_name FROM employees WHERE device_pin=? AND device_pin<>'' AND active=1").get(String(pin));
  return e && e.full_name ? (deviceName(e.full_name) || null) : null;
}
// Xếp lệnh ghi tên xuống các máy (ADMS, đang dùng) đang có Số ID đó. pins rỗng = mọi NV đang làm có Số ID.
export function pushNames(pins = null, force = false) {
  if (!force && !pushNamesOn()) return 0;
  const list = pins ? [...pins].map((p) => String(p).trim()).filter(Boolean)
    : db.prepare("SELECT device_pin p FROM employees WHERE active=1 AND device_pin IS NOT NULL AND device_pin<>''").all().map((r) => String(r.p).trim());
  const held = heldSet();
  const on = db.prepare(`SELECT s.serial FROM device_users_serial s JOIN push_devices d ON d.serial=s.serial
    WHERE s.pin=? AND d.active=1 AND d.conn_type<>'tcp'`);
  let n = 0;
  for (const pin of list) {
    if (!pmNameFor(pin, true)) continue;
    for (const { serial } of on.all(pin)) {
      if (held.has(serial + '|' + pin)) continue;
      queueCmd(serial, buildUserCommand(pin, serial, null, true), { pin, mkind: 'user' });
      n++;
    }
  }
  return n;
}

/* ---------------- ĐẨY NV TỪ PHẦN MỀM XUỐNG MÁY ---------------- */
// Công tắc device_auto_push_emp (mặc định BẬT): khai / sửa / nhập Excel NV có Số ID → tự đẩy Số ID + tên xuống máy.
export const autoPushOn = () => getSetting('device_auto_push_emp', '1') === '1';

// Máy nhận Số ID này khi tự đẩy: máy đang có Số ID + các máy cùng nhóm đồng bộ với chúng;
// Số ID chưa ở máy nào (NV mới) → mọi máy đang dùng có bật "Nhận NV mới từ phần mềm".
export function targetsFor(pin) {
  const act = db.prepare("SELECT serial, sync_group, recv_new FROM push_devices WHERE active=1 AND conn_type<>'tcp'").all();
  const have = new Set(db.prepare('SELECT serial FROM device_users_serial WHERE pin=?').all(pin).map((r) => r.serial));
  const haveAct = act.filter((d) => have.has(d.serial));
  if (!haveAct.length) return act.filter((d) => d.recv_new).map((d) => d.serial);
  const groups = new Set(haveAct.map((d) => d.sync_group).filter(Boolean));
  return act.filter((d) => have.has(d.serial) || (d.sync_group && groups.has(d.sync_group))).map((d) => d.serial);
}

// Đẩy NV (đang làm, có Số ID) xuống máy: Số ID + TÊN PHẦN MỀM (+ thẻ/mật mã đang có). withBio: kèm vân tay/khuôn mặt/ảnh
// phần mềm đang lưu từ máy khác mà máy đích còn thiếu. serials rỗng → tự chọn máy (targetsFor).
export function pushEmployees(pins, { serials = null, withBio = false } = {}) {
  const held = heldSet();
  const okTarget = new Set(db.prepare("SELECT serial FROM push_devices WHERE active=1 AND conn_type<>'tcp'").all().map((r) => r.serial));
  const emp = db.prepare("SELECT 1 FROM employees WHERE device_pin=? AND active=1");
  let users = 0, bios = 0;
  const devs = new Set();
  for (const p of pins || []) {
    const pin = String(p || '').trim();
    if (!pin || !emp.get(pin)) continue;
    for (const serial of (serials ? serials.filter((x) => okTarget.has(x)) : targetsFor(pin))) {
      if (held.has(serial + '|' + pin)) continue;   // máy đó đang có người khác mang Số ID này (nghi trùng)
      queueCmd(serial, buildUserCommand(pin, serial, null, true), { pin, mkind: 'user' });
      users++; devs.add(serial);
      if (!withBio) continue;
      const mine = new Set(db.prepare("SELECT bio_type||'|'||idx k FROM device_bio_templates WHERE serial=? AND pin=?").all(serial, pin).map((r) => r.k));
      for (const t of db.prepare('SELECT * FROM device_bio_templates WHERE pin=? AND serial<>? ORDER BY id').all(pin, serial)) {
        const k = t.bio_type + '|' + t.idx;
        if (mine.has(k)) continue;
        mine.add(k);
        queueCmd(serial, buildBioCommand(t), { pin, bio_type: t.bio_type, idx: t.idx, mkind: 'bio' });
        bios++;
      }
      const pc = buildPhotoCommand(pin); if (pc) queueCmd(serial, pc, { pin, mkind: 'photo' });
    }
  }
  return { users, bios, devices: devs.size };
}

// Vừa lưu NV (khai báo / sửa / nhập Excel): bật tự đẩy → đẩy NV xuống máy; không thì (nếu bật đẩy tên) chỉ ghi tên ở máy đang có
export function onEmployeesSaved(pins) {
  const list = [...new Set((pins || []).map((p) => String(p || '').trim()).filter(Boolean))];
  if (!list.length) return 0;
  if (autoPushOn()) return pushEmployees(list).users;
  return pushNames(list);
}
