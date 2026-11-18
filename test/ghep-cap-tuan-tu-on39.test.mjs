// LỊCH NHIỀU CA TỰ DÒ + "TỰ ĐỘNG - QUA ĐÊM": ghép cặp theo thứ tự giờ rồi mỗi cặp mới tìm ca, như Wise Eye On39 (Anh duyệt 18/11/2026).
// Ca và lịch trình vào ra chép đúng file On39 của khách (Data_on39_CaDem): Ngày 07:30–16:30 (vào 05:00–09:00, ra 13:00–20:00),
// Đêm 19:30–04:30 (vào 18:00–21:00, ra 02:00–08:00); TĐ-QĐ: nhỏ nhất 30', lớn nhất 960', giữa 2 cặp 10', mốc kết thúc ra hôm sau 09:00.
// Các ví dụ là lượt chấm THẬT trong báo cáo đối chiếu (BaoCao-DoiChieu-On39-Digiplus.html, mục L1 / L2 / L3) — kết quả = bảng công On39.
// Nạp lượt TỪNG LƯỢT theo thứ tự giờ như máy đẩy, rồi Tính lại: hai cách phải ra cùng kết quả.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'dgp-tuantu-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema } = await import('../server/db.js');
const { ingestAttlog } = await import('../server/device-sync.js');
const { recomputeAttendance } = await import('../server/routes/admin/attendance.js');
const { seqPairUnits } = await import('../server/attendance-calc.js');

const ins = (t, o) => { const k = Object.keys(o); return db.prepare(`INSERT INTO ${t}(${k.join(',')}) VALUES(${k.map(() => '?').join(',')})`).run(...k.map((x) => o[x])).lastInsertRowid; };
const hm = (x) => (x ? new Date(Date.parse(x) + 7 * 3600e3).toISOString().slice(8, 16).replace('T', ' ') : '');
const S = {}, IO = {};
let W, n = 0;

before(() => {
  initSchema();
  db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('workunit_rounding_mode','2')").run();   // làm tròn số công gần nhất như On39
  db.prepare('UPDATE shifts SET active=0').run();
  const base = { allow_ot: 1, ot_start_after_min: 30, work_unit_value: 1, break_minutes: 60, late_grace_min: 3, early_grace_min: 5 };
  S.NGAY = ins('shifts', { ...base, name: 'Ngày', code: 'Ngày', start_time: '07:30', end_time: '16:30', break_start: '11:30',
    check_in_start: '05:00', check_in_end: '09:00', check_out_start: '13:00', check_out_end: '20:00' });
  S.DEM = ins('shifts', { ...base, name: 'Đêm', code: 'Đêm', start_time: '19:30', end_time: '04:30', cross_midnight: 1, break_start: '23:30',
    check_in_start: '18:00', check_in_end: '21:00', check_out_start: '02:00', check_out_end: '08:00' });
  db.prepare('UPDATE inout_schedules SET is_default=0').run();
  IO.tdqd = ins('inout_schedules', { code: 'TĐ-QĐ', name: 'Chọn giờ tự động - Đi qua đêm', rule: 'tdqd', min_minutes: 30, max_minutes: 960, gap_minutes: 10, next_out_end: '09:00', is_default: 0 });
  IO.tdqdNoEnd = ins('inout_schedules', { code: 'TĐ-QĐ2', name: 'Tự động qua đêm (không mốc)', rule: 'tdqd', min_minutes: 30, max_minutes: 960, gap_minutes: 10, is_default: 0 });
  W = db.prepare("INSERT INTO work_schedules(code,name,unit,cycle) VALUES('','Theo Ca','auto',1)").run().lastInsertRowid;
  [S.NGAY, S.DEM].forEach((s, i) => db.prepare('INSERT INTO work_schedule_shifts(work_schedule_id,shift_id,sort_order) VALUES(?,?,?)').run(W, s, i));
});
after(() => { try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} });

// punches: 'DD HH:MM[:SS]' tháng 10/2026 → chuỗi các dòng công 'DD[ca] vào→ra công'; nạp từng lượt rồi tính lại phải giống nhau
function chay(punches, io = IO.tdqd) {
  n++; const pin = String(7000 + n);
  const id = db.prepare("INSERT INTO employees(code,full_name,username,password_hash,role,device_pin) VALUES(?,?,?,'x','employee',?)").run('T' + n, 'NV ' + n, 't' + n, pin).lastInsertRowid;
  ins('shift_assignments', { employee_id: id, mode: 'schedule', work_schedule_id: W, from_date: '2026-09-01', shift_type: 'fixed', merge_rule: 'default', inout_schedule_id: io, active: 1 });
  for (const p of [...punches].sort()) {
    const [d, t] = p.split(' ');
    ingestAttlog('SN1', `${pin}\t2026-10-${d} ${t.length === 5 ? t + ':00' : t}\t0\t1`, { ask: () => {} });
  }
  const name = (sid) => (sid === S.NGAY ? 'Ngày' : sid === S.DEM ? 'Đêm' : '-');
  const get = () => db.prepare('SELECT * FROM attendance WHERE employee_id=? ORDER BY work_date, check_in_at').all(id)
    .map((r) => `${r.work_date.slice(8)}[${name(r.shift_id)}] ${hm(r.check_in_at).slice(3)}→${hm(r.check_out_at).slice(3)} ${r.work_unit}c`).join(' | ');
  const a = get();
  recomputeAttendance({ from: '2026-09-28', to: '2026-10-31', ids: [id] });
  assert.equal(get(), a, 'Tính lại phải ra đúng như lúc nạp từng lượt');
  return a;
}

test('L1 · NV 94: ra 21:14 quá "Kết thúc ra" 20:00 vẫn là giờ ra ca Ngày (On39: 1 công)', () => {
  assert.equal(chay(['07 07:00', '07 21:14']), '07[Ngày] 07:00→21:14 1c');
});

test('L1 · NV 94: ca đêm ra 08:25 (quá khung ra 08:00, trước mốc 09:00) — không đảo chuỗi đêm thành ngày', () => {
  // trước đây: 12/10 Đêm 19:03→? 0 công · 13/10 Ngày 08:25→19:05 0,89 công trễ 55' (đảo cả chuỗi)
  assert.equal(chay(['12 19:03', '13 08:25', '13 19:05', '14 08:46']), '12[Đêm] 19:03→08:25 1c | 13[Đêm] 19:05→08:46 1c');
});

test('L1 · NV 94: Ngày ra 20:15 rồi sáng hôm sau vào 07:01 — lượt 07:01 không bị lấy làm giờ ra ca Đêm', () => {
  assert.equal(chay(['09 07:05', '09 20:15', '10 07:01', '10 19:42']), '09[Ngày] 07:05→20:15 1c | 10[Ngày] 07:01→19:42 1c');
});

test('L2 · NV 297: quẹt lặp cách 2 giây sau giờ ra → 1 ca Ngày mỗi ngày, không thêm ca Đêm ảo', () => {
  assert.equal(chay(['28 07:01', '28 19:33:00', '28 19:33:02', '29 07:06', '29 19:35:00', '29 19:35:01']),
    '28[Ngày] 07:01→19:33 1c | 29[Ngày] 07:06→19:35 1c');
});

test('L3 · NV 424 / NV 466: lượt ngoài khung vẫn giữ giờ thật (về sớm / vào sớm tính bằng giờ chấm)', () => {
  assert.equal(chay(['21 07:17', '21 08:51']), '21[Ngày] 07:17→08:51 0.17c');        // On39: 0,17 công, về sớm 399'
  assert.equal(chay(['06 16:33', '07 07:08']), '06[Đêm] 16:33→07:08 1c');           // vào 16:33 trước khung vào 18:00 — ra trong khung ra → Đêm
});

test('Mốc kết thúc ra hôm sau 09:00: lượt 09:30 sáng hôm sau không còn là giờ RA; bỏ trống mốc → theo "Thời gian lớn nhất"', () => {
  const day = [{ punch_at: '2026-10-02T12:00:00Z' }];   // 19:00 ngày 02
  const next = [{ punch_at: '2026-10-03T02:30:00Z' }];  // 09:30 ngày 03
  const opt = { min: 30, max: 960, gap: 10 };
  assert.equal(seqPairUnits(day, next, { ...opt, nextEnd: '09:00' })[0].out, null);
  assert.equal(seqPairUnits(day, next, opt)[0].out.punch_at, '2026-10-03T02:30:00Z');
});

test('Ca đêm ra ngoài qua nửa đêm (19:20 · 23:00 · 01:00 · 07:00): vẫn 1 dòng ca Đêm, trừ giờ ra ngoài', () => {
  const r = chay(['02 19:20', '02 23:00', '03 01:00', '03 07:00']);
  assert.match(r, /^02\[Đêm\] 19:20→07:00 [\d.]+c$/);
  const row = db.prepare("SELECT * FROM attendance WHERE employee_id=(SELECT MAX(id) FROM employees) AND work_date='2026-10-02'").get();
  assert.equal(row.work_minutes < 10 * 60, true, 'giờ ra ngoài 23:00–01:00 không tính');
});

test('seqPairUnits: quẹt lặp sau VÀO bỏ; quẹt lặp sau RA lấy lượt sau; cách RA từ "giữa 2 cặp" trở lên là VÀO mới', () => {
  const P = (...hh) => hh.map((h) => ({ punch_at: new Date(`2026-10-05T${h}:00+07:00`).toISOString() }));
  const opt = { min: 30, max: 960, gap: 10 };
  let u = seqPairUnits(P('08:00', '08:10', '17:00'), [], opt);
  assert.equal(u.length, 1); assert.equal(hm(u[0].out.punch_at), '05 17:00'); assert.equal(u[0].ps.length, 3);
  u = seqPairUnits(P('08:00', '17:00', '17:05'), [], opt);
  assert.equal(u.length, 1); assert.equal(hm(u[0].out.punch_at), '05 17:05');
  u = seqPairUnits(P('08:00', '17:00', '17:20'), [], opt);
  assert.equal(u.length, 2); assert.equal(u[1].out, null);
  // lượt ngày hôm sau chỉ dùng để đóng lượt cuối ngày: gặp lượt thành VÀO mới thì dừng (lượt đó của hôm sau)
  u = seqPairUnits(P('19:00'), [{ punch_at: '2026-10-06T00:00:00Z' }, { punch_at: '2026-10-06T12:00:00Z' }], opt);
  assert.equal(u.length, 1); assert.equal(u[0].ps.length, 2);
  // quá "Thời gian lớn nhất" → VÀO mới (lượt VÀO cũ quên ra)
  u = seqPairUnits(P('06:00'), [{ punch_at: '2026-10-06T01:00:00Z' }], opt);
  assert.equal(u.length, 1); assert.equal(u[0].out, null);
});
