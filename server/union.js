// MÁY CHẤM CÔNG UNION (Virdi / UNIONCOMMUNITY) — SDK UCS v4.8 (UCSAPI40.dll, Windows 32-bit).
// Máy TỰ KẾT NỐI về phần mềm: trên máy đặt "Server IP" = IP máy tính cài phần mềm + cổng (mặc định 9870).
// SDK là thư viện C của Windows nên chạy trong 1 tiến trình phụ CHẠY NỀN (server/union/UnionBridge.cs, tự biên dịch
// bằng csc của .NET Framework 4 có sẵn trong Windows) — nói chuyện qua stdin/stdout từng dòng TAB (xem đầu file .cs).
// Công tắc union_device_enabled (mặc định TẮT). Tắt = không mở cổng, phần mềm chạy y như cũ.
// Máy mới kết nối → hiện "Chờ duyệt" (Serial = UNION-<Terminal ID>). Lượt chấm đổ chung đường ingestAttlog như máy ZKTeco.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, getSetting } from './db.js';
import { MULTI, ROOT } from './tenant.js';
import { ingestAttlog, ingestUserData, forgetDeviceUsers } from './device-sync.js';
import { guardIncoming } from './pin-guard.js';

export const unionEnabled = () => getSetting('device_enabled', '0') === '1' && getSetting('union_device_enabled', '0') === '1';
export const unionPort = () => { const p = parseInt(getSetting('union_port', '9870'), 10); return p > 0 && p < 65536 ? p : 9870; };
export const serialOf = (tid) => 'UNION-' + String(tid).padStart(4, '0');
const tidOf = (serial) => parseInt(String(serial).replace(/^UNION-/, ''), 10);

const SRC = fileURLToPath(new URL('./union/UnionBridge.cs', import.meta.url));
const SDK_DIR = process.env.UNION_SDK_DIR || fileURLToPath(new URL('./union/sdk', import.meta.url));
const OUT_DIR = join(ROOT, 'data', 'union');   // cầu nối SDK dùng chung của bản cài (không theo công ty)
const EXE = join(OUT_DIR, 'UnionBridge.exe');
const PID_FILE = join(OUT_DIR, 'bridge.pid');

// Biên dịch cầu nối (chỉ khi chưa có hoặc file .cs mới hơn — VD sau khi cập nhật phần mềm)
function buildBridge() {
  if (existsSync(EXE) && statSync(EXE).mtimeMs >= statSync(SRC).mtimeMs) return EXE;
  const root = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const csc = `${root}\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe`;
  if (!existsSync(csc)) throw new Error('Máy tính thiếu .NET Framework 4 (csc.exe) — cần để chạy SDK máy Union.');
  mkdirSync(OUT_DIR, { recursive: true });
  try { execFileSync(csc, ['-nologo', '-platform:x86', '-target:exe', `-out:${EXE}`, SRC], { windowsHide: true, stdio: 'pipe' }); }
  catch (e) { throw new Error('Không biên dịch được cầu nối máy Union: ' + String(e.stdout || e.message).trim().split('\n').slice(-2).join(' ')); }
  return EXE;
}

/* ---------- tiến trình cầu nối ---------- */
let bridge = null;          // { p, ready, port }
let lastErr = '';           // lỗi gần nhất (hiện ở trang Máy chấm công)
const online = new Map();   // TerminalID → { ip, since }
let seq = 0;
const acks = new Map();     // mã lệnh → resolve(kết quả gọi SDK)
const waiters = new Set();  // việc đang chờ dữ liệu từ máy: { tid, on(k, cols) → true = xong }

export const unionStatus = () => ({ running: !!(bridge && bridge.ready), port: bridge?.port || unionPort(),
  error: MULTI ? 'Máy chủ nhiều công ty của Digiplus chưa hỗ trợ máy Union' : lastErr });
export const unionOnline = (serial) => online.has(tidOf(serial));

function startBridge() {
  if (bridge) return;
  if (process.platform !== 'win32' && !process.env.UNION_BRIDGE) { lastErr = 'Máy Union chỉ chạy khi phần mềm cài trên máy tính Windows.'; return; }
  let exe, args;
  const port = unionPort();
  try {
    // UNION_BRIDGE: chạy cầu nối giả lập (chỉ dùng khi kiểm thử, VD "node tools/sim-union.mjs")
    if (process.env.UNION_BRIDGE) { const [cmd, ...rest] = process.env.UNION_BRIDGE.split(' '); exe = cmd; args = [...rest, '--port', String(port)]; }
    else { exe = buildBridge(); args = ['--port', String(port), '--dll', SDK_DIR]; }
  } catch (e) { lastErr = e.message; console.error('[union]', e.message); return; }
  killStale();
  const p = spawn(exe, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  try { mkdirSync(OUT_DIR, { recursive: true }); writeFileSync(PID_FILE, String(p.pid || '')); } catch {}
  const b = bridge = { p, ready: false, port };
  let buf = '';
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1); if (l) onLine(b, l.split('\t')); } });
  p.stderr.setEncoding('utf8'); p.stderr.on('data', (d) => console.error('[union] bridge:', String(d).trim().slice(0, 300)));
  p.on('error', (e) => { lastErr = 'Không chạy được cầu nối máy Union: ' + e.message; });
  p.on('close', (code) => {
    if (bridge === b) bridge = null;
    online.clear();
    for (const [, r] of acks) r('DOWN'); acks.clear();
    for (const w of waiters) w.fail(new Error('Cầu nối máy Union đã dừng.')); waiters.clear();
    if (code && !lastErr) lastErr = 'Cầu nối máy Union dừng (mã ' + code + ').';
  });
  p.stdin.on('error', () => {});
  openFirewall(port);
}
function stopBridge() {
  if (!bridge) return;
  try { bridge.p.stdin.write('0\tquit\t0\n'); bridge.p.stdin.end(); } catch {}
  const p = bridge.p; setTimeout(() => { try { p.kill(); } catch {} }, 3000);
  bridge = null; online.clear();
}
// Cầu nối của lần chạy trước còn sót (phần mềm bị tắt ngang) đang giữ cổng → dừng nó trước khi mở lại
function killStale() {
  if (process.platform !== 'win32') return;
  let pid = 0;
  try { pid = parseInt(readFileSync(PID_FILE, 'utf8'), 10) || 0; } catch { return; }
  if (!pid) return;
  try {
    const t = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true, encoding: 'utf8' });
    if (/UnionBridge\.exe/i.test(t)) execFileSync('taskkill', ['/F', '/PID', String(pid)], { windowsHide: true, stdio: 'ignore' });
  } catch { /* không còn */ }
}
// Mở tường lửa Windows cho cổng nhận máy (chỉ được khi phần mềm chạy quyền Administrator; không được thì thôi — bộ cài đã mở sẵn)
let fwDone = 0;
function openFirewall(port) {
  if (process.platform !== 'win32' || fwDone === port || process.env.UNION_BRIDGE || process.env.UNION_NO_FW) return;   // UNION_NO_FW: chạy thử, không đụng tường lửa
  fwDone = port;
  const name = `Digiplus Union ${port}`;
  try {
    execFileSync('netsh', ['advfirewall', 'firewall', 'delete', 'rule', `name=${name}`], { windowsHide: true, stdio: 'ignore' });
    execFileSync('netsh', ['advfirewall', 'firewall', 'add', 'rule', `name=${name}`, 'dir=in', 'action=allow', 'protocol=TCP', `localport=${port}`, 'profile=any'], { windowsHide: true, stdio: 'ignore' });
  } catch { /* không có quyền Administrator */ }
}

// Bật / tắt theo công tắc (gọi định kỳ — đổi công tắc / đổi cổng không cần khởi động lại phần mềm)
export function syncUnion() {
  if (!unionEnabled()) { lastErr = ''; return stopBridge(); }
  if (bridge && bridge.port !== unionPort()) stopBridge();
  if (!bridge) startBridge();
}
let timer = null;
export function startUnion() {
  if (timer) return;
  // Máy chủ nhiều công ty: máy Union nối thẳng về 1 cổng TCP, chưa phân biệt được máy của công ty nào → chưa hỗ trợ
  if (MULTI) return;
  syncUnion();
  timer = setInterval(syncUnion, Math.max(1000, parseInt(process.env.UNION_TICK_MS || '10000', 10) || 10000));
  timer.unref();
}

function send(cmd, tid, ...args) {
  return new Promise((resolve) => {
    if (!bridge || !bridge.ready) return resolve('DOWN');
    const id = String(++seq);
    acks.set(id, resolve);
    bridge.p.stdin.write([id, cmd, tid, ...args].join('\t') + '\n');
    setTimeout(() => { if (acks.delete(id)) resolve('TIMEOUT'); }, 15000);
  });
}
const SDK_ERR = { 6: 'cổng nhận máy chưa mở', 7: 'máy đang mất kết nối' };
function ackErr(r) {
  if (r === '0') return null;
  if (r === 'DOWN') return 'Cầu nối máy Union chưa chạy' + (lastErr ? ': ' + lastErr : ' — kiểm tra đã bật "Dùng máy Union".');
  if (r === 'TIMEOUT') return 'SDK không trả lời lệnh.';
  const n = parseInt(r, 16);
  return 'Máy không nhận lệnh: ' + (SDK_ERR[n] || 'mã lỗi ' + r) + '.';
}

/* ---------- dữ liệu máy gửi lên ---------- */
const devOf = (tid) => db.prepare("SELECT * FROM push_devices WHERE serial=? AND conn_type='union'").get(serialOf(tid));
const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
// AuthMode Union: 1 đi làm · 2 tan ca · 3 thường · 4 ra ngoài · 5 trở về → trạng thái kiểu ZKTeco (0 vào · 1 ra · 2 ra giữa giờ · 3 vào lại)
const STATUS = { 1: 0, 2: 1, 4: 2, 5: 3 };
// AuthType Union: 0/1 vân tay · 2 vân tay + thẻ · 3 thẻ · 4 mật mã · 5/6 khuôn mặt · 8/9 mống mắt → kiểu xác thực ZKTeco
const VERIFY = { 0: 1, 1: 1, 2: 1, 3: 4, 4: 0, 5: 15, 6: 15, 7: 4, 8: 15, 9: 15 };
// x = cột 1 lượt chấm từ cầu nối: [Số ID, giờ, AuthMode, AuthType, hợp lệ, AuthResult, thẻ, thứ tự, tổng]
const logLine = (x) => `${x[0]}\t${x[1]}\t${STATUS[+x[2]] ?? 0}\t${VERIFY[+x[3]] ?? 15}`;
// Lượt chấm hợp lệ: máy xác nhận đúng người (IsAuthorized) và không lỗi; Số ID 0 = sự kiện cửa / người lạ
const validLog = (x) => /^\d+$/.test(x[0]) && x[0] !== '0' && x[4] === '1' && (x[5] === '0' || x[5] === '') && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(x[1]) && x[1] >= '2000';

// Số ID chưa khớp NV → tải danh sách NV của máy (tự tạo NV như máy ZKTeco), tối đa 10 phút / lần mỗi máy
const askAt = new Map();
function askUsers(tid) {
  if (getSetting('device_autocreate', '1') !== '1' || Date.now() - (askAt.get(tid) || 0) < 600000) return;
  askAt.set(tid, Date.now());
  setTimeout(() => { unionUsers(devOf(tid)).catch((e) => console.error('[union] tự tải NV lỗi:', e.message)); }, 2000);
}

function onLine(b, c) {
  const k = c[0];
  if (k === 'READY') { b.ready = true; lastErr = ''; console.log('[union] đang nhận máy Union ở cổng', c[1]); return; }
  if (k === 'FAIL') { lastErr = c.slice(2).join(' ') || 'Lỗi SDK ' + c[1]; console.error('[union]', lastErr); return; }
  if (k === 'A') { const r = acks.get(c[1]); if (r) { acks.delete(c[1]); r(c[2]); } return; }
  const tid = parseInt(c[1], 10);
  if (!Number.isFinite(tid)) return;
  try {
    if (k === 'C') onConnect(tid, c[2] || '');
    else if (k === 'X') online.delete(tid);
    else if (k === 'L' && c[2] === 'R') onRealtime(tid, c.slice(3));
    else if (k === 'T') { const d = devOf(tid); if (d) db.prepare('UPDATE push_devices SET last_seen=? WHERE id=?').run(new Date().toISOString(), d.id); }
  } catch (e) { console.error('[union]', k, tid, e.message); }
  for (const w of [...waiters]) if (w.tid === tid) { try { if (w.on(k, c.slice(2))) { waiters.delete(w); w.done(); } } catch (e) { waiters.delete(w); w.fail(e); } }
}

function onConnect(tid, ip) {
  online.set(tid, { ip, since: Date.now() });
  const serial = serialOf(tid), now = new Date().toISOString();
  let d = devOf(tid);
  if (!d) {
    if (db.prepare('SELECT 1 FROM push_devices WHERE serial=?').get(serial)) return;   // trùng Serial máy hãng khác
    db.prepare("INSERT INTO push_devices(serial, name, active, conn_type, last_ip, last_seen, tcp_info) VALUES(?,?,0,'union',?,?,?)")
      .run(serial, '', ip, now, JSON.stringify({ terminal_id: tid, read_at: now }));
    return;
  }
  db.prepare('UPDATE push_devices SET last_ip=?, last_seen=? WHERE id=?').run(ip, now, d.id);
  // Máy vừa kết nối lại (VD sau mất mạng / máy tính ngủ) → lấy các lượt chấm máy CHƯA gửi về
  if (d.active) setTimeout(() => { if (online.has(tid)) unionLogs(devOf(tid), '', '', () => {}, true).catch(() => {}); }, 3000);
}

function onRealtime(tid, c) {
  const d = devOf(tid);
  if (!d) return;
  db.prepare('UPDATE push_devices SET last_seen=? WHERE id=?').run(new Date().toISOString(), d.id);
  if (!d.active || !validLog(c)) return;
  tx(() => ingestAttlog(d.serial, logLine(c), { ask: () => askUsers(tid) }));
}

/* ---------- thao tác (phần mềm ra lệnh, chờ máy trả dữ liệu) ---------- */
let chain = Promise.resolve();   // mỗi lúc 1 việc tải dữ liệu (máy trả dữ liệu theo sự kiện, không lẫn việc này với việc kia)
// on(k, cột) trả true = đủ dữ liệu. Máy chưa gửi gì sau firstMs → lỗi; đang gửi mà ngưng quá idleMs → coi như xong (phòng máy không báo tổng số).
function collect(dev, cmd, args, keys, on, firstMs = 60000, idleMs = 15000) {
  const job = () => new Promise((resolve, reject) => {
    if (!dev) return reject(new Error('Không tìm thấy máy Union'));
    const tid = tidOf(dev.serial);
    if (!online.has(tid)) return reject(new Error(`Máy ${dev.name || dev.serial} đang mất kết nối — kiểm tra máy đã bật và đặt đúng Server IP + cổng ${unionPort()}.`));
    let t, got = false;
    const w = { tid, on: (k, c) => { if (!keys.includes(k)) return false; got = true; arm(); return on(k, c); }, done: () => { clearTimeout(t); resolve(); }, fail: (e) => { clearTimeout(t); reject(e); } };
    const arm = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        if (!waiters.delete(w)) return;
        if (got) w.done(); else w.fail(Object.assign(new Error('Máy không trả dữ liệu (quá thời gian chờ).'), { code: 'TIMEOUT' }));
      }, got ? idleMs : firstMs);
    };
    waiters.add(w); arm();
    send(cmd, tid, ...args).then((r) => { const e = ackErr(r); if (e && waiters.delete(w)) w.fail(new Error(e)); });
  });
  const run = chain.then(job, job);
  chain = run.catch(() => {});
  return run;
}
const fin = (c) => { const cur = +c[c.length - 2], tot = +c[c.length - 1]; return tot > 0 && cur >= tot; };

// Tải NHÂN VIÊN (Số ID, tên, quyền) → tự tạo / cập nhật NV như máy ZKTeco
export async function unionUsers(dev, prog = () => {}) {
  const lines = [];
  await collect(dev, 'users', [], ['U', 'UE'], (k, c) => {
    if (k === 'UE') return true;
    if (k !== 'U') return false;
    if (/^\d+$/.test(c[0]) && c[0] !== '0') lines.push(`USER PIN=${c[0]}\tName=${c[1] || ''}\tPri=${c[2] === '1' ? 14 : 0}`);
    if (lines.length % 200 === 0) prog(`Đã đọc ${lines.length} nhân viên…`);
    return fin(c);
  });
  prog(`Đang lưu ${lines.length} nhân viên…`);
  if (lines.length) { try { guardIncoming(dev.serial, 'USER', lines.join('\n'), { realtime: false }); } catch (e) { console.error('[pin-guard] kiểm trùng lỗi:', e.message); } }
  const seen = lines.length ? ingestUserData(dev.serial, 'USER', lines.join('\n')) : new Set();
  return { read: lines.length, saved: seen.size };
}

// Tải LƯỢT CHẤM [from, to] (rỗng = toàn bộ; onlyNew = các lượt máy chưa gửi) → lưu + dựng công. Lượt đã có tự bỏ qua.
export async function unionLogs(dev, from, to, prog = () => {}, onlyNew = false) {
  const lines = [];
  let total = 0;
  await collect(dev, onlyNew ? 'newlogs' : 'logs', onlyNew ? [] : [from || '', to || ''], ['L', 'LE'], (k, c) => {
    if (k === 'LE') return true;
    if (k !== 'L' || c[0] !== 'G') return false;
    total = +c[c.length - 1] || total;
    const x = c.slice(1);
    if (validLog(x)) lines.push(logLine(x));
    if (lines.length % 2000 === 0) prog(`Đã đọc ${lines.length.toLocaleString('vi')} lượt chấm từ máy…`);
    return fin(c);
  }, onlyNew ? 20000 : 60000);
  const before = db.prepare('SELECT COUNT(*) c FROM device_punches WHERE serial=?').get(dev.serial).c;
  const CH = 2000, tid = tidOf(dev.serial);
  for (let i = 0; i < lines.length; i += CH) {
    prog(`Đang lưu + tính công: ${Math.min(i + CH, lines.length).toLocaleString('vi')} / ${lines.length.toLocaleString('vi')} lượt chấm…`);
    tx(() => ingestAttlog(dev.serial, lines.slice(i, i + CH).join('\n'), { ask: () => askUsers(tid) }));
    await new Promise((ok) => setImmediate(ok));
  }
  const after = db.prepare('SELECT COUNT(*) c FROM device_punches WHERE serial=?').get(dev.serial).c;
  const unmatched = db.prepare('SELECT COUNT(DISTINCT pin) c FROM device_punches WHERE serial=? AND employee_id IS NULL').get(dev.serial).c;
  db.prepare('UPDATE push_devices SET tcp_sync_at=? WHERE id=?').run(new Date().toISOString(), dev.id);
  return { read: lines.length, added: after - before, onDevice: total || lines.length, unmatched };
}

// Thông tin máy: số NV / quản trị / vân tay / khuôn mặt (kèm sức chứa) + firmware + IP / MAC
export async function unionInfo(dev) {
  const info = {};
  await collect(dev, 'count', [], ['N'], (k, c) => {
    if (k !== 'N') return false;
    if (c.length >= 8) Object.assign(info, { admins: +c[1], users: +c[2], user_cap: +c[3], fps: +c[4], fp_cap: +c[5], faces: +c[6], face_cap: +c[7] });
    return true;
  }, 20000);
  try { await collect(dev, 'fw', [], ['V'], (k, c) => { if (k !== 'V') return false; if (c[1]) info.firmware = c[1]; return true; }, 10000); } catch { /* máy đời cũ không trả firmware */ }
  try { await collect(dev, 'info', [], ['I'], (k, c) => { if (k !== 'I') return false; Object.assign(info, { ip: c[0], firmware: info.firmware || c[1], model: c[2], mac: c[4] }); return true; }, 5000); } catch { /* bỏ qua */ }
  info.terminal_id = tidOf(dev.serial);
  info.read_at = new Date().toISOString();
  db.prepare('UPDATE push_devices SET tcp_info=? WHERE id=?').run(JSON.stringify(info), dev.id);
  return info;
}

// Lệnh không trả dữ liệu: khởi động lại · mở cửa · xoá 1 / nhiều / toàn bộ NV trên máy
export async function unionSimple(dev, cmd, ...args) {
  const tid = tidOf(dev.serial);
  if (!online.has(tid)) throw new Error(`Máy ${dev.name || dev.serial} đang mất kết nối.`);
  const e = ackErr(await send(cmd, tid, ...args));
  if (e) throw new Error(e);
}
export async function unionDeleteUsers(dev, pins, prog = () => {}) {
  let n = 0;
  for (const p of pins) {
    const pin = String(p).trim(); if (!/^\d+$/.test(pin)) continue;
    await unionSimple(dev, 'deluser', pin); n++;
    if (n % 20 === 0) prog(`Đã xoá ${n} / ${pins.length} nhân viên…`);
  }
  forgetDeviceUsers(dev.serial, pins);
  return { deleted: n };
}
export async function unionClearUsers(dev) {
  await unionSimple(dev, 'delall');
  db.prepare('DELETE FROM device_users_serial WHERE serial=?').run(dev.serial);
  return { cleared: true };
}
