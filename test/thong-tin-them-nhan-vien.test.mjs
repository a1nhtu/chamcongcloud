// THÔNG TIN THÊM CỦA NHÂN VIÊN (Anh 20/11/2026): công tắc emp_extra_info (mặc định TẮT, chỉ tài khoản tổng bật) → form Sửa NV
// có tab "🧾 Thông tin thêm" (CCCD, quê quán, liên hệ, học vấn, ngân hàng) + gia cảnh / người phụ thuộc. Dùng chung bảng
// hr_profiles + hr_family với phân hệ Nhân sự. Tắt = như cũ: API trả 403, không có gì đổi. Chạy: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { moCong } from './_cong.mjs';

const DBP = join(tmpdir(), `dgp-thong-tin-them-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, setSetting, getSetting, server, base, empId, admId;
let user = null;   // người đang gọi (gắn vào req.user)
const call = async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, data: ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
};

before(async () => {
  let initSchema;
  ({ db, initSchema, setSetting, getSetting } = await import('../server/db.js'));
  initSchema();
  const { registerEmpExtraRoutes } = await import('../server/routes/admin/emp-extra.js');
  const express = (await import('express')).default;
  admId = Number(db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash) VALUES ('ADM','Quản Trị','admin','adm','x')").run().lastInsertRowid);
  empId = Number(db.prepare("INSERT INTO employees(code, full_name, department, role, username, password_hash) VALUES ('NV01','Nguyễn Văn An','Xưởng','employee','nv01','x')").run().lastInsertRowid);
  const app = express(); app.use(express.json());
  const r = express.Router();
  r.use((req, res, next) => { req.user = user; next(); });
  // quyền giả: người có perms chứa key (admin luôn qua)
  const need = (key) => (req, res, next) => (req.user && (req.user.role === 'admin' || (req.user.perms || []).includes(key)) ? next() : res.status(403).json({ error: 'Không có quyền' }));
  registerEmpExtraRoutes(r, { need });
  app.use('/admin', r);
  server = await moCong(app);
  base = `http://127.0.0.1:${server.address().port}/admin`;
});
after(() => { server?.close(); for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} } });

const ADMIN = { id: 1, role: 'admin', full_name: 'Quản Trị' };

test('mặc định TẮT: công tắc chưa đặt = 0, API trả 403, không ghi gì vào hồ sơ', async () => {
  user = ADMIN;
  assert.equal(getSetting('emp_extra_info', '0'), '0');
  assert.equal((await call('GET', `/employees/${empId}/extra`)).status, 403);
  assert.equal((await call('PUT', `/employees/${empId}/extra`, { profile: { id_number: '001' } })).status, 403);
  assert.equal((await call('GET', '/employees/extra/export.xlsx')).status, 403);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM hr_profiles').get().n, 0);
});

test('bật: lưu + đọc lại CCCD, quê quán, ngày sinh; trường lạ / trường riêng Nhân sự bị bỏ; ngày sai để trống', async () => {
  setSetting('emp_extra_info', '1');
  user = ADMIN;
  const put = await call('PUT', `/employees/${empId}/extra`, {
    profile: { id_number: '079090001234', id_issue_date: '2021-05-10', hometown: 'Nam Định', birth_date: '1990-13-45', gender: 'Nam',
      manager_id: String(admId), salary: '999', hr_note: 'Ghi chú thử' },
    family: [
      { full_name: 'Trần Thị Bình', relation: 'Vợ', birth_date: '1992-02-03', dependent: false },
      { full_name: 'Nguyễn Văn Cường', relation: 'Con', birth_date: '2018-06-01', dependent: true },
      { full_name: '   ', relation: 'Khác' },   // dòng không có họ tên → bỏ
    ],
  });
  assert.equal(put.status, 200);
  assert.equal(put.data.dependents, 1);
  const g = (await call('GET', `/employees/${empId}/extra`)).data;
  assert.equal(g.profile.id_number, '079090001234');
  assert.equal(g.profile.id_issue_date, '2021-05-10');
  assert.equal(g.profile.hometown, 'Nam Định');
  assert.equal(g.profile.birth_date, '', 'ngày sai → trống');
  assert.equal(g.profile.hr_note, 'Ghi chú thử');
  assert.ok(!('manager_id' in g.profile), 'trường riêng phân hệ Nhân sự không hiện ở tab');
  assert.equal(db.prepare('SELECT manager_id FROM hr_profiles WHERE employee_id=?').get(empId).manager_id || '', '', 'không ghi được quản lý trực tiếp qua tab này');
  assert.deepEqual(g.family.map((x) => [x.full_name, x.relation, x.dependent]), [['Trần Thị Bình', 'Vợ', 0], ['Nguyễn Văn Cường', 'Con', 1]]);
  assert.ok(g.fields.some((f) => f[0] === 'id_number') && g.relations.includes('Con'));
});

test('lưu lại: gửi family = thay cả danh sách; không gửi family = giữ nguyên gia cảnh', async () => {
  user = ADMIN;
  await call('PUT', `/employees/${empId}/extra`, { profile: { hometown: 'Hà Nam' } });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM hr_family WHERE employee_id=?').get(empId).n, 2);
  await call('PUT', `/employees/${empId}/extra`, { profile: {}, family: [{ full_name: 'Nguyễn Văn Cường', relation: 'Con', dependent: true }] });
  const g = (await call('GET', `/employees/${empId}/extra`)).data;
  assert.equal(g.profile.hometown, 'Hà Nam');
  assert.equal(g.profile.id_number, '079090001234', 'trường không gửi giữ nguyên');
  assert.deepEqual(g.family.map((x) => x.full_name), ['Nguyễn Văn Cường']);
});

test('quyền: cần quyền Nhân viên; quản lý không sửa được hồ sơ tài khoản Admin', async () => {
  user = { id: 9, role: 'manager', perms: [], full_name: 'QL' };
  assert.equal((await call('GET', `/employees/${empId}/extra`)).status, 403);
  user = { id: 9, role: 'manager', perms: ['employees'], full_name: 'QL' };
  assert.equal((await call('GET', `/employees/${empId}/extra`)).status, 200);
  assert.equal((await call('PUT', `/employees/${admId}/extra`, { profile: { hometown: 'X' } })).status, 403);
  assert.equal((await call('GET', '/employees/99999/extra')).status, 404);
});

test('xuất Excel: sheet ThongTinThem (CCCD, quê quán, số người phụ thuộc) + sheet GiaCanh', async () => {
  user = ADMIN;
  const r = await call('GET', '/employees/extra/export.xlsx');
  assert.equal(r.status, 200);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(r.data);
  const ws = wb.getWorksheet('ThongTinThem');
  const head = ws.getRow(1).values.slice(1);
  const row = ws.getRow(2).values.slice(1).length ? [2, 3].map((i) => ws.getRow(i).values.slice(1)).find((v) => v[0] === 'NV01') : null;
  assert.ok(row, 'có dòng NV01');
  assert.equal(row[head.indexOf('Số CCCD / CMND')], '079090001234');
  assert.equal(row[head.indexOf('Quê quán')], 'Hà Nam');
  assert.equal(row[head.indexOf('Số người phụ thuộc')], 1);
  const wf = wb.getWorksheet('GiaCanh');
  assert.deepEqual(wf.getRow(2).values.slice(1, 4), ['NV01', 'Nguyễn Văn An', 'Nguyễn Văn Cường']);
  assert.equal(wf.getRow(2).values[8], 'Có');
});

test('form THÊM MỚI: /employees/extra/meta trả khung trống (nhóm, trường, quan hệ) — tắt công tắc thì 403', async () => {
  user = ADMIN;
  const m = await call('GET', '/employees/extra/meta');
  assert.equal(m.status, 200);
  assert.ok(m.data.groups.length >= 4 && m.data.fields.some((f) => f[0] === 'id_number') && m.data.relations.includes('Con'));
  assert.deepEqual(m.data.family, []);
  assert.ok(Object.values(m.data.profile).every((v) => v === ''));
  assert.ok(!('manager_id' in m.data.profile));   // trường riêng Nhân sự không hiện
  // NV vừa tạo → lưu thông tin thêm bằng PUT như form Sửa
  const nid = Number(db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash) VALUES ('NV02','Trần Thị Bình','employee','nv02','x')").run().lastInsertRowid);
  assert.equal((await call('PUT', `/employees/${nid}/extra`, { profile: { id_number: '001199000111' }, family: [{ full_name: 'Trần Văn Cha', relation: 'Bố' }] })).status, 200);
  assert.equal(db.prepare('SELECT id_number FROM hr_profiles WHERE employee_id=?').get(nid).id_number, '001199000111');
  setSetting('emp_extra_info', '0');
  assert.equal((await call('GET', '/employees/extra/meta')).status, 403);
  setSetting('emp_extra_info', '1');
});

test('tắt lại: API 403 nhưng dữ liệu đã nhập vẫn còn', async () => {
  setSetting('emp_extra_info', '0');
  user = ADMIN;
  assert.equal((await call('GET', `/employees/${empId}/extra`)).status, 403);
  assert.equal(db.prepare('SELECT id_number FROM hr_profiles WHERE employee_id=?').get(empId).id_number, '079090001234');
});
