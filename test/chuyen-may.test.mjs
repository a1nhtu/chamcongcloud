// CHUYỂN PHẦN MỀM SANG MÁY KHÁC (Anh 04/11/2026: "gỡ cài đặt rồi nén zip rồi đưa sang máy khác cài đúng đường dẫn… phức tạp quá"
// → chốt "Tự cấp lại"). Máy cũ: 1 nút ra 1 file ChuyenMay-*.zip rồi tắt hẳn. Máy mới: Setup.exe › "Chuyển từ máy cũ" › chọn file
// → phần mềm tự nhận dữ liệu + tự đổi license sang Mã máy mới (máy chủ: test/chuyen-may-license.test.mjs). Chạy: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DBP = join(tmpdir(), `dgp-chuyen-may-test-${process.pid}.db`);
const clean = () => { for (const ext of ['', '-wal', '-shm', '.restore']) { try { rmSync(DBP + ext); } catch {} } };
clean();
process.env.DB_PATH = DBP;
delete process.env.CUSTOMER; delete process.env.TUNNEL_TOKEN;

const WIN = process.platform === 'win32';
const TMP = mkdtempSync(join(tmpdir(), 'dgp-chuyen-may-'));
let D, CM, NH, F, A, DS, LIC;
before(async () => {
  D = await import('../server/db.js'); D.initSchema();
  CM = await import('../server/chuyen-may.js');
  NH = await import('../server/chuyen-may-nhan.js');
  F = await import('../server/move-flag.js');
  A = await import('../server/autostart.js');
  DS = await import('../server/device-sync.js');
  LIC = await import('../server/license.js');
});
after(() => { try { F.setMoving(null); } catch {} rmSync(TMP, { recursive: true, force: true }); clean(); });

// Thư mục cài giả: <root>\runtime\node.exe + config.txt (+ app\data cho phía máy mới)
function fakeInstall(name, cfg = 'PORT=8686\r\n') {
  const root = join(TMP, name);
  mkdirSync(join(root, 'runtime'), { recursive: true });
  writeFileSync(join(root, 'runtime', 'node.exe'), '');
  writeFileSync(join(root, 'config.txt'), cfg);
  const app = join(root, 'app');
  mkdirSync(join(app, 'data'), { recursive: true });
  return { root, app };
}
const zipList = (zip) => execFileSync(CM_TAR(), ['-tf', zip], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).filter(Boolean);
const CM_TAR = () => (WIN ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'bsdtar');
// Đóng 1 file chuyển máy bằng tay (giống máy cũ đóng) để thử phía máy mới
function makeZip(dir, files) {
  const st = join(dir, '_st'); mkdirSync(st, { recursive: true });
  for (const [n, c] of Object.entries(files)) { mkdirSync(join(st, n, '..'), { recursive: true }); writeFileSync(join(st, n), c); }
  const zip = join(dir, 'pkg.zip');
  execFileSync(CM_TAR(), ['--format', 'zip', '-cf', zip, '-C', st, ...readdirSync(st)], { windowsHide: true });
  rmSync(st, { recursive: true, force: true });
  return zip;
}
const sqliteBytes = () => Buffer.concat([Buffer.from('SQLite format 3\0', 'latin1'), Buffer.alloc(100)]);
const resMock = () => {
  const r = { code: 200, body: null, type() { return r; }, status(c) { r.code = c; return r; }, send(b) { r.body = b; return r; }, json(b) { r.body = b; return r; }, download(p, n) { r.dl = [p, n]; return r; } };
  return r;
};
const guard = (method, path) => { const res = resMock(); let passed = false; CM.moveGuard({ method, path }, res, () => { passed = true; }); return { passed, res }; };

test('đang chuyển: máy chấm công + ghi dữ liệu nhận 503 (máy tự giữ lượt, gửi lại sang máy mới); trang Sao lưu / đăng nhập / license vẫn chạy', () => {
  assert.equal(guard('POST', '/iclock/cdata').passed, true, 'chưa chuyển thì không chặn gì');
  F.setMoving({ at: 'x', token: 't' });
  try {
    for (const p of ['/iclock/cdata', '/iclock/getrequest', '/cdata', '/hik/event', '/ICLOCK/cdata']) {
      const { passed, res } = guard('GET', p);
      assert.equal(passed, false, p); assert.equal(res.code, 503); assert.equal(res.body, 'MOVING');
    }
    const w = guard('POST', '/api/admin/employees');
    assert.equal(w.passed, false); assert.equal(w.res.code, 503); assert.match(w.res.body.error, /đang chuyển/);
    assert.equal(guard('POST', '/api/phone/punch').passed, false, 'chấm điện thoại cũng chờ');
    for (const [m, p] of [['GET', '/api/admin/employees'], ['POST', '/api/admin/backup/chuyen-may/tat'], ['POST', '/api/auth/login'],
      ['POST', '/api/license/move-retry'], ['GET', '/admin/'], ['GET', '/api/chuyen-may/tai']])
      assert.equal(guard(m, p).passed, true, `${m} ${p}`);
    assert.throws(() => DS.ingestAttlog('SN1', '1\t2026-11-04 08:00:00\t0\t1'), /chuyển phần mềm/, 'đường nhận lượt chấm (union, AI, hik kéo về) cũng chặn');
  } finally { F.setMoving(null); }
  assert.equal(guard('POST', '/api/admin/employees').passed, true);
});

test('cờ đang chuyển tự bỏ sau 2 giờ (quên bấm tắt máy cũ thì máy cũ nhận dữ liệu lại như thường)', () => {
  F.setMoving({ at: 'x' });
  assert.ok(F.movingOut());
  assert.equal(F.MOVE_HOLD_MS, 2 * 3600 * 1000);
  F.movingOut().until = Date.now() - 1;
  assert.equal(F.movingOut(), null);
});

test('bản không phải bản cài Windows (thiếu runtime\\node.exe) → báo không dùng được, không tạo file', () => {
  const root = join(TMP, 'khong-phai-ban-cai'); mkdirSync(root, { recursive: true });
  const i = CM.moveInfo(root);
  assert.equal(i.available, false); assert.ok(i.reason);
  assert.throws(() => CM.startMovePackage(root), /không phải bản cài|Chỉ dùng/);
});

test('máy cũ: đóng file (CSDL + cấu hình + license + ảnh) → link tải có mã → bấm tắt: dấu đã chuyển + cất license; máy mới nhận đủ', { skip: !WIN }, async () => {
  const old = fakeInstall('may-cu', 'PORT=8697\r\nCUSTOMER=\r\n');
  D.db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES ('company_name', 'Nhà hàng Thử Chuyển Máy')").run();
  const r = await CM.createMovePackage(old.root);
  assert.match(r.name, /^ChuyenMay-LAN-\d{8}-\d{4}\.zip$/);
  assert.ok(existsSync(r.path) && r.size > 0);
  const names = zipList(r.path);
  for (const n of ['digiplus.db', 'chuyen-may.json', 'config.txt']) assert.ok(names.includes(n), n + ' phải có trong file');
  assert.ok(!names.some((n) => n.startsWith('_chuyen_may_')), 'không lẫn thư mục tạm');
  assert.ok(!readdirSync(D.dataDir()).some((n) => n.startsWith('_chuyen_may_')), 'dọn thư mục tạm');

  // đang chuyển: trang thấy file đang chờ, link tải sai mã → 404
  const info = CM.moveInfo(old.root);
  assert.equal(info.available, true); assert.equal(info.pending.name, r.name); assert.equal(info.pending.token, r.token);
  let res = resMock(); CM.moveDownload({ query: { k: 'sai' } }, res); assert.equal(res.code, 404);
  res = resMock(); CM.moveDownload({ query: { k: r.token } }, res); assert.deepEqual(res.dl, [r.path, r.name]);
  assert.equal(guard('POST', '/iclock/cdata').res.code, 503, 'từ lúc chụp CSDL là chặn nhận lượt chấm');

  // bấm "đã có file — tắt phần mềm" (exit:false để không tắt tiến trình test)
  const data = join(old.app, 'data'); writeFileSync(join(data, 'license.key'), 'LIC-MAY-CU');
  const f = CM.finishMove(old.root, { exit: false, data });
  assert.equal(f.ok, true);
  assert.match(readFileSync(join(old.root, CM.MOVED_MARKER), 'utf8'), new RegExp(`cong ${process.env.PORT || '8686'} da chuyen sang may khac`));
  assert.ok(!existsSync(join(data, 'license.key')) && readFileSync(join(data, 'license.key.da-chuyen-may'), 'utf8') === 'LIC-MAY-CU');

  // máy mới: Setup.exe chép file thành ChuyenMay-nhan.zip → phần mềm khởi động nhận dữ liệu
  const neu = fakeInstall('may-moi');
  copyFileSync(r.path, join(neu.root, NH.INCOMING));
  const got = NH.applyIncomingMove(neu.root, neu.app);
  assert.equal(got.ok, true, got.error);
  assert.equal(got.manifest.company, 'Nhà hàng Thử Chuyển Máy'); assert.equal(got.manifest.port, '' + (process.env.PORT || ''));
  assert.ok(readFileSync(DBP + '.restore').subarray(0, 15).toString('latin1') === 'SQLite format 3', 'CSDL đặt chờ phục hồi (db.js thay lúc mở)');
  assert.ok(!existsSync(join(neu.root, NH.INCOMING)) && existsSync(join(neu.root, NH.INCOMING + '.da-nhap')), 'nhận 1 lần, không nhận lại mỗi lần khởi động');
  assert.equal(NH.applyIncomingMove(neu.root, neu.app), null);
  F.setMoving(null);
});

test('máy mới: license máy cũ không dùng được ở đây → để chờ đổi; ảnh + giấy tờ NV thay bằng của máy cũ; file hỏng → đổi tên .loi', { skip: !WIN }, () => {
  const neu = fakeInstall('may-moi-2');
  mkdirSync(join(neu.app, 'uploads', 'cu'), { recursive: true }); writeFileSync(join(neu.app, 'uploads', 'cu', 'a.jpg'), 'anh-may-moi');
  const zip = makeZip(TMP, {
    'chuyen-may.json': JSON.stringify({ v: 1, customer: 'abc', at: '2026-11-04T10:00:00Z' }),
    'digiplus.db': sqliteBytes(), 'config.txt': 'PORT=8697\r\nCUSTOMER=abc\r\n', 'license.key': 'eyJjIjoiQ3R5In0.khongphaichuky',
    'uploads/punch/1.jpg': 'anh-1', 'hr-files/nv1/hd.pdf': 'pdf',
  });
  copyFileSync(zip, join(neu.root, NH.INCOMING));
  const got = NH.applyIncomingMove(neu.root, neu.app);
  assert.equal(got.ok, true, got.error); assert.equal(got.license, 'pending');
  assert.equal(readFileSync(join(neu.app, 'data', 'license.chuyen-may'), 'utf8'), 'eyJjIjoiQ3R5In0.khongphaichuky');
  assert.ok(!existsSync(join(neu.app, 'data', 'license.key')), 'không ghi license không dùng được');
  assert.equal(readFileSync(join(neu.app, 'uploads', 'punch', '1.jpg'), 'utf8'), 'anh-1');
  assert.ok(!existsSync(join(neu.app, 'uploads', 'cu')), 'ảnh = đúng của máy cũ');
  assert.equal(readFileSync(join(neu.app, 'data', 'hr-files', 'nv1', 'hd.pdf'), 'utf8'), 'pdf');
  assert.deepEqual(NH.moveState(neu.app), { pending: true, error: '', stopped: false, tries: 0 });

  // file không phải file chuyển máy / thiếu CSDL → không đụng gì, đổi tên .loi (không thử lại mỗi lần khởi động)
  for (const files of [{ 'abc.txt': 'x' }, { 'chuyen-may.json': '{}', 'digiplus.db': 'khong phai sqlite' }]) {
    const bad = fakeInstall('may-moi-loi-' + Object.keys(files).length);
    rmSync(join(TMP, 'pkg.zip'), { force: true });
    copyFileSync(makeZip(TMP, files), join(bad.root, NH.INCOMING));
    const e = NH.applyIncomingMove(bad.root, bad.app);
    assert.equal(e.ok, false); assert.match(e.error, /không phải file chuyển máy|thiếu dữ liệu/);
    assert.ok(existsSync(join(bad.root, NH.INCOMING + '.loi')) && !existsSync(join(bad.root, NH.INCOMING)));
  }
});

test('máy mới đổi license: máy chủ từ chối → dừng + hiện lý do; mất mạng / máy chủ bận → tự thử lại; nhận được → lưu, hết chờ', { skip: !WIN }, async () => {
  const neu = fakeInstall('may-moi-3');
  const pend = join(neu.app, 'data', 'license.chuyen-may');
  writeFileSync(pend, 'LIC-MAY-CU');
  let reply = { status: 409, body: { error: 'License này đã chuyển sang máy khác' } }, seen = null;
  const srv = createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      seen = { path: req.url, body: JSON.parse(b) };
      res.writeHead(reply.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  process.env.DGP_HUB = 'http://127.0.0.1:' + srv.address().port;
  try {
    assert.equal(await NH.claimOnce(neu.app), 'refused');
    assert.equal(seen.path, '/api/chuyen-may');
    assert.deepEqual(seen.body, { license: 'LIC-MAY-CU', machine: LIC.machineId(), customer: '' });
    assert.match(NH.moveState(neu.app).error, /đã chuyển sang máy khác/); assert.equal(NH.moveState(neu.app).stopped, true);
    assert.ok(existsSync(pend), 'giữ license cũ để Digiplus xem / thử lại');

    reply = { status: 503, body: { error: 'bận' } };
    assert.equal(await NH.claimOnce(neu.app), 'retry');
    reply = { status: 429, body: {} };
    assert.equal(await NH.claimOnce(neu.app), 'retry');

    // máy chủ trả license KHÔNG khớp máy này → không lưu
    reply = { status: 200, body: { license: 'eyJ4IjoxfQ.sai' } };
    assert.equal(await NH.claimOnce(neu.app), 'refused');
    assert.ok(!existsSync(join(neu.app, 'data', 'license.key')));

    // nhận license dùng được (license thật của máy dev, nếu có) → lưu + hết chờ
    let devKey = '';
    try { devKey = readFileSync(join(D.dataDir(), 'license.key'), 'utf8').trim(); } catch {}
    if (devKey && LIC.verifyLicense(devKey).valid) {
      reply = { status: 200, body: { license: devKey } };
      assert.equal(await NH.claimOnce(neu.app), 'done');
      assert.equal(readFileSync(join(neu.app, 'data', 'license.key'), 'utf8'), devKey);
      assert.ok(!existsSync(pend)); assert.equal(NH.moveState(neu.app), null);
      assert.equal(await NH.claimOnce(neu.app), 'none');
    }
  } finally { delete process.env.DGP_HUB; srv.close(); }

  // không có mạng (máy chủ không nghe) → 'retry'
  writeFileSync(pend, 'LIC-MAY-CU'); rmSync(join(neu.app, 'data', 'license.key'), { force: true });
  process.env.DGP_HUB = 'http://127.0.0.1:1';
  try { assert.equal(await NH.claimOnce(neu.app), 'retry'); assert.match(NH.moveState(neu.app).error, /Internet/); }
  finally { delete process.env.DGP_HUB; }
});

test('máy cũ đã chuyển: ChayApp.bat (lịch gác 5 phút, lịch đăng nhập) không bật lại; CaiDat.bat (cài lại) bỏ dấu', () => {
  const lines = A.CHAY_APP_BAT.split(/\r?\n/);
  const i = lines.findIndex((l) => l.includes('DA-CHUYEN-MAY.txt'));
  assert.ok(i > 0); assert.match(lines[i], /^if exist "%~dp0DA-CHUYEN-MAY\.txt" exit \/b$/);
  assert.ok(i < lines.findIndex((l) => /cloudflared|node\.exe/i.test(l)), 'chặn TRƯỚC khi bật tunnel / node');
  assert.doesNotMatch(A.CHAY_APP_BAT, /[^\x00-\x7f]/);
  const build = readFileSync(new URL('../tools/build-package.mjs', import.meta.url), 'utf8');
  assert.match(build, /:main\r?\ncd \/d "%~dp0"\r?\nrem [^\n]*\r?\nif exist "%~dp0DA-CHUYEN-MAY\.txt" del "%~dp0DA-CHUYEN-MAY\.txt" >nul 2>&1/);
});

test('tắt máy cũ: xoá 3 lịch + lối tắt khởi động của ĐÚNG cổng, chỉ tắt cloudflared của thư mục này / đúng token', () => {
  const s = CM.stopScript("D:\\Cham Cong\\Digiplus O'Neil", '8697', 'TOKEN123');
  for (const n of ['Digiplus-8697', 'Digiplus-8697-logon', 'Digiplus-8697-watch']) assert.ok(s.includes(`'${n}'`), n);
  assert.match(s, /DigiplusChamCong-8697\.lnk/);
  assert.ok(s.includes("$d='D:\\Cham Cong\\Digiplus O''Neil\\'"), 'đường dẫn có nháy đơn vẫn đúng');
  assert.ok(s.includes("$tk='TOKEN123'"));
  assert.match(s, /\$_\.Name -eq 'cloudflared\.exe'/);
  assert.doesNotMatch(s, /node\.exe/, 'không tắt node của khách khác trên cùng máy (tiến trình này tự thoát)');
});

test('Setup.exe có lựa chọn "Chuyển từ máy cũ": chọn file, lấy cấu hình trong file, chép thành ChuyenMay-nhan.zip', () => {
  const iss = readFileSync(new URL('../tools/installer/DigiplusSetup.iss', import.meta.url), 'utf8');
  assert.match(iss, /MODE_MOVE = 3;/);
  assert.match(iss, /ModePage\.Add\('Chuyển từ máy cũ/);
  assert.match(iss, /CreateInputFilePage\(ModePage\.ID, 'Chuyển từ máy cũ'/);
  assert.ok(iss.includes("ExpandConstant('{sys}\\tar.exe')") && !iss.includes('{sys}\t'), 'đường dẫn tar.exe đúng (không lọt ký tự tab)');
  assert.match(iss, /config\.txt chuyen-may\.json/);
  assert.match(iss, /FileCopy\(MoveFile, Dir \+ 'ChuyenMay-nhan\.zip', False\)/);
  assert.match(iss, /else if M = 'move' then begin/);
  assert.match(iss, /function ValidPort\(const S: String\): Boolean; forward;/);
});
