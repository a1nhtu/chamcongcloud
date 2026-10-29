// CHUYỂN DỮ LIỆU TỪ PHẦN MỀM CŨ — CHỌN BỘ PHẬN + FILE HỎNG 1 TRANG (Nhà hàng Gia Đình / Wise Eye V5.1, 29/10/2026):
// 1) Phần mềm cũ để NV đã nghỉ trong bộ phận "Nghỉ việc" (339 / 358 NV) → bỏ tick bộ phận đó / bỏ NV chưa có bộ phận
//    thì không tạo bộ phận, không lấy NV + lượt chấm của NV đó. Tick hết (mặc định) = như cũ.
// 2) File .mdb có 1 trang hỏng trong danh sách trang của bảng (Access cũng báo "Unrecognized database format") → trước báo lỗi
//    "Wrong page type" và không đọc được NV nào; giờ bỏ qua trang hỏng, đọc các trang còn lại. Chạy: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, readFileSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-legacy-chon-bp-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, L;
const T = (s) => new Date(s + 'Z');
const fake = (tables) => (name) => tables[name] || [];
const WISE = {
  RelationDept: [
    { ID: 1, Description: 'Nhà hàng', RelationID: 0, LevelID: 0 },
    { ID: 2, Description: 'Bếp', RelationID: 1, LevelID: 1 },
    { ID: 8, Description: 'Nghỉ việc', RelationID: 1, LevelID: 1 },
    { ID: 9, Description: 'Bar', RelationID: 1, LevelID: 1 },
  ],
  UserInfo: [
    { UserEnrollNumber: 18, UserFullCode: '00018', UserFullName: 'Nguyễn Minh Thu', UserIDD: 2 },
    { UserEnrollNumber: 1, UserFullCode: '00001', UserFullName: 'Khổng Thu Trang', UserIDD: 8 },
    { UserEnrollNumber: 3, UserFullCode: '00003', UserFullName: 'Lê Văn Ba', UserIDD: 8 },
    { UserEnrollNumber: 255, UserFullCode: '00255', UserFullName: '00255', UserIDD: 0 },
  ],
  Machines: [{ MachineID: 1, MachineName: 'Máy 1', SerialNumber: '' }],
  CheckInOut: [
    { UserEnrollNumber: 18, TimeStr: T('2026-10-20T07:30:00'), OriginType: 'I', MachineNo: 1 },
    { UserEnrollNumber: 1, TimeStr: T('2026-10-20T07:31:00'), OriginType: 'I', MachineNo: 1 },
    { UserEnrollNumber: 255, TimeStr: T('2026-10-20T07:32:00'), OriginType: 'I', MachineNo: 1 },
  ],
};

before(async () => {
  const D = await import('../server/db.js');
  db = D.db; D.initSchema();
  L = await import('../server/legacy-import.js');
});

test('Xem trước: từng bộ phận kèm số NV để chọn', () => {
  const s = L.summarize(L.normalizeOn39(fake(WISE)));
  assert.deepEqual(s.dept_list, [{ key: 'D2', name: 'Bếp', emps: 1 }, { key: 'D8', name: 'Nghỉ việc', emps: 2 }, { key: 'D9', name: 'Bar', emps: 0 }]);
  assert.equal(s.emps_no_dept, 1);
});

test('Không bỏ gì → dữ liệu y như cũ; bỏ "Nghỉ việc" + NV chưa có bộ phận → chỉ còn bộ phận / NV / lượt chấm của người còn làm', () => {
  const data = L.normalizeOn39(fake(WISE));
  assert.equal(L.filterLegacy(data, [], false), data);
  const f = L.filterLegacy(data, ['D8'], true);
  assert.deepEqual(f.depts.map((d) => d.name), ['Bếp', 'Bar']);
  assert.deepEqual(f.emps.map((e) => e.pin), ['18']);
  assert.deepEqual(f.punches.map((p) => p.pin), ['18']);
  assert.deepEqual(L.filterLegacy(data, ['D8'], false).emps.map((e) => e.pin).sort(), ['18', '255']);
});

test('Ghi vào Digiplus với bộ phận bỏ tick: không tạo bộ phận đó, không tạo NV đã nghỉ', async () => {
  const out = await L.applyLegacy(L.normalizeOn39(fake(WISE)), { punches: false, skip_depts: ['D8'], skip_no_dept: true });
  assert.equal(out.depts_created, 2);
  assert.equal(out.emps_created, 1);
  assert.deepEqual(db.prepare('SELECT name FROM departments ORDER BY name').all().map((d) => d.name), ['Bar', 'Bếp']);
  assert.deepEqual(db.prepare('SELECT device_pin, full_name, department FROM employees ORDER BY device_pin').all().map((e) => ({ ...e })),
    [{ device_pin: '18', full_name: 'Nguyễn Minh Thu', department: 'Bếp' }]);
});

test('File .mdb có 1 trang dữ liệu hỏng → bỏ qua trang đó, vẫn đọc các trang còn lại (trước: lỗi "Wrong page type")', async () => {
  const { default: MDBReader } = await import('../server/vendor/mdb-reader.mjs');
  const buf = Buffer.from(readFileSync(new URL('./fixtures/mdb-nhieu-trang.mdb', import.meta.url)));   // 120 NV giả, nhiều trang
  assert.equal(new MDBReader(buf).getTable('NhanVien').getData().length, 120);
  // Trang dữ liệu (loại 1) của bảng có nhiều trang nhất = NhanVien; làm hỏng trang đầu (loại trang 62 như file thật)
  const PS = 4096, own = new Map();
  for (let p = 1; p < buf.length / PS; p++) if (buf[p * PS] === 1) { const o = buf.readUInt32LE(p * PS + 4); own.set(o, [...(own.get(o) || []), p]); }
  const pages = [...own.values()].sort((a, b) => b.length - a.length)[0];
  assert.ok(pages.length >= 3, 'file mẫu phải có nhiều trang dữ liệu');
  buf[pages[0] * PS] = 62;
  const rows = new MDBReader(buf).getTable('NhanVien').getData();
  assert.ok(rows.length > 0 && rows.length < 120, `đọc được ${rows.length} dòng`);
  assert.ok(rows.some((r) => r.ID === 120), 'trang sau trang hỏng vẫn đọc được');
});

test('Wise Eye V5.1: cùng cấu trúc file với On39 → đọc được, tên hiện "Wise Eye V5.1"; chọn nhầm Ronald Jack thì báo đúng loại file', () => {
  const buf = readFileSync(new URL('./fixtures/wiseeye-mau.mdb', import.meta.url));   // file mẫu tên giả, đủ bảng UserInfo / RelationDept / CheckInOut
  const d = L.readLegacy(buf, '', 'we51');
  assert.equal(d.kind, 'we51');
  assert.equal(L.summarize(d).label, 'Wise Eye V5.1');
  assert.deepEqual(d.depts.map((x) => x.name), ['Bep', 'Nghi viec']);
  assert.equal(d.emps.length, 3);
  assert.equal(L.readLegacy(buf, '', 'on39').kind, 'on39');
  assert.throws(() => L.readLegacy(buf, '', 'rj'), /Wise Eye \(On39 \/ V5\.1\), không phải Ronald Jack Pro/);
});
