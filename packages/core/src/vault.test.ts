import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DestinyProfileResponse } from 'bungie-api-ts/destiny2';
import { summarizeProfile, VAULT_BUCKET } from './vault.ts';
import { needsRefresh, type Tokens } from './bungie.ts';
import type { ManifestTables } from './manifest.ts';

const manifest = {
  version: 'test',
  items: {
    1: { displayProperties: { name: 'Fatebringer' }, itemTypeDisplayName: 'Hand Cannon', inventory: { bucketTypeHash: 10 } },
    2: { displayProperties: { name: 'Gjallarhorn' }, itemTypeDisplayName: 'Rocket Launcher', inventory: { bucketTypeHash: 20 } },
  },
  buckets: {
    10: { displayProperties: { name: 'Kinetic Weapons' } },
    20: { displayProperties: { name: 'Power Weapons' } },
  },
} as unknown as ManifestTables;

const profile = {
  profileInventory: { data: { items: [
    { itemHash: 1, bucketHash: VAULT_BUCKET, itemInstanceId: 'a' },
    { itemHash: 99, bucketHash: 375726501 }, // consumable bucket: must be skipped
  ] } },
  characters: { data: { c1: { classType: 2, light: 2010 } } },
  characterEquipment: { data: { c1: { items: [{ itemHash: 2, bucketHash: 20, itemInstanceId: 'b' }] } } },
  characterInventories: { data: { c1: { items: [] } } },
  itemComponents: { instances: { data: { a: { primaryStat: { value: 1990 } }, b: { primaryStat: { value: 2010 } } } } },
} as unknown as DestinyProfileResponse;

test('lists vault items with their real bucket and power', () => {
  const rows = summarizeProfile(profile, manifest);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    { ...rows[0] },
    { location: 'Vault', name: 'Fatebringer', type: 'Hand Cannon', bucket: 'Kinetic Weapons', power: 1990, equipped: false, itemHash: 1, instanceId: 'a' },
  );
});

test('labels character gear by class and marks it equipped', () => {
  const row = summarizeProfile(profile, manifest)[1];
  assert.equal(row?.location, 'Warlock (2010)');
  assert.equal(row?.equipped, true);
  assert.equal(row?.bucket, 'Power Weapons');
});

test('refreshes a token within a minute of expiry', () => {
  const t = { accessExpiresAt: 1_000_000 } as Tokens;
  assert.equal(needsRefresh(t, 1_000_000 - 30_000), true);
  assert.equal(needsRefresh(t, 1_000_000 - 120_000), false);
});
