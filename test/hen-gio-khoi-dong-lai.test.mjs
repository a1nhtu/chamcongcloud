// Hẹn giờ khởi động lại máy chấm công (server/reboot-schedule.js): hằng ngày / theo thứ, mỗi ngày tối đa 1 lần,
// chỉ trong 10 phút đầu kể từ giờ hẹn (máy tính ngủ qua giờ hẹn → bỏ lượt), lệnh REBOOT máy chưa nhận quá 10 phút thì huỷ.
// Chạy: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-reboot-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, setSetting, R;
const routes = {};
const call = async (key, params, body) => {
  let out = null, code = 200, i = 0;
  const res = { status(c) { code = c; return this; }, json(o) { out = o; return this; } };
  const req = { body, params, query: {}, user: { id: 1, role: 'admin', master: true } };
  const hs = routes[key]; const next = async () => { const h = hs[i++]; if (h) await h(req, res, next); };
  await next();
  return { code, out };
};
// Giờ Việt Nam → mốc ms (máy chủ có thể để múi giờ khác)
const vn = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h, mi) - 7 * 3600e3;
const addDev = (serial, sched, o = {}) => db.prepare("INSERT INTO push_devices(serial, name, active, reboot_sched, conn_type) VALUES(?,?,?,?,?)")
  .run(serial, serial, o.active ?? 1, sched, o.conn ?? 'push').lastInsertRowid;
const reboots = (serial) => db.prepare("SELECT * FROM push_device_commands WHERE serial=? AND content='REBOOT'").all(serial);
const dev = (serial) => db.prepare('SELECT * FROM push_devices WHERE serial=?').get(serial);
const reset = () => { db.exec('DELETE FROM push_devices; DELETE FROM push_device_commands;'); setSetting('device_enabled', '1'); };

before(async () => {
  const D = await import('../server/db.js');
  db = D.db; setSetting = D.setSetting; D.initSchema();
  R = await import('../server/reboot-schedule.js');
  const add = (m) => (p, ...h) => { routes[`${m} ${p}`] = h; };
  (await import('../server/routes/admin/devices.js')).registerDeviceRoutes({ get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE') }, { need: () => (q, s, n) => n() });
});

test('hằng ngày 03:00: tới giờ gửi REBOOT đúng 1 lần, chưa tới giờ thì không', async () => {
  reset(); addDev('P1', '03:00|0123456');
  await R.rebootTick(vn(2026, 10, 25, 2, 59));
  assert.equal(reboots('P1').length, 0);
  await R.rebootTick(vn(2026, 10, 25, 3, 0));
  assert.equal(reboots('P1').length, 1);
  assert.equal(reboots('P1')[0].mkind, 'sched_reboot');
  assert.equal(dev('P1').reboot_last, '2026-10-25');
  assert.match(dev('P1').reboot_note, /^25\/10 03:00 — đã gửi lệnh/);
  await R.rebootTick(vn(2026, 10, 25, 3, 1));
  await R.rebootTick(vn(2026, 10, 25, 3, 5));
  assert.equal(reboots('P1').length, 1, 'cùng ngày không gửi lại');
  // máy đã nhận lệnh (trans_time) → hôm sau tới giờ lại gửi
  db.prepare("UPDATE push_device_commands SET trans_time='x', response_at='y'").run();
  await R.rebootTick(vn(2026, 10, 26, 3, 0));
  assert.equal(reboots('P1').length, 2);
});

test('máy tính ngủ qua giờ hẹn → BỎ lượt (không khởi động lại bù giữa giờ làm)', async () => {
  reset(); addDev('P2', '03:00|0123456');
  await R.rebootTick(vn(2026, 10, 25, 3, 10));   // dậy muộn 10 phút
  await R.rebootTick(vn(2026, 10, 25, 8, 15));   // giờ làm
  assert.equal(reboots('P2').length, 0);
  assert.equal(dev('P2').reboot_last, '');
});

test('theo thứ: chỉ khởi động lại đúng ngày đã chọn (25/10/2026 = Chủ nhật)', async () => {
  reset(); addDev('P3', '04:30|0');
  await R.rebootTick(vn(2026, 10, 24, 4, 30));   // T7
  assert.equal(reboots('P3').length, 0);
  await R.rebootTick(vn(2026, 10, 25, 4, 32));   // CN, trễ 2 phút vẫn trong 10 phút
  assert.equal(reboots('P3').length, 1);
});

test('giờ hẹn sát nửa đêm 23:55: máy tính chạy tới 00:02 vẫn làm, tính cho ngày hôm trước', async () => {
  reset(); addDev('P4', '23:55|0123456');
  await R.rebootTick(vn(2026, 10, 26, 0, 2));
  assert.equal(reboots('P4').length, 1);
  assert.equal(dev('P4').reboot_last, '2026-10-25');
  await R.rebootTick(vn(2026, 10, 26, 0, 3));
  assert.equal(reboots('P4').length, 1);
});

test('bỏ qua: máy chưa duyệt / chưa hẹn; tắt dùng máy chấm công → ghi lỗi, không gửi lệnh', async () => {
  reset(); addDev('P5', '03:00|0123456', { active: 0 }); addDev('P6', '');
  await R.rebootTick(vn(2026, 10, 25, 3, 0));
  assert.equal(reboots('P5').length + reboots('P6').length, 0);
  addDev('P7', '03:00|0123456'); setSetting('device_enabled', '0');
  await R.rebootTick(vn(2026, 10, 25, 3, 0));
  assert.equal(reboots('P7').length, 0);
  assert.match(dev('P7').reboot_note, /lỗi: phần mềm đang tắt dùng máy chấm công/);
});

test('lệnh REBOOT theo lịch máy chưa nhận (mất mạng) quá 10 phút → huỷ; lệnh đã gửi tới máy thì giữ', async () => {
  reset(); addDev('P8', '03:00|0123456');
  await R.rebootTick(vn(2026, 10, 25, 3, 0));
  assert.equal(reboots('P8').length, 1);
  await R.rebootTick(vn(2026, 10, 25, 3, 9));
  assert.equal(reboots('P8').length, 1, 'chưa quá 10 phút');
  await R.rebootTick(vn(2026, 10, 25, 3, 11));
  assert.equal(reboots('P8').length, 0, 'máy không nối lại kịp → huỷ, tránh khởi động lại giữa ngày');
  // lệnh tay (không phải theo lịch) không bị đụng tới
  db.prepare("INSERT INTO push_device_commands(serial, content, created_at) VALUES('P8','REBOOT','2020-01-01 00:00:00')").run();
  await R.rebootTick(vn(2026, 10, 25, 9, 0));
  assert.equal(reboots('P8').length, 1);
});

test('API lưu lịch: hằng ngày / theo thứ / tắt / áp cho tất cả máy; dữ liệu sai bị chặn', async () => {
  reset(); const a = addDev('A1', ''), b = addDev('A2', '');
  db.prepare("UPDATE push_devices SET reboot_last='2026-10-25'").run();
  let r = await call('PUT /devices/:id/reboot-schedule', { id: a }, { mode: 'daily', time: '03:00' });
  assert.equal(r.code, 200); assert.equal(r.out.sched, '03:00|0123456'); assert.equal(r.out.label, '03:00 hằng ngày');
  assert.equal(dev('A1').reboot_last, '', 'lưu lại → giờ mới hôm nay vẫn chạy');
  assert.equal(dev('A2').reboot_sched, '');
  r = await call('PUT /devices/:id/reboot-schedule', { id: a }, { mode: 'weekly', time: '02:15', days: [0, 1], all: true });
  assert.equal(r.out.count, 2); assert.equal(r.out.label, '02:15 T2, CN');
  assert.equal(dev('A2').reboot_sched, '02:15|01');
  assert.equal((await call('PUT /devices/:id/reboot-schedule', { id: a }, { mode: 'weekly', time: '02:15', days: [] })).code, 400);
  assert.equal((await call('PUT /devices/:id/reboot-schedule', { id: a }, { mode: 'daily', time: '25:00' })).code, 400);
  assert.equal((await call('PUT /devices/:id/reboot-schedule', { id: 999 }, { mode: 'off' })).code, 404);
  r = await call('PUT /devices/:id/reboot-schedule', { id: b }, { mode: 'off' });
  assert.equal(r.out.sched, ''); assert.equal(dev('A2').reboot_sched, ''); assert.equal(dev('A1').reboot_sched, '02:15|01');
});
