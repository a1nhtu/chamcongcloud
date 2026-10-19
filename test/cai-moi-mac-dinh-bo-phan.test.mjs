// Dữ liệu MẶC ĐỊNH khi mới cài (4 bộ phận, admin ở "Quản trị", không NV mẫu, 4 ca, 2 lịch trình vào ra, 2 lịch trình ca)
// + trang Bộ phận kiểu Wise Eye: xoá bộ phận chỉ còn Admin, chặn vòng cha-con, đổi tên kéo theo nơi khác. Chạy: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-cai-moi-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, D;
const routes = {};
const ADMIN = { id: 999999, role: 'admin', full_name: 'Admin' };
const call = async (key, { body = {}, params = {} } = {}) => {
  let out = null, code = 200;
  const res = { status(c) { code = c; return this; }, json(o) { out = o; return this; } };
  await routes[key]({ body, params, query: {}, user: ADMIN }, res);
  return { code, out };
};
const deptId = (name) => db.prepare('SELECT id FROM departments WHERE name=?').get(name)?.id;

before(async () => {
  D = await import('../server/db.js');
  db = D.db; D.initSchema();
  (await import('../server/seed.js')).ensureSeed();
  const add = (m) => (p, ...h) => { routes[`${m} ${p}`] = h[h.length - 1]; };
  const R = { get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE') };
  (await import('../server/routes/admin/org.js')).registerOrgRoutes(R, { need: () => (q, s, n) => n() });
});

test('mới cài: 4 bộ phận, chỉ có admin (bộ phận Quản trị), không có nhân viên mẫu', () => {
  const depts = db.prepare('SELECT name FROM departments ORDER BY id').all().map((r) => r.name);
  assert.deepEqual(depts, ['Hành chính', 'Văn phòng', 'Kế toán', 'Quản trị']);
  const emps = db.prepare('SELECT username, department, role FROM employees').all().map((r) => ({ ...r }));
  assert.deepEqual(emps, [{ username: 'admin', department: 'Quản trị', role: 'admin' }]);
});

test('mới cài: 4 ca + 2 lịch trình vào ra + 2 lịch trình ca', () => {
  const sh = db.prepare('SELECT code, name, start_time, end_time, work_unit_value, cross_midnight FROM shifts ORDER BY id').all().map((r) => ({ ...r }));
  assert.deepEqual(sh.map((s) => s.name), ['Ca hành chính', 'Ca sáng', 'Ca chiều', 'Ca đêm']);
  assert.equal(sh[3].cross_midnight, 1);
  assert.deepEqual(sh.map((s) => s.work_unit_value), [1, 0.5, 0.5, 1]);
  const io = db.prepare('SELECT name, rule, is_default FROM inout_schedules ORDER BY id').all().map((r) => ({ ...r }));
  assert.deepEqual(io, [{ name: 'Giờ đầu - Giờ cuối', rule: 'filo', is_default: 1 }, { name: 'Tự động - Qua đêm', rule: 'tdqd', is_default: 0 }]);
  const ws = db.prepare(`SELECT w.name, group_concat(s.code, '-') codes FROM work_schedules w
    JOIN work_schedule_shifts x ON x.work_schedule_id = w.id JOIN shifts s ON s.id = x.shift_id GROUP BY w.id ORDER BY w.id`).all().map((r) => ({ ...r }));
  assert.deepEqual(ws, [{ name: 'Hành chính', codes: 'HC-S-C' }, { name: 'Theo ca', codes: 'HC-DEM' }]);
});

test('lịch trình tự dò đúng ca theo giờ chấm', async () => {
  const { autoDetectShift, scheduleShifts } = await import('../server/shift-resolver.js');
  const wsId = (n) => db.prepare('SELECT id FROM work_schedules WHERE name=?').get(n).id;
  const t = (d, hm) => new Date(`${d}T${hm}:00+07:00`).toISOString();
  const pick = (w, a, b, nextDay) => autoDetectShift(t('2026-10-20', a), scheduleShifts(wsId(w)), t(nextDay ? '2026-10-21' : '2026-10-20', b)).code;
  assert.equal(pick('Hành chính', '07:55', '17:05'), 'HC');
  assert.equal(pick('Hành chính', '07:58', '12:01'), 'S');
  assert.equal(pick('Hành chính', '12:55', '17:02'), 'C');
  assert.equal(pick('Theo ca', '21:50', '06:05', true), 'DEM');
});

test('chạy seed lần 2 không tạo trùng', async () => {
  (await import('../server/seed.js')).ensureSeed();
  assert.equal(db.prepare('SELECT COUNT(*) c FROM shifts').get().c, 4);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM departments').get().c, 4);
});

test('xoá bộ phận chỉ còn Admin (VD "Ban giám đốc" bản cũ) → Admin tự sang "Quản trị"', async () => {
  db.prepare("INSERT INTO departments(name) VALUES('Ban giám đốc')").run();
  db.prepare("UPDATE employees SET department='Ban giám đốc' WHERE username='admin'").run();
  db.prepare("DELETE FROM departments WHERE name='Quản trị'").run();   // bản cũ chưa có bộ phận Quản trị
  const r = await call('DELETE /departments/:id', { params: { id: deptId('Ban giám đốc') } });
  assert.equal(r.code, 200); assert.equal(r.out.moved_admins, 1);
  assert.equal(deptId('Ban giám đốc'), undefined);
  assert.ok(deptId('Quản trị'));
  assert.equal(db.prepare("SELECT department FROM employees WHERE username='admin'").get().department, 'Quản trị');
  // bộ phận Quản trị đang chứa Admin → không xoá
  const r2 = await call('DELETE /departments/:id', { params: { id: deptId('Quản trị') } });
  assert.equal(r2.code, 400);
});

test('vẫn chặn xoá bộ phận còn nhân viên thường', async () => {
  db.prepare("INSERT INTO employees(code, full_name, department, role, username, password_hash) VALUES('NV9','NV 9','Kế toán','employee','nv9','x')").run();
  const r = await call('DELETE /departments/:id', { params: { id: deptId('Kế toán') } });
  assert.equal(r.code, 400); assert.match(r.out.error, /Còn 1 nhân viên/);
});

test('kéo bộ phận vào con của chính nó → bị chặn; vào bộ phận khác → được', async () => {
  const vp = deptId('Văn phòng'), kt = deptId('Kế toán');
  assert.equal((await call('PUT /departments/:id', { params: { id: kt }, body: { parent_id: vp } })).code, 200);
  const r = await call('PUT /departments/:id', { params: { id: vp }, body: { parent_id: kt } });
  assert.equal(r.code, 400); assert.match(r.out.error, /bộ phận con/);
  assert.equal(db.prepare('SELECT parent_id FROM departments WHERE id=?').get(kt).parent_id, vp);
});

test('đổi tên bộ phận → NV + gán lịch trình phòng ban + cài đặt cuối tuần đổi theo', async () => {
  db.prepare("INSERT INTO dept_shift_assignments(department, from_date) VALUES('Kế toán','2026-10-01')").run();
  D.setSetting('weekend_normal_depts', JSON.stringify(['Kế toán']));
  const r = await call('PUT /departments/:id', { params: { id: deptId('Kế toán') }, body: { name: 'Kế toán - Tài chính' } });
  assert.equal(r.code, 200);
  assert.equal(db.prepare("SELECT department FROM employees WHERE code='NV9'").get().department, 'Kế toán - Tài chính');
  assert.equal(db.prepare('SELECT department FROM dept_shift_assignments').get().department, 'Kế toán - Tài chính');
  assert.deepEqual(D.weekendNormalDepts(), ['Kế toán - Tài chính']);
  assert.equal((await call('PUT /departments/:id', { params: { id: deptId('Văn phòng') }, body: { name: '  ' } })).code, 400);
});
