// CA GÃY NỐI LIỀN: làm 2 ca liền nhau trong ngày mà chỉ quẹt 1 lượt ở mốc giao ca → lượt đó vừa là giờ RA ca trước
// vừa là giờ VÀO ca sau (trankimxuyen 10/11/2026: Vệ sinh 06:30–16:00 + ca gãy 16:00–21:00, quẹt 06:00 · 13:00 · 16:00 · 21:00;
// Kỹ thuật 3 ca 06–14 / 14–22 / 22–06 làm liền ca 1 + ca 2 quẹt 06:00 · 13:48 · 22:01).
// Trước đây ca gãy bị bỏ (mất giờ 21:00) và lượt 22:01 thành "vào ca 3". Ca ngày + ca đêm qua đêm (An ninh 07–19 / 19–07) KHÔNG dùng chung.
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
  S.V1 = ins({ ...base, name: 'VS 1', code: 'V1', start_time: '06:30', end_time: '16:00', check_in_start: '04:30', check_in_end: '09:00', check_out_start: '14:00', check_out_end: '16:30' });
  S.V2 = ins({ ...base, name: 'VS gãy', code: 'V2', start_time: '16:00', end_time: '21:00', check_in_start: '15:30', check_in_end: '17:30', check_out_start: '19:00', check_out_end: '23:30' });
  S.AS = ins({ ...base, name: 'AN sáng', code: 'AS', start_time: '07:00', end_time: '19:00', check_in_start: '05:00', check_in_end: '09:00', check_out_start: '15:00', check_out_end: '20:00' });
  S.AD = ins({ ...base, name: 'AN đêm', code: 'AD', start_time: '19:00', end_time: '07:00', cross_midnight: 1, check_in_start: '18:00', check_in_end: '23:59', check_out_start: '04:00', check_out_end: '09:00' });
  W.KT = ws('KT', [S.K1, S.K2, S.K3]); W.VS = ws('VS', [S.V1, S.V2]); W.AN = ws('AN', [S.AS, S.AD]);
});
after(() => { try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} });

test('Vệ sinh ca 1 + ca gãy, 1 lượt 16:00 dùng cho cả 2 ca (lượt 13:00 giữa ca bỏ qua)', () => {
  assert.deepEqual(chay(W.VS, ['10-27 06:02', '10-27 12:56', '10-27 15:57', '10-27 20:58']), ['10-27 V1 06:02-15:57 1', '10-27 V2 15:57-20:58 1']);
  assert.deepEqual(chay(W.VS, ['10-27 06:00', '10-27 16:05', '10-27 21:00']), ['10-27 V1 06:00-16:05 1', '10-27 V2 16:05-21:00 1']);
});
test('Vệ sinh chỉ làm 1 trong 2 ca → đúng 1 dòng', () => {
  assert.deepEqual(chay(W.VS, ['10-28 06:19', '10-28 13:10', '10-28 15:56']), ['10-28 V1 06:19-15:56 1']);
  assert.deepEqual(chay(W.VS, ['10-28 15:55', '10-28 21:01']), ['10-28 V2 15:55-21:01 1']);
});
test('Có quẹt riêng ra ca 1 và vào ca gãy → không dùng chung', () => {
  const r = chay(W.VS, ['10-27 06:20', '10-27 15:00', '10-27 17:00', '10-27 21:00']);
  assert.equal(r[0].slice(0, 20), '10-27 V1 06:20-15:00');
  assert.equal(r[1].slice(0, 20), '10-27 V2 17:00-21:00');
});
test('Kỹ thuật làm liền ca 1 + ca 2: lượt giữa 13:48 dùng chung, lượt 22:01 là RA ca 2 (không phải vào ca 3)', () => {
  assert.deepEqual(chay(W.KT, ['11-03 06:00', '11-03 13:48', '11-03 22:01']), ['11-03 K1 06:00-13:48 1', '11-03 K2 13:48-22:01 1']);
  assert.deepEqual(chay(W.KT, ['10-21 06:17', '10-21 13:57', '10-21 14:00', '10-21 22:02']).map((s) => s.slice(0, 20)), ['10-21 K1 06:17-14:00', '10-21 K2 14:00-22:02']);
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
