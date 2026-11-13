// CHỌN CA KHÔNG ĐOÁN — Việc 5 (đợt 13/11/2026, Anh duyệt): chấm điện thoại quanh nửa đêm với lịch NHIỀU ca có ca đêm.
//   - Ca đêm hôm qua còn đang chạy, chấm VÀO sau nửa đêm (00:30): dòng công thuộc HÔM QUA với ca đêm đó, trễ đủ phút; chấm RA sau đó
//     giữ đúng ca đêm (trước đây ra sớm 02:00 thì dò lại thành ca 14:00–22:00 → 0 công, trễ 630).
//   - Ca bắt đầu ngay sau nửa đêm (00:00–08:00) chấm vào sớm 23:50: dòng công thuộc NGÀY CỦA CA (hôm sau), không trễ
//     (trước đây thành dòng hôm nay trễ 1.430 / ca 16:00 trễ 470, sáng hôm sau không chấm ra được).
// Chấm qua route thật (/api/attendance/check-in, /check-out), giờ máy chủ giả bằng mock.timers.
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { moCong } from './_cong.mjs';   // cổng ngẫu nhiên an toàn

const dir = mkdtempSync(join(tmpdir(), 'dgp-ccdt-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema, setSetting } = await import('../server/db.js');
const { signToken } = await import('../server/auth.js');
const express = (await import('express')).default;

const ins = (t, o) => { const k = Object.keys(o); return Number(db.prepare(`INSERT INTO ${t}(${k.join(',')}) VALUES(${k.map(() => '?').join(',')})`).run(...k.map((x) => o[x])).lastInsertRowid); };
const hm = (x) => (x ? new Date(Date.parse(x) + 7 * 3600e3).toISOString().slice(8, 16).replace('T', ' ') : '-');
const S = {};
let codeOf = {}, srv, base, n = 0;
const PUNCH = { lat: 21.0, lng: 105.8, photo: 'khong-phai-anh' };
const call = async (path, e) => {
  const x = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + signToken(db.prepare('SELECT * FROM employees WHERE id=?').get(e)) }, body: JSON.stringify(PUNCH) });
  let body = null; try { body = await x.json(); } catch {}
  return { status: x.status, body };
};
function lich(codes, unit = 'auto') {
  const w = ins('work_schedules', { code: '', name: codes.join('/'), unit, cycle: 1 });
  codes.forEach((c, i) => ins('work_schedule_shifts', { work_schedule_id: w, shift_id: S[c], sort_order: i }));
  if (unit === 'week') for (let d = 0; d < 7; d++) for (const c of codes) ins('work_schedule_days', { work_schedule_id: w, idx: d, shift_id: S[c] });
  return w;
}
function nv(w) {
  n++;
  const id = ins('employees', { code: 'DT' + n, full_name: 'NV ' + n, username: 'dt' + n, password_hash: 'x', role: 'employee', active: 1, att_mode: 'shift' });
  ins('shift_assignments', { employee_id: id, mode: 'schedule', work_schedule_id: w, from_date: '2026-10-26', shift_type: 'fixed', merge_rule: 'default', active: 1 });
  return id;
}
const cong = (e) => db.prepare('SELECT * FROM attendance WHERE employee_id=? ORDER BY work_date, check_in_at').all(e)
  .map((r) => `${r.work_date.slice(8)}[${codeOf[r.shift_id] || '-'}] ${hm(r.check_in_at)}→${hm(r.check_out_at)} ${r.work_unit}c trễ${r.late_min || 0} sớm${r.early_min || 0}`);
// các bước [vào|ra, 'DD HH:MM'] (tháng 11/2026), mỗi bước đặt giờ máy chủ đúng lúc chấm; bước nào lỗi thì báo kèm lý do
async function cham(e, steps) {
  for (const [k, t] of steps) {
    mock.timers.enable({ apis: ['Date'], now: new Date(`2026-11-${t.replace(' ', 'T')}:00+07:00`) });
    try {
      const r = await call(k === 'vào' ? '/api/attendance/check-in' : '/api/attendance/check-out', e);
      assert.equal(r.status, 200, `${k} ${t}: ${JSON.stringify(r.body)}`);
    } finally { mock.timers.reset(); }
  }
}

before(async () => {
  initSchema();
  setSetting('attendance_mode', 'shift');
  db.prepare('UPDATE shifts SET active=0').run();
  const b = { late_grace_min: 0, early_grace_min: 0, allow_ot: 1, ot_start_after_min: 30, work_unit_value: 1, break_minutes: 0 };
  const ca = (code, st, en, x = {}) => (S[code] = ins('shifts', { ...b, name: code, code, start_time: st, end_time: en, ...(en <= st ? { cross_midnight: 1 } : {}), ...x }));
  ca('HC', '08:00', '17:00', { break_minutes: 60 }); ca('DM', '19:00', '07:00', { break_minutes: 60 });
  ca('S6', '06:00', '14:00'); ca('C14', '14:00', '22:00'); ca('D22', '22:00', '06:00');
  ca('C0', '00:00', '08:00'); ca('C16', '16:00', '00:00');
  codeOf = Object.fromEntries(Object.entries(S).map(([k, v]) => [v, k]));
  const app = express(); app.use(express.json({ limit: '2mb' }));
  app.use('/api/attendance', (await import('../server/routes/attendance.js')).default);
  app.use((err, req, res, next) => { res.status(500).json({ error: 'LOI 500: ' + err.message }); });   // eslint-disable-line no-unused-vars
  srv = await moCong(app); base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { mock.timers.reset(); srv.close(); try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} });

test('Việc 5 · lịch nhiều ca có ca đêm, vào trễ 00:30: dòng của HÔM QUA với ca đêm, trễ đủ phút; chấm ra tính đúng ca đêm', async () => {
  const a = nv(lich(['HC', 'DM']));
  await cham(a, [['vào', '03 00:30'], ['ra', '03 07:00']]);
  assert.deepEqual(cong(a), ['02[DM] 03 00:30→03 07:00 0.5c trễ330 sớm0']);
  const b = nv(lich(['S6', 'C14', 'D22']));
  await cham(b, [['vào', '04 00:30'], ['ra', '04 06:05']]);
  assert.deepEqual(cong(b), ['03[D22] 04 00:30→04 06:05 0.68c trễ150 sớm0']);
});

test('Việc 5 · ca đêm vào trễ rồi ra sớm 02:00: vẫn đúng ca đêm đã chọn lúc vào (trước: dò lại thành ca 14:00–22:00, 0 công, trễ 630)', async () => {
  const e = nv(lich(['S6', 'C14', 'D22']));
  await cham(e, [['vào', '04 00:30'], ['ra', '04 02:00']]);
  assert.deepEqual(cong(e), ['03[D22] 04 00:30→04 02:00 0.18c trễ150 sớm240']);
});

test('Việc 5 · ca 00:00–08:00 chấm vào sớm 23:50: dòng công thuộc ngày của ca (hôm sau), không trễ; sáng hôm sau chấm ra được', async () => {
  const a = nv(lich(['C0'], 'week'));   // lịch 1 ca
  await cham(a, [['vào', '03 23:50'], ['ra', '04 08:00']]);
  assert.deepEqual(cong(a), ['04[C0] 03 23:50→04 08:00 1c trễ0 sớm0']);
  const b = nv(lich(['C0', 'C16']));    // lịch tự dò ca 00:00–08:00 / 16:00–00:00
  await cham(b, [['vào', '03 23:50'], ['ra', '04 08:00']]);
  assert.deepEqual(cong(b), ['04[C0] 03 23:50→04 08:00 1c trễ0 sớm0']);
});

test('Việc 5 · giữ như cũ: gần giờ vào ca hôm nay hơn (05:45 → ca 06:00), ca đêm đúng giờ 2 đêm liền, ca 16:00 vào 15:50', async () => {
  const a = nv(lich(['S6', 'C14', 'D22']));
  await cham(a, [['vào', '04 05:45'], ['ra', '04 14:00']]);
  assert.deepEqual(cong(a), ['04[S6] 04 05:45→04 14:00 1c trễ0 sớm0']);
  const b = nv(lich(['HC', 'DM']));
  await cham(b, [['vào', '02 19:00'], ['ra', '03 07:00'], ['vào', '03 19:00']]);
  assert.deepEqual(cong(b), ['02[DM] 02 19:00→03 07:00 1c trễ0 sớm0', '03[DM] 03 19:00→- 0c trễ0 sớm0']);
  const c = nv(lich(['C0', 'C16']));
  await cham(c, [['vào', '03 15:50'], ['ra', '04 00:00']]);
  assert.deepEqual(cong(c), ['03[C16] 03 15:50→04 00:00 1c trễ0 sớm0']);
});
