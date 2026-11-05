// MA TRẬN ghép cặp vào–ra cho MỌI quy tắc (lịch trình vào ra) × ca ngày / ca đêm / quên chấm / quẹt lặp / ra ngoài / tăng ca qua đêm.
// Mỗi NV gán 1 lịch trình ca (tuần) + 1 lịch trình vào ra; lượt chấm nạp qua ingestAttlog như máy đẩy lên:
//   - "v" = quẹt ở máy số 1 (lẻ = VÀO), phím trạng thái 0 (Check-In)
//   - "r" = quẹt ở máy số 2 (chẵn = RA),  phím trạng thái 1 (Check-Out)
// Cùng 1 bộ lượt chấm chạy qua 7 quy tắc → so kết quả với cách Ronald Jack / Wise Eye On39 tính.
// SHOW=1 node --test test/ma-tran-ghep-cap.test.mjs → in bảng đầy đủ.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'dgp-matran-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema } = await import('../server/db.js');
const { ingestAttlog } = await import('../server/device-sync.js');
const { idmPairs, idmOpenIn, idmRows, stateRows } = await import('../server/attendance-calc.js');

const hm = (x) => (x ? new Date(Date.parse(x) + 7 * 3600e3).toISOString().slice(8, 16).replace('T', ' ') : '-');
const vn = (dhm) => new Date(`2026-11-${dhm.replace(' ', 'T')}:00+07:00`).toISOString();
const S = {}, W = {}, IO = {};
let n = 0;

function ws(name, shiftId) {
  const w = db.prepare("INSERT INTO work_schedules(code,name,unit,cycle) VALUES('',?,'week',1)").run(name).lastInsertRowid;
  db.prepare('INSERT INTO work_schedule_shifts(work_schedule_id,shift_id,sort_order) VALUES(?,?,0)').run(w, shiftId);
  for (let d = 0; d < 7; d++) db.prepare('INSERT INTO work_schedule_days(work_schedule_id,idx,shift_id) VALUES(?,?,?)').run(w, d, shiftId);
  return w;
}

// 7 quy tắc: tên → [lịch trình vào ra, hậu tố ca] (tdqd kiểu ID máy = ca có tdqd_mode 'idm'; TĐ-HC = ca có khung vào/ra)
const RULES = { filo: ['filo', ''], pairs: ['pairs', ''], tdqd: ['tdqd', ''], tdqdI: ['tdqd', 'I'], idm: ['idm', ''], state: ['state', ''], tdhc: ['tdhc', 'W'] };

// Chạy 1 NV: ca `ca` (HC | DM), quy tắc `rule`, lượt chấm ['DD HH:MM v|r', ...] → các dòng công
function chay(ca, rule, punches) {
  n++; const pin = String(7000 + n);
  const [io, suf] = RULES[rule];
  const e = db.prepare("INSERT INTO employees(code,full_name,username,password_hash,role,device_pin) VALUES(?,?,?,'x','employee',?)").run('M' + n, 'NV ' + n, 'm' + n, pin).lastInsertRowid;
  db.prepare("INSERT INTO shift_assignments(employee_id,mode,work_schedule_id,from_date,shift_type,merge_rule,inout_schedule_id,active) VALUES(?,'schedule',?,'2026-10-26','fixed','default',?,1)")
    .run(e, W[ca + suf], IO[io]);
  const by = { v: [], r: [] };
  for (const p of punches) { const [d, t, k] = p.split(' '); by[k].push(`${pin}\t2026-11-${d} ${t}:00\t${k === 'v' ? 0 : 1}\t1`); }
  if (by.v.length) ingestAttlog('SN1', by.v.join('\n'), { ask: () => {} });
  if (by.r.length) ingestAttlog('SN2', by.r.join('\n'), { ask: () => {} });
  return db.prepare('SELECT * FROM attendance WHERE employee_id=? ORDER BY work_date, check_in_at').all(e)
    .map((r) => ({ d: r.work_date.slice(8), vao: hm(r.check_in_at), ra: hm(r.check_out_at), gio: r.work_minutes, cong: r.work_unit, tre: r.late_min, som: r.early_min, tc: r.ot_min }));
}
const txt = (rows) => rows.map((r) => `${r.d}: ${r.vao}→${r.ra} ${r.gio}p ${r.cong}c tre${r.tre} som${r.som} tc${r.tc}`).join(' | ') || '(không có dòng công)';

before(() => {
  initSchema();
  db.prepare("UPDATE settings SET value='5' WHERE key='punch_dedup_min'").run();
  db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('punch_dedup_min','5')").run();
  const ins = (o) => { const k = Object.keys(o); return db.prepare(`INSERT INTO shifts(${k.join(',')}) VALUES(${k.map(() => '?').join(',')})`).run(...k.map((x) => o[x])).lastInsertRowid; };
  const base = { late_grace_min: 0, early_grace_min: 0, allow_ot: 1, ot_start_after_min: 30, work_unit_value: 1, break_minutes: 60 };
  const HC = { ...base, name: 'HC', code: 'HC', start_time: '08:00', end_time: '17:00' };
  const DM = { ...base, name: 'Đêm', code: 'DM', start_time: '19:00', end_time: '07:00', cross_midnight: 1 };
  S.HC = ins(HC); S.DM = ins(DM);
  S.HCI = ins({ ...HC, code: 'HCI', tdqd_mode: 'idm' }); S.DMI = ins({ ...DM, code: 'DMI', tdqd_mode: 'idm' });
  S.HCW = ins({ ...HC, code: 'HCW', check_in_start: '05:00', check_in_end: '11:00', check_out_start: '11:30', check_out_end: '23:59' });
  S.DMW = ins({ ...DM, code: 'DMW', check_in_start: '16:00', check_in_end: '22:00', check_out_start: '04:00', check_out_end: '11:00' });
  for (const k of Object.keys(S)) W[k] = ws(k, S[k]);
  // Lịch trình "tự do" HC + Đêm: ngày nào làm ca nào phần mềm tự dò theo giờ chấm (ca xoay ngày / đêm)
  const auto = (name, ids) => { const w = db.prepare("INSERT INTO work_schedules(code,name,unit,cycle) VALUES('',?,'auto',1)").run(name).lastInsertRowid; ids.forEach((id, i) => db.prepare('INSERT INTO work_schedule_shifts(work_schedule_id,shift_id,sort_order) VALUES(?,?,?)').run(w, id, i)); return w; };
  W.XOAY = auto('Xoay', [S.HC, S.DM]); W.XOAYI = auto('XoayI', [S.HCI, S.DMI]); W.XOAYW = auto('XoayW', [S.HCW, S.DMW]);
  db.prepare("INSERT INTO push_devices(serial,name,active,machine_number) VALUES('SN1','Cổng vào',1,1),('SN2','Cổng ra',1,2)").run();
  db.prepare('UPDATE inout_schedules SET is_default=0').run();
  const io = db.prepare('INSERT INTO inout_schedules(code,name,rule,min_minutes,max_minutes,gap_minutes,is_default) VALUES (?,?,?,30,960,30,?)');
  for (const r of ['filo', 'pairs', 'tdqd', 'idm', 'state', 'tdhc']) IO[r] = io.run('MT_' + r, r, r, r === 'filo' ? 1 : 0).lastInsertRowid;
});
after(() => { try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} });

// ===== CÁC TRƯỜNG HỢP (ngày 02/11/2026 = thứ Hai) =====
export const CASES = {
  A_chuan_2lan: ['HC', ['02 08:00 v', '02 17:00 r']],
  B_4lan_nghi_trua: ['HC', ['02 08:00 v', '02 12:00 r', '02 13:00 v', '02 17:00 r']],
  C_quen_ra: ['HC', ['02 08:00 v']],
  D_quen_vao: ['HC', ['02 17:00 r']],
  E_quen_ra_trua: ['HC', ['02 08:00 v', '02 13:00 v', '02 17:00 r']],
  F_quen_vao_chieu: ['HC', ['02 08:00 v', '02 12:00 r', '02 17:00 r']],
  G_quet_lap: ['HC', ['02 08:00 v', '02 08:06 v', '02 17:00 r', '02 17:06 r']],
  H_ra_ngoai_2h: ['HC', ['02 08:00 v', '02 10:00 r', '02 12:00 v', '02 17:00 r']],
  I_tang_ca_toi: ['HC', ['02 08:00 v', '02 17:00 r', '02 18:00 v', '02 21:00 r']],
  J_tang_ca_qua_dem: ['HC', ['02 08:00 v', '02 17:00 r', '02 18:00 v', '03 01:30 r']],
  K_mot_mach_qua_dem: ['HC', ['02 08:00 v', '03 01:30 r']],
  L_tre_som: ['HC', ['02 08:30 v', '02 16:00 r']],
  M_dem_chuan: ['DM', ['02 19:00 v', '03 07:00 r']],
  N_dem_ra_ngoai: ['DM', ['02 19:00 v', '02 22:00 r', '03 02:00 v', '03 07:00 r']],
  O_dem_quen_ra: ['DM', ['02 19:00 v']],
  P_dem_quen_vao: ['DM', ['03 07:00 r']],
  Q_dem_2_dem_lien: ['DM', ['02 19:00 v', '03 07:00 r', '03 19:00 v', '04 07:00 r']],
  R_dem_quen_ra_dem1: ['DM', ['02 19:00 v', '03 19:00 v', '04 07:00 r']],
  S_quet_nham_may: ['HC', ['02 07:58 r', '02 08:00 v', '02 17:00 r']],
  T_ra_lap_20p: ['HC', ['02 08:00 v', '02 17:00 r', '02 17:20 r']],
  U_xoay_ngay_dem: ['XOAY', ['02 08:00 v', '02 17:00 r', '03 19:00 v', '04 07:00 r', '05 08:00 v', '05 12:00 r', '05 13:00 v', '05 17:00 r']],
  V_xoay_dem_ra_ngoai: ['XOAY', ['02 19:00 v', '02 23:00 r', '03 01:00 v', '03 07:00 r', '04 08:00 v', '04 17:00 r']],
};

// KẾT QUẢ CHUẨN: "*" = mọi quy tắc còn lại. Mỗi ô: ngày: vào→ra · giờ công (phút) · công · trễ · sớm · tăng ca (phút)
// (đã soát tay từng ô theo cách Ronald Jack / Wise Eye On39 — xem chú thích các test bên dưới)
const EXPECT = {
  A_chuan_2lan: {"*": "02: 02 08:00→02 17:00 480p 1c tre0 som0 tc0"},
  B_4lan_nghi_trua: {"*": "02: 02 08:00→02 17:00 480p 1c tre0 som0 tc0"},
  C_quen_ra: {"*": "02: 02 08:00→- 0p 0c tre0 som0 tc0"},
  D_quen_vao: {"*": "02: 02 17:00→- 0p 0c tre540 som0 tc0"},
  E_quen_ra_trua: {"*": "02: 02 08:00→02 17:00 240p 0.5c tre0 som0 tc0", "filo": "02: 02 08:00→02 17:00 480p 1c tre0 som0 tc0", "pairs": "02: 02 08:00→02 17:00 240p 0.5c tre0 som240 tc0", "tdqd": "02: 02 08:00→02 17:00 240p 0.5c tre0 som240 tc0", "tdhc": "02: 02 08:00→02 17:00 480p 1c tre0 som0 tc0"},
  F_quen_vao_chieu: {"*": "02: 02 08:00→02 17:00 240p 0.5c tre0 som300 tc0", "filo": "02: 02 08:00→02 17:00 480p 1c tre0 som0 tc0", "tdhc": "02: 02 08:00→02 17:00 480p 1c tre0 som0 tc0"},
  G_quet_lap: {"*": "02: 02 08:00→02 17:06 480p 1c tre0 som0 tc0"},
  H_ra_ngoai_2h: {"*": "02: 02 08:00→02 17:00 420p 0.87c tre0 som0 tc0", "filo": "02: 02 08:00→02 17:00 480p 1c tre0 som0 tc0", "tdhc": "02: 02 08:00→02 17:00 480p 1c tre0 som0 tc0"},
  I_tang_ca_toi: {"*": "02: 02 08:00→02 21:00 480p 1c tre0 som0 tc180", "filo": "02: 02 08:00→02 21:00 480p 1c tre0 som0 tc240", "tdhc": "02: 02 08:00→02 21:00 480p 1c tre0 som0 tc240"},
  J_tang_ca_qua_dem: {"*": "02: 02 08:00→02 18:00 480p 1c tre0 som0 tc60 | 03: 03 01:30→- 0p 0c tre0 som0 tc0", "pairs": "02: 02 08:00→02 18:00 480p 1c tre0 som0 tc0 | 03: 03 01:30→- 0p 0c tre0 som0 tc0", "tdqd": "02: 02 08:00→03 01:30 480p 1c tre0 som0 tc450", "tdqdI": "02: 02 08:00→03 01:30 480p 1c tre0 som0 tc450", "idm": "02: 02 08:00→02 17:00 480p 1c tre0 som0 tc0 | 03: 03 01:30→- 0p 0c tre0 som0 tc0", "state": "02: 02 08:00→02 17:00 480p 1c tre0 som0 tc0 | 03: 03 01:30→- 0p 0c tre0 som0 tc0"},
  K_mot_mach_qua_dem: {"*": "02: 02 08:00→- 0p 0c tre0 som0 tc0 | 03: 03 01:30→- 0p 0c tre0 som0 tc0"},
  L_tre_som: {"*": "02: 02 08:30→02 16:00 390p 0.81c tre30 som60 tc0"},
  M_dem_chuan: {"*": "02: 02 19:00→03 07:00 660p 1c tre0 som0 tc0"},
  N_dem_ra_ngoai: {"*": "02: 02 19:00→03 07:00 480p 0.72c tre0 som0 tc0", "filo": "02: 02 19:00→03 07:00 660p 1c tre0 som0 tc0", "tdhc": "02: 02 19:00→03 07:00 660p 1c tre0 som0 tc0"},
  O_dem_quen_ra: {"*": "02: 02 19:00→- 0p 0c tre0 som0 tc0"},
  P_dem_quen_vao: {"*": "(không có dòng công)"},
  Q_dem_2_dem_lien: {"*": "02: 02 19:00→03 07:00 660p 1c tre0 som0 tc0 | 03: 03 19:00→04 07:00 660p 1c tre0 som0 tc0"},
  R_dem_quen_ra_dem1: {"*": "02: 02 19:00→- 0p 0c tre0 som0 tc0 | 03: 03 19:00→04 07:00 660p 1c tre0 som0 tc0"},
  S_quet_nham_may: {"*": "02: 02 07:58→02 17:00 480p 1c tre0 som0 tc0", "tdqdI": "02: 02 08:00→02 17:00 480p 1c tre0 som0 tc0", "idm": "02: 02 08:00→02 17:00 480p 1c tre0 som0 tc0", "state": "02: 02 08:00→02 17:00 480p 1c tre0 som0 tc0"},
  T_ra_lap_20p: {"*": "02: 02 08:00→02 17:20 480p 1c tre0 som0 tc0"},
  U_xoay_ngay_dem: {"*": "02: 02 08:00→02 17:00 480p 1c tre0 som0 tc0 | 03: 03 19:00→04 07:00 660p 1c tre0 som0 tc0 | 05: 05 08:00→05 17:00 480p 1c tre0 som0 tc0"},
  V_xoay_dem_ra_ngoai: {"*": "02: 02 19:00→03 07:00 600p 0.9c tre0 som0 tc0 | 04: 04 08:00→04 17:00 480p 1c tre0 som0 tc0", "filo": "02: 02 19:00→03 07:00 660p 1c tre0 som0 tc0 | 04: 04 08:00→04 17:00 480p 1c tre0 som0 tc0", "tdhc": "02: 02 19:00→03 07:00 660p 1c tre0 som0 tc0 | 04: 04 08:00→04 17:00 480p 1c tre0 som0 tc0"},
};

const RES = {};
test('chạy ma trận', () => {
  for (const [name, [ca, ps]] of Object.entries(CASES)) {
    RES[name] = {};
    for (const rule of Object.keys(RULES)) RES[name][rule] = chay(ca, rule, ps);
  }
  if (process.env.SHOW) {
    for (const [name, [ca, ps]] of Object.entries(CASES)) {
      console.log(`\n### ${name} (${ca}) lượt: ${ps.join(', ')}`);
      for (const rule of Object.keys(RULES)) console.log(`  ${rule.padEnd(6)} ${txt(RES[name][rule])}`);
    }
  }
});

test('ma trận: kết quả từng quy tắc đúng bảng chuẩn', () => {
  for (const [name, exp] of Object.entries(EXPECT)) for (const rule of Object.keys(RULES))
    assert.equal(txt(RES[name][rule]), exp[rule] ?? exp['*'], `${name} · ${rule}`);
});

test('Theo ID máy kiểu On39: vào lại khi chưa ra = quên ra, ra khi chưa vào = quên vào, ra lặp lấy lượt sau', () => {
  const P = (h, m) => ({ punch_at: vn('02 ' + h), serial: m === 'v' ? 'A' : 'B' });
  const mnum = (p) => (p.serial === 'A' ? 1 : 2);
  const ps = [P('07:50', 'r'), P('08:00', 'v'), P('08:10', 'v'), P('10:00', 'v'), P('12:00', 'r'), P('12:10', 'r'), P('17:00', 'r'), P('18:00', 'v')];
  // 07:50 ra chưa vào (quên vào) · 08:00 vào (08:10 lặp) · 10:00 vào lại → 08:00 quên ra · 10:00–12:10 (ra lặp 12:00/12:10 lấy sau)
  // · 17:00 ra không có vào (quên vào) · 18:00 vào chưa ra (mở)
  assert.deepEqual(idmRows(ps, mnum, { min: 30 }).map(([a, b]) => [hm(a), hm(b)]),
    [['-', '02 07:50'], ['02 08:00', '-'], ['02 10:00', '02 12:10'], ['-', '02 17:00'], ['02 18:00', '-']]);
  assert.deepEqual(idmPairs(ps, mnum, { min: 30 }).map(([a, b]) => [hm(a), hm(b)]), [['02 10:00', '02 12:10']]);
  assert.equal(hm(idmOpenIn(ps, mnum, { min: 30 })), '02 18:00');
  // cặp dài quá "thời gian lớn nhất" → lượt vào cũ quên ra, lượt ra này quên vào
  assert.deepEqual(idmRows([P('01:00', 'v'), P('20:00', 'r')], mnum, { min: 30, max: 960 }).map(([a, b]) => [hm(a), hm(b)]), [['02 01:00', '-'], ['-', '02 20:00']]);
  // Chọn từ máy: phím 0/3/4 vào, 1/2/5 ra, phím khác bỏ qua
  const S = (h, st) => ({ punch_at: vn('02 ' + h), status: st });
  assert.deepEqual(stateRows([S('08:00', 0), S('11:00', 2), S('11:30', 9), S('12:00', 3), S('17:00', 1)], 30).map(([a, b]) => [hm(a), hm(b)]),
    [['02 08:00', '02 11:00'], ['02 12:00', '02 17:00']]);
});

test('báo cáo danh sách: Theo ID máy / Chọn từ máy hiện từng lần vào–ra (kể cả dòng quên ra)', async () => {
  const { signToken } = await import('../server/auth.js');
  const express = (await import('express')).default;
  const reportRoutes = (await import('../server/routes/reports.js')).default;
  const adm = Number(db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash) VALUES ('ADMX','Admin','admin','admx','x')").run().lastInsertRowid);
  const tok = signToken({ id: adm, code: 'ADMX', role: 'admin', full_name: 'Admin' });
  const app = express(); app.use(express.json()); app.use('/api/reports', reportRoutes);
  const server = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  try {
    const row = async (rule, punches) => {
      chay('HC', rule, punches);
      const e = db.prepare('SELECT MAX(id) id FROM employees').get().id;
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api/reports/data?type=detaillist&from=2026-11-02&to=2026-11-02&ids=${e}`, { headers: { Authorization: 'Bearer ' + tok } });
      assert.equal(r.status, 200);
      const d = (await r.json()).rows.find((x) => x.date === '02/11/2026');
      // ngày chỉ 1 cặp vào–ra → báo cáo chỉ có 1 cột Giờ vào / Giờ ra (cin / cout)
      return [1, 2, 3].map((i) => [d['cin_' + i] || (i === 1 && d.cin) || '', d['cout_' + i] || (i === 1 && d.cout) || '']);
    };
    assert.deepEqual(await row('idm', CASES.H_ra_ngoai_2h[1]), [['08:00', '10:00'], ['12:00', '17:00'], ['', '']]);
    assert.deepEqual(await row('state', CASES.H_ra_ngoai_2h[1]), [['08:00', '10:00'], ['12:00', '17:00'], ['', '']]);
    assert.deepEqual(await row('idm', CASES.E_quen_ra_trua[1]), [['08:00', '?'], ['13:00', '17:00'], ['', '']]);
    assert.deepEqual(await row('idm', CASES.A_chuan_2lan[1]), [['08:00', '17:00'], ['', ''], ['', '']]);
  } finally { server.close(); }
});
