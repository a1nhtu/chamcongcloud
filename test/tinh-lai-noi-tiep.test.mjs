// Quản lý BÙ TAY một ngày (thêm / sửa / xoá lượt chấm, thêm hàng loạt, dòng công tay, sửa giờ ở bảng Tính công)
// → các ngày SAU của nhân viên đó tự tính lại NỐI TIẾP cho tới khi kết quả hết đổi — không cần bấm Tính lại.
// Bối cảnh: công ngày N+1 phụ thuộc ngày N (lượt chấm sáng sớm đã là giờ RA ca đêm hôm trước thì không dùng lại — consumedByPrevDay).
// NV ca đêm quên chấm VÀO một đêm → các đêm sau dựng sai dây chuyền ([HC] 07:00→19:00 tăng ca 120'). Bù lượt thiếu: trước đây chỉ
// ngày đó + 1 ngày kế đúng lại, các ngày sau nữa sai tới khi có người bấm Tính lại.
// Dùng CSDL tạm (DB_PATH) + gọi thật các route quản trị (cổng ngẫu nhiên an toàn: moCong).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { moCong } from './_cong.mjs';

const dir = mkdtempSync(join(tmpdir(), 'dgp-noitiep-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema } = await import('../server/db.js');
const { ingestAttlog } = await import('../server/device-sync.js');
const { registerAttendanceRoutes, recomputeAttendance } = await import('../server/routes/admin/attendance.js');
const express = (await import('express')).default;

const hm = (x) => (x ? new Date(Date.parse(x) + 7 * 3600e3).toISOString().slice(8, 16).replace('T', ' ') : '-');
const ins = (t, o) => { const k = Object.keys(o); return db.prepare(`INSERT INTO ${t}(${k.join(',')}) VALUES(${k.map(() => '?').join(',')})`).run(...k.map((x) => o[x])).lastInsertRowid; };
const S = {};
let W, IO, srv, base, n = 0;
const call = async (m, p, b) => {
  const x = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  return { status: x.status, body: await x.json() };
};
const dayShift = (d, k) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + k); return t.toISOString().slice(0, 10); };

before(async () => {
  initSchema();
  db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('punch_dedup_min','5')").run();
  db.prepare('UPDATE shifts SET active=0').run();   // bỏ ca mẫu để tự dò chỉ thấy ca của bài thử
  const sh = (code, start, end) => (S[code] = ins('shifts', { name: code, code, start_time: start, end_time: end, late_grace_min: 0, early_grace_min: 0, allow_ot: 1, ot_start_after_min: 30, work_unit_value: 1, break_minutes: 60, ...(end <= start ? { cross_midnight: 1 } : {}) }));
  sh('HC', '08:00', '17:00'); sh('DM', '19:00', '07:00');
  db.prepare("INSERT INTO push_devices(serial,name,active,machine_number) VALUES('SN1','Cổng vào',1,1),('SN2','Cổng ra',1,2)").run();
  db.prepare('UPDATE inout_schedules SET is_default=0').run();
  IO = ins('inout_schedules', { code: 'P_filo', name: 'filo', rule: 'filo', min_minutes: 30, max_minutes: 960, gap_minutes: 30, is_default: 1 });
  // lịch "tự dò" gồm HC 08–17 và DM 19–07, vào ra theo cặp đầu–cuối (filo)
  W = db.prepare("INSERT INTO work_schedules(code,name,unit,cycle) VALUES('',?,'auto',1)").run('Xoay HC/DM').lastInsertRowid;
  ['HC', 'DM'].forEach((c, i) => db.prepare('INSERT INTO work_schedule_shifts(work_schedule_id,shift_id,sort_order) VALUES(?,?,?)').run(W, S[c], i));
  const app = express(); app.use(express.json());
  app.use((q, s, nx) => { q.user = { id: 1, full_name: 'QL', role: 'admin' }; nx(); });
  const r = express.Router(); registerAttendanceRoutes(r, { need: () => (q, s, nx) => nx() }); app.use('/admin', r);
  srv = await moCong(app); base = `http://127.0.0.1:${srv.address().port}/admin`;
});
after(() => { srv.close(); try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} });

// Tạo NV gán lịch tự dò HC/DM + nạp các lượt quẹt ('DD HH:MM v|r' = ngày tháng 11/2026 · giờ · vào|ra), theo thứ tự giờ như máy đẩy về
function mkEmp(list, { month = '2026-11' } = {}) {
  n++; const pin = String(9100 + n);
  const id = db.prepare("INSERT INTO employees(code,full_name,username,password_hash,role,device_pin) VALUES(?,?,?,'x','employee',?)").run('N' + n, 'NV ' + n, 'n' + n, pin).lastInsertRowid;
  ins('shift_assignments', { employee_id: id, mode: 'schedule', work_schedule_id: W, from_date: '2026-10-26', shift_type: 'fixed', merge_rule: 'default', inout_schedule_id: IO, active: 1 });
  for (const p of list) { const [d, t, k] = p.split(' '); ingestAttlog(k === 'v' ? 'SN1' : 'SN2', `${pin}\t${month}-${d} ${t}:00\t${k === 'v' ? 0 : 1}\t1`, { ask: () => {} }); }
  return id;
}
const codeOf = Object.fromEntries(Object.entries(S).map(([k, v]) => [v, k]));
// Dòng công của NV dạng chữ: "03[DM] 19:00→07:00 1c tc120"
const rows = (id, from = '0000', to = '9999') => db.prepare('SELECT * FROM attendance WHERE employee_id=? AND work_date>=? AND work_date<=? ORDER BY work_date, check_in_at').all(id, from, to)
  .map((r) => `${r.work_date.slice(8)}[${codeOf[r.shift_id] || '-'}] ${hm(r.check_in_at).slice(3)}→${hm(r.check_out_at).slice(3)} ${r.work_unit}c${r.late_min ? ' trễ' + r.late_min : ''}${r.early_min ? ' sớm' + r.early_min : ''}${r.ot_min ? ' tc' + r.ot_min : ''}${r.manual ? ' (tay)' : ''}`);
// Toàn bộ cột (trừ id) của các dòng công — để khẳng định "y nguyên từng cột"
const full = (id, from = '0000', to = '9999') => db.prepare('SELECT * FROM attendance WHERE employee_id=? AND work_date>=? AND work_date<=? ORDER BY work_date, check_in_at, shift_id').all(id, from, to).map(({ id: _i, ...r }) => r);

// Lịch trình quen với ca đêm: 02 vào · 03 ra · (QUÊN CHẤM VÀO đêm 03) · 04 ra · 04 vào · 05 ra · 05 vào · 06 ra · 06 vào · 07 ra
const QUEN_VAO_03 = ['02 19:00 v', '03 07:00 r', '04 07:00 r', '04 19:00 v', '05 07:00 r', '05 19:00 v', '06 07:00 r', '06 19:00 v', '07 07:00 r'];
const SAI = ['02[DM] 19:00→07:00 1c', '04[HC] 07:00→19:00 1c tc120', '05[HC] 07:00→19:00 1c tc120', '06[HC] 07:00→19:00 1c tc120', '07[HC] 07:00→ 0c'];
const DUNG = ['02[DM] 19:00→07:00 1c', '03[DM] 19:00→07:00 1c', '04[DM] 19:00→07:00 1c', '05[DM] 19:00→07:00 1c', '06[DM] 19:00→07:00 1c'];

test('tái hiện: quên chấm vào đêm 03/11, bù tay 1 lượt VÀO → 02–06 đều [DM] 19:00→07:00 1 công, không còn dòng [HC], KHÔNG cần Tính lại', async () => {
  const id = mkEmp(QUEN_VAO_03);
  assert.deepEqual(rows(id), SAI);   // trạng thái trước khi bù (dây chuyền sai)
  const r = await call('POST', '/attendance/punches', { employee_ids: [id], date: '2026-11-03', in: '19:00' });
  assert.equal(r.status, 200);
  assert.deepEqual(rows(id), DUNG);
  assert.ok(!rows(id).some((x) => x.includes('[HC]')));
  // khớp với Tính lại: bấm Tính lại sau đó không đổi gì
  recomputeAttendance({ from: '2026-11-01', to: '2026-11-10', ids: [id] });
  assert.deepEqual(rows(id), DUNG);
});

test('bù tay bằng DÒNG CÔNG TAY (POST /attendance: 03/11 Vào 19:00 Ra 07:00) → các đêm sau cũng tự đúng, dòng tay giữ nguyên', async () => {
  const id = mkEmp(QUEN_VAO_03);
  const r = await call('POST', '/attendance', { employee_id: id, work_date: '2026-11-03', check_in: '19:00', check_out: '07:00' });
  assert.equal(r.status, 200);
  assert.deepEqual(rows(id), ['02[DM] 19:00→07:00 1c', '03[DM] 19:00→07:00 1c (tay)', '04[DM] 19:00→07:00 1c', '05[DM] 19:00→07:00 1c', '06[DM] 19:00→07:00 1c']);
});

test('sửa giờ RA ở bảng Tính công (PUT /attendance/:id): dòng tay 03/11 chỉ có Vào → thêm Ra 07:00 → các đêm sau tự đúng', async () => {
  const id = mkEmp(QUEN_VAO_03);
  assert.equal((await call('POST', '/attendance', { employee_id: id, work_date: '2026-11-03', check_in: '19:00' })).status, 200);
  assert.deepEqual(rows(id, '2026-11-04', '2026-11-04'), ['04[HC] 07:00→19:00 1c tc120']);   // chưa có giờ ra → chưa gỡ được lượt 04 07:00
  const row = db.prepare("SELECT id FROM attendance WHERE employee_id=? AND work_date='2026-11-03'").get(id);
  assert.equal((await call('PUT', '/attendance/' + row.id, { check_out: '07:00' })).status, 200);
  assert.deepEqual(rows(id), ['02[DM] 19:00→07:00 1c', '03[DM] 19:00→07:00 1c (tay)', '04[DM] 19:00→07:00 1c', '05[DM] 19:00→07:00 1c', '06[DM] 19:00→07:00 1c']);
});

test('THÊM GIỜ HÀNG LOẠT cũng nối tiếp; XOÁ lượt vừa bù → nối tiếp ngược về như trước; SỬA giờ lượt bù vẫn đúng', async () => {
  const id = mkEmp(QUEN_VAO_03);
  const b = await call('POST', '/attendance/punches/bulk', { employee_ids: [id], dates: ['2026-11-03'], in: { time: '19:00', jitter: 0 } });
  assert.equal(b.status, 200); assert.equal(b.body.added, 1);
  assert.deepEqual(rows(id), DUNG);
  const tay = db.prepare("SELECT id FROM device_punches WHERE employee_id=? AND serial='TAY_VAO'").get(id).id;
  assert.equal((await call('PUT', '/attendance/punches/' + tay, { time: '19:05', date: '2026-11-03' })).status, 200);   // sửa giờ lượt bù
  assert.deepEqual(rows(id), ['02[DM] 19:00→07:00 1c', '03[DM] 19:05→07:00 0.99c trễ5', '04[DM] 19:00→07:00 1c', '05[DM] 19:00→07:00 1c', '06[DM] 19:00→07:00 1c']);
  assert.equal((await call('DELETE', '/attendance/punches/' + tay)).status, 200);   // xoá lượt bù → thiếu lượt vào lại như ban đầu
  assert.deepEqual(rows(id), SAI);
});

test('giữ nguyên dòng SỬA TAY của ngày sau (manual=1 không bị đè), vẫn sửa đúng các ngày không sửa tay', async () => {
  const id = mkEmp(QUEN_VAO_03);
  // quản lý đã sửa tay ngày 05/11 thành 08:00–17:00 (dòng tay)
  assert.equal((await call('POST', '/attendance', { employee_id: id, work_date: '2026-11-05', check_in: '08:00', check_out: '17:00' })).status, 200);
  const tay05 = full(id, '2026-11-05', '2026-11-05').filter((r) => r.manual === 1);
  assert.equal(tay05.length, 1);
  assert.equal((await call('POST', '/attendance/punches', { employee_ids: [id], date: '2026-11-03', in: '19:00' })).status, 200);
  assert.deepEqual(full(id, '2026-11-05', '2026-11-05').filter((r) => r.manual === 1), tay05);   // từng cột như cũ
  const r = rows(id);
  assert.deepEqual(r.filter((x) => /^0[234]\[/.test(x)), ['02[DM] 19:00→07:00 1c', '03[DM] 19:00→07:00 1c', '04[DM] 19:00→07:00 1c']);
});

test('ca ngày bình thường: bù tay 1 ngày (thiếu giờ ra) KHÔNG làm đổi bất kỳ ngày nào khác — từng cột y nguyên', async () => {
  // 5 ngày làm hành chính 08:00–17:00; ngày 03 quên chấm ra
  const id = mkEmp(['02 08:00 v', '02 17:00 r', '03 08:00 v', '04 08:00 v', '04 17:00 r', '05 08:00 v', '05 17:00 r', '06 08:00 v', '06 17:00 r']);
  assert.deepEqual(rows(id, '2026-11-02', '2026-11-02'), ['02[HC] 08:00→17:00 1c']);
  const truoc = full(id);
  const cung = (d) => truoc.filter((r) => r.work_date === d);
  assert.equal((await call('POST', '/attendance/punches', { employee_ids: [id], date: '2026-11-03', out: '17:00' })).status, 200);
  const sau = full(id);
  for (const d of ['2026-11-02', '2026-11-04', '2026-11-05', '2026-11-06']) assert.deepEqual(sau.filter((r) => r.work_date === d), cung(d), 'ngày ' + d + ' đổi');
  assert.deepEqual(rows(id, '2026-11-03', '2026-11-03'), ['03[HC] 08:00→17:00 1c']);   // chỉ ngày bù là có thêm giờ ra
});

test('dừng ngay khi một ngày dựng lại mà không đổi: ngày sau đó không bị dựng lại (làm hỏng thử dòng ngày 06 vẫn nằm nguyên)', async () => {
  const id = mkEmp(['02 08:00 v', '02 17:00 r', '03 08:00 v', '04 08:00 v', '04 17:00 r', '05 08:00 v', '05 17:00 r', '06 08:00 v', '06 17:00 r']);
  // đánh dấu dòng ngày 06 bằng số liệu lạ — nếu bị dựng lại thì mất dấu
  db.prepare("UPDATE attendance SET work_unit=9 WHERE employee_id=? AND work_date='2026-11-06'").run(id);
  assert.equal((await call('POST', '/attendance/punches', { employee_ids: [id], date: '2026-11-03', out: '17:00' })).status, 200);
  assert.equal(db.prepare("SELECT work_unit u FROM attendance WHERE employee_id=? AND work_date='2026-11-06'").get(id).u, 9);   // chuỗi dừng ở 05 (không đổi) nên 06 chưa bị đụng
});

test('giới hạn cứng 62 ngày: 70 đêm liền, quên chấm vào đêm đầu → bù tay sửa đúng 62 ngày kế, ngày thứ 63 trở đi để như cũ (Tính lại sẽ lo)', async () => {
  const d0 = '2026-11-02';
  const list = [];   // phải theo thứ tự giờ: ingestAttlog dựng lại sau mỗi lượt
  for (let k = 0; k < 70; k++) {
    if (k !== 1) list.push([dayShift(d0, k), '19:00', 'v']);   // đêm k=1 (03/11) quên chấm vào
    list.push([dayShift(d0, k + 1), '07:00', 'r']);
  }
  n++; const pin = String(9100 + n);
  const id = db.prepare("INSERT INTO employees(code,full_name,username,password_hash,role,device_pin) VALUES(?,?,?,'x','employee',?)").run('N' + n, 'NV ' + n, 'n' + n, pin).lastInsertRowid;
  ins('shift_assignments', { employee_id: id, mode: 'schedule', work_schedule_id: W, from_date: '2026-10-26', shift_type: 'fixed', merge_rule: 'default', inout_schedule_id: IO, active: 1 });
  for (const [d, t, k] of list) ingestAttlog(k === 'v' ? 'SN1' : 'SN2', `${pin}\t${d} ${t}:00\t${k === 'v' ? 0 : 1}\t1`, { ask: () => {} });
  const dayRows = (d) => db.prepare('SELECT shift_id s FROM attendance WHERE employee_id=? AND work_date=?').all(id, d).map((r) => codeOf[r.s]);
  const ngay03 = '2026-11-03';
  assert.deepEqual(dayRows(dayShift(ngay03, 1)), ['HC']);     // sai dây chuyền kéo dài
  assert.deepEqual(dayRows(dayShift(ngay03, 63)), ['HC']);
  assert.equal((await call('POST', '/attendance/punches', { employee_ids: [id], date: ngay03, in: '19:00' })).status, 200);
  assert.deepEqual(dayRows(ngay03), ['DM']);
  assert.deepEqual(dayRows(dayShift(ngay03, 1)), ['DM']);
  assert.deepEqual(dayRows(dayShift(ngay03, 62)), ['DM']);    // ngày thứ 62 sau ngày bù: đã sửa
  assert.deepEqual(dayRows(dayShift(ngay03, 63)), ['HC']);    // ngày thứ 63: vượt giới hạn, giữ nguyên
});

test('NV chỉ chấm ĐIỆN THOẠI: sửa giờ 1 ngày ở bảng Tính công → các ngày khác y nguyên từng cột (không dựng lại gì)', async () => {
  n++;
  const id = db.prepare("INSERT INTO employees(code,full_name,username,password_hash,role,device_pin) VALUES(?,?,?,'x','employee',?)").run('N' + n, 'NV ' + n, 'n' + n, String(9100 + n)).lastInsertRowid;
  ins('shift_assignments', { employee_id: id, mode: 'schedule', work_schedule_id: W, from_date: '2026-10-26', shift_type: 'fixed', merge_rule: 'default', inout_schedule_id: IO, active: 1 });
  const iso = (d, t) => new Date(`${d}T${t}:00+07:00`).toISOString();
  const addPhone = (d, i, o, wm, wu, ot = 0) => db.prepare(`INSERT INTO attendance(employee_id, work_date, check_in_at, check_out_at, check_in_photo, check_out_photo, work_minutes, work_unit, day_status, shift_source, ot_min, ot_raw_min, late_min, early_min)
    VALUES (?,?,?,?,'/uploads/a.jpg','/uploads/b.jpg',?,?,'lam_viec','schedule',?,?,7,3)`).run(id, d, iso(d, i), iso(dayShift(d, i > o ? 1 : 0), o), wm, wu, ot, ot);
  addPhone('2026-11-02', '19:00', '07:00', 600, 0.91, 45);
  addPhone('2026-11-03', '19:00', '07:00', 600, 0.91, 45);
  addPhone('2026-11-04', '08:00', '17:00', 480, 1);
  addPhone('2026-11-05', '07:00', '19:00', 660, 1, 120);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM device_punches WHERE employee_id=?').get(id).c, 0);
  const truoc = full(id);
  const row = db.prepare("SELECT id FROM attendance WHERE employee_id=? AND work_date='2026-11-03'").get(id);
  assert.equal((await call('PUT', '/attendance/' + row.id, { check_in: '20:00' })).status, 200);
  const sau = full(id);
  for (const d of ['2026-11-02', '2026-11-04', '2026-11-05']) assert.deepEqual(sau.filter((r) => r.work_date === d), truoc.filter((r) => r.work_date === d), 'ngày ' + d + ' bị đổi');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM device_punches WHERE employee_id=?').get(id).c, 0);   // không chép thêm lượt chấm nào
  // NV vừa quẹt máy vừa chấm điện thoại: ngày CHỈ chấm điện thoại nằm giữa các ngày quẹt máy cũng không bị dựng lại
  const idH = mkEmp(['02 08:00 v', '02 17:00 r', '06 08:00 v', '06 17:00 r']);
  db.prepare(`INSERT INTO attendance(employee_id, work_date, check_in_at, check_out_at, check_in_photo, check_out_photo, work_minutes, work_unit, day_status, shift_source, shift_id, late_min)
    VALUES (?,?,?,?,'/uploads/a.jpg','/uploads/b.jpg',500,0.97,'lam_viec','schedule',?,12)`).run(idH, '2026-11-04', iso('2026-11-04', '08:12'), iso('2026-11-04', '17:00'), S.HC);
  const t4 = full(idH, '2026-11-04', '2026-11-04'), t6 = full(idH, '2026-11-06', '2026-11-06');
  const r02 = db.prepare("SELECT id FROM attendance WHERE employee_id=? AND work_date='2026-11-02'").get(idH);
  assert.equal((await call('PUT', '/attendance/' + r02.id, { check_out: '17:30' })).status, 200);
  assert.deepEqual(full(idH, '2026-11-04', '2026-11-04'), t4);
  assert.deepEqual(full(idH, '2026-11-06', '2026-11-06'), t6);
});

test('XOÁ dòng công (DELETE /attendance/:id) KHÔNG nối tiếp: các ngày sau đứng yên (xoá không phải bù; dòng dựng từ máy sẽ hiện lại khi Tính lại)', async () => {
  const id = mkEmp(QUEN_VAO_03);
  assert.equal((await call('POST', '/attendance/punches', { employee_ids: [id], date: '2026-11-03', in: '19:00' })).status, 200);
  const sau = rows(id, '2026-11-04', '2026-11-06');
  const row = db.prepare("SELECT id FROM attendance WHERE employee_id=? AND work_date='2026-11-03'").get(id);
  assert.equal((await call('DELETE', '/attendance/' + row.id)).status, 200);
  assert.deepEqual(rows(id, '2026-11-04', '2026-11-06'), sau);
  assert.deepEqual(rows(id, '2026-11-03', '2026-11-03'), []);
});
