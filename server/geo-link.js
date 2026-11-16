// Lấy TOẠ ĐỘ từ chữ người dùng dán vào màn Chi nhánh / Định vị:
//   - cặp số "10.776889, 106.700806" (chép từ Google Maps: nhấn giữ 1 điểm → bấm vào toạ độ)
//   - link Google Maps đầy đủ (…/place/…/@lat,lng,17z/data=…!3d<lat>!4d<lng>, ?q=lat,lng, ?ll=…)
//   - link rút gọn khi bấm "Chia sẻ" trên điện thoại (maps.app.goo.gl/…, goo.gl/maps/…) → máy chủ tự mở link để lấy link đầy đủ
// Lý do: ô tìm địa chỉ dùng dữ liệu OpenStreetMap, ở VN thường KHÔNG có số nhà (vd "330 Nguyễn Văn Cừ" không ra).

const N = '(-?\\d{1,3}(?:\\.\\d+)?)';

function valid(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}
function pick(a, b) {
  const lat = parseFloat(a), lng = parseFloat(b);
  if (valid(lat, lng)) return { lat, lng };
  if (valid(lng, lat)) return { lat: lng, lng: lat };   // dán ngược "kinh độ, vĩ độ"
  return null;
}
function safeDecode(s) {
  let out = String(s);
  for (let i = 0; i < 3; i++) { try { const d = decodeURIComponent(out); if (d === out) break; out = d; } catch { break; } }
  return out.replace(/\+/g, ' ');
}

// Trả { lat, lng } hoặc null. Không gọi mạng.
export function parseMapCoords(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const s = safeDecode(raw);
  let m;
  // 1) Cặp số đứng riêng (có thể kèm dấu °)
  if ((m = s.match(new RegExp('^\\(?\\s*' + N + '\\s*°?\\s*[,; ]\\s*' + N + '\\s*°?\\s*\\)?$')))) return pick(m[1], m[2]);
  // 2) Ghim đúng địa điểm trong link /place/: !3d<lat>!4d<lng> (lấy cặp CUỐI — chính là điểm đã ghim)
  const pins = [...s.matchAll(/!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/g)];
  if (pins.length) { const p = pins[pins.length - 1]; const r = pick(p[1], p[2]); if (r) return r; }
  // 3) Tham số ?q= / ?query= / ?ll= / ?destination= …
  if ((m = s.match(new RegExp('[?&](?:q|query|ll|sll|destination|daddr|center|viewpoint|markers)=(?:loc:)?\\s*' + N + '\\s*,\\s*' + N)))) { const r = pick(m[1], m[2]); if (r) return r; }
  // 4) Tâm bản đồ @lat,lng,zoom
  if ((m = s.match(new RegExp('@' + N + ',' + N)))) { const r = pick(m[1], m[2]); if (r) return r; }
  // 5) Đường dẫn kiểu /maps/search/10.77, 106.70 hoặc /maps/place/10.77,106.70
  if ((m = s.match(/\/(?:search|place|dir)\/(-?\d{1,3}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/))) { const r = pick(m[1], m[2]); if (r) return r; }
  return null;
}

// Chỉ mở link của Google Maps (chống dùng máy chủ khách đi gọi địa chỉ lạ)
export function isGoogleMapsHost(u) {
  let url; try { url = new URL(u); } catch { return false; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const h = url.hostname.toLowerCase();
  if (h === 'maps.app.goo.gl' || h === 'goo.gl' || h === 'g.co') return true;
  return /^(?:www\.|maps\.)?google\.(?:com|com\.vn|vn)$/.test(h);
}

// Dán gì cũng được: cặp số / link đầy đủ / link rút gọn. Trả { lat, lng } hoặc ném lỗi tiếng Việt.
export async function resolveMapCoords(text, { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  const direct = parseMapCoords(text);
  if (direct) return direct;
  const first = String(text || '').trim().match(/https?:\/\/\S+/i)?.[0];
  if (!first) throw new Error('Không đọc được toạ độ. Dán cặp số kiểu "10.776889, 106.700806" hoặc link Google Maps.');
  if (!isGoogleMapsHost(first)) throw new Error('Chỉ nhận link Google Maps (google.com/maps hoặc maps.app.goo.gl).');
  let url = first;
  for (let hop = 0; hop < 6; hop++) {
    let res;
    try {
      res = await fetchImpl(url, {
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36', 'Accept-Language': 'vi,en;q=0.8' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new Error('Không mở được link (máy chủ cần internet). Hãy dán cặp số toạ độ thay cho link.');
    }
    const loc = res.headers?.get?.('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      const next = new URL(loc, url).toString();
      const c = parseMapCoords(next);
      if (c) return c;
      if (!isGoogleMapsHost(next)) break;
      url = next;
      continue;
    }
    // Trang trả thẳng (200) KHÔNG có toạ độ địa điểm trong HTML — toạ độ trong đó là vị trí Google đoán theo IP máy chủ → không dùng
    break;
  }
  throw new Error('Link này không kèm toạ độ. Trên Google Maps, nhấn giữ đúng điểm cần chấm công rồi chép cặp số toạ độ dán vào.');
}
