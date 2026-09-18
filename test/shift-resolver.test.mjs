// Test khoá hành vi bộ giải ca (shift-resolver) trên DB tạm — phủ toàn bộ chuỗi ưu tiên:
// phân ca NGÀY (đè) → phân ca KHOẢNG → lịch trình → ca mặc định → tự dò theo giờ.
// node --test chạy mỗi file test trong tiến trình RIÊNG → set DB_PATH tạm ở đây không đụng DB khác.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-resolver-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, initSchema, resolveShift, resolveEffectiveShift, resolveDayShifts;
const id = {};
const iso = (d, hm) => new Date(`${d}T${hm}:00+07:00`).toISOString();
const D = '2026-01-05';

before(async () => {
  ({ db, initSchema } = await import('../server/db.js'));
  ({ resolveShift, resolveEffectiveShift, resolveDayShifts } = await import('../server/shift-resolver.js'));
  initSchema();

  const insShift = (name, st, et, cis, cie, mr) => {
    db.prepare("INSERT INTO shifts(name,start_time,end_time,check_in_start,check_in_end,merge_rule) VALUES(?,?,?,?,?,?)").run(name, st, et, cis, cie, mr);
    return db.prepare('SELECT id FROM shifts ORDER BY id DESC LIMIT 1').get().id;
  };
  id.HC = insShift('HC', '08:00', '17:00', '06:00', '10:00', 'filo');
  id.Sang = insShift('Sang', '06:00', '14:00', '05:00', '08:00', 'idm');
  id.Chieu = insShift('Chieu', '14:00', '22:00', '13:00', '16:00', 'filo');

  db.prepare("INSERT INTO work_schedules(name) VALUES('LT 2 ca')").run();
  id.WS = db.prepare('SELECT id FROM work_schedules ORDER BY id DESC LIMIT 1').get().id;
  db.prepare('INSERT INTO work_schedule_shifts(work_schedule_id,shift_id,sort_order) VALUES(?,?,0)').run(id.WS, id.Sang);
  db.prepare('INSERT INTO work_schedule_shifts(work_schedule_id,shift_id,sort_order) VALUES(?,?,1)').run(id.WS, id.Chieu);

  const insEmp = (code) => {
    db.prepare("INSERT INTO employees(code,full_name,username,password_hash,role) VALUES(?,?,?,'x','employee')").run(code, code, code);
    return db.prepare('SELECT id FROM employees WHERE code=?').get(code).id;
  };
  id.A = insEmp('A'); id.B = insEmp('B'); id.C = insEmp('C'); id.D = insEmp('D'); id.E = insEmp('E'); id.F = insEmp('F');

  // A: ngày nghỉ (daily is_off)
  db.prepare('INSERT INTO daily_shift_assignments(employee_id,work_date,is_off) VALUES(?,?,1)').run(id.A, D);
  // B: phân ca NGÀY 1 ca HC
  db.prepare('INSERT INTO daily_shift_assignments(employee_id,work_date,shift_id) VALUES(?,?,?)').run(id.B, D, id.HC);
  // C: phân ca KHOẢNG mode=shift HC
  db.prepare("INSERT INTO shift_assignments(employee_id,mode,shift_id,from_date,to_date,merge_rule,active) VALUES(?, 'shift', ?, '2026-01-01', NULL, 'default', 1)").run(id.C, id.HC);
  // D: ca mặc định trên hồ sơ NV
  db.prepare('UPDATE employees SET shift_id=? WHERE id=?').run(id.HC, id.D);
  // E: lịch trình 2 ca trên hồ sơ NV
  db.prepare('UPDATE employees SET work_schedule_id=? WHERE id=?').run(id.WS, id.E);
  // F: không gì cả → phải tự dò theo giờ (auto)
});

test('A — ngày nghỉ (daily is_off) → off ở cả 3 hàm', () => {
  assert.equal(resolveShift(id.A, D).off, true);
  const eff = resolveEffectiveShift(id.A, D, iso(D, '08:00'));
  assert.equal(eff.off, true); assert.equal(eff.mergeRule, null);
  const day = resolveDayShifts(id.A, D);
  assert.equal(day.off, true); assert.deepEqual(day.shifts, []);
});

test('B — phân ca ngày 1 ca → source manual, đúng ca', () => {
  assert.equal(resolveShift(id.B, D).shift.id, id.HC);
  assert.equal(resolveShift(id.B, D).source, 'manual');
  const eff = resolveEffectiveShift(id.B, D, iso(D, '08:00'));
  assert.equal(eff.shift.id, id.HC); assert.equal(eff.source, 'manual'); assert.equal(eff.mergeRule, 'filo');
  const day = resolveDayShifts(id.B, D);
  assert.equal(day.shifts.length, 1); assert.equal(day.isSchedule, false);
});

test('C — phân ca khoảng (mode=shift) → source assign', () => {
  assert.equal(resolveShift(id.C, D).source, 'assign');
  assert.equal(resolveEffectiveShift(id.C, D, iso(D, '08:00')).source, 'assign');
  assert.equal(resolveDayShifts(id.C, D).source, 'assign');
});

test('D — ca mặc định trên hồ sơ → source default', () => {
  assert.equal(resolveShift(id.D, D).source, 'default');
  assert.equal(resolveShift(id.D, D).shift.id, id.HC);
  assert.equal(resolveEffectiveShift(id.D, D, iso(D, '08:00')).source, 'default');
  assert.equal(resolveDayShifts(id.D, D).source, 'default');
});

test('E — lịch trình 2 ca → schedule; resolveDayShifts trả 2 ca; effective tự dò theo giờ', () => {
  const rs = resolveShift(id.E, D);
  assert.equal(rs.source, 'schedule'); assert.equal(rs.shift, null);
  const day = resolveDayShifts(id.E, D);
  assert.equal(day.source, 'schedule'); assert.equal(day.isSchedule, true); assert.equal(day.shifts.length, 2);
  // Chấm 06:30 → khớp cửa sổ VÀO của ca Sáng (05:00-08:00)
  const eff = resolveEffectiveShift(id.E, D, iso(D, '06:30'));
  assert.equal(eff.source, 'schedule'); assert.equal(eff.shift.id, id.Sang); assert.equal(eff.mergeRule, 'idm');
});

test('F — không phân ca/không mặc định → tự dò theo giờ (auto)', () => {
  assert.equal(resolveShift(id.F, D).source, 'none');   // resolveShift KHÔNG auto toàn cục
  const eff = resolveEffectiveShift(id.F, D, iso(D, '08:00')); // 08:00 khớp cửa sổ HC (06-10)
  assert.equal(eff.source, 'auto'); assert.equal(eff.shift.id, id.HC);
  assert.equal(resolveDayShifts(id.F, D).source, 'auto');
});
