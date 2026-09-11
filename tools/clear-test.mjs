import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const db = new DatabaseSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'digiplus.db'));
const a = db.prepare("DELETE FROM attendance WHERE work_date >= '2026-08-01'").run();
const l = db.prepare("DELETE FROM leave_requests").run();
console.log('Đã xoá', a.changes, 'bản ghi chấm công test và', l.changes, 'đơn test.');
console.log('Còn lại attendance:', db.prepare('SELECT COUNT(*) c FROM attendance').get().c);
