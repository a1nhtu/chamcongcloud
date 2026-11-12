// Test GÓI CÀI ĐẶT (Cài đặt › Chế độ tính công): server/profiles.js + route /settings/profile(s).
//   · chưa áp gói → GET /settings không có trường gói, bảng settings không đổi (như cũ)
//   · áp gói = đúng các ô như tích tay ở Quy tắc tính công; "Trả về như trước" → bảng settings giống HỆT trước khi áp
//   · chỉ tài khoản tổng áp / trả về được
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { moCong } from './_cong.mjs';   // cổng ngẫu nhiên an toàn (tránh cổng fetch cấm / cổng test khác đang dò)

const DBP = join(tmpdir(), `dgp-goi-cai-dat-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;
let db, setSetting, P, server, base;
let user = { master: true, role: 'master' };
const call = async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json() };
};
const snapshot = () => db.prepare('SELECT key, value FROM settings ORDER BY key').all();

before(async () => {
  let initSchema;
  ({ db, initSchema, setSetting } = await import('../server/db.js'));
  P = await import('../server/profiles.js');
  const { registerSettingsRoutes } = await import('../server/routes/admin/settings.js');
  const express = (await import('express')).default;
  initSchema();
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { req.user = user; next(); });
  const r = express.Router();
  const pass = (req, res, next) => next();
  registerSettingsRoutes(r, { need: () => pass, adminOnly: pass });
  app.use('/api/admin', r);
  server = await moCong(app);
  base = `http://127.0.0.1:${server.address().port}/api/admin`;
});
after(() => { server?.close(); for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} } });

test('chưa áp gói: GET /settings không có trường gói, không ghi gì vào bảng settings', async () => {
  const before = snapshot();
  const { status, json } = await call('GET', '/settings');
  assert.equal(status, 200);
  for (const k of ['profile', 'profile_name', 'profile_reports']) assert.ok(!(k in json), k);
  assert.equal(P.activeProfile(), null);
  assert.deepEqual(snapshot(), before);
});

test('mỗi gói chỉ dùng ô cài đặt có tên + mặc định khai trong SETTING_INFO (xem trước đúng)', () => {
  for (const p of P.PROFILES) {
    assert.ok(p.id && p.name && p.desc, p.id);
    for (const k of Object.keys(p.settings)) assert.ok(P.SETTING_INFO[k], `${p.id}: ${k} chưa có trong SETTING_INFO`);
  }
});

test('áp gói HR-ERP 4 lần quẹt → 4 ô bật, GET /settings báo gói + báo cáo ghim; trả về → bảng settings y hệt trước', async () => {
  setSetting('weekend_ot_before', '1');   // khách đã tự tích 1 ô từ trước
  setSetting('pairs_fixed_break', '0');   // và đã lưu 1 ô ở trạng thái tắt
  const before = snapshot();
  const list = await call('GET', '/settings/profiles');
  assert.equal(list.status, 200);
  assert.equal(list.json.active, '');
  const pv = list.json.list.find((p) => p.id === 'hrerp4').preview;
  assert.deepEqual(pv.map((c) => [c.key, c.from, c.to, c.change]), [
    ['pairs_fixed_break', '0', '1', true], ['weekend_ot_before', '1', '1', false],
    ['weekend_work_exact', '0', '1', true], ['weekend_need_pairs', '0', '1', true],
  ]);

  const ap = await call('POST', '/settings/profile', { id: 'hrerp4' });
  assert.equal(ap.status, 200);
  const s = (await call('GET', '/settings')).json;
  for (const k of ['pairs_fixed_break', 'weekend_ot_before', 'weekend_work_exact', 'weekend_need_pairs']) assert.equal(s[k], '1', k);
  assert.equal(s.profile, 'hrerp4');
  assert.equal(s.profile_name, 'Kiểu HR-ERP 4 lần quẹt / ngày');
  assert.deepEqual(s.profile_reports, ['track6']);
  assert.equal((await call('GET', '/settings/profiles')).json.active, 'hrerp4');

  // áp lại lần 2 vẫn giữ bản sao lưu GỐC
  assert.equal((await call('POST', '/settings/profile', { id: 'hrerp4' })).status, 200);
  const rv = await call('DELETE', '/settings/profile');
  assert.deepEqual(rv.json, { ok: true });
  assert.deepEqual(snapshot(), before);
  assert.equal(P.activeProfile(), null);
  assert.deepEqual((await call('DELETE', '/settings/profile')).json, { ok: false });   // không có gói → không làm gì
});

test('áp gói trên CSDL mới rồi trả về: các ô chưa từng có được xoá đi (không để lại dòng "0")', () => {
  const before = snapshot();
  for (const k of ['weekend_work_exact', 'weekend_need_pairs']) assert.ok(!before.some((r) => r.key === k), k);
  P.applyProfile('hrerp4');
  P.revertProfile();
  assert.deepEqual(snapshot(), before);
});

test('áp gói = đúng như tích tay 4 ô ở Quy tắc tính công (PUT /settings)', async () => {
  const keys = ['pairs_fixed_break', 'weekend_ot_before', 'weekend_work_exact', 'weekend_need_pairs'];
  const val = () => Object.fromEntries(keys.map((k) => [k, db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value]));
  P.applyProfile('hrerp4');
  const viaProfile = val();
  P.revertProfile();
  await call('PUT', '/settings', Object.fromEntries(keys.map((k) => [k, true])));
  assert.deepEqual(val(), viaProfile);
  await call('PUT', '/settings', Object.fromEntries(keys.map((k) => [k, false])));
});

test('gói không có → 400; không phải tài khoản tổng → 403 (xem, áp, trả về)', async () => {
  assert.equal((await call('POST', '/settings/profile', { id: 'khong-co' })).status, 400);
  user = { id: 1, role: 'admin' };
  try {
    const before = snapshot();
    assert.equal((await call('GET', '/settings/profiles')).status, 403);
    assert.equal((await call('POST', '/settings/profile', { id: 'hrerp4' })).status, 403);
    assert.equal((await call('DELETE', '/settings/profile')).status, 403);
    assert.deepEqual(snapshot(), before);
  } finally { user = { master: true, role: 'master' }; }
});
