// CHUYỂN MÁY TỰ CẤP LẠI LICENSE (Anh chốt "Tự cấp lại" 04/11/2026): máy mới gửi license máy cũ + Mã máy mới lên /api/chuyen-may
// → ký license mới GIỮ tên công ty + hạn + số NV. Mỗi license chỉ chuyển 1 lần; license cũ đã bị thay → không chuyển được.
// Khoá ký THỬ (sinh tại chỗ) thay khoá thật: chép worker ra file tạm, đổi khoá công khai nhúng sẵn. Giả lập API Cloudflare (DNS TXT).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, verify, createPublicKey } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const pubB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const src = readFileSync(new URL('../HuongDan/hd-worker.js', import.meta.url), 'utf8');
const realPub = src.match(/const LIC_PUB_DER_B64 = "([^"]+)"/)[1];
const dir = mkdtempSync(join(tmpdir(), 'dgp-worker-'));
writeFileSync(join(dir, 'w.mjs'), src.replace(realPub, pubB64));
const W = (await import(pathToFileURL(join(dir, 'w.mjs')).href)).default;
rmSync(dir, { recursive: true, force: true });

const env = { CF_ZONE: 'z.com', CF_PROVISION_TOKEN: 'tok', LICENSE_PRIVATE_KEY: privPem, LICENSE_ADMIN_PASS: 'mk' };
let dns, failWrite;
const reset = () => { dns = []; failWrite = false; };
const ok = (result) => new Response(JSON.stringify({ success: true, result }), { headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, o = {}) => {
  const u = new URL(url), m = o.method || 'GET', p = u.pathname.replace('/client/v4', '');
  if (p === '/zones') return ok([{ id: 'Z', name: 'z.com', account: { id: 'A' } }]);
  if (p === '/zones/Z/dns_records' && m === 'GET') return ok(dns.filter((r) => r.type === u.searchParams.get('type')));
  if (failWrite && m !== 'GET') return new Response(JSON.stringify({ success: false, errors: [{ code: 1, message: 'ghi lỗi' }] }), { status: 500 });
  if (p === '/zones/Z/dns_records' && m === 'POST') { const r = { id: 'r' + (dns.length + 1), ...JSON.parse(o.body) }; dns.push(r); return ok(r); }
  const mm = p.match(/^\/zones\/Z\/dns_records\/(\w+)$/);
  if (mm && m === 'PUT') { const i = dns.findIndex((r) => r.id === mm[1]); dns[i] = { id: mm[1], ...JSON.parse(o.body) }; return ok(dns[i]); }
  return new Response(JSON.stringify({ success: false, errors: [{ code: 0, message: 'chưa giả lập ' + m + ' ' + p }] }), { status: 400 });
};
const post = async (path, body) => {
  const r = await W.fetch(new Request('https://x.dev' + path, { method: 'POST', body: JSON.stringify(body) }), env);
  return { status: r.status, d: await r.json() };
};
// License tự ký (giống cách app/Anh cấp) — dùng cho trường hợp KHÔNG có trong lịch sử (khách cũ trước khi có lịch sử)
const mkLic = (payload) => {
  const b = Buffer.from(JSON.stringify(payload)).toString('base64');
  return b + '.' + sign(null, Buffer.from(b), privateKey).toString('base64');
};
const payloadOf = (lic) => {
  const [b, s] = lic.split('.');
  assert.ok(verify(null, Buffer.from(b), createPublicKey(privateKey), Buffer.from(s, 'base64')), 'chữ ký license mới phải đúng');
  return JSON.parse(Buffer.from(b, 'base64').toString('utf8'));
};
const A = 'AAAA1111AAAA1111', B = 'BBBB2222BBBB2222', C = 'CCCC3333CCCC3333';
const history = async () => (await post('/api/lic-lich-su', { pass: 'mk', a: 'list' })).d.items;

test('chuyển lần đầu: license mới cho Mã máy mới, giữ công ty + hạn + số NV; lịch sử ghi "chuyen-may"', async () => {
  reset();
  const old = (await post('/api/gen-license', { pass: 'mk', machine: A, company: 'Nhà hàng 3S', exp: '2099-12-31', max: 50 })).d.license;
  const r = await post('/api/chuyen-may', { license: old, machine: 'BBBB-2222-BBBB-2222', customer: '3svina' });
  assert.equal(r.status, 200, JSON.stringify(r.d));
  const p = payloadOf(r.d.license);
  assert.equal(p.m, B); assert.equal(p.c, 'Nhà hàng 3S'); assert.equal(p.e, '2099-12-31'); assert.equal(p.n, 50);
  const h = await history();
  assert.equal(h.length, 1, 'cùng hồ sơ khách, không tạo khách mới');
  assert.equal(h[0].h[0].t, 'chuyen-may'); assert.equal(h[0].h[0].m, B); assert.equal(h[0].h[0].by, '3svina');
  assert.match(h[0].h[0].f, new RegExp('^' + A + '@'));

  // máy mới gửi lại (mất mạng giữa chừng, khởi động lại…) → trả lại license đó, không ghi thêm
  const again = await post('/api/chuyen-may', { license: old, machine: B });
  assert.equal(again.status, 200); assert.equal(again.d.again, true); assert.equal(payloadOf(again.d.license).m, B);
  assert.equal((await history())[0].h.length, 2);

  // license máy cũ dùng lần nữa cho máy thứ 3 → từ chối
  const third = await post('/api/chuyen-may', { license: old, machine: C });
  assert.equal(third.status, 409); assert.match(third.d.error, /đã chuyển sang máy khác/);

  // license MỚI (máy B) chuyển tiếp sang máy C được (đổi máy lần nữa)
  const next = await post('/api/chuyen-may', { license: r.d.license, machine: C });
  assert.equal(next.status, 200, JSON.stringify(next.d)); assert.equal(payloadOf(next.d.license).m, C);
});

test('license cũ đã bị thay bằng lần cấp mới hơn cho máy khác (Anh cấp lại) → không chuyển được', async () => {
  reset();
  const old = mkLic({ c: 'Cty X', m: A, e: null, n: null, i: '2026-01-05' });
  await post('/api/lic-lich-su', { pass: 'mk', a: 'import', lines: old });
  await post('/api/lic-lich-su', { pass: 'mk', a: 'import', lines: mkLic({ c: 'Cty X', m: C, e: null, n: null, i: '2026-06-01' }) });
  const r = await post('/api/chuyen-may', { license: old, machine: B });
  assert.equal(r.status, 409); assert.match(r.d.error, /license mới hơn/);
});

test('khách cũ chưa có lịch sử: vẫn chuyển được + tạo hồ sơ; license vĩnh viễn giữ vĩnh viễn', async () => {
  reset();
  const r = await post('/api/chuyen-may', { license: mkLic({ c: 'Cty Cũ', m: A, e: null, n: 30, i: '2025-03-01' }), machine: B });
  assert.equal(r.status, 200, JSON.stringify(r.d));
  const p = payloadOf(r.d.license);
  assert.equal(p.e, null); assert.equal(p.n, 30); assert.equal(p.m, B);
  const h = await history();
  assert.equal(h.length, 1); assert.equal(h[0].c, 'Cty Cũ');
});

test('từ chối: hết hạn, Mã máy sai, license giả; license mọi máy (*) / đúng máy thì trả lại nguyên, không ghi lịch sử', async () => {
  reset();
  let r = await post('/api/chuyen-may', { license: mkLic({ c: 'Cty', m: A, e: '2020-01-01', n: 5, i: '2019-01-01' }), machine: B });
  assert.equal(r.status, 403); assert.match(r.d.error, /hết hạn/);
  r = await post('/api/chuyen-may', { license: mkLic({ c: 'Cty', m: A, e: null, n: 5, i: '2019-01-01' }), machine: 'xyz' });
  assert.equal(r.status, 400);
  const fake = mkLic({ c: 'Cty', m: A, e: null, n: 5, i: '2019-01-01' }).replace(/\.(.)/, (x, c) => '.' + (c === 'A' ? 'B' : 'A'));
  r = await post('/api/chuyen-may', { license: fake, machine: B });
  assert.equal(r.status, 400);
  const star = mkLic({ c: 'Cty', m: '*', e: null, n: 5, i: '2019-01-01' });
  r = await post('/api/chuyen-may', { license: star, machine: B });
  assert.equal(r.status, 200); assert.equal(r.d.same, true); assert.equal(r.d.license, star);
  assert.equal(dns.length, 0, 'không ghi lịch sử');
});

test('không ghi được lịch sử → KHÔNG cấp (để còn chặn được chuyển lần 2); máy mới tự thử lại (503)', async () => {
  reset(); failWrite = true;
  const r = await post('/api/chuyen-may', { license: mkLic({ c: 'Cty', m: A, e: null, n: 5, i: '2026-01-01' }), machine: B });
  assert.equal(r.status, 503); assert.equal(r.d.license, undefined);
});
