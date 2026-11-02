// GÓI CÀI ĐẶT ("Chế độ tính công") — 1 nút bật cả bộ công tắc ĐÃ CÓ cho một kiểu khách, thay vì tích từng ô ở nhiều trang.
// Gói KHÔNG thêm phép tính nào: áp gói = ghi đúng các cài đặt như khi tích tay ở Cài đặt › Quy tắc tính công.
// Tên gói đặt theo KIỂU tính (không theo tên khách) → bộ cài khách khác không lộ khách nào đang dùng.
// Chưa áp gói nào (mặc định) → không ghi gì vào CSDL, mọi thứ y như cũ. Chỉ tài khoản tổng áp / trả về (routes/admin/settings.js).
//
// Lưu trong bảng settings của công ty đang phục vụ:
//   profile        — id gói đang dùng
//   profile_backup — JSON { key: giá trị TRƯỚC khi áp | null = trước đó chưa có dòng } → "Trả về như trước" khôi phục đúng nguyên trạng
import { db, getSetting, setSetting } from './db.js';

export const PROFILES = [
  {
    id: 'hrerp4',
    name: 'Kiểu HR-ERP 4 lần quẹt / ngày',
    desc: 'Công ty chấm 4 lần/ngày (Đến – Ra trưa – Vào lại – Về), ca có nghỉ trưa cố định, đối chiếu với HR-ERP.',
    settings: { pairs_fixed_break: '1', weekend_ot_before: '1', weekend_work_exact: '1', weekend_need_pairs: '1' },
    reports: ['track6'],
    manual: [
      'Ca làm việc: khai "Nghỉ giữa ca bắt đầu lúc" và chọn quy tắc "Nhiều lần vào/ra" cho các ca của công ty.',
      'Công ảo kiểu K (nếu khách dùng): bật riêng ở Cài đặt › Công ảo — gói không đụng công ảo.',
      'Áp xong bấm "↻ Tính lại công tất cả" để áp cho dữ liệu đã có.',
    ],
  },
];

// Tên ô + giá trị mặc định (giống Cài đặt › Quy tắc tính công) — để màn xem trước hiện "đang → sẽ thành"
export const SETTING_INFO = {
  pairs_fixed_break: ['Ca nghỉ trưa cố định + nhiều lần vào/ra: mỗi cặp quẹt trừ giờ nghỉ trưa', '0'],
  weekend_ot_before: ['Ngày nghỉ: tính cả giờ đến sớm trước giờ vào ca là tăng ca', '0'],
  weekend_work_exact: ['Ngày nghỉ: giờ làm trong ca giữ đúng số phút', '0'],
  weekend_need_pairs: ['Ngày nghỉ: chỉ có 2 lần quẹt thì không tính giờ làm trong ca', '0'],
};

export const profileById = (id) => PROFILES.find((p) => p.id === id) || null;
const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
const rawSetting = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;

// Gói đang dùng của công ty (null = chưa áp gói nào)
export function activeProfile() {
  const id = getSetting('profile', '');
  const p = id ? profileById(id) : null;
  return p ? { id: p.id, name: p.name, reports: p.reports } : null;
}

// Xem trước: từng ô gói sẽ đặt — giá trị hiện tại → giá trị của gói
export function previewProfile(id) {
  const p = profileById(id);
  if (!p) return null;
  return Object.entries(p.settings).map(([key, to]) => {
    const [label, def] = SETTING_INFO[key] || [key, ''];
    const from = getSetting(key, def);
    return { key, label, from, to, change: from !== to };
  });
}

// Áp gói. Đang dùng gói khác → giữ bản sao lưu GỐC (trước gói đầu tiên), chỉ bổ sung ô mới chưa có trong bản sao lưu.
export function applyProfile(id) {
  const p = profileById(id);
  if (!p) throw new Error('Không có gói cài đặt này');
  const changes = previewProfile(id);
  tx(() => {
    let backup = {};
    try { backup = JSON.parse(getSetting('profile_backup', '{}')) || {}; } catch { backup = {}; }
    if (!getSetting('profile', '')) backup = {};
    for (const key of Object.keys(p.settings)) if (!(key in backup)) backup[key] = rawSetting(key);
    for (const [key, v] of Object.entries(p.settings)) setSetting(key, v);
    setSetting('profile', p.id);
    setSetting('profile_backup', JSON.stringify(backup));
  });
  return changes;
}

// Trả về như trước khi áp gói: khôi phục đúng từng ô (ô trước đó chưa có thì xoá dòng) và bỏ dấu gói
export function revertProfile() {
  if (!getSetting('profile', '')) return false;
  let backup = {};
  try { backup = JSON.parse(getSetting('profile_backup', '{}')) || {}; } catch { backup = {}; }
  tx(() => {
    for (const [key, v] of Object.entries(backup)) {
      if (v == null) db.prepare('DELETE FROM settings WHERE key = ?').run(key);
      else setSetting(key, v);
    }
    db.prepare("DELETE FROM settings WHERE key IN ('profile', 'profile_backup')").run();
  });
  return true;
}
