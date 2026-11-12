// RÀ SOÁT 12/11/2026 — 3 lỗi dựng công từ lượt chấm máy (server/device-sync.js):
//  1. Đổi lịch NHIỀU ca/ngày sang 1 ca (hoặc bỏ gán → tự dò) rồi "Tính lại": dòng công ca cũ còn sót → ngày đó cộng trùng công.
//  2. Ca gãy (Sáng + Chiều) về muộn hơn giờ tan ca cuối quá 4 tiếng: mất dòng ca Chiều, tăng ca tính từ cuối ca Sáng (gấp đôi).
//  3. 1 ca đêm + quy tắc Theo ID máy / Chọn từ máy: lượt VÀO sáng hôm sau (sau khi ca đêm đã hết) thành dòng rác "trễ 780'" ở ngày trước.
// Mỗi lỗi kèm các ca giữ nguyên kết quả cũ (chỉ đổi đúng tình huống sai). Lượt chấm nạp qua ingestAttlog như máy đẩy lên.
// Chạy: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'dgp-rs1211-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema } = await import('../server/db.js');
const { ingestAttlog } = await import('../server/device-sync.js');
const { recomputeAttendance } = await import('../server/routes/admin/attendance.js');

const hm = (x) => (x ? new Date(Date.parse(x) + 7 * 3600e3).toISOString().slice(11, 16) : '-');
const ins = (t, o) => { const k = Object.keys(o); return Number(db.prepare(`INSERT INTO ${t}(${k.join(',')}) VALUES(${k.map(() => '?').join(',')})`).run(...k.map((x) => o[x])).lastInsertRowid); };
const S = {}, W = {}, IO = {};
let codeOf = {};

// lịch tuần: mỗi ngày đúng các ca `codes`; days[idx] (idx 0 = Thứ Hai) để mỗi ngày 1 kiểu
function schedWeek(codes, days = null) {
  const w = ins('work_schedules', { code: '', name: codes.join('+'), unit: 'week', cycle: 1 });
  const all = days ? [...new Set(days.flat())] : codes;
  all.forEach((c, i) => ins('work_schedule_shifts', { work_schedule_id: w, shift_id: S[c], sort_order: i }));
  for (let d = 0; d < 7; d++) for (const c of (days ? days[d] : codes)) ins('work_schedule_days', { work_schedule_id: w, idx: d, shift_id: S[c] });
  return w;
}
function schedAuto(codes) {
  const w = ins('work_schedules', { code: '', name: codes.join('/'), unit: 'auto', cycle: 1 });
  codes.forEach((c, i) => ins('work_schedule_shifts', { work_schedule_id: w, shift_id: S[c], sort_order: i }));
  return w;
}
let n = 0;
function nv() {
  n++; const pin = String(8100 + n);
  return { pin, id: ins('employees', { code: 'RS' + n, full_name: 'NV ' + n, username: 'rs' + n, password_hash: 'x', role: 'employee', device_pin: pin }) };
}
const ganLich = (e, w, rule = 'filo') => ins('shift_assignments', { employee_id: e.id, mode: 'schedule', work_schedule_id: w, from_date: '2026-10-26', shift_type: 'fixed', merge_rule: 'default', inout_schedule_id: IO[rule], active: 1 });
const ganCa = (e, code) => ins('shift_assignments', { employee_id: e.id, mode: 'shift', shift_id: S[code], from_date: '2026-10-26', shift_type: 'fixed', merge_rule: 'default', inout_schedule_id: IO.filo, active: 1 });
// lượt chấm 'DD HH:MM v|r': v = máy số 1 (lẻ = VÀO) phím 0 Check-In, r = máy số 2 (chẵn = RA) phím 1 Check-Out; đẩy lần lượt theo giờ như máy thật
function cham(e, list) {
  for (const p of [...list].sort()) {
    const [d, t, k = 'v'] = p.split(' ');
    ingestAttlog(k === 'r' ? 'SN2' : 'SN1', `${e.pin}\t2026-11-${d} ${t}:00\t${k === 'r' ? 1 : 0}\t1`, { ask: () => {} });
  }
}
const cong = (e) => db.prepare('SELECT * FROM attendance WHERE employee_id=? ORDER BY work_date, check_in_at').all(e.id)
  .map((r) => `${r.work_date.slice(8)}[${codeOf[r.shift_id] || '-'}] ${hm(r.check_in_at)}→${hm(r.check_out_at)} ${r.work_unit}c${r.late_min ? ' trễ' + r.late_min : ''}${r.ot_min ? ' tc' + r.ot_min : ''}`);
const tinhLai = (e) => recomputeAttendance({ from: '2026-11-01', to: '2026-11-10', ids: [e.id] });

before(() => {
  initSchema();
  db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('punch_dedup_min','5')").run();
  db.prepare('UPDATE shifts SET active=0').run();   // bỏ ca mẫu: tự dò chỉ thấy ca của bài thử
  const base = { late_grace_min: 0, early_grace_min: 0, allow_ot: 1, ot_start_after_min: 30, work_unit_value: 1, break_minutes: 0 };
  const ca = (code, start, end, extra = {}) => (S[code] = ins('shifts', { ...base, name: code, code, start_time: start, end_time: end, ...(end <= start ? { cross_midnight: 1 } : {}), ...extra }));
  ca('HC', '08:00', '17:00', { break_minutes: 60 });
  ca('SA', '08:00', '12:00', { work_unit_value: 0.5 });
  ca('CH', '13:30', '17:30', { work_unit_value: 0.5 });
  ca('CHE', '13:30', '17:30', { work_unit_value: 0.5, check_out_end: '20:00' });   // ca Chiều có khai "Kết thúc ra"
  ca('C1', '08:00', '12:00', { work_unit_value: 0.5 });
  ca('C2', '12:00', '16:00', { work_unit_value: 0.5 });                              // nối liền C1
  ca('C0', '00:00', '08:00', { check_in_start: '22:00' });                           // nhận vào từ 22:00 tối hôm trước
  ca('DM', '19:00', '07:00', { break_minutes: 60 });
  codeOf = Object.fromEntries(Object.entries(S).map(([k, v]) => [v, k]));
  db.prepare("INSERT INTO push_devices(serial,name,active,machine_number) VALUES('SN1','Cổng vào',1,1),('SN2','Cổng ra',1,2)").run();
  db.prepare('UPDATE inout_schedules SET is_default=0').run();
  for (const r of ['filo', 'pairs', 'idm', 'state']) IO[r] = ins('inout_schedules', { code: 'RS_' + r, name: r, rule: r, min_minutes: 30, max_minutes: 960, gap_minutes: 30, is_default: r === 'filo' ? 1 : 0 });
  W.SACH = schedWeek(['SA', 'CH']);
  W.SACHE = schedWeek(['SA', 'CHE']);
  W.C1C2 = schedWeek(['C1', 'C2']);
  W.SACHHC = schedAuto(['SA', 'CH', 'HC']);
  W.DM = schedWeek(['DM']);
  // Thứ Ba 03/11 làm Sáng + Chiều, Thứ Tư 04/11 làm ca C0 (00:00–08:00)
  W.SACH_C0 = schedWeek([], [['SA', 'CH'], ['SA', 'CH'], ['C0'], ['SA', 'CH'], ['SA', 'CH'], ['SA', 'CH'], ['SA', 'CH']]);
});
after(() => { try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} });

/* ===================== LỖI 1: dòng công thừa khi đổi lịch nhiều ca → 1 ca rồi Tính lại ===================== */
const BON_LUOT = ['03 08:00 v', '03 12:00 r', '03 13:30 v', '03 17:30 r'];

test('lỗi 1: lịch Sáng + Chiều → đổi sang 1 ca HC rồi Tính lại: chỉ còn 1 dòng HC (trước đây sót dòng Chiều → 1,5 công)', () => {
  const e = nv(); const a = ganLich(e, W.SACH);
  cham(e, BON_LUOT);
  assert.deepEqual(cong(e), ['03[SA] 08:00→12:00 0.5c', '03[CH] 13:30→17:30 0.5c']);
  db.prepare('UPDATE shift_assignments SET active=0 WHERE id=?').run(a);
  ganCa(e, 'HC');
  tinhLai(e);
  assert.deepEqual(cong(e), ['03[HC] 08:00→17:30 1c tc30']);
  tinhLai(e);   // tính lại lần nữa vẫn vậy
  assert.deepEqual(cong(e), ['03[HC] 08:00→17:30 1c tc30']);
});

test('lỗi 1: lịch Sáng + Chiều → bỏ gán (tự dò ca) rồi Tính lại: chỉ còn 1 dòng', () => {
  const e = nv(); const a = ganLich(e, W.SACH);
  cham(e, BON_LUOT);
  db.prepare('UPDATE shift_assignments SET active=0 WHERE id=?').run(a);
  tinhLai(e);
  const rows = cong(e);
  assert.equal(rows.length, 1, rows.join(' | '));
  assert.match(rows[0], /^03\[[^\]]+\] 08:00→17:30 /);
});

test('lỗi 1: dòng sửa tay của ngày đó vẫn giữ nguyên khi Tính lại', () => {
  const e = nv(); const a = ganLich(e, W.SACH);
  cham(e, BON_LUOT);
  db.prepare("UPDATE attendance SET manual=1 WHERE employee_id=? AND shift_id=?").run(e.id, S.CH);
  db.prepare('UPDATE shift_assignments SET active=0 WHERE id=?').run(a);
  ganCa(e, 'HC');
  tinhLai(e);
  assert.ok(cong(e).includes('03[CH] 13:30→17:30 0.5c'), 'dòng Chiều sửa tay còn nguyên');
});

/* ===================== LỖI 2: ca gãy về muộn hơn cuối ca Chiều + 4 tiếng ===================== */
test('lỗi 2: Sáng + Chiều, về 22:00 → Sáng 08–12 + Chiều 13:30–22:00 tăng ca 270 (trước đây chỉ 1 dòng Sáng 08→22, tăng ca 600)', () => {
  for (const rule of ['filo', 'pairs', 'idm', 'state']) {
    const e = nv(); ganLich(e, W.SACH, rule);
    cham(e, ['03 08:00 v', '03 12:00 r', '03 13:30 v', '03 22:00 r']);
    const want = ['03[SA] 08:00→12:00 0.5c', '03[CH] 13:30→22:00 0.5c tc270'];
    assert.deepEqual(cong(e), want, rule);
    tinhLai(e);
    assert.deepEqual(cong(e), want, rule + ' sau Tính lại');
  }
});

test('lỗi 2: về 23:59 vẫn nhận (tới hết ngày như 1 ca/ngày); về 21:20 ra y như cũ', () => {
  const a = nv(); ganLich(a, W.SACH);
  cham(a, ['03 08:00 v', '03 12:00 r', '03 13:30 v', '03 23:59 r']);
  assert.deepEqual(cong(a), ['03[SA] 08:00→12:00 0.5c', '03[CH] 13:30→23:59 0.5c tc388.8']);
  const b = nv(); ganLich(b, W.SACH);
  cham(b, ['03 08:00 v', '03 12:00 r', '03 13:30 v', '03 21:20 r']);
  assert.deepEqual(cong(b), ['03[SA] 08:00→12:00 0.5c', '03[CH] 13:30→21:20 0.5c tc229.8']);
});

test('lỗi 2: ca nối liền C1 08–12 + C2 12–16, quẹt 2 lần ở mốc, về 21:00 → đủ 2 dòng', () => {
  const e = nv(); ganLich(e, W.C1C2);
  cham(e, ['03 08:00 v', '03 12:00 r', '03 12:01 v', '03 21:00 r']);
  assert.deepEqual(cong(e), ['03[C1] 08:00→12:00 0.5c', '03[C2] 12:01→21:00 0.49c trễ1 tc300']);
});

test('lỗi 2 — giữ nguyên: đủ 4 lượt, chỉ làm 1 ca, quên chấm giữa ca, ca có khai "Kết thúc ra"', () => {
  const ca = (w, list) => { const e = nv(); ganLich(e, w); cham(e, list); return cong(e); };
  assert.deepEqual(ca(W.SACH, BON_LUOT), ['03[SA] 08:00→12:00 0.5c', '03[CH] 13:30→17:30 0.5c']);
  assert.deepEqual(ca(W.SACH, ['03 08:00 v', '03 12:00 r']), ['03[SA] 08:00→12:00 0.5c']);
  assert.deepEqual(ca(W.SACH, ['03 13:30 v', '03 17:30 r']), ['03[CH] 13:30→17:30 0.5c']);
  // quên chấm giữa ca: vẫn 1 ca như cũ (không đoán giờ lượt bị thiếu)
  assert.deepEqual(ca(W.SACH, ['03 08:00 v', '03 22:00 r']), ['03[SA] 08:00→22:00 0.5c tc600']);
  assert.deepEqual(ca(W.SACH, ['03 09:00 v', '03 22:00 r']), ['03[SA] 09:00→22:00 0.37c trễ60 tc600']);
  assert.deepEqual(ca(W.SACH, ['03 08:00 v', '03 12:00 r', '03 22:00 r']), ['03[SA] 08:00→22:00 0.5c tc600']);
  // ca Chiều đã khai "Kết thúc ra" 20:00 → theo đúng khung đã khai
  assert.deepEqual(ca(W.SACHE, ['03 08:00 v', '03 12:00 r', '03 13:30 v', '03 22:00 r']), ['03[SA] 08:00→22:00 0.5c tc600']);
  // lịch Sáng / Chiều / HC: đã chọn HC theo khung thường thì không đổi sang Sáng + Chiều
  assert.deepEqual(ca(W.SACHHC, ['03 08:00 v', '03 12:00 r', '03 13:30 v', '03 16:30 r', '03 22:00 r']), ['03[HC] 08:00→22:00 1c tc300']);
});

test('lỗi 2 — giữ nguyên: lượt 23:50 là giờ vào ca 00:00 hôm sau, không thành giờ ra ca Chiều', () => {
  const e = nv(); ganLich(e, W.SACH_C0);
  cham(e, ['03 08:00 v', '03 12:00 r', '03 13:30 v', '03 17:30 r', '03 23:50 v', '04 08:00 r']);
  assert.deepEqual(cong(e), ['03[SA] 08:00→12:00 0.5c', '03[CH] 13:30→17:30 0.5c', '04[C0] 23:50→08:00 1c']);
});

/* ===================== LỖI 3: 1 ca đêm + Theo ID máy / Chọn từ máy ===================== */
test('lỗi 3: chỉ 1 lượt VÀO 08:00 sáng 02 rồi đêm 03 đủ → không còn dòng rác ngày 01 "trễ 780"', () => {
  for (const rule of ['idm', 'state']) {
    const e = nv(); ganLich(e, W.DM, rule);
    cham(e, ['02 08:00 v', '03 19:00 v', '04 07:00 r']);
    assert.deepEqual(cong(e), ['03[DM] 19:00→07:00 1c'], rule);
    tinhLai(e);
    assert.deepEqual(cong(e), ['03[DM] 19:00→07:00 1c'], rule + ' sau Tính lại');
  }
});

test('lỗi 3: đêm 02 quên chấm ra, 04 vào 08:00 ra 17:00 → không còn dòng rác ngày 03', () => {
  for (const rule of ['idm', 'state']) {
    const e = nv(); ganLich(e, W.DM, rule);
    cham(e, ['02 19:00 v', '04 08:00 v', '04 17:00 r']);
    assert.deepEqual(cong(e), ['02[DM] 19:00→- 0c', '04[DM] -→17:00 0c'], rule);
    tinhLai(e);
    assert.deepEqual(cong(e), ['02[DM] 19:00→- 0c', '04[DM] -→17:00 0c'], rule + ' sau Tính lại');
  }
});

test('lỗi 3: quên chấm vào đêm 02, ra 07:00 rồi 08:00 vào lại → dòng 02 chỉ có giờ ra (không lấy 08:00 làm giờ vào)', () => {
  for (const rule of ['idm', 'state']) {
    const e = nv(); ganLich(e, W.DM, rule);
    cham(e, ['03 07:00 r', '03 08:00 v']);
    assert.deepEqual(cong(e), ['02[DM] -→07:00 0c'], rule);
  }
});

test('lỗi 3 — giữ nguyên: quên chấm vào (chỉ lượt RA), vào trễ sau nửa đêm (có / không có giờ ra)', () => {
  for (const rule of ['idm', 'state']) {
    const ca = (list) => { const e = nv(); ganLich(e, W.DM, rule); cham(e, list); return cong(e); };
    assert.deepEqual(ca(['03 07:00 r']), ['02[DM] -→07:00 0c'], rule);
    assert.deepEqual(ca(['03 00:30 v', '03 07:00 r']), ['02[DM] 00:30→07:00 0.5c trễ330'], rule);
    assert.deepEqual(ca(['03 00:30 v']), ['02[DM] 00:30→- 0c trễ330'], rule);
    assert.deepEqual(ca(['03 00:30 v', '03 07:00 r', '03 19:00 v', '04 07:00 r']), ['02[DM] 00:30→07:00 0.5c trễ330', '03[DM] 19:00→07:00 1c'], rule);
  }
});
