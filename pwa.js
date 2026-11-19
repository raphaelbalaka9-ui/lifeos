/* LifeOS sur téléphone : active le mode application (hors connexion, mises à jour) quand le site est en ligne en https */
(function () {
  if (!('serviceWorker' in navigator) || (location.protocol !== 'https:' && location.hostname !== 'localhost')) return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  });
})();
