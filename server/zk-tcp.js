// MÁY CHẤM CÔNG KẾT NỐI TRỰC TIẾP TCP/IP (cổng 4370) — qua SDK zkemkeeper của ZKTeco.
// SDK là thư viện COM của Windows nên gọi qua 1 tiến trình PowerShell phụ (server/zk/zk-tcp.ps1): mỗi thao tác = 1 lần kết nối.
// Quy tắc SDK: làm TUẦN TỰ từng máy (không chạy song song), đọc xong luôn bật lại máy + ngắt kết nối (script lo).
// Dữ liệu tải về đi chung đường với máy Push: lượt chấm → ingestAttlog, nhân viên → ingestUserData (tự tạo NV, tự tính công).
import { execFile, spawn } from 'node:child_process';
import { existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import dgram from 'node:dgram';
import { fileURLToPath } from 'node:url';
import { db, getSetting } from './db.js';
import { ingestAttlog, ingestUserData, buildUserCommand, storeTemplates } from './device-sync.js';
import { guardIncoming, heldSet } from './pin-guard.js';
import { vnDateStr } from './util.js';
import { busyFlag, eachTenant, tenantKey } from './tenant.js';

const SCRIPT = process.env.ZK_TCP_SCRIPT || fileURLToPath(new URL('./zk/zk-tcp.ps1', import.meta.url));   // ZK_TCP_SCRIPT: script giả lập máy (chỉ dùng khi kiểm thử)
export const tcpEnabled = () => getSetting('device_enabled', '0') === '1' && getSetting('tcp_device_enabled', '0') === '1';

// PowerShell 32-bit trước (SDK thường đăng ký bản 32-bit), không có thì bản mặc định
function psExe() {
  if (process.platform !== 'win32') return null;
  const root = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  for (const p of [`${root}\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe`, `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`]) if (existsSync(p)) return p;
  return 'powershell.exe';
}

// Gõ cửa 1 cổng TCP, trả rõ kết quả: 'open' | 'refused' (máy bật nhưng từ chối = cổng tắt thật) | 'timeout' (không ai trả lời) | 'unreach'
export function tcpKnock(ip, port, ms = 3000) {
  return new Promise((ok) => {
    const s = connect({ host: ip, port, timeout: ms });
    const end = (v) => { s.destroy(); ok(v); };
    s.once('connect', () => end('open')); s.once('timeout', () => end('timeout'));
    s.once('error', (e) => end(e.code === 'ECONNREFUSED' || e.code === 'ECONNRESET' ? 'refused' : /UNREACH/.test(e.code || '') ? 'unreach' : 'timeout'));
  });
}
// Cổng máy có mở không (hỏi nhanh trước, khỏi chờ SDK ~15 giây mới báo lỗi)
export const tcpProbe = (ip, port, ms = 3000) => tcpKnock(ip, port, ms).then((r) => r === 'open');

/* ---------- bắt tay giao thức ZK (không cần SDK) ----------
 * Làm đúng như SDK lúc kết nối: CMD_CONNECT (1000); máy đáp "cần xác thực" (CMD_ACK_UNAUTH 2005) thì gửi CMD_AUTH (1102) kèm mật khẩu
 * kết nối đã mã hoá (Comm Key, mặc định 0 — nhiều máy như Ronald Jack 3315 FW 6.60 LUÔN đòi bước này dù không đặt mật khẩu); xong gửi
 * CMD_EXIT (1001) trả máy ngay. Gói tin + cách mã hoá theo thư viện pyzk (MakeKey của commpro.c): TCP có thêm 8 byte đầu 5050 827D + độ dài.
 * Trả 'ok' (vào được với mật khẩu này) | 'need_key' (máy không nhận mật khẩu này) | 'refused' (máy đáp lỗi) | 'silent' (kết nối được mà
 * máy không đáp — máy đang bận với phần mềm khác, hoặc cổng này không phải cổng ZK) | 'closed' (không kết nối được cổng TCP). */
const ZK = { CONNECT: 1000, EXIT: 1001, AUTH: 1102, ACK_OK: 2000, ACK_UNAUTH: 2005 };
function zkSum(buf) {
  let s = 0;
  for (let i = 0; i + 1 < buf.length; i += 2) { s += buf.readUInt16LE(i); if (s > 65535) s -= 65535; }
  if (buf.length % 2) s += buf[buf.length - 1];
  while (s > 65535) s -= 65535;
  s = ~s; while (s < 0) s += 65535;
  return s & 0xffff;
}
export function zkPacket(cmd, session = 0, reply = 65534, tcp = false, data = Buffer.alloc(0)) {
  const h = Buffer.concat([Buffer.alloc(8), data]);
  h.writeUInt16LE(cmd, 0); h.writeUInt16LE(session, 4); h.writeUInt16LE(reply, 6);
  h.writeUInt16LE(zkSum(h), 2);
  h.writeUInt16LE((reply + 1) % 65535, 6);   // như pyzk: tổng kiểm tính trước khi tăng số thứ tự
  if (!tcp) return h;
  const t = Buffer.alloc(8); t.writeUInt16LE(0x5050, 0); t.writeUInt16LE(0x7d82, 2); t.writeUInt32LE(h.length, 4);
  return Buffer.concat([t, h]);
}
// Mã hoá mật khẩu kết nối cho CMD_AUTH (đảo bit mật khẩu + phiên, trộn chữ "ZKSO", trộn số 50) — y như pyzk make_commkey
export function zkCommKey(key, session, ticks = 50) {
  let k = 0;
  for (let i = 0; i < 32; i++) k = ((k << 1) | ((Number(key) >>> i) & 1)) >>> 0;
  const b = Buffer.alloc(4); b.writeUInt32LE((k + session) >>> 0, 0);
  const x = [b[0] ^ 0x5a, b[1] ^ 0x4b, b[2] ^ 0x53, b[3] ^ 0x4f];   // 'Z' 'K' 'S' 'O'
  const y = [x[2], x[3], x[0], x[1]], t = ticks & 0xff;              // đổi chỗ 2 nửa 16 bit
  return Buffer.from([y[0] ^ t, y[1] ^ t, t, y[3] ^ t]);
}
// Đọc đầu gói máy trả về → { cmd, session, reply, size (độ dài cả gói) } (null = chưa đủ / không phải gói ZK)
export function zkReply(buf, tcp = false) {
  const o = tcp ? 8 : 0;
  if (buf.length < o + 8 || (tcp && (buf.readUInt16LE(0) !== 0x5050 || buf.readUInt16LE(2) !== 0x7d82))) return null;
  const size = tcp ? 8 + buf.readUInt32LE(4) : buf.length;
  if (buf.length < size) return null;
  return { cmd: buf.readUInt16LE(o), session: buf.readUInt16LE(o + 4), reply: buf.readUInt16LE(o + 6), size };
}
export function zkHello(ip, port = 4370, { udp = false, ms = 2500, key = 0 } = {}) {
  return new Promise((ok) => {
    let done = false, buf = Buffer.alloc(0), timer = null, close = () => {}, send = () => {}, authed = false;
    const end = (v) => { if (done) return; done = true; clearTimeout(timer); close(); ok(v); };
    timer = setTimeout(() => end('silent'), ms);
    // máy đáp 1 gói: vào được → trả máy; đòi xác thực (lần đầu) → gửi mật khẩu; còn lại → kết luận
    const onReply = (r) => {
      if (r.cmd === ZK.ACK_UNAUTH && !authed) { authed = true; return send(zkPacket(ZK.AUTH, r.session, r.reply, !udp, zkCommKey(key, r.session))); }
      try { send(zkPacket(ZK.EXIT, r.session, r.reply, !udp)); } catch {}
      end(r.cmd === ZK.ACK_OK ? 'ok' : r.cmd === ZK.ACK_UNAUTH ? 'need_key' : 'refused');
    };
    if (udp) {
      const u = dgram.createSocket('udp4');
      close = () => setTimeout(() => { try { u.close(); } catch {} }, 50);
      send = (pk) => u.send(pk, port, ip, (e) => { if (e) end('silent'); });
      u.on('error', () => end('silent'));
      u.on('message', (m) => { const r = zkReply(m); if (r) onReply(r); });
      send(zkPacket(ZK.CONNECT));
      return;
    }
    const s = connect({ host: ip, port });
    let joined = false;
    close = () => setTimeout(() => s.destroy(), 50);
    send = (pk) => s.write(pk);
    s.once('connect', () => { joined = true; send(zkPacket(ZK.CONNECT, 0, 65534, true)); });
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      for (let r; !done && (r = zkReply(buf, true));) { buf = buf.subarray(r.size); onReply(r); }
    });
    s.once('error', () => end(joined ? 'silent' : 'closed'));
    s.once('close', () => end('silent'));
  });
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const retryMs = () => (process.env.ZK_RETRY_MS != null ? +process.env.ZK_RETRY_MS : 2500);   // ZK_RETRY_MS: chỉ dùng khi kiểm thử
const connErr = (e) => /^CONNECT/.test(e.code || '');
// Chạy 1 thao tác SDK (VD đọc / ghi cài đặt Cloud Server) mà KHÔNG kết luận vội: bắt tay ZK trước để biết máy có nhận mật khẩu kết nối /
// đang bận không, kết nối hỏng thì chờ chút thử lại 1 lần, vẫn hỏng thì báo ĐÚNG nguyên nhân (mã lỗi riêng cho giao diện).
// c = { tcp_ip, tcp_port, tcp_key, udp (máy chỉ trả lời UDP) }.
export async function zkCareful(c, fn) {
  const keyGiven = Number(c.tcp_key) > 0, where = `${c.tcp_ip}:${c.tcp_port}${c.udp ? ' (UDP)' : ''}`;
  const hi = () => zkHello(c.tcp_ip, c.tcp_port, { udp: !!c.udp, key: Number(c.tcp_key) || 0 });
  let hello = await hi();
  if (hello === 'silent') { await sleep(retryMs()); hello = await hi(); }
  const explain = (e) => {
    if (hello === 'need_key') return keyGiven
      ? Object.assign(new Error(`Sai mật khẩu kết nối (Comm Key): máy ${where} không nhận mật khẩu vừa nhập. Xem trên máy: Menu → Comm (Truyền thông) → PC Connection → Comm Key.`), { code: 'WRONGKEY' })
      : Object.assign(new Error(`Máy ${where} có đặt mật khẩu kết nối (Comm Key) — nhập đúng mật khẩu để kết nối (xem trên máy: Menu → Comm → PC Connection → Comm Key).`), { code: 'NEEDKEY' });
    if (hello === 'silent') return Object.assign(new Error(`Máy ${where} nhận kết nối nhưng không trả lời — thường do máy đang kết nối với phần mềm khác (Wise Eye, Ronald Jack…) hoặc đang mở menu trên màn hình máy. Tắt phần mềm kia / thoát menu trên máy rồi bấm Tìm lại.`), { code: 'BUSY' });
    if (hello === 'closed') return Object.assign(new Error(`Không tới được cổng ${where} — máy vừa tắt, đổi IP hoặc mất mạng. Bấm Tìm lại.`), { code: 'UNREACH' });
    if (hello === 'ok') e.message += ' (Máy vẫn trả lời giao thức chấm công bình thường — thử lại sau ít phút; vẫn lỗi thì chạy lại bộ cài bằng quyền Administrator để đăng ký lại SDK.)';
    return e;
  };
  // bắt tay chỉ để GIẢI THÍCH lỗi — luôn để SDK thử thật (máy lạ có thể khác pyzk), không chặn trước
  try { return await fn(c); } catch (e) {
    if (!connErr(e) || hello === 'need_key') throw connErr(e) ? explain(e) : e;
    await sleep(retryMs());   // máy vừa bận (vừa bị dò / phần mềm khác vừa nhả) → thử lại 1 lần
    try { return await fn(c); } catch (e2) { throw connErr(e2) ? explain(e2) : e2; }
  }
}

let chain = Promise.resolve();   // hàng đợi: mỗi lúc chỉ 1 thao tác SDK
// Chạy 1 thao tác trên máy. onLine(loại, [cột…]) nhận từng dòng dữ liệu. Trả { note } hoặc ném lỗi (message tiếng Việt).
export function zkRun(dev, action, args = {}, onLine = null) {
  const job = () => new Promise((resolve, reject) => {
    const exe = psExe();
    if (!exe) return reject(Object.assign(new Error('Kết nối TCP/IP chỉ chạy khi phần mềm cài trên máy tính Windows (cùng mạng LAN với máy chấm công).'), { code: 'NOWIN' }));
    const a = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Ip', dev.tcp_ip, '-Port', String(dev.tcp_port || 4370), '-Key', String(dev.tcp_key || 0), '-Action', action];
    if (dev.udp) a.push('-Proto', 'udp');   // máy chỉ trả lời UDP 4370 (dò thấy khi bắt tay)
    if (args.from) a.push('-From', args.from);
    if (args.to) a.push('-To', args.to);
    const p = spawn(exe, a, { windowsHide: true });
    let buf = '', errTxt = '', done = null, fail = null;
    const timer = setTimeout(() => { fail = { code: 'TIMEOUT', msg: 'Máy không phản hồi (quá thời gian chờ).' }; p.kill(); }, args.timeoutMs || 15 * 60000);
    const line = (l) => {
      if (!l) return;
      const c = l.split('\t'), k = c[0];
      if (k === 'OK') done = { note: c.slice(1) };
      else if (k === 'ERR') fail = { code: c[1] || 'ERR', msg: c.slice(2).join(' ') || 'Lỗi không rõ' };
      else if (onLine) { try { onLine(k, c.slice(1)); } catch (e) { fail = { code: 'INGEST', msg: e.message }; p.kill(); } }
    };
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { line(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); } });
    p.stderr.setEncoding('utf8'); p.stderr.on('data', (d) => { errTxt += d; });
    p.on('error', (e) => { clearTimeout(timer); reject(Object.assign(new Error('Không chạy được PowerShell: ' + e.message), { code: 'SPAWN' })); });
    p.on('close', () => {
      clearTimeout(timer); line(buf.replace(/\r$/, ''));
      if (fail) return reject(Object.assign(new Error(fail.msg), { code: fail.code }));
      if (done) return resolve(done);
      reject(Object.assign(new Error('SDK dừng giữa chừng' + (errTxt ? ': ' + errTxt.trim().split('\n')[0].slice(0, 200) : '')), { code: 'ABORT' }));
    });
  });
  const run = chain.then(job, job);
  chain = run.catch(() => {});
  return run;
}

/* ---------- thao tác mức cao ---------- */
const NUM = new Set(['admins', 'users', 'fps', 'pwds', 'logs', 'fp_cap', 'user_cap', 'log_cap', 'faces', 'face_cap']);
// Đọc thông tin + dung lượng máy: { serial, firmware, platform, mac, model, time, users, user_cap, fps, fp_cap, logs, log_cap, faces, face_cap, admins… }
export async function tcpInfo(dev) {
  const info = {};
  await zkRun(dev, 'info', { timeoutMs: 60000 }, (k, c) => { if (k === 'I' && c[0]) info[c[0]] = NUM.has(c[0]) ? Number(c[1]) : (c[1] || ''); });
  info.read_at = new Date().toISOString();
  return info;
}
export function saveInfo(id, info) {
  db.prepare('UPDATE push_devices SET tcp_info=?, last_seen=?, last_ip=tcp_ip WHERE id=?').run(JSON.stringify(info), info.read_at, id);
}

/* ---------- tìm máy trong mạng LAN + trỏ máy Push về tên miền (ghi qua SDK cổng 4370) ---------- */
// Dò cả lớp mạng /24 của từng IP LAN máy tính: cổng 4370 (SDK) + cổng 8818, rồi đọc bảng ARP tìm MAC 00:17:… (ZKTeco)
// → bắt được cả máy tắt cổng 4370. Chỉ mở/đóng kết nối TCP (chưa gọi SDK) → vài giây / lớp mạng.
// ZK_SCAN_HOSTS="ip[:cổng],…" thay danh sách dò (chỉ dùng khi kiểm thử).
// Trả [{ ip, port (cổng SDK nói chuyện được, null = không), ports: [cổng mở], mac, udp, tcp, offline }].
const extraPort = () => +process.env.ZK_SCAN_EXTRA_PORT || 8818;   // ZK_SCAN_EXTRA_PORT: chỉ dùng khi kiểm thử
// 00:17:… (dải phổ biến của ZKTeco / Ronald Jack) + các dải MAC khác của ZKTeco (như tool Tìm máy chấm công)
const ZK_OUI = new Set(['0017A1', '00661B', '68175A', 'F44932', '88A9A7', '341513', '607EA4']);
export const isZkMac = (mac) => /^00[:-]17[:-]/i.test(mac || '') || ZK_OUI.has(String(mac || '').replace(/[:-]/g, '').slice(0, 6).toUpperCase());
// "arp -a" của Windows → [{ ip, mac 'AA:BB:…' }]
export function parseArp(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/(\d+\.\d+\.\d+\.\d+)\s+([0-9a-f]{2}(?:[-:][0-9a-f]{2}){5})/gi)) out.push({ ip: m[1], mac: m[2].replace(/-/g, ':').toUpperCase() });
  return out;
}
const arpTable = () => new Promise((ok) => {
  if (process.env.ZK_SCAN_HOSTS) return ok(parseArp(process.env.ZK_SCAN_ARP));   // ZK_SCAN_ARP="ip mac,…": bảng ARP giả, chỉ dùng khi kiểm thử
  if (process.platform !== 'win32') return ok([]);
  execFile('arp', ['-a'], { windowsHide: true, timeout: 10000 }, (e, out) => ok(e ? [] : parseArp(out)));
});
// Gửi bắt tay ZK (CMD_CONNECT) qua UDP tới mọi máy bằng 1 socket, máy nào đáp → Map(ip → cổng); đáp xong gửi CMD_EXIT trả máy ngay
function udpSweep(hosts, ms) {
  return new Promise((ok) => {
    const seen = new Map(), u = dgram.createSocket('udp4');
    u.on('error', () => {});
    u.on('message', (m, from) => {
      const r = zkReply(m); if (!r || seen.has(from.address)) return;
      seen.set(from.address, from.port);
      try { u.send(zkPacket(ZK.EXIT, r.session, r.reply), from.port, from.address); } catch {}
    });
    u.bind(0, () => { for (const h of hosts) try { u.send(zkPacket(ZK.CONNECT), h.port, h.ip); } catch {} });
    setTimeout(() => { setTimeout(() => { try { u.close(); } catch {} }, 100); ok(seen); }, ms);
  });
}
const ping = (ip) => new Promise((ok) => {
  const win = process.platform === 'win32';
  execFile('ping', win ? ['-n', '1', '-w', '1000', ip] : ['-c', '1', '-W', '1', ip], { windowsHide: true, timeout: 5000 }, (e, out) => ok(/TTL=/i.test(String(out || ''))));
});
// Hỏi lại TỪ TỪ 1 máy mà lượt dò nhanh chưa thấy cổng SDK: TCP chờ lâu × 2 lần → bắt tay ZK qua UDP → ping.
// Ghi vào x: tcp ('open' | 'refused' | 'timeout' | 'unreach'), port (+ udp = máy chỉ trả lời UDP), offline (máy không còn trả lời gì).
const recheckMs = () => +process.env.ZK_RECHECK_MS || 3000;   // ZK_RECHECK_MS: chỉ dùng khi kiểm thử
export async function recheckHost(x, port = 4370) {
  let tcp = 'timeout';
  for (let i = 0; i < 2 && (tcp === 'timeout' || tcp === 'unreach'); i++) tcp = await tcpKnock(x.ip, port, recheckMs());
  x.tcp = tcp;
  if (tcp === 'open') { x.port = port; if (!x.ports.includes(port)) x.ports.unshift(port); return x; }
  const u = await zkHello(x.ip, port, { udp: true, ms: Math.min(2500, recheckMs()) });
  if (u !== 'silent') { x.port = port; x.udp = true; return x; }   // máy đời cũ: chỉ nói chuyện qua UDP 4370
  // máy từ chối TCP (gửi lại RST) / mở cổng khác / trả lời ping = đang bật; im hết = chỉ còn MAC trong bộ nhớ ARP của Windows
  if (!(tcp === 'refused' || x.ports.length || await ping(x.ip))) x.offline = true;
  return x;
}
export async function scanLan(ips, port = 4370, ms = 800) {
  const test = !!process.env.ZK_SCAN_HOSTS;
  const nets = [...new Set(ips.map((ip) => ip.split('.').slice(0, 3).join('.')))];
  const hosts = test
    ? process.env.ZK_SCAN_HOSTS.split(',').map((h) => h.trim()).filter(Boolean).map((h) => ({ ip: h.split(':')[0], port: +h.split(':')[1] || port }))
    : nets.flatMap((net) => Array.from({ length: 254 }, (_, i) => ({ ip: `${net}.${i + 1}`, port })));
  const probes = hosts.flatMap((h) => [{ ...h, sdk: true }, { ip: h.ip, port: extraPort() }]);
  const byIp = new Map();
  const hit = (ip) => byIp.get(ip) || byIp.set(ip, { ip, port: null, ports: [], mac: '' }).get(ip);
  const udpSeen = udpSweep(hosts, Math.max(ms, 1500));   // cùng lúc: bắt tay ZK qua UDP (máy đời cũ chỉ nói UDP 4370)
  for (let i = 0; i < probes.length; i += 256) {
    const part = probes.slice(i, i + 256);
    const ok = await Promise.all(part.map((h) => tcpProbe(h.ip, h.port, ms)));
    part.forEach((h, j) => { if (!ok[j]) return; const x = hit(h.ip); x.ports.push(h.port); if (h.sdk) x.port = h.port; });
  }
  for (const [ip, p] of await udpSeen) { const x = hit(ip); if (!x.port) { x.port = p; x.udp = true; } }
  // dò xong thì bảng ARP đã có MAC mọi máy đang bật trong lớp mạng (kể cả máy đóng hết cổng) — nhưng cũng còn MAC của máy
  // vừa tắt / vừa đổi IP (Windows nhớ vài phút), nên máy chỉ thấy qua MAC phải hỏi lại mới biết còn sống không
  for (const a of await arpTable()) {
    if (!test && !nets.includes(a.ip.split('.').slice(0, 3).join('.'))) continue;
    if (byIp.has(a.ip)) byIp.get(a.ip).mac = a.mac;
    else if (isZkMac(a.mac)) hit(a.ip).mac = a.mac;
  }
  // Lượt dò nhanh bắn hàng trăm kết nối cùng lúc, chờ 0,8 giây → máy chậm trả lời (đang bận, mạng Wi-Fi, ARP chậm) bị lỡ.
  // Máy nào chưa thấy cổng 4370 thì hỏi lại từng máy một trước khi kết luận "đóng cổng".
  for (const x of byIp.values()) if (!x.port) await recheckHost(x, port);
  const num = (ip) => ip.split('.').reduce((n, p) => n * 256 + +p, 0);
  return [...byIp.values()].sort((a, b) => num(a.ip) - num(b.ip));
}
const kvOf = (out) => (k, c) => { if (k === 'I' && c[0]) out[c[0]] = c[1] || ''; };
// Đọc cài đặt Cloud Server trong máy: { serial, model, firmware, svr_fun, svr_mode (1 = tên miền), svr_url, svr_port }
export async function tcpServerInfo(c) {
  const info = {};
  await zkRun(c, 'svr', { timeoutMs: 60000 }, kvOf(info));
  return info;
}
// Cổng Cloudflare nhận (HTTP + HTTPS). Máy để cổng khác (VD mặc định 8081) mà firmware lại dùng cổng đó với tên miền → không về được.
const CF_PORTS = new Set(['80', '8080', '8880', '2052', '2082', '2086', '2095', '443', '2053', '2083', '2087', '2096', '8443']);
// Trỏ máy về tên miền rồi khởi động lại máy. port = cổng đang lưu trong máy (đọc trước): ngoài danh sách Cloudflare → đổi về 80.
export async function tcpSetServer(c, domain, port = '') {
  const info = {};
  await zkRun(c, 'set-svr', { from: domain, to: port && !CF_PORTS.has(String(port)) ? '80' : '', timeoutMs: 60000 }, kvOf(info));
  return info;
}

// Tải NHÂN VIÊN từ máy về phần mềm (tên, quyền, thẻ, mật mã) → tự tạo / cập nhật NV như máy Push.
// fp = kèm VÂN TAY (bấm "Tải nhân viên"; trước không tải vân tay — khách nhahanggiadinh 29/10/2026): lưu như vân tay máy đẩy gửi về
// → hiện ở Sinh trắc của NV, đẩy được sang máy khác. Tự tải theo chu kỳ thì không đọc vân tay (chậm, máy đứng "Đang làm việc").
export async function tcpUsers(dev, prog = () => {}, { fp = false } = {}) {
  const lines = [], fp9 = [], fp10 = [];
  await zkRun(dev, 'users', fp ? { to: 'fp' } : {}, (k, c) => {
    if (k === 'F' && c[0] && c[4]) {
      const [pin, idx, flag, ver, tmp] = c;
      if (ver === '10') fp10.push(`BIODATA Pin=${pin}\tNo=${idx}\tIndex=${idx}\tValid=1\tDuress=${flag === '3' ? 1 : 0}\tType=1\tMajorVer=10\tMinorVer=0\tFormat=0\tTmp=${tmp}`);
      else fp9.push(`FP PIN=${pin}\tFID=${idx}\tSize=${tmp.length}\tValid=1\tTMP=${tmp}`);
      return;
    }
    if (k !== 'U' || !c[0]) return;
    lines.push(`USER PIN=${c[0]}\tName=${c[1] || ''}\tPri=${c[2] || 0}\tCard=${c[4] || ''}${c[5] ? `\tPasswd=${c[5]}` : ''}`);
    if (lines.length % 200 === 0) prog(`Đã đọc ${lines.length} nhân viên…`);
  });
  prog(`Đang lưu ${lines.length} nhân viên…`);
  // Cảnh báo trùng Số ID (nếu bật): chỉ so tên (máy TCP/IP không báo đăng ký mới theo thời gian thực)
  if (lines.length) { try { guardIncoming(dev.serial, 'USER', lines.join('\n'), { realtime: false }); } catch (e) { console.error('[pin-guard] kiểm trùng lỗi:', e.message); } }
  const seen = lines.length ? ingestUserData(dev.serial, 'USER', lines.join('\n')) : new Set();
  if (fp9.length) storeTemplates(dev.serial, 'FP', fp9.join('\n'));
  if (fp10.length) storeTemplates(dev.serial, 'BIODATA', fp10.join('\n'));
  return { read: lines.length, saved: seen.size, ...(fp ? { fps: fp9.length + fp10.length } : {}) };
}

// ĐẨY NV TỪ PHẦN MỀM XUỐNG MÁY TCP/IP (bấm "Đẩy NV xuống máy"; trước chỉ máy đẩy ADMS nhận được — khách nhahanggiadinh 29/10/2026).
// Số ID + tên + mật mã + thẻ lấy y như lệnh gửi máy đẩy (buildUserCommand); withBio = kèm vân tay phần mềm đang có (từ máy khác).
// Chỉ NV đang làm, có Số ID, không đang nghi trùng ở máy này. Xong đọc lại NV trên máy → danh sách "có trên máy" đúng thực tế.
const SAFE = (v) => String(v ?? '').replace(/[\t\r\n]/g, ' ').trim();
export async function tcpPushUsers(dev, pins, { withBio = false } = {}, prog = () => {}) {
  const held = heldSet();
  const active = db.prepare('SELECT 1 FROM employees WHERE device_pin=? AND active=1');
  const lines = [], sent = [];
  for (const p of new Set((pins || []).map((x) => String(x || '').trim()).filter(Boolean))) {
    if (!/^[0-9A-Za-z_-]{1,20}$/.test(p) || !active.get(p) || held.has(dev.serial + '|' + p)) continue;
    const f = Object.fromEntries(buildUserCommand(p, dev.serial, null, true).replace(/^DATA UPDATE USERINFO /, '').split('\t').map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]));
    lines.push(['U', p, SAFE(f.Name).slice(0, 24), SAFE(f.Passwd), +f.Pri || 0, SAFE(f.Card)].join('\t'));
    sent.push(p);
    if (!withBio) continue;
    const fps = new Map();   // ngón → mẫu mới nhất (phần mềm có thể giữ mẫu cùng ngón từ nhiều máy)
    for (const t of db.prepare('SELECT idx, major_ver, tmp FROM device_bio_templates WHERE pin=? AND serial<>? AND bio_type=1 AND valid=1 ORDER BY id').all(p, dev.serial)) fps.set(t.idx, t);
    for (const t of fps.values()) if (t.tmp) lines.push(['F', p, t.idx, (t.major_ver || 10) < 10 ? 9 : 10, SAFE(t.tmp)].join('\t'));
  }
  if (!sent.length) return { pushed: 0, failed: 0, fps: 0, skipped: (pins || []).length };
  const file = join(tmpdir(), `dgp-push-${process.pid}-${Date.now()}.txt`);
  writeFileSync(file, lines.join('\r\n'), 'utf8');
  const ok = [], bad = [];
  let fps = 0, fpFail = 0, fpVer = '';
  try {
    prog(`Đang ghi ${sent.length} NV xuống máy ${dev.name || dev.serial}…`);
    const r = await zkRun(dev, 'set-users', { from: file, timeoutMs: 15 * 60000 }, (k, c) => {
      if (k === 'S') (c[1] === '1' ? ok : bad).push(c[0]);
      else if (k === 'T') { if (c[2] === '1') fps++; else fpFail++; }
    });
    fpVer = r.note?.[1] || '';
  } finally { rmSync(file, { force: true }); }
  prog('Đang đọc lại nhân viên trên máy…');
  try { await tcpUsers(dev, prog); } catch { /* ghi xong rồi, đọc lại lỗi thì lần Tải nhân viên sau sẽ cập nhật */ }
  return { pushed: ok.length, failed: bad.length, failed_pins: bad, fps, fp_failed: fpFail, fp_version: fpVer, skipped: (pins || []).length - sent.length };
}

// Tải LƯỢT CHẤM trong [from, to] (rỗng = toàn bộ) → lưu lượt quẹt + dựng công. Lượt đã có thì tự bỏ qua (không trùng).
export async function tcpLogs(dev, from, to, prog = () => {}) {
  const lines = [];
  const r = await zkRun(dev, 'logs', { from, to }, (k, c) => {
    if (k === 'L' && c[0] && c[1]) lines.push(`${c[0]}\t${c[1]}\t${c[2] || 0}\t${c[3] || 0}`);
    else if (k === 'P') prog(`Đã đọc ${Number(c[0]).toLocaleString('vi')} lượt chấm từ máy…`);
  });
  const before = db.prepare('SELECT COUNT(*) c FROM device_punches WHERE serial=?').get(dev.serial).c;
  const CH = 2000;
  for (let i = 0; i < lines.length; i += CH) {
    prog(`Đang lưu + tính công: ${Math.min(i + CH, lines.length).toLocaleString('vi')} / ${lines.length.toLocaleString('vi')} lượt chấm…`);
    db.exec('BEGIN');
    try { ingestAttlog(dev.serial, lines.slice(i, i + CH).join('\n')); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    await new Promise((ok) => setImmediate(ok));   // nhường máy chủ phục vụ người khác giữa các mẻ
  }
  // máy TCP/IP không nhận lệnh Push → bỏ các lệnh "hỏi thông tin NV" mà ingestAttlog vừa xếp
  db.prepare('DELETE FROM push_device_commands WHERE serial=? AND trans_time IS NULL').run(dev.serial);
  const after = db.prepare('SELECT COUNT(*) c FROM device_punches WHERE serial=?').get(dev.serial).c;
  const unmatched = db.prepare('SELECT COUNT(DISTINCT pin) c FROM device_punches WHERE serial=? AND employee_id IS NULL').get(dev.serial).c;
  db.prepare('UPDATE push_devices SET tcp_sync_at=? WHERE id=?').run(new Date().toISOString(), dev.id);
  return { read: lines.length, added: after - before, onDevice: Number(r.note[1]) || lines.length, ranged: r.note[2] === 'range', unmatched };
}

/* ---------- việc chạy nền (giao diện hỏi tiến độ) ---------- */
const jobs = new Map(); let seq = 0;
export function startJob(kind, devName, fn) {
  const j = { id: String(++seq) + '-' + Date.now().toString(36), kind, device: devName, state: 'run', msg: 'Đang kết nối máy…', result: null, at: Date.now() };
  Object.defineProperty(j, 'tk', { value: tenantKey() });   // việc của công ty nào (không trả ra giao diện)
  jobs.set(j.id, j);
  for (const [k, v] of jobs) if (jobs.size > 40 && v.state !== 'run') jobs.delete(k);
  Promise.resolve().then(() => fn((m) => { j.msg = m; }))
    .then((r) => { j.state = 'done'; j.result = r || {}; j.msg = 'Xong'; })
    .catch((e) => { j.state = 'err'; j.msg = e.message || String(e); j.code = e.code || ''; console.error('[zk-tcp]', kind, devName, e.message); });
  return j;
}
export const getJob = (id) => { const j = jobs.get(id); return j && j.tk === tenantKey() ? j : null; };

/* ---------- TỰ ĐỘNG TẢI THEO LỊCH ----------
 * Cài đặt tcp_auto_min = cứ N phút tải 1 lần (0 = tắt). Mỗi lượt, với từng máy TCP/IP đã duyệt + đang bật tự tải (tuần tự từng máy):
 *   1) hỏi thông tin máy (nhẹ, không khoá máy)  2) số lượt chấm trên máy KHÔNG đổi so với lần trước → bỏ qua
 *   3) có lượt mới → tải nhân viên (khi số NV đổi) + tải lượt chấm từ hôm trước lần tải gần nhất đến hôm nay.
 * Máy tắt / mất mạng: ghi lại lỗi, lượt sau thử lại; không làm phiền người dùng. */
export const AUTO_CHOICES = [0, 5, 10, 15, 30, 60, 120, 240];
export const autoMinutes = () => { const n = parseInt(getSetting('tcp_auto_min', '0'), 10) || 0; return n > 0 ? Math.max(1, n) : 0; };
const dayBefore = (d) => new Date(Date.parse(d + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
const autoBusy = busyFlag();
// Tự tải 1 máy. Trả chuỗi kết quả ngắn (ghi vào tcp_auto_msg).
async function autoOne(d, prog = () => {}) {
  const mark = (ok, msg, extra = {}) => {
    db.prepare('UPDATE push_devices SET tcp_auto_at=?, tcp_auto_ok=?, tcp_auto_msg=?, tcp_auto_logs=COALESCE(?, tcp_auto_logs), tcp_auto_users=COALESCE(?, tcp_auto_users) WHERE id=?')
      .run(new Date().toISOString(), ok ? 1 : 0, msg, extra.logs ?? null, extra.users ?? null, d.id);
    return msg;
  };
  try {
    prog(`${d.name || d.serial}: đang kết nối…`);
    if (!(await tcpProbe(d.tcp_ip, d.tcp_port))) return mark(false, `Không thấy máy ở ${d.tcp_ip}:${d.tcp_port}`);
    const info = await tcpInfo(d);
    if (info.serial && info.serial !== d.serial) return mark(false, `IP này đang là máy khác (Serial ${info.serial})`);
    saveInfo(d.id, info);
    const logsNow = Number.isFinite(info.logs) ? info.logs : null, usersNow = Number.isFinite(info.users) ? info.users : null;
    if (logsNow != null && logsNow === d.tcp_auto_logs && (usersNow == null || usersNow === d.tcp_auto_users)) return mark(true, 'Không có lượt chấm mới');
    if (usersNow == null || usersNow !== d.tcp_auto_users) { prog(`${d.name || d.serial}: tải nhân viên…`); await tcpUsers(d); }
    let added = 0;
    if (logsNow == null || logsNow !== d.tcp_auto_logs) {
      const today = vnDateStr();
      const last = d.tcp_sync_at ? vnDateStr(new Date(d.tcp_sync_at)) : '';
      prog(`${d.name || d.serial}: tải lượt chấm…`);
      const r = last ? await tcpLogs(d, dayBefore(last), today) : await tcpLogs(d, '', '');   // chưa tải lần nào → tải toàn bộ
      added = r.added;
    }
    return mark(true, added ? `Thêm ${added} lượt chấm mới` : 'Không có lượt chấm mới', { logs: logsNow, users: usersNow });
  } catch (e) { return mark(false, e.message || String(e)); }
}
// Chạy 1 lượt cho các máy đến hạn (force = mọi máy đang bật, bỏ qua giờ hẹn). Trả [{ device, msg }].
export async function autoCycle(force = false, prog = () => {}) {
  if (!autoBusy.take()) return null;
  try {
    const every = autoMinutes() * 60000, out = [];
    const list = db.prepare("SELECT * FROM push_devices WHERE conn_type='tcp' AND active=1 AND tcp_auto=1 ORDER BY id").all();
    for (const d of list) {   // TUẦN TỰ từng máy (quy tắc SDK)
      if (!force && d.tcp_auto_at && Date.now() - Date.parse(d.tcp_auto_at) < every - 5000) continue;
      if (!tcpEnabled()) break;
      out.push({ device: d.name || d.serial, msg: await autoOne(d, prog) });
    }
    return out;
  } finally { autoBusy.done(); }
}
let autoTimer = null;
export function startTcpScheduler() {
  if (autoTimer || process.platform !== 'win32') return;
  const tick = Math.max(2000, parseInt(process.env.ZK_TCP_TICK_MS || '30000', 10) || 30000);
  autoTimer = setInterval(() => eachTenant(() => {
    if (!tcpEnabled() || !autoMinutes()) return;
    return autoCycle(false).catch((e) => console.error('[zk-tcp] tự tải lỗi:', e.message));
  }), tick);
  autoTimer.unref();
}
