// sw.js — 설치 가능(installable) 조건을 충족시키기 위한 최소한의 서비스워커.
// 오프라인 캐싱 등은 하지 않고, 네트워크 요청을 그대로 통과시킨다.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
