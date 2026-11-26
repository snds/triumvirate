import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { accessConfigFromEnv, accessGate } from './access.ts';
import { createApp } from './app.ts';
import Anthropic from '@anthropic-ai/sdk';
import { createStore } from './store.ts';
import { createWishListCache } from './wishlist-cache.ts';
import { createPush, loadPushConfig, type PushConfig } from './push.ts';

// A stray failed promise (say, writing to a chat stream after the browser closed it) should be
// logged, not take the whole server down. Node exits on these by default.
process.on('unhandledRejection', (err) => console.error('Unhandled rejection (server kept running):', err));

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing ${k}. Copy .env.example to .env and fill it in.`);
  return v;
};

// DATA_DIR lets the Docker image keep tokens, snapshots, and caches on a mounted volume.
const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(import.meta.dirname, '../../../.data');
// Web Push keys are read (or made) the first time something needs them.
let pushConfig: Promise<PushConfig> | undefined;
const push = createPush(dataDir, () => (pushConfig ??= loadPushConfig(dataDir, process.env).catch((e) => { pushConfig = undefined; throw e; })));
const app = createApp(
  { apiKey: env('BUNGIE_API_KEY'), clientId: env('BUNGIE_CLIENT_ID'), clientSecret: env('BUNGIE_CLIENT_SECRET') },
  createStore(dataDir),
  {
    wishList: createWishListCache(dataDir),
    // The SDK reads ANTHROPIC_API_KEY itself; the agent is simply off without it.
    anthropic: process.env.ANTHROPIC_API_KEY ? new Anthropic() : undefined,
    // e.g. COMMUNITY_CRAWL_HOUR=3 crawls public matches at 3 AM while the server runs.
    communityCrawlHour: process.env.COMMUNITY_CRAWL_HOUR ? Number(process.env.COMMUNITY_CRAWL_HOUR) : undefined,
    // e.g. DIGEST_HOUR=7 builds the daily digest at 7 AM (after the night's crawl).
    digestHour: process.env.DIGEST_HOUR ? Number(process.env.DIGEST_HOUR) : undefined,
    // The morning alert on your phone when the digest is ready (Settings in the digest sheet).
    push,
  },
);
const port = Number(process.env.API_PORT ?? 5444);
// Locally the server only listens on 127.0.0.1. In Docker it listens on 0.0.0.0 so the tunnel
// container can reach it, and then the Cloudflare Access gate is required (see access.ts).
const hostname = process.env.HOST ?? '127.0.0.1';
const loopback = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
const access = accessConfigFromEnv(process.env);
if (!loopback && !access && process.env.ALLOW_UNGATED !== '1') {
  throw new Error(
    `HOST=${hostname} makes the app reachable from other machines, but CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD are not set. ` +
    'Anyone who reached it could use your Bungie account. Set them (see README, "Host it on Unraid"), ' +
    'or set ALLOW_UNGATED=1 if this is a private network you trust.',
  );
}

const root = new Hono();
// For Docker's health check: before the gate, and says nothing about the account.
root.get('/healthz', (c) => c.text('ok'));
if (access) root.use('*', accessGate(access));
root.route('/', app);
// WEB_DIST is the built web app (pnpm build). In dev, Vite serves it instead.
const webDist = process.env.WEB_DIST ? resolve(process.env.WEB_DIST) : undefined;
if (webDist && existsSync(webDist)) {
  root.use('/assets/*', serveStatic({ root: webDist, onFound: (_p, c) => c.header('Cache-Control', 'public, max-age=31536000, immutable') }));
  // The service worker and manifest must be rechecked on every visit, or app updates get stuck behind an old copy.
  const fresh = serveStatic({ root: webDist, onFound: (_p, c) => c.header('Cache-Control', 'no-cache') });
  root.get('/sw.js', fresh);
  root.get('/manifest.webmanifest', fresh);
  // "/" is answered here with index.html, which must not be cached either, so new builds show up.
  root.use('*', serveStatic({ root: webDist, onFound: (p, c) => { if (p.endsWith('index.html')) c.header('Cache-Control', 'no-cache'); } }));
  // Single-page app: anything else gets index.html (never cached, so new builds show up).
  const page = serveStatic({ root: webDist, path: 'index.html', onFound: (_p, c) => c.header('Cache-Control', 'no-cache') });
  // API paths that don't exist should stay 404s, not turn into the page.
  root.get('*', (c, next) => (/^\/(api|auth)\//.test(c.req.path) ? next() : page(c, next)));
}

serve({ fetch: root.fetch, hostname, port }, () =>
  console.log(`Triumvirate on http://${hostname}:${port}${access ? ' (Cloudflare Access gate on)' : ''}${webDist ? `, web app from ${webDist}` : ''}`));
