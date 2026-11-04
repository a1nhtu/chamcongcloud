// Bản cài Windows bật node THẲNG (bấm đúp restart-app.vbs) vẫn phải đúng cổng + mã khách trong config.txt.
// 3svina 04/11/2026: bật tay lên cổng 8080 (mặc định) → tunnel trỏ 8697 vẫn 502, thiếu CUSTOMER → Mã máy đổi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig, loadInstallConfig } from '../server/install-config.js';

const makeInstall = (conf, { node = true } = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'dgp-cfg-'));
  if (node) { mkdirSync(join(root, 'runtime')); writeFileSync(join(root, 'runtime', 'node.exe'), ''); }
  writeFileSync(join(root, 'config.txt'), conf);
  return root;
};

test('đọc config.txt như cmd: cắt ở dấu = đầu tiên, bỏ BOM / chú thích / dòng lạ', () => {
  assert.deepEqual(parseConfig('﻿PORT=8697\r\nCUSTOMER=3svina\r\n; chu thich\r\nrem x\r\n\r\nTUNNEL_TOKEN=ab=cd==\r\n'),
    { PORT: '8697', CUSTOMER: '3svina', TUNNEL_TOKEN: 'ab=cd==' });
});

test('bật thẳng (không có biến môi trường) → điền PORT, CUSTOMER, TUNNEL_TOKEN từ config.txt', () => {
  const root = makeInstall('PORT=8697\r\nCUSTOMER=3svina\r\nTUNNEL_TOKEN=tok\r\n');
  try {
    const env = {};
    assert.deepEqual(loadInstallConfig(root, env).sort(), ['CUSTOMER', 'PORT', 'TUNNEL_TOKEN']);
    assert.equal(env.PORT, '8697');
    assert.equal(env.CUSTOMER, '3svina');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('bật qua ChayApp.bat / CapNhat.bat (biến đã có) → không đè', () => {
  const root = makeInstall('PORT=8697\r\nCUSTOMER=3svina\r\n');
  try {
    const env = { PORT: '9000' };
    assert.deepEqual(loadInstallConfig(root, env), ['CUSTOMER']);
    assert.equal(env.PORT, '9000');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('không phải bản cài cho khách (không có runtime\\node.exe) → không đụng gì', () => {
  const root = makeInstall('PORT=8697\r\n', { node: false });
  try {
    const env = {};
    assert.deepEqual(loadInstallConfig(root, env), []);
    assert.equal(env.PORT, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
