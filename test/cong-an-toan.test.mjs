// Hàm mở cổng dùng chung cho test (test/_cong.mjs): phải BỎ QUA cổng fetch cấm và cổng test khác đang dò.
// Bối cảnh: máy có dải cổng động từ 1024 thỉnh thoảng cấp trúng cổng 6000 / 6666 / 5060… → "fetch failed: bad port" → bộ test hỏng ngẫu nhiên.
// Chạy: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { moCong, congTrong, congOk } from './_cong.mjs';

// "máy chủ" giả: mỗi lần listen nhận cổng kế tiếp trong danh sách
function fake(ports) {
  const log = { listens: 0, closes: 0 };
  const srv = new EventEmitter();
  let cur = null;
  srv.listen = () => { cur = ports[log.listens++]; setImmediate(() => srv.emit('listening')); return srv; };
  srv.address = () => ({ port: cur });
  srv.close = (cb) => { log.closes++; setImmediate(cb); };
  return { srv, log };
}

test('congOk: loại cổng fetch cấm, cổng máy chấm công, cổng dưới 1024', () => {
  for (const p of [6000, 6666, 5060, 10080, 2049, 4370, 8818, 8686, 80, 443, 1023]) assert.equal(congOk(p), false, 'cổng ' + p);
  for (const p of [1024, 3000, 12345, 49152, 65000]) assert.equal(congOk(p), true, 'cổng ' + p);
});

test('moCong: trúng cổng cấm thì đóng, xin lại cho tới khi được cổng an toàn', async () => {
  const { srv, log } = fake([6000, 4370, 10080, 23456]);
  const got = await moCong(srv);
  assert.equal(got.address().port, 23456);
  assert.equal(log.listens, 4);
  assert.equal(log.closes, 3);
});

test('moCong: mãi không có cổng an toàn thì báo lỗi rõ (không lặp vô hạn)', async () => {
  const { srv } = fake(Array(60).fill(6666));
  await assert.rejects(moCong(srv), /cổng an toàn/);
});

test('moCong / congTrong với máy chủ thật: fetch gọi được, cổng trống thì không ai nghe', async () => {
  const srv = await moCong(createServer((req, res) => res.end('ok')));
  try {
    const port = srv.address().port;
    assert.equal(congOk(port), true);
    assert.equal(srv.address().address, '127.0.0.1');
    assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), 'ok');
  } finally { await new Promise((ok) => srv.close(ok)); }
  const p = await congTrong();
  assert.equal(congOk(p), true);
  await assert.rejects(fetch(`http://127.0.0.1:${p}/`));
});

test('không file test nào tự mở cổng ngẫu nhiên bằng listen(0…) — phải qua moCong / congTrong', () => {
  const dir = new URL('.', import.meta.url);
  const sot = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.test.mjs') && x !== 'cong-an-toan.test.mjs')) {
    readFileSync(new URL(f, dir), 'utf8').split('\n').forEach((ln, i) => { if (/\.listen\(\s*0\b/.test(ln)) sot.push(`${f}:${i + 1}`); });
  }
  assert.deepEqual(sot, [], 'đổi sang moCong(app) / congTrong() trong test/_cong.mjs: ' + sot.join(', '));
});
