// Test masterLogin (server/auth.js) — so sánh MASTER_PASS phải timing-safe nhưng
// kết quả đúng/sai phải y hệt so sánh `===` cũ.
// node --test chạy mỗi file test trong tiến trình RIÊNG → set DB_PATH tạm ở đây không đụng DB khác
// (auth.js import db.js sẽ mở CSDL để lấy jwt_secret).
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DBP = join(tmpdir(), `dgp-masterlogin-test-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
process.env.DB_PATH = DBP;

let masterLogin, masterUsername;
const ORIG_ENV = { MASTER_USER: process.env.MASTER_USER, MASTER_PASS: process.env.MASTER_PASS, MASTER_HASH: process.env.MASTER_HASH };

before(async () => {
  ({ masterLogin, masterUsername } = await import('../server/auth.js'));
});

after(() => {
  for (const [k, v] of Object.entries(ORIG_ENV)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  for (const ext of ['', '-wal', '-shm']) { try { rmSync(DBP + ext); } catch {} }
});

beforeEach(() => {
  delete process.env.MASTER_USER;
  delete process.env.MASTER_PASS;
  delete process.env.MASTER_HASH;
});

test('sai username → luôn false (không đụng nhánh so mật khẩu)', () => {
  process.env.MASTER_PASS = 'bimat123';
  assert.equal(masterLogin('nguoi-la', 'bimat123'), false);
  assert.equal(masterLogin('', 'bimat123'), false);
});

test('MASTER_PASS đúng → đăng nhập được (đúng username mặc định "sadmin")', () => {
  process.env.MASTER_PASS = 'bimat123';
  assert.equal(masterUsername(), 'sadmin');
  assert.equal(masterLogin('sadmin', 'bimat123'), true);
});

test('MASTER_PASS sai (khác độ dài, ngắn hơn/dài hơn) → false, không ném lỗi', () => {
  process.env.MASTER_PASS = 'bimat123';
  assert.doesNotThrow(() => masterLogin('sadmin', 'bimat12'));
  assert.equal(masterLogin('sadmin', 'bimat12'), false);
  assert.equal(masterLogin('sadmin', 'bimat123-dai-hon'), false);
  assert.equal(masterLogin('sadmin', ''), false);
});

test('MASTER_PASS sai (cùng độ dài, khác nội dung) → false', () => {
  process.env.MASTER_PASS = 'bimat123';
  assert.equal(masterLogin('sadmin', 'bimat124'), false);
});

test('password undefined/null → false, không ném lỗi', () => {
  process.env.MASTER_PASS = 'bimat123';
  assert.doesNotThrow(() => masterLogin('sadmin', undefined));
  assert.equal(masterLogin('sadmin', undefined), false);
  assert.equal(masterLogin('sadmin', null), false);
});

test('password không phải string (number) → false như so sánh === cũ', () => {
  process.env.MASTER_PASS = '123456';
  assert.equal(masterLogin('sadmin', 123456), false);
});

test('MASTER_PASS rỗng → rơi về nhánh MASTER_HASH/DEFAULT_MASTER_HASH (không dùng so sánh plain)', () => {
  process.env.MASTER_PASS = '';
  assert.equal(masterLogin('sadmin', ''), false);
  assert.equal(masterLogin('sadmin', 'bat-ky-gi'), false);
});

test('username có khoảng trắng thừa vẫn được trim khi so, mật khẩu đúng vẫn đăng nhập được', () => {
  process.env.MASTER_USER = 'tongquantri';
  process.env.MASTER_PASS = 'matkhaudai-hon-32-ky-tu-de-kiem-tra-pad';
  assert.equal(masterLogin('  tongquantri  ', 'matkhaudai-hon-32-ky-tu-de-kiem-tra-pad'), true);
  assert.equal(masterLogin('tongquantri', 'sai'), false);
});
