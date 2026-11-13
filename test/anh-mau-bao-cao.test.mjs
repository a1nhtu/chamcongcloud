// Nút "👁 Xem mẫu" ở màn Báo cáo: mỗi báo cáo trong REPORT_SAMPLES phải có ảnh mẫu (theo ca + theo giờ nếu mẫu theo giờ có báo cáo đó),
// và danh sách khớp với script tạo ảnh (tools/anh-mau-bao-cao/xuat-excel-mau.mjs) — thêm báo cáo mới mà quên tạo ảnh thì test báo. Chạy: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';

const arr = (src, name) => {
  const m = src.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  assert.ok(m, 'không thấy ' + name);
  return [...m[1].matchAll(/'([a-z0-9]+)'/g)].map((x) => x[1]);
};
const ui = readFileSync(new URL('../public/admin-parts/84-may-hikvision-ai.js', import.meta.url), 'utf8');
const tool = readFileSync(new URL('../tools/anh-mau-bao-cao/xuat-excel-mau.mjs', import.meta.url), 'utf8');
const SAMPLES = arr(ui, 'REPORT_SAMPLES'), HIDE = arr(ui, 'REPORT_HOURLY_HIDE');

test('mỗi báo cáo có nút Xem mẫu đều có ảnh (theo ca + theo giờ), ảnh không rỗng', () => {
  assert.ok(SAMPLES.length >= 20);
  for (const v of SAMPLES) {
    for (const f of [v, ...(HIDE.includes(v) ? [] : [v + '-gio'])]) {
      const p = new URL(`../public/mau-bao-cao/${f}.png`, import.meta.url);
      assert.ok(existsSync(p), `thiếu ảnh mẫu public/mau-bao-cao/${f}.png — chạy tools/anh-mau-bao-cao/TaoAnhMau.bat`);
      assert.ok(statSync(p).size > 5000, `ảnh ${f}.png rỗng / hỏng`);
    }
  }
});

test('danh sách báo cáo có ảnh mẫu khớp với script tạo ảnh; mọi thẻ báo cáo (trừ công ảo) đều có ảnh', () => {
  assert.deepEqual(arr(tool, 'TYPES'), SAMPLES);
  assert.deepEqual(arr(tool, 'HOURLY_HIDE'), HIDE);
  const groups = ui.slice(ui.indexOf('const REPORT_GROUPS'), ui.indexOf('const REPORT_SAMPLES'));
  const cards = [...groups.matchAll(/\['([a-z0-9]+)', '/g)].map((x) => x[1]).filter((v) => !v.startsWith('audit3'));
  assert.deepEqual(cards.filter((v) => !SAMPLES.includes(v)), [], 'thẻ báo cáo chưa có ảnh mẫu');
});
