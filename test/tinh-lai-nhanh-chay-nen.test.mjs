// v1.42.2 TÍNH LẠI NHANH + CHẠY NỀN (pretty 28/11/2026: Tính lại cả công ty giữ luồng chính nhiều phút, qua tên miền bị cắt 100 giây).
//  · Nhớ tạm cấu hình ca / lịch trình / phân ca trong MỘT lần dựng công (withResolverCache) — ra Y HỆT không nhớ, ngoài lần dựng thì không nhớ gì.
//  · Tính lại chạy nền chia theo nhóm NV (startRecomputeJob) — ra Y HỆT Tính lại một lần.
//  · Mốc giờ nhớ tạm (vnInstant / toMinute) vẫn trả Date MỚI mỗi lần (nơi gọi sửa Date không ảnh hưởng lần sau).
// Chạy: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-tinh-lai-nhanh-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, S, A, R, C;
const ids = [];
const MONTH = '2026-06';

before(async () => {
  const D = await import('../server/db.js');
  db = D.db; D.initSchema();
  (await import('../server/seed.js')).ensureSeed();   // ca HC / S / C / Đêm + lịch trình "Hành chính" mặc định (như pretty)
  S = await import('../server/device-sync.js');
  A = await import('../server/routes/admin/attendance.js');
  R = await import('../server/shift-resolver.js');
  C = await import('../server/attendance-calc.js');
  const ws = db.prepare("SELECT id FROM work_schedules WHERE code='HC'").get().id;
  db.prepare("INSERT INTO dept_shift_assignments(department, mode, work_schedule_id, from_date) VALUES('*','schedule',?,'2026-01-01')").run(ws);
  db.prepare("INSERT OR IGNORE INTO departments(name) VALUES('Xưởng')").run();
  // 12 NV, đủ kiểu ngày: đủ HC, nửa buổi sáng / chiều, tăng ca tối, quên chấm ra, chỉ có lượt chiều, 4 lần quẹt, quẹt lặp
  const days = [
    ['07:55', '17:02'], ['07:58', '11:40'], ['12:58', '17:05'], ['07:50', '20:03'], ['07:59'], ['17:10'],
    ['07:52', '12:01', '12:58', '17:01'], ['07:55', '07:56', '17:03'], ['15:18', '20:03'], ['08:20', '16:30'],
  ];
  const lines = [];
  for (let k = 0; k < 12; k++) {
    const pin = String(900 + k);
    ids.push(Number(db.prepare("INSERT INTO employees(code, username, password_hash, full_name, device_pin, department, active) VALUES(?,?,'x',?,?,?,1)")
      .run('T' + pin, 'u' + pin, 'NV ' + pin, pin, k % 2 ? 'Xưởng' : '').lastInsertRowid));
    for (let d = 1; d <= 20; d++) {
      const date = `${MONTH}-${String(d).padStart(2, '0')}`;
      for (const hm of days[(k + d) % days.length]) lines.push(`${pin}\t${date} ${hm}:00\t0\t1`);
    }
  }
  S.ingestAttlog('SN_NHANH', lines.join('\n'), { ask: () => {} });
});

const snap = () => db.prepare(`SELECT employee_id, work_date, shift_id, check_in_at, check_out_at, late_min, early_min, ot_min, ot_raw_min,
  work_minutes, work_unit, day_status, ot_type, shift_source FROM attendance WHERE work_date LIKE ? ORDER BY employee_id, work_date, check_in_at`).all(MONTH + '%');

test('Tính lại chạy nền (chia nhóm NV) ra Y HỆT Tính lại một lần', async () => {
  A.recomputeAttendance({ month: MONTH });
  const once = snap();
  assert.ok(once.length > 150, 'có đủ dòng công để so');
  db.prepare("UPDATE attendance SET work_minutes=0, ot_min=0, late_min=0, work_unit=0 WHERE work_date LIKE ?").run(MONTH + '%');   // làm hỏng → tính lại phải dựng lại
  const { job, total } = A.startRecomputeJob({ month: MONTH });
  assert.equal(total, ids.length);
  let j;
  while ((j = A.recomputeJobStatus(job)).state === 'run') await new Promise((ok) => setTimeout(ok, 20));
  assert.equal(j.state, 'done', j.msg);
  assert.equal(j.done, ids.length);
  assert.deepEqual(snap(), once);
});

test('Tính lại chạy nền theo phòng ban: chỉ NV phòng đó; đang chạy thì lượt sau trả mã lượt đang chạy', async () => {
  const a = A.startRecomputeJob({ month: MONTH, deptList: ['Xưởng'] });
  assert.equal(a.total, 6);
  const b = A.startRecomputeJob({ month: MONTH });
  assert.equal(b.busy, a.job, 'không chạy 2 lượt cùng lúc');
  while (A.recomputeJobStatus(a.job).state === 'run') await new Promise((ok) => setTimeout(ok, 20));
});

test('Nhớ tạm cấu hình CHỈ trong một lần dựng công: đổi ca xong Tính lại thấy ngay', () => {
  const hc = db.prepare("SELECT id FROM shifts WHERE code='HC'").get().id;
  const v1 = R.withResolverCache(() => { const x = R.getShift(hc).check_out_end; db.prepare('UPDATE shifts SET check_out_end=? WHERE id=?').run('21:00', hc); return [x, R.getShift(hc).check_out_end]; });
  assert.equal(v1[0], v1[1], 'trong 1 lần dựng: dùng bản đã nhớ');
  assert.equal(R.getShift(hc).check_out_end, '21:00', 'xong lần dựng: đọc lại CSDL');
  db.prepare("UPDATE shifts SET check_out_end='20:00' WHERE id=?").run(hc);
  assert.equal(R.withResolverCache(() => R.getShift(hc).check_out_end), '20:00', 'lần dựng sau không dùng bản nhớ cũ');
});

test('Mốc giờ nhớ tạm vẫn trả Date mới mỗi lần', () => {
  const sh = { start_time: '08:00', end_time: '17:00' };
  const a = C.shiftBounds('2026-06-03', sh);
  a.start.setUTCHours(0);
  const b = C.shiftBounds('2026-06-03', sh);
  assert.equal(b.start.toISOString(), '2026-06-03T01:00:00.000Z');
  assert.equal(C.shiftBounds('2026-06-03', { start_time: '22:00', end_time: '06:00' }).end.toISOString(), '2026-06-03T23:00:00.000Z', 'ca đêm: giờ ra sang hôm sau');
});
