// MÁY BẾP TỰ TỪ CHỐI — máy ZKTeco ADMS dòng có KIỂM SOÁT RA VÀO (VD SenseFace 4B, NF43VA) đặt ở nhà ăn.
// Hai công tắc ở Cấu hình suất ăn, mặc định TẮT (tắt = mọi lệnh xuống máy y như cũ):
//   meal_guard_window — KHUNG GIỜ: nhóm 1 trên máy bếp chỉ được quét trong giờ các bữa đang bật → ngoài giờ máy báo
//                       "Khoảng thời gian không hợp lệ" và không lưu lượt. Lệnh hãng: AccTimeZone (khung giờ) + AccGroup (nhóm dùng 3 khung).
//                       Mỗi nhóm chỉ có 3 khung → bếp có hơn 3 khung thì giữ 3 khung SẮP TỚI, hết 1 khung thì thay bằng khung kế tiếp.
//   meal_guard_once   — MỘT LẦN / BỮA: quét thành công ở 1 máy bếp → mọi máy bếp đổi người đó sang "khung giờ riêng, để trống"
//                       (TZ 0001000000000000 — đúng trạng thái làm máy 4B báo "Khoảng thời gian không hợp lệ" ở aac 11/11/2026)
//                       tới hết khung giờ bữa đó; hết bữa trả về USER_TZ như cũ. Máy bếp hỏi lệnh 3 giây / lần → hở vài giây.
//   meal_guard_off    — NGHỈ VIỆC / BỊ KHOÁ: người bị khoá trên phần mềm (active = 0) hoặc đã tới ngày nghỉ việc (leave_date) cũng bị
//                       đổi sang LOCK_TZ trên mọi máy bếp (không xoá khỏi máy, giữ khuôn mặt); mở khoá / đi làm lại thì trả như cũ.
// Máy nào là máy bếp: meal_guard_serials (chỉ máy ADMS conn_type 'push' — máy TCP/IP không nhận các lệnh này).
// Người là QUẢN TRỊ trên máy: không bị khoá, luôn quét được (khung riêng số 45 = cả ngày) để còn vào menu máy.
// Tài liệu hãng: Attendance PUSH Protocol 2021 §12.1.1.14–15 (trang 91–92), trường TZ của USERINFO (trang 40–41).
import { db, getSetting, setSetting } from './db.js';
import { queueCmd, buildUserCommand, setUserTzResolver, setPunchListener, setPollDelayResolver, deviceOnline } from './device-sync.js';
import { heldSet } from './pin-guard.js';
import { listShifts, mealEnabled, machineSignupOn, mealSignupSerials } from './meal.js';
import { shiftForPunch, windowBoundsUtc, hhmmToMin, vnNow } from './meal-rules.js';
import { eachTenant, tenantKey } from './tenant.js';

export const LOCK_TZ = '0001000000000000';                                     // khung giờ riêng, không khung nào → máy từ chối
export const ALWAYS_UID = 45;                                                   // khung cả ngày cho quản trị máy
export const ADMIN_TZ = '0001' + String(ALWAYS_UID).padStart(4, '0') + '00000000';
export const SLOT_UIDS = [46, 47, 48];                                          // 3 khung giờ bữa ăn của nhóm 1
export const GUARD_DELAY = 3;                                                   // giây giữa 2 lần máy bếp hỏi lệnh
const MK = 'mguard';

const flag = (k) => getSetting(k, '0') === '1';
export const guardWindowOn = () => flag('meal_guard_window');
export const guardOnceOn = () => flag('meal_guard_once');
export const guardOffOn = () => flag('meal_guard_off');
const baseOn = () => getSetting('device_enabled', '0') === '1' && mealEnabled();
export const guardOn = () => (guardWindowOn() || guardOnceOn() || guardOffOn()) && baseOn();
const savedSerials = () => String(getSetting('meal_guard_serials', '')).split(',').map((s) => s.trim()).filter(Boolean);
const isAdms = (serial) => !!db.prepare("SELECT 1 FROM push_devices WHERE serial=? AND active=1 AND conn_type='push'").get(serial);
// Máy bếp đang được điều khiển: đã chọn + đang hoạt động + máy ADMS
export function guardSerials() {
  const want = savedSerials();
  if (!want.length || !guardOn()) return [];
  return want.filter(isAdms);
}

/* ---------------------------- quy tắc thuần (test không cần CSDL) ---------------------------- */
const hhmm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + String(m % 60).padStart(2, '0');
export const segText = (g) => `${hhmm(g.from).replace(/(\d\d)(\d\d)/, '$1:$2')}–${hhmm(g.to).replace(/(\d\d)(\d\d)/, '$1:$2')}`;
// Khung giờ các bữa đang bật → đoạn trong ngày [{ from, to }] (phút, gồm trọn phút cuối như windowBoundsUtc);
// bữa qua nửa đêm tách 2 đoạn; đoạn chồng / liền nhau gộp lại cho đỡ tốn khung.
export function mealSegments(shifts) {
  const raw = [];
  for (const s of shifts || []) {
    if (!s || !s.enabled) continue;
    const f = hhmmToMin(s.from_time), t = hhmmToMin(s.to_time);
    if (Number.isNaN(f) || Number.isNaN(t)) continue;
    if (t === f) raw.push({ from: 0, to: 1439 });
    else if (t < f) raw.push({ from: f, to: 1439 }, { from: 0, to: t });
    else raw.push({ from: f, to: t });
  }
  raw.sort((a, b) => a.from - b.from || a.to - b.to);
  const out = [];
  for (const r of raw) {
    const last = out[out.length - 1];
    if (last && r.from <= last.to + 1) last.to = Math.max(last.to, r.to);
    else out.push({ ...r });
  }
  return out;
}
// Máy giữ 3 khung / nhóm: ≤ 3 đoạn → gửi hết; nhiều hơn → 3 đoạn kể từ đoạn ĐANG diễn ra hoặc sắp tới (vòng sang hôm sau)
export function pickSegments(segs, nowMin) {
  if (segs.length <= SLOT_UIDS.length) return segs.map((g) => ({ ...g }));
  let i = segs.findIndex((g) => g.to >= nowMin);
  if (i < 0) i = 0;
  const pick = [];
  for (let k = 0; k < SLOT_UIDS.length; k++) pick.push({ ...segs[(i + k) % segs.length] });
  return pick.sort((a, b) => a.from - b.from);
}
const DAYS = ['Sun', 'Mon', 'Tues', 'Wed', 'Thurs', 'Fri', 'Sat'];   // đúng tên trường của lệnh AccTimeZone (tài liệu hãng §12.1.1.15)
export function tzCommand(uid, seg) {
  const a = seg ? hhmm(seg.from) : '0000', b = seg ? hhmm(seg.to) : '0000';
  return `DATA UPDATE AccTimeZone UID=${uid}\t` + DAYS.map((d) => `${d}Start=${a}\t${d}End=${b}`).join('\t');
}
export const groupCommand = (uids) => `DATA UPDATE AccGroup ID=1\tVerify=0\tValidHoliday=0\tTZ=${[0, 1, 2].map((i) => uids[i] || 0).join(';')}`;
export const GROUP_RESTORE = groupCommand([1]);   // mặc định của máy: nhóm 1 dùng khung 1 (cả ngày)

/* ---------------------------- TZ từng người (gọi từ buildUserCommand) ---------------------------- */
// null = như cũ (USER_TZ). Máy bếp: quản trị → khung cả ngày (khi bật khung giờ); người đang bị khoá bữa này → LOCK_TZ.
export function userTzFor(serial, pin, pri, nowMs = Date.now()) {
  if (!savedSerials().includes(serial) || !guardOn() || !isAdms(serial)) return null;
  if (pri > 0) return guardWindowOn() ? ADMIN_TZ : null;
  if (guardOffOn() && db.prepare('SELECT 1 FROM meal_guard_off WHERE serial=? AND pin=?').get(serial, pin)) return LOCK_TZ;
  if (guardOnceOn() && db.prepare('SELECT 1 FROM meal_guard_locks WHERE serial=? AND pin=? AND released_at IS NULL AND until_at > ?')
    .get(serial, pin, new Date(nowMs).toISOString())) return LOCK_TZ;
  return null;
}
// Máy bếp (bật "một lần / bữa") hỏi lệnh nhanh hơn — áp dụng khi máy bắt tay lại (khởi động lại máy). null = như cũ.
export const guardDelay = (serial) => (guardOnceOn() && guardSerials().includes(serial) ? GUARD_DELAY : null);

/* ---------------------------- khoá người vừa ăn ---------------------------- */
function lockOne(s, pin, hit, until, src, punchIso, nowIso, held) {
  if (held.has(s + '|' + pin)) return 0;   // Số ID đang nghi trùng ở máy này → không ghi đè
  const du = db.prepare('SELECT privilege FROM device_users_serial WHERE serial=? AND pin=?').get(s, pin);
  if (!du) return 0;                       // máy không có người này (hoặc phần mềm chưa biết quyền) → không ghi, khỏi tạo người rỗng / hạ quyền
  if (du.privilege > 0) return 0;          // quản trị máy: không khoá
  if (db.prepare('SELECT 1 FROM meal_guard_locks WHERE serial=? AND pin=? AND released_at IS NULL AND until_at > ?').get(s, pin, nowIso)) return 0;
  db.prepare('INSERT INTO meal_guard_locks(serial, pin, work_date, shift, until_at, src_serial, punch_at) VALUES (?,?,?,?,?,?,?)')
    .run(s, pin, hit.workDate, hit.shift.code, until, src, punchIso);
  queueCmd(s, buildUserCommand(pin, s), { pin, mkind: MK });
  return 1;
}
// Lượt quẹt MỚI vừa lưu ở máy `serial` (ingestAttlog gọi): [{ pin, punchIso, empId }]. Trả số lệnh khoá đã xếp.
export function onPunches(serial, list, nowMs = Date.now()) {
  if (!guardOnceOn() || !guardOn()) return 0;
  const serials = guardSerials();
  if (!serials.includes(serial)) return 0;
  const shifts = listShifts({ onlyEnabled: true });
  const nowIso = new Date(nowMs).toISOString();
  const held = heldSet();
  let n = 0;
  for (const p of list || []) {
    const hit = shiftForPunch(p.punchIso, shifts);
    if (!hit) continue;                                   // quét ngoài mọi bữa
    const until = windowBoundsUtc(hit.workDate, hit.shift)[1];
    if (until <= nowIso) continue;                        // lượt cũ máy gửi bù khi bữa đã hết
    const pins = new Set([String(p.pin)]);
    if (p.empId) { const e = db.prepare('SELECT device_pin FROM employees WHERE id=?').get(p.empId); if (e && e.device_pin) pins.add(String(e.device_pin)); }
    for (const s of serials) for (const pin of pins) n += lockOne(s, pin, hit, until, serial, p.punchIso, nowIso, held);
  }
  return n;
}
// Mở lại: hết khung giờ bữa / tắt "một lần / bữa" (all) / máy không còn là máy bếp (ngoài keep). Lệnh khoá chưa kịp gửi thì huỷ luôn.
export function releaseLocks(nowIso, { all = false, keep = null } = {}) {
  let n = 0;
  for (const L of db.prepare('SELECT * FROM meal_guard_locks WHERE released_at IS NULL ORDER BY id').all()) {
    if (!all && L.until_at > nowIso && (!keep || keep.has(L.serial))) continue;
    db.prepare("UPDATE meal_guard_locks SET released_at = datetime('now') WHERE id = ?").run(L.id);
    const dropped = db.prepare(`DELETE FROM push_device_commands WHERE serial=? AND pin=? AND mkind=? AND trans_time IS NULL AND response_at IS NULL
      AND instr(content, ?) > 0`).run(L.serial, L.pin, MK, '\tTZ=' + LOCK_TZ + '\t').changes;
    const still = db.prepare('SELECT 1 FROM device_users_serial WHERE serial=? AND pin=?').get(L.serial, L.pin);
    if (!dropped && still) queueCmd(L.serial, buildUserCommand(L.pin, L.serial), { pin: L.pin, mkind: MK });
    n++;
  }
  return n;
}

/* ---------------------------- người nghỉ việc / bị khoá ---------------------------- */
// Số ID (trên máy) của người KHÔNG còn được ăn: NV bị khoá (active = 0) hoặc đã tới ngày nghỉ việc (leave_date ≤ hôm nay).
// Số ID khớp theo device_pin, mã NV, và mã máy gửi kèm (device_users.code) — như findEmpByPin; Số ID đang thuộc 1 NV còn làm thì bỏ.
export function offPins(today) {
  const rows = db.prepare(`WITH off AS (SELECT code, device_pin FROM employees WHERE active = 0 OR (IFNULL(leave_date, '') <> '' AND leave_date <= ?)),
      live AS (SELECT code, device_pin FROM employees WHERE active = 1 AND (IFNULL(leave_date, '') = '' OR leave_date > ?))
    SELECT pin FROM (
      SELECT device_pin pin FROM off WHERE IFNULL(device_pin, '') <> ''
      UNION SELECT code FROM off WHERE IFNULL(code, '') <> ''
      UNION SELECT u.pin FROM device_users u JOIN off ON off.code = u.code WHERE u.code <> '')
    WHERE pin NOT IN (SELECT device_pin FROM live WHERE IFNULL(device_pin, '') <> '' UNION SELECT code FROM live)`).all(today, today);
  return new Set(rows.map((r) => String(r.pin)));
}
// Đưa danh sách chặn trên máy bếp về đúng: người mới nghỉ / bị khoá → khoá; người mở khoá / đi làm lại → trả như cũ.
// want = null → bỏ chặn hết (tắt công tắc / máy không còn là máy bếp).
function syncOff(serials, want, held) {
  let n = 0;
  const keep = new Set(serials);
  for (const r of db.prepare('SELECT serial, pin FROM meal_guard_off').all()) {
    if (want && keep.has(r.serial) && want.has(r.pin)) continue;
    db.prepare('DELETE FROM meal_guard_off WHERE serial=? AND pin=?').run(r.serial, r.pin);
    if (db.prepare('SELECT 1 FROM device_users_serial WHERE serial=? AND pin=?').get(r.serial, r.pin))
      queueCmd(r.serial, buildUserCommand(r.pin, r.serial), { pin: r.pin, mkind: MK });
    n++;
  }
  if (!want || !want.size) return n;
  for (const s of serials) {
    for (const u of db.prepare('SELECT pin, privilege FROM device_users_serial WHERE serial=?').all(s)) {
      const pin = String(u.pin);
      if (!want.has(pin) || u.privilege > 0 || held.has(s + '|' + pin)) continue;   // quản trị máy: không chặn (còn vào menu)
      if (db.prepare('SELECT 1 FROM meal_guard_off WHERE serial=? AND pin=?').get(s, pin)) continue;
      db.prepare('INSERT INTO meal_guard_off(serial, pin) VALUES (?,?)').run(s, pin);
      queueCmd(s, buildUserCommand(pin, s), { pin, mkind: MK });
      n++;
    }
  }
  return n;
}

/* ---------------------------- khung giờ từng máy ---------------------------- */
const readState = (serial) => { try { return JSON.parse(db.prepare('SELECT state FROM meal_guard_state WHERE serial=?').get(serial)?.state || 'null'); } catch { return null; } };
const writeState = (serial, st) => db.prepare(`INSERT INTO meal_guard_state(serial, state, updated_at) VALUES (?,?,datetime('now'))
  ON CONFLICT(serial) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`).run(serial, JSON.stringify(st));
// Quản trị máy: gửi lại USERINFO để nhận khung cả ngày (bật khung giờ) hoặc trả như cũ (tắt)
function pushAdmins(serial) {
  for (const u of db.prepare('SELECT pin FROM device_users_serial WHERE serial=? AND privilege > 0').all(serial))
    queueCmd(serial, buildUserCommand(u.pin, serial), { pin: u.pin, mkind: MK });
}
function syncDevice(serial, segs) {
  const prev = readState(serial) || { window: false, slots: [] };
  const win = segs.length > 0;   // bật khung giờ mà không còn bữa nào đang bật → không giới hạn (tránh khoá cả máy)
  const cmds = [];
  let next;
  if (win) {
    if (!prev.window) cmds.push(tzCommand(ALWAYS_UID, { from: 0, to: 1439 }));
    const slots = segs.map((g, i) => ({ uid: SLOT_UIDS[i], from: g.from, to: g.to }));
    for (const sl of slots) {
      const p = prev.window ? (prev.slots || []).find((x) => x.uid === sl.uid) : null;
      if (!p || p.from !== sl.from || p.to !== sl.to) cmds.push(tzCommand(sl.uid, sl));
    }
    const uids = slots.map((x) => x.uid).join(';');
    if (!prev.window || (prev.slots || []).map((x) => x.uid).join(';') !== uids) cmds.push(groupCommand(slots.map((x) => x.uid)));
    next = { window: true, slots };
  } else {
    if (prev.window) cmds.push(GROUP_RESTORE);
    next = { window: false, slots: [] };
  }
  for (const c of cmds) queueCmd(serial, c, { mkind: MK });
  writeState(serial, next);
  if (!!prev.window !== next.window) pushAdmins(serial);
  return cmds.length;
}
function restoreDevice(serial, st) {
  db.prepare('DELETE FROM meal_guard_state WHERE serial=?').run(serial);
  if (st && st.window) { queueCmd(serial, GROUP_RESTORE, { mkind: MK }); pushAdmins(serial); }
}

// 1 nhịp (20 giây / lần): mở khoá hết bữa, đổi khung giờ theo bữa sắp tới, trả máy bỏ khỏi danh sách về như cũ.
const lastClean = new Map();   // công ty → lần dọn lịch sử gần nhất (1 giờ / lần)
export function guardTick(nowMs = Date.now()) {
  const nowIso = new Date(nowMs).toISOString();
  const serials = guardSerials();
  const states = db.prepare('SELECT serial, state FROM meal_guard_state').all();
  const open = db.prepare('SELECT COUNT(*) n FROM meal_guard_locks WHERE released_at IS NULL').get().n;
  const offN = db.prepare('SELECT COUNT(*) n FROM meal_guard_off').get().n;
  if (!serials.length && !states.length && !open && !offN) return { released: 0, tz: 0, off: 0 };   // chưa dùng máy bếp → không làm gì
  const keep = new Set(serials);
  for (const st of states) {
    if (keep.has(st.serial)) continue;
    let s = null; try { s = JSON.parse(st.state || 'null'); } catch {}
    restoreDevice(st.serial, s);
  }
  const released = open ? releaseLocks(nowIso, { all: !(guardOn() && guardOnceOn()), keep }) : 0;
  let tz = 0;
  if (serials.length) {
    const segs = guardWindowOn() ? pickSegments(mealSegments(listShifts({ onlyEnabled: true })), vnNow(new Date(nowMs)).min) : [];
    for (const s of serials) tz += syncDevice(s, segs);
  }
  const offOn = guardOffOn() && serials.length > 0;
  const off = offOn || offN ? syncOff(serials, offOn ? offPins(vnNow(new Date(nowMs)).date) : null, heldSet()) : 0;
  // dọn lịch sử: khoá đã mở + lệnh máy bếp đã chạy quá 7 ngày
  const key = tenantKey();
  if (nowMs - (lastClean.get(key) || 0) > 3600000) {
    lastClean.set(key, nowMs);
    const cut = nowIso.slice(0, 19).replace('T', ' ');
    db.prepare("DELETE FROM meal_guard_locks WHERE released_at IS NOT NULL AND released_at < datetime(?, '-7 days')").run(cut);
    db.prepare("DELETE FROM push_device_commands WHERE mkind=? AND response_at IS NOT NULL AND response_at < datetime(?, '-7 days')").run(MK, cut);
  }
  return { released, tz, off };
}
// Gửi lại toàn bộ khung giờ xuống máy (máy vừa khôi phục cài đặt gốc / thay máy)
export function resendGuard(serial = null) {
  if (serial) db.prepare('DELETE FROM meal_guard_state WHERE serial=?').run(serial);
  else db.prepare('DELETE FROM meal_guard_state').run();
  return guardTick();
}
export function saveGuard({ window, once, off, serials } = {}) {
  const known = new Set(db.prepare('SELECT serial FROM push_devices').all().map((d) => d.serial));
  const list = [...new Set((Array.isArray(serials) ? serials : []).map((x) => String(x).trim()).filter((x) => known.has(x)))];
  setSetting('meal_guard_window', window ? '1' : '0');
  setSetting('meal_guard_once', once ? '1' : '0');
  if (off !== undefined) setSetting('meal_guard_off', off ? '1' : '0');
  setSetting('meal_guard_serials', list.join(','));
  guardTick();
  return guardStatus();
}

/* ---------------------------- trạng thái cho trang Cấu hình suất ăn ---------------------------- */
export function guardStatus(nowMs = Date.now()) {
  const nowIso = new Date(nowMs).toISOString();
  const segs = mealSegments(listShifts({ onlyEnabled: true }));
  const saved = new Set(savedSerials());
  const live = new Set(guardSerials());
  const counted = String(getSetting('meal_serials', '')).split(',').map((s) => s.trim()).filter(Boolean);
  const signup = machineSignupOn() ? new Set(mealSignupSerials()) : new Set();
  const devices = db.prepare("SELECT serial, name, conn_type, last_seen, no_att FROM push_devices WHERE active=1 AND conn_type IN ('push','tcp') ORDER BY name, serial").all().map((d) => {
    const st = readState(d.serial);
    const err = db.prepare(`SELECT content, return_value FROM push_device_commands WHERE serial=? AND mkind=? AND response_at IS NOT NULL
      AND CAST(return_value AS INTEGER) < 0 ORDER BY id DESC LIMIT 1`).get(d.serial, MK);
    return {
      serial: d.serial, name: d.name || d.serial, adms: d.conn_type === 'push', online: deviceOnline(d.last_seen, nowMs),
      picked: saved.has(d.serial), live: live.has(d.serial),
      pending: db.prepare('SELECT COUNT(*) n FROM push_device_commands WHERE serial=? AND mkind=? AND trans_time IS NULL').get(d.serial, MK).n,
      locked: db.prepare('SELECT COUNT(*) n FROM meal_guard_locks WHERE serial=? AND released_at IS NULL AND until_at > ?').get(d.serial, nowIso).n,
      blocked: db.prepare('SELECT COUNT(*) n FROM meal_guard_off WHERE serial=?').get(d.serial).n,
      counts_att: !d.no_att,   // máy bếp mà vẫn tính công → lượt quẹt ăn thành lượt chấm công (cảnh báo ở giao diện)
      slots: st && st.window ? st.slots.map(segText) : [],
      error: err ? { cmd: err.content.split(/\s|\t/).slice(0, 3).join(' '), code: err.return_value } : null,
      not_counted: live.has(d.serial) && counted.length > 0 && !counted.includes(d.serial),
      signup_conflict: live.has(d.serial) && guardWindowOn() && (signup.has(d.serial) || (signup.size === 0 && machineSignupOn())),
    };
  });
  return {
    window: guardWindowOn(), once: guardOnceOn(), off: guardOffOn(), base_ok: baseOn(), serials: [...saved],
    off_people: db.prepare('SELECT COUNT(DISTINCT pin) n FROM meal_guard_off').get().n,
    segments: segs.map(segText), rotating: segs.length > SLOT_UIDS.length, delay: GUARD_DELAY, devices,
    locked_people: db.prepare('SELECT COUNT(DISTINCT pin) n FROM meal_guard_locks WHERE released_at IS NULL AND until_at > ?').get(nowIso).n,
  };
}

// Gắn vào đường đẩy NV + nhận lượt quẹt của máy ZKTeco (công tắc tắt → hai hàm trả null / 0 = như cũ)
setUserTzResolver((serial, pin, pri) => userTzFor(serial, pin, pri));
setPunchListener((serial, list) => onPunches(serial, list));
setPollDelayResolver((serial) => guardDelay(serial));

export function startMealGuard() {
  const run = () => eachTenant(() => { try { guardTick(); } catch (e) { console.error('[máy bếp]', e.message); } });
  setTimeout(run, 20000).unref?.();
  setInterval(run, 20000).unref?.();
}
