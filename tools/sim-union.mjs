// GIẢ LẬP cầu nối máy Union (thay server/union/UnionBridge.exe khi kiểm thử, không cần máy thật / Windows):
//   UNION_BRIDGE="node tools/sim-union.mjs" node server/index.js
// Giả 1 máy Terminal ID 1 (IP 192.168.1.50) kết nối ngay, 3 nhân viên, vài lượt chấm; cứ 20 giây (SIM_UNION_RT_MS) có 1 lượt chấm real-time của Số ID 1001.
// Nói đúng giao thức dòng TAB của UnionBridge.cs (xem đầu file đó).
import { createInterface } from 'node:readline';

const out = (...c) => process.stdout.write(c.join('\t') + '\n');
const port = process.argv[process.argv.indexOf('--port') + 1] || '9870';
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const USERS = [['1001', 'Nguyen Van A', 0], ['1002', 'Tran Thi B', 0], ['1', 'Quan tri', 1]];
const day = (n, h, m) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(h, m, 0, 0); return stamp(d); };
// [Số ID, giờ, AuthMode, AuthType, hợp lệ, AuthResult]
const LOGS = [['1001', day(1, 7, 55), 1, 0, 1, 0], ['1001', day(1, 17, 5), 2, 0, 1, 0], ['1002', day(1, 8, 2), 1, 3, 1, 0],
  ['1002', day(1, 17, 31), 2, 5, 1, 0], ['9999', day(1, 9, 0), 3, 0, 0, 1], ['0', day(1, 9, 1), 3, 3, 0, 1]];

out('READY', port);
setTimeout(() => out('C', 1, '192.168.1.50'), 300);
setInterval(() => out('L', 1, 'R', '1001', stamp(new Date()), 3, 0, 1, 0, '', 0, 0), +process.env.SIM_UNION_RT_MS || 20000).unref();

createInterface({ input: process.stdin }).on('line', (l) => {
  const [id, cmd, tid] = l.split('\t');
  if (cmd === 'quit') process.exit(0);
  if (tid !== '1') return out('A', id, '7');   // máy không kết nối
  out('A', id, '0');
  setTimeout(() => {
    if (cmd === 'users') USERS.forEach((u, i) => out('U', 1, u[0], u[1], u[2], '', i + 1, USERS.length));
    else if (cmd === 'logs' || cmd === 'newlogs') {
      const [, , , from, to] = l.split('\t');
      const rows = LOGS.filter((x) => !from || (x[1].slice(0, 10) >= from && x[1].slice(0, 10) <= to));
      if (!rows.length) return out('LE', 1, 0);
      rows.forEach((x, i) => out('L', 1, 'G', ...x, '', i + 1, rows.length));
    } else if (cmd === 'count') out('N', 1, 0, 1, 3, 3000, 4, 6000, 1, 1000);
    else if (cmd === 'fw') out('V', 1, 0, 'AC-2200 v1.2.3');
    else if (cmd === 'info') out('I', 1, '192.168.1.50', '1.2', 2200, 0, '00:11:22:33:44:55');
    else if (cmd === 'deluser') out('E', 1, 1611, 0, l.split('\t')[3]);
  }, 200);
});
