// Test NHẮC HỢP ĐỒNG sắp hết hạn / hết thử việc qua thông báo đẩy (server/hr-remind.js + reminderStage/reminderDigest):
// chọn đúng HĐ cần nhắc, mỗi mốc chỉ nhắc 1 lần, đổi ngày hết hạn thì nhắc lại, chỉ gửi 8:00–20:00, công tắc tắt thì thôi,
// và chỉ gửi cho người có quyền Nhân sự (pickPermSubs). CSDL tạm (node --test chạy mỗi file trong tiến trình riêng).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { reminderStage, reminderDigest } from '../server/hr-rules.js';

const DBP = join(tmpdir(), `dgp-hr-remind-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, initSchema, setSetting, runHrReminders, pickPermSubs, hrToday, addDays;
before(async () => {
  ({ db, initSchema, setSetting } = await import('../server/db.js'));
  initSchema();
  setSetting('hr_enabled', '1');   // phân hệ Nhân sự mặc định TẮT — các bài nhắc dưới đây cần bật
  ({ runHrReminders } = await import('../server/hr-remind.js'));
  ({ pickPermSubs } = await import('../server/push.js'));
  ({ hrToday } = await import('../server/hr.js'));
  ({ addDays } = await import('../server/hr-rules.js'));
});

const AT_10H = new Date(Date.UTC(2026, 9, 15, 3, 0));   // 10:00 giờ VN
const AT_22H = new Date(Date.UTC(2026, 9, 15, 15, 0));  // 22:00 giờ VN
function addEmp(code, active = 1) {
  return Number(db.prepare(`INSERT INTO employees (code, full_name, role, username, password_hash, active) VALUES (?, ?, 'employee', ?, 'x', ?)`)
    .run(code, 'NV ' + code, code.toLowerCase(), active).lastInsertRowid);
}
function addContract(emp, ctype, startOff, endOff, extra = {}) {
  const t = hrToday();
  return Number(db.prepare(`INSERT INTO hr_contracts (employee_id, contract_no, ctype, start_date, end_date, parent_id) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(emp, extra.no || '', ctype, addDays(t, startOff), endOff == null ? '' : addDays(t, endOff), extra.parent || null).lastInsertRowid);
}
function fakeSend(sent = 1) {
  const calls = [];
  const fn = async (perm, payload) => { calls.push({ perm, payload }); return { total: 1, sent }; };
  fn.calls = calls;
  return fn;
}

test('mốc nhắc (hàm thuần): vào ngưỡng / còn ≤ 7 ngày / đã hết hạn 7 ngày đầu; bỏ qua tái ký, chấm dứt, NV nghỉ', () => {
  const c = (o) => ({ end_date: '2026-11-30', terminated_date: '', emp_active: 1, status: 'sap_het_han', days_left: 20, ...o });
  assert.equal(reminderStage(c({}), 30), 'warn');
  assert.equal(reminderStage(c({ days_left: 7 }), 30), 'd7');
  assert.equal(reminderStage(c({ days_left: 0 }), 30), 'd7');
  assert.equal(reminderStage(c({ days_left: 5 }), 5), 'warn');           // ngưỡng ≤ 7 ngày: chỉ 1 mốc
  assert.equal(reminderStage(c({ days_left: 45, status: 'hieu_luc' }), 30), null);
  assert.equal(reminderStage(c({ days_left: -3, status: 'het_han' }), 30), 'expired');
  assert.equal(reminderStage(c({ days_left: -8, status: 'het_han' }), 30), null);
  assert.equal(reminderStage(c({ status: 'da_tai_ky' }), 30), null);
  assert.equal(reminderStage(c({ terminated_date: '2026-12-01' }), 30), null);
  assert.equal(reminderStage(c({ emp_active: 0 }), 30), null);
  assert.equal(reminderStage(c({ end_date: '', days_left: null }), 30), null);
  assert.equal(reminderStage(c({}), 30, { leavingOn: '2026-12-01' }), null);   // nghỉ ngay sau ngày hết hạn
  assert.equal(reminderStage(c({}), 30, { leavingOn: '2027-03-01' }), 'warn');
});

test('nội dung thông báo gộp: 1 HĐ / nhiều HĐ, phân biệt hết thử việc', () => {
  const one = reminderDigest([{ name: 'Bình', code: 'NV1', ctype: 'thu_viec', days_left: 5, end_date: '2026-10-20' }]);
  assert.equal(one.title, '⏳ Sắp hết thử việc');
  assert.ok(one.body.startsWith('Bình (NV1): hết thử việc còn 5 ngày — 20/10/2026'));
  const many = reminderDigest([
    { name: 'A', code: '1', ctype: 'xac_dinh', days_left: -2, end_date: '' }, { name: 'B', code: '2', ctype: 'thu_viec', days_left: 0, end_date: '' },
    { name: 'C', code: '3', ctype: 'xac_dinh', days_left: 9 }, { name: 'D', code: '4', ctype: 'xac_dinh', days_left: 10 }, { name: 'E', code: '5', ctype: 'xac_dinh', days_left: 11 },
  ]);
  assert.equal(many.title, '📄 5 hợp đồng cần xử lý (1 hết thử việc)');
  assert.ok(many.body.includes('A (1): HĐ hết hạn đã quá 2 ngày') && many.body.includes('B (2): hết thử việc hôm nay'));
  assert.ok(many.body.endsWith('… và 1 người khác'));
});

test('chạy nhắc trên CSDL: chọn đúng HĐ, gộp 1 thông báo, mỗi mốc 1 lần, đổi ngày hết hạn thì nhắc lại', async () => {
  setSetting('hr_contract_warn_days', '30');
  const e1 = addEmp('R1'), e2 = addEmp('R2'), e3 = addEmp('R3'), e4 = addEmp('R4'), e5 = addEmp('R5'), e6 = addEmp('R6'), e7 = addEmp('R7', 0), e8 = addEmp('R8');
  const c1 = addContract(e1, 'xac_dinh', -340, 20);            // còn 20 ngày → warn
  addContract(e2, 'thu_viec', -50, 5);                          // thử việc còn 5 ngày → d7
  addContract(e3, 'xac_dinh', -300, 60);                        // còn 60 ngày → chưa nhắc
  addContract(e4, 'xac_dinh', -365, -3);                        // hết hạn 3 ngày chưa tái ký → expired
  const c5 = addContract(e5, 'xac_dinh', -355, 10);             // còn 10 ngày nhưng ĐÃ tái ký → không nhắc
  addContract(e5, 'khong_xac_dinh', 11, null, { parent: c5 });
  addContract(e6, 'xac_dinh', -355, 10);                        // có QĐ nghỉ việc trước ngày hết hạn → không nhắc
  db.prepare("INSERT INTO hr_decisions (employee_id, kind, effective_date) VALUES (?, 'resign', ?)").run(e6, addDays(hrToday(), 5));
  addContract(e7, 'xac_dinh', -355, 10);                        // NV đã nghỉ (khoá) → không nhắc
  addContract(e8, 'xac_dinh', -400, -20);                       // hết hạn đã lâu → không nhắc nữa

  const s1 = fakeSend();
  const r1 = await runHrReminders({ now: AT_10H, send: s1 });
  assert.equal(r1.items, 3);
  assert.equal(s1.calls.length, 1);
  assert.equal(s1.calls[0].perm, 'hr');
  const p = s1.calls[0].payload;
  assert.equal(p.title, '📄 3 hợp đồng cần xử lý (1 hết thử việc)');
  assert.equal(p.url, '/admin#hrcontract');
  const lines = p.body.split('\n');
  assert.ok(lines[0].startsWith('NV R4 (R4): HĐ hết hạn đã quá 3 ngày'));   // gấp nhất lên đầu
  assert.ok(lines[1].startsWith('NV R2 (R2): hết thử việc còn 5 ngày'));
  assert.ok(lines[2].startsWith('NV R1 (R1): HĐ hết hạn còn 20 ngày'));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM hr_reminders').get().n, 3);

  // lượt sau: không có gì mới → không gửi
  const s2 = fakeSend();
  assert.deepEqual(await runHrReminders({ now: AT_10H, send: s2 }), { items: 0 });
  assert.equal(s2.calls.length, 0);

  // gia hạn ngày hết hạn (vẫn trong ngưỡng) → nhắc lại HĐ đó
  db.prepare('UPDATE hr_contracts SET end_date = ? WHERE id = ?').run(addDays(hrToday(), 25), c1);
  const s3 = fakeSend();
  const r3 = await runHrReminders({ now: AT_10H, send: s3 });
  assert.equal(r3.items, 1);
  assert.equal(s3.calls[0].payload.title, '📄 Hợp đồng sắp hết hạn');

  // nút "Gửi thử nhắc ngay" (force) → gồm cả HĐ đã nhắc
  const s4 = fakeSend();
  assert.equal((await runHrReminders({ force: true, now: AT_22H, send: s4 })).items, 3);
});

test('chưa ai nhận được (chưa bật thông báo) → không ghi "đã nhắc", lượt sau gửi lại; ngoài 8:00–20:00 / công tắc tắt → không gửi', async () => {
  const e = addEmp('R9');
  addContract(e, 'thu_viec', -40, 3);
  const s0 = fakeSend(0);
  assert.equal((await runHrReminders({ now: AT_10H, send: s0 })).items, 1);
  const s1 = fakeSend();
  assert.equal((await runHrReminders({ now: AT_22H, send: s1 })).skipped, 'night');
  assert.equal(s1.calls.length, 0);
  setSetting('hr_remind_push', '0');
  assert.equal((await runHrReminders({ now: AT_10H, send: s1 })).skipped, 'off');
  assert.equal(s1.calls.length, 0);
  setSetting('hr_remind_push', '1');
  assert.equal((await runHrReminders({ now: AT_10H, send: s1 })).items, 1);   // gửi lại vì lần trước chưa ai nhận
  assert.equal((await runHrReminders({ now: AT_10H, send: s1 })).items, 0);
});

test('người nhận: tài khoản tổng + Admin + người được tích quyền Nhân sự; không gửi quản lý thường, tài khoản kiểm tra, NV đã nghỉ', () => {
  const rows = [
    { endpoint: 'master', employee_id: null },
    { endpoint: 'admin', employee_id: 1, active: 1, role: 'admin', permissions: null, audit_only: 0 },
    { endpoint: 'hr-manager', employee_id: 2, active: 1, role: 'manager', permissions: '["hr","reports"]', audit_only: 0 },
    { endpoint: 'manager-default', employee_id: 3, active: 1, role: 'manager', permissions: null, audit_only: 0 },
    { endpoint: 'inspector', employee_id: 4, active: 1, role: 'manager', permissions: '["hr"]', audit_only: 1 },
    { endpoint: 'left-admin', employee_id: 5, active: 0, role: 'admin', permissions: null, audit_only: 0 },
    { endpoint: 'employee', employee_id: 6, active: 1, role: 'employee', permissions: null, audit_only: 0 },
  ];
  assert.deepEqual(pickPermSubs(rows, 'hr').map((r) => r.endpoint), ['master', 'admin', 'hr-manager']);
});
