// CÔNG ẢO / LƯƠNG ẢO (audit) — giống "công khách (K)" của HR-ERP. Có 3 MỨC (Ảo 1 / 2 / 3), khác nhau ở tăng ca tối đa / ngày.
// Công THẬT giữ nguyên trong bảng attendance; khi xem ở chế độ ảo, tăng ca được cắt theo hạn mức
//   ngày (phút) → tuần (giờ, T2–CN) → tháng (giờ, theo kỳ lương) → năm (giờ, cộng dồn từ kỳ lương tháng 1)
// rồi giờ ra (hoặc giờ vào, nếu tăng ca trước ca) được lùi lại cho khớp số tăng ca còn lại.
// Chỉ dùng khi tài khoản tổng (sadmin) bật "audit_enabled" và người xem có quyền "audit".
import { db, getSetting } from './db.js';
import { hasPerm } from './auth.js';
import { kDayTimes, realFourTimes, kSeed } from './k-times.js';

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
const monday = (d) => { const w = new Date(d + 'T12:00:00Z').getUTCDay(); return addDays(d, -((w + 6) % 7)); };

// Map mức ảo 1/2/3 → số phút (đọc giờ; '' / âm = null = không giới hạn)
function hoursLv(prefix) {
  return Object.fromEntries([1, 2, 3].map((l) => { const v = getSetting(prefix + l, ''); const n = parseFloat(v); return [l, v === '' || v == null || !Number.isFinite(n) || n < 0 ? null : Math.round(n * 60)]; }));
}
export function auditSettings() {
  const num = (k, d) => { const v = parseFloat(getSetting(k, String(d))); return Number.isFinite(v) && v >= 0 ? v : d; };
  const lvs = (k, d) => new Set(String(getSetting(k, d)).split(',').map((x) => parseInt(x, 10)).filter((x) => [1, 2, 3].includes(x)));
  return {
    weekLv: lvs('audit_week_lv', '1,2,3'),          // hạn mức tuần / tháng / năm áp cho những mức ảo nào (mặc định cả 3)
    monthLv: lvs('audit_month_lv', '1,2,3'),
    yearLv: lvs('audit_year_lv', '1,2,3'),
    clampLv: lvs('audit_clamp_lv', ''),             // KHỐNG CHẾ GIỜ CHẤM áp cho những mức ảo nào (mặc định không mức nào)
    clampIn: Math.round(num('audit_clamp_in_min', 14)) * 60000,    // giờ vào không sớm hơn giờ vào ca quá N phút
    clampOut: Math.round(num('audit_clamp_out_min', 14)) * 60000,  // giờ ra không trễ hơn (giờ tan ca + tăng ca ảo) quá N phút
    // GIỜ TRƯA & ĐI TRỄ KIỂU "CÔNG KHÁCH K" của HR-ERP (khách chấm 4 lần/ngày): áp cho những mức ảo nào (mặc định không mức nào = TẮT)
    kLv: lvs('audit_k_lv', ''),
    kEarly: Math.round(num('audit_k_early_min', 15)),    // đến sớm từ N phút → hiện 1–14 phút trước giờ vào ca
    kLateMax: Math.round(num('audit_k_late_max', 60)),   // đi trễ 1…N phút → coi như đúng giờ (hiện sớm 1–14', trả đủ giờ công)
    kOutGap: Math.round(num('audit_k_out_gap', 15)),     // ra trưa muộn hơn giờ bắt đầu nghỉ từ N phút → hiện 0–11 phút sau giờ nghỉ
    kInGap: Math.round(num('audit_k_in_gap', 5)),        // vào lại sớm hơn giờ hết nghỉ quá N phút → hiện trong N phút cuối giờ nghỉ
    // số ngày nghỉ hằng tuần (chủ nhật…) đi làm tối đa / tháng lương của từng mức ảo; null = không giới hạn
    sunMax: Object.fromEntries([1, 2, 3].map((l) => { const v = getSetting('audit_sun_l' + l, ''); const n = parseInt(v, 10); return [l, v === '' || v == null || !Number.isFinite(n) || n < 0 ? null : n]; })),
    // tổng giờ làm (giờ công + tăng ca) tối đa / ngày · / tuần — mỗi mức ảo một số giờ riêng ('' = không giới hạn), đổi sang phút
    totDay: hoursLv('audit_totday_l'),
    totWeek: hoursLv('audit_totweek_l'),
    // số ngày làm LIÊN TỤC tối đa / mức ảo (ngày; '' / <1 = không giới hạn) — vượt thì gỡ bớt ngày (coi như nghỉ) xen vào
    streak: Object.fromEntries([1, 2, 3].map((l) => { const v = getSetting('audit_streak_l' + l, ''); const n = parseInt(v, 10); return [l, v === '' || v == null || !Number.isFinite(n) || n < 1 ? null : n]; })),
    enabled: getSetting('audit_enabled', '0') === '1',
    weekMin: num('audit_ot_week_h', 0) * 60,         // tối đa / tuần (giờ)
    monthMin: num('audit_ot_month_h', 0) * 60,      // tối đa / tháng (giờ, theo kỳ lương)
    yearMin: num('audit_ot_year_h', 0) * 60,       // tối đa / năm (giờ)
    inclWeekend: getSetting('audit_incl_weekend', '1') === '1',   // tăng ca ngày nghỉ tuần (CN…) tính vào hạn mức & bị cắt
    inclHoliday: getSetting('audit_incl_holiday', '1') === '1',   // tăng ca ngày lễ tính vào hạn mức & bị cắt
    method: getSetting('audit_method', 'ratio') === 'days' ? 'days' : 'ratio',   // chia đều tỷ lệ | gỡ bớt nguyên ngày
    block: Math.max(0, parseInt(getSetting('audit_block', '15'), 10) || 0),       // làm tròn phút tăng ca ảo theo khối
  };
}
// 3 MỨC công ảo (như "TGLT tối đa / tối đa 2 / tối đa 3" của HR-ERP): mỗi mức có tăng ca tối đa / ngày riêng.
// Mặc định công ty (phút; null = không giới hạn). Mức 1 kế thừa audit_ot_day_min cũ (> 0).
export function levelDefaults() {
  const rd = (k) => { const v = getSetting(k, ''); if (v === '' || v == null) return null; const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : null; };
  let l1 = rd('audit_l1_day');
  if (l1 == null && getSetting('audit_l1_day', null) == null) { const old = parseInt(getSetting('audit_ot_day_min', '0'), 10); if (old > 0) l1 = old; }
  return { 1: l1, 2: rd('audit_l2_day'), 3: rd('audit_l3_day') };
}
// Mức công ảo đang xem từ query ?virt=1|2|3 (0 = công thật).
// Tài khoản kiểm tra: luôn đúng mức gắn với tài khoản (employees.audit_only = 1 / 2 / 3), bỏ qua query.
export const inspectorLevel = (u) => ([1, 2, 3].includes(+(u && u.audit_only)) ? +u.audit_only : 1);
export function virtLevel(q, req) {
  if (req && req.forceVirt) return inspectorLevel(req.user);
  const v = parseInt(q && q.virt, 10);
  return [1, 2, 3].includes(v) ? v : 0;
}
// Hàm tra tăng ca tối đa (phút) của NV eid ngày d ở mức `level`: ô ngày → mức riêng NV ('*') → mặc định công ty; null = không giới hạn
function dayLimitFn(ids, L, R, level) {
  const cells = new Map();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    for (const c of db.prepare(`SELECT employee_id, work_date, minutes FROM audit_ot_max WHERE level=? AND employee_id IN (${chunk.map(() => '?').join(',')})
        AND ((work_date >= ? AND work_date <= ?) OR work_date='*')`).all(level, ...chunk, L, R)) cells.set(c.employee_id + '|' + c.work_date, c.minutes);
  }
  const def = levelDefaults()[level];
  return (eid, d) => { const k = eid + '|' + d; if (cells.has(k)) return cells.get(k); const e = eid + '|*'; return cells.has(e) ? cells.get(e) : def; };
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

// Kỳ lương 'YYYY-MM' → { from, to }
export function payPeriod(month) { const P = payKeyFn(); const y = +month.slice(0, 4), m = +month.slice(5, 7); return { from: P.start(y, m), to: P.end(y, m) }; }
export function payMonthOf(d) { return payKeyFn().key(d); }
// Các tháng lương ĐÃ CHỐT giao với [from, to]
export function locksIn(from, to) { return db.prepare('SELECT month, from_date, to_date FROM audit_locks WHERE to_date >= ? AND from_date <= ? ORDER BY month').all(from, to); }

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
// force = tài khoản kiểm tra: luôn công ảo (kể cả khi tài khoản tổng đã tắt tính năng)
export function virtualOt(empIds, from, to, force = false, level = 1) {
  const S = auditSettings();
  const out = new Map();
  if ((!S.enabled && !force) || !empIds || !empIds.length) return out;
  const P = payKeyFn();
  // nạp từ đầu NĂM lương (hạn mức năm cộng dồn) tới hết kỳ lương chứa `to`, mở rộng đủ tuần
  const y0 = +P.key(from).slice(0, 4);
  const kT = P.key(to);
  const L = monday(P.start(y0, 1));
  let R = P.end(+kT.slice(0, 4), +kT.slice(5, 7)); if (to > R) R = to;
  R = addDays(monday(R), 6);
  const ids = [...new Set(empIds.map(Number).filter(Boolean))];
  const lv = [1, 2, 3].includes(+level) ? +level : 1;
  const dayCap = dayLimitFn(ids, L, R, lv);
  // CHỐT KỲ: tháng đã chốt giữ nguyên bản chụp; tăng ca đã chốt vẫn được cộng vào hạn mức NĂM của các tháng sau
  const locks = locksIn(L, R);
  const lockedDay = (d) => locks.some((k) => d >= k.from_date && d <= k.to_date);
  const lockedUse = new Map();   // empId|tháng → tổng phút tăng ca ảo đã chốt (chỉ loại tính vào hạn mức)
  if (locks.length) {
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      for (const r of db.prepare(`SELECT employee_id, month, thuong, cuoi_tuan, le FROM audit_lock_sums WHERE level=? AND month IN (${locks.map(() => '?').join(',')})
          AND employee_id IN (${chunk.map(() => '?').join(',')})`).all(lv, ...locks.map((k) => k.month), ...chunk))
        lockedUse.set(r.employee_id + '|' + r.month, (r.thuong || 0) + (S.inclWeekend ? r.cuoi_tuan || 0 : 0) + (S.inclHoliday ? r.le || 0 : 0));
    }
    const want = locks.filter((k) => k.to_date >= from && k.from_date <= to);
    if (want.length) out.locked = { ranges: want.map((k) => ({ from: k.from_date < from ? from : k.from_date, to: k.to_date > to ? to : k.to_date })), rows: lockedRows(ids, want, lv, from, to) };
  }
  const rows = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    rows.push(...db.prepare(`SELECT a.id, a.employee_id, a.work_date, a.ot_min, a.ot_type, a.work_unit, a.work_minutes, a.check_in_at, a.check_out_at,
        s.start_time, s.end_time FROM attendance a LEFT JOIN shifts s ON s.id = a.shift_id
      WHERE a.employee_id IN (${chunk.map(() => '?').join(',')}) AND a.work_date >= ? AND a.work_date <= ? AND a.ot_min > 0`).all(...chunk, L, R));
  }
  // CHỦ NHẬT ĐI LÀM TỐI ĐA / THÁNG: ngày nghỉ hằng tuần (dòng công loại tăng ca 'cuoi_tuan') vượt số cho phép bị gỡ hẳn khỏi công ảo
  const sunHidden = S.sunMax[lv] != null ? sundayDrops(ids, L, R, S.sunMax[lv], lv, P, lockedDay) : new Map();
  // SỐ NGÀY LÀM LIÊN TỤC TỐI ĐA: chuỗi dài hơn số cho phép → gỡ bớt ngày (ưu tiên ngày ít công) để không chuỗi nào vượt
  const streakHidden = S.streak[lv] != null ? streakDrops(ids, L, R, S.streak[lv], lv, lockedDay, sunHidden) : new Map();
  const counted = (t) => t === 'le' ? S.inclHoliday : t === 'cuoi_tuan' ? S.inclWeekend : true;
  const byEmp = new Map();
  // TỔNG GIỜ LÀM (công + TC) tối đa / ngày · / tuần: tổng giờ công thật (không cắt) để trừ ra hạn mức tăng ca còn lại
  const totDay = S.totDay[lv], totWeek = S.totWeek[lv];
  const dayWork = new Map(), weekWork = new Map();
  if (totDay != null || totWeek != null) {
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      for (const r of db.prepare(`SELECT employee_id, work_date, work_minutes FROM attendance WHERE employee_id IN (${chunk.map(() => '?').join(',')})
          AND work_date >= ? AND work_date <= ? AND work_minutes > 0`).all(...chunk, L, R)) {
        if (lockedDay(r.work_date)) continue;
        dayWork.set(r.employee_id + '|' + r.work_date, (dayWork.get(r.employee_id + '|' + r.work_date) || 0) + r.work_minutes);
        const wk = r.employee_id + '|' + monday(r.work_date); weekWork.set(wk, (weekWork.get(wk) || 0) + r.work_minutes);
      }
    }
  }
  for (const r of rows) {
    if (!counted(r.ot_type || 'thuong') || lockedDay(r.work_date) || sunHidden.has(r.id) || streakHidden.has(r.id)) continue;   // tháng đã chốt: không tính lại; chủ nhật / vượt ngày liên tục bị gỡ: không tính vào hạn mức
    if (!byEmp.has(r.employee_id)) byEmp.set(r.employee_id, []);
    byEmp.get(r.employee_id).push({ r, date: r.work_date, type: r.ot_type || 'thuong', v: r.ot_min || 0 });
  }
  const group = (items, keyFn) => { const m = new Map(); for (const x of items) { const k = keyFn(x.date); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };
  const weekOn = S.weekMin > 0 && S.weekLv.has(lv), monthOn = S.monthMin > 0 && S.monthLv.has(lv), yearOn = S.yearMin > 0 && S.yearLv.has(lv);
  if (yearOn) for (const k of lockedUse.keys()) { const eid = +k.split('|')[0]; if (!byEmp.has(eid)) byEmp.set(eid, []); }   // NV chỉ có tháng đã chốt
  for (const [eid, items] of byEmp) {
    items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    for (const [d, xs] of group(items, (d) => d)) { const cap = dayCap(eid, d); if (cap != null) reduce(xs, cap, S, eid * 7919 + Date.parse(d) / DAY + lv); }
    if (weekOn) for (const [w, xs] of group(items, monday)) reduce(xs, S.weekMin, S, eid * 104729 + Date.parse(w) / DAY);
    if (totDay != null) for (const [d, xs] of group(items, (d) => d)) reduce(xs, Math.max(0, totDay - (dayWork.get(eid + '|' + d) || 0)), S, eid * 2750159 + Date.parse(d) / DAY + lv);
    if (totWeek != null) for (const [w, xs] of group(items, monday)) reduce(xs, Math.max(0, totWeek - (weekWork.get(eid + '|' + w) || 0)), S, eid * 49979687 + Date.parse(w) / DAY + lv);
    const months = group(items, P.key);
    if (monthOn) for (const [k, xs] of months) reduce(xs, S.monthMin, S, eid * 1299709 + +k.replace('-', ''));
    if (yearOn) {
      let year = null, used = 0;
      const lockedKs = locks.map((k) => k.month).filter((m) => lockedUse.has(eid + '|' + m));
      for (const k of [...new Set([...months.keys(), ...lockedKs])].sort()) {
        if (k.slice(0, 4) !== year) { year = k.slice(0, 4); used = 0; }
        if (!months.has(k)) { used += lockedUse.get(eid + '|' + k) || 0; continue; }   // tháng đã chốt: cộng đúng số đã chốt
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
  for (const [id, x] of sunHidden) if (x.date >= from && x.date <= to) out.set(id, { hidden: true, check_in_at: null, check_out_at: null, ot_min: 0, cut: x.ot });
  for (const [id, x] of streakHidden) if (x.date >= from && x.date <= to) out.set(id, { hidden: true, check_in_at: null, check_out_at: null, ot_min: 0, cut: x.ot });
  if (S.clampLv.has(lv)) clampRange(out, ids, from, to, S, lv, lockedDay);
  if (S.kLv.has(lv)) kRange(out, ids, from, to, S, lv, lockedDay);
  return out;
}

// GIỜ TRƯA & ĐI TRỄ KIỂU K: chỉ chạy khi mức ảo được tích ở "Giờ trưa & đi trễ kiểu K" (mặc định tắt → hàm này không được gọi).
// Với dòng công có ca nghỉ trưa CỐ ĐỊNH: sinh giờ Ra / Vào trưa ảo (k_ra, k_vao), đổi giờ Đến theo quy tắc K (xem k-times.js);
// đi trễ được che thì giờ công / số công trả đủ, phút trễ = 0. Giờ VỀ và tăng ca do phần cắt tăng ca / khống chế giờ chấm ở trên lo.
function kRange(out, ids, from, to, S, lv, lockedDay) {
  const K = { early: S.kEarly, lateMax: S.kLateMax, outGap: S.kOutGap, inGap: S.kInGap };
  const dec = parseInt(getSetting('workunit_rounding', '2'), 10), mode = parseInt(getSetting('workunit_rounding_mode', '0'), 10) || 0;
  const dig = Number.isFinite(dec) ? Math.max(0, Math.min(3, dec)) : 2, f = Math.pow(10, dig);
  const rf = mode === 1 ? Math.ceil : mode === 2 ? Math.round : Math.floor;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500), ph = chunk.map(() => '?').join(',');
    const punches = new Map();   // 'NV|ngày' → [mốc ms]
    for (const p of db.prepare(`SELECT employee_id, work_date, punch_at FROM device_punches WHERE employee_id IN (${ph}) AND work_date >= ? AND work_date <= ? ORDER BY punch_at`).all(...chunk, from, to)) {
      const k = p.employee_id + '|' + p.work_date; if (!punches.has(k)) punches.set(k, []); punches.get(k).push(Date.parse(p.punch_at));
    }
    for (const r of db.prepare(`SELECT a.id, a.employee_id, a.work_date, a.check_in_at, a.check_out_at, a.late_min, a.work_minutes, a.work_unit, a.ot_min,
        s.start_time, s.end_time, s.break_start, s.break_minutes, s.work_unit_value FROM attendance a JOIN shifts s ON s.id = a.shift_id
      WHERE a.employee_id IN (${ph}) AND a.work_date >= ? AND a.work_date <= ? AND a.check_in_at IS NOT NULL`).all(...chunk, from, to)) {
      if (!r.start_time || !r.end_time || !r.break_start || !(r.break_minutes > 0) || lockedDay(r.work_date)) continue;
      const cur = out.get(r.id);
      if (cur && cur.hidden) continue;
      const st = Date.parse(`${r.work_date}T${r.start_time}:00+07:00`);
      let bs = Date.parse(`${r.work_date}T${r.break_start}:00+07:00`); if (bs < st) bs += DAY;
      const be = bs + r.break_minutes * 60000;
      const real = realFourTimes(punches.get(r.employee_id + '|' + r.work_date) || [Date.parse(r.check_in_at), ...(r.check_out_at ? [Date.parse(r.check_out_at)] : [])], bs);
      const t = kDayTimes({ start: st, breakStart: bs, breakEnd: be, den: real.den ?? Date.parse(r.check_in_at), ra: real.ra, vao: real.vao }, K, kSeed(r.employee_id, r.work_date, lv));
      const e = { hidden: false, ot_min: cur ? cur.ot_min : r.ot_min || 0, cut: cur ? cur.cut : 0,
        check_in_at: cur ? cur.check_in_at : r.check_in_at, check_out_at: cur ? cur.check_out_at : r.check_out_at };
      if (t.den !== real.den && t.den != null) e.check_in_at = new Date(t.den).toISOString();
      if (t.ra != null && t.ra !== real.ra) e.k_ra = new Date(t.ra).toISOString(); else if (real.ra != null) e.k_ra = new Date(real.ra).toISOString();
      if (t.vao != null && t.vao !== real.vao) e.k_vao = new Date(t.vao).toISOString(); else if (real.vao != null) e.k_vao = new Date(real.vao).toISOString();
      if (t.lateHidden && r.work_unit > 0) {   // che đi trễ → trả đủ giờ công, phút trễ = 0
        let en = Date.parse(`${r.work_date}T${r.end_time}:00+07:00`); if (en <= st) en += DAY;
        const std = Math.max(1, Math.round((en - st) / 60000) - r.break_minutes);
        e.late_min = 0;
        e.work_minutes = Math.min(std, (r.work_minutes || 0) + (r.late_min || 0));
        e.work_unit = Math.min(r.work_unit_value ?? 1, rf((r.work_unit_value ?? 1) * e.work_minutes / std * f) / f);
      }
      out.set(r.id, e);
    }
  }
}

// Chủ nhật (ngày nghỉ hằng tuần) đi làm vượt `max` ngày / tháng lương → Map attendance.id → { date, ot } của các dòng bị gỡ.
// Ngày có lượt chấm (kể cả chỉ có giờ vào) đều tính. Ngày được giữ chọn ngẫu nhiên nhưng CỐ ĐỊNH theo NV + tháng + mức (xem lại vẫn ra đúng ngày đó; mỗi NV giữ các ngày khác nhau).
function sundayDrops(ids, L, R, max, lv, P, lockedDay) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const groups = new Map();   // empId|tháng → Map ngày → [dòng]
    for (const r of db.prepare(`SELECT id, employee_id, work_date, ot_min, (ot_min > 0 OR work_unit > 0 OR work_minutes > 0) worked FROM attendance WHERE employee_id IN (${chunk.map(() => '?').join(',')})
        AND work_date >= ? AND work_date <= ? AND ot_type='cuoi_tuan' AND (ot_min > 0 OR work_unit > 0 OR work_minutes > 0 OR check_in_at IS NOT NULL)`).all(...chunk, L, R)) {
      if (lockedDay(r.work_date)) continue;
      const k = r.employee_id + '|' + P.key(r.work_date);
      if (!groups.has(k)) groups.set(k, new Map());
      const g = groups.get(k); if (!g.has(r.work_date)) g.set(r.work_date, []); g.get(r.work_date).push(r);
    }
    for (const [k, days] of groups) {
      if (days.size <= max) continue;
      const [eid, m] = k.split('|');
      let h = (+eid * 2246822519 + +m.replace('-', '') * 3266489917 + lv * 668265263) >>> 0;
      const rnd = () => { h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return h; };
      // giữ ưu tiên ngày có công / tăng ca; ngày chỉ có 1 lượt chấm (thiếu giờ ra) bị gỡ trước
      const order = [...days.entries()].map(([d, rs]) => [d, rs.some((r) => r.worked) ? 0 : 1, rnd()]).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map((x) => x[0]);
      for (const d of order.slice(max)) for (const r of days.get(d)) out.set(r.id, { date: d, ot: r.ot_min || 0 });
    }
  }
  return out;
}

// SỐ NGÀY LÀM LIÊN TỤC TỐI ĐA: mỗi chuỗi ngày đi làm liền nhau dài hơn `max` → gỡ bớt ngày (coi như nghỉ) để cắt chuỗi.
// Mỗi lần cắt: trong `max`+1 ngày đầu của phần chuỗi còn lại, gỡ ngày YẾU nhất (ít giờ công nhất; ngày chỉ có tăng ca = 0 công bị gỡ trước), tie cố định theo NV + ngày + mức.
// Ngày đã chốt kỳ hoặc đã bị gỡ vì chủ nhật không tính (coi như ngày nghỉ, tự cắt chuỗi). Trả Map attendance.id → { date, ot } của các dòng bị gỡ.
function streakDrops(ids, L, R, max, lv, lockedDay, sunHidden) {
  const out = new Map();
  const dnum = (d) => Math.round(Date.parse(d + 'T12:00:00Z') / DAY);
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const byEmp = new Map();   // eid → Map ngày → { rows:[], work: tổng giờ công }
    for (const r of db.prepare(`SELECT id, employee_id, work_date, ot_min, work_minutes FROM attendance WHERE employee_id IN (${chunk.map(() => '?').join(',')})
        AND work_date >= ? AND work_date <= ? AND (work_minutes > 0 OR ot_min > 0 OR check_in_at IS NOT NULL)`).all(...chunk, L, R)) {
      if (lockedDay(r.work_date) || sunHidden.has(r.id)) continue;
      if (!byEmp.has(r.employee_id)) byEmp.set(r.employee_id, new Map());
      const dm = byEmp.get(r.employee_id);
      if (!dm.has(r.work_date)) dm.set(r.work_date, { rows: [], work: 0 });
      const g = dm.get(r.work_date); g.rows.push(r); g.work += r.work_minutes || 0;
    }
    for (const [eid, dm] of byEmp) {
      const dates = [...dm.keys()].sort();
      const rndOf = (d) => { let h = (eid * 2654435761 + dnum(d) * 40503 + lv * 97) >>> 0; h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return h; };
      let run = [];
      const flush = () => {
        if (run.length <= max) { run = []; return; }
        let j = 0;   // đầu phần chuỗi chưa xử lý
        while (run.length - j > max) {
          const window = run.slice(j, j + max + 1);
          let best = window[0];
          for (const d of window) { const w = dm.get(d).work, bw = dm.get(best).work; if (w < bw || (w === bw && rndOf(d) < rndOf(best))) best = d; }
          for (const r of dm.get(best).rows) out.set(r.id, { date: best, ot: r.ot_min || 0 });
          j = run.indexOf(best) + 1;
        }
        run = [];
      };
      for (let k = 0; k < dates.length; k++) { if (k > 0 && dnum(dates[k]) - dnum(dates[k - 1]) !== 1) flush(); run.push(dates[k]); }
      flush();
    }
  }
  return out;
}

// KHỐNG CHẾ GIỜ CHẤM ẢO: giờ vào không sớm hơn giờ vào ca quá `clampIn`, giờ ra không trễ hơn (giờ tan ca + tăng ca ảo còn lại) quá `clampOut`.
// Ngày chia 2 ca (sáng / chiều) → giờ ra giữa ca và giờ vào chiều cũng theo đúng luật này (mỗi ca 1 dòng công).
// Giờ nằm ngoài khoảng được thay bằng 1 giờ ngẫu nhiên TRONG khoảng (cố định theo NV + ngày + mức → xem lại vẫn ra đúng giờ đó);
// đi trễ / về sớm thật giữ nguyên. Chỉ đổi giờ hiển thị, không đổi công / tăng ca.
function clampRange(out, ids, from, to, S, lv, lockedDay) {
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    for (const r of db.prepare(`SELECT a.id, a.employee_id, a.work_date, a.ot_min, a.work_unit, a.check_in_at, a.check_out_at,
        s.start_time, s.end_time, s.break_minutes, s.ot_before FROM attendance a JOIN shifts s ON s.id = a.shift_id
      WHERE a.employee_id IN (${chunk.map(() => '?').join(',')}) AND a.work_date >= ? AND a.work_date <= ?`).all(...chunk, from, to)) {
      if (!r.start_time || !r.end_time || lockedDay(r.work_date)) continue;
      const cur = out.get(r.id);
      if (cur && cur.hidden) continue;
      const v = cur ? cur.ot_min : r.ot_min || 0;
      const t = clampTimes(r, cur ? cur.check_in_at : r.check_in_at, cur ? cur.check_out_at : r.check_out_at, v, S, lv);
      if (t) out.set(r.id, { hidden: false, ot_min: v, cut: cur ? cur.cut : 0, ...t });
    }
  }
}
function clampTimes(r, cin, cout, v, S, lv) {
  const st = Date.parse(`${r.work_date}T${r.start_time}:00+07:00`);
  let en = Date.parse(`${r.work_date}T${r.end_time}:00+07:00`); if (en <= st) en += DAY;
  let inT = cin ? Date.parse(cin) : null, outT = cout ? Date.parse(cout) : null;
  const in0 = inT, out0 = outT, vMs = v * 60000;
  // phần tăng ca ảo nằm SAU giờ tan ca (post) / TRƯỚC giờ vào ca (pre) — giờ ảo phải chừa đủ chỗ cho phần này
  let pre = 0, post;
  if (r.work_unit > 0) {
    post = Math.min(vMs, outT != null ? Math.max(0, outT - en) : 0);
    if (r.ot_before && inT != null) pre = Math.min(vMs - post, Math.max(0, st - inT));
  } else post = Math.max(0, vMs - Math.max(0, en - st - (r.break_minutes || 0) * 60000));   // ngày cả ca là tăng ca: chỉ phần vượt độ dài ca mới nằm sau giờ tan
  let h = (r.employee_id * 2654435761 + Date.parse(r.work_date) / DAY * 40503 + lv * 97) >>> 0;
  const rnd = (n) => { h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return Math.floor(h / 4294967296 * n); };   // 0 … n-1
  if (inT != null && inT < st - pre - S.clampIn) inT = st - pre - (S.clampIn ? S.clampIn - rnd(S.clampIn / 1000) * 1000 : 0);
  if (outT != null && outT > en + post + S.clampOut) outT = en + post + (S.clampOut ? rnd(S.clampOut / 1000) * 1000 : 0);
  if (inT != null && outT != null && inT > outT) inT = in0;   // lượt chấm nằm hẳn ngoài ca: không ép giờ vào vượt giờ ra
  if (inT === in0 && outT === out0) return null;
  return { check_in_at: inT != null ? new Date(inT).toISOString() : null, check_out_at: outT != null ? new Date(outT).toISOString() : null };
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
// Công ảo đã chốt của mức `lv` cho các NV trong [from, to]: Map 'empId|ngày' → [dòng công ảo] (bỏ dòng bị ẩn)
const toSec = (iso) => (iso ? Math.round(Date.parse(iso) / 1000) : null);
const toIso = (sec) => (sec == null ? null : new Date(sec * 1000).toISOString());
function lockedRows(ids, locks, lv, from, to) {
  const mq = locks.map(() => '?').join(','), months = locks.map((k) => k.month);
  const emp = new Map(), sh = new Map(db.prepare('SELECT id, name, start_time, end_time FROM shifts').all().map((x) => [x.id, x]));
  const out = new Map();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500), eq = chunk.map(() => '?').join(',');
    for (const e of db.prepare(`SELECT id, code, full_name, department FROM employees WHERE id IN (${eq})`).all(...chunk)) emp.set(e.id, e);
    const diff = new Map();
    for (const d of db.prepare(`SELECT employee_id, work_date, i, cin, cout, ot, hidden FROM audit_lock_att WHERE level=? AND month IN (${mq}) AND employee_id IN (${eq}) AND work_date >= ? AND work_date <= ?`).all(lv, ...months, ...chunk, from, to))
      diff.set(d.employee_id + '|' + d.work_date + '|' + d.i, d);
    for (const b of db.prepare(`SELECT * FROM audit_lock_att WHERE level=0 AND month IN (${mq}) AND employee_id IN (${eq}) AND work_date >= ? AND work_date <= ? ORDER BY employee_id, work_date, i`).all(...months, ...chunk, from, to)) {
      const k = b.employee_id + '|' + b.work_date, df = diff.get(k + '|' + b.i);
      if (df && df.hidden) continue;
      const e = emp.get(b.employee_id) || {}, x = sh.get(b.shift_id) || {};
      const row = { id: b.att_id, employee_id: b.employee_id, work_date: b.work_date, shift_id: b.shift_id, check_in_at: toIso(df ? df.cin : b.cin), check_out_at: toIso(df ? df.cout : b.cout),
        late_min: b.late || 0, early_min: b.early || 0, ot_min: df ? df.ot || 0 : b.ot || 0, ot_type: b.ot_type, work_minutes: b.wmin || 0, work_unit: b.wu || 0, day_status: b.day_status, manual: b.manual || 0,
        shift_source: null, note: null, code: e.code, full_name: e.full_name, department: e.department, shift_name: x.name || null, shift_start: x.start_time || null, shift_end: x.end_time || null };
      if (!out.has(k)) out.set(k, []);
      out.get(k).push(row);
    }
  }
  return out;
}

// CHỐT KỲ 1 tháng lương: lưu công ảo cả 3 mức (tính như hiện tại) vào CSDL → từ nay xem / in / lương ảo của tháng này luôn ra đúng số đã chốt
export function lockMonth(month, by = '') {
  if (!/^\d{4}-\d{2}$/.test(month)) throw Object.assign(new Error('Tháng không hợp lệ'), { status: 400 });
  if (db.prepare('SELECT 1 FROM audit_locks WHERE month=?').get(month)) throw Object.assign(new Error('Tháng này đã chốt'), { status: 409 });
  const { from, to } = payPeriod(month);
  const rows = db.prepare(`SELECT a.* FROM attendance a JOIN employees e ON e.id = a.employee_id
    WHERE a.work_date >= ? AND a.work_date <= ? AND IFNULL(e.audit_only, 0) = 0 ORDER BY a.employee_id, a.work_date, a.check_in_at, a.id`).all(from, to);
  const ids = [...new Set(rows.map((r) => r.employee_id))];
  const base = db.prepare(`INSERT INTO audit_lock_att(month, level, employee_id, work_date, i, att_id, shift_id, cin, cout, late, early, ot, ot_type, wmin, wu, day_status, manual, hidden)
    VALUES (?,0,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`);
  const dif = db.prepare('INSERT INTO audit_lock_att(month, level, employee_id, work_date, i, cin, cout, ot, hidden) VALUES (?,?,?,?,?,?,?,?,?)');
  const sum = db.prepare('INSERT OR REPLACE INTO audit_lock_sums(month, level, employee_id, thuong, cuoi_tuan, le) VALUES (?,?,?,?,?,?)');
  const vms = [1, 2, 3].map((lv) => virtualOt(ids, from, to, true, lv));   // tính TRƯỚC khi ghi khoá (tháng này chưa chốt)
  db.exec('BEGIN');
  try {
    const idx = new Map();   // thứ tự dòng trong NV × ngày (khớp level 0)
    for (const r of rows) {
      const k = r.employee_id + '|' + r.work_date; const i = idx.get(k) || 0; idx.set(k, i + 1); r._i = i;
      base.run(month, r.employee_id, r.work_date, i, r.id, r.shift_id, toSec(r.check_in_at), toSec(r.check_out_at), r.late_min || 0, r.early_min || 0, r.ot_min || 0, r.ot_type || null,
        r.work_minutes || 0, r.work_unit || 0, r.day_status || null, r.manual ? 1 : 0);
    }
    [1, 2, 3].forEach((lv, j) => {
      const vm = vms[j], tot = new Map();
      for (const r of rows) {
        const v = vm.get(r.id);
        if (v) dif.run(month, lv, r.employee_id, r.work_date, r._i, toSec(v.check_in_at), toSec(v.check_out_at), v.ot_min || 0, v.hidden ? 1 : 0);
        const ot = v ? (v.hidden ? 0 : v.ot_min) : (r.ot_min || 0); if (!ot) continue;
        const t = tot.get(r.employee_id) || { thuong: 0, cuoi_tuan: 0, le: 0 }; const ty = r.ot_type === 'le' ? 'le' : r.ot_type === 'cuoi_tuan' ? 'cuoi_tuan' : 'thuong';
        t[ty] += ot; tot.set(r.employee_id, t);
      }
      for (const [eid, t] of tot) sum.run(month, lv, eid, t.thuong, t.cuoi_tuan, t.le);
    });
    db.prepare('INSERT INTO audit_locks(month, from_date, to_date, locked_by, rows) VALUES (?,?,?,?,?)').run(month, from, to, by, rows.length);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { month, from, to, rows: rows.length, people: ids.length };
}
export function unlockMonth(month) {
  db.exec('BEGIN');
  try {
    for (const t of ['audit_lock_att', 'audit_lock_sums', 'audit_locks']) db.prepare(`DELETE FROM ${t} WHERE month=?`).run(month);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Tháng ĐÃ CHỐT: bỏ dòng công hiện tại, thay bằng đúng bản đã chốt (giữ các cột ghép thêm của nơi gọi, VD tên NV / ca);
// ngày đã chốt mà nay không còn dòng thật vẫn hiện theo bản chốt.
export function applyVirtual(rows, vmap, onlyEmp = null) {   // onlyEmp: map dùng chung nhiều NV → chỉ thêm ngày đã chốt của NV này
  const LK = vmap && vmap.locked;
  if (!vmap || (!vmap.size && !(LK && LK.ranges.length))) return rows;
  const inLocked = (d) => !!LK && LK.ranges.some((r) => d >= r.from && d <= r.to);
  const done = new Set();
  const res = [];
  for (const row of rows) {
    if (inLocked(row.work_date)) {
      const k = row.employee_id + '|' + row.work_date;
      if (done.has(k)) continue;
      done.add(k);
      for (const s of LK.rows.get(k) || []) res.push({ ...row, ...s });
      continue;
    }
    const v = vmap.get(row.id);
    if (!v) { res.push(row); continue; }
    if (v.hidden) continue;
    res.push({ ...row, ot_min: v.ot_min, check_in_at: v.check_in_at, check_out_at: v.check_out_at,
      // kiểu K (chỉ có khi mức ảo bật "Giờ trưa & đi trễ kiểu K"): giờ Ra / Vào trưa ảo, đi trễ được che → phút trễ 0 + đủ giờ công
      ...(v.k_ra ? { k_ra: v.k_ra } : {}), ...(v.k_vao ? { k_vao: v.k_vao } : {}),
      ...(v.work_minutes != null ? { late_min: v.late_min, work_minutes: v.work_minutes, work_unit: v.work_unit } : {}) });
  }
  if (LK) {
    const extra = [];
    for (const [k, arr] of LK.rows) if (!done.has(k) && (onlyEmp == null || k.startsWith(onlyEmp + '|'))) for (const s of arr) extra.push({ ...s });
    if (extra.length) {   // ngày đã chốt mà nay không còn dòng thật → xếp vào đúng chỗ theo ngày (giữ chiều sắp xếp của nơi gọi)
      const asc = !res.length || res[0].work_date <= res[res.length - 1].work_date;
      res.push(...extra);
      res.sort((p, q) => (p.work_date === q.work_date ? 0 : (p.work_date < q.work_date) === asc ? -1 : 1));
    }
  }
  return res;
}
