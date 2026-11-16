// Màn Chi nhánh / Định vị: ô tìm địa chỉ (OpenStreetMap) ở VN thường không có số nhà → cho DÁN cặp toạ độ
// hoặc link Google Maps (cả link rút gọn maps.app.goo.gl khi bấm Chia sẻ trên điện thoại) để lấy đúng toạ độ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMapCoords, isGoogleMapsHost, resolveMapCoords } from '../server/geo-link.js';

const near = (a, b) => assert.ok(a && Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lng - b.lng) < 1e-6, JSON.stringify(a) + ' ≠ ' + JSON.stringify(b));

test('cặp số chép từ Google Maps (nhiều kiểu viết)', () => {
  near(parseMapCoords('10.776889, 106.700806'), { lat: 10.776889, lng: 106.700806 });
  near(parseMapCoords(' 21.0459,105.8700 '), { lat: 21.0459, lng: 105.87 });
  near(parseMapCoords('(10.76 106.68)'), { lat: 10.76, lng: 106.68 });
  near(parseMapCoords('10.76°, 106.68°'), { lat: 10.76, lng: 106.68 });
  near(parseMapCoords('106.700806, 10.776889'), { lat: 10.776889, lng: 106.700806 });   // dán ngược
  assert.equal(parseMapCoords('330 Nguyễn Văn Cừ'), null);
  assert.equal(parseMapCoords(''), null);
  assert.equal(parseMapCoords('0, 0'), null);
});

test('link Google Maps đầy đủ: ưu tiên điểm ghim !3d!4d hơn tâm bản đồ @', () => {
  const u = 'https://www.google.com/maps/place/330+Nguy%E1%BB%85n+V%C4%83n+C%E1%BB%AB/@10.7600000,106.6800000,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x1!8m2!3d10.7612345!4d106.6823456!16s';
  near(parseMapCoords(u), { lat: 10.7612345, lng: 106.6823456 });
  near(parseMapCoords('https://www.google.com/maps/@21.0285,105.8542,15z'), { lat: 21.0285, lng: 105.8542 });
  near(parseMapCoords('https://maps.google.com/?q=10.77,106.70'), { lat: 10.77, lng: 106.70 });
  near(parseMapCoords('https://www.google.com/maps/search/?api=1&query=10.77%2C106.70'), { lat: 10.77, lng: 106.70 });
  near(parseMapCoords('https://www.google.com/maps/search/10.776889,+106.700806?entry=tts'), { lat: 10.776889, lng: 106.700806 });
});

test('chỉ mở link của Google (không cho máy chủ khách gọi địa chỉ lạ)', () => {
  for (const u of ['https://maps.app.goo.gl/abc', 'https://goo.gl/maps/xyz', 'https://www.google.com/maps/place/x', 'https://www.google.com.vn/maps', 'https://maps.google.com/?cid=1'])
    assert.equal(isGoogleMapsHost(u), true, u);
  for (const u of ['http://127.0.0.1:8686/api', 'https://google.com.evil.vn/maps', 'https://evilgoogle.com/maps', 'file:///c:/x', 'not a url'])
    assert.equal(isGoogleMapsHost(u), false, u);
});

test('link rút gọn: đi theo chuyển hướng tới link có toạ độ', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === 'https://maps.app.goo.gl/AbC123')
      return { status: 302, ok: false, headers: new Headers({ location: 'https://www.google.com/maps/place/X/@10.7,106.6,17z/data=!3d10.7654321!4d106.6543210' }) };
    throw new Error('không được gọi tiếp');
  };
  near(await resolveMapCoords('Xem ở đây https://maps.app.goo.gl/AbC123', { fetchImpl }), { lat: 10.7654321, lng: 106.654321 });
  assert.deepEqual(calls, ['https://maps.app.goo.gl/AbC123']);
});

test('link rút gọn chuyển hướng ra ngoài Google → dừng, không đi theo', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return { status: 302, ok: false, headers: new Headers({ location: 'http://192.168.1.1/admin' }) };
  };
  await assert.rejects(resolveMapCoords('https://maps.app.goo.gl/zzz', { fetchImpl }), /không kèm toạ độ/);
  assert.equal(calls.length, 1);
});

test('link không ghi toạ độ → KHÔNG đoán từ HTML (đó là vị trí theo IP máy chủ), báo cách chép toạ độ', async () => {
  const html = 'window.APP_INITIALIZATION_STATE=[[[1234.5,105.8615988,20.9963473],[0,0,0]';   // trang thật: tâm = nơi đặt máy chủ
  const fetchImpl = async () => ({ status: 200, ok: true, headers: new Headers(), text: async () => html });
  await assert.rejects(resolveMapCoords('https://www.google.com/maps/place/Ten+cong+ty', { fetchImpl }), /nhấn giữ/);
  await assert.rejects(resolveMapCoords('https://example.com/maps', { fetchImpl }), /Chỉ nhận link Google Maps/);
  await assert.rejects(resolveMapCoords('330 Nguyễn Văn Cừ'), /Không đọc được toạ độ/);
  const offline = async () => { throw new Error('ENOTFOUND'); };
  await assert.rejects(resolveMapCoords('https://maps.app.goo.gl/x', { fetchImpl: offline }), /cần internet/);
});

test('giao diện: ô địa chỉ nhận dán link / toạ độ và gọi API đọc toạ độ', () => {
  const ui = readFileSync(new URL('../public/admin-parts/40-chi-nhanh.js', import.meta.url), 'utf8');
  assert.match(ui, /\/admin\/offices\/parse-location/);
  assert.match(ui, /looksLikeCoordOrLink\(q\)/);
  const org = readFileSync(new URL('../server/routes/admin/org.js', import.meta.url), 'utf8');
  assert.match(org, /r\.post\('\/offices\/parse-location', need\('offices'\)/);
});

test('Tổng quan: chấm ngoài VP ghi rõ so với định vị nào + nút mở Google Maps chỗ chấm (16/11, thephongai)', () => {
  // 16/11 (sau): vị trí hiện dưới TỪNG giờ chấm (geoBlock) thay cho 1 cột "Vị trí" chỉ của giờ vào — test vi-tri-tung-gio-cham.test.mjs
  const ui = readFileSync(new URL('../public/admin-parts/10-tong-quan.js', import.meta.url), 'utf8');
  assert.match(ui, /function geoBlock\(g, t\)/);
  assert.match(ui, /\(g\.out \? 'so với ' : ''\) \+ g\.office/);
  assert.match(ui, /google\.com\/maps\/search\/\?api=1&query=/);
  const rep = readFileSync(new URL('../server/routes/reports.js', import.meta.url), 'utf8');
  assert.match(rep, /SELECT a\.\*, e\.code, e\.full_name, e\.department, oi\.name AS in_office/, 'API Tổng quan phải trả toạ độ lượt chấm + tên định vị');
});

test('Lấy vị trí hiện tại: không dùng vị trí cũ, hiện sai số, sai số lớn (máy tính đoán theo mạng) thì hỏi lại', () => {
  const ui = readFileSync(new URL('../public/admin-parts/40-chi-nhanh.js', import.meta.url), 'utf8');
  assert.match(ui, /maximumAge: 0/);
  assert.match(ui, /const GPS_OK_M = 100/);
  assert.match(ui, /acc > GPS_OK_M\) \{\s*const ok = confirm\(/);
  assert.match(ui, /if \(!ok\) \{ gpsNote\.textContent = `⚠ Chưa lấy/, 'bấm Huỷ thì KHÔNG lấy vị trí sai');
});
