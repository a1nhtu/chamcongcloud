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

// Giờ VN hiện tại dạng { date: 'YYYY-MM-DD', min: số phút trong ngày }
export function vnNow(now = new Date()) {
  const t = new Date(now.getTime() + VN_MS);
  return { date: t.toISOString().slice(0, 10), min: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

// Nhân viên còn được chọn / đổi món cho ca này không: ngày sau hôm nay → được; hôm nay → chỉ trước giờ bắt đầu khung ăn; ngày qua → khoá
export function canOrderMeal(workDate, shift, now = new Date()) {
  const n = vnNow(now);
  if (workDate > n.date) return true;
  if (workDate < n.date) return false;
  return n.min < hhmmToMin(shift.from_time);
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
  return { ok: true, value: { name, from_time: b.from_time, to_time: b.to_time, mode: b.mode, enabled: b.enabled ? 1 : 0 } };
}
