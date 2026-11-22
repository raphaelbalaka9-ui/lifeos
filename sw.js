/* LifeOS : réseau d'abord (pour toujours avoir la dernière version), copie locale si pas de connexion.
   Cloudflare Pages redirige /index.html vers / : on ne sert jamais une réponse « redirigée » (Safari et Chrome refusent de l'ouvrir). */
var CACHE = 'lifeos-v9';
var SHELL = ['./', 'fonts.css', 'runtime.js', 'screens.js', 'i18n-en.js', 'pwa.js', 'vendor/react.js', 'vendor/react-dom.js', 'vendor/supabase.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
function clean(res) {
  if (!res || !res.redirected) return Promise.resolve(res);
  return res.blob().then(function (b) { return new Response(b, { status: res.status, statusText: res.statusText, headers: res.headers }); });
}
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(SHELL.map(function (u) { return fetch(u, { cache: 'reload' }).then(clean).then(function (r) { if (r && r.ok) return c.put(u, r); }).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) { e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); })); });
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  var nav = req.mode === 'navigate';
  var key = nav || /\/index\.html$/.test(url.pathname) ? './' : req;
  e.respondWith(fetch(nav ? './' : req).then(clean).then(function (res) {
    if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(key, copy); }); }
    return res;
  }).catch(function () { return caches.match(key, { ignoreSearch: true }).then(function (r) { return r || caches.match('./'); }); }));
});
