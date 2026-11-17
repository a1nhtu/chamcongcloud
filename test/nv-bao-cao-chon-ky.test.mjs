// App nhân viên › tab Báo cáo: xem công THÁNG TRƯỚC / tháng bất kỳ / TỪ NGÀY → ĐẾN NGÀY (Anh 17/11/2026).
// API /attendance/mine + /attendance/summary nhận ?month=YYYY-MM hoặc ?from&to; bỏ trống = tháng hiện tại như cũ.
// Kèm: "NGÀY CHẤM" đếm theo NGÀY (ngày làm 2 ca = 2 dòng công vẫn là 1 ngày). Chạy: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'dgp-nvbc-')), 'test.db');

let db, myRange, mine, summary, empId, vnDateStr;
const handler = (router, path) => router.stack.find((l) => l.route?.path === path && l.route.methods.get).route.stack.at(-1).handle;
const call = (h, query) => { let out; h({ query, user: { id: empId } }, { json(o) { out = o; return this; }, status() { return this; } }); return out; };

before(async () => {
  const D = await import('../server/db.js');
  db = D.db; D.initSchema();
  (await import('../server/seed.js')).ensureSeed();
  ({ vnDateStr } = await import('../server/util.js'));
  const A = await import('../server/routes/attendance.js');
  myRange = A.myRange; mine = handler(A.default, '/mine'); summary = handler(A.default, '/summary');
  empId = Number(db.prepare("INSERT INTO employees(code, username, password_hash, full_name, role, active) VALUES ('T1','t1','x','NV T1','employee',1)").run().lastInsertRowid);
  const sId = db.prepare("SELECT id FROM shifts WHERE code='S'").get().id, cId = db.prepare("SELECT id FROM shifts WHERE code='C'").get().id;
  const ins = db.prepare('INSERT INTO attendance(employee_id, work_date, shift_id, check_in_at, check_out_at, work_minutes, work_unit, late_min) VALUES (?,?,?,?,?,?,?,?)');
  const at = (d, hm) => new Date(`${d}T${hm}:00+07:00`).toISOString();
  // Tháng 10: 2 ngày, ngày 31/10 làm 2 ca (S + C)
  ins.run(empId, '2026-10-30', sId, at('2026-10-30', '07:05'), at('2026-10-30', '12:30'), 300, 0.6, 0);
  ins.run(empId, '2026-10-31', sId, at('2026-10-31', '07:10'), at('2026-10-31', '12:40'), 330, 0.68, 0);
  ins.run(empId, '2026-10-31', cId, at('2026-10-31', '14:40'), at('2026-10-31', '19:40'), 300, 0.62, 10);
  // Tháng 11: 1 ngày
  ins.run(empId, '2026-11-02', sId, at('2026-11-02', '07:00'), at('2026-11-02', '12:00'), 300, 0.6, 0);
});

test('myRange: bỏ trống = tháng hiện tại; ?month; ?from&to (đảo ngược tự sửa, tối đa 366 ngày); giá trị rác bỏ qua', () => {
  const cur = vnDateStr().slice(0, 7);
  assert.deepEqual(myRange({}), { from: cur + '-01', to: cur + '-31', month: cur });
  assert.deepEqual(myRange({ month: '2026-10' }), { from: '2026-10-01', to: '2026-10-31', month: '2026-10' });
  assert.deepEqual(myRange({ month: "x' OR 1=1" }).month, cur);
  assert.deepEqual(myRange({ from: '2026-10-15', to: '2026-11-05' }), { from: '2026-10-15', to: '2026-11-05', month: null });
  assert.deepEqual(myRange({ from: '2026-11-05', to: '2026-10-15' }), { from: '2026-10-15', to: '2026-11-05', month: null });
  assert.deepEqual(myRange({ from: '2026-11-01', to: '2026-11-10' }).month, '2026-11');
  assert.equal(myRange({ from: '2024-01-01', to: '2026-12-31' }).to, '2024-12-31');
  assert.equal(myRange({ from: '2026-10-15' }).month, cur, 'thiếu "đến ngày" → về tháng hiện tại');
});

test('xem THÁNG TRƯỚC (?month): đúng dòng + tổng; ngày 2 ca chỉ tính 1 NGÀY CHẤM', () => {
  const m = call(mine, { month: '2026-10' });
  assert.deepEqual(m.rows.map((r) => r.work_date), ['2026-10-31', '2026-10-31', '2026-10-30']);
  const s = call(summary, { month: '2026-10' });
  assert.equal(s.days, 2, '31/10 làm 2 ca vẫn là 1 ngày chấm');
  assert.equal(s.totalMinutes, 930);
  assert.equal(s.totalWorkUnit, 1.9);
  assert.equal(s.lateCount, 1);
  assert.equal(call(summary, { month: '2026-11' }).totalMinutes, 300);
});

test('xem TỪ NGÀY → ĐẾN NGÀY qua 2 tháng', () => {
  const q = { from: '2026-10-31', to: '2026-11-02' };
  assert.deepEqual(call(mine, q).rows.map((r) => r.work_date), ['2026-11-02', '2026-10-31', '2026-10-31']);
  const s = call(summary, q);
  assert.equal(s.days, 2); assert.equal(s.totalMinutes, 930); assert.equal(s.from, '2026-10-31'); assert.equal(s.to, '2026-11-02');
  assert.equal(call(summary, { from: '2026-10-01', to: '2026-10-30' }).totalMinutes, 300);
});

test('chỉ thấy công của CHÍNH mình', () => {
  const other = Number(db.prepare("INSERT INTO employees(code, username, password_hash, full_name, role, active) VALUES ('T2','t2','x','NV T2','employee',1)").run().lastInsertRowid);
  db.prepare("INSERT INTO attendance(employee_id, work_date, work_minutes) VALUES (?, '2026-10-30', 999)").run(other);
  assert.equal(call(summary, { month: '2026-10' }).totalMinutes, 930);
});
