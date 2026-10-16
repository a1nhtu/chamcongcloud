// MÁY CHẤM CÔNG KẾT NỐI TRỰC TIẾP TCP/IP (cổng 4370) — qua SDK zkemkeeper của ZKTeco.
// SDK là thư viện COM của Windows nên gọi qua 1 tiến trình PowerShell phụ (server/zk/zk-tcp.ps1): mỗi thao tác = 1 lần kết nối.
// Quy tắc SDK: làm TUẦN TỰ từng máy (không chạy song song), đọc xong luôn bật lại máy + ngắt kết nối (script lo).
// Dữ liệu tải về đi chung đường với máy Push: lượt chấm → ingestAttlog, nhân viên → ingestUserData (tự tạo NV, tự tính công).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import { db, getSetting } from './db.js';
import { ingestAttlog, ingestUserData } from './device-sync.js';
import { guardIncoming } from './pin-guard.js';
import { vnDateStr } from './util.js';

const SCRIPT = process.env.ZK_TCP_SCRIPT || fileURLToPath(new URL('./zk/zk-tcp.ps1', import.meta.url));   // ZK_TCP_SCRIPT: script giả lập máy (chỉ dùng khi kiểm thử)
export const tcpEnabled = () => getSetting('device_enabled', '0') === '1' && getSetting('tcp_device_enabled', '0') === '1';

// PowerShell 32-bit trước (SDK thường đăng ký bản 32-bit), không có thì bản mặc định
function psExe() {
  if (process.platform !== 'win32') return null;
  const root = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  for (const p of [`${root}\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe`, `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`]) if (existsSync(p)) return p;
  return 'powershell.exe';
}

// Cổng máy có mở không (hỏi nhanh trước, khỏi chờ SDK ~15 giây mới báo lỗi)
export function tcpProbe(ip, port, ms = 3000) {
  return new Promise((ok) => {
    const s = connect({ host: ip, port, timeout: ms });
    const end = (v) => { s.destroy(); ok(v); };
    s.once('connect', () => end(true)); s.once('timeout', () => end(false)); s.once('error', () => end(false));
  });
}

let chain = Promise.resolve();   // hàng đợi: mỗi lúc chỉ 1 thao tác SDK
// Chạy 1 thao tác trên máy. onLine(loại, [cột…]) nhận từng dòng dữ liệu. Trả { note } hoặc ném lỗi (message tiếng Việt).
export function zkRun(dev, action, args = {}, onLine = null) {
  const job = () => new Promise((resolve, reject) => {
    const exe = psExe();
    if (!exe) return reject(Object.assign(new Error('Kết nối TCP/IP chỉ chạy khi phần mềm cài trên máy tính Windows (cùng mạng LAN với máy chấm công).'), { code: 'NOWIN' }));
    const a = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Ip', dev.tcp_ip, '-Port', String(dev.tcp_port || 4370), '-Key', String(dev.tcp_key || 0), '-Action', action];
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

// Tải NHÂN VIÊN từ máy về phần mềm (tên, quyền, thẻ) → tự tạo / cập nhật NV như máy Push
export async function tcpUsers(dev, prog = () => {}) {
  const lines = [];
  await zkRun(dev, 'users', {}, (k, c) => {
    if (k !== 'U' || !c[0]) return;
    lines.push(`USER PIN=${c[0]}\tName=${c[1] || ''}\tPri=${c[2] || 0}\tCard=${c[4] || ''}`);
    if (lines.length % 200 === 0) prog(`Đã đọc ${lines.length} nhân viên…`);
  });
  prog(`Đang lưu ${lines.length} nhân viên…`);
  // Cảnh báo trùng Số ID (nếu bật): chỉ so tên (máy TCP/IP không báo đăng ký mới theo thời gian thực)
  if (lines.length) { try { guardIncoming(dev.serial, 'USER', lines.join('\n'), { realtime: false }); } catch (e) { console.error('[pin-guard] kiểm trùng lỗi:', e.message); } }
  const seen = lines.length ? ingestUserData(dev.serial, 'USER', lines.join('\n')) : new Set();
  return { read: lines.length, saved: seen.size };
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
  jobs.set(j.id, j);
  for (const [k, v] of jobs) if (jobs.size > 40 && v.state !== 'run') jobs.delete(k);
  Promise.resolve().then(() => fn((m) => { j.msg = m; }))
    .then((r) => { j.state = 'done'; j.result = r || {}; j.msg = 'Xong'; })
    .catch((e) => { j.state = 'err'; j.msg = e.message || String(e); j.code = e.code || ''; console.error('[zk-tcp]', kind, devName, e.message); });
  return j;
}
export const getJob = (id) => jobs.get(id) || null;

/* ---------- TỰ ĐỘNG TẢI THEO LỊCH ----------
 * Cài đặt tcp_auto_min = cứ N phút tải 1 lần (0 = tắt). Mỗi lượt, với từng máy TCP/IP đã duyệt + đang bật tự tải (tuần tự từng máy):
 *   1) hỏi thông tin máy (nhẹ, không khoá máy)  2) số lượt chấm trên máy KHÔNG đổi so với lần trước → bỏ qua
 *   3) có lượt mới → tải nhân viên (khi số NV đổi) + tải lượt chấm từ hôm trước lần tải gần nhất đến hôm nay.
 * Máy tắt / mất mạng: ghi lại lỗi, lượt sau thử lại; không làm phiền người dùng. */
export const AUTO_CHOICES = [0, 5, 10, 15, 30, 60, 120, 240];
export const autoMinutes = () => { const n = parseInt(getSetting('tcp_auto_min', '0'), 10) || 0; return n > 0 ? Math.max(1, n) : 0; };
const dayBefore = (d) => new Date(Date.parse(d + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
let autoBusy = false;
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
  if (autoBusy) return null;
  autoBusy = true;
  try {
    const every = autoMinutes() * 60000, out = [];
    const list = db.prepare("SELECT * FROM push_devices WHERE conn_type='tcp' AND active=1 AND tcp_auto=1 ORDER BY id").all();
    for (const d of list) {   // TUẦN TỰ từng máy (quy tắc SDK)
      if (!force && d.tcp_auto_at && Date.now() - Date.parse(d.tcp_auto_at) < every - 5000) continue;
      if (!tcpEnabled()) break;
      out.push({ device: d.name || d.serial, msg: await autoOne(d, prog) });
    }
    return out;
  } finally { autoBusy = false; }
}
let autoTimer = null;
export function startTcpScheduler() {
  if (autoTimer || process.platform !== 'win32') return;
  const tick = Math.max(2000, parseInt(process.env.ZK_TCP_TICK_MS || '30000', 10) || 30000);
  autoTimer = setInterval(() => {
    if (!tcpEnabled() || !autoMinutes()) return;
    autoCycle(false).catch((e) => console.error('[zk-tcp] tự tải lỗi:', e.message));
  }, tick);
  autoTimer.unref();
}
