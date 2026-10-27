/* Accessory Editor service worker — offline app shell (additive; never caches cross-origin) */
const CACHE = 'accessory-editor-v1';
const CORE = ['./', 'index.html', 'styles.css', 'editor.js',
  'accessory-library.js', 'living-faces.js', 'three.module.js',
  'GLTFLoader.js', 'utils/BufferGeometryUtils.js', 'utils/SkeletonUtils.js',
  'assets/accessories/balloon.glb', 'assets/accessories/buckethat.glb', 'assets/accessories/camera.glb', 'assets/accessories/cane.glb', 'assets/accessories/cape.glb', 'assets/accessories/coin.glb', 'assets/accessories/die.glb', 'assets/accessories/envelope.glb', 'assets/accessories/flag.glb', 'assets/accessories/flower.glb', 'assets/accessories/gavel.glb', 'assets/accessories/goldbar.glb', 'assets/accessories/hammer.glb', 'assets/accessories/mailcap.glb', 'assets/accessories/rod.glb', 'assets/accessories/scroll.glb', 'assets/accessories/strawhat.glb', 'assets/accessories/tophat.glb', 'assets/accessories/tourcap.glb', 'assets/accessories/yarn.glb',
  'manifest.webmanifest'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => Promise.allSettled(CORE.map((u) => c.add(u))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => {
      const copy = r.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return r;
    }).catch(() => caches.match('index.html')));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => {
    if (r && r.ok) {
      const copy = r.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return r;
  })));
});
