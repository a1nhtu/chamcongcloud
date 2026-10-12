// CÔNG ẢO / LƯƠNG ẢO (audit) — giống "công khách (K)" của HR-ERP.
// Công THẬT giữ nguyên trong bảng attendance; khi xem ở chế độ ảo, tăng ca được cắt theo hạn mức
//   ngày (phút) → tuần (giờ, T2–CN) → tháng (giờ, theo kỳ lương) → năm (giờ, cộng dồn từ kỳ lương tháng 1)
// rồi giờ ra (hoặc giờ vào, nếu tăng ca trước ca) được lùi lại cho khớp số tăng ca còn lại.
// Chỉ dùng khi tài khoản tổng (sadmin) bật "audit_enabled" và người xem có quyền "audit".
import { db, getSetting } from './db.js';
import { hasPerm } from './auth.js';

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
const monday = (d) => { const w = new Date(d + 'T12:00:00Z').getUTCDay(); return addDays(d, -((w + 6) % 7)); };

export function auditSettings() {
  const num = (k, d) => { const v = parseFloat(getSetting(k, String(d))); return Number.isFinite(v) && v >= 0 ? v : d; };
  return {
    enabled: getSetting('audit_enabled', '0') === '1',
    dayMin: num('audit_ot_day_min', 240),            // tăng ca tối đa / ngày (phút)        — 0 = không giới hạn
    weekMin: num('audit_ot_week_h', 0) * 60,         // tối đa / tuần (giờ)
    monthMin: num('audit_ot_month_h', 40) * 60,      // tối đa / tháng (giờ, theo kỳ lương)
    yearMin: num('audit_ot_year_h', 200) * 60,       // tối đa / năm (giờ)
    inclWeekend: getSetting('audit_incl_weekend', '1') === '1',   // tăng ca ngày nghỉ tuần (CN…) tính vào hạn mức & bị cắt
    inclHoliday: getSetting('audit_incl_holiday', '1') === '1',   // tăng ca ngày lễ tính vào hạn mức & bị cắt
    method: getSetting('audit_method', 'ratio') === 'days' ? 'days' : 'ratio',   // chia đều tỷ lệ | gỡ bớt nguyên ngày
    block: Math.max(0, parseInt(getSetting('audit_block', '15'), 10) || 0),       // làm tròn phút tăng ca ảo theo khối
  };
}
// Người dùng có được xem công ảo không (tính năng bật + là admin / tài khoản tổng / có quyền "audit")
export function auditAllowed(user) {
  if (getSetting('audit_enabled', '0') !== '1' || !user) return false;
  return hasPerm(user, 'audit');
}

// Tháng lương chứa ngày d ('YYYY-MM'), theo ngày bắt đầu kỳ lương (Cài đặt › Lương)
function payKeyFn() {
  const sd = parseInt(getSetting('pay_period_start_day', '1'), 10) || 1;
  const key = (d) => {
    let y = +d.slice(0, 4), m = +d.slice(5, 7);
    if (sd > 1 && +d.slice(8, 10) >= sd) { m++; if (m > 12) { m = 1; y++; } }
    return `${y}-${pad(m)}`;
  };
  const start = (y, m) => { if (sd <= 1) return `${y}-${pad(m)}-01`; const p = m === 1 ? [y - 1, 12] : [y, m - 1]; return `${p[0]}-${pad(p[1])}-${pad(sd)}`; };
  const end = (y, m) => (sd <= 1 ? new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) : `${y}-${pad(m)}-${pad(sd - 1)}`);
  return { key, start, end };
}

// Cắt tổng tăng ca của nhóm dòng `items` ({v}) xuống `cap` phút
function reduce(items, cap, S, seed) {
  const total = items.reduce((a, x) => a + x.v, 0);
  if (total <= cap) return;
  const blk = S.block > 1 ? S.block : 1;
  if (S.method === 'days') {
    // gỡ bớt NGUYÊN NGÀY (thứ tự ngẫu nhiên cố định theo NV + kỳ, ngày thường trước, ngày nghỉ / lễ sau);
    // ngày cuối cùng chỉ cắt phần còn thừa → tổng đúng bằng hạn mức
    const byDay = new Map();
    for (const x of items) { if (!x.v) continue; if (!byDay.has(x.date)) byDay.set(x.date, []); byDay.get(x.date).push(x); }
    let h = seed >>> 0;
    const rnd = () => { h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return h / 4294967296; };
    const days = [...byDay.entries()].map(([d, xs]) => ({ d, xs, off: xs.some((x) => x.type !== 'thuong') ? 1 : 0, r: rnd() }))
      .sort((a, b) => a.off - b.off || a.r - b.r);
    let over = total - cap;
    for (const day of days) {
      if (over <= 0) break;
      const dt = day.xs.reduce((a, x) => a + x.v, 0);
      if (dt <= over) { for (const x of day.xs) x.v = 0; over -= dt; continue; }
      let cut = Math.ceil(over / blk) * blk;
      for (const x of day.xs.sort((a, b) => b.v - a.v)) { const c = Math.min(x.v, cut); x.v -= c; cut -= c; if (cut <= 0) break; }
      over = 0;
    }
    return;
  }
  // CHIA ĐỀU THEO TỶ LỆ: mỗi dòng × (hạn mức / tổng), làm tròn xuống theo khối, phần dư chia lại cho dòng lẻ nhiều nhất
  const f = cap / total;
  const parts = items.map((x) => { const exact = x.v * f; const fl = Math.floor(exact / blk) * blk; return { x, fl, frac: exact - fl }; });
  let left = cap - parts.reduce((a, p) => a + p.fl, 0);
  for (const p of parts.sort((a, b) => b.frac - a.frac)) {
    if (left < blk) break;
    if (p.fl + blk <= p.x.v) { p.fl += blk; left -= blk; }
  }
  for (const p of parts) p.x.v = p.fl;
}

// Map attendance.id → { ot_min, check_in_at, check_out_at, hidden, cut } cho các NV trong [from, to].
// Dòng không bị cắt không có trong map. Tính năng tắt → map rỗng.
export function virtualOt(empIds, from, to) {
  const S = auditSettings();
  const out = new Map();
  if (!S.enabled || !empIds || !empIds.length) return out;
  const P = payKeyFn();
  // nạp từ đầu NĂM lương (hạn mức năm cộng dồn) tới hết kỳ lương chứa `to`, mở rộng đủ tuần
  const y0 = +P.key(from).slice(0, 4);
  const kT = P.key(to);
  const L = monday(P.start(y0, 1));
  let R = P.end(+kT.slice(0, 4), +kT.slice(5, 7)); if (to > R) R = to;
  R = addDays(monday(R), 6);
  const ids = [...new Set(empIds.map(Number).filter(Boolean))];
  const rows = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    rows.push(...db.prepare(`SELECT a.id, a.employee_id, a.work_date, a.ot_min, a.ot_type, a.work_unit, a.work_minutes, a.check_in_at, a.check_out_at,
        s.start_time, s.end_time FROM attendance a LEFT JOIN shifts s ON s.id = a.shift_id
      WHERE a.employee_id IN (${chunk.map(() => '?').join(',')}) AND a.work_date >= ? AND a.work_date <= ? AND a.ot_min > 0`).all(...chunk, L, R));
  }
  const counted = (t) => t === 'le' ? S.inclHoliday : t === 'cuoi_tuan' ? S.inclWeekend : true;
  const byEmp = new Map();
  for (const r of rows) {
    if (!counted(r.ot_type || 'thuong')) continue;
    if (!byEmp.has(r.employee_id)) byEmp.set(r.employee_id, []);
    byEmp.get(r.employee_id).push({ r, date: r.work_date, type: r.ot_type || 'thuong', v: r.ot_min || 0 });
  }
  const group = (items, keyFn) => { const m = new Map(); for (const x of items) { const k = keyFn(x.date); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };
  for (const [eid, items] of byEmp) {
    items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    if (S.dayMin > 0) for (const [d, xs] of group(items, (d) => d)) reduce(xs, S.dayMin, S, eid * 7919 + Date.parse(d) / DAY);
    if (S.weekMin > 0) for (const [w, xs] of group(items, monday)) reduce(xs, S.weekMin, S, eid * 104729 + Date.parse(w) / DAY);
    const months = group(items, P.key);
    if (S.monthMin > 0) for (const [k, xs] of months) reduce(xs, S.monthMin, S, eid * 1299709 + +k.replace('-', ''));
    if (S.yearMin > 0) {
      let year = null, used = 0;
      for (const k of [...months.keys()].sort()) {
        if (k.slice(0, 4) !== year) { year = k.slice(0, 4); used = 0; }
        const xs = months.get(k);
        reduce(xs, Math.max(0, S.yearMin - used), S, eid * 15485863 + +k.replace('-', ''));
        used += xs.reduce((a, x) => a + x.v, 0);
      }
    }
    for (const x of items) {
      const r = x.r, cut = (r.ot_min || 0) - x.v;
      if (cut <= 0 || x.date < from || x.date > to) continue;
      out.set(r.id, { ...shiftTimes(r, cut, x.v), ot_min: x.v, cut });
    }
  }
  return out;
}

// Giờ vào / ra ẢO khớp với số tăng ca còn lại: lùi giờ ra phần tăng ca sau ca, còn thừa thì lùi giờ vào (tăng ca trước ca).
// Ngày làm toàn tăng ca (ngày nghỉ / lễ, 0 công) bị cắt hết → ẩn cả ngày (như HR-ERP gỡ ngày).
function shiftTimes(r, cut, v) {
  if (v <= 0 && !(r.work_unit > 0) && !(r.work_minutes > 0)) return { hidden: true, check_in_at: null, check_out_at: null };
  let inT = r.check_in_at ? Date.parse(r.check_in_at) : null, outT = r.check_out_at ? Date.parse(r.check_out_at) : null;
  let left = cut * 60000;
  if (outT != null) {
    let room = left;
    if (r.end_time && r.work_unit > 0) {   // ngày có công: chỉ lùi trong phần sau giờ tan ca
      let end = Date.parse(`${r.work_date}T${r.end_time}:00+07:00`);
      if (r.start_time && r.end_time <= r.start_time) end += DAY;
      room = Math.max(0, Math.min(left, outT - Math.max(end, inT || end)));
    }
    if (inT != null) room = Math.min(room, Math.max(0, outT - inT));
    outT -= room; left -= room;
  }
  if (left > 0 && inT != null) {   // còn thừa → tăng ca TRƯỚC ca: lùi giờ vào nhưng không quá giờ vào ca / giờ ra
    let lim = outT != null ? outT : inT + left;
    if (r.start_time && r.work_unit > 0) lim = Math.min(lim, Math.max(inT, Date.parse(`${r.work_date}T${r.start_time}:00+07:00`)));
    inT = Math.min(inT + left, lim);
  }
  return { hidden: false, check_in_at: inT != null ? new Date(inT).toISOString() : null, check_out_at: outT != null ? new Date(outT).toISOString() : null };
}

// Áp công ảo lên danh sách dòng attendance (có id): đổi ot_min / giờ vào ra; bỏ dòng bị ẩn
export function applyVirtual(rows, vmap) {
  if (!vmap || !vmap.size) return rows;
  const res = [];
  for (const row of rows) {
    const v = vmap.get(row.id);
    if (!v) { res.push(row); continue; }
    if (v.hidden) continue;
    res.push({ ...row, ot_min: v.ot_min, check_in_at: v.check_in_at, check_out_at: v.check_out_at });
  }
  return res;
}
