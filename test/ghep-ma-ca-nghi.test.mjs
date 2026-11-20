// BẢNG MÃ KIỂU MAY MẶC (công tắc leave_sym_shift, mặc định TẮT — khách may Hualida, bảng công tháng 11/2026 của họ):
//  · ngày VỪA LÀM VỪA NGHỈ → mã ca + ký hiệu nghỉ (làm HC + nghỉ P → "HCP"); nghỉ CẢ NGÀY vẫn chỉ "P"
//  · báo cáo "Bảng công theo mã ca" (shiftcode): 3 dòng / NV — Ký hiệu · Giờ hành chính · Giờ tăng ca; công tắc bật thì
//    làm chủ nhật → HCk (giờ trong ca ở dòng hành chính), nghỉ chủ nhật L, lễ NL, đã nghỉ việc NV.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

// CSDL TẠM phải đặt TRƯỚC khi nạp mã máy chủ (db.js chốt đường dẫn lúc import) → import động
const DBP = join(tmpdir(), `dgp-ghepmaca-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;
let setSetting, joinLeaveSym, grid, report;
const E = {};
const iso = (d, hm) => new Date(`${d}T${hm}:00+07:00`).toISOString();

before(async () => {
  const D = await import('../server/db.js');
  const db = D.db; setSetting = D.setSetting; D.initSchema();
  ({ joinLeaveSym } = await import('../server/leave-shift-sym.js'));
  db.prepare("INSERT INTO shifts(id, name, code, start_time, end_time, break_minutes, break_start) VALUES (1,'Hành chính','HC','07:30','16:30',60,'12:00')").run();
  const emp = (code, extra = {}) => Number(db.prepare(`INSERT INTO employees(code, full_name, role, username, password_hash, shift_id, start_date, leave_date)
    VALUES (?,?,'employee',?,'x',1,?,?)`).run(code, 'NV ' + code, code.toLowerCase(), extra.start || '2020-01-01', extra.leave || '').lastInsertRowid);
  E.a = emp('A1');
  E.nv = emp('A2', { leave: '2026-11-10' });   // nghỉ việc từ 11/11
  const att = (eid, d, inn, out, work, ot, type = 'thuong') => db.prepare(`INSERT INTO attendance(employee_id, work_date, shift_id, check_in_at, check_out_at,
    work_minutes, work_unit, ot_min, ot_type, day_status) VALUES (?,?,1,?,?,?,?,?,?,'lam_viec')`).run(eid, d, iso(d, inn), iso(d, out), work, work / 480, ot, type);
  att(E.a, '2026-11-02', '07:30', '19:30', 480, 180);                  // T2: HC 8h + TC 3h
  att(E.a, '2026-11-04', '07:30', '11:30', 240, 0);                    // T4: làm nửa ngày + nghỉ nửa ngày
  att(E.a, '2026-11-08', '09:00', '18:30', 0, 510, 'cuoi_tuan');       // CN: 9h vào, cả ngày là tăng ca 8,5h
  const leave = (eid, d, half = '') => db.prepare("INSERT INTO leave_requests(employee_id, type, from_date, to_date, status, half) VALUES (?, 'Nghỉ phép', ?, ?, 'approved', ?)").run(eid, d, d, half);
  leave(E.a, '2026-11-03');           // nghỉ cả ngày
  leave(E.a, '2026-11-04', 'chieu');  // nghỉ chiều
  db.prepare("INSERT INTO public_holidays(holiday_date, name, kind) VALUES ('2026-11-24', 'Nghỉ lễ thử', 'le')").run();

  const { registerAttendanceRoutes } = await import('../server/routes/admin/attendance.js');
  const routes = {};
  const r = { get: (p, ...h) => { routes['GET ' + p] = h.at(-1); }, put: () => {}, post: () => {}, delete: () => {} };
  registerAttendanceRoutes(r, { need: () => (q, s, n) => n() });
  grid = (q) => new Promise((ok) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(j) { ok(j); }, setHeader() {} };
    routes['GET /attendance/grid']({ query: q, user: { role: 'admin', master: true } }, res);
  });
  const { buildReportData } = await import('../server/routes/reports.js');
  report = () => buildReportData('shiftcode', '2026-11-01', '2026-11-30', {});
});
after(() => { for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} } });

test('joinLeaveSym: có mã ca thì ghép, không có giữ nguyên', () => {
  assert.equal(joinLeaveSym('HC', 'PN'), 'HCPN');
  assert.equal(joinLeaveSym(' D ', 'PB'), 'DPB');
  assert.equal(joinLeaveSym('', 'PN'), 'PN');
});

const leaves = async () => {
  const j = await grid({ from: '2026-11-03', to: '2026-11-04', mode: 'detail', ids: String(E.a) });
  return Object.fromEntries(j.rows.filter((x) => x.leave).map((x) => [x.date, x.leave]));
};

test('lưới chấm công — TẮT (mặc định): chỉ ký hiệu nghỉ', async () => {
  assert.deepEqual(await leaves(), { '2026-11-03': 'P', '2026-11-04': 'P½' });
});

test('lưới chấm công — BẬT: vừa làm vừa nghỉ → HCP, nghỉ cả ngày vẫn P', async () => {
  setSetting('leave_sym_shift', '1');
  try { assert.deepEqual(await leaves(), { '2026-11-03': 'P', '2026-11-04': 'HCP½' }); }
  finally { setSetting('leave_sym_shift', '0'); }
});

const rowsOf = (rep, eid) => {
  const i = rep.rows.findIndex((r) => r.code === (eid === E.a ? 'A1' : 'A2'));
  return rep.rows.slice(i, i + 3);
};

test('Bảng công theo mã ca — TẮT: 3 dòng, mã ca / ký hiệu nghỉ, CN làm = toàn bộ tăng ca', () => {
  const rep = report();
  assert.ok(rep.columns.some((c) => c.key === 'd2026-11-30'));
  const [k, hc, tc] = rowsOf(rep, E.a);
  assert.deepEqual([k.loai, hc.loai, tc.loai], ['Ký hiệu', 'Giờ hành chính', 'Giờ tăng ca']);
  assert.equal(k.hire, '01/01/2020');
  assert.deepEqual([k['d2026-11-02'], hc['d2026-11-02'], tc['d2026-11-02']], ['HC', 8, 3]);
  assert.equal(k['d2026-11-03'], 'P');
  assert.deepEqual([k['d2026-11-04'], hc['d2026-11-04']], ['HC', 4]);
  assert.deepEqual([k['d2026-11-08'], hc['d2026-11-08'], tc['d2026-11-08']], ['HC', '', 8.5]);
  assert.equal(k['d2026-11-01'], '');      // nghỉ CN để trống
  assert.equal(k['d2026-11-24'], 'L');     // lễ
  assert.equal(k['d2026-11-05'], 'V');     // ngày phải làm, đã qua, không chấm
  assert.deepEqual([hc.total, tc.total], [12, 11.5]);
  assert.equal(rowsOf(rep, E.nv)[0]['d2026-11-12'], '');
});

test('Bảng công theo mã ca — BẬT: HCP, HCk (giờ trong ca / ngoài ca), L, NL, NV', () => {
  setSetting('leave_sym_shift', '1');
  try {
    const rep = report();
    const [k, hc, tc] = rowsOf(rep, E.a);
    assert.equal(k['d2026-11-03'], 'P');
    assert.deepEqual([k['d2026-11-04'], hc['d2026-11-04']], ['HCP', 4]);
    // CN 09:00–18:30, ca HC 07:30–16:30 nghỉ 12–13 → trong ca 6,5h, ngoài ca 2h
    assert.deepEqual([k['d2026-11-08'], hc['d2026-11-08'], tc['d2026-11-08']], ['HCk', 6.5, 2]);
    assert.equal(k['d2026-11-01'], 'L');
    assert.equal(k['d2026-11-24'], 'NL');
    assert.deepEqual([hc.total, tc.total], [18.5, 5]);   // tổng giờ không đổi: 12 + 11,5 = 18,5 + 5
    assert.equal(rowsOf(rep, E.nv)[0]['d2026-11-12'], 'NV');
  } finally { setSetting('leave_sym_shift', '0'); }
});
