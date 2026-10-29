// Máy chấm công ZKTeco đẩy dữ liệu về đây (giao thức ADMS Push).
// Máy tự gọi: GET/POST /iclock/cdata, GET /iclock/getrequest, POST /iclock/devicecmd.
// KHÔNG nằm sau cổng bản quyền — máy phải kết nối được. Chỉ XỬ LÝ khi bật "Dùng máy chấm công" + máy đã duyệt.
import { Router, text } from 'express';
import { db, getSetting } from '../db.js';
import { guardIncoming } from '../pin-guard.js';
import { ingestAttlog, ingestUserData, storeTemplates, storeUserPhotos, storeDeviceOplogs, syncPinsToGroup, syncFillDevice, nextCommand, ackCommand, storeClockResult, queryDeviceAttlog, resendLostAttlogQueries } from '../device-sync.js';
import { vnDateStr } from '../util.js';

const r = Router();
// CHỈ parse text cho các route POST của máy (KHÔNG dùng r.use để tránh nuốt body /api)
const textParser = text({ type: () => true, limit: '12mb' });

const nowIso = () => new Date().toISOString();
const enabled = () => getSetting('device_enabled', '0') === '1';

// Máy NỐI LẠI sau quãng mất liên lạc (mất mạng / máy chủ tắt) quá GAP_MS: máy KHÔNG tự gửi bù lượt quẹt trong quãng đó
// (mốc ATTLOGStamp của máy thật kẹt 9999 từ lúc chờ duyệt → máy chỉ gửi lượt mới) → tự ra lệnh tải lại log
// từ NGÀY mất liên lạc tới hôm nay (tối đa 31 ngày). Lượt đã có thì bỏ qua (UNIQUE serial+pin+punch_at).
const GAP_MS = 5 * 60000;
function seenDevice(serial, ip) {
  if (!serial) return;
  const d = db.prepare('SELECT id, active, last_seen FROM push_devices WHERE serial=?').get(serial);
  if (d) db.prepare('UPDATE push_devices SET last_ip=?, last_seen=? WHERE id=?').run(ip || '', nowIso(), d.id);
  else db.prepare('INSERT INTO push_devices(serial, name, active, last_ip, last_seen) VALUES(?,?,0,?,?)').run(serial, '', ip || '', nowIso());
  const lastMs = d && d.last_seen ? Date.parse(d.last_seen) : NaN;
  if (d && d.active === 1 && enabled() && Date.now() - lastMs > GAP_MS) {
    const from = vnDateStr(new Date(Math.max(lastMs, Date.now() - 31 * 86400e3)));
    try { queryDeviceAttlog(serial, from, vnDateStr()); } catch (e) { console.error('[device] tải bù log lỗi:', e.message); }
  }
}
function isActive(serial) {
  const d = db.prepare('SELECT active FROM push_devices WHERE serial=?').get(serial);
  return !!(d && d.active === 1);
}
function initInfo(serial) {
  const d = db.prepare('SELECT att_stamp, oper_stamp FROM push_devices WHERE serial=?').get(serial);
  // TransFlag bật đẩy real-time: chấm công (AttLog), thao tác (OpLog),
  // đăng ký/sửa nhân viên (EnrollUser/ChgUser) và vân tay (EnrollFP/ChgFP), ảnh (UserPic).
  return `GET OPTION FROM:${serial}\n` +
    `ATTLOGStamp=${d?.att_stamp || '0'}\n` +
    `OPERLOGStamp=${d?.oper_stamp || '0'}\n` +
    `ErrorDelay=30\n` +
    `Delay=10\n` +
    `TimeZone=7\n` +
    `TransTimes=00:00;14:05\n` +
    `TransInterval=1\n` +
    `TransFlag=TransData AttLog OpLog EnrollUser ChgUser EnrollFP ChgFP UserPic BioData BioPhoto FACE\n` +
    `Realtime=1\n` +
    `Encrypt=0\n` +
    `ServerVer=2.4.1\n` +
    `PushProtVer=2.4.1\n` +
    `ServerName=Digiplus Server\n`;
}
// Máy CHƯA duyệt: chỉ gửi cấu hình tối thiểu để máy nhận ĐÚNG MÚI GIỜ (+7). Nếu không gửi, máy lấy giờ
// máy chủ nhưng tính theo múi giờ mặc định của hãng (+8) → nhanh 1 tiếng. KHÔNG bật đẩy dữ liệu
// (TransFlag rỗng, stamp lớn) — khi được duyệt máy sẽ khởi động lại và bắt tay đầy đủ bằng initInfo.
function pendingInfo(serial) {
  return `GET OPTION FROM:${serial}\n` +
    `ATTLOGStamp=9999\n` +
    `OPERLOGStamp=9999\n` +
    `ErrorDelay=30\n` +
    `Delay=10\n` +
    `TimeZone=7\n` +
    `TransTimes=00:00\n` +
    `TransInterval=0\n` +
    `TransFlag=\n` +
    `Realtime=0\n` +
    `Encrypt=0\n` +
    `ServerVer=2.4.1\n` +
    `PushProtVer=2.4.1\n` +
    `ServerName=Digiplus Server\n`;
}
// Tham số máy gửi, không phân biệt hoa thường (pushver / PushVersion..., INFO / info)
const queryParam = (req, ...names) => {
  for (const [k, v] of Object.entries(req.query || {})) if (names.includes(k.toLowerCase())) return String(v || '').trim();
  return '';
};
const clientIp = (req) => (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim();

// /cdata + /iclock/cdata
function handleCData(req, res) {
  const sn = req.query.SN || req.query.sn || '';
  const table = String(req.query.table || '').toUpperCase();
  const stamp = req.query.Stamp || req.query.stamp || '0';
  const options = String(req.query.options || '');
  seenDevice(sn, clientIp(req));

  if (req.method === 'GET') {
    if (options.toLowerCase() === 'all') {
      // Bắt tay: máy đời mới khai pushver, đời cũ không khai → ghi lại để chọn đúng cách tải NV (xem queryDeviceUsers)
      if (sn) db.prepare('UPDATE push_devices SET push_ver=? WHERE serial=?').run(queryParam(req, 'pushver').slice(0, 20) || '-', sn);
      if (enabled() && isActive(sn)) {
        try { syncFillDevice(sn); } catch (e) { console.error('[device] fill lỗi:', e.message); } // xếp lệnh đồng bộ khi máy kết nối
        return res.type('text/plain').send(initInfo(sn));
      }
      if (enabled() && sn) return res.type('text/plain').send(pendingInfo(sn));   // chờ duyệt: chỉ gửi múi giờ
      return res.type('text/plain').send('OK');
    }
    return res.type('text/plain').send('OK');
  }
  // POST
  const body = typeof req.body === 'string' ? req.body : '';
  const lineCount = body.split('\n').filter((l) => l.trim()).length;
  if (table === 'ATTLOG') {
    if (enabled() && isActive(sn)) {
      try { ingestAttlog(sn, body); } catch (e) { console.error('[device] ingest lỗi:', e.message); }
      if (sn) db.prepare('UPDATE push_devices SET att_stamp=? WHERE serial=?').run(String(stamp), sn);
    }
    return res.type('text/plain').send(`OK: ${lineCount}\n`);
  }
  // Đăng ký nhân viên / vân tay / khuôn mặt: máy đẩy qua USERINFO, OPERLOG, BIODATA, FINGERTMP...
  // → tạo NV + lưu template, rồi đồng bộ real-time sang các máy cùng nhóm.
  if (USER_TABLES.includes(table)) {
    ingestUserTables(sn, table, body, stamp);
    return res.type('text/plain').send(`OK: ${lineCount}\n`);
  }
  // Các bảng khác (OPTIONS, ...) — nhận cho máy khỏi báo lỗi
  return res.type('text/plain').send(`OK: ${lineCount}\n`);
}

const USER_TABLES = ['USERINFO', 'OPERLOG', 'USER', 'FINGERTMP', 'FP', 'BIODATA', 'BIOPHOTO', 'USERPIC'];
function ingestUserTables(sn, table, body, stamp) {
    if (enabled() && isActive(sn)) {
      const pins = new Set();
      try {
        // Cảnh báo trùng Số ID (nếu bật): kiểm TRƯỚC khi lưu để người lạ không đè dữ liệu / không bị đồng bộ đi
        try { guardIncoming(sn, table, body); } catch (e) { console.error('[pin-guard] kiểm trùng lỗi:', e.message); }
        if (table === 'OPERLOG') {
          // OPERLOG trộn nhiều loại dòng: USER (thông tin NV) + FP/BIODATA (template) + USERPIC/BIOPHOTO (ảnh)
          const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
          const userLines = lines.filter((l) => /^USER\b/i.test(l));
          const tmplLines = lines.filter((l) => /^(FP|BIODATA|FINGERTMP)\b/i.test(l));
          const photoLines = lines.filter((l) => /^(USERPIC|BIOPHOTO)\b/i.test(l));
          const oplogLines = lines.filter((l) => /^OPLOG\b/i.test(l));   // nhật ký thao tác trên máy
          if (userLines.length) for (const p of ingestUserData(sn, 'USER', userLines.join('\n'))) pins.add(p);
          if (tmplLines.length) for (const p of storeTemplates(sn, 'FP', tmplLines.join('\n'))) pins.add(p);
          if (photoLines.length) for (const p of storeUserPhotos(sn, photoLines.join('\n'))) pins.add(p);
          if (oplogLines.length) storeDeviceOplogs(sn, oplogLines.join('\n'));
          if (sn) db.prepare('UPDATE push_devices SET oper_stamp=? WHERE serial=?').run(String(stamp), sn);
        } else if (table === 'BIOPHOTO' || table === 'USERPIC') {
          for (const p of storeUserPhotos(sn, body)) pins.add(p);
        } else if (table === 'BIODATA' || table === 'FINGERTMP' || table === 'FP') {
          for (const p of storeTemplates(sn, table, body)) pins.add(p);
        } else { // USERINFO / USER
          for (const p of ingestUserData(sn, table, body)) pins.add(p);
        }
        if (pins.size) syncPinsToGroup(sn, pins);   // đẩy sang máy cùng nhóm
      } catch (e) { console.error('[device] sync lỗi:', e.message); }
    }
}

// /querydata — máy ZK đời mới trả lời lệnh DATA QUERY (tải NV / vân tay / khuôn mặt) qua đường này thay vì /cdata:
// POST /iclock/querydata?SN=..&type=tabledata&cmdid=..&tablename=user&count=..&packcnt=..&packidx=..
// Dòng dạng "user uid=1<TAB>cardno=..<TAB>pin=1<TAB>password=..<TAB>name=..<TAB>privilege=0". Trước đây không có
// đường này → máy nhận 404, danh sách NV mất giữa đường (nhahanggiadinh 29/10/2026: bấm tải NV báo đã gửi mà không ra NV).
// Đổi về đúng dạng dòng như /cdata rồi dùng chung bộ xử lý.
const QD_TABLE = { user: 'USERINFO', userinfo: 'USERINFO', fingertmp: 'FINGERTMP', templatev10: 'BIODATA', biodata: 'BIODATA', biophoto: 'BIOPHOTO', userpic: 'USERPIC' };
const QD_KEY = { cardno: 'Card', password: 'Passwd', privilege: 'Pri', fingerid: 'FID', template: 'Tmp', size: 'Size' };
export function queryDataToCData(tablename, body) {
  const table = QD_TABLE[String(tablename || '').toLowerCase()];
  if (!table) return null;
  const v10 = String(tablename).toLowerCase() === 'templatev10';   // vân tay ZKFinger 10 → lưu như BIODATA loại 1 (vân tay)
  const lines = String(body || '').split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    line = line.replace(/^(user|userinfo|fingertmp|templatev10|biodata|biophoto|userpic)\b\s*/i, '');
    const parts = line.split('\t').map((part) => {
      const eq = part.indexOf('=');
      if (eq <= 0) return part;
      const k = part.slice(0, eq).trim();
      const nk = QD_KEY[k.toLowerCase()];
      if (v10 && k.toLowerCase() === 'fingerid') return `No=${part.slice(eq + 1)}`;
      return nk ? `${nk}=${part.slice(eq + 1)}` : part;
    });
    if (v10) parts.push('Type=1', 'MajorVer=10');
    return `${table} ${parts.join('\t')}`;
  });
  return { table, body: lines.join('\n'), count: lines.length };
}
function handleQueryData(req, res) {
  const sn = req.query.SN || req.query.sn || '';
  seenDevice(sn, clientIp(req));
  const body = typeof req.body === 'string' ? req.body : '';
  const tablename = String(req.query.tablename || '');
  const c = queryDataToCData(tablename, body);
  if (c) ingestUserTables(sn, c.table, c.body, null);
  else if (body.trim()) console.warn(`[device] ${sn} querydata bảng chưa hỗ trợ: ${tablename}`);
  res.type('text/plain').send(`${tablename}=${c ? c.count : 0}`);
}

// /getrequest — máy hỏi lệnh kế tiếp (đồng bộ). Trả 'C:<id>:<content>' hoặc 'OK'.
function handleGetRequest(req, res) {
  const sn = req.query.SN || req.query.sn || '';
  seenDevice(sn, clientIp(req));
  // Máy gửi kèm INFO=Ver 6.60 Apr 28 2016,số NV,số vân tay,số lượt,... → giữ phiên bản firmware để xem đời máy
  const info = queryParam(req, 'info');
  if (sn && info) db.prepare('UPDATE push_devices SET firmware=? WHERE serial=?').run(info.split(',')[0].trim().slice(0, 60), sn);
  if (enabled() && isActive(sn)) {
    try { resendLostAttlogQueries(sn); } catch (e) { console.error('[device] gửi lại lệnh tải log lỗi:', e.message); }
    try { const cmd = nextCommand(sn); if (cmd) return res.type('text/plain').send(cmd); }
    catch (e) { console.error('[device] getrequest lỗi:', e.message); }
  }
  res.type('text/plain').send('OK');
}

// /devicecmd — máy báo kết quả thực hiện lệnh: body dạng 'ID=123&Return=0&Cmd=...'
function handleDeviceCmd(req, res) {
  const body = typeof req.body === 'string' ? req.body : '';
  const p = {};
  for (const pair of body.split('&')) { const i = pair.indexOf('='); if (i > 0) p[pair.slice(0, i).trim()] = pair.slice(i + 1).trim(); }
  const id = parseInt(p.ID || req.query.ID || '0', 10);
  if (id) { try { ackCommand(id, p.Return ?? '?'); storeClockResult(id, body); } catch (e) { console.error('[device] ack lỗi:', e.message); } }
  res.type('text/plain').send('OK');
}

r.get(['/iclock/cdata', '/cdata'], handleCData);
r.post(['/iclock/cdata', '/cdata'], textParser, handleCData);
r.get(['/iclock/getrequest', '/getrequest'], handleGetRequest);
r.post(['/iclock/devicecmd', '/devicecmd'], textParser, handleDeviceCmd);
r.post(['/iclock/querydata', '/querydata'], textParser, handleQueryData);
r.all(['/iclock/edata', '/iclock/fdata'], textParser, (req, res) => res.type('text/plain').send('OK'));
// Đường máy gọi mà phần mềm chưa biết: ghi log (mỗi đường 1 lần/giờ) để lần sau tra được, trả OK cho máy khỏi gửi lại mãi
const unknownSeen = new Map();
r.all('/iclock/*', textParser, (req, res) => {
  const key = req.path;
  if (Date.now() - (unknownSeen.get(key) || 0) > 3600e3) {
    unknownSeen.set(key, Date.now());
    console.warn(`[device] ${req.query.SN || req.query.sn || '?'} gọi đường chưa hỗ trợ: ${req.method} ${req.originalUrl.slice(0, 200)}`);
  }
  res.type('text/plain').send('OK');
});

export default r;
// Cho test gọi thẳng (giả lập máy đẩy dữ liệu)
export { handleCData, handleGetRequest, handleDeviceCmd, handleQueryData };
