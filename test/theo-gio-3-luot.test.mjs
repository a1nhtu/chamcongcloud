// Test chế độ THEO GIỜ + quy tắc "Theo cặp vào / ra" khi ngày có LƯỢT LẺ (VD 3 lượt: vào 1 · ra 1 · vào 2 chưa ra).
// Lỗi gốc (04/11/2026): 08:52 · 14:47 · 16:34 → phần mềm tính 08:52 → 16:34 = 7g42p; đúng phải là ra 1 − vào 1 = 5g55p
// (chưa có ra 2 thì không tính phiên 2). Ngày đủ cặp (2 lượt, 4 lượt) phải ra đúng số như cũ.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'dgp-3luot-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema, setSetting } = await import('../server/db.js');
const { rebuildDay } = await import('../server/device-sync.js');

const iso = (d, t) => new Date(`${d}T${t}+07:00`).toISOString();
let eid;
const day = (d, times) => {
  const ins = db.prepare("INSERT INTO device_punches(serial, pin, punch_at, work_date, status, verify, employee_id) VALUES ('M1','G1',?,?,0,1,?)");
  for (const t of times) ins.run(iso(d, t), d, eid);
  rebuildDay(eid, d);
  return db.prepare('SELECT work_minutes FROM attendance WHERE employee_id=? AND work_date=?').get(eid, d).work_minutes;
};

before(() => {
  initSchema();
  setSetting('attendance_mode', 'hourly');
  setSetting('hourly_merge_rule', 'pairs');
  setSetting('punch_dedup_min', '15');
  eid = Number(db.prepare("INSERT INTO employees(code, username, password_hash, full_name, role, active) VALUES ('G1','g1','x','NV G1','employee',1)").run().lastInsertRowid);
});
after(() => { try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} });

test('3 lượt (vào 2 chưa ra): chỉ tính ra 1 − vào 1', () => {
  assert.equal(day('2026-11-04', ['08:52:00', '14:47:00', '16:34:00']), 355);   // 5g55p (trước: 462 = 7g42p)
  assert.equal(day('2026-11-02', ['08:58:00', '13:57:00', '16:59:00']), 299);   // trước: 482
});

test('ngày đủ cặp không đổi: 4 lượt = tổng 2 cặp, 2 lượt = ra − vào (làm tròn giây như cũ)', () => {
  assert.equal(day('2026-11-01', ['08:41:00', '14:46:00', '16:33:00', '22:05:00']), 697);
  assert.equal(day('2026-11-05', ['07:43:10', '14:30:50']), 408);   // 6g47p40s → làm tròn 408 như trước
});

test('5 lượt: 2 cặp đủ, lượt thứ 5 chưa ra không tính', () => {
  assert.equal(day('2026-11-06', ['07:00:00', '11:00:00', '13:00:00', '17:00:00', '19:00:00']), 480);
});

test('quy tắc Đầu – cuối (FILO) giữ nguyên: 3 lượt = lượt đầu → lượt cuối', () => {
  setSetting('hourly_merge_rule', 'filo');
  try { assert.equal(day('2026-11-07', ['08:52:00', '14:47:00', '16:34:00']), 462); }
  finally { setSetting('hourly_merge_rule', 'pairs'); }
});
