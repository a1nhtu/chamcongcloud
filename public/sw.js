// Service worker: ưu tiên MẠNG (network-first) để giao diện luôn cập nhật bản mới,
// chỉ dùng cache khi offline. KHÔNG cache /api và /uploads.
const CACHE = 'digiplus-v5';
const SHELL = ['/', '/index.html', '/common.css', '/employee.css', '/common.js', '/app.js', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api') || url.pathname.startsWith('/uploads')) return;
  // Network-first: thử tải bản mới từ mạng, cập nhật cache; nếu mất mạng thì dùng cache.
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(e.request))
  );
});
