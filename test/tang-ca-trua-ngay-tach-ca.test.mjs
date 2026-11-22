// TĂNG CA TRƯA CHỈ THEO ĐĂNG KÝ — ngày quẹt 4 lần bị tách ca Sáng + Chiều (cấu hình kiểu khách Thép Hòn Gai, 22/11/2026):
// lịch "Hành chính" mỗi ngày 3 ca HC 07:15–17:00 nghỉ 11:30/90 · S 07:15–11:30 · C 13:00–17:00, tự dò theo giờ chấm.
// NV ngày nào cũng quẹt 07:10 · 11:32 · 12:58 · 17:05 → 2 dòng S + C (không có giờ nghỉ). Có đăng ký 11:30–12:00 → 30',
// 11:30–12:30 → 60' (cộng vào dòng ca chiều); không đăng ký → như ngày thường. Bật "Phải đăng ký mới tính tăng ca".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'dgp-trua-tach-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema, setSetting } = await import('../server/db.js');
const { rebuildDay } = await import('../server/device-sync.js');
const { syncOtReg } = await import('../server/ot-reg.js');

const D = '2026-11-18';   // Thứ Tư
const iso = (hm) => new Date(`${D}T${hm}:00+07:00`).toISOString();
const ins = (t, o) => { const k = Object.keys(o); return Number(db.prepare(`INSERT INTO ${t}(${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`).run(...Object.values(o)).lastInsertRowid); };
let n = 0;
const nv = (times) => {
  n++;
  const id = ins('employees', { code: 'T' + n, username: 't' + n, password_hash: 'x', full_name: 'NV ' + n, role: 'employee', active: 1, device_pin: 'P' + n, department: 'Công nhân' });
  for (const t of times) ins('device_punches', { serial: 'M', pin: 'P' + n, punch_at: iso(t), work_date: D, status: 0, verify: 1, employee_id: id });
  return id;
};
const rows = (id) => db.prepare('SELECT s.code, a.ot_min, a.work_unit FROM attendance a LEFT JOIN shifts s ON s.id=a.shift_id WHERE employee_id=? AND work_date=? ORDER BY check_in_at').all(id, D)
  .map((r) => `${r.code}:${r.ot_min}`).join(' ');
const lunch = (id, f, t) => ins('ot_lunch_reg', { employee_id: id, work_date: D, from_hm: f, to_hm: t });

before(() => {
  initSchema();
  db.exec('DELETE FROM shifts');
  const base = { late_grace_min: 5, early_grace_min: 0, merge_rule: 'filo' };
  ins('shifts', { ...base, id: 1, name: 'HC', code: 'HC', start_time: '07:15', end_time: '17:00', break_start: '11:30', break_minutes: 90, work_unit_value: 1, allow_ot: 1,
    check_in_start: '04:00', check_in_end: '10:00', check_out_start: '15:00', check_out_end: '22:00' });
  ins('shifts', { ...base, id: 2, name: 'S', code: 'S', start_time: '07:15', end_time: '11:30', work_unit_value: 0.5, allow_ot: 0,
    check_in_start: '04:00', check_in_end: '10:00', check_out_start: '10:30', check_out_end: '14:00' });
  ins('shifts', { ...base, id: 3, name: 'C', code: 'C', start_time: '13:00', end_time: '17:00', work_unit_value: 0.5, allow_ot: 1,
    check_in_start: '11:30', check_in_end: '14:30', check_out_start: '15:00', check_out_end: '22:00' });
  ins('work_schedules', { id: 1, name: 'Hành chính', unit: 'week', cycle: 1 });
  for (const sid of [1, 2, 3]) {
    ins('work_schedule_shifts', { work_schedule_id: 1, shift_id: sid, sort_order: 0 });
    for (let i = 0; i < 7; i++) ins('work_schedule_days', { work_schedule_id: 1, idx: i, shift_id: sid });
  }
  ins('dept_shift_assignments', { department: '*', mode: 'schedule', work_schedule_id: 1, from_date: '2026-11-01' });
  setSetting('ot_lunch_reg', '1');
  setSetting('ot_reg_required', '1');
});
after(() => { try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} });

const P4 = ['07:10', '11:32', '12:58', '17:05'];

test('quẹt 4 lần, KHÔNG đăng ký trưa → tách S + C, không tăng ca', () => {
  const id = nv(P4); rebuildDay(id, D);
  assert.equal(rows(id), 'S:0 C:0');
});

test('quẹt 4 lần + đăng ký 11:30–12:00 → 30 phút; 11:30–12:30 → 60 phút (dòng ca chiều)', () => {
  const a = nv(P4); lunch(a, '11:30', '12:00'); rebuildDay(a, D);
  assert.equal(rows(a), 'S:0 C:30');
  const b = nv(P4); lunch(b, '11:30', '12:30'); rebuildDay(b, D);
  assert.equal(rows(b), 'S:0 C:60');
  // đổi đăng ký (Áp nhanh / duyệt đơn → syncOtReg), không dựng lại công
  db.prepare('UPDATE ot_lunch_reg SET to_hm=? WHERE employee_id=?').run('12:00', b);
  syncOtReg([b], D, D);
  assert.equal(rows(b), 'S:0 C:30');
  db.prepare('DELETE FROM ot_lunch_reg WHERE employee_id=?').run(b);
  syncOtReg([b], D, D);
  assert.equal(rows(b), 'S:0 C:0');
});

test('quẹt 2 lần cả ngày (ca HC có giờ nghỉ) + đăng ký 11:30–12:30 → 60 phút', () => {
  const id = nv(['07:10', '17:05']); lunch(id, '11:30', '12:30'); rebuildDay(id, D);
  assert.equal(rows(id), 'HC:60');
});

test('chỉ làm buổi sáng dù đã đăng ký trưa → 0', () => {
  const id = nv(['07:10', '11:32']); lunch(id, '11:30', '12:30'); rebuildDay(id, D);
  assert.equal(rows(id), 'S:0');
});
