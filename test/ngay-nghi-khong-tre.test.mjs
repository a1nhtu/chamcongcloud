// Công tắc weekend_ot_no_late (mặc định TẮT — khách may Hualida, ca "+k" ngày CN): ngày nghỉ hằng tuần đi làm, cả ngày là tăng ca
// → làm bao nhiêu giờ tính tăng ca bấy nhiêu, vào muộn / về sớm KHÔNG ghi đi trễ / về sớm. Ngày thường giữ nguyên.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-ngaynghi-tre-${process.pid}.db`);
process.env.DB_PATH = DBP;   // không đụng CSDL thật (db.js chốt đường dẫn lúc import)
const { computeDayMetrics } = await import('../server/day-metrics.js');
after(() => { for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} } });

const iso = (d, hm) => new Date(`${d}T${hm}:00+07:00`).toISOString();
const HC = { id: 1, start_time: '07:30', end_time: '16:30', break_minutes: 60, break_start: '12:00', late_grace_min: 0, early_grace_min: 0,
  work_unit_value: 1, allow_ot: 1, ot_start_after_min: 30, ot_rounding_unit: 0 };
const ctx = (noLate) => ({ weekend: '7', weekendOt: true, weekendNoLate: noLate, roundingDecimals: 2, roundingMode: 0, hourly: false,
  isHoliday: () => false, otRound: { decimals: 2, mode: 0, block: 0 } });
const day = (noLate, d, i, o) => computeDayMetrics(ctx(noLate), HC, d, iso(d, i), iso(d, o), null, {});
const SUN = '2026-03-08', MON = '2026-03-09';

test('mặc định (tắt): chủ nhật vào 09:00 vẫn ghi đi trễ 90 phút như cũ', () => {
  const m = day(false, SUN, '09:00', '16:30');
  assert.equal(m.ot_type, 'cuoi_tuan'); assert.equal(m.ot_min, 390); assert.equal(m.late, 90);
});

test('bật: chủ nhật vào 09:00, về 15:00 → tăng ca theo giờ thực, không đi trễ / về sớm', () => {
  const m = day(true, SUN, '09:00', '16:30');
  assert.equal(m.ot_min, 390); assert.equal(m.late, 0); assert.equal(m.work_unit, 0);
  const n = day(true, SUN, '09:00', '15:00');
  assert.equal(n.late, 0); assert.equal(n.early_min, 0); assert.ok(n.ot_min > 0 && n.ot_min < 390);
});

test('bật: ngày thường vẫn tính đi trễ', () => {
  const m = day(true, MON, '09:00', '16:30');
  assert.equal(m.ot_type, 'thuong'); assert.equal(m.late, 90); assert.equal(m.work_minutes, 390);
});
