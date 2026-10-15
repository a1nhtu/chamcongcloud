// (Dùng bởi tools/prove-meal-safe.mjs — không chạy tay.) Dựng 1 CSDL tạm với dữ liệu NGẪU NHIÊN CÓ HẠT GIỐNG (ca ngày / đêm / ngắn, đi muộn,
// về sớm, tăng ca, thiếu giờ ra, quẹt đúp, đăng ký làm thêm, ngày lễ…), nạp lượt quẹt vào device_punches rồi dựng công bằng ĐÚNG hàm của bản cài
// (server/device-sync.js › rebuildDays) và ghi toàn bộ bảng công ra file NDJSON để so giữa 2 bản mã.
//   node tools/_prove-meal-worker.mjs <root> <scenario A|B|C> <employees> <days> <seed> <mode plain|meal-on> <out.ndjson>
// mode meal-on: bật phân hệ suất ăn và chạy XEN KẼ đủ loại thao tác suất ăn giữa các mẻ tính công (chỉ có ở bản nhánh mới).
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, writeFileSync, appendFileSync } from 'node:fs';

const [root, scenario = 'A', E = '200', DAYS = '45', SEED = '1', mode = 'plain', out] = process.argv.slice(2);
const dbPath = join(tmpdir(), `prove-meal-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(dbPath + ext); } catch {} }
process.env.DB_PATH = dbPath;
const load = (f) => import(pathToFileURL(join(root, 'server', f)).href);
const { db, initSchema, setSetting } = await load('db.js');
const { rebuildDays } = await load('device-sync.js');
initSchema();

// bộ sinh số ngẫu nhiên có hạt giống (mulberry32) — mọi lần chạy cùng hạt cho đúng cùng dữ liệu
let a = (Number(SEED) * 2654435761) >>> 0;
const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ri = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const gauss = (m, sd) => m + sd * (rnd() + rnd() + rnd() - 1.5) * 1.1547;

// cài đặt theo kịch bản
if (scenario === 'B') {
  for (const [k, v] of [['punch_dedup_min', '0'], ['weekend_work_exact', '1'], ['ot_reg_required', '1'], ['ot_rounding_type', 'block'], ['ot_rounding_block', '15'], ['late_round_block', '10'], ['weekend_days', '6,7']]) setSetting(k, v);
}
if (scenario === 'C') for (const [k, v] of [['hourly_merge_rule', 'pairs'], ['workunit_rounding_mode', '2'], ['punch_dedup_min', '5'], ['weekend_work_as_ot', '0']]) setSetting(k, v);

// ca làm việc
const SH = [
  ['HC', '08:00', '17:00', 5, 60, 1, 0], ['Sáng', '06:00', '14:00', 0, 30, 1, 0], ['Chiều', '14:00', '22:00', 3, 30, 1, 0],
  ['Đêm', '22:00', '06:00', 5, 45, 1, 1], ['Ngắn', '08:00', '12:00', 0, 0, 0, 0], ['Hành chính 8h30', '08:30', '17:30', 10, 60, 1, 0],
];
const shifts = SH.map(([name, s, e, grace, brk, ot, night]) => ({ name, start: s, end: e, night,
  id: Number(db.prepare('INSERT INTO shifts(name, start_time, end_time, late_grace_min, work_days, break_minutes, allow_ot, cross_midnight) VALUES (?,?,?,?,?,?,?,?)')
    .run(name, s, e, grace, '1,2,3,4,5,6', brk, ot, night).lastInsertRowid) }));
const DEPTS = ['Sản xuất', 'Kho', 'May', 'Văn phòng', 'Bảo vệ'];
const emps = [];
db.exec('BEGIN');
for (let i = 0; i < Number(E); i++) {
  const sh = pick(shifts), hourly = scenario === 'C' && rnd() < 0.3;
  const id = Number(db.prepare('INSERT INTO employees(code, full_name, department, role, username, password_hash, shift_id, att_mode) VALUES (?,?,?,?,?,?,?,?)')
    .run('P' + String(i).padStart(4, '0'), 'NV ' + i, pick(DEPTS), 'employee', 'p' + i, 'x', sh.id, hourly ? 'hourly' : '').lastInsertRowid);
  emps.push({ id, sh, pin: 'P' + i });
}
db.exec('COMMIT');

const startDate = '2026-07-01';
const dateAdd = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const days = Array.from({ length: Number(DAYS) }, (_, i) => dateAdd(startDate, i));
for (const d of [days[5], days[20]]) if (d) db.prepare('INSERT OR IGNORE INTO public_holidays(holiday_date, name) VALUES (?,?)').run(d, 'Lễ');
const vnIso = (date, hhmm, addMin = 0, sec = 0) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.parse(date + 'T00:00:00Z') - 7 * 3600000 + (h * 60 + m + Math.round(addMin)) * 60000 + sec * 1000).toISOString();
};
const insP = db.prepare('INSERT OR IGNORE INTO device_punches(serial, pin, punch_at, work_date, status, verify, employee_id) VALUES (?,?,?,?,0,1,?)');
const insOt = db.prepare('INSERT OR REPLACE INTO ot_registrations(employee_id, work_date, minutes, updated_by) VALUES (?,?,?,?)');
const insDaily = db.prepare('INSERT OR REPLACE INTO daily_shift_assignments(employee_id, work_date, shift_id, is_off) VALUES (?,?,?,?)');
const keys = new Set();
let shiftDays = 0;
db.exec('BEGIN');
for (const e of emps) for (const date of days) {
  const dow = new Date(date + 'T12:00:00Z').getUTCDay();   // 0 = CN
  if (rnd() < (dow === 0 ? 0.88 : dow === 6 ? 0.25 : 0.06)) continue;   // nghỉ (CN nghỉ nhiều, T7 đi làm 1 phần)
  let sh = e.sh;
  const r = rnd();
  if (r < 0.03) { insDaily.run(e.id, date, null, 1); continue; }          // ngày nghỉ phân riêng
  if (r < 0.12) { sh = pick(shifts); insDaily.run(e.id, date, sh.id, 0); }  // đổi ca riêng ngày
  shiftDays++;
  const sec = () => ri(0, 59);
  let inOff = gauss(-6, 8); if (rnd() < 0.12) inOff = ri(8, 90);   // 12% đi muộn
  const inIso = vnIso(date, sh.start, inOff, sec());
  const endDate = sh.night ? dateAdd(date, 1) : date;
  let outOff = gauss(4, 9);
  const q = rnd();
  if (q < 0.18) outOff = ri(31, 200);        // tăng ca
  else if (q < 0.25) outOff = -ri(16, 90);   // về sớm
  const outIso = vnIso(endDate, sh.end, outOff, sec());
  const sn = pick(['SN1', 'SN2']);
  const put = (iso) => { const wd = new Date(Date.parse(iso) + 7 * 3600000).toISOString().slice(0, 10); insP.run(sn, e.pin, iso, wd, e.id); };
  put(inIso);
  if (rnd() < 0.07) put(vnIso(date, sh.start, inOff + ri(1, 3), sec()));      // quẹt đúp đầu ca
  if (rnd() < 0.06) { put(vnIso(date, sh.start, 240 + ri(0, 30), sec())); put(vnIso(date, sh.start, 300 + ri(0, 30), sec())); }   // ra / vào giữa ca
  if (rnd() >= 0.05) { put(outIso); if (rnd() < 0.06) put(vnIso(endDate, sh.end, outOff + ri(1, 3), sec())); }   // 5% thiếu giờ ra
  if (rnd() < 0.18) insOt.run(e.id, date, pick([30, 60, 90, 120, 180, 240]), 'prove');
  keys.add(e.id + '|' + date);
}
db.exec('COMMIT');

// phân hệ suất ăn (chỉ mode meal-on, chỉ bản mã có meal.js): bật + chạy đủ loại thao tác xen kẽ
let mealOps = null;
if (mode === 'meal-on') {
  const M = await load('meal.js');
  setSetting('meal_enabled', '1');
  const serial = 'SN1';
  db.prepare("INSERT OR IGNORE INTO push_devices(serial, name, active) VALUES (?,?,1)").run(serial, 'Máy căng tin');
  let n = 0;
  mealOps = () => {
    const d = pick(days), dn = '2099-01-' + String(ri(1, 28)).padStart(2, '0');
    for (const sh of ['trua', 'chieu', 'dem']) {
      M.loadBoard(d, sh);
      M.saveRegistrations({ workDate: dn, code: sh, items: DEPTS.map((p) => ({ department: p, count: ri(0, 80), note: 'prove' })), by: 'prove' });
      M.saveMenu(dn, sh, ['Món 1', 'Món 2', 'Món ' + ri(3, 9)]);
      const m = db.prepare('SELECT id FROM meal_menu WHERE work_date = ? AND shift = ? LIMIT 1').get(dn, sh);
      if (m) M.setMyOrder(pick(emps).id, dn, sh, m.id);
      if (++n % 5 === 0) { try { M.closeMeal(dn, sh, 'prove'); M.reopenMeal(dn, sh); } catch {} }
    }
    M.kitchenFeed(0, new Date(Date.parse(d + 'T05:00:00Z')));
    M.orderSummary(dn, 'trua');
    return 1;
  };
}

// dựng công bằng đúng hàm của bản cài, theo mẻ
const t0 = Date.now();
const all = [...keys];
let mealCalls = 0;
for (let i = 0; i < all.length; i += 1500) {
  rebuildDays(all.slice(i, i + 1500));
  if (mealOps) mealCalls += mealOps();
}

// ghi bảng công (đủ cột kết quả tính công) ra NDJSON, theo thứ tự cố định
const rows = db.prepare(`SELECT a.employee_id, e.code, a.work_date, a.shift_id, a.check_in_at, a.check_out_at, a.late_min, a.early_min, a.ot_min, a.ot_raw_min,
    a.work_unit, a.work_minutes, a.day_status, a.ot_type, a.shift_source, a.manual FROM attendance a JOIN employees e ON e.id = a.employee_id
    ORDER BY e.code, a.work_date, a.check_in_at, a.shift_id`).all();
writeFileSync(out, '');
for (let i = 0; i < rows.length; i += 2000) appendFileSync(out, rows.slice(i, i + 2000).map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(JSON.stringify({ scenario, mode, employees: Number(E), days: Number(DAYS), shiftDays, attendanceRows: rows.length, rebuildSeconds: Math.round((Date.now() - t0) / 100) / 10, mealCalls }));
for (const ext of ['', '-wal', '-shm']) { try { rmSync(dbPath + ext); } catch {} }
process.exit(0);
