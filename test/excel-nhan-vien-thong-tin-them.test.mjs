// Excel NHÂN VIÊN + công tắc "Thông tin thêm của nhân viên" (emp_extra_info) — Anh 21/11/2026:
//  TẮT (mặc định) = File mẫu / Xuất danh sách / Nhập — Cập nhật y như cũ (10 cột, cột lạ bỏ qua).
//  BẬT = thêm cột CCCD, quê quán… (nhận theo TÊN CỘT) + sheet GiaCanh; nhập mới / cập nhật lưu luôn vào hồ sơ + gia cảnh.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import ExcelJS from 'exceljs';

const DBP = join(tmpdir(), `dgp-excel-nv-ttt-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, setSetting, xlDate;
const routes = {};
const ADMIN = { id: 999999, role: 'admin', full_name: 'Admin' };
// Gọi route trả file Excel → Workbook
const getXlsx = async (key, query = {}) => {
  const res = new PassThrough(); const chunks = [];
  res.setHeader = () => {};
  res.on('data', (c) => chunks.push(c));
  const ended = new Promise((ok) => res.on('end', ok));
  await routes[key]({ query, params: {}, body: {}, user: ADMIN }, res);
  await ended;
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.concat(chunks));
  return wb;
};
const importWb = async (wb, mode) => {
  const b64 = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
  let out = null, code = 200;
  const res = { status(c) { code = c; return this; }, json(o) { out = o; return this; } };
  await routes['POST /employees/import']({ body: { mode, fileBase64: b64 }, params: {}, query: {}, user: ADMIN }, res);
  return { code, out };
};
// Thay sheet GiaCanh bằng các dòng cho trước (giữ dòng tiêu đề)
const setFam = (wb, rows) => {
  const old = wb.getWorksheet('GiaCanh'); const head = old.getRow(1).values.slice(1);
  wb.removeWorksheet(old.id);
  const g = wb.addWorksheet('GiaCanh'); g.addRow(head); rows.forEach((r) => g.addRow(r));
};
const heads = (ws) => ws.getRow(1).values.slice(1).map(String);
const prof = (code) => db.prepare('SELECT p.* FROM hr_profiles p JOIN employees e ON e.id=p.employee_id WHERE e.code=?').get(code) || {};
const fam = (code) => db.prepare('SELECT f.full_name, f.relation, f.birth_date, f.dependent FROM hr_family f JOIN employees e ON e.id=f.employee_id WHERE e.code=? ORDER BY f.id').all(code);

before(async () => {
  const D = await import('../server/db.js');
  db = D.db; setSetting = D.setSetting; D.initSchema();
  ({ xlDate } = await import('../server/routes/admin/emp-extra.js'));
  const add = (m) => (p, ...h) => { routes[`${m} ${p}`] = h[h.length - 1]; };
  const R = { get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE') };
  (await import('../server/routes/admin/employees.js')).registerEmployeeRoutes(R, { need: () => (q, s, n) => n() });
  db.prepare("INSERT INTO employees(code, full_name, department, role, username, password_hash) VALUES('A1','Nguyễn An','Xưởng','employee','a1','x')").run();
});

test('xlDate: ô ngày Excel, số seri, dd/mm/yyyy, yyyy-mm-dd; ngày không có thật → null', () => {
  assert.equal(xlDate(new Date(Date.UTC(1990, 4, 15))), '1990-05-15');
  assert.equal(xlDate('15/05/1990'), '1990-05-15');
  assert.equal(xlDate('5/6/2021'), '2021-06-05');
  assert.equal(xlDate('2021-06-05'), '2021-06-05');
  assert.equal(xlDate(45000), '2023-03-15');
  assert.equal(xlDate(''), '');
  assert.equal(xlDate('31/02/2020'), null);
  assert.equal(xlDate('abc'), null);
});

test('TẮT công tắc: file mẫu + xuất danh sách y như cũ (10 / 11 cột, 1 sheet nhân viên), cột thêm trong file nhập bị bỏ qua', async () => {
  setSetting('emp_extra_info', '0');
  const t = await getXlsx('GET /employees/template.xlsx');
  assert.equal(heads(t.worksheets[0]).length, 10);
  assert.deepEqual(t.worksheets.map((w) => w.name), ['NhanVien', 'HuongDan']);
  const x = await getXlsx('GET /employees/export.xlsx');
  assert.equal(heads(x.worksheets[0]).length, 11);
  assert.equal(x.worksheets.length, 1);
  // file có cột CCCD + sheet GiaCanh nhưng công tắc tắt → chỉ thêm NV, không ghi hồ sơ
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('NhanVien');
  ws.addRow(['Mã NV *', 'Họ tên *', '', '', '', '', '', '', '', '', 'Số CCCD / CMND']);
  ws.addRow(['T1', 'Tắt Một', '', '', '', '', '', '', '', '', '001']);
  wb.addWorksheet('GiaCanh').addRow(['Mã NV']).commit;
  const r = await importWb(wb, 'add');
  assert.equal(r.out.added, 1);
  assert.ok(!('extraSaved' in r.out));
  assert.equal(prof('T1').id_number, undefined);
});

test('BẬT: file mẫu có cột CCCD… (sau 10 cột cũ) + sheet GiaCanh; xuất danh sách có cột + gia cảnh của NV', async () => {
  setSetting('emp_extra_info', '1');
  const t = await getXlsx('GET /employees/template.xlsx');
  const h = heads(t.worksheets[0]);
  assert.equal(h[0], 'Mã NV *'); assert.equal(h[9], 'Mật khẩu');
  assert.ok(h.includes('Số CCCD / CMND') && h.includes('Quê quán') && h.includes('Quan hệ (liên hệ khẩn cấp)'));
  assert.ok(!h.includes('Quản lý trực tiếp'));   // trường riêng phân hệ Nhân sự
  assert.deepEqual(t.worksheets.map((w) => w.name), ['NhanVien', 'GiaCanh', 'HuongDan']);
  // ví dụ NV001 có CCCD dạng chữ (giữ số 0 đầu)
  assert.equal(t.worksheets[0].getRow(2).getCell(h.indexOf('Số CCCD / CMND') + 1).value, '036090012345');
});

test('BẬT + NHẬP MỚI: lưu CCCD, ngày (dd/mm/yyyy + ô ngày), gia cảnh; ngày sai báo lỗi và bỏ ô; gia cảnh mã lạ bị bỏ', async () => {
  setSetting('emp_extra_info', '1');
  const t = await getXlsx('GET /employees/template.xlsx');
  const ws = t.worksheets[0]; const h = heads(ws); const col = (l) => h.indexOf(l) + 1;
  ws.spliceRows(2, 2);   // bỏ 2 dòng ví dụ
  const r = ws.getRow(2);
  r.getCell(1).value = 'B1'; r.getCell(2).value = 'Trần Bình';
  r.getCell(col('Số CCCD / CMND')).value = '001199000111';
  r.getCell(col('Ngày cấp')).value = '20/06/2021';
  r.getCell(col('Ngày sinh')).value = new Date(Date.UTC(1999, 0, 2));
  r.getCell(col('Quê quán')).value = 'Thái Bình';
  r.commit();
  const r3 = ws.getRow(3);
  r3.getCell(1).value = 'B2'; r3.getCell(2).value = 'Lê Ba'; r3.getCell(col('Ngày sinh')).value = '31/02/2000'; r3.getCell(col('Dân tộc')).value = 'Kinh';
  r3.commit();
  setFam(t, [['B1', 'Trần Bình', 'Trần Văn Bố', 'Bố', '01/01/1970', '', 'Làm ruộng', '', ''],
    ['B1', 'Trần Bình', 'Trần Bé', 'Con', '10/10/2020', '', '', 'Có', ''],
    ['ZZ9', '', 'Người lạ', 'Bố', '', '', '', '', '']]);
  const res = await importWb(t, 'add');
  assert.equal(res.out.added, 2);
  assert.equal(res.out.extraSaved, 2);
  const p = prof('B1');
  assert.deepEqual([p.id_number, p.id_issue_date, p.birth_date, p.hometown], ['001199000111', '2021-06-20', '1999-01-02', 'Thái Bình']);
  assert.deepEqual(fam('B1').map((f) => ({ ...f })), [
    { full_name: 'Trần Văn Bố', relation: 'Bố', birth_date: '1970-01-01', dependent: 0 },
    { full_name: 'Trần Bé', relation: 'Con', birth_date: '2020-10-10', dependent: 1 }]);
  assert.equal(prof('B2').birth_date || '', '');   // ngày sai → bỏ ô
  assert.equal(prof('B2').ethnicity, 'Kinh');
  assert.ok(res.out.errors.some((e) => /Dòng 3: Ngày sinh "31\/02\/2000"/.test(e)));
  assert.ok(res.out.errors.some((e) => /ZZ9/.test(e)));
});

test('BẬT + CẬP NHẬT từ file Xuất danh sách: ô trống giữ nguyên, ô điền thì ghi đè; NV không có dòng gia cảnh giữ nguyên', async () => {
  setSetting('emp_extra_info', '1');
  const x = await getXlsx('GET /employees/export.xlsx');
  const ws = x.worksheets[0]; const h = heads(ws); const col = (l) => h.indexOf(l) + 1;
  assert.equal(h[10], 'Trạng thái');
  let rB1 = null;
  ws.eachRow((row, i) => { if (i > 1 && String(row.getCell(1).value) === 'B1') rB1 = row; });
  assert.equal(rB1.getCell(col('Số CCCD / CMND')).value, '001199000111');   // xuất ra đúng
  assert.equal(rB1.getCell(col('Ngày sinh')).value, '02/01/1999');
  rB1.getCell(col('Quê quán')).value = 'Nam Định';    // sửa
  rB1.getCell(col('Số CCCD / CMND')).value = null;    // để trống → giữ
  rB1.commit();
  const g = x.getWorksheet('GiaCanh');
  assert.equal(g.rowCount, 3);                         // 2 người thân của B1
  setFam(x, []);                                       // không còn dòng nào của B1 → giữ nguyên
  const res = await importWb(x, 'update');
  assert.equal(res.code, 200);
  const p = prof('B1');
  assert.equal(p.hometown, 'Nam Định');
  assert.equal(p.id_number, '001199000111');
  assert.equal(fam('B1').length, 2);
  // có dòng gia cảnh → THAY cả danh sách
  const x2 = await getXlsx('GET /employees/export.xlsx');
  setFam(x2, [['B1', '', 'Trần Mẹ', 'Mẹ', '', '', '', '', '']]);
  await importWb(x2, 'update');
  assert.deepEqual(fam('B1').map((f) => f.full_name), ['Trần Mẹ']);
});

test('nhập nhầm file "Xuất thông tin thêm" (sheet ThongTinThem) → từ chối, không đổi gì', async () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('ThongTinThem');
  ws.addRow(['Mã NV', 'Họ tên', 'Bộ phận', 'Chức danh', 'SĐT', 'Trạng thái']);
  ws.addRow(['A1', 'Nguyễn An', 'Xưởng', '', '', 'Đang làm']);
  const r = await importWb(wb, 'update');
  assert.equal(r.code, 400);
  assert.match(r.out.error, /Xuất thông tin thêm/);
});
