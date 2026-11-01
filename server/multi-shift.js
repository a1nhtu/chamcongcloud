// Hỗ trợ nhân viên làm NHIỀU CA trong 1 ngày (ca gãy) ở Bảng phân ca — CHỈ HIỂN THỊ / CẢNH BÁO, không đổi cách tính công.
// Công tắc "multi_shift_assist" (Cài đặt › Quy tắc tính công), mặc định TẮT: tắt thì mọi hàm xuất ra phần thêm ở đây trả {} → API y như cũ.
// Module này KHÔNG được import bởi code tính công (device-sync, attendance-calc, shift-resolver, day-metrics) — có test khoá.
import { db, getSetting } from './db.js';
import { shiftBounds } from './attendance-calc.js';

export const multiAssistOn = () => getSetting('multi_shift_assist', '0') === '1';

const codeOf = (s) => ((s.code || '').trim() || s.name || '');

// Phân tích 1 ngày của 1 NV được gán ≥ 2 ca. rows = các dòng công (attendance) của NV đó trong ngày.
//  - status từng ca: ok = có dòng công của ca đó · missing = ngày đã có chấm nhưng ca này không có dòng công · unknown = ngày chưa có dòng công nào
//  - overlap: các cặp ca chồng giờ (khi tính công chỉ 1 trong 2 ca được chọn)
//  - twoPunch: chỉ có 1 dòng công mà khoảng vào–ra phủ ≥ nửa một ca khác được gán (nghi chỉ quẹt 2 lần, thiếu quẹt trưa) — chỉ cảnh báo, công vẫn tính như cũ
//  - mark: ⚠ chồng giờ · ✗ thiếu ca · ✓ đủ ca · '' chưa có dữ liệu chấm
export function analyzeMultiDay(workDate, shifts, rows = []) {
  const list = shifts.map((s) => ({ s, ...shiftBounds(workDate, s) }));
  const overlap = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++)
    if (list[i].start < list[j].end && list[j].start < list[i].end) overlap.push([codeOf(list[i].s), codeOf(list[j].s)]);
  const have = new Set(rows.map((r) => r.shift_id));
  const items = shifts.map((s) => ({
    id: s.id, code: codeOf(s), name: s.name, start: s.start_time, end: s.end_time,
    status: !rows.length ? 'unknown' : have.has(s.id) ? 'ok' : 'missing',
  }));
  let twoPunch = false;
  if (rows.length === 1 && rows[0].check_in_at && rows[0].check_out_at) {
    const r = rows[0], own = list.find((x) => x.s.id === r.shift_id);
    const t0 = Date.parse(r.check_in_at), t1 = Date.parse(r.check_out_at);
    for (const x of list) {
      if (x.s.id === r.shift_id) continue;
      if (own && x.start < own.end && own.start < x.end) continue;   // chồng giờ với ca đã tính → không phải chuyện thiếu quẹt trưa
      if (Math.min(t1, x.end) - Math.max(t0, x.start) >= 0.5 * (x.end - x.start)) twoPunch = true;
    }
  }
  const mark = overlap.length ? '⚠' : items.some((i) => i.status === 'missing') ? '✗' : items.every((i) => i.status === 'ok') ? '✓' : '';
  return { mark, shifts: items, overlap, twoPunch };
}

// Các ô (NV × ngày) trong [from, to] đang được gán ≥ 2 ca (lớp đang hiệu lực: ô Excel, không thì lịch tạm thời), kèm phân tích.
function multiCells(from, to) {
  const byKey = new Map();
  const off = new Set();
  for (const a of db.prepare('SELECT employee_id, work_date, shift_id, is_off FROM dsa_effective WHERE work_date >= ? AND work_date <= ?').all(from, to)) {
    const k = a.employee_id + '|' + a.work_date;
    if (a.is_off) { off.add(k); continue; }
    if (!a.shift_id) continue;
    if (!byKey.has(k)) byKey.set(k, new Set());
    byKey.get(k).add(a.shift_id);
  }
  const shById = new Map(db.prepare('SELECT * FROM shifts').all().map((s) => [s.id, s]));
  const att = new Map();
  for (const r of db.prepare('SELECT employee_id, work_date, shift_id, check_in_at, check_out_at FROM attendance WHERE work_date >= ? AND work_date <= ?').all(from, to)) {
    const k = r.employee_id + '|' + r.work_date;
    if (!att.has(k)) att.set(k, []);
    att.get(k).push(r);
  }
  const out = new Map();
  for (const [k, ids] of byKey) {
    if (off.has(k) || ids.size < 2) continue;
    const shifts = [...ids].map((id) => shById.get(id)).filter(Boolean).sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
    if (shifts.length < 2) continue;
    out.set(k, analyzeMultiDay(k.split('|')[1], shifts, att.get(k) || []));
  }
  return out;
}

// Phần thêm vào kết quả GET /admin/assignments (Bảng phân ca). Công tắc tắt → {} (không thêm khoá nào).
export function multiAssistExtra(from, to) {
  if (!multiAssistOn()) return {};
  const multi = {};
  for (const [k, v] of multiCells(from, to)) multi[k] = v;
  return { multiAssist: true, multi };
}

// Phần thêm vào kết quả Nhập Excel / Lưu ô: số ô nhiều ca + cảnh báo ca chồng giờ. keys = 'empId|YYYY-MM-DD'. Công tắc tắt → {}.
export function multiAssistReport(keys) {
  if (!multiAssistOn()) return {};
  const list = [...keys];
  if (!list.length) return { multiCells: 0, overlapWarn: [] };
  const dates = list.map((k) => k.split('|')[1]).sort();
  const all = multiCells(dates[0], dates[dates.length - 1]);
  const code = db.prepare('SELECT code FROM employees WHERE id = ?');
  let n = 0; const warn = [];
  for (const k of list) {
    const m = all.get(k); if (!m) continue;
    n++;
    const [eid, d] = k.split('|');
    for (const [a, b] of m.overlap) warn.push(`Ngày ${d.slice(8)}/${d.slice(5, 7)} (NV ${code.get(+eid)?.code || eid}): ca ${a} và ca ${b} chồng giờ — khi tính công chỉ 1 trong 2 ca được chọn`);
  }
  return { multiCells: n, overlapWarn: warn.slice(0, 20) };
}
