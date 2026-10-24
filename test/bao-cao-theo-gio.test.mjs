// Test BÁO CÁO MẪU "THEO GIỜ" + quy tắc "Nhiều lần vào/ra":
//   · theo giờ: mọi báo cáo bỏ cột trễ/sớm, công, tăng ca, ca; cột tổng là Tổng giờ; bỏ dòng Giờ tăng ca / Giờ TC
//   · nhiều lần vào/ra: mỗi lần chấm 1 cột (Giờ vào 1 · Giờ ra 1 · Giờ vào 2 …) ở báo cáo danh sách, ma trận và Excel
//   · mẫu theo ca: giữ nguyên trễ/sớm, công, tăng ca như cũ
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import ExcelJS from 'exceljs';

const DBP = join(tmpdir(), `dgp-bao-cao-theo-gio-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;
let db, server, base, tok;
const Q = '&from=2026-09-01&to=2026-09-30';
const get = async (path) => {
  const res = await fetch(base + path, { headers: { Authorization: 'Bearer ' + tok } });
  assert.equal(res.status, 200, path);
  return (res.headers.get('content-type') || '').includes('json') ? res.json() : Buffer.from(await res.arrayBuffer());
};
const keys = (rep) => rep.columns.map((c) => c.key);
const labels = (rep) => rep.columns.map((c) => c.label);
const sheetText = async (buf) => {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
  const out = []; wb.worksheets[0].eachRow((r) => out.push(r.values.slice(1).map((v) => (v == null ? '' : String(v)))));
  return out;
};
const vn = (d, hm) => new Date(`${d}T${hm}:00+07:00`).toISOString();

before(async () => {
  let initSchema, setSetting;
  ({ db, initSchema, setSetting } = await import('../server/db.js'));
  const { signToken } = await import('../server/auth.js');
  const reportRoutes = (await import('../server/routes/reports.js')).default;
  const express = (await import('express')).default;
  initSchema();
  setSetting('attendance_mode', 'hourly');
  setSetting('hourly_merge_rule', 'pairs');
  setSetting('punch_dedup_min', '5');
  const adm = Number(db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash) VALUES ('ADM','Admin','admin','adm','x')").run().lastInsertRowid);
  const h1 = Number(db.prepare("INSERT INTO employees(code, full_name, department, role, username, password_hash, att_mode, start_date) VALUES ('H1','Lê Giờ','Xưởng','employee','h1','x','hourly','2026-01-01')").run().lastInsertRowid);
  tok = signToken({ id: adm, code: 'ADM', role: 'admin', full_name: 'Admin' });
  const att = db.prepare('INSERT INTO attendance(employee_id, work_date, check_in_at, check_out_at, work_unit, work_minutes, late_min, early_min, ot_min) VALUES (?,?,?,?,?,?,?,?,?)');
  const pun = db.prepare("INSERT INTO device_punches(serial, pin, punch_at, work_date, employee_id) VALUES ('SN1','H1',?,?,?)");
  // 02/09: 3 cặp vào/ra (08–11, 12–14, 15–18) = 8 giờ; có trễ/tăng ca trong CSDL để chắc báo cáo theo giờ KHÔNG hiện
  att.run(h1, '2026-09-02', vn('2026-09-02', '08:00'), vn('2026-09-02', '18:00'), 1, 480, 15, 0, 60);
  for (const t of ['08:00', '11:00', '12:00', '14:00', '15:00', '18:00']) pun.run(vn('2026-09-02', t), '2026-09-02', h1);
  // 03/09: 1 cặp 08–12 = 4 giờ
  att.run(h1, '2026-09-03', vn('2026-09-03', '08:00'), vn('2026-09-03', '12:00'), 0.5, 240, 0, 0, 0);
  for (const t of ['08:00', '12:00']) pun.run(vn('2026-09-03', t), '2026-09-03', h1);
  const app = express(); app.use(express.json());
  app.use('/api/reports', reportRoutes);
  await new Promise((res) => { server = app.listen(0, '127.0.0.1', res); });
  base = `http://127.0.0.1:${server.address().port}/api/reports`;
});
after(() => { server?.close(); for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} } });

const NO_SHIFT_STUFF = ['late', 'early', 'lateN', 'earlyN', 'lateM', 'earlyM', 'cong', 'ot', 'otWk', 'ot1', 'otE', 'otH', 'otNT', 'otNN', 'shift', 'inCa', 'outCa'];
test('theo giờ: mọi báo cáo bỏ trễ/sớm, công, tăng ca, ca', async () => {
  for (const type of ['detail', 'detaillist', 'detailmulti', 'empsheet', 'attendance', 'summary', 'hourstat', 'track6', 'daytime', 'workhours', 'absence']) {
    const rep = await get(`/data?type=${type}${Q}&mode=hourly`);
    for (const k of NO_SHIFT_STUFF) assert.ok(!keys(rep).includes(k), `${type} còn cột ${k}`);
    assert.ok(!labels(rep).some((l) => /công|Trễ|Sớm|Tăng ca|OT/.test(l) && l !== 'Tên nhân viên'), `${type}: ${labels(rep).join(', ')}`);
  }
});
test('nhiều lần vào/ra: báo cáo danh sách mỗi lần chấm 1 cột', async () => {
  const rep = await get(`/data?type=detaillist${Q}&mode=hourly`);
  assert.deepEqual(keys(rep).filter((k) => /^c(in|out)_/.test(k)), ['cin_1', 'cout_1', 'cin_2', 'cout_2', 'cin_3', 'cout_3']);
  assert.ok(labels(rep).includes('Giờ vào 3'));
  const d2 = rep.rows.find((r) => r.date === '02/09/2026');
  assert.deepEqual([d2.cin_1, d2.cout_1, d2.cin_2, d2.cout_2, d2.cin_3, d2.cout_3], ['08:00', '11:00', '12:00', '14:00', '15:00', '18:00']);
  const d3 = rep.rows.find((r) => r.date === '03/09/2026');
  assert.deepEqual([d3.cin_1, d3.cout_1, d3.cin_2], ['08:00', '12:00', '']);
  assert.ok(!rep.rows.some((r) => '_io' in r));
  const det = await get(`/data?type=detail${Q}&mode=hourly`);
  assert.ok(keys(det).includes('inReal_3') && keys(det).includes('gio'));
  assert.equal(det.rows.find((r) => r.date === '02/09/2026').status, 'Đủ');
});
test('theo giờ: tổng là Tổng giờ, bỏ dòng tăng ca', async () => {
  const dt = await get(`/data?type=daytime${Q}&mode=hourly`);
  assert.equal(dt.columns.at(-1).label, 'Tổng giờ');
  assert.equal(dt.rows[0].total, 12);
  const wh = await get(`/data?type=workhours${Q}&mode=hourly`);
  assert.deepEqual(wh.rows.map((r) => r.loai), ['Giờ Vào–Ra', 'Giờ công']);
  assert.equal(wh.rows[0]['d2026-09-02i3'], '15:00');
  assert.ok(labels(wh).includes('Vào 3'));
  const t6 = await get(`/data?type=track6${Q}&mode=hourly`);
  assert.deepEqual(t6.rows.map((r) => r.loai), ['Vào 1', 'Ra 1', 'Vào 2', 'Ra 2', 'Giờ làm']);
  const hs = await get(`/data?type=hourstat${Q}&mode=hourly`);
  assert.equal(hs.columns.find((c) => c.key === 'gio').label, 'Tổng giờ');
  assert.equal(hs.rows[0].gio, 12);
});
test('mẫu theo ca: vẫn đủ trễ/sớm, công, tăng ca', async () => {
  const rep = await get(`/data?type=detaillist${Q}&mode=shift`);
  for (const k of ['late', 'early', 'cong', 'ot']) assert.ok(keys(rep).includes(k), k);
  assert.equal(rep.rows.find((r) => r.date === '02/09/2026').late, 15);
  const wh = await get(`/data?type=workhours${Q}&mode=shift`);
  assert.equal(wh.rows.length, 3);
});
test('Excel bảng chi tiết từng NV (theo giờ): Vào 1…Ra 3 mỗi cột 1 tiêu đề, không trễ/sớm/công, có dòng Tổng giờ', async () => {
  const rows = await sheetText(await get(`/export.xlsx?type=empsheet${Q}&mode=hourly`));
  const head = rows.find((r) => r.includes('Vào 1'));
  assert.ok(head && head.includes('Ra 3') && head.includes('Giờ'), JSON.stringify(head));
  assert.ok(!rows.flat().some((v) => /^(Trễ|Sớm|Về trễ|Công|Tổng công|Số lần trễ)$/.test(v)));
  const tot = rows.find((r) => r[0] === 'Tổng');
  assert.ok(tot && tot.includes('12'), JSON.stringify(tot));
});
test('Excel chi tiết giờ vào/ra + giờ làm (theo giờ): mỗi lần chấm 1 cột, Tổng giờ, 2 dòng/NV', async () => {
  const dt = await sheetText(await get(`/export.xlsx?type=daytime${Q}&mode=hourly`));
  assert.ok(dt.flat().includes('Vào 3') && dt.flat().includes('Tổng giờ'));
  const r2 = dt.find((r) => r.includes('Lê Giờ'));
  assert.ok(['08:00', '11:00', '12:00', '14:00', '15:00', '18:00'].every((t) => r2.includes(t)));
  const wh = await sheetText(await get(`/export.xlsx?type=workhours${Q}&mode=hourly`));
  assert.ok(wh.flat().includes('Ra 3'));
  assert.ok(!wh.flat().some((v) => /tăng ca/i.test(v)));
});
