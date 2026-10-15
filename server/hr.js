// PHÂN HỆ NHÂN SỰ — phần dùng CSDL: đọc hợp đồng kèm trạng thái, áp dụng quyết định thuyên chuyển / nghỉ việc
// khi tới ngày hiệu lực (chạy lúc khởi động + mỗi 30 phút + mỗi lần mở trang Nhân sự). Quy tắc thuần ở hr-rules.js.
import { join } from 'node:path';
import { db, getSetting, DATA_DIR } from './db.js';
import { vnDateStr } from './util.js';
import { contractStatus, currentContract, decisionDue, expiredTooLong, EMP_TYPE_BY_CONTRACT, dmy } from './hr-rules.js';

// Giấy tờ nhân sự (CCCD, bằng cấp…) lưu TRONG data/ — thư mục máy chủ KHÔNG phát công khai; chỉ tải qua API có quyền Nhân sự.
// Có trong bản "Sao lưu toàn bộ" (server/backup.js).
export const HR_FILES_DIR = join(DATA_DIR, 'hr-files');
export const hrToday = () => vnDateStr();
// Công tắc phân hệ (chỉ tài khoản tổng bật — Cài đặt). Tắt: menu ẩn, API Nhân sự trả 403, không gửi nhắc.
export const hrEnabled = () => getSetting('hr_enabled', '0') === '1';
export function hrGate(req, res, next) {
  if (hrEnabled()) return next();
  res.status(403).json({ error: 'Phân hệ Nhân sự chưa được bật (chỉ tài khoản tổng bật được trong Cài đặt).' });
}
export const warnDays = () => Math.max(1, Math.min(365, parseInt(getSetting('hr_contract_warn_days', '30'), 10) || 30));

// Lương / chức danh hiệu lực của 1 HĐ tại ngày `today` (phụ lục mới nhất đã hiệu lực đè lên)
function effectiveTerms(c, annexes, today) {
  let salary = c.salary, position = c.position;
  for (const a of annexes.filter((x) => !x.effective_date || x.effective_date <= today).sort((x, y) => (x.effective_date > y.effective_date ? 1 : -1))) {
    if (a.salary > 0) salary = a.salary;
    if (a.position) position = a.position;
  }
  return { salary, position };
}

// Hợp đồng (kèm phụ lục, trạng thái, cảnh báo) — empIds rỗng = tất cả
export function loadContracts(empIds = null) {
  const today = hrToday(), wd = warnDays();
  const where = empIds && empIds.length ? `WHERE c.employee_id IN (${empIds.map(() => '?').join(',')})` : '';
  const rows = db.prepare(`SELECT c.*, e.code AS emp_code, e.full_name AS emp_name, e.department AS emp_department, e.active AS emp_active
      FROM hr_contracts c JOIN employees e ON e.id = c.employee_id ${where}
      ORDER BY c.start_date DESC, c.id DESC`).all(...(empIds || []));
  const ann = new Map();
  if (rows.length) {
    const ids = rows.map((r) => r.id);
    for (const a of db.prepare(`SELECT * FROM hr_contract_annexes WHERE contract_id IN (${ids.map(() => '?').join(',')}) ORDER BY effective_date, id`).all(...ids)) {
      if (!ann.has(a.contract_id)) ann.set(a.contract_id, []);
      ann.get(a.contract_id).push(a);
    }
  }
  const renewedIds = new Set(rows.filter((r) => r.parent_id).map((r) => r.parent_id));
  for (const c of rows) {
    c.annexes = ann.get(c.id) || [];
    const renewed = renewedIds.has(c.id);
    c.status = contractStatus(c, today, wd, renewed);
    c.days_left = c.end_date ? Math.round((Date.parse(c.end_date) - Date.parse(today)) / 86400000) : null;
    Object.assign(c, { eff: effectiveTerms(c, c.annexes, today) });
    c.alerts = [];
    if (expiredTooLong(c, today, renewed, c.emp_active === 1))
      c.alerts.push(`Đã hết hạn từ ${dmy(c.end_date)} (quá 30 ngày) mà nhân viên vẫn đang làm — HĐ này đã thành HĐ không xác định thời hạn theo điểm b khoản 2 Điều 20 BLLĐ 2019. Nên ký HĐ mới ngay.`);
  }
  return rows;
}

// Tóm tắt HĐ hiện tại của mỗi NV: Map employee_id → { contract, emp_type }
export function currentContractsByEmp(contracts) {
  const today = hrToday();
  const by = new Map();
  for (const c of contracts) { if (!by.has(c.employee_id)) by.set(c.employee_id, []); by.get(c.employee_id).push(c); }
  const out = new Map();
  for (const [eid, list] of by) {
    const cur = currentContract(list, today);
    const latest = list[0];   // mới nhất theo ngày bắt đầu (để báo "HĐ đã hết hạn")
    out.set(eid, { cur, latest, emp_type: cur ? EMP_TYPE_BY_CONTRACT[cur.ctype] : '' });
  }
  return out;
}

// Áp dụng 1 quyết định (đã tới ngày hiệu lực): đổi bộ phận / chức danh, hoặc cho nghỉ việc
export function applyDecision(d, by = 'Hệ thống') {
  db.exec('BEGIN');
  try {
    if (d.kind === 'transfer') {
      if (d.to_department) {
        db.prepare('INSERT OR IGNORE INTO departments(name) VALUES (?)').run(d.to_department);
        db.prepare('UPDATE employees SET department = ? WHERE id = ?').run(d.to_department, d.employee_id);
      }
      if (d.to_position) {
        db.prepare('INSERT OR IGNORE INTO positions(name) VALUES (?)').run(d.to_position);
        db.prepare('UPDATE employees SET position = ? WHERE id = ?').run(d.to_position, d.employee_id);
      }
    } else if (d.kind === 'resign') {
      db.prepare('UPDATE employees SET leave_date = ? WHERE id = ?').run(d.effective_date, d.employee_id);
      if (d.lock_account) db.prepare('UPDATE employees SET active = 0 WHERE id = ?').run(d.employee_id);
      if (d.end_contract) {
        // chấm dứt các HĐ còn hiệu lực tại ngày nghỉ (HĐ đã hết hạn trước đó giữ nguyên)
        // (HĐ ký trước cho giai đoạn SAU ngày nghỉ: chấm dứt từ chính ngày bắt đầu của nó = coi như không thực hiện)
        db.prepare(`UPDATE hr_contracts SET terminated_date = CASE WHEN start_date > ? THEN start_date ELSE ? END, terminate_reason = ?
            WHERE employee_id = ? AND terminated_date = '' AND (end_date = '' OR end_date >= ?)`)
          .run(d.effective_date, d.effective_date, `Nghỉ việc${d.decision_no ? ' theo QĐ ' + d.decision_no : ''}`, d.employee_id, d.effective_date);
      }
    }
    db.prepare("UPDATE hr_decisions SET status = 'applied', applied_at = datetime('now') WHERE id = ?").run(d.id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  console.log(`[hr] Áp dụng quyết định #${d.id} (${d.kind}) cho NV #${d.employee_id} — ${by}`);
}

// Áp dụng mọi quyết định đã tới ngày hiệu lực (theo thứ tự ngày). Trả số quyết định đã áp dụng.
export function applyDueDecisions(today = hrToday()) {
  let n = 0;
  const due = db.prepare("SELECT * FROM hr_decisions WHERE status = 'pending' AND effective_date <= ? ORDER BY effective_date, id").all(today);
  for (const d of due) {
    if (!decisionDue(d, today)) continue;
    try { applyDecision(d); n++; } catch (e) { console.error('[hr] áp dụng quyết định #' + d.id + ' lỗi:', e.message); }
  }
  return n;
}

export function startHrScheduler() {
  try { applyDueDecisions(); } catch (e) { console.error('[hr]', e.message); }
  setInterval(() => { try { applyDueDecisions(); } catch (e) { console.error('[hr]', e.message); } }, 30 * 60 * 1000).unref?.();
}
