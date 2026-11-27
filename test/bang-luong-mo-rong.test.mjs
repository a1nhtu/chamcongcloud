// BẢNG LƯƠNG MỞ RỘNG (công tắc pay_extra, mặc định TẮT) — làm cho khách mythuatlt (27/11/2026):
//   · Tiền ăn từng người: × số ngày đi làm / × số công / cố định cả kỳ
//   · Đơn giá tăng ca VNĐ / giờ từng người theo mốc TC1 / TC2 / TC3 (+ ngày nghỉ, ngày lễ); ô 0 = vẫn theo hệ số × lương ngày ÷ 8 như cũ
//   · Trừ khác nhập tay theo từng kỳ → Thực lĩnh = tổng thu nhập − trừ khác
//   Tắt công tắc: bảng lương y như cũ dù đã điền các ô mới.
// Chạy: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { moCong } from './_cong.mjs';

const DBP = join(tmpdir(), `dgp-luong-mo-rong-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, setSetting, getSetting, P, buildReportData, server, base;
const tok = {};
let EMP, EMP2, HOURLY;
const FROM = '2026-11-01', TO = '2026-11-30';

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}
const ok = (r) => { assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
const pay = (id = EMP, from = FROM, to = TO) => P.computePayrollForEmployee(id, from, to);

before(async () => {
  const D = await import('../server/db.js');
  ({ db, setSetting, getSetting } = D); D.initSchema();
  P = await import('../server/payroll-calc.js');
  ({ buildReportData } = await import('../server/routes/reports.js'));
  const { signToken } = await import('../server/auth.js');
  const adminRoutes = (await import('../server/routes/admin.js')).default;
  const express = (await import('express')).default;

  const addEmp = (code, name, dept, role = 'employee', perms = null) => Number(db.prepare(
    'INSERT INTO employees(code, full_name, department, role, username, password_hash, permissions) VALUES (?,?,?,?,?,?,?)')
    .run(code, name, dept, role, code.toLowerCase(), 'x', perms).lastInsertRowid);
  EMP = addEmp('LT1', 'Thợ Một', 'Xưởng');
  EMP2 = addEmp('LT2', 'Thợ Hai', 'Xưởng');
  HOURLY = addEmp('LTG', 'Thợ Giờ', 'Văn phòng');
  db.prepare("UPDATE employees SET att_mode = 'hourly' WHERE id = ?").run(HOURLY);
  const ADM = addEmp('ADM', 'Quản trị', '', 'admin');
  tok.ADM = signToken({ id: ADM, code: 'ADM', role: 'admin', full_name: 'Quản trị' });

  // ca kiểu mythuatlt: tăng ca từ 18:00, TC1 180' (18–21h), TC2 180' (21–0h), TC3 = phần còn lại (từ 0h); hệ số TC2–4 để 0 = theo hệ số NV
  const SH = Number(db.prepare(`INSERT INTO shifts(name, start_time, end_time, break_minutes, ot_tier1_min, ot_tier2_min, ot_tier3_min)
    VALUES ('HC thử', '07:00', '17:30', 150, 180, 180, 0)`).run().lastInsertRowid);
  // đơn giá ngày 480.000 ÷ 8 giờ = 60.000 đ / giờ; hệ số tăng ca 1,5 / 2 / 3
  const cfg = db.prepare(`INSERT INTO salary_configs(employee_id, basic_salary, daily_rate, working_days_per_month, ot_rate_weekday, ot_rate_weekend, ot_rate_holiday, allowance, hourly_rate)
    VALUES (?, 0, 480000, 26, 1.5, 2, 3, ?, ?)`);
  cfg.run(EMP, 100000, 0); cfg.run(EMP2, 0, 0); cfg.run(HOURLY, 0, 50000);
  const att = db.prepare('INSERT INTO attendance(employee_id, work_date, shift_id, work_unit, work_minutes, ot_min, ot_type) VALUES (?,?,?,?,?,?,?)');
  att.run(EMP, '2026-11-02', SH, 1, 480, 240, 'thuong');      // về 22h → mốc 1: 3 giờ, mốc 2: 1 giờ
  att.run(EMP, '2026-11-03', SH, 0.5, 240, 480, 'thuong');    // về 02h → 3 / 3 / 2 giờ
  att.run(EMP, '2026-11-08', SH, 0, 0, 120, 'cuoi_tuan');     // Chủ nhật: 2 giờ tăng ca ngày nghỉ
  att.run(EMP, '2026-11-10', SH, 0, 0, 0, 'thuong');          // dòng trống (vắng) — không tính ngày ăn
  att.run(EMP2, '2026-11-02', SH, 1, 480, 0, 'thuong');
  att.run(HOURLY, '2026-11-02', null, 0, 240, 0, 'thuong');
  att.run(HOURLY, '2026-11-03', null, 0, 300, 0, 'thuong');

  const app = express(); app.use(express.json());
  app.use('/api/admin', adminRoutes);
  server = await moCong(app);
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server?.close(); try { db.close(); } catch {} for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} } });

// Lương tăng ca CŨ: 12 giờ ngày thường × 60.000 × 1,5 + 2 giờ ngày nghỉ × 60.000 × 2
const OT_OLD = 12 * 60000 * 1.5 + 2 * 60000 * 2;            // 1.320.000
const WORK = 1.5 * 480000;                                   // 720.000

test('tắt công tắc (mặc định): điền tiền ăn / đơn giá mốc / trừ khác cũng KHÔNG đổi bảng lương', () => {
  assert.equal(getSetting('pay_extra'), null);
  const before = pay();
  assert.equal(before.otSalary, OT_OLD);
  assert.equal(before.gross, WORK + OT_OLD + 100000);
  assert.equal(before.net, before.gross);
  db.prepare("UPDATE salary_configs SET food_allowance = 25000, food_mode = 'day', ot_pay1 = 30000, ot_pay2 = 40000, ot_pay3 = 50000 WHERE employee_id = ?").run(EMP);
  db.prepare("INSERT INTO payroll_extra(employee_id, period_from, period_to, deduct_other) VALUES (?, ?, ?, 150000)").run(EMP, FROM, TO);
  const off = pay();
  assert.deepEqual(off, before);
  for (const k of ['extra', 'foodAllowance', 'deductOther', 'otLines']) assert.equal(off[k], undefined, k);
  db.prepare('DELETE FROM payroll_extra').run();
});

test('bật: tăng ca tính theo đơn giá VNĐ / giờ từng mốc; mốc để 0 vẫn theo hệ số; ngày nghỉ / lễ riêng', () => {
  setSetting('pay_extra', '1');
  const p = pay();
  // mốc 1: 6 giờ × 30.000 · mốc 2: 4 giờ × 40.000 · mốc 3: 2 giờ × 50.000 · CN chưa đặt đơn giá: 2 giờ × 60.000 × 2
  assert.equal(p.otSalary, 6 * 30000 + 4 * 40000 + 2 * 50000 + 240000);
  assert.deepEqual(p.otLines, [
    { label: 'Tăng ca mốc 1', hours: 6, rate: 30000, amount: 180000, own: 1 },
    { label: 'Tăng ca mốc 2', hours: 4, rate: 40000, amount: 160000, own: 1 },
    { label: 'Tăng ca mốc 3', hours: 2, rate: 50000, amount: 100000, own: 1 },
    { label: 'Tăng ca ngày nghỉ', hours: 2, rate: 120000, amount: 240000, own: 0 },
  ]);
  assert.deepEqual(p.otTierHours, [6, 4, 2, 0]);
  // mốc 2 để 0 → theo hệ số ngày thường 1,5 × 60.000 = 90.000 / giờ
  db.prepare('UPDATE salary_configs SET ot_pay2 = 0, ot_pay_weekend = 70000 WHERE employee_id = ?').run(EMP);
  const q = pay();
  assert.equal(q.otSalary, 180000 + 4 * 90000 + 100000 + 2 * 70000);
  assert.deepEqual(q.otLines.map((l) => [l.rate, l.own]), [[30000, 1], [90000, 0], [50000, 1], [70000, 1]]);
  db.prepare('UPDATE salary_configs SET ot_pay2 = 40000, ot_pay_weekend = 0 WHERE employee_id = ?').run(EMP);
  // NV không đặt đơn giá nào: y như cũ dù công tắc bật
  const p2 = pay(EMP2);
  assert.equal(p2.otSalary, 0); assert.equal(p2.net, 480000); assert.equal(p2.foodAllowance, 0); assert.equal(p2.deductOther, 0);
});

test('bật: tiền ăn theo ngày đi làm (kể cả CN tăng ca) / theo số công / cố định cả kỳ', () => {
  const ot = 6 * 30000 + 4 * 40000 + 2 * 50000 + 240000;
  let p = pay();
  assert.equal(p.foodDays, 3);                                // 02, 03, 08 — ngày 10 trống không tính
  assert.equal(p.foodAllowance, 3 * 25000);
  assert.equal(p.gross, WORK + ot + 100000 + 75000);
  assert.equal(p.net, p.gross);
  db.prepare("UPDATE salary_configs SET food_mode = 'unit' WHERE employee_id = ?").run(EMP);
  assert.equal(pay().foodAllowance, 1.5 * 25000);
  db.prepare("UPDATE salary_configs SET food_mode = 'month' WHERE employee_id = ?").run(EMP);
  assert.equal(pay().foodAllowance, 25000);
  db.prepare("UPDATE salary_configs SET food_mode = 'day' WHERE employee_id = ?").run(EMP);
  // chế độ theo giờ: tiền ăn theo số ngày có công
  db.prepare('UPDATE salary_configs SET food_allowance = 20000 WHERE employee_id = ?').run(HOURLY);
  const h = pay(HOURLY);
  assert.equal(h.hourly, true); assert.equal(h.foodAllowance, 40000);
  assert.equal(h.gross, 9 * 50000 + 40000);
});

test('bật: trừ khác theo đúng kỳ; 0 + không lý do = xoá; tiền gõ "150.000" đọc đúng; số âm / kỳ sai bị chặn', () => {
  const g = pay().gross;
  assert.deepEqual(P.setDeduct(EMP, FROM, TO, '150.000', ' Tạm ứng '), { deduct_other: 150000, note: 'Tạm ứng' });
  const p = pay();
  assert.equal(p.deductOther, 150000); assert.equal(p.deductNote, 'Tạm ứng');
  assert.equal(p.gross, g); assert.equal(p.net, g - 150000);
  assert.equal(pay(EMP, '2026-11-01', '2026-11-29').deductOther, 0, 'kỳ khác không dính');
  assert.throws(() => P.setDeduct(EMP, FROM, TO, '-5'), /không hợp lệ/);
  assert.throws(() => P.setDeduct(EMP, TO, FROM, 1000), /Kỳ lương/);
  assert.throws(() => P.setDeduct(999999, FROM, TO, 1000), /Không tìm thấy/);
  P.setDeduct(EMP, FROM, TO, 0, '');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payroll_extra').get().n, 0);
  assert.deepEqual(P.cleanExtraFields({ ot_pay1: '30.000', food_mode: 'lạ', food_allowance: '' }), { ot_pay1: 30000, food_mode: 'day', food_allowance: 0 });
  assert.throws(() => P.cleanExtraFields({ ot_pay2: -1 }), /không hợp lệ/);
});

test('API: công tắc trong Cài đặt; lưu đơn giá từng người; giao diện cũ lưu lương không xoá ô mới; sửa hàng loạt; trừ khác; báo cáo có cột mới', async () => {
  setSetting('pay_extra', '0');
  assert.equal(ok(await call('GET', '/admin/settings', { token: tok.ADM })).pay_extra, '0');
  assert.equal(ok(await call('GET', `/admin/payroll?month=2026-11`, { token: tok.ADM })).extra, false);
  assert.equal((await call('PUT', '/admin/payroll/deduct', { token: tok.ADM, body: { employee_id: EMP, from: FROM, to: TO, amount: 1000 } })).status, 400);
  ok(await call('PUT', '/admin/settings', { token: tok.ADM, body: { pay_extra: true } }));
  assert.equal(getSetting('pay_extra'), '1');

  // lưu 1 người kèm ô mới
  ok(await call('PUT', `/admin/salary/${EMP2}`, { token: tok.ADM, body: { daily_rate: 480000, working_days_per_month: 26, ot_rate_weekday: 1.5, ot_rate_weekend: 2, ot_rate_holiday: 3, food_allowance: '30.000', food_mode: 'unit', ot_pay1: 35000, ot_pay3: 55000 } }));
  let s = ok(await call('GET', '/admin/salary', { token: tok.ADM }));
  assert.equal(s.extra, true);
  let r2 = s.rows.find((r) => r.employee_id === EMP2);
  assert.deepEqual([r2.food_allowance, r2.food_mode, r2.ot_pay1, r2.ot_pay2, r2.ot_pay3], [30000, 'unit', 35000, 0, 55000]);
  // giao diện cũ (không gửi ô mới) lưu lại lương → ô mới giữ nguyên
  ok(await call('PUT', `/admin/salary/${EMP2}`, { token: tok.ADM, body: { daily_rate: 500000, working_days_per_month: 26, ot_rate_weekday: 1.5, ot_rate_weekend: 2, ot_rate_holiday: 3 } }));
  r2 = ok(await call('GET', '/admin/salary', { token: tok.ADM })).rows.find((r) => r.employee_id === EMP2);
  assert.deepEqual([r2.daily_rate, r2.food_allowance, r2.ot_pay1], [500000, 30000, 35000]);
  assert.equal((await call('PUT', `/admin/salary/${EMP2}`, { token: tok.ADM, body: { ot_pay1: -3 } })).status, 400);

  // sửa hàng loạt bộ phận Xưởng: chỉ ô tiền ăn, ô khác giữ nguyên
  ok(await call('POST', '/admin/salary/bulk', { token: tok.ADM, body: { dept: 'Xưởng', fields: { food_allowance: 22000, food_mode: 'day' } } }));
  s = ok(await call('GET', '/admin/salary', { token: tok.ADM }));
  const r1 = s.rows.find((r) => r.employee_id === EMP); r2 = s.rows.find((r) => r.employee_id === EMP2);
  assert.deepEqual([r1.food_allowance, r1.food_mode, r1.ot_pay1, r1.allowance], [22000, 'day', 30000, 100000]);
  assert.deepEqual([r2.food_allowance, r2.food_mode, r2.ot_pay1, r2.daily_rate], [22000, 'day', 35000, 500000]);

  // trừ khác qua API → bảng lương trả thực lĩnh đã trừ
  ok(await call('PUT', '/admin/payroll/deduct', { token: tok.ADM, body: { employee_id: EMP, from: FROM, to: TO, amount: '200.000', note: 'Đồng phục' } }));
  const pr = ok(await call('GET', `/admin/payroll?month=2026-11`, { token: tok.ADM }));
  assert.equal(pr.extra, true);
  const row = pr.rows.find((r) => r.emp.id === EMP).pay;
  assert.equal(row.deductOther, 200000); assert.equal(row.deductNote, 'Đồng phục');
  assert.equal(row.foodAllowance, 3 * 22000);
  assert.equal(row.net, row.gross - 200000);

  // báo cáo Bảng lương (Excel): thêm Tiền ăn, Trừ khác, Lý do trừ ngay trước Thực lĩnh
  const rep = buildReportData('payroll', FROM, TO, {});
  const keys = rep.columns.map((c) => c.key);
  assert.deepEqual(keys.slice(-5), ['allow', 'food', 'deduct', 'deductnote', 'net']);
  const rr = rep.rows.find((x) => x.code === 'LT1');
  assert.equal(rr.deduct, (200000).toLocaleString('vi-VN')); assert.equal(rr.deductnote, 'Đồng phục');
  assert.equal(rr.net, row.net.toLocaleString('vi-VN'));
  // tắt lại: báo cáo y như cũ
  setSetting('pay_extra', '0');
  assert.ok(!buildReportData('payroll', FROM, TO, {}).columns.some((c) => c.key === 'food'));
});
