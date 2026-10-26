// Test SUẤT ĂN — chế độ CHỈ ĐĂNG KÝ ĂN (không chọn món) + NHIỀU BẾP + CẤU HÌNH HIỂN THỊ, đầu-cuối qua router thật, CSDL tạm:
//   · 3 công tắc cách đăng ký (mặc định bật = như cũ, chỉ tài khoản tổng đổi) + công tắc Chấm công (Cấu hình hiển thị)
//   · thêm / xoá bữa tự thêm · giờ MỞ / KHOÁ đăng ký · NV bấm Có ăn / Không ăn · HR đăng ký / huỷ hộ (lý do + lưu vết)
//   · bếp: thêm / sửa / xoá, phân NV theo bộ phận / từng người, mã màn hình riêng, quẹt nhầm bếp · thêm suất tay · gửi bếp
//   · báo cáo: tổng số & giờ đăng ký · báo ăn mà không ăn theo NV · ngoại lệ · xuất Excel
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-meal-signup-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, initSchema, getSetting, M, server, base;
const tok = {}, E = {};
const P = '2026-10-01';   // ngày ĐÃ QUA (bữa đã kết thúc → tính "không ăn")
const F = '2099-03-03';   // ngày tương lai (đang nhận đăng ký)

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}
const addEmp = (code, name, dept, role = 'employee', perms = null) => {
  E[code] = Number(db.prepare(`INSERT INTO employees(code, full_name, department, role, username, password_hash, permissions) VALUES (?,?,?,?,?,?,?)`)
    .run(code, name, dept, role, code.toLowerCase(), 'x', perms).lastInsertRowid);
  return E[code];
};
const punch = (code, iso, serial) => db.prepare('INSERT INTO device_punches(serial, pin, punch_at, work_date, employee_id) VALUES (?,?,?,?,?)').run(serial, code, iso, iso.slice(0, 10), E[code]);

before(async () => {
  ({ db, initSchema, getSetting } = await import('../server/db.js'));
  const { signToken, signMaster } = await import('../server/auth.js');
  M = await import('../server/meal.js');
  const adminRoutes = (await import('../server/routes/admin.js')).default;
  const mealRoutes = (await import('../server/routes/meal.js')).default;
  const express = (await import('express')).default;
  initSchema();
  for (const [c, n, d] of [['A1', 'Nguyễn An', 'May'], ['A2', 'Trần Bình', 'May'], ['B1', 'Lê Cường', 'Cắt'], ['B2', 'Phạm Dũng', 'Cắt']]) addEmp(c, n, d);
  addEmp('ADM', 'Admin', '', 'admin');
  addEmp('HR1', 'Lan HR', 'Văn phòng', 'manager', JSON.stringify(['meal']));
  for (const c of ['A1', 'A2', 'B1', 'ADM', 'HR1']) tok[c] = signToken({ id: E[c], code: c, role: db.prepare('SELECT role FROM employees WHERE id=?').get(E[c]).role, full_name: db.prepare('SELECT full_name FROM employees WHERE id=?').get(E[c]).full_name });
  tok.master = signMaster('sadmin');
  db.prepare("INSERT INTO push_devices(serial, name, active) VALUES ('K1SN', 'Máy ăn bếp 1', 1), ('K2SN', 'Máy ăn bếp 2', 1)").run();
  const app = express(); app.use(express.json());
  app.use('/api/admin', adminRoutes); app.use('/api/meal', mealRoutes);
  await new Promise((ok) => { server = app.listen(0, '127.0.0.1', ok); });
  base = `http://127.0.0.1:${server.address().port}/api`;
  await call('PUT', '/admin/settings', { token: tok.master, body: { meal_enabled: true } });
});
after(() => { server?.close(); for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} } });

test('Cấu hình hiển thị: mặc định Chấm công BẬT + 3 công tắc suất ăn BẬT (như cũ, không ghi dòng cài đặt); chỉ tài khoản tổng đổi', async () => {
  for (const k of ['att_enabled', 'meal_self_order', 'meal_dish_choice', 'meal_dept_head']) assert.equal(getSetting(k), null, k + ' không được tự ghi');
  const s = (await call('GET', '/admin/settings', { token: tok.ADM })).body;
  assert.deepEqual([s.att_enabled, s.meal_self_order, s.meal_dish_choice, s.meal_dept_head], ['1', '1', '1', '1']);
  assert.deepEqual((await call('GET', '/meal/config', { token: tok.A1 })).body, { enabled: true, self_order: true, dish_choice: true, dept_head: true, head: false });
  // admin công ty gửi lên → bỏ qua
  await call('PUT', '/admin/settings', { token: tok.ADM, body: { att_enabled: false, meal_dish_choice: false } });
  assert.equal(getSetting('att_enabled', '1'), '1'); assert.equal(getSetting('meal_dish_choice', '1'), '1');
  assert.equal((await call('PUT', '/admin/meal/options', { token: tok.HR1, body: { dish_choice: false } })).status, 403);
  // tài khoản tổng: tắt chấm công + chuyển sang CHỈ ĐĂNG KÝ ĂN, không trưởng bộ phận
  await call('PUT', '/admin/settings', { token: tok.master, body: { att_enabled: false, meal_dish_choice: false, meal_dept_head: false } });
  assert.equal(getSetting('att_enabled'), '0');
  assert.deepEqual((await call('GET', '/admin/meal/options', { token: tok.HR1 })).body, { self_order: true, dish_choice: false, dept_head: false });
  const c = (await call('GET', '/meal/config', { token: tok.A1 })).body;
  assert.equal(c.dish_choice, false); assert.equal(c.dept_head, false);
  // chọn món / trưởng bộ phận bị chặn đúng chế độ
  assert.equal((await call('PUT', '/meal/order', { token: tok.A1, body: { date: F, shift: 'trua', menu_id: 1 } })).status, 403);
  assert.equal((await call('GET', `/meal/dept?date=${F}&shift=trua`, { token: tok.A1 })).status, 403);
  assert.deepEqual((await call('GET', '/meal/me', { token: tok.A1 })).body.head_of, []);
});

test('thêm / xoá BỮA tự thêm: mã b1…, giờ mở sai dạng → 400, bữa mặc định không xoá được, bữa có dữ liệu không xoá được', async () => {
  const bad = await call('POST', '/admin/meal/shifts', { token: tok.HR1, body: { name: 'Sáng', from_time: '06:00', to_time: '07:30', open_at: '25:00' } });
  assert.equal(bad.status, 400);
  const r = await call('POST', '/admin/meal/shifts', { token: tok.HR1, body: { name: 'Sáng', from_time: '06:00', to_time: '07:30', lock_mode: 'before', lock_hours: 1, open_at: '20:00' } });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.shift.code, r.body.shift.custom, r.body.shift.open_at, r.body.shift.lock_before_min, r.body.shift.mode], ['b1', 1, '20:00', 60, 'punch']);
  assert.deepEqual(r.body.shifts.map((s) => s.code), ['trua', 'chieu', 'dem', 'b1']);
  assert.equal((await call('DELETE', '/admin/meal/shifts/trua', { token: tok.HR1 })).status, 400);
  // có người đăng ký rồi → không xoá
  await call('PUT', '/admin/meal/signup-for', { token: tok.HR1, body: { date: F, shift: 'b1', employee_ids: [E.A1], on: true, reason: 'thử bữa sáng' } });
  assert.equal((await call('DELETE', '/admin/meal/shifts/b1', { token: tok.HR1 })).status, 409);
  await call('PUT', '/admin/meal/signup-for', { token: tok.HR1, body: { date: F, shift: 'b1', employee_ids: [E.A1], on: false, reason: 'thử xong' } });
  db.prepare("DELETE FROM meal_adjust_log WHERE shift = 'b1'").run();
  assert.equal((await call('DELETE', '/admin/meal/shifts/b1', { token: tok.HR1 })).status, 200);
  assert.ok(!M.listShifts().some((s) => s.code === 'b1'));
});

test('giờ MỞ / KHOÁ đăng ký: chưa tới giờ mở → chặn; đang mở → Có ăn / Không ăn; hết giờ khoá → chặn (báo HR)', async () => {
  assert.equal((await call('PUT', '/admin/meal/shifts/trua', { token: tok.HR1, body: { name: 'Trưa', from_time: '10:30', to_time: '13:30', mode: 'punch', enabled: true, lock_mode: 'at', lock_at: '09:00', open_at: '15:00' } })).status, 200);
  const D = '2099-02-02';   // trưa 02/02: mở 15:00 01/02, khoá 09:00 02/02 (VN)
  assert.throws(() => M.setMySignup(E.A1, D, 'trua', true, new Date('2099-02-01T07:00:00Z')), /Chưa tới giờ mở đăng ký bữa trưa \(mở lúc 15:00 ngày 01\/02\)/);
  assert.deepEqual(M.setMySignup(E.A1, D, 'trua', true, new Date('2099-02-01T09:00:00Z')), { registered: true });
  assert.deepEqual(M.setMySignup(E.A1, D, 'trua', true, new Date('2099-02-01T09:01:00Z')), { registered: true });   // bấm lại không nhân đôi
  assert.equal(db.prepare('SELECT COUNT(*) n FROM meal_orders WHERE employee_id=? AND work_date=?').get(E.A1, D).n, 1);
  assert.throws(() => M.setMySignup(E.A1, D, 'trua', false, new Date('2099-02-02T02:30:00Z')), /Đã khoá đăng ký bữa trưa \(hạn 09:00 ngày 02\/02\)/);
  assert.deepEqual(M.setMySignup(E.A1, D, 'trua', false, new Date('2099-02-02T01:00:00Z')), { registered: false });   // trước giờ khoá huỷ được
  // qua API: bữa chiều (luôn mở) ngày F
  assert.equal((await call('PUT', '/meal/signup', { token: tok.A1, body: { date: F, shift: 'chieu', on: true } })).body.registered, true);
  const plan = (await call('GET', `/meal/plan?from=${F}&to=${F}`, { token: tok.A1 })).body.days[0].shifts;
  const ch = plan.find((s) => s.code === 'chieu'), tr = plan.find((s) => s.code === 'trua');
  assert.deepEqual([ch.registered, ch.state, ch.editable, ch.open], [true, 'open', true, '']);
  assert.deepEqual([tr.registered, tr.state, tr.editable, tr.open], [false, 'wait', false, '2099-03-02 15:00']);
  assert.equal((await call('PUT', '/meal/signup', { token: tok.A1, body: { date: F, shift: 'trua', on: true } })).status, 400);   // chưa mở
  const o = db.prepare("SELECT dish, set_by, created_at FROM meal_orders WHERE employee_id=? AND work_date=? AND shift='chieu'").get(E.A1, F);
  assert.equal(o.dish, ''); assert.equal(o.set_by, ''); assert.match(o.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

let K1, K2;
test('BẾP: thêm / trùng tên / phân cả bộ phận + từng người; đơn tương lai đổi theo bếp mới', async () => {
  K1 = (await call('POST', '/admin/meal/kitchens', { token: tok.HR1, body: { name: 'Bếp 1', serials: ['K1SN'] } })).body.kitchen;
  K2 = (await call('POST', '/admin/meal/kitchens', { token: tok.HR1, body: { name: 'Bếp 2' } })).body.kitchen;
  assert.equal((await call('POST', '/admin/meal/kitchens', { token: tok.HR1, body: { name: 'bếp 1' } })).status, 400);
  assert.match(K1.screen_key, /^[A-HJKMNP-Z2-9]{6}$/); assert.notEqual(K1.screen_key, K2.screen_key);
  assert.equal(K1.serials, 'K1SN');
  let r = await call('PUT', '/admin/meal/kitchen-assign', { token: tok.HR1, body: { kitchen_id: K1.id, department: 'May' } });
  assert.equal(r.body.count, 2);
  r = await call('PUT', '/admin/meal/kitchen-assign', { token: tok.HR1, body: { kitchen_id: K2.id, employee_ids: [E.B1, E.B2, 99999] } });
  assert.equal(r.body.count, 2);   // id không có thật bị bỏ
  const may = r.body.depts.find((d) => d.department === 'May'), cat = r.body.depts.find((d) => d.department === 'Cắt');
  assert.deepEqual([may.by[K1.id], cat.by[K2.id]], [2, 2]);
  assert.deepEqual(r.body.kitchens.map((k) => [k.name, k.people]), [['Bếp 1', 2], ['Bếp 2', 2]]);
  assert.equal(db.prepare("SELECT kitchen_id FROM meal_orders WHERE employee_id=? AND work_date=? AND shift='chieu'").get(E.A1, F).kitchen_id, K1.id);
  assert.equal((await call('GET', '/meal/me', { token: tok.A1 })).body.kitchen, 'Bếp 1');
  assert.deepEqual((await call('GET', '/admin/meal/kitchen-emps?department=Cắt', { token: tok.HR1 })).body.rows.map((x) => [x.code, x.kitchen_id]), [['B1', K2.id], ['B2', K2.id]]);
});

test('HR ĐĂNG KÝ / HUỶ HỘ (không bị giờ khoá chặn) + THÊM SUẤT tay theo bếp — bắt buộc lý do, lưu vết; trang Đăng ký ăn theo bếp', async () => {
  const put = (body) => call('PUT', '/admin/meal/signup-for', { token: tok.HR1, body: { date: F, shift: 'chieu', ...body } });
  assert.equal((await put({ employee_ids: [E.A2], on: true, reason: '' })).status, 400);
  assert.equal((await put({ employee_ids: [], on: true, reason: 'quên đăng ký' })).status, 400);
  assert.deepEqual((await put({ employee_ids: [E.A2], on: true, reason: 'quên đăng ký' })).body, { ok: true, changed: 1, skipped: 0 });
  assert.deepEqual((await put({ department: 'Cắt', on: true, reason: 'tăng ca đột xuất' })).body, { ok: true, changed: 2, skipped: 0 });
  assert.deepEqual((await put({ employee_ids: [E.A1, E.A2], on: true, reason: 'lặp lại' })).body, { ok: true, changed: 0, skipped: 2 });   // đã đăng ký sẵn
  assert.deepEqual((await put({ employee_ids: [E.B2], on: false, reason: 'nghỉ đột xuất' })).body, { ok: true, changed: 1, skipped: 0 });
  assert.equal(db.prepare("SELECT set_by FROM meal_orders WHERE employee_id=? AND work_date=? AND shift='chieu'").get(E.A2, F).set_by, 'Lan HR');
  const ex = (body) => call('PUT', '/admin/meal/extra', { token: tok.HR1, body: { date: F, shift: 'chieu', ...body } });
  assert.equal((await ex({ kitchen_id: K2.id, qty: 3, reason: '' })).status, 400);
  assert.equal((await ex({ kitchen_id: K2.id, qty: 'x', reason: 'khách' })).status, 400);
  assert.equal((await ex({ kitchen_id: 777, qty: 3, reason: 'khách' })).status, 404);
  assert.equal((await ex({ kitchen_id: K2.id, qty: '+3', reason: '3 khách đối tác' })).status, 200);
  const d = (await call('GET', `/admin/meal/signups?date=${F}&shift=chieu`, { token: tok.HR1 })).body;
  assert.equal(d.current, 'chieu');
  const ch = d.shifts.find((s) => s.code === 'chieu');
  assert.deepEqual(ch.rows.map((k) => [k.name, k.app, k.hr, k.extra, k.total]), [['Bếp 1', 1, 1, 0, 2], ['Bếp 2', 0, 1, 3, 4]]);
  assert.equal(ch.totals.total, 6);
  assert.deepEqual(ch.list.map((x) => [x.code, x.kitchen_id, x.set_by]).sort(), [['A1', K1.id, ''], ['A2', K1.id, 'Lan HR'], ['B1', K2.id, 'Lan HR']]);
  assert.ok(!d.shifts.find((s) => s.code === 'trua').list, 'bữa không xem thì không kèm danh sách');
  assert.deepEqual(d.log.map((l) => l.kind).sort(), ['extra', 'signup', 'signup', 'signup', 'signup']);
  assert.equal(d.log.find((l) => l.kind === 'extra').dish, 'Bếp 2');
  // tìm NV: có cờ đã đăng ký + bếp
  const sr = (await call('GET', `/admin/meal/emp-search?date=${F}&shift=chieu&q=cuong`, { token: tok.HR1 })).body.rows;
  assert.deepEqual(sr.map((x) => [x.code, x.registered, x.kitchen_id]), [['B1', true, K2.id]]);
});

test('GỬI BẾP: chụp tổng + từng bếp, tin nhắn Zalo; màn hình bếp hiện số đã gửi và báo khi số đổi sau đó', async () => {
  const r = await call('POST', '/admin/meal/dispatch', { token: tok.HR1, body: { date: F, shift: 'chieu' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 6);
  assert.deepEqual(r.body.detail, { [K1.id]: 2, [K2.id]: 4 });
  assert.match(r.body.message, /BÁO SUẤT ĂN — Bữa chiều \(tối\) Thứ 3 03\/03\/2099/);
  assert.match(r.body.message, /• Bếp 1: 2 suất\n• Bếp 2: 4 suất\nTỔNG: 6 suất/);
  assert.match(r.body.message, /\(Lan HR\)$/);
  const now = new Date(`${F}T08:00:00Z`);   // 15:00 VN — bữa chiều 17:00 sắp tới
  let b = M.kitchenBoard({ kitchen: K2 }, now).find((x) => x.code === 'chieu');
  assert.deepEqual([b.total, b.signed, b.extra, b.sent], [4, 1, 3, 4]);
  b = M.kitchenBoard({ kitchen: null }, now).find((x) => x.code === 'chieu');
  assert.deepEqual([b.total, b.sent], [6, 6]);
  await call('PUT', '/admin/meal/signup-for', { token: tok.HR1, body: { date: F, shift: 'chieu', employee_ids: [E.B2], on: true, reason: 'đi làm lại' } });
  b = M.kitchenBoard({ kitchen: K2 }, now).find((x) => x.code === 'chieu');
  assert.deepEqual([b.total, b.sent], [5, 4]);   // màn hình bếp thấy số mới, kèm số HR đã gửi để cảnh báo
});

test('MÀN HÌNH BẾP theo bếp: mã riêng chỉ thấy bếp đó; quẹt máy bếp 1 mà là người bếp 2 → "sai bếp"; chưa đăng ký → registered false', async () => {
  // ngày P (đã qua): A1, A2 (bếp 1), B1 (bếp 2) được đăng ký bữa trưa; quẹt: A1 ở máy bếp 1, B1 nhầm máy bếp 1, B2 quẹt máy bếp 2 mà không đăng ký
  M.hrSetSignup({ workDate: P, code: 'trua', employeeIds: [E.A1, E.A2, E.B1], on: true, reason: 'dữ liệu thử', by: 'Lan HR' });
  punch('A1', `${P}T04:00:00.000Z`, 'K1SN');   // 11:00
  punch('B1', `${P}T04:05:00.000Z`, 'K1SN');
  punch('B2', `${P}T04:10:00.000Z`, 'K2SN');
  const now = new Date(`${P}T04:30:00.000Z`);
  const f1 = M.kitchenFeed(0, now, { kitchen: K1 });
  assert.deepEqual(f1.kitchen, { id: K1.id, name: 'Bếp 1' });
  assert.deepEqual(f1.events.map((e) => [e.code, e.registered, e.wrong_kitchen, e.kitchen_name]).sort(), [['A1', true, false, 'Bếp 1'], ['B1', true, true, 'Bếp 2']]);
  assert.equal(f1.dish_choice, false);
  const f2 = M.kitchenFeed(0, now, { kitchen: K2 });   // bếp 2 không gán máy → người của bếp 2 quẹt ở bất kỳ máy nào
  assert.deepEqual(f2.events.map((e) => [e.code, e.registered]).sort(), [['B1', true], ['B2', false]]);
  // qua API bằng mã riêng của bếp
  const api = await call('GET', `/meal/kitchen/feed?key=${K1.screen_key.toLowerCase()}`);
  assert.equal(api.status, 200); assert.equal(api.body.kitchen.name, 'Bếp 1');
  const all = await call('GET', `/meal/kitchen/feed?key=${M.kitchenKey()}`);
  assert.equal(all.status, 200); assert.equal(all.body.kitchen, null);
  // đổi mã bếp → mã cũ vô hiệu
  const k1b = (await call('POST', `/admin/meal/kitchens/${K1.id}/renew`, { token: tok.HR1 })).body.kitchen;
  assert.equal((await call('GET', `/meal/kitchen/feed?key=${K1.screen_key}`)).status, 401);
  assert.equal((await call('GET', `/meal/kitchen/feed?key=${k1b.screen_key}`)).status, 200);
});

test('BÁO CÁO: tổng số & giờ đăng ký · báo ăn mà không ăn theo NV · ngoại lệ (chỉ bữa đã kết thúc) + Excel', async () => {
  const s = (await call('GET', `/admin/meal/rpt/summary?from=${P}&to=${P}`, { token: tok.HR1 })).body;
  const tr = s.rows.find((x) => x.shift === 'trua');
  assert.equal(tr.ended, true);
  assert.deepEqual([tr.totals.signed, tr.totals.ate, tr.totals.no_show, tr.totals.walk_in], [3, 2, 1, 1]);
  assert.deepEqual(tr.kitchens.map((k) => [k.name, k.hr, k.ate, k.no_show, k.walk_in]), [['Bếp 1', 2, 1, 1, 0], ['Bếp 2', 1, 1, 0, 1]]);
  assert.match(tr.first_signup, /^\d{4}-\d{2}-\d{2} /);
  assert.equal(tr.deadline, `${P} 09:00`); assert.equal(tr.open, '2026-09-30 15:00');
  const ns = (await call('GET', `/admin/meal/rpt/noshow?from=2026-09-25&to=${P}`, { token: tok.HR1 })).body;
  assert.deepEqual(ns.rows.map((x) => [x.code, x.registered, x.ate, x.no_show, x.walk_in, x.rate]), [['A2', 1, 0, 1, 0, 100], ['B2', 0, 0, 0, 1, 0], ['A1', 1, 1, 0, 0, 0], ['B1', 1, 1, 0, 0, 0]]);
  assert.deepEqual(ns.rows[0].items.map((i) => [i.date, i.shift_name, i.set_by]), [[P, 'Trưa', 'Lan HR']]);
  // bữa chưa kết thúc (ngày F) không bị tính "không ăn"
  const nsF = (await call('GET', `/admin/meal/rpt/noshow?from=${F}&to=${F}`, { token: tok.HR1 })).body;
  assert.equal(nsF.meals, 0); assert.deepEqual(nsF.rows, []);
  const ex = (await call('GET', `/admin/meal/rpt/except?from=${P}&to=${P}`, { token: tok.HR1 })).body;
  assert.deepEqual(ex.no_show.map((x) => [x.code, x.kitchen_id]), [['A2', K1.id]]);
  assert.deepEqual(ex.walk_in.map((x) => [x.code, x.kitchen_id]), [['B2', K2.id]]);
  assert.equal((await call('GET', `/admin/meal/rpt/except?from=2026-01-01&to=${P}`, { token: tok.HR1 })).status, 400);   // quá 31 ngày
  assert.equal((await call('GET', `/admin/meal/rpt/summary?from=${P}&to=2026-09-01`, { token: tok.HR1 })).status, 400);  // đến < từ
  // Excel
  const ExcelJS = (await import('exceljs')).default;
  const load = async (type) => {
    const res = await fetch(`${base}/admin/meal/rpt.xlsx?type=${type}&from=${P}&to=${P}`, { headers: { Authorization: 'Bearer ' + tok.HR1 } });
    assert.equal(res.status, 200, type);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
    const rows = (w) => { const out = []; w.eachRow((r) => out.push(r.values.slice(1))); return out; };
    return { names: wb.worksheets.map((w) => w.name), rows: wb.worksheets.map(rows) };
  };
  const x1 = await load('summary');
  assert.deepEqual(x1.names, ['Tổng hợp', 'Chi tiết đăng ký']);
  const cong = x1.rows[0].find((v) => v[2] === 'Cộng Trưa');
  assert.deepEqual(Array.from(cong.slice(7, 14)), [0, 3, undefined, 3, 2, 1, 1]);   // NV tự · HR hộ · thêm tay (trống) · tổng · đã quẹt · không quẹt · quẹt không ĐK
  assert.ok(x1.rows[1].some((v) => v[2] === 'A2' && v[9] === 'KHÔNG ĂN' && String(v[7]).startsWith('HR đăng ký hộ')));
  const x2 = await load('noshow');
  assert.deepEqual(x2.rows[0].find((v) => v[0] === 'A2').slice(4, 8), [1, 0, 1, 100]);
  const x3 = await load('except');
  assert.deepEqual(x3.names, ['ĐK mà không quẹt', 'Quẹt mà không ĐK']);
  assert.equal((await fetch(`${base}/admin/meal/rpt.xlsx?type=abc&from=${P}&to=${P}`, { headers: { Authorization: 'Bearer ' + tok.HR1 } })).status, 400);
});

test('MẪU BÁO CƠM: bảng tổng hợp tháng (giờ báo / giờ ăn) · danh sách báo cơm theo ngày · đối chiếu báo ↔ ăn + Excel', async () => {
  // ngày P: A1, A2 (bếp 1), B1 (bếp 2) được HR báo hộ bữa trưa; quẹt: A1, B1 (ăn), B2 (ăn mà không báo); A2 báo mà không ăn
  const m = (await call('GET', `/admin/meal/rpt/month?from=2026-10-01&to=2026-10-31`, { token: tok.HR1 })).body;
  assert.equal(m.days.length, 31); assert.equal(m.mode, 'signup');
  assert.ok(m.shifts.some((s) => s.code === 'trua'));
  assert.deepEqual(m.rows.map((r) => r.code), ['B1', 'A1', 'A2']);   // theo bộ phận (Cắt trước May) rồi mã NV
  const cell = (code) => m.rows.find((r) => r.code === code).cells.trua[P];
  assert.match(cell('A1').t, /^\d{2}:\d{2}$/);
  assert.deepEqual([cell('A1').hr, cell('A1').no_show, cell('A2').no_show], [true, false, true]);
  assert.equal(m.totals.trua, 3);
  const mp = (await call('GET', `/admin/meal/rpt/month?from=2026-10-01&to=2026-10-31&mode=punch`, { token: tok.HR1 })).body;
  assert.deepEqual(mp.rows.map((r) => [r.code, r.cells.trua[P].t, r.cells.trua[P].walk_in]), [['B1', '11:05', false], ['B2', '11:10', true], ['A1', '11:00', false]]);
  const mk = (await call('GET', `/admin/meal/rpt/month?from=2026-10-01&to=2026-10-31&kitchen=${K1.id}`, { token: tok.HR1 })).body;
  assert.deepEqual(mk.rows.map((r) => r.code), ['A1', 'A2']);
  assert.equal((await call('GET', `/admin/meal/rpt/month?from=2026-09-01&to=2026-10-31`, { token: tok.HR1 })).status, 400);   // quá 31 ngày
  // danh sách 1 bữa: HR báo hộ → ghi chú, xếp theo bộ phận
  const dl = (await call('GET', `/admin/meal/rpt/daylist?from=${P}&shift=trua`, { token: tok.HR1 })).body;
  assert.deepEqual(dl.rows.map((r) => [r.code, r.note]), [['B1', 'HR báo hộ'], ['A1', 'HR báo hộ'], ['A2', 'HR báo hộ']]);
  assert.equal((await call('GET', `/admin/meal/rpt/daylist?from=${P}&shift=khongco`, { token: tok.HR1 })).status, 404);
  // đối chiếu
  const c = (await call('GET', `/admin/meal/rpt/compare?from=${P}&to=${P}`, { token: tok.HR1 })).body;
  const d = c.days.find((x) => x.shift === 'trua');
  assert.deepEqual([d.signed, d.ate, d.ok, d.no_show, d.walk_in], [3, 3, 2, 1, 1]);
  assert.deepEqual(c.people.slice(0, 2).map((x) => [x.code, x.no_show, x.walk_in]), [['A2', 1, 0], ['B2', 0, 1]]);
  assert.deepEqual([c.no_show.map((x) => x.code), c.walk_in.map((x) => x.code)], [['A2'], ['B2']]);
  const c2 = (await call('GET', `/admin/meal/rpt/compare?from=${P}&to=${P}&kitchen=${K2.id}`, { token: tok.HR1 })).body;
  assert.deepEqual([c2.no_show.length, c2.walk_in.map((x) => x.code)], [0, ['B2']]);
  // Excel đúng mẫu
  const ExcelJS = (await import('exceljs')).default;
  const load = async (q) => {
    const res = await fetch(`${base}/admin/meal/rpt.xlsx?${q}`, { headers: { Authorization: 'Bearer ' + tok.HR1 } });
    assert.equal(res.status, 200, q);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
    return wb;
  };
  const wm = await load(`type=month&from=2026-10-01&to=2026-10-31&place=${encodeURIComponent('Nhà công vụ')}`);
  const ws = wm.getWorksheet('Bảng tổng hợp báo cơm');
  assert.equal(ws.getCell('A4').value, 'BẢNG TỔNG HỢP BÁO CƠM NHÀ CÔNG VỤ');
  assert.equal(ws.getCell('A5').value, 'Tháng 10 năm 2026');
  assert.equal(ws.getCell(7, 4).value, 1); assert.equal(ws.getCell(8, 4).value, 'T5');   // 01/10/2026 là thứ 5
  assert.equal(ws.getCell(9, 2).value, 'Lê Cường');
  let tot = null;
  ws.eachRow((r) => { if (String(r.getCell(4).value || '').startsWith('Tổng số suất ăn từ 01 đến 31/10/2026')) tot = r.getCell(35).value; });
  assert.equal(tot, m.total);
  const wd = await load(`type=daylist&from=${P}&shift=trua`);
  const sd = wd.worksheets[0];
  assert.equal(sd.getCell('A1').value, `DANH SÁCH BÁO CƠM TRƯA NGÀY 01/10/2026`);
  assert.deepEqual([sd.getCell('B4').value, sd.getCell('C4').value, sd.getCell('A33').value, sd.getCell('D4').value], ['Lê Cường', 'HR báo hộ', 30, 31]);
  const wc = await load(`type=compare&from=${P}&to=${P}`);
  assert.deepEqual(wc.worksheets.map((w) => w.name), ['Tổng hợp theo ngày', 'Theo nhân viên', 'Báo mà không ăn', 'Ăn mà không báo']);
});

test('xoá bếp: NV thành "chưa phân bếp", đơn tương lai bỏ gắn bếp, đơn ngày đã qua giữ nguyên', async () => {
  assert.equal((await call('DELETE', `/admin/meal/kitchens/${K2.id}`, { token: tok.HR1 })).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM meal_emp_kitchen WHERE kitchen_id=?').get(K2.id).n, 0);
  assert.equal(db.prepare("SELECT kitchen_id FROM meal_orders WHERE employee_id=? AND work_date=? AND shift='chieu'").get(E.B1, F).kitchen_id, null);
  assert.equal(db.prepare("SELECT kitchen_id FROM meal_orders WHERE employee_id=? AND work_date=? AND shift='trua'").get(E.B1, P).kitchen_id, K2.id);
  const d = (await call('GET', `/admin/meal/signups?date=${F}&shift=chieu`, { token: tok.HR1 })).body.shifts.find((s) => s.code === 'chieu');
  assert.deepEqual(d.rows.map((k) => k.name), ['Bếp 1', 'Chưa phân bếp']);
});

test('bật lại "Có chọn món" + "Trưởng bộ phận" = như cũ: đăng ký ăn bị chặn, chọn món chạy lại', async () => {
  await call('PUT', '/admin/settings', { token: tok.master, body: { att_enabled: true, meal_dish_choice: true, meal_dept_head: true } });
  assert.equal((await call('PUT', '/meal/signup', { token: tok.A1, body: { date: F, shift: 'chieu', on: false } })).status, 400);
  await call('PUT', '/admin/meal/menu', { token: tok.HR1, body: { date: F, shift: 'chieu', dishes: ['Cơm gà'] } });
  const id = db.prepare("SELECT id FROM meal_menu WHERE work_date=? AND shift='chieu'").get(F).id;
  assert.equal((await call('PUT', '/meal/order', { token: tok.A2, body: { date: F, shift: 'chieu', menu_id: id } })).status, 200);
  // NV đã "chỉ đăng ký ăn" khi bật lại chọn món → tính vào dòng mặc định của trang Tổng hợp
  const rep = (await call('GET', `/admin/meal/report?date=${F}`, { token: tok.HR1 })).body.shifts.find((s) => s.code === 'chieu');
  assert.equal(rep.rows.find((x) => x.dish === 'Cơm gà').app, 1);
  assert.equal(rep.default.signed, 3);   // A1, B1, B2 đăng ký không món
});
