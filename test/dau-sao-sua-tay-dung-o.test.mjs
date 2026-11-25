// Dấu * "giờ sửa / thêm bằng tay" ở Tính công › Chi tiết (khách mythuatlt 25/11/2026): ngày 24 quẹt vào 06:47 bằng máy, quên ra,
// khách THÊM GIỜ RA TAY 17:30 → dấu * hiện cạnh 06:47 (giờ vào) như thể giờ vào mới là giờ thêm tay. Nay lưới trả man_in / man_out:
// giờ nào là lượt thêm tay thì * nằm cạnh giờ đó. Sửa thẳng ô Vào / Ra (dòng manual) vẫn như cũ (man_in = man_out = 0 → * cạnh giờ vào).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { moCong } from './_cong.mjs';

const dir = mkdtempSync(join(tmpdir(), 'dgp-dausao-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema } = await import('../server/db.js');
const { ingestAttlog } = await import('../server/device-sync.js');
const { registerAttendanceRoutes } = await import('../server/routes/admin/attendance.js');
const express = (await import('express')).default;

let srv, base, E, N;
before(async () => {
  initSchema();
  const emp = (code) => Number(db.prepare("INSERT INTO employees(code, username, password_hash, full_name, role, active, device_pin) VALUES (?,?,'x',?,'employee',1,?)").run(code, code.toLowerCase(), 'NV ' + code, code.replace(/\D/g, '')).lastInsertRowid);
  const sh = (o) => Number(db.prepare('INSERT INTO shifts(name, code, start_time, end_time, break_minutes, merge_rule) VALUES (?,?,?,?,?,?)').run(o.name, o.code, o.start, o.end, o.br, 'filo').lastInsertRowid);
  E = emp('SX802'); N = emp('DM803');
  db.prepare('UPDATE employees SET shift_id=? WHERE id=?').run(sh({ name: 'Hành chính', code: 'HC', start: '07:00', end: '17:30', br: 150 }), E);
  db.prepare('UPDATE employees SET shift_id=? WHERE id=?').run(sh({ name: 'Đêm', code: 'DM', start: '19:00', end: '07:00', br: 60 }), N);
  ingestAttlog('SN1', ['802\t2026-11-24 06:47:00\t0\t1', '803\t2026-11-24 18:55:00\t0\t1'].join('\n'), { ask: () => {} });
  const app = express(); app.use(express.json());
  const r = express.Router();
  r.use((q, s, n) => { q.user = { id: 1, full_name: 'QL', role: 'admin' }; n(); });
  registerAttendanceRoutes(r, { need: () => (q, s, n) => n() });
  app.use('/admin', r);
  srv = await moCong(app); base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { srv?.close(); try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} });

const call = async (method, p, body) => {
  const x = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await x.json(); assert.equal(x.status, 200, JSON.stringify(j)); return j;
};
const row = async (eid) => (await call('GET', `/admin/attendance/grid?mode=detail&from=2026-11-24&to=2026-11-24&ids=${eid}`)).rows.find((r) => r.date === '2026-11-24');

test('vào 06:47 bằng máy + thêm tay giờ RA 17:30 → * cạnh giờ ra, không cạnh giờ vào', async () => {
  await call('POST', '/admin/attendance/punches', { employee_id: E, date: '2026-11-24', out: '17:30' });
  const r = await row(E);
  assert.deepEqual([r.in, r.out, r.manual, r.man_in, r.man_out], ['06:47', '17:30', 1, 0, 1]);
});

test('ca đêm: thêm tay giờ RA 07:00 sáng hôm sau (lượt nằm ở ngày 25) → * cạnh giờ ra của dòng đêm 24', async () => {
  await call('POST', '/admin/attendance/punches', { employee_id: N, date: '2026-11-24', out: '07:00', out_date: '2026-11-25' });
  const r = await row(N);
  assert.deepEqual([r.in, r.out, r.man_in, r.man_out], ['18:55', '07:00', 0, 1]);
});

test('nút SỬA trên dòng (PUT cả dòng, giây bị cắt): vào 06:43:27 quẹt máy + nhập ra 17:30 → * chỉ cạnh giờ ra', async () => {
  const D = Number(db.prepare("INSERT INTO employees(code, username, password_hash, full_name, role, active, device_pin, shift_id) VALUES ('SX813','sx813','x','NV 813','employee',1,'813',(SELECT shift_id FROM employees WHERE id=?))").run(E).lastInsertRowid);
  ingestAttlog('SN1', '813\t2026-11-24 06:43:27\t0\t1', { ask: () => {} });
  const r0 = await row(D);
  assert.deepEqual([r0.in, r0.out, r0.manual], ['06:43', '', 0]);
  await call('PUT', `/admin/attendance/${r0.att_id}`, { check_in: '06:43', check_out: '17:30' });   // modal Sửa gửi cả 2 ô
  const r = await row(D);
  assert.deepEqual([r.in, r.out, r.manual, r.man_in, r.man_out], ['06:43', '17:30', 1, 0, 1]);
  // sửa cả giờ vào sang giờ không có lượt quẹt nào → * cả 2 ô
  await call('PUT', `/admin/attendance/${r0.att_id}`, { check_in: '07:00', check_out: '17:30' });
  const r2 = await row(D);
  assert.deepEqual([r2.man_in, r2.man_out], [1, 1]);
});

test('dòng sửa tay mà cả 2 giờ đều trùng lượt quẹt thật (chỉ sửa ghi chú) → không rõ ô nào, * cạnh giờ vào như cũ', async () => {
  const D = Number(db.prepare("INSERT INTO employees(code, username, password_hash, full_name, role, active, device_pin, shift_id) VALUES ('SX814','sx814','x','NV 814','employee',1,'814',(SELECT shift_id FROM employees WHERE id=?))").run(E).lastInsertRowid);
  ingestAttlog('SN1', ['814\t2026-11-24 06:40:00\t0\t1', '814\t2026-11-24 17:35:00\t0\t1'].join('\n'), { ask: () => {} });
  const r0 = await row(D);
  await call('PUT', `/admin/attendance/${r0.att_id}`, { check_in: '06:40', check_out: '17:35', note: 'đã kiểm' });
  const r = await row(D);
  assert.deepEqual([r.manual, r.man_in, r.man_out], [1, 0, 0]);
});
