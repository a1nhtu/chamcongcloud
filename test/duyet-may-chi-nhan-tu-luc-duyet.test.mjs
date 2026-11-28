// DUYỆT MÁY LẦN ĐẦU: chỉ nhận dữ liệu phát sinh TỪ LÚC BẤM DUYỆT (Anh chốt 28/11/2026, khách pretty: duyệt 15 máy → máy gửi lại cả
// danh sách người + lượt cũ → tự ra NV, tự tải dữ liệu dù chưa bấm gì). Dữ liệu cũ lấy bằng Chuyển từ phần mềm cũ / Tải NV / Tải dữ liệu.
// Chạy: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { moCong } from './_cong.mjs';

const DBP = join(tmpdir(), `dgp-duyet-tu-luc-duyet-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let db, D, S, base, srv;
const f = (p, o) => fetch(`${base}/iclock/${p}`, o).then((r) => r.text());
const cnt = (q, ...a) => db.prepare(q).get(...a).c;
const users = (sn, n) => Array.from({ length: n }, (_, i) => `USER PIN=${i + 1}\tName=Nguoi ${sn} ${i + 1}\tPri=0\tPasswd=\tCard=\tGrp=1\tTZ=0`).join('\n')
  + '\n' + Array.from({ length: n }, (_, i) => `FP PIN=${i + 1}\tFID=0\tSize=8\tValid=1\tTMP=${sn}${i}abcdefghijklmnop`).join('\n');

before(async () => {
  D = await import('../server/db.js');
  db = D.db; D.initSchema();
  D.setSetting('device_enabled', '1');
  S = await import('../server/device-sync.js');
  const express = (await import('express')).default;
  const app = express();
  app.use('/iclock', (await import('../server/routes/iclock.js')).default);
  srv = await moCong(app);
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { srv.close(); srv.closeAllConnections?.();
});

test('duyệt lần đầu: máy nhận mốc 9999 (chỉ gửi dữ liệu mới), không tự tạo NV, không báo nghi trùng, không xếp lệnh', async () => {
  for (const sn of ['SN_A', 'SN_B']) await f(`cdata?SN=${sn}&options=all`);   // chờ duyệt
  for (const sn of ['SN_A', 'SN_B']) {
    db.prepare('UPDATE push_devices SET active=1 WHERE serial=?').run(sn);
    assert.equal(S.startFromApproval(sn), true);
    const hs = await f(`cdata?SN=${sn}&options=all&pushver=2.4.1`);
    assert.match(hs, /ATTLOGStamp=9999/);
    assert.match(hs, /OPERLOGStamp=9999/);
    // máy đời cũ lờ mốc, vẫn gửi lại cả danh sách ngay sau khi duyệt
    await f(`cdata?SN=${sn}&table=OPERLOG&Stamp=120`, { method: 'POST', body: users(sn, 25) });
    await f(`cdata?SN=${sn}&table=OPERLOG&Stamp=140`, { method: 'POST', body: users(sn + 'x', 25) });
  }
  assert.equal(cnt('SELECT COUNT(*) c FROM employees'), 0, 'không tự tạo NV');
  assert.equal(cnt('SELECT COUNT(*) c FROM device_pin_conflicts'), 0, 'không báo nghi trùng');
  assert.equal(cnt('SELECT COUNT(*) c FROM push_device_commands'), 0, 'không tự hỏi / tải NV');
  assert.equal(cnt("SELECT COUNT(*) c FROM device_users_serial WHERE serial='SN_A'"), 25, 'vẫn ghi nhận người đang có trên máy');
});

test('sau khi duyệt: đăng ký MỚI trên máy vẫn tự tạo NV như cũ', async () => {
  D.setSetting('oper_dump_at:SN_A', '');   // đợt gửi lại đã xong (ngưng quá OPER_DUMP_GAP_MS)
  await f('cdata?SN=SN_A&table=OPERLOG&Stamp=300', { method: 'POST', body: 'USER PIN=901\tName=Nguoi Moi\tPri=0\tPasswd=\tCard=\tGrp=1\tTZ=0' });
  assert.equal(cnt("SELECT COUNT(*) c FROM employees WHERE device_pin='901'"), 1);
});

test('duyệt lại máy đã từng chạy (tạm dừng rồi bật) thì giữ mốc cũ để máy gửi bù', () => {
  db.prepare("INSERT INTO push_devices(serial, name, active, att_stamp, oper_stamp) VALUES('SN_C','',1,'5555','777')").run();
  assert.equal(S.startFromApproval('SN_C'), false);
  assert.equal(db.prepare("SELECT att_stamp FROM push_devices WHERE serial='SN_C'").get().att_stamp, '5555');
});

test('bấm Tải NV (máy gửi lại cả danh sách) thì vẫn tạo NV', async () => {
  D.setSetting('device_pull_at:SN_B', new Date().toISOString());
  D.setSetting('oper_dump_at:SN_B', new Date().toISOString());
  await f('cdata?SN=SN_B&table=OPERLOG&Stamp=400', { method: 'POST', body: users('SN_B', 3) });
  assert.equal(cnt("SELECT COUNT(*) c FROM employees WHERE device_pin IN ('1','2','3')"), 3);
});
