// HẸN GIỜ KHỞI ĐỘNG LẠI MÁY CHẤM CÔNG (máy chạy lâu ngày dễ đơ): hằng ngày hoặc theo thứ trong tuần, đặt cho từng máy.
// Firmware máy không có tham số tự khởi động lại theo giờ → phần mềm gửi lệnh khi tới giờ:
//   máy Push: xếp lệnh REBOOT (máy hỏi lệnh 10 giây / lần) · máy TCP/IP: SDK RestartDevice · máy AI / Hikvision: lệnh của hãng.
// Chỉ làm trong WINDOW_MIN phút đầu kể từ giờ hẹn: máy tính tắt / ngủ qua giờ đó thì BỎ lượt hôm đó
// (không khởi động lại bù giữa giờ làm). Lệnh REBOOT máy Push chưa tới được máy (máy mất mạng) quá WINDOW_MIN phút thì huỷ,
// tránh máy nối lại giữa ngày rồi khởi động lại.
import { db, getSetting } from './db.js';
import { queueCmd } from './device-sync.js';
import { tcpEnabled, tcpProbe, zkRun } from './zk-tcp.js';
import { unionEnabled, unionSimple } from './union.js';
import { aiEnabled, aiAction } from './ai-device.js';
import { hikEnabled, hikRestart } from './hik-isapi.js';
import { busyFlag, eachTenant } from './tenant.js';

const WINDOW_MIN = 10;
const DAY_VI = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

// 'HH:MM|0123456' → { min, days:[…] } · sai định dạng → null
export function parseSched(s) {
  const m = /^(\d{2}):(\d{2})\|([0-6]{1,7})$/.exec(String(s || ''));
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return { hm: `${m[1]}:${m[2]}`, min: +m[1] * 60 + +m[2], days: [...new Set(m[3].split('').map(Number))].sort() };
}
export function buildSched(time, days) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time || ''))) return null;
  const ds = [...new Set((days || []).map(Number).filter((x) => x >= 0 && x <= 6))].sort();
  return ds.length ? `${time}|${ds.join('')}` : null;
}
export function schedLabel(s) {
  const p = parseSched(s);
  if (!p) return '';
  return p.hm + ' ' + (p.days.length === 7 ? 'hằng ngày' : [...p.days.filter((x) => x), ...p.days.filter((x) => !x)].map((x) => DAY_VI[x]).join(', '));
}

// Giờ Việt Nam (máy chủ VPS có thể để múi giờ khác) của mốc ms
const vn = (ms) => { const d = new Date(ms + 7 * 3600e3); return { day: d.toISOString().slice(0, 10), dow: d.getUTCDay(), min: d.getUTCHours() * 60 + d.getUTCMinutes() }; };

// Khởi động lại 1 máy theo loại kết nối. utc = giờ nhịp hiện tại (mốc tính hạn huỷ lệnh). Trả ghi chú ngắn, lỗi thì ném.
async function rebootNow(d, utc) {
  if (getSetting('device_enabled', '0') !== '1') throw new Error('phần mềm đang tắt dùng máy chấm công');
  if (d.conn_type === 'tcp') {
    if (!tcpEnabled()) throw new Error('chưa bật máy TCP/IP');
    if (!(await tcpProbe(d.tcp_ip, d.tcp_port))) throw new Error(`không thấy máy ở ${d.tcp_ip}:${d.tcp_port}`);
    await zkRun(d, 'restart', { timeoutMs: 60000 });
    return 'đã khởi động lại';
  }
  if (d.conn_type === 'hik') {
    if (!hikEnabled()) throw new Error('chưa bật máy Hikvision');
    await hikRestart(d);
    return 'đã khởi động lại';
  }
  if (d.conn_type === 'union') {
    if (!unionEnabled()) throw new Error('chưa bật máy Union');
    await unionSimple(d, 'reboot');
    return 'đã khởi động lại';
  }
  if (d.conn_type === 'ai') {
    if (!aiEnabled()) throw new Error('chưa bật máy AI');
    aiAction(d.serial, 'restart');
    return 'đã gửi lệnh';
  }
  queueCmd(d.serial, 'REBOOT', { mkind: 'sched_reboot' });
  db.prepare("UPDATE push_device_commands SET created_at=? WHERE serial=? AND mkind='sched_reboot' AND trans_time IS NULL").run(utc, d.serial);
  return 'đã gửi lệnh';
}

const busy = busyFlag();
// 1 nhịp kiểm tra (gọi mỗi 30 giây; nowMs để kiểm thử). Trả danh sách máy đã xử lý ở nhịp này.
export async function rebootTick(nowMs = Date.now()) {
  if (!busy.take()) return [];
  const done = [];
  try {
    const utc = new Date(nowMs).toISOString().slice(0, 19).replace('T', ' ');
    db.prepare(`DELETE FROM push_device_commands WHERE mkind='sched_reboot' AND trans_time IS NULL AND created_at < datetime(?, '-${WINDOW_MIN} minutes')`).run(utc);
    const now = vn(nowMs);
    for (const d of db.prepare("SELECT * FROM push_devices WHERE active=1 AND reboot_sched<>''").all()) {
      const s = parseSched(d.reboot_sched);
      if (!s) continue;
      // hôm nay, hoặc hôm qua khi giờ hẹn sát nửa đêm (VD 23:55 → còn tới 00:05)
      for (const back of [0, 1]) {
        const at = vn(nowMs - back * 86400e3), late = now.min + back * 1440 - s.min;
        if (late < 0 || late >= WINDOW_MIN || !s.days.includes(at.dow) || d.reboot_last === at.day) continue;
        db.prepare('UPDATE push_devices SET reboot_last=? WHERE id=?').run(at.day, d.id);   // đánh dấu TRƯỚC: lỗi cũng không thử dồn dập
        let note;
        try { note = await rebootNow(d, utc); } catch (e) { note = 'lỗi: ' + e.message; }
        note = `${at.day.slice(8, 10)}/${at.day.slice(5, 7)} ${s.hm} — ${note}`;
        db.prepare('UPDATE push_devices SET reboot_note=? WHERE id=?').run(note, d.id);
        console.log(`[hẹn giờ khởi động lại] máy ${d.name || d.serial}: ${note}`);
        done.push({ serial: d.serial, note });
        break;
      }
    }
  } finally { busy.done(); }
  return done;
}

export function startRebootScheduler() {
  const run = () => eachTenant(() => rebootTick().catch((e) => console.error('[hẹn giờ khởi động lại]', e.message)));
  setTimeout(run, 15000).unref?.();
  setInterval(run, 30000).unref?.();
}
