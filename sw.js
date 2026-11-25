/* 学习台 PWA：缓存壳子与题库数据；音频按需联网，不进缓存 */
const CACHE = 'studyhub-v4';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/style.css',
  './assets/js/portal.js',
  './assets/js/cloud.js',
  './assets/js/supabase-config.js',
  './assets/vendor/supabase/supabase.js',
  './english/',
  './english/index.html',
  './english/assets/css/english.css',
  './english/assets/js/app.js',
  './english/data/bank-cet4.js',
  './english/data/bank-cet6.js',
  './english/data/exams-2023-12.js'
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(ASSETS.map(a => c.add(a)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (/\.(mp3|m4a|wav|ogg)$/i.test(url.pathname)) return;
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (!res || res.status !== 200 || res.type === 'opaque') return res;
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
