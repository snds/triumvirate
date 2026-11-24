import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import Anthropic from '@anthropic-ai/sdk';
import { createStore } from './store.ts';
import { createWishListCache } from './wishlist-cache.ts';

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing ${k}. Copy .env.example to .env and fill it in.`);
  return v;
};

const dataDir = join(import.meta.dirname, '../../../.data');
const app = createApp(
  { apiKey: env('BUNGIE_API_KEY'), clientId: env('BUNGIE_CLIENT_ID'), clientSecret: env('BUNGIE_CLIENT_SECRET') },
  createStore(dataDir),
  {
    wishList: createWishListCache(dataDir),
    // The SDK reads ANTHROPIC_API_KEY itself; the agent is simply off without it.
    anthropic: process.env.ANTHROPIC_API_KEY ? new Anthropic() : undefined,
  },
);
const port = Number(process.env.API_PORT ?? 5444);
serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, () => console.log(`API on http://127.0.0.1:${port}`));
