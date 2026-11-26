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

// ── Morning alert (Web Push) ─────────────────────────────────
// The server sends { title, body, tag, url }. iPhones require every push to show an alert,
// so even an unreadable one shows something rather than nothing.
self.addEventListener('push', (event) => {
  let msg = {};
  try { msg = event.data ? event.data.json() : {}; } catch { msg = { body: event.data && event.data.text() }; }
  event.waitUntil((async () => {
    await self.registration.showNotification(msg.title || 'Triumvirate', {
      body: msg.body || 'Your daily digest is ready.',
      tag: msg.tag || 'digest', // a new digest alert replaces yesterday's instead of stacking
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: msg.url || '/?open=digest' },
    });
    // A dot on the Home Screen icon until the digest is opened.
    if (self.navigator.setAppBadge) await self.navigator.setAppBadge(1).catch(() => {});
  })());
});

// Tapping the alert: bring the open app forward and show the digest, or open it fresh.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/?open=digest', self.location.origin);
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = open.find((c) => new URL(c.url).origin === self.location.origin);
    if (client) {
      client.postMessage({ type: 'open', view: url.searchParams.get('open') });
      return client.focus();
    }
    return self.clients.openWindow(url.href);
  })());
});

// Push services rotate subscriptions now and then; hand the new one to the server so alerts keep coming.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const old = event.oldSubscription;
    const sub = event.newSubscription
      || (old && old.options && await self.registration.pushManager.subscribe(old.options).catch(() => null));
    if (!sub) return;
    await fetch('/api/push/subscribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }),
    }).catch(() => {});
    if (old) await fetch('/api/push/unsubscribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: old.endpoint }),
    }).catch(() => {});
  })());
});
