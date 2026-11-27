// MÁY BẾP TỰ TỪ CHỐI (server/meal-guard.js) — máy ZKTeco ADMS có kiểm soát ra vào ở nhà ăn (yêu cầu bếp 8 máy, 27/11/2026):
//   · KHUNG GIỜ: nhóm 1 trên máy bếp chỉ được quét trong giờ ăn (AccTimeZone + AccGroup), > 3 khung thì xoay theo bữa sắp tới
//   · MỘT LẦN / BỮA: quét ở 1 máy bếp → mọi máy bếp khoá người đó (TZ 0001000000000000) tới hết bữa, hết bữa mở lại
//   · công tắc mặc định TẮT = lệnh xuống máy y như cũ. Chạy: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-may-bep-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, D, S, G;
const VN = (s) => Date.parse(s.replace(' ', 'T') + '+07:00');           // '2026-11-24 12:00' giờ VN → ms
const at = (t, s) => { if (!t.__mock) { t.mock.timers.enable({ apis: ['Date'], now: VN(s) }); t.__mock = 1; } else t.mock.timers.setTime(VN(s)); };
const fields = (c) => Object.fromEntries(c.replace(/^DATA UPDATE USERINFO /, '').split('\t').map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]));
const gcmds = (sn) => db.prepare("SELECT id, content, pin, trans_time FROM push_device_commands WHERE serial=? AND mkind='mguard' ORDER BY id").all(sn);
const pend = (sn) => gcmds(sn).filter((c) => !c.trans_time);
const openLocks = (pin) => db.prepare('SELECT serial FROM meal_guard_locks WHERE pin=? AND released_at IS NULL ORDER BY serial').all(pin).map((r) => r.serial);
const att = (pin, time) => `${pin}\t${time}\t0\t15\t0`;
const setShifts = (rows) => {
  db.prepare('DELETE FROM meal_shifts').run();
  const ins = db.prepare('INSERT INTO meal_shifts(code, name, from_time, to_time, mode, enabled, sort_order) VALUES (?,?,?,?,?,1,?)');
  rows.forEach(([c, n, f, t], i) => ins.run(c, n, f, t, 'punch', i));
};

before(async () => {
  D = await import('../server/db.js');
  db = D.db; D.initSchema();
  S = await import('../server/device-sync.js');
  G = await import('../server/meal-guard.js');   // nạp module = gắn vào buildUserCommand + ingestAttlog
  D.setSetting('device_enabled', '1');
  D.setSetting('meal_enabled', '1');
  D.setSetting('punch_dedup_min', '1');
  const dev = db.prepare("INSERT INTO push_devices(serial, name, active, conn_type, push_ver) VALUES (?,?,1,?,?)");
  for (const [sn, name, ct] of [['K1', 'Bếp 1', 'push'], ['K2', 'Bếp 2', 'push'], ['K3', 'Bếp 3', 'push'], ['CC', 'Cổng chấm công', 'push'], ['T1', 'Máy TCP', 'tcp']]) dev.run(sn, name, ct, '2.4.1');
  const emp = db.prepare("INSERT INTO employees(code, full_name, role, username, password_hash, device_pin, active) VALUES (?,?,'employee',?,'x',?,1)");
  for (const [code, name, pin] of [['NV101', 'Nguyễn An', '101'], ['NV102', 'Trần Bình', '102'], ['QT900', 'Bếp trưởng', '900'], ['QT901', 'Quản trị K1', '901']]) emp.run(code, name, code.toLowerCase(), pin);
  const du = db.prepare("INSERT INTO device_users(pin, name, card, passwd, privilege) VALUES (?,?,'','',0)");
  for (const [pin, name] of [['101', 'Nguyen An'], ['102', 'Tran Binh'], ['900', 'Bep truong'], ['901', 'Quan tri K1']]) du.run(pin, name);
  const dus = db.prepare('INSERT INTO device_users_serial(serial, pin, name, privilege) VALUES (?,?,?,?)');
  for (const sn of ['K1', 'K2', 'K3', 'CC']) for (const pin of ['101', '102']) dus.run(sn, pin, pin, 0);
  dus.run('K2', '900', 'Bep truong', 14);   // quản trị ở máy K2
  dus.run('K1', '900', 'Bep truong', 0);    // người thường ở máy K1 (K3 không có người này)
  dus.run('K1', '901', 'Quan tri K1', 14);
  setShifts([['trua', 'Bữa trưa', '11:00', '13:00'], ['chieu', 'Bữa chiều', '17:00', '19:00']]);
});

test('quy tắc thuần: đoạn giờ bữa ăn (tách qua nửa đêm, gộp đoạn liền nhau) + chọn 3 khung sắp tới', () => {
  const on = (f, t) => ({ enabled: 1, from_time: f, to_time: t });
  assert.deepEqual(G.mealSegments([on('11:00', '13:00'), on('13:00', '14:00'), on('22:00', '01:00'), { ...on('08:00', '09:00'), enabled: 0 }]),
    [{ from: 0, to: 60 }, { from: 660, to: 840 }, { from: 1320, to: 1439 }]);
  assert.deepEqual(G.mealSegments([on('06:00', '06:00')]), [{ from: 0, to: 1439 }]);   // bữa 24 giờ
  const six = G.mealSegments([on('06:00', '07:00'), on('11:00', '13:00'), on('17:00', '19:00'), on('20:00', '21:00'), on('23:00', '00:30')]);
  assert.equal(six.length, 6);   // 23:00–00:30 tách 2 đoạn
  const txt = (a) => a.map(G.segText).join(' ');
  assert.equal(txt(G.pickSegments(six, 12 * 60)), '11:00–13:00 17:00–19:00 20:00–21:00');   // đang ăn trưa
  assert.equal(txt(G.pickSegments(six, 13 * 60 + 1)), '17:00–19:00 20:00–21:00 23:00–23:59');
  assert.equal(txt(G.pickSegments(six, 23 * 60 + 30)), '00:00–00:30 06:00–07:00 23:00–23:59');   // vòng sang hôm sau
  assert.equal(G.pickSegments(six.slice(0, 3), 0).length, 3);
});

test('lệnh hãng đúng định dạng: AccTimeZone đủ 7 ngày, AccGroup 3 khung, TZ 16 chữ số', () => {
  const c = G.tzCommand(46, { from: 660, to: 780 });
  assert.ok(c.startsWith('DATA UPDATE AccTimeZone UID=46\t'));
  for (const d of ['Sun', 'Mon', 'Tues', 'Wed', 'Thurs', 'Fri', 'Sat']) assert.ok(c.includes(`\t${d}Start=1100\t${d}End=1300`), d);
  assert.equal(c.split('\t').length, 15);
  assert.equal(G.groupCommand([46, 47]), 'DATA UPDATE AccGroup ID=1\tVerify=0\tValidHoliday=0\tTZ=46;47;0');
  assert.equal(G.GROUP_RESTORE, 'DATA UPDATE AccGroup ID=1\tVerify=0\tValidHoliday=0\tTZ=1;0;0');
  assert.match(G.LOCK_TZ, /^0001\d{12}$/);
  assert.equal(G.ADMIN_TZ, '0001004500000000');
});

test('mặc định TẮT: quẹt ở máy bếp không sinh lệnh nào, đẩy NV y như cũ', (t) => {
  at(t, '2026-11-24 12:00:30');
  assert.equal(S.ingestAttlog('K1', att('101', '2026-11-24 12:00:05')), 1);
  assert.equal(gcmds('K2').length + gcmds('K1').length, 0);
  assert.deepEqual(openLocks('101'), []);
  assert.equal(fields(S.buildUserCommand('101', 'K1')).TZ, D.USER_TZ);
  assert.equal(fields(S.buildUserCommand('901', 'K1')).TZ, D.USER_TZ);
  assert.equal(G.guardDelay('K1'), null);
  assert.equal(S.pollDelay('K1'), 10);
  assert.deepEqual(G.guardTick(), { released: 0, tz: 0 });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM meal_guard_state').get().n, 0);
  // chọn máy nhưng chưa bật công tắc nào → vẫn như cũ
  G.saveGuard({ window: false, once: false, serials: ['K1', 'K2'] });
  assert.deepEqual(G.guardSerials(), []);
  assert.equal(fields(S.buildUserCommand('101', 'K1')).TZ, D.USER_TZ);
  db.prepare('DELETE FROM device_punches').run();
});

test('MỘT LẦN / BỮA: quét ở K1 → K1, K2, K3 khoá người đó tới hết bữa; máy chấm công khác không đụng', (t) => {
  at(t, '2026-11-24 12:00:30');
  const st = G.saveGuard({ window: false, once: true, serials: ['K1', 'K2', 'K3', 'T1', 'KHONG_CO'] });
  assert.deepEqual(st.serials, ['K1', 'K2', 'K3', 'T1']);   // serial lạ bị bỏ
  assert.deepEqual(G.guardSerials(), ['K1', 'K2', 'K3']);   // máy TCP/IP không nhận lệnh ADMS
  assert.equal(G.guardDelay('K1'), G.GUARD_DELAY);
  assert.equal(G.guardDelay('CC'), null);
  assert.equal(S.pollDelay('K1'), G.GUARD_DELAY);   // lời chào máy (GET OPTION) gửi Delay=3 cho máy bếp
  assert.equal(S.pollDelay('CC'), 10);              // máy khác như cũ
  // K2 đang có sẵn lệnh thường chờ gửi → lệnh khoá phải đi TRƯỚC
  S.queueCmd('K2', 'DATA UPDATE USERINFO PIN=555\tName=X\tPasswd=\tPri=0\tGrp=1\tTZ=' + D.USER_TZ + '\tVerify=0', { pin: '555', mkind: 'user' });

  assert.equal(S.ingestAttlog('K1', att('101', '2026-11-24 12:00:05')), 1);
  assert.deepEqual(openLocks('101'), ['K1', 'K2', 'K3']);
  for (const sn of ['K1', 'K2', 'K3']) {
    const c = gcmds(sn).filter((x) => x.pin === '101');
    assert.equal(c.length, 1, sn);
    assert.equal(fields(c[0].content).TZ, G.LOCK_TZ, sn);
    assert.equal(fields(c[0].content).Name, 'Nguyen An');
  }
  assert.equal(gcmds('CC').length, 0);
  const first = S.nextCommand('K2').split('\n')[0];
  assert.ok(first.includes('PIN=101') && first.includes('TZ=' + G.LOCK_TZ), first);
  // đẩy NV lúc đang khoá (HR sửa tên…) vẫn giữ khoá; máy khác / người khác như cũ
  assert.equal(fields(S.buildUserCommand('101', 'K3')).TZ, G.LOCK_TZ);
  assert.equal(fields(S.buildUserCommand('101', 'CC')).TZ, D.USER_TZ);
  assert.equal(fields(S.buildUserCommand('102', 'K3')).TZ, D.USER_TZ);

  // quét lại ở máy khác (lệnh chưa tới kịp) → không xếp thêm lệnh khoá
  at(t, '2026-11-24 12:03:30');
  S.ingestAttlog('K2', att('101', '2026-11-24 12:03:10'));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM meal_guard_locks WHERE pin='101'").get().n, 3);

  // quản trị máy K2 (900): không khoá ở K2; K1 là người thường → khoá; K3 không có người này → không ghi
  S.ingestAttlog('K1', att('900', '2026-11-24 12:03:20'));
  assert.deepEqual(openLocks('900'), ['K1']);
  assert.equal(G.guardStatus().locked_people, 2);
});

test('lượt ngoài giờ ăn / lượt cũ gửi bù sau khi hết bữa: không khoá', (t) => {
  at(t, '2026-11-24 15:00:30');
  S.ingestAttlog('K1', att('102', '2026-11-24 15:00:05'));   // ngoài mọi bữa
  S.ingestAttlog('K1', att('102', '2026-11-24 12:30:00'));   // bữa trưa đã hết lúc 13:00
  assert.deepEqual(openLocks('102'), []);
});

test('hết bữa: mở lại — lệnh khoá đã gửi thì gửi lệnh mở, chưa gửi thì huỷ luôn', (t) => {
  at(t, '2026-11-24 12:50:00');
  db.prepare("UPDATE push_device_commands SET trans_time=datetime('now') WHERE serial='K1' AND mkind='mguard'").run();   // K1 đã nhận lệnh khoá
  assert.equal(G.guardTick().released, 0);   // chưa hết bữa
  at(t, '2026-11-24 13:01:30');
  assert.equal(G.guardTick().released, 4);   // 101 × 3 máy + 900 ở K1
  assert.deepEqual(openLocks('101'), []);
  const k1 = pend('K1').filter((c) => c.pin === '101');
  assert.equal(k1.length, 1);
  assert.equal(fields(k1[0].content).TZ, D.USER_TZ);          // K1: gửi lệnh mở
  assert.equal(fields(pend('K2').find((c) => c.pin === '101').content).TZ, D.USER_TZ);   // K2 đã lấy lệnh khoá qua nextCommand → mở
  assert.equal(gcmds('K3').filter((c) => c.pin === '101').length, 0);                    // K3 chưa lấy → huỷ, không cần mở
  assert.equal(fields(S.buildUserCommand('101', 'K1')).TZ, D.USER_TZ);
  // xoá người khỏi máy: bỏ cả lệnh máy bếp còn chờ (không tạo lại người rỗng)
  S.deleteDeviceUsers('K1', ['101']);
  assert.equal(pend('K1').filter((c) => c.pin === '101').length, 0);
});

test('KHUNG GIỜ: nhóm 1 chỉ quét được trong giờ ăn, quản trị luôn quét được, > 3 khung thì xoay, tắt thì trả như cũ', (t) => {
  at(t, '2026-11-24 12:00:00');
  G.saveGuard({ window: true, once: false, serials: ['K1'] });
  assert.equal(openLocks('900').length, 0);   // tắt "một lần / bữa" → mở hết
  const c1 = pend('K1').map((c) => c.content);
  assert.ok(c1.includes(G.tzCommand(45, { from: 0, to: 1439 })));
  assert.ok(c1.includes(G.tzCommand(46, { from: 660, to: 780 })));
  assert.ok(c1.includes(G.tzCommand(47, { from: 1020, to: 1140 })));
  assert.ok(c1.includes(G.groupCommand([46, 47])));
  const adm = c1.filter((c) => c.includes('PIN=901'));
  assert.equal(adm.length, 1);
  assert.equal(fields(adm[0]).TZ, G.ADMIN_TZ);   // quản trị K1: khung riêng cả ngày
  assert.equal(fields(S.buildUserCommand('102', 'K1')).TZ, D.USER_TZ);   // người thường theo nhóm 1
  assert.equal(gcmds('K2').filter((c) => /AccTimeZone|AccGroup/.test(c.content)).length, 0);   // K2 không chọn
  assert.equal(G.guardDelay('K1'), null);   // chỉ "một lần / bữa" mới cần hỏi lệnh nhanh
  const n = gcmds('K1').length;
  assert.equal(G.guardTick().tz, 0);         // không đổi gì → không gửi lại
  assert.equal(gcmds('K1').length, n);

  // 5 bữa (6 đoạn) → giữ 3 khung sắp tới
  setShifts([['sang', 'Sáng', '06:00', '07:00'], ['trua', 'Trưa', '11:00', '13:00'], ['chieu', 'Chiều', '17:00', '19:00'], ['toi', 'Tối', '20:00', '21:00'], ['tc', 'Tăng ca', '23:00', '00:30']]);
  G.guardTick();
  const c2 = gcmds('K1').slice(n).map((c) => c.content);
  assert.deepEqual(c2, [G.tzCommand(48, { from: 1200, to: 1260 }), G.groupCommand([46, 47, 48])]);
  assert.equal(G.guardStatus().rotating, true);
  at(t, '2026-11-24 13:01:00');
  G.guardTick();
  const c3 = gcmds('K1').slice(n + 2).map((c) => c.content);
  assert.deepEqual(c3, [G.tzCommand(46, { from: 1020, to: 1140 }), G.tzCommand(47, { from: 1200, to: 1260 }), G.tzCommand(48, { from: 1380, to: 1439 })]);
  const k1 = G.guardStatus().devices.find((d) => d.serial === 'K1');
  assert.deepEqual(k1.slots, ['17:00–19:00', '20:00–21:00', '23:00–23:59']);

  // tắt khung giờ → nhóm 1 về khung 1 (cả ngày), quản trị về như cũ
  const m = gcmds('K1').length;
  G.saveGuard({ window: false, once: false, serials: ['K1'] });
  const c4 = gcmds('K1').slice(m).map((c) => c.content);
  assert.equal(c4[0], G.GROUP_RESTORE);
  assert.equal(fields(c4.find((c) => c.includes('PIN=901'))).TZ, D.USER_TZ);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM meal_guard_state').get().n, 0);
  assert.equal(fields(S.buildUserCommand('901', 'K1')).TZ, D.USER_TZ);
  assert.deepEqual(G.guardTick(), { released: 0, tz: 0 });
});

test('bỏ máy khỏi danh sách máy bếp khi đang bật khung giờ → máy đó trả về như cũ', (t) => {
  at(t, '2026-11-24 12:00:00');
  setShifts([['trua', 'Bữa trưa', '11:00', '13:00']]);
  G.saveGuard({ window: true, once: true, serials: ['K1', 'K3'] });
  const m = gcmds('K3').length;
  G.saveGuard({ window: true, once: true, serials: ['K1'] });
  assert.deepEqual(gcmds('K3').slice(m).map((c) => c.content), [G.GROUP_RESTORE]);
  assert.ok(db.prepare("SELECT 1 FROM meal_guard_state WHERE serial='K1'").get());
  assert.ok(!db.prepare("SELECT 1 FROM meal_guard_state WHERE serial='K3'").get());
  // gửi lại toàn bộ khung giờ xuống K1 (máy vừa khôi phục cài đặt gốc) — lệnh cũ máy đã nhận; lệnh y hệt còn chờ thì không xếp trùng
  db.prepare("UPDATE push_device_commands SET trans_time=datetime('now'), response_at=datetime('now'), return_value='0' WHERE serial='K1'").run();
  const k = gcmds('K1').length;
  G.resendGuard('K1');
  const re = gcmds('K1').slice(k).map((c) => c.content);
  assert.ok(re.includes(G.tzCommand(46, { from: 660, to: 780 })) && re.includes(G.groupCommand([46])));
  G.saveGuard({ window: false, once: false, serials: [] });
});
