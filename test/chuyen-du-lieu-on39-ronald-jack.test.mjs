// CHUYỂN DỮ LIỆU TỪ WISE EYE ON39 / RONALD JACK PRO: đổi bảng Access về dạng chung (hàm thuần) + ghi vào DB tạm
// (bộ phận cha – con, NV mới / NV đã có, lượt chấm qua ingestAttlog, nhập lại lần 2 không nhân đôi). Chạy: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-legacy-import-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, L;
// Giả lập file Access: table(tên, cột) trả các dòng (mdb-reader đưa ngày giờ ra Date "UTC" = giờ ghi trong file)
const fake = (tables) => (name) => tables[name] || [];
const T = (s) => new Date(s + 'Z');

const ON39 = {
  Company: [{ CompName: 'CTY ELECOM' }],
  RelationDept: [
    { ID: 1, Description: 'Wise Eye On 39', RelationID: 0, DeptCode: 'root' },
    { ID: 2, Description: 'Văn phòng', RelationID: 1, DeptCode: 'VP' },
    { ID: 3, Description: 'Kế toán', RelationID: 2, DeptCode: 'KT' },
  ],
  Title: [{ IDT: 1, TitleName: 'Trưởng phòng' }],
  UserInfo: [
    { UserEnrollNumber: 1, UserFullCode: '00001', UserFullName: '00001', UserEnrollName: 'Hieu Tran', UserCardNo: '2719534779', UserHireDay: T('2024-07-25T00:00:00'), UserIDD: 0, UserBirthDay: '' },
    { UserEnrollNumber: 142, UserFullCode: '00142', UserFullName: 'Nguyễn Văn Đoàn', UserEnrollName: 'Doan', UserCardNo: '0000000000', UserHireDay: T('2024-07-25T00:00:00'), UserIDD: 3, UserIDTitle: 1, UserBirthDay: '05/03/1990', UserIDCard: '001090123456' },
    { UserEnrollNumber: 7, UserFullCode: '', UserFullName: 'Lê Thị Bảy', UserIDD: 2, UserBirthDay: '' },
  ],
  Machines: [{ MachineID: 1, MachineName: 'Máy 1', SerialNumber: 'A8LN205060021' }],
  CheckInOut: [
    { UserEnrollNumber: 142, TimeStr: T('2024-07-23T07:25:10'), OriginType: 'I', MachineNo: 1 },
    { UserEnrollNumber: 142, TimeStr: T('2024-07-23T17:05:00'), OriginType: 'O', MachineNo: 1 },
    { UserEnrollNumber: 1, TimeStr: T('2024-07-24T08:01:22'), OriginType: 'I', MachineNo: 1 },
    { UserEnrollNumber: 7, TimeStr: T('2024-06-01T07:30:00'), OriginType: 'I', MachineNo: 9 },
  ],
};

const RJ = {
  CONGTY: [{ TenCongTy: 'CÔNG TY' }],
  KHUVUC: [{ MaKhuVuc: 'KV00001', TenKhuVuc: 'dang Lam' }],
  PHONGBAN: [{ MaPhongBan: 'PB00001', MaKhuVuc: 'KV00001', TenPhongBan: 'Phong nhan su' }, { MaPhongBan: 'PB00002', MaKhuVuc: 'KV00001', TenPhongBan: 'Hanh Chinh' }],
  NHANVIEN: [
    { MaNhanVien: '00016', TenNhanVien: 'Ngoan', MaChamCong: 16, MaThe: '0000000000', NgayVaoLamViec: T('2026-10-09T00:00:00'), NgaySinh: T('2026-10-09T00:00:00'), CMND: '123456789123', MaPhongBan: 'PB00001' },
    { MaNhanVien: '00017', TenNhanVien: 'Lien', MaChamCong: 17, MaThe: '12345', NgayVaoLamViec: T('2026-10-01T00:00:00'), NgaySinh: T('1995-02-01T00:00:00'), NghiViecTamThoi: true },
  ],
  MAYCHAMCONG: [{ IDMCC: 1, TenMCC: 'Máy MCC00001', Serial: '5265212200015' }],
  CheckInOut: [
    { MaChamCong: 16, GioCham: T('2026-10-05T07:31:00'), KieuCham: '0', NguonCham: '1', MaSoMay: 1 },
    { MaChamCong: 16, GioCham: T('2026-10-05T17:02:00'), KieuCham: '1', NguonCham: '1', MaSoMay: 1 },
    { MaChamCong: 16, GioCham: T('2026-10-06T07:30:00'), KieuCham: '0', NguonCham: '10', MaSoMay: 1 },
    { MaChamCong: 16, GioCham: T('2026-10-06T17:00:00'), KieuCham: '1', NguonCham: '10', MaSoMay: 2 },
    { MaChamCong: 17, GioCham: T('2026-10-02T07:45:00'), KieuCham: '0', NguonCham: '1', MaSoMay: 1 },
  ],
};

before(async () => {
  const D = await import('../server/db.js');
  db = D.db; D.initSchema();
  L = await import('../server/legacy-import.js');
});

test('On39: bỏ gốc cây (tên công ty), bộ phận con giữ cha; tên NV lấy tên có chữ; thẻ 000… = chưa có thẻ; giờ chấm giữ nguyên giờ VN', () => {
  const d = L.normalizeOn39(fake(ON39));
  assert.equal(d.company, 'CTY ELECOM');
  assert.deepEqual(d.depts, [{ key: 'D2', name: 'Văn phòng', parent: null }, { key: 'D3', name: 'Kế toán', parent: 'D2' }]);
  const [a, b, c] = d.emps;
  assert.equal(a.name, 'Hieu Tran'); assert.equal(a.code, '00001'); assert.equal(a.pin, '1'); assert.equal(a.dept, null); assert.equal(a.card, '2719534779');
  assert.equal(b.name, 'Nguyễn Văn Đoàn'); assert.equal(b.dept, 'D3'); assert.equal(b.position, 'Trưởng phòng'); assert.equal(b.card, '');
  assert.equal(b.birth_date, '1990-03-05'); assert.equal(b.start_date, '2024-07-25'); assert.equal(b.id_number, '001090123456');
  assert.equal(c.code, '7');   // không có mã NV → dùng Số ID
  assert.deepEqual(d.punches[1], { pin: '142', time: '2024-07-23 17:05:00', status: 1, serial: 'A8LN205060021' });
  assert.equal(d.punches[3].serial, 'ON39_MAY9');   // máy không còn trong danh sách
});

test('Ronald Jack: 1 khu vực thì bỏ cấp khu vực; ngày sinh/CMND để sẵn bị bỏ; nghỉ việc tạm thời = khoá; THÊM GIỜ → máy ảo thêm tay', () => {
  const d = L.normalizeRj(fake(RJ));
  assert.deepEqual(d.depts.map((x) => [x.name, x.parent]), [['Phong nhan su', null], ['Hanh Chinh', null]]);
  const [n, l] = d.emps;
  assert.equal(n.dept, 'P' + 'PB00001'); assert.equal(n.birth_date, ''); assert.equal(n.id_number, ''); assert.equal(n.card, ''); assert.equal(n.active, true);
  assert.equal(l.birth_date, '1995-02-01'); assert.equal(l.card, '12345'); assert.equal(l.active, false); assert.equal(l.dept, null);
  assert.deepEqual(d.punches.slice(0, 4).map((p) => p.serial), ['5265212200015', '5265212200015', 'TAY_VAO', 'TAY_RA']);
  // nhiều khu vực → khu vực thành bộ phận cha
  const d2 = L.normalizeRj(fake({ ...RJ, KHUVUC: [...RJ.KHUVUC, { MaKhuVuc: 'KV2', TenKhuVuc: 'Xưởng' }] }));
  assert.deepEqual(d2.depts.map((x) => [x.name, x.parent]), [['dang Lam', null], ['Xưởng', null], ['Phong nhan su', 'KKV00001'], ['Hanh Chinh', 'KKV00001']]);
});

test('Ghi vào Digiplus: tạo bộ phận cha–con, NV mới gắn Số ID + bộ phận + thẻ + hồ sơ; NV nháp có sẵn được điền tên; lượt chấm thành công', async () => {
  // NV nháp máy tự tạo trước đó (Số ID 1) + 1 NV gõ tay trùng mã 00142 chưa có Số ID
  db.prepare("INSERT INTO employees(code, full_name, username, password_hash, device_pin, from_device) VALUES ('1','NV 1','nv1','x','1',1)").run();
  db.prepare("INSERT INTO employees(code, full_name, department, username, password_hash) VALUES ('00142','Đoàn','Bảo vệ','u142','x')").run();
  const data = L.normalizeOn39(fake(ON39));
  const sum = L.summarize(data);
  assert.equal(sum.emps, 3); assert.equal(sum.emps_existing, 2); assert.equal(sum.emps_new, 1);
  assert.equal(sum.first_date, '2024-06-01'); assert.equal(sum.last_date, '2024-07-24');
  const r = await L.applyLegacy(data, {});
  assert.equal(r.depts_created, 2); assert.equal(r.emps_created, 1); assert.equal(r.emps_linked, 1);
  const kt = db.prepare("SELECT d.name, p.name parent FROM departments d LEFT JOIN departments p ON p.id=d.parent_id WHERE d.name='Kế toán'").get();
  assert.equal(kt.parent, 'Văn phòng');
  const e1 = db.prepare("SELECT * FROM employees WHERE device_pin='1'").get();
  assert.equal(e1.full_name, 'Hieu Tran');   // nháp → điền tên thật
  const e142 = db.prepare("SELECT * FROM employees WHERE code='00142'").get();
  assert.equal(e142.device_pin, '142');       // gắn Số ID theo mã NV
  assert.equal(e142.full_name, 'Đoàn');       // không ghi đè thông tin đã có
  assert.equal(e142.department, 'Bảo vệ');
  assert.equal(e142.position, 'Trưởng phòng');   // ô trống thì điền
  assert.equal(db.prepare('SELECT birth_date FROM hr_profiles WHERE employee_id=?').get(e142.id).birth_date, '1990-03-05');
  const e7 = db.prepare("SELECT * FROM employees WHERE device_pin='7'").get();
  assert.equal(e7.full_name, 'Lê Thị Bảy'); assert.equal(e7.department, 'Văn phòng');
  assert.equal(db.prepare("SELECT card FROM device_users WHERE pin='1'").get().card, '2719534779');
  assert.equal(r.punches_new, 4);
  const att = db.prepare("SELECT * FROM attendance WHERE employee_id=? AND work_date='2024-07-23'").get(e142.id);
  assert.ok(att && att.check_in_at && att.check_out_at, 'ngày 23/07 có giờ vào + ra');
  assert.equal(new Date(att.check_in_at).toISOString(), '2024-07-23T00:25:10.000Z');   // 07:25:10 giờ VN
});

test('Nhập lại lần 2: không nhân đôi bộ phận / NV / lượt chấm; chọn ghi đè thì cập nhật thông tin NV có sẵn', async () => {
  const nEmp = db.prepare('SELECT COUNT(*) c FROM employees').get().c;
  const r = await L.applyLegacy(L.normalizeOn39(fake(ON39)), { overwrite: true });
  assert.equal(r.depts_created, 0); assert.equal(r.emps_created, 0); assert.equal(r.punches_new, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM employees').get().c, nEmp);
  const e142 = db.prepare("SELECT * FROM employees WHERE code='00142'").get();
  assert.equal(e142.full_name, 'Nguyễn Văn Đoàn'); assert.equal(e142.department, 'Kế toán');
});

test('Ronald Jack: lọc theo khoảng ngày; NV nghỉ việc tạm thời tạo ở trạng thái khoá; chỉ chọn lượt chấm thì không tạo NV', async () => {
  const data = L.normalizeRj(fake(RJ));
  const r0 = await L.applyLegacy(data, { depts: false, emps: false, punches: true, from: '2026-10-06', to: '2026-10-06' });
  assert.equal(r0.punches_read, 2); assert.equal(r0.emps_created, 0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM device_punches WHERE pin='16' AND employee_id IS NULL").get().c, 2);   // giữ chờ NV
  const r = await L.applyLegacy(data, {});
  assert.equal(r.emps_created, 2); assert.equal(r.punches_new, 3);
  const n = db.prepare("SELECT * FROM employees WHERE device_pin='16'").get();
  assert.equal(n.department, 'Phong nhan su'); assert.equal(n.start_date, '2026-10-09');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM device_punches WHERE pin='16' AND employee_id=?").get(n.id).c, 4);   // lượt chờ đã gắn NV
  const l = db.prepare("SELECT id, active FROM employees WHERE device_pin='17'").get();
  assert.equal(l.active, 0);
  assert.equal(db.prepare("SELECT employee_id FROM device_punches WHERE pin='17'").get().employee_id, l.id);   // NV đã nghỉ vẫn nhận lượt chấm cũ
  const tay = db.prepare("SELECT serial FROM device_punches WHERE pin='16' AND work_date='2026-10-06' ORDER BY punch_at").all().map((x) => x.serial);
  assert.deepEqual(tay, ['TAY_VAO', 'TAY_RA']);
});

test('File không phải On39 / Ronald Jack → báo lỗi dễ hiểu', () => {
  assert.throws(() => L.readLegacy(Buffer.alloc(8192)), /Không đọc được file Access/);
});
