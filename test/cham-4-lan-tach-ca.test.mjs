// CHẤM 4 LẦN → TÁCH CA (Anh 16/11/2026, công tắc "split_four_punches" MẶC ĐỊNH BẬT).
// Lịch trình có cả ca Hành chính lẫn ca Sáng + Chiều: trước đây chọn theo độ lệch nên HC luôn thắng → chấm 4 lần vẫn 1 dòng HC,
// về trưa muộn không bị trễ. Nay: chấm đủ 4 lần (mỗi buổi đủ vào–ra) → 2 dòng Sáng + Chiều; chấm 2 lần / quẹt trùng / lẻ lượt → như cũ.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'dgp-4lan-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema, setSetting } = await import('../server/db.js');
const { ingestAttlog, preferSplitOn } = await import('../server/device-sync.js');
const { recomputeAttendance } = await import('../server/routes/admin/attendance.js');
const { pickShiftSet, pickDirShiftSet, stateDir } = await import('../server/attendance-calc.js');

const hm = (x) => (x ? new Date(Date.parse(x) + 7 * 3600e3).toISOString().slice(11, 16) : '-');
const ins = (t, o) => { const k = Object.keys(o); return Number(db.prepare(`INSERT INTO ${t}(${k.join(',')}) VALUES(${k.map(() => '?').join(',')})`).run(...k.map((x) => o[x])).lastInsertRowid); };
const S = {}; let codeOf = {}, W = 0;

before(() => {
  initSchema();
  db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('punch_dedup_min','5')").run();
  db.prepare('UPDATE shifts SET active=0').run();
  const base = { late_grace_min: 0, early_grace_min: 0, allow_ot: 0, work_unit_value: 1, break_minutes: 0 };
  const ca = (code, start, end, extra = {}) => (S[code] = ins('shifts', { ...base, name: code, code, start_time: start, end_time: end, ...extra }));
  ca('HC', '07:30', '17:00', { break_minutes: 90 });
  ca('SA', '07:30', '11:30', { work_unit_value: 0.5 });
  ca('CH', '13:00', '17:00', { work_unit_value: 0.5 });
  codeOf = Object.fromEntries(Object.entries(S).map(([k, v]) => [v, k]));
  W = ins('work_schedules', { code: '', name: 'HC/SA/CH', unit: 'auto', cycle: 1 });
  ['HC', 'SA', 'CH'].forEach((c, i) => ins('work_schedule_shifts', { work_schedule_id: W, shift_id: S[c], sort_order: i }));
});
after(() => { try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} });

let n = 0;
function nv() {
  n++; const pin = String(4400 + n);
  const id = ins('employees', { code: 'B' + n, full_name: 'NV ' + n, username: 'b' + n, password_hash: 'x', role: 'employee', device_pin: pin });
  ins('shift_assignments', { employee_id: id, mode: 'schedule', work_schedule_id: W, from_date: '2026-11-01', shift_type: 'fixed', merge_rule: 'default', active: 1 });
  return { id, pin };
}
const cham = (e, list) => { for (const t of list) ingestAttlog('SN1', `${e.pin}\t2026-11-12 ${t}:00\t0\t1`, { ask: () => {} }); };
const cong = (e) => db.prepare('SELECT * FROM attendance WHERE employee_id=? ORDER BY check_in_at').all(e.id)
  .map((r) => `${codeOf[r.shift_id] || '-'} ${hm(r.check_in_at)}→${hm(r.check_out_at)} ${r.work_unit}c${r.late_min ? ' trễ' + r.late_min : ''}${r.early_min ? ' sớm' + r.early_min : ''}`);
const tinhLai = (e) => recomputeAttendance({ from: '2026-11-12', to: '2026-11-12', ids: [e.id] });

test('công tắc mặc định BẬT', () => { assert.equal(preferSplitOn(), true); });

test('chọn ca (không biết hướng): 4 lần → Sáng + Chiều; 2 lần / quẹt trùng / lẻ lượt → như cũ', () => {
  const sh = (c) => db.prepare('SELECT * FROM shifts WHERE id=?').get(S[c]);
  const P = (t) => ({ punch_at: new Date(`2026-11-12T${t}:00+07:00`).toISOString() });
  const chon = (list, on) => pickShiftSet(['HC', 'SA', 'CH'].map(sh), list.map(P), '2026-11-12', { preferSplit: on }).map((x) => codeOf[x.shift.id] + x.punches.length).join('+');
  assert.equal(chon(['07:25', '11:25', '13:01', '16:54'], true), 'SA2+CH2');
  assert.equal(chon(['07:25', '11:25', '13:01', '16:54'], false), 'HC4', 'tắt: như cũ');
  assert.equal(chon(['07:25', '11:35', '13:20', '16:54'], true), 'SA2+CH2');
  assert.equal(chon(['07:25', '16:54'], true), 'HC2', 'quên chấm trưa → vẫn HC');
  assert.equal(chon(['07:25', '07:26', '16:54', '16:55'], true), 'HC4', 'quẹt trùng không tính là đủ vào–ra');
  assert.equal(chon(['07:25', '11:25', '16:54'], true), 'HC3', 'lẻ lượt → như cũ');
  assert.equal(chon(['07:25', '11:30'], true), 'SA2');
  assert.equal(chon(['13:00', '17:00'], true), 'CH2');
});

test('chọn ca (quy tắc biết hướng — máy / phím vào ra): 4 lần → Sáng + Chiều', () => {
  const sh = (c) => db.prepare('SELECT * FROM shifts WHERE id=?').get(S[c]);
  const P = (s) => { const [t, k] = s.split(' '); return { punch_at: new Date(`2026-11-12T${t}:00+07:00`).toISOString(), status: k === 'r' ? 1 : 0 }; };
  const chon = (list, on) => pickDirShiftSet(['HC', 'SA', 'CH'].map(sh), list.map(P), '2026-11-12', stateDir, { min: 30, gap: 30, max: 960 }, { preferSplit: on })
    .map((x) => codeOf[x.shift.id] + x.punches.length).join('+');
  assert.equal(chon(['07:25 v', '11:25 r', '13:01 v', '16:54 r'], true), 'SA2+CH2');
  assert.equal(chon(['07:25 v', '11:25 r', '13:01 v', '16:54 r'], false), 'HC4');
  assert.equal(chon(['07:25 v', '16:54 r'], true), 'HC2');
});

test('dựng công thật: 4 lần → 2 dòng, về trưa muộn bị trễ buổi chiều; tắt công tắc + Tính lại → 1 dòng HC', () => {
  const a = nv();
  cham(a, ['07:25', '11:25', '13:20', '16:54']);
  assert.deepEqual(cong(a), ['SA 07:25→11:25 0.48c sớm5', 'CH 13:20→16:54 0.44c trễ20 sớm6']);
  tinhLai(a);
  assert.deepEqual(cong(a), ['SA 07:25→11:25 0.48c sớm5', 'CH 13:20→16:54 0.44c trễ20 sớm6'], 'Tính lại ra y như vậy');
  const b = nv();
  cham(b, ['07:25', '16:54']);
  assert.deepEqual(cong(b).map((x) => x.split(' ')[0]), ['HC'], 'chấm 2 lần → HC');
  setSetting('split_four_punches', '0');
  try {
    tinhLai(a);
    assert.deepEqual(cong(a).map((x) => x.split(' ').slice(0, 2).join(' ')), ['HC 07:25→16:54'], 'tắt: như cũ');
  } finally { setSetting('split_four_punches', '1'); }
});
