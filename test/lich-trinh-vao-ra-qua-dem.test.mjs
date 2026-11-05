// Lịch trình vào ra "Tự động - không qua đêm" (pairs) và "Tự động - qua đêm" (tdqd), đối chiếu Ronald Jack Pro + Wise Eye On39.
//  - RJ / On39: "tự động" = lượt 1 VÀO, lượt 2 RA… ghép trong NGÀY; "qua đêm" = thêm: lượt VÀO lẻ cuối ngày ghép với lượt
//    sáng hôm sau (RJ kiểu 7: ngày trước còn lẻ lượt + cách nhau ≤ Thời gian lớn nhất; On39: Số ngày = 1).
//  - Lỗi cũ 1: tdqd chạy y hệt FILO (không tính cặp, không trừ giờ ra ngoài).
//  - Lỗi cũ 2: gán Lịch trình ca làm việc, ô Lịch trình vào ra để Mặc định → bỏ qua lịch trình vào ra MẶC ĐỊNH, luôn thành FILO.
// Dùng CSDL tạm, nạp lượt chấm thật qua ingestAttlog (như máy đẩy lên).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'dgp-tdqd-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema } = await import('../server/db.js');
const { ingestAttlog } = await import('../server/device-sync.js');
const { resolveDayShifts } = await import('../server/shift-resolver.js');
const { rulePairs, openTailIn, punchPairs } = await import('../server/attendance-calc.js');

const hm = (x) => (x ? new Date(Date.parse(x) + 7 * 3600e3).toISOString().slice(8, 16).replace('T', ' ') : null);
const vn = (dhm) => new Date(`2026-11-${dhm.replace(' ', 'T')}:00+07:00`).toISOString();
let S = {}, W = {}, IO = {}, n = 0;

function ws(name, unit, shiftIds) {
  const w = db.prepare("INSERT INTO work_schedules(code,name,unit,cycle) VALUES('',?,?,1)").run(name, unit).lastInsertRowid;
  shiftIds.forEach((s, i) => {
    db.prepare('INSERT OR IGNORE INTO work_schedule_shifts(work_schedule_id,shift_id,sort_order) VALUES(?,?,?)').run(w, s, i);
    if (unit === 'week') for (let d = 0; d < 7; d++) db.prepare('INSERT OR IGNORE INTO work_schedule_days(work_schedule_id,idx,shift_id) VALUES(?,?,?)').run(w, d, s);
  });
  return w;
}
// Tạo 1 NV gán lịch trình `w` + lịch trình vào ra `io` (null = để Mặc định), nạp các lượt chấm → các dòng công
function chay(w, io, punches) {
  n++; const pin = String(5000 + n);
  const e = db.prepare("INSERT INTO employees(code,full_name,username,password_hash,role,device_pin) VALUES(?,?,?,'x','employee',?)").run('Q' + n, 'NV ' + n, 'q' + n, pin).lastInsertRowid;
  db.prepare("INSERT INTO shift_assignments(employee_id,mode,work_schedule_id,from_date,shift_type,merge_rule,inout_schedule_id,active) VALUES(?,'schedule',?,'2026-10-26','fixed','default',?,1)").run(e, w, io);
  ingestAttlog('SN1', punches.map((p) => `${pin}\t2026-11-${p}:00\t0\t1`).join('\n'), { ask: () => {} });
  const rows = db.prepare('SELECT * FROM attendance WHERE employee_id=? ORDER BY work_date, check_in_at').all(e);
  return { e, rows, day: (d) => rows.find((r) => r.work_date === '2026-11-' + d) };
}

before(() => {
  initSchema();
  const ins = (o) => { const k = Object.keys(o); return db.prepare(`INSERT INTO shifts(${k.join(',')}) VALUES(${k.map(() => '?').join(',')})`).run(...k.map((x) => o[x])).lastInsertRowid; };
  const base = { late_grace_min: 0, early_grace_min: 0, allow_ot: 1, ot_start_after_min: 30, work_unit_value: 1, break_minutes: 60 };
  S.NG = ins({ ...base, name: 'Ngày', code: 'NG', start_time: '08:00', end_time: '19:00' });
  S.HC = ins({ ...base, name: 'Hành chính', code: 'HC', start_time: '08:00', end_time: '17:00' });
  S.DM = ins({ ...base, name: 'Đêm', code: 'DM', start_time: '19:00', end_time: '07:00', cross_midnight: 1 });
  db.prepare('UPDATE inout_schedules SET is_default=0').run();
  const io = db.prepare('INSERT INTO inout_schedules(code,name,rule,min_minutes,max_minutes,gap_minutes,is_default) VALUES (?,?,?,?,?,?,?)');
  IO.filo = io.run('T_F', 'filo', 'filo', 30, 960, 30, 1).lastInsertRowid;
  IO.pairs = io.run('T_P', 'pairs', 'pairs', 30, 960, 30, 0).lastInsertRowid;
  IO.tdqd = io.run('T_Q', 'tdqd', 'tdqd', 30, 960, 30, 0).lastInsertRowid;
  W.NG = ws('Ngày', 'week', [S.NG]); W.HC = ws('HC', 'week', [S.HC]); W.DM = ws('Đêm', 'week', [S.DM]);
  W.AUTO = ws('Tự do', 'auto', [S.HC, S.DM]);
});
after(() => { try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} });

const setDefault = (id) => { db.prepare('UPDATE inout_schedules SET is_default=0').run(); if (id) db.prepare('UPDATE inout_schedules SET is_default=1 WHERE id=?').run(id); };

test('rulePairs: 2 kiểu "Tự động" tính theo cặp; tdqd kiểu con ID máy và các quy tắc khác thì không', () => {
  assert.equal(rulePairs('pairs', {}), true);
  assert.equal(rulePairs('tdqd', {}), true);
  assert.equal(rulePairs('tdqd', { tdqd_mode: 'pair' }), true);
  assert.equal(rulePairs('tdqd', { tdqd_mode: 'idm' }), false);
  for (const r of ['filo', 'tdhc', 'idm', 'state', null, undefined]) assert.equal(rulePairs(r, {}), false, String(r));
});

test('openTailIn: lượt VÀO lẻ cuối (sau khi bỏ quẹt lặp) — punchPairs giữ nguyên kết quả cũ', () => {
  const t = (h) => vn('02 ' + h);
  assert.equal(openTailIn([t('08:00'), t('17:00'), t('18:00')], 30), t('18:00'));
  assert.equal(openTailIn([t('08:00'), t('17:00')], 30), null);
  assert.equal(openTailIn([t('08:00'), t('08:10'), t('17:00')], 30), null);   // 08:10 là quẹt lặp
  assert.equal(openTailIn([t('17:00'), t('17:10')], 30), t('17:00'));          // ra cách vào < 30' → chưa có cặp
  assert.equal(punchPairs([t('08:00'), t('12:00'), t('13:00'), t('17:00')], 30).length, 2);
});

test('Ca ĐÊM, ra ngoài 22:00–02:00: tdqd và pairs trừ 4 tiếng (480p), FILO tính đủ 660p', () => {
  const p = ['02 19:00', '02 22:00', '03 02:00', '03 07:00'];
  for (const r of ['tdqd', 'pairs']) {
    const d = chay(W.DM, IO[r], p).day('02');
    assert.equal(hm(d.check_in_at), '02 19:00', r); assert.equal(hm(d.check_out_at), '03 07:00', r);
    assert.equal(d.work_minutes, 480, r); assert.equal(d.work_unit, 0.72, r);
  }
  const f = chay(W.DM, IO.filo, p).day('02');
  assert.equal(f.work_minutes, 660); assert.equal(f.work_unit, 1);
});

test('Ca ĐÊM tdqd: 2 đêm liền, ăn đêm 1 tiếng, tăng ca tới 09:00, quên ra — như FILO', () => {
  const a = chay(W.DM, IO.tdqd, ['02 19:00', '03 07:00', '03 19:00', '04 07:00']);
  assert.deepEqual(a.rows.map((r) => [hm(r.check_in_at), hm(r.check_out_at), r.work_unit]), [['02 19:00', '03 07:00', 1], ['03 19:00', '04 07:00', 1]]);
  const an = chay(W.DM, IO.tdqd, ['02 19:00', '03 00:00', '03 01:00', '03 07:00']).day('02');
  assert.equal(an.work_minutes, 660);   // 19–00 + 01–07 = 11 tiếng, giờ nghỉ 60' coi như đã nằm trong lúc ra ngoài
  const ot = chay(W.DM, IO.tdqd, ['02 19:00', '03 09:00']).day('02');
  assert.equal(ot.ot_min, 120);
  const quen = chay(W.DM, IO.tdqd, ['02 19:00', '03 19:00', '04 07:00']);
  assert.equal(quen.day('02').day_status, 'thieu_ra');
  assert.equal(hm(quen.day('03').check_out_at), '04 07:00');
});

test('Ca NGÀY tdqd: ra ngoài 12:00–14:00 bị trừ (540p = 0,9 công); FILO không trừ (600p)', () => {
  const p = ['02 08:00', '02 12:00', '02 14:00', '02 19:00'];
  const q = chay(W.NG, IO.tdqd, p).day('02');
  assert.equal(q.work_minutes, 540); assert.equal(q.work_unit, 0.9);
  assert.equal(chay(W.NG, IO.filo, p).day('02').work_minutes, 600);
});

test('QUA ĐÊM (tdqd): ca HC tăng ca 18:00 → 01:30 sáng hôm sau → 01:30 là giờ RA của hôm trước', () => {
  const r = chay(W.HC, IO.tdqd, ['02 08:00', '02 17:00', '02 18:00', '03 01:30', '03 08:00', '03 17:00']);
  const d2 = r.day('02'), d3 = r.day('03');
  assert.equal(hm(d2.check_in_at), '02 08:00'); assert.equal(hm(d2.check_out_at), '03 01:30');
  assert.equal(d2.work_unit, 1);
  assert.ok(d2.ot_min >= 400, 'tăng ca 18:00–01:30 phải được tính, ot_min=' + d2.ot_min);
  // hôm sau KHÔNG lấy 01:30 làm giờ vào
  assert.equal(hm(d3.check_in_at), '03 08:00'); assert.equal(hm(d3.check_out_at), '03 17:00');
  assert.equal(d3.late_min, 0); assert.equal(d3.work_unit, 1);
});

test('KHÔNG qua đêm (pairs): cùng lượt chấm → 18:00 lẻ, 01:30 thuộc hôm sau (như Ronald Jack kiểu 2)', () => {
  const r = chay(W.HC, IO.pairs, ['02 08:00', '02 17:00', '02 18:00', '03 01:30', '03 08:00', '03 17:00']);
  assert.equal(hm(r.day('02').check_out_at), '02 18:00');
  assert.equal(hm(r.day('03').check_in_at), '03 01:30');
});

test('tdqd: lượt sáng hôm sau là GIỜ VÀO ca hôm sau (07:50) → không ghép, hôm trước thiếu cặp cuối', () => {
  const r = chay(W.HC, IO.tdqd, ['02 08:00', '02 12:00', '02 13:00', '03 07:50', '03 17:00']);
  assert.equal(hm(r.day('02').check_out_at), '02 13:00');   // 13:00 vào lại sau trưa, quên ra
  assert.equal(r.day('02').work_minutes, 240);               // chỉ cặp 08–12
  assert.equal(hm(r.day('03').check_in_at), '03 07:50'); assert.equal(hm(r.day('03').check_out_at), '03 17:00');
});

test('tdqd: lượt sáng hôm sau quá "Thời gian lớn nhất" (16 tiếng) → không ghép', () => {
  const r = chay(W.HC, IO.tdqd, ['02 08:00', '03 05:00', '03 17:00']);   // 08:00 → 05:00 = 21 tiếng
  assert.equal(r.day('02').day_status, 'thieu_ra');
  assert.equal(hm(r.day('03').check_in_at), '03 05:00');
});

test('tdqd: quẹt lặp sau lượt RA lúc sáng sớm (01:30, 01:31) → ra 01:31, hôm sau không có giờ vào 01:31', () => {
  const r = chay(W.HC, IO.tdqd, ['02 08:00', '02 17:00', '02 18:00', '03 01:30', '03 01:31', '03 08:00', '03 17:00']);
  assert.equal(hm(r.day('02').check_out_at), '03 01:31');
  assert.equal(hm(r.day('03').check_in_at), '03 08:00');
});

test('tdqd: máy đẩy lượt sáng hôm sau MUỘN (tải bù) → ngày hôm trước vẫn được dựng lại đúng', () => {
  n++; const pin = String(5000 + n);
  const e = db.prepare("INSERT INTO employees(code,full_name,username,password_hash,role,device_pin) VALUES(?,?,?,'x','employee',?)").run('Q' + n, 'NV ' + n, 'q' + n, pin).lastInsertRowid;
  db.prepare("INSERT INTO shift_assignments(employee_id,mode,work_schedule_id,from_date,shift_type,merge_rule,inout_schedule_id,active) VALUES(?,'schedule',?,'2026-10-26','fixed','default',?,1)").run(e, W.HC, IO.tdqd);
  ingestAttlog('SN1', [`${pin}\t2026-11-02 08:00:00\t0\t1`, `${pin}\t2026-11-02 17:00:00\t0\t1`, `${pin}\t2026-11-02 18:00:00\t0\t1`].join('\n'), { ask: () => {} });
  ingestAttlog('SN1', `${pin}\t2026-11-03 01:30:00\t0\t1`, { ask: () => {} });
  const d2 = db.prepare("SELECT * FROM attendance WHERE employee_id=? AND work_date='2026-11-02'").get(e);
  assert.equal(hm(d2.check_out_at), '03 01:30');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM attendance WHERE employee_id=? AND work_date='2026-11-03'").get(e).c, 0);
});

test('tdqd + lịch Tự do (HC / Đêm): ngày tăng ca quá nửa đêm vẫn nhận đúng ca HC, ra 01:30', () => {
  const r = chay(W.AUTO, IO.tdqd, ['02 08:00', '02 17:00', '02 18:00', '03 01:30']);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].shift_id, S.HC);
  assert.equal(hm(r.rows[0].check_out_at), '03 01:30');
});

test('Lịch trình vào ra MẶC ĐỊNH = Tự động, ô gán để Mặc định → áp dụng (trước đây thành FILO)', () => {
  setDefault(IO.pairs);
  try {
    const r = chay(W.NG, null, ['02 08:00', '02 12:00', '02 14:00', '02 19:00']);
    assert.equal(r.day('02').work_minutes, 540);
    assert.equal(resolveDayShifts(r.e, '2026-11-02').mergeRule, 'pairs');
    // chọn hẳn FILO lúc gán → FILO thắng mặc định
    assert.equal(chay(W.NG, IO.filo, ['02 08:00', '02 12:00', '02 14:00', '02 19:00']).day('02').work_minutes, 600);
  } finally { setDefault(IO.filo); }
});

test('Mặc định FILO hoặc không có lịch trình vào ra nào → như cũ (FILO)', () => {
  assert.equal(chay(W.NG, null, ['02 08:00', '02 12:00', '02 14:00', '02 19:00']).day('02').work_minutes, 600);
  setDefault(null);
  try { assert.equal(chay(W.NG, null, ['02 08:00', '02 12:00', '02 14:00', '02 19:00']).day('02').work_minutes, 600); }
  finally { setDefault(IO.filo); }
});

test('FILO ca ngày: lượt sáng hôm sau KHÔNG bị kéo về hôm trước (chỉ tdqd mới ghép qua đêm)', () => {
  const r = chay(W.HC, IO.filo, ['02 08:00', '02 18:00', '03 01:30', '03 08:00', '03 17:00']);
  assert.equal(hm(r.day('02').check_out_at), '02 18:00');
  assert.equal(hm(r.day('03').check_in_at), '03 01:30');
});
