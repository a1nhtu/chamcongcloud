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

// --- Thông báo đẩy (Web Push) ---
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  const title = d.title || 'Digiplus Chấm công';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    icon: '/icons/logo.png',
    badge: '/icons/logo.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: { url: d.url || '/admin' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/admin';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    for (const c of cs) { if (c.url.includes('/admin') && 'focus' in c) return c.focus(); }
    return clients.openWindow(url);
  }));
});
