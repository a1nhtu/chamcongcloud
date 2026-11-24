// BÁO CÁO CHUYÊN CẦN: mỗi NV đếm đi trễ / về sớm (lần + phút), quên quẹt vào / ra, tổng vi phạm.
//  · quên quẹt = ngày thiếu giờ vào / thiếu giờ ra, CỘNG ngày nhân sự đã xác nhận quên quẹt (att_flags — giờ đã bù đủ)
//  · ngày không có công trong bảng đang xem thì cờ quên quẹt không tính
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-chuyencan-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;
let report;
const iso = (d, hm) => new Date(`${d}T${hm}:00+07:00`).toISOString();

before(async () => {
  const D = await import('../server/db.js');
  const db = D.db; D.initSchema();
  db.prepare("INSERT INTO shifts(id, name, code, start_time, end_time, break_minutes, break_start) VALUES (1,'Hành chính','HC','07:30','16:30',60,'12:00')").run();
  const add = (code) => Number(db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash, shift_id, start_date) VALUES (?, ?, 'employee', ?, 'x', 1, '2020-01-01')").run(code, 'NV ' + code, code.toLowerCase()).lastInsertRowid);
  const a = add('C1'); add('C2');
  const att = (d, inn, out, late = 0, early = 0, st = 'lam_viec') => db.prepare(`INSERT INTO attendance(employee_id, work_date, shift_id, check_in_at, check_out_at, work_minutes, work_unit, late_min, early_min, ot_min, ot_type, day_status)
    VALUES (?,?,1,?,?,480,1,?,?,0,'thuong',?)`).run(a, d, inn ? iso(d, inn) : null, out ? iso(d, out) : null, late, early, st);
  att('2026-11-02', '07:40', '16:30', 10);              // trễ 10 phút
  att('2026-11-03', '07:30', null, 0, 0, 'thieu_ra');   // thiếu giờ ra → quên quẹt ra
  att('2026-11-04', '07:30', '16:30');                  // đủ giờ nhưng nhân sự xác nhận quên quẹt ra (đã bù)
  att('2026-11-06', '07:30', '16:25', 0, 5);            // về sớm 5 phút
  const flag = db.prepare('INSERT INTO att_flags(employee_id, work_date, kind) VALUES (?,?,?)');
  flag.run(a, '2026-11-04', 'quen_ra');
  flag.run(a, '2026-11-05', 'quen_vao');                // ngày không có công → không đếm
  const { buildReportData } = await import('../server/routes/reports.js');
  report = (type) => buildReportData(type, '2026-11-01', '2026-11-07', {});
});
after(() => { for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} } });

test('chuyên cần: đếm trễ, sớm, quên quẹt (thiếu giờ + đã xác nhận), bỏ cờ của ngày không có công', () => {
  const rep = report('chuyencan');
  assert.match(rep.title, /^Chuyên cần/);
  const r = rep.rows.find((x) => x.code === 'C1');
  assert.deepEqual([r.lateN, r.lateM, r.earlyN, r.earlyM, r.quenVao, r.quenRa, r.tong], [1, 10, 1, 5, 0, 2, 4]);
  const r2 = rep.rows.find((x) => x.code === 'C2');
  assert.equal(r2.tong, 0);
});

test('ngày trước ngày vào làm / sau ngày nghỉ việc không tính vắng (Tổng hợp, Chuyên cần)', async () => {
  const D = await import('../server/db.js');
  D.db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash, shift_id, start_date, leave_date, active) VALUES ('C3','NV C3','employee','c3','x',1,'2026-11-05','2026-11-05',0)").run();
  const sum = report('summary').rows.find((x) => x.code === 'C3');
  const cc = report('chuyencan').rows.find((x) => x.code === 'C3');
  assert.equal(sum.vang, 1);   // chỉ ngày 05/11 (thứ 5) là ngày phải làm; 02–04 chưa vào làm, 06 đã nghỉ
  assert.equal(cc.vang, 1);
});
