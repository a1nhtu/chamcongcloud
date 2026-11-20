// NGHỈ THEO GIỜ (công tắc leave_hours, mặc định TẮT — khách may Hualida: nghỉ từ 1 giờ, 1,5 giờ, 2 giờ…):
//  · đơn 1 ngày ghi số giờ nghỉ; 8 giờ = 1 ngày phép (trừ phép năm, đếm nghỉ trong báo cáo theo số giờ / 8)
//  · trong số giờ đã xin, đến muộn / về sớm không tính trễ – sớm
//  · bảng mã kiểu may mặc: vừa làm vừa nghỉ theo giờ → HCPN; nghỉ CẢ NGÀY có lương mà vẫn có giờ công (thăm thân PA) → chỉ "PA"
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-nghigio-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;
let setSetting, leaveDaysIn, halfLeavePriv, computeLate, report, halfOf;
const E = {};
const iso = (d, hm) => new Date(`${d}T${hm}:00+07:00`).toISOString();
const SHIFT = { start_time: '07:30', end_time: '16:30', break_minutes: 60, break_start: '12:00' };

before(async () => {
  const D = await import('../server/db.js');
  const db = D.db; setSetting = D.setSetting; D.initSchema();
  ({ leaveDaysIn } = await import('../server/leave-quota.js'));
  ({ halfLeavePriv, computeLate } = await import('../server/attendance-calc.js'));
  const { halfLeaveFor } = await import('../server/privilege.js');
  halfOf = (eid, d) => halfLeaveFor(db, eid, d);
  db.prepare("INSERT INTO shifts(id, name, code, start_time, end_time, break_minutes, break_start) VALUES (1,'Hành chính','HC','07:30','16:30',60,'12:00')").run();
  E.a = Number(db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash, shift_id, start_date) VALUES ('B1','NV B1','employee','b1','x',1,'2020-01-01')").run().lastInsertRowid);
  db.prepare("INSERT INTO leave_types(name, sym, paid, quota) VALUES ('Phép năm', 'PN', 1, 1), ('Nghỉ thăm thân', 'PA', 1, 0)").run();
  const att = (d, inn, out, work) => db.prepare(`INSERT INTO attendance(employee_id, work_date, shift_id, check_in_at, check_out_at, work_minutes, work_unit, ot_min, ot_type, day_status)
    VALUES (?,?,1,?,?,?,?,0,'thuong','lam_viec')`).run(E.a, d, iso(d, inn), iso(d, out), work, work / 480);
  att('2026-11-02', '07:30', '15:30', 420);   // làm 7 giờ, nghỉ phép 1 giờ cuối ca
  att('2026-11-03', '07:30', '16:30', 480);   // thăm thân cả ngày nhưng vẫn tính 8 giờ công
  const lv = (type, d, hours = 0) => db.prepare("INSERT INTO leave_requests(employee_id, type, from_date, to_date, status, hours) VALUES (?,?,?,?, 'approved', ?)").run(E.a, type, d, d, hours);
  lv('Phép năm', '2026-11-02', 1);
  lv('Nghỉ thăm thân', '2026-11-03');
  const { buildReportData } = await import('../server/routes/reports.js');
  report = (type) => buildReportData(type, '2026-11-01', '2026-11-30', {});
});
after(() => { for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} } });

test('số ngày phép: theo giờ = số giờ / 8, nửa ngày 0,5, nhiều ngày giữ nguyên', () => {
  assert.equal(leaveDaysIn({ from_date: '2026-11-02', to_date: '2026-11-02', hours: 1.5 }, '2026-11-01', '2026-11-30'), 0.188);
  assert.equal(leaveDaysIn({ from_date: '2026-11-02', to_date: '2026-11-02', hours: 4 }, '2026-11-01', '2026-11-30'), 0.5);
  assert.equal(leaveDaysIn({ from_date: '2026-11-02', to_date: '2026-11-02', half: 'chieu' }, '2026-11-01', '2026-11-30'), 0.5);
  assert.equal(leaveDaysIn({ from_date: '2026-11-02', to_date: '2026-11-04', hours: 0 }, '2026-11-01', '2026-11-30'), 3);
});

test('đến muộn trong số giờ đã xin nghỉ không tính trễ', () => {
  const at = iso('2026-11-02', '08:30');
  assert.equal(computeLate(SHIFT, at, '2026-11-02'), 60);
  assert.equal(computeLate(SHIFT, at, '2026-11-02', 0, halfLeavePriv(SHIFT, '2026-11-02', 'h1')), 0);
  assert.equal(computeLate(SHIFT, at, '2026-11-02', 0, halfLeavePriv(SHIFT, '2026-11-02', 'h0.5')), 30);
  assert.equal(halfOf(E.a, '2026-11-02'), 'h1.0');   // đơn đã duyệt có số giờ → dạng 'h<giờ>'
});

test('bảng mã kiểu may mặc: làm 7 giờ + nghỉ 1 giờ → HCPN; thăm thân cả ngày có giờ công → PA', () => {
  setSetting('leave_sym_shift', '1');
  try {
    const rep = report('shiftcode');
    const i = rep.rows.findIndex((r) => r.code === 'B1');
    const [k, hc] = rep.rows.slice(i, i + 3);
    assert.deepEqual([k['d2026-11-02'], hc['d2026-11-02']], ['HCPN', 7]);
    assert.deepEqual([k['d2026-11-03'], hc['d2026-11-03']], ['PA', 8]);
  } finally { setSetting('leave_sym_shift', '0'); }
});

test('báo cáo đơn từ: đơn theo giờ đếm số giờ / 8', () => {
  const rep = report('leave');
  const pn = rep.rows.find((r) => r.type === 'Phép năm');
  assert.equal(pn.days, 0.125);
});
