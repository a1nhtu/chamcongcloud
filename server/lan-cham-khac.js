// LẦN CHẤM KHÁC (Anh 20/11/2026, khách trankimxuyen): lượt quẹt KHÔNG được dùng làm giờ Vào / Ra của dòng công nào
// — quẹt giữa giờ (13h chứng minh có mặt), lượt của ca gãy không nhận, quẹt thêm lần nữa… Ca ghép Đầu–cuối chỉ lấy lượt đầu + cuối
// nên các lượt này trước đây chỉ thấy ở tab "Giờ nguồn".
// Mỗi lượt gắn vào dòng công CHỨA nó (giữa giờ vào và giờ ra, kể cả ca đêm qua nửa đêm); không dòng nào chứa thì gắn dòng GẦN NHẤT
// cùng ngày. Lượt trùng PHÚT với giờ vào / ra (hoặc với lượt khác đã gắn) không tính lại. Chỉ để HIỂN THỊ, không đổi công.
import { db } from './db.js';
import { applyVirtual } from './virtual-att.js';

const vnHM = (iso) => { if (!iso) return ''; const t = new Date(new Date(iso).getTime() + 7 * 3600000); return String(t.getUTCHours()).padStart(2, '0') + ':' + String(t.getUTCMinutes()).padStart(2, '0'); };
// ✎ = lượt thêm tay · 📱 = chấm điện thoại
export const punchMark = (serial) => (String(serial).startsWith('TAY_') ? '✎' : String(serial).startsWith('DT_') ? '📱' : '');

// GIỜ NGUỒN (như On39 "Giờ nguồn", Anh 16/11/2026): mỗi NV mỗi ngày 1 nhóm, MỌI lượt quẹt theo thứ tự (không theo ca / quy tắc ghép).
// Ngày chỉ chấm điện thoại (không có lượt máy) lấy giờ vào / ra của phiên chấm. Dùng chung cho tab "🕘 Giờ nguồn" và file Excel của nó.
// → [{ eid, date, times: ['05:51', '13:00✎'…], srcs: ['Máy cổng (máy 1)'…] }] theo thứ tự lượt quẹt.
export function rawPunchDays(empIds, from, to) {
  const groups = new Map();
  if (!empIds || !empIds.length) return [];
  const ph = empIds.map(() => '?').join(',');
  const put = (eid, d, t, src) => { const k = eid + '|' + d; if (!groups.has(k)) groups.set(k, { eid, date: d, times: [], srcs: [] }); const g = groups.get(k); g.times.push(t); g.srcs.push(src); };
  const dn = new Map(db.prepare('SELECT serial, name, machine_number FROM push_devices').all().map((d) => [d.serial, d]));
  const srcOf = (sr) => { sr = String(sr || ''); if (sr.startsWith('TAY_')) return 'Thêm tay'; if (sr.startsWith('DT_')) return 'Điện thoại'; const d = dn.get(sr); return d ? (d.name || sr) + (d.machine_number ? ` (máy ${d.machine_number})` : '') : sr; };
  for (const p of db.prepare(`SELECT employee_id, work_date, punch_at, serial FROM att_punches WHERE employee_id IN (${ph}) AND work_date>=? AND work_date<=? ORDER BY punch_at`).all(...empIds, from, to))
    put(p.employee_id, p.work_date, vnHM(p.punch_at) + punchMark(p.serial), srcOf(p.serial));
  const has = new Set(groups.keys());
  for (const a of db.prepare(`SELECT employee_id, work_date, check_in_at, check_out_at, check_in_photo, check_out_photo FROM attendance WHERE employee_id IN (${ph}) AND work_date>=? AND work_date<=? ORDER BY check_in_at`).all(...empIds, from, to)) {
    if (has.has(a.employee_id + '|' + a.work_date) || !(a.check_in_photo || a.check_out_photo)) continue;
    for (const x of [a.check_in_at, a.check_out_at]) if (x) put(a.employee_id, a.work_date, vnHM(x) + '📱', 'Điện thoại');
  }
  return [...groups.values()];
}
// Giờ nguồn ở CÔNG ẢO: chỉ giờ vào / ra ảo của từng dòng công, không lộ lượt quẹt thật. vmap = virtualOt(...) của virtual-att.js
export function virtPunchDays(empIds, from, to, vmap) {
  const groups = new Map();
  if (!empIds || !empIds.length) return [];
  const ph = empIds.map(() => '?').join(',');
  const att = db.prepare(`SELECT * FROM attendance WHERE employee_id IN (${ph}) AND work_date>=? AND work_date<=? ORDER BY check_in_at`).all(...empIds, from, to);
  for (const a of applyVirtual(att, vmap)) for (const x of [a.check_in_at, a.check_out_at]) if (x) {
    const k = a.employee_id + '|' + a.work_date;
    if (!groups.has(k)) groups.set(k, { eid: a.employee_id, date: a.work_date, times: [], srcs: [] });
    groups.get(k).times.push(vnHM(x)); groups.get(k).srcs.push('');
  }
  return [...groups.values()];
}

const addDay = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const minOf = (iso) => Math.floor(Date.parse(iso) / 60000);

// → { byRow: Map(attendance.id → [{ at: iso, serial }]), byDay: Map('empId|YYYY-MM-DD' → [iso…] mọi lượt của ngày: vào, ra + lượt khác, theo giờ) }
// Chỉ trả dòng công có work_date trong [from, to]; đọc thêm 1 ngày 2 đầu để ca đêm hôm trước / hôm sau giữ đúng lượt của nó.
export function otherPunches(empIds, from, to) {
  const byRow = new Map(), byDay = new Map();
  if (!empIds || !empIds.length) return { byRow, byDay };
  const ph = empIds.map(() => '?').join(',');
  const lo = addDay(from, -1), hi = addDay(to, 1);
  const rows = db.prepare(`SELECT id, employee_id, work_date, check_in_at, check_out_at FROM attendance
    WHERE employee_id IN (${ph}) AND work_date >= ? AND work_date <= ? AND (check_in_at IS NOT NULL OR check_out_at IS NOT NULL)`).all(...empIds, lo, hi);
  const rowsOf = new Map(), used = new Map();
  for (const r of rows) {
    r.a = Date.parse(r.check_in_at || r.check_out_at); r.b = Date.parse(r.check_out_at || r.check_in_at);
    if (!rowsOf.has(r.employee_id)) { rowsOf.set(r.employee_id, []); used.set(r.employee_id, new Set()); }
    rowsOf.get(r.employee_id).push(r);
    for (const x of [r.check_in_at, r.check_out_at]) if (x) used.get(r.employee_id).add(minOf(x));
  }
  for (const p of db.prepare(`SELECT employee_id, work_date, punch_at, serial FROM att_punches
    WHERE employee_id IN (${ph}) AND work_date >= ? AND work_date <= ? ORDER BY punch_at`).all(...empIds, lo, hi)) {
    const rs = rowsOf.get(p.employee_id);
    if (!rs) continue;
    const m = minOf(p.punch_at), seen = used.get(p.employee_id);
    if (seen.has(m)) continue;
    const t = Date.parse(p.punch_at);
    let row = rs.find((r) => r.check_in_at && r.check_out_at && t >= r.a && t <= r.b);
    if (!row) {
      let best = Infinity;
      for (const r of rs) {
        if (r.work_date !== p.work_date) continue;
        const dist = t < r.a ? r.a - t : t > r.b ? t - r.b : 0;
        if (dist < best) { best = dist; row = r; }
      }
    }
    if (!row) continue;
    seen.add(m);
    if (!byRow.has(row.id)) byRow.set(row.id, []);
    byRow.get(row.id).push({ at: p.punch_at, serial: p.serial });
  }
  for (const r of rows) {
    if (r.work_date < from || r.work_date > to) { byRow.delete(r.id); continue; }
    const k = r.employee_id + '|' + r.work_date;
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(...[r.check_in_at, r.check_out_at].filter(Boolean), ...(byRow.get(r.id) || []).map((x) => x.at));
  }
  // 1 lượt dùng chung làm giờ ra ca trước + giờ vào ca sau (dữ liệu tính bằng bản cũ) → chỉ 1 lần
  for (const [k, list] of byDay) {
    const s = new Set();
    byDay.set(k, list.sort((x, y) => Date.parse(x) - Date.parse(y)).filter((x) => !s.has(minOf(x)) && s.add(minOf(x))));
  }
  return { byRow, byDay };
}
