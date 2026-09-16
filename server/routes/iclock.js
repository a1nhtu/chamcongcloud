// Máy chấm công ZKTeco đẩy dữ liệu về đây (giao thức ADMS Push).
// Máy tự gọi: GET/POST /iclock/cdata, GET /iclock/getrequest, POST /iclock/devicecmd.
// KHÔNG nằm sau cổng bản quyền — máy phải kết nối được. Chỉ XỬ LÝ khi bật "Dùng máy chấm công" + máy đã duyệt.
import { Router, text } from 'express';
import { db, getSetting } from '../db.js';
import { ingestAttlog, ingestUserData, storeTemplates, storeUserPhotos, syncPinsToGroup, syncFillDevice, nextCommand, ackCommand } from '../device-sync.js';

const r = Router();
// CHỈ parse text cho các route POST của máy (KHÔNG dùng r.use để tránh nuốt body /api)
const textParser = text({ type: () => true, limit: '12mb' });

const nowIso = () => new Date().toISOString();
const enabled = () => getSetting('device_enabled', '0') === '1';

function seenDevice(serial, ip) {
  if (!serial) return;
  const d = db.prepare('SELECT id FROM push_devices WHERE serial=?').get(serial);
  if (d) db.prepare('UPDATE push_devices SET last_ip=?, last_seen=? WHERE id=?').run(ip || '', nowIso(), d.id);
  else db.prepare('INSERT INTO push_devices(serial, name, active, last_ip, last_seen) VALUES(?,?,0,?,?)').run(serial, '', ip || '', nowIso());
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
      if (enabled() && isActive(sn)) {
        try { syncFillDevice(sn); } catch (e) { console.error('[device] fill lỗi:', e.message); } // xếp lệnh đồng bộ khi máy kết nối
        return res.type('text/plain').send(initInfo(sn));
      }
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
  if (['USERINFO', 'OPERLOG', 'USER', 'FINGERTMP', 'FP', 'BIODATA', 'BIOPHOTO', 'USERPIC'].includes(table)) {
    if (enabled() && isActive(sn)) {
      const pins = new Set();
      try {
        if (table === 'OPERLOG') {
          // OPERLOG trộn nhiều loại dòng: USER (thông tin NV) + FP/BIODATA (template) + USERPIC/BIOPHOTO (ảnh)
          const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
          const userLines = lines.filter((l) => /^USER\b/i.test(l));
          const tmplLines = lines.filter((l) => /^(FP|BIODATA|FINGERTMP)\b/i.test(l));
          const photoLines = lines.filter((l) => /^(USERPIC|BIOPHOTO)\b/i.test(l));
          if (userLines.length) for (const p of ingestUserData(sn, 'USER', userLines.join('\n'))) pins.add(p);
          if (tmplLines.length) for (const p of storeTemplates(sn, 'FP', tmplLines.join('\n'))) pins.add(p);
          if (photoLines.length) for (const p of storeUserPhotos(sn, photoLines.join('\n'))) pins.add(p);
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
    return res.type('text/plain').send(`OK: ${lineCount}\n`);
  }
  // Các bảng khác (OPTIONS, ...) — nhận cho máy khỏi báo lỗi
  return res.type('text/plain').send(`OK: ${lineCount}\n`);
}

// /getrequest — máy hỏi lệnh kế tiếp (đồng bộ). Trả 'C:<id>:<content>' hoặc 'OK'.
function handleGetRequest(req, res) {
  const sn = req.query.SN || req.query.sn || '';
  seenDevice(sn, clientIp(req));
  if (enabled() && isActive(sn)) {
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
  if (id) { try { ackCommand(id, p.Return ?? '?'); } catch (e) { console.error('[device] ack lỗi:', e.message); } }
  res.type('text/plain').send('OK');
}

r.get(['/iclock/cdata', '/cdata'], handleCData);
r.post(['/iclock/cdata', '/cdata'], textParser, handleCData);
r.get(['/iclock/getrequest', '/getrequest'], handleGetRequest);
r.post(['/iclock/devicecmd', '/devicecmd'], textParser, handleDeviceCmd);
r.all(['/iclock/edata', '/iclock/fdata'], textParser, (req, res) => res.type('text/plain').send('OK'));

export default r;
