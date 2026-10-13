// Change ce numéro à chaque mise à jour de l'appli pour forcer le rafraîchissement du cache.
const CACHE = 'codex-v52';
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './regles.js', './spells.json', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-512-maskable.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== location.origin && !isFont) return;

  // Données (spells.json) : réseau d'abord pour avoir la dernière version, cache en secours.
  if (url.origin === location.origin && url.pathname.endsWith('.json')) {
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) { const copie = res.clone(); caches.open(CACHE).then(c => c.put(req, copie)); }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }))
    );
    return;
  }

  // Le reste : cache d'abord, puis mise à jour en arrière-plan (fonctionne hors ligne).
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
