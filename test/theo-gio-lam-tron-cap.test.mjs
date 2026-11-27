// Test chế độ THEO GIỜ + "Làm tròn giờ làm xuống theo khối" (hourly_round_block, thefifty 27/11/2026, Anh chọn THEO CẶP):
// mỗi cặp vào/ra bỏ giây, làm tròn XUỐNG theo khối rồi mới cộng. Tắt (0, mặc định) = tính đúng từng phút như cũ.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'dgp-lamtron-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema, setSetting } = await import('../server/db.js');
const { rebuildDay } = await import('../server/device-sync.js');
const { sumPairsMinutes } = await import('../server/attendance-calc.js');
const { hourlyRoundBlockFrom } = await import('../server/day-metrics.js');

const iso = (d, t) => new Date(`${d}T${t}+07:00`).toISOString();
let eid;
const day = (d, times) => {
  db.prepare('DELETE FROM device_punches WHERE employee_id=? AND work_date=?').run(eid, d);
  const ins = db.prepare("INSERT INTO device_punches(serial, pin, punch_at, work_date, status, verify, employee_id) VALUES ('M1','R1',?,?,0,1,?)");
  for (const t of times) ins.run(iso(d, t), d, eid);
  rebuildDay(eid, d);
  return db.prepare('SELECT work_minutes FROM attendance WHERE employee_id=? AND work_date=?').get(eid, d).work_minutes;
};

before(() => {
  initSchema();
  setSetting('attendance_mode', 'hourly');
  setSetting('punch_dedup_min', '15');
  eid = Number(db.prepare("INSERT INTO employees(code, username, password_hash, full_name, role, active) VALUES ('R1','r1','x','NV R1','employee',1)").run().lastInsertRowid);
});
after(() => { try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} });

test('sumPairsMinutes: block = 0 như cũ, block 30 làm tròn xuống từng cặp', () => {
  const p = [[iso('2026-11-03', '08:00:00'), iso('2026-11-03', '12:14:00')], [iso('2026-11-03', '13:00:00'), iso('2026-11-03', '17:20:00')]];
  assert.equal(sumPairsMinutes(p), 514);
  assert.equal(sumPairsMinutes(p, 30), 480);
});

test('giá trị cài đặt lạ → 0 (không làm tròn)', () => {
  assert.equal(hourlyRoundBlockFrom(() => '30'), 30);
  assert.equal(hourlyRoundBlockFrom(() => '7'), 0);
  assert.equal(hourlyRoundBlockFrom(() => 'abc'), 0);
});

test('TẮT (mặc định): tính đúng từng phút như cũ', () => {
  setSetting('hourly_merge_rule', 'pairs');
  setSetting('hourly_round_block', '0');
  assert.equal(day('2026-11-03', ['08:00:00', '12:14:00', '13:00:00', '17:20:00']), 514);
  assert.equal(day('2026-11-05', ['07:43:10', '14:30:50']), 408);
});

test('Theo cặp + khối 30: mỗi cặp làm tròn xuống rồi cộng', () => {
  setSetting('hourly_merge_rule', 'pairs');
  setSetting('hourly_round_block', '30');
  assert.equal(day('2026-11-03', ['08:00:00', '12:14:00', '13:00:00', '17:20:00']), 480);   // 4g + 4g (không phải 8g30)
  assert.equal(day('2026-11-04', ['08:00:00', '12:30:00', '13:00:00', '17:59:00']), 540);   // 4g30 + 4g30
  assert.equal(day('2026-11-05', ['07:43:10', '14:30:50']), 390);   // bỏ giây: 07:43 → 14:30 = 6g47 → 6g30
  assert.equal(day('2026-11-06', ['08:00:00', '08:29:00']), 0);     // chưa đủ 30 phút → 0
  assert.equal(day('2026-11-07', ['08:52:00', '14:47:00', '16:34:00']), 330);   // lẻ lượt: chỉ cặp đủ 5g55 → 5g30
});

test('Đầu – cuối (FILO) + khối 30: cả ngày là 1 cặp đầu → cuối', () => {
  setSetting('hourly_merge_rule', 'filo');
  setSetting('hourly_round_block', '30');
  assert.equal(day('2026-11-10', ['08:00:00', '12:14:00', '13:00:00', '17:20:00']), 540);   // 08:00 → 17:20 = 9g20 → 9g
  setSetting('hourly_round_block', '0');
});
