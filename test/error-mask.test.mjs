// Test hàm che lỗi hệ thống dùng chung (server/util.js: userError, sendCaughtError).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { userError, sendCaughtError } from '../server/util.js';

// res giả để bắt lại status()/json() đã gọi
function fakeRes() {
  return {
    _status: null, _body: null,
    status(s) { this._status = s; return this; },
    json(b) { this._body = b; return this; },
  };
}

test('userError() đánh dấu lỗi nghiệp vụ (userFacing) với message + status tuỳ chỉnh', () => {
  const e = userError('Bộ phận đã tồn tại', 409);
  assert.equal(e.message, 'Bộ phận đã tồn tại');
  assert.equal(e.userFacing, true);
  assert.equal(e.status, 409);
});

test('userError() mặc định status 400', () => {
  const e = userError('Thiếu dữ liệu');
  assert.equal(e.status, 400);
});

test('sendCaughtError() với lỗi nghiệp vụ (userError) trả nguyên văn message + status của lỗi', () => {
  const res = fakeRes();
  const e = userError('File không phải cơ sở dữ liệu Digiplus hợp lệ', 400);
  sendCaughtError(res, 'POST /admin/backup/restore', e);
  assert.equal(res._status, 400);
  assert.deepEqual(res._body, { error: 'File không phải cơ sở dữ liệu Digiplus hợp lệ' });
});

test('sendCaughtError() với lỗi hệ thống bình thường (Error thô) che message, không lộ chi tiết', () => {
  const res = fakeRes();
  const e = new Error('SQLITE_CONSTRAINT: NOT NULL constraint failed: employees.code');
  // Chặn console.error khi test để không in log rác ra output
  const origError = console.error;
  let logged = null;
  console.error = (...args) => { logged = args; };
  try {
    sendCaughtError(res, 'PUT /admin/employees/:id', e);
  } finally { console.error = origError; }
  assert.equal(res._status, 500);
  assert.equal(res._body.error, 'Có lỗi hệ thống, vui lòng thử lại hoặc liên hệ Digiplus');
  // Không được để lộ nội dung lỗi SQLite gốc trong response
  assert.ok(!res._body.error.includes('SQLITE'));
  assert.ok(!res._body.error.includes('employees.code'));
  // Nhưng vẫn phải log đầy đủ ra server (kèm tên route) để tra được nguyên nhân
  assert.ok(logged[0].includes('PUT /admin/employees/:id'));
  assert.equal(logged[1], e);
});

test('sendCaughtError() cho phép tuỳ chỉnh status và message chung khi che lỗi', () => {
  const res = fakeRes();
  const e = new Error('ENOENT: no such file or directory, open \'/data/backups/xyz.zip\'');
  const origError = console.error;
  console.error = () => {};
  try {
    sendCaughtError(res, 'POST /admin/backup/full', e, {
      status: 400,
      message: 'Không tạo được bản sao lưu toàn bộ, vui lòng thử lại hoặc liên hệ Digiplus',
    });
  } finally { console.error = origError; }
  assert.equal(res._status, 400);
  assert.equal(res._body.error, 'Không tạo được bản sao lưu toàn bộ, vui lòng thử lại hoặc liên hệ Digiplus');
  assert.ok(!res._body.error.includes('ENOENT'));
  assert.ok(!res._body.error.includes('/data/'));
});
