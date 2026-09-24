// Test bổ sung các trường hợp biên của bộ giải ca (shift-resolver) chưa được phủ ở shift-resolver.test.mjs:
// ca qua đêm, nhiều ca/ngày (daily), phân ca theo khoảng ngày (mode=schedule + biên from/to + bản ghi mới nhất thắng),
// ngày lễ (không ảnh hưởng đến việc giải ca), NV chưa có ca (kể cả auto không khớp giờ nào), ca mặc định trên hồ sơ.
// node --test chạy mỗi file test trong tiến trình RIÊNG → set DB_PATH tạm ở đây không đụng DB khác.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-shift-edge-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, initSchema, resolveShift, resolveEffectiveShift, resolveDayShifts, autoDetectShift;
const id = {};
const iso = (d, hm) => new Date(`${d}T${hm}:00+07:00`).toISOString();
const D = '2026-01-05';

before(async () => {
  ({ db, initSchema } = await import('../server/db.js'));
  ({ resolveShift, resolveEffectiveShift, resolveDayShifts, autoDetectShift } = await import('../server/shift-resolver.js'));
  initSchema();

  const insShift = (name, st, et, cis, cie, mr) => {
    db.prepare("INSERT INTO shifts(name,start_time,end_time,check_in_start,check_in_end,merge_rule) VALUES(?,?,?,?,?,?)").run(name, st, et, cis, cie, mr);
    return db.prepare('SELECT id FROM shifts ORDER BY id DESC LIMIT 1').get().id;
  };
  // Ca đêm: 22:00 -> 06:00 hôm sau, cửa sổ nhận VÀO 21:00-23:00 (không wrap), cửa sổ RA suy ra từ end_time (wrap qua nửa đêm).
  id.Dem = insShift('Dem', '22:00', '06:00', '21:00', '23:00', 'filo');
  // Ca đêm khác, CÙNG cửa sổ VÀO với Dem nhưng end_time khác → outWin suy luận khác, dùng để test chấm điểm theo giờ RA.
  id.DemB = insShift('DemB', '21:00', '02:00', '21:00', '23:00', 'filo');
  // Ca có cửa sổ VÀO wrap qua nửa đêm (23:00 -> 02:00) để test inWindow khi start > end.
  id.DemWrap = insShift('DemWrap', '23:30', '07:30', '23:00', '02:00', 'filo');
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
  id.G = insEmp('G'); id.H = insEmp('H'); id.I = insEmp('I'); id.J = insEmp('J'); id.K = insEmp('K'); id.L = insEmp('L'); id.M = insEmp('M');

  // G: ca mặc định trên hồ sơ = ca đêm (để test qua đêm với nguồn 'default')
  db.prepare('UPDATE employees SET shift_id=? WHERE id=?').run(id.Dem, id.G);
  // H: nhiều ca trong 1 ngày qua daily_shift_assignments (Sáng + Chiều)
  db.prepare('INSERT INTO daily_shift_assignments(employee_id,work_date,shift_id) VALUES(?,?,?)').run(id.H, D, id.Sang);
  db.prepare('INSERT INTO daily_shift_assignments(employee_id,work_date,shift_id) VALUES(?,?,?)').run(id.H, D, id.Chieu);
  // I: phân ca KHOẢNG mode='schedule' áp dụng lịch trình 2 ca, có merge_rule ghi đè
  db.prepare("INSERT INTO shift_assignments(employee_id,mode,work_schedule_id,from_date,to_date,merge_rule,active) VALUES(?, 'schedule', ?, '2026-01-01', '2026-01-31', 'tdhc', 1)").run(id.I, id.WS);
  // J: hai bản ghi phân ca KHOẢNG chồng nhau → bản ghi mới nhất (id lớn hơn) phải thắng
  db.prepare("INSERT INTO shift_assignments(employee_id,mode,shift_id,from_date,to_date,merge_rule,active) VALUES(?, 'shift', ?, '2026-01-01', NULL, 'default', 1)").run(id.J, id.Sang);
  db.prepare("INSERT INTO shift_assignments(employee_id,mode,shift_id,from_date,to_date,merge_rule,active) VALUES(?, 'shift', ?, '2026-01-04', NULL, 'default', 1)").run(id.J, id.HC);
  // K: phân ca KHOẢNG chỉ áp dụng đúng biên from_date..to_date (2026-01-05 .. 2026-01-05)
  db.prepare("INSERT INTO shift_assignments(employee_id,mode,shift_id,from_date,to_date,merge_rule,active) VALUES(?, 'shift', ?, ?, ?, 'default', 1)").run(id.K, id.HC, D, D);
  // L: ca mặc định trên hồ sơ (HC) + có ngày lễ trùng ngày làm việc → shift-resolver vẫn giải ca bình thường
  db.prepare('UPDATE employees SET shift_id=? WHERE id=?').run(id.HC, id.L);
  db.prepare("INSERT INTO public_holidays(holiday_date,name) VALUES(?, 'Tết Dương lịch')").run(D);
  // M: nhân viên hoàn toàn chưa có ca (không daily, không khoảng, không lịch trình, không mặc định)
});

test('Ca qua đêm — NV có ca mặc định trên hồ sơ thì luôn nhận ca đó, không tự dò lại theo giờ chấm', () => {
  // 10:00 KHÔNG nằm trong cửa sổ VÀO của ca Dem (21:00-23:00) — nhưng vì đã có ca mặc định trên hồ sơ
  // nên resolveEffectiveShift trả thẳng ca đó (nguồn 'default'), không chạy autoDetectShift.
  const eff = resolveEffectiveShift(id.G, D, iso(D, '10:00'));
  assert.equal(eff.source, 'default');
  assert.equal(eff.shift.id, id.Dem);
  assert.equal(eff.mergeRule, 'filo');
});

test('Ca qua đêm — outWin suy từ end_time (không khai báo cửa sổ RA) phân biệt đúng 2 ca cùng giờ vào bằng giờ ra', () => {
  const demRow = db.prepare('SELECT * FROM shifts WHERE id=?').get(id.Dem);   // end 06:00 → out-window suy ra 05:00-14:00
  const demBRow = db.prepare('SELECT * FROM shifts WHERE id=?').get(id.DemB); // end 02:00 → out-window suy ra 01:00-10:00
  // Ra lúc 12:00 chỉ khớp cửa sổ suy luận của Dem (05:00-14:00), không khớp của DemB (01:00-10:00).
  const s1 = autoDetectShift(iso(D, '22:00'), [demRow, demBRow], iso(D, '12:00'));
  assert.equal(s1.id, id.Dem);
  // Ra lúc 02:00 chỉ khớp cửa sổ suy luận của DemB (01:00-10:00), không khớp của Dem (05:00-14:00).
  const s2 = autoDetectShift(iso(D, '22:00'), [demRow, demBRow], iso(D, '02:00'));
  assert.equal(s2.id, id.DemB);
});

test('Ca qua đêm — autoDetectShift với cửa sổ VÀO wrap qua nửa đêm (23:00-02:00) khớp cả trước và sau 0h', () => {
  const s1 = autoDetectShift(iso(D, '23:30'), [{ ...db.prepare('SELECT * FROM shifts WHERE id=?').get(id.DemWrap) }]);
  assert.equal(s1.id, id.DemWrap);
  const s2 = autoDetectShift(iso(D, '00:45'), [{ ...db.prepare('SELECT * FROM shifts WHERE id=?').get(id.DemWrap) }]);
  assert.equal(s2.id, id.DemWrap);
});

test('Nhiều ca trong 1 ngày (daily_shift_assignments) — resolveShift trả schedule không xác định ca cụ thể', () => {
  const rs = resolveShift(id.H, D);
  assert.equal(rs.off, false);
  assert.equal(rs.source, 'schedule');
  assert.equal(rs.shift, null);
  assert.equal(rs.scheduleName, '2 ca đã chọn');
});

test('Nhiều ca trong 1 ngày (daily_shift_assignments) — resolveDayShifts trả đủ danh sách 2 ca, isSchedule=true', () => {
  const day = resolveDayShifts(id.H, D);
  assert.equal(day.off, false);
  assert.equal(day.isSchedule, true);
  assert.equal(day.source, 'manual');
  assert.equal(day.shifts.length, 2);
  assert.deepEqual(day.shifts.map((s) => s.id).sort(), [id.Sang, id.Chieu].sort());
});

test('Nhiều ca trong 1 ngày (daily_shift_assignments) — resolveEffectiveShift tự dò đúng ca theo giờ chấm trong số các ca đã chọn', () => {
  const effSang = resolveEffectiveShift(id.H, D, iso(D, '06:30'));
  assert.equal(effSang.source, 'manual');
  assert.equal(effSang.shift.id, id.Sang);
  assert.equal(effSang.mergeRule, 'idm');

  const effChieu = resolveEffectiveShift(id.H, D, iso(D, '14:10'));
  assert.equal(effChieu.shift.id, id.Chieu);
  assert.equal(effChieu.mergeRule, 'filo');
});

test('Phân ca theo khoảng ngày (mode=schedule) — resolveShift/resolveDayShifts trả source=schedule, mergeRule ghi đè', () => {
  const rs = resolveShift(id.I, D);
  assert.equal(rs.source, 'schedule');
  assert.equal(rs.shift, null);

  const day = resolveDayShifts(id.I, D);
  assert.equal(day.source, 'schedule');
  assert.equal(day.isSchedule, true);
  assert.equal(day.shifts.length, 2);
  assert.equal(day.mergeRule, 'tdhc'); // override từ shift_assignments.merge_rule

  const eff = resolveEffectiveShift(id.I, D, iso(D, '06:30'));
  assert.equal(eff.source, 'schedule');
  assert.equal(eff.shift.id, id.Sang);
  assert.equal(eff.mergeRule, 'tdhc'); // ghi đè áp dụng thay vì merge_rule riêng của ca Sáng ('idm')
});

test('Phân ca theo khoảng ngày — nhiều bản ghi chồng nhau, bản ghi mới nhất (id lớn hơn) thắng', () => {
  const rs = resolveShift(id.J, D);
  assert.equal(rs.source, 'assign');
  assert.equal(rs.shift.id, id.HC); // bản ghi thêm sau (from 2026-01-04, ca HC) thắng, không phải bản ghi Sáng thêm trước
});

test('Phân ca theo khoảng ngày — đúng biên from_date/to_date (chỉ áp dụng đúng ngày đó)', () => {
  assert.equal(resolveShift(id.K, D).source, 'assign');
  assert.equal(resolveShift(id.K, D).shift.id, id.HC);
  // Ngoài khoảng (trước from_date và sau to_date) → không còn phân ca khoảng, rơi về 'none'
  assert.equal(resolveShift(id.K, '2026-01-04').source, 'none');
  assert.equal(resolveShift(id.K, '2026-01-06').source, 'none');
});

test('Ngày lễ — không làm thay đổi cách giải ca (shift-resolver không biết/không quan tâm ngày lễ)', () => {
  const rs = resolveShift(id.L, D);
  assert.equal(rs.off, false);
  assert.equal(rs.source, 'default');
  assert.equal(rs.shift.id, id.HC);
  const eff = resolveEffectiveShift(id.L, D, iso(D, '08:00'));
  assert.equal(eff.off, false);
  assert.equal(eff.shift.id, id.HC);
  // Một ngày thường (không lễ) của cùng NV vẫn cho kết quả giống hệt.
  const rsNonHoliday = resolveShift(id.L, '2026-01-06');
  assert.equal(rsNonHoliday.source, rs.source);
  assert.equal(rsNonHoliday.shift.id, rs.shift.id);
});

test('Nhân viên chưa có ca — resolveShift/resolveDayShifts đều là none/auto rỗng khi chưa chấm giờ nào', () => {
  assert.equal(resolveShift(id.M, D).source, 'none');
  assert.equal(resolveShift(id.M, D).shift, null);
  const day = resolveDayShifts(id.M, D);
  assert.equal(day.source, 'auto');
  assert.deepEqual(day.shifts, []);
  assert.equal(day.off, false);
});

test('Nhân viên chưa có ca — resolveEffectiveShift tự dò toàn cục nhưng giờ chấm không khớp cửa sổ ca nào → source=none', () => {
  // 03:00 không nằm trong cửa sổ VÀO của bất kỳ ca active nào đã tạo → auto không tìm được ca.
  const eff = resolveEffectiveShift(id.M, D, iso(D, '03:00'));
  assert.equal(eff.source, 'none');
  assert.equal(eff.shift, null);
  assert.equal(eff.mergeRule, null);
});

test('Nhân viên chưa có ca — resolveEffectiveShift tự dò ra ca khi giờ chấm khớp cửa sổ VÀO của một ca đang hoạt động', () => {
  // 08:00 khớp cửa sổ VÀO của ca HC (06:00-10:00) → auto toàn cục tìm thấy.
  const eff = resolveEffectiveShift(id.M, D, iso(D, '08:00'));
  assert.equal(eff.source, 'auto');
  assert.equal(eff.shift.id, id.HC);
});

test('Ca mặc định trên hồ sơ — vẫn áp dụng cho ngày khác miễn không có phân ca ngày/khoảng đè lên', () => {
  const eff1 = resolveEffectiveShift(id.G, '2026-02-01', iso('2026-02-01', '22:15'));
  assert.equal(eff1.source, 'default');
  assert.equal(eff1.shift.id, id.Dem);
});
