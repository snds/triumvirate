import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.ts';
import { createStore } from './store.ts';

// A fake Bungie with one seal and one triumph category. The record tables are only downloaded
// when the Records screen first asks for them.
const TABLES = ['DestinyInventoryItemLiteDefinition', 'DestinyInventoryBucketDefinition', 'DestinyStatDefinition', 'DestinyDamageTypeDefinition',
  'DestinyStatGroupDefinition', 'DestinyObjectiveDefinition', 'DestinyInventoryItemDefinition', 'DestinyBreakerTypeDefinition', 'DestinyPlugSetDefinition',
  'DestinyRecordDefinition', 'DestinyPresentationNodeDefinition', 'DestinyGlobalConstantsDefinition'];
const ok = (body: unknown) => new Response(JSON.stringify({ ErrorCode: 1, Message: 'Ok', Response: body }));
const obj = (objectiveHash: number, progress: number, completionValue: number) => ({ objectiveHash, progress, completionValue, complete: progress >= completionValue, visible: true });

function fakeBungie() {
  const calls: string[] = [];
  const fake = async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    if (url.includes('/Destiny2/Manifest/') && !url.includes('/m/')) {
      return ok({ version: 'v1', jsonWorldComponentContentPaths: { en: Object.fromEntries(TABLES.map((t) => [t, `/m/${t}.json`])) } });
    }
    if (url.includes('/m/DestinyInventoryItemLiteDefinition')) {
      return new Response(JSON.stringify({ 5: { hash: 5, collectibleHash: 55, itemType: 3, classType: 3, itemTypeDisplayName: 'Hand Cannon', displayProperties: { name: 'Ace of Spades', icon: '/a.png' }, inventory: { tierTypeName: 'Exotic', bucketTypeHash: 1498876634 } } }));
    }
    if (url.includes('/m/DestinyObjectiveDefinition')) return new Response(JSON.stringify({ 7: { progressDescription: 'Opponents defeated', uiStyle: 0 } }));
    if (url.includes('/m/DestinyRecordDefinition')) {
      return new Response(JSON.stringify({
        900: { displayProperties: { name: 'Conqueror' }, titleInfo: { hasTitle: true, titlesByGender: { Male: 'Conqueror', Female: 'Conqueror' } } },
        101: { displayProperties: { name: 'Grandmaster' }, completionInfo: { ScoreValue: 20 } },
        201: { displayProperties: { name: 'Almost there', description: 'Defeat opponents' }, completionInfo: { ScoreValue: 10 } },
      }));
    }
    if (url.includes('/m/DestinyPresentationNodeDefinition')) {
      return new Response(JSON.stringify({
        10: { displayProperties: { name: 'Seals' }, children: { presentationNodes: [{ presentationNodeHash: 11 }] } },
        11: { displayProperties: { name: 'Conqueror' }, completionRecordHash: 900, children: { records: [{ recordHash: 101 }] } },
        20: { displayProperties: { name: 'Triumphs' }, children: { presentationNodes: [{ presentationNodeHash: 21 }] } },
        21: { displayProperties: { name: 'Crucible' }, children: { records: [{ recordHash: 201 }] } },
      }));
    }
    if (url.includes('/m/')) return new Response('{}');
    if (url.includes('/Profile/42/') && url.includes('components=200%2C700%2C800%2C900')) {
      return ok({
        characters: { data: { c1: { characterId: 'c1', genderType: 1 } } },
        profileRecords: { data: {
          activeScore: 500, legacyScore: 10, lifetimeScore: 510, recordCategoriesRootNodeHash: 20, recordSealsRootNodeHash: 10,
          records: { 900: { state: 4, objectives: [] }, 101: { state: 4, objectives: [obj(7, 0, 1)] }, 201: { state: 4, objectives: [obj(7, 90, 100)] } },
        } },
        profilePresentationNodes: { data: { nodes: { 11: { state: 0, progressValue: 0, completionValue: 1 } } } },
        profileCollectibles: { data: { collectibles: { 55: { state: 1 } } } },
      });
    }
    if (url.includes('/Profile/42/')) {
      return ok({
        responseMintedTimestamp: 't1', secondaryComponentsMintedTimestamp: 's1',
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

test('records: titles, triumphs, nearly done, and tracking that survives a backup', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tri-'));
  const store = createStore(dir);
  const far = Date.now() + 3_600_000;
  await store.writeTokens({ accessToken: 'a', refreshToken: 'r', accessExpiresAt: far, refreshExpiresAt: far, bungieMembershipId: '1' });
  const { calls, fake } = fakeBungie();
  const real = globalThis.fetch;
  globalThis.fetch = fake as typeof fetch;
  try {
    const app = createApp({ apiKey: 'k', clientId: '1', clientSecret: 's' }, store, { wishList: async () => new Map() });
    await app.request('/api/inventory');
    assert.equal(calls.filter((u) => u.includes('/m/DestinyRecordDefinition')).length, 0, 'not loaded at start up');

    const body = await (await app.request('/api/records')).json();
    assert.deepEqual(body.score, { active: 500, legacy: 10, lifetime: 510 });
    assert.deepEqual(body.titles.map((t: { title: string; progress: number; completion: number }) => [t.title, t.progress, t.completion]), [['Conqueror', 0, 1]]);
    assert.equal(body.triumphs[0].name, 'Crucible');
    assert.equal(body.nearly[0].name, 'Almost there');
    assert.equal(body.nearly[0].objectives[0].description, 'Opponents defeated');
    assert.deepEqual(body.exotics.map((g: { name: string }) => g.name), ['Ace of Spades']);
    // Only the trimmed copies are kept on disk.
    const files = await readdir(join(dir, 'manifest', 'v1'));
    assert.ok(files.some((f) => f.startsWith('DestinyRecordDefinition.slim')));
    assert.ok(!files.includes('DestinyRecordDefinition.json'));

    assert.equal((await app.request('/api/records/track', { method: 'POST', body: JSON.stringify({ hash: 'x' }) })).status, 400);
    const tr = await (await app.request('/api/records/track', { method: 'POST', body: JSON.stringify({ hash: 201, tracked: true }) })).json();
    assert.deepEqual(tr.tracked, [201]);
    const again = await (await app.request('/api/records')).json();
    assert.deepEqual(again.tracked.map((r: { name: string }) => r.name), ['Almost there']);
    assert.equal(calls.filter((u) => u.includes('components=200%2C700%2C800%2C900')).length, 1, 'profile reused within 5 minutes');

    const backup = await (await app.request('/api/backup')).json();
    assert.deepEqual(backup.data.trackedRecords, [201]);
    await app.request('/api/records/track', { method: 'POST', body: JSON.stringify({ hash: 201, tracked: false }) });
    const restored = await (await app.request('/api/backup', { method: 'POST', body: JSON.stringify(backup) })).json();
    assert.ok(restored.restored.includes('1 tracked triumph'));
  } finally {
    globalThis.fetch = real;
  }
});

test('records need a sign-in', async () => {
  const app = createApp({ apiKey: 'k', clientId: '1', clientSecret: 's' }, createStore(await mkdtemp(join(tmpdir(), 'tri-'))), { wishList: async () => new Map() });
  assert.equal((await app.request('/api/records')).status, 401);
});
