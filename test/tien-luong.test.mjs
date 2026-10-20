// Test TIỀN LƯƠNG NÂNG CAO (kiểu AMIS):
//   · hàm thuần: bộ tính công thức (IF/ROUND/AND/chuỗi/%), vòng lặp công thức, thuế lũy tiến 5 bậc, BH có trần, phiếu lương, quyết toán năm
//   · đầu-cuối qua router thật + CSDL tạm: công tắc mặc định TẮT (403, bảng lương cũ y nguyên), chỉ tài khoản tổng bật;
//     thành phần (cố định / theo công / công thức / nhập theo kỳ) + BH + thuế + tạm ứng → thực lĩnh đúng từng đồng;
//     chốt / duyệt / khoá, chặn sửa dữ liệu kỳ đã chốt, chống trả lương 2 lần, phiếu lương trên app + phản hồi, báo cáo, Excel
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { parseFormula, evalFormula, checkFormula, orderByDeps } from '../server/pay-formula.js';
import { progressiveTax, insuranceCalc, normalizeParams, computeSlip, annualSettlement, compileComponents, DEFAULT_PARAMS, makeCode } from '../server/pay-rules.js';

const ev = (f, v = {}) => evalFormula(parseFormula(f), v);

/* ============================ hàm thuần ============================ */
test('công thức: số, phép tính, ưu tiên, %, ^, chia 0 = 0', () => {
  assert.equal(ev('=1+2*3'), 7);
  assert.equal(ev('(1+2)*3'), 9);
  assert.equal(ev('2^3^1'), 8);
  assert.equal(ev('-5+2'), -3);
  assert.equal(ev('10%*500000'), 50000);
  assert.equal(ev('LUONG/CONG_CHUAN', { LUONG: 26000000, CONG_CHUAN: 0 }), 0);
  assert.equal(ev('A*B', { A: 3 }), 0);   // biến chưa có = 0
});
test('công thức: IF / IFS / AND / OR / NOT, so sánh chuỗi không phân biệt hoa thường', () => {
  const f = '=IF(OR(CHUC_DANH="Giám đốc",CHUC_DANH="Phó Giám đốc"),1000000*(CONG/CONG_CHUAN),IF(CHUC_DANH="Nhân viên",500000*(CONG/CONG_CHUAN),700000))';
  assert.equal(ev(f, { CHUC_DANH: 'giám đốc', CONG: 13, CONG_CHUAN: 26 }), 500000);
  assert.equal(ev(f, { CHUC_DANH: 'Nhân viên', CONG: 26, CONG_CHUAN: 26 }), 500000);
  assert.equal(ev(f, { CHUC_DANH: 'Tổ trưởng' }), 700000);
  assert.equal(ev('IF(AND(DI_TRE_LAN=0; NGHI=0); 300000; 0)', { DI_TRE_LAN: 0, NGHI: 0 }), 300000);   // dấu ; như Excel tiếng Việt
  assert.equal(ev('IFS(X>=30,3,X>=20,2,X>=10,1)', { X: 25 }), 2);
  assert.equal(ev('NOT(1>2)'), 1);
  assert.equal(ev('"A"&"B"'), 'AB');
});
test('công thức: ROUND kiểu Excel (số âm = hàng nghìn), ROUNDUP/DOWN, MIN/MAX/SUM, MOD, CEILING/FLOOR', () => {
  assert.equal(ev('ROUND(1234567,-3)'), 1235000);
  assert.equal(ev('ROUND(2.5)'), 3);
  assert.equal(ev('ROUND(-2.5)'), -3);
  assert.equal(ev('ROUNDUP(1201,-2)'), 1300);
  assert.equal(ev('ROUNDDOWN(1299,-2)'), 1200);
  assert.equal(ev('MIN(AN_CA,730000)', { AN_CA: 900000 }), 730000);
  assert.equal(ev('MAX(1,5,3)'), 5);
  assert.equal(ev('SUM(1,2,3)'), 6);
  assert.equal(ev('MOD(7,3)'), 1);
  assert.equal(ev('CEILING(1234,1000)'), 2000);
  assert.equal(ev('FLOOR(1999,1000)'), 1000);
  assert.equal(ev('ROUND((TONG/CONG_CHUAN)*730000,-3)', { TONG: 22, CONG_CHUAN: 26 }), 618000);
});
test('công thức: báo lỗi tiếng Việt (thiếu ngoặc, hàm lạ, sai số đối số, ký tự lạ, mã không có)', () => {
  assert.throws(() => parseFormula('=(1+2'), /Thiếu dấu "\)"/);
  assert.throws(() => parseFormula('=VLOOKUP(1,2)'), /Không có hàm VLOOKUP/);
  assert.throws(() => parseFormula('=IF(1)'), /IF cần 2–3 đối số/);
  assert.throws(() => parseFormula('=1 $ 2'), /Ký tự "\$"/);
  assert.throws(() => parseFormula('='), /trống/);
  assert.throws(() => parseFormula('=1 2'), /Thừa/);
  const ck = checkFormula('=CONG*X_LA', new Set(['CONG']));
  assert.equal(ck.ok, false);
  assert.match(ck.error, /X_LA/);
});
test('thứ tự tính theo phụ thuộc + phát hiện vòng lặp', () => {
  assert.deepEqual(orderByDeps([{ code: 'C', deps: ['B'] }, { code: 'B', deps: ['A'] }, { code: 'A', deps: [] }]), ['A', 'B', 'C']);
  assert.throws(() => orderByDeps([{ code: 'A', deps: ['B'] }, { code: 'B', deps: ['A'] }]), /vòng lặp/);
  assert.throws(() => compileComponents([{ code: 'X', value_type: 'formula', formula: '=Y+1' }, { code: 'Y', value_type: 'formula', formula: '=X*2' }]), /vòng lặp/);
});
test('mã tự tạo từ tên tiếng Việt', () => {
  assert.equal(makeCode('Phụ cấp ăn trưa'), 'PHU_CAP_AN_TRUA');
  assert.equal(makeCode('Đi lại / xăng xe'), 'DI_LAI_XANG_XE');
  assert.equal(makeCode('13 tháng'), 'K_13_THANG');
});
test('thuế lũy tiến 5 bậc 2026 (≤10tr 5% · 10–30 10% · 30–60 20% · 60–100 30% · >100 35%)', () => {
  const B = DEFAULT_PARAMS.brackets;
  assert.equal(progressiveTax(0, B), 0);
  assert.equal(progressiveTax(10000000, B), 500000);
  assert.equal(progressiveTax(20000000, B), 1500000);
  assert.equal(progressiveTax(50000000, B), 500000 + 2000000 + 4000000);
  assert.equal(progressiveTax(150000000, B), 500000 + 2000000 + 6000000 + 12000000 + 17500000);
  assert.equal(progressiveTax(240000000, B, 12), 12 * 1500000);   // năm: mốc × 12
});
test('bảo hiểm: tỷ lệ 8/1,5/1 + DN 17,5/3/1/2, trần 20× lương cơ sở (BHXH) và 20× tối thiểu vùng (BHTN), đoàn phí tối đa 10% LCS', () => {
  const p = normalizeParams({});
  const a = insuranceCalc(10000000, p);
  assert.deepEqual([a.bhxh, a.bhyt, a.bhtn, a.emp_total], [800000, 150000, 100000, 1050000]);
  assert.deepEqual([a.co_bhxh, a.co_bhyt, a.co_bhtn, a.co_kpcd, a.co_total], [1750000, 300000, 100000, 200000, 2350000]);
  const big = insuranceCalc(200000000, p, { union: true });
  assert.equal(big.base_si, 46800000);                 // 20 × 2.340.000
  assert.equal(big.base_ui, 106200000);                // 20 × 5.310.000 (vùng I)
  assert.equal(big.bhxh, 3744000);
  assert.equal(big.bhtn, 1062000);
  assert.equal(big.union_fee, 234000);                 // 1% × 46,8tr = 468.000 → trần 10% × 2.340.000
  assert.equal(insuranceCalc(10000000, p, { on: false }).emp_total, 0);
  const p3 = normalizeParams({ region: 3 });
  assert.equal(insuranceCalc(200000000, p3).base_ui, 82800000);
});
test('thông số: giá trị sai → về mặc định; biểu thuế không tăng dần → về mặc định', () => {
  const p = normalizeParams({ base_salary: -5, region: 9, emp_rate: { bhxh: 'x' }, brackets: [{ to: 30000000, rate: 5 }, { to: 10000000, rate: 10 }, { to: null, rate: 20 }] });
  assert.equal(p.base_salary, 2340000);
  assert.equal(p.region, 1);
  assert.equal(p.emp_rate.bhxh, 8);
  assert.deepEqual(p.brackets, DEFAULT_PARAMS.brackets);
});
test('phiếu lương: phụ cấp miễn thuế có trần, tăng ca chỉ chịu thuế phần lương thường, 10% cho thời vụ, nghỉ ≥14 ngày không đóng BH', () => {
  const params = normalizeParams({});
  const base = { workUnits: 26, paidLeaveDays: 0, dailyRate: 400000, otHoursTotal: 10, otHoursWeekday: 10, workSalary: 10400000, paidLeaveSalary: 0, otSalary: 750000, allowance: 0, basicSalary: 10400000 };
  const comps = compileComponents([{ code: 'AN', name: 'Ăn trưa', kind: 'income', value_type: 'per_unit', amount: 35000, taxable: 1, tax_free_cap: 730000, show: 1, deptList: [] }]);
  const s = computeSlip(base, { params, flags: { ins: true, tax: true, adv: true, items: true, formula: true }, profile: { ins_on: 1, tax_mode: 'progressive', dependents: 0 }, basic: 10400000, workDays: 26, comps, periodItems: {}, advance: 0 });
  assert.equal(s.comp.AN, 910000);
  assert.equal(s.income, 10400000 + 750000 + 910000);
  assert.equal(s.taxable, 10400000 + 500000 + 180000);   // TC: 10 giờ × 50.000 (phần 1,5 → chỉ 1,0 chịu thuế); ăn trưa vượt 730k
  assert.equal(s.ins.emp_total, 1092000);
  assert.equal(s.tax, 0);                                 // 11,08tr − 1,092tr − 15,5tr < 0
  assert.equal(s.net, s.income - 1092000);
  // thời vụ 10%: tổng ≥ 2tr → 10% thu nhập chịu thuế
  const f10 = computeSlip({ ...base, workUnits: 5, workSalary: 2000000, otSalary: 0, otHoursTotal: 0 }, { params, flags: { ins: true, tax: true }, profile: { ins_on: 1, tax_mode: 'flat10' }, basic: 10400000, workDays: 26, comps: [], periodItems: {}, advance: 0 });
  assert.equal(f10.tax, 200000);
  assert.equal(f10.ins.emp_total, 0);
  assert.match(f10.ins_skipped, /14 ngày/);
  // tắt BH + thuế → chỉ còn thu nhập
  const off = computeSlip(base, { params, flags: { ins: false, tax: false }, profile: { ins_on: 1, tax_mode: 'progressive' }, basic: 10400000, workDays: 26, comps: [], periodItems: {}, advance: 0 });
  assert.equal(off.net, 10400000 + 750000);
});
test('quyết toán năm: thuế tính theo biểu năm, so với số đã khấu trừ', () => {
  const p = normalizeParams({});
  const months = Array.from({ length: 12 }, (_, i) => ({ taxable: i < 6 ? 30000000 : 40000000, ins_emp: 2000000, tax: 0, dependents: 1 }));
  const r = annualSettlement(months, p);
  assert.equal(r.taxable, 420000000);
  assert.equal(r.family_deduct, 15500000 * 12 + 6200000 * 12);
  assert.equal(r.assessable, 420000000 - 24000000 - 260400000);
  assert.equal(r.tax_due, progressiveTax(r.assessable, p.brackets, 12));
  assert.equal(r.diff, r.tax_due);
});

/* ============================ đầu-cuối ============================ */
const DBP = join(tmpdir(), `dgp-tien-luong-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;
let db, initSchema, getSetting, server, base;
const tok = {}, E = {};
const P = '2026-09';
async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null, buf = null; const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) { try { json = await res.json(); } catch {} } else buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, body: json, buf, type: ct };
}
const ok = (r) => { assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
const addEmp = (code, name, dept, role = 'employee', perms = null) => {
  E[code] = Number(db.prepare(`INSERT INTO employees(code, full_name, department, role, username, password_hash, permissions) VALUES (?,?,?,?,?,?,?)`)
    .run(code, name, dept, role, code.toLowerCase(), 'x', perms).lastInsertRowid);
  return E[code];
};
const days = (n, from = 1) => Array.from({ length: n }, (_, i) => `${P}-${String(from + i).padStart(2, '0')}`);
const row = (sheet, code) => sheet.rows.find((r) => r.code === code);

before(async () => {
  ({ db, initSchema, getSetting } = await import('../server/db.js'));
  const { signToken, signMaster } = await import('../server/auth.js');
  const adminRoutes = (await import('../server/routes/admin.js')).default;
  const payRoutes = (await import('../server/routes/pay.js')).default;
  const express = (await import('express')).default;
  initSchema();
  addEmp('A1', 'Nguyễn An', 'Văn phòng');
  addEmp('B1', 'Trần Bình', 'Xưởng');
  addEmp('ADM', 'Admin', '', 'admin');
  addEmp('KT', 'Kế toán', 'Văn phòng', 'manager', JSON.stringify(['salary']));
  addEmp('GD', 'Giám đốc', 'Văn phòng', 'manager', JSON.stringify(['salary', 'pay_approve']));
  for (const c of Object.keys(E)) {
    const e = db.prepare('SELECT role, full_name FROM employees WHERE id=?').get(E[c]);
    tok[c] = signToken({ id: E[c], code: c, role: e.role, full_name: e.full_name });
  }
  tok.master = signMaster('sadmin');
  // lương: A1 26tr / 26 công (1tr/ngày), đi đủ 26 ngày; B1 5,2tr / 26 công, đi 10 ngày (1 ngày trễ 10 phút)
  db.prepare('INSERT INTO salary_configs(employee_id, basic_salary, working_days_per_month) VALUES (?,?,26)').run(E.A1, 26000000);
  db.prepare('INSERT INTO salary_configs(employee_id, basic_salary, working_days_per_month) VALUES (?,?,26)').run(E.B1, 5200000);
  const ins = db.prepare('INSERT INTO attendance(employee_id, work_date, work_unit, work_minutes, late_min) VALUES (?,?,?,?,?)');
  for (const d of days(26)) ins.run(E.A1, d, 1, 480, 0);
  days(10).forEach((d, i) => ins.run(E.B1, d, 1, 480, i === 0 ? 10 : 0));
  const app = express(); app.use(express.json({ limit: '6mb' }));
  app.use('/api/admin', adminRoutes); app.use('/api/pay', payRoutes);
  await new Promise((res) => { server = app.listen(0, '127.0.0.1', res); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server?.close(); for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} } });

let oldPayroll;
test('công tắc mặc định TẮT: không ghi cài đặt, API 403, app NV không có tab, quyền Duyệt bảng lương bị ẩn, admin công ty không bật được', async () => {
  assert.equal(getSetting('pay_pro'), null);
  assert.equal(ok(await call('GET', '/admin/settings', { token: tok.ADM })).pay_pro, '0');
  assert.equal((await call('GET', '/admin/pay/meta', { token: tok.ADM })).status, 403);
  assert.equal((await call('GET', '/admin/pay/sheets', { token: tok.KT })).status, 403);
  assert.equal(ok(await call('GET', '/pay/config', { token: tok.A1 })).enabled, false);
  assert.equal((await call('GET', '/pay/slips', { token: tok.A1 })).status, 403);
  assert.ok(!ok(await call('GET', '/admin/perm-catalog', { token: tok.ADM })).permissions.some(([k]) => k === 'pay_approve'));
  oldPayroll = ok(await call('GET', `/admin/payroll?month=${P}`, { token: tok.KT }));
  assert.equal(oldPayroll.rows.find((r) => r.emp.code === 'A1').pay.net, 26000000);
  await call('PUT', '/admin/settings', { token: tok.ADM, body: { pay_pro: true } });
  assert.equal(getSetting('pay_pro', '0'), '0');
  ok(await call('PUT', '/admin/settings', { token: tok.master, body: { pay_pro: true } }));
  assert.equal(getSetting('pay_pro'), '1');
  assert.ok(ok(await call('GET', '/admin/perm-catalog', { token: tok.ADM })).permissions.some(([k]) => k === 'pay_approve'));
});

test('bật lên: bảng lương CŨ (/admin/payroll) vẫn trả y nguyên — tiền lương nâng cao không đụng công thức cũ', async () => {
  const now = ok(await call('GET', `/admin/payroll?month=${P}`, { token: tok.KT }));
  assert.deepEqual(now.rows, oldPayroll.rows);
});

test('thông số + hồ sơ lương: mặc định đúng luật, lưu được, NV không có quyền lương bị chặn', async () => {
  const m = ok(await call('GET', '/admin/pay/meta', { token: tok.KT }));
  assert.equal(m.params.self_deduct, 15500000);
  assert.equal(m.params.dep_deduct, 6200000);
  assert.equal(m.caps.si, 46800000);
  assert.equal(m.flags.ins, true); assert.equal(m.flags.approve, false); assert.equal(m.flags.app_slip, false);
  assert.equal((await call('GET', '/admin/pay/meta', { token: tok.A1 })).status, 403);
  ok(await call('PUT', `/admin/pay/profiles/${E.A1}`, { token: tok.KT, body: { dependents: 1, bank_account: '0123456789', bank_name: 'VCB' } }));
  ok(await call('PUT', `/admin/pay/profiles/${E.B1}`, { token: tok.KT, body: { tax_mode: 'flat10' } }));
  const p = ok(await call('GET', '/admin/pay/profiles', { token: tok.KT })).rows;
  assert.equal(p.find((r) => r.code === 'A1').dependents, 1);
  assert.equal(p.find((r) => r.code === 'B1').tax_mode, 'flat10');
  const t = ok(await call('POST', '/admin/pay/calc-test', { token: tok.KT, body: { gross: 30000000, dependents: 0 } }));
  assert.equal(t.ins.emp_total, 3150000);
  assert.equal(t.tax, progressiveTax(30000000 - 3150000 - 15500000, DEFAULT_PARAMS.brackets));
});

test('thành phần lương: tạo / kiểm tra mã, công thức lỗi & vòng lặp bị chặn, khoản mẫu tạo ở trạng thái NGỪNG', async () => {
  ok(await call('POST', '/admin/pay/components', { token: tok.KT, body: { name: 'Ăn trưa', code: 'AN_TRUA', kind: 'income', value_type: 'per_unit', amount: 30000, taxable: true, tax_free_cap: 730000 } }));
  ok(await call('POST', '/admin/pay/components', { token: tok.KT, body: { name: 'Chuyên cần', code: 'CHUYEN_CAN', kind: 'income', value_type: 'formula', formula: '=IF(DI_TRE_LAN=0,500000,0)' } }));
  ok(await call('POST', '/admin/pay/components', { token: tok.KT, body: { name: 'Thưởng', code: 'THUONG', kind: 'income', value_type: 'input' } }));
  ok(await call('POST', '/admin/pay/components', { token: tok.KT, body: { name: 'Phạt', code: 'PHAT', kind: 'deduct', value_type: 'input' } }));
  assert.match((await call('POST', '/admin/pay/components', { token: tok.KT, body: { name: 'X', code: 'CONG', value_type: 'fixed' } })).body.error, /mã hệ thống/);
  assert.match((await call('POST', '/admin/pay/components', { token: tok.KT, body: { name: 'X', code: 'an trua' } })).body.error, /CHỮ IN HOA/);
  assert.match((await call('POST', '/admin/pay/components', { token: tok.KT, body: { name: 'Ăn trưa 2', code: 'AN_TRUA' } })).body.error, /Đã có/);
  assert.match((await call('POST', '/admin/pay/components', { token: tok.KT, body: { name: 'Lỗi', code: 'LOI', value_type: 'formula', formula: '=IF(1' } })).body.error, /Công thức/);
  ok(await call('POST', '/admin/pay/components', { token: tok.KT, body: { name: 'V1', code: 'V1', kind: 'info', value_type: 'formula', formula: '=CONG*2' } }));
  const v2 = ok(await call('POST', '/admin/pay/components', { token: tok.KT, body: { name: 'V2', code: 'V2', kind: 'info', value_type: 'formula', formula: '=V1+1' } })).row;
  const v1 = ok(await call('GET', '/admin/pay/components', { token: tok.KT })).rows.find((c) => c.code === 'V1');
  const loop = await call('PUT', `/admin/pay/components/${v1.id}`, { token: tok.KT, body: { ...v1, formula: '=V2+1' } });
  assert.equal(loop.status, 400); assert.match(loop.body.error, /vòng lặp/);
  // V1 đang được V2 dùng → không xoá được; xoá V2 rồi V1
  assert.match((await call('DELETE', `/admin/pay/components/${v1.id}`, { token: tok.KT })).body.error, /V2/);
  ok(await call('DELETE', `/admin/pay/components/${v2.id}`, { token: tok.KT }));
  ok(await call('DELETE', `/admin/pay/components/${v1.id}`, { token: tok.KT }));
  // thử công thức với 1 NV
  const ck = ok(await call('POST', '/admin/pay/formula/check', { token: tok.KT, body: { formula: '=CONG*AN_TRUA', employee_id: E.A1, period: P } }));
  assert.equal(ck.ok, true); assert.equal(ck.test, 26 * 780000);
  const s = ok(await call('POST', '/admin/pay/components/samples', { token: tok.KT }));
  assert.ok(s.added >= 5);
  assert.ok(ok(await call('GET', '/admin/pay/components', { token: tok.KT })).rows.filter((c) => !['AN_TRUA', 'CHUYEN_CAN', 'THUONG', 'PHAT'].includes(c.code)).every((c) => !c.active));
});

let sheetId;
test('bảng lương: thực lĩnh đúng từng đồng (công + phụ cấp theo công + công thức + nhập theo kỳ + BH + thuế lũy tiến/10% + tạm ứng)', async () => {
  const comps = ok(await call('GET', '/admin/pay/components', { token: tok.KT })).rows;
  const id = (c) => comps.find((x) => x.code === c).id;
  ok(await call('PUT', '/admin/pay/period-items', { token: tok.KT, body: { period: P, cells: [{ employee_id: E.A1, component_id: id('THUONG'), amount: 1000000 }, { employee_id: E.B1, component_id: id('PHAT'), amount: 50000 }] } }));
  ok(await call('POST', '/admin/pay/advances', { token: tok.KT, body: { employee_id: E.A1, period: P, amount: '5.000.000', adv_date: `${P}-15` } }));
  const c = ok(await call('POST', '/admin/pay/sheets', { token: tok.KT, body: { period: P } }));
  sheetId = c.id;
  ok(await call('POST', `/admin/pay/sheets/${sheetId}/compute`, { token: tok.KT }));
  const d = ok(await call('GET', `/admin/pay/sheets/${sheetId}`, { token: tok.KT }));
  const a = row(d, 'A1');
  // A1: 26tr công + ăn trưa 780k (miễn 730k) + chuyên cần 500k + thưởng 1tr
  assert.equal(a.cells.TONG_THU_NHAP, 28280000);
  assert.equal(a.cells.THU_NHAP_CHIU_THUE, 26000000 + 50000 + 500000 + 1000000);
  assert.equal(a.cells.BH_NLD, 2730000);                        // 10,5% × 26tr
  assert.equal(a.cells.GIAM_TRU_GIA_CANH, 15500000 + 6200000);  // 1 người phụ thuộc
  assert.equal(a.cells.THU_NHAP_TINH_THUE, 27550000 - 2730000 - 21700000);
  assert.equal(a.cells.THUE_TNCN, 156000);
  assert.equal(a.cells.TAM_UNG, 5000000);
  assert.equal(a.cells.THUC_LINH, 28280000 - 2730000 - 156000 - 5000000);
  assert.equal(a.cells.BH_DN, 26000000 * 0.235);
  // B1: 10 công × 200k + ăn trưa 300k (miễn thuế), có 1 lần trễ → không chuyên cần; nghỉ 16 ngày → không đóng BH; thời vụ 10%
  const b = row(d, 'B1');
  assert.equal(b.cells.TONG_THU_NHAP, 2300000);
  assert.equal(b.cells.CHUYEN_CAN || 0, 0);
  assert.equal(b.cells.BH_NLD, 0);
  assert.equal(b.cells.THUE_TNCN, 200000);
  assert.equal(b.cells.THUC_LINH, 2300000 - 200000 - 50000);
  assert.match(b.slip.ins_skipped, /14 ngày/);
  assert.equal(d.sheet.totals.net, a.cells.THUC_LINH + b.cells.THUC_LINH + row(d, 'KT').cells.THUC_LINH + row(d, 'GD').cells.THUC_LINH);
  // cột: có khoản đang có số, không có khoản mẫu đang ngừng
  const keys = d.sheet.columns.map((x) => x.key);
  assert.ok(keys.includes('AN_TRUA') && keys.includes('THUE_TNCN') && keys.includes('THUC_LINH'));
  assert.ok(!keys.includes('XANG_XE'));
});

test('tắt công tắc con (BH, thuế, tạm ứng) → bảng lương đơn giản: thực lĩnh = tổng thu nhập − khấu trừ', async () => {
  ok(await call('PUT', '/admin/pay/settings', { token: tok.KT, body: { pay_ins: false, pay_tax: false, pay_adv: false } }));
  ok(await call('POST', `/admin/pay/sheets/${sheetId}/compute`, { token: tok.KT }));
  const a = row(ok(await call('GET', `/admin/pay/sheets/${sheetId}`, { token: tok.KT })), 'A1');
  assert.equal(a.cells.THUC_LINH, 28280000);
  ok(await call('PUT', '/admin/pay/settings', { token: tok.KT, body: { pay_ins: true, pay_tax: true, pay_adv: true } }));
  ok(await call('POST', `/admin/pay/sheets/${sheetId}/compute`, { token: tok.KT }));
});

test('gửi duyệt / duyệt / khoá: kế toán không tự chốt khi bật duyệt, giám đốc duyệt; đã chốt thì không tính lại, không sửa dữ liệu kỳ, không xoá', async () => {
  ok(await call('PUT', '/admin/pay/settings', { token: tok.KT, body: { pay_approve: true } }));
  assert.equal((await call('POST', `/admin/pay/sheets/${sheetId}/lock`, { token: tok.KT })).status, 403);
  ok(await call('POST', `/admin/pay/sheets/${sheetId}/send`, { token: tok.KT }));
  assert.match((await call('POST', `/admin/pay/sheets/${sheetId}/compute`, { token: tok.KT })).body.error, /NHÁP/);
  ok(await call('POST', `/admin/pay/sheets/${sheetId}/reject`, { token: tok.GD, body: { note: 'Xem lại thưởng' } }));
  let s = ok(await call('GET', `/admin/pay/sheets/${sheetId}`, { token: tok.KT })).sheet;
  assert.equal(s.status, 'draft'); assert.match(s.reject_note, /Xem lại thưởng/);
  ok(await call('POST', `/admin/pay/sheets/${sheetId}/send`, { token: tok.KT }));
  ok(await call('POST', `/admin/pay/sheets/${sheetId}/lock`, { token: tok.GD }));
  s = ok(await call('GET', `/admin/pay/sheets/${sheetId}`, { token: tok.KT })).sheet;
  assert.equal(s.status, 'locked');
  const comps = ok(await call('GET', '/admin/pay/components', { token: tok.KT })).rows;
  const r = await call('PUT', '/admin/pay/period-items', { token: tok.KT, body: { period: P, cells: [{ employee_id: E.A1, component_id: comps.find((x) => x.code === 'THUONG').id, amount: 9 }] } });
  assert.equal(r.status, 400); assert.match(r.body.error, /đã chốt/);
  assert.match((await call('POST', '/admin/pay/advances', { token: tok.KT, body: { employee_id: E.A1, period: P, amount: 1000 } })).body.error, /đã chốt/);
  assert.match((await call('DELETE', `/admin/pay/sheets/${sheetId}`, { token: tok.KT })).body.error, /mở khoá/);
  // chấm công đổi sau khi chốt → bảng đã chốt giữ nguyên số
  db.prepare('UPDATE attendance SET work_unit = 0 WHERE employee_id = ?').run(E.A1);
  assert.equal(row(ok(await call('GET', `/admin/pay/sheets/${sheetId}`, { token: tok.KT })), 'A1').cells.THUC_LINH, 20394000);
  db.prepare('UPDATE attendance SET work_unit = 1 WHERE employee_id = ?').run(E.A1);
  // bảng thứ 2 cùng tháng có A1 → không chốt được (chống trả lương 2 lần)
  const s2 = ok(await call('POST', '/admin/pay/sheets', { token: tok.KT, body: { period: P, name: 'Bảng trùng', depts: ['Văn phòng'] } })).id;
  ok(await call('POST', `/admin/pay/sheets/${s2}/compute`, { token: tok.KT }));
  assert.match((await call('POST', `/admin/pay/sheets/${s2}/send`, { token: tok.KT })).body.error, /đã chốt/);
  ok(await call('DELETE', `/admin/pay/sheets/${s2}`, { token: tok.KT }));
  // mở khoá chỉ người duyệt
  assert.equal((await call('POST', `/admin/pay/sheets/${sheetId}/unlock`, { token: tok.KT })).status, 403);
});

test('phiếu lương trên app: phải bật công tắc, chỉ bảng đã chốt + đã gửi, NV chỉ thấy phiếu của mình, phản hồi + trả lời', async () => {
  assert.match((await call('POST', `/admin/pay/sheets/${sheetId}/publish`, { token: tok.KT, body: { notify: false } })).body.error, /Chưa bật/);
  ok(await call('PUT', '/admin/pay/settings', { token: tok.KT, body: { pay_app_slip: true } }));
  assert.equal(ok(await call('GET', '/pay/config', { token: tok.A1 })).enabled, true);
  assert.equal(ok(await call('GET', '/pay/slips', { token: tok.A1 })).rows.length, 0);   // chưa gửi
  ok(await call('POST', `/admin/pay/sheets/${sheetId}/publish`, { token: tok.KT, body: { notify: false } }));
  const list = ok(await call('GET', '/pay/slips', { token: tok.A1 })).rows;
  assert.equal(list.length, 1); assert.equal(list[0].net, 20394000);
  const slip = ok(await call('GET', `/pay/slips/${sheetId}`, { token: tok.A1 }));
  assert.equal(slip.code, 'A1'); assert.equal(slip.slip.tax, 156000);
  assert.equal((await call('GET', `/pay/slips/${sheetId + 999}`, { token: tok.A1 })).status, 404);
  ok(await call('POST', `/pay/slips/${sheetId}/feedback`, { token: tok.A1, body: { text: 'Thưởng tháng này sao ít vậy?' } }));
  const fb = ok(await call('GET', '/admin/pay/feedback', { token: tok.KT })).rows;
  assert.equal(fb[0].code, 'A1');
  ok(await call('POST', `/admin/pay/sheets/${sheetId}/reply`, { token: tok.KT, body: { employee_id: E.A1, reply: 'Đúng quy chế' } }));
  assert.equal(ok(await call('GET', `/pay/slips/${sheetId}`, { token: tok.A1 })).feedback_reply, 'Đúng quy chế');
  assert.ok(ok(await call('GET', `/admin/pay/sheets/${sheetId}`, { token: tok.KT })).rows.find((r) => r.code === 'A1').seen_at);
});

test('trả lương + file chuyển khoản + Excel bảng lương + báo cáo (năm, BH, thuế, quyết toán)', async () => {
  ok(await call('POST', `/admin/pay/sheets/${sheetId}/paid`, { token: tok.KT, body: { ids: [E.A1] } }));
  assert.equal(row(ok(await call('GET', `/admin/pay/sheets/${sheetId}`, { token: tok.KT })), 'A1').paid, 1);
  const bank = await call('GET', `/admin/pay/sheets/${sheetId}/bank.xlsx`, { token: tok.KT });
  assert.equal(bank.status, 200); assert.match(bank.type, /spreadsheetml/);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(bank.buf);
  const txt = []; wb.worksheets[0].eachRow((r) => txt.push(r.values.join('|')));
  assert.ok(txt.some((l) => l.includes('0123456789') && l.includes('20394000')));
  const xl = await call('GET', `/admin/pay/sheets/${sheetId}/export.xlsx`, { token: tok.KT });
  assert.equal(xl.status, 200);
  const y = ok(await call('GET', '/admin/pay/reports/year?year=2026', { token: tok.KT }));
  assert.equal(y.rows.find((r) => r.code === 'A1').m09, 28280000);
  const insr = ok(await call('GET', `/admin/pay/reports/insurance?period=${P}`, { token: tok.KT }));
  assert.equal(insr.rows.find((r) => r.code === 'A1').emp_total, 2730000);
  assert.ok(insr.rows.find((r) => r.code === 'B1').skipped);
  const tax = ok(await call('GET', `/admin/pay/reports/tax?period=${P}`, { token: tok.KT }));
  assert.equal(tax.rows.find((r) => r.code === 'A1').tax, 156000);
  const st = ok(await call('GET', '/admin/pay/reports/settlement?year=2026', { token: tok.KT }));
  assert.equal(st.rows.find((r) => r.code === 'A1').withheld, 156000);
  assert.equal((await call('GET', '/admin/pay/reports/settlement.xlsx?year=2026', { token: tok.KT })).status, 200);
});

test('dữ liệu theo kỳ + tạm ứng nhập Excel: tải file mẫu, điền, nhập lại', async () => {
  const P2 = '2026-10';
  const t = await call('GET', `/admin/pay/period-items/template.xlsx?period=${P2}`, { token: tok.KT });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(t.buf);
  const ws = wb.worksheets[0];
  const head = ws.getRow(1).values;
  const col = head.findIndex((v) => String(v).includes('(THUONG)'));
  assert.ok(col > 0);
  ws.eachRow((r, n) => { if (n > 1 && r.getCell(1).value === 'B1') r.getCell(col).value = 750000; });
  const b64 = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
  const imp = ok(await call('POST', '/admin/pay/period-items/import', { token: tok.KT, body: { period: P2, fileBase64: b64 } }));
  assert.equal(imp.cells, 1);
  const items = ok(await call('GET', `/admin/pay/period-items?period=${P2}`, { token: tok.KT })).items;
  assert.equal(items.find((i) => i.employee_id === E.B1).amount, 750000);
  // tạm ứng hàng loạt 30% lương cơ bản, làm tròn trăm nghìn, bộ phận Xưởng
  const n = ok(await call('POST', '/admin/pay/advances/bulk', { token: tok.KT, body: { period: P2, percent: 30, round: 100000, depts: ['Xưởng'] } })).n;
  assert.equal(n, 1);
  assert.equal(ok(await call('GET', `/admin/pay/advances?period=${P2}`, { token: tok.KT })).rows[0].amount, 1500000);   // 30% × 5,2tr = 1,56tr → 1,5tr
  // mẫu bảng lương: chỉ bộ phận Xưởng, cột tự chọn
  const tid = ok(await call('POST', '/admin/pay/templates', { token: tok.KT, body: { name: 'Khối xưởng', depts: ['Xưởng'], columns: [{ key: 'MA_NV' }, { key: 'HO_TEN', label: 'Tên' }, { key: 'THUC_LINH' }] } })).id;
  const sid = ok(await call('POST', '/admin/pay/sheets', { token: tok.KT, body: { period: P2, template_id: tid } })).id;
  ok(await call('POST', `/admin/pay/sheets/${sid}/compute`, { token: tok.KT }));
  const d = ok(await call('GET', `/admin/pay/sheets/${sid}`, { token: tok.KT }));
  assert.deepEqual(d.rows.map((r) => r.code), ['B1']);
  assert.deepEqual(d.sheet.columns.map((c) => c.label), ['Mã NV', 'Tên', 'Thực lĩnh']);
});

test('tắt lại công tắc chính: trang Lương về như cũ (API 403, app không có tab), dữ liệu lương nâng cao giữ nguyên', async () => {
  ok(await call('PUT', '/admin/settings', { token: tok.master, body: { pay_pro: false } }));
  assert.equal((await call('GET', '/admin/pay/sheets', { token: tok.KT })).status, 403);
  assert.equal(ok(await call('GET', '/pay/config', { token: tok.A1 })).enabled, false);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM pay_sheets').get().n, 2);
  assert.deepEqual(ok(await call('GET', `/admin/payroll?month=${P}`, { token: tok.KT })).rows, oldPayroll.rows);
});
