// CHUYỂN LƯỢT QUẸT SANG NV KHÁC (Máy chấm công → Xem quẹt → chọn lượt → "Chuyển sang NV khác") — Anh 27/11/2026, khách BBQ:
// máy Manor và máy Green Star cùng có Số ID 3 (2 người khác nhau) → lượt của Minh ở Manor cộng nhầm cho Giáp từ tháng 9.
// "Người khác" của Cảnh báo trùng chỉ chuyển lượt từ lúc phát hiện, nên lượt cũ phải chuyển bằng tay.
//  - lượt đổi sang Số ID của NV đích + employee_id, chỉ lượt của đúng máy; dựng lại công cả 2 người
//  - NV đích đã có lượt đúng giờ đó ở máy này → bỏ bản trùng
//  - ghi quy tắc đổi số cho các khoảng đã chuyển (ngắt ở lượt cũ không chuyển) → máy gửi lại log cũ vẫn về đúng người,
//    quy tắc mới nhất thắng quy tắc cũ cùng khoảng
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { moCong } from './_cong.mjs';

const dir = mkdtempSync(join(tmpdir(), 'dgp-chuyen-luot-'));
process.env.DB_PATH = join(dir, 'test.db');
const { db, initSchema } = await import('../server/db.js');
const { ingestAttlog, rebuildDays } = await import('../server/device-sync.js');
const { registerDeviceRoutes } = await import('../server/routes/admin/devices.js');
const { describeAction } = await import('../server/audit-describe.js');
const express = (await import('express')).default;

const iso = (d, t) => new Date(`2026-11-${d}T${t}:00+07:00`).toISOString();
const hm = (x) => (x ? new Date(Date.parse(x) + 7 * 3600e3).toISOString().slice(11, 16) : null);
let srv, base, GIAP, MINH, MANOR, GSTAR;

before(async () => {
  initSchema();
  const emp = (code, name, pin) => Number(db.prepare("INSERT INTO employees(code, username, password_hash, full_name, device_pin, role, active) VALUES (?,?,'x',?,?,'employee',1)").run(code, 'u' + code, name, pin).lastInsertRowid);
  GIAP = emp('3', 'Giáp', '3'); MINH = emp('637', 'Minh', '637');
  MANOR = Number(db.prepare("INSERT INTO push_devices(serial, name) VALUES ('MANOR','BBQ Manor')").run().lastInsertRowid);
  GSTAR = Number(db.prepare("INSERT INTO push_devices(serial, name) VALUES ('GSTAR','BBQ Green Star')").run().lastInsertRowid);
  const pu = db.prepare('INSERT INTO device_punches(serial, pin, punch_at, work_date, status, verify, employee_id) VALUES (?,?,?,?,0,1,?)');
  const p = (serial, pin, d, t, eid) => pu.run(serial, pin, iso(d, t), '2026-11-' + d, eid);
  // Manor: Số ID 3 = Minh nhưng đang cộng cho Giáp
  p('MANOR', '3', '10', '07:00', GIAP); p('MANOR', '3', '10', '17:00', GIAP);
  p('MANOR', '3', '11', '07:05', GIAP);                                    // lượt này KHÔNG chuyển (giả sử đúng là Giáp)
  p('MANOR', '3', '12', '07:00', GIAP); p('MANOR', '3', '12', '17:00', GIAP);
  p('MANOR', '3', '13', '07:00', GIAP); p('MANOR', '637', '13', '07:00', MINH);   // trùng giờ với lượt Minh đã có
  // Green Star: Số ID 3 = Giáp thật
  p('GSTAR', '3', '10', '08:00', GIAP); p('GSTAR', '3', '10', '18:00', GIAP);
  // quy tắc đổi số CŨ ở Manor phủ ngày 10 (VD từ một cảnh báo trước) — chuyển tay phải thắng
  db.prepare("INSERT INTO device_pin_remaps(serial,pin,from_at,to_at,new_pin) VALUES('MANOR','3',?,?,'999')").run(iso('10', '00:00'), iso('10', '23:59'));
  rebuildDays(new Set(['10', '11', '12', '13'].flatMap((d) => [GIAP + '|2026-11-' + d, MINH + '|2026-11-' + d])));
  const app = express(); app.use(express.json());
  const r = express.Router();
  r.use((q, s, n) => { q.user = { id: 1, role: 'admin' }; n(); });
  registerDeviceRoutes(r, { need: () => (q, s, n) => n() });
  app.use('/admin', r);
  srv = await moCong(app); base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { srv?.close(); try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} });

const post = (id, body) => fetch(`${base}/admin/devices/${id}/punches/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const idOf = (serial, pin, d, t) => db.prepare('SELECT id FROM device_punches WHERE serial=? AND pin=? AND punch_at=?').get(serial, pin, iso(d, t))?.id;
const ins = (eid, d) => db.prepare('SELECT check_in_at FROM attendance WHERE employee_id=? AND work_date=? ORDER BY check_in_at').all(eid, '2026-11-' + d).map((r) => hm(r.check_in_at));

test('trước khi chuyển: ngày 10 Giáp đang nhận cả lượt của Manor', () => {
  assert.equal(ins(GIAP, '10')[0], '07:00');
  assert.deepEqual(ins(MINH, '10'), []);
});

test('báo lỗi: không chọn lượt, NV không có', async () => {
  assert.equal((await post(MANOR, { ids: [], employee_id: MINH })).status, 400);
  const x = await post(MANOR, { ids: [idOf('MANOR', '3', '10', '07:00')], employee_id: 99999 });
  assert.equal(x.status, 400);
  assert.match((await x.json()).error, /Không tìm thấy nhân viên/);
  assert.equal(idOf('MANOR', '3', '10', '07:00') > 0, true);   // chưa đổi gì
});

test('chuyển: đổi Số ID + NV, chỉ lượt của đúng máy, bỏ bản trùng giờ, dựng lại công 2 người, nhật ký ghi rõ', async () => {
  const ids = [['10', '07:00'], ['10', '17:00'], ['12', '07:00'], ['12', '17:00'], ['13', '07:00']].map(([d, t]) => idOf('MANOR', '3', d, t));
  const other = idOf('GSTAR', '3', '10', '08:00');
  const desc = describeAction({ method: 'POST', path: `/devices/${MANOR}/punches/move`, body: { ids: [...ids, other], employee_id: MINH } });
  assert.match(desc, /Máy BBQ Manor: chuyển 5 lượt quẹt sang Minh — Số ID 3 lúc 07:00 10\/11\/2026/);
  const x = await post(MANOR, { ids: [...ids, other], employee_id: MINH });
  assert.equal(x.status, 200);
  const r = await x.json();
  assert.equal(r.moved, 4); assert.equal(r.merged, 1); assert.equal(r.pin, '637');
  const manor = db.prepare("SELECT pin, employee_id e, work_date d FROM device_punches WHERE serial='MANOR' ORDER BY punch_at").all();
  assert.deepEqual(manor.map((p) => `${p.d.slice(8)} ${p.pin} ${p.e === MINH ? 'Minh' : 'Giáp'}`),
    ['10 637 Minh', '10 637 Minh', '11 3 Giáp', '12 637 Minh', '12 637 Minh', '13 637 Minh']);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM device_punches WHERE serial='GSTAR' AND pin='3' AND employee_id=?").get(GIAP).n, 2);   // máy khác giữ nguyên
  // công: ngày 10 Giáp chỉ còn lượt Green Star 08:00, Minh có 07:00; ngày 12 Giáp hết công
  assert.deepEqual(ins(GIAP, '10'), ['08:00']);
  assert.equal(ins(MINH, '10')[0], '07:00');
  assert.deepEqual(ins(GIAP, '12'), []);
  assert.equal(ins(MINH, '12')[0], '07:00');
});

test('quy tắc đổi số: 2 khoảng (ngắt ở lượt ngày 11 không chuyển), máy gửi lại log cũ về đúng người', () => {
  const rules = db.prepare("SELECT from_at, to_at, new_pin FROM device_pin_remaps WHERE serial='MANOR' AND new_pin='637' ORDER BY from_at").all();
  assert.deepEqual(rules.map((x) => [hm(x.from_at), hm(x.to_at), x.new_pin]), [['07:00', '17:00', '637'], ['07:00', '07:00', '637']]);
  assert.equal(rules[0].to_at, new Date(Date.parse(iso('10', '17:00')) + 1000).toISOString());
  assert.equal(rules[1].from_at, iso('12', '07:00'));
  assert.equal(rules[1].to_at, new Date(Date.parse(iso('13', '07:00')) + 1000).toISOString());
  ingestAttlog('MANOR', [
    '3\t2026-11-10 07:00:00\t0\t1',   // đã chuyển → về 637, đã có → không thêm (quy tắc mới thắng quy tắc cũ "999")
    '3\t2026-11-11 07:05:00\t0\t1',   // không chuyển → vẫn Giáp, đã có
    '3\t2026-11-11 12:00:00\t0\t1',   // giữa 2 khoảng → vẫn là Giáp
    '3\t2026-11-12 12:00:00\t0\t1',   // trong khoảng đã chuyển → Minh
  ].join('\n'), { ask: () => {} });
  const manor = db.prepare("SELECT pin, employee_id e, punch_at FROM device_punches WHERE serial='MANOR' ORDER BY punch_at").all();
  assert.deepEqual(manor.map((p) => `${hm(p.punch_at)} ${p.pin} ${p.e === MINH ? 'Minh' : 'Giáp'}`),
    ['07:00 637 Minh', '17:00 637 Minh', '07:05 3 Giáp', '12:00 3 Giáp', '07:00 637 Minh', '12:00 637 Minh', '17:00 637 Minh', '07:00 637 Minh']);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM device_punches WHERE pin='999'").get().n, 0);
});

test('chuyển lại lượt đã đúng người: không đổi gì', async () => {
  const x = await post(MANOR, { ids: [idOf('MANOR', '637', '10', '07:00')], employee_id: MINH });
  assert.equal(x.status, 200);
  const r = await x.json();
  assert.equal(r.moved, 0); assert.equal(r.merged, 0);
});
