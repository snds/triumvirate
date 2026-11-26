import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.ts';
import { createStore } from './store.ts';

// A fake Bungie with one character, one vendor selling a weapon and a shader, and the few
// definitions the Vendors screen looks up one at a time.
const TABLES = ['DestinyInventoryItemLiteDefinition', 'DestinyInventoryBucketDefinition', 'DestinyStatDefinition', 'DestinyDamageTypeDefinition',
  'DestinyStatGroupDefinition', 'DestinyObjectiveDefinition', 'DestinyInventoryItemDefinition', 'DestinyBreakerTypeDefinition', 'DestinyPlugSetDefinition'];
const GUN = 500, PERK = 1001, SHADER = 600, GLIMMER = 900, BANSHEE = 672118013, TOWER = 7, CITY = 8;
const ok = (body: unknown) => new Response(JSON.stringify({ ErrorCode: 1, Message: 'Ok', Response: body }));

function fakeBungie() {
  const calls: string[] = [];
  const items = {
    [GUN]: { hash: GUN, itemType: 3, itemTypeDisplayName: 'Hand Cannon', displayProperties: { name: 'Fatebringer', icon: '/g.png' }, inventory: { tierTypeName: 'Legendary', bucketTypeHash: 1498876634 }, collectibleHash: 11 },
    [PERK]: { hash: PERK, itemTypeDisplayName: 'Trait', displayProperties: { name: 'Explosive Payload', icon: '/p.png' } },
    [SHADER]: { hash: SHADER, itemType: 19, itemTypeDisplayName: 'Shader', displayProperties: { name: 'Gilded Shader', icon: '/s.png' }, collectibleHash: 22 },
    [GLIMMER]: { hash: GLIMMER, displayProperties: { name: 'Glimmer', icon: '/gl.png' } },
  };
  const fake = async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    if (url.includes('/Destiny2/Manifest/DestinyVendorDefinition/')) {
      return ok({ hash: BANSHEE, displayProperties: { name: 'Banshee-44', subtitle: 'Gunsmith', smallTransparentIcon: '/b.png' }, groups: [{ vendorGroupHash: TOWER }],
        locations: [{ destinationHash: CITY }], displayCategories: [{ displayProperties: { name: 'Weapons' } }, { displayProperties: { name: 'Cosmetics' } }], failureStrings: [] });
    }
    if (url.includes('/Destiny2/Manifest/DestinyVendorGroupDefinition/')) return ok({ categoryName: 'Tower', order: 1 });
    if (url.includes('/Destiny2/Manifest/DestinyDestinationDefinition/')) return ok({ displayProperties: { name: 'The Last City' } });
    if (url.includes('/Destiny2/Manifest/DestinyProgressionDefinition/')) return ok({ displayProperties: { name: 'Gunsmith Rank' }, steps: [{ stepName: 'Guardian I', progressTotal: 100 }, { stepName: 'Brave I', progressTotal: 200 }] });
    if (url.includes('/Destiny2/Manifest/') && !url.includes('/m/')) {
      return ok({ version: 'v1', jsonWorldComponentContentPaths: { en: Object.fromEntries(TABLES.map((t) => [t, `/m/${t}.json`])) } });
    }
    if (url.includes('/m/DestinyInventoryItemLiteDefinition')) return new Response(JSON.stringify(items));
    if (url.includes('/m/')) return new Response('{}');
    if (url.includes('/Character/c1/Vendors/')) {
      return ok({
        vendorGroups: { data: { groups: [{ vendorGroupHash: TOWER, vendorHashes: [BANSHEE] }] } },
        vendors: { data: { [BANSHEE]: { vendorHash: BANSHEE, enabled: true, vendorLocationIndex: 0, nextRefreshDate: '2026-11-27T17:00:00Z',
          progression: { progressionHash: 77, level: 1, progressToNextLevel: 50, nextLevelAt: 200, currentResetCount: 0 } } } },
        categories: { data: { [BANSHEE]: { categories: [{ displayCategoryIndex: 0, itemIndexes: [3] }, { displayCategoryIndex: 1, itemIndexes: [4] }] } } },
        sales: { data: { [BANSHEE]: { saleItems: {
          3: { vendorItemIndex: 3, itemHash: GUN, quantity: 1, augments: 0, costs: [{ itemHash: GLIMMER, quantity: 5000 }], failureIndexes: [] },
          4: { vendorItemIndex: 4, itemHash: SHADER, quantity: 1, augments: 0, costs: [{ itemHash: GLIMMER, quantity: 500 }], failureIndexes: [] },
        } } } },
        itemComponents: { [BANSHEE]: {
          instances: { data: { 3: { primaryStat: { value: 550 } } } },
          sockets: { data: { 3: { sockets: [{ plugHash: PERK, isEnabled: true, isVisible: true }] } } },
          reusablePlugs: { data: {} },
          stats: { data: {} },
        } },
      });
    }
    if (url.includes('/Profile/42/') && url.includes('components=800')) {
      return ok({ profileCollectibles: { data: { collectibles: { 11: { state: 0 }, 22: { state: 1 } } } } });
    }
    if (url.includes('/Profile/42/')) {
      return ok({
        responseMintedTimestamp: 't1', secondaryComponentsMintedTimestamp: 's1',
        profileCurrencies: { data: { items: [{ itemHash: GLIMMER, quantity: 1000 }] } },
        profileInventory: { data: { items: [] } },
        characters: { data: { c1: { characterId: 'c1', classType: 1, light: 2000, emblemPath: '', emblemBackgroundPath: '', stats: {}, dateLastPlayed: '2026-11-26T00:00:00Z' } } },
        characterInventories: { data: { c1: { items: [] } } },
        characterEquipment: { data: { c1: { items: [] } } },
        itemComponents: {},
      });
    }
    if (url.includes('GetMembershipsForCurrentUser')) {
      return ok({ destinyMemberships: [{ membershipType: 3, membershipId: '42', displayName: 'G', bungieGlobalDisplayName: 'G' }] });
    }
    throw new Error(`unexpected ${url}`);
  };
  return { calls, fake };
}

test('vendors screen: groups, categories, costs, ownership, ranks, and weapon rows; definitions are cached', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tri-'));
  const store = createStore(dir);
  const far = Date.now() + 3_600_000;
  await store.writeTokens({ accessToken: 'a', refreshToken: 'r', accessExpiresAt: far, refreshExpiresAt: far, bungieMembershipId: '1' });
  const { calls, fake } = fakeBungie();
  const real = globalThis.fetch;
  globalThis.fetch = fake as typeof fetch;
  try {
    const app = createApp({ apiKey: 'k', clientId: '1', clientSecret: 's' }, store, { wishList: async () => new Map() });
    const res = await app.request('/api/vendors');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.characterId, 'c1');
    const [tower] = body.groups;
    assert.equal(tower.name, 'Tower');
    const [banshee] = tower.vendors;
    assert.equal(banshee.name, 'Banshee-44');
    assert.equal(banshee.location, 'The Last City');
    assert.deepEqual(banshee.rank, { name: 'Gunsmith Rank', rank: 'Brave I', step: 2, steps: 2, progress: 50, next: 200, resets: 0 });
    const [weapons, cosmetics] = banshee.categories;
    assert.equal(weapons.sales[0].name, 'Fatebringer');
    assert.equal(weapons.sales[0].owned, true);
    assert.equal(weapons.sales[0].short, true);
    assert.equal(weapons.sales[0].rowId, `vendor-${BANSHEE}-3`);
    assert.equal(body.items[`vendor-${BANSHEE}-3`].perks[0][0].name, 'Explosive Payload');
    assert.equal(cosmetics.sales[0].owned, false);
    assert.equal(cosmetics.sales[0].short, undefined);
    assert.ok((await readdir(join(dir, 'defs', 'v1'))).includes(`DestinyVendorDefinition-${BANSHEE}.json`));

    // A second ask is served from memory; ?refresh asks Bungie again but reuses the definitions.
    const before = calls.length;
    await app.request('/api/vendors');
    assert.equal(calls.length, before);
    await app.request('/api/vendors?refresh=1');
    assert.equal(calls.filter((u) => u.includes('DestinyVendorDefinition/')).length, 1);
  } finally {
    globalThis.fetch = real;
  }
});

test('vendors screen needs a sign-in', async () => {
  const app = createApp({ apiKey: 'k', clientId: '1', clientSecret: 's' }, createStore(await mkdtemp(join(tmpdir(), 'tri-'))), { wishList: async () => new Map() });
  assert.equal((await app.request('/api/vendors')).status, 401);
});
