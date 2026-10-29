// CHỌN FILE .mdb NGAY TRÊN MÁY CÀI DIGIPLUS (nhahanggiadinh 29/10/2026: hộp chọn file của trình duyệt treo trang qua UltraViewer,
// file Wise Eye lại để ổ D chứ không ở chỗ mặc định). Tự tìm trên các ổ + duyệt thư mục — chỉ đọc tên file. Chạy: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

const ROOT = join(tmpdir(), `dgp-chon-mdb-${process.pid}`);
const mk = (rel) => { const p = join(ROOT, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, 'x'); return p; };
let F;
before(async () => {
  mk('PhanMem/WiseEyeV5.1/Data/WiseEyeV5.1.mdb');             // thư mục Wise Eye → lấy
  mk('Ke toan/Backup cu/RJData.mdb');                          // tên file Ronald Jack → lấy
  mk('PhanMem/WiseEyeV5.1/Data/ghi chu.txt');                  // không phải .mdb
  mk('Ke toan/SoSach.mdb');                                    // .mdb khác, không liên quan → bỏ
  mk('node_modules/wiseeye/x.mdb');                            // thư mục bỏ qua
  mk('a/b/c/d/e/f/g/h/i/WiseEye.mdb');                         // sâu quá giới hạn
  F = await import('../server/legacy-files.js');
});
after(() => rmSync(ROOT, { recursive: true, force: true }));

test('Tìm file: thấy file Wise Eye / Ronald Jack ở mọi thư mục, bỏ file .mdb lạ, thư mục hệ thống, quá sâu', async () => {
  const r = await F.findLegacyFiles({ roots: [ROOT], depth: 8 });
  assert.deepEqual(r.files.map((f) => f.path.slice(ROOT.length + 1).replace(/\\/g, '/')).sort(),
    ['Ke toan/Backup cu/RJData.mdb', 'PhanMem/WiseEyeV5.1/Data/WiseEyeV5.1.mdb']);
  assert.equal(r.timedOut, false);
  assert.ok(r.files.every((f) => f.size === 1 && f.mtime));
});

test('Duyệt thư mục: thư mục con + chỉ file .mdb; lên thư mục trên; thư mục không có thì báo lỗi rõ', async () => {
  const d = await F.listDir(join(ROOT, 'PhanMem', 'WiseEyeV5.1', 'Data'));
  assert.deepEqual(d.files.map((f) => f.name), ['WiseEyeV5.1.mdb']);
  assert.equal(d.parent, join(ROOT, 'PhanMem', 'WiseEyeV5.1'));
  const top = await F.listDir(ROOT);
  assert.deepEqual(top.dirs.map((x) => x.name), ['a', 'Ke toan', 'node_modules', 'PhanMem']);
  const drv = await F.listDir('');
  assert.ok(drv.dirs.length >= 1 && drv.parent === null, 'rỗng = danh sách ổ đĩa');
  await assert.rejects(F.listDir(join(ROOT, 'khong-co')), /Không mở được thư mục/);
});
