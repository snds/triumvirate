// Service worker: makes the installed app reopen fast and keeps Bungie art on the device.
// Rules, in order of how much they matter:
// 1. Pages always try the network first, so an expired Cloudflare sign-in still sends you to log in.
//    The last good page is only a fallback when there's no connection at all.
// 2. Built files (/assets/*, named by content hash) and Bungie art never change, so they're served
//    from the cache once seen.
// 3. Everything else (your inventory, the chat, sign-in) is never cached here.
const PAGES = 'pages-v1';
const ASSETS = 'assets-v1';
const ART = 'art-v1';
const KEEP = [PAGES, ASSETS, ART];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (!KEEP.includes(name)) await caches.delete(name);
    await self.clients.claim();
  })());
});

// Only keep plain same-origin successes; a redirect to the sign-in page must never be cached.
const cacheable = (res) => res && res.ok && res.type === 'basic' && !res.redirected;

async function trim(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(key);
}

async function cacheFirst(request, name, max) {
  const cache = await caches.open(name);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (cacheable(res)) {
    await cache.put(request, res.clone());
    trim(name, max); // oldest first; not awaited so the answer isn't held up
  }
  return res;
}

async function page(request) {
  try {
    const res = await fetch(request);
    if (cacheable(res)) (await caches.open(PAGES)).put('/', res.clone());
    return res;
  } catch (err) {
    const fallback = await (await caches.open(PAGES)).match('/');
    if (fallback) return fallback;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' && !/^\/(api|auth)\//.test(url.pathname)) event.respondWith(page(request));
  else if (url.pathname.startsWith('/assets/')) event.respondWith(cacheFirst(request, ASSETS, 80));
  else if (url.pathname.startsWith('/api/bungie-img/')) event.respondWith(cacheFirst(request, ART, 2000));
});
