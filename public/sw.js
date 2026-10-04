// 오프라인 플레이용 서비스워커. 배포 시 VERSION을 올리면 이전 캐시가 정리된다.
const VERSION = 'sf-v16';
const CORE = ['./', 'index.html', 'manifest.webmanifest',
  'assets/icons/icon-192.png', 'assets/icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;
  if (req.headers.has('range') || req.url.endsWith('.mp3')) return;   // 미디어(Range 요청)는 브라우저에 맡김
  const isPage = req.mode === 'navigate' || req.url.endsWith('.html');
  if (isPage) {   // 페이지는 네트워크 우선 (항상 최신), 실패 시 캐시
    e.respondWith(fetch(req).then(r => { const cp = r.clone(); caches.open(VERSION).then(c => c.put(req, cp)); return r; })
      .catch(() => caches.match(req).then(m => m || caches.match('index.html'))));
    return;
  }
  // 이미지·음악 등 정적 자원은 캐시 우선 + 백그라운드 갱신
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(r => { if (r.ok && r.status === 200) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(req, cp)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
