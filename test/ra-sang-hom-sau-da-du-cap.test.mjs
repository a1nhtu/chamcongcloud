// Khách mythuatlt (25/11/2026): lịch Hành chính = HC + Sáng + Chiều, khung RA của HC / Chiều kéo tới 06:30 sáng hôm sau (nhận tăng ca
// thâu đêm). Khung đó trùng khung VÀO ca hôm sau (06:00) → lượt 06:12 sáng 25 bị lấy làm giờ ra 24 dù 24 đã có giờ ra (thêm tay 17:30
// hoặc quẹt máy), ngày 25 mất giờ vào. Nay: lượt sau nửa đêm chỉ là giờ ra hôm nay khi các lượt trong ngày còn lẻ lượt VÀO chưa ra.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'dgp-rasang-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema } = await import('../server/db.js');
const { ingestAttlog, rebuildDays } = await import('../server/device-sync.js');

const hm = (x) => (x ? new Date(Date.parse(x) + 7 * 3600e3).toISOString().slice(8, 16).replace('T', ' ') : null);
let W, n = 0;

before(() => {
  initSchema();
  const ins = (o) => { const k = Object.keys(o); return db.prepare(`INSERT INTO shifts(${k.join(',')}) VALUES(${k.map(() => '?').join(',')})`).run(...k.map((x) => o[x])).lastInsertRowid; };
  const base = { late_grace_min: 0, early_grace_min: 0, work_unit_value: 1 };
  const tc = { allow_ot: 1, ot_start_after_min: 30, ot_from_time: '18:00', ot_tier1_min: 180, ot_tier2_min: 180, ot_tier3_min: 0 };
  const HC = ins({ ...base, ...tc, name: 'Hành chính', code: 'HC', start_time: '07:00', end_time: '17:30', break_minutes: 150, break_start: '11:00',
    check_in_start: '06:00', check_in_end: '10:00', check_out_start: '15:00', check_out_end: '06:30' });
  const SA = ins({ ...base, name: 'Sáng', code: 'SA', start_time: '07:00', end_time: '11:00', break_minutes: 0, work_unit_value: 0.5,
    check_in_start: '06:00', check_in_end: '10:00', check_out_start: '10:00', check_out_end: '13:00', allow_ot: 0 });
  const CH = ins({ ...base, ...tc, name: 'Chiều', code: 'CH', start_time: '13:30', end_time: '17:30', break_minutes: 0, work_unit_value: 0.5,
    check_in_start: '12:00', check_in_end: '14:30', check_out_start: '16:30', check_out_end: '06:30' });
  W = db.prepare("INSERT INTO work_schedules(code,name,unit,cycle) VALUES('','Hành chính','week',1)").run().lastInsertRowid;
  [HC, SA, CH].forEach((s, i) => db.prepare('INSERT OR IGNORE INTO work_schedule_shifts(work_schedule_id,shift_id,sort_order) VALUES(?,?,?)').run(W, s, i));
  for (let d = 0; d < 7; d++) for (const s of [HC, SA, CH]) db.prepare('INSERT OR IGNORE INTO work_schedule_days(work_schedule_id,idx,shift_id) VALUES(?,?,?)').run(W, d, s);
});
after(() => { try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} });

// punches: 'DD HH:MM' tháng 11/2026 (T3 24, T4 25); tay: [['DD','HH:MM']] giờ RA thêm tay (máy ảo TAY_RA, như Tính công › Lượt chấm)
function chay(punches, tay = []) {
  n++; const pin = String(800 + n);
  const e = db.prepare("INSERT INTO employees(code,full_name,username,password_hash,role,device_pin) VALUES(?,?,?,'x','employee',?)").run('SX' + n, 'NV ' + n, 'u' + n, pin).lastInsertRowid;
  db.prepare("INSERT INTO shift_assignments(employee_id,mode,work_schedule_id,from_date,shift_type,merge_rule,inout_schedule_id,active) VALUES(?,'schedule',?,'2026-11-01','fixed','default',NULL,1)").run(e, W);
  ingestAttlog('SN1', punches.map((p) => `${pin}\t2026-11-${p}:00\t0\t1`).join('\n'), { ask: () => {} });
  for (const [d, t] of tay) {
    db.prepare('INSERT OR IGNORE INTO device_punches(serial,pin,punch_at,work_date,status,verify,employee_id) VALUES (?,?,?,?,1,0,?)')
      .run('TAY_RA', pin, new Date(`2026-11-${d}T${t}:00+07:00`).toISOString(), '2026-11-' + d, e);
    rebuildDays([e + '|2026-11-' + d]);
  }
  return db.prepare('SELECT a.work_date, s.code, a.check_in_at, a.check_out_at, a.ot_min FROM attendance a LEFT JOIN shifts s ON s.id=a.shift_id WHERE employee_id=? ORDER BY work_date, check_in_at').all(e)
    .map((r) => `${r.code} ${hm(r.check_in_at)}→${hm(r.check_out_at)} tc${r.ot_min}`);
}

test('24 quên ra, khách thêm giờ ra tay 17:30 → 06:12 sáng 25 là giờ VÀO 25', () => {
  assert.deepEqual(chay(['24 06:55', '25 06:12', '25 17:35'], [['24', '17:30']]),
    ['HC 24 06:55→24 17:30 tc0', 'HC 25 06:12→25 17:35 tc0']);
});

test('24 đủ vào – ra bằng máy → 06:12 sáng 25 không thành giờ ra 24', () => {
  assert.deepEqual(chay(['24 06:55', '24 17:32', '25 06:12', '25 17:35']),
    ['HC 24 06:55→24 17:32 tc0', 'HC 25 06:12→25 17:35 tc0']);
});

test('tăng ca thâu đêm (chỉ có lượt vào trong ngày) → 06:00 sáng 25 vẫn là giờ ra 24, TC 12 tiếng', () => {
  assert.deepEqual(chay(['24 06:55', '25 06:00', '25 06:50', '25 17:35']),
    ['HC 24 06:55→25 06:00 tc720', 'HC 25 06:50→25 17:35 tc0']);
});

test('tăng ca tới 23:00 rồi sáng 25 đến 06:10 → không dính nhau', () => {
  assert.deepEqual(chay(['24 06:55', '24 23:00', '25 06:10', '25 17:30']),
    ['HC 24 06:55→24 23:00 tc300', 'HC 25 06:10→25 17:30 tc0']);
});
