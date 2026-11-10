// CHUYỂN DỮ LIỆU PHẦN MỀM CŨ — trình duyệt nén gzip file .mdb trước khi gửi (file Ronald Jack 26 MB → 2,3 MB).
// Máy chủ: file nén thì giải nén, file thô (trình duyệt cũ) giữ nguyên, file nén hỏng báo lỗi dễ hiểu. Chạy: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

process.env.DB_PATH = join(tmpdir(), `dgp-legacy-gzip-test-${process.pid}.db`);
const { unpackUpload } = await import('../server/legacy-import.js');

// Đầu file Access thật: 00 01 00 00 "Standard Jet DB" + nhiều trang trống
const mdb = Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.from('Standard Jet DB'), Buffer.alloc(200000, 0), Buffer.from('dữ liệu')]);

test('file nén gzip → giải nén đúng từng byte', async () => {
  const gz = gzipSync(mdb);
  assert.ok(gz.length < mdb.length / 10);
  assert.deepEqual(await unpackUpload(gz), mdb);
});

test('file thô (trình duyệt không nén) → giữ nguyên', async () => {
  assert.equal(await unpackUpload(mdb), mdb);
});

test('file nén bị cắt dở → báo lỗi tiếng Việt', async () => {
  const gz = gzipSync(mdb);
  await assert.rejects(unpackUpload(gz.subarray(0, 20)), /giải nén/);
});
