// CHỌN CA KHÔNG ĐOÁN (đợt 13/11/2026, Anh duyệt — chuẩn: "quên chấm thì khách bù tay, phần mềm KHÔNG đoán giờ để tính công / tìm ca").
// Việc 1 — quy tắc BIẾT HƯỚNG (Theo ID máy / Chọn từ máy / Tự động - qua đêm kiểu ID máy) + lịch nhiều ca: ghép cặp theo hướng TRƯỚC
//          rồi mỗi cặp / lượt lẻ mới tìm ca (pickDirShiftSet); lượt RA lẻ sáng sớm khớp cuối ca đêm hôm trước = dòng "chỉ giờ ra" của
//          ca đêm hôm trước (cả giữa chuỗi đêm liền của lịch 1 ca đêm — mục 8).
// Lượt chấm nạp qua ingestAttlog như máy đẩy lên ("v" = máy số 1 lẻ = VÀO / phím 0, "r" = máy số 2 chẵn = RA / phím 1).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'dgp-ccd-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema } = await import('../server/db.js');
const { ingestAttlog } = await import('../server/device-sync.js');
const { recomputeAttendance } = await import('../server/routes/admin/attendance.js');
const { pickDirShiftSet, stateDir } = await import('../server/attendance-calc.js');

const hm = (x) => (x ? new Date(Date.parse(x) + 7 * 3600e3).toISOString().slice(11, 16) : '-');
const vn = (dhm) => new Date(`2026-11-${dhm.replace(' ', 'T')}:00+07:00`).toISOString();
const ins = (t, o) => { const k = Object.keys(o); return Number(db.prepare(`INSERT INTO ${t}(${k.join(',')}) VALUES(${k.map(() => '?').join(',')})`).run(...k.map((x) => o[x])).lastInsertRowid); };
const S = {}, IO = {};
const sh = (code) => db.prepare('SELECT * FROM shifts WHERE id=?').get(S[code]);
let codeOf = {};

function schedAuto(codes) {
  const w = ins('work_schedules', { code: '', name: codes.join('/'), unit: 'auto', cycle: 1 });
  codes.forEach((c, i) => ins('work_schedule_shifts', { work_schedule_id: w, shift_id: S[c], sort_order: i }));
  return w;
}
function schedWeek(codes) {
  const w = ins('work_schedules', { code: '', name: codes.join('+'), unit: 'week', cycle: 1 });
  codes.forEach((c, i) => ins('work_schedule_shifts', { work_schedule_id: w, shift_id: S[c], sort_order: i }));
  for (let d = 0; d < 7; d++) for (const c of codes) ins('work_schedule_days', { work_schedule_id: w, idx: d, shift_id: S[c] });
  return w;
}
let n = 0;
function nv() {
  n++; const pin = String(8600 + n);
  return { pin, id: ins('employees', { code: 'CC' + n, full_name: 'NV ' + n, username: 'cc' + n, password_hash: 'x', role: 'employee', device_pin: pin }) };
}
const ganLich = (e, w, rule = 'filo') => ins('shift_assignments', { employee_id: e.id, mode: 'schedule', work_schedule_id: w, from_date: '2026-10-26', shift_type: 'fixed', merge_rule: 'default', inout_schedule_id: IO[rule], active: 1 });
function cham(e, list) {
  for (const p of [...list].sort()) {
    const [d, t, k = 'v'] = p.split(' ');
    ingestAttlog(k === 'r' ? 'SN2' : 'SN1', `${e.pin}\t2026-11-${d} ${t}:00\t${k === 'r' ? 1 : 0}\t1`, { ask: () => {} });
  }
}
const cong = (e) => db.prepare('SELECT * FROM attendance WHERE employee_id=? ORDER BY work_date, check_in_at').all(e.id)
  .map((r) => `${r.work_date.slice(8)}[${codeOf[r.shift_id] || '-'}] ${hm(r.check_in_at)}→${hm(r.check_out_at)} ${r.work_unit}c${r.late_min ? ' trễ' + r.late_min : ''}${r.early_min ? ' sớm' + r.early_min : ''}${r.ot_min ? ' tc' + r.ot_min : ''}`);
const tinhLai = (e) => recomputeAttendance({ from: '2026-11-01', to: '2026-11-10', ids: [e.id] });
// nạp lượt rồi kiểm; tính lại phải ra y như vậy
function kiem(e, list, want, msg) {
  cham(e, list);
  assert.deepEqual(cong(e), want, msg + ' — nạp lượt');
  tinhLai(e);
  assert.deepEqual(cong(e), want, msg + ' — sau Tính lại');
}

before(() => {
  initSchema();
  db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('punch_dedup_min','5')").run();
  db.prepare('UPDATE shifts SET active=0').run();   // bỏ ca mẫu: tự dò chỉ thấy ca của bài thử
  const base = { late_grace_min: 0, early_grace_min: 0, allow_ot: 1, ot_start_after_min: 30, work_unit_value: 1, break_minutes: 0 };
  const ca = (code, start, end, extra = {}) => (S[code] = ins('shifts', { ...base, name: code, code, start_time: start, end_time: end, ...(end <= start ? { cross_midnight: 1 } : {}), ...extra }));
  ca('HC', '08:00', '17:00', { break_minutes: 60 }); ca('DM', '19:00', '07:00', { break_minutes: 60 });
  ca('S6', '06:00', '14:00'); ca('C14', '14:00', '22:00'); ca('D22', '22:00', '06:00'); ca('C0', '00:00', '08:00');
  ca('SAW', '08:00', '12:00', { work_unit_value: 0.5, check_in_start: '07:00', check_in_end: '09:00', check_out_start: '11:30', check_out_end: '13:00' });
  ca('CHW', '13:30', '17:30', { work_unit_value: 0.5, check_in_start: '13:00', check_in_end: '14:30', check_out_start: '17:00', check_out_end: '20:00' });
  codeOf = Object.fromEntries(Object.entries(S).map(([k, v]) => [v, k]));
  db.prepare("INSERT INTO push_devices(serial,name,active,machine_number) VALUES('SN1','Cổng vào',1,1),('SN2','Cổng ra',1,2)").run();
  db.prepare('UPDATE inout_schedules SET is_default=0').run();
  for (const r of ['filo', 'pairs', 'tdqd', 'idm', 'state', 'tdhc']) IO[r] = ins('inout_schedules', { code: 'CC_' + r, name: r, rule: r, min_minutes: 30, max_minutes: 960, gap_minutes: 30, is_default: r === 'filo' ? 1 : 0 });
});
after(() => { try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} });

// ======================= VIỆC 1: ghép cặp theo hướng trước, rồi tìm ca =======================
// p('DD HH:MM v|r') → lượt chấm có phím trạng thái (Chọn từ máy): v = 0 Check-In, r = 1 Check-Out
const p = (s) => { const [d, t, k] = s.split(' '); return { punch_at: vn(`${d} ${t}`), serial: k === 'r' ? 'SN2' : 'SN1', status: k === 'r' ? 1 : 0 }; };
const chon = (codes, list, date = '2026-11-03', opts = {}) => pickDirShiftSet(codes.map(sh), list.map(p), date, stateDir, { min: 30, gap: 30, max: 960 }, opts)
  .map((x) => `${x.shift.code}:${x.punches.map((q) => hm(q.punch_at) + (q.status ? 'r' : 'v')).join(',')}`);

test('Việc 1 · pickDirShiftSet: RA lẻ tìm ca theo CUỐI ca, VÀO lẻ theo ĐẦU ca, cặp đủ theo cả hai', () => {
  assert.deepEqual(chon(['S6', 'C14'], ['03 14:05 r']), ['S6:14:05r']);   // trước: ca C14 (lượt RA thành giờ vào)
  assert.deepEqual(chon(['S6', 'C14'], ['03 13:55 v']), ['C14:13:55v']);
  assert.deepEqual(chon(['S6', 'C14'], ['03 05:55 v', '03 14:05 r', '03 14:06 v', '03 22:04 r']), ['S6:05:55v,14:05r', 'C14:14:06v,22:04r']);
  // ca đêm quên vào: RA 07:00 sáng hôm sau là cuối ca đêm hôm nay (không thành "HC 19:00→07:00")
  assert.deepEqual(chon(['HC', 'DM'], ['04 07:00 r']), ['DM:07:00r']);
  // ... trừ khi cuối một ca HÔM SAU gần lượt đó hơn hẳn → để hôm sau
  assert.deepEqual(chon(['HC', 'DM'], ['04 07:00 r'], '2026-11-03', { nextOutClaim: () => true }), []);
  assert.deepEqual(chon(['HC', 'DM'], ['03 19:00 v', '04 07:00 r']), ['DM:19:00v,07:00r']);
  // ca đêm ra ngoài 23:00 rồi vào lại 01:00 hôm sau: cả 2 cặp thuộc ca đêm
  assert.deepEqual(chon(['HC', 'DM'], ['03 19:00 v', '03 23:00 r', '04 01:00 v', '04 07:00 r']), ['DM:19:00v,23:00r,01:00v,07:00r']);
  // chỉ có cặp VÀO sáng hôm sau: không làm giờ vào đầu tiên của ca đêm hôm nay
  assert.deepEqual(chon(['HC', 'DM'], ['04 01:00 v', '04 07:00 r']), []);
  // 2 ca không chồng giờ: ca ngày đủ + RA lẻ sáng hôm sau khớp cuối ca đêm
  assert.deepEqual(chon(['HC', 'DM'], ['03 08:00 v', '03 17:00 r', '04 07:00 r']), ['HC:08:00v,17:00r', 'DM:07:00r']);
});

test('Việc 1 · S7: lịch S6 / C14, Theo ID máy, chỉ 1 lượt RA 14:05 → dòng chỉ giờ ra thuộc [S6], 0 công, không trễ', () => {
  for (const rule of ['idm', 'state']) {
    const e = nv(); ganLich(e, schedAuto(['S6', 'C14']), rule);
    kiem(e, ['03 14:05 r'], ['03[S6] -→14:05 0c'], rule);
    const r = db.prepare('SELECT check_in_at, late_min FROM attendance WHERE employee_id=?').get(e.id);
    assert.equal(r.check_in_at, null); assert.equal(r.late_min, 0);
  }
});

test('Việc 1 · S7b giữ nguyên: làm liền 2 ca S6 + C14 → 2 dòng', () => {
  const e = nv(); ganLich(e, schedAuto(['S6', 'C14']), 'idm');
  kiem(e, ['03 05:55 v', '03 14:05 r', '03 14:06 v', '03 22:04 r'], ['03[S6] 05:55→14:05 1c', '03[C14] 14:06→22:04 0.98c trễ6'], 'S7b');
});

test('Việc 1 · lịch HC / DM biết hướng, quên VÀO đêm đầu / đêm giữa → dòng chỉ giờ ra của đúng đêm đó, đêm kế đủ công', () => {
  for (const rule of ['idm', 'state']) {
    const a = nv(); ganLich(a, schedAuto(['HC', 'DM']), rule);
    kiem(a, ['03 07:00 r', '03 19:00 v', '04 07:00 r'], ['02[DM] -→07:00 0c', '03[DM] 19:00→07:00 1c'], 'Z4 ' + rule);
    const b = nv(); ganLich(b, schedAuto(['HC', 'DM']), rule);
    kiem(b, ['02 19:00 v', '03 07:00 r', '04 07:00 r', '04 19:00 v', '05 07:00 r'],
      ['02[DM] 19:00→07:00 1c', '03[DM] -→07:00 0c', '04[DM] 19:00→07:00 1c'], 'Z3 ' + rule);
  }
});

test('Việc 1 · mục 8: lịch 1 ca đêm, quên VÀO đêm GIỮA chuỗi → thêm dòng chỉ giờ ra của đêm đó', () => {
  const e = nv(); ganLich(e, schedWeek(['DM']), 'idm');
  kiem(e, ['02 19:00 v', '03 07:00 r', '04 07:00 r', '04 19:00 v', '05 07:00 r'],
    ['02[DM] 19:00→07:00 1c', '03[DM] -→07:00 0c', '04[DM] 19:00→07:00 1c'], 'DM1 Z3');
});

test('Việc 1 · RA lẻ sáng hôm sau gần CUỐI ca hôm sau hơn (ca 00:00–08:00) → của hôm sau, hôm nay không có dòng', () => {
  const e = nv(); ganLich(e, schedAuto(['DM', 'C0']), 'idm');
  kiem(e, ['04 07:55 r'], ['04[C0] -→07:55 0c'], 'C0');
});

test('Việc 1 · lịch nhiều ca CÓ khung giờ + Theo ID máy: theo hướng của máy, không ép "Phân theo giờ" (vào trễ 09:30 ngoài khung vào vẫn có dòng)', () => {
  const e = nv(); ganLich(e, schedWeek(['SAW', 'CHW']), 'idm');
  kiem(e, ['03 09:30 v', '03 12:00 r', '03 13:25 v', '03 17:35 r'], ['03[SAW] 09:30→12:00 0.31c trễ90', '03[CHW] 13:25→17:35 0.5c'], 'SAW/CHW idm');
});

test('Việc 1 · quy tắc KHÔNG biết hướng giữ cách chọn ca cũ (lịch HC / DM, quên vào đêm đầu: HC 07:00→19:00 như mốc)', () => {
  const e = nv(); ganLich(e, schedAuto(['HC', 'DM']), 'filo');
  kiem(e, ['03 07:00 r', '03 19:00 v', '04 07:00 r'], ['03[HC] 07:00→19:00 1c tc120', '04[HC] 07:00→- 0c'], 'Z4 filo');
});
