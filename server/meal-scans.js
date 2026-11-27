// BÁO CÁO CHI TIẾT LƯỢT ĂN (Suất ăn › Báo cáo › 5): mỗi lượt quét máy chấm ăn TRONG giờ ăn = 1 dòng — mã NV, tên, bộ phận, máy, bữa,
// đơn giá, ngày vào làm / nghỉ việc, quốc tịch, loại NV, ngày + giờ ăn, trạng thái. Lọc bộ phận / khoảng ngày / bữa / trạng thái, xuất Excel.
// Chỉ ĐỌC device_punches + attendance + hồ sơ NV; không ghi gì. Trạng thái tính lúc xem (bảng công cập nhật → trạng thái tự đổi):
//   · lượt ĐẦU của 1 người trong 1 bữa được tính; lượt sau = "Quẹt lặp (không tính)" (máy mất mạng chưa kịp khoá chéo…)
//   · bữa TĂNG CA (meal_shifts.ot_need_min > 0): đủ / không đủ / chờ xác minh theo tăng ca thực tế của ngày công (meal-rules otMealStatus)
//   · người đã nghỉ việc / bị khoá, Số ID chưa khớp NV → trạng thái riêng để HR xem
import { db, getSetting, deptWithChildren } from './db.js';
import { listShifts, needRange } from './meal.js';
import { shiftForPunch, addDaysIso, NON_MACHINE_SERIALS, SCAN_STATUS, mergeAttRows, pickAttDay, otMealStatus } from './meal-rules.js';

const VN_MS = 7 * 3600000;
const VERIFY = { 0: 'Mật mã', 1: 'Vân tay', 2: 'Thẻ', 3: 'Mật mã', 4: 'Thẻ', 15: 'Khuôn mặt', 25: 'Lòng bàn tay' };
const noAcc = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
export const unitPrice = () => Math.max(0, parseInt(getSetting('meal_unit_price', '0'), 10) || 0);
const mealSerials = () => String(getSetting('meal_serials', '')).split(',').map((s) => s.trim()).filter(Boolean);

// Nhóm lọc trạng thái: '' = tất cả; 'ok' = đủ điều kiện; còn lại theo đúng mã trạng thái
const STATUS_KEYS = Object.keys(SCAN_STATUS);

export function mealScans({ from, to, dept = '', shift = '', status = '', q = '', now = new Date() } = {}) {
  needRange(from, to, 31);
  const nowIso = now.toISOString();
  const shifts = listShifts();
  const price = unitPrice();
  // lượt quét: từ 00:00 ngày đầu tới hết ngày sau ngày cuối (bữa qua đêm)
  const lo = new Date(Date.parse(from + 'T00:00:00Z') - VN_MS).toISOString();
  const hi = new Date(Date.parse(addDaysIso(to, 2) + 'T00:00:00Z') - VN_MS).toISOString();
  const only = mealSerials();
  const punches = db.prepare(`SELECT p.serial, p.pin, p.punch_at, p.verify, p.employee_id FROM device_punches p
      WHERE p.punch_at >= ? AND p.punch_at < ? AND p.serial NOT IN (${NON_MACHINE_SERIALS.map(() => '?').join(',')})
      ${only.length ? `AND p.serial IN (${only.map(() => '?').join(',')})` : ''} ORDER BY p.punch_at`).all(lo, hi, ...NON_MACHINE_SERIALS, ...only);

  // NV (kể cả đã khoá / nghỉ) + hồ sơ: khớp lượt chưa gán NV (NV bị khoá thì lượt không gán) theo Số ID máy → mã NV
  const emps = new Map(), byPin = new Map(), byCode = new Map();
  for (const e of db.prepare(`SELECT e.id, e.code, e.full_name, IFNULL(e.department, '') department, e.active, IFNULL(e.device_pin, '') device_pin,
      IFNULL(e.start_date, '') start_date, IFNULL(e.leave_date, '') leave_date, IFNULL(h.nationality, '') nationality, IFNULL(h.emp_type, '') emp_type
      FROM employees e LEFT JOIN hr_profiles h ON h.employee_id = e.id`).all()) {
    emps.set(e.id, e);
    if (e.device_pin && (!byPin.has(e.device_pin) || e.active)) byPin.set(e.device_pin, e);
    if (!byCode.has(e.code) || e.active) byCode.set(e.code, e);
  }
  const duCode = new Map(db.prepare("SELECT pin, code FROM device_users WHERE IFNULL(code, '') <> ''").all().map((r) => [r.pin, r.code]));
  const empOf = (p) => (p.employee_id && emps.get(p.employee_id)) || byPin.get(p.pin) || byCode.get(p.pin) || (duCode.has(p.pin) ? byCode.get(duCode.get(p.pin)) : null) || null;
  const devs = new Map(db.prepare('SELECT serial, name, machine_number FROM push_devices').all().map((d) => [d.serial, d]));

  // bảng công (chỉ khi có bữa tăng ca): 'NV|ngày' → dòng đã gộp
  const needAtt = shifts.some((s) => s.ot_need_min > 0);
  const att = new Map();
  if (needAtt) {
    const g = new Map();
    for (const a of db.prepare(`SELECT employee_id, work_date, check_in_at, check_out_at, ot_min, ot_raw_min FROM attendance WHERE work_date >= ? AND work_date <= ?`)
      .all(addDaysIso(from, -1), addDaysIso(to, 1))) {
      const k = a.employee_id + '|' + a.work_date;
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(a);
    }
    for (const [k, rows] of g) att.set(k, mergeAttRows(rows));
  }

  const rows = [], seen = new Map();
  let outside = 0;
  for (const p of punches) {
    const hit = shiftForPunch(p.punch_at, shifts);
    const vnDay = new Date(Date.parse(p.punch_at) + VN_MS).toISOString().slice(0, 10);
    if (!hit) { if (vnDay >= from && vnDay <= to) outside++; continue; }
    if (hit.workDate < from || hit.workDate > to) continue;
    const e = empOf(p), sh = hit.shift;
    const key = (e ? 'e' + e.id : 'p' + p.pin) + '|' + hit.workDate + '|' + sh.code;
    const nth = (seen.get(key) || 0) + 1;
    seen.set(key, nth);
    let st, note = '', ot = null;
    if (nth > 1) { st = 'lap'; note = `Quẹt lần ${nth} trong bữa — không tính`; }
    else if (!e) { st = 'la'; note = `Số ID ${p.pin} chưa khớp nhân viên nào`; }
    else if (!e.active || (e.leave_date && e.leave_date <= hit.workDate)) {
      st = 'nghi'; note = e.leave_date && e.leave_date <= hit.workDate ? `Nghỉ việc từ ${e.leave_date.slice(8, 10)}/${e.leave_date.slice(5, 7)}/${e.leave_date.slice(0, 4)}` : 'Nhân viên đang bị khoá';
    } else if (sh.ot_need_min > 0) {
      const d0 = addDaysIso(vnDay, -1);
      const day = pickAttDay([att.get(e.id + '|' + d0), att.get(e.id + '|' + vnDay)], p.punch_at);
      ({ st, ot, note } = otMealStatus(sh.ot_need_min, day, p.punch_at, nowIso));
    } else st = 'du';
    const d = devs.get(p.serial);
    rows.push({
      date: hit.workDate, at: p.punch_at, shift: sh.code, shift_name: sh.name, sort: sh.sort_order ?? 0, ot_meal: sh.ot_need_min > 0,
      employee_id: e?.id ?? null, code: e?.code || p.pin, full_name: e?.full_name || '', department: e?.department || '',
      serial: p.serial, device: d?.name || p.serial, machine_number: d?.machine_number || 0, verify: VERIFY[p.verify] ?? '',
      start_date: e?.start_date || '', leave_date: e?.leave_date || '', nationality: e?.nationality || '', emp_type: e?.emp_type || '',
      status: st, status_text: SCAN_STATUS[st], note, ot, counted: st !== 'lap', price: st !== 'lap' ? price : 0,
    });
  }

  // lọc
  let list = rows;
  if (dept) { const ds = new Set(deptWithChildren([dept]).map((x) => x.normalize('NFC'))); list = list.filter((r) => ds.has(r.department.normalize('NFC'))); }
  if (shift) list = list.filter((r) => r.shift === shift);
  if (status && STATUS_KEYS.includes(status)) list = list.filter((r) => r.status === status);
  if (q) { const n = noAcc(q).trim(); if (n) list = list.filter((r) => noAcc(r.code).includes(n) || noAcc(r.full_name).includes(n)); }
  list.sort((a, b) => a.date.localeCompare(b.date) || a.sort - b.sort || a.at.localeCompare(b.at));

  const by = Object.fromEntries(STATUS_KEYS.map((k) => [k, 0]));
  const byShift = new Map();
  for (const r of list) {
    by[r.status]++;
    if (!byShift.has(r.shift)) byShift.set(r.shift, { shift: r.shift, shift_name: r.shift_name, sort: r.sort, meals: 0, amount: 0 });
    const s = byShift.get(r.shift);
    if (r.counted) { s.meals++; s.amount += r.price; }
  }
  const meals = list.filter((r) => r.counted).length;
  return {
    from, to, price, statuses: SCAN_STATUS, outside,
    shifts: shifts.filter((s) => s.enabled || byShift.has(s.code)).map((s) => ({ code: s.code, name: s.name, ot_need_min: s.ot_need_min || 0 })),
    totals: { rows: list.length, meals, amount: meals * price, by, by_shift: [...byShift.values()].sort((a, b) => a.sort - b.sort) },
    rows: list,
    company: getSetting('company_name', ''),
  };
}
