// Giữ cho lịch gán ca (của nhân viên / của phòng ban) KHÔNG chồng ngày nhau.
// Quy tắc: lịch gán SAU thắng. Khi có lịch mới [from, to] thì các lịch cũ của cùng đối tượng:
//   - nằm trọn trong khoảng mới            → xoá
//   - bắt đầu trước, lấn vào khoảng mới    → kết thúc vào hôm trước ngày bắt đầu của lịch mới
//     (nếu lịch cũ còn kéo dài quá ngày kết thúc của lịch mới → tách thêm 1 đoạn sau đó)
//   - bắt đầu trong khoảng mới, kéo dài quá → dời ngày bắt đầu sang hôm sau ngày kết thúc của lịch mới
import { db, getSetting, setSetting } from './db.js';

const addDay = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const KEY = { shift_assignments: 'employee_id', dept_shift_assignments: 'department' };

// from/to: 'YYYY-MM-DD' (to = null là không thời hạn). exceptId: dòng vừa tạo / đang sửa (không tự đè chính nó).
// olderSet: (chỉ khi dọn dữ liệu cũ) tập id các dòng được coi là CŨ HƠN — chỉ đè lên các dòng này; đoạn tách ra cũng được thêm vào tập.
export function overrideAssignRanges(table, keyVal, from, to, exceptId = null, olderSet = null) {
  const key = KEY[table];
  if (!key || !from) return 0;
  const rows = db.prepare(`SELECT * FROM ${table} WHERE ${key} = ? AND active = 1`).all(keyVal)
    .filter((r) => r.id !== exceptId && (!olderSet || olderSet.has(r.id)))
    .filter((r) => (to == null || r.from_date <= to) && (r.to_date == null || r.to_date >= from));
  let n = 0;
  for (const r of rows) {
    const endsInside = to == null || (r.to_date != null && r.to_date <= to);
    if (r.from_date >= from && endsInside) {
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(r.id);
    } else if (r.from_date < from) {
      if (!endsInside) {   // lịch cũ bao trùm lịch mới → giữ thêm đoạn sau
        const cols = Object.keys(r).filter((c) => c !== 'id');
        const tail = { ...r, from_date: addDay(to, 1) };
        const info = db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => tail[c]));
        if (olderSet) olderSet.add(Number(info.lastInsertRowid));
      }
      db.prepare(`UPDATE ${table} SET to_date = ? WHERE id = ?`).run(addDay(from, -1), r.id);
    } else {
      db.prepare(`UPDATE ${table} SET from_date = ? WHERE id = ?`).run(addDay(to, 1), r.id);
    }
    n++;
  }
  return n;
}

// Lịch trình gán cho TẤT CẢ PHÒNG BAN (cả công ty, kể cả phòng ban thêm sau / NV chưa có phòng ban): dòng department = '*'
export const ALL_DEPTS = '*';
// Gán "tất cả phòng ban" = lịch mới thắng: lịch riêng của MỌI phòng ban trong khoảng [from, to] bị cắt / thay
export function overrideAllDepts(from, to) {
  for (const { department } of db.prepare('SELECT DISTINCT department FROM dept_shift_assignments WHERE active = 1 AND department <> ?').all(ALL_DEPTS))
    overrideAssignRanges('dept_shift_assignments', department, from, to);
}

// Dọn 1 lần các lịch chồng ngày đã có từ trước (bản cũ cho gán đè mà không cắt lịch cũ): duyệt theo thứ tự tạo, dòng sau đè dòng trước.
export function fixOverlappingAssignmentsOnce() {
  if (getSetting('assign_overlap_fixed') === '1') return;
  db.exec('BEGIN');
  try {
    for (const table of Object.keys(KEY)) {
      const key = KEY[table];
      const ids = db.prepare(`SELECT id FROM ${table} WHERE active = 1 ORDER BY id`).all().map((x) => x.id);
      const older = new Set();
      for (const id of ids) {
        const r = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
        overrideAssignRanges(table, r[key], r.from_date, r.to_date, r.id, older);
        older.add(id);
      }
    }
    setSetting('assign_overlap_fixed', '1');
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); console.error('fixOverlappingAssignmentsOnce:', e.message); }
}
