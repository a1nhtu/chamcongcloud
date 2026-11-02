// Test MẪU BÁO CÁO RIÊNG của công ty (server/custom-reports.js + /api/reports type=crN + /api/admin/custom-reports):
//   · mẫu chỉ là cách trình bày trên báo cáo gốc: chọn / đổi tên / đổi thứ tự cột, cột ngày, cột vào–ra tách theo lần chấm, cột công thức
//   · cột gốc không còn → bỏ qua, không lỗi; công thức lỗi → ô trống
//   · chưa có mẫu → báo cáo cũ y như cũ; tạo mẫu không làm đổi báo cáo gốc
//   · chỉ tài khoản tổng thêm / sửa / xoá
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import ExcelJS from 'exceljs';

const DBP = join(tmpdir(), `dgp-mau-bao-cao-rieng-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;
let CRM, server, base, tokAdmin, tokMaster;
const Q = '&from=2026-09-01&to=2026-09-30';
const req = async (method, path, tok, body) => {
  const res = await fetch(base + path, { method, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, body: ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
};
const vn = (d, hm) => new Date(`${d}T${hm}:00+07:00`).toISOString();

before(async () => {
  const { db, initSchema, getSetting } = await import('../server/db.js');
  const { signToken } = await import('../server/auth.js');
  const jwt = (await import('jsonwebtoken')).default;
  CRM = await import('../server/custom-reports.js');
  const express = (await import('express')).default;
  initSchema();
  const adm = Number(db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash) VALUES ('ADM','Admin','admin','adm','x')").run().lastInsertRowid);
  const e1 = Number(db.prepare("INSERT INTO employees(code, full_name, department, role, username, password_hash, start_date) VALUES ('A1','Nguyễn Văn A','Xưởng','employee','a1','x','2026-01-01')").run().lastInsertRowid);
  const att = db.prepare('INSERT INTO attendance(employee_id, work_date, check_in_at, check_out_at, work_unit, work_minutes, late_min, early_min, ot_min) VALUES (?,?,?,?,?,?,?,?,?)');
  att.run(e1, '2026-09-02', vn('2026-09-02', '08:00'), vn('2026-09-02', '17:00'), 1, 480, 0, 0, 60);
  att.run(e1, '2026-09-03', vn('2026-09-03', '08:10'), vn('2026-09-03', '17:00'), 1, 470, 10, 0, 0);
  tokAdmin = signToken({ id: adm, code: 'ADM', role: 'admin', full_name: 'Admin' });
  tokMaster = jwt.sign({ master: true, role: 'master', name: 'test' }, getSetting('jwt_secret'));
  const app = express(); app.use(express.json({ limit: '2mb' }));
  app.use('/api/reports', (await import('../server/routes/reports.js')).default);
  app.use('/api/admin', (await import('../server/routes/admin.js')).default);
  await new Promise((res) => { server = app.listen(0, '127.0.0.1', res); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server?.close(); for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} } });

// Báo cáo gốc giả (có cột ngày + cột vào/ra tách theo lần chấm) cho phần thuần
const REP = {
  title: 'Gốc',
  columns: [{ key: 'code', label: 'Mã NV' }, { key: 'name', label: 'Họ tên' }, { key: 'd2026-09-01', label: '01' }, { key: 'd2026-09-02', label: '02' },
    { key: 'cin_1', label: 'Giờ vào 1' }, { key: 'cout_1', label: 'Giờ ra 1' }, { key: 'cin_2', label: 'Giờ vào 2' }, { key: 'cong', label: 'Công' }, { key: 'ot', label: 'Tăng ca' }],
  rows: [{ code: 'A1', name: 'A', 'd2026-09-01': 1, 'd2026-09-02': '', cin_1: '08:00', cout_1: '12:00', cin_2: '13:00', cong: 22.5, ot: '3,5' }],
};

test('applyTemplate: chọn / đổi tên / đổi thứ tự cột, cột ngày, cột vào–ra tách, cột gốc không còn thì bỏ qua', () => {
  const out = CRM.applyTemplate(REP, { cols: [{ key: 'name', label: 'Tên' }, { key: 'code', label: '' }, { key: '@days' }, { key: 'cin', label: 'Vào' }, { key: 'khong_con', label: 'X' }] });
  assert.deepEqual(out.columns.map((c) => [c.key, c.label]), [['name', 'Tên'], ['code', 'Mã NV'], ['d2026-09-01', '01'], ['d2026-09-02', '02'], ['cin_1', 'Vào 1'], ['cin_2', 'Vào 2']]);
  assert.equal(out.rows, REP.rows);   // không có công thức → giữ nguyên dòng
  assert.equal(out.title, 'Gốc');
});

test('applyTemplate: cột công thức (số, chuỗi số có dấu phẩy, IF ra chữ, dùng cột công thức trước, lỗi → trống)', () => {
  const out = CRM.applyTemplate(REP, { cols: [{ key: 'code' },
    { key: 'cf1', label: 'Giờ', f: '=cong*8 + ot' }, { key: 'cf2', label: 'Gấp đôi', f: '=cf1*2' },
    { key: 'cf3', label: 'Nhận xét', f: '=IF(cong>=22, "Đủ", "Thiếu")' }, { key: 'cf4', label: 'Giờ vào', f: '=cin_1+1' }, { key: 'cf5', label: 'Lỗi', f: '=(' }] });
  const r = out.rows[0];
  assert.equal(r.cf1, 183.5);
  assert.equal(r.cf2, 367);
  assert.equal(r.cf3, 'Đủ');
  assert.equal(r.cf4, 1);   // ô giờ "08:00" không phải số → 0
  assert.equal(r.cf5, '');
  assert.equal(REP.rows[0].cf1, undefined);   // không sửa dòng của báo cáo gốc
});

test('saveCustom: báo lỗi rõ khi thiếu tên / báo cáo gốc không dùng được / không có cột / công thức sai', () => {
  assert.throws(() => CRM.saveCustom({ name: '', base: 'summary', cols: [{ key: 'code' }] }), /tên mẫu/);
  assert.throws(() => CRM.saveCustom({ name: 'A', base: 'payroll', cols: [{ key: 'code' }] }), /không dùng được/);
  assert.throws(() => CRM.saveCustom({ name: 'A', base: 'track6', cols: [{ key: 'code' }] }), /không dùng được/);
  assert.throws(() => CRM.saveCustom({ name: 'A', base: 'summary', cols: [] }), /ít nhất 1 cột/);
  assert.throws(() => CRM.saveCustom({ name: 'A', base: 'summary', cols: [{ label: 'X', f: '=(' }] }), /Công thức cột "X"/);
  assert.throws(() => CRM.saveCustom({ name: 'A', base: 'summary', cols: [{ label: '', f: '=1' }] }), /tên cột/);
});

test('chưa có mẫu: danh sách rỗng; tạo + xem + xuất Excel mẫu riêng; báo cáo gốc không đổi; chỉ tài khoản tổng sửa', async () => {
  let r = await req('GET', '/reports/custom', tokAdmin);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.list, []);
  assert.ok(r.body.bases.some(([t]) => t === 'summary'));
  const before = (await req('GET', `/reports/data?type=summary${Q}`, tokAdmin)).body;

  // admin công ty không tạo được
  r = await req('POST', '/admin/custom-reports', tokAdmin, { name: 'Mẫu A', base: 'summary', cols: [{ key: 'code' }] });
  assert.equal(r.status, 403);

  r = await req('POST', '/admin/custom-reports', tokMaster, { name: 'Bảng công công ty A', base: 'summary', title: 'BẢNG CÔNG CÔNG TY A',
    cols: [{ key: 'name', label: 'Họ và tên' }, { key: 'code' }, { key: 'cong' }, { label: 'Giờ quy đổi', f: '=cong*8' }] });
  assert.equal(r.status, 200);
  const id = r.body.id;
  assert.deepEqual(r.body.cols.map((c) => c.key), ['name', 'code', 'cong', 'cf1']);

  const rep = (await req('GET', `/reports/data?type=cr${id}${Q}`, tokAdmin)).body;
  assert.equal(rep.title, 'BẢNG CÔNG CÔNG TY A tháng 09/2026');
  assert.deepEqual(rep.columns.map((c) => c.label), ['Họ và tên', 'Mã NV', 'Tổng công', 'Giờ quy đổi']);
  const row = rep.rows.find((x) => x.code === 'A1');
  assert.equal(row.cf1, Math.round(row.cong * 8 * 100) / 100);
  assert.ok(row.cong > 0);

  const xl = await req('GET', `/reports/export.xlsx?type=cr${id}${Q}`, tokAdmin);
  assert.equal(xl.status, 200);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(xl.body);
  const ws = wb.worksheets[0];
  assert.match(String(ws.getCell(3, 1).value), /BẢNG CÔNG CÔNG TY A THÁNG 09\/2026/);
  assert.deepEqual(ws.getRow(5).values.slice(1), ['Họ và tên', 'Mã NV', 'Tổng công', 'Giờ quy đổi']);

  // báo cáo gốc y như trước khi có mẫu
  assert.deepEqual((await req('GET', `/reports/data?type=summary${Q}`, tokAdmin)).body, before);
  assert.equal((await req('GET', '/reports/custom', tokAdmin)).body.list.length, 1);

  // sửa: admin công ty không sửa / xoá được; tài khoản tổng sửa được
  assert.equal((await req('PUT', `/admin/custom-reports/${id}`, tokAdmin, { name: 'X', base: 'summary', cols: [{ key: 'code' }] })).status, 403);
  assert.equal((await req('DELETE', `/admin/custom-reports/${id}`, tokAdmin)).status, 403);
  r = await req('PUT', `/admin/custom-reports/${id}`, tokMaster, { name: 'Bảng công A', base: 'summary', title: '', cols: [{ key: 'code' }] });
  assert.equal(r.status, 200);
  const rep2 = (await req('GET', `/reports/data?type=cr${id}${Q}`, tokAdmin)).body;
  assert.deepEqual(rep2.columns.map((c) => c.key), ['code']);
  assert.equal(rep2.title, before.title);   // không đặt tiêu đề riêng → tiêu đề báo cáo gốc

  // xoá → mẫu không còn, báo cáo gốc vẫn còn
  assert.deepEqual((await req('DELETE', `/admin/custom-reports/${id}`, tokMaster)).body, { ok: true });
  const gone = (await req('GET', `/reports/data?type=cr${id}${Q}`, tokAdmin)).body;
  assert.deepEqual(gone.rows, []);
  assert.match(gone.title, /không còn/);
  assert.deepEqual((await req('GET', '/reports/custom', tokAdmin)).body.list, []);
  assert.deepEqual((await req('GET', `/reports/data?type=summary${Q}`, tokAdmin)).body, before);
});
