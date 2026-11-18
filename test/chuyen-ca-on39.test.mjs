// CHUYỂN CA + LỊCH TRÌNH TỪ WISE EYE ON39 (L6, Anh duyệt 18/11/2026): Shifts / InOutArr / Schedule + WSchedules / UserInfo.SchID / UserTempSch
// → ca, lịch trình vào ra, lịch trình ca, dòng gán NV của Digiplus. Số liệu chép đúng file Data_on39_CaDem của khách. Chạy: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'dgp-chuyen-ca-'));
process.env.DB_PATH = join(dir, 'test.db');
let db, L;
const fake = (tables) => (name, cols) => (tables[name] || []).map((r) => (cols ? Object.fromEntries(cols.filter((c) => c in r).map((c) => [c, r[c]])) : r));
const T = (s) => new Date(s + 'Z');
const base = { DayCount: 0, Workingday: 1, IsAfterOT: true, MinAfterOT: 30, IsBeforeOT: false, MinBeforeOT: 30 };
const SHIFTS = [
  { ...base, ShiftID: 1, ShiftCode: 'HC-CN', Onduty: '07:30', Offduty: '16:30', OnTimeIn: 150, OnTimeOut: 90, CutIn: 150, CutOut: 390, OnLunch: '11:30', OffLunch: '12:30', LateGrace: 5, EarlyGrace: 5 },
  { ...base, ShiftID: 2, ShiftCode: 'Ngày', Onduty: '07:30', Offduty: '16:30', OnTimeIn: 150, OnTimeOut: 210, CutIn: 90, CutOut: 210, OnLunch: '11:30', OffLunch: '12:30', LateGrace: 3, EarlyGrace: 5 },
  { ...base, ShiftID: 5, ShiftCode: 'Đêm', Onduty: '19:30', Offduty: '04:30', DayCount: 1, OnTimeIn: 90, OnTimeOut: 150, CutIn: 90, CutOut: 210, OnLunch: '23:30', OffLunch: '00:30', LateGrace: 3, EarlyGrace: 5 },
];
const io = (o) => ({ AutoMax: 960, AutoMin: 30, AutoInterval: 10, DayCount: 0, EndTime: '23:59', ...o });
const INOUT = [
  io({ InOutID: 1, InOutCode: 'TĐ-HC', InOutName: 'Chọn giờ tự động - Trong ngày', InOutMode: 0 }),
  io({ InOutID: 2, InOutCode: 'IDM', InOutName: 'Theo số máy', InOutMode: 2 }),
  io({ InOutID: 3, InOutCode: 'PGio', InOutName: 'Theo khoảng giờ', InOutMode: 1 }),
  io({ InOutID: 4, InOutCode: 'FILO', InOutName: 'Giờ đầu giờ cuối trong ngày', InOutMode: 3 }),
  io({ InOutID: 5, InOutCode: 'CICO', InOutName: 'Theo phím vào ra', InOutMode: 4 }),
  io({ InOutID: 8, InOutCode: 'TĐ-QĐ', InOutName: 'Chọn giờ tự động - Đi qua đêm', InOutMode: 0, DayCount: 1, EndTime: '09:00' }),
];
let wid = 30;
const week = (sch, shiftId, days = [1, 2, 3, 4, 5, 6, 7, 8]) => days.map((d) => ({ ID: wid++, DayID: d, SchID: sch, ShiftID: shiftId, MonthID: 0 }));
const ON39 = {
  RelationDept: [{ ID: 1, Description: 'Công ty', RelationID: 0, DeptCode: 'root' }, { ID: 2, Description: 'Sản xuất', RelationID: 1, DeptCode: 'SX' }],
  UserInfo: [
    { UserEnrollNumber: 94, UserFullCode: '094', UserFullName: 'Nguyễn Văn Ca', UserIDD: 2, SchID: 2 },
    { UserEnrollNumber: 44, UserFullCode: '044', UserFullName: 'Trần Thị Tạm', UserIDD: 2, SchID: 1 },
    { UserEnrollNumber: 7, UserFullCode: '007', UserFullName: 'Lê Không Lịch', UserIDD: 2, SchID: 0 },
  ],
  Shifts: SHIFTS, InOutArr: INOUT,
  Schedule: [
    { SchID: 1, SchName: 'HC-CN', InOutID: 1, CycleMode: 0 },
    { SchID: 2, SchName: 'Theo Ca', InOutID: 8, CycleMode: 0 },
    { SchID: 3, SchName: 'Thứ 7 nghỉ', InOutID: 4, CycleMode: 0 },
  ],
  WSchedules: [...week(1, 1), ...week(2, 2), ...week(2, 5), ...week(3, 2, [2, 3, 4, 5, 6])],
  UserTempSch: [{ UserEnrollNumber: 44, StartDate: T('2026-10-05T00:00:00'), EndDate: T('2026-10-11T00:00:00'), SchID: 2 }],
  Machines: [{ MachineID: 1, MachineName: 'Máy 1', SerialNumber: 'SN-ON39' }],
  CheckInOut: [
    ['94', '2026-10-12T19:03:00'], ['94', '2026-10-13T08:25:00'],      // ca Đêm ra 08:25 (trước mốc 09:00)
    ['44', '2026-10-01T07:28:00'], ['44', '2026-10-01T16:35:00'],      // lịch chính HC-CN
    ['44', '2026-10-06T19:10:00'], ['44', '2026-10-07T07:20:00'],      // trong lịch tạm Theo Ca → ca Đêm
  ].map(([pin, t]) => ({ UserEnrollNumber: +pin, TimeStr: T(t), OriginType: 'I', MachineNo: 1 })),
};

before(async () => {
  const D = await import('../server/db.js');
  db = D.db; D.initSchema();
  L = await import('../server/legacy-import.js');
});
after(() => { try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} });

const rowsOf = (pin) => db.prepare(`SELECT a.work_date d, s.code ca, a.work_unit c FROM attendance a JOIN employees e ON e.id=a.employee_id
  LEFT JOIN shifts s ON s.id=a.shift_id WHERE e.device_pin=? ORDER BY a.work_date`).all(pin).map((r) => `${r.d.slice(8)} ${r.ca} ${r.c}`);
const counts = () => ['shifts', 'inout_schedules', 'work_schedules', 'work_schedule_days', 'shift_assignments']
  .map((t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c).join(',');

test('Đọc ca On39: khung vào/ra = giờ ca ± OnTimeIn/CutIn/OnTimeOut/CutOut; nghỉ trưa; ca đêm qua ngày', () => {
  const d = L.normalizeOn39Shifts(fake(ON39));
  const dem = d.shifts.find((s) => s.code === 'Đêm');
  assert.deepEqual([dem.check_in_start, dem.check_in_end, dem.check_out_start, dem.check_out_end], ['18:00', '21:00', '02:00', '08:00']);
  assert.equal(dem.cross_midnight, 1); assert.equal(dem.break_minutes, 60); assert.equal(dem.break_start, '23:30');
  const ngay = d.shifts.find((s) => s.code === 'Ngày');
  assert.deepEqual([ngay.check_in_start, ngay.check_in_end, ngay.check_out_start, ngay.check_out_end], ['05:00', '09:00', '13:00', '20:00']);
  assert.equal(ngay.late_grace_min, 3); assert.equal(ngay.allow_ot, 1); assert.equal(ngay.ot_start_after_min, 30);
  // giờ lưu kiểu ngày giờ của Access (30/12/1899) vẫn đọc đúng
  const d2 = L.normalizeOn39Shifts(fake({ ...ON39, Shifts: [{ ...SHIFTS[0], Onduty: T('1899-12-30T07:30:00'), Offduty: T('1899-12-30T16:30:00') }] }));
  assert.equal(d2.shifts[0].start_time, '07:30'); assert.equal(d2.shifts[0].end_time, '16:30');
});

test('Đọc lịch trình vào ra On39: 0 Tự động (qua đêm → tdqd + Mốc kết thúc ra hôm sau) · 1 khoảng giờ · 2 số máy · 3 đầu–cuối · 4 phím', () => {
  const d = L.normalizeOn39Shifts(fake(ON39));
  assert.deepEqual(d.inouts.map((a) => `${a.code}:${a.rule}:${a.next_out_end}`),
    ['TĐ-HC:pairs:', 'IDM:idm:', 'PGio:tdhc:', 'FILO:filo:', 'CICO:state:', 'TĐ-QĐ:tdqd:09:00']);
  const qd = d.inouts.find((a) => a.code === 'TĐ-QĐ');
  assert.deepEqual([qd.min_minutes, qd.max_minutes, qd.gap_minutes], [30, 960, 10]);
});

test('Đọc lịch trình ca On39: DayID 1 = CN → ô 6, 2 = T2 → ô 0; DayID 8 (ngày lễ) bỏ; ngày không có ca = nghỉ; gán NV theo SchID + lịch tạm', () => {
  const d = L.normalizeOn39Shifts(fake(ON39));
  const tc = d.schedules.find((s) => s.name === 'Theo Ca');
  assert.equal(tc.unit, 'week'); assert.equal(tc.io, 'IO8'); assert.deepEqual(tc.shifts, ['S2', 'S5']);
  assert.equal(tc.cells.length, 14);   // 7 ngày × 2 ca, không có ô ngày lễ
  const t7 = d.schedules.find((s) => s.name === 'Thứ 7 nghỉ');
  assert.deepEqual(t7.cells.map((c) => c[0]), [0, 1, 2, 3, 4]);   // T2–T6; T7 + CN trống = nghỉ
  assert.deepEqual(d.assign, [{ pin: '94', sch: 'W2' }, { pin: '44', sch: 'W1' }]);   // SchID 0 = chưa có lịch → bỏ
  assert.deepEqual(d.temp_sch, [{ pin: '44', sch: 'W2', from: '2026-10-05', to: '2026-10-11' }]);
});

test('Ghi vào Digiplus: tạo ca + lịch trình + gán NV TRƯỚC lượt chấm → công tính ngay theo đúng ca; lịch tạm đè lịch chính trong khoảng ngày', async () => {
  const r = await L.applyLegacy(L.normalizeOn39(fake(ON39)), {});
  assert.equal(r.shifts_created, 3); assert.equal(r.inouts_created, 6); assert.equal(r.schedules_created, 3);
  assert.equal(r.assign_created, 2); assert.equal(r.temp_created, 1);
  const ws = db.prepare("SELECT * FROM work_schedules WHERE name='Theo Ca'").get();
  assert.equal(ws.unit, 'week'); assert.match(ws.description, /Chép từ Wise Eye On39/);
  const a94 = db.prepare("SELECT sa.*, io.code io FROM shift_assignments sa JOIN employees e ON e.id=sa.employee_id JOIN inout_schedules io ON io.id=sa.inout_schedule_id WHERE e.device_pin='94'").get();
  assert.equal(a94.work_schedule_id, ws.id); assert.equal(a94.io, 'TĐ-QĐ'); assert.equal(a94.from_date, '2026-10-01'); assert.equal(a94.to_date, null);
  assert.deepEqual(rowsOf('94'), ['12 Đêm 1']);                       // ra 08:25 vẫn là ca Đêm (L1 + mốc 09:00)
  assert.deepEqual(rowsOf('44'), ['01 HC-CN 1', '06 Đêm 1']);         // 06/10 nằm trong lịch tạm Theo Ca
  assert.equal(db.prepare("SELECT COUNT(*) c FROM shift_assignments sa JOIN employees e ON e.id=sa.employee_id WHERE e.device_pin='7'").get().c, 0);
});

test('Chuyển lại lần 2: không tạo trùng ca / lịch trình / dòng gán', async () => {
  const before = counts();
  const r = await L.applyLegacy(L.normalizeOn39(fake(ON39)), {});
  assert.equal(r.shifts_created + r.inouts_created + r.schedules_created + r.assign_created + r.temp_created, 0);
  assert.equal(counts(), before);
  assert.deepEqual(rowsOf('44'), ['01 HC-CN 1', '06 Đêm 1']);
});

test('Ca trùng mã khác giờ → ca mới "(On39)"; NV đã tự gán ca ở Digiplus giữ nguyên, chọn Ghi đè mới gán theo On39', async () => {
  db.prepare("UPDATE shifts SET active=0").run();
  db.prepare("UPDATE work_schedules SET active=0").run();
  db.prepare("UPDATE inout_schedules SET active=0").run();
  db.prepare('DELETE FROM shift_assignments').run();
  const hc = db.prepare("INSERT INTO shifts(code, name, start_time, end_time) VALUES ('Ngày','Ngày','08:00','17:00')").run().lastInsertRowid;
  const e94 = db.prepare("SELECT id FROM employees WHERE device_pin='94'").get().id;
  db.prepare("INSERT INTO shift_assignments(employee_id, mode, shift_id, from_date) VALUES (?, 'shift', ?, '2026-01-01')").run(e94, hc);
  const r = await L.applyLegacy(L.normalizeOn39(fake(ON39)), { depts: false, emps: false, punches: false });
  assert.ok(db.prepare("SELECT 1 FROM shifts WHERE code='Ngày (On39)' AND start_time='07:30' AND active=1").get(), 'ca On39 tên mới');
  assert.equal(db.prepare("SELECT start_time FROM shifts WHERE id=?").get(hc).start_time, '08:00');   // ca của khách không đổi
  assert.equal(r.assign_skipped, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM shift_assignments WHERE employee_id=?').get(e94).c, 1);
  const r2 = await L.applyLegacy(L.normalizeOn39(fake(ON39)), { depts: false, emps: false, punches: false, overwrite: true });
  assert.equal(r2.assign_created, 1); assert.equal(r2.assign_skipped, 0);
});

test('Lượt chấm đã có từ trước (chuyển lần 1 chưa chép ca) → chép ca xong tự tính lại công theo ca mới', async () => {
  db.prepare('DELETE FROM shift_assignments').run();
  db.prepare("UPDATE shifts SET active=0").run();
  db.prepare("UPDATE work_schedules SET active=0").run();
  db.prepare('DELETE FROM attendance').run();   // dòng công chỉ có lại nếu bước tính lại chạy (lượt chấm trùng → ingest không dựng ngày)
  const r = await L.applyLegacy(L.normalizeOn39(fake(ON39)), { shifts: true, punches: true });
  assert.equal(r.punches_new, 0);
  assert.equal(r.recomputed_emps, 2, 'tính lại công 2 NV đã có lượt chấm');
  assert.deepEqual(rowsOf('94'), ['12 Đêm 1']);
  assert.deepEqual(rowsOf('44'), ['01 HC-CN 1', '06 Đêm 1']);
  const sid = db.prepare("SELECT a.shift_id FROM attendance a JOIN employees e ON e.id=a.employee_id WHERE e.device_pin='94'").get().shift_id;
  assert.equal(db.prepare('SELECT active FROM shifts WHERE id=?').get(sid).active, 1, 'công tính theo ca vừa chép (đang dùng)');
});

test('NV chấm 2 máy (vào máy A, ra máy B): lượt nạp theo từng máy → dựng lại theo thứ tự ngày, kết quả = Tính lại', async () => {
  const { recomputeAttendance } = await import('../server/routes/admin/attendance.js');
  const P = [['14 19:05', 1], ['15 07:10', 2], ['15 19:02', 1], ['16 07:05', 2], ['16 19:00', 1], ['17 07:00', 2], ['17 07:30', 1], ['17 19:20', 2]];
  const data = L.normalizeOn39(fake({ ...ON39,
    UserInfo: [{ UserEnrollNumber: 95, UserFullCode: '095', UserFullName: 'Phạm Hai Máy', UserIDD: 2, SchID: 2 }], UserTempSch: [],
    Machines: [{ MachineID: 1, SerialNumber: 'SN-A' }, { MachineID: 2, SerialNumber: 'SN-B' }],
    CheckInOut: P.map(([t, m]) => ({ UserEnrollNumber: 95, TimeStr: T(`2026-10-${t.replace(' ', 'T')}:00`), OriginType: 'I', MachineNo: m })) }));
  const r = await L.applyLegacy(data, {});
  assert.equal(r.recomputed_emps, 1);
  const a = rowsOf('95');
  assert.deepEqual(a.slice(0, 3), ['14 Đêm 1', '15 Đêm 1', '16 Đêm 1']);
  const id = db.prepare("SELECT id FROM employees WHERE device_pin='95'").get().id;
  recomputeAttendance({ from: '2026-10-01', to: '2026-10-31', ids: [id] });
  assert.deepEqual(rowsOf('95'), a, 'chuyển xong phải giống hệt Tính lại');
});
