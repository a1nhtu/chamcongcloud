// GHÉP MÃ CA + KÝ HIỆU NGHỈ trên bảng công (công tắc leave_sym_shift, mặc định TẮT — khách may Hualida):
// ca HC nghỉ PN → "HCPN", ca đêm D nghỉ PB → "DPB". Không xác định được ca → giữ ký hiệu nghỉ.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

// CSDL TẠM phải đặt TRƯỚC khi nạp mã máy chủ (db.js chốt đường dẫn lúc import) → import động
const DBP = join(tmpdir(), `dgp-ghepmaca-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;
let db, setSetting, leaveShiftCoder, joinLeaveSym, grid;
const E = {};

before(async () => {
  const D = await import('../server/db.js');
  db = D.db; setSetting = D.setSetting; D.initSchema();
  ({ leaveShiftCoder, joinLeaveSym } = await import('../server/leave-shift-sym.js'));
  db.prepare("INSERT INTO shifts(id, name, code, start_time, end_time, break_minutes) VALUES (1,'Hành chính','HC','07:30','16:30',60)").run();
  db.prepare("INSERT INTO shifts(id, name, code, start_time, end_time, break_minutes, cross_midnight) VALUES (2,'Ca đêm','D','22:00','06:00',0,1)").run();
  db.prepare("INSERT INTO shifts(id, name, code, start_time, end_time, break_minutes) VALUES (3,'Ca không mã','','08:00','17:00',60)").run();
  const emp = (code, shiftId) => Number(db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash, shift_id) VALUES (?,?,'employee',?,'x',?)")
    .run(code, 'NV ' + code, code.toLowerCase(), shiftId).lastInsertRowid);
  E.hc = emp('A1', 1);        // ca mặc định HC
  E.dem = emp('A2', 1);       // ca mặc định HC nhưng phân ca ngày = D
  E.tu = emp('A3', null);     // không phân ca (tự nhận ca): tuần trước làm ca D
  E.none = emp('A4', null);   // không ca, không có ngày làm
  E.noCode = emp('A5', 3);    // ca không có mã
  db.prepare("INSERT INTO daily_shift_assignments(employee_id, work_date, shift_id) VALUES (?, '2026-03-10', 2)").run(E.dem);
  db.prepare(`INSERT INTO attendance(employee_id, work_date, shift_id, check_in_at, check_out_at, work_minutes, work_unit, day_status)
    VALUES (?, '2026-03-06', 2, '2026-03-06T15:00:00.000Z', '2026-03-06T23:00:00.000Z', 480, 1, 'lam_viec')`).run(E.tu);
  for (const id of Object.values(E)) db.prepare("INSERT INTO leave_requests(employee_id, type, from_date, to_date, status) VALUES (?, 'Nghỉ phép', '2026-03-10', '2026-03-10', 'approved')").run(id);
  const { registerAttendanceRoutes } = await import('../server/routes/admin/attendance.js');
  const routes = {};
  const r = { get: (p, ...h) => { routes['GET ' + p] = h.at(-1); }, put: () => {}, post: () => {}, delete: () => {} };
  registerAttendanceRoutes(r, { need: () => (q, s, n) => n() });
  grid = (q) => new Promise((ok) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(j) { ok(j); }, setHeader() {} };
    routes['GET /attendance/grid']({ query: q, user: { role: 'admin', master: true } }, res);
  });
});
after(() => { for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} } });

test('joinLeaveSym: có mã ca thì ghép, không có giữ nguyên', () => {
  assert.equal(joinLeaveSym('HC', 'PN'), 'HCPN');
  assert.equal(joinLeaveSym('D', 'PB'), 'DPB');
  assert.equal(joinLeaveSym('', 'PN'), 'PN');
});

test('ca của ngày nghỉ: ca mặc định → phân ca ngày → ca làm gần nhất 7 ngày trước', () => {
  const codeOf = leaveShiftCoder();
  assert.equal(codeOf(E.hc, '2026-03-10'), 'HC');
  assert.equal(codeOf(E.dem, '2026-03-10'), 'D');     // phân ca ngày thắng ca mặc định
  assert.equal(codeOf(E.tu, '2026-03-10'), 'D');      // tự nhận ca: lấy ca đã làm 06/03
  assert.equal(codeOf(E.tu, '2026-03-20'), '');       // quá 7 ngày → không đoán
  assert.equal(codeOf(E.none, '2026-03-10'), '');
  assert.equal(codeOf(E.noCode, '2026-03-10'), '');   // ca không có mã
});

const syms = async () => {
  const j = await grid({ from: '2026-03-10', to: '2026-03-10', mode: 'detail' });
  return Object.fromEntries(j.rows.filter((x) => x.leave).map((x) => [x.employee_id, x.leave]));
};

test('bảng công: công tắc TẮT (mặc định) → chỉ ký hiệu nghỉ như cũ', async () => {
  const s = await syms();
  for (const id of Object.values(E)) assert.equal(s[id], 'P');
});

test('bảng công: công tắc BẬT → ghép mã ca + ký hiệu nghỉ', async () => {
  setSetting('leave_sym_shift', '1');
  const s = await syms();
  assert.equal(s[E.hc], 'HCP'); assert.equal(s[E.dem], 'DP'); assert.equal(s[E.tu], 'DP');
  assert.equal(s[E.none], 'P'); assert.equal(s[E.noCode], 'P');
  setSetting('leave_sym_shift', '0');
});
