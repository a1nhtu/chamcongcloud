// ĐƯỜNG TRUYỀN WEBSOCKET cho máy chấm công AI (RFC 6455, tự viết bằng node:crypto — KHÔNG thêm thư viện npm,
// vì nút "Cập nhật phần mềm" chỉ chép code, không cài thêm gói). Gắn vào CHÍNH cổng web của phần mềm (VD 8686):
// trên máy điền IP / tên miền + cổng của phần mềm là kết nối được (máy chỉ chạy ws:// không mã hoá).
// Nội dung giao thức (máy gửi gì → lưu gì) ở server/ai-device.js. Công tắc ai_device_enabled tắt → từ chối mọi kết nối.
import { createHash } from 'node:crypto';
import { db } from './db.js';
import { vnNowStr } from './device-sync.js';
import { aiEnabled, parseMsg, onReg, onSendlog, onSenduser, onReply, nextAiCommand, requeueCmd, finishCmd } from './ai-device.js';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MSG = 32 * 1024 * 1024;   // 1 tin tối đa 32MB (lượt chấm / mẫu khuôn mặt kèm ảnh base64)
const REPLY_MS = Number(process.env.AI_REPLY_MS || 60000);   // máy không trả lời lệnh trong 60 giây → bỏ lệnh đó, gửi lệnh kế
const IDLE_MS = 180000;                                      // 3 phút không nhận được gì (kể cả pong) → đóng kết nối
const TICK_MS = Number(process.env.AI_TICK_MS || 5000);

const sessions = new Map();   // serial → Session (máy đã đăng ký + đã duyệt đang kết nối)
// Máy đang giữ kết nối (kể cả máy đã đăng ký nhưng còn Chờ duyệt)
export const aiOnline = (serial) => sessions.has(serial) || [...all].some((s) => s.serial === serial && !s.closed);
// Có lệnh mới xếp cho máy → gửi ngay (khỏi chờ nhịp 5 giây)
export function aiPoke(serial) { const s = sessions.get(serial); if (s) s.pump(); }
// Vừa duyệt / tạm dừng máy → ngắt để máy kết nối + đăng ký lại (nhận kết quả duyệt mới)
export function aiKick(serial) { for (const s of [...all]) if (s.serial === serial) s.close(1012); }

/* ---------- khung WebSocket ---------- */
export function encodeFrame(payload, opcode = 1) {
  const len = payload.length;
  let head;
  if (len < 126) head = Buffer.from([0x80 | opcode, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, payload]);
}
// Tách các khung trọn vẹn trong buf. Trả { frames:[{fin,opcode,payload}], rest } (rest = phần chưa đủ 1 khung).
export function decodeFrames(buf) {
  const frames = [];
  let off = 0;
  while (buf.length - off >= 2) {
    const b0 = buf[off], b1 = buf[off + 1];
    let len = b1 & 0x7f, p = off + 2;
    if (len === 126) { if (buf.length < p + 2) break; len = buf.readUInt16BE(p); p += 2; }
    else if (len === 127) { if (buf.length < p + 8) break; const big = buf.readBigUInt64BE(p); if (big > BigInt(MAX_MSG)) throw new Error('khung quá lớn'); len = Number(big); p += 8; }
    const masked = (b1 & 0x80) !== 0;
    if (buf.length < p + (masked ? 4 : 0) + len) break;
    let payload;
    if (masked) {
      const mask = buf.subarray(p, p + 4); p += 4;
      payload = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) payload[i] = buf[p + i] ^ mask[i & 3];
    } else payload = Buffer.from(buf.subarray(p, p + len));
    p += len;
    frames.push({ fin: (b0 & 0x80) !== 0, opcode: b0 & 0x0f, payload });
    off = p;
  }
  return { frames, rest: buf.subarray(off) };
}
const closeFrame = (code) => { const b = Buffer.alloc(2); b.writeUInt16BE(code, 0); return encodeFrame(b, 8); };

/* ---------- 1 kết nối máy ---------- */
class Session {
  constructor(socket, ip) {
    this.s = socket; this.ip = ip; this.buf = Buffer.alloc(0); this.frag = null;
    this.serial = null; this.active = false; this.fl = null;   // fl = lệnh đang chờ máy trả lời
    this.lastRx = Date.now(); this.lastPing = Date.now(); this.lastSeenDb = 0; this.closed = false;
    socket.setNoDelay(true); socket.setKeepAlive(true, 30000);
    socket.on('data', (d) => this.onData(d));
    socket.on('close', () => this.cleanup());
    socket.on('error', () => this.cleanup());
    all.add(this);
  }
  send(obj) {
    if (this.closed) return;
    try { this.s.write(encodeFrame(Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf8'), 1)); } catch {}
  }
  onData(d) {
    this.lastRx = Date.now();
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    if (this.buf.length > MAX_MSG + 16) return this.close(1009);
    let r; try { r = decodeFrames(this.buf); } catch { return this.close(1009); }
    this.buf = r.rest.length ? Buffer.from(r.rest) : Buffer.alloc(0);
    for (const f of r.frames) { if (this.closed) break; this.onFrame(f); }
  }
  onFrame(f) {
    if (f.opcode === 8) return this.close(1000);
    if (f.opcode === 9) { try { this.s.write(encodeFrame(f.payload, 10)); } catch {} return; }
    if (f.opcode === 10) return;
    if (f.opcode === 1 || f.opcode === 2) { if (f.fin) this.onText(f.payload); else this.frag = [f.payload]; return; }
    if (f.opcode === 0 && this.frag) {
      this.frag.push(f.payload);
      if (this.frag.reduce((n, b) => n + b.length, 0) > MAX_MSG) return this.close(1009);
      if (f.fin) { const p = Buffer.concat(this.frag); this.frag = null; this.onText(p); }
    }
  }
  onText(buf) {
    let m; try { m = parseMsg(buf.toString('utf8')); } catch { return; }
    if (!m || typeof m !== 'object' || Array.isArray(m)) return;
    try { this.handle(m); } catch (e) { console.error('[ai-ws]', this.serial || this.ip, 'xử lý tin lỗi:', e.message); }
  }
  handle(m) {
    const cmd = String(m.cmd ?? '').trim().toLowerCase(), ret = String(m.ret ?? '').trim().toLowerCase();
    if (cmd === 'reg') {
      const r = onReg(m, this.ip);
      this.send(r.reply);
      if (!r.serial) return;
      const old = sessions.get(r.serial);
      if (old && old !== this) old.close(1000);   // máy kết nối lại → bỏ kết nối cũ
      this.serial = r.serial; this.active = r.ok;
      if (r.ok) { sessions.set(r.serial, this); this.pump(); }
      return;
    }
    if (!this.serial || !this.active) { if (cmd) this.send({ ret: cmd, result: false, reason: 1 }); return; }   // chưa đăng ký / chưa duyệt
    this.touch();
    if (cmd === 'sendlog') { this.send(onSendlog(this.serial, m)); return this.pump(); }     // pump: gửi ngay lệnh hỏi tên Số ID lạ (nếu có)
    if (cmd === 'senduser') { this.send(onSenduser(this.serial, m)); return this.pump(); }
    if (cmd) return this.send({ ret: cmd, result: true, cloudtime: vnNowStr() });   // tin lạ máy gửi → báo đã nhận để máy khỏi gửi lại
    if (ret && this.fl && ret === this.fl.obj.cmd) {
      const r = onReply(this.serial, this.fl, m);
      if (r.more) { this.fl.at = Date.now(); this.send({ cmd: this.fl.obj.cmd, stn: false }); return; }   // xin trang kế
      this.fl = null; this.pump();
    }
  }
  touch() {   // ghi "kết nối gần nhất" (tối đa 1 lần / 20 giây)
    if (Date.now() - this.lastSeenDb < 20000) return;
    this.lastSeenDb = Date.now();
    try { db.prepare('UPDATE push_devices SET last_seen=?, last_ip=? WHERE serial=?').run(new Date().toISOString(), this.ip, this.serial); } catch {}
  }
  // Gửi lệnh kế tiếp trong hàng đợi (mỗi lúc 1 lệnh — máy trả lời xong mới gửi lệnh sau)
  pump() {
    if (this.closed || this.fl || !this.active || !aiEnabled()) return;
    const c = nextAiCommand(this.serial);
    if (!c) return;
    this.fl = { id: c.id, obj: c.obj, at: Date.now() };
    this.send(c.obj);
    if (c.obj.cmd === 'reboot') { finishCmd(c.id, 0); this.fl = null; }   // máy khởi động lại ngay, không trả lời
  }
  tick() {
    if (this.closed) return;
    if (!aiEnabled()) return this.close(1001);   // vừa tắt công tắc máy AI
    const now = Date.now();
    if (now - this.lastRx > IDLE_MS) return this.close(1001);
    if (this.fl && now - this.fl.at > REPLY_MS) { finishCmd(this.fl.id, 'timeout'); this.fl = null; }
    if (now - this.lastPing > 30000) { this.lastPing = now; try { this.s.write(encodeFrame(Buffer.alloc(0), 9)); } catch {} }
    this.pump();
  }
  close(code = 1000) {
    if (this.closed) return;
    try { this.s.end(closeFrame(code)); } catch {}
    const s = this.s; setTimeout(() => { try { s.destroy(); } catch {} }, 1000).unref();
    this.cleanup();
  }
  cleanup() {
    if (this.closed && !all.has(this)) return;
    this.closed = true; all.delete(this);
    if (this.fl) { requeueCmd(this.fl.id); this.fl = null; }   // lệnh đang gửi dở → gửi lại lần kết nối sau
    if (this.serial && sessions.get(this.serial) === this) sessions.delete(this.serial);
  }
}
const all = new Set();   // mọi kết nối (kể cả chưa đăng ký)

const clientIp = (req) => String(req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || '')
  .trim().replace(/^::ffff:/, '');

let ticker = null;
// Gắn vào máy chủ HTTP của phần mềm: nhận yêu cầu nâng cấp lên WebSocket (máy AI kết nối)
export function attachAiWs(server) {
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    if (String(req.headers.upgrade || '').toLowerCase() !== 'websocket' || !req.headers['sec-websocket-key']) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return;
    }
    if (!aiEnabled()) { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return; }
    const accept = createHash('sha1').update(String(req.headers['sec-websocket-key']).trim() + GUID).digest('base64');
    const proto = String(req.headers['sec-websocket-protocol'] || '').split(',')[0].trim();
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n'
      + (proto ? 'Sec-WebSocket-Protocol: ' + proto + '\r\n' : '') + '\r\n');
    const s = new Session(socket, clientIp(req));
    if (head && head.length) s.onData(head);
  });
  if (!ticker) { ticker = setInterval(() => { for (const s of [...all]) s.tick(); }, TICK_MS); ticker.unref(); }
}
