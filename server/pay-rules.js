// TIỀN LƯƠNG NÂNG CAO — quy tắc thuần (không đụng CSDL): thông số mặc định theo luật, bảo hiểm, thuế TNCN,
// thành phần lương (cố định / theo ngày công / theo công / nhập theo kỳ / công thức), thực lĩnh, quyết toán thuế năm.
// Chỉ dùng khi công tắc `pay_pro` BẬT; tắt thì bảng lương tính y như cũ (server/payroll-calc.js không đổi).
import { parseFormula, evalFormula, formulaVars, orderByDeps, FormulaError } from './pay-formula.js';

/* ======================= THÔNG SỐ MẶC ĐỊNH (sửa được ở trang Thông số) =======================
   · Lương cơ sở 2.340.000 (NĐ 73/2024) — trần BHXH, BHYT = 20 × lương cơ sở
   · Lương tối thiểu vùng 2026 (NĐ 293/2025): I 5.310.000 · II 4.730.000 · III 4.140.000 · IV 3.700.000 — trần BHTN = 20 × LTTV
   · Tỷ lệ BH: NLĐ 8 / 1,5 / 1 — DN 17,5 (gồm 0,5 TNLĐ-BNN) / 3 / 1 + KPCĐ 2 · đoàn phí công đoàn NLĐ 1% (tối đa 10% lương cơ sở)
   · Thuế TNCN từ kỳ tính thuế 2026: giảm trừ 15,5 triệu bản thân + 6,2 triệu/người phụ thuộc (NQ 110/2025/UBTVQH15);
     biểu lũy tiến 5 bậc (Luật Thuế TNCN 2025): ≤10tr 5% · 10–30tr 10% · 30–60tr 20% · 60–100tr 30% · >100tr 35%
   · Khấu trừ 10% với HĐ dưới 3 tháng / thời vụ / cộng tác viên khi trả từ 2.000.000 đ/lần trở lên                       */
export const DEFAULT_PARAMS = Object.freeze({
  base_salary: 2340000,
  region: 1,
  region_min: [5310000, 4730000, 4140000, 3700000],
  si_cap_mult: 20,
  ui_cap_mult: 20,
  emp_rate: { bhxh: 8, bhyt: 1.5, bhtn: 1 },
  co_rate: { bhxh: 17.5, bhyt: 3, bhtn: 1, kpcd: 2 },
  union_fee_pct: 1,
  union_fee_cap_pct: 10,
  si_skip_14: 1,                 // không làm việc & không hưởng lương từ 14 ngày trở lên trong tháng → không đóng BH tháng đó
  self_deduct: 15500000,
  dep_deduct: 6200000,
  brackets: [{ to: 10000000, rate: 5 }, { to: 30000000, rate: 10 }, { to: 60000000, rate: 20 }, { to: 100000000, rate: 30 }, { to: null, rate: 35 }],
  flat_rate: 10,
  flat_min: 2000000,
  flat_base: 'taxable',          // taxable = thu nhập chịu thuế × 10% · total = tổng thu nhập × 10%
  ot_premium_exempt: 1,          // phần tiền tăng ca CAO HƠN lương giờ bình thường được miễn thuế
  round_net: 0,                  // làm tròn thực lĩnh: 0 = tới đồng · 3 = tới nghìn
});

const clampNum = (v, lo, hi, d) => { const x = parseFloat(v); return Number.isFinite(x) && x >= lo && x <= hi ? x : d; };   // ngoài giới hạn → mặc định

// Gộp thông số đã lưu với mặc định + kiểm tra giới hạn (số âm / quá lớn → về mặc định)
export function normalizeParams(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const D = DEFAULT_PARAMS;
  const rate = (o, d) => Object.fromEntries(Object.keys(d).map((k) => [k, clampNum(o?.[k], 0, 50, d[k])]));
  const rm = Array.isArray(r.region_min) && r.region_min.length === 4 ? r.region_min.map((v, i) => clampNum(v, 0, 1e9, D.region_min[i])) : D.region_min.slice();
  let brackets = Array.isArray(r.brackets) ? r.brackets
    .map((b) => ({ to: b?.to == null || b.to === '' ? null : clampNum(b.to, 0, 1e12, null), rate: clampNum(b?.rate, 0, 100, 0) }))
    .filter((b, i, a) => b.to != null || i === a.length - 1) : null;
  if (!brackets || !brackets.length || !bracketsValid(brackets)) brackets = D.brackets.map((b) => ({ ...b }));
  return {
    base_salary: clampNum(r.base_salary, 0, 1e9, D.base_salary),
    region: [1, 2, 3, 4].includes(+r.region) ? +r.region : D.region,
    region_min: rm,
    si_cap_mult: clampNum(r.si_cap_mult, 0, 100, D.si_cap_mult),
    ui_cap_mult: clampNum(r.ui_cap_mult, 0, 100, D.ui_cap_mult),
    emp_rate: rate(r.emp_rate, D.emp_rate),
    co_rate: rate(r.co_rate, D.co_rate),
    union_fee_pct: clampNum(r.union_fee_pct, 0, 10, D.union_fee_pct),
    union_fee_cap_pct: clampNum(r.union_fee_cap_pct, 0, 1000, D.union_fee_cap_pct),
    si_skip_14: r.si_skip_14 == null ? D.si_skip_14 : (r.si_skip_14 && r.si_skip_14 !== '0' ? 1 : 0),
    self_deduct: clampNum(r.self_deduct, 0, 1e9, D.self_deduct),
    dep_deduct: clampNum(r.dep_deduct, 0, 1e9, D.dep_deduct),
    brackets,
    flat_rate: clampNum(r.flat_rate, 0, 100, D.flat_rate),
    flat_min: clampNum(r.flat_min, 0, 1e9, D.flat_min),
    flat_base: r.flat_base === 'total' ? 'total' : 'taxable',
    ot_premium_exempt: r.ot_premium_exempt == null ? D.ot_premium_exempt : (r.ot_premium_exempt && r.ot_premium_exempt !== '0' ? 1 : 0),
    round_net: [0, 1, 2, 3].includes(+r.round_net) ? +r.round_net : D.round_net,
  };
}
// Bậc thuế phải tăng dần, bậc cuối "trở lên" (to = null)
export function bracketsValid(b) {
  if (!Array.isArray(b) || !b.length || b[b.length - 1].to != null) return false;
  for (let i = 0; i < b.length - 1; i++) if (!(b[i].to > (i ? b[i - 1].to : 0))) return false;
  return true;
}

export const regionMin = (p) => p.region_min[(p.region || 1) - 1] || 0;
export const siCap = (p) => p.base_salary * p.si_cap_mult;
export const uiCap = (p) => regionMin(p) * p.ui_cap_mult;
const R = (n) => Math.round(n || 0);

/* ======================= BẢO HIỂM ======================= */
// insSalary: lương đóng BH tháng · on: NV có tham gia BH tháng này · union: NV là đoàn viên (đóng đoàn phí 1%)
export function insuranceCalc(insSalary, p, { on = true, union = false } = {}) {
  const z = { base_si: 0, base_ui: 0, bhxh: 0, bhyt: 0, bhtn: 0, emp_total: 0, co_bhxh: 0, co_bhyt: 0, co_bhtn: 0, co_kpcd: 0, co_total: 0, union_fee: 0 };
  const sal = Math.max(0, +insSalary || 0);
  if (!on || !sal) return z;
  const bs = siCap(p) > 0 ? Math.min(sal, siCap(p)) : sal;
  const bu = uiCap(p) > 0 ? Math.min(sal, uiCap(p)) : sal;
  const e = p.emp_rate, c = p.co_rate;
  const o = {
    base_si: R(bs), base_ui: R(bu),
    bhxh: R(bs * e.bhxh / 100), bhyt: R(bs * e.bhyt / 100), bhtn: R(bu * e.bhtn / 100),
    co_bhxh: R(bs * c.bhxh / 100), co_bhyt: R(bs * c.bhyt / 100), co_bhtn: R(bu * c.bhtn / 100), co_kpcd: R(bs * c.kpcd / 100),
    union_fee: 0,
  };
  if (union) o.union_fee = R(Math.min(bs * p.union_fee_pct / 100, p.base_salary * p.union_fee_cap_pct / 100));
  o.emp_total = o.bhxh + o.bhyt + o.bhtn;
  o.co_total = o.co_bhxh + o.co_bhyt + o.co_bhtn + o.co_kpcd;
  return o;
}

/* ======================= THUẾ TNCN ======================= */
// Thuế lũy tiến từng phần cho thu nhập tính thuế (tháng; năm thì nhân mốc × months)
export function progressiveTax(assessable, brackets, months = 1) {
  let left = Math.max(0, +assessable || 0), prev = 0, tax = 0;
  for (const b of brackets) {
    const top = b.to == null ? Infinity : b.to * months;
    const part = Math.min(left, top - prev);
    if (part <= 0) break;
    tax += part * b.rate / 100;
    left -= part; prev = top;
    if (left <= 0) break;
  }
  return R(tax);
}

/* ======================= BIẾN HỆ THỐNG dùng trong công thức ======================= */
export const SYSTEM_VARS = [
  ['CONG', 'Số công làm việc thực tế trong kỳ'],
  ['NGAY_PHEP', 'Số ngày nghỉ có lương (phép, lễ được hưởng lương…)'],
  ['CONG_HUONG_LUONG', 'Công hưởng lương = CONG + NGAY_PHEP'],
  ['CONG_CHUAN', 'Ngày công chuẩn của tháng (theo cấu hình lương NV)'],
  ['NGAY_NGHI_KHONG_LUONG', 'Số ngày nghỉ không lương đã duyệt trong kỳ'],
  ['GIO_LAM', 'Tổng giờ làm (chế độ tính theo giờ)'],
  ['GIO_TC', 'Tổng giờ tăng ca'], ['GIO_TC_THUONG', 'Giờ tăng ca ngày thường'], ['GIO_TC_NGHI', 'Giờ tăng ca ngày nghỉ'], ['GIO_TC_LE', 'Giờ tăng ca ngày lễ'],
  ['DI_TRE_PHUT', 'Tổng phút đi trễ'], ['DI_TRE_LAN', 'Số lần đi trễ'], ['VE_SOM_PHUT', 'Tổng phút về sớm'], ['VE_SOM_LAN', 'Số lần về sớm'],
  ['LUONG_CB', 'Lương cơ bản / tháng'], ['DON_GIA_NGAY', 'Đơn giá 1 ngày công'], ['DON_GIA_GIO', 'Đơn giá 1 giờ'],
  ['LUONG_CONG', 'Lương theo công'], ['LUONG_PHEP', 'Lương ngày nghỉ có lương'], ['LUONG_TC', 'Tiền tăng ca'], ['PHU_CAP', 'Phụ cấp cố định (ô Phụ cấp ở cấu hình lương)'],
  ['LUONG_DONG_BH', 'Lương đóng bảo hiểm'], ['SO_NPT', 'Số người phụ thuộc'],
  ['THAM_NIEN_THANG', 'Thâm niên (tháng) tính tới cuối kỳ'],
  ['LUONG_CO_SO', 'Lương cơ sở (thông số)'], ['LUONG_TOI_THIEU_VUNG', 'Lương tối thiểu vùng (thông số)'],
  ['MA_NV', 'Mã nhân viên (chữ)'], ['BO_PHAN', 'Bộ phận (chữ)'], ['CHUC_DANH', 'Chức danh (chữ)'],
];
export const SYSTEM_VAR_SET = new Set(SYSTEM_VARS.map(([k]) => k));
// Mã KẾT QUẢ do hệ thống tính sau cùng — thành phần không được trùng mã, công thức không được dùng (tránh vòng lặp)
export const RESULT_CODES = ['TONG_THU_NHAP', 'THU_NHAP_CHIU_THUE', 'BHXH', 'BHYT', 'BHTN', 'DOAN_PHI', 'GIAM_TRU_GIA_CANH', 'THU_NHAP_TINH_THUE', 'THUE_TNCN', 'TAM_UNG', 'TONG_KHAU_TRU', 'THUC_LINH'];
export const RESERVED_CODES = new Set([...SYSTEM_VAR_SET, ...RESULT_CODES]);

export const COMP_KINDS = [['income', 'Thu nhập'], ['deduct', 'Khấu trừ'], ['info', 'Khác (chỉ hiển thị / dùng trong công thức)']];
export const COMP_TYPES = [
  ['fixed', 'Số tiền cố định / tháng'],
  ['prorate', 'Theo ngày công (số tiền × công hưởng lương ÷ công chuẩn)'],
  ['per_unit', 'Theo mỗi công (số tiền × số công)'],
  ['input', 'Nhập theo từng kỳ (thưởng, phạt, truy lĩnh…)'],
  ['formula', 'Công thức'],
];
// Nhóm (giống "Loại thành phần" của AMIS) — chỉ để lọc / sắp xếp
export const COMP_GROUPS = ['Phụ cấp', 'Thưởng', 'Phúc lợi', 'Doanh thu / KPI', 'Khấu trừ', 'Bảo hiểm - Công đoàn', 'Khác'];

export const codeOk = (c) => /^[A-Z][A-Z0-9_]{1,39}$/.test(String(c || ''));
// "Phụ cấp ăn trưa" → "PHU_CAP_AN_TRUA"
export function makeCode(name) {
  return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'K_$1').slice(0, 40) || 'KHOAN';
}

// Biên dịch danh sách thành phần: phân tích công thức 1 lần + thứ tự tính theo phụ thuộc. Lỗi → ném FormulaError (có mã thành phần)
export function compileComponents(comps) {
  const known = new Set([...SYSTEM_VAR_SET, ...comps.map((c) => c.code)]);
  const items = comps.map((c) => {
    if (c.value_type !== 'formula') return { ...c, deps: [] };
    let ast;
    try { ast = parseFormula(c.formula); } catch (e) { throw new FormulaError(`[${c.code}] ${e.message}`); }
    const deps = [...formulaVars(ast)];
    const bad = deps.filter((v) => !known.has(v));
    if (bad.length) throw new FormulaError(`[${c.code}] không có mã: ${bad.join(', ')}`);
    return { ...c, ast, deps };
  });
  const order = orderByDeps(items.map((i) => ({ code: i.code, deps: i.deps })));
  const by = new Map(items.map((i) => [i.code, i]));
  return order.map((code) => by.get(code));
}

/* ======================= PHIẾU LƯƠNG 1 NHÂN VIÊN =======================
   base   : kết quả computePayrollForEmployee (lương công / phép / tăng ca / phụ cấp cũ) — KHÔNG đổi
   ctx    : { params, flags:{ins,tax,adv,items,formula}, profile:{ins_on,ins_salary,union_on,tax_mode,dependents},
              basic, workDays, comps (đã compile + số tiền theo NV), periodItems:{CODE: số}, advance, vars (biến hệ thống thêm) }   */
export function computeSlip(base, ctx) {
  const p = ctx.params;
  const f = ctx.flags || {};
  const prof = ctx.profile || {};
  const hourly = !!base.hourly;
  const workDays = +ctx.workDays || 26;
  const cong = +base.workUnits || 0, phep = +base.paidLeaveDays || 0;
  const hourlyRate = hourly ? (+base.hourlyRate || 0) : (+base.dailyRate || 0) / 8;
  const vars = {
    CONG: cong, NGAY_PHEP: phep, CONG_HUONG_LUONG: cong + phep, CONG_CHUAN: workDays,
    GIO_LAM: hourly ? (+base.totalHours || 0) : 0,
    GIO_TC: +base.otHoursTotal || 0, GIO_TC_THUONG: +base.otHoursWeekday || 0, GIO_TC_NGHI: +base.otHoursWeekend || 0, GIO_TC_LE: +base.otHoursHoliday || 0,
    LUONG_CB: +ctx.basic || 0, DON_GIA_NGAY: +base.dailyRate || 0, DON_GIA_GIO: R(hourlyRate),
    LUONG_CONG: +base.workSalary || 0, LUONG_PHEP: +base.paidLeaveSalary || 0, LUONG_TC: +base.otSalary || 0, PHU_CAP: +base.allowance || 0,
    SO_NPT: +prof.dependents || 0,
    LUONG_CO_SO: p.base_salary, LUONG_TOI_THIEU_VUNG: regionMin(p),
    DI_TRE_PHUT: 0, DI_TRE_LAN: 0, VE_SOM_PHUT: 0, VE_SOM_LAN: 0, NGAY_NGHI_KHONG_LUONG: 0, THAM_NIEN_THANG: 0,
    MA_NV: '', BO_PHAN: '', CHUC_DANH: '',
    ...(ctx.vars || {}),
  };

  // ---- dòng thu nhập hệ thống (y như bảng lương cũ) ----
  const lines = [];
  const otTaxable = p.ot_premium_exempt ? Math.min(+base.otSalary || 0, R((+base.otHoursTotal || 0) * hourlyRate)) : (+base.otSalary || 0);
  const sys = (code, name, amount, taxable) => { if (amount) lines.push({ code, name, kind: 'income', amount: R(amount), taxable: R(taxable), sys: 1, show: 1 }); };
  sys('LUONG_CONG', hourly ? `Lương theo giờ (${base.totalHours || 0} giờ)` : `Lương theo công (${cong} công)`, base.workSalary, base.workSalary);
  sys('LUONG_PHEP', `Lương ngày nghỉ có lương (${phep} ngày)`, base.paidLeaveSalary, base.paidLeaveSalary);
  sys('LUONG_TC', `Tăng ca (${base.otHoursTotal || 0} giờ)`, base.otSalary, otTaxable);
  sys('PHU_CAP', 'Phụ cấp', base.allowance, base.allowance);

  // ---- lương đóng BH: đặt riêng > tự tính (lương cơ bản + các khoản có tick "tính vào lương đóng BH") ----
  const insAuto = !(+prof.ins_salary > 0);
  let insSalary = insAuto ? (+ctx.basic || 0) : +prof.ins_salary;
  vars.LUONG_DONG_BH = insSalary;

  // ---- thành phần lương ----
  const compVal = {};
  const useItems = f.items !== false;
  for (const c of ctx.comps || []) {
    if (c.value_type === 'formula' && !f.formula) continue;   // công tắc Công thức đang tắt → bỏ qua khoản công thức
    if (!useItems && c.value_type !== 'formula') continue;
    let v;
    const has = ctx.periodItems && Object.prototype.hasOwnProperty.call(ctx.periodItems, c.code);
    if (has) v = +ctx.periodItems[c.code] || 0;                // nhập theo kỳ luôn được ưu tiên (sửa tay)
    else if (c.value_type === 'fixed') v = +c.amount || 0;
    else if (c.value_type === 'prorate') v = workDays > 0 ? (+c.amount || 0) * Math.min(1, (cong + phep) / workDays) : 0;
    else if (c.value_type === 'per_unit') v = (+c.amount || 0) * cong;
    else if (c.value_type === 'formula') v = evalFormula(c.ast, { ...vars, ...compVal });
    else v = 0;
    if (typeof v !== 'number') v = parseFloat(v) || 0;   // công thức trả chữ → 0 cho khoản tiền
    v = c.kind === 'info' ? Math.round(v * 100) / 100 : R(v);
    compVal[c.code] = v;
    if (c.ins_include && insAuto && c.kind === 'income') insSalary += c.value_type === 'fixed' || c.value_type === 'prorate' ? (+c.amount || 0) : v;
    if (c.kind === 'info') { lines.push({ code: c.code, name: c.name, kind: 'info', amount: v, taxable: 0, show: c.show ? 1 : 0 }); continue; }
    if (!v) { if (c.show_zero) lines.push({ code: c.code, name: c.name, kind: c.kind, amount: 0, taxable: 0, show: c.show ? 1 : 0 }); continue; }
    let taxable = 0;
    if (c.kind === 'income' && c.taxable) taxable = +c.tax_free_cap > 0 ? Math.max(0, v - +c.tax_free_cap) : v;
    lines.push({ code: c.code, name: c.name, kind: c.kind, amount: v, taxable: R(taxable), show: c.show ? 1 : 0 });
  }
  insSalary = R(insSalary);

  const income = lines.filter((l) => l.kind === 'income').reduce((s, l) => s + l.amount, 0);
  const taxableIncome = lines.filter((l) => l.kind === 'income').reduce((s, l) => s + l.taxable, 0);
  const otherDeduct = lines.filter((l) => l.kind === 'deduct').reduce((s, l) => s + l.amount, 0);

  // ---- bảo hiểm ----
  let insOn = f.ins !== false && prof.ins_on !== 0 && prof.ins_on !== false;
  let insSkipped = '';
  if (insOn && p.si_skip_14 && !hourly && workDays > 0 && (workDays - (cong + phep)) >= 14) { insOn = false; insSkipped = 'Nghỉ không lương từ 14 ngày trở lên — không đóng BH tháng này'; }
  const ins = insuranceCalc(insSalary, p, { on: insOn, union: f.ins !== false && !!prof.union_on });

  // ---- thuế TNCN ----
  const mode = f.tax === false ? 'none' : (prof.tax_mode || 'progressive');
  const deps = Math.max(0, Math.trunc(+prof.dependents || 0));
  let familyDeduct = 0, assessable = 0, tax = 0;
  if (mode === 'progressive') {
    familyDeduct = p.self_deduct + deps * p.dep_deduct;
    assessable = Math.max(0, taxableIncome - ins.emp_total - familyDeduct);
    tax = progressiveTax(assessable, p.brackets);
  } else if (mode === 'flat10') {
    const baseAmt = p.flat_base === 'total' ? income : taxableIncome;
    assessable = income >= p.flat_min ? baseAmt : 0;
    tax = R(assessable * p.flat_rate / 100);
  }

  const advance = f.adv === false ? 0 : R(ctx.advance || 0);
  const totalDeduct = ins.emp_total + ins.union_fee + tax + otherDeduct + advance;
  let net = income - totalDeduct;
  if (p.round_net > 0) { const m = Math.pow(10, p.round_net); net = Math.round(net / m) * m; }

  return {
    lines, comp: compVal,
    income: R(income), taxable: R(taxableIncome),
    ins_salary: insSalary, ins, ins_skipped: insSkipped,
    tax_mode: mode, dependents: deps, family_deduct: R(familyDeduct), assessable: R(assessable), tax,
    other_deduct: R(otherDeduct), advance, total_deduct: R(totalDeduct), net: R(net),
    co_cost: R(income + ins.co_total),   // chi phí lương của công ty = tổng thu nhập + BH phần DN đóng
    vars: { ...vars, LUONG_DONG_BH: insSalary },   // để "Thử công thức" (không lưu vào bảng lương)
  };
}

/* ======================= QUYẾT TOÁN THUẾ TNCN NĂM (1 NV) =======================
   months: [{ taxable, ins_emp, tax, dependents, tax_mode }] các tháng đã chốt trong năm.
   Chỉ quyết toán lũy tiến; tháng thuế 10% vẫn cộng thu nhập & số đã khấu trừ (đúng cách tổ chức trả thu nhập quyết toán thay).  */
export function annualSettlement(months, p) {
  const n = months.length;
  const taxable = months.reduce((s, m) => s + (+m.taxable || 0), 0);
  const insEmp = months.reduce((s, m) => s + (+m.ins_emp || 0), 0);
  const withheld = months.reduce((s, m) => s + (+m.tax || 0), 0);
  const depMonths = months.reduce((s, m) => s + Math.max(0, +m.dependents || 0), 0);
  const family = p.self_deduct * 12 + depMonths * p.dep_deduct;   // bản thân trừ đủ 12 tháng; người phụ thuộc theo số tháng thực có
  const assessable = Math.max(0, taxable - insEmp - family);
  const due = progressiveTax(assessable, p.brackets, 12);
  return { months: n, taxable: R(taxable), ins_emp: R(insEmp), family_deduct: R(family), assessable: R(assessable), tax_due: due, withheld: R(withheld), diff: R(due - withheld) };
}
