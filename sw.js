/* LifeOS : réseau d'abord (pour toujours avoir la dernière version), copie locale si pas de connexion.
   Cloudflare Pages redirige /index.html vers / : on ne sert jamais une réponse « redirigée » (Safari et Chrome refusent de l'ouvrir). */
var CACHE = 'lifeos-v11';
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

/* Notifications du soir (envoyées par Supabase) */
self.addEventListener('push', function (e) {
  var d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || '⚔️ Ton Boss t\'attend', { body: d.body || 'Check-in du soir : 2 minutes, +300 XP.', icon: 'icon-192.png', badge: 'icon-192.png', tag: 'lifeos-checkin', renotify: true, data: { url: d.url || './?ci=1' } }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
    for (var i = 0; i < cs.length; i++) { if (cs[i].url.indexOf(self.registration.scope) === 0 && 'focus' in cs[i]) { cs[i].navigate && cs[i].navigate(url); return cs[i].focus(); } }
    return self.clients.openWindow(url);
  }));
});
