// Công ảo — hạn mức tăng ca TUẦN / THÁNG / NĂM riêng từng mức ảo + tăng ca tối đa 1 NGÀY NGHỈ TUẦN / 1 NGÀY LỄ
// (Phụ lục A hợp đồng khách may Hualida: UQ 24 / 60 / 590 giờ, BTW 12 / 40 / 400 giờ; ngày thường 4h, chủ nhật / lễ 8h).
// Khách cũ chưa lưu số riêng: vẫn chạy theo số chung + ô tích "Áp cho" như trước.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-congao-hanmuc-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;
let db, setSetting, virtualOt, periodLvRaw, e1;

const vn = (d, hm) => new Date(`${d}T${hm}:00+07:00`).toISOString();
const addDay = (date, work, ot, out, type = 'thuong') =>
  db.prepare(`INSERT INTO attendance(employee_id, work_date, shift_id, check_in_at, check_out_at, work_minutes, work_unit, ot_min, ot_type)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(e1, date, 1, vn(date, '07:30'), vn(date, out), work, work > 0 ? 1 : 0, ot, type);
const clearKeys = () => {
  for (const k of ['audit_ot_week_h', 'audit_ot_month_h', 'audit_ot_year_h']) setSetting(k, '0');
  for (const k of ['audit_week_lv', 'audit_month_lv', 'audit_year_lv']) setSetting(k, '1,2,3');
  db.prepare("DELETE FROM settings WHERE key LIKE 'audit_week_l_' OR key LIKE 'audit_month_l_' OR key LIKE 'audit_year_l_' OR key LIKE 'audit_wkday_l_' OR key LIKE 'audit_holday_l_' OR key LIKE 'audit_l_day'").run();
  db.prepare('DELETE FROM audit_ot_max').run();
};

before(async () => {
  const D = await import('../server/db.js');
  db = D.db; setSetting = D.setSetting; D.initSchema();
  ({ virtualOt, periodLvRaw } = await import('../server/virtual-att.js'));
  db.prepare("INSERT INTO shifts(id, name, code, start_time, end_time, break_minutes, work_unit_value) VALUES (1,'HC','HC','07:30','16:30',60,1)").run();
  e1 = Number(db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash) VALUES ('E1','Nguyễn Hạn','employee','e1','x')").run().lastInsertRowid);
  // tuần 07–13/09/2026: T2–T6 công 8h + TC 4h (240') · CN 13/09 đi làm 10h (cả ngày là TC 600')
  for (const d of ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']) addDay(d, 480, 240, '20:30');
  addDay('2026-09-13', 0, 600, '18:30', 'cuoi_tuan');
  // 02/09 (lễ) đi làm 10h (TC 600')
  addDay('2026-09-02', 0, 600, '18:30', 'le');
});
after(() => { for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} } });

const ots = (from, to, lv) => {
  const m = virtualOt([e1], from, to, true, lv);
  return db.prepare('SELECT id, work_date, ot_min FROM attendance WHERE employee_id=? AND work_date>=? AND work_date<=? ORDER BY work_date').all(e1, from, to)
    .map((x) => { const v = m.get(x.id); return v ? (v.hidden ? 0 : v.ot_min) : x.ot_min; });
};
const sum = (a) => a.reduce((s, x) => s + x, 0);

test('khách cũ (chưa lưu số riêng): số chung + ô tích "Áp cho" vẫn chạy như trước', () => {
  clearKeys();
  setSetting('audit_ot_week_h', '12'); setSetting('audit_week_lv', '1');   // 12h/tuần chỉ áp Ảo 1
  assert.deepEqual(periodLvRaw('week'), { 1: '12', 2: '', 3: '' });
  assert.equal(sum(ots('2026-09-07', '2026-09-13', 1)), 720);
  assert.equal(sum(ots('2026-09-07', '2026-09-13', 2)), 5 * 240 + 600);
});

test('hạn mức TUẦN riêng từng mức: Ảo 1 = 24h, Ảo 2 = 12h', () => {
  clearKeys();
  setSetting('audit_week_l1', '24'); setSetting('audit_week_l2', '12'); setSetting('audit_week_l3', '');
  assert.equal(sum(ots('2026-09-07', '2026-09-13', 1)), 1440);
  assert.equal(sum(ots('2026-09-07', '2026-09-13', 2)), 720);
  assert.equal(sum(ots('2026-09-07', '2026-09-13', 3)), 5 * 240 + 600);   // để trống = không giới hạn
});

test('đã lưu số riêng thì số chung cũ không còn tác dụng', () => {
  clearKeys();
  setSetting('audit_ot_week_h', '5'); setSetting('audit_week_l1', '');   // mức 1 lưu trống = không giới hạn
  assert.equal(periodLvRaw('week')[1], '');
  assert.equal(sum(ots('2026-09-07', '2026-09-13', 1)), 5 * 240 + 600);
  assert.equal(periodLvRaw('week')[2], '5');   // mức 2 chưa lưu → vẫn theo số chung
});

test('hạn mức THÁNG riêng: Ảo 1 = 60h (không cắt), Ảo 2 = 30h (tháng 9 có 1.200 + 600 + 600 = 2.400 phút)', () => {
  clearKeys();
  setSetting('audit_month_l1', '60'); setSetting('audit_month_l2', '30');
  assert.equal(sum(ots('2026-09-01', '2026-09-30', 1)), 2400);
  assert.equal(sum(ots('2026-09-01', '2026-09-30', 2)), 1800);
});

test('hạn mức NĂM riêng: Ảo 1 = 30h, Ảo 2 = 10h', () => {
  clearKeys();
  setSetting('audit_year_l1', '30'); setSetting('audit_year_l2', '10');
  assert.equal(sum(ots('2026-09-01', '2026-09-30', 1)), 1800);
  assert.equal(sum(ots('2026-09-01', '2026-09-30', 2)), 600);
});

test('ngày thường 4h, ngày nghỉ tuần 8h, ngày lễ 8h (theo mức)', () => {
  clearKeys();
  setSetting('audit_l1_day', '240'); setSetting('audit_l2_day', '240');
  // chưa đặt riêng ngày nghỉ / lễ → như ngày thường: CN và lễ bị cắt về 4h
  assert.deepEqual(ots('2026-09-13', '2026-09-13', 1), [240]);
  assert.deepEqual(ots('2026-09-02', '2026-09-02', 1), [240]);
  setSetting('audit_wkday_l1', '8'); setSetting('audit_holday_l1', '8');
  assert.deepEqual(ots('2026-09-13', '2026-09-13', 1), [480]);
  assert.deepEqual(ots('2026-09-02', '2026-09-02', 1), [480]);
  assert.deepEqual(ots('2026-09-07', '2026-09-07', 1), [240]);   // ngày thường vẫn 4h
  assert.deepEqual(ots('2026-09-13', '2026-09-13', 2), [240]);   // mức 2 chưa đặt → như ngày thường
  setSetting('audit_wkday_l2', '0');                             // 0 = không cho tăng ca ngày nghỉ
  assert.deepEqual(ots('2026-09-13', '2026-09-13', 2), [0]);
});

test('ô ngày khai riêng cho NV vẫn thắng hạn mức ngày nghỉ', () => {
  clearKeys();
  setSetting('audit_wkday_l1', '8');
  db.prepare("INSERT INTO audit_ot_max(employee_id, work_date, level, minutes) VALUES (?, '2026-09-13', 1, 120)").run(e1);
  assert.deepEqual(ots('2026-09-13', '2026-09-13', 1), [120]);
});

test('API cài đặt: lưu / đọc số riêng, chặn số sai', async () => {
  clearKeys();
  setSetting('audit_enabled', '1');
  const { registerSettingsRoutes } = await import('../server/routes/admin/settings.js');
  const routes = {};
  const r = { get: (p, ...h) => { routes['GET ' + p] = h.at(-1); }, put: (p, ...h) => { routes['PUT ' + p] = h.at(-1); }, post: () => {}, delete: () => {} };
  registerSettingsRoutes(r, { need: () => (q, s, n) => n(), adminOnly: (q, s, n) => n() });
  const call = (m, body) => new Promise((ok) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(j) { ok({ status: this.statusCode, j }); } };
    routes[m + ' /settings']({ body, user: { role: 'admin', master: true }, query: {} }, res);
  });
  let x = await call('PUT', { audit_week_l1: '24', audit_week_l2: '12', audit_month_l1: '60', audit_year_l2: '400', audit_wkday_l1: '8', audit_holday_l2: '8' });
  assert.equal(x.status, 200, JSON.stringify(x.j));
  x = await call('GET');
  assert.equal(x.j.audit_week_l1, '24'); assert.equal(x.j.audit_week_l2, '12'); assert.equal(x.j.audit_month_l1, '60');
  assert.equal(x.j.audit_year_l2, '400'); assert.equal(x.j.audit_wkday_l1, '8'); assert.equal(x.j.audit_holday_l2, '8');
  x = await call('PUT', { audit_wkday_l1: '30' });
  assert.equal(x.status, 400);
  x = await call('PUT', { audit_week_l3: 'abc' });
  assert.equal(x.status, 400);
});
