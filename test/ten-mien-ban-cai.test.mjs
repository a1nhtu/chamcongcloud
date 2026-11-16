// Tên miền của bản cài 1 công ty (installDomain): có CUSTOMER + TUNNEL_TOKEN mới là bản tên miền, thiếu 1 trong 2 = bản LAN.
// node --test chạy mỗi file ở tiến trình RIÊNG → đặt biến môi trường ở đây không ảnh hưởng test khác.
import { test } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.MULTI_TENANT;
const { installDomain } = await import('../server/tenant.js');

test('bản 1 công ty: CUSTOMER + TUNNEL_TOKEN → <khách>.maychamcongcloud.com, thiếu 1 trong 2 → bản LAN', () => {
  process.env.CUSTOMER = ' ThuNghiem '; process.env.TUNNEL_TOKEN = 'abc=';
  assert.equal(installDomain(), 'thunghiem.maychamcongcloud.com');
  delete process.env.TUNNEL_TOKEN;
  assert.equal(installDomain(), '');
  process.env.TUNNEL_TOKEN = 'abc='; process.env.CUSTOMER = '';
  assert.equal(installDomain(), '');
});
