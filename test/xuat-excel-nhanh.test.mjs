// XUẤT EXCEL NHANH (Anh 05/11/2026: xuất Excel chậm hơn xem báo cáo nhiều): báo cáo dạng bảng ghi bằng bộ ghi luồng + dùng chung style,
// xuất ngay sau khi xem thì dùng lại bảng vừa dựng; có thao tác ghi thì dựng lại, không bao giờ xuất số cũ. Chạy: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

const DBP = join(tmpdir(), `dgp-xuat-excel-nhanh-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;
let db, server, root, tok, h1, reportSticky;
const Q = '&from=2026-09-04&to=2026-09-07';
const call = (path, opt) => fetch(root + path, { headers: { Authorization: 'Bearer ' + tok }, ...opt });
const data = async (qs) => (await call('/api/reports/data?' + qs)).json();
const book = async (qs) => {
  const res = await call('/api/reports/export.xlsx?' + qs);
  assert.equal(res.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  return wb;
};
const vn = (d, hm) => new Date(`${d}T${hm}:00+07:00`).toISOString();
const argb = (c) => c.fill?.fgColor?.argb;
const rowOf = (ws, date) => { let hit = null; ws.eachRow((r) => { if (r.getCell(1).value === date) hit = r; }); return hit; };

before(async () => {
  let initSchema, setSetting, markWrites;
  ({ db, initSchema, setSetting } = await import('../server/db.js'));
  ({ markWrites, reportSticky } = await import('../server/heavy.js'));
  const { signToken } = await import('../server/auth.js');
  const reportRoutes = (await import('../server/routes/reports.js')).default;
  const express = (await import('express')).default;
  initSchema();
  setSetting('attendance_mode', 'hourly');
  setSetting('hourly_merge_rule', 'pairs');
  const adm = Number(db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash) VALUES ('ADM','Admin','admin','adm','x')").run().lastInsertRowid);
  h1 = Number(db.prepare("INSERT INTO employees(code, full_name, department, role, username, password_hash, att_mode, start_date) VALUES ('H1','An Đi Làm','Xưởng','employee','h1','x','hourly','2026-01-01')").run().lastInsertRowid);
  tok = signToken({ id: adm, code: 'ADM', role: 'admin', full_name: 'Admin' });
  const att = db.prepare('INSERT INTO attendance(employee_id, work_date, check_in_at, check_out_at, work_unit, work_minutes) VALUES (?,?,?,?,?,?)');
  att.run(h1, '2026-09-04', vn('2026-09-04', '08:00'), vn('2026-09-04', '17:00'), 1, 480);   // thứ 6
  att.run(h1, '2026-09-05', vn('2026-09-05', '08:00'), vn('2026-09-05', '12:00'), 0.5, 240);  // thứ 7
  att.run(h1, '2026-09-06', vn('2026-09-06', '08:00'), vn('2026-09-06', '10:00'), 0.25, 120); // chủ nhật
  const app = express();
  app.use(markWrites);
  app.post('/ghi', (req, res) => res.json({ ok: 1 }));   // đại diện cho 1 thao tác ghi bất kỳ
  app.use('/api/reports', reportRoutes);
  await new Promise((res) => { server = app.listen(0, '127.0.0.1', res); });
  root = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.close(); for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} } });

test('file ghi bằng bộ ghi luồng: tiêu đề, độ rộng, đóng băng, cột Thứ, tô T7 nhạt hơn CN, dòng ngày nghỉ, sheet TongHop', async () => {
  const wb = await book(`type=attendance${Q}&mode=hourly&alldays=1`);
  const ws = wb.getWorksheet('BaoCao');
  assert.match(String(ws.getCell(1, 1).value), /^Công ty: /);
  assert.equal(ws.getCell(1, 1).font.bold, true);
  assert.match(String(ws.getCell(3, 1).value), /^BÁO CÁO CHẤM CÔNG/);
  assert.equal(ws.getCell(3, 1).font.size, 14);
  assert.ok(ws.model.merges.includes('A1:' + ws.getColumn(ws.columnCount).letter + '1'));
  const head = ws.getRow(5).values.slice(1);
  assert.deepEqual(head.slice(0, 2), ['Ngày', 'Thứ']);
  assert.equal(ws.getColumn(1).width, 12);
  assert.equal(argb(ws.getCell(5, 1)), 'FF1E3A5F');
  assert.deepEqual(ws.views.map((v) => [v.state, v.xSplit, v.ySplit]), [['frozen', 2, 5]]);
  const t7 = rowOf(ws, '05/09/2026'), cn = rowOf(ws, '06/09/2026'), t6 = rowOf(ws, '04/09/2026'), t2 = rowOf(ws, '07/09/2026');
  assert.equal(t7.getCell(2).value, 'T7');
  assert.equal(cn.getCell(2).value, 'CN');
  assert.equal(argb(t7.getCell(4)), 'FFFFF3E3', 'T7 tô nhạt');
  assert.equal(argb(cn.getCell(4)), 'FFFFDDB3', 'CN tô đậm hơn');
  assert.equal(t7.getCell(2).font.bold, true);
  assert.equal(argb(t6.getCell(4)), undefined, 'ngày thường không tô');
  assert.equal(argb(t2.getCell(4)), 'FFF1F5F9', 'ngày không đi làm tô xám');
  assert.equal(t6.getCell(1).border.top.style, 'thin');
  assert.equal(t6.getCell(4).alignment.horizontal, 'center');
  const sum = wb.getWorksheet('TongHop');
  assert.deepEqual(sum.views.map((v) => [v.state, v.xSplit, v.ySplit]), [['frozen', 3, 5]]);
  assert.equal(sum.getColumn(3).width, 24);
  assert.equal(sum.getCell(6, 2).value, 'H1');
  assert.equal(sum.getCell(6, 8).value, 840, 'tổng phút cộng từ các ngày');
});

test('nhiều lần vào/ra: mỗi lần chấm 1 cột; nội dung file khớp bảng xem trước', async () => {
  const pp = db.prepare("INSERT INTO device_punches(serial, pin, punch_at, work_date, employee_id) VALUES ('S1','1',?,?,?)");
  for (const hm of ['08:00', '10:00', '13:00', '17:00']) pp.run(vn('2026-09-04', hm), '2026-09-04', h1);
  const qs = `type=attendance${Q}&mode=hourly`;
  const rep = await data(qs);
  const ws = (await book(qs)).getWorksheet('BaoCao');
  assert.deepEqual(ws.getRow(5).values.slice(1), rep.columns.map((c) => c.label));
  assert.ok(rep.columns.some((c) => c.key === 'inReal_2'), 'tách cột theo lần chấm');
  rep.rows.forEach((row, i) => assert.deepEqual(ws.getRow(6 + i).values.slice(1).map((v) => v ?? ''), rep.columns.map((c) => row[c.key] ?? '')));
});

test('báo cáo tự xếp ô (bảng từng NV) vẫn đúng màu T7 / CN sau khi dồn style', async () => {
  const ws = (await book(`type=empsheet${Q}&mode=shift`)).worksheets[0];
  const color = {};
  ws.eachRow((r) => r.eachCell((c) => { if (typeof c.value === 'string' && /^\d\d\/\d\d/.test(c.value)) color[c.value.slice(0, 5)] = argb(c); }));
  assert.equal(color['05/09'], 'FFD5F5FB');
  assert.equal(color['06/09'], 'FF9BE7F5');
  assert.equal(color['04/09'], undefined);
});

test('báo cáo tự xếp ô ghi bằng bộ ghi luồng: giữ đóng băng, độ rộng, gộp ô, ngắt trang, thiết lập in và tô T7 / CN', async () => {
  const h2 = Number(db.prepare("INSERT INTO employees(code, full_name, department, role, username, password_hash, att_mode, start_date) VALUES ('H2','Bình Đi Làm','Xưởng','employee','h2','x','hourly','2026-01-01')").run().lastInsertRowid);
  db.prepare('INSERT INTO attendance(employee_id, work_date, check_in_at, check_out_at, work_unit, work_minutes) VALUES (?,?,?,?,?,?)')
    .run(h2, '2026-09-05', vn('2026-09-05', '08:00'), vn('2026-09-05', '12:00'), 0.5, 240);
  const ids = `&ids=${h1},${h2}`;
  try {
    const ws = async (type) => (await book(`type=${type}${Q}&mode=shift${ids}`)).worksheets[0];
    const pane = (s) => s.views.map((v) => [v.state, v.xSplit, v.ySplit]);

    const hours = await ws('workhours');
    assert.equal(hours.name, 'GioCong');
    assert.deepEqual(pane(hours), [['frozen', 5, 6]]);
    assert.deepEqual([1, 2, 3, 4, 5, 6].map((c) => hours.getColumn(c).width), [5, 14, 12, 20, 12, 7]);
    assert.ok(hours.model.merges.includes('A7:A9') && hours.model.merges.includes('A10:A12'), 'mỗi NV 3 dòng, gộp ô STT');
    assert.equal(hours.getCell(7, 4).value, 'An Đi Làm');
    assert.equal(hours.getCell(10, 4).value, 'Bình Đi Làm');
    const dayCol = (n) => { let col = 0; hours.getRow(5).eachCell((c, i) => { if (parseInt(c.value, 10) === n) col = i; }); return col; };
    assert.equal(argb(hours.getCell(10, dayCol(5))), 'FFFFF0F6', 'T7 hồng nhạt');
    assert.equal(argb(hours.getCell(10, dayCol(6))), 'FFFFE0EC', 'CN hồng đậm');
    assert.equal(argb(hours.getCell(10, dayCol(4))), undefined, 'ngày thường không tô');

    const track = await ws('track6');
    assert.deepEqual(pane(track), [['frozen', 3, 6]]);
    assert.equal(track.getColumn(3).width, 20);
    assert.equal(track.getRow(5).height, 30);
    assert.equal(track.getCell(7, 3).value, 'An Đi Làm');

    const daytime = await ws('daytime');
    assert.deepEqual(pane(daytime), [['frozen', 5, 6]]);
    assert.equal(daytime.getCell(8, 4).value, 'Bình Đi Làm');
    assert.equal(daytime.getColumn(14).width, 7);

    const stat = await ws('hourstat');
    assert.deepEqual(pane(stat), [['frozen', 4, 6]]);
    assert.equal(stat.pageSetup.orientation, 'landscape');
    assert.equal(stat.pageSetup.fitToPage, true);

    const sheet = await ws('empsheet');
    assert.equal(sheet.name, 'ChiTietTungNV');
    assert.equal(sheet.pageSetup.orientation, 'portrait');
    assert.equal(sheet.pageSetup.fitToWidth, 1);
    assert.equal(sheet.getColumn(1).width, 11);
    const titles = [];
    sheet.eachRow((r, n) => { if (r.getCell(1).value === 'BẢNG CHI TIẾT CHẤM CÔNG') titles.push(n); });
    assert.equal(titles.length, 2);
    const raw = await JSZip.loadAsync(await (await call(`/api/reports/export.xlsx?type=empsheet${Q}&mode=shift${ids}`)).arrayBuffer());
    const brk = [...(await raw.file('xl/worksheets/sheet1.xml').async('string')).matchAll(/<brk id="(\d+)"/g)].map((m) => +m[1]);   // ExcelJS đọc file không nạp ngắt trang
    assert.deepEqual(brk, [titles[1] - 1], 'mỗi NV 1 trang: ngắt ngay trước NV thứ hai');
    assert.ok(sheet.model.merges.includes(`A${titles[1]}:${sheet.getColumn(sheet.columnCount).letter}${titles[1]}`));
  } finally {
    db.prepare('DELETE FROM attendance WHERE employee_id = ?').run(h2);
    db.prepare('DELETE FROM employees WHERE id = ?').run(h2);
  }
});

test('báo cáo tự xếp ô không có dữ liệu vẫn ra file mở được', async () => {
  for (const [type, text] of [['workhours', 'Không có dữ liệu.'], ['track6', 'Không có dữ liệu.'], ['daytime', 'Không có dữ liệu.'], ['hourstat', 'Không có dữ liệu.'],
    ['empsheet', 'Không có dữ liệu.'], ['empsheetlate', 'Không có nhân viên nào đi muộn / về sớm trong kỳ.']]) {
    const ws = (await book(`type=${type}${Q}&mode=shift&ids=99999`)).worksheets[0];
    const seen = [];
    ws.eachRow((r) => r.eachCell((c) => seen.push(c.value)));
    assert.ok(seen.includes(text), type);
  }
});

test('mẫu riêng đã xoá (không có cột nào) vẫn xuất được file', async () => {
  const ws = (await book(`type=cr999${Q}`)).getWorksheet('BaoCao');
  assert.match(String(ws.getCell(3, 1).value), /KHÔNG CÒN/);
});

test('xuất ngay sau khi xem: dùng lại bảng vừa dựng, không đọc lại CSDL', async () => {
  const qs = `type=attendance${Q}&mode=hourly&ids=${h1}`;
  await data(qs);
  db.prepare("UPDATE attendance SET work_minutes = 111 WHERE employee_id = ? AND work_date = '2026-09-05'").run(h1);   // ghi lén, không qua máy chủ
  const old = rowOf((await book(qs + '&pt=abcdef12')).getWorksheet('BaoCao'), '05/09/2026');
  assert.ok(old.values.includes(240), 'cùng báo cáo + cùng bộ lọc → số của bảng xem trước (mã thanh tiến trình không tính)');
  assert.ok(rowOf((await book(qs + '&alldays=1')).getWorksheet('BaoCao'), '05/09/2026').values.includes(111), 'khác bộ lọc → dựng mới');
  db.prepare("UPDATE attendance SET work_minutes = 240 WHERE employee_id = ? AND work_date = '2026-09-05'").run(h1);
});

test('có thao tác ghi sau khi xem: Excel dựng lại, không xuất số cũ', async () => {
  const qs = `type=attendance${Q}&mode=hourly&ids=${h1}`;
  await data(qs);
  db.prepare("UPDATE attendance SET work_minutes = 222 WHERE employee_id = ? AND work_date = '2026-09-05'").run(h1);
  assert.equal((await call('/ghi', { method: 'POST' })).status, 200);
  assert.ok(rowOf((await book(qs)).getWorksheet('BaoCao'), '05/09/2026').values.includes(222));
  db.prepare("UPDATE attendance SET work_minutes = 240 WHERE employee_id = ? AND work_date = '2026-09-05'").run(h1);
});

test('xem trước và Excel cùng báo cáo về cùng 1 luồng phụ; khác báo cáo là khoá khác', () => {
  const req = (path, query) => ({ path, query });
  const a = reportSticky(req('/data', { type: 'attendance', from: '2026-09-01', to: '2026-09-30', mode: 'shift' }));
  const b = reportSticky(req('/export.xlsx', { mode: 'shift', pt: 'abcdef12', to: '2026-09-30', from: '2026-09-01', type: 'attendance' }));
  assert.equal(a, b);
  assert.notEqual(a, reportSticky(req('/data', { type: 'late', from: '2026-09-01', to: '2026-09-30', mode: 'shift' })));
  assert.equal(reportSticky(req('/attendance', {})), null, 'trang Tổng quan vẫn xoay vòng');
});
