// Test CỘT / DÒNG TỔNG của 2 báo cáo (Anh 11/11/2026):
//   · "Giờ công & tăng ca" (workhours) — Excel thêm cột cuối: Tổng giờ công, Tổng ngày công, Tổng giờ tăng ca, Tổng phút trễ, Tổng phút sớm
//     (theo giờ: chỉ Tổng giờ làm); bảng xem trước thêm Tổng ngày công / phút trễ / phút sớm
//   · "Bảng thống kê chấm công (giờ)" (hourstat) — dòng TỔNG CỘNG cuối bảng + sheet 2 "ChiTiet" (vào/ra, giờ làm, tăng ca từng ngày)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { moCong } from './_cong.mjs';   // cổng ngẫu nhiên an toàn (tránh cổng fetch cấm / cổng test khác đang dò)

const DBP = join(tmpdir(), `dgp-bao-cao-tong-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;
let db, server, base, tok;
const Q = '&from=2026-09-01&to=2026-09-30';
const get = async (path) => {
  const res = await fetch(base + path, { headers: { Authorization: 'Bearer ' + tok } });
  assert.equal(res.status, 200, path);
  return (res.headers.get('content-type') || '').includes('json') ? res.json() : Buffer.from(await res.arrayBuffer());
};
const book = async (path) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await get(path)); return wb; };
const text = (ws) => { const out = []; ws.eachRow((r) => out.push(r.values.slice(1).map((v) => (v == null ? '' : String(v))))); return out; };
const vn = (d, hm) => new Date(`${d}T${hm}:00+07:00`).toISOString();

before(async () => {
  let initSchema, setSetting;
  ({ db, initSchema, setSetting } = await import('../server/db.js'));
  const { signToken } = await import('../server/auth.js');
  const reportRoutes = (await import('../server/routes/reports.js')).default;
  const express = (await import('express')).default;
  initSchema();
  setSetting('attendance_mode', 'shift');
  const adm = Number(db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash) VALUES ('ADM','Admin','admin','adm','x')").run().lastInsertRowid);
  const a = Number(db.prepare("INSERT INTO employees(code, full_name, department, role, username, password_hash, start_date) VALUES ('A1','An','Xưởng','employee','a1','x','2026-01-01')").run().lastInsertRowid);
  const b = Number(db.prepare("INSERT INTO employees(code, full_name, department, role, username, password_hash, start_date) VALUES ('B1','Bình','Xưởng','employee','b1','x','2026-01-01')").run().lastInsertRowid);
  tok = signToken({ id: adm, code: 'ADM', role: 'admin', full_name: 'Admin' });
  const att = db.prepare('INSERT INTO attendance(employee_id, work_date, check_in_at, check_out_at, work_unit, work_minutes, late_min, early_min, ot_min) VALUES (?,?,?,?,?,?,?,?,?)');
  // An: 2 ngày — 8h + 1h TC trễ 10' ; 4h20' sớm 30'
  att.run(a, '2026-09-02', vn('2026-09-02', '08:10'), vn('2026-09-02', '18:00'), 1, 480, 10, 0, 60);
  att.run(a, '2026-09-03', vn('2026-09-03', '08:00'), vn('2026-09-03', '12:20'), 0.5, 260, 0, 30, 0);
  // Bình: 1 ngày 8h + 2h TC
  att.run(b, '2026-09-02', vn('2026-09-02', '08:00'), vn('2026-09-02', '19:00'), 1, 480, 0, 0, 120);
  const app = express(); app.use(express.json());
  app.use('/api/reports', reportRoutes);
  server = await moCong(app);
  base = `http://127.0.0.1:${server.address().port}/api/reports`;
});
after(() => { server?.close(); for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} } });

test('Giờ công & tăng ca (Excel): 5 cột tổng cuối bảng, mỗi NV gộp dọc 3 dòng', async () => {
  const ws = (await book(`/export.xlsx?type=workhours${Q}&mode=shift`)).worksheets[0];
  const rows = text(ws);
  const head = rows[4];
  assert.deepEqual(head.slice(-5), ['TỔNG GIỜ CÔNG', 'TỔNG NGÀY CÔNG', 'TỔNG GIỜ TĂNG CA', 'TỔNG PHÚT TRỄ', 'TỔNG PHÚT SỚM']);
  const n = ws.columnCount;
  const an = ws.getRow(7);
  assert.equal(an.getCell(4).value, 'An');
  assert.deepEqual([n - 4, n - 3, n - 2, n - 1, n].map((c) => an.getCell(c).value), [12.33, 1.5, 1, 10, 30]);
  assert.ok(ws.model.merges.some((m) => m.startsWith(ws.getColumn(n - 4).letter + '7:')), 'gộp dọc cột tổng');
  const binh = ws.getRow(10);
  assert.deepEqual([n - 4, n - 3, n - 2, n - 1, n].map((c) => binh.getCell(c).value), [8, 1, 2, 0, 0]);
});

test('Giờ công & tăng ca (xem trước): thêm Tổng ngày công / phút trễ / phút sớm ở dòng đầu NV', async () => {
  const rep = await get(`/data?type=workhours${Q}&mode=shift`);
  const keys = rep.columns.map((c) => c.key);
  assert.deepEqual(keys.slice(-4), ['total', 'cong', 'lateM', 'earlyM']);
  assert.deepEqual([rep.rows[0].cong, rep.rows[0].lateM, rep.rows[0].earlyM], [1.5, 10, 30]);
  assert.equal(rep.rows[1].total, 12.33);
  assert.equal(rep.rows[2].total, 1);
});

test('Giờ công (theo giờ): chỉ 1 cột Tổng giờ làm, không tăng ca / trễ / sớm', async () => {
  const rows = text((await book(`/export.xlsx?type=workhours${Q}&mode=hourly`)).worksheets[0]);
  assert.equal(rows[4].at(-1), 'TỔNG GIỜ LÀM');
  assert.ok(!rows.flat().some((v) => /tăng ca|trễ|sớm/i.test(v)));
});

test('Bảng thống kê chấm công (giờ): dòng TỔNG CỘNG cộng từ phút', async () => {
  const rep = await get(`/data?type=hourstat${Q}&mode=shift`);
  const tot = rep.rows.at(-1);
  assert.equal(tot._total, true);
  assert.equal(tot.name, 'TỔNG CỘNG');
  assert.equal(tot.gio, 20.33);                  // 480 + 260 + 480 phút
  assert.equal(tot['d2026-09-02'], 16);
  assert.equal(tot['d2026-09-03'], 4.33);
  assert.equal(tot.lateN, 1);
  assert.equal(tot.earlyN, 1);
  const ws = (await book(`/export.xlsx?type=hourstat${Q}&mode=shift`)).getWorksheet('ThongKeGio');
  const last = text(ws).at(-1);
  assert.ok(last.includes('TỔNG CỘNG') && last.includes('20.33'), JSON.stringify(last));
});

test('Bảng thống kê chấm công (giờ): sheet 2 ChiTiet — vào/ra, giờ làm, tăng ca, Cộng từng NV + TỔNG CỘNG', async () => {
  const wb = await book(`/export.xlsx?type=hourstat${Q}&mode=shift`);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['ThongKeGio', 'ChiTiet']);
  const rows = text(wb.getWorksheet('ChiTiet'));
  assert.deepEqual(rows[4], ['STT', 'Mã NV', 'Tên nhân viên', 'Phòng ban', 'Ngày', 'Thứ', 'Vào 1', 'Ra 1', 'Giờ làm', 'Tăng ca (giờ)', 'Tổng giờ (làm + TC)', 'Ghi chú']);
  assert.deepEqual(rows[5].slice(0, 11), ['1', 'A1', 'An', 'Xưởng', '02/09/2026', 'T.4', '08:10', '18:00', '8', '1', '9']);
  const subAn = rows.find((r) => r[2] === 'Cộng: An');
  assert.deepEqual(subAn.slice(8, 11), ['12.33', '1', '13.33']);
  assert.deepEqual(rows.at(-1).slice(8, 11), ['20.33', '3', '23.33']);
  assert.equal(rows.at(-1)[2], 'TỔNG CỘNG');
});

test('Bảng thống kê (theo giờ): sheet ChiTiet không có cột tăng ca', async () => {
  const rows = text((await book(`/export.xlsx?type=hourstat${Q}&mode=hourly`)).getWorksheet('ChiTiet'));
  assert.ok(!rows[4].some((v) => /tăng ca/i.test(v)));
  assert.equal(rows.at(-1)[2], 'TỔNG CỘNG');
});
