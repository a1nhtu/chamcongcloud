// PHÂN CA ĐÊM NGÀY QUÊN CHẤM VÀO → CẢ CHUỖI ĐÊM SAU TỰ TÍNH LẠI (Anh 16/11/2026, v1.35.8).
// Lịch tự dò Ca ngày 08–20 + Ca đêm 20–08, quy tắc Giờ đầu – Giờ cuối (không biết hướng). Làm đêm liền 10→14/11, đêm 10/11 quên chấm vào:
// máy đẩy về thì cả chuỗi bị hiểu là ca ngày (07:58 → 19:55…). Anh gõ ô 10/11 = DEM trên Bảng phân ca / Excel → 10/11 dòng chỉ giờ ra
// 07:58 (không đoán giờ vào), các đêm sau tự tính lại thành Ca đêm đủ công — không phải bấm Tính lại.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'dgp-demquen-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema } = await import('../server/db.js');
const { ingestAttlog } = await import('../server/device-sync.js');
const { registerAssignmentRoutes } = await import('../server/routes/admin/assignments.js');
after(() => { try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} });

initSchema();
db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('punch_dedup_min','5')").run();
db.prepare('UPDATE shifts SET active=0').run();
const ins = (t, o) => { const k = Object.keys(o); return Number(db.prepare(`INSERT INTO ${t}(${k.join(',')}) VALUES(${k.map(() => '?').join(',')})`).run(...k.map((x) => o[x])).lastInsertRowid); };
const base = { late_grace_min: 0, early_grace_min: 0, allow_ot: 0, work_unit_value: 1, break_minutes: 0 };
const S = { NGAY: ins('shifts', { ...base, name: 'Ca ngày', code: 'NGAY', start_time: '08:00', end_time: '20:00' }),
  DEM: ins('shifts', { ...base, name: 'Ca đêm', code: 'DEM', start_time: '20:00', end_time: '08:00', cross_midnight: 1 }) };
const code = Object.fromEntries(Object.entries(S).map(([k, v]) => [v, k]));
const W = ins('work_schedules', { code: '', name: 'Ngày/Đêm', unit: 'auto', cycle: 1 });
ins('work_schedule_shifts', { work_schedule_id: W, shift_id: S.NGAY, sort_order: 0 });
ins('work_schedule_shifts', { work_schedule_id: W, shift_id: S.DEM, sort_order: 1 });

const routes = {};
const r = { get() {}, put() {}, delete() {}, post(p, _m, h) { routes[p] = h; } };
registerAssignmentRoutes(r, { need: () => (_q, _s, n) => n && n() });
const luuO = (cells) => new Promise((ok) => routes['/assignments/cells']({ body: { cells } }, { json: ok, status() { return this; } }));

const hm = (x) => (x ? new Date(Date.parse(x) + 7 * 3600e3).toISOString().slice(8, 16).replace('T', ' ') : '—');
const cong = (e) => db.prepare('SELECT * FROM attendance WHERE employee_id=? ORDER BY work_date, check_in_at').all(e)
  .map((x) => `${x.work_date.slice(8)} ${code[x.shift_id] || '-'} ${hm(x.check_in_at)}→${hm(x.check_out_at)} ${x.work_unit}c`);

test('phân ca Đêm ngày quên chấm vào → ngày đó chỉ giờ ra, các đêm sau tự tính lại thành Ca đêm', async () => {
  const e = ins('employees', { code: 'D1', full_name: 'NV đêm', username: 'd1', password_hash: 'x', role: 'employee', device_pin: '5501' });
  ins('shift_assignments', { employee_id: e, mode: 'schedule', work_schedule_id: W, from_date: '2026-11-01', shift_type: 'fixed', merge_rule: 'default', active: 1 });
  for (const x of ['11 07:58', '11 19:55', '12 08:03', '12 19:57', '13 08:01', '13 19:52', '14 08:05', '14 19:58', '15 08:02']) {
    const [d, t] = x.split(' '); ingestAttlog('SN1', `5501\t2026-11-${d} ${t}:00\t0\t1`, { ask: () => {} });
  }
  assert.equal(cong(e)[0], '11 NGAY 11 07:58→11 19:55 0.99c', 'máy đẩy về: hiểu nhầm ca ngày (đúng như thực tế)');
  const res = await luuO([{ employee_id: e, date: '2026-11-10', value: 'DEM' }]);
  assert.equal(res.ok, true);
  assert.deepEqual(cong(e), ['10 DEM —→11 07:58 0c', '11 DEM 11 19:55→12 08:03 1c', '12 DEM 12 19:57→13 08:01 1c',
    '13 DEM 13 19:52→14 08:05 1c', '14 DEM 14 19:58→15 08:02 1c']);
});
