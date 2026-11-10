// Rà soát 10/11/2026: công thức tính giờ, tìm ca, ca đêm, sửa công, duyệt đơn — các lỗi tìm được và đã sửa (v1.32.3)
//  1. Tài khoản tổng duyệt "chọn ca" bị lỗi (khoá ngoại reviewed_by = 0).
//  2. Duyệt chọn ca cho ngày ĐÃ có giờ chấm: ca đổi nhưng công không tính lại (vẫn trễ / tăng ca theo ca cũ).
//  3. Đơn đã xử lý vẫn duyệt / từ chối lại được (từ chối đơn chọn ca đã duyệt: lịch vẫn giữ ca).
//  4. Nhân viên gửi đơn nghỉ với loại lạ / ngày sai dạng vẫn lưu.
//  5. Sửa công tay ca đêm: giờ vào sau nửa đêm (00:30) bị hiểu là 00:30 đầu ngày → không trễ, đủ công; giờ sai dạng → lỗi 500.
//  6. Máy chấm công, ca đêm vào trễ SAU NỬA ĐÊM: không ra dòng công nào (mất cả ca).
//  7. Ca bắt đầu ngay sau nửa đêm (00:00–08:00) đến sớm 23:50: dòng rác hôm trước trễ 1.430 phút + giờ ra lấy nhầm lượt 23:55.
//  8. Điện thoại, ca đêm vào trễ sau nửa đêm: thành dòng của hôm nay, chấm ra 0 công + về sớm 1.440 phút.
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'dgp-rasoat-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema, setSetting } = await import('../server/db.js');
const { signToken, signMaster } = await import('../server/auth.js');
const { ingestAttlog } = await import('../server/device-sync.js');
const express = (await import('express')).default;

const hm = (x) => (x ? new Date(Date.parse(x) + 7 * 3600e3).toISOString().slice(8, 16).replace('T', ' ') : null);
const iso = (d, t) => new Date(`${d}T${t}:00+07:00`).toISOString();
let srv, base, ADMIN, n = 0;
const S = {};
const tok = (who) => (who === 'master' ? signMaster('sadmin') : signToken(db.prepare('SELECT * FROM employees WHERE id=?').get(who)));
const call = async (m, p, who, b) => {
  const x = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tok(who) }, body: b ? JSON.stringify(b) : undefined });
  let body = null; try { body = await x.json(); } catch {}
  return { status: x.status, body };
};
const emp = (sid, role = 'employee') => {
  n++;
  return Number(db.prepare("INSERT INTO employees(code, username, password_hash, full_name, role, active, shift_id, att_mode, device_pin) VALUES (?,?,'x',?,?,1,?,'shift',?)")
    .run('K' + n, 'k' + n, 'NV ' + n, role, sid, String(6000 + n)).lastInsertRowid);
};
const pinOf = (e) => db.prepare('SELECT device_pin p FROM employees WHERE id=?').get(e).p;
// máy đẩy từng lượt một như thời gian thực; p = 'DD HH:MM' (tháng 11/2026)
const quet = (e, list) => { for (const p of list) ingestAttlog('SN1', `${pinOf(e)}\t2026-11-${p}:00\t0\t1`, { ask: () => {} }); };
const cong = (e) => db.prepare('SELECT a.*, s.code sc FROM attendance a LEFT JOIN shifts s ON s.id=a.shift_id WHERE a.employee_id=? ORDER BY a.work_date, a.check_in_at').all(e)
  .map((a) => ({ d: a.work_date.slice(8), ca: a.sc || '', vao: hm(a.check_in_at), ra: hm(a.check_out_at), tre: a.late_min || 0, som: a.early_min || 0, phut: a.work_minutes || 0, cong: a.work_unit || 0, ot: a.ot_min || 0, st: a.day_status }));
const daily = (e, d) => db.prepare('INSERT INTO daily_shift_assignments(employee_id, work_date, shift_id, is_off) VALUES (?,?,?,0)').run(e, '2026-11-' + d, null) && 0;

before(async () => {
  initSchema();
  setSetting('attendance_mode', 'shift');
  setSetting('self_shift_enabled', '1'); setSetting('self_shift_approve', '1');
  const ins = (o) => { const k = Object.keys(o); return Number(db.prepare(`INSERT INTO shifts(${k.join(',')}) VALUES(${k.map(() => '?').join(',')})`).run(...k.map((x) => o[x])).lastInsertRowid); };
  const b = { late_grace_min: 0, early_grace_min: 0, allow_ot: 1, ot_start_after_min: 30, work_unit_value: 1, break_minutes: 60 };
  S.HC = ins({ ...b, name: 'Hành chính', code: 'HC', start_time: '08:00', end_time: '17:00' });
  S.CH = ins({ ...b, name: 'Chiều', code: 'CH', start_time: '14:00', end_time: '22:00' });
  S.SA = ins({ ...b, name: 'Sáng', code: 'SA', start_time: '06:00', end_time: '14:00' });
  S.DM = ins({ ...b, name: 'Đêm', code: 'DM', start_time: '22:00', end_time: '06:00' });
  S.D23 = ins({ ...b, name: 'Đêm 23', code: 'D23', start_time: '23:00', end_time: '07:00' });
  S.C3 = ins({ ...b, name: 'Ca 3', code: 'C3', start_time: '00:00', end_time: '08:00' });
  ADMIN = emp(null, 'admin');
  const app = express(); app.use(express.json({ limit: '2mb' }));
  app.use('/api/shift-requests', (await import('../server/routes/shift-requests.js')).default);
  app.use('/api/leaves', (await import('../server/routes/leaves.js')).default);
  app.use('/api/admin', (await import('../server/routes/admin.js')).default);
  app.use('/api/attendance', (await import('../server/routes/attendance.js')).default);
  app.use((err, req, res, next) => { res.status(500).json({ error: 'LOI 500: ' + err.message }); });   // eslint-disable-line no-unused-vars
  srv = app.listen(0); base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { mock.timers.reset(); srv.close(); try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} });

/* ---------------- DUYỆT CHỌN CA ---------------- */
test('tài khoản tổng duyệt đăng ký chọn ca: không còn lỗi khoá ngoại', async () => {
  const e = emp(S.HC);
  const r = await call('POST', '/api/shift-requests', e, { work_date: '2026-11-03', shift_id: S.CH });
  assert.equal(r.body.request.status, 'pending');
  const rv = await call('POST', `/api/shift-requests/${r.body.request.id}/review`, 'master', { action: 'approve' });
  assert.equal(rv.status, 200, JSON.stringify(rv.body));
  assert.equal(db.prepare('SELECT status FROM shift_requests WHERE id=?').get(r.body.request.id).status, 'approved');
  assert.deepEqual(db.prepare('SELECT shift_id FROM daily_shift_assignments WHERE employee_id=?').all(e).map((x) => x.shift_id), [S.CH]);
});

test('duyệt chọn ca cho ngày đã có giờ chấm: công ngày đó tính lại theo ca vừa duyệt', async () => {
  const e = emp(S.HC);
  quet(e, ['04 13:55', '04 22:05']);
  assert.equal(cong(e)[0].ca, 'HC');
  assert.equal(cong(e)[0].tre, 355);   // theo ca Hành chính 08–17: trễ 355 phút
  const r = await call('POST', '/api/shift-requests', e, { work_date: '2026-11-04', shift_id: S.CH });
  const rv = await call('POST', `/api/shift-requests/${r.body.request.id}/review`, ADMIN, { action: 'approve' });
  assert.equal(rv.status, 200);
  const c = cong(e)[0];
  assert.deepEqual([c.ca, c.vao, c.ra, c.tre, c.som, c.phut, c.cong, c.ot], ['CH', '04 13:55', '04 22:05', 0, 0, 420, 1, 0]);
});

test('chế độ tự áp dụng (không cần duyệt): nhân viên chọn ca xong công cũng tính lại', async () => {
  setSetting('self_shift_approve', '0');
  try {
    const e = emp(S.HC);
    quet(e, ['05 13:55', '05 22:05']);
    const r = await call('POST', '/api/shift-requests', e, { work_date: '2026-11-05', shift_id: S.CH });
    assert.equal(r.body.auto, true);
    const c = cong(e)[0];
    assert.deepEqual([c.ca, c.tre, c.cong], ['CH', 0, 1]);
  } finally { setSetting('self_shift_approve', '1'); }
});

test('đăng ký chọn ca đã xử lý: không duyệt / từ chối lại được (lịch không bị lệch với trạng thái đơn)', async () => {
  const e = emp(S.HC);
  const r = await call('POST', '/api/shift-requests', e, { work_date: '2026-11-06', shift_id: S.CH });
  const id = r.body.request.id;
  assert.equal((await call('POST', `/api/shift-requests/${id}/review`, ADMIN, { action: 'approve' })).status, 200);
  const again = await call('POST', `/api/shift-requests/${id}/review`, ADMIN, { action: 'reject' });
  assert.equal(again.status, 400);
  assert.equal(db.prepare('SELECT status FROM shift_requests WHERE id=?').get(id).status, 'approved');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM daily_shift_assignments WHERE employee_id=?').get(e).c, 1);
});

/* ---------------- ĐƠN NGHỈ ---------------- */
test('nhân viên gửi đơn nghỉ: loại đơn lạ hoặc ngày sai dạng bị từ chối; đơn đúng vẫn gửi được', async () => {
  const e = emp(S.HC);
  assert.equal((await call('POST', '/api/leaves', e, { type: 'Loại bậy bạ', from_date: '2026-11-05', to_date: '2026-11-05' })).status, 400);
  assert.equal((await call('POST', '/api/leaves', e, { type: 'Nghỉ phép', from_date: 'abc', to_date: 'abd' })).status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM leave_requests WHERE employee_id=?').get(e).c, 0);
  const ok = await call('POST', '/api/leaves', e, { type: 'Nghỉ không lương', from_date: '2026-11-05', to_date: '2026-11-06', reason: 'việc nhà' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.leave.status, 'pending');
});

test('đơn nghỉ đã duyệt / đã từ chối: không duyệt lại được (2 quản lý cùng mở danh sách)', async () => {
  const e = emp(S.HC);
  const id = (await call('POST', '/api/leaves', e, { type: 'Nghỉ không lương', from_date: '2026-11-10', to_date: '2026-11-10' })).body.leave.id;
  assert.equal((await call('POST', `/api/leaves/${id}/review`, 'master', { action: 'approve' })).status, 200);
  const again = await call('POST', `/api/leaves/${id}/review`, ADMIN, { action: 'reject' });
  assert.equal(again.status, 400);
  assert.equal(db.prepare('SELECT status FROM leave_requests WHERE id=?').get(id).status, 'approved');
});

/* ---------------- SỬA CÔNG TAY ---------------- */
test('sửa công tay ca đêm 22:00–06:00: giờ vào 00:30 là 00:30 HÔM SAU (trễ 150 phút), không phải đầu ngày công', async () => {
  const e = emp(S.DM);
  const r = await call('POST', '/api/admin/attendance', ADMIN, { employee_id: e, work_date: '2026-11-03', check_in: '22:00', check_out: '06:00' });
  assert.equal(r.status, 200);
  let c = cong(e)[0];
  assert.deepEqual([c.vao, c.ra, c.tre, c.phut, c.cong], ['03 22:00', '04 06:00', 0, 420, 1]);
  assert.equal((await call('PUT', `/api/admin/attendance/${r.body.id}`, ADMIN, { check_in: '00:30' })).status, 200);
  c = cong(e)[0];
  assert.deepEqual([c.d, c.vao, c.ra, c.tre], ['03', '04 00:30', '04 06:00', 150]);
  assert.equal(c.phut, 270);   // 00:30 → 06:00 = 330 phút, trừ nghỉ giữa ca 60
  // về sớm trước nửa đêm vẫn là cùng ngày
  assert.equal((await call('PUT', `/api/admin/attendance/${r.body.id}`, ADMIN, { check_in: '22:00', check_out: '23:30' })).status, 200);
  c = cong(e)[0];
  assert.deepEqual([c.vao, c.ra, c.tre, c.som], ['03 22:00', '03 23:30', 0, 390]);
});

test('sửa công tay ca đêm: nhập cả hai giờ 00:30 → 06:00 và chỉ nhập giờ ra 06:00 đều ra đúng sáng hôm sau', async () => {
  const e = emp(S.DM);
  await call('POST', '/api/admin/attendance', ADMIN, { employee_id: e, work_date: '2026-11-03', check_in: '00:30', check_out: '06:00' });
  await call('POST', '/api/admin/attendance', ADMIN, { employee_id: e, work_date: '2026-11-05', check_in: '', check_out: '06:00' });
  const [a, b] = cong(e);
  assert.deepEqual([a.d, a.vao, a.ra, a.tre], ['03', '04 00:30', '04 06:00', 150]);
  assert.deepEqual([b.d, b.vao, b.ra], ['05', null, '06 06:00']);
});

test('sửa công tay ca ngày không đổi: 08:00 → 17:00 cùng ngày, ra 01:00 là sáng hôm sau', async () => {
  const e = emp(S.HC);
  await call('POST', '/api/admin/attendance', ADMIN, { employee_id: e, work_date: '2026-11-03', check_in: '08:00', check_out: '17:00' });
  await call('POST', '/api/admin/attendance', ADMIN, { employee_id: e, work_date: '2026-11-04', check_in: '08:00', check_out: '01:00' });
  const [a, b] = cong(e);
  assert.deepEqual([a.vao, a.ra, a.phut, a.cong], ['03 08:00', '03 17:00', 480, 1]);
  assert.deepEqual([b.vao, b.ra], ['04 08:00', '05 01:00']);
});

test('sửa công tay: giờ sai dạng báo lỗi rõ ràng (400), "8" hoặc "830" hiểu là 08:00 / 08:30', async () => {
  const e = emp(S.HC);
  const r = await call('POST', '/api/admin/attendance', ADMIN, { employee_id: e, work_date: '2026-11-03', check_in: '8', check_out: '1700' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([cong(e)[0].vao, cong(e)[0].ra], ['03 08:00', '03 17:00']);
  for (const bad of ['25:99', '83:0', 'abc']) {
    const x = await call('PUT', `/api/admin/attendance/${r.body.id}`, ADMIN, { check_in: bad });
    assert.equal(x.status, 400, bad + ' → ' + JSON.stringify(x.body));
  }
  const y = await call('POST', '/api/admin/attendance', ADMIN, { employee_id: e, work_date: '2026-11-04', check_in: '99:00', check_out: '' });
  assert.equal(y.status, 400);
  assert.deepEqual([cong(e)[0].vao, cong(e)[0].ra], ['03 08:00', '03 17:00']);   // dòng cũ không bị đụng
  assert.equal((await call('PUT', `/api/admin/attendance/${r.body.id}`, ADMIN, { check_in: '830' })).status, 200);
  assert.equal(cong(e)[0].vao, '03 08:30');
});

/* ---------------- MÁY CHẤM CÔNG: CA ĐÊM ---------------- */
test('ca đêm bình thường 2 đêm liền + tăng ca sáng + về sớm: giữ nguyên như cũ', () => {
  const e = emp(S.DM);
  quet(e, ['03 21:55', '04 09:30', '04 21:57', '05 02:00', '05 21:50', '06 06:02']);
  const c = cong(e);
  assert.deepEqual(c.map((x) => [x.d, x.vao, x.ra, x.tre, x.som, x.phut, x.ot]), [
    ['03', '03 21:55', '04 09:30', 0, 0, 420, 210],
    ['04', '04 21:57', '05 02:00', 0, 240, 180, 0],
    ['05', '05 21:50', '06 06:02', 0, 0, 420, 0],
  ]);
});

test('ca đêm 23:00–07:00 vào trễ sau nửa đêm (00:10): vẫn ra dòng công của đêm đó, trễ 70 phút', () => {
  const e = emp(S.D23);
  quet(e, ['03 22:55', '04 07:05', '05 00:10', '05 07:05', '05 22:50', '06 07:01']);
  const c = cong(e);
  assert.deepEqual(c.map((x) => [x.d, x.vao, x.ra, x.tre]), [
    ['03', '03 22:55', '04 07:05', 0],
    ['04', '05 00:10', '05 07:05', 70],
    ['05', '05 22:50', '06 07:01', 0],
  ]);
  assert.equal(c[1].phut, 350);   // 00:10 → 07:00 = 410 phút, trừ nghỉ giữa ca 60
});

test('ca đêm 22:00–06:00 chỉ làm 1 đêm, vào trễ 00:30: lượt đầu thành giờ vào (thiếu ra), lượt sau thành giờ ra', () => {
  const e = emp(S.DM);
  quet(e, ['05 00:30']);
  assert.deepEqual(cong(e).map((x) => [x.d, x.vao, x.ra, x.tre, x.st]), [['04', '05 00:30', null, 150, 'thieu_ra']]);
  quet(e, ['05 06:05']);
  assert.deepEqual(cong(e).map((x) => [x.d, x.vao, x.ra, x.tre, x.phut]), [['04', '05 00:30', '05 06:05', 150, 270]]);
});

test('ca đêm quên chấm vào, chỉ có 1 lượt sát giờ tan ca (06:02): không dựng thành "vào trễ" (như cũ)', () => {
  const e = emp(S.DM);
  quet(e, ['03 21:55', '04 06:05', '05 06:02', '05 21:58', '06 06:00']);
  assert.deepEqual(cong(e).map((x) => [x.d, x.vao, x.ra]), [['03', '03 21:55', '04 06:05'], ['05', '05 21:58', '06 06:00']]);
});

test('lịch hôm trước ca đêm (vắng), hôm sau ca sáng 06:00: lượt 05:50 là giờ vào ca sáng, không bị kéo về ca đêm', () => {
  const e = emp(null);
  db.prepare('INSERT INTO daily_shift_assignments(employee_id, work_date, shift_id, is_off) VALUES (?,?,?,0)').run(e, '2026-11-03', S.DM);
  db.prepare('INSERT INTO daily_shift_assignments(employee_id, work_date, shift_id, is_off) VALUES (?,?,?,0)').run(e, '2026-11-04', S.SA);
  quet(e, ['04 05:50', '04 09:00', '04 14:05']);
  assert.deepEqual(cong(e).map((x) => [x.d, x.ca, x.vao, x.ra, x.cong]), [['04', 'SA', '04 05:50', '04 14:05', 1]]);
});

test('lịch hôm trước ca đêm (vắng), hôm sau ca hành chính 08:00 đến rất sớm 05:30: 3 lượt vẫn thuộc ca hành chính hôm sau', () => {
  const e = emp(null);
  db.prepare('INSERT INTO daily_shift_assignments(employee_id, work_date, shift_id, is_off) VALUES (?,?,?,0)').run(e, '2026-11-03', S.DM);
  db.prepare('INSERT INTO daily_shift_assignments(employee_id, work_date, shift_id, is_off) VALUES (?,?,?,0)').run(e, '2026-11-04', S.HC);
  quet(e, ['04 05:30', '04 09:00', '04 17:00']);
  assert.deepEqual(cong(e).map((x) => [x.d, x.ca, x.vao, x.ra, x.tre, x.cong]), [['04', 'HC', '04 05:30', '04 17:00', 0, 1]]);
});

test('ca đêm 22:00–06:00 vào rất trễ 03:00 rồi ra 06:05: vẫn là ca đêm hôm trước (trễ 300 phút), hôm sau không có dòng rác', () => {
  const e = emp(S.DM);
  quet(e, ['05 03:00', '05 06:05', '05 21:55', '06 06:01']);
  assert.deepEqual(cong(e).map((x) => [x.d, x.vao, x.ra, x.tre]), [['04', '05 03:00', '05 06:05', 300], ['05', '05 21:55', '06 06:01', 0]]);
});

/* ---------------- MÁY CHẤM CÔNG: CA BẮT ĐẦU NGAY SAU NỬA ĐÊM ---------------- */
test('ca 00:00–08:00 đến sớm 23:50 hôm trước: không còn dòng rác hôm trước, giờ ra không lấy nhầm lượt 23:55', () => {
  const e = emp(S.C3);
  quet(e, ['03 23:50']);
  assert.deepEqual(cong(e).map((x) => [x.d, x.vao, x.ra, x.tre]), [['04', '03 23:50', null, 0]]);   // đang trong ca: hiện ở ngày 04, chưa ra
  quet(e, ['04 08:05', '04 23:55', '05 08:01']);
  assert.deepEqual(cong(e).map((x) => [x.d, x.vao, x.ra, x.tre, x.phut, x.cong, x.ot]), [
    ['04', '03 23:50', '04 08:05', 0, 420, 1, 0],
    ['05', '04 23:55', '05 08:01', 0, 420, 1, 0],
  ]);
});

test('ca 00:00–08:00 vào đúng sau nửa đêm (00:05): trễ 5 phút như cũ', () => {
  const e = emp(S.C3);
  quet(e, ['04 00:05', '04 08:05']);
  assert.deepEqual(cong(e).map((x) => [x.d, x.vao, x.ra, x.tre, x.phut]), [['04', '04 00:05', '04 08:05', 5, 415]]);
});

test('ca ngày 08:00–17:00 tăng ca tới 23:30, hôm sau vẫn ca 08:00: lượt 23:30 vẫn là giờ ra (không bị đẩy sang hôm sau)', () => {
  const e = emp(S.HC);
  quet(e, ['03 07:55', '03 23:30', '04 07:58', '04 17:02']);
  assert.deepEqual(cong(e).map((x) => [x.d, x.vao, x.ra]), [['03', '03 07:55', '03 23:30'], ['04', '04 07:58', '04 17:02']]);
});

/* ---------------- ĐIỆN THOẠI: CA ĐÊM VÀO TRỄ SAU NỬA ĐÊM ---------------- */
test('điện thoại, ca đêm 22:00–06:00 vào trễ 00:30: ghi vào ca đêm HÔM QUA (trễ 150), chấm ra 06:00 tính đúng giờ', async () => {
  const e = emp(S.DM);
  const PUNCH = { lat: 21.0, lng: 105.8, photo: 'khong-phai-anh' };
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-05T00:30:00+07:00') });
  try {
    const ci = await call('POST', '/api/attendance/check-in', e, PUNCH);
    assert.equal(ci.status, 200, JSON.stringify(ci.body));
    assert.deepEqual(cong(e).map((x) => [x.d, x.ca, x.vao, x.tre, x.st]), [['04', 'DM', '05 00:30', 150, 'thieu_ra']]);
    mock.timers.setTime(new Date('2026-11-05T06:00:00+07:00').getTime());
    const t = await call('GET', '/api/attendance/today', e);
    assert.equal(t.body.state, 'can_out');
    const co = await call('POST', '/api/attendance/check-out', e, PUNCH);
    assert.equal(co.status, 200, JSON.stringify(co.body));
    assert.deepEqual(cong(e).map((x) => [x.d, x.vao, x.ra, x.tre, x.som, x.phut]), [['04', '05 00:30', '05 06:00', 150, 0, 270]]);
    // tối 05 vào ca đêm đúng giờ: là ca của ngày 05 như thường
    mock.timers.setTime(new Date('2026-11-05T21:55:00+07:00').getTime());
    assert.equal((await call('POST', '/api/attendance/check-in', e, PUNCH)).status, 200);
    assert.deepEqual(cong(e).map((x) => [x.d, x.vao, x.tre]), [['04', '05 00:30', 150], ['05', '05 21:55', 0]]);
  } finally { mock.timers.reset(); }
});

test('điện thoại, lịch hôm qua ca đêm (vắng), hôm nay ca sáng 06:00: 05:45 chấm vào là ca sáng hôm nay', async () => {
  const e = emp(null);
  db.prepare('INSERT INTO daily_shift_assignments(employee_id, work_date, shift_id, is_off) VALUES (?,?,?,0)').run(e, '2026-11-11', S.DM);
  db.prepare('INSERT INTO daily_shift_assignments(employee_id, work_date, shift_id, is_off) VALUES (?,?,?,0)').run(e, '2026-11-12', S.SA);
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-12T05:45:00+07:00') });
  try {
    const ci = await call('POST', '/api/attendance/check-in', e, { lat: 21.0, lng: 105.8, photo: 'khong-phai-anh' });
    assert.equal(ci.status, 200, JSON.stringify(ci.body));
    assert.deepEqual(cong(e).map((x) => [x.d, x.ca, x.vao, x.tre]), [['12', 'SA', '12 05:45', 0]]);
  } finally { mock.timers.reset(); }
});
