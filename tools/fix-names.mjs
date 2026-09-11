import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const db = new DatabaseSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'digiplus.db'));

const shiftFix = { 2: 'Ca sáng', 3: 'Ca chiều', 4: 'Ca đêm' };
for (const [id, name] of Object.entries(shiftFix))
  db.prepare('UPDATE shifts SET name = ? WHERE id = ?').run(name, +id);

db.prepare('UPDATE departments SET name = ? WHERE id = ?').run('Kỹ thuật', 3);
// Đồng bộ lại department của nhân viên nếu đang lưu chuỗi hỏng
db.prepare("UPDATE employees SET department = 'Kỹ thuật' WHERE department LIKE 'K%thu%t' AND department != 'Kỹ thuật'").run();

console.log('SHIFTS:', db.prepare('SELECT id,name FROM shifts').all());
console.log('DEPARTMENTS:', db.prepare('SELECT id,name FROM departments').all());
