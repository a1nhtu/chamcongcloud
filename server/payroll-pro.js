// TIỀN LƯƠNG NÂNG CAO (kiểu AMIS Tiền lương) — lớp dữ liệu.
//   · công tắc `pay_pro` (Cài đặt › Cấu hình hiển thị, mặc định TẮT, chỉ tài khoản tổng bật): tắt → API /admin/pay/* trả 403,
//     trang Lương + bảng lương + phiếu lương y như cũ (server/payroll-calc.js KHÔNG đổi, bảng lương nâng cao chỉ ĐỌC kết quả của nó)
//   · công tắc con (trang Lương › Thông số, người có quyền Bảng lương đổi): pay_ins (BH) · pay_tax (thuế TNCN) · pay_adv (tạm ứng)
//     · pay_items (khoản cố định / nhập theo kỳ) · pay_formula (công thức) · pay_approve (gửi duyệt) · pay_app_slip (NV xem phiếu trên app)
//   · chỉ ghi vào bảng riêng pay_* (db.js), không ghi vào chấm công / salary_configs (trừ nút "Lấy lương từ hợp đồng" do người dùng bấm)
import { db, getSetting, setSetting, EMP_IN_PERIOD, adminAttWhere, deptWithChildren } from './db.js';
import { payPeriod, computePayrollForEmployee, getSalaryConfig } from './payroll-calc.js';
import { virtualOt } from './virtual-att.js';
import { leaveTypeOf, leaveDaysIn } from './leave-quota.js';
import { userError } from './util.js';
import {
  normalizeParams, computeSlip, compileComponents, annualSettlement, RESERVED_CODES, SYSTEM_VAR_SET, codeOk, makeCode, COMP_TYPES, COMP_KINDS, COMP_GROUPS,
} from './pay-rules.js';
import { checkFormula, FormulaError } from './pay-formula.js';

export const payProEnabled = () => getSetting('pay_pro', '0') === '1';
export function payGate(req, res, next) {
  if (!payProEnabled() || req.forceVirt) return res.status(403).json({ error: 'Chưa bật Tiền lương nâng cao (tài khoản tổng bật ở Cài đặt › Cấu hình hiển thị)' });
  next();
}

/* ------------------------- công tắc con + thông số ------------------------- */
export const FLAG_KEYS = [
  ['pay_ins', '1', '🛡️ Bảo hiểm (BHXH, BHYT, BHTN, đoàn phí)'],
  ['pay_tax', '1', '🧾 Thuế TNCN (lũy tiến / 10%)'],
  ['pay_adv', '1', '💵 Tạm ứng (trừ vào kỳ lương)'],
  ['pay_items', '1', '🧩 Phụ cấp / thưởng / khấu trừ (cố định, theo công, nhập theo kỳ)'],
  ['pay_formula', '1', '🧮 Khoản tính bằng công thức (kiểu Excel)'],
  ['pay_approve', '0', '✅ Gửi duyệt bảng lương (người có quyền Duyệt bảng lương mới chốt được)'],
  ['pay_app_slip', '0', '📱 Nhân viên xem phiếu lương trên app (+ phản hồi)'],
];
export function payFlags() {
  const g = (k, d) => getSetting(k, d) === '1';
  return {
    ins: g('pay_ins', '1'), tax: g('pay_tax', '1'), adv: g('pay_adv', '1'), items: g('pay_items', '1'),
    formula: g('pay_formula', '1'), approve: g('pay_approve', '0'), app_slip: g('pay_app_slip', '0'),
  };
}
export function saveFlags(b) {
  for (const [k] of FLAG_KEYS) if (b[k] != null) setSetting(k, b[k] && b[k] !== '0' ? '1' : '0');
}
export function getParams() {
  let raw = null;
  try { raw = JSON.parse(getSetting('pay_params', '') || 'null'); } catch {}
  return normalizeParams(raw);
}
export function saveParams(b) {
  const p = normalizeParams({ ...getParams(), ...(b || {}) });
  setSetting('pay_params', JSON.stringify(p));
  return p;
}

const J = (s, d) => { try { const v = JSON.parse(s || ''); return v ?? d; } catch { return d; } };
const R = (n) => Math.round(n || 0);
// Tiền VNĐ: số giữ nguyên; chữ "5.000.000" / "5,000,000 đ" → bỏ MỌI ký tự không phải số (không giữ dấu chấm). neg = cho phép số âm
export function toMoney(v, { neg = false, max = 1e11 } = {}) {
  if (v == null || v === '') return NaN;
  let x;
  if (typeof v === 'number') x = Math.round(v);
  else { const s = String(v).trim(); const d = s.replace(/\D/g, ''); if (!d) return NaN; x = +d * (neg && /^-/.test(s) ? -1 : 1); }
  if (!Number.isFinite(x)) return NaN;
  return Math.max(neg ? -max : 0, Math.min(max, x));
}
const money0 = (v) => { const x = toMoney(v); return Number.isFinite(x) ? x : 0; };
const isPeriod = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || ''));
export function needPeriod(s) { if (!isPeriod(s)) throw userError('Tháng lương không hợp lệ (YYYY-MM)'); return s; }
export function periodRange(period) {
  const [y, m] = period.split('-').map(Number);
  return payPeriod(y, m, parseInt(getSetting('pay_period_start_day', '1'), 10) || 1);
}

/* ------------------------- HỒ SƠ LƯƠNG NV ------------------------- */
const PROF_DEFAULT = { ins_on: 1, ins_salary: 0, union_on: 0, tax_mode: 'progressive', dependents: 0, bank_name: '', bank_account: '', bank_holder: '' };
const TAX_MODES = ['progressive', 'flat10', 'none'];
function hrBank() {   // số tài khoản đã khai ở hồ sơ Nhân sự (nếu có) — dùng khi hồ sơ lương để trống
  try { return new Map(db.prepare("SELECT employee_id, bank_account, bank_name FROM hr_profiles WHERE bank_account <> ''").all().map((r) => [r.employee_id, r])); } catch { return new Map(); }
}
export function profilesMap() {
  return new Map(db.prepare('SELECT * FROM pay_profiles').all().map((r) => [r.employee_id, r]));
}
export function listProfiles() {
  const rows = db.prepare(`
    SELECT e.id AS employee_id, e.code, e.full_name, e.department, e.position, e.start_date,
           c.basic_salary, c.daily_rate, c.working_days_per_month, c.allowance, c.hourly_rate
    FROM employees e LEFT JOIN salary_configs c ON c.employee_id = e.id
    WHERE e.active = 1${adminAttWhere('e.role')}
    ORDER BY e.department, e.full_name`).all();
  const prof = profilesMap(), bank = hrBank();
  return rows.map((r) => {
    const p = { ...PROF_DEFAULT, ...(prof.get(r.employee_id) || {}) };
    const hb = bank.get(r.employee_id);
    return { ...r, ...p, employee_id: r.employee_id, hr_bank_account: hb?.bank_account || '', hr_bank_name: hb?.bank_name || '', has_profile: prof.has(r.employee_id) ? 1 : 0 };
  });
}
export function cleanProfile(b) {
  const o = {};
  if (b.ins_on != null) o.ins_on = b.ins_on && b.ins_on !== '0' ? 1 : 0;
  if (b.ins_salary != null) o.ins_salary = Math.max(0, Math.min(1e10, parseFloat(String(b.ins_salary).replace(/\D/g, '')) || 0));
  if (b.union_on != null) o.union_on = b.union_on && b.union_on !== '0' ? 1 : 0;
  if (b.tax_mode != null) o.tax_mode = TAX_MODES.includes(b.tax_mode) ? b.tax_mode : 'progressive';
  if (b.dependents != null) o.dependents = Math.max(0, Math.min(20, parseInt(b.dependents, 10) || 0));
  for (const k of ['bank_name', 'bank_account', 'bank_holder']) if (b[k] != null) o[k] = String(b[k]).trim().slice(0, 120);
  return o;
}
export function saveProfile(empId, b) {
  const v = cleanProfile(b || {});
  const cur = { ...PROF_DEFAULT, ...(db.prepare('SELECT * FROM pay_profiles WHERE employee_id = ?').get(empId) || {}) };
  const n = { ...cur, ...v };
  db.prepare(`INSERT INTO pay_profiles(employee_id, ins_on, ins_salary, union_on, tax_mode, dependents, bank_name, bank_account, bank_holder, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?, datetime('now'))
    ON CONFLICT(employee_id) DO UPDATE SET ins_on=excluded.ins_on, ins_salary=excluded.ins_salary, union_on=excluded.union_on,
      tax_mode=excluded.tax_mode, dependents=excluded.dependents, bank_name=excluded.bank_name, bank_account=excluded.bank_account,
      bank_holder=excluded.bank_holder, updated_at=datetime('now')`)
    .run(empId, n.ins_on, n.ins_salary, n.union_on, n.tax_mode, n.dependents, n.bank_name, n.bank_account, n.bank_holder);
}

// Lấy lương thoả thuận + lương đóng BH từ hợp đồng lao động đang hiệu lực (phân hệ Nhân sự) — người dùng bấm mới chạy
export async function syncFromContracts(ids) {
  let hr;
  try { hr = await import('./hr.js'); } catch { throw userError('Chưa có phân hệ Nhân sự'); }
  if (getSetting('hr_enabled', '0') !== '1') throw userError('Phân hệ Nhân sự đang tắt — không có hợp đồng để lấy lương');
  const cur = hr.currentContractsByEmp(hr.loadContracts(ids && ids.length ? ids : null));
  let n = 0;
  const out = [];
  db.exec('BEGIN');
  try {
    for (const [eid, { cur: c }] of cur) {
      if (!c) continue;
      const sal = +(c.eff?.salary ?? c.salary) || 0;
      if (sal > 0) {
        const cfg = getSalaryConfig(eid);
        db.prepare(`INSERT INTO salary_configs(employee_id, basic_salary, daily_rate, working_days_per_month, ot_rate_weekday, ot_rate_weekend, ot_rate_holiday, allowance, hourly_rate, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?, datetime('now')) ON CONFLICT(employee_id) DO UPDATE SET basic_salary=excluded.basic_salary, updated_at=datetime('now')`)
          .run(eid, sal, cfg.daily_rate ?? null, cfg.working_days_per_month || 26, cfg.ot_rate_weekday, cfg.ot_rate_weekend, cfg.ot_rate_holiday, cfg.allowance || 0, cfg.hourly_rate || 0);
      }
      const prof = {};
      if (+c.insurance_salary > 0) prof.ins_salary = +c.insurance_salary;
      if (c.ctype === 'dich_vu') prof.tax_mode = 'flat10';
      if (Object.keys(prof).length) saveProfile(eid, prof);
      n++; out.push(eid);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { updated: n };
}

/* ------------------------- THÀNH PHẦN LƯƠNG ------------------------- */
export function listComponents({ activeOnly = false } = {}) {
  const rows = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM pay_emp_components x WHERE x.component_id = c.id AND x.excluded = 0) AS assigned,
      (SELECT COUNT(*) FROM pay_emp_components x WHERE x.component_id = c.id AND x.excluded = 1) AS excluded_n
    FROM pay_components c ${activeOnly ? 'WHERE c.active = 1' : ''} ORDER BY c.active DESC, c.sort, c.id`).all();
  return rows.map((r) => ({ ...r, depts: J(r.depts, []) }));
}
export function cleanComponent(b, id = 0) {
  const name = String(b.name || '').trim().slice(0, 120);
  if (!name) throw userError('Thiếu tên thành phần');
  const code = String(b.code || makeCode(name)).trim().toUpperCase();
  if (!codeOk(code)) throw userError('Mã chỉ gồm CHỮ IN HOA không dấu, số và dấu _ (bắt đầu bằng chữ, 2–40 ký tự)');
  if (RESERVED_CODES.has(code)) throw userError(`Mã ${code} là mã hệ thống — đặt mã khác`);
  if (db.prepare('SELECT id FROM pay_components WHERE code = ? AND id <> ?').get(code, id)) throw userError(`Đã có thành phần mã ${code}`);
  const kind = COMP_KINDS.some(([k]) => k === b.kind) ? b.kind : 'income';
  const value_type = COMP_TYPES.some(([k]) => k === b.value_type) ? b.value_type : 'fixed';
  const formula = String(b.formula || '').trim().slice(0, 2000);
  if (value_type === 'formula') {
    if (!formula) throw userError('Khoản tính bằng công thức cần nhập công thức');
    const others = db.prepare('SELECT code FROM pay_components WHERE id <> ?').all(id).map((r) => r.code);
    const ck = checkFormula(formula, new Set([...SYSTEM_VAR_SET, ...others, code]));
    if (!ck.ok) throw userError('Công thức: ' + ck.error);
  }
  const money = money0;
  const depts = Array.isArray(b.depts) ? b.depts.map((x) => String(x).trim()).filter(Boolean) : [];
  return {
    code, name, grp: COMP_GROUPS.includes(b.grp) ? b.grp : 'Khác', kind, value_type,
    amount: money(b.amount), formula: value_type === 'formula' ? formula : '',
    taxable: kind === 'income' && b.taxable !== false && b.taxable !== 0 && b.taxable !== '0' ? 1 : 0,
    tax_free_cap: kind === 'income' ? money(b.tax_free_cap) : 0,
    ins_include: kind === 'income' && b.ins_include && b.ins_include !== '0' ? 1 : 0,
    show: b.show === false || b.show === 0 || b.show === '0' ? 0 : 1,
    show_zero: b.show_zero && b.show_zero !== '0' ? 1 : 0,
    apply_all: b.apply_all === false || b.apply_all === 0 || b.apply_all === '0' ? 0 : 1,
    depts: depts.length ? JSON.stringify(depts) : '',
    active: b.active === false || b.active === 0 || b.active === '0' ? 0 : 1,
    sort: parseInt(b.sort, 10) || 0,
    note: String(b.note || '').slice(0, 500),
  };
}
const COMP_COLS = ['code', 'name', 'grp', 'kind', 'value_type', 'amount', 'formula', 'taxable', 'tax_free_cap', 'ins_include', 'show', 'show_zero', 'apply_all', 'depts', 'active', 'sort', 'note'];
export function saveComponent(id, b) {
  const v = cleanComponent(b, +id || 0);
  db.exec('BEGIN');
  try {
    if (+id) {
      const old = db.prepare('SELECT * FROM pay_components WHERE id = ?').get(+id);
      if (!old) throw userError('Không tìm thấy thành phần', 404);
      db.prepare(`UPDATE pay_components SET ${COMP_COLS.map((c) => c + ' = ?').join(', ')} WHERE id = ?`).run(...COMP_COLS.map((c) => v[c]), +id);
      // đổi mã → sửa luôn các công thức đang dùng mã cũ
      if (old.code !== v.code) {
        const re = new RegExp(`\\b${old.code}\\b`, 'g');
        for (const o of db.prepare("SELECT id, formula FROM pay_components WHERE value_type = 'formula' AND id <> ?").all(+id))
          if (re.test(o.formula)) db.prepare('UPDATE pay_components SET formula = ? WHERE id = ?').run(o.formula.replace(re, v.code), o.id);
      }
    } else {
      if (!v.sort) v.sort = (db.prepare('SELECT MAX(sort) m FROM pay_components').get().m || 0) + 10;
      id = db.prepare(`INSERT INTO pay_components(${COMP_COLS.join(',')}) VALUES (${COMP_COLS.map(() => '?').join(',')})`).run(...COMP_COLS.map((c) => v[c])).lastInsertRowid;
    }
    compileComponents(loadActiveComps());   // không cho lưu nếu tạo vòng lặp công thức
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    if (e instanceof FormulaError) throw userError(e.message);
    throw e;
  }
  return db.prepare('SELECT * FROM pay_components WHERE id = ?').get(+id);
}
export function deleteComponent(id) {
  const c = db.prepare('SELECT * FROM pay_components WHERE id = ?').get(+id);
  if (!c) throw userError('Không tìm thấy thành phần', 404);
  const re = new RegExp(`\\b${c.code}\\b`);
  const users = db.prepare("SELECT code, formula FROM pay_components WHERE value_type = 'formula' AND id <> ?").all(+id).filter((o) => re.test(o.formula));
  if (users.length) throw userError(`Đang được dùng trong công thức của: ${users.map((u) => u.code).join(', ')}`);
  const used = db.prepare('SELECT COUNT(*) n FROM pay_period_items WHERE component_id = ?').get(+id).n;
  if (used) { db.prepare('UPDATE pay_components SET active = 0 WHERE id = ?').run(+id); return { deleted: false, inactive: true }; }
  db.prepare('DELETE FROM pay_components WHERE id = ?').run(+id);
  return { deleted: true };
}
function loadActiveComps() {
  return db.prepare('SELECT * FROM pay_components WHERE active = 1 ORDER BY sort, id').all().map((r) => ({ ...r, deptList: J(r.depts, []) }));
}
// Khoản mẫu (tạo ở trạng thái NGỪNG DÙNG — bật lên mới tính, để không đổi bảng lương khi chưa xem)
export const SAMPLE_COMPONENTS = [
  { code: 'AN_TRUA', name: 'Phụ cấp ăn trưa', grp: 'Phụ cấp', kind: 'income', value_type: 'per_unit', amount: 30000, taxable: 1, tax_free_cap: 730000, note: 'Tiền ăn giữa ca — phần miễn thuế tối đa 730.000 đ/tháng (kiểm tra lại quy định hiện hành)' },
  { code: 'XANG_XE', name: 'Phụ cấp xăng xe', grp: 'Phụ cấp', kind: 'income', value_type: 'prorate', amount: 500000, taxable: 1 },
  { code: 'DIEN_THOAI', name: 'Phụ cấp điện thoại', grp: 'Phụ cấp', kind: 'income', value_type: 'fixed', amount: 200000, taxable: 1, apply_all: 0 },
  { code: 'TRACH_NHIEM', name: 'Phụ cấp trách nhiệm', grp: 'Phụ cấp', kind: 'income', value_type: 'fixed', amount: 1000000, taxable: 1, ins_include: 1, apply_all: 0, note: 'Phụ cấp lương — tính vào lương đóng BH' },
  { code: 'CHUYEN_CAN', name: 'Thưởng chuyên cần', grp: 'Thưởng', kind: 'income', value_type: 'formula', formula: '=IF(AND(CONG_HUONG_LUONG>=CONG_CHUAN, DI_TRE_LAN=0, VE_SOM_LAN=0, NGAY_NGHI_KHONG_LUONG=0), 300000, 0)', taxable: 1, note: 'Đủ công chuẩn, không đi trễ / về sớm, không nghỉ không lương' },
  { code: 'THUONG', name: 'Thưởng khác', grp: 'Thưởng', kind: 'income', value_type: 'input', taxable: 1 },
  { code: 'PHAT_DI_TRE', name: 'Phạt đi trễ', grp: 'Khấu trừ', kind: 'deduct', value_type: 'formula', formula: '=DI_TRE_LAN*20000' },
  { code: 'KHAU_TRU_KHAC', name: 'Khấu trừ khác', grp: 'Khấu trừ', kind: 'deduct', value_type: 'input' },
];
export function createSamples() {
  let n = 0;
  for (const s of SAMPLE_COMPONENTS) {
    if (db.prepare('SELECT id FROM pay_components WHERE code = ?').get(s.code)) continue;
    saveComponent(0, { ...s, active: 0 });
    n++;
  }
  return n;
}
// Gán NV cho 1 thành phần: rows [{employee_id, amount (null = mặc định), excluded}]
export function compAssignments(compId) {
  return db.prepare('SELECT employee_id, amount, excluded FROM pay_emp_components WHERE component_id = ?').all(+compId);
}
export function saveAssignments(compId, rows, { replace = false } = {}) {
  if (!db.prepare('SELECT id FROM pay_components WHERE id = ?').get(+compId)) throw userError('Không tìm thấy thành phần', 404);
  db.exec('BEGIN');
  try {
    if (replace) db.prepare('DELETE FROM pay_emp_components WHERE component_id = ?').run(+compId);
    for (const r of rows || []) {
      const eid = +r.employee_id;
      if (!eid) continue;
      if (r.remove) { db.prepare('DELETE FROM pay_emp_components WHERE employee_id = ? AND component_id = ?').run(eid, +compId); continue; }
      const amt = r.amount == null || r.amount === '' ? null : money0(r.amount);
      db.prepare(`INSERT INTO pay_emp_components(employee_id, component_id, amount, excluded) VALUES (?,?,?,?)
        ON CONFLICT(employee_id, component_id) DO UPDATE SET amount = excluded.amount, excluded = excluded.excluded`).run(eid, +compId, amt, r.excluded ? 1 : 0);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/* ------------------------- DỮ LIỆU THEO KỲ ------------------------- */
export function periodItems(period) {
  return db.prepare('SELECT employee_id, component_id, amount, note FROM pay_period_items WHERE period = ?').all(period);
}
export function savePeriodItems(period, cells, by) {
  needPeriod(period);
  lockGuard(period, cells.map((c) => +c.employee_id));
  db.exec('BEGIN');
  try {
    for (const c of cells) {
      const eid = +c.employee_id, cid = +c.component_id;
      if (!eid || !cid) continue;
      if (c.amount == null || c.amount === '') { db.prepare('DELETE FROM pay_period_items WHERE period = ? AND employee_id = ? AND component_id = ?').run(period, eid, cid); continue; }
      const v = toMoney(c.amount, { neg: true });
      if (!Number.isFinite(v)) continue;
      db.prepare(`INSERT INTO pay_period_items(period, employee_id, component_id, amount, note, updated_by, updated_at) VALUES (?,?,?,?,?,?, datetime('now'))
        ON CONFLICT(period, employee_id, component_id) DO UPDATE SET amount = excluded.amount, note = excluded.note, updated_by = excluded.updated_by, updated_at = datetime('now')`)
        .run(period, eid, cid, v, String(c.note || '').slice(0, 300), by || '');
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
// Không cho sửa dữ liệu của NV đã nằm trong bảng lương đã chốt của kỳ đó (mở khoá bảng lương trước)
function lockGuard(period, empIds) {
  const ids = [...new Set(empIds.filter(Boolean))];
  if (!ids.length) return;
  const hit = db.prepare(`SELECT r.full_name, s.name FROM pay_sheet_rows r JOIN pay_sheets s ON s.id = r.sheet_id
    WHERE s.period = ? AND s.status = 'locked' AND r.employee_id IN (${ids.map(() => '?').join(',')}) LIMIT 3`).all(period, ...ids);
  if (hit.length) throw userError(`Bảng lương "${hit[0].name}" đã chốt (có ${hit.map((h) => h.full_name).join(', ')}…) — mở khoá bảng lương trước khi sửa dữ liệu kỳ này`);
}

/* ------------------------- TẠM ỨNG ------------------------- */
export function listAdvances(period) {
  return db.prepare(`SELECT a.*, e.code, e.full_name, e.department FROM pay_advances a JOIN employees e ON e.id = a.employee_id
    WHERE a.period = ? ORDER BY e.department, e.full_name, a.adv_date`).all(period);
}
export function saveAdvance(id, b, by) {
  const period = needPeriod(b.period);
  const eid = +b.employee_id;
  if (!eid || !db.prepare('SELECT id FROM employees WHERE id = ?').get(eid)) throw userError('Chọn nhân viên');
  const amount = money0(b.amount);
  if (!amount) throw userError('Số tiền tạm ứng phải lớn hơn 0');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.adv_date || '') ? b.adv_date : '';
  lockGuard(period, [eid]);
  if (+id) {
    const old = db.prepare('SELECT * FROM pay_advances WHERE id = ?').get(+id);
    if (!old) throw userError('Không tìm thấy khoản tạm ứng', 404);
    lockGuard(old.period, [old.employee_id]);
    db.prepare('UPDATE pay_advances SET employee_id = ?, period = ?, adv_date = ?, amount = ?, note = ? WHERE id = ?').run(eid, period, date, amount, String(b.note || '').slice(0, 300), +id);
    return +id;
  }
  return Number(db.prepare('INSERT INTO pay_advances(employee_id, period, adv_date, amount, note, created_by) VALUES (?,?,?,?,?,?)').run(eid, period, date, amount, String(b.note || '').slice(0, 300), by || '').lastInsertRowid);
}
export function deleteAdvance(id) {
  const old = db.prepare('SELECT * FROM pay_advances WHERE id = ?').get(+id);
  if (!old) throw userError('Không tìm thấy khoản tạm ứng', 404);
  lockGuard(old.period, [old.employee_id]);
  db.prepare('DELETE FROM pay_advances WHERE id = ?').run(+id);
}
// Tạm ứng hàng loạt: theo % lương cơ bản hoặc số tiền cố định, cho bộ phận / danh sách NV
export function bulkAdvance(b, by) {
  const period = needPeriod(b.period);
  const pct = parseFloat(b.percent) || 0, fixed = money0(b.amount);
  if (!(pct > 0 && pct <= 100) && !fixed) throw userError('Nhập % lương cơ bản (1–100) hoặc số tiền');
  const emps = pickEmployees(period, { depts: b.depts, ids: b.ids });
  if (!emps.length) throw userError('Không có nhân viên nào');
  lockGuard(period, emps.map((e) => e.id));
  const round = Math.max(0, parseInt(b.round, 10) || 0);
  let n = 0;
  db.exec('BEGIN');
  try {
    for (const e of emps) {
      let amt = fixed || (getSalaryConfig(e.id).basic_salary || 0) * pct / 100;
      if (round) amt = Math.floor(amt / round) * round;
      if (amt <= 0) continue;
      db.prepare('INSERT INTO pay_advances(employee_id, period, adv_date, amount, note, created_by) VALUES (?,?,?,?,?,?)')
        .run(e.id, period, /^\d{4}-\d{2}-\d{2}$/.test(b.adv_date || '') ? b.adv_date : '', R(amt), String(b.note || 'Tạm ứng kỳ').slice(0, 300), by || '');
      n++;
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return n;
}

/* ------------------------- MẪU BẢNG LƯƠNG ------------------------- */
export function listTemplates() {
  return db.prepare('SELECT * FROM pay_templates ORDER BY active DESC, name').all().map((t) => ({ ...t, depts: J(t.depts, []), comp_ids: J(t.comp_ids, []), columns: J(t.columns, []) }));
}
export function saveTemplate(id, b) {
  const name = String(b.name || '').trim().slice(0, 120);
  if (!name) throw userError('Thiếu tên mẫu bảng lương');
  const arr = (a) => (Array.isArray(a) ? a : []);
  const depts = arr(b.depts).map((x) => String(x).trim()).filter(Boolean);
  const comp = arr(b.comp_ids).map(Number).filter(Boolean);
  const cols = arr(b.columns).filter((c) => c && c.key).map((c) => ({ key: String(c.key).slice(0, 60), label: String(c.label || '').slice(0, 80) }));
  const vals = [name, depts.length ? JSON.stringify(depts) : '', comp.length ? JSON.stringify(comp) : '', cols.length ? JSON.stringify(cols) : '', b.active === false || b.active === 0 ? 0 : 1, String(b.note || '').slice(0, 500)];
  if (+id) {
    if (!db.prepare('SELECT id FROM pay_templates WHERE id = ?').get(+id)) throw userError('Không tìm thấy mẫu', 404);
    db.prepare('UPDATE pay_templates SET name = ?, depts = ?, comp_ids = ?, columns = ?, active = ?, note = ? WHERE id = ?').run(...vals, +id);
    return +id;
  }
  return Number(db.prepare('INSERT INTO pay_templates(name, depts, comp_ids, columns, active, note) VALUES (?,?,?,?,?,?)').run(...vals).lastInsertRowid);
}
export function deleteTemplate(id) { db.prepare('DELETE FROM pay_templates WHERE id = ?').run(+id); }

/* ------------------------- TÍNH BẢNG LƯƠNG ------------------------- */
function pickEmployees(period, { depts, ids } = {}) {
  const { from } = periodRange(period);
  const idl = (ids || []).map(Number).filter(Boolean);
  const dl = deptWithChildren((depts || []).filter(Boolean));
  let sql = `SELECT id, code, full_name, department, position, start_date FROM employees WHERE ${EMP_IN_PERIOD}` + adminAttWhere();
  const args = [from];
  if (idl.length) { sql += ` AND id IN (${idl.map(() => '?').join(',')})`; args.push(...idl); }
  else if (dl.length) { sql += ` AND department IN (${dl.map(() => '?').join(',')})`; args.push(...dl); }
  sql += ' ORDER BY department, full_name';
  return db.prepare(sql).all(...args);
}
const monthsBetween = (a, b) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a || '')) return 0;
  const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number);
  return Math.max(0, (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0));
};

// Tính bảng lương nâng cao (không lưu). opts: { depts, ids, templateId, virt }
export function computeProRows(period, opts = {}) {
  needPeriod(period);
  const { from, to } = periodRange(period);
  const params = getParams(), flags = payFlags();
  const tpl = opts.templateId ? db.prepare('SELECT * FROM pay_templates WHERE id = ?').get(+opts.templateId) : null;
  const tplDepts = tpl ? J(tpl.depts, []) : [];
  const emps = pickEmployees(period, { depts: (opts.depts && opts.depts.length) ? opts.depts : tplDepts, ids: opts.ids });
  const ids = emps.map((e) => e.id);
  const tplComp = tpl ? J(tpl.comp_ids, []) : [];
  let comps = loadActiveComps();
  if (tplComp.length) {
    // mẫu chọn thành phần → tính các thành phần đó + những thành phần chúng cần (công thức tham chiếu)
    const want = new Set(comps.filter((c) => tplComp.includes(c.id)).map((c) => c.code));
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of comps) if (want.has(c.code) && c.value_type === 'formula') for (const d of checkFormula(c.formula).vars) if (!want.has(d) && comps.some((x) => x.code === d)) { want.add(d); grew = true; }
    }
    comps = comps.filter((c) => want.has(c.code));
  }
  let compiled;
  try { compiled = compileComponents(comps); } catch (e) { throw userError('Thành phần lương lỗi: ' + e.message); }

  const inList = (col) => (ids.length ? ` AND ${col} IN (${ids.map(() => '?').join(',')})` : ' AND 0');
  const assign = new Map();
  for (const a of db.prepare(`SELECT * FROM pay_emp_components WHERE 1${inList('employee_id')}`).all(...ids)) {
    if (!assign.has(a.employee_id)) assign.set(a.employee_id, new Map());
    assign.get(a.employee_id).set(a.component_id, a);
  }
  const codeById = new Map(comps.map((c) => [c.id, c.code]));
  const items = new Map();
  for (const it of db.prepare(`SELECT * FROM pay_period_items WHERE period = ?${inList('employee_id')}`).all(period, ...ids)) {
    const code = codeById.get(it.component_id);
    if (!code) continue;
    if (!items.has(it.employee_id)) items.set(it.employee_id, {});
    items.get(it.employee_id)[code] = it.amount;
  }
  const adv = new Map(db.prepare(`SELECT employee_id, SUM(amount) s FROM pay_advances WHERE period = ?${inList('employee_id')} GROUP BY employee_id`).all(period, ...ids).map((r) => [r.employee_id, r.s]));
  const late = new Map(db.prepare(`SELECT employee_id, SUM(COALESCE(late_min,0)) lm, SUM(CASE WHEN late_min > 0 THEN 1 ELSE 0 END) ln,
      SUM(COALESCE(early_min,0)) em, SUM(CASE WHEN early_min > 0 THEN 1 ELSE 0 END) en
    FROM attendance WHERE work_date >= ? AND work_date <= ?${inList('employee_id')} GROUP BY employee_id`).all(from, to, ...ids).map((r) => [r.employee_id, r]));
  const unpaid = new Map();
  for (const l of db.prepare(`SELECT employee_id, type, from_date, to_date, half FROM leave_requests WHERE status = 'approved' AND from_date <= ? AND to_date >= ?${inList('employee_id')}`).all(to, from, ...ids)) {
    if (leaveTypeOf(l.type).paid) continue;
    unpaid.set(l.employee_id, (unpaid.get(l.employee_id) || 0) + leaveDaysIn(l, from, to));
  }
  const prof = profilesMap();
  const vmap = opts.virt ? virtualOt(ids, from, to, false, opts.virt) : null;

  const rows = [];
  for (const e of emps) {
    const base = computePayrollForEmployee(e.id, from, to, { virt: opts.virt || 0, vmap });
    const cfg = getSalaryConfig(e.id);
    const a = assign.get(e.id) || new Map();
    const empComps = [];
    for (const c of compiled) {
      if (c.deptList.length && !deptWithChildren(c.deptList).includes(e.department)) continue;
      const x = a.get(c.id);
      if (c.apply_all ? x?.excluded : !(x && !x.excluded)) continue;
      empComps.push(x && x.amount != null ? { ...c, amount: x.amount } : c);
    }
    const lt = late.get(e.id) || {};
    const slip = computeSlip(base, {
      params, flags, profile: prof.get(e.id) || { ins_on: 1, tax_mode: 'progressive', dependents: 0 },
      basic: cfg.basic_salary || 0, workDays: cfg.working_days_per_month || 26,
      comps: empComps, periodItems: items.get(e.id) || {}, advance: adv.get(e.id) || 0,
      vars: {
        DI_TRE_PHUT: lt.lm || 0, DI_TRE_LAN: lt.ln || 0, VE_SOM_PHUT: lt.em || 0, VE_SOM_LAN: lt.en || 0,
        NGAY_NGHI_KHONG_LUONG: Math.round((unpaid.get(e.id) || 0) * 100) / 100,
        THAM_NIEN_THANG: monthsBetween(e.start_date, to),
        MA_NV: e.code, BO_PHAN: e.department || '', CHUC_DANH: e.position || '',
      },
    });
    rows.push({ emp: e, base, slip });
  }
  return { from, to, period, params, flags, comps: compiled.map(({ ast, deps, deptList, ...c }) => c), template: tpl ? { id: tpl.id, name: tpl.name, columns: J(tpl.columns, []) } : null, rows };
}

/* ------------------------- CỘT BẢNG LƯƠNG ------------------------- */
// Ô phẳng của 1 dòng (để hiện bảng + xuất Excel + mẫu bảng lương chọn cột)
export function flatCells(emp, base, slip) {
  const c = {
    MA_NV: emp.code, HO_TEN: emp.full_name, BO_PHAN: emp.department || '', CHUC_DANH: emp.position || '',
    CONG: base.workUnits || 0, NGAY_PHEP: base.paidLeaveDays || 0, GIO_LAM: base.totalHours || 0, GIO_TC: base.otHoursTotal || 0,
    LUONG_CB: base.basicSalary || 0, DON_GIA_NGAY: base.dailyRate || 0, LUONG_DONG_BH: slip.ins_salary,
    LUONG_CONG: base.workSalary || 0, LUONG_PHEP: base.paidLeaveSalary || 0, LUONG_TC: base.otSalary || 0, PHU_CAP: base.allowance || 0,
    TONG_THU_NHAP: slip.income, THU_NHAP_CHIU_THUE: slip.taxable,
    BHXH: slip.ins.bhxh, BHYT: slip.ins.bhyt, BHTN: slip.ins.bhtn, BH_NLD: slip.ins.emp_total, DOAN_PHI: slip.ins.union_fee,
    SO_NPT: slip.dependents, GIAM_TRU_GIA_CANH: slip.family_deduct, THU_NHAP_TINH_THUE: slip.assessable, THUE_TNCN: slip.tax,
    KHAU_TRU_KHAC: slip.other_deduct, TAM_UNG: slip.advance, TONG_KHAU_TRU: slip.total_deduct, THUC_LINH: slip.net,
    BH_DN: slip.ins.co_total, KPCD_DN: slip.ins.co_kpcd, CHI_PHI_CTY: slip.co_cost,
  };
  for (const [k, v] of Object.entries(slip.comp || {})) c[k] = v;
  return c;
}
const COL = (key, label, type = 'money') => ({ key, label, type });
export function defaultColumns(comps, flags, hourly) {
  const cols = [COL('MA_NV', 'Mã NV', 'text'), COL('HO_TEN', 'Họ tên', 'text'), COL('BO_PHAN', 'Bộ phận', 'text')];
  if (hourly) cols.push(COL('GIO_LAM', 'Giờ làm', 'num'));
  else cols.push(COL('CONG', 'Công', 'num'), COL('NGAY_PHEP', 'Phép', 'num'));
  cols.push(COL('GIO_TC', 'Giờ TC', 'num'), COL('LUONG_CB', 'Lương CB'), COL('LUONG_CONG', 'Lương công'), COL('LUONG_PHEP', 'Lương phép'), COL('LUONG_TC', 'Lương TC'), COL('PHU_CAP', 'Phụ cấp'));
  for (const c of comps) if (c.kind === 'income') cols.push(COL(c.code, c.name));
  cols.push(COL('TONG_THU_NHAP', 'Tổng thu nhập'));
  if (flags.ins) cols.push(COL('LUONG_DONG_BH', 'Lương đóng BH'), COL('BHXH', 'BHXH 8%'), COL('BHYT', 'BHYT 1,5%'), COL('BHTN', 'BHTN 1%'), COL('DOAN_PHI', 'Đoàn phí'));
  if (flags.tax) cols.push(COL('THU_NHAP_CHIU_THUE', 'TN chịu thuế'), COL('GIAM_TRU_GIA_CANH', 'Giảm trừ gia cảnh'), COL('THU_NHAP_TINH_THUE', 'TN tính thuế'), COL('THUE_TNCN', 'Thuế TNCN'));
  for (const c of comps) if (c.kind === 'deduct') cols.push(COL(c.code, c.name));
  if (flags.adv) cols.push(COL('TAM_UNG', 'Tạm ứng'));
  cols.push(COL('TONG_KHAU_TRU', 'Tổng khấu trừ'), COL('THUC_LINH', 'Thực lĩnh'));
  for (const c of comps) if (c.kind === 'info') cols.push(COL(c.code, c.name, 'num'));
  if (flags.ins) cols.push(COL('BH_DN', 'BH công ty đóng'));
  return cols;
}
// Danh mục mọi cột có thể chọn ở mẫu bảng lương
export function columnCatalog() {
  const comps = loadActiveComps();
  const all = defaultColumns(comps, { ins: true, tax: true, adv: true }, false);
  const extra = [COL('CHUC_DANH', 'Chức danh', 'text'), COL('GIO_LAM', 'Giờ làm', 'num'), COL('DON_GIA_NGAY', 'Đơn giá ngày'), COL('BH_NLD', 'BH NLĐ (tổng)'),
    COL('SO_NPT', 'Số người phụ thuộc', 'num'), COL('KHAU_TRU_KHAC', 'Khấu trừ khác (tổng)'), COL('KPCD_DN', 'KPCĐ công ty'), COL('CHI_PHI_CTY', 'Chi phí lương công ty')];
  const seen = new Set(all.map((c) => c.key));
  return [...all, ...extra.filter((c) => !seen.has(c.key))];
}
function resolveColumns(tplCols, comps, flags, hourly, rows) {
  const def = defaultColumns(comps, flags, hourly);
  if (tplCols && tplCols.length) {
    const cat = new Map(columnCatalog().map((c) => [c.key, c]));
    return tplCols.map((c) => ({ ...(cat.get(c.key) || COL(c.key, c.key)), label: c.label || cat.get(c.key)?.label || c.key }));
  }
  // bỏ cột khoản không ai có số (gọn bảng) — trừ cột hệ thống chính
  const keep = new Set(['MA_NV', 'HO_TEN', 'BO_PHAN', 'CONG', 'GIO_LAM', 'TONG_THU_NHAP', 'TONG_KHAU_TRU', 'THUC_LINH']);
  return def.filter((c) => keep.has(c.key) || rows.some((r) => r.cells[c.key]));
}

/* ------------------------- BẢNG LƯƠNG ĐÃ LƯU ------------------------- */
const sheetOut = (s) => s && ({ ...s, depts: J(s.depts, {}), totals: J(s.totals, {}), columns: J(s.columns, []), params: undefined });
export function listSheets(period) {
  const rows = period ? db.prepare('SELECT * FROM pay_sheets WHERE period = ? ORDER BY id DESC').all(period)
    : db.prepare('SELECT * FROM pay_sheets ORDER BY period DESC, id DESC LIMIT 200').all();
  return rows.map(sheetOut);
}
export function getSheet(id) {
  const s = db.prepare('SELECT * FROM pay_sheets WHERE id = ?').get(+id);
  if (!s) throw userError('Không tìm thấy bảng lương', 404);
  return s;
}
export function sheetDetail(id) {
  const s = getSheet(id);
  const rows = db.prepare('SELECT * FROM pay_sheet_rows WHERE sheet_id = ? ORDER BY department, full_name').all(+id).map((r) => {
    const d = J(r.data, {});
    return { employee_id: r.employee_id, code: r.code, full_name: r.full_name, department: r.department, position: r.position, net: r.net,
      paid: r.paid, paid_at: r.paid_at, seen_at: r.seen_at, feedback: r.feedback, feedback_at: r.feedback_at, feedback_reply: r.feedback_reply,
      cells: d.cells || {}, slip: d.slip || null, base: d.base || null };
  });
  return { sheet: sheetOut(s), rows, flags: payFlags() };
}
// compute=false: chỉ tạo khung (route gọi tiếp /compute ở luồng phụ để máy chủ không "đứng" với công ty đông người)
export function createSheet(b, by, { compute = true } = {}) {
  const period = needPeriod(b.period);
  const tplId = +b.template_id || null;
  if (tplId && !db.prepare('SELECT id FROM pay_templates WHERE id = ?').get(tplId)) throw userError('Không tìm thấy mẫu bảng lương');
  const scope = { depts: Array.isArray(b.depts) ? b.depts.filter(Boolean) : [], ids: Array.isArray(b.ids) ? b.ids.map(Number).filter(Boolean) : [] };
  const name = String(b.name || '').trim().slice(0, 150) || `Bảng lương tháng ${period.slice(5)}/${period.slice(0, 4)}`;
  const { from, to } = periodRange(period);
  const id = Number(db.prepare('INSERT INTO pay_sheets(period, name, template_id, depts, from_date, to_date, created_by) VALUES (?,?,?,?,?,?,?)')
    .run(period, name, tplId, JSON.stringify(scope), from, to, by || '').lastInsertRowid);
  if (compute) { try { computeSheet(id); } catch (e) { db.prepare('DELETE FROM pay_sheets WHERE id = ?').run(id); throw e; } }
  return id;
}
// Tính lại bảng lương NHÁP và lưu ảnh chụp từng dòng (chốt rồi thì số không tự đổi)
export function computeSheet(id) {
  const s = getSheet(id);
  if (s.status !== 'draft') throw userError('Chỉ tính lại được bảng lương NHÁP (đang chờ duyệt / đã chốt → trả về nháp / mở khoá trước)');
  const scope = J(s.depts, {});
  const data = computeProRows(s.period, { depts: scope.depts, ids: scope.ids, templateId: s.template_id });
  const hourly = data.rows.some((r) => r.base.hourly) && !data.rows.some((r) => !r.base.hourly);
  const out = data.rows.map((r) => ({ ...r, cells: flatCells(r.emp, r.base, r.slip) }));
  const columns = resolveColumns(data.template?.columns, data.comps, data.flags, hourly, out);
  const sum = (k) => out.reduce((t, r) => t + (+r.cells[k] || 0), 0);
  const totals = { count: out.length, income: sum('TONG_THU_NHAP'), ins_emp: sum('BH_NLD'), union: sum('DOAN_PHI'), tax: sum('THUE_TNCN'),
    advance: sum('TAM_UNG'), deduct: sum('TONG_KHAU_TRU'), net: sum('THUC_LINH'), ins_co: sum('BH_DN'), cost: sum('CHI_PHI_CTY') };
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM pay_sheet_rows WHERE sheet_id = ?').run(+id);
    const ins = db.prepare('INSERT INTO pay_sheet_rows(sheet_id, employee_id, code, full_name, department, position, data, net) VALUES (?,?,?,?,?,?,?,?)');
    for (const r of out) {
      const { vars, ...slip } = r.slip;
      ins.run(+id, r.emp.id, r.emp.code, r.emp.full_name, r.emp.department || '', r.emp.position || '', JSON.stringify({ base: r.base, slip, cells: r.cells }), r.slip.net);
    }
    db.prepare("UPDATE pay_sheets SET from_date = ?, to_date = ?, params = ?, totals = ?, columns = ?, computed_at = datetime('now') WHERE id = ?")
      .run(data.from, data.to, JSON.stringify({ params: data.params, flags: data.flags }), JSON.stringify(totals), JSON.stringify(columns), +id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return totals;
}
export function renameSheet(id, name) {
  const s = getSheet(id);
  db.prepare('UPDATE pay_sheets SET name = ? WHERE id = ?').run(String(name || '').trim().slice(0, 150) || s.name, s.id);
}
export function deleteSheet(id) {
  const s = getSheet(id);
  if (s.status === 'locked') throw userError('Bảng lương đã chốt — mở khoá trước khi xoá');
  db.prepare('DELETE FROM pay_sheets WHERE id = ?').run(s.id);
}
// Một NV chỉ nằm trong 1 bảng lương ĐÃ CHỐT của mỗi tháng (tránh trả lương 2 lần)
function dupGuard(s) {
  const dup = db.prepare(`SELECT r.full_name, o.name FROM pay_sheet_rows r JOIN pay_sheets o ON o.id = r.sheet_id
    WHERE o.period = ? AND o.status = 'locked' AND o.id <> ? AND r.employee_id IN (SELECT employee_id FROM pay_sheet_rows WHERE sheet_id = ?) LIMIT 5`).all(s.period, s.id, s.id);
  if (dup.length) throw userError(`Có nhân viên đã nằm trong bảng lương đã chốt "${dup[0].name}" cùng tháng: ${dup.map((d) => d.full_name).join(', ')} — bỏ họ khỏi bảng này hoặc mở khoá bảng kia`);
}
export function sendSheet(id, by) {
  const s = getSheet(id);
  if (s.status !== 'draft') throw userError('Chỉ gửi duyệt bảng lương nháp');
  if (!db.prepare('SELECT 1 FROM pay_sheet_rows WHERE sheet_id = ? LIMIT 1').get(s.id)) throw userError('Bảng lương chưa có nhân viên nào');
  dupGuard(s);
  db.prepare("UPDATE pay_sheets SET status = 'pending', sent_by = ?, sent_at = datetime('now'), reject_note = '' WHERE id = ?").run(by || '', s.id);
}
export function lockSheet(id, by, { approve } = {}) {
  const s = getSheet(id);
  if (approve ? s.status !== 'pending' : !['draft', 'pending'].includes(s.status)) throw userError(approve ? 'Bảng lương không ở trạng thái chờ duyệt' : 'Bảng lương đã chốt rồi');
  if (!db.prepare('SELECT 1 FROM pay_sheet_rows WHERE sheet_id = ? LIMIT 1').get(s.id)) throw userError('Bảng lương chưa có nhân viên nào');
  dupGuard(s);
  db.prepare("UPDATE pay_sheets SET status = 'locked', locked_by = ?, locked_at = datetime('now') WHERE id = ?").run(by || '', s.id);
}
export function rejectSheet(id, note, by) {
  const s = getSheet(id);
  if (s.status !== 'pending') throw userError('Bảng lương không ở trạng thái chờ duyệt');
  db.prepare("UPDATE pay_sheets SET status = 'draft', reject_note = ? WHERE id = ?").run(`${by || ''}: ${String(note || '').slice(0, 300)}`, s.id);
}
export function unlockSheet(id) {
  const s = getSheet(id);
  if (s.status === 'draft') throw userError('Bảng lương đang là nháp');
  db.prepare("UPDATE pay_sheets SET status = 'draft', published = 0, locked_by = '', locked_at = '' WHERE id = ?").run(s.id);
}
export function publishSheet(id, on) {
  const s = getSheet(id);
  if (on && s.status !== 'locked') throw userError('Chỉ gửi phiếu lương của bảng lương đã chốt');
  db.prepare('UPDATE pay_sheets SET published = ? WHERE id = ?').run(on ? 1 : 0, s.id);
  return db.prepare('SELECT employee_id FROM pay_sheet_rows WHERE sheet_id = ?').all(s.id).map((r) => r.employee_id);
}
export function markPaid(id, empIds, paid) {
  const s = getSheet(id);
  if (s.status !== 'locked') throw userError('Chốt bảng lương trước khi đánh dấu đã trả');
  const ids = (empIds || []).map(Number).filter(Boolean);
  const where = ids.length ? ` AND employee_id IN (${ids.map(() => '?').join(',')})` : '';
  db.prepare(`UPDATE pay_sheet_rows SET paid = ?, paid_at = ? WHERE sheet_id = ?${where}`).run(paid ? 1 : 0, paid ? new Date().toISOString() : '', s.id, ...ids);
}
export function replyFeedback(id, empId, reply) {
  db.prepare('UPDATE pay_sheet_rows SET feedback_reply = ? WHERE sheet_id = ? AND employee_id = ?').run(String(reply || '').slice(0, 1000), +id, +empId);
}

/* ------------------------- NHÂN VIÊN XEM PHIẾU LƯƠNG ------------------------- */
export function mySlips(empId) {
  return db.prepare(`SELECT s.id, s.period, s.name, s.from_date, s.to_date, r.net, r.seen_at, r.feedback, r.feedback_reply
    FROM pay_sheet_rows r JOIN pay_sheets s ON s.id = r.sheet_id
    WHERE r.employee_id = ? AND s.status = 'locked' AND s.published = 1 ORDER BY s.period DESC, s.id DESC LIMIT 36`).all(empId);
}
export function mySlip(empId, sheetId) {
  const r = db.prepare(`SELECT r.*, s.period, s.name, s.from_date, s.to_date FROM pay_sheet_rows r JOIN pay_sheets s ON s.id = r.sheet_id
    WHERE r.employee_id = ? AND r.sheet_id = ? AND s.status = 'locked' AND s.published = 1`).get(empId, +sheetId);
  if (!r) throw userError('Không có phiếu lương này', 404);
  if (!r.seen_at) db.prepare("UPDATE pay_sheet_rows SET seen_at = datetime('now') WHERE sheet_id = ? AND employee_id = ?").run(+sheetId, empId);
  const d = J(r.data, {});
  return { sheet_id: r.sheet_id, period: r.period, name: r.name, from: r.from_date, to: r.to_date, code: r.code, full_name: r.full_name, department: r.department,
    base: d.base, slip: d.slip, feedback: r.feedback, feedback_reply: r.feedback_reply, company: getSetting('company_name', '') };
}
export function sendFeedback(empId, sheetId, text) {
  const t = String(text || '').trim().slice(0, 1000);
  if (!t) throw userError('Nhập nội dung phản hồi');
  mySlip(empId, sheetId);
  db.prepare("UPDATE pay_sheet_rows SET feedback = ?, feedback_at = datetime('now') WHERE sheet_id = ? AND employee_id = ?").run(t, +sheetId, empId);
}
export function feedbackList() {
  return db.prepare(`SELECT r.sheet_id, r.employee_id, r.code, r.full_name, r.department, r.feedback, r.feedback_at, r.feedback_reply, s.name, s.period
    FROM pay_sheet_rows r JOIN pay_sheets s ON s.id = r.sheet_id WHERE r.feedback <> '' ORDER BY r.feedback_at DESC LIMIT 200`).all();
}

/* ------------------------- BÁO CÁO (từ bảng lương ĐÃ CHỐT) ------------------------- */
function lockedRows(fromPeriod, toPeriod) {
  return db.prepare(`SELECT r.employee_id, r.code, r.full_name, r.department, r.data, s.period, s.id AS sheet_id
    FROM pay_sheet_rows r JOIN pay_sheets s ON s.id = r.sheet_id
    WHERE s.status = 'locked' AND s.period >= ? AND s.period <= ? ORDER BY r.department, r.full_name, s.period`).all(fromPeriod, toPeriod)
    .map((r) => ({ ...r, d: J(r.data, {}) }));
}
// Tổng hợp thu nhập năm: mỗi NV × 12 tháng (thu nhập, BH, thuế, thực lĩnh)
export function reportYear(year) {
  const y = String(parseInt(year, 10) || new Date().getFullYear());
  const by = new Map();
  for (const r of lockedRows(`${y}-01`, `${y}-12`)) {
    if (!by.has(r.employee_id)) by.set(r.employee_id, { employee_id: r.employee_id, code: r.code, full_name: r.full_name, department: r.department, months: {} });
    const m = by.get(r.employee_id).months;
    const k = r.period.slice(5);
    const s = r.d.slip || {};
    const o = m[k] || (m[k] = { income: 0, ins: 0, tax: 0, net: 0 });
    o.income += s.income || 0; o.ins += (s.ins?.emp_total || 0) + (s.ins?.union_fee || 0); o.tax += s.tax || 0; o.net += s.net || 0;
  }
  return { year: y, rows: [...by.values()] };
}
// Báo cáo bảo hiểm 1 tháng (NLĐ + công ty đóng)
export function reportInsurance(period) {
  needPeriod(period);
  const rows = lockedRows(period, period).filter((r) => r.d.slip?.ins?.base_si > 0 || r.d.slip?.ins_skipped).map((r) => {
    const i = r.d.slip.ins;
    return { code: r.code, full_name: r.full_name, department: r.department, ins_salary: r.d.slip.ins_salary, base_si: i.base_si, base_ui: i.base_ui,
      bhxh: i.bhxh, bhyt: i.bhyt, bhtn: i.bhtn, emp_total: i.emp_total, co_bhxh: i.co_bhxh, co_bhyt: i.co_bhyt, co_bhtn: i.co_bhtn, co_kpcd: i.co_kpcd, co_total: i.co_total,
      union_fee: i.union_fee, skipped: r.d.slip.ins_skipped || '' };
  });
  return { period, rows };
}
// Bảng thuế TNCN 1 tháng
export function reportTax(period) {
  needPeriod(period);
  const rows = lockedRows(period, period).map((r) => {
    const s = r.d.slip || {};
    return { code: r.code, full_name: r.full_name, department: r.department, tax_mode: s.tax_mode, income: s.income, taxable: s.taxable,
      ins_emp: s.ins?.emp_total || 0, dependents: s.dependents, family_deduct: s.family_deduct, assessable: s.assessable, tax: s.tax };
  });
  return { period, rows };
}
// Quyết toán thuế TNCN năm (lũy tiến) — tính lại cả năm, so với số đã khấu trừ hằng tháng
export function reportSettlement(year) {
  const y = String(parseInt(year, 10) || new Date().getFullYear());
  const p = getParams();
  const by = new Map();
  for (const r of lockedRows(`${y}-01`, `${y}-12`)) {
    if (!by.has(r.employee_id)) by.set(r.employee_id, { code: r.code, full_name: r.full_name, department: r.department, months: [] });
    const s = r.d.slip || {};
    by.get(r.employee_id).months.push({ taxable: s.taxable, ins_emp: s.ins?.emp_total || 0, tax: s.tax, dependents: s.dependents, tax_mode: s.tax_mode });
  }
  const rows = [...by.values()].map((e) => ({ code: e.code, full_name: e.full_name, department: e.department,
    flat10: e.months.some((m) => m.tax_mode === 'flat10'), ...annualSettlement(e.months, p) }));
  return { year: y, rows };
}
// Dữ liệu file chuyển khoản ngân hàng của 1 bảng lương đã chốt
export function bankRows(id) {
  const s = getSheet(id);
  if (s.status !== 'locked') throw userError('Chốt bảng lương trước khi xuất file chuyển khoản');
  const prof = profilesMap(), hb = hrBank();
  return { sheet: s, rows: db.prepare('SELECT employee_id, code, full_name, department, net, paid FROM pay_sheet_rows WHERE sheet_id = ? ORDER BY department, full_name').all(s.id).map((r) => {
    const p = prof.get(r.employee_id) || {}, h = hb.get(r.employee_id) || {};
    return { ...r, bank_account: p.bank_account || h.bank_account || '', bank_name: p.bank_name || h.bank_name || '', bank_holder: p.bank_holder || r.full_name };
  }) };
}
