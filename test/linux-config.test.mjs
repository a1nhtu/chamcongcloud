// Bản Linux: chay-app.mjs đọc config.txt giống ChayApp.bat (KEY=VALUE, tách ở dấu "=" đầu tiên)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '../tools/linux/chay-app.mjs';

test('đọc config.txt kiểu Windows (CRLF) + bỏ dòng chú thích', () => {
  const cfg = parseConfig('PORT=8687\r\nCUSTOMER=congtyabc\r\n# MASTER_USER=...\r\nTUNNEL_TOKEN=eyJhIjoi==\r\n\r\nUSE_PHONE=0\r\n');
  assert.deepEqual(cfg, { PORT: '8687', CUSTOMER: 'congtyabc', TUNNEL_TOKEN: 'eyJhIjoi==', USE_PHONE: '0' });
});

test('giá trị có ký tự $ và dấu = (mật khẩu băm) giữ nguyên', () => {
  const cfg = parseConfig('MASTER_HASH=$2a$10$abc=def\nTUNNEL_TOKEN=\n');
  assert.equal(cfg.MASTER_HASH, '$2a$10$abc=def');
  assert.equal(cfg.TUNNEL_TOKEN, '');
});
