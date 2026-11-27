// BẾP QUÉT MẶT 8 MÁY — phần 2 (khách trả lời 27/11/2026):
//   A. Máy KHÔNG DÙNG TÍNH CÔNG (push_devices.no_att): lượt quẹt máy nhà ăn vẫn lưu nhưng không vào bảng công (view att_punches)
//   B. Bữa TĂNG CA (meal_shifts.ot_need_min): đủ / không đủ / chờ xác minh theo tăng ca thực tế của ngày công
//   C. NV nghỉ việc / bị khoá → máy bếp báo thất bại (meal_guard_off, TZ rỗng như khoá 1 lần / bữa)
//   D. Báo cáo CHI TIẾT LƯỢT ĂN (server/meal-scans.js) + Excel. Chạy: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { PassThrough } from 'node:stream';

const DBP = join(tmpdir(), `dgp-bep-bao-cao-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, D, S, G, R, M, X;
const VN = (s) => new Date(Date.parse(s.replace(' ', 'T') + '+07:00'));   // '2026-11-24 12:00' giờ VN → Date
const iso = (s) => VN(s).toISOString();
const line = (pin, time) => `${pin}\t${time}\t0\t15\t0`;
const empId = (code) => db.prepare('SELECT id FROM employees WHERE code=?').get(code).id;
const gcmds = (sn, pin) => db.prepare("SELECT content FROM push_device_commands WHERE serial=? AND pin=? AND mkind='mguard' ORDER BY id").all(sn, pin).map((r) => r.content);
const tzOf = (c) => /\tTZ=(\d+)/.exec(c)?.[1];

before(async () => {
  D = await import('../server/db.js');
  db = D.db; D.initSchema();
  S = await import('../server/device-sync.js');
  G = await import('../server/meal-guard.js');
  R = await import('../server/meal-rules.js');
  M = await import('../server/meal-scans.js');
  X = await import('../server/meal-scans-xlsx.js');
  D.setSetting('device_enabled', '1');
  D.setSetting('meal_enabled', '1');
  D.setSetting('punch_dedup_min', '15');
  const dev = db.prepare("INSERT INTO push_devices(serial, name, active, conn_type, push_ver, machine_number) VALUES (?,?,1,?,?,?)");
  for (const [sn, name, n] of [['K1', 'Nhà ăn 1', 1], ['K2', 'Nhà ăn 2', 2], ['CC', 'Cổng chấm công', 9]]) dev.run(sn, name, 'push', '2.4.1', n);
  const emp = db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash, device_pin, department, active, start_date) VALUES (?,?,'employee',?,'x',?,?,1,'2025-01-02')");
  for (const [code, name, pin, dept] of [['NV101', 'Nguyễn An', '101', 'Sản xuất'], ['NV102', 'Trần Bình', '102', 'Sản xuất'], ['NV103', 'Lê Cường', '103', 'Kho'],
    ['NV104', 'Phạm Dũng', '104', 'Kho'], ['NV105', 'Hồ Em', '105', 'Sản xuất'], ['NV106', 'Vũ Phong', '106', 'Sản xuất'], ['NV107', 'Đỗ Giang', '107', 'Bảo vệ'],
    ['QT900', 'Bếp trưởng', '900', 'Bếp']]) emp.run(code, name, code.toLowerCase(), pin, dept);
  db.prepare("INSERT INTO hr_profiles(employee_id, nationality, emp_type) VALUES (?, 'Trung Quốc', 'Chính thức')").run(empId('NV101'));
  const du = db.prepare("INSERT INTO device_users(pin, name, card, passwd, privilege) VALUES (?,?,'','',0)");
  const dus = db.prepare('INSERT INTO device_users_serial(serial, pin, name, privilege) VALUES (?,?,?,?)');
  for (const pin of ['101', '102', '103', '104', '105', '106', '107', '900']) {
    du.run(pin, 'NV ' + pin);
    for (const sn of ['K1', 'K2']) dus.run(sn, pin, 'NV ' + pin, pin === '900' && sn === 'K2' ? 14 : 0);   // 900 là quản trị ở K2
  }
});

/* ---------------------------- A. máy không dùng tính công ---------------------------- */
test('A — mặc định mọi máy vẫn tính công (view att_punches = mọi lượt)', () => {
  S.ingestAttlog('K1', line('106', '2026-11-20 11:30:00'));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM att_punches WHERE serial='K1'").get().n, 1);
  assert.ok(db.prepare('SELECT 1 FROM attendance WHERE employee_id=? AND work_date=?').get(empId('NV106'), '2026-11-20'), 'máy thường → có dòng công');
});

test('A — máy nhà ăn KHÔNG tính công: lượt vẫn lưu, không vào bảng công, không xoá nhầm lượt chấm công khi chống trùng', () => {
  db.prepare("UPDATE push_devices SET no_att=1 WHERE serial IN ('K1','K2')").run();
  // NV103 chỉ quẹt ở nhà ăn → không có dòng công
  S.ingestAttlog('K1', line('103', '2026-11-21 11:30:00'));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM device_punches WHERE serial='K1' AND pin='103'").get().n, 1, 'lượt vẫn lưu (Xem quẹt, báo cáo suất ăn)');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM att_punches WHERE serial IN ('K1','K2')").get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM attendance WHERE employee_id=? AND work_date=?').get(empId('NV103'), '2026-11-21').n, 0);
  // NV104: vào 07:30 + ra 17:20 / 17:30 ở cổng, giữa đó quẹt ăn 17:25 ở nhà ăn
  S.ingestAttlog('CC', line('104', '2026-11-21 07:30:00'));
  S.ingestAttlog('CC', line('104', '2026-11-21 17:20:00'));
  S.ingestAttlog('K2', line('104', '2026-11-21 17:25:00'));
  S.ingestAttlog('CC', line('104', '2026-11-21 17:30:00'));
  const ps = db.prepare("SELECT serial, punch_at FROM device_punches WHERE pin='104' AND work_date='2026-11-21' ORDER BY punch_at").all();
  assert.deepEqual(ps.map((p) => p.serial), ['CC', 'CC', 'K2', 'CC'], 'chống trùng 15 phút chỉ so lượt cùng loại máy');
  const a = db.prepare('SELECT check_in_at, check_out_at FROM attendance WHERE employee_id=? AND work_date=?').get(empId('NV104'), '2026-11-21');
  assert.ok(a, 'có dòng công từ máy cổng');
  assert.notEqual(a.check_out_at, iso('2026-11-21 17:25'), 'giờ ra không lấy lượt quẹt ăn');
  assert.notEqual(a.check_in_at, iso('2026-11-21 17:25'));
  db.prepare("UPDATE push_devices SET no_att=0 WHERE serial IN ('K1','K2')").run();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM att_punches WHERE serial='K2'").get().n, 1, 'bỏ tích → lượt lại vào bảng công (sau khi Tính lại)');
  db.prepare("UPDATE push_devices SET no_att=1 WHERE serial IN ('K1','K2')").run();
});

/* ---------------------------- B. quy tắc thuần bữa tăng ca ---------------------------- */
test('B — trạng thái bữa tăng ca: đủ / không đủ / chờ xác minh', () => {
  const P = iso('2026-11-24 16:30'), now = iso('2026-11-24 21:00');
  const day = (ci, co, ot) => ({ work_date: '2026-11-24', check_in_at: ci && iso(ci), check_out_at: co && iso(co), ot });
  assert.equal(R.otMealStatus(120, null, P, now).st, 'cho');
  assert.equal(R.otMealStatus(120, day('2026-11-24 07:30', null, 0), P, now).st, 'cho', 'chưa chấm ra → không tự xác nhận');
  assert.equal(R.otMealStatus(120, day('2026-11-24 07:30', null, 130), P, now).st, 'du', 'đã đủ giờ thì đủ luôn');
  assert.equal(R.otMealStatus(120, day('2026-11-24 07:30', '2026-11-24 20:00', 180), P, now).st, 'du');
  const th = R.otMealStatus(120, day('2026-11-24 07:30', '2026-11-24 18:00', 30), P, now);
  assert.equal(th.st, 'thieu'); assert.match(th.note, /0:30 — dưới 2:00 giờ/);
  // giờ ra trước bữa ăn (lượt giữa giờ) → chờ tới 12 tiếng sau bữa, quá thì không đủ
  assert.equal(R.otMealStatus(120, day('2026-11-24 07:30', '2026-11-24 12:00', 0), P, now).st, 'cho');
  assert.equal(R.otMealStatus(120, day('2026-11-24 07:30', '2026-11-24 12:00', 0), P, iso('2026-11-25 05:00')).st, 'thieu');
});

test('B — chọn ngày công chứa giờ ăn (bữa tăng ca đêm 04:00 thuộc ca đêm vào từ tối hôm trước) + gộp nhiều dòng', () => {
  const d23 = { work_date: '2026-11-23', check_in_at: iso('2026-11-23 07:30'), check_out_at: iso('2026-11-23 17:00') };
  const d24n = { work_date: '2026-11-24', check_in_at: iso('2026-11-24 20:00'), check_out_at: iso('2026-11-25 06:30') };
  const d25 = { work_date: '2026-11-25', check_in_at: iso('2026-11-25 07:00'), check_out_at: null };
  assert.equal(R.pickAttDay([d24n, d25], iso('2026-11-25 04:30')), d24n);
  assert.equal(R.pickAttDay([d23, null], iso('2026-11-23 16:30')), d23);
  assert.equal(R.pickAttDay([d23], iso('2026-11-25 16:30')), null, 'vào quá 20 tiếng trước bữa → không phải ngày công đó');
  const m = R.mergeAttRows([{ work_date: 'x', check_in_at: iso('2026-11-24 13:00'), check_out_at: iso('2026-11-24 20:00'), ot_raw_min: 90, ot_min: 60 },
    { work_date: 'x', check_in_at: iso('2026-11-24 07:30'), check_out_at: iso('2026-11-24 11:30'), ot_raw_min: null, ot_min: 30 }]);
  assert.deepEqual(m, { work_date: 'x', check_in_at: iso('2026-11-24 07:30'), check_out_at: iso('2026-11-24 20:00'), ot: 120 });
  assert.equal(R.checkShiftConfig({ name: 'Chiều', from_time: '16:00', to_time: '17:30', mode: 'punch', ot_need_hours: '2' }).value.ot_need_min, 120);
  assert.equal(R.checkShiftConfig({ name: 'Chiều', from_time: '16:00', to_time: '17:30', mode: 'punch', ot_need_hours: '1,5' }).value.ot_need_min, 90);
  assert.equal(R.checkShiftConfig({ name: 'Chiều', from_time: '16:00', to_time: '17:30', mode: 'punch' }).value.ot_need_min, undefined, 'không gửi = không đụng');
  assert.equal(R.checkShiftConfig({ name: 'Chiều', from_time: '16:00', to_time: '17:30', mode: 'punch', ot_need_hours: '30' }).ok, false);
});

/* ---------------------------- C. nghỉ việc / bị khoá → máy bếp từ chối ---------------------------- */
test('C — mặc định TẮT: khoá NV không gửi gì xuống máy bếp', () => {
  D.setSetting('meal_guard_serials', 'K1,K2');
  db.prepare('UPDATE employees SET active=0 WHERE code=?').run('NV102');
  G.guardTick(VN('2026-11-24 10:00').getTime());
  assert.equal(db.prepare('SELECT COUNT(*) n FROM meal_guard_off').get().n, 0);
  assert.deepEqual(gcmds('K1', '102'), []);
});

test('C — bật: NV khoá / tới ngày nghỉ việc bị chặn trên mọi máy bếp; quản trị máy không chặn; mở khoá thì trả như cũ', () => {
  db.prepare('UPDATE employees SET leave_date=? WHERE code=?').run('2026-11-24', 'NV103');   // nghỉ từ hôm nay
  db.prepare('UPDATE employees SET leave_date=? WHERE code=?').run('2026-11-30', 'NV104');   // chưa tới ngày nghỉ
  db.prepare('UPDATE employees SET active=0 WHERE code=?').run('QT900');                       // quản trị ở K2, người thường ở K1
  const off = G.offPins('2026-11-24');   // Số ID khớp theo device_pin lẫn mã NV (như findEmpByPin)
  for (const p of ['102', '103', '900']) assert.ok(off.has(p), p);
  assert.ok(!off.has('104') && !off.has('101'));
  G.saveGuard({ window: false, once: false, off: true, serials: ['K1', 'K2'] });
  G.guardTick(VN('2026-11-24 10:00').getTime());
  const rows = db.prepare('SELECT serial || pin k FROM meal_guard_off ORDER BY k').all().map((r) => r.k);
  assert.deepEqual(rows, ['K1102', 'K1103', 'K1900', 'K2102', 'K2103'], 'K2 không chặn 900 (quản trị máy)');
  assert.equal(tzOf(gcmds('K1', '102').at(-1)), G.LOCK_TZ);
  assert.equal(tzOf(gcmds('K2', '103').at(-1)), G.LOCK_TZ);
  assert.deepEqual(gcmds('K1', '104'), []);
  // đẩy lại NV (VD đổi tên) vẫn giữ khoá
  assert.equal(tzOf(S.buildUserCommand('102', 'K1')), G.LOCK_TZ);
  // nhịp sau không gửi lại
  const n = db.prepare("SELECT COUNT(*) n FROM push_device_commands WHERE mkind='mguard'").get().n;
  G.guardTick(VN('2026-11-24 10:01').getTime());
  assert.equal(db.prepare("SELECT COUNT(*) n FROM push_device_commands WHERE mkind='mguard'").get().n, n);
  // mở khoá NV102 → trả TZ thường ở cả 2 máy
  db.prepare('UPDATE employees SET active=1 WHERE code=?').run('NV102');
  G.guardTick(VN('2026-11-24 10:02').getTime());
  assert.equal(db.prepare("SELECT COUNT(*) n FROM meal_guard_off WHERE pin='102'").get().n, 0);
  assert.equal(tzOf(gcmds('K1', '102').at(-1)), '0000000100000000');
  assert.equal(tzOf(gcmds('K2', '102').at(-1)), '0000000100000000');
  const st = G.guardStatus(VN('2026-11-24 10:02').getTime());
  assert.equal(st.off, true); assert.equal(st.off_people, 2);
  assert.equal(st.devices.find((d) => d.serial === 'K1').blocked, 2);
  assert.equal(st.devices.find((d) => d.serial === 'K1').counts_att, false);
  assert.equal(st.devices.find((d) => d.serial === 'CC').counts_att, true);
  // tắt công tắc → bỏ chặn hết
  G.saveGuard({ window: false, once: false, off: false, serials: ['K1', 'K2'] });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM meal_guard_off').get().n, 0);
  assert.equal(tzOf(gcmds('K1', '103').at(-1)), '0000000100000000');
  db.prepare("UPDATE employees SET active=1, leave_date='' WHERE code IN ('QT900','NV103','NV104')").run();
  D.setSetting('meal_guard_serials', '');
});

/* ---------------------------- D. báo cáo chi tiết lượt ăn ---------------------------- */
function seedReport() {
  db.prepare('DELETE FROM meal_shifts').run();
  const ins = db.prepare('INSERT INTO meal_shifts(code, name, from_time, to_time, mode, enabled, sort_order, ot_need_min) VALUES (?,?,?,?,?,1,?,?)');
  [['sang', 'Sáng', '06:30', '08:00', 0], ['trua', 'Trưa', '11:00', '13:00', 0], ['chieu', 'Chiều (tăng ca)', '16:00', '17:30', 120],
    ['dem', 'Đêm', '23:00', '01:00', 0], ['tcdem', 'Tăng ca đêm', '04:00', '05:30', 120]].forEach(([c, n, f, t, ot], i) => ins.run(c, n, f, t, 'punch', i, ot));
  D.setSetting('meal_serials', 'K1,K2');
  D.setSetting('meal_unit_price', '25000');
  const p = db.prepare('INSERT INTO device_punches(serial, pin, punch_at, work_date, status, verify, employee_id) VALUES (?,?,?,?,0,?,?)');
  const put = (sn, pin, t, v = 15, emp = true) => p.run(sn, pin, iso(t), t.slice(0, 10), v, emp ? db.prepare('SELECT id FROM employees WHERE device_pin=? AND active=1').get(pin)?.id ?? null : null);
  put('K1', '101', '2026-11-24 11:30:10');                 // trưa: đủ
  put('K2', '101', '2026-11-24 11:35:00');                 // trưa lần 2: quẹt lặp
  put('CC', '101', '2026-11-24 11:40:00');                 // máy cổng — không phải máy chấm ăn
  put('K1', '101', '2026-11-24 16:30:00', 4);              // chiều (thẻ): tăng ca 3h → đủ
  put('K1', '104', '2026-11-24 16:40:00');                 // chiều: ra 17:00, tăng ca 0 → không đủ
  put('K2', '105', '2026-11-24 16:45:00');                 // chiều: chưa chấm ra → chờ
  put('K2', '106', '2026-11-24 16:50:00');                 // chiều: chưa có dữ liệu chấm công → chờ
  put('K1', '107', '2026-11-25 04:30:00');                 // tăng ca đêm: ca đêm vào 20:00 hôm 24, tăng ca 2h30 → đủ
  put('K1', '102', '2026-11-24 12:10:00', 15, false);      // NV102 đang khoá (lượt không gán NV)
  put('K2', '555', '2026-11-24 12:20:00', 15, false);      // Số ID lạ
  put('K1', '101', '2026-11-24 09:00:00');                 // ngoài giờ ăn
  put('K1', '103', '2026-11-24 23:30:00');                 // bữa đêm
  const a = db.prepare('INSERT OR REPLACE INTO attendance(employee_id, work_date, check_in_at, check_out_at, ot_min, ot_raw_min) VALUES (?,?,?,?,?,?)');
  a.run(empId('NV101'), '2026-11-24', iso('2026-11-24 07:30'), iso('2026-11-24 20:00'), 120, 180);
  a.run(empId('NV104'), '2026-11-24', iso('2026-11-24 07:30'), iso('2026-11-24 17:00'), 0, 0);
  a.run(empId('NV105'), '2026-11-24', iso('2026-11-24 07:30'), null, 0, 0);
  a.run(empId('NV107'), '2026-11-24', iso('2026-11-24 20:00'), iso('2026-11-25 06:30'), 150, 150);
  db.prepare('UPDATE employees SET active=0 WHERE code=?').run('NV102');
}

test('D — chi tiết lượt ăn: mỗi lượt 1 dòng, trạng thái đúng, đơn giá + thành tiền, lọc', () => {
  seedReport();
  const now = VN('2026-11-25 09:00');
  const r = M.mealScans({ from: '2026-11-24', to: '2026-11-25', now });
  const st = Object.fromEntries(r.rows.map((x) => [`${x.code}|${x.shift}|${x.at.slice(11, 16)}`, x.status]));
  assert.deepEqual(st, {
    'NV101|trua|04:30': 'du', 'NV101|trua|04:35': 'lap', 'NV102|trua|05:10': 'nghi', '555|trua|05:20': 'la',
    'NV101|chieu|09:30': 'du', 'NV104|chieu|09:40': 'thieu', 'NV105|chieu|09:45': 'cho', 'NV106|chieu|09:50': 'cho',
    'NV103|dem|16:30': 'du', 'NV107|tcdem|21:30': 'du',
  });
  assert.equal(r.outside, 1, 'lượt 09:00 ngoài giờ ăn không vào bảng');
  assert.equal(r.totals.meals, 9, 'quẹt lặp không tính');
  assert.equal(r.totals.amount, 9 * 25000);
  assert.deepEqual(r.totals.by, { du: 4, thieu: 1, cho: 2, lap: 1, nghi: 1, la: 1 });
  const an = r.rows.find((x) => x.code === 'NV101' && x.shift === 'chieu');
  assert.equal(an.ot, 180); assert.equal(an.verify, 'Thẻ'); assert.equal(an.device, 'Nhà ăn 1'); assert.equal(an.machine_number, 1);
  assert.equal(an.nationality, 'Trung Quốc'); assert.equal(an.emp_type, 'Chính thức'); assert.equal(an.start_date, '2025-01-02'); assert.equal(an.price, 25000);
  assert.equal(r.rows.find((x) => x.status === 'lap').price, 0);
  const tc = r.rows.find((x) => x.code === 'NV107');
  assert.equal(tc.date, '2026-11-25'); assert.equal(tc.ot, 150);
  assert.equal(r.rows.find((x) => x.code === 'NV102').full_name, 'Trần Bình', 'NV đã khoá vẫn nhận ra tên theo Số ID');
  // lọc
  assert.equal(M.mealScans({ from: '2026-11-24', to: '2026-11-25', status: 'cho', now }).rows.length, 2);
  assert.deepEqual(M.mealScans({ from: '2026-11-24', to: '2026-11-25', dept: 'Kho', now }).rows.map((x) => x.code).sort(), ['NV103', 'NV104']);
  assert.equal(M.mealScans({ from: '2026-11-24', to: '2026-11-25', shift: 'chieu', now }).totals.meals, 4);
  assert.deepEqual(M.mealScans({ from: '2026-11-24', to: '2026-11-25', q: 'phong', now }).rows.map((x) => x.code), ['NV106'], 'tìm không cần dấu');
  // NV105 chấm ra lúc 20:30 → tự chuyển đủ điều kiện
  db.prepare('UPDATE attendance SET check_out_at=?, ot_raw_min=150 WHERE employee_id=? AND work_date=?').run(iso('2026-11-24 20:30'), empId('NV105'), '2026-11-24');
  assert.equal(M.mealScans({ from: '2026-11-24', to: '2026-11-24', q: 'NV105', now }).rows[0].status, 'du');
  assert.throws(() => M.mealScans({ from: '2026-10-01', to: '2026-11-25', now }), /Tối đa 31 ngày/);
});

test('D — Excel chi tiết lượt ăn: đủ dòng + dòng tổng + sheet Tổng hợp', async () => {
  const ExcelJS = (await import('exceljs')).default;
  const r = M.mealScans({ from: '2026-11-24', to: '2026-11-25', now: VN('2026-11-25 09:00') });
  const out = new PassThrough(), bufs = [];
  out.on('data', (b) => bufs.push(b));
  out.setHeader = () => {};
  const done = new Promise((ok) => out.on('end', ok));
  await X.writeMealScansXlsx(out, r);
  await done;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.concat(bufs));
  const ws = wb.getWorksheet('Chi tiết lượt ăn');
  assert.equal(ws.getRow(3).getCell(13).value, 'Trạng thái');
  assert.equal(ws.rowCount, 3 + r.rows.length + 1);
  const last = ws.getRow(ws.rowCount);
  assert.equal(last.getCell(1).value, 'Tổng cộng');
  assert.equal(last.getCell(11).value, r.totals.amount);
  const sum = wb.getWorksheet('Tổng hợp');
  assert.ok(sum.getRow(4).getCell(1).value);
});

test('D — xếp bữa theo bộ nhớ khung từng ngày cho kết quả y hệt shiftForPunch (lượt quẹt ngẫu nhiên, có bữa qua đêm)', () => {
  db.prepare("DELETE FROM device_punches WHERE serial IN ('K1','K2')").run();
  db.prepare("INSERT INTO meal_shifts(code, name, from_time, to_time, mode, enabled, sort_order, ot_need_min) VALUES ('khuya','Khuya','00:30','02:00','punch',1,9,0)").run();
  const p = db.prepare('INSERT INTO device_punches(serial, pin, punch_at, work_date, status, verify, employee_id) VALUES (?,?,?,?,0,15,NULL)');
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const base = Date.parse('2026-11-23T17:00:00Z');   // 00:00 giờ VN ngày 24/11
  for (let i = 0; i < 600; i++) {
    const at = new Date(base + Math.floor(rnd() * 3 * 86400) * 1000).toISOString();
    p.run(i % 2 ? 'K1' : 'K2', String(9000 + i), at, at.slice(0, 10));   // Số ID khác nhau → không có quẹt lặp
  }
  const shifts = db.prepare('SELECT * FROM meal_shifts ORDER BY sort_order').all();
  const r = M.mealScans({ from: '2026-11-24', to: '2026-11-25', now: VN('2026-11-27 09:00') });
  const want = new Map();
  let outside = 0;
  for (const x of db.prepare("SELECT pin, punch_at FROM device_punches WHERE serial IN ('K1','K2')").all()) {
    const h = R.shiftForPunch(x.punch_at, shifts);
    const vnDay = new Date(Date.parse(x.punch_at) + 7 * 3600000).toISOString().slice(0, 10);
    if (!h) { if (vnDay >= '2026-11-24' && vnDay <= '2026-11-25') outside++; continue; }
    if (h.workDate >= '2026-11-24' && h.workDate <= '2026-11-25') want.set(x.pin, h.workDate + '|' + h.shift.code);
  }
  assert.ok(want.size > 100);
  assert.deepEqual(new Map(r.rows.map((x) => [x.code, x.date + '|' + x.shift])), want);
  assert.equal(r.outside, outside);
  assert.ok(r.rows.some((x) => x.shift === 'dem' && x.at.slice(0, 10) !== x.date || x.shift === 'khuya'), 'có lượt qua đêm');
  db.prepare("DELETE FROM meal_shifts WHERE code='khuya'").run();
});
