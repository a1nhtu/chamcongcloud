import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const db = new DatabaseSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'digiplus.db'));
const rows = db.prepare(`SELECT a.*, e.full_name, e.code FROM attendance a JOIN employees e ON e.id=a.employee_id ORDER BY a.work_date DESC, a.id DESC LIMIT 10`).all();
for (const r of rows) {
  console.log('---', r.full_name, r.code, '| ngày', r.work_date);
  console.log('  VÀO:', r.check_in_at, '| ảnh:', r.check_in_photo, '| muộn:', r.late_min, '| ngoài:', r.check_in_outside, '| cách(m):', r.check_in_distance_m);
  console.log('  RA :', r.check_out_at, '| ảnh:', r.check_out_photo, '| tổng phút:', r.work_minutes);
}
console.log('\nTong so ban ghi attendance:', db.prepare('SELECT COUNT(*) c FROM attendance').get().c);
