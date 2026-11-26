import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.ts';
import { createStore } from './store.ts';

// A fake Bungie with one vault weapon whose first column can switch between two perks. Like the real
// one, its profile endpoint lags behind writes: it keeps serving the old perk after a swap.
const TABLES = ['DestinyInventoryItemLiteDefinition', 'DestinyInventoryBucketDefinition', 'DestinyStatDefinition', 'DestinyDamageTypeDefinition',
  'DestinyStatGroupDefinition', 'DestinyObjectiveDefinition', 'DestinyInventoryItemDefinition', 'DestinyBreakerTypeDefinition', 'DestinyPlugSetDefinition'];
const GUN = 500, OLD = 1001, NEW = 1002, OTHER = 2001;
function fakeBungie(opts: { refuse?: { code: number; message: string } } = {}) {
  const inserts: { itemId: string; characterId: string; plug: { socketIndex: number; plugItemHash: number } }[] = [];
  const ok = (body: unknown) => new Response(JSON.stringify({ ErrorCode: 1, Message: 'Ok', Response: body }));
  const items = {
    [GUN]: { hash: GUN, itemType: 3, itemTypeDisplayName: 'Auto Rifle', displayProperties: { name: 'Chroma Rush', icon: '/g.png' }, inventory: { tierTypeName: 'Legendary', bucketTypeHash: 1498876634 } },
    [OLD]: { hash: OLD, itemTypeDisplayName: 'Barrel', displayProperties: { name: 'Smallbore', icon: '/a.png' } },
    [NEW]: { hash: NEW, itemTypeDisplayName: 'Barrel', displayProperties: { name: 'Arrowhead Brake', icon: '/b.png' } },
    [OTHER]: { hash: OTHER, itemTypeDisplayName: 'Trait', displayProperties: { name: 'Rampage', icon: '/c.png' } },
  };
  const fake = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('GetMembershipsForCurrentUser')) {
      return ok({ destinyMemberships: [{ membershipType: 3, membershipId: '42', displayName: 'G', bungieGlobalDisplayName: 'G' }] });
    }
    if (url.includes('/Destiny2/Manifest/') && !url.includes('/m/')) {
      return ok({ version: 'v1', jsonWorldComponentContentPaths: { en: Object.fromEntries(TABLES.map((t) => [t, `/m/${t}.json`])) } });
    }
    if (url.includes('/m/DestinyInventoryItemLiteDefinition')) return new Response(JSON.stringify(items));
    if (url.includes('/m/')) return new Response('{}');
    if (url.includes('InsertSocketPlugFree')) {
      const body = JSON.parse(String(init?.body));
      if (opts.refuse) return new Response(JSON.stringify({ ErrorCode: opts.refuse.code, Message: opts.refuse.message }), { status: 500 });
      inserts.push(body);
      return ok({});
    }
    if (url.includes('/Profile/42/')) {
      return ok({
        responseMintedTimestamp: 't1', secondaryComponentsMintedTimestamp: 's1',
        profileInventory: { data: { items: [{ itemHash: GUN, itemInstanceId: '100', bucketHash: 138197802, state: 1, quantity: 1 }] } },
        characters: { data: { c1: { characterId: 'c1', classType: 1, light: 2000, emblemPath: '', emblemBackgroundPath: '', stats: {} } } },
        characterInventories: { data: { c1: { items: [] } } },
        characterEquipment: { data: { c1: { items: [] } } },
        itemComponents: {
          instances: { data: { 100: { primaryStat: { value: 550 } } } },
          sockets: { data: { 100: { sockets: [{ plugHash: OLD, isEnabled: true, isVisible: true }, { plugHash: OTHER, isEnabled: true, isVisible: true }] } } },
          reusablePlugs: { data: { 100: { plugs: { 0: [{ plugItemHash: OLD, canInsert: true, enabled: true }, { plugItemHash: NEW, canInsert: true, enabled: true }] } } } },
        },
      });
    }
    throw new Error(`unexpected ${url}`);
  };
  return { inserts, fake };
}

async function withApp(opts: Parameters<typeof fakeBungie>[0], run: (app: ReturnType<typeof createApp>, inserts: ReturnType<typeof fakeBungie>['inserts']) => Promise<void>) {
  const store = createStore(await mkdtemp(join(tmpdir(), 'tri-')));
  const far = Date.now() + 3_600_000;
  await store.writeTokens({ accessToken: 'a', refreshToken: 'r', accessExpiresAt: far, refreshExpiresAt: far, bungieMembershipId: '1' });
  const { inserts, fake } = fakeBungie(opts);
  const real = globalThis.fetch;
  globalThis.fetch = fake as typeof fetch;
  try {
    await run(createApp({ apiKey: 'k', clientId: '1', clientSecret: 's' }, store, { wishList: async () => new Map() }), inserts);
  } finally {
    globalThis.fetch = real;
  }
}

const perksOf = async (app: ReturnType<typeof createApp>) => {
  const inv = await (await app.request('/api/inventory')).json() as { items: { instanceId?: string; perks?: { hash?: number; active: boolean }[][] }[] };
  return inv.items.find((i) => i.instanceId === '100')!.perks!;
};

test('a perk swap on a vault weapon sticks, even though Bungie still serves the old perks', async () => {
  await withApp({}, async (app, inserts) => {
    const before = await perksOf(app);
    assert.equal(before[0]![0]!.hash, OLD);
    const res = await app.request('/api/perks', { method: 'POST', body: JSON.stringify({ instanceId: '100', plugs: [{ socketIndex: 0, plugHash: NEW }] }) });
    const body = await res.json() as { applied: number; total: number; error?: string; item: { perks: { hash: number; active: boolean }[][] } };
    assert.equal(res.status, 200);
    assert.equal(body.applied, 1);
    assert.equal(body.error, undefined);
    // Vault item: acted through a character.
    assert.deepEqual(inserts.map((i) => [i.itemId, i.characterId, i.plug.socketIndex, i.plug.plugItemHash]), [['100', 'c1', 0, NEW]]);
    assert.equal(body.item.perks[0]![0]!.hash, NEW, 'the response shows the new perk slotted');
    assert.equal((await perksOf(app))[0]![0]!.hash, NEW, 'and so does the next page load');
    // A refresh that gets the same (stale) Bungie stamps keeps what we know changed.
    await app.request('/api/inventory?refresh=1');
    assert.equal((await perksOf(app))[0]![0]!.hash, NEW);
  });
});

test('a refused perk swap says why and changes nothing', async () => {
  await withApp({ refuse: { code: 1679, message: 'You cannot perform this action on this item right now.' } }, async (app, inserts) => {
    await perksOf(app);
    const res = await app.request('/api/perks', { method: 'POST', body: JSON.stringify({ instanceId: '100', plugs: [{ socketIndex: 0, plugHash: NEW }] }) });
    const body = await res.json() as { applied: number; error?: string };
    assert.equal(res.status, 409);
    assert.equal(body.applied, 0);
    assert.match(body.error!, /refused the perk change: You cannot perform this action/);
    assert.equal(inserts.length, 0);
    assert.equal((await perksOf(app))[0]![0]!.hash, OLD);
  });
});
