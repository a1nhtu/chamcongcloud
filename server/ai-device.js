// MÁY CHẤM CÔNG "AI" — giao thức WEBSOCKET + JSON của hãng (SDK_MayChamCong/AI/.../websocket+json protocol2.0.pdf).
// Máy TỰ KẾT NỐI về phần mềm (giống ZKTeco ADMS) → chạy được cả trên VPS, khỏi mở port modem.
// Công tắc ai_device_enabled (mặc định TẮT; chỉ tài khoản tổng bật). Tắt = phần mềm chạy y như cũ.
//
// File này lo NỘI DUNG (máy gửi gì → lưu gì, phần mềm ra lệnh gì); đường truyền WebSocket ở server/ai-ws.js.
//   Máy → phần mềm: reg (đăng ký) · sendlog (lượt chấm) · senduser (NV vừa đăng ký trên máy)
//   Phần mềm → máy: lệnh JSON xếp trong push_device_commands (content = JSON), gửi lần lượt từng lệnh, máy trả "ret".
// Lượt chấm đổ chung đường với máy ZKTeco (ingestAttlog) → tính công / báo cáo / công ảo không phải sửa.
// Mẫu vân tay / khuôn mặt của máy AI lưu bảng riêng ai_templates (khác chuẩn ZKTeco) — chỉ đồng bộ giữa các máy AI cùng nhóm.
import { db, getSetting } from './db.js';
import { ingestAttlog, ingestUserData, queueCmd, vnNowStr, lockedPins, forgetDeviceUsers, upsertDeviceUserSerial } from './device-sync.js';
import { guardIncoming, heldSet, pmNameFor, registerPusher } from './pin-guard.js';

export const aiEnabled = () => getSetting('device_enabled', '0') === '1' && getSetting('ai_device_enabled', '0') === '1';

// backupnum: 0-9 vân tay · 10 mật mã · 11 thẻ · 20-27 khuôn mặt · 30-37 lòng bàn tay · 50 ảnh (base64)
export const isFp = (b) => b >= 0 && b <= 9;
export const isFace = (b) => (b >= 20 && b <= 27) || b === 50;
const isBio = (b) => isFp(b) || (b >= 20 && b <= 27) || (b >= 30 && b <= 37) || b === 50;
const BN_PWD = 10, BN_CARD = 11;
// Số ID máy AI là số nguyên (enrollid)
const pinOk = (p) => /^\d{1,9}$/.test(String(p ?? '').trim());
const str = (v) => String(v ?? '').trim();

// JSON máy gửi: vài firmware để thừa dấu phẩy (",]" / ",}") và khoá có khoảng trắng / chữ hoa ("count ", "record ")
export function parseMsg(text) {
  let o;
  try { o = JSON.parse(text); } catch { o = JSON.parse(String(text).replace(/,\s*([\]}])/g, '$1')); }
  return normKeys(o);
}
function normKeys(v) {
  if (Array.isArray(v)) return v.map(normKeys);
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k.trim().toLowerCase()] = normKeys(x); return o; }
  return v;
}
const okOf = (m) => m.result === true || m.result === 'true' || m.result === 1;
const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

/* ============================ MÁY GỬI LÊN ============================ */
// Máy đăng ký (mỗi lần kết nối). Máy lạ → thêm vào danh sách "Chờ duyệt"; chưa duyệt → trả result:false (máy hiện lý do
// trên màn hình, giữ lượt chấm lại, kết nối lại sau). Trả { serial, ok, reply }.
export function onReg(m, ip = '') {
  const sn = str(m.sn);
  if (!/^[\w.-]{3,40}$/.test(sn)) return { serial: null, ok: false, reply: { ret: 'reg', result: false, reason: 'Serial khong hop le' } };
  let d = db.prepare('SELECT * FROM push_devices WHERE serial=?').get(sn);
  if (d && d.conn_type !== 'ai') return { serial: null, ok: false, reply: { ret: 'reg', result: false, reason: 'Serial trung may khac' } };
  const info = { ...(m.devinfo && typeof m.devinfo === 'object' ? m.devinfo : {}), cpusn: str(m.cpusn), read_at: new Date().toISOString() };
  if (!d) {
    db.prepare("INSERT INTO push_devices(serial, name, active, conn_type, last_ip, last_seen, tcp_info) VALUES(?,?,0,'ai',?,?,?)")
      .run(sn, '', ip, new Date().toISOString(), JSON.stringify(info));
    d = db.prepare('SELECT * FROM push_devices WHERE serial=?').get(sn);
  } else {
    db.prepare('UPDATE push_devices SET last_ip=?, last_seen=?, tcp_info=? WHERE id=?').run(ip, new Date().toISOString(), JSON.stringify(info), d.id);
  }
  if (!d.active) return { serial: sn, ok: false, reply: { ret: 'reg', result: false, reason: 'Cho duyet tren phan mem' } };
  // cloudtime = giờ máy chủ (VN) → máy tự chỉnh giờ theo
  return { serial: sn, ok: true, reply: { ret: 'reg', result: true, cloudtime: vnNowStr() } };
}

// Lượt chấm: enrollid=0 là sự kiện cửa (đóng/mở) → bỏ qua. mode 0 vân tay · 1 thẻ · 2 mật mã · khác = khuôn mặt.
const VERIFY = { 0: 1, 1: 4, 2: 0 };
function logLines(records) {
  const out = [];
  for (const r of Array.isArray(records) ? records : []) {
    const pin = str(r.enrollid), t = str(r.time).replace('T', ' ').slice(0, 19);
    if (!pin || pin === '0' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(t)) continue;
    const mode = parseInt(r.mode, 10);
    out.push(`${pin}\t${t.length === 16 ? t + ':00' : t}\t${parseInt(r.inout, 10) === 1 ? 1 : 0}\t${VERIFY[mode] ?? 15}`);
  }
  return out;
}
// Số ID lạ (chưa khớp NV) → hỏi tên trên máy để tự tạo NV (giống máy ZKTeco)
export function aiAsk(serial, pin) {
  if (!pinOk(pin) || getSetting('device_autocreate', '1') !== '1') return;
  aiQueue(serial, { cmd: 'getusername', enrollid: +pin }, { pin, mkind: 'ask' });
}
export function ingestAiLogs(serial, records) {
  const lines = logLines(records);
  if (!lines.length) return 0;
  return tx(() => ingestAttlog(serial, lines.join('\n'), { ask: aiAsk }));
}
export function onSendlog(serial, m) {
  const d = activeDev(serial);
  if (!d) return { ret: 'sendlog', result: false, reason: 1 };
  ingestAiLogs(serial, m.record);
  const reply = { ret: 'sendlog', result: true, cloudtime: vnNowStr(), access: 1 };
  if (m.count != null) reply.count = +m.count || 0;
  if (m.logindex != null) reply.logindex = +m.logindex || 0;
  return reply;
}

// 1 bản ghi NV/sinh trắc từ máy (senduser hoặc trả lời getuserinfo) → lưu NV + thẻ/mật mã + mẫu. Trả Set Số ID đã đụng.
function ingestUserRecord(serial, r, realtime) {
  const pin = str(r.enrollid);
  if (!pinOk(pin)) return new Set();
  const bn = parseInt(r.backupnum, 10), rec = r.record;
  let line = `USER PIN=${pin}\tName=${str(r.name).replace(/[\t\r\n]/g, ' ')}`;
  if (r.admin != null) line += `\tPri=${+r.admin > 0 ? 14 : 0}`;   // không có thông tin quyền → giữ nguyên quyền đang lưu
  if (bn === BN_CARD && str(rec) && str(rec) !== '0') line += `\tCard=${str(rec)}`;
  if (bn === BN_PWD && str(rec) && str(rec) !== '0') line += `\tPasswd=${str(rec)}`;
  try { guardIncoming(serial, 'USER', line, { realtime }); } catch (e) { console.error('[pin-guard] kiểm trùng lỗi:', e.message); }
  const seen = ingestUserData(serial, 'USER', line);
  if (isBio(bn) && str(rec)) {
    db.prepare(`INSERT INTO ai_templates(serial,pin,backupnum,record) VALUES(?,?,?,?)
      ON CONFLICT(serial,pin,backupnum) DO UPDATE SET record=excluded.record, received_at=datetime('now')`).run(serial, pin, bn, String(rec));
    seen.add(pin);
  }
  return seen;
}
export function onSenduser(serial, m) {
  if (!activeDev(serial)) return { ret: 'senduser', result: false, reason: 1 };
  const pins = tx(() => ingestUserRecord(serial, m, true));
  try { aiSyncPins(serial, pins); } catch (e) { console.error('[ai] đồng bộ nhóm lỗi:', e.message); }
  return { ret: 'senduser', result: true, cloudtime: vnNowStr() };
}
const activeDev = (serial) => serial ? db.prepare("SELECT * FROM push_devices WHERE serial=? AND conn_type='ai' AND active=1").get(serial) : null;

/* ============================ PHẦN MỀM RA LỆNH ============================ */
// Xếp 1 lệnh JSON (chống trùng lệnh y hệt đang chờ). meta.mkind: 'user' | 'bio' | 'del' | 'ask' → xử lý khi máy xác nhận.
export function aiQueue(serial, obj, meta = {}) { queueCmd(serial, JSON.stringify(obj), meta); }
// Lấy lệnh kế tiếp cho máy (đánh dấu đã gửi). Trả { id, obj } hoặc null.
export function nextAiCommand(serial) {
  const c = db.prepare('SELECT id, content FROM push_device_commands WHERE serial=? AND trans_time IS NULL ORDER BY id LIMIT 1').get(serial);
  if (!c) return null;
  db.prepare("UPDATE push_device_commands SET trans_time=datetime('now') WHERE id=?").run(c.id);
  let obj; try { obj = JSON.parse(c.content); } catch { obj = null; }
  if (!obj || !obj.cmd) { finishCmd(c.id, 'bad'); return nextAiCommand(serial); }
  return { id: c.id, obj };
}
// Máy mất kết nối giữa chừng → lệnh đang gửi dở được gửi lại lần sau
export function requeueCmd(id) { db.prepare('UPDATE push_device_commands SET trans_time=NULL WHERE id=? AND response_at IS NULL').run(id); }
export function finishCmd(id, ret) { db.prepare("UPDATE push_device_commands SET return_value=?, response_at=datetime('now') WHERE id=?").run(String(ret), id); }

const PAGED = new Set(['getuserlist', 'getnewlog', 'getalllog']);
// Máy trả lời lệnh đang chờ (fl = { id, obj, acc }). Trả { more } — more=true: gửi tiếp trang sau {cmd, stn:false}.
export function onReply(serial, fl, m) {
  const cmd = fl.obj.cmd, ok = okOf(m);
  const meta = db.prepare('SELECT pin, mkind FROM push_device_commands WHERE id=?').get(fl.id) || {};
  if (PAGED.has(cmd)) {
    const recs = ok && Array.isArray(m.record) ? m.record : [];
    if (cmd === 'getuserlist') {
      fl.acc = fl.acc || new Map();
      for (const r of recs) {
        const pin = str(r.enrollid); if (!pinOk(pin)) continue;
        const u = fl.acc.get(pin) || { admin: 0, bns: new Set() };
        u.admin = Math.max(u.admin, +r.admin || 0); u.bns.add(parseInt(r.backupnum, 10)); fl.acc.set(pin, u);
      }
    } else if (recs.length) ingestAiLogs(serial, recs);
    // Trang trống / đã đủ tổng số → xong. (count ở getuserlist = số dòng trang này; ở log = tổng số lượt)
    // Chặn lặp vô hạn: máy trả lại đúng trang vừa rồi (cùng "from") hoặc quá 5.000 trang → dừng.
    const total = +m.count || 0, to = parseInt(m.to, 10), from = parseInt(m.from, 10);
    const same = Number.isFinite(from) && fl.lastFrom === from; fl.lastFrom = from;
    const done = !ok || !recs.length || same || (Number.isFinite(to) && total > recs.length && to + 1 >= total) || (fl.pages = (fl.pages || 0) + 1) > 5000;
    if (!done) return { more: true };
    if (cmd === 'getuserlist' && fl.acc) userListDone(serial, fl.acc);
    finishCmd(fl.id, ok ? 0 : 'fail');
    return { more: false };
  }
  finishCmd(fl.id, ok ? 0 : 'fail');
  if (!ok) return { more: false };
  try {
    if (cmd === 'getuserinfo') { const pins = tx(() => ingestUserRecord(serial, m, false)); aiSyncPins(serial, pins); }
    else if (cmd === 'getusername' && str(m.record)) tx(() => ingestUserRecord(serial, { enrollid: fl.obj.enrollid, name: m.record, backupnum: -1 }, false));
    else if (cmd === 'getdevinfo') {
      const d = db.prepare('SELECT id, tcp_info FROM push_devices WHERE serial=?').get(serial);
      let info = {}; try { info = JSON.parse(d.tcp_info || '{}'); } catch {}
      info.params = { ...m }; delete info.params.ret; delete info.params.result; info.read_at = new Date().toISOString();
      db.prepare('UPDATE push_devices SET tcp_info=? WHERE id=?').run(JSON.stringify(info), d.id);
    } else if (cmd === 'setuserinfo') {
      const pin = str(fl.obj.enrollid), bn = parseInt(fl.obj.backupnum, 10);
      upsertDeviceUserSerial(serial, pin, str(fl.obj.name), bn === BN_CARD ? str(fl.obj.record) : '');
      if (isBio(bn)) db.prepare(`INSERT INTO ai_templates(serial,pin,backupnum,record) VALUES(?,?,?,?)
        ON CONFLICT(serial,pin,backupnum) DO UPDATE SET record=excluded.record, received_at=datetime('now')`).run(serial, pin, bn, String(fl.obj.record));
    } else if (cmd === 'setusername') {
      for (const r of fl.obj.record || []) upsertDeviceUserSerial(serial, str(r.enrollid), str(r.name), '');
    } else if (cmd === 'deleteuser') {
      const pin = str(fl.obj.enrollid);
      forgetDeviceUsers(serial, [pin]); db.prepare('DELETE FROM ai_templates WHERE serial=? AND pin=?').run(serial, pin);
    } else if (cmd === 'cleanuser' || cmd === 'initsys') {
      db.prepare('DELETE FROM device_users_serial WHERE serial=?').run(serial); db.prepare('DELETE FROM ai_templates WHERE serial=?').run(serial);
    } else if (cmd === 'cleanadmin') db.prepare('UPDATE device_users_serial SET privilege=0 WHERE serial=?').run(serial);
  } catch (e) { console.error('[ai] xử lý trả lời', cmd, 'lỗi:', e.message, meta.pin || ''); }
  return { more: false };
}
// Đã có danh sách Số ID + loại dữ liệu trên máy → ghi nhận NV, rồi hỏi từng mục (tên + mẫu vân tay/mặt, thẻ, mật mã)
function userListDone(serial, acc) {
  tx(() => { for (const [pin, u] of acc) ingestUserData(serial, 'USER', `USER PIN=${pin}\tPri=${u.admin > 0 ? 14 : 0}`); });
  for (const [pin, u] of acc) for (const bn of [...u.bns].sort((a, b) => a - b)) aiQueue(serial, { cmd: 'getuserinfo', enrollid: +pin, backupnum: bn });
}

/* ---------- ghi NV / mẫu xuống máy AI ---------- */
// Các lệnh ghi 1 Số ID xuống máy đích: tên (phần mềm) + thẻ/mật mã (đã biết) + mẫu sinh trắc máy đích còn thiếu.
// fromSerial: chỉ lấy mẫu của máy nguồn đó (đồng bộ nhóm); null = mẫu ở bất kỳ máy AI nào. withBio=false: chỉ tên/thẻ/mật mã.
function aiPushPin(target, pin, { fromSerial = null, withBio = true, force = false } = {}) {
  if (!pinOk(pin)) return { users: 0, bios: 0 };
  const u = db.prepare('SELECT * FROM device_users WHERE pin=?').get(pin) || {};
  const name = pmNameFor(pin, true) || u.name || '';
  const s = db.prepare('SELECT privilege FROM device_users_serial WHERE serial=? AND pin=?').get(target, pin);
  const admin = s && s.privilege > 0 ? 1 : 0;   // giữ quyền đang có trên máy đích, không mang quyền máy khác sang
  const base = { cmd: 'setuserinfo', enrollid: +pin, name, admin };
  let users = 0, bios = 0;
  if (u.card && u.card !== '0') { aiQueue(target, { ...base, backupnum: BN_CARD, record: +u.card || u.card }, { pin, mkind: 'user' }); users++; }
  if (u.passwd && u.passwd !== '0' && /^\d{1,8}$/.test(u.passwd)) { aiQueue(target, { ...base, backupnum: BN_PWD, record: +u.passwd }, { pin, mkind: 'user' }); users++; }
  if (withBio) {
    const mine = force ? new Set() : new Set(db.prepare('SELECT backupnum FROM ai_templates WHERE serial=? AND pin=?').all(target, pin).map((r) => r.backupnum));
    const tps = fromSerial
      ? db.prepare('SELECT backupnum, record FROM ai_templates WHERE serial=? AND pin=? ORDER BY backupnum').all(fromSerial, pin)
      : db.prepare('SELECT backupnum, record FROM ai_templates WHERE serial<>? AND pin=? ORDER BY received_at DESC').all(target, pin);
    for (const t of tps) {
      if (mine.has(t.backupnum)) continue;
      mine.add(t.backupnum);
      aiQueue(target, { ...base, backupnum: t.backupnum, record: t.record }, { pin, mkind: 'bio' }); bios++;
    }
  }
  // chưa có thẻ/mật mã/mẫu nào để ghi → chỉ đặt tên (máy đã có Số ID này)
  if (!users && !bios && name && db.prepare('SELECT 1 FROM device_users_serial WHERE serial=? AND pin=?').get(target, pin)) {
    aiQueue(target, { cmd: 'setusername', count: 1, record: [{ enrollid: +pin, name }] }, { pin, mkind: 'user' }); users++;
  }
  return { users: users || (bios ? 1 : 0), bios };
}
// Máy AI vừa gửi NV/mẫu lên → đẩy sang các máy AI CÙNG NHÓM đồng bộ (real-time, như máy ZKTeco)
export function aiSyncPins(sourceSerial, pins) {
  if (!pins || !pins.size) return 0;
  const src = db.prepare("SELECT sync_group FROM push_devices WHERE serial=? AND conn_type='ai'").get(sourceSerial);
  if (!src || !src.sync_group) return 0;
  const targets = db.prepare("SELECT serial FROM push_devices WHERE sync_group=? AND serial<>? AND active=1 AND conn_type='ai'").all(src.sync_group, sourceSerial);
  const locked = lockedPins(), held = heldSet();
  let n = 0;
  for (const t of targets) for (const pin of pins) {
    if (locked.has(pin) || held.has(sourceSerial + '|' + pin) || held.has(t.serial + '|' + pin)) continue;
    n += aiPushPin(t.serial, pin, { fromSerial: sourceSerial }).bios;
  }
  return n;
}
// Máy AI vừa duyệt / vừa đặt nhóm → nhận đủ NV + mẫu mà các máy AI cùng nhóm đang có (force: gửi lại hết)
export function aiFillDevice(serial, force = false) {
  const dev = db.prepare("SELECT sync_group FROM push_devices WHERE serial=? AND conn_type='ai' AND active=1").get(serial);
  if (!dev || !dev.sync_group) return 0;
  const peers = db.prepare("SELECT serial FROM push_devices WHERE sync_group=? AND serial<>? AND conn_type='ai'").all(dev.sync_group, serial).map((r) => r.serial);
  if (!peers.length) return 0;
  const ph = peers.map(() => '?').join(',');
  const pins = new Set(db.prepare(`SELECT DISTINCT pin FROM ai_templates WHERE serial IN (${ph}) UNION SELECT DISTINCT pin FROM device_users_serial WHERE serial IN (${ph})`).all(...peers, ...peers).map((r) => String(r.pin)));
  const locked = lockedPins(), held = heldSet();
  let n = 0;
  for (const pin of pins) {
    if (locked.has(pin) || held.has(serial + '|' + pin)) continue;
    const r = aiPushPin(serial, pin, { force }); n += r.users + r.bios;
  }
  return n;
}
// Đẩy NV từ phần mềm xuống máy AI (nút "Đẩy NV từ phần mềm xuống máy" + tự đẩy khi khai/sửa NV)
registerPusher('ai', (serial, pin, { withBio } = {}) => aiPushPin(serial, pin, { withBio: !!withBio }));

/* ---------- thao tác bấm tay trên trang Máy chấm công ---------- */
export const AI_ACTIONS = {
  info: 'Đọc thông tin máy', users: 'Tải nhân viên từ máy', logs: 'Tải dữ liệu chấm công', 'new-logs': 'Tải lượt chấm mới', 'set-time': 'Đặt giờ máy theo máy chủ',
  restart: 'Khởi động lại máy', 'open-door': 'Mở cửa', 'clear-admins': 'Xóa quyền quản trị', 'clear-logs': 'Xóa toàn bộ dữ liệu chấm công trên máy',
  'clear-users': 'Xóa toàn bộ nhân viên trên máy', 'clear-all': 'Xóa sạch máy (NV + chấm công)',
};
// Xếp lệnh cho 1 thao tác. Trả số lệnh đã xếp.
export function aiAction(serial, action, args = {}) {
  const one = (obj) => { aiQueue(serial, obj); return 1; };
  switch (action) {
    case 'info': return one({ cmd: 'getdevinfo' });
    case 'users': return one({ cmd: 'getuserlist', stn: true });
    case 'logs': return args.from && args.to ? one({ cmd: 'getalllog', stn: true, from: args.from, to: args.to }) : one({ cmd: 'getalllog', stn: true });
    case 'new-logs': return one({ cmd: 'getnewlog', stn: true });
    case 'set-time': return one({ cmd: 'settime', cloudtime: vnNowStr() });
    case 'restart': return one({ cmd: 'reboot' });
    case 'open-door': return one({ cmd: 'opendoor', doornum: 1 });
    case 'clear-admins': return one({ cmd: 'cleanadmin' });
    case 'clear-logs': return one({ cmd: 'cleanlog' });
    case 'clear-users': return one({ cmd: 'cleanuser' });
    case 'clear-all': return one({ cmd: 'initsys' });
    default: return 0;
  }
}
// Xoá các Số ID trên máy AI (backupnum 13 = xoá hết dữ liệu của người đó). Trả số lệnh đã xếp.
export function aiDeleteUsers(serial, pins) {
  let n = 0;
  for (const p of pins || []) { const pin = str(p); if (!pinOk(pin)) continue; aiQueue(serial, { cmd: 'deleteuser', enrollid: +pin, backupnum: 13 }, { pin, mkind: 'del' }); n++; }
  return n;
}
