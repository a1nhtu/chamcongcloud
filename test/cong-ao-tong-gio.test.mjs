// Công ảo — TỔNG giờ làm (công + tăng ca) tối đa / ngày · / tuần (theo phiếu khảo sát khách may Hualida).
// Vượt thì cắt bớt tăng ca cho tổng không quá hạn mức; giờ công thật giữ nguyên. Mỗi mức ảo một số riêng, để trống = không giới hạn.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-congao-tonggio-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;
let db, setSetting, virtualOt, h1;

// ca HC 07:30–16:30 (công chuẩn 480'); 1 dòng công / ngày
const vn = (d, hm) => new Date(`${d}T${hm}:00+07:00`).toISOString();
const addDay = (emp, date, work, ot, in_, out, type = 'thuong') =>
  db.prepare(`INSERT INTO attendance(employee_id, work_date, shift_id, check_in_at, check_out_at, work_minutes, work_unit, ot_min, ot_type)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(emp, date, 1, vn(date, in_), vn(date, out), work, work > 0 ? 1 : 0, ot, type);

before(async () => {
  const D = await import('../server/db.js');
  db = D.db; setSetting = D.setSetting; D.initSchema();
  ({ virtualOt } = await import('../server/virtual-att.js'));
  db.prepare("INSERT INTO shifts(id, name, code, start_time, end_time, break_minutes, work_unit_value) VALUES (1,'HC','HC','07:30','16:30',60,1)").run();
  h1 = Number(db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash) VALUES ('H1','Lê Giờ','employee','h1','x')").run().lastInsertRowid);
  // tuần 07–13/09/2026 (T2–CN). T2–T6: công 480' + tăng ca 300' (5h) mỗi ngày
  for (const d of ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']) addDay(h1, d, 480, 300, '07:30', '21:30');
});
after(() => { for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} } });

const otOf = (from, to, lv = 1) => {
  const m = virtualOt([h1], from, to, true, lv);
  const r = db.prepare('SELECT id, work_date FROM attendance WHERE employee_id=? AND work_date>=? AND work_date<=? ORDER BY work_date').all(h1, from, to);
  return r.map((x) => { const v = m.get(x.id); return { date: x.work_date, ot: v ? v.ot_min : 300 }; });
};

test('chưa đặt hạn mức tổng giờ → tăng ca giữ nguyên 300 phút', () => {
  for (const k of ['audit_totday_l1', 'audit_totday_l2', 'audit_totday_l3', 'audit_totweek_l1', 'audit_totweek_l2', 'audit_totweek_l3']) setSetting(k, '');
  assert.deepEqual(otOf('2026-09-07', '2026-09-11').map((x) => x.ot), [300, 300, 300, 300, 300]);
});

test('tổng giờ / NGÀY tối đa 12h: công 8h + TC bị cắt còn 4h (240 phút)', () => {
  setSetting('audit_totday_l1', '12');
  assert.deepEqual(otOf('2026-09-07', '2026-09-11').map((x) => x.ot), [240, 240, 240, 240, 240]);
  setSetting('audit_totday_l1', '');
});

test('tổng giờ / NGÀY áp đúng mức ảo: đặt mức 1, xem mức 2 không bị cắt', () => {
  setSetting('audit_totday_l1', '10');   // tổng 10h → TC còn 2h = 120'
  assert.deepEqual(otOf('2026-09-07', '2026-09-07', 1).map((x) => x.ot), [120]);
  assert.deepEqual(otOf('2026-09-07', '2026-09-07', 2).map((x) => x.ot), [300]);
  setSetting('audit_totday_l1', '');
});

test('tổng giờ / TUẦN tối đa 50h: công tuần 40h → TC cả tuần còn 10h, chia đều 5 ngày', () => {
  setSetting('audit_totweek_l1', '50');   // tuần: công 5×480=2400' (40h) + TC ≤ 600' (10h)
  const got = otOf('2026-09-07', '2026-09-11');
  const sum = got.reduce((a, x) => a + x.ot, 0);
  assert.equal(sum, 600, JSON.stringify(got));
  for (const x of got) assert.ok(x.ot < 300 && x.ot > 0, JSON.stringify(got));   // mỗi ngày đều giảm (chia đều theo tỷ lệ)
  setSetting('audit_totweek_l1', '');
});

test('ngày + tuần cùng bật: lấy mức chặt hơn', () => {
  setSetting('audit_totday_l1', '12');     // ngày ≤ 4h TC
  setSetting('audit_totweek_l1', '52');    // tuần ≤ 12h TC (công 40h) → 720'
  const got = otOf('2026-09-07', '2026-09-11');
  for (const x of got) assert.ok(x.ot <= 240, JSON.stringify(got));              // ngày chặn 240 chặt hơn (tuần cho tb 144/ngày… thực ra 720/5=144)
  assert.ok(got.reduce((a, x) => a + x.ot, 0) <= 720);
  setSetting('audit_totday_l1', ''); setSetting('audit_totweek_l1', '');
});
