// BÁO CÁO DANH SÁCH TỪNG NGÀY (Anh 28/11/2026, khách Hualida):
//  1) có cột "Ca làm việc" (Bản ghi chấm công, Giờ vào & ra đầu/cuối, Đi muộn / về sớm, Tăng ca, Chi tiết nhiều lần vào/ra)
//  2) công tắc report_ot_hours: cột tăng ca tính theo GIỜ (mặc định) hay PHÚT (như cũ)
//  3) dòng TỔNG CỘNG cuối bảng — cột giờ cộng từ PHÚT gốc; xem trên màn hình + Excel; sheet TongHop không coi dòng tổng là 1 người
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { moCong } from './_cong.mjs';

const DBP = join(tmpdir(), `dgp-bao-cao-ca-tong-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;
let db, setSetting, server, base, tok;
const Q = '&from=2026-11-02&to=2026-11-04&mode=shift';
const get = async (path) => {
  const res = await fetch(base + path, { headers: { Authorization: 'Bearer ' + tok } });
  assert.equal(res.status, 200, path);
  return (res.headers.get('content-type') || '').includes('json') ? res.json() : Buffer.from(await res.arrayBuffer());
};
const vn = (d, hm) => new Date(`${d}T${hm}:00+07:00`).toISOString();
const totalOf = (rep) => rep.rows[rep.rows.length - 1];

before(async () => {
  let initSchema;
  ({ db, initSchema, setSetting } = await import('../server/db.js'));
  const { signToken } = await import('../server/auth.js');
  const reportRoutes = (await import('../server/routes/reports.js')).default;
  const express = (await import('express')).default;
  initSchema();
  const adm = Number(db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash) VALUES ('ADM','Admin','admin','adm','x')").run().lastInsertRowid);
  const emp = db.prepare("INSERT INTO employees(code, full_name, department, role, username, password_hash, start_date) VALUES (?,?,'May','employee',?,'x','2026-01-01')");
  const a = Number(emp.run('TB1', 'An Ca Ngày', 'tb1').lastInsertRowid);
  const b = Number(emp.run('TB2', 'Bình Ca Đêm', 'tb2').lastInsertRowid);
  const sh = db.prepare('INSERT INTO shifts(name, start_time, end_time, break_minutes) VALUES (?,?,?,60)');
  const HC = Number(sh.run('Hành chính', '07:30', '16:30').lastInsertRowid);
  const DEM = Number(sh.run('Ca đêm', '20:00', '05:00').lastInsertRowid);
  tok = signToken({ id: adm, code: 'ADM', role: 'admin', full_name: 'Admin' });
  const att = db.prepare('INSERT INTO attendance(employee_id, work_date, shift_id, check_in_at, check_out_at, work_unit, work_minutes, ot_min, late_min, early_min) VALUES (?,?,?,?,?,?,?,?,?,?)');
  // phút lẻ để thấy cộng từ PHÚT khác cộng số giờ đã làm tròn: 3 × 25 phút = 75 phút = 1,25 giờ (cộng 0,42 × 3 = 1,26 là sai)
  att.run(a, '2026-11-02', HC, vn('2026-11-02', '07:35'), vn('2026-11-02', '16:55'), 1, 480, 25, 5, 0);
  att.run(a, '2026-11-03', HC, vn('2026-11-03', '07:30'), vn('2026-11-03', '16:55'), 1, 480, 25, 0, 0);
  att.run(b, '2026-11-03', DEM, vn('2026-11-03', '20:10'), vn('2026-11-04', '05:25'), 1, 470, 25, 10, 0);
  const app = express(); app.use(express.json());
  app.use('/api/reports', reportRoutes);
  server = await moCong(app);
  base = `http://127.0.0.1:${server.address().port}/api/reports`;
});
after(() => { server?.close(); for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} } });

test('Bản ghi chấm công: có cột Ca làm việc ngay sau Bộ phận, ghi đúng tên ca từng ngày', async () => {
  const rep = await get('/data?type=attendance' + Q);
  const keys = rep.columns.map((c) => c.key);
  assert.equal(keys[keys.indexOf('dept') + 1], 'shift');
  assert.equal(rep.columns.find((c) => c.key === 'shift').label, 'Ca làm việc');
  const days = rep.rows.filter((r) => !r._total);
  assert.deepEqual(days.map((r) => r.code + ' ' + r.shift), ['TB1 Hành chính', 'TB1 Hành chính', 'TB2 Ca đêm']);
});

test('Báo cáo tương tự cũng có cột Ca làm việc', async () => {
  for (const type of ['firstlast', 'late', 'ot', 'detailmulti']) {
    const rep = await get(`/data?type=${type}${Q}`);
    assert.ok(rep.columns.some((c) => c.key === 'shift' && c.label === 'Ca làm việc'), type);
    assert.ok(rep.rows.filter((r) => !r._total).some((r) => r.shift === 'Ca đêm'), type + ': có tên ca');
  }
});

test('Mặc định: tăng ca theo GIỜ; tắt công tắc → PHÚT như cũ', async () => {
  let rep = await get('/data?type=attendance' + Q);
  assert.equal(rep.columns.find((c) => c.key === 'ot').label, 'OT (giờ)');
  assert.equal(rep.rows[0].ot, 0.42);
  let det = await get('/data?type=detail' + Q);
  assert.equal(det.columns.find((c) => c.key === 'ot').label, 'OT (giờ)');
  setSetting('report_ot_hours', '0');
  try {
    rep = await get('/data?type=attendance' + Q);
    assert.equal(rep.columns.find((c) => c.key === 'ot').label, 'OT (p)');
    assert.equal(rep.rows[0].ot, 25);
    assert.equal(totalOf(rep).ot, 75, 'tổng phút');
    det = await get('/data?type=detail' + Q);
    assert.equal(det.columns.find((c) => c.key === 'ot').label, 'OT (p)');
  } finally { setSetting('report_ot_hours', '1'); }
});

test('Dòng TỔNG CỘNG cuối bảng: cộng giờ từ phút gốc, cộng phút / công / trễ', async () => {
  const rep = await get('/data?type=attendance' + Q);
  const t = totalOf(rep);
  assert.equal(t._total, true);
  assert.equal(t.name, 'TỔNG CỘNG');
  assert.equal(t.ot, 1.25, '75 phút = 1,25 giờ (không phải 0,42 × 3 = 1,26)');
  assert.equal(t.phut, 1430);
  assert.equal(t.gio, 23.83);
  assert.equal(t.cong, 3);
  assert.equal(t.late, 15);
  assert.equal(t.shift, undefined, 'cột chữ để trống');
  for (const type of ['late', 'ot', 'firstlast', 'detail', 'detaillist', 'detailmulti']) {
    const r = await get(`/data?type=${type}${Q}`);
    assert.equal(totalOf(r)._total, true, type + ': có dòng tổng');
    assert.equal(r.rows.filter((x) => x._total).length, 1, type);
  }
  const ot = await get('/data?type=ot' + Q);
  assert.equal(totalOf(ot).oth, 1.25);
  assert.equal(totalOf(ot).otp, 75);
});

test('Không có dữ liệu → không có dòng tổng', async () => {
  const rep = await get('/data?type=attendance&from=2026-10-01&to=2026-10-02&mode=shift');
  assert.equal(rep.rows.length, 0);
});

test('Excel: dòng TỔNG CỘNG ở cuối sheet BaoCao, in đậm; sheet TongHop không có người tên "TỔNG CỘNG" thừa', async () => {
  const buf = await get('/export.xlsx?type=attendance' + Q);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('BaoCao');
  const head = ws.getRow(5).values.slice(1);
  assert.ok(head.includes('Ca làm việc') && head.includes('OT (giờ)'));
  const last = ws.getRow(ws.rowCount);
  const vals = last.values.slice(1);
  assert.equal(vals[head.indexOf('Họ tên')], 'TỔNG CỘNG');
  assert.equal(vals[head.indexOf('OT (giờ)')], 1.25);
  assert.equal(last.getCell(head.indexOf('Họ tên') + 1).font?.bold, true);
  const sum = []; wb.getWorksheet('TongHop').eachRow((r) => sum.push(r.values.slice(1).map((v) => (v == null ? '' : String(v)))));
  assert.equal(sum.filter((r) => r.includes('TỔNG CỘNG')).length, 1, 'chỉ 1 dòng TỔNG CỘNG của chính sheet TongHop');
  assert.ok(sum.some((r) => r[1] === 'TB1') && sum.some((r) => r[1] === 'TB2'));
});
