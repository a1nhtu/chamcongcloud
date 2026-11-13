// "Số giờ chuẩn của 1 ngày công" (Cài đặt › Quy tắc tính công, pay_hours_per_day) áp cho công của ngày KHÔNG có ca
// (nhân viên chấm công THEO GIỜ, hoặc chế độ theo ca mà ngày đó không tìm được ca): số công = phút làm ÷ (số giờ × 60), tối đa 1.
// Trước đây ô này chỉ đổi lương ngày → lương giờ; công ngày không ca luôn = phút ÷ 480 (đặt 9 giờ, làm 510 phút vẫn ra 1 công).
// Cài đặt để mặc định 8 thì MỌI kết quả phải y như cũ.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { moCong } from './_cong.mjs';

const dir = mkdtempSync(join(tmpdir(), 'dgp-giochuan-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema, setSetting, getSetting } = await import('../server/db.js');
const { ingestAttlog, rebuildDay } = await import('../server/device-sync.js');
const { payrollCtx, computeDayMetrics, standardMinutesFrom } = await import('../server/day-metrics.js');
const { noShiftUnit } = await import('../server/attendance-calc.js');
const { registerAttendanceRoutes } = await import('../server/routes/admin/attendance.js');
const { signToken } = await import('../server/auth.js');
const { vnDateStr } = await import('../server/util.js');
const phoneRoutes = (await import('../server/routes/attendance.js')).default;
const express = (await import('express')).default;

let srv, base, n = 0;
const iso = (d, t) => new Date(`${d}T${t}:00+07:00`).toISOString();
const setHpd = (v) => { if (v === undefined) db.prepare("DELETE FROM settings WHERE key='pay_hours_per_day'").run(); else setSetting('pay_hours_per_day', String(v)); };
const mkEmp = (mode, extra = '') => {
  n++;
  return Number(db.prepare(`INSERT INTO employees(code, username, password_hash, full_name, role, active, att_mode, device_pin) VALUES (?,?,'x',?,'employee',1,?,?)`)
    .run('G' + n, 'g' + n, 'NV G' + n, mode, String(9300 + n)).lastInsertRowid);
};
const pinOf = (id) => db.prepare('SELECT device_pin p FROM employees WHERE id=?').get(id).p;
const adminCall = async (m, p, b) => {
  const x = await fetch(base + '/admin' + p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  return { status: x.status, body: await x.json() };
};
const phoneCall = async (m, p, who, b) => {
  const x = await fetch(base + '/api/attendance' + p, { method: m, headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + signToken(db.prepare('SELECT * FROM employees WHERE id=?').get(who)) }, body: b ? JSON.stringify(b) : undefined });
  return { status: x.status, body: await x.json() };
};
const unitOf = (id, d) => { const r = db.prepare('SELECT work_unit u, work_minutes m FROM attendance WHERE employee_id=? AND work_date=?').get(id, d); return r && { ...r }; };

before(async () => {
  initSchema();
  db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('punch_dedup_min','5')").run();
  db.prepare('UPDATE shifts SET active=0').run();   // không còn ca nào → ngày chế độ theo ca cũng "không tìm được ca"
  db.prepare("INSERT INTO push_devices(serial,name,active,machine_number) VALUES('SN1','Cổng vào',1,1),('SN2','Cổng ra',1,2)").run();
  const app = express(); app.use(express.json());
  app.use('/api/attendance', phoneRoutes);
  app.use('/admin', (q, s, nx) => { q.user = { id: 1, full_name: 'QL', role: 'admin' }; nx(); });
  const r = express.Router(); registerAttendanceRoutes(r, { need: () => (q, s, nx) => nx() }); app.use('/admin', r);
  srv = await moCong(app); base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { srv.close(); try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} });

test('standardMinutesFrom: 8 giờ = 480 phút; 7,5 → 450; 9 → 540; trống / sai / ngoài 1–24 → 8 giờ như hoursPerDay()', () => {
  const g = (v) => (k, d) => (k === 'pay_hours_per_day' ? v : d);
  assert.equal(standardMinutesFrom((k, d) => d), 480);   // chưa cài
  assert.equal(standardMinutesFrom(g('8')), 480);
  assert.equal(standardMinutesFrom(g('7.5')), 450);
  assert.equal(standardMinutesFrom(g('9')), 540);
  assert.equal(standardMinutesFrom(g('12')), 720);
  assert.equal(standardMinutesFrom(g('1')), 60);
  assert.equal(standardMinutesFrom(g('24')), 1440);
  for (const bad of ['', 'abc', '0', '0.5', '25', '-3', 'NaN', undefined]) assert.equal(standardMinutesFrom(g(bad)), 480, 'giá trị ' + bad);
  assert.equal(standardMinutesFrom(g('8.3')), 498);   // làm tròn phút, không lẻ số thực
});

test('cài đặt mặc định (chưa cài hoặc 8): công ngày không ca Y NHƯ CŨ — mọi số phút 0…1000 khớp noShiftUnit(phút) mặc định', () => {
  const id = mkEmp('hourly');
  for (const v of [undefined, 8, '8', '8.0', 'sai']) {
    setHpd(v);
    const ctx = payrollCtx(getSetting, db);
    for (let wm = 0; wm <= 1000; wm++) {
      const d = '2026-11-03';   // thứ Ba
      const c = computeDayMetrics(ctx, null, d, iso(d, '08:00'), new Date(Date.parse(iso(d, '08:00')) + wm * 60000).toISOString(), null, { hourly: true, empId: id });
      assert.equal(c.work_minutes, wm);
      assert.equal(c.work_unit, noShiftUnit(wm), `cài ${v}, làm ${wm} phút`);
    }
  }
  setHpd(undefined);
});

test('NV chấm THEO GIỜ quẹt máy: 570 phút → 1 công ở cả 8 và 9; 510 phút → 1 (cài 8) / 0,94 (cài 9) / 1 (cài 7,5); đủ 540 phút mới 1 công khi cài 9', () => {
  const id = mkEmp('hourly');
  const pin = pinOf(id);
  const days = { '2026-11-02': ['08:00', '17:30'], '2026-11-03': ['08:00', '16:30'], '2026-11-04': ['08:00', '12:00'], '2026-11-05': ['08:00', '17:00'], '2026-11-06': ['08:00', '16:59'] };
  for (const [d, [a, b]] of Object.entries(days)) {
    ingestAttlog('SN1', `${pin}\t${d} ${a}:00\t0\t1`, { ask: () => {} });
    ingestAttlog('SN2', `${pin}\t${d} ${b}:00\t1\t1`, { ask: () => {} });
  }
  const units = () => Object.keys(days).map((d) => unitOf(id, d)?.u);
  const redo = (v) => { setHpd(v); for (const d of Object.keys(days)) rebuildDay(id, d); return units(); };
  //                570   510    240    540    539
  assert.deepEqual(redo(undefined), [1, 1, 0.5, 1, 1], 'chưa cài');
  assert.deepEqual(redo(8), [1, 1, 0.5, 1, 1], 'cài 8');
  assert.deepEqual(redo(9), [1, 0.94, 0.44, 1, 0.99], 'cài 9');
  assert.deepEqual(redo(7.5), [1, 1, 0.53, 1, 1], 'cài 7,5');
  assert.deepEqual(redo(12), [0.79, 0.7, 0.33, 0.75, 0.74], 'cài 12');
  assert.deepEqual(redo('abc'), [1, 1, 0.5, 1, 1], 'cài sai → 8 giờ');
  assert.deepEqual(redo(8), [1, 1, 0.5, 1, 1], 'trả về 8 → như cũ');
  assert.equal(unitOf(id, '2026-11-03').m, 510);   // phút làm không đổi, chỉ số công đổi
});

test('chế độ THEO CA nhưng ngày không tìm được ca (không còn ca nào): sửa giờ tay 08:00–16:30 → 1 công (cài 8) / 0,94 (cài 9)', async () => {
  const id = mkEmp('shift');
  setHpd(8);
  let r = await adminCall('POST', '/attendance', { employee_id: id, work_date: '2026-11-03', check_in: '08:00', check_out: '16:30' });
  assert.equal(r.status, 200);
  assert.deepEqual(unitOf(id, '2026-11-03'), { u: 1, m: 510 });
  setHpd(9);
  r = await adminCall('POST', '/attendance', { employee_id: id, work_date: '2026-11-03', check_in: '08:00', check_out: '16:30' });
  assert.equal(r.status, 200);
  assert.deepEqual(unitOf(id, '2026-11-03'), { u: 0.94, m: 510 });
  setHpd(undefined);
});

test('chấm RA bằng ĐIỆN THOẠI (không ca): làm 510 phút → 1 công (cài 8) / 0,94 (cài 9)', async () => {
  const today = vnDateStr();
  const PUNCH = { lat: 21.0, lng: 105.8, photo: 'khong-phai-anh' };
  for (const [mode, v, want] of [['hourly', 8, 1], ['hourly', 9, 0.94], ['hourly', 7.5, 1], ['shift', 8, 1], ['shift', 9, 0.94]]) {
    const id = mkEmp(mode);
    setHpd(v);
    // phiên đã mở cách đây đúng 510 phút (hôm nay theo ngày công của bản ghi)
    db.prepare("INSERT INTO attendance(employee_id, work_date, check_in_at, check_in_photo, day_status, shift_source) VALUES (?,?,?,'/a.jpg','thieu_ra','hourly')")
      .run(id, today, new Date(Date.now() - 510 * 60000).toISOString());
    const out = await phoneCall('POST', '/check-out', id, PUNCH);
    assert.equal(out.status, 200, JSON.stringify(out.body));
    const row = unitOf(id, today);
    assert.equal(row.m, 510, `${mode} cài ${v}`);
    assert.equal(row.u, want, `${mode} cài ${v}`);
  }
  setHpd(undefined);
});
