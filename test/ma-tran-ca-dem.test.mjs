// MA TRẬN CA ĐÊM — khoá các trường hợp ca đêm ĐANG TÍNH ĐÚNG, để đợt sửa bộ chọn ca / ghép cặp không làm hỏng.
// 12 tình huống (Z1…Z12) × kiểu gán ca × quy tắc vào ra, nạp lượt chấm qua ingestAttlog từng lượt một THEO ĐÚNG THỨ TỰ GIỜ
// như máy chấm công đẩy thật ("v" = máy số 1 = VÀO, phím 0; "r" = máy số 2 = RA, phím 1), rồi tính lại (recomputeAttendance)
// và khẳng định kết quả KHÔNG đổi. Mẫu: test/ma-tran-ghep-cap.test.mjs. Kết quả mong đợi = bản thử ngày 12/11/2026 trên CSDL tạm,
// cộng các ô sửa theo đợt "chọn ca không đoán" Anh duyệt 13/11/2026 (test/chon-ca-khong-doan.test.mjs) và các ô Anh chốt giữ như cũ.
//
// Kiểu gán ca:  DM1  = lịch tuần 1 ca đêm DM 19:00–07:00 (nghỉ 60')
//               XOAY = lịch "tự dò" gồm HC 08:00–17:00 (nghỉ 60') + DM
//               BA   = lịch "tự dò" 3 ca S6 06–14 / C14 14–22 / D22 22–06 (nghỉ 0'); giờ lượt chấm đổi theo ca (to3)
//               TUDO = KHÔNG gán ca, phần mềm tự dò theo khung giờ (chỉ có ở biến thể ca CÓ khai khung giờ vào / ra)
// Biến thể ca:  "không khung giờ" (HC, DM) và "có khung giờ" (HCW, DMW — mã hiện trên dòng công vẫn là HC / DM).
// Chỉ khoá các ô đang đúng (bảng KHOA); ô đang sai hoặc chờ Anh quyết nằm ở bảng CHUA_CHOT và hiện là test.todo.
// SHOW=1 node --test test/ma-tran-ca-dem.test.mjs → in kết quả từng ô đã khoá.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'dgp-cadem-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema } = await import('../server/db.js');
const { ingestAttlog } = await import('../server/device-sync.js');
const { recomputeAttendance } = await import('../server/routes/admin/attendance.js');

const hm = (x) => (x ? new Date(Date.parse(x) + 7 * 3600e3).toISOString().slice(8, 16).replace('T', ' ') : '-');
const ins = (t, o) => { const k = Object.keys(o); return db.prepare(`INSERT INTO ${t}(${k.join(',')}) VALUES(${k.map(() => '?').join(',')})`).run(...k.map((x) => o[x])).lastInsertRowid; };
const RULES = ['filo', 'pairs', 'tdqd', 'idm', 'state', 'tdhc'];   // quy tắc vào ra (lịch trình vào ra min 30 / max 960 / gap 30)
const S = {}, W = {}, IO = {};
let n = 0;

before(() => {
  initSchema();
  db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('punch_dedup_min','5')").run();
  db.prepare('UPDATE shifts SET active=0').run();   // bỏ ca mẫu để tự dò chỉ thấy ca của bài thử
  const base = { late_grace_min: 0, early_grace_min: 0, allow_ot: 1, ot_start_after_min: 30, work_unit_value: 1, break_minutes: 60 };
  const sh = (code, start, end, extra = {}) => (S[code] = ins('shifts', { ...base, name: code, code, start_time: start, end_time: end, ...(end <= start ? { cross_midnight: 1 } : {}), ...extra }));
  sh('HC', '08:00', '17:00'); sh('DM', '19:00', '07:00');
  sh('HCW', '08:00', '17:00', { check_in_start: '05:00', check_in_end: '11:00', check_out_start: '11:30', check_out_end: '23:59' });
  sh('DMW', '19:00', '07:00', { check_in_start: '16:00', check_in_end: '22:00', check_out_start: '04:00', check_out_end: '11:00' });
  sh('S6', '06:00', '14:00', { break_minutes: 0 }); sh('C14', '14:00', '22:00', { break_minutes: 0 }); sh('D22', '22:00', '06:00', { break_minutes: 0 });
  db.prepare("INSERT INTO push_devices(serial,name,active,machine_number) VALUES('SN1','Cổng vào',1,1),('SN2','Cổng ra',1,2)").run();
  db.prepare('UPDATE inout_schedules SET is_default=0').run();
  for (const r of RULES) IO[r] = ins('inout_schedules', { code: 'CD_' + r, name: r, rule: r, min_minutes: 30, max_minutes: 960, gap_minutes: 30, is_default: r === 'filo' ? 1 : 0 });
  const schedWeek = (name, codes) => { const w = db.prepare("INSERT INTO work_schedules(code,name,unit,cycle) VALUES('',?,'week',1)").run(name).lastInsertRowid;
    codes.forEach((c, i) => db.prepare('INSERT INTO work_schedule_shifts(work_schedule_id,shift_id,sort_order) VALUES(?,?,?)').run(w, S[c], i));
    for (let d = 0; d < 7; d++) for (const c of codes) db.prepare('INSERT INTO work_schedule_days(work_schedule_id,idx,shift_id) VALUES(?,?,?)').run(w, d, S[c]); return w; };
  const schedAuto = (name, codes) => { const w = db.prepare("INSERT INTO work_schedules(code,name,unit,cycle) VALUES('',?,'auto',1)").run(name).lastInsertRowid;
    codes.forEach((c, i) => db.prepare('INSERT INTO work_schedule_shifts(work_schedule_id,shift_id,sort_order) VALUES(?,?,?)').run(w, S[c], i)); return w; };
  W.DM1 = schedWeek('1 ca đêm', ['DM']); W.DM1_W = schedWeek('1 ca đêm (khung giờ)', ['DMW']);
  W.XOAY = schedAuto('Xoay HC/DM', ['HC', 'DM']); W.XOAY_W = schedAuto('Xoay HC/DM (khung giờ)', ['HCW', 'DMW']);
  W.BA = schedAuto('3 ca', ['S6', 'C14', 'D22']);
});
after(() => { try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} });

const KINDS = ['DM1', 'XOAY', 'BA', 'TUDO'];
// Các ô mà kịch bản gốc chạy: tdhc chỉ chạy ở lịch BA hoặc ở biến thể có khung giờ; TUDO chỉ ở biến thể có khung giờ và chỉ quy tắc filo
const rulesOf = (kind, win) => (kind === 'TUDO' ? (win ? ['filo'] : []) : win || kind === 'BA' ? RULES : RULES.filter((r) => r !== 'tdhc'));

// ===== 12 TÌNH HUỐNG (ngày 02/11/2026 = thứ Hai). Lượt theo ca đêm 19–07; lịch BA đổi giờ bằng to3 =====
const CASES = {
  Z1: ['3 đêm đủ', ['02 19:00 v', '03 07:00 r', '03 19:00 v', '04 07:00 r', '04 19:00 v', '05 07:00 r']],
  Z2: ['quên RA đêm giữa', ['02 19:00 v', '03 07:00 r', '03 19:00 v', '04 19:00 v', '05 07:00 r']],
  Z3: ['quên VÀO đêm giữa', ['02 19:00 v', '03 07:00 r', '04 07:00 r', '04 19:00 v', '05 07:00 r']],
  Z4: ['quên VÀO đêm đầu', ['03 07:00 r', '03 19:00 v', '04 07:00 r']],
  Z5: ['vào trễ 00:30 sau nửa đêm', ['03 00:30 v', '03 07:00 r', '03 19:00 v', '04 07:00 r']],
  Z6: ['ca ngày quên ra rồi ca đêm', ['02 08:00 v', '03 19:00 v', '04 07:00 r']],
  Z7: ['ca đêm quên ra rồi ca ngày', ['02 19:00 v', '04 08:00 v', '04 17:00 r']],
  Z8: ['đêm tăng ca sáng tới 09:30', ['02 19:00 v', '03 09:30 r', '03 19:00 v', '04 07:00 r']],
  Z9: ['đêm về sớm trước 0h', ['02 19:00 v', '02 23:00 r', '03 19:00 v', '04 07:00 r']],
  Z10: ['đêm quẹt lặp', ['02 18:58 v', '02 19:00 v', '03 07:00 r', '03 07:02 r']],
  Z11: ['chỉ 1 lượt RA buổi sáng', ['03 07:00 r']],
  Z12: ['chỉ 1 lượt VÀO buổi tối', ['02 19:00 v']],
};
const to3 = (p) => p.replace(' 19:00', ' 22:00').replace(' 18:58', ' 21:58').replace(' 07:00', ' 06:00').replace(' 07:02', ' 06:02').replace(' 08:00 v', ' 06:00 v').replace(' 17:00', ' 14:00').replace(' 09:30', ' 08:30');

// ===== Ô ĐÃ KHOÁ: mỗi dòng là tập ô (ca = tình huống; kind / rule / win bỏ trống = mọi giá trị; win: false = ca không khung giờ, true = có khung giờ) =====
const HUONG = ['idm', 'state'], KHONG_HUONG = ['filo', 'pairs', 'tdqd', 'tdhc'];   // quy tắc biết / không biết hướng lượt chấm
const KHOA = [
  { ca: ['Z1', 'Z2', 'Z8', 'Z10', 'Z12'] },                                                                  // mọi kiểu gán, mọi quy tắc, cả 2 biến thể
  { ca: ['Z9'], kind: ['DM1', 'XOAY', 'BA'], rule: ['filo', 'pairs', 'tdqd', 'idm', 'state'], win: [false] },  // về sớm trước nửa đêm: chỉ biến thể KHÔNG khung giờ (BA + tdhc xem CHUA_CHOT)
  { ca: ['Z6', 'Z7'], kind: ['XOAY', 'BA', 'TUDO'] },                                                        // ngày ↔ đêm quên ra
  { ca: ['Z6', 'Z7'], kind: ['DM1'], rule: HUONG },                                                          // hết dòng rác "08:00→ trễ 780" (v1.33.10)
  { ca: ['Z3', 'Z4'], kind: ['DM1'], rule: KHONG_HUONG },                                                    // quên VÀO ca đêm: không có dòng công, đêm kế vẫn đủ
  { ca: ['Z3'], kind: ['DM1'], rule: HUONG },                                                                // quên VÀO đêm giữa: dòng chỉ-giờ-ra như Z4 (mục 8, 13/11/2026)
  { ca: ['Z3', 'Z4', 'Z11'], kind: ['XOAY', 'BA'], rule: HUONG },                                            // lịch nhiều ca biết hướng: RA lẻ sáng = chỉ-giờ-ra ca đêm hôm trước (13/11/2026)
  { ca: ['Z3', 'Z4', 'Z11'], kind: ['XOAY', 'BA', 'TUDO'], rule: KHONG_HUONG },                              // Anh chốt 13/11/2026: không biết hướng + quên vào → GIỮ cách chọn ca như cũ
  { ca: ['Z5'], kind: ['DM1'], rule: ['filo', 'pairs', 'tdqd', 'idm', 'state'] },                            // vào trễ sau nửa đêm
  { ca: ['Z11'], kind: ['DM1'] },                                                                            // chỉ 1 lượt RA sáng
];

// ===== Ô CHƯA CHỐT (đang sai hoặc chờ Anh quyết) — KHÔNG assert, hiện là test.todo. Mỗi dòng → 1 todo cho từng (ca × kind) =====
const CHUA_CHOT = [
  { ca: ['Z5'], kind: ['XOAY', 'TUDO'],
    note: 'vào trễ 00:30 sau nửa đêm: đêm 02 không ra dòng; filo… dựng NHẦM ca HC 00:30→19:00, sai dây chuyền sang hôm sau (04[HC] 07:00→ 0c)' },
  { ca: ['Z5'], kind: ['BA'], note: 'vào trễ 00:30 sau nửa đêm: đêm 02 không được tính; lượt RA 06:00 thành ca S6 (06:00→ / →06:00)' },
  { ca: ['Z5'], kind: ['DM1'], rule: ['tdhc'], win: [true], note: 'tdhc bỏ mất dòng đêm 02 (00:30→07:00 trễ 330 0,5 công) mà các quy tắc khác có' },
  { ca: ['Z9'], kind: ['DM1', 'XOAY', 'BA', 'TUDO'], win: [true],
    note: 'biến thể có khung giờ: lượt RA 23:00 nằm ngoài khung ra (04:00–11:00) → XOAY mọi quy tắc và tdhc ra 02[…] 19:00→ 0c (không sớm 480); filo… của DM1 / BA / TUDO vẫn 0,36 / 0,12 công — chờ Anh quyết' },
  { ca: ['Z9'], kind: ['BA'], rule: ['tdhc'], win: [false],
    note: 'ngoài danh sách đề bài: BA + tdhc (ca không khung giờ) bỏ lượt RA 23:00 (22:00→ 0c) trong khi quy tắc khác ra 0,12 công sớm 420 — để todo thay vì khoá' },
];

const cua = (sel, c) => (!sel.ca || sel.ca.includes(c.ca)) && (!sel.kind || sel.kind.includes(c.kind)) && (!sel.rule || sel.rule.includes(c.rule)) && (!sel.win || sel.win.includes(c.win));
// Toàn bộ ô mà kịch bản gốc chạy
const LUOI = [];
for (const ca of Object.keys(CASES)) for (const win of [false, true]) for (const kind of KINDS) for (const rule of rulesOf(kind, win)) LUOI.push({ ca, win, kind, rule });
const DA_KHOA = LUOI.filter((c) => KHOA.some((s) => cua(s, c)));
const DO_TODO = LUOI.filter((c) => CHUA_CHOT.some((s) => cua(s, c)));

// ===== KẾT QUẢ MONG ĐỢI (khớp từng ký tự với bản thử ngày 12/11/2026): ca → kiểu gán → chuỗi | { quy tắc: chuỗi } =====
const dem = (s) => ({ DM1: s, XOAY: s, TUDO: s });   // TUDO / XOAY / DM1 ra cùng kết quả ở ô đã khoá
const NOLINE = '(không có dòng công)';
const huong = (khong, co) => ({ filo: khong, pairs: khong, tdqd: khong, tdhc: khong, idm: co, state: co });   // quy tắc không biết / biết hướng
const EXPECT = {
  Z1: { ...dem('02[DM] 19:00→07:00 1c | 03[DM] 19:00→07:00 1c | 04[DM] 19:00→07:00 1c'), BA: '02[D22] 22:00→06:00 1c | 03[D22] 22:00→06:00 1c | 04[D22] 22:00→06:00 1c' },
  Z2: { ...dem('02[DM] 19:00→07:00 1c | 03[DM] 19:00→ 0c | 04[DM] 19:00→07:00 1c'), BA: '02[D22] 22:00→06:00 1c | 03[D22] 22:00→ 0c | 04[D22] 22:00→06:00 1c' },
  // Z3 / Z4 / Z11 không biết hướng: GIỮ như mốc 12/11 (Anh chốt 13/11 — dòng HC 07:00→19:00 / S6 06:00→ là cách chọn ca hiện tại, chờ "tự tính lại sau khi bù tay")
  Z3: { DM1: huong('02[DM] 19:00→07:00 1c | 04[DM] 19:00→07:00 1c', '02[DM] 19:00→07:00 1c | 03[DM] →07:00 0c | 04[DM] 19:00→07:00 1c'),
    XOAY: huong('02[DM] 19:00→07:00 1c | 04[HC] 07:00→19:00 1c tc120 | 05[HC] 07:00→ 0c', '02[DM] 19:00→07:00 1c | 03[DM] →07:00 0c | 04[DM] 19:00→07:00 1c'),
    TUDO: '02[DM] 19:00→07:00 1c | 04[HC] 07:00→19:00 1c tc120 | 05[HC] 07:00→ 0c',
    BA: huong('02[D22] 22:00→06:00 1c | 04[S6] 06:00→ 0c | 04[D22] 22:00→06:00 1c', '02[D22] 22:00→06:00 1c | 03[D22] →06:00 0c | 04[D22] 22:00→06:00 1c') },
  Z4: { DM1: '03[DM] 19:00→07:00 1c',
    XOAY: huong('03[HC] 07:00→19:00 1c tc120 | 04[HC] 07:00→ 0c', '02[DM] →07:00 0c | 03[DM] 19:00→07:00 1c'),
    TUDO: '03[HC] 07:00→19:00 1c tc120 | 04[HC] 07:00→ 0c',
    BA: huong('03[S6] 06:00→ 0c | 03[D22] 22:00→06:00 1c', '02[D22] →06:00 0c | 03[D22] 22:00→06:00 1c') },
  Z5: { DM1: '02[DM] 00:30→07:00 0.5c trễ330 | 03[DM] 19:00→07:00 1c' },
  Z6: { XOAY: '02[HC] 08:00→ 0c | 03[DM] 19:00→07:00 1c', TUDO: '02[HC] 08:00→ 0c | 03[DM] 19:00→07:00 1c', BA: '02[S6] 06:00→ 0c | 03[D22] 22:00→06:00 1c',
    DM1: '03[DM] 19:00→07:00 1c' },
  Z7: { XOAY: '02[DM] 19:00→ 0c | 04[HC] 08:00→17:00 1c', TUDO: '02[DM] 19:00→ 0c | 04[HC] 08:00→17:00 1c', BA: '02[D22] 22:00→ 0c | 04[S6] 06:00→14:00 1c',
    DM1: '02[DM] 19:00→ 0c | 04[DM] →17:00 0c' },
  Z8: { ...dem('02[DM] 19:00→09:30 1c tc150 | 03[DM] 19:00→07:00 1c'), BA: '02[D22] 22:00→08:30 1c tc150 | 03[D22] 22:00→06:00 1c' },
  Z9: { DM1: '02[DM] 19:00→23:00 0.36c sớm480 | 03[DM] 19:00→07:00 1c', XOAY: '02[DM] 19:00→23:00 0.36c sớm480 | 03[DM] 19:00→07:00 1c', BA: '02[D22] 22:00→23:00 0.12c sớm420 | 03[D22] 22:00→06:00 1c' },
  Z10: { ...dem('02[DM] 18:58→07:02 1c'), BA: '02[D22] 21:58→06:02 1c' },
  Z11: { DM1: huong(NOLINE, '02[DM] →07:00 0c'), XOAY: huong('03[HC] 07:00→ 0c', '02[DM] →07:00 0c'), TUDO: '03[HC] 07:00→ 0c',
    BA: huong('03[S6] 06:00→ 0c', '02[D22] →06:00 0c') },
  Z12: { ...dem('02[DM] 19:00→ 0c'), BA: '02[D22] 22:00→ 0c' },
};
const ky_vong = (c) => { const e = EXPECT[c.ca]?.[c.kind]; const v = typeof e === 'string' ? e : e?.[c.rule]; if (v === undefined) throw new Error(`thiếu kết quả mong đợi: ${c.ca} ${c.kind} ${c.rule}`); return v; };

// Chạy 1 ô: tạo NV + gán ca + nạp lượt TỪNG LƯỢT theo thứ tự giờ → kết quả; rồi tính lại → kết quả sau tính lại
function chay({ ca, win, kind, rule }) {
  n++; const pin = String(9000 + n);
  const id = db.prepare("INSERT INTO employees(code,full_name,username,password_hash,role,device_pin) VALUES(?,?,?,'x','employee',?)").run('P' + n, 'NV ' + n, 'p' + n, pin).lastInsertRowid;
  if (kind !== 'TUDO') ins('shift_assignments', { employee_id: id, mode: 'schedule', work_schedule_id: W[kind === 'BA' ? 'BA' : kind + (win ? '_W' : '')], from_date: '2026-10-26', shift_type: 'fixed', merge_rule: 'default', inout_schedule_id: IO[rule], active: 1 });
  const list = kind === 'BA' ? CASES[ca][1].map(to3) : CASES[ca][1];
  for (const p of [...list].sort()) { const [d, t, k] = p.split(' '); ingestAttlog(k === 'v' ? 'SN1' : 'SN2', `${pin}\t2026-11-${d} ${t}:00\t${k === 'v' ? 0 : 1}\t1`, { ask: () => {} }); }
  const label = (sid) => ({ HC: 'HC', HCW: 'HC', DM: 'DM', DMW: 'DM' }[Object.keys(S).find((k) => S[k] === sid)] || Object.keys(S).find((k) => S[k] === sid) || '-');
  const get = () => db.prepare('SELECT * FROM attendance WHERE employee_id=? ORDER BY work_date, check_in_at').all(id)
    .map((r) => `${r.work_date.slice(8)}[${label(r.shift_id)}] ${hm(r.check_in_at).slice(3)}→${hm(r.check_out_at).slice(3)} ${r.work_unit}c${r.late_min ? ' trễ' + r.late_min : ''}${r.early_min ? ' sớm' + r.early_min : ''}${r.ot_min ? ' tc' + r.ot_min : ''}`).join(' | ') || NOLINE;
  const a = get();
  recomputeAttendance({ from: '2026-11-01', to: '2026-11-10', ids: [id] });
  return { a, b: get() };
}
const ten = (c) => `${c.ca} · ${c.kind} · ${c.rule} · ${c.win ? 'có khung giờ' : 'không khung giờ'}`;

// Số ô đã khoá / chưa chốt (chốt cứng để không ai âm thầm thu hẹp phạm vi khoá)
test('phạm vi: không ô nào vừa khoá vừa chưa chốt; số ô khoá / chưa chốt đúng như đã chốt', () => {
  assert.deepEqual(DA_KHOA.filter((c) => DO_TODO.includes(c)), []);
  assert.equal(DA_KHOA.length, 357);
  assert.equal(DO_TODO.length, 45);
  for (const c of DA_KHOA) ky_vong(c);   // ô nào đã khoá đều có kết quả mong đợi
});

for (const [ca, [mota]] of Object.entries(CASES)) {
  test(`${ca} ${mota}: nạp từng lượt theo thứ tự giờ → đúng bảng; tính lại không đổi`, () => {
    const cells = DA_KHOA.filter((c) => c.ca === ca);
    assert.ok(cells.length > 0);
    for (const c of cells) {
      const { a, b } = chay(c), want = ky_vong(c);
      if (process.env.SHOW) console.log(`  ${ten(c).padEnd(40)} ${a}`);
      assert.equal(a, want, `${ten(c)} — nạp lượt`);
      assert.equal(b, want, `${ten(c)} — SAU TÍNH LẠI không được đổi`);
    }
  });
}

// ===== CHƯA CHỐT: chỉ hiện trong báo cáo test (todo), không khẳng định =====
for (const s of CHUA_CHOT) for (const ca of s.ca) for (const kind of s.kind) {
  const vt = s.win ? (s.win[0] ? 'có khung giờ' : 'không khung giờ') : 'mọi biến thể';
  test.todo(`CHƯA CHỐT ${ca} ${CASES[ca][0]} · ${kind}${s.rule ? ' · ' + s.rule.join('/') : ''} · ${vt}: ${s.note}`);
}
