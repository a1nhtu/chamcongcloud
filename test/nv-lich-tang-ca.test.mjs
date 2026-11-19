// App nhân viên › tab Bảng công (lịch tháng): NV phải xem được giờ TĂNG CA / làm thêm (Anh 19/11/2026).
// - Ngày làm 2 ca (2 dòng công) → gộp: cộng giờ / công / tăng ca, giờ vào sớm nhất, giờ ra muộn nhất.
// - Ngày đi làm cuối tuần tính cả ngày là tăng ca (công 0, ot_min > 0) → "Đủ công", KHÔNG phải "Vắng".
// Chạy: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'dgp-nvtc-')), 'test.db');

let db, calendar, empId;
const handler = (router, path) => router.stack.find((l) => l.route?.path === path && l.route.methods.get).route.stack.at(-1).handle;
const call = (h, query) => { let out; h({ query, user: { id: empId } }, { json(o) { out = o; return this; }, status() { return this; } }); return out; };
const at = (d, hm) => new Date(`${d}T${hm}:00+07:00`).toISOString();

before(async () => {
  const D = await import('../server/db.js');
  db = D.db; D.initSchema();
  (await import('../server/seed.js')).ensureSeed();
  const A = await import('../server/routes/attendance.js');
  calendar = handler(A.default, '/calendar');
  empId = Number(db.prepare("INSERT INTO employees(code, username, password_hash, full_name, role, active) VALUES ('T2','t2','x','NV T2','employee',1)").run().lastInsertRowid);
  const sId = db.prepare("SELECT id FROM shifts WHERE code='S'").get().id, cId = db.prepare("SELECT id FROM shifts WHERE code='C'").get().id;
  const ins = db.prepare(`INSERT INTO attendance(employee_id, work_date, shift_id, check_in_at, check_out_at, work_minutes, work_unit, late_min, ot_min, ot_raw_min, ot_type)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  // 05/10 (CN): đi làm ngày nghỉ tuần → cả ngày là tăng ca, công 0
  ins.run(empId, '2026-10-05', sId, at('2026-10-05', '08:00'), at('2026-10-05', '17:00'), 480, 0, 0, 480, 480, 'cuoi_tuan');
  // 06/10: 2 ca S + C, ca C có 90 phút tăng ca
  ins.run(empId, '2026-10-06', cId, at('2026-10-06', '14:00'), at('2026-10-06', '20:30'), 390, 0.6, 0, 90, 90, 'thuong');
  ins.run(empId, '2026-10-06', sId, at('2026-10-06', '07:00'), at('2026-10-06', '12:00'), 300, 0.4, 0, 0, 0, 'thuong');
  // 07/10: 1 ca, tăng ca lẻ phút sau làm tròn
  ins.run(empId, '2026-10-07', sId, at('2026-10-07', '07:00'), at('2026-10-07', '18:00'), 600, 1, 0, 45.5, 46, 'thuong');
});

test('lịch tháng: ngày làm cuối tuần chỉ có tăng ca → Đủ công + ot_min + loại tăng ca', () => {
  const d = call(calendar, { month: '2026-10' }).days.find((x) => x.date === '2026-10-05');
  assert.equal(d.status, 'du_cong');
  assert.equal(d.ot_min, 480);
  assert.equal(d.ot_type, 'cuoi_tuan');
});

test('lịch tháng: ngày 2 ca được GỘP, không mất tăng ca của ca nào', () => {
  const d = call(calendar, { month: '2026-10' }).days.find((x) => x.date === '2026-10-06');
  assert.equal(d.ot_min, 90);
  assert.equal(d.work_minutes, 690);
  assert.equal(d.work_unit, 1);
  assert.equal(d.check_in, at('2026-10-06', '07:00'));
  assert.equal(d.check_out, at('2026-10-06', '20:30'));
  assert.equal(d.status, 'du_cong');
});

test('lịch tháng: ngày 1 ca vẫn như cũ', () => {
  const d = call(calendar, { month: '2026-10' }).days.find((x) => x.date === '2026-10-07');
  assert.equal(d.ot_min, 45.5);
  assert.equal(d.work_unit, 1);
  assert.equal(d.status, 'du_cong');
});
