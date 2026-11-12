// Tên bộ phận CÓ DẤU PHẨY (trankimxuyen 11/11/2026: "Làm sạch (2 ca, nhóm thường xuyên tăng ca, trực 7/7 …)").
// Lọc theo bộ phận ở Tính công / Báo cáo gửi depts=a,b → trước đây tách mù theo dấu phẩy nên tên bị cắt vụn,
// không khớp ai → bảng trống, dù xem theo từng NV vẫn có giờ. splitDeptList ghép lại theo tên bộ phận có thật.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { moCong } from './_cong.mjs';   // cổng ngẫu nhiên an toàn (tránh cổng fetch cấm / cổng test khác đang dò)

const DBP = join(tmpdir(), `dgp-bp-dau-phay-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;
let db, splitDeptList, server, base, tok;
const LS = 'Làm sạch (2 ca, nhóm thường xuyên tăng ca, trực 7/7 ngày tất cả vị trí)';
const KT = 'Kỹ thuật (3 ca, thường xuyên tăng ca)';
const vn = (d, hm) => new Date(`${d}T${hm}:00+07:00`).toISOString();

before(async () => {
  let initSchema;
  ({ db, initSchema, splitDeptList } = await import('../server/db.js'));
  const { signToken } = await import('../server/auth.js');
  const reportRoutes = (await import('../server/routes/reports.js')).default;
  const express = (await import('express')).default;
  initSchema();
  for (const n of [LS, KT, 'An ninh', 'Văn phòng']) db.prepare('INSERT OR IGNORE INTO departments(name) VALUES (?)').run(n);
  const adm = Number(db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash) VALUES ('ADM','Admin','admin','adm','x')").run().lastInsertRowid);
  const att = db.prepare('INSERT INTO attendance(employee_id, work_date, check_in_at, check_out_at, work_unit, work_minutes) VALUES (?,?,?,?,1,480)');
  [['LS1', LS], ['KT1', KT], ['VP1', 'Văn phòng']].forEach(([c, d]) => {
    const id = Number(db.prepare("INSERT INTO employees(code, full_name, department, role, username, password_hash, start_date) VALUES (?,?,?,'employee',?,'x','2026-01-01')").run(c, 'NV ' + c, d, c.toLowerCase()).lastInsertRowid);
    att.run(id, '2026-11-03', vn('2026-11-03', '06:00'), vn('2026-11-03', '14:00'));
  });
  tok = signToken({ id: adm, code: 'ADM', role: 'admin', full_name: 'Admin' });
  const app = express(); app.use(express.json());
  app.use('/api/reports', reportRoutes);
  server = await moCong(app);
  base = `http://127.0.0.1:${server.address().port}/api/reports`;
});
after(() => { server?.close(); for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} } });

test('splitDeptList: tên có dấu phẩy giữ nguyên, nhiều bộ phận vẫn tách đúng', () => {
  assert.deepEqual(splitDeptList(LS), [LS]);
  assert.deepEqual(splitDeptList([LS, KT].join(',')), [LS, KT]);
  assert.deepEqual(splitDeptList(['An ninh', LS, 'Văn phòng'].join(',')), ['An ninh', LS, 'Văn phòng']);
});
test('splitDeptList: tên không có dấu phẩy → y như split(",") cũ (kể cả tên lạ, ô trống)', () => {
  assert.deepEqual(splitDeptList('An ninh,Văn phòng'), ['An ninh', 'Văn phòng']);
  assert.deepEqual(splitDeptList(' An ninh , Lạ ,, '), ['An ninh', 'Lạ']);
  assert.deepEqual(splitDeptList(''), []);
  assert.deepEqual(splitDeptList(undefined), []);
});
test('Báo cáo lọc theo bộ phận có dấu phẩy → ra đúng NV có giờ', async () => {
  const get = async (q) => (await fetch(`${base}/data?type=detaillist&from=2026-11-01&to=2026-11-05&mode=shift&${q}`, { headers: { Authorization: 'Bearer ' + tok } })).json();
  const codes = (r) => [...new Set(r.rows.map((x) => x.code))].sort();
  assert.deepEqual(codes(await get('depts=' + encodeURIComponent(LS))), ['LS1']);
  assert.deepEqual(codes(await get('depts=' + encodeURIComponent([LS, KT].join(',')))), ['KT1', 'LS1']);
  assert.deepEqual(codes(await get('depts=' + encodeURIComponent('Văn phòng'))), ['VP1']);
});
