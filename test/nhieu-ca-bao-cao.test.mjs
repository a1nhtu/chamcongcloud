// Công tắc "nhiều ca/ngày" (multi_shift_assist) ở BÁO CÁO CÔNG: ca được gán mà ngày đó không có công → cột "Thiếu ca" ghi tên ca.
// Chỉ là ghi chú hiển thị: BẬT thì báo cáo = báo cáo TẮT + đúng 1 cột mới (mọi số công / giờ / tăng ca khác y hệt); TẮT thì không có cột nào.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { moCong } from './_cong.mjs';   // cổng ngẫu nhiên an toàn (tránh cổng fetch cấm / cổng test khác đang dò)

const DBP = join(tmpdir(), `dgp-nhieu-ca-bao-cao-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;
let db, server, base, tok, setSetting;
const Q = '&from=2026-11-01&to=2026-11-30';
const D = '2026-11-02';
const TYPES = ['horizontal', 'symbol', 'detail', 'detaillist', 'detailmulti'];
const get = async (path) => {
  const res = await fetch(base + path, { headers: { Authorization: 'Bearer ' + tok } });
  assert.equal(res.status, 200, path);
  return (res.headers.get('content-type') || '').includes('json') ? res.json() : Buffer.from(await res.arrayBuffer());
};
const vn = (hm) => new Date(`${D}T${hm}:00+07:00`).toISOString();
const sheetText = async (buf) => {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
  const out = []; wb.worksheets[0].eachRow((r) => out.push(r.values.slice(1).map((v) => (v == null ? '' : String(v)))));
  return out;
};

before(async () => {
  let initSchema;
  ({ db, initSchema, setSetting } = await import('../server/db.js'));
  const { signToken } = await import('../server/auth.js');
  const reportRoutes = (await import('../server/routes/reports.js')).default;
  const express = (await import('express')).default;
  initSchema();
  const adm = Number(db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash) VALUES ('ADM','Admin','admin','adm','x')").run().lastInsertRowid);
  tok = signToken({ id: adm, code: 'ADM', role: 'admin', full_name: 'Admin' });
  const sh = (name, a, b) => Number(db.prepare('INSERT INTO shifts(name, code, start_time, end_time) VALUES (?,?,?,?)').run(name, name, a, b).lastInsertRowid);
  const S = sh('Ca sáng', '08:00', '12:00'), C = sh('Ca chiều', '13:00', '17:00'), HC = sh('Ca HC', '08:00', '17:00');
  const emp = (code) => Number(db.prepare("INSERT INTO employees(code, full_name, department, role, username, password_hash) VALUES (?,?, 'Kho','employee',?,'x')").run(code, 'NV ' + code, code.toLowerCase()).lastInsertRowid);
  const e1 = emp('E1'), e2 = emp('E2'), e3 = emp('E3');
  const asg = db.prepare("INSERT INTO daily_shift_assignments(employee_id, work_date, shift_id, is_off, source) VALUES (?,?,?,0,'sheet')");
  const att = db.prepare('INSERT INTO attendance(employee_id, work_date, check_in_at, check_out_at, work_unit, work_minutes, shift_id) VALUES (?,?,?,?,?,?,?)');
  asg.run(e1, D, S); asg.run(e1, D, C); att.run(e1, D, vn('08:00'), vn('12:00'), 0.5, 240, S);                                   // thiếu ca chiều
  asg.run(e2, D, S); asg.run(e2, D, C); att.run(e2, D, vn('08:00'), vn('12:00'), 0.5, 240, S); att.run(e2, D, vn('13:00'), vn('17:00'), 0.5, 240, C);   // đủ
  asg.run(e3, D, S); asg.run(e3, D, HC); att.run(e3, D, vn('08:00'), vn('17:00'), 1, 480, HC);                                   // S chồng giờ HC → không coi là thiếu
  const app = express(); app.use(express.json());
  app.use('/api/reports', reportRoutes);
  server = await moCong(app);
  base = `http://127.0.0.1:${server.address().port}/api/reports`;
});
after(() => { server?.close(); for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} } });

test('công tắc TẮT (mặc định): không báo cáo nào có cột Thiếu ca', async () => {
  for (const t of TYPES) {
    const rep = await get(`/data?type=${t}${Q}`);
    assert.ok(!rep.columns.some((c) => c.key === 'missShift'), t);
    assert.ok(!rep.rows.some((r) => 'missShift' in r), t);
  }
});

test('công tắc BẬT: báo cáo = báo cáo TẮT + đúng cột Thiếu ca (công / giờ / tăng ca không đổi)', async () => {
  const off = {};
  for (const t of TYPES) off[t] = await get(`/data?type=${t}${Q}`);
  setSetting('multi_shift_assist', '1');
  try {
    for (const t of TYPES) {
      const on = await get(`/data?type=${t}${Q}`);
      assert.ok(on.columns.some((c) => c.key === 'missShift' && c.label === 'Thiếu ca'), t);
      const strip = { ...on, columns: on.columns.filter((c) => c.key !== 'missShift'), rows: on.rows.map(({ missShift, ...r }) => r) };
      assert.deepEqual(strip, off[t], t + ': ngoài cột Thiếu ca phải y hệt khi tắt');
    }
    const list = (await get(`/data?type=detaillist${Q}`)).rows.filter((r) => r.date === '02/11/2026');
    const by = (code) => list.find((r) => r.code === code).missShift;
    assert.equal(by('E1'), 'Ca chiều');   // gán sáng + chiều, chỉ có công ca sáng
    assert.equal(by('E2'), '');           // đủ 2 ca
    assert.equal(by('E3'), '');           // ca sáng chồng giờ ca HC đã có công
    const detail = (await get(`/data?type=detail${Q}`)).rows.filter((r) => r.date === '02/11/2026' && r.code === 'E1');
    assert.ok(detail.length && detail.every((r) => r.missShift === 'Ca chiều'));
    const sym = (await get(`/data?type=symbol${Q}`)).rows;
    assert.equal(sym.find((r) => r.code === 'E1').missShift, '02/11: Ca chiều');
    assert.equal(sym.find((r) => r.code === 'E2').missShift, '');
  } finally { setSetting('multi_shift_assist', '0'); }
});

// Các báo cáo dạng ma trận / nhiều dòng mỗi NV: cũng chỉ thêm đúng 1 cột "Thiếu ca" khi BẬT
const TYPES2 = ['hourstat', 'daytime', 'workhours', 'track6', 'empsheet'];
test('công tắc TẮT: báo cáo thống kê giờ / giờ vào ra / giờ công / theo dõi / từng NV không có cột Thiếu ca', async () => {
  for (const t of TYPES2) {
    const rep = await get(`/data?type=${t}${Q}`);
    assert.ok(!rep.columns.some((c) => c.key === 'missShift'), t);
    assert.ok(!rep.rows.some((r) => 'missShift' in r), t);
  }
});

test('công tắc BẬT: các báo cáo ma trận = báo cáo TẮT + đúng cột Thiếu ca, ghi đúng ca thiếu', async () => {
  const off = {};
  for (const t of TYPES2) off[t] = await get(`/data?type=${t}${Q}`);
  setSetting('multi_shift_assist', '1');
  try {
    for (const t of TYPES2) {
      const on = await get(`/data?type=${t}${Q}`);
      assert.ok(on.columns.some((c) => c.key === 'missShift' && c.label === 'Thiếu ca'), t);
      const strip = { ...on, columns: on.columns.filter((c) => c.key !== 'missShift'), rows: on.rows.map(({ missShift, ...r }) => r) };
      assert.deepEqual(strip, off[t], t + ': ngoài cột Thiếu ca phải y hệt khi tắt');
      const miss = on.rows.filter((r) => r.missShift).map((r) => ({ code: r.code, v: r.missShift }));
      assert.ok(miss.length >= 1 && miss.every((m) => m.v.includes('Ca chiều') && !/Ca sáng|Ca HC/.test(m.v)), t + ': ' + JSON.stringify(miss));
      assert.ok(!miss.some((m) => m.code === 'E2' || m.code === 'E3'), t + ': NV đủ ca không được báo thiếu');
    }
  } finally { setSetting('multi_shift_assist', '0'); }
});

test('file Excel các báo cáo ma trận: BẬT có cột / dòng Thiếu ca ghi tên ca, TẮT không có', async () => {
  const text = async (t) => (await sheetText(await get(`/export.xlsx?type=${t}${Q}`))).flat().join('|');
  for (const t of TYPES2) assert.ok(!(await text(t)).includes('Thiếu ca'), t + ' (tắt)');
  setSetting('multi_shift_assist', '1');
  try {
    for (const t of TYPES2) {
      const s = await text(t);
      assert.ok(s.includes('Thiếu ca') && s.includes('Ca chiều'), t + ' (bật)');
    }
  } finally { setSetting('multi_shift_assist', '0'); }
  for (const t of TYPES2) assert.ok(!(await text(t)).includes('Thiếu ca'), t + ' (tắt lại)');
});

test('file Excel xuất: BẬT có cột Thiếu ca ghi tên ca, TẮT không có', async () => {
  const text = async () => (await sheetText(await get(`/export.xlsx?type=horizontal${Q}`))).flat().join('|');
  assert.ok(!(await text()).includes('Thiếu ca'));
  setSetting('multi_shift_assist', '1');
  try {
    const t = await text();
    assert.ok(t.includes('Thiếu ca') && t.includes('02/11: Ca chiều'));
  } finally { setSetting('multi_shift_assist', '0'); }
  assert.ok(!(await text()).includes('Thiếu ca'));
});
