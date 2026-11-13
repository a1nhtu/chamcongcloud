// TẠO ẢNH MẪU BÁO CÁO — bước 1: dựng CSDL tạm có dữ liệu GIẢ (8 NV tên giả, 1–12/10/2026), xuất Excel từng báo cáo
// theo cả mẫu theo ca lẫn mẫu theo giờ vào thư mục tạm. Bước 2 (render-anh.py) chụp file Excel thành ảnh PNG cho nút "Xem mẫu".
// Chạy: node tools/anh-mau-bao-cao/xuat-excel-mau.mjs <thư mục ra>   (hoặc chạy cả 2 bước: tools/anh-mau-bao-cao/TaoAnhMau.bat)
// KHÔNG đụng CSDL thật: DB_PATH đặt ở thư mục tạm trước khi nạp mã app.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const OUT = process.argv[2] || join(tmpdir(), 'dgp-anh-mau-xlsx');
mkdirSync(OUT, { recursive: true });
const DBP = join(tmpdir(), `dgp-anh-mau-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

const { db, initSchema, setSetting } = await import('../../server/db.js');
const { signToken } = await import('../../server/auth.js');
const { ingestAttlog } = await import('../../server/device-sync.js');
const reportRoutes = (await import('../../server/routes/reports.js')).default;
const express = (await import('express')).default;
initSchema();
setSetting('company_name', 'CÔNG TY TNHH MẪU');
setSetting('hourly_merge_rule', 'pairs');

const FROM = '2026-10-01', TO = '2026-10-12';
const shift = Number(db.prepare(`INSERT INTO shifts(name, code, start_time, end_time, late_grace_min, early_grace_min, work_days, break_minutes, break_start,
  work_unit_value, allow_ot, ot_start_after_min, check_in_start, check_in_end, check_out_start, check_out_end)
  VALUES ('Hành chính', 'HC', '08:00', '17:00', 5, 5, '1,2,3,4,5,6', 60, '12:00', 1, 1, 30, '05:00', '11:00', '13:30', '23:59')`).run().lastInsertRowid);
const NV = [
  ['NV001', 'Nguyễn Văn An', 'Sản xuất'], ['NV002', 'Trần Thị Bình', 'Sản xuất'], ['NV003', 'Lê Văn Cường', 'Kho'],
  ['NV004', 'Phạm Thị Dung', 'Hành chính'], ['NV005', 'Hoàng Văn Em', 'Kho'], ['NV006', 'Vũ Thị Giang', 'Kế toán'],
  ['NV007', 'Đặng Văn Hùng', 'Sản xuất'], ['NV008', 'Bùi Thị Lan', 'Hành chính'],   // Hành chính xếp đầu: ảnh mẫu thấy ngay người quẹt 4 lần
];
for (const d of new Set(NV.map((n) => n[2]))) try { db.prepare('INSERT INTO departments(name) VALUES(?)').run(d); } catch {}
const adm = Number(db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash) VALUES ('ADM','Quản trị','admin','adm','x')").run().lastInsertRowid);
const ids = NV.map(([code, name, dept], i) => {
  const id = Number(db.prepare("INSERT INTO employees(code, full_name, department, role, username, password_hash, device_pin, start_date) VALUES (?,?,?,'employee',?,'x',?,'2025-03-01')")
    .run(code, name, dept, code.toLowerCase(), String(i + 1)).lastInsertRowid);
  db.prepare("INSERT INTO shift_assignments(employee_id, mode, shift_id, from_date, shift_type, merge_rule, active) VALUES (?, 'shift', ?, '2026-01-01', 'fixed', 'default', 1)").run(id, shift);
  return id;
});

// Giờ quẹt giả, cố định (không ngẫu nhiên → chạy lại ra ảnh y hệt): đi đúng giờ / đi muộn / về sớm / tăng ca / 4 lần quẹt / thiếu giờ ra / nghỉ phép
const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const lines = [];
const days = [];
for (let t = Date.parse(FROM + 'T00:00:00Z'); t <= Date.parse(TO + 'T00:00:00Z'); t += 864e5) days.push(new Date(t).toISOString().slice(0, 10));
days.forEach((d, di) => {
  const wd = new Date(d + 'T12:00:00Z').getUTCDay();   // 0 = CN
  NV.forEach((_, i) => {
    const pin = String(i + 1), k = (di * 7 + i * 13) % 17;
    if (wd === 0) { if (i === 6 && di < 7) lines.push(`${pin}\t${d} 07:58:00\t0\t1`, `${pin}\t${d} 12:03:00\t0\t1`); return; }   // CN: 1 người đi làm buổi sáng
    if (i === 1 && d === '2026-10-06') return;   // nghỉ phép (đơn đã duyệt bên dưới)
    if (i === 4 && d === '2026-10-08') return;   // vắng không phép
    const vin = 7 * 60 + 45 + (k % 5) * 4 + (k === 3 ? 25 : 0) + (i === 2 && wd === 1 ? 32 : 0);   // thỉnh thoảng đi muộn
    const vout = 17 * 60 + (k % 4) * 6 + (i === 0 || i === 6 ? (k % 3 === 0 ? 105 : 0) : 0) - (k === 9 ? 40 : 0);   // tăng ca / về sớm
    lines.push(`${pin}\t${d} ${hm(vin)}:00\t0\t1`);
    if (i === 3 || i === 7) lines.push(`${pin}\t${d} ${hm(12 * 60 + 1 + k % 4)}:00\t0\t1`, `${pin}\t${d} ${hm(12 * 60 + 52 + k % 6)}:00\t0\t1`);   // 4 lần quẹt
    if (!(i === 2 && d === '2026-10-09')) lines.push(`${pin}\t${d} ${hm(vout)}:00\t0\t1`);   // 1 ngày quên chấm ra
  });
});
ingestAttlog('MAU0001', lines.join('\n'), { ask: () => {} });
db.prepare("INSERT INTO leave_requests(employee_id, type, from_date, to_date, status, reviewed_by) VALUES (?, 'Nghỉ phép', '2026-10-06', '2026-10-06', 'approved', ?)").run(ids[1], adm);
const { rebuildDay } = await import('../../server/device-sync.js');
for (const id of ids) for (const d of days) { try { rebuildDay(id, d); } catch {} }

const tok = signToken({ id: adm, code: 'ADM', role: 'admin', full_name: 'Quản trị' });
const app = express();
app.use('/api/reports', reportRoutes);
const server = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
const root = `http://127.0.0.1:${server.address().port}`;

// Mọi báo cáo trên màn thẻ (public/admin-parts/84-may-hikvision-ai.js REPORT_GROUPS) — theo ca + theo giờ (báo cáo nào có ở mẫu theo giờ)
const TYPES = ['attendance', 'firstlast', 'detail', 'detaillist', 'empsheet', 'empsheetlate', 'detailmulti', 'daytime', 'workhours', 'track6',
  'horizontal', 'hourstat', 'symbol', 'late', 'ot', 'summary', 'absence', 'leave', 'payroll', 'manualtime'];
const HOURLY_HIDE = ['late', 'ot', 'symbol', 'horizontal', 'empsheetlate', 'audit3', 'audit3day'];
const done = [];
for (const mode of ['shift', 'hourly']) {
  for (const type of TYPES) {
    if (mode === 'hourly' && HOURLY_HIDE.includes(type)) continue;
    const res = await fetch(`${root}/api/reports/export.xlsx?type=${type}&from=${FROM}&to=${TO}&mode=${mode}`, { headers: { Authorization: 'Bearer ' + tok } });
    if (res.status !== 200) { console.log(`BỎ ${type} (${mode}): HTTP ${res.status} ${(await res.text()).slice(0, 120)}`); continue; }
    const name = `${type}${mode === 'hourly' ? '-gio' : ''}.xlsx`;
    writeFileSync(join(OUT, name), Buffer.from(await res.arrayBuffer()));
    done.push(name);
  }
}
server.close();
db.close();
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
console.log(`Đã xuất ${done.length} file Excel mẫu vào ${OUT}`);
process.exit(0);
