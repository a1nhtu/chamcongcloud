// Test PHÂN HỆ NHÂN SỰ: quy tắc hợp đồng theo BLLĐ 2019 (hàm thuần, server/hr-rules.js) + áp dụng quyết định
// thuyên chuyển / nghỉ việc và điều kiện "NV có đi làm trong kỳ" cho bảng công / báo cáo / lương (CSDL tạm).
// node --test chạy mỗi file test trong tiến trình RIÊNG → set DB_PATH tạm ở đây không đụng DB khác.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import {
  contractEndDate, contractStatus, currentContract, checkContract, noticeWarning, cleanProfile, decisionDue, expiredTooLong,
} from '../server/hr-rules.js';

const DBP = join(tmpdir(), `dgp-hr-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, initSchema, EMP_IN_PERIOD, applyDueDecisions, loadContracts;
before(async () => {
  ({ db, initSchema, EMP_IN_PERIOD } = await import('../server/db.js'));
  ({ applyDueDecisions, loadContracts } = await import('../server/hr.js'));
  initSchema();
});

// ===================== ngày hết hạn hợp đồng =====================
test('ngày hết hạn = ngày bắt đầu + n tháng − 1 ngày; cuối tháng thì kẹp về ngày cuối', () => {
  assert.equal(contractEndDate('2026-01-15', 12), '2027-01-14');
  assert.equal(contractEndDate('2026-01-01', 1), '2026-01-31');
  assert.equal(contractEndDate('2026-03-01', 36), '2029-02-28');
  assert.equal(contractEndDate('2026-01-31', 1), '2026-02-28');
  assert.equal(contractEndDate('2026-01-15', 0), '');
});

// ===================== trạng thái hợp đồng =====================
test('trạng thái HĐ: còn hiệu lực / sắp hết hạn / hết hạn / đã tái ký / chấm dứt / chưa hiệu lực', () => {
  const c = { start_date: '2026-01-01', end_date: '2026-12-31', terminated_date: '' };
  assert.equal(contractStatus(c, '2026-06-01', 30), 'hieu_luc');
  assert.equal(contractStatus(c, '2026-12-05', 30), 'sap_het_han');
  assert.equal(contractStatus(c, '2027-01-05', 30), 'het_han');
  assert.equal(contractStatus(c, '2027-01-05', 30, true), 'da_tai_ky');
  assert.equal(contractStatus({ ...c, terminated_date: '2026-05-01' }, '2026-06-01', 30), 'cham_dut');
  assert.equal(contractStatus({ ...c, terminated_date: '2026-07-01' }, '2026-06-01', 30), 'hieu_luc');   // chấm dứt trong tương lai
  assert.equal(contractStatus(c, '2025-12-01', 30), 'chua_hieu_luc');
  assert.equal(contractStatus({ start_date: '2026-01-01', end_date: '', terminated_date: '' }, '2030-01-01', 30), 'hieu_luc');
});

test('HĐ hiện tại = HĐ mới nhất đang hiệu lực tại ngày xét', () => {
  const list = [
    { id: 1, start_date: '2026-01-01', end_date: '2026-03-31', terminated_date: '' },
    { id: 2, start_date: '2026-04-01', end_date: '2027-03-31', terminated_date: '' },
    { id: 3, start_date: '2027-04-01', end_date: '', terminated_date: '' },
  ];
  assert.equal(currentContract(list, '2026-02-01').id, 1);
  assert.equal(currentContract(list, '2026-10-01').id, 2);
  assert.equal(currentContract(list, '2028-01-01').id, 3);
  assert.equal(currentContract(list, '2025-01-01'), null);
});

// ===================== kiểm tra theo BLLĐ 2019 =====================
test('HĐ xác định thời hạn quá 36 tháng → chặn (khoản 1 Điều 20)', () => {
  const r = checkContract({ ctype: 'xac_dinh', start_date: '2026-01-01', end_date: contractEndDate('2026-01-01', 48) });
  assert.ok(r.errors.some((e) => e.includes('36 tháng')));
  assert.equal(checkContract({ ctype: 'xac_dinh', start_date: '2026-01-01', end_date: contractEndDate('2026-01-01', 36) }).errors.length, 0);
});

test('HĐ xác định thời hạn lần thứ 3 → cảnh báo phải ký không xác định thời hạn (điểm c khoản 2 Điều 20)', () => {
  const hist = [
    { ctype: 'xac_dinh', start_date: '2024-01-01', end_date: '2024-12-31' },
    { ctype: 'xac_dinh', start_date: '2025-01-01', end_date: '2025-12-31' },
  ];
  const r = checkContract({ ctype: 'xac_dinh', start_date: '2026-01-01', end_date: '2026-12-31' }, hist);
  assert.equal(r.errors.length, 0);
  assert.ok(r.warnings.some((w) => w.includes('Điều 20')));
  // lần thứ 2 thì chưa cảnh báo
  assert.equal(checkContract({ ctype: 'xac_dinh', start_date: '2025-01-01', end_date: '2025-12-31' }, hist.slice(0, 1)).warnings.length, 0);
});

test('Thử việc: > 60 ngày cảnh báo, > 180 ngày chặn (Điều 25); thử việc 2 lần cùng công việc → cảnh báo', () => {
  assert.ok(checkContract({ ctype: 'thu_viec', start_date: '2026-01-01', end_date: '2026-03-31' }).warnings.some((w) => w.includes('Điều 25')));
  assert.ok(checkContract({ ctype: 'thu_viec', start_date: '2026-01-01', end_date: '2026-08-31' }).errors.some((e) => e.includes('180')));
  assert.equal(checkContract({ ctype: 'thu_viec', start_date: '2026-01-01', end_date: '2026-02-15' }).warnings.length, 0);
  const again = checkContract({ ctype: 'thu_viec', start_date: '2026-05-01', end_date: '2026-05-30', position: 'Kế toán' },
    [{ ctype: 'thu_viec', start_date: '2026-01-01', end_date: '2026-01-30', position: 'Kế toán' }]);
  assert.ok(again.warnings.some((w) => w.includes('1 lần')));
});

test('HĐ đầu tiên ký SAU ngày bắt đầu làm → cảnh báo (khoản 2 Điều 13); có HĐ trước (tái ký) thì không', () => {
  const c = { ctype: 'thu_viec', sign_date: '2026-07-05', start_date: '2026-07-01', end_date: '2026-07-30' };
  assert.ok(checkContract(c).warnings.some((w) => w.includes('Điều 13')));
  assert.ok(!checkContract({ ...c, sign_date: '2026-06-30' }).warnings.some((w) => w.includes('Điều 13')));
  assert.ok(!checkContract(c, [{ ctype: 'thu_viec', start_date: '2026-01-01', end_date: '2026-01-30', position: 'x' }]).warnings.some((w) => w.includes('Điều 13')));
});

test('HĐ không xác định thời hạn không có ngày hết hạn; HĐ xác định thời hạn bắt buộc có', () => {
  assert.ok(checkContract({ ctype: 'khong_xac_dinh', start_date: '2026-01-01', end_date: '2027-01-01' }).errors.length);
  assert.equal(checkContract({ ctype: 'khong_xac_dinh', start_date: '2026-01-01', end_date: '' }).errors.length, 0);
  assert.ok(checkContract({ ctype: 'xac_dinh', start_date: '2026-01-01', end_date: '' }).errors.length);
  assert.ok(checkContract({ ctype: 'xac_dinh', start_date: '2026-05-01', end_date: '2026-04-01' }).errors.length);
});

test('HĐ hết hạn quá 30 ngày mà NV vẫn làm → cảnh báo đã thành HĐ không xác định thời hạn (điểm b khoản 2 Điều 20)', () => {
  const c = { ctype: 'xac_dinh', start_date: '2025-01-01', end_date: '2025-12-31', terminated_date: '' };
  assert.equal(expiredTooLong(c, '2026-01-20', false, true), false);
  assert.equal(expiredTooLong(c, '2026-02-15', false, true), true);
  assert.equal(expiredTooLong(c, '2026-02-15', true, true), false);    // đã tái ký
  assert.equal(expiredTooLong(c, '2026-02-15', false, false), false);  // đã nghỉ việc
  const late = checkContract({ ctype: 'xac_dinh', start_date: '2026-03-01', end_date: '2027-02-28' }, [c]);
  assert.ok(late.warnings.some((w) => w.includes('điểm b khoản 2 Điều 20')));
});

test('Báo trước khi NV xin nghỉ: 45 ngày (không thời hạn), 30 ngày (12–36 tháng), 3 ngày (< 12 tháng) — khoản 1 Điều 35', () => {
  const kxd = { ctype: 'khong_xac_dinh', start_date: '2020-01-01', end_date: '' };
  const xd12 = { ctype: 'xac_dinh', start_date: '2026-01-01', end_date: '2026-12-31' };
  const xd6 = { ctype: 'xac_dinh', start_date: '2026-01-01', end_date: '2026-06-30' };
  assert.ok(noticeWarning('tu_nguyen', kxd, '2026-05-01', '2026-06-01').includes('45 ngày'));
  assert.equal(noticeWarning('tu_nguyen', kxd, '2026-05-01', '2026-06-20'), '');
  assert.ok(noticeWarning('tu_nguyen', xd12, '2026-05-01', '2026-05-20').includes('30 ngày'));
  assert.equal(noticeWarning('tu_nguyen', xd6, '2026-05-01', '2026-05-05'), '');
  assert.equal(noticeWarning('thoa_thuan', kxd, '2026-05-01', '2026-05-02'), '');   // thoả thuận: không cần báo trước
});

test('cleanProfile: chỉ nhận trường hợp lệ, ngày sai định dạng thì bỏ trống', () => {
  const p = cleanProfile({ gender: 'Nữ', birth_date: '12/04/1995', id_number: ' 036195000999 ', hacker: 'x', password_hash: 'y' });
  assert.deepEqual(p, { gender: 'Nữ', birth_date: '', id_number: '036195000999' });
  assert.equal(decisionDue({ status: 'pending', effective_date: '2026-10-15' }, '2026-10-15'), true);
  assert.equal(decisionDue({ status: 'pending', effective_date: '2026-10-16' }, '2026-10-15'), false);
  assert.equal(decisionDue({ status: 'cancelled', effective_date: '2026-10-01' }, '2026-10-15'), false);
});

// ===================== CSDL: áp dụng quyết định + bảng công tháng cuối =====================
function addEmp(code, extra = {}) {
  const info = db.prepare(`INSERT INTO employees (code, full_name, department, position, role, username, password_hash, active)
    VALUES (?, ?, ?, ?, 'employee', ?, 'x', ?)`).run(code, 'NV ' + code, extra.department || 'Sản xuất', extra.position || 'Công nhân', code.toLowerCase(), extra.active ?? 1);
  return Number(info.lastInsertRowid);
}

test('Quyết định tới ngày hiệu lực → tự đổi bộ phận / chức danh; chưa tới ngày → giữ nguyên', () => {
  const a = addEmp('HRT1'), b = addEmp('HRT2');
  const ins = db.prepare(`INSERT INTO hr_decisions (employee_id, kind, effective_date, to_department, to_position) VALUES (?, 'transfer', ?, ?, ?)`);
  ins.run(a, '2026-10-01', 'Kho', 'Thủ kho');
  ins.run(b, '2026-11-01', 'Kho', '');
  applyDueDecisions('2026-10-15');
  const ea = db.prepare('SELECT department, position FROM employees WHERE id = ?').get(a);
  assert.deepEqual({ ...ea }, { department: 'Kho', position: 'Thủ kho' });
  assert.equal(db.prepare('SELECT department FROM employees WHERE id = ?').get(b).department, 'Sản xuất');
  assert.ok(db.prepare("SELECT 1 FROM departments WHERE name = 'Kho'").get(), 'bộ phận mới tự tạo');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM hr_decisions WHERE status = 'pending'").get().n, 1);
});

test('Nghỉ việc → khoá tài khoản, ghi ngày nghỉ, chấm dứt HĐ còn hiệu lực (HĐ đã hết hạn giữ nguyên)', () => {
  const e = addEmp('HRT3');
  const insC = db.prepare(`INSERT INTO hr_contracts (employee_id, ctype, start_date, end_date) VALUES (?, ?, ?, ?)`);
  const old = Number(insC.run(e, 'xac_dinh', '2025-01-01', '2025-12-31').lastInsertRowid);
  const cur = Number(insC.run(e, 'xac_dinh', '2026-01-01', '2026-12-31').lastInsertRowid);
  const fut = Number(insC.run(e, 'khong_xac_dinh', '2027-01-01', '').lastInsertRowid);
  db.prepare(`INSERT INTO hr_decisions (employee_id, kind, sub_kind, effective_date, decision_no) VALUES (?, 'resign', 'tu_nguyen', '2026-10-12', 'QD9')`).run(e);
  applyDueDecisions('2026-10-15');
  const emp = db.prepare('SELECT active, leave_date FROM employees WHERE id = ?').get(e);
  assert.equal(emp.active, 0);
  assert.equal(emp.leave_date, '2026-10-12');
  const t = (id) => db.prepare('SELECT terminated_date FROM hr_contracts WHERE id = ?').get(id).terminated_date;
  assert.equal(t(old), '');
  assert.equal(t(cur), '2026-10-12');
  assert.equal(t(fut), '2027-01-01');   // HĐ ký trước cho giai đoạn sau ngày nghỉ: coi như không thực hiện
  const st = new Map(loadContracts([e]).map((c) => [c.id, c.status]));
  assert.equal(st.get(cur), 'cham_dut');
});

test('Bảng công / báo cáo / lương: NV nghỉ qua phân hệ Nhân sự vẫn có mặt các kỳ còn đi làm; NV khoá kiểu cũ loại như trước', () => {
  const q = db.prepare(`SELECT code FROM employees WHERE ${EMP_IN_PERIOD} AND code LIKE 'HRT%' ORDER BY code`);
  const codes = (from) => q.all(from).map((r) => r.code);
  addEmp('HRT4', { active: 0 });   // khoá bằng nút cũ (không có ngày nghỉ)
  assert.ok(codes('2026-10-01').includes('HRT3'), 'kỳ tháng 10 vẫn có người nghỉ ngày 12/10');
  assert.ok(codes('2026-09-01').includes('HRT3'));
  assert.ok(!codes('2026-11-01').includes('HRT3'), 'tháng 11 không còn');
  assert.ok(!codes('2026-10-12').includes('HRT3'), 'kỳ bắt đầu đúng ngày nghỉ: không còn đi làm');
  assert.ok(!codes('2026-10-01').includes('HRT4'), 'khoá kiểu cũ: như trước (không hiện)');
});

test('Chưa ai nghỉ qua phân hệ Nhân sự → điều kiện mới cho KẾT QUẢ Y HỆT điều kiện cũ (active = 1)', () => {
  const oldQ = db.prepare("SELECT id FROM employees WHERE active = 1 AND leave_date = '' ORDER BY id").all().map((r) => r.id);
  const newQ = db.prepare(`SELECT id FROM employees WHERE ${EMP_IN_PERIOD} AND leave_date = '' ORDER BY id`).all('2026-10-01').map((r) => r.id);
  assert.deepEqual(newQ, oldQ);
  // mọi NV cũ (cột leave_date mặc định rỗng) → không ai được thêm vào ngoài người active
  const extra = db.prepare(`SELECT COUNT(*) n FROM employees WHERE ${EMP_IN_PERIOD} AND active = 0 AND leave_date = ''`).get('2000-01-01').n;
  assert.equal(extra, 0);
});
