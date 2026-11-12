// Test ô "Cho phép chấm qua đêm" của chế độ chấm công THEO GIỜ (Cài đặt, mặc định TẮT).
// Lỗi gốc (giadungs1, NV002 ngày 04/10): chiều 04/10 vào 14:29 quên chấm ra, sáng 05/10 mở app thấy nút "RA CA"
// (phần mềm tìm phiên còn mở của hôm qua) → lượt 07:59 ngày 05/10 thành giờ ra của 04/10 = 17,5 giờ.
//   · TẮT (mặc định): không bao giờ lấy lượt chấm hôm sau làm giờ ra — phiên hôm qua để "thiếu ra", hôm nay chấm VÀO bình thường
//   · BẬT: như cũ — lượt chấm sáng hôm sau đóng phiên còn mở của hôm qua
//   · NV theo CA (ca đêm) không bị ảnh hưởng
// Dùng CSDL tạm (DB_PATH) + gọi thật route chấm điện thoại và route sửa giờ của quản lý.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { moCong } from './_cong.mjs';   // cổng ngẫu nhiên an toàn (tránh cổng fetch cấm / cổng test khác đang dò)

const dir = mkdtempSync(join(tmpdir(), 'dgp-quadem-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema, setSetting } = await import('../server/db.js');
const { signToken } = await import('../server/auth.js');
const { vnDateStr } = await import('../server/util.js');
const attRoutes = (await import('../server/routes/attendance.js')).default;
const { registerAttendanceRoutes } = await import('../server/routes/admin/attendance.js');
const { rebuildDay } = await import('../server/device-sync.js');
const express = (await import('express')).default;

const TODAY = vnDateStr();
const YDAY = (() => { const d = new Date(TODAY + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })();
const iso = (d, t) => new Date(`${d}T${t}:00+07:00`).toISOString();
const hm = (i) => (i ? new Date(Date.parse(i) + 7 * 3600000).toISOString().slice(11, 16) : null);
let srv, base;
const emp = {};
const call = async (m, p, b, who) => {
  const headers = { 'content-type': 'application/json' };
  if (who) headers.Authorization = 'Bearer ' + signToken(db.prepare('SELECT * FROM employees WHERE id=?').get(who));
  const x = await fetch(base + p, { method: m, headers, body: b ? JSON.stringify(b) : undefined });
  return { status: x.status, body: await x.json() };
};
const rowsOf = (eid, d) => db.prepare('SELECT check_in_at i, check_out_at o FROM attendance WHERE employee_id=? AND work_date=? ORDER BY check_in_at').all(eid, d).map((a) => [hm(a.i), hm(a.o)]);
const PUNCH = { lat: 21.0, lng: 105.8, photo: 'khong-phai-anh' };   // ảnh không hợp lệ → không ghi file

before(async () => {
  initSchema();
  setSetting('attendance_mode', 'hourly');
  setSetting('punch_dedup_min', '15');
  const addEmp = (code, mode = '') => Number(db.prepare("INSERT INTO employees(code, username, password_hash, full_name, role, active, att_mode) VALUES (?,?,'x',?,'employee',1,?)")
    .run(code, code.toLowerCase(), 'NV ' + code, mode).lastInsertRowid);
  for (const c of ['LAM', 'BAT', 'SUA', 'CA']) emp[c] = addEmp(c, c === 'CA' ? 'shift' : '');
  emp.MAY = addEmp('MAY');
  // Phiên chấm điện thoại hôm qua: vào 14:29, quên chấm ra
  const open = db.prepare("INSERT INTO attendance(employee_id, work_date, check_in_at, check_in_photo, day_status, shift_source) VALUES (?,?,?,'/uploads/in.jpg','thieu_ra','hourly')");
  for (const c of ['LAM', 'BAT', 'CA']) open.run(emp[c], YDAY, iso(YDAY, '14:29'));
  const app = express(); app.use(express.json());
  app.use('/api/attendance', attRoutes);
  const r = express.Router();
  r.use((q, s, n) => { q.user = { id: 1, full_name: 'QL', role: 'admin' }; n(); });
  registerAttendanceRoutes(r, { need: () => (q, s, n) => n() });
  app.use('/admin', r);
  srv = await moCong(app); base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { srv.close(); try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} });

test('mặc định TẮT: hôm qua quên chấm ra → hôm nay app hiện VÀO CA + nhắc, không đóng phiên hôm qua', async () => {
  const t = await call('GET', '/api/attendance/today', null, emp.LAM);
  assert.equal(t.status, 200);
  assert.equal(t.body.state, 'can_in');
  assert.equal(t.body.forgotOut?.date, YDAY);
  assert.equal(hm(t.body.forgotOut.check_in_at), '14:29');
  // gọi thẳng chấm RA (app cũ còn mở) → bị chặn, phiên hôm qua giữ nguyên "thiếu ra"
  const out = await call('POST', '/api/attendance/check-out', PUNCH, emp.LAM);
  assert.equal(out.status, 400);
  assert.match(out.body.error, /chưa chấm VÀO/);
  assert.deepEqual(rowsOf(emp.LAM, YDAY), [['14:29', null]]);
  // chấm VÀO hôm nay → phiên mới của hôm nay
  const inn = await call('POST', '/api/attendance/check-in', PUNCH, emp.LAM);
  assert.equal(inn.status, 200, JSON.stringify(inn.body));
  assert.equal(rowsOf(emp.LAM, TODAY).length, 1);
  assert.equal(rowsOf(emp.LAM, TODAY)[0][1], null);
  assert.deepEqual(rowsOf(emp.LAM, YDAY), [['14:29', null]]);
  // giờ app thấy phiên hôm nay đang mở → RA CA
  assert.equal((await call('GET', '/api/attendance/today', null, emp.LAM)).body.state, 'can_out');
});

test('NV theo CA (ca đêm) không bị ảnh hưởng: vẫn chấm ra cho ca hôm qua', async () => {
  const t = await call('GET', '/api/attendance/today', null, emp.CA);
  assert.equal(t.body.state, 'can_out');
  assert.equal(t.body.forgotOut, null);
  const out = await call('POST', '/api/attendance/check-out', PUNCH, emp.CA);
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(out.body.attendance.work_date, YDAY);
});

test('quản lý nhập tay giờ ra nhỏ hơn giờ vào (TẮT qua đêm) → báo lỗi, không tự lấy sáng hôm sau', async () => {
  const p = await call('POST', '/admin/attendance', { employee_id: emp.SUA, work_date: YDAY, check_in: '14:29', check_out: '07:59' });
  assert.equal(p.status, 400);
  assert.match(p.body.error, /Cho phép chấm qua đêm/);
  // giờ ra đúng thì vẫn lưu được
  const ok = await call('POST', '/admin/attendance', { employee_id: emp.SUA, work_date: YDAY, check_in: '14:29', check_out: '18:01' });
  assert.equal(ok.status, 200);
  const id = ok.body.id;
  const put = await call('PUT', `/admin/attendance/${id}`, { check_out: '07:59' });
  assert.equal(put.status, 400);
  assert.deepEqual(rowsOf(emp.SUA, YDAY), [['14:29', '18:01']]);
  // ô Thêm giờ chấm (NV theo giờ chỉ chấm điện thoại) cũng chặn
  const add = await call('POST', '/admin/attendance/punches', { employee_ids: [emp.SUA], date: TODAY, in: '14:00', out: '07:00' });
  assert.equal(add.status, 400);
  const bulk = await call('POST', '/admin/attendance/punches/bulk', { employee_ids: [emp.SUA], dates: [TODAY], in: { time: '22:00' }, out: { time: '06:00' } });
  assert.equal(bulk.status, 400);
});

test('máy chấm công: lượt sáng hôm nay không bị phiên hôm qua "nuốt" khi TẮT qua đêm', () => {
  // dữ liệu cũ: phiên hôm qua đã bị đóng bằng lượt 07:59 hôm nay; máy có lượt 07:59 + 18:08 hôm nay
  db.prepare("INSERT INTO attendance(employee_id, work_date, check_in_at, check_out_at, check_in_photo, check_out_photo, day_status, shift_source) VALUES (?,?,?,?,'/a.jpg','/b.jpg','lam_viec','hourly')")
    .run(emp.MAY, YDAY, iso(YDAY, '14:29'), iso(TODAY, '07:59'));
  const ins = db.prepare("INSERT INTO device_punches(serial, pin, punch_at, work_date, status, verify, employee_id) VALUES ('M1','MAY',?,?,0,1,?)");
  for (const t of ['07:59', '18:08']) ins.run(iso(TODAY, t), TODAY, emp.MAY);
  rebuildDay(emp.MAY, TODAY);
  assert.deepEqual(rowsOf(emp.MAY, TODAY), [['07:59', '18:08']]);
  // BẬT qua đêm: như cũ — lượt 07:59 đã là giờ ra hôm qua nên hôm nay bắt đầu từ 18:08
  setSetting('hourly_overnight', '1');
  try { rebuildDay(emp.MAY, TODAY); assert.deepEqual(rowsOf(emp.MAY, TODAY), [['18:08', null]]); }
  finally { setSetting('hourly_overnight', '0'); }
});

test('BẬT qua đêm: như cũ — lượt chấm sáng hôm sau đóng phiên còn mở hôm qua; nhập tay ra < vào = sáng hôm sau', async () => {
  setSetting('hourly_overnight', '1');
  try {
    const t = await call('GET', '/api/attendance/today', null, emp.BAT);
    assert.equal(t.body.state, 'can_out');
    assert.equal(t.body.forgotOut, null);
    const out = await call('POST', '/api/attendance/check-out', PUNCH, emp.BAT);
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(out.body.attendance.work_date, YDAY);
    assert.equal(rowsOf(emp.BAT, YDAY)[0][0], '14:29');
    assert.notEqual(rowsOf(emp.BAT, YDAY)[0][1], null);
    const p = await call('POST', '/admin/attendance', { employee_id: emp.BAT, work_date: TODAY, check_in: '22:00', check_out: '06:00' });
    assert.equal(p.status, 200);
    const r = db.prepare('SELECT check_out_at, work_minutes FROM attendance WHERE id=?').get(p.body.id);
    assert.equal(r.work_minutes, 480);
  } finally { setSetting('hourly_overnight', '0'); }
});

test('dữ liệu cũ (17,5 giờ): hộp Lượt chấm liệt kê phiên + nút "Chuyển giờ ra sang ngày sau" tách đúng', async () => {
  const D0 = '2026-10-04', D1 = '2026-10-05';
  const id = Number(db.prepare(`INSERT INTO attendance(employee_id, work_date, check_in_at, check_out_at, check_in_photo, check_out_photo, check_out_lat, check_out_lng,
    work_minutes, day_status, shift_source) VALUES (?,?,?,?,'/uploads/v.jpg','/uploads/r.jpg',21.01,105.81,1050,'lam_viec','hourly')`)
    .run(emp.SUA, D0, iso(D0, '14:29'), iso(D1, '07:59')).lastInsertRowid);
  db.prepare("INSERT INTO attendance(employee_id, work_date, check_in_at, check_out_at, check_in_photo, check_out_photo, work_minutes, day_status, shift_source) VALUES (?,?,?,?,'/a.jpg','/b.jpg',274,'lam_viec','hourly')")
    .run(emp.SUA, D0, iso(D0, '07:59'), iso(D0, '12:33'));
  // hộp Lượt chấm: có đủ 2 phiên kèm id, ngày ra, ảnh — không còn "Chưa có lượt chấm nào"
  const g = await call('GET', `/admin/attendance/punches?employee_id=${emp.SUA}&date=${D0}`);
  assert.equal(g.status, 200);
  assert.equal(g.body.phoneLocked, true);
  assert.equal(g.body.noOvernight, true);
  assert.deepEqual(g.body.phone.map((p) => [p.in, p.out, p.out_date]), [['07:59', '12:33', D0], ['14:29', '07:59', D1]]);
  assert.equal(g.body.phone[1].id, id);
  // phiên không sang ngày sau → không tách được
  const bad = await call('POST', `/admin/attendance/${g.body.phone[0].id}/split-out`);
  assert.equal(bad.status, 400);
  const s = await call('POST', `/admin/attendance/${id}/split-out`);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal(s.body.moved, true);
  assert.equal(s.body.next_date, D1);
  const a = db.prepare('SELECT * FROM attendance WHERE id=?').get(id);
  assert.equal(a.check_out_at, null);
  assert.equal(a.check_out_photo, null);
  assert.equal(a.work_minutes, 0);
  assert.deepEqual(rowsOf(emp.SUA, D0), [['07:59', '12:33'], ['14:29', null]]);
  // 07:59 thành giờ VÀO ngày 05/10, giữ ảnh + vị trí
  const n = db.prepare('SELECT * FROM attendance WHERE employee_id=? AND work_date=?').all(emp.SUA, D1);
  assert.equal(n.length, 1);
  assert.equal(hm(n[0].check_in_at), '07:59');
  assert.equal(n[0].check_out_at, null);
  assert.equal(n[0].check_in_photo, '/uploads/r.jpg');
  assert.equal(n[0].check_in_lat, 21.01);
  // bấm lại → báo không còn giờ ra sang ngày sau, không thêm trùng
  assert.equal((await call('POST', `/admin/attendance/${id}/split-out`)).status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM attendance WHERE employee_id=? AND work_date=?').get(emp.SUA, D1).c, 1);
});

test('Chuyển giờ ra sang ngày sau: ngày sau ĐÃ có giờ vào cùng phút (bấm RA nhầm rồi bấm VÀO ngay) → chỉ bỏ giờ ra, không nhân đôi', async () => {
  const D0 = '2026-10-11', D1 = '2026-10-12';
  const id = Number(db.prepare("INSERT INTO attendance(employee_id, work_date, check_in_at, check_out_at, check_in_photo, check_out_photo, work_minutes, day_status, shift_source) VALUES (?,?,?,?,'/v.jpg','/r.jpg',1050,'lam_viec','hourly')")
    .run(emp.SUA, D0, iso(D0, '14:29'), new Date(`${D1}T07:59:12+07:00`).toISOString()).lastInsertRowid);
  db.prepare("INSERT INTO attendance(employee_id, work_date, check_in_at, check_out_at, check_in_photo, check_out_photo, work_minutes, day_status, shift_source) VALUES (?,?,?,?,'/a.jpg','/b.jpg',608,'lam_viec','hourly')")
    .run(emp.SUA, D1, new Date(`${D1}T07:59:40+07:00`).toISOString(), iso(D1, '18:08'));
  const s = await call('POST', `/admin/attendance/${id}/split-out`);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal(s.body.moved, false);
  assert.deepEqual(rowsOf(emp.SUA, D0), [['14:29', null]]);
  assert.deepEqual(rowsOf(emp.SUA, D1), [['07:59', '18:08']]);
});
