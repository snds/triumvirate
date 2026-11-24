import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { createStore } from './store.ts';

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing ${k}. Copy .env.example to .env and fill it in.`);
  return v;
};

const app = createApp(
  { apiKey: env('BUNGIE_API_KEY'), clientId: env('BUNGIE_CLIENT_ID'), clientSecret: env('BUNGIE_CLIENT_SECRET') },
  createStore(join(import.meta.dirname, '../../../.data')),
);
const port = Number(process.env.API_PORT ?? 5444);
serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, () => console.log(`API on http://127.0.0.1:${port}`));
