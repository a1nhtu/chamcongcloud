// CA NỐI LIỀN — MỖI LƯỢT QUẸT CHỈ DÙNG 1 LẦN (Anh chốt 11/11/2026, trankimxuyen):
// Vệ sinh 06:30–16:00 + ca gãy 16:00–21:00, Kỹ thuật 06–14 / 14–22 / 22–06. Người làm liền 2 ca: hoặc quẹt riêng ra ca trước +
// vào ca sau (16:00 / 16:01), hoặc khai thêm ca "cả ngày" gộp 2 ca (Số công 2) vào lịch trình — quẹt 06h · 21h là đủ.
// Phần mềm KHÔNG tự lấy 1 lượt làm cả giờ ra lẫn giờ vào (v1.32.7–1.32.9 từng làm, đã bỏ ở v1.32.10).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'dgp-cagay-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema } = await import('../server/db.js');
const { ingestAttlog } = await import('../server/device-sync.js');

const hm = (x) => (x ? new Date(Date.parse(x) + 7 * 3600e3).toISOString().slice(11, 16) : null);
let S = {}, W = {}, n = 0;
function ws(name, shiftIds) {
  const w = db.prepare("INSERT INTO work_schedules(code,name,unit,cycle) VALUES('',?,'week',1)").run(name).lastInsertRowid;
  shiftIds.forEach((s, i) => {
    db.prepare('INSERT OR IGNORE INTO work_schedule_shifts(work_schedule_id,shift_id,sort_order) VALUES(?,?,?)').run(w, s, i);
    for (let d = 0; d < 7; d++) db.prepare('INSERT OR IGNORE INTO work_schedule_days(work_schedule_id,idx,shift_id) VALUES(?,?,?)').run(w, d, s);
  });
  return w;
}
// nạp lượt chấm ('MM-DD HH:MM') cho 1 NV mới gán lịch trình w → các dòng công dạng 'MM-DD CA vào-ra công'
function chay(w, punches) {
  n++; const pin = String(7000 + n);
  const e = db.prepare("INSERT INTO employees(code,full_name,username,password_hash,role,device_pin) VALUES(?,?,?,'x','employee',?)").run('Q' + n, 'NV ' + n, 'q' + n, pin).lastInsertRowid;
  db.prepare("INSERT INTO shift_assignments(employee_id,mode,work_schedule_id,from_date,shift_type,merge_rule,active) VALUES(?,'schedule',?,'2026-10-01','fixed','default',1)").run(e, w);
  ingestAttlog('SN1', punches.map((p) => `${pin}\t2026-${p}:00\t0\t1`).join('\n'), { ask: () => {} });
  return db.prepare('SELECT a.*, s.code sc FROM attendance a LEFT JOIN shifts s ON s.id=a.shift_id WHERE employee_id=? ORDER BY work_date, check_in_at').all(e)
    .map((r) => `${r.work_date.slice(5)} ${r.sc} ${hm(r.check_in_at)}-${hm(r.check_out_at)} ${r.work_unit}`);
}

before(() => {
  initSchema();
  const ins = (o) => { const k = Object.keys(o); return db.prepare(`INSERT INTO shifts(${k.join(',')}) VALUES(${k.map(() => '?').join(',')})`).run(...k.map((x) => o[x])).lastInsertRowid; };
  const base = { late_grace_min: 5, early_grace_min: 15, allow_ot: 1, ot_start_after_min: 30, work_unit_value: 1, break_minutes: 0 };
  S.K1 = ins({ ...base, name: 'KT 1', code: 'K1', start_time: '06:00', end_time: '14:00', check_in_start: '04:30', check_in_end: '09:00', check_out_start: '12:00', check_out_end: '16:00' });
  S.K2 = ins({ ...base, name: 'KT 2', code: 'K2', start_time: '14:00', end_time: '22:00', check_in_start: '12:00', check_in_end: '17:00', check_out_start: '20:00', check_out_end: '23:59' });
  S.K3 = ins({ ...base, name: 'KT 3', code: 'K3', start_time: '22:00', end_time: '06:00', cross_midnight: 1, check_in_start: '20:00', check_in_end: '23:59', check_out_start: '04:00', check_out_end: '09:00' });
  S.V1 = ins({ ...base, name: 'VS 1', code: 'V1', start_time: '06:30', end_time: '16:00', check_in_start: '03:00', check_in_end: '11:30', check_out_start: '14:00', check_out_end: '18:00' });
  S.V2 = ins({ ...base, name: 'VS gãy', code: 'V2', start_time: '16:00', end_time: '21:00', check_in_start: '15:00', check_in_end: '18:30', check_out_start: '18:30', check_out_end: '23:59' });
  S.AS = ins({ ...base, name: 'AN sáng', code: 'AS', start_time: '07:00', end_time: '19:00', check_in_start: '05:00', check_in_end: '09:00', check_out_start: '15:00', check_out_end: '20:00' });
  S.AD = ins({ ...base, name: 'AN đêm', code: 'AD', start_time: '19:00', end_time: '07:00', cross_midnight: 1, check_in_start: '18:00', check_in_end: '23:59', check_out_start: '04:00', check_out_end: '09:00' });
  S.VF = ins({ ...base, name: 'VS cả ngày', code: 'VF', start_time: '06:30', end_time: '21:00', work_unit_value: 2, check_in_start: '03:00', check_in_end: '11:30', check_out_start: '19:00', check_out_end: '23:59' });
  S.KF = ins({ ...base, name: 'KT ca 1+2', code: 'KF', start_time: '06:00', end_time: '22:00', work_unit_value: 2, check_in_start: '04:30', check_in_end: '09:00', check_out_start: '20:00', check_out_end: '23:59' });
  W.KT = ws('KT', [S.K1, S.K2, S.K3, S.KF]); W.VS = ws('VS', [S.V1, S.V2, S.VF]); W.VS2 = ws('VS2', [S.V1, S.V2]); W.AN = ws('AN', [S.AS, S.AD]);
});
after(() => { try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} });

const g = (r) => r.map((x) => x.split(' ').slice(0, 3).join(' '));

test('Vệ sinh làm cả 2 ca → ca cả ngày 2 công (lượt 13h, 16h giữa ca bỏ qua)', () => {
  assert.deepEqual(chay(W.VS, ['10-27 06:00', '10-27 13:00', '10-27 21:00']), ['10-27 VF 06:00-21:00 2']);
  assert.deepEqual(chay(W.VS, ['10-27 06:02', '10-27 12:56', '10-27 15:57', '10-27 20:58']), ['10-27 VF 06:02-20:58 2']);
  assert.deepEqual(chay(W.VS, ['10-27 06:00', '10-27 13:00', '10-27 16:00', '10-27 16:01', '10-27 21:00']), ['10-27 VF 06:00-21:00 2']);
});
test('Vệ sinh chỉ làm 1 trong 2 ca → đúng 1 dòng 1 công', () => {
  assert.deepEqual(chay(W.VS, ['10-28 06:19', '10-28 13:10', '10-28 15:56']), ['10-28 V1 06:19-15:56 1']);
  assert.deepEqual(chay(W.VS, ['10-28 15:55', '10-28 21:01']), ['10-28 V2 15:55-21:01 1']);
  assert.deepEqual(g(chay(W.VS, ['10-24 09:09', '10-24 12:58', '10-24 15:58'])), ['10-24 V1 09:09-15:58']);
});
test('Lịch KHÔNG có ca cả ngày: quẹt riêng 16:00 ra + 16:01 vào → 2 dòng; chỉ quẹt 1 lần 16h → KHÔNG dùng 1 lượt cho 2 ca', () => {
  assert.deepEqual(chay(W.VS2, ['10-27 06:00', '10-27 13:00', '10-27 16:00', '10-27 16:01', '10-27 21:00']), ['10-27 V1 06:00-16:00 1', '10-27 V2 16:01-21:00 1']);
  const r = chay(W.VS2, ['10-26 06:02', '10-26 12:56', '10-26 16:01', '10-26 20:58']);
  const used = r.flatMap((x) => x.split(' ')[2].split('-')).filter((x) => x === '16:01');
  assert.ok(used.length <= 1, 'lượt 16:01 bị dùng 2 lần: ' + r.join(' | '));
});
test('Kỹ thuật làm liền ca 1 + ca 2 → ca 1+2 2 công; lượt 22:01 là RA (không phải vào ca 3)', () => {
  assert.deepEqual(chay(W.KT, ['11-03 06:00', '11-03 13:48', '11-03 22:01']), ['11-03 KF 06:00-22:01 2']);
});
test('Kỹ thuật ca đơn và ca 3 qua đêm vẫn như cũ', () => {
  assert.deepEqual(chay(W.KT, ['10-27 05:55', '10-27 14:02', '10-29 14:04', '10-29 22:00']), ['10-27 K1 05:55-14:02 1', '10-29 K2 14:04-22:00 1']);
  assert.deepEqual(chay(W.KT, ['11-03 21:55', '11-04 06:02', '11-04 21:58', '11-05 06:01']), ['11-03 K3 21:55-06:02 1', '11-04 K3 21:58-06:01 1']);
  assert.deepEqual(chay(W.KT, ['11-03 13:55', '11-03 22:02', '11-04 05:58', '11-04 14:01']), ['11-03 K2 13:55-22:02 1', '11-04 K1 05:58-14:01 1']);
});
test('An ninh ca ngày nối ca ngày (07–19 / 19–07): lượt 07:00 hôm sau KHÔNG thành ra ca đêm', () => {
  assert.deepEqual(chay(W.AN, ['11-03 06:55', '11-03 19:02', '11-04 06:57', '11-04 19:01']), ['11-03 AS 06:55-19:02 1', '11-04 AS 06:57-19:01 1']);
  assert.deepEqual(chay(W.AN, ['11-03 18:50', '11-04 07:03']), ['11-03 AD 18:50-07:03 1']);
});
