import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DestinyProfileResponse } from 'bungie-api-ts/destiny2';
import { summarizeAccount, summarizeCharacters, summarizeProfile, VAULT_BUCKET } from './vault.ts';
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
    { itemHash: 1, bucketHash: VAULT_BUCKET, itemInstanceId: 'a', state: 1 },
    { itemHash: 99, bucketHash: 375726501 }, // consumable bucket: must be skipped
  ] } },
  characters: { data: { c1: { classType: 2, light: 2010 } } },
  characterEquipment: { data: { c1: { items: [{ itemHash: 2, bucketHash: 20, itemInstanceId: 'b', state: 0 }] } } },
  characterInventories: { data: { c1: { items: [] } } },
  itemComponents: { instances: { data: { a: { primaryStat: { value: 1990 }, damageType: 2 }, b: { primaryStat: { value: 2010 } } } } },
} as unknown as DestinyProfileResponse;

test('lists vault items with their real bucket and power', () => {
  const rows = summarizeProfile(profile, manifest);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    { ...rows[0] },
    {
      location: 'Vault', owner: 'vault', name: 'Fatebringer', type: 'Hand Cannon', bucket: 'Kinetic Weapons', bucketHash: 10,
      power: 1990, equipped: false, itemHash: 1, instanceId: 'a', icon: undefined, watermark: undefined,
      tier: '', itemType: 0, classType: 3, damage: 'Arc', locked: true,
      gearTier: undefined, perks: undefined, stats: undefined, damageIcon: undefined,
    },
  );
});

test('labels character gear by class and marks it equipped', () => {
  const row = summarizeProfile(profile, manifest)[1];
  assert.equal(row?.location, 'Warlock (2010)');
  assert.equal(row?.equipped, true);
  assert.equal(row?.bucket, 'Power Weapons');
  assert.equal(row?.owner, 'c1');
  assert.equal(row?.locked, false);
});

test('orders characters by most recently played', () => {
  const p = {
    characters: { data: {
      old: { classType: 0, light: 10, dateLastPlayed: '2026-01-01T00:00:00Z' },
      new: { classType: 1, light: 20, dateLastPlayed: '2026-11-01T00:00:00Z', emblemBackgroundPath: '/e.jpg' },
    } },
  } as unknown as DestinyProfileResponse;
  const chars = summarizeCharacters(p);
  assert.deepEqual(chars.map((c) => c.className), ['Hunter', 'Titan']);
  assert.equal(chars[0]?.emblemBackground, 'https://www.bungie.net/e.jpg');
});

test('reads weapon perk columns and armor stats', () => {
  const m = {
    ...manifest,
    items: {
      10: { displayProperties: { name: 'Gun' }, itemType: 3, inventory: { bucketTypeHash: 10 } },
      11: { displayProperties: { name: 'Hood' }, itemType: 2, inventory: { bucketTypeHash: 10 } },
      20: { displayProperties: { name: 'Rampage', icon: '/r.png' }, itemTypeDisplayName: 'Trait' },
      21: { displayProperties: { name: 'Kill Clip' }, itemTypeDisplayName: 'Trait' },
      22: { displayProperties: { name: 'Default Shader' }, itemTypeDisplayName: 'Shader' },
    },
    stats: { 900: { displayProperties: { name: 'Health' } } },
  } as unknown as ManifestTables;
  const p = {
    profileInventory: { data: { items: [
      { itemHash: 10, bucketHash: VAULT_BUCKET, itemInstanceId: 'w', state: 0 },
      { itemHash: 11, bucketHash: VAULT_BUCKET, itemInstanceId: 'a', state: 0 },
    ] } },
    itemComponents: {
      instances: { data: { w: {}, a: { gearTier: 4 } } },
      sockets: { data: { w: { sockets: [{ plugHash: 20, isVisible: true }, { plugHash: 22, isVisible: true }] } } },
      reusablePlugs: { data: { w: { plugs: { 0: [{ plugItemHash: 20 }, { plugItemHash: 21 }] } } } },
      stats: { data: { a: { stats: { 900: { statHash: 900, value: 27 } } } } },
    },
  } as unknown as DestinyProfileResponse;
  const [gun, hood] = summarizeProfile(p, m);
  assert.deepEqual(gun?.perks, [[
    { name: 'Rampage', icon: 'https://www.bungie.net/r.png', active: true },
    { name: 'Kill Clip', icon: undefined, active: false },
  ]]);
  assert.deepEqual(hood?.stats, { Health: 27 });
  assert.equal(hood?.gearTier, 4);
});

test('refreshes a token within a minute of expiry', () => {
  const t = { accessExpiresAt: 1_000_000 } as Tokens;
  assert.equal(needsRefresh(t, 1_000_000 - 30_000), true);
  assert.equal(needsRefresh(t, 1_000_000 - 120_000), false);
});

test('adds title and stats in game order, skipping Power', () => {
  const p = {
    characters: { data: {
      c1: { classType: 2, light: 2010, dateLastPlayed: '2026-11-01T00:00:00Z',
        stats: { 1935470627: 2010, 392767087: 100, 2996146975: 30 } },
    } },
  } as unknown as DestinyProfileResponse;
  const m = { stats: {
    392767087: { displayProperties: { name: 'Health', icon: '/h.png' } },
    2996146975: { displayProperties: { name: 'Weapons', icon: '/w.png' } },
  } } as unknown as ManifestTables;
  const [c] = summarizeCharacters(p, m, { c1: 'Iron Lord' });
  assert.equal(c?.title, 'Iron Lord');
  assert.deepEqual(c?.stats, [
    { name: 'Weapons', value: 30, icon: 'https://www.bungie.net/w.png' },
    { name: 'Health', value: 100, icon: 'https://www.bungie.net/h.png' },
  ]);
});

test('summarizes currencies and vault space', () => {
  const p = {
    profileCurrencies: { data: { items: [{ itemHash: 1, quantity: 500000 }] } },
    profileInventory: { data: { items: [{ bucketHash: VAULT_BUCKET }, { bucketHash: VAULT_BUCKET }, { bucketHash: 5 }] } },
  } as unknown as DestinyProfileResponse;
  const m = {
    items: { 1: { displayProperties: { name: 'Glimmer', icon: '/g.png' } } },
    buckets: { [VAULT_BUCKET]: { itemCount: 700 } },
  } as unknown as ManifestTables;
  assert.deepEqual(summarizeAccount(p, m), {
    currencies: [{ name: 'Glimmer', quantity: 500000, icon: 'https://www.bungie.net/g.png' }],
    vault: { used: 2, capacity: 700 },
  });
});

test('splits weapon sockets into frame, perks, and mods, with stat bonuses and crafted level', () => {
  const m = {
    ...manifest,
    items: {
      10: { displayProperties: { name: 'Gun' }, itemType: 3, inventory: { bucketTypeHash: 10 } },
      30: { displayProperties: { name: 'Rapid-Fire Frame' }, itemTypeDisplayName: 'Intrinsic' },
      31: { displayProperties: { name: 'Fluted Barrel', description: 'Handling up.' }, itemTypeDisplayName: 'Barrel' },
      32: { displayProperties: { name: 'Rampage' }, itemTypeDisplayName: 'Enhanced Trait' },
      33: { displayProperties: { name: 'Masterworked: Stability' }, itemTypeDisplayName: 'Masterwork' },
      34: { displayProperties: { name: 'Default Shader' }, itemTypeDisplayName: 'Shader' },
      40: { displayProperties: { name: 'Shaped Weapon' }, itemTypeDisplayName: 'Memento' },
    },
    stats: { 155624089: { displayProperties: { name: 'Stability' } }, 4284893193: { displayProperties: { name: 'Rounds Per Minute' } } },
    extras: {
      10: { statGroupHash: 7, socketCategories: [[3956125808, [0]], [4241085061, [1, 2]], [2685412949, [3, 4]]] },
      31: { investment: [[155624089, 5]] },
      33: { investment: [[155624089, 10]] },
    },
    statGroups: { 7: { scaledStats: [{ statHash: 4284893193, displayAsNumeric: true }, { statHash: 155624089 }] } },
    objectives: { 99: { uiStyle: 2 } },
  } as unknown as ManifestTables;
  const p = {
    profileInventory: { data: { items: [{ itemHash: 10, bucketHash: VAULT_BUCKET, itemInstanceId: 'w', state: 8 }] } },
    itemComponents: {
      instances: { data: {} },
      sockets: { data: { w: { sockets: [{ plugHash: 30 }, { plugHash: 31 }, { plugHash: 32 }, { plugHash: 33 }, { plugHash: 34 }] } } },
      stats: { data: { w: { stats: { 155624089: { statHash: 155624089, value: 60 }, 4284893193: { statHash: 4284893193, value: 720 } } } } },
      plugObjectives: { data: { w: { objectivesPerPlug: { 40: [{ objectiveHash: 99, progress: 17 }] } } } },
    },
  } as unknown as DestinyProfileResponse;
  const [gun] = summarizeProfile(p, m);
  assert.equal(gun?.intrinsic?.name, 'Rapid-Fire Frame');
  assert.deepEqual(gun?.perks?.map((c) => c[0]?.name), ['Fluted Barrel', 'Rampage']);
  assert.equal(gun?.perks?.[1]?.[0]?.enhanced, true);
  assert.equal(gun?.perks?.[0]?.[0]?.description, 'Handling up.');
  assert.deepEqual(gun?.mods?.map((x) => x.name), ['Masterworked: Stability']);
  assert.deepEqual(gun?.statDetails, [
    { hash: 4284893193, name: 'Rounds Per Minute', value: 720, bonus: 0, numeric: true },
    { hash: 155624089, name: 'Stability', value: 60, bonus: 15, numeric: false },
  ]);
  assert.equal(gun?.crafted, true);
  assert.equal(gun?.craftedLevel, 17);
});
