// CHẤM 4 LẦN → TÁCH CA như Wise Eye On39 (Anh 16/11/2026; v1.35.4 có công tắc, v1.35.6 bỏ hẳn — luôn như vậy).
// Lịch trình có cả ca Hành chính lẫn ca Sáng + Chiều: trước đây chọn theo độ lệch nên HC luôn thắng → chấm 4 lần vẫn 1 dòng HC,
// về trưa muộn không bị trễ. Nay: chấm đủ 4 lần (mỗi buổi đủ vào–ra) → 2 dòng Sáng + Chiều; chấm 2 lần / quẹt trùng / lẻ lượt → như cũ.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'dgp-4lan-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema } = await import('../server/db.js');
const { ingestAttlog } = await import('../server/device-sync.js');
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

test('chọn ca (không biết hướng): 4 lần → Sáng + Chiều; 2 lần / quẹt trùng / lẻ lượt → như cũ', () => {
  const sh = (c) => db.prepare('SELECT * FROM shifts WHERE id=?').get(S[c]);
  const P = (t) => ({ punch_at: new Date(`2026-11-12T${t}:00+07:00`).toISOString() });
  const chon = (list) => pickShiftSet(['HC', 'SA', 'CH'].map(sh), list.map(P), '2026-11-12').map((x) => codeOf[x.shift.id] + x.punches.length).join('+');
  assert.equal(chon(['07:25', '11:25', '13:01', '16:54']), 'SA2+CH2');
  assert.equal(chon(['07:25', '11:35', '13:20', '16:54']), 'SA2+CH2');
  assert.equal(chon(['07:25', '16:54']), 'HC2', 'quên chấm trưa → vẫn HC');
  assert.equal(chon(['07:25', '07:26', '16:54', '16:55']), 'HC4', 'quẹt trùng không tính là đủ vào–ra');
  assert.equal(chon(['07:25', '11:25', '16:54']), 'HC3', 'lẻ lượt → như cũ');
  assert.equal(chon(['07:25', '11:30']), 'SA2');
  assert.equal(chon(['13:00', '17:00']), 'CH2');
});

test('chọn ca (quy tắc biết hướng — máy / phím vào ra): 4 lần → Sáng + Chiều', () => {
  const sh = (c) => db.prepare('SELECT * FROM shifts WHERE id=?').get(S[c]);
  const P = (s) => { const [t, k] = s.split(' '); return { punch_at: new Date(`2026-11-12T${t}:00+07:00`).toISOString(), status: k === 'r' ? 1 : 0 }; };
  const chon = (list) => pickDirShiftSet(['HC', 'SA', 'CH'].map(sh), list.map(P), '2026-11-12', stateDir, { min: 30, gap: 30, max: 960 })
    .map((x) => codeOf[x.shift.id] + x.punches.length).join('+');
  assert.equal(chon(['07:25 v', '11:25 r', '13:01 v', '16:54 r']), 'SA2+CH2');
  assert.equal(chon(['07:25 v', '16:54 r']), 'HC2');
});

test('dựng công thật: 4 lần → 2 dòng, về trưa muộn bị trễ buổi chiều; chấm 2 lần → HC', () => {
  const a = nv();
  cham(a, ['07:25', '11:25', '13:20', '16:54']);
  assert.deepEqual(cong(a), ['SA 07:25→11:25 0.48c sớm5', 'CH 13:20→16:54 0.44c trễ20 sớm6']);
  tinhLai(a);
  assert.deepEqual(cong(a), ['SA 07:25→11:25 0.48c sớm5', 'CH 13:20→16:54 0.44c trễ20 sớm6'], 'Tính lại ra y như vậy');
  const b = nv();
  cham(b, ['07:25', '16:54']);
  assert.deepEqual(cong(b).map((x) => x.split(' ')[0]), ['HC'], 'chấm 2 lần → HC');
});

// v1.35.7 (Anh 16/11/2026): tìm ca theo khung VÀO / RA của ca như On39 — không ưu tiên tách ca nếu giờ chấm không khớp khung của ca.
test('tìm ca theo khung vào / ra: lịch 3 ca, làm ca Chiều ra ngoài giữa ca → vẫn 1 ca Chiều; ca đêm ra ngoài → vẫn ca Đêm', () => {
  let id = 9000; const k = (code, s, e, x = {}) => ({ id: ++id, code, start_time: s, end_time: e, break_minutes: 0, work_unit_value: 1, cross_midnight: e <= s ? 1 : 0, ...x });
  const P = (t) => { const [d, h] = t.includes(' ') ? t.split(' ') : ['12', t]; return { punch_at: new Date(`2026-11-${d}T${h}:00+07:00`).toISOString() }; };
  const B3 = [k('S6', '06:00', '14:00'), k('C14', '14:00', '22:00'), k('D22', '22:00', '06:00')];
  const chon = (L, list) => pickShiftSet(L, list.map(P), '2026-11-12').map((x) => x.shift.code + x.punches.length).join('+');
  assert.equal(chon(B3, ['13:34', '17:38', '18:10', '22:10']), 'C144', 'v1.35.6 ra S6 + D22 — sai');
  assert.equal(chon(B3, ['14:10', '21:45', '22:36', '13 06:06']), 'C142+D222', 'làm 2 ca thật: Chiều rồi Đêm');
  const HD = [k('HC', '08:00', '17:00'), k('DM', '20:00', '08:00')];
  assert.equal(chon(HD, ['19:50', '23:00', '23:30', '13 07:55']), 'DM4');
  const dir = (L, list) => pickDirShiftSet(L, list.map((s, i) => ({ ...P(s), status: i % 2 })), '2026-11-12', stateDir, { min: 30, gap: 30, max: 960 })
    .map((x) => x.shift.code + x.punches.length).join('+');
  assert.equal(dir(B3, ['13:34', '17:38', '18:10', '22:10']), 'C144');
});

test('tìm ca theo khung vào / ra ĐÃ KHAI (như On39): ra trong khung ra Sáng → Sáng + Chiều; ngoài khung → như cũ', () => {
  let id = 9100; const k = (code, s, e, x = {}) => ({ id: ++id, code, start_time: s, end_time: e, break_minutes: 0, work_unit_value: 1, cross_midnight: 0, ...x });
  const L = [k('HC', '07:30', '17:00', { check_in_start: '06:00', check_in_end: '09:00', check_out_start: '16:00', check_out_end: '19:00' }),
    k('SA', '07:30', '11:30', { check_in_start: '06:00', check_in_end: '09:00', check_out_start: '11:00', check_out_end: '12:30' }),
    k('CH', '13:00', '17:00', { check_in_start: '12:30', check_in_end: '14:30', check_out_start: '16:00', check_out_end: '19:00' })];
  const P = (t) => ({ punch_at: new Date(`2026-11-12T${t}:00+07:00`).toISOString() });
  const chon = (list) => pickShiftSet(L, list.map(P), '2026-11-12').map((x) => x.shift.code + x.punches.length).join('+');
  assert.equal(chon(['07:25', '11:25', '13:20', '16:54']), 'SA2+CH2');
  assert.equal(chon(['07:25', '12:20', '12:40', '18:30']), 'SA2+CH2');
  assert.equal(chon(['07:25', '16:54']), 'HC2');
  assert.equal(chon(['07:25', '09:40', '10:05', '16:54']), 'HC4', 'ra ngoài 09:40 (ngoài khung ra Sáng) → vẫn HC');
});
