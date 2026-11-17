// Lịch trình ca MẶC ĐỊNH (Anh 17/11/2026): bản cài mới tạo sẵn 2 lịch trình ca theo CHU KỲ TUẦN, "Hành chính" là mặc định cho
// nhân viên CHƯA được gán ca / lịch trình nào (giống lịch trình vào ra mặc định). Khách cũ không có lịch trình mặc định → tính như cũ.
// Kèm: tên tài khoản quản trị "Quản trị Digiplus" → "Quản trị". Chạy: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'dgp-ltmd-')), 'test.db');

let db, D, R, ingestAttlog, rebuildDay;
const routes = {};
const call = async (key, { body = {}, params = {} } = {}) => {
  let out = null, code = 200;
  const res = { status(c) { code = c; return this; }, json(o) { out = o; return this; } };
  await routes[key]({ body, params, query: {}, user: { id: 1, role: 'admin' } }, res);
  return { code, out };
};
const iso = (d, hm) => new Date(`${d}T${hm}:00+07:00`).toISOString();
const wsId = (name) => db.prepare('SELECT id FROM work_schedules WHERE name = ?').get(name).id;
const defaults = () => db.prepare('SELECT name FROM work_schedules WHERE active = 1 AND is_default = 1 ORDER BY id').all().map((r) => r.name);
let n = 0;
const mkEmp = (extra = {}) => {
  n++;
  const id = Number(db.prepare(`INSERT INTO employees(code, username, password_hash, full_name, role, active, device_pin, shift_id, work_schedule_id)
    VALUES (?,?,'x',?,'employee',1,?,?,?)`).run('M' + n, 'm' + n, 'NV M' + n, String(8800 + n), extra.shift_id ?? null, extra.work_schedule_id ?? null).lastInsertRowid);
  return id;
};
const shiftId = (code) => db.prepare('SELECT id FROM shifts WHERE code = ?').get(code).id;

before(async () => {
  D = await import('../server/db.js');
  db = D.db; D.initSchema();
  (await import('../server/seed.js')).ensureSeed();
  R = await import('../server/shift-resolver.js');
  ({ ingestAttlog, rebuildDay } = await import('../server/device-sync.js'));
  const add = (m) => (p, ...h) => { routes[`${m} ${p}`] = h[h.length - 1]; };
  (await import('../server/routes/admin/org.js')).registerOrgRoutes({ get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE') }, { need: () => (q, s, nx) => nx() });
});

test('mới cài: 2 lịch trình ca theo CHU KỲ TUẦN, đủ 7 ngày, "Hành chính" là mặc định', () => {
  const ws = db.prepare('SELECT name, unit, cycle, is_default FROM work_schedules ORDER BY id').all().map((r) => ({ ...r }));
  assert.deepEqual(ws, [
    { name: 'Hành chính', unit: 'week', cycle: 1, is_default: 1 },
    { name: 'Theo ca', unit: 'week', cycle: 1, is_default: 0 },
  ]);
  const cells = (name) => db.prepare(`SELECT d.idx, group_concat(s.code, '-') codes FROM work_schedule_days d JOIN shifts s ON s.id = d.shift_id
    WHERE d.work_schedule_id = ? GROUP BY d.idx ORDER BY d.idx`).all(wsId(name)).map((r) => [r.idx, r.codes.split('-').sort().join('-')]);
  assert.deepEqual(cells('Hành chính'), [0, 1, 2, 3, 4, 5, 6].map((i) => [i, 'C-HC-S']));
  assert.deepEqual(cells('Theo ca'), [0, 1, 2, 3, 4, 5, 6].map((i) => [i, 'DEM-HC']));
});

test('mới cài: ca tạo sẵn cho phép muộn / sớm = 0; tính tăng ca sau giờ ở mọi ca TRỪ Ca sáng', () => {
  const rows = db.prepare('SELECT code, late_grace_min l, early_grace_min e, allow_ot ot FROM shifts ORDER BY id').all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [
    { code: 'HC', l: 0, e: 0, ot: 1 },
    { code: 'S', l: 0, e: 0, ot: 0 },
    { code: 'C', l: 0, e: 0, ot: 1 },
    { code: 'DEM', l: 0, e: 0, ot: 1 },
  ]);
});

test('mới cài: ca HC về 18:30 → tăng ca 90 phút; vào 08:03 → muộn 3 phút', () => {
  const id = mkEmp({ shift_id: shiftId('HC') });
  const pin = db.prepare('SELECT device_pin p FROM employees WHERE id = ?').get(id).p;
  ingestAttlog('SN1', `${pin}\t2026-11-03 08:03:00\t0\t1`, { ask: () => {} });
  ingestAttlog('SN1', `${pin}\t2026-11-03 18:30:00\t1\t1`, { ask: () => {} });
  rebuildDay(id, '2026-11-03');
  const a = db.prepare("SELECT late_min, early_min, ot_min FROM attendance WHERE employee_id = ? AND work_date = '2026-11-03'").get(id);
  assert.deepEqual({ ...a }, { late_min: 3, early_min: 0, ot_min: 90 });
});

test('mới cài: tài khoản quản trị tên "Quản trị"', () => {
  assert.equal(db.prepare("SELECT full_name FROM employees WHERE username = 'admin'").get().full_name, 'Quản trị');
});

test('NV chưa gán gì → theo lịch trình mặc định "Hành chính" (chọn ca theo giờ chấm)', () => {
  const id = mkEmp();
  const r = R.resolveShift(id, '2026-11-16');
  assert.equal(r.source, 'schedule'); assert.equal(r.scheduleName, 'Hành chính');
  assert.equal(R.resolveEffectiveShift(id, '2026-11-16', iso('2026-11-16', '07:58'), iso('2026-11-16', '12:01')).shift.code, 'S');
  assert.equal(R.resolveEffectiveShift(id, '2026-11-16', iso('2026-11-16', '12:55'), iso('2026-11-16', '17:02')).shift.code, 'C');
  const ds = R.resolveDayShifts(id, '2026-11-15');   // Chủ Nhật vẫn có ca (ngày nghỉ do cài đặt cuối tuần quyết định)
  assert.equal(ds.isSchedule, true); assert.deepEqual(ds.shifts.map((s) => s.code).sort(), ['C', 'HC', 'S']);
});

test('NV đã có ca riêng / lịch trình riêng / phân ca → KHÔNG dùng lịch trình mặc định', () => {
  const a = mkEmp({ shift_id: shiftId('DEM') });
  assert.equal(R.resolveShift(a, '2026-11-16').shift.code, 'DEM');
  assert.equal(R.resolveShift(a, '2026-11-16').source, 'default');
  const b = mkEmp({ work_schedule_id: wsId('Theo ca') });
  assert.equal(R.resolveShift(b, '2026-11-16').scheduleName, 'Theo ca');
  const c = mkEmp();
  db.prepare("INSERT INTO shift_assignments(employee_id, mode, shift_id, from_date) VALUES (?, 'shift', ?, '2026-11-01')").run(c, shiftId('C'));
  assert.equal(R.resolveShift(c, '2026-11-16').shift.code, 'C');
  assert.equal(R.resolveShift(c, '2026-11-16').source, 'assign');
});

test('tính công NV chưa gán ca: có mặc định "Hành chính" ra y như cũ (ngày thường, nửa buổi, Chủ Nhật)', () => {
  const id = mkEmp();
  const pin = db.prepare('SELECT device_pin p FROM employees WHERE id = ?').get(id).p;
  const days = { '2026-11-09': ['08:00', '17:00'], '2026-11-10': ['07:58', '12:01'], '2026-11-11': ['12:55', '17:02'], '2026-11-14': ['08:00', '17:00'], '2026-11-15': ['08:00', '17:00'] };
  for (const [d, [a, b]] of Object.entries(days)) {
    ingestAttlog('SN1', `${pin}\t${d} ${a}:00\t0\t1`, { ask: () => {} });
    ingestAttlog('SN1', `${pin}\t${d} ${b}:00\t1\t1`, { ask: () => {} });
  }
  const rows = () => Object.keys(days).map((d) => {
    rebuildDay(id, d);
    const r = db.prepare('SELECT a.work_unit u, a.work_minutes m, a.ot_min ot, s.code sh FROM attendance a LEFT JOIN shifts s ON s.id = a.shift_id WHERE a.employee_id = ? AND a.work_date = ?').get(id, d);
    return { ...r };
  });
  const withDefault = rows();
  db.prepare('UPDATE work_schedules SET is_default = 0').run();
  const old = rows();
  db.prepare("UPDATE work_schedules SET is_default = 1 WHERE name = 'Hành chính'").run();
  assert.deepEqual(withDefault, old);
  assert.deepEqual(withDefault.map((r) => r.sh), ['HC', 'S', 'C', 'HC', 'HC']);
  assert.equal(withDefault[4].ot, 480, 'Chủ Nhật 08:00–17:00 = 480 phút tăng ca (trừ giờ nghỉ trưa)');
});

test('khách cũ (không có lịch trình mặc định) → NV chưa gán vẫn tự dò mọi ca như cũ', () => {
  db.prepare('UPDATE work_schedules SET is_default = 0').run();
  try {
    assert.equal(R.defaultWorkScheduleId(), null);
    const id = mkEmp();
    const r = R.resolveEffectiveShift(id, '2026-11-16', iso('2026-11-16', '21:55'), iso('2026-11-17', '06:05'));
    assert.equal(r.source, 'auto'); assert.equal(r.shift.code, 'DEM');
    assert.equal(R.resolveShift(id, '2026-11-16').source, 'none');
  } finally { db.prepare("UPDATE work_schedules SET is_default = 1 WHERE name = 'Hành chính'").run(); }
});

test('màn Lịch trình ca: chỉ 1 dòng mặc định; thêm / sửa / bỏ / xoá', async () => {
  const hc = shiftId('HC');
  const add = await call('POST /schedules', { body: { name: 'HC T2-T6', unit: 'week', cycle: 1, days: [0, 1, 2, 3, 4].map((idx) => ({ idx, shift_ids: [hc] })), is_default: true } });
  assert.equal(add.code, 200);
  assert.deepEqual(defaults(), ['HC T2-T6']);
  assert.equal((await call('GET /schedules')).out.rows[0].name, 'HC T2-T6', 'dòng mặc định đứng đầu');
  // sửa không gửi is_default → giữ nguyên
  await call('PUT /schedules/:id', { params: { id: add.out.id }, body: { name: 'HC T2-T6 (sửa)' } });
  assert.deepEqual(defaults(), ['HC T2-T6 (sửa)']);
  // chọn lại "Hành chính" → dòng kia tự bỏ mặc định
  await call('PUT /schedules/:id', { params: { id: wsId('Hành chính') }, body: { is_default: true } });
  assert.deepEqual(defaults(), ['Hành chính']);
  // bỏ tích → không còn mặc định
  await call('PUT /schedules/:id', { params: { id: wsId('Hành chính') }, body: { is_default: false } });
  assert.deepEqual(defaults(), []);
  // xoá lịch trình đang mặc định → hết mặc định
  await call('PUT /schedules/:id', { params: { id: add.out.id }, body: { is_default: true } });
  assert.equal((await call('DELETE /schedules/:id', { params: { id: add.out.id } })).code, 200);
  assert.deepEqual(defaults(), []);
  assert.equal(R.defaultWorkScheduleId(), null);
  await call('PUT /schedules/:id', { params: { id: wsId('Hành chính') }, body: { is_default: true } });
});

test('bản cũ: admin tên "Quản trị Digiplus" → đổi 1 lần thành "Quản trị"; tên khách tự đặt thì giữ', () => {
  db.prepare("UPDATE employees SET full_name = 'Quản trị Digiplus' WHERE username = 'admin'").run();
  db.prepare("DELETE FROM settings WHERE key = 'admin_name_quan_tri'").run();
  D.initSchema();
  assert.equal(db.prepare("SELECT full_name FROM employees WHERE username = 'admin'").get().full_name, 'Quản trị');
  db.prepare("UPDATE employees SET full_name = 'Giám đốc Lan' WHERE username = 'admin'").run();
  db.prepare("DELETE FROM settings WHERE key = 'admin_name_quan_tri'").run();
  D.initSchema();
  assert.equal(db.prepare("SELECT full_name FROM employees WHERE username = 'admin'").get().full_name, 'Giám đốc Lan');
  // đã đổi 1 lần rồi → khách đặt lại đúng tên cũ cũng không bị đổi nữa
  db.prepare("UPDATE employees SET full_name = 'Quản trị Digiplus' WHERE username = 'admin'").run();
  D.initSchema();
  assert.equal(db.prepare("SELECT full_name FROM employees WHERE username = 'admin'").get().full_name, 'Quản trị Digiplus');
});
