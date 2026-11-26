import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.ts';
import { createStore } from './store.ts';
import { createPush, loadPushConfig, type Sender } from './push.ts';

const sub = (n: number) => ({ endpoint: `https://web.push.apple.com/abc${n}`, keys: { p256dh: `p${n}`, auth: `a${n}` } });

test('VAPID keys are made once, then reused; env wins', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tri-'));
  const a = await loadPushConfig(dir, { ALLOWED_EMAILS: 'me@example.com, other@example.com' });
  const b = await loadPushConfig(dir, {});
  assert.equal(a.publicKey, b.publicKey);
  assert.equal(a.subject, 'mailto:me@example.com');
  assert.match(a.publicKey, /^[A-Za-z0-9_-]{80,}$/);
  const c = await loadPushConfig(dir, { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'https://x.example' });
  assert.deepEqual(c, { publicKey: 'pub', privateKey: 'priv', subject: 'https://x.example' });
});

test('notify sends to every device and drops the ones that are gone', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tri-'));
  const sent: { endpoint: string; payload: string }[] = [];
  const send: Sender = async (s, payload) => {
    if (s.endpoint.endsWith('2')) return { gone: true };
    if (s.endpoint.endsWith('3')) throw new Error('503');
    sent.push({ endpoint: s.endpoint, payload });
    return { gone: false };
  };
  const push = createPush(dir, () => loadPushConfig(dir, {}), send);
  await push.add(sub(1), 'iPhone');
  await push.add(sub(2));
  await push.add(sub(3));
  await push.add(sub(1), 'iPhone again'); // same endpoint replaces, doesn't duplicate
  assert.equal(await push.count(), 3);
  const r = await push.notify({ title: 'T', body: 'B', tag: 'digest' });
  assert.deepEqual(r, { sent: 1, removed: 1, failed: 1 });
  assert.deepEqual(JSON.parse(sent[0]!.payload), { title: 'T', body: 'B', tag: 'digest' });
  // The gone one is removed; the one that failed for now is kept for tomorrow.
  const saved = JSON.parse(await readFile(join(dir, 'push.json'), 'utf8')) as { endpoint: string; device?: string }[];
  assert.deepEqual(saved.map((s) => s.endpoint), [sub(3).endpoint, sub(1).endpoint]);
  assert.equal(saved[1]!.device, 'iPhone again');
});

test('push routes: subscribe, status, test alert, unsubscribe', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tri-'));
  const sent: string[] = [];
  const push = createPush(dir, () => loadPushConfig(dir, {}), async (_s, p) => { sent.push(p); return { gone: false }; });
  const app = createApp({ apiKey: 'k', clientId: '123', clientSecret: 's' }, createStore(dir), { wishList: async () => ({ rolls: new Map() }) as never, push, digestHour: 7 });
  const post = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  assert.equal((await post('/api/push/subscribe', { subscription: { endpoint: 'http://evil', keys: {} } })).status, 400);
  assert.equal((await post('/api/push/test', { endpoint: sub(1).endpoint })).status, 400);
  assert.equal((await post('/api/push/subscribe', { subscription: sub(1), device: 'iPhone' })).status, 200);
  const status = await (await app.request(`/api/push?endpoint=${encodeURIComponent(sub(1).endpoint)}`)).json() as Record<string, unknown>;
  assert.equal(status.enabled, true);
  assert.equal(status.subscribed, true);
  assert.equal(status.devices, 1);
  assert.equal(status.digestHour, 7);
  assert.equal(typeof status.publicKey, 'string');

  assert.equal((await post('/api/push/test', { endpoint: sub(1).endpoint })).status, 200);
  assert.deepEqual(JSON.parse(sent[0]!), { title: 'Alerts are on', body: 'You\'ll get one here each morning when the digest is ready.', tag: 'digest', url: '/?open=digest' });

  assert.equal((await post('/api/push/unsubscribe', { endpoint: sub(1).endpoint })).status, 200);
  const after = await (await app.request(`/api/push?endpoint=${encodeURIComponent(sub(1).endpoint)}`)).json() as Record<string, unknown>;
  assert.equal(after.subscribed, false);
});

test('without push the status says off', async () => {
  const app = createApp({ apiKey: 'k', clientId: '123', clientSecret: 's' }, createStore(await mkdtemp(join(tmpdir(), 'tri-'))), { wishList: async () => ({ rolls: new Map() }) as never });
  assert.deepEqual(await (await app.request('/api/push')).json(), { enabled: false });
});
