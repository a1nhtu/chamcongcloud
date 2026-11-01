// Công tắc "hỗ trợ nhiều ca/ngày" (multi_shift_assist): chỉ HIỂN THỊ / CẢNH BÁO ở Bảng phân ca.
// Khoá: (1) phân tích đủ/thiếu/chồng giờ/quẹt 2 lần đúng; (2) công tắc TẮT → không thêm gì vào kết quả API;
// (3) code tính công không hề đọc công tắc này → bật/tắt không đổi công.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, readFileSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-multi-shift-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, initSchema, setSetting, analyzeMultiDay, multiAssistExtra, multiAssistReport;
const D = '2026-11-02';
const iso = (hm, d = D) => new Date(`${d}T${hm}:00+07:00`).toISOString();
const S = { id: 1, code: 'S', name: 'Ca sáng', start_time: '08:00', end_time: '12:00' };
const C = { id: 2, code: 'C', name: 'Ca chiều', start_time: '13:00', end_time: '17:00' };
const HC = { id: 3, code: 'HC', name: 'Hành chính', start_time: '08:00', end_time: '17:00' };
const row = (shift_id, a, b) => ({ shift_id, check_in_at: iso(a), check_out_at: b ? iso(b) : null });
const st = (r) => r.shifts.map((x) => `${x.code}:${x.status}`).join(',');

before(async () => {
  ({ db, initSchema, setSetting } = await import('../server/db.js'));
  ({ analyzeMultiDay, multiAssistExtra, multiAssistReport } = await import('../server/multi-shift.js'));
  initSchema();
});

test('S+C có đủ 2 dòng công → ✓', () => {
  const r = analyzeMultiDay(D, [S, C], [row(1, '08:00', '12:00'), row(2, '13:00', '17:00')]);
  assert.equal(r.mark, '✓'); assert.equal(st(r), 'S:ok,C:ok'); assert.equal(r.twoPunch, false);
});
test('S+C mà chỉ có công ca sáng → ✗ thiếu ca chiều', () => {
  const r = analyzeMultiDay(D, [S, C], [row(1, '08:00', '12:00')]);
  assert.equal(r.mark, '✗'); assert.equal(st(r), 'S:ok,C:missing');
});
test('chưa có dòng công nào → chưa có dữ liệu, không đánh dấu', () => {
  const r = analyzeMultiDay(D, [S, C], []);
  assert.equal(r.mark, ''); assert.equal(st(r), 'S:unknown,C:unknown');
});
test('ca gãy chỉ quẹt 2 lần (vào 08:00, ra 17:00) → ✗ + cảnh báo nghi thiếu quẹt trưa', () => {
  const r = analyzeMultiDay(D, [S, C], [row(1, '08:00', '17:00')]);
  assert.equal(r.mark, '✗'); assert.equal(r.twoPunch, true);
});
test('chỉ làm buổi sáng đúng giờ → không bị coi là quẹt 2 lần', () => {
  assert.equal(analyzeMultiDay(D, [S, C], [row(1, '08:00', '12:00')]).twoPunch, false);
});
test('HC + S chồng giờ → ⚠', () => {
  const r = analyzeMultiDay(D, [S, HC], [row(3, '08:00', '17:00')]);
  assert.equal(r.mark, '⚠'); assert.deepEqual(r.overlap, [['S', 'HC']]);
  assert.equal(r.twoPunch, false);   // ca kia chồng giờ với ca đã tính → không phải chuyện thiếu quẹt
});

test('công tắc TẮT (mặc định) → API không thêm khoá nào', () => {
  assert.deepEqual(multiAssistExtra('2026-11-01', '2026-11-30'), {});
  assert.deepEqual(multiAssistReport(new Set(['1|2026-11-02'])), {});
});

test('công tắc BẬT → trả multi cho ô được gán ≥ 2 ca, ô 1 ca thì không', () => {
  const ins = (name, st_, et) => db.prepare('INSERT INTO shifts(name,code,start_time,end_time) VALUES(?,?,?,?)').run(name, name, st_, et).lastInsertRowid;
  const s1 = ins('S', '08:00', '12:00'), s2 = ins('C', '13:00', '17:00'), s3 = ins('HC', '08:00', '17:00');
  const emp = db.prepare("INSERT INTO employees(code,full_name,username,password_hash,role) VALUES('N1','N1','n1','x','employee')").run().lastInsertRowid;
  const asg = db.prepare("INSERT INTO daily_shift_assignments(employee_id,work_date,shift_id,is_off,source) VALUES(?,?,?,0,'sheet')");
  asg.run(emp, D, s1); asg.run(emp, D, s2);                      // ngày 02: S+C
  asg.run(emp, '2026-11-03', s3);                                 // ngày 03: 1 ca
  asg.run(emp, '2026-11-04', s1); asg.run(emp, '2026-11-04', s3); // ngày 04: S+HC chồng giờ
  db.prepare("INSERT INTO attendance(employee_id,work_date,check_in_at,check_out_at,shift_id) VALUES(?,?,?,?,?)").run(emp, D, iso('08:00'), iso('12:00'), s1);
  setSetting('multi_shift_assist', '1');
  try {
    const x = multiAssistExtra('2026-11-01', '2026-11-30');
    assert.equal(x.multiAssist, true);
    assert.deepEqual(Object.keys(x.multi).sort(), [`${emp}|${D}`, `${emp}|2026-11-04`]);
    assert.equal(x.multi[`${emp}|${D}`].mark, '✗');
    assert.equal(x.multi[`${emp}|2026-11-04`].mark, '⚠');
    const rep = multiAssistReport(new Set([`${emp}|${D}`, `${emp}|2026-11-03`, `${emp}|2026-11-04`]));
    assert.equal(rep.multiCells, 2); assert.equal(rep.overlapWarn.length, 1);
    assert.match(rep.overlapWarn[0], /N1.*chồng giờ/);
  } finally { setSetting('multi_shift_assist', '0'); }
  assert.deepEqual(multiAssistExtra('2026-11-01', '2026-11-30'), {});   // tắt lại → hết
});

test('code tính công KHÔNG đọc công tắc → bật/tắt không đổi công', () => {
  for (const f of ['device-sync.js', 'attendance-calc.js', 'shift-resolver.js', 'day-metrics.js', 'payroll-calc.js', 'ot-cap.js', 'swap.js']) {
    const src = readFileSync(new URL('../server/' + f, import.meta.url), 'utf8');
    assert.ok(!/multi_shift_assist|multi-shift/.test(src), f + ' không được dùng công tắc nhiều ca');
  }
});
