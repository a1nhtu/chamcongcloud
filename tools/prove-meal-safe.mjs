// CHỨNG MINH phân hệ Quản lý suất ăn KHÔNG làm đổi kết quả tính công.
// So bảng công do bản main (cũ) và bản nhánh này dựng từ CÙNG hàng chục nghìn ca ngẫu nhiên (có hạt giống, 3 bộ cài đặt khác nhau), qua đúng hàm
// dựng công của bản cài (server/device-sync.js › rebuildDays → shift-resolver / attendance-calc / day-metrics / ot-reg…).
// Mỗi kịch bản chạy 3 lần: (1) bản main · (2) bản nhánh, công tắc suất ăn TẮT · (3) bản nhánh, công tắc BẬT + chạy xen kẽ mọi thao tác suất ăn.
// Kết quả phải KHÁC NHAU = 0 dòng ở cả (2) và (3) so với (1). Thoát mã 1 nếu có khác biệt.
//   node tools/prove-meal-safe.mjs [--ref main] [--old <thư mục bản cũ>] [--employees 300] [--days 90] [--seed 20261015]
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const NEW = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REF = arg('ref', 'main'), EMP = arg('employees', '300'), DAYS = arg('days', '90'), SEED = arg('seed', '20261015');
const WORKER = join(NEW, 'tools', '_prove-meal-worker.mjs');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

// bản cũ: thư mục có sẵn (--old) hoặc xuất đúng nội dung nhánh `main` bằng git archive (nằm trong thư mục repo để dùng chung node_modules)
let OLD = arg('old', ''), tmpOld = '';
if (!OLD) {
  tmpOld = join(NEW, `.prove-old-${process.pid}`);
  mkdirSync(tmpOld, { recursive: true });
  execFileSync('git', ['-C', NEW, 'archive', '--format=tar', '-o', join(tmpOld, '_old.tar'), REF]);
  execFileSync('tar', ['-xf', '_old.tar'], { cwd: tmpOld });   // chạy trong thư mục đích, đường dẫn tương đối (tar GNU hiểu "C:" là tên máy)
  rmSync(join(tmpOld, '_old.tar'));
  OLD = tmpOld;
}
OLD = resolve(OLD);
const cleanup = () => { if (tmpOld) { try { rmSync(tmpOld, { recursive: true, force: true }); } catch {} } };
process.on('exit', cleanup);

const oldVer = JSON.parse(readFileSync(join(OLD, 'package.json'), 'utf8')).version, newVer = JSON.parse(readFileSync(join(NEW, 'package.json'), 'utf8')).version;
console.log(`BẢN CŨ  (${REF}): ${OLD}  — v${oldVer}`);
console.log(`BẢN MỚI (nhánh): ${NEW}  — v${newVer}${oldVer === newVer ? '  (version không đổi ✓)' : '  (!) version khác main'}\n`);

// 1) các file TÍNH CÔNG phải giống hệt từng byte
const CORE = ['attendance-calc.js', 'day-metrics.js', 'shift-resolver.js', 'payroll-calc.js', 'ot-reg.js', 'ot-cap.js', 'device-sync.js', 'virtual-att.js', 'k-times.js', 'track6.js', 'privilege.js', 'swap.js', 'leave-quota.js',
  'routes/attendance.js', 'routes/reports.js', 'routes/iclock.js', 'routes/admin/attendance.js', 'routes/admin/payroll.js', 'routes/admin/ot-reg.js', 'routes/admin/assignments.js'];
let coreDiff = 0;
for (const f of CORE) {
  const a = join(OLD, 'server', f), b = join(NEW, 'server', f);
  if (!existsSync(a) || !existsSync(b)) { console.log(`  ? ${f}: thiếu file`); coreDiff++; continue; }
  const same = sha(readFileSync(a)) === sha(readFileSync(b));
  if (!same) coreDiff++;
  console.log(`  ${same ? '✓ giống hệt' : '✗ KHÁC     '}  server/${f}`);
}
console.log(`→ file tính công khác main: ${coreDiff}\n`);

// 2) so kết quả tính công trên dữ liệu ngẫu nhiên
const run = (root, scenario, mode, out) => {
  const r = spawnSync(process.execPath, ['--no-warnings', WORKER, root, scenario, EMP, DAYS, SEED + scenario, mode, out], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) { console.error(r.stderr || r.stdout); throw new Error(`worker lỗi (${scenario}/${mode}) ở ${root}`); }
  return JSON.parse(r.stdout.trim().split('\n').pop());
};
let totalDays = 0, totalRows = 0, totalDiff = 0;
console.log('Kịch bản'.padEnd(9) + 'Ca ngẫu nhiên'.padStart(14) + 'Dòng công'.padStart(11) + '   khác main (suất ăn TẮT)   khác main (suất ăn BẬT)');
for (const sc of ['A', 'B', 'C']) {
  const f = (n) => join(tmpdir(), `prove-${process.pid}-${sc}-${n}.ndjson`);
  const o = run(OLD, sc, 'plain', f('old')), n0 = run(NEW, sc, 'plain', f('new0')), n1 = run(NEW, sc, 'meal-on', f('new1'));
  const L = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean);
  const lo = L(f('old')), l0 = L(f('new0')), l1 = L(f('new1'));
  const diff = (x, y) => { let d = Math.abs(x.length - y.length); for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) d++; return d; };
  const d0 = diff(lo, l0), d1 = diff(lo, l1);
  totalDays += o.shiftDays; totalRows += lo.length; totalDiff += d0 + d1;
  console.log(sc.padEnd(9) + String(o.shiftDays).padStart(14) + String(lo.length).padStart(11) + `   ${d0 === 0 ? '0 ✓' : d0 + ' ✗'}`.padEnd(28) + `${d1 === 0 ? '0 ✓' : d1 + ' ✗'}` + `   (suất ăn chạy xen ${n1.mealCalls} đợt; sha256 ${sha(readFileSync(f('old'))).slice(0, 12)} = ${sha(readFileSync(f('new1'))).slice(0, 12)})`);
  for (const n of ['old', 'new0', 'new1']) { try { rmSync(f(n)); } catch {} }
  if (statSync(WORKER).size === 0 || o.attendanceRows === 0) throw new Error('không dựng được công — kiểm tra lại');
}
console.log(`\nTỔNG: ${totalDays} ca ngẫu nhiên (${totalRows} dòng công) × 2 phép so (tắt / bật) — số dòng KHÁC NHAU = ${totalDiff}; file tính công khác = ${coreDiff}`);
console.log(totalDiff === 0 && coreDiff === 0 ? 'KẾT LUẬN: tính công của nhánh này GIỐNG HỆT bản main ✓' : 'KẾT LUẬN: CÓ KHÁC BIỆT ✗');
process.exit(totalDiff === 0 && coreDiff === 0 ? 0 : 1);
