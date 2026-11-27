// Khách mythuatlt (27/11/2026): lịch Hành chính = HC + Sáng + Chiều. Ngày đã SỬA TAY một ca, lúc ngày đó được dựng lại (sửa ngày trước
// → dựng nối tiếp, Tính lại…) thì ca TRÙNG GIỜ với ca đã sửa không được dựng thêm dòng từ lượt quẹt:
//  - sửa tay HC 06:15–20:00 (lượt thật 06:13 nằm ngoài khung vào HC 06:15) → trước sinh thêm dòng ma "Ca sáng 06:13 thiếu ra"
//  - sửa tay Ca sáng 06:51–11:00 (chỉ có 1 lượt 06:51) → trước sinh thêm dòng ma "HC 06:51 thiếu ra"
// Ca KHÔNG trùng giờ với ca đã sửa (sửa tay ca Sáng, chiều quẹt ca Chiều) vẫn dựng như cũ.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'dgp-suatay-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema } = await import('../server/db.js');
const { ingestAttlog, rebuildDays } = await import('../server/device-sync.js');

const hm = (x) => (x ? new Date(Date.parse(x) + 7 * 3600e3).toISOString().slice(8, 16).replace('T', ' ') : null);
const iso = (d, t) => new Date(`2026-11-${d}T${t}:00+07:00`).toISOString();
let n = 0;
const W = {};

// 1 lịch trình 3 ca như mythuatlt; hcIn = "Bắt đầu vào" của HC; rule = quy tắc ghép của cả 3 ca; k = hậu tố mã ca
function lich(k, hcIn, rule) {
  const ins = (o) => { const c = Object.keys(o); return db.prepare(`INSERT INTO shifts(${c.join(',')}) VALUES(${c.map(() => '?').join(',')})`).run(...c.map((x) => o[x])).lastInsertRowid; };
  const base = { late_grace_min: 0, early_grace_min: 0, work_unit_value: 1, merge_rule: rule, tdqd_mode: 'pair' };
  const tc = { allow_ot: 1, ot_start_after_min: 30, ot_from_time: '18:00', ot_tier1_min: 180, ot_tier2_min: 180, ot_tier3_min: 360 };
  const HC = ins({ ...base, ...tc, name: 'Hành chính ' + k, code: 'HC' + k, start_time: '07:00', end_time: '17:30', break_minutes: 150, break_start: '11:00',
    check_in_start: hcIn, check_in_end: '10:00', check_out_start: '15:00', check_out_end: '06:10' });
  const SA = ins({ ...base, name: 'Sáng ' + k, code: 'SA' + k, start_time: '07:00', end_time: '11:00', break_minutes: 0, work_unit_value: 0.5,
    check_in_start: '06:00', check_in_end: '09:00', check_out_start: '10:00', check_out_end: '13:00', allow_ot: 0 });
  const CH = ins({ ...base, ...tc, name: 'Chiều ' + k, code: 'CH' + k, start_time: '13:30', end_time: '17:30', break_minutes: 0, work_unit_value: 0.5,
    check_in_start: '12:00', check_in_end: '14:30', check_out_start: '16:30', check_out_end: '06:10' });
  const w = db.prepare("INSERT INTO work_schedules(code,name,unit,cycle) VALUES('',?,'week',1)").run('Hành chính ' + k).lastInsertRowid;
  [HC, SA, CH].forEach((s, i) => db.prepare('INSERT OR IGNORE INTO work_schedule_shifts(work_schedule_id,shift_id,sort_order) VALUES(?,?,?)').run(w, s, i));
  for (let d = 0; d < 7; d++) for (const s of [HC, SA, CH]) db.prepare('INSERT OR IGNORE INTO work_schedule_days(work_schedule_id,idx,shift_id) VALUES(?,?,?)').run(w, d, s);
  return w;
}

before(() => {
  initSchema();
  W.cu = lich('', '06:15', 'filo');     // cài đặt khách để từ 25/11 14:29 tới 27/11
  W.moi = lich('M', '06:00', 'filo');   // cài đặt sau khi đặt lại 06:00
  W.seq = lich('Q', '06:00', 'tdqd');   // "Tự động - qua đêm" (nhánh ghép cặp tuần tự rebuildSeqDay)
});
after(() => { try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} });

// punches: 'DD HH:MM' tháng 11/2026; tay: ['DD', mã ca, 'vào', 'ra'] = khách sửa tay dòng công ngày đó, rồi ngày đó được dựng lại
function chay(w, punches, tay) {
  n++; const pin = String(900 + n);
  const e = db.prepare("INSERT INTO employees(code,full_name,username,password_hash,role,device_pin) VALUES(?,?,?,'x','employee',?)").run('ST' + n, 'NV ' + n, 'st' + n, pin).lastInsertRowid;
  db.prepare("INSERT INTO shift_assignments(employee_id,mode,work_schedule_id,from_date,shift_type,merge_rule,inout_schedule_id,active) VALUES(?,'schedule',?,'2026-11-01','fixed','default',NULL,1)").run(e, w);
  ingestAttlog('SN1', punches.map((p) => `${pin}\t2026-11-${p}:00\t0\t1`).join('\n'), { ask: () => {} });
  if (tay) {
    const [d, code, vi, ra] = tay, wd = '2026-11-' + d;
    const sid = db.prepare('SELECT id FROM shifts WHERE code=?').get(code).id;
    db.prepare('DELETE FROM attendance WHERE employee_id=? AND work_date=?').run(e, wd);
    db.prepare("INSERT INTO attendance(employee_id,work_date,shift_id,check_in_at,check_out_at,manual,shift_source) VALUES(?,?,?,?,?,1,'manual')")
      .run(e, wd, sid, iso(d, vi), ra ? iso(d, ra) : null);
    rebuildDays([e + '|' + wd]);
  }
  return db.prepare('SELECT s.code, a.check_in_at, a.check_out_at, a.manual FROM attendance a LEFT JOIN shifts s ON s.id=a.shift_id WHERE employee_id=? ORDER BY work_date, check_in_at, s.code').all(e)
    .map((r) => `${r.code} ${hm(r.check_in_at)}→${hm(r.check_out_at)}${r.manual ? ' TAY' : ''}`);
}

test('Khải 26/11: vào 06:13 (ngoài khung vào HC 06:15), sửa tay HC 06:15–20:00 → không còn dòng "Ca sáng 06:13 thiếu ra"', () => {
  assert.deepEqual(chay(W.cu, ['26 06:13', '26 20:20'], ['26', 'HC', '06:15', '20:00']), ['HC 26 06:15→26 20:00 TAY']);
});

test('sửa tay Ca sáng 06:51–11:00 (1 lượt 06:51) → không sinh thêm dòng HC 06:51', () => {
  assert.deepEqual(chay(W.moi, ['24 06:51'], ['24', 'SAM', '06:51', '11:00']), ['SAM 24 06:51→24 11:00 TAY']);
});

test('sửa tay Ca sáng, chiều quẹt ca Chiều (không trùng giờ) → vẫn dựng dòng Chiều từ máy', () => {
  assert.deepEqual(chay(W.moi, ['24 13:25', '24 17:35'], ['24', 'SAM', '07:00', '11:00']),
    ['SAM 24 07:00→24 11:00 TAY', 'CHM 24 13:25→24 17:35']);
});

test('sau khi đặt lại vào HC 06:00: vào 06:13 ra 20:20 → 1 dòng HC đủ vào – ra', () => {
  assert.deepEqual(chay(W.moi, ['26 06:13', '26 20:20']), ['HCM 26 06:13→26 20:20']);
});

test('"Tự động - qua đêm" (ghép tuần tự): sửa tay Ca sáng 06:51–11:00 → không sinh thêm dòng ca khác trùng giờ', () => {
  const rows = chay(W.seq, ['24 06:51'], ['24', 'SAQ', '06:51', '11:00']);
  assert.deepEqual(rows, ['SAQ 24 06:51→24 11:00 TAY']);
});
