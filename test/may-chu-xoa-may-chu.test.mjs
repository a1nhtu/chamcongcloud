// XOÁ HẲN MÁY CHỦ trên trang /may-chu (31/10/2026, gỡ pc1): chỉ xoá máy chủ ĐANG TẮT + không còn link đại lý trỏ vào;
// xoá đúng các tên miền trỏ về tunnel của máy chủ đó (không đụng máy chủ khác) rồi xoá tunnel. Giả lập API Cloudflare.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const W = (await import('../HuongDan/hd-worker.js')).default;
const env = { CF_ZONE: 'z.com', CF_PROVISION_TOKEN: 'tok', DOMAIN_ADMIN_PASS: 'mat-khau-thu', HOST_SECRET: 'bi-mat-thu', LICENSE_SECRET: 'bi-mat-thu' };
let cf, calls;
const reset = () => {
  calls = [];
  cf = {
    tunnels: [{ id: 'T1', name: 'dgphost-pc1', status: 'down', connections: [] }, { id: 'T2', name: 'dgphost-vps', status: 'healthy', connections: [{}] }],
    dns: [{ id: 'd1', type: 'CNAME', name: 'ctl-pc1.z.com', content: 'T1.cfargotunnel.com' }, { id: 'd2', type: 'CNAME', name: 'congty12.z.com', content: 'T1.cfargotunnel.com' },
      { id: 'd3', type: 'CNAME', name: 'anhtu1.z.com', content: 'T2.cfargotunnel.com' }, { id: 'd4', type: 'TXT', name: '_dl-anhtu.z.com', content: '"dgp-dl v=1 host=vps ten=anhtu"' }],
  };
};
const ok = (result) => new Response(JSON.stringify({ success: true, result }), { headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, o = {}) => {
  const u = new URL(url), m = o.method || 'GET';
  calls.push(`${m} ${u.pathname}`);
  if (u.hostname.startsWith('ctl-')) throw new Error('máy chủ tắt');   // gọi máy chủ: đều không trả lời
  const p = u.pathname.replace('/client/v4', '');
  if (p === '/zones') return ok([{ id: 'Z', name: 'z.com', account: { id: 'A' } }]);
  if (p === '/accounts/A/cfd_tunnel') return ok(u.searchParams.get('page') === '1' ? cf.tunnels : []);
  if (p === '/zones/Z/dns_records') return ok(cf.dns.filter((r) => r.type === u.searchParams.get('type')));
  let mm;
  if ((mm = p.match(/^\/zones\/Z\/dns_records\/(\w+)$/)) && m === 'DELETE') { cf.dns = cf.dns.filter((r) => r.id !== mm[1]); return ok({}); }
  if ((mm = p.match(/^\/accounts\/A\/cfd_tunnel\/(\w+)(\/connections)?$/)) && m === 'DELETE') { if (!mm[2]) cf.tunnels = cf.tunnels.filter((t) => t.id !== mm[1]); return ok({}); }
  return new Response(JSON.stringify({ success: false, errors: [{ code: 0, message: 'chưa giả lập ' + m + ' ' + p }] }), { status: 400 });
};
const call = async (body) => {
  const r = await W.fetch(new Request('https://x.dev/api/may-chu', { method: 'POST', body: JSON.stringify({ pass: 'mat-khau-thu', ...body }) }), env);
  return { status: r.status, d: await r.json() };
};

test('máy chủ đang chạy → không cho xoá', async () => {
  reset(); cf.dns = cf.dns.filter((r) => r.type !== 'TXT');
  const r = await call({ action: 'host-delete', host: 'vps', confirm: true });
  assert.equal(r.status, 400); assert.match(r.d.error, /đang chạy/);
  assert.equal(cf.tunnels.length, 2); assert.equal(cf.dns.length, 3);
});

test('máy chủ đã tắt: bước 1 chỉ liệt kê tên miền; bước 2 xoá đúng tên miền của nó + tunnel, không đụng máy chủ khác', async () => {
  reset();
  const p = await call({ action: 'host-delete', host: 'pc1' });
  assert.deepEqual(p.d.names, ['ctl-pc1.z.com', 'congty12.z.com']);
  assert.equal(cf.dns.length, 4, 'xem trước không xoá gì');
  const r = await call({ action: 'host-delete', host: 'pc1', confirm: true });
  assert.equal(r.status, 200);
  assert.deepEqual(cf.dns.map((x) => x.id), ['d3', 'd4']);
  assert.deepEqual(cf.tunnels.map((t) => t.name), ['dgphost-vps']);
});

test('còn link đại lý tạo công ty vào máy chủ → không cho xoá', async () => {
  reset(); cf.dns[3].content = '"dgp-dl v=1 host=pc1 ten=anhtu"';
  const r = await call({ action: 'host-delete', host: 'pc1', confirm: true });
  assert.equal(r.status, 400); assert.match(r.d.error, /anhtu/);
  assert.equal(cf.tunnels.length, 2);
});

test('sai mật khẩu → không làm gì', async () => {
  reset();
  const r = await W.fetch(new Request('https://x.dev/api/may-chu', { method: 'POST', body: JSON.stringify({ pass: 'sai', action: 'host-delete', host: 'pc1', confirm: true }) }), env);
  assert.equal(r.status, 401); assert.equal(cf.tunnels.length, 2);
});
