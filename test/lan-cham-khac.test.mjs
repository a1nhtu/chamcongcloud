// LẦN CHẤM KHÁC (Anh 20/11/2026, khách trankimxuyen): Vệ sinh quẹt 06h · 13h (chứng minh có mặt) · 16h · 21h, ca ghép Đầu–cuối
// chỉ lấy lượt đầu + cuối → lượt 13h / lượt ca gãy không nhận trước đây chỉ thấy ở tab Giờ nguồn.
//  - otherPunches gắn lượt không làm giờ Vào / Ra vào đúng dòng công (ca đêm giữ lượt sau nửa đêm) — dùng cho báo cáo dưới
//    (cột "Lần chấm khác" ở Tính công → Chi tiết đã bỏ 20/11/2026: Anh thấy rối, xem ở tab Giờ nguồn)
//  - Báo cáo "Chi tiết chấm công (nhiều lần vào/ra)": ngày ghép đầu–cuối liệt kê đủ mọi lượt vào Giờ vào 1 · Giờ ra 1 · Giờ vào 2 …
//  - Báo cáo 'rawpunch' (nút Xuất Excel ở tab Giờ nguồn): mỗi NV × ngày 1 dòng, Lần 1 · Lần 2 … y như bảng trên màn hình
// Chỉ hiển thị: công / giờ không đổi.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { moCong } from './_cong.mjs';

const dir = mkdtempSync(join(tmpdir(), 'dgp-lan-khac-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema } = await import('../server/db.js');
const { otherPunches } = await import('../server/lan-cham-khac.js');
const { registerAttendanceRoutes } = await import('../server/routes/admin/attendance.js');
const reportRoutes = (await import('../server/routes/reports.js')).default;
const { signToken } = await import('../server/auth.js');
const express = (await import('express')).default;

const iso = (d, t) => new Date(`2026-11-${d}T${t}+07:00`).toISOString();
const hm = (i) => new Date(Date.parse(i) + 7 * 3600000).toISOString().slice(11, 16);
let srv, base, tok, E, F;
const ids = {};

before(async () => {
  initSchema();
  const emp = (code, role = 'employee') => Number(db.prepare("INSERT INTO employees(code, username, password_hash, full_name, department, role, active) VALUES (?,?,'x',?,'Làm sạch',?,1)").run(code, code.toLowerCase(), 'NV ' + code, role).lastInsertRowid);
  const adm = emp('ADM', 'admin');
  tok = signToken({ id: adm, code: 'ADM', role: 'admin', full_name: 'Admin' });
  E = emp('VS1'); F = emp('VS2');
  // ca ghép ĐẦU–CUỐI như khách (không ca nào thì máy chủ tính theo cặp — ngày đó báo cáo vốn đã liệt kê từng lượt)
  const sh = Number(db.prepare("INSERT INTO shifts(name, code, start_time, end_time, merge_rule) VALUES ('Vệ sinh ca 1','VS1','06:30','16:00','filo')").run().lastInsertRowid);
  db.prepare('UPDATE employees SET shift_id=? WHERE id IN (?,?)').run(sh, E, F);
  const att = db.prepare('INSERT INTO attendance(employee_id, work_date, check_in_at, check_out_at, work_unit, work_minutes) VALUES (?,?,?,?,1,480)');
  const pu = db.prepare("INSERT INTO device_punches(serial, pin, punch_at, work_date, status, verify, employee_id) VALUES (?,?,?,?,0,1,?)");
  const punch = (eid, d, t, serial = 'MAY1') => pu.run(serial, String(eid), iso(d, t), '2026-11-' + d, eid);
  // 01/11: 05:51 · 12:57 · 16:00 · 20:56 — chỉ nhận ca 1 (05:51 → 16:00); 20:56 không quẹt đôi 16h nên ca gãy không có dòng
  ids.d01 = Number(att.run(E, '2026-11-01', iso('01', '05:51:00'), iso('01', '16:00:00')).lastInsertRowid);
  for (const t of ['05:51:00', '12:57:10', '12:57:40', '16:00:00', '20:56:00']) punch(E, '01', t);   // 12:57 quẹt 2 phát cùng phút → 1 lần
  // 02/11: 2 dòng ca 1 + ca gãy; 13:05 (giữa ca 1) + 18:00 (giữa ca gãy, thêm tay) — mỗi lượt chỉ ở đúng 1 dòng
  ids.d02a = Number(att.run(E, '2026-11-02', iso('02', '06:02:00'), iso('02', '15:58:00')).lastInsertRowid);
  ids.d02b = Number(att.run(E, '2026-11-02', iso('02', '16:01:00'), iso('02', '20:58:00')).lastInsertRowid);
  for (const t of ['06:02:30', '13:05:00', '15:58:00', '16:01:00', '20:58:00']) punch(E, '02', t);
  punch(E, '02', '18:00:00', 'TAY_VAO');
  // 04/11: thiếu ra (05:56 · ?) — 12:56 và 20:56 vẫn hiện để biết có quẹt
  ids.d04 = Number(att.run(E, '2026-11-04', iso('04', '05:56:00'), null).lastInsertRowid);
  for (const t of ['05:56:00', '12:56:00', '20:56:00']) punch(E, '04', t);
  // ca đêm 05/11 19:00 → 06/11 07:00: lượt 01:30 (ngày 06) thuộc dòng đêm 05; ngày 06 không có dòng nào khác
  ids.d05 = Number(att.run(F, '2026-11-05', iso('05', '19:00:00'), iso('06', '07:00:00')).lastInsertRowid);
  punch(F, '05', '19:00:00'); punch(F, '06', '01:30:00'); punch(F, '06', '07:00:00');
  // 07/11: chấm đúng 2 lần → không có lượt khác, báo cáo y như cũ
  ids.d07 = Number(att.run(F, '2026-11-07', iso('07', '08:00:00'), iso('07', '17:00:00')).lastInsertRowid);
  punch(F, '07', '08:00:00'); punch(F, '07', '17:00:00');

  const app = express(); app.use(express.json());
  const r = express.Router();
  r.use((q, s, n) => { q.user = { id: adm, full_name: 'QL', role: 'admin' }; n(); });
  registerAttendanceRoutes(r, { need: () => (q, s, n) => n() });
  app.use('/admin', r);
  app.use('/api/reports', reportRoutes);
  srv = await moCong(app); base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { srv?.close(); try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} });

const get = async (p) => {
  const x = await fetch(base + p, { headers: { Authorization: 'Bearer ' + tok } });
  assert.equal(x.status, 200, p);
  return (x.headers.get('content-type') || '').includes('json') ? x.json() : Buffer.from(await x.arrayBuffer());
};

test('otherPunches: gắn đúng dòng chứa lượt, không chứa thì dòng gần nhất cùng ngày; trùng phút với vào / ra thì bỏ', () => {
  const { byRow, byDay } = otherPunches([E, F], '2026-11-01', '2026-11-07');
  const of = (id) => (byRow.get(id) || []).map((p) => hm(p.at));
  assert.deepEqual(of(ids.d01), ['12:57', '20:56']);
  assert.deepEqual(of(ids.d02a), ['13:05']);   // 06:02:30 trùng phút giờ vào 06:02 → không tính
  assert.deepEqual(of(ids.d02b), ['18:00']);
  assert.deepEqual(of(ids.d04), ['12:56', '20:56']);
  assert.deepEqual(of(ids.d05), ['01:30']);
  assert.deepEqual(of(ids.d07), []);
  assert.deepEqual(byDay.get(E + '|2026-11-01').map(hm), ['05:51', '12:57', '16:00', '20:56']);
  assert.deepEqual(byDay.get(E + '|2026-11-02').map(hm), ['06:02', '13:05', '15:58', '16:01', '18:00', '20:58']);
  assert.deepEqual(byDay.get(F + '|2026-11-05').map(hm), ['19:00', '01:30', '07:00']);
  // chỉ xem 06/11: dòng đêm 05/11 nằm ngoài khoảng → không trả, lượt 01:30 / 07:00 không bị gắn nhầm vào ngày 06
  const only6 = otherPunches([F], '2026-11-06', '2026-11-06');
  assert.equal(only6.byRow.size, 0);
  assert.equal(only6.byDay.size, 0);
});

test('Tính công → Chi tiết: KHÔNG có cột Lần chấm khác (Anh bỏ 20/11/2026 vì nhìn rối — xem ở tab Giờ nguồn)', async () => {
  const g = await get(`/admin/attendance/grid?mode=detail&from=2026-11-01&to=2026-11-07&ids=${E},${F}`);
  const r = g.rows.find((x) => x.att_id === ids.d01);
  assert.deepEqual([r.in, r.out, r.cong], ['05:51', '16:00', 1]);
  assert.ok(g.rows.every((x) => !('other' in x)));
  const raw = await get(`/admin/attendance/grid?mode=raw&from=2026-11-01&to=2026-11-01&ids=${E}`);
  assert.deepEqual(raw.rows[0].times, ['05:51', '12:57', '12:57', '16:00', '20:56']);   // Giờ nguồn vẫn đủ mọi lượt
});

test('Báo cáo Chi tiết chấm công (nhiều lần vào/ra): ngày ghép đầu–cuối liệt kê đủ mọi lượt', async () => {
  const rep = await get(`/api/reports/data?type=detailmulti&from=2026-11-01&to=2026-11-07&ids=${E},${F}`);
  const row = (code, date) => rep.rows.find((r) => r.code === code && r.date === date);
  const t = (r) => [1, 2, 3, 4].flatMap((i) => [r['in' + i], r['out' + i]]).filter(Boolean);
  assert.deepEqual(t(row('VS1', '01/11/2026')), ['05:51', '12:57', '16:00', '20:56']);
  assert.deepEqual(t(row('VS1', '02/11/2026')), ['06:02', '13:05', '15:58', '16:01', '18:00', '20:58']);
  assert.deepEqual(t(row('VS1', '04/11/2026')), ['05:56', '12:56', '20:56']);
  assert.deepEqual(t(row('VS2', '05/11/2026')), ['19:00', '01:30', '07:00']);
  assert.deepEqual(t(row('VS2', '07/11/2026')), ['08:00', '17:00']);   // chấm 2 lần: y như cũ
  assert.equal(row('VS1', '01/11/2026').cong, 1);   // công không đổi
  // Bảng chi tiết từng nhân viên (in A4) — file Excel tự xếp ô cũng liệt kê đủ
  const buf = await get(`/api/reports/export.xlsx?type=empsheet&from=2026-11-01&to=2026-11-07&ids=${E}`);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
  const lines = []; wb.worksheets[0].eachRow((r) => lines.push(r.values.slice(1).map((v) => (v == null ? '' : String(v))).join('|')));
  assert.ok(lines.some((l) => l.startsWith('01/11/2026') && l.includes('|05:51|12:57|16:00|20:56|')), lines.find((l) => l.startsWith('01/11/2026')));
});

test('Giờ nguồn → Xuất Excel (rawpunch): mỗi NV × ngày 1 dòng, Lần 1 · Lần 2 … như màn hình', async () => {
  const rep = await get(`/api/reports/data?type=rawpunch&from=2026-11-01&to=2026-11-07&ids=${E}`);
  const r1 = rep.rows.find((r) => r.date === '01/11/2026');
  assert.deepEqual([r1.l1, r1.l2, r1.l3, r1.l4, r1.l5, r1.nlan], ['05:51', '12:57', '12:57', '16:00', '20:56', 5]);   // lượt thô, không bỏ trùng
  const r2 = rep.rows.find((r) => r.date === '02/11/2026');
  assert.equal(r2.l5, '18:00✎');
  assert.ok(rep.columns.some((c) => c.label === 'Lần 6'));
  const buf = await get(`/api/reports/export.xlsx?type=rawpunch&from=2026-11-01&to=2026-11-07&ids=${E}`);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
  const text = []; wb.worksheets[0].eachRow((row) => text.push(row.values.slice(1).map((v) => (v == null ? '' : String(v))).join('|')));
  assert.ok(text.some((l) => l.includes('Lần 1')), 'thiếu tiêu đề Lần 1');
  assert.ok(text.some((l) => l.includes('01/11/2026') && l.includes('12:57') && l.includes('20:56')), 'thiếu dòng 01/11');
});
