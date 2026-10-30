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
import { tenantKey, busyFlag, eachTenant } from './tenant.js';

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
function rawReq(dev, method, path, body, auth, timeoutMs, ctype) {
  return new Promise((resolve, reject) => {
    const https = Number(dev.tcp_port) === 443;
    const data = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
    const headers = { Accept: '*/*', Connection: 'close' };
    if (data) { headers['Content-Type'] = ctype || (typeof body === 'string' && body.trimStart().startsWith('<') ? 'application/xml' : 'application/json'); headers['Content-Length'] = data.length; }
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
// Dò nhanh (không đăng nhập): IP này có cổng web ISAPI của Hikvision không — máy trả 401 (đòi đăng nhập) / 200 cho deviceInfo.
// Dùng ở "Tìm máy LAN" để báo máy Hikvision thêm được bằng "Thêm máy Hikvision". Trả true / false, không ném lỗi.
export function hikKnock(ip, port = 80, ms = 2500) {
  return rawReq({ tcp_ip: ip, tcp_port: port }, 'GET', '/ISAPI/System/deviceInfo', null, null, ms)
    .then((r) => r.status === 401 || r.status === 200, () => false);
}
// Gọi 1 lệnh ISAPI. Trả { status, text, json } — json khi máy trả JSON. Lỗi → ném Error (tiếng Việt).
// body: object (gửi JSON) | chuỗi (XML / JSON) | Buffer (kèm contentType, VD multipart có ảnh).
export async function isapi(dev, method, path, body = null, { timeoutMs = 20000, okStatus = [200], contentType = '' } = {}) {
  let r = await rawReq(dev, method, path, body, null, timeoutMs, contentType);
  if (r.status === 401) {
    const ch = parseChallenge(r.headers['www-authenticate']);
    const user = dev.dev_user || 'admin', pass = dev.dev_pass || '';
    const auth = ch && ch.scheme === 'digest' ? digestAuth(ch, user, pass, method, path)
      : 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
    r = await rawReq(dev, method, path, body, auth, timeoutMs, contentType);
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
// 1 người trên máy → dòng "USER PIN=..\tName=.." (null = bỏ: Số ID rác, khách visitor, danh sách chặn)
function userLine(u) {
  const pin = String(u.employeeNo ?? '').trim();
  if (!pin || /[\s=\t]/.test(pin) || pin.length > 20) return null;
  if (u.userType && !['normal', ''].includes(String(u.userType))) return null;
  return `USER PIN=${pin}\tName=${String(u.name || '').replace(/[\t\r\n]/g, ' ').trim()}`;
}
export async function hikUsers(dev, prog = () => {}) {
  const lines = [], searchID = randomUUID();
  let pos = 0, fp = 0, face = 0, card = 0;
  for (let page = 0; page < 5000; page++) {
    const r = await isapi(dev, 'POST', '/ISAPI/AccessControl/UserInfo/Search?format=json',
      { UserInfoSearchCond: { searchID, searchResultPosition: pos, maxResults: 30 } }, { timeoutMs: 30000 });
    const s = r.json?.UserInfoSearch || {};
    const list = Array.isArray(s.UserInfo) ? s.UserInfo : [];
    for (const u of list) {
      const l = userLine(u);
      if (!l) continue;
      lines.push(l);
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

/* ---------- ẢNH KHUÔN MẶT xuống máy ----------
 * Ảnh lấy từ device_user_photos (ảnh người dùng / ảnh mặt các máy khác đã gửi về phần mềm). Máy Hikvision nhận ảnh JPG ≤ 200 KB,
 * lưu vào thư viện mặt của máy (FDLib loại "blackFD", FPID = Số ID) rồi tự dựng mẫu khuôn mặt cho người đó.
 * Tài liệu Person-Based Access Control Guide: E.186 FaceDataRecord (thêm), E.190 FDSetUp (thêm hoặc thay), F.6 / F.161. */
export const HIK_FACE_MAX = 200 * 1024;
export function hikFacePhoto(pin) {
  const p = db.prepare('SELECT photo FROM device_user_photos WHERE pin=?').get(String(pin));
  if (!p || !p.photo) return null;
  const buf = Buffer.from(p.photo, 'base64');
  return buf.length > 100 && buf[0] === 0xff && buf[1] === 0xd8 ? buf : null;   // chỉ ảnh JPG
}
function multipart(parts) {
  const b = '----Digiplus' + randomBytes(8).toString('hex');
  const chunks = [];
  for (const p of parts) {
    chunks.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${p.name}"${p.filename ? `; filename="${p.filename}"` : ''}\r\nContent-Type: ${p.type}\r\nContent-Length: ${p.data.length}\r\n\r\n`), p.data, Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${b}--\r\n`));
  return { body: Buffer.concat(chunks), type: 'multipart/form-data; boundary=' + b };
}
// Thư viện mặt của máy: lấy thư viện "blackFD" đầu tiên; máy không trả danh sách → mặc định FDID 1 (máy chấm công Hikvision)
async function faceLib(dev) {
  try {
    const r = await isapi(dev, 'GET', '/ISAPI/Intelligent/FDLib?format=json');
    const libs = Array.isArray(r.json?.FDLib) ? r.json.FDLib : [];
    const l = libs.find((x) => x.faceLibType === 'blackFD' && x.FDID) || libs.find((x) => x.FDID);
    if (l) return { FDID: String(l.FDID), faceLibType: l.faceLibType || 'blackFD' };
  } catch (e) { if (e.code !== 'ISAPI') throw e; }
  return { FDID: '1', faceLibType: 'blackFD' };
}
// máy trả HTTP 200 nhưng JSON statusCode ≠ 1 → cũng là lỗi
const statusOk = (r) => {
  const j = r.json;
  if (j && j.statusCode != null && +j.statusCode !== 1) throw Object.assign(new Error(`Máy Hikvision báo lỗi: ${j.subStatusCode || j.statusString || j.errorMsg}`), { code: 'ISAPI' });
  return r;
};
// Ghi ảnh mặt của 1 Số ID (người đó phải có trên máy rồi). false = phần mềm chưa có ảnh JPG của người này.
// ctx: dùng chung giữa nhiều người cùng 1 máy (nhớ thư viện mặt, khỏi hỏi lại máy).
export async function hikPushFace(dev, pin, ctx = {}) {
  const img = hikFacePhoto(pin);
  if (!img) return false;
  if (img.length > HIK_FACE_MAX) throw Object.assign(new Error(`ảnh khuôn mặt ${Math.round(img.length / 1024)} KB, máy chỉ nhận ảnh ≤ 200 KB`), { code: 'ISAPI' });
  ctx.lib = ctx.lib || await faceLib(dev);
  const name = pmNameFor(pin, true) || db.prepare('SELECT name FROM device_users WHERE pin=?').get(String(pin))?.name || String(pin);
  const m = multipart([
    { name: 'FaceDataRecord', type: 'application/json', data: Buffer.from(JSON.stringify({ faceLibType: ctx.lib.faceLibType, FDID: ctx.lib.FDID, FPID: String(pin), name })) },
    { name: 'FaceImage', filename: 'face.jpg', type: 'image/jpeg', data: img },
  ]);
  const opt = { contentType: m.type, timeoutMs: 30000 };
  try { statusOk(await isapi(dev, 'PUT', '/ISAPI/Intelligent/FDLib/FDSetUp?format=json', m.body, opt)); }   // có ảnh rồi thì thay, chưa có thì thêm
  catch (e) {
    if (e.code !== 'ISAPI') throw e;
    statusOk(await isapi(dev, 'POST', '/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json', m.body, opt));   // máy đời cũ chưa có FDSetUp
  }
  return true;
}

/* ---------- ghi / xoá NHÂN VIÊN trên máy ---------- */
// Ghi Số ID + tên phần mềm (+ thẻ nếu đã biết) xuống máy. SetUp = có rồi thì sửa, chưa có thì thêm.
// withFace: kèm ảnh khuôn mặt phần mềm đang có (ghi sau khi đã có người trên máy).
export async function hikPushUsers(dev, pins, prog = () => {}, { withFace = false } = {}) {
  let ok = 0, faces = 0; const fail = [], faceFail = [], ctx = {};
  for (const p of pins || []) {
    const pin = String(p || '').trim(); if (!pin) continue;
    const u = db.prepare('SELECT name, card FROM device_users WHERE pin=?').get(pin) || {};
    const name = pmNameFor(pin, true) || u.name || pin;
    const body = { UserInfo: { employeeNo: pin, name, userType: 'normal',
      Valid: { enable: true, beginTime: '2020-01-01T00:00:00', endTime: '2037-12-31T23:59:59', timeType: 'local' },
      doorRight: '1', RightPlan: [{ doorNo: 1, planTemplateNo: '1' }] } };
    let userOk = false;
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
      ok++; userOk = true;
    } catch (e) {
      if (e.code === 'CONN' || e.code === 'AUTH' || e.code === 'TIMEOUT') throw e;
      fail.push(pin + ': ' + e.message);
    }
    if (withFace && userOk) {   // ảnh mặt ghi SAU khi máy đã có người này
      try { if (await hikPushFace(dev, pin, ctx)) faces++; }
      catch (e) {
        if (e.code === 'CONN' || e.code === 'AUTH' || e.code === 'TIMEOUT') throw e;
        faceFail.push(pin + ' (ảnh mặt): ' + e.message);
      }
    }
    if ((ok + fail.length) % 20 === 0) prog(`Đã ghi ${ok + fail.length} / ${pins.length} nhân viên…`);
  }
  return { pushed: ok, failed: fail.length, faces, face_failed: faceFail.length, errors: [...fail, ...faceFail].slice(0, 10) };
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

/* ---------- MÁY TỰ GỬI LƯỢT CHẤM TỨC THÌ (HTTP Listening / HTTP host notification) ----------
 * Phần mềm ghi địa chỉ nhận lên máy (/ISAPI/Event/notification/httpHosts — Person Arming Guide D.3–D.5, E.39–E.41).
 * Từ đó mỗi sự kiện máy tự POST "EventNotificationAlert" (JSON; kèm ảnh chụp thì multipart/form-data) về
 * /hik/event/<mã bí mật của máy> (Person-Based Access Control Guide F.98 AccessControllerEvent) — route: server/routes/hik-event.js.
 * Chỉ nhận lượt XÁC THỰC THÀNH CÔNG (cùng bộ mã với lúc tải lượt chấm), đổ chung đường ingestAttlog → tính công như cũ.
 * Lượt máy gửi lại / lượt tải theo lịch sau đó tự bỏ (không trùng). */
export const HIK_EVENT_PATH = '/hik/event';
const HOST_RE = /^(?:(?:\d{1,3}\.){3}\d{1,3}|localhost|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)$/i;

// Tách các khối sự kiện (JSON hoặc XML) trong thân yêu cầu máy gửi; phần ảnh chụp kèm theo thì bỏ.
export function parseHikAlerts(contentType, buf) {
  const ct = String(contentType || ''), texts = [];
  const bm = /boundary="?([^";\s]+)"?/i.exec(ct);
  if (/multipart/i.test(ct) && bm) {
    for (const part of buf.toString('latin1').split('--' + bm[1]).slice(1)) {
      if (part.startsWith('--')) break;                    // dấu kết thúc thân
      const h = /\r?\n\r?\n/.exec(part);
      if (h && /image\/|filename=/i.test(part.slice(0, h.index))) continue;   // ảnh chụp lúc quẹt
      texts.push(Buffer.from(h ? part.slice(h.index + h[0].length) : part, 'latin1').toString('utf8'));
    }
  } else texts.push(buf.toString('utf8'));
  const out = [];
  for (const t of texts) {
    const j = t.indexOf('{'), x = t.indexOf('<');
    if (j >= 0 && (x < 0 || j < x)) {
      try { const o = JSON.parse(t.slice(j, t.lastIndexOf('}') + 1)); if (o && typeof o === 'object') out.push(o.EventNotificationAlert || o); } catch {}
    } else if (x >= 0) {   // máy để định dạng XML
      const ace = (/<AccessControllerEvent>([\s\S]*?)<\/AccessControllerEvent>/.exec(t) || [])[1];
      out.push({ macAddress: tag(t, 'macAddress'), ipAddress: tag(t, 'ipAddress'), dateTime: tag(t, 'dateTime'), eventType: tag(t, 'eventType'),
        AccessControllerEvent: ace ? { majorEventType: tag(ace, 'majorEventType'), subEventType: tag(ace, 'subEventType'), employeeNoString: tag(ace, 'employeeNoString') || tag(ace, 'employeeNo'),
          name: tag(ace, 'name'), attendanceStatus: tag(ace, 'attendanceStatus') } : null });
    }
  }
  return out;
}
// 1 sự kiện → dòng ATTLOG (null = không phải lượt xác thực thành công). Giờ = đồng hồ hiển thị trên máy, như lúc tải lượt chấm.
export function hikAlertLine(a) {
  const e = a && a.AccessControllerEvent;
  if (!e || typeof e !== 'object') return null;
  let t = String(a.dateTime || e.time || '');
  if (/Z$/i.test(t) && !isNaN(Date.parse(t))) t = new Date(Date.parse(t) + 7 * 3600e3).toISOString().slice(0, 19);   // máy gửi giờ UTC → giờ Việt Nam
  const pin = String(e.employeeNoString || (e.employeeNo != null ? e.employeeNo : '')).trim();
  return hikEventLine({ employeeNoString: pin, major: e.majorEventType, minor: e.subEventType, time: t, attendanceStatus: e.attendanceStatus }, true);
}
const normMac = (s) => String(s || '').toLowerCase().replace(/[^0-9a-f]/g, '');
// Máy nào gửi? Địa chỉ có mã → đúng máy giữ mã đó. Không mã (điền tay trên máy, chỉ dùng trong LAN): IP thật của kết nối
// phải là IP máy đã khai, và MAC trong sự kiện khớp MAC đã đọc từ máy (nếu đã biết).
function hikPushDevice(token, alerts, remoteIp) {
  if (token) return db.prepare("SELECT * FROM push_devices WHERE conn_type='hik' AND hik_push_token<>'' AND hik_push_token=?").get(String(token)) || null;
  const ip = String(remoteIp || '').replace(/^::ffff:/i, '');
  const macs = new Set(alerts.map((a) => normMac(a.macAddress)).filter(Boolean));
  for (const d of db.prepare("SELECT * FROM push_devices WHERE conn_type='hik' AND tcp_ip=?").all(ip)) {
    let mac = ''; try { mac = normMac(JSON.parse(d.tcp_info || '{}').mac); } catch {}
    if (!mac || !macs.size || macs.has(mac)) return d;
  }
  return null;
}
function addDeviceUsers(serial, lines) {
  try { guardIncoming(serial, 'USER', lines.join('\n'), { realtime: false }); } catch (e) { console.error('[pin-guard] kiểm trùng lỗi:', e.message); }
  ingestUserData(serial, 'USER', lines.join('\n'));
}
// Hỏi máy tên các Số ID lạ (tối đa 30 / lần) → tạo NV nháp (nếu bật "Tự tạo NV") + gán các lượt chấm vừa nhận
export async function hikFetchUsers(dev, pins) {
  const r = await isapi(dev, 'POST', '/ISAPI/AccessControl/UserInfo/Search?format=json',
    { UserInfoSearchCond: { searchID: randomUUID(), searchResultPosition: 0, maxResults: 30, EmployeeNoList: pins.slice(0, 30).map((p) => ({ employeeNo: String(p) })) } });
  const list = r.json?.UserInfoSearch?.UserInfo;
  const lines = (Array.isArray(list) ? list : []).map(userLine).filter(Boolean);
  if (lines.length) addDeviceUsers(dev.serial, lines);
  return lines.length;
}
const askedAt = new Map();   // serial|pin → lúc hỏi máy tên người lạ gần nhất (khỏi hỏi dồn mỗi lượt quẹt)
// Nhận 1 lần máy gửi. Trả { device: serial | null, added, pending }. device null = không biết máy nào (route trả 404).
export function hikReceive({ token = '', contentType = '', body, remoteIp = '' } = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''), 'utf8');
  const alerts = parseHikAlerts(contentType, buf);
  const d = hikPushDevice(token, alerts, remoteIp);
  if (!d) return { device: null };
  const now = new Date().toISOString();
  db.prepare('UPDATE push_devices SET last_seen=?, hik_push_at=? WHERE id=?').run(now, now, d.id);
  if (!d.active) return { device: d.serial, pending: true, added: 0 };   // chờ duyệt: chưa nhận lượt chấm
  const lines = [], names = new Map();
  for (const a of alerts) {
    const l = hikAlertLine(a);
    if (!l) continue;
    lines.push(l);
    const nm = String(a.AccessControllerEvent.name || '').replace(/[\t\r\n]/g, ' ').trim();
    if (nm) names.set(l.split('\t')[0], nm);
  }
  if (!lines.length) return { device: d.serial, added: 0 };   // nhịp tim / sự kiện cửa / xác thực thất bại
  const unknown = new Set();
  const count = () => db.prepare('SELECT COUNT(*) c FROM device_punches WHERE serial=?').get(d.serial).c;
  const before = count();
  ingestAttlog(d.serial, lines.join('\n'), { ask: (s, pin) => unknown.add(pin) });
  const added = count() - before;
  // Số ID chưa khớp NV: sự kiện kèm tên → tạo NV ngay (như lúc tải NV từ máy); không kèm tên → hỏi máy (chạy nền)
  const ask = [];
  for (const pin of unknown) {
    if (names.has(pin)) addDeviceUsers(d.serial, [`USER PIN=${pin}\tName=${names.get(pin)}`]);
    else { const k = tenantKey() + '|' + d.serial + '|' + pin; if (Date.now() - (askedAt.get(k) || 0) > 10 * 60000) { askedAt.set(k, Date.now()); ask.push(pin); } }
  }
  if (ask.length) hikFetchUsers(d, ask).catch((e) => console.error('[hik] hỏi tên NV từ máy lỗi:', e.message));
  return { device: d.serial, added };
}
// Các ô địa chỉ nhận đang có trên máy
function parseHttpHosts(xml) {
  return [...String(xml || '').matchAll(/<HttpHostNotification\b[^>]*>([\s\S]*?)<\/HttpHostNotification>/g)]
    .map((m) => ({ id: tag(m[1], 'id'), url: tag(m[1], 'url'), ipAddress: tag(m[1], 'ipAddress'), hostName: tag(m[1], 'hostName'), portNo: tag(m[1], 'portNo'), raw: m[0] }))
    .filter((h) => h.id);
}
// Cài địa chỉ nhận lên máy. host = IP LAN / tên miền của máy chủ phần mềm, port = cổng phần mềm (443 = HTTPS).
// Ô đã trỏ về phần mềm Digiplus → ghi đè; không thì dùng ô còn trống; hết ô → báo người dùng tự xoá bớt trên máy
// (KHÔNG tự xoá địa chỉ của phần mềm khác). Xong nhờ máy gửi thử 1 tin.
export async function hikSetupPush(dev, { host, port } = {}) {
  host = String(host || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/:].*$/, '');
  const p = parseInt(port, 10);
  if (!HOST_RE.test(host) || host.length > 100) throw Object.assign(new Error('Địa chỉ máy chủ không hợp lệ (VD 192.168.1.10 hoặc abc.maychamcongcloud.com)'), { code: 'INPUT' });
  if (!(p > 0 && p < 65536)) throw Object.assign(new Error('Cổng không hợp lệ'), { code: 'INPUT' });
  let token = db.prepare('SELECT hik_push_token t FROM push_devices WHERE id=?').get(dev.id)?.t || '';
  if (!token) { token = randomBytes(16).toString('hex'); db.prepare('UPDATE push_devices SET hik_push_token=? WHERE id=?').run(token, dev.id); }
  const path = `${HIK_EVENT_PATH}/${token}`, https = p === 443, isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(host);
  let list;
  try { list = parseHttpHosts((await isapi(dev, 'GET', '/ISAPI/Event/notification/httpHosts')).text); }
  catch (e) { if (e.code === 'ISAPI') throw Object.assign(new Error('Máy này không hỗ trợ tự gửi sự kiện qua HTTP (HTTP Listening) — dùng "Tự động tải" theo lịch.'), { code: 'ISAPI' }); throw e; }
  const free = (h) => !h.hostName && (!h.ipAddress || h.ipAddress === '0.0.0.0');
  const slot = list.find((h) => h.url.includes(HIK_EVENT_PATH)) || list.find(free) || (list.length ? null : { id: '1' });
  if (!slot) throw Object.assign(new Error(`Máy đã dùng hết ${list.length} ô địa chỉ nhận cho phần mềm khác (${list.map((h) => (h.hostName || h.ipAddress) + (h.portNo ? ':' + h.portNo : '')).join(', ')}). Vào trang web của máy (Network → Advanced → HTTP Listening) xoá bớt 1 ô rồi bấm lại.`), { code: 'FULL' });
  const XML = '<?xml version="1.0" encoding="UTF-8"?>';
  const node = `<HttpHostNotification version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"><id>${slot.id}</id><url>${path}</url><protocolType>${https ? 'HTTPS' : 'HTTP'}</protocolType>` +
    `<parameterFormatType>JSON</parameterFormatType><addressingFormatType>${isIp ? 'ipaddress' : 'hostname'}</addressingFormatType>${isIp ? `<ipAddress>${host}</ipAddress>` : `<hostName>${host}</hostName>`}` +
    `<portNo>${p}</portNo><httpAuthenticationMethod>none</httpAuthenticationMethod></HttpHostNotification>`;
  const at = '/ISAPI/Event/notification/httpHosts/' + encodeURIComponent(slot.id);
  try { await isapi(dev, 'PUT', at, XML + node); }
  catch (e) {   // máy chỉ nhận ghi CẢ danh sách → giữ nguyên các ô khác
    if (e.code !== 'ISAPI') throw e;
    const others = list.filter((h) => h.id !== slot.id).map((h) => h.raw);
    await isapi(dev, 'PUT', '/ISAPI/Event/notification/httpHosts', `${XML}<HttpHostNotificationList version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">${[...others, node].join('')}</HttpHostNotificationList>`);
  }
  let test = '';   // '' = máy không có lệnh gửi thử
  try { const t = await isapi(dev, 'POST', at + '/test', XML + node, { timeoutMs: 15000 }); test = tag(t.text, 'errorDescription') || 'ok'; }
  catch (e) { if (e.code === 'CONN' || e.code === 'AUTH') throw e; test = e.code === 'ISAPI' && e.status === 404 ? '' : e.message; }
  const url = `${https ? 'https' : 'http'}://${host}${p === (https ? 443 : 80) ? '' : ':' + p}${path}`;
  db.prepare('UPDATE push_devices SET hik_push_url=? WHERE id=?').run(url, dev.id);
  return { slot: slot.id, url, test };
}

/* ---------- TỰ ĐỘNG TẢI THEO LỊCH ----------
 * Cài đặt hik_auto_min = cứ N phút tải 1 lần (0 = tắt). Mỗi lượt, từng máy Hikvision đã duyệt + bật tự tải (tuần tự):
 * đọc số lượt chấm trên máy → không đổi thì bỏ qua; đổi thì tải NV (khi số NV đổi) + tải lượt chấm từ hôm trước lần tải gần nhất. */
export const HIK_AUTO_CHOICES = [0, 5, 10, 15, 30, 60, 120, 240];
export const hikAutoMinutes = () => { const n = parseInt(getSetting('hik_auto_min', '0'), 10) || 0; return n > 0 ? Math.max(1, n) : 0; };
const autoBusy = busyFlag();
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
  if (!autoBusy.take()) return null;
  try {
    const every = hikAutoMinutes() * 60000, out = [];
    for (const d of db.prepare("SELECT * FROM push_devices WHERE conn_type='hik' AND active=1 AND tcp_auto=1 ORDER BY id").all()) {
      if (!force && d.tcp_auto_at && Date.now() - Date.parse(d.tcp_auto_at) < every - 5000) continue;
      if (!hikEnabled()) break;
      out.push({ device: d.name || d.serial, msg: await autoOne(d, prog) });
    }
    return out;
  } finally { autoBusy.done(); }
}
let autoTimer = null;
export function startHikScheduler() {
  if (autoTimer) return;
  autoTimer = setInterval(() => eachTenant(() => {
    if (!hikEnabled() || !hikAutoMinutes()) return;
    return hikAutoCycle(false).catch((e) => console.error('[hik] tự tải lỗi:', e.message));
  }), Math.max(2000, parseInt(process.env.HIK_TICK_MS || '30000', 10) || 30000));
  autoTimer.unref();
}
