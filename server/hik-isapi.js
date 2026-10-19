// MÁY CHẤM CÔNG HIKVISION (dòng khuôn mặt / vân tay DS-K1T…) — gọi THẲNG giao thức web ISAPI của máy (HTTP + Digest),
// không cần DLL HCNetSDK (SDK đó thực chất cũng chỉ chuyển các lệnh ISAPI này) → chạy được cả bản Windows lẫn Linux.
// Tài liệu: SDK_MayChamCong/HIK/.../doc/Device Network SDK (Person-Based Access Control)_Developer Guide (mục E.6, E.164-169).
// Phần mềm KẾT NỐI VÀO MÁY (giống máy ZKTeco TCP/IP) → phần mềm phải cùng mạng LAN với máy, hoặc máy được mở port ra internet.
// Công tắc hik_device_enabled (mặc định TẮT; chỉ tài khoản tổng bật). Lượt chấm đổ chung đường ingestAttlog như máy ZKTeco.
import { request as httpReq } from 'node:http';
import { request as httpsReq } from 'node:https';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { db, getSetting } from './db.js';
import { ingestAttlog, ingestUserData, forgetDeviceUsers } from './device-sync.js';
import { guardIncoming, pmNameFor } from './pin-guard.js';
import { vnDateStr } from './util.js';

export const hikEnabled = () => getSetting('device_enabled', '0') === '1' && getSetting('hik_device_enabled', '0') === '1';

/* ---------- gọi ISAPI (HTTP Digest) ---------- */
const md5 = (s) => createHash('md5').update(s).digest('hex');
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
function parseChallenge(h) {
  const m = /^\s*(\w+)\s+(.*)$/s.exec(String(h || ''));
  if (!m) return null;
  const p = { scheme: m[1].toLowerCase() };
  for (const x of m[2].matchAll(/(\w+)\s*=\s*(?:"([^"]*)"|([^,\s]*))/g)) p[x[1].toLowerCase()] = x[2] ?? x[3];
  return p;
}
export function digestAuth(ch, user, pass, method, uri, nc = 1) {
  const algo = String(ch.algorithm || 'MD5').toUpperCase();
  const H = algo.startsWith('SHA-256') ? sha256 : md5;
  const cnonce = randomBytes(8).toString('hex'), ncs = String(nc).padStart(8, '0');
  let ha1 = H(`${user}:${ch.realm}:${pass}`);
  if (algo.endsWith('-SESS')) ha1 = H(`${ha1}:${ch.nonce}:${cnonce}`);
  const ha2 = H(`${method}:${uri}`);
  const qops = String(ch.qop || '').split(',').map((s) => s.trim()).filter(Boolean);
  const qop = qops.includes('auth') ? 'auth' : (qops[0] || '');
  const resp = qop ? H(`${ha1}:${ch.nonce}:${ncs}:${cnonce}:${qop}:${ha2}`) : H(`${ha1}:${ch.nonce}:${ha2}`);
  let s = `Digest username="${user}", realm="${ch.realm}", nonce="${ch.nonce}", uri="${uri}", algorithm=${ch.algorithm || 'MD5'}, response="${resp}"`;
  if (qop) s += `, qop=${qop}, nc=${ncs}, cnonce="${cnonce}"`;
  if (ch.opaque) s += `, opaque="${ch.opaque}"`;
  return s;
}
function rawReq(dev, method, path, body, auth, timeoutMs) {
  return new Promise((resolve, reject) => {
    const https = Number(dev.tcp_port) === 443;
    const data = body == null ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
    const headers = { Accept: '*/*', Connection: 'close' };
    if (data) { headers['Content-Type'] = typeof body === 'string' && body.trimStart().startsWith('<') ? 'application/xml' : 'application/json'; headers['Content-Length'] = data.length; }
    if (auth) headers.Authorization = auth;
    const req = (https ? httpsReq : httpReq)({ host: dev.tcp_ip, port: dev.tcp_port || 80, method, path, headers, rejectUnauthorized: false, timeout: timeoutMs }, (res) => {
      const chunks = []; let size = 0;
      res.on('data', (c) => { size += c.length; if (size > 64 * 1024 * 1024) { req.destroy(new Error('Máy trả dữ liệu quá lớn')); return; } chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('Máy không phản hồi (quá thời gian chờ).'), { code: 'TIMEOUT' })));
    req.on('error', (e) => reject(e.code === 'TIMEOUT' ? e : Object.assign(new Error(`Không kết nối được máy Hikvision ở ${dev.tcp_ip}:${dev.tcp_port || 80} (${e.code || e.message}). Kiểm tra máy đã bật, IP/cổng đúng và cùng mạng.`), { code: 'CONN' })));
    if (data) req.write(data);
    req.end();
  });
}
// Gọi 1 lệnh ISAPI. Trả { status, text, json } — json khi máy trả JSON. Lỗi → ném Error (tiếng Việt).
export async function isapi(dev, method, path, body = null, { timeoutMs = 20000, okStatus = [200] } = {}) {
  let r = await rawReq(dev, method, path, body, null, timeoutMs);
  if (r.status === 401) {
    const ch = parseChallenge(r.headers['www-authenticate']);
    const user = dev.dev_user || 'admin', pass = dev.dev_pass || '';
    const auth = ch && ch.scheme === 'digest' ? digestAuth(ch, user, pass, method, path)
      : 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
    r = await rawReq(dev, method, path, body, auth, timeoutMs);
    if (r.status === 401) throw Object.assign(new Error('Sai tài khoản hoặc mật khẩu máy Hikvision (nhập sai nhiều lần máy sẽ tạm khoá đăng nhập ~30 phút).'), { code: 'AUTH' });
  }
  let json = null;
  if (/^\s*[{[]/.test(r.text)) { try { json = JSON.parse(r.text); } catch {} }
  if (!okStatus.includes(r.status)) {
    const st = json && (json.ResponseStatus || json);
    const why = st && (st.subStatusCode || st.statusString || st.errorMsg) || (/<subStatusCode>([^<]*)/.exec(r.text) || [])[1] || ('HTTP ' + r.status);
    throw Object.assign(new Error(`Máy Hikvision báo lỗi: ${why}`), { code: 'ISAPI', status: r.status, sub: st && st.subStatusCode });
  }
  return { status: r.status, text: r.text, json };
}
const tag = (xml, t) => ((new RegExp(`<${t}>([^<]*)</${t}>`).exec(xml) || [])[1] || '').trim();

/* ---------- đọc thông tin + dung lượng ---------- */
// { serial, model, name, firmware, mac, users, logs, read_at }
export async function hikInfo(dev) {
  const r = await isapi(dev, 'GET', '/ISAPI/System/deviceInfo');
  const info = { serial: tag(r.text, 'serialNumber'), model: tag(r.text, 'model'), name: tag(r.text, 'deviceName'),
    firmware: [tag(r.text, 'firmwareVersion'), tag(r.text, 'firmwareReleasedDate')].filter(Boolean).join(' '), mac: tag(r.text, 'macAddress') };
  try { const c = await isapi(dev, 'GET', '/ISAPI/AccessControl/UserInfo/Count?format=json'); info.users = Number(c.json?.UserInfoCount?.userNumber); } catch {}
  try {
    const c = await isapi(dev, 'POST', '/ISAPI/AccessControl/AcsEventTotalNum?format=json', { AcsEventTotalNumCond: { major: 5, minor: 0, eventAttribute: 'attendance' } });
    info.logs = Number(c.json?.AcsEventTotalNum?.totalNum);
  } catch {}
  for (const k of ['users', 'logs']) if (!Number.isFinite(info[k])) delete info[k];
  info.read_at = new Date().toISOString();
  return info;
}
export function saveHikInfo(id, info) {
  db.prepare('UPDATE push_devices SET tcp_info=?, last_seen=?, last_ip=tcp_ip WHERE id=?').run(JSON.stringify(info), info.read_at, id);
}

/* ---------- tải NHÂN VIÊN ---------- */
export async function hikUsers(dev, prog = () => {}) {
  const lines = [], searchID = randomUUID();
  let pos = 0, fp = 0, face = 0, card = 0;
  for (let page = 0; page < 5000; page++) {
    const r = await isapi(dev, 'POST', '/ISAPI/AccessControl/UserInfo/Search?format=json',
      { UserInfoSearchCond: { searchID, searchResultPosition: pos, maxResults: 30 } }, { timeoutMs: 30000 });
    const s = r.json?.UserInfoSearch || {};
    const list = Array.isArray(s.UserInfo) ? s.UserInfo : [];
    for (const u of list) {
      const pin = String(u.employeeNo ?? '').trim();
      if (!pin || /[\s=\t]/.test(pin) || pin.length > 20) continue;
      if (u.userType && !['normal', ''].includes(String(u.userType))) continue;   // bỏ khách (visitor) / danh sách chặn
      const name = String(u.name || '').replace(/[\t\r\n]/g, ' ').trim();
      lines.push(`USER PIN=${pin}\tName=${name}`);
      fp += +u.numOfFP || 0; face += +u.numOfFace || 0; card += +u.numOfCard || 0;
    }
    pos += list.length;
    if (lines.length && lines.length % 300 < 30) prog(`Đã đọc ${lines.length} nhân viên…`);
    if (s.responseStatusStrg !== 'MORE' || !list.length) break;
  }
  prog(`Đang lưu ${lines.length} nhân viên…`);
  if (lines.length) { try { guardIncoming(dev.serial, 'USER', lines.join('\n'), { realtime: false }); } catch (e) { console.error('[pin-guard] kiểm trùng lỗi:', e.message); } }
  const seen = lines.length ? ingestUserData(dev.serial, 'USER', lines.join('\n')) : new Set();
  // số vân tay / khuôn mặt / thẻ trên máy (máy Hikvision không gửi mẫu về → chỉ ghi số đếm để hiển thị)
  try {
    const d = db.prepare('SELECT tcp_info FROM push_devices WHERE id=?').get(dev.id);
    const info = d && d.tcp_info ? JSON.parse(d.tcp_info) : {};
    Object.assign(info, { users: lines.length, fps: fp, faces: face, cards: card });
    db.prepare('UPDATE push_devices SET tcp_info=? WHERE id=?').run(JSON.stringify(info), dev.id);
  } catch {}
  return { read: lines.length, saved: seen.size };
}

/* ---------- tải LƯỢT CHẤM ---------- */
// Mã sự kiện "xác thực thành công" (major 5) — lấy từ incEn/HCNetSDK.h của SDK
const PASS_CARD = [0x01, 0x02], PASS_FP = [0x26, 0x28, 0x2b, 0x2e, 0x45, 0x48], PASS_FACE = [0x36, 0x39, 0x3c, 0x3f, 0x42, 0x4b, 0x4d],
  PASS_OTHER = [0x10, 0x65, 0x69, 0x99, 0x9c, 0x9f, 0xb3, 0xb5, 0xbe, 0xd5, 0xe2];
const PASS = new Set([...PASS_CARD, ...PASS_FP, ...PASS_FACE, ...PASS_OTHER]);
const verifyOf = (minor) => (PASS_FP.includes(minor) ? 1 : PASS_FACE.includes(minor) ? 15 : PASS_CARD.includes(minor) ? 4 : 0);
const OUT = new Set(['checkOut', 'breakOut', 'overtimeOut']);
const shiftDay = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
// 1 sự kiện → dòng ATTLOG "PIN \t yyyy-MM-dd HH:mm:ss \t Status \t Verify". Giờ lấy theo ĐỒNG HỒ HIỂN THỊ trên máy
// (bỏ phần múi giờ) — giống mọi máy chấm công khác; máy để sai múi giờ cũng không lệch công.
export function hikEventLine(e, strict) {
  const pin = String(e.employeeNoString ?? e.employeeNo ?? '').trim();
  if (!pin || /[\s\t]/.test(pin) || pin.length > 20) return null;
  const minor = +e.minor;
  if (strict && (+e.major !== 5 || !PASS.has(minor))) return null;
  const t = String(e.time || '').replace('T', ' ').slice(0, 19);
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(t)) return null;
  return `${pin}\t${t}\t${OUT.has(String(e.attendanceStatus || '')) ? 1 : 0}\t${verifyOf(minor)}`;
}
async function searchEvents(dev, cond, onPage) {
  const searchID = randomUUID();
  let pos = 0;
  for (let page = 0; page < 20000; page++) {
    const r = await isapi(dev, 'POST', '/ISAPI/AccessControl/AcsEvent?format=json',
      { AcsEventCond: { searchID, searchResultPosition: pos, maxResults: 30, major: 5, minor: 0, picEnable: false, ...cond } }, { timeoutMs: 30000 });
    const s = r.json?.AcsEvent || {};
    const list = Array.isArray(s.InfoList) ? s.InfoList : [];
    onPage(list, Number(s.totalMatches) || 0);
    pos += list.length;
    if (s.responseStatusStrg !== 'MORE' || !list.length) break;
  }
}
// Tải lượt chấm trong [from, to] (rỗng = toàn bộ trên máy) → lưu + dựng công. Lượt đã có thì tự bỏ (không trùng).
export async function hikLogs(dev, from, to, prog = () => {}) {
  const cond = {};
  if (from && to) { cond.startTime = shiftDay(from, -1) + 'T00:00:00+07:00'; cond.endTime = shiftDay(to, 1) + 'T23:59:59+07:00'; }   // nới 1 ngày 2 đầu (máy để múi giờ khác) rồi lọc lại theo ngày
  const lines = [];
  let strict = false, read = 0;
  const onPage = (list, total) => {
    read += list.length;
    for (const e of list) {
      const l = hikEventLine(e, strict);
      if (!l) continue;
      const day = l.split('\t')[1].slice(0, 10);
      if (from && to && (day < from || day > to)) continue;
      lines.push(l);
    }
    prog(`Đã đọc ${read.toLocaleString('vi')}${total ? ' / ' + total.toLocaleString('vi') : ''} sự kiện từ máy…`);
  };
  try { await searchEvents(dev, { ...cond, eventAttribute: 'attendance' }, onPage); }   // máy mới: chỉ lấy lượt xác thực hợp lệ
  catch (e) {
    if (e.code !== 'ISAPI') throw e;
    strict = true; lines.length = 0; read = 0;          // máy đời cũ không hiểu eventAttribute → lấy hết rồi tự lọc mã "thành công"
    await searchEvents(dev, cond, onPage);
  }
  const before = db.prepare('SELECT COUNT(*) c FROM device_punches WHERE serial=?').get(dev.serial).c;
  const CH = 2000;
  for (let i = 0; i < lines.length; i += CH) {
    prog(`Đang lưu + tính công: ${Math.min(i + CH, lines.length).toLocaleString('vi')} / ${lines.length.toLocaleString('vi')} lượt chấm…`);
    db.exec('BEGIN');
    try { ingestAttlog(dev.serial, lines.slice(i, i + CH).join('\n'), { ask: () => {} }); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    await new Promise((ok) => setImmediate(ok));
  }
  const after = db.prepare('SELECT COUNT(*) c FROM device_punches WHERE serial=?').get(dev.serial).c;
  const unmatched = db.prepare('SELECT COUNT(DISTINCT pin) c FROM device_punches WHERE serial=? AND employee_id IS NULL').get(dev.serial).c;
  db.prepare('UPDATE push_devices SET tcp_sync_at=? WHERE id=?').run(new Date().toISOString(), dev.id);
  return { read: lines.length, added: after - before, events: read, ranged: !!(from && to), unmatched };
}

/* ---------- ghi / xoá NHÂN VIÊN trên máy ---------- */
// Ghi Số ID + tên phần mềm (+ thẻ nếu đã biết) xuống máy. SetUp = có rồi thì sửa, chưa có thì thêm.
export async function hikPushUsers(dev, pins, prog = () => {}) {
  let ok = 0; const fail = [];
  for (const p of pins || []) {
    const pin = String(p || '').trim(); if (!pin) continue;
    const u = db.prepare('SELECT name, card FROM device_users WHERE pin=?').get(pin) || {};
    const name = pmNameFor(pin, true) || u.name || pin;
    const body = { UserInfo: { employeeNo: pin, name, userType: 'normal',
      Valid: { enable: true, beginTime: '2020-01-01T00:00:00', endTime: '2037-12-31T23:59:59', timeType: 'local' },
      doorRight: '1', RightPlan: [{ doorNo: 1, planTemplateNo: '1' }] } };
    try {
      try { await isapi(dev, 'PUT', '/ISAPI/AccessControl/UserInfo/SetUp?format=json', body); }
      catch (e) {   // máy đời cũ chưa có SetUp → thêm mới (Record), trùng thì sửa (Modify)
        if (e.code !== 'ISAPI') throw e;
        try { await isapi(dev, 'POST', '/ISAPI/AccessControl/UserInfo/Record?format=json', body); }
        catch (e2) { if (e2.code !== 'ISAPI') throw e2; await isapi(dev, 'PUT', '/ISAPI/AccessControl/UserInfo/Modify?format=json', body); }
      }
      if (u.card && u.card !== '0') {
        try { await isapi(dev, 'PUT', '/ISAPI/AccessControl/CardInfo/SetUp?format=json', { CardInfo: { employeeNo: pin, cardNo: String(u.card), cardType: 'normalCard' } }); }
        catch (e) { if (e.code !== 'ISAPI') throw e; }   // máy không có đầu đọc thẻ → bỏ qua thẻ
      }
      ingestUserData(dev.serial, 'USER', `USER PIN=${pin}\tName=${name}${u.card && u.card !== '0' ? '\tCard=' + u.card : ''}`);
      ok++;
    } catch (e) {
      if (e.code === 'CONN' || e.code === 'AUTH' || e.code === 'TIMEOUT') throw e;
      fail.push(pin + ': ' + e.message);
    }
    if ((ok + fail.length) % 20 === 0) prog(`Đã ghi ${ok + fail.length} / ${pins.length} nhân viên…`);
  }
  return { pushed: ok, failed: fail.length, errors: fail.slice(0, 10) };
}
export async function hikDeleteUsers(dev, pins) {
  const list = [...new Set((pins || []).map((p) => String(p || '').trim()).filter(Boolean))];
  for (let i = 0; i < list.length; i += 30) {
    const chunk = list.slice(i, i + 30);
    await isapi(dev, 'PUT', '/ISAPI/AccessControl/UserInfo/Delete?format=json', { UserInfoDelCond: { EmployeeNoList: chunk.map((employeeNo) => ({ employeeNo })) } }, { timeoutMs: 60000 });
    forgetDeviceUsers(dev.serial, chunk);
  }
  return { deleted: list.length };
}

/* ---------- điều khiển máy ---------- */
export const hikRestart = (dev) => isapi(dev, 'PUT', '/ISAPI/System/reboot');
export const hikOpenDoor = (dev) => isapi(dev, 'PUT', '/ISAPI/AccessControl/RemoteControl/door/1', '<RemoteControlDoor><cmd>open</cmd></RemoteControlDoor>');
// Đặt giờ máy = giờ máy chủ, múi giờ Việt Nam (UTC+7; ký hiệu POSIX của Hikvision: CST-7:00:00)
export function hikSetTime(dev) {
  const vn = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 19);
  return isapi(dev, 'PUT', '/ISAPI/System/time', `<?xml version="1.0" encoding="UTF-8"?><Time><timeMode>manual</timeMode><localTime>${vn}+07:00</localTime><timeZone>CST-7:00:00</timeZone></Time>`);
}

/* ---------- TỰ ĐỘNG TẢI THEO LỊCH ----------
 * Cài đặt hik_auto_min = cứ N phút tải 1 lần (0 = tắt). Mỗi lượt, từng máy Hikvision đã duyệt + bật tự tải (tuần tự):
 * đọc số lượt chấm trên máy → không đổi thì bỏ qua; đổi thì tải NV (khi số NV đổi) + tải lượt chấm từ hôm trước lần tải gần nhất. */
export const HIK_AUTO_CHOICES = [0, 5, 10, 15, 30, 60, 120, 240];
export const hikAutoMinutes = () => { const n = parseInt(getSetting('hik_auto_min', '0'), 10) || 0; return n > 0 ? Math.max(1, n) : 0; };
let autoBusy = false;
async function autoOne(d, prog = () => {}) {
  const mark = (ok, msg, extra = {}) => {
    db.prepare('UPDATE push_devices SET tcp_auto_at=?, tcp_auto_ok=?, tcp_auto_msg=?, tcp_auto_logs=COALESCE(?, tcp_auto_logs), tcp_auto_users=COALESCE(?, tcp_auto_users) WHERE id=?')
      .run(new Date().toISOString(), ok ? 1 : 0, msg, extra.logs ?? null, extra.users ?? null, d.id);
    return msg;
  };
  try {
    prog(`${d.name || d.serial}: đang kết nối…`);
    const info = await hikInfo(d);
    if (info.serial && info.serial !== d.serial) return mark(false, `IP này đang là máy khác (Serial ${info.serial})`);
    saveHikInfo(d.id, { ...(JSON.parse(d.tcp_info || '{}')), ...info });
    const logsNow = Number.isFinite(info.logs) ? info.logs : null, usersNow = Number.isFinite(info.users) ? info.users : null;
    if (logsNow != null && logsNow === d.tcp_auto_logs && (usersNow == null || usersNow === d.tcp_auto_users)) return mark(true, 'Không có lượt chấm mới');
    if (usersNow == null || usersNow !== d.tcp_auto_users) { prog(`${d.name || d.serial}: tải nhân viên…`); await hikUsers(d); }
    let added = 0;
    if (logsNow == null || logsNow !== d.tcp_auto_logs) {
      const today = vnDateStr(), last = d.tcp_sync_at ? vnDateStr(new Date(d.tcp_sync_at)) : '';
      prog(`${d.name || d.serial}: tải lượt chấm…`);
      added = (last ? await hikLogs(d, shiftDay(last, -1), today) : await hikLogs(d, '', '')).added;
    }
    return mark(true, added ? `Thêm ${added} lượt chấm mới` : 'Không có lượt chấm mới', { logs: logsNow, users: usersNow });
  } catch (e) { return mark(false, e.message || String(e)); }
}
export async function hikAutoCycle(force = false, prog = () => {}) {
  if (autoBusy) return null;
  autoBusy = true;
  try {
    const every = hikAutoMinutes() * 60000, out = [];
    for (const d of db.prepare("SELECT * FROM push_devices WHERE conn_type='hik' AND active=1 AND tcp_auto=1 ORDER BY id").all()) {
      if (!force && d.tcp_auto_at && Date.now() - Date.parse(d.tcp_auto_at) < every - 5000) continue;
      if (!hikEnabled()) break;
      out.push({ device: d.name || d.serial, msg: await autoOne(d, prog) });
    }
    return out;
  } finally { autoBusy = false; }
}
let autoTimer = null;
export function startHikScheduler() {
  if (autoTimer) return;
  autoTimer = setInterval(() => {
    if (!hikEnabled() || !hikAutoMinutes()) return;
    hikAutoCycle(false).catch((e) => console.error('[hik] tự tải lỗi:', e.message));
  }, Math.max(2000, parseInt(process.env.HIK_TICK_MS || '30000', 10) || 30000));
  autoTimer.unref();
}
