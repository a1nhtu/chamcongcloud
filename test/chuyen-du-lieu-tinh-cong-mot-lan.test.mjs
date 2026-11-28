// CHUYỂN DỮ LIỆU PHẦN MỀM CŨ: nhập HẾT lượt chấm rồi mới tính công MỘT lần (pretty 28/11/2026: 1,5 triệu lượt On39, mỗi đợt
// 2.000 lượt lại tính công ngay → chạy hàng giờ, máy chủ trả lời 13–27 giây). ingestAttlog({ collect }) chỉ gom ngày cần tính.
// Chạy: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-tinh-cong-mot-lan-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, S, L;
const fake = (tables) => (name) => tables[name] || [];
const T = (s) => new Date(s + 'Z');

before(async () => {
  const D = await import('../server/db.js');
  db = D.db; D.initSchema();
  S = await import('../server/device-sync.js');
  L = await import('../server/legacy-import.js');
});

test('ingestAttlog có collect: lưu lượt nhưng KHÔNG tính công, trả về ngày cần tính (cả hôm trước — ca đêm)', () => {
  const id = db.prepare("INSERT INTO employees(code, username, password_hash, full_name, device_pin, active) VALUES('C1','c1','x','Nguyen Van A','501',1)").run().lastInsertRowid;
  const dirty = new Set();
  S.ingestAttlog('SN_CU', '501\t2025-03-04 07:58:00\t0\t1\n501\t2025-03-04 17:02:00\t1\t1', { ask: () => {}, collect: dirty });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM device_punches WHERE pin=?').get('501').c, 2);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM attendance WHERE employee_id=?').get(id).c, 0, 'chưa tính công');
  assert.ok(dirty.has(`${id}|2025-03-04`) && dirty.has(`${id}|2025-03-03`));
  S.rebuildDays(dirty);
  const a = db.prepare("SELECT check_in_at, check_out_at FROM attendance WHERE employee_id=? AND work_date='2025-03-04'").get(id);
  assert.ok(a?.check_in_at && a?.check_out_at, 'tính 1 lần sau cùng ra đủ vào – ra');
});

test('chuyển On39: NV chấm 2 máy (lượt nạp theo từng máy) vẫn ra đúng vào – ra sau khi tính công 1 lần ở cuối', async () => {
  const ON39 = {
    Company: [{ CompName: 'CTY THU' }],
    RelationDept: [{ ID: 1, Description: 'CTY THU', RelationID: 0, DeptCode: 'root' }, { ID: 2, Description: 'Xưởng', RelationID: 1, DeptCode: 'X' }],
    UserInfo: [{ UserEnrollNumber: 77, UserFullCode: '00077', UserFullName: 'Tran Thi B', UserIDD: 2, UserBirthDay: '' }],
    Machines: [{ MachineID: 1, MachineName: 'Cổng', SerialNumber: 'SN_A' }, { MachineID: 2, MachineName: 'Xưởng', SerialNumber: 'SN_B' }],
    CheckInOut: [
      { UserEnrollNumber: 77, TimeStr: T('2025-05-06T07:55:00'), OriginType: 'I', MachineNo: 1 },
      { UserEnrollNumber: 77, TimeStr: T('2025-05-06T17:10:00'), OriginType: 'O', MachineNo: 2 },
      { UserEnrollNumber: 77, TimeStr: T('2025-05-07T07:50:00'), OriginType: 'I', MachineNo: 2 },
      { UserEnrollNumber: 77, TimeStr: T('2025-05-07T17:05:00'), OriginType: 'O', MachineNo: 1 },
    ],
  };
  const r = await L.applyLegacy(L.normalizeOn39(fake(ON39)), {});
  assert.equal(r.punches_new, 4);
  const id = db.prepare("SELECT id FROM employees WHERE device_pin='77'").get().id;
  const rows = db.prepare("SELECT work_date, check_in_at, check_out_at FROM attendance WHERE employee_id=? AND work_date IN ('2025-05-06','2025-05-07') ORDER BY work_date").all(id);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((x) => x.check_in_at && x.check_out_at), 'cả 2 ngày đủ vào – ra dù vào ở máy này, ra ở máy kia');
  const again = await L.applyLegacy(L.normalizeOn39(fake(ON39)), {});
  assert.equal(again.punches_new, 0, 'nhập lại không nhân đôi');
});

test('⏹ Dừng giữa lúc nhập lượt chấm: phần đã nhập giữ nguyên, ngày chưa tính công được ghi nhớ → chuyển lại tính bù', async () => {
  const ON39 = {
    Company: [{ CompName: 'CTY DUNG' }],
    RelationDept: [{ ID: 1, Description: 'CTY DUNG', RelationID: 0, DeptCode: 'root' }],
    UserInfo: [{ UserEnrollNumber: 88, UserFullCode: '00088', UserFullName: 'Le Van C', UserIDD: 1, UserBirthDay: '' }],
    Machines: [{ MachineID: 1, MachineName: 'Cổng', SerialNumber: 'SN_D' }],
    CheckInOut: [
      { UserEnrollNumber: 88, TimeStr: T('2025-08-11T07:58:00'), OriginType: 'I', MachineNo: 1 },
      { UserEnrollNumber: 88, TimeStr: T('2025-08-11T17:01:00'), OriginType: 'O', MachineNo: 1 },
    ],
  };
  let calls = 0;   // lần hỏi 1: sau bước NV · lần 2: sau đợt lượt chấm đầu → dừng lúc đã nhập lượt, chưa tính công
  const r = await L.applyLegacy(L.normalizeOn39(fake(ON39)), {}, () => {}, () => ++calls >= 2);
  assert.equal(r.stopped, true);
  const id = db.prepare("SELECT id FROM employees WHERE device_pin='88'").get()?.id;
  assert.ok(id, 'NV đã tạo trước khi dừng vẫn còn');
  const day = () => db.prepare("SELECT check_in_at, check_out_at FROM attendance WHERE employee_id=? AND work_date='2025-08-11'").get(id);
  const punches = db.prepare("SELECT COUNT(*) c FROM device_punches WHERE pin='88'").get().c;
  assert.equal(punches, 2, 'lượt đã nhập trước khi dừng giữ nguyên');
  assert.ok(!day()?.check_out_at, 'dừng trước bước tính công');
  assert.ok(L.legacyPendingCount() >= 1, 'ghi nhớ NV còn ngày chờ tính');
  const r2 = await L.applyLegacy(L.normalizeOn39(fake(ON39)), {});
  assert.ok(!r2.stopped);
  assert.ok(day()?.check_in_at && day()?.check_out_at, 'chuyển lại: lượt đã có bỏ qua nhưng ngày chờ vẫn được tính công');
  assert.equal(L.legacyPendingCount(), 0, 'xong thì xoá ghi nhớ');
});
