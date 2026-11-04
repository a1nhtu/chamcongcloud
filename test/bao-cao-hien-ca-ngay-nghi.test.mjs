// Ô "HIỆN CẢ NGÀY KHÔNG ĐI LÀM" ở trang Báo cáo (Anh 03/11/2026): báo cáo danh sách vốn chỉ có ngày đi làm; tích ô (?alldays=1)
// → mọi NV × mọi ngày trong kỳ, ngày không chấm có dòng để trống (_off). Không tích = y như cũ. Chạy: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import ExcelJS from 'exceljs';

const DBP = join(tmpdir(), `dgp-bao-cao-ca-ngay-nghi-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;
let db, server, base, tok;
const Q = '&from=2026-09-01&to=2026-09-07&mode=hourly';
const get = async (path) => {
  const res = await fetch(base + path, { headers: { Authorization: 'Bearer ' + tok } });
  assert.equal(res.status, 200, path);
  return (res.headers.get('content-type') || '').includes('json') ? res.json() : Buffer.from(await res.arrayBuffer());
};
const vn = (d, hm) => new Date(`${d}T${hm}:00+07:00`).toISOString();
const dates = (rows, code) => rows.filter((r) => r.code === code).map((r) => r.date.slice(0, 2));

before(async () => {
  let initSchema, setSetting;
  ({ db, initSchema, setSetting } = await import('../server/db.js'));
  const { signToken } = await import('../server/auth.js');
  const reportRoutes = (await import('../server/routes/reports.js')).default;
  const express = (await import('express')).default;
  initSchema();
  setSetting('attendance_mode', 'hourly');
  const adm = Number(db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash) VALUES ('ADM','Admin','admin','adm','x')").run().lastInsertRowid);
  const emp = db.prepare("INSERT INTO employees(code, full_name, department, role, username, password_hash, att_mode, start_date, leave_date, active) VALUES (?,?,'Xưởng','employee',?,'x','hourly',?,?,?)");
  const h1 = Number(emp.run('H1', 'An Đi Làm', 'h1', '2026-01-01', '', 1).lastInsertRowid);
  emp.run('H2', 'Bình Mới Vào', 'h2', '2026-09-05', '', 1);       // vào làm 05/09, chưa chấm ngày nào
  emp.run('H3', 'Cường Nghỉ Việc', 'h3', '2026-01-01', '2026-09-03', 0);   // nghỉ việc 03/09
  tok = signToken({ id: adm, code: 'ADM', role: 'admin', full_name: 'Admin' });
  const att = db.prepare('INSERT INTO attendance(employee_id, work_date, check_in_at, check_out_at, work_unit, work_minutes) VALUES (?,?,?,?,?,?)');
  att.run(h1, '2026-09-02', vn('2026-09-02', '08:00'), vn('2026-09-02', '17:00'), 1, 480);
  att.run(h1, '2026-09-04', vn('2026-09-04', '08:00'), vn('2026-09-04', '12:00'), 0.5, 240);
  const app = express(); app.use(express.json());
  app.use('/api/reports', reportRoutes);
  await new Promise((res) => { server = app.listen(0, '127.0.0.1', res); });
  base = `http://127.0.0.1:${server.address().port}/api/reports`;
});
after(() => { server?.close(); for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} } });

const LIST = ['attendance', 'firstlast', 'detail', 'detaillist', 'detailmulti', 'empsheet'];

test('không tích: báo cáo danh sách chỉ có ngày đi làm (như cũ)', async () => {
  for (const type of LIST) {
    const rep = await get(`/data?type=${type}${Q}`);
    assert.deepEqual(rep.rows.map((r) => r.code), ['H1', 'H1'], type);
    assert.deepEqual(dates(rep.rows, 'H1'), ['02', '04'], type);
    assert.ok(!rep.rows.some((r) => r._off), type);
  }
});

test('tích: đủ mọi ngày trong kỳ, ngày không chấm để trống; bỏ ngày trước khi vào làm / sau khi nghỉ việc', async () => {
  for (const type of LIST) {
    const rep = await get(`/data?type=${type}${Q}&alldays=1`);
    assert.deepEqual(dates(rep.rows, 'H1'), ['01', '02', '03', '04', '05', '06', '07'], type);
    assert.deepEqual(dates(rep.rows, 'H2'), ['05', '06', '07'], type + ': NV mới vào 05/09');
    assert.deepEqual(dates(rep.rows, 'H3'), ['01', '02', '03'], type + ': NV nghỉ việc 03/09');
    const off = rep.rows.filter((r) => r.code === 'H1' && r._off).map((r) => r.date.slice(0, 2));
    assert.deepEqual(off, ['01', '03', '05', '06', '07'], type);
    for (const r of rep.rows.filter((x) => x._off)) {
      const filled = rep.columns.filter((c) => !['stt', 'date', 'wd', 'code', 'name', 'dept'].includes(c.key) && r[c.key] != null && r[c.key] !== '');
      assert.deepEqual(filled.map((c) => c.key), [], `${type} ${r.date}: dòng ngày không đi làm phải trống`);
    }
    const on = rep.rows.find((r) => r.code === 'H1' && r.date === '02/09/2026');
    assert.ok(!on._off && JSON.stringify(on).includes('08:00'), type + ': ngày đi làm giữ nguyên giờ');
    if (rep.columns.some((c) => c.key === 'stt')) assert.deepEqual(rep.rows.map((r) => r.stt), rep.rows.map((_, i) => i + 1), type + ': STT liền mạch');
  }
});

test('Excel: dòng trống có trong sheet BaoCao, sheet TongHop không đếm ngày không đi làm', async () => {
  const buf = await get(`/export.xlsx?type=attendance${Q}&alldays=1`);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
  const rows = []; wb.getWorksheet('BaoCao').eachRow((r) => rows.push(r.values.slice(1).map((v) => (v == null ? '' : String(v)))));
  const head = rows.find((r) => r.includes('Mã NV'));
  assert.deepEqual(head.slice(0, 3), ['Ngày', 'Thứ', 'Mã NV'], 'Excel có cột Thứ ngay sau Ngày');
  const ci = head.indexOf('Mã NV');
  assert.equal(rows.filter((r) => r[ci] === 'H1').length, 7);
  const sum = []; wb.getWorksheet('TongHop').eachRow((r) => sum.push(r.values.slice(1).map((v) => (v == null ? '' : String(v)))));
  const h1 = sum.find((r) => r[1] === 'H1');
  assert.equal(h1[4], '2', 'Số ngày có chấm = 2, không phải 7');
  assert.equal(h1[7], '720', 'Tổng phút');
});

// Anh 04/11/2026: khách báo các báo cáo liệt kê theo ngày không có thứ → cột Thứ ngay sau Ngày
test('báo cáo liệt kê theo ngày có cột Thứ ngay sau Ngày', async () => {
  for (const type of ['attendance', 'firstlast', 'late', 'ot']) {
    const rep = await get(`/data?type=${type}${Q}&alldays=1`);
    assert.deepEqual(rep.columns.slice(0, 2).map((c) => [c.key, c.label]), [['date', 'Ngày'], ['wd', 'Thứ']], type);
    for (const r of rep.rows) assert.ok(r.wd, `${type} ${r.date}: thiếu thứ`);
    const on = rep.rows.find((r) => r.date === '02/09/2026');
    if (on) assert.equal(on.wd, 'T4', type + ': 02/09/2026 là thứ Tư');
  }
});

// Anh 04/11/2026: mọi báo cáo bôi màu thứ 7 + chủ nhật (xem trước trên phần mềm + Excel) — kể cả khi Cài đặt chỉ khai CN nghỉ
test('Excel: dòng thứ 7 / chủ nhật tô cam cả dòng, chữ Thứ đậm; ngày thường không tô', async () => {
  for (const type of ['attendance', 'firstlast', 'detail']) {
    const buf = await get(`/export.xlsx?type=${type}${Q}&alldays=1`);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
    const ws = wb.getWorksheet('BaoCao');
    let head = 0; ws.eachRow((r, i) => { if (!head && r.values.includes('Thứ')) head = i; });
    const cols = ws.getRow(head).values.slice(1);
    const wdCol = cols.indexOf('Thứ') + 1, dCol = cols.indexOf('Ngày') + 1;
    const seen = new Set();
    ws.eachRow((r, i) => {
      if (i <= head) return;
      const wd = String(r.getCell(wdCol).value || ''), d = String(r.getCell(dCol).value || '');
      const fills = cols.map((_, k) => r.getCell(k + 1).fill?.fgColor?.argb || '');
      if (wd === 'T7' || wd === 'CN') {
        seen.add(wd);
        assert.ok(fills.every((f) => f === 'FFFFE8CC'), `${type} ${d} ${wd}: cả dòng tô cam`);
        assert.equal(r.getCell(wdCol).font?.bold, true, `${type} ${d}: chữ Thứ đậm`);
      } else assert.ok(!fills.includes('FFFFE8CC'), `${type} ${d} ${wd}: ngày thường không tô cam`);
    });
    assert.deepEqual([...seen].sort(), ['CN', 'T7'], type + ': kỳ 01–07/09/2026 có cả T7 (05) và CN (06)');
  }
});

test('báo cáo ma trận (mỗi ngày 1 cột): cột thứ 7 + chủ nhật được đánh dấu tô màu dù Cài đặt chỉ khai CN', async () => {
  const rep = await get(`/data?type=horizontal${Q}`);
  const wk = rep.columns.filter((c) => c.weekend).map((c) => c.key);
  assert.deepEqual(wk, ['d2026-09-05', 'd2026-09-06']);
});
