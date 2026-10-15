// PHÂN HỆ NHÂN SỰ — NHẮC HỢP ĐỒNG sắp hết hạn / hết thử việc bằng THÔNG BÁO ĐẨY cho người có quyền "Nhân sự"
// (tài khoản tổng + Admin + người được tích quyền). Bật/tắt bằng công tắc hr_remind_push (mặc định BẬT).
// Chạy 1 phút sau khi khởi động + mỗi 30 phút, chỉ gửi trong 8:00–20:00 giờ VN; mỗi lượt gộp thành 1 thông báo.
// Mốc nhắc + nội dung: hàm thuần reminderStage / reminderDigest (hr-rules.js).
import { db, getSetting } from './db.js';
import { vnParts } from './util.js';
import { loadContracts, warnDays, hrEnabled } from './hr.js';
import { reminderStage, reminderDigest } from './hr-rules.js';
import { notifyPerm } from './push.js';

export const remindEnabled = () => getSetting('hr_remind_push', '1') !== '0';

// HĐ cần nhắc ở lượt này. all = gồm cả các mốc đã gửi (nút "Gửi thử nhắc ngay")
export function dueReminders({ all = false } = {}) {
  const wd = warnDays();
  const leaving = new Map(db.prepare("SELECT employee_id, MIN(effective_date) d FROM hr_decisions WHERE kind = 'resign' AND status = 'pending' GROUP BY employee_id")
    .all().map((x) => [x.employee_id, x.d]));
  const sent = new Set(db.prepare('SELECT contract_id, stage, end_date FROM hr_reminders').all().map((x) => `${x.contract_id}|${x.stage}|${x.end_date}`));
  const items = [];
  for (const c of loadContracts()) {
    const stage = reminderStage(c, wd, { leavingOn: leaving.get(c.employee_id) || '' });
    if (!stage || (!all && sent.has(`${c.id}|${stage}|${c.end_date}`))) continue;
    items.push({ contract_id: c.id, stage, end_date: c.end_date, name: c.emp_name, code: c.emp_code, ctype: c.ctype, days_left: c.days_left });
  }
  return items.sort((a, b) => a.days_left - b.days_left);
}

// Gửi 1 lượt nhắc. Chỉ ghi "đã nhắc" khi có ít nhất 1 thiết bị nhận được (chưa ai bật thông báo → lượt sau gửi lại).
export async function runHrReminders({ force = false, now = new Date(), send = notifyPerm } = {}) {
  if (!force && (!remindEnabled() || !hrEnabled())) return { skipped: 'off' };
  const h = vnParts(now).h;
  if (!force && (h < 8 || h >= 20)) return { skipped: 'night' };
  const items = dueReminders({ all: force });
  if (!items.length && !force) return { items: 0 };
  const payload = items.length
    ? { ...reminderDigest(items), url: '/admin#hrcontract', tag: 'hr-remind' }
    : { title: '📄 Nhắc hợp đồng lao động', body: `Không có hợp đồng nào sắp hết hạn trong ${warnDays()} ngày tới — thông báo nhắc hoạt động tốt ✅`, url: '/admin#hrcontract', tag: 'hr-remind' };
  const r = await send('hr', payload);
  if (r.sent > 0 && items.length) {
    const ins = db.prepare('INSERT OR IGNORE INTO hr_reminders (contract_id, stage, end_date) VALUES (?, ?, ?)');
    db.exec('BEGIN');
    try { for (const i of items) ins.run(i.contract_id, i.stage, i.end_date); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  return { items: items.length, total: r.total, sent: r.sent, title: payload.title, body: payload.body };
}

let _busy = false;
export function startHrRemindScheduler() {
  const tick = async () => {
    if (_busy) return;
    _busy = true;
    try { await runHrReminders(); } catch (e) { console.error('[hr-remind]', e.message); } finally { _busy = false; }
  };
  setTimeout(tick, 60 * 1000).unref?.();
  setInterval(tick, 30 * 60 * 1000).unref?.();
}
