// TRANG QUẢN LÝ viết thành nhiều file trong public/admin-parts, máy chủ ghép lại thành /admin.js (server/admin-bundle.js).
// Các ca dưới đây chặn những lỗi dễ gặp khi sửa: cắt phần sai chỗ, đặt tên phần sai quy ước, để sót file admin.js cũ,
// thêm dòng import ngoài phần đầu (import phải đứng đầu file ghép). Chạy: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { adminBundle, adminParts, adminLocate, ADMIN_PARTS_DIR } from '../server/admin-bundle.js';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const check = (file) => execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });

test('các phần đặt tên đúng quy ước, theo thứ tự, phần đầu là 00-khung.js', () => {
  const parts = adminParts();
  assert.ok(parts.length >= 10, 'phải có nhiều phần');
  assert.equal(parts[0], '00-khung.js');
  assert.deepEqual(parts, parts.slice().sort());
  const la = readdirSync(ADMIN_PARTS_DIR).filter((f) => !parts.includes(f));
  assert.deepEqual(la, [], 'file trong admin-parts không đúng dạng NN-ten.js sẽ KHÔNG được ghép: ' + la.join(', '));
});

test('không còn file public/admin.js (chỉ một nguồn duy nhất là admin-parts); admin.html vẫn nạp /admin.js', () => {
  assert.equal(existsSync(join(PUBLIC, 'admin.js')), false, 'đừng tạo lại public/admin.js — sửa trong public/admin-parts');
  assert.match(readFileSync(join(PUBLIC, 'admin.html'), 'utf8'), /src="\/admin\.js"/);
});

test('file ghép = đúng các phần nối liền nhau, đúng cú pháp; chỉ phần đầu có dòng import', () => {
  const parts = adminParts();
  const text = adminBundle();
  assert.equal(text, parts.map((f) => readFileSync(join(ADMIN_PARTS_DIR, f), 'utf8')).join(''));
  const dir = mkdtempSync(join(tmpdir(), 'dgp-admin-ghep-'));
  try {
    const f = join(dir, 'admin.mjs'); writeFileSync(f, text); check(f);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  for (const p of parts.slice(1)) {
    assert.equal(/^import\s/m.test(readFileSync(join(ADMIN_PARTS_DIR, p), 'utf8')), false, p + ': dòng import chỉ được đặt trong 00-khung.js');
  }
});

test('từng phần tự nó đúng cú pháp (chỗ cắt nằm ở cấp ngoài cùng, không cắt giữa hàm)', () => {
  for (const p of adminParts()) check(join(ADMIN_PARTS_DIR, p));
});

test('adminLocate: dòng của file ghép → phần nào, dòng mấy', () => {
  const parts = adminParts();
  const lines = (f) => { const t = readFileSync(join(ADMIN_PARTS_DIR, f), 'utf8'); return t.split('\n').length - (t.endsWith('\n') ? 1 : 0); };
  const n0 = lines(parts[0]);
  assert.deepEqual(adminLocate(1), { file: parts[0], line: 1 });
  assert.deepEqual(adminLocate(n0), { file: parts[0], line: n0 });
  assert.deepEqual(adminLocate(n0 + 1), { file: parts[1], line: 1 });
  const total = parts.reduce((s, f) => s + lines(f), 0);
  assert.deepEqual(adminLocate(total), { file: parts[parts.length - 1], line: lines(parts[parts.length - 1]) });
  assert.equal(adminLocate(total + 1), null);
  assert.equal(adminLocate(0), null);
});

test('sửa 1 phần thì lần đọc sau nhận nội dung mới (không cần khởi động lại máy chủ)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dgp-admin-parts-'));
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '00-a.js'), 'const a = 1;\n');
    writeFileSync(join(dir, '10-b.js'), 'const b = 2;\n');
    writeFileSync(join(dir, 'ghi-chu.txt'), 'không ghép');
    assert.equal(adminBundle(dir), 'const a = 1;\nconst b = 2;\n');
    writeFileSync(join(dir, '10-b.js'), 'const b = 22222;\n');
    assert.equal(adminBundle(dir), 'const a = 1;\nconst b = 22222;\n');
    writeFileSync(join(dir, '05-giua.js'), 'const m = 0;\n');
    assert.equal(adminBundle(dir), 'const a = 1;\nconst m = 0;\nconst b = 22222;\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
