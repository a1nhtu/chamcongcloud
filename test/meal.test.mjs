// Test PHÂN HỆ QUẢN LÝ SUẤT ĂN đầu-cuối: công tắc (mặc định TẮT, chỉ tài khoản tổng bật), phân quyền, 3 ca, đăng ký của trưởng bộ phận
// + HR nhập hộ, chốt số, chọn món, màn hình bếp — qua router thật của app (không cần giấy phép / máy chấm công thật), CSDL tạm.
// Và: "công tắc TẮT = chạy như cũ" (API suất ăn 403, trang 404, không tạo dòng nào, mã tính công không nhắc tới suất ăn) +
// module ĐỘC LẬP (mọi thao tác suất ăn không làm đổi bảng chấm công / đăng ký làm thêm / nhân viên).
// node --test chạy mỗi file test trong tiến trình RIÊNG → set DB_PATH tạm ở đây không đụng DB khác.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { rmSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DBP = join(tmpdir(), `dgp-meal-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;
const __dirname = dirname(fileURLToPath(import.meta.url));

let db, initSchema, getSetting, express, signToken, signMaster, adminRoutes, mealRoutes, M, server, base;
const tok = {};   // token theo vai trò
const E = {};     // nhân viên theo tên
const D = '2026-10-15';   // ngày ăn thử
const Z = (hhmm) => `${D}T${hhmm}:00.000Z`;   // mốc UTC trong ngày thử (VN = UTC+7)

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}
const addEmp = (code, name, dept, role = 'employee', perms = null) => {
  const id = Number(db.prepare(`INSERT INTO employees(code, full_name, department, role, username, password_hash, permissions) VALUES (?,?,?,?,?,?,?)`)
    .run(code, name, dept, role, code.toLowerCase(), 'x', perms).lastInsertRowid);
  E[code] = id; return id;
};
const punch = (code, iso, serial = 'SN1') => db.prepare('INSERT INTO device_punches(serial, pin, punch_at, work_date, employee_id) VALUES (?,?,?,?,?)').run(serial, code, iso, iso.slice(0, 10), E[code]);
const digest = (tables) => createHash('sha1').update(JSON.stringify(tables.map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all()))).digest('hex');
const CORE_TABLES = ['attendance', 'device_punches', 'ot_registrations', 'employees', 'shifts', 'shift_assignments', 'salary_configs'];

before(async () => {
  ({ db, initSchema, getSetting } = await import('../server/db.js'));
  ({ signToken, signMaster } = await import('../server/auth.js'));
  M = await import('../server/meal.js');
  adminRoutes = (await import('../server/routes/admin.js')).default;
  mealRoutes = (await import('../server/routes/meal.js')).default;
  express = (await import('express')).default;
  initSchema();
  // nhân viên: sản xuất ×3 (SX1 SX2 SX3), kho ×2, trưởng bộ phận sản xuất, quản lý có / không quyền suất ăn, admin
  for (const [c, n, d] of [['SX1', 'Nguyễn A', 'Sản xuất'], ['SX2', 'Trần B', 'Sản xuất'], ['SX3', 'Lê C', 'Sản xuất'], ['KHO1', 'Phạm D', 'Kho'], ['KHO2', 'Vũ E', 'Kho']]) addEmp(c, n, d);
  addEmp('TBP1', 'Trưởng SX', 'Sản xuất');
  addEmp('ADM', 'Admin', '', 'admin');
  addEmp('MGR0', 'Quản lý thường', 'Văn phòng', 'manager');
  addEmp('MGR1', 'Quản lý HR', 'Văn phòng', 'manager', JSON.stringify(['meal', 'reports']));
  for (const c of ['SX1', 'TBP1', 'ADM', 'MGR0', 'MGR1']) tok[c] = signToken({ id: E[c], code: c, role: db.prepare('SELECT role FROM employees WHERE id=?').get(E[c]).role, full_name: c });
  tok.master = signMaster('sadmin');
  const app = express(); app.use(express.json());
  app.use('/api/admin', adminRoutes); app.use('/api/meal', mealRoutes);
  await new Promise((ok) => { server = app.listen(0, '127.0.0.1', ok); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server?.close(); for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} } });

/* ===================== công tắc TẮT = như cũ ===================== */
test('mặc định TẮT: không có dòng cài đặt, bảng suất ăn rỗng, API 403, trang 404, chỉ /config báo "chưa bật"', async () => {
  assert.equal(getSetting('meal_enabled'), null);
  assert.equal(M.mealEnabled(), false);
  for (const t of ['meal_shifts', 'meal_registrations', 'meal_closings', 'meal_dept_heads', 'meal_menu', 'meal_orders'])
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n, 0, t + ' phải rỗng khi chưa bật');
  assert.equal(M.mealAllowed({ master: true, role: 'master' }), false);
  assert.equal(M.mealAllowed({ id: 1, role: 'admin' }), false);
  const s = await call('GET', '/admin/settings', { token: tok.admin ?? tok.ADM });
  assert.equal(s.body.meal_enabled, '0');
  assert.equal((await call('GET', '/meal/config', { token: tok.SX1 })).body.enabled, false);
  assert.equal((await call('GET', '/meal/me', { token: tok.SX1 })).status, 403);
  assert.equal((await call('GET', `/admin/meal/board?date=${D}&shift=trua`, { token: tok.ADM })).status, 403);
  assert.equal((await call('GET', '/admin/meal/shifts', { token: tok.master })).status, 403);
  assert.equal((await call('GET', '/meal/kitchen/feed?key=abc')).status, 403);
  const mock = () => { const r = { code: 200 }; r.status = (c) => { r.code = c; return r; }; r.type = () => r; r.send = () => r; return r; };
  let passed = false; const res = mock();
  M.mealStaticGate({}, res, () => { passed = true; });
  assert.equal(passed, false); assert.equal(res.code, 404);
  const cat = await call('GET', '/admin/perm-catalog', { token: tok.ADM });
  assert.ok(!cat.body.permissions.some(([k]) => k === 'meal'), 'tắt: ô quyền Suất ăn không hiện');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM meal_shifts').get().n, 0, 'gọi API khi tắt không được tạo dữ liệu');
});

test('chỉ TÀI KHOẢN TỔNG bật được công tắc (admin gửi lên cũng bị bỏ qua)', async () => {
  let r = await call('PUT', '/admin/settings', { token: tok.ADM, body: { meal_enabled: true } });
  assert.equal(r.status, 200);
  assert.equal(getSetting('meal_enabled', '0'), '0');
  r = await call('PUT', '/admin/settings', { token: tok.master, body: { meal_enabled: true } });
  assert.equal(r.status, 200);
  assert.equal(getSetting('meal_enabled'), '1');
  assert.equal((await call('GET', '/admin/settings', { token: tok.ADM })).body.meal_enabled, '1');
  assert.equal((await call('GET', '/meal/config', { token: tok.SX1 })).body.enabled, true);
});

/* ===================== quyền ===================== */
test('quyền "meal": admin / tài khoản tổng / quản lý được cấp quyền mới vào; quản lý thường không', async () => {
  assert.equal(M.mealAllowed({ master: true, role: 'master' }), true);
  assert.equal(M.mealAllowed(db.prepare('SELECT * FROM employees WHERE code=?').get('ADM')), true);
  assert.equal(M.mealAllowed(db.prepare('SELECT * FROM employees WHERE code=?').get('MGR1')), true);
  assert.equal(M.mealAllowed(db.prepare('SELECT * FROM employees WHERE code=?').get('MGR0')), false);
  assert.equal(M.mealAllowed(null), false);
  assert.equal((await call('GET', '/admin/meal/shifts', { token: tok.MGR0 })).status, 403);
  const ok = await call('GET', '/admin/meal/shifts', { token: tok.MGR1 });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.shifts.map((s) => s.code), ['trua', 'chieu', 'dem']);   // 3 ca mặc định tạo khi dùng lần đầu
  assert.equal((await call('GET', '/admin/meal/shifts', { token: tok.SX1 })).status, 403);   // nhân viên thường (role employee) không vào được /admin
  const cat = await call('GET', '/admin/perm-catalog', { token: tok.ADM });
  assert.ok(cat.body.permissions.some(([k]) => k === 'meal'), 'bật: ô quyền Suất ăn hiện');
});

/* ===================== đối chiếu 3 ca ===================== */
let coreBefore;
test('ca TRƯA: đếm lượt chấm hợp lệ theo bộ phận — loại ngoài giờ chốt, lượt thêm tay, chấm điện thoại', async () => {
  punch('SX1', Z('04:00')); punch('SX1', Z('04:20'));   // 11:00, 11:20 — 1 người, 2 lượt
  punch('SX2', Z('05:00'));                              // 12:00
  punch('SX3', Z('03:00'));                              // 10:00 — trước giờ chốt → loại
  punch('KHO1', Z('05:30'));                             // 12:30
  punch('KHO2', Z('04:10'), 'TAY_VAO'); punch('KHO2', Z('04:10'), 'DT_VAO');   // thêm tay / điện thoại → không tính
  const r = await call('GET', `/admin/meal/board?date=${D}&shift=trua`, { token: tok.MGR1 });
  assert.equal(r.status, 200);
  const by = Object.fromEntries(r.body.board.rows.map((x) => [x.department, x]));
  assert.equal(by['Sản xuất'].punch_people, 2); assert.equal(by['Sản xuất'].punch_swipes, 3);
  assert.equal(by.Kho.punch_people, 1);
  assert.equal(r.body.board.totals.punch_people, 3);
  assert.equal(r.body.outside, 1);
  assert.equal(r.body.closed, null);
});

test('ca CHIỀU: KHÔNG đếm chấm công — lấy số đăng ký làm thêm (ot_registrations) cộng theo bộ phận', async () => {
  db.prepare('INSERT INTO ot_registrations(employee_id, work_date, minutes) VALUES (?,?,?)').run(E.SX1, D, 120);
  db.prepare('INSERT INTO ot_registrations(employee_id, work_date, minutes) VALUES (?,?,?)').run(E.SX2, D, 60);
  db.prepare('INSERT INTO ot_registrations(employee_id, work_date, minutes) VALUES (?,?,?)').run(E.SX3, D, 0);   // 0 phút = không làm thêm
  db.prepare('INSERT INTO ot_registrations(employee_id, work_date, minutes) VALUES (?,?,?)').run(E.KHO1, D, 90);
  const r = await call('GET', `/admin/meal/board?date=${D}&shift=chieu`, { token: tok.ADM });
  const by = Object.fromEntries(r.body.board.rows.map((x) => [x.department, x]));
  assert.equal(by['Sản xuất'].ot_people, 2); assert.equal(by['Sản xuất'].ot_minutes, 180);
  assert.equal(by.Kho.ot_people, 1);
  assert.equal(by['Sản xuất'].ref, 2);            // số tham chiếu ca chiều = người đăng ký làm thêm
  assert.equal(by['Sản xuất'].punch_people, 0);   // không đếm chấm công
});

test('ca ĐÊM: khung qua nửa đêm — quẹt 00:30 sáng hôm sau vẫn tính cho ngày ăn', async () => {
  punch('SX1', `${D}T16:30:00.000Z`);                  // 23:30 ngày 15
  punch('SX2', '2026-10-15T18:00:00.000Z');            // 01:00 ngày 16 (VN) — vẫn là đêm ngày 15
  punch('SX3', '2026-10-15T19:30:00.000Z');            // 02:30 ngày 16 — quá giờ chốt 02:00 → loại
  const r = await call('GET', `/admin/meal/board?date=${D}&shift=dem`, { token: tok.ADM });
  assert.equal(r.body.board.rows.find((x) => x.department === 'Sản xuất').punch_people, 2);
  assert.equal(r.body.outside, 1);
  const next = await call('GET', `/admin/meal/board?date=2026-10-16&shift=dem`, { token: tok.ADM });
  assert.equal(next.body.board.totals.punch_people, 0);
});

test('đổi giờ chốt: nới khung Trưa ra 09:30 thì lượt quẹt 10:00 được tính; ca tắt bị ẩn khỏi app', async () => {
  coreBefore = digest(CORE_TABLES);   // từ đây dữ liệu chấm công / đăng ký làm thêm đã dựng xong — mọi thao tác suất ăn sau đó KHÔNG được làm đổi
  let r = await call('PUT', '/admin/meal/shifts/trua', { token: tok.ADM, body: { name: 'Trưa', from_time: '09:30', to_time: '13:30', mode: 'punch', enabled: true } });
  assert.equal(r.status, 200);
  r = await call('GET', `/admin/meal/board?date=${D}&shift=trua`, { token: tok.ADM });
  assert.equal(r.body.board.rows.find((x) => x.department === 'Sản xuất').punch_people, 3);
  assert.equal((await call('PUT', '/admin/meal/shifts/trua', { token: tok.ADM, body: { name: 'Trưa', from_time: '25:00', to_time: '13:30', mode: 'punch' } })).status, 400);
  await call('PUT', '/admin/meal/shifts/trua', { token: tok.ADM, body: { name: 'Trưa', from_time: '10:30', to_time: '13:30', mode: 'punch', enabled: true } });   // trả lại
  await call('PUT', '/admin/meal/shifts/dem', { token: tok.ADM, body: { name: 'Đêm', from_time: '23:00', to_time: '02:00', mode: 'punch', enabled: false } });
  assert.deepEqual((await call('GET', '/meal/me', { token: tok.SX1 })).body.shifts.map((s) => s.code), ['trua', 'chieu']);
  await call('PUT', '/admin/meal/shifts/dem', { token: tok.ADM, body: { name: 'Đêm', from_time: '23:00', to_time: '02:00', mode: 'punch', enabled: true } });
});

/* ===================== trưởng bộ phận + HR nhập hộ + chốt ===================== */
test('trưởng bộ phận chỉ nhập được bộ phận của mình, không nhập ngày đã qua; người khác bị chặn', async () => {
  assert.deepEqual((await call('GET', '/meal/me', { token: tok.TBP1 })).body.head_of, []);
  assert.equal((await call('PUT', '/meal/dept', { token: tok.TBP1, body: { date: '2099-01-10', shift: 'trua', items: [{ department: 'Sản xuất', count: 5 }] } })).status, 403);   // chưa được chỉ định
  const add = await call('POST', '/admin/meal/heads', { token: tok.ADM, body: { department: 'Sản xuất', employee_id: E.TBP1 } });
  assert.equal(add.status, 200);
  assert.deepEqual((await call('GET', '/meal/me', { token: tok.TBP1 })).body.head_of, ['Sản xuất']);
  assert.equal((await call('PUT', '/meal/dept', { token: tok.TBP1, body: { date: '2099-01-10', shift: 'trua', items: [{ department: 'Sản xuất', count: 38, note: 'nghỉ 2' }] } })).status, 200);
  assert.equal((await call('PUT', '/meal/dept', { token: tok.TBP1, body: { date: '2099-01-10', shift: 'trua', items: [{ department: 'Kho', count: 9 }] } })).status, 403);   // bộ phận khác
  assert.equal((await call('PUT', '/meal/dept', { token: tok.TBP1, body: { date: '2000-01-01', shift: 'trua', items: [{ department: 'Sản xuất', count: 9 }] } })).status, 400);   // ngày đã qua
  assert.equal((await call('PUT', '/meal/dept', { token: tok.TBP1, body: { date: '2099-01-10', shift: 'trua', items: [{ department: 'Sản xuất', count: -3 }] } })).status, 400);
  assert.equal((await call('PUT', '/meal/dept', { token: tok.SX1, body: { date: '2099-01-10', shift: 'trua', items: [{ department: 'Sản xuất', count: 7 }] } })).status, 403);   // nhân viên thường
  const g = await call('GET', '/meal/dept?date=2099-01-10&shift=trua', { token: tok.TBP1 });
  assert.deepEqual(g.body.departments.map((d) => [d.department, d.count, d.note]), [['Sản xuất', 38, 'nghỉ 2']]);
});

test('HR nhập hộ / sửa cho bất kỳ bộ phận; bảng hiện chênh lệch + tổng; chốt rồi thì khoá sửa tới khi mở lại', async () => {
  let r = await call('PUT', '/admin/meal/registrations', { token: tok.MGR1, body: { date: D, shift: 'trua', items: [{ department: 'Sản xuất', count: 38 }, { department: 'Kho', count: 1 }] } });
  assert.equal(r.status, 200);
  const by = Object.fromEntries(r.body.board.rows.map((x) => [x.department, x]));
  assert.equal(by['Sản xuất'].diff, 36);   // đăng ký 38, chấm công hợp lệ 2
  assert.equal(by.Kho.diff, 0);
  assert.equal(r.body.board.totals.total, 39);
  assert.equal(by['Văn phòng']?.registered ?? null, null);   // chưa đăng ký → tính 0, có cờ missing
  assert.ok(r.body.board.totals.missing >= 0);

  assert.equal((await call('POST', '/admin/meal/close', { token: tok.MGR1, body: { date: D, shift: 'trua' } })).body.closed.total, 39);
  assert.equal((await call('POST', '/admin/meal/close', { token: tok.MGR1, body: { date: D, shift: 'trua' } })).status, 409);   // chốt rồi
  assert.equal((await call('PUT', '/admin/meal/registrations', { token: tok.ADM, body: { date: D, shift: 'trua', items: [{ department: 'Kho', count: 5 }] } })).status, 409);
  assert.equal(db.prepare("SELECT count FROM meal_registrations WHERE department='Kho' AND work_date=? AND shift='trua'").get(D).count, 1);   // không đổi
  await call('POST', '/admin/meal/reopen', { token: tok.MGR1, body: { date: D, shift: 'trua' } });
  assert.equal((await call('PUT', '/admin/meal/registrations', { token: tok.ADM, body: { date: D, shift: 'trua', items: [{ department: 'Kho', count: 2 }] } })).status, 200);
});

/* ===================== chọn món + màn hình bếp ===================== */
test('thực đơn → nhân viên chọn món trên app → HR xem tổng hợp; quá hạn không chọn được', async () => {
  const F = '2099-01-10';
  const m = await call('PUT', '/admin/meal/menu', { token: tok.ADM, body: { date: F, shift: 'trua', dishes: ['Cơm gà', 'Cơm sườn', 'cơm gà', ''] } });
  assert.equal(m.body.saved, 2);
  const plan = await call('GET', `/meal/plan?from=${F}&to=${F}`, { token: tok.SX1 });
  const trua = plan.body.days[0].shifts.find((s) => s.code === 'trua');
  assert.deepEqual(trua.dishes.map((d) => d.name), ['Cơm gà', 'Cơm sườn']);
  assert.equal(trua.editable, true); assert.equal(trua.chosen, null);
  const pick = trua.dishes[1].id;
  assert.equal((await call('PUT', '/meal/order', { token: tok.SX1, body: { date: F, shift: 'trua', menu_id: pick } })).body.chosen.dish, 'Cơm sườn');
  assert.equal((await call('PUT', '/meal/order', { token: tok.SX1, body: { date: F, shift: 'chieu', menu_id: pick } })).status, 400);   // món không thuộc bữa chiều
  assert.equal((await call('PUT', '/meal/order', { token: tok.SX1, body: { date: '2000-01-01', shift: 'trua', menu_id: pick } })).status, 400);   // ngày đã qua
  await call('PUT', '/meal/order', { token: tok.TBP1, body: { date: F, shift: 'trua', menu_id: pick } });
  const sum = await call('GET', `/admin/meal/orders?date=${F}&shift=trua`, { token: tok.ADM });
  assert.equal(sum.body.total, 2); assert.deepEqual(sum.body.dishes[0].byDept.map((x) => x.department).sort(), ['Sản xuất']);
  // đổi thực đơn: món giữ nguyên tên giữ id → đơn đã chọn còn nguyên; món bị xoá → đơn giữ tên món
  await call('PUT', '/admin/meal/menu', { token: tok.ADM, body: { date: F, shift: 'trua', dishes: ['Cơm sườn', 'Bún bò'] } });
  assert.equal(db.prepare('SELECT dish FROM meal_orders WHERE employee_id=? AND work_date=?').get(E.SX1, F).dish, 'Cơm sườn');
  // bỏ chọn
  assert.equal((await call('PUT', '/meal/order', { token: tok.SX1, body: { date: F, shift: 'trua', menu_id: null } })).body.chosen, null);
  // sao chép thực đơn sang ngày khác
  assert.equal((await call('POST', '/admin/meal/menu/copy', { token: tok.ADM, body: { from: F, to: '2099-01-11' } })).body.copied, 2);
});

test('màn hình bếp: cần khoá; lượt quẹt gần nhất hiện tên + món đã chọn + số lần quẹt', async () => {
  assert.equal((await call('GET', '/meal/kitchen/feed')).status, 401);   // chưa có khoá
  const k = (await call('GET', '/admin/meal/kitchen', { token: tok.ADM })).body.key;
  assert.match(k, /^[0-9a-f]{24}$/);
  assert.equal((await call('GET', '/meal/kitchen/feed?key=sai')).status, 401);
  assert.equal((await call('GET', '/meal/kitchen/feed?key=' + k)).status, 200);
  // chọn món bữa trưa ngày D cho SX1 rồi quẹt → màn hình bếp hiện đúng món
  const menuId = db.prepare('INSERT INTO meal_menu(work_date, shift, name) VALUES (?,?,?)').run(D, 'trua', 'Cơm gà xối mỡ').lastInsertRowid;
  db.prepare('INSERT INTO meal_orders(employee_id, work_date, shift, menu_id, dish) VALUES (?,?,?,?,?)').run(E.SX1, D, 'trua', menuId, 'Cơm gà xối mỡ');
  const now = new Date(Z('05:40'));   // 12:40 VN
  const f = M.kitchenFeed(0, now);
  const sx1 = f.events.filter((e) => e.code === 'SX1');
  assert.equal(sx1.length, 2);                                // 2 lượt quẹt 11:00 + 11:20
  assert.equal(sx1[0].dish, 'Cơm gà xối mỡ'); assert.equal(sx1[0].shift, 'trua'); assert.equal(sx1[0].times, 2);   // mới nhất = lần thứ 2
  assert.equal(sx1[1].times, 1);
  assert.equal(f.events.find((e) => e.code === 'SX2').dish, null);   // chưa chọn món
  assert.ok(!f.events.some((e) => e.code === 'KHO2'), 'lượt thêm tay / điện thoại không lên màn hình bếp');
  assert.equal(f.last_id, Math.max(...db.prepare("SELECT id FROM device_punches WHERE punch_at<=? AND punch_at>='2026-10-15T02:40:00.000Z' AND serial NOT IN ('TAY_VAO','TAY_RA','DT_VAO','DT_RA')").all(new Date(now.getTime() + 5 * 60000).toISOString()).map((x) => x.id)));
  assert.equal(M.kitchenFeed(f.last_id, now).events.length, 0);   // hỏi tiếp từ mốc cũ → không có gì mới
  // đổi khoá → khoá cũ vô hiệu
  const k2 = (await call('POST', '/admin/meal/kitchen/renew', { token: tok.ADM })).body.key;
  assert.notEqual(k2, k);
  assert.equal((await call('GET', '/meal/kitchen/feed?key=' + k)).status, 401);
});

/* ===================== MODULE ĐỘC LẬP ===================== */
test('mọi thao tác suất ăn KHÔNG làm đổi bảng chấm công / đăng ký làm thêm / nhân viên / ca / lương', () => {
  assert.equal(digest(CORE_TABLES), coreBefore);
});

test('mã tính công / chấm công / báo cáo / lương KHÔNG nhắc tới phân hệ suất ăn (tắt hay bật đều tính y như nhau)', () => {
  for (const f of ['attendance-calc.js', 'day-metrics.js', 'shift-resolver.js', 'payroll-calc.js', 'ot-reg.js', 'ot-cap.js', 'device-sync.js', 'virtual-att.js', 'k-times.js',
    'routes/attendance.js', 'routes/reports.js', 'routes/iclock.js', 'routes/admin/attendance.js', 'routes/admin/payroll.js', 'routes/admin/ot-reg.js']) {
    const src = readFileSync(join(__dirname, '../server', f), 'utf8');
    assert.doesNotMatch(src, /meal/i, f + ' không được phụ thuộc phân hệ suất ăn');
  }
});

test('TẮT lại công tắc: API 403 trở lại, dữ liệu suất ăn đã nhập giữ nguyên, bật lại thấy ngay', async () => {
  const regs = db.prepare('SELECT COUNT(*) n FROM meal_registrations').get().n;
  assert.ok(regs > 0);
  await call('PUT', '/admin/settings', { token: tok.master, body: { meal_enabled: false } });
  assert.equal(getSetting('meal_enabled'), '0');
  assert.equal((await call('GET', '/meal/me', { token: tok.SX1 })).status, 403);
  assert.equal((await call('GET', `/admin/meal/board?date=${D}&shift=trua`, { token: tok.ADM })).status, 403);
  assert.equal((await call('GET', '/meal/kitchen/feed?key=x')).status, 403);
  assert.equal((await call('GET', '/meal/config', { token: tok.SX1 })).body.enabled, false);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM meal_registrations').get().n, regs);
  assert.equal(digest(CORE_TABLES), coreBefore);
  await call('PUT', '/admin/settings', { token: tok.master, body: { meal_enabled: true } });
  assert.equal((await call('GET', `/admin/meal/board?date=${D}&shift=trua`, { token: tok.ADM })).status, 200);
});

test('công tắc TẮT = tính công như cũ: cùng dữ liệu ngẫu nhiên, bật phân hệ + chạy xen mọi thao tác suất ăn → bảng công GIỐNG HỆT từng dòng', async () => {
  const { spawnSync } = await import('node:child_process');
  const { readFileSync, rmSync: rm } = await import('node:fs');
  const root = join(__dirname, '..');
  const worker = join(root, 'tools', '_prove-meal-worker.mjs');
  const run = (sc, mode) => {
    const out = join(tmpdir(), `dgp-meal-prove-${process.pid}-${sc}-${mode}.ndjson`);
    const r = spawnSync(process.execPath, ['--no-warnings', worker, root, sc, '60', '30', '7' + sc, mode, out], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const rows = readFileSync(out, 'utf8'); rm(out);
    return { rows, info: JSON.parse(r.stdout.trim().split('\n').pop()) };
  };
  for (const sc of ['A', 'B', 'C']) {
    const off = run(sc, 'plain'), on = run(sc, 'meal-on');
    assert.ok(off.info.attendanceRows > 500, 'phải dựng được nhiều dòng công');
    assert.ok(on.info.mealCalls > 0, 'phải có thao tác suất ăn chạy xen');
    assert.equal(on.rows, off.rows, `kịch bản ${sc}: bảng công khi BẬT suất ăn phải y hệt khi TẮT`);
  }
});
