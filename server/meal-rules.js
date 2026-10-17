// PHÂN HỆ QUẢN LÝ SUẤT ĂN — quy tắc THUẦN (không mở CSDL) để test không cần DB. Phần dùng CSDL ở server/meal.js.
//
// 3 ca ăn: Trưa · Chiều (tối) · Đêm. Mỗi ca có KHUNG GIỜ CHỐT (from → to, qua nửa đêm được):
//   · mode 'punch' (Trưa, Đêm): số THAM CHIẾU = số người có lượt quẹt máy chấm công TRONG khung giờ chốt (quẹt ngoài khung bị loại)
//   · mode 'ot'    (Chiều)    : KHÔNG đếm chấm công; đối chiếu với ĐĂNG KÝ LÀM THÊM (ot_registrations) của phòng ban trong ngày
// Số để CHỐT = số trưởng bộ phận đăng ký (HR sửa / nhập hộ được); số kia chỉ để đối chiếu.

export const MEAL_MODES = ['punch', 'ot'];
// Ba ca mặc định (HR đổi giờ / bật tắt ở Suất ăn › Cấu hình)
export const DEFAULT_MEAL_SHIFTS = [
  { code: 'trua', name: 'Trưa', from_time: '10:30', to_time: '13:30', mode: 'punch', enabled: 1, sort_order: 1 },
  { code: 'chieu', name: 'Chiều (tối)', from_time: '17:00', to_time: '20:00', mode: 'ot', enabled: 1, sort_order: 2 },
  { code: 'dem', name: 'Đêm', from_time: '23:00', to_time: '02:00', mode: 'punch', enabled: 1, sort_order: 3 },
];
// Lượt quẹt KHÔNG tính suất ăn: lượt thêm tay (TAY_*) và lượt sinh từ chấm công điện thoại (DT_*) — chỉ lượt thật tại máy chấm công
export const NON_MACHINE_SERIALS = ['TAY_VAO', 'TAY_RA', 'DT_VAO', 'DT_RA'];

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const VN_MS = 7 * 3600000;
const DAY_MS = 86400000;

export const isHHMM = (s) => HHMM.test(String(s || ''));
export const isIsoDate = (s) => ISO_DATE.test(String(s || '')) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
export const hhmmToMin = (s) => { const m = HHMM.exec(String(s || '')); return m ? +m[1] * 60 + +m[2] : NaN; };
export const addDaysIso = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * DAY_MS).toISOString().slice(0, 10);

// Khung giờ chốt có qua nửa đêm không (VD 23:00 → 02:00)
export const isOvernight = (shift) => hhmmToMin(shift.to_time) <= hhmmToMin(shift.from_time);

// Mốc UTC [bắt đầu, kết thúc] (chuỗi ISO, so sánh được theo thứ tự chữ) của khung giờ chốt ca `shift` cho ngày ăn `workDate` (giờ VN)
export function windowBoundsUtc(workDate, shift) {
  const f = hhmmToMin(shift.from_time), t = hhmmToMin(shift.to_time);
  const base = Date.parse(workDate + 'T00:00:00Z') - VN_MS;   // 00:00 giờ VN của ngày ăn, tính theo UTC
  const start = base + f * 60000;
  const end = base + (t <= f ? t + 1440 : t) * 60000 + 59999;   // gồm trọn phút kết thúc (đến 59,999 giây)
  return [new Date(start).toISOString(), new Date(end).toISOString()];
}

// Lượt quẹt (ISO UTC) có nằm trong khung giờ chốt của ca cho ngày ăn đó không
export function inWindow(punchIso, workDate, shift) {
  const [a, b] = windowBoundsUtc(workDate, shift);
  return punchIso >= a && punchIso <= b;
}

// Một lượt quẹt thuộc ca ăn nào (màn hình bếp, mọi ca đang bật kể cả ca Chiều)? → { workDate, shift } hoặc null (quẹt ngoài mọi khung giờ chốt).
// Ca qua nửa đêm: quẹt 00:30 sáng thuộc ngày ăn HÔM TRƯỚC. Nhiều khung chồng nhau → lấy ca bắt đầu gần nhất.
export function shiftForPunch(punchIso, shifts) {
  const t = Date.parse(punchIso);
  if (Number.isNaN(t)) return null;
  const vnDay = new Date(t + VN_MS).toISOString().slice(0, 10);
  let best = null;
  for (const sh of shifts) {
    if (!sh.enabled) continue;
    for (const d of [vnDay, addDaysIso(vnDay, -1)]) {
      if (!inWindow(punchIso, d, sh)) continue;
      const startMs = Date.parse(windowBoundsUtc(d, sh)[0]);
      if (!best || startMs > best.startMs) best = { workDate: d, shift: sh, startMs };
    }
  }
  return best ? { workDate: best.workDate, shift: best.shift } : null;
}

// Đếm lượt quẹt hợp lệ của MỘT ca: punches = [{ employee_id, punch_at, department }].
// Mỗi người chỉ tính 1 suất / ca (quẹt nhiều lần trong khung vẫn 1). Trả bảng theo bộ phận + tổng + số lượt bị loại (ngoài giờ chốt).
export function countValidPunches(punches, workDate, shift) {
  const people = new Map();   // employee_id → department
  const swipes = new Map();   // department → số lượt hợp lệ
  const perDept = new Map();  // department → Set employee_id
  let outside = 0, valid = 0;
  for (const p of punches) {
    if (!p || p.employee_id == null) continue;
    if (!inWindow(p.punch_at, workDate, shift)) { outside++; continue; }
    valid++;
    const dep = p.department || '';
    swipes.set(dep, (swipes.get(dep) || 0) + 1);
    if (!perDept.has(dep)) perDept.set(dep, new Set());
    perDept.get(dep).add(p.employee_id);
    people.set(p.employee_id, dep);
  }
  const byDept = {};
  for (const [dep, set] of perDept) byDept[dep] = { people: set.size, swipes: swipes.get(dep) || 0 };
  return { byDept, people: people.size, swipes: valid, outside };
}

// Số đăng ký hợp lệ: số nguyên 0 … 99999
export function parseCount(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 99999 ? n : undefined;   // undefined = không hợp lệ
}

// Bảng đối chiếu của 1 ca. input:
//   mode: 'punch' | 'ot'
//   depts: Tên bộ phận cần hiện (đã gồm cả bộ phận chỉ xuất hiện trong dữ liệu)
//   punch: { [dept]: { people, swipes } }   (mode punch)    ot: { [dept]: { people, minutes } }   (mode ot)
//   reg:   { [dept]: { count, note, updated_by, updated_at } }
// Mỗi dòng: department, punch_people, punch_swipes, ot_people, ot_minutes, registered (null = chưa đăng ký), diff, total.
//   ref = số tham chiếu của ca (người quẹt hoặc người đăng ký làm thêm); diff = registered − ref (null nếu chưa đăng ký);
//   total = số để chốt = registered (chưa đăng ký tính 0, kèm cờ missing).
export function buildBoard({ mode, depts, punch = {}, ot = {}, reg = {} }) {
  const rows = depts.map((department) => {
    const p = punch[department] || { people: 0, swipes: 0 }, o = ot[department] || { people: 0, minutes: 0 }, g = reg[department];
    const registered = g && g.count != null ? g.count : null;
    const ref = mode === 'ot' ? o.people : p.people;
    return {
      department, punch_people: p.people, punch_swipes: p.swipes, ot_people: o.people, ot_minutes: o.minutes,
      registered, note: g?.note || '', updated_by: g?.updated_by || '', updated_at: g?.updated_at || '',
      ref, diff: registered == null ? null : registered - ref, total: registered == null ? 0 : registered, missing: registered == null,
    };
  });
  const sum = (f) => rows.reduce((s, r) => s + (f(r) || 0), 0);
  return {
    rows,
    totals: {
      punch_people: sum((r) => r.punch_people), punch_swipes: sum((r) => r.punch_swipes), ot_people: sum((r) => r.ot_people),
      registered: sum((r) => r.registered), ref: sum((r) => r.ref), diff: sum((r) => r.registered) - sum((r) => r.ref), total: sum((r) => r.total),
      missing: rows.filter((r) => r.missing).length,
    },
  };
}

// BÁO CÁO SUẤT ĂN theo MÓN của 1 ngày + 1 ca. input:
//   menu:       tên món theo thứ tự thực đơn
//   orders:     [{ employee_id, dish, set_by }]  (set_by '' = NV tự chọn trên app, khác '' = HR chọn hộ)
//   adjust:     { [dish]: qty }  HR điều chỉnh +/−; dish '' = suất không chọn món (mặc định)
//   punchers:   Set employee_id đã quẹt máy chấm công trong khung giờ chốt (= thực tế đã đến ăn)
//   registered: tổng số trưởng bộ phận đăng ký (null = chưa bộ phận nào đăng ký)
// Mỗi món: app + hr + adjust = total (không âm); ate = số người chọn món đó đã quẹt.
// Dòng mặc định (dish ''): suất trưởng BP đăng ký vượt số người đã chọn món (= người ăn mà không chọn) + điều chỉnh; ate = người quẹt mà không chọn món.
export function buildDishReport({ menu = [], orders = [], adjust = {}, punchers = new Set(), registered = null }) {
  const names = [...menu];
  const seen = new Set(names.map((n) => n.toLocaleLowerCase('vi')));
  for (const n of [...orders.map((o) => o.dish), ...Object.keys(adjust)]) {
    if (!n || seen.has(n.toLocaleLowerCase('vi'))) continue;
    seen.add(n.toLocaleLowerCase('vi')); names.push(n);   // món đã gỡ khỏi thực đơn nhưng vẫn có người chọn / có điều chỉnh
  }
  const key = (n) => names.find((x) => x.toLocaleLowerCase('vi') === String(n || '').toLocaleLowerCase('vi')) ?? n;
  const rows = new Map(names.map((n) => [n, { dish: n, app: 0, hr: 0, adjust: 0, total: 0, ate: 0 }]));
  const chosen = new Set();
  for (const o of orders) {
    const r = rows.get(key(o.dish)); if (!r) continue;
    if (o.set_by) r.hr++; else r.app++;
    if (punchers.has(o.employee_id)) r.ate++;
    chosen.add(o.employee_id);
  }
  for (const [d, q] of Object.entries(adjust)) if (d) { const r = rows.get(key(d)); if (r) r.adjust += Number(q) || 0; }
  for (const r of rows.values()) r.total = Math.max(0, r.app + r.hr + r.adjust);
  const base = registered == null ? 0 : Math.max(0, registered - chosen.size);
  const defAdj = Number(adjust['']) || 0;
  let ateDefault = 0; for (const id of punchers) if (!chosen.has(id)) ateDefault++;
  const def = { dish: '', base, adjust: defAdj, total: Math.max(0, base + defAdj), ate: ateDefault };
  const list = [...rows.values()];
  const sum = (f) => list.reduce((s, r) => s + f(r), 0);
  const totalCook = sum((r) => r.total) + def.total;
  return {
    rows: list, default: def,
    totals: {
      chosen: chosen.size, app: sum((r) => r.app), hr: sum((r) => r.hr), adjust: sum((r) => r.adjust) + defAdj,
      registered, total: totalCook, ate: punchers.size, not_yet: [...chosen].filter((id) => !punchers.has(id)).length,
    },
  };
}

// Số suất HR điều chỉnh: số nguyên −9999 … 9999 (0 = bỏ điều chỉnh); undefined = không hợp lệ
export function parseAdjust(v) {
  if (v === '' || v == null) return 0;
  const n = Number(String(v).replace(/^\+/, ''));
  return Number.isInteger(n) && Math.abs(n) <= 9999 ? n : undefined;
}

// Giờ VN hiện tại dạng { date: 'YYYY-MM-DD', min: số phút trong ngày }
export function vnNow(now = new Date()) {
  const t = new Date(now.getTime() + VN_MS);
  return { date: t.toISOString().slice(0, 10), min: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

// HẠN CHỌN MÓN (mốc ms UTC) của ca `shift` cho ngày ăn `workDate` — HR đặt ở Cấu hình suất ăn để bếp kịp chuẩn bị:
//   · lock_at 'HH:MM'     → khoá lúc giờ đó; giờ khoá MUỘN hơn giờ bắt đầu khung ăn = của HÔM TRƯỚC (VD bữa trưa 10:30, khoá 20:00 → 20:00 hôm trước)
//   · lock_before_min = N → khoá trước giờ bắt đầu khung ăn N phút (0 = đúng lúc bắt đầu — như bản cũ)
export function orderDeadlineMs(workDate, shift) {
  const base = Date.parse(workDate + 'T00:00:00Z') - VN_MS;   // 00:00 giờ VN của ngày ăn
  const f = hhmmToMin(shift.from_time);
  if (isHHMM(shift.lock_at)) {
    const l = hhmmToMin(shift.lock_at);
    return base + (l > f ? l - 1440 : l) * 60000;
  }
  return base + (f - Math.max(0, Number(shift.lock_before_min) || 0)) * 60000;
}
// Hạn chọn món dạng giờ VN 'YYYY-MM-DD HH:MM' (để hiện cho nhân viên)
export function orderDeadlineVn(workDate, shift) {
  return new Date(orderDeadlineMs(workDate, shift) + VN_MS).toISOString().slice(0, 16).replace('T', ' ');
}
// Nhân viên còn được chọn / đổi món cho ca này không: chỉ TRƯỚC hạn chọn món (orderDeadlineMs); ngày đã qua luôn khoá
export function canOrderMeal(workDate, shift, now = new Date()) {
  return now.getTime() < orderDeadlineMs(workDate, shift);
}

// Chuẩn hoá danh sách tên món HR nhập (bỏ dòng trống, trùng, cắt độ dài); tối đa 40 món / ca / ngày
export function cleanDishes(list) {
  const seen = new Set(), out = [];
  for (const x of Array.isArray(list) ? list : []) {
    const s = String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const key = s.toLocaleLowerCase('vi');
    if (!s || seen.has(key)) continue;
    seen.add(key); out.push(s);
    if (out.length >= 40) break;
  }
  return out;
}

// Kiểm tra cấu hình 1 ca do HR gửi lên → { ok, error?, value? }
export function checkShiftConfig(b) {
  const name = String(b?.name ?? '').trim().slice(0, 40);
  if (!name) return { ok: false, error: 'Tên ca không được để trống' };
  if (!isHHMM(b.from_time) || !isHHMM(b.to_time)) return { ok: false, error: 'Giờ chốt phải dạng HH:MM (VD 10:30)' };
  if (b.from_time === b.to_time) return { ok: false, error: 'Giờ bắt đầu và giờ chốt không được trùng nhau' };
  if (!MEAL_MODES.includes(b.mode)) return { ok: false, error: 'Cách đối chiếu không hợp lệ' };
  const value = { name, from_time: b.from_time, to_time: b.to_time, mode: b.mode, enabled: b.enabled ? 1 : 0 };
  // Hạn chọn món: 'start' = lúc bắt đầu khung ăn · 'before' = trước lock_hours giờ (lẻ được, tối đa 48) · 'at' = lúc lock_at
  // Không gửi lock_mode (giao diện cũ) → không đụng tới hạn đang lưu
  if (b.lock_mode === 'start') Object.assign(value, { lock_before_min: 0, lock_at: '' });
  else if (b.lock_mode === 'before') {
    const h = Number(String(b.lock_hours ?? '').replace(',', '.'));
    if (!Number.isFinite(h) || h <= 0 || h > 48) return { ok: false, error: 'Số giờ khoá chọn món trước bữa phải từ lớn hơn 0 đến 48 (VD 1 hoặc 1.5)' };
    Object.assign(value, { lock_before_min: Math.round(h * 60), lock_at: '' });
  } else if (b.lock_mode === 'at') {
    if (!isHHMM(b.lock_at)) return { ok: false, error: 'Giờ khoá chọn món phải dạng HH:MM (VD 14:00)' };
    Object.assign(value, { lock_before_min: 0, lock_at: b.lock_at });
  } else if (b.lock_mode != null) return { ok: false, error: 'Cách khoá chọn món không hợp lệ' };
  return { ok: true, value };
}
