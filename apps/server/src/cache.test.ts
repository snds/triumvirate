import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.ts';
import { createStore } from './store.ts';

// A fake Bungie: counts calls so the test can see what a page load or refresh really asks for.
function fakeBungie(stamp: { value: string }) {
  const calls = { membership: 0, profile: 0, manifest: 0 };
  const ok = (body: unknown) => new Response(JSON.stringify({ ErrorCode: 1, Message: "Ok", Response: body }));
  const fake = async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('GetMembershipsForCurrentUser')) {
      calls.membership++;
      return ok({ destinyMemberships: [{ membershipType: 3, membershipId: '42', displayName: 'Guardian', bungieGlobalDisplayName: 'Guardian' }] });
    }
    if (url.includes('/Destiny2/Manifest/')) {
      calls.manifest++;
      const tables = ['DestinyInventoryItemLiteDefinition', 'DestinyInventoryBucketDefinition', 'DestinyStatDefinition', 'DestinyDamageTypeDefinition',
        'DestinyStatGroupDefinition', 'DestinyObjectiveDefinition', 'DestinyInventoryItemDefinition', 'DestinyBreakerTypeDefinition', 'DestinyPlugSetDefinition'];
      return ok({ version: 'v1', jsonWorldComponentContentPaths: { en: Object.fromEntries(tables.map((t) => [t, `/m/${t}.json`])) } });
    }
    if (url.includes('/m/')) return new Response('{}');
    if (url.includes('/Profile/42/')) {
      calls.profile++;
      return ok({ responseMintedTimestamp: stamp.value, secondaryComponentsMintedTimestamp: 's', profileInventory: { data: { items: [] } }, characters: { data: {} } });
    }
    throw new Error(`unexpected ${url}`);
  };
  return { calls, fake };
}

test('page loads reuse the snapshot, the browser gets 304s, and an unchanged refresh saves nothing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tri-'));
  const store = createStore(dir);
  const far = Date.now() + 3_600_000;
  await store.writeTokens({ accessToken: 'a', refreshToken: 'r', accessExpiresAt: far, refreshExpiresAt: far, bungieMembershipId: '1' });
  const stamp = { value: 't1' };
  const { calls, fake } = fakeBungie(stamp);
  const real = globalThis.fetch;
  globalThis.fetch = fake as typeof fetch;
  try {
    const list = new Map();
    const app = createApp({ apiKey: 'k', clientId: '1', clientSecret: 's' }, store, { wishList: async () => list });
    const first = await app.request('/api/inventory');
    assert.equal(first.status, 200);
    const etag = first.headers.get('ETag')!;
    assert.ok(etag);
    assert.deepEqual(calls, { membership: 1, profile: 1, manifest: 1 });

    const again = await app.request('/api/inventory', { headers: { 'If-None-Match': etag } });
    assert.equal(again.status, 304);
    assert.equal(calls.profile, 1, 'a page load does not call Bungie');

    const refreshed = await app.request('/api/inventory?refresh=1');
    assert.equal(refreshed.status, 200);
    assert.equal(calls.profile, 2);
    assert.equal(calls.membership, 1, 'who you are is reused');
    assert.equal((await readdir(join(dir, 'snapshots'))).length, 1, 'same Bungie stamps, no new snapshot');

    stamp.value = 't2';
    await app.request('/api/inventory?refresh=1');
    assert.equal((await readdir(join(dir, 'snapshots'))).length, 2, 'changed data is saved');
  } finally {
    globalThis.fetch = real;
  }
});

test('Bungie images are fetched once, kept on disk, and cached by the browser for a year', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tri-'));
  let fetches = 0;
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { fetches++; return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }); }) as typeof fetch;
  try {
    const make = () => createApp({ apiKey: 'k', clientId: '1', clientSecret: 's' }, createStore(dir), { wishList: async () => new Map() });
    const first = await make().request('/api/bungie-img/common/destiny2_content/icons/abc.jpg');
    assert.equal(first.status, 200);
    assert.match(first.headers.get('Cache-Control') ?? '', /max-age=31536000/);
    // A fresh server (empty memory) still serves it from disk without asking Bungie.
    const second = await make().request('/api/bungie-img/common/destiny2_content/icons/abc.jpg');
    assert.deepEqual(new Uint8Array(await second.arrayBuffer()), new Uint8Array([1, 2, 3]));
    assert.equal(second.headers.get('Content-Type'), 'image/jpeg');
    assert.equal(fetches, 1);
  } finally {
    globalThis.fetch = real;
  }
});
