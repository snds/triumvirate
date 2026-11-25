import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, friendlyMoveError } from './app.ts';
import { createStore } from './store.ts';

const cfg = { apiKey: 'k', clientId: '123', clientSecret: 's' };
const deps = { wishList: async () => new Map() };

test('inventory says signed out when there is no token', async () => {
  const app = createApp(cfg, createStore(await mkdtemp(join(tmpdir(), 'tri-'))), deps);
  const res = await app.request('/api/inventory');
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { signedIn: false });
});

test('login redirects to Bungie with a state value', async () => {
  const app = createApp(cfg, createStore(await mkdtemp(join(tmpdir(), 'tri-'))), deps);
  const res = await app.request('/auth/login');
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get('location')!);
  assert.equal(loc.host, 'www.bungie.net');
  assert.equal(loc.searchParams.get('client_id'), '123');
  assert.match(loc.searchParams.get('state') ?? '', /^[0-9a-f]{32}$/);
});

test('callback rejects a mismatched state', async () => {
  const app = createApp(cfg, createStore(await mkdtemp(join(tmpdir(), 'tri-'))), deps);
  await app.request('/auth/login');
  const res = await app.request('/auth/callback?code=abc&state=wrong');
  assert.equal(res.status, 400);
});

test('agent explains how to turn it on when there is no API key', async () => {
  const app = createApp(cfg, createStore(await mkdtemp(join(tmpdir(), 'tri-'))), deps);
  const res = await app.request('/api/agent', { method: 'POST', body: JSON.stringify({ messages: [] }) });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /ANTHROPIC_API_KEY/);
});

test('bungie image proxy rejects paths outside Bungie image folders', async () => {
  const app = createApp(cfg, createStore(await mkdtemp(join(tmpdir(), 'tv-'))), { wishList: async () => new Map() });
  assert.equal((await app.request('/api/bungie-img/etc/passwd')).status, 400);
  assert.notEqual((await app.request('/api/bungie-img/common/../../x.png')).status, 200);
});

test('move needs a sign-in, and explains a missing Bungie permission', async () => {
  const app = createApp(cfg, createStore(await mkdtemp(join(tmpdir(), 'tri-'))), deps);
  const res = await app.request('/api/move', { method: 'POST', body: JSON.stringify({ instanceId: '1', to: 'vault' }) });
  assert.equal(res.status, 401);
  assert.match(friendlyMoveError(new Error('Bungie API error 2108: nope')), /Move or equip Destiny gear/);
  assert.match(friendlyMoveError(new Error('Bungie API error 1642: full')), /no room/);
});

test('a profile with the same Bungie stamps counts as unchanged', async () => {
  const { sameProfile } = await import('./app.ts');
  const p = (a: string, b: string) => ({ responseMintedTimestamp: a, secondaryComponentsMintedTimestamp: b }) as never;
  assert.equal(sameProfile(p('t1', 's1'), p('t1', 's1')), true);
  assert.equal(sameProfile(p('t1', 's1'), p('t2', 's1')), false);
  assert.equal(sameProfile(p('t1', 's1'), p('t1', 's2')), false);
  assert.equal(sameProfile(p('', ''), p('', '')), false);
});

test('community routes report status and reject a bad item hash', async () => {
  const app = createApp(cfg, createStore(await mkdtemp(join(tmpdir(), 'tri-'))), deps);
  const res = await app.request('/api/community/status');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).running, false);
  assert.equal((await app.request('/api/community/items/abc')).status, 400);
  const w = await (await app.request('/api/community/items/123')).json();
  assert.deepEqual(w, { samples: 0, weapon: null, trend: [] });
});

test('perk swaps need a sign-in and a weapon', async () => {
  const app = createApp(cfg, createStore(await mkdtemp(join(tmpdir(), 'tri-'))), deps);
  const res = await app.request('/api/perks', { method: 'POST', body: JSON.stringify({ instanceId: '1', plugs: [{ socketIndex: 1, plugHash: 2 }] }) });
  assert.equal(res.status, 401);
});

test('equip, lock, and loadout actions need a sign-in; equip errors say where to stand', async () => {
  const app = createApp(cfg, createStore(await mkdtemp(join(tmpdir(), 'tri-'))), deps);
  const post = (path: string, body: unknown) => app.request(path, { method: 'POST', body: JSON.stringify(body) });
  assert.equal((await post('/api/equip', { instanceId: '1', characterId: 'w' })).status, 401);
  assert.equal((await post('/api/lock', { instanceId: '1', locked: true })).status, 401);
  assert.equal((await post('/api/game-loadouts/equip', { characterId: 'w', index: 0 })).status, 401);
  assert.match(friendlyMoveError(new Error('Bungie API error 1671: no')), /orbit/);
  assert.match(friendlyMoveError(new Error('Bungie API error 1641: no')), /exotic/);
});

test('saved loadouts: create, list, update, delete', async () => {
  const app = createApp(cfg, createStore(await mkdtemp(join(tmpdir(), 'tri-'))), deps);
  const items = [{ instanceId: '6917529', itemHash: 1, bucketHash: 1498876634 }];
  assert.equal((await app.request('/api/loadouts', { method: 'POST', body: JSON.stringify({ name: '', classType: 2, items }) })).status, 400);
  const created = await (await app.request('/api/loadouts', { method: 'POST', body: JSON.stringify({ name: 'Raid', classType: 2, items }) })).json();
  assert.match(created.id, /^lo-/);
  const put = await app.request(`/api/loadouts/${created.id}`, { method: 'PUT', body: JSON.stringify({ name: 'Raid DPS', classType: 2, items }) });
  assert.equal((await put.json()).name, 'Raid DPS');
  assert.equal((await (await app.request('/api/loadouts')).json()).length, 1);
  await app.request(`/api/loadouts/${created.id}`, { method: 'DELETE' });
  assert.deepEqual(await (await app.request('/api/loadouts')).json(), []);
  assert.equal((await app.request('/api/loadouts/../x', { method: 'DELETE' })).status, 404);
});

test('digest: none yet, and building needs a sign-in', async () => {
  const app = createApp(cfg, createStore(await mkdtemp(join(tmpdir(), 'tri-'))), deps);
  const res = await app.request('/api/digest');
  assert.deepEqual(await res.json(), { digest: null, dates: [], building: false });
  assert.equal((await app.request('/api/digest?date=../x')).status, 400);
  const run = await app.request('/api/digest/run', { method: 'POST' });
  assert.equal(run.status, 409);
  assert.match((await run.json()).error, /Sign in/);
});
