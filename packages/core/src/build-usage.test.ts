import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUsage, extractArmorSamples, suggestBuilds, type ArmorSample } from './build-usage.ts';
import { DEFAULT_BUILDS } from './builds.ts';

const STAT_NAMES = ['Weapons', 'Health', 'Class', 'Grenade', 'Super', 'Melee'];
const manifest = {
  items: {
    10: { itemType: 2, displayProperties: { name: 'Gyrfalcon\'s Hauberk' }, inventory: { tierTypeName: 'Exotic' } },
    11: { itemType: 2, displayProperties: { name: 'Wormhusk Crown' }, inventory: { tierTypeName: 'Exotic' } },
    20: { itemType: 2, displayProperties: { name: 'Set helm' }, inventory: { tierTypeName: 'Legendary' } },
    21: { itemType: 2, displayProperties: { name: 'Set arms' }, inventory: { tierTypeName: 'Legendary' } },
    30: { itemType: 16, displayProperties: { name: 'Nightstalker' } },
  },
  extras: { 20: { itemSetHash: 500 }, 21: { itemSetHash: 500 } },
  stats: Object.fromEntries(STAT_NAMES.map((n, i) => [String(100 + i), { displayProperties: { name: n } }])),
  itemSets: { 500: { name: 'Techsec', perks: [] } },
} as never;

test('armor samples: exotic, sets worn as a set, subclass, stat totals, once per character', () => {
  const pgcr = {
    period: '2026-11-26T03:00:00Z', activityDetails: { instanceId: 'm1', mode: 82, modes: [82] },
    entries: [{ characterId: 'c1', player: { destinyUserInfo: { membershipId: 'p1' } } }, { characterId: 'c1', player: { destinyUserInfo: { membershipId: 'p1' } } }],
  } as never;
  const profiles = { p1: {
    characters: { data: { c1: { classType: 1, stats: { 100: 30, 101: 80, 102: 120, 103: 10, 104: 40, 105: 5 } } } },
    characterEquipment: { data: { c1: { items: [{ itemHash: 10, bucketHash: 1 }, { itemHash: 20, bucketHash: 2 }, { itemHash: 21, bucketHash: 3 }, { itemHash: 30, bucketHash: 3284755031 }] } } },
  } } as never;
  const s = extractArmorSamples(manifest, pgcr, profiles);
  assert.equal(s.length, 1);
  assert.deepEqual(s[0], { match: 'm1', at: '2026-11-26T03:00:00Z', role: 'pve-endgame', character: 'c1', classType: 1, exotic: 10, sets: [500], subclass: 30, stats: [30, 80, 120, 10, 40, 5] });
});

test('usage and suggestions: most worn per class and activity, skipping exotics already listed', () => {
  const mk = (i: number, exotic: number, role: ArmorSample['role'] = 'pve-endgame'): ArmorSample => ({
    match: `m${i}`, at: '2026-11-26T03:00:00Z', role, character: `c${i}`, classType: 1, exotic, sets: [500], subclass: 30, stats: [30, 80, 120, 10, 40, 5],
  });
  const samples = [
    ...Array.from({ length: 8 }, (_, i) => mk(i, 11)), // Wormhusk, 8 players
    ...Array.from({ length: 6 }, (_, i) => mk(100 + i, 10)), // Gyrfalcon, already a default build
    mk(200, 11), mk(200, 11), // same character twice: counts once
    ...Array.from({ length: 5 }, (_, i) => mk(300 + i, 11, 'pvp')),
  ];
  const u = buildUsage(manifest, samples, new Date('2026-11-26T12:00:00Z'));
  const worm = u.usage.find((x) => x.name === 'Wormhusk Crown' && x.activity === 'endgame')!;
  assert.equal(worm.players, 9);
  assert.deepEqual(worm.stats, ['Class', 'Health', 'Super']);
  assert.equal(worm.set, 'Techsec');
  assert.equal(worm.subclass, 'Nightstalker');
  const s = suggestBuilds(u, DEFAULT_BUILDS);
  assert.deepEqual(s.map((x) => x.build.exotic), ['Wormhusk Crown']);
  assert.deepEqual(s[0]!.build.activities, ['endgame', 'pvp']);
  assert.equal(s[0]!.build.source, 'community');
  assert.match(s[0]!.why, /^Worn by 60% of Hunters in endgame \(9 seen\)$/);
});
