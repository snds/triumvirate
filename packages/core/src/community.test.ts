import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyMode, extractSamples, rollup, type Sample } from './community.ts';
import type { ManifestTables } from './manifest.ts';

const PERKS = 4241085061;
const GUN = 100, BLUE_GUN = 101;
// Plug hashes: barrels 1-2, mags 3-4, trait A 5-6 (+ 56 enhanced 5), trait B 7-8, masterwork 9, mod 10.
const named = (name: string, type = 'Trait') => ({ displayProperties: { name }, itemTypeDisplayName: type });
const manifest = {
  version: 't',
  items: {
    [GUN]: { ...named('Test Hand Cannon', 'Hand Cannon'), inventory: { tierType: 5 } },
    [BLUE_GUN]: { ...named('Blue Gun', 'Hand Cannon'), inventory: { tierType: 4 } },
    1: named('Smallbore', 'Barrel'), 2: named('Arrowhead Brake', 'Barrel'),
    3: named('Ricochet Rounds', 'Magazine'), 4: named('Flared Magwell', 'Magazine'),
    5: named('Explosive Payload'), 56: named('Explosive Payload Enhanced', 'Enhanced Trait'), 6: named('Rewind Rounds'),
    7: named('Firefly'), 8: named('Frenzy'),
    9: named('Masterworked: Range', 'Masterwork'), 10: named('Backup Mag', 'Weapon Mod'),
  },
  buckets: {},
  stats: { 1240592695: { displayProperties: { name: 'Range' } }, 155624089: { displayProperties: { name: 'Stability' } } },
  extras: {
    [GUN]: { socketCategories: [[PERKS, [1, 2, 3, 4]]], socketEntries: [[0, 0], [11, 0], [12, 0], [13, 0], [14, 0], [0, 0], [0, 0]] },
    1: { plugCategory: 'barrels', investment: [[1240592695, 6], [155624089, 6]] },
    2: { plugCategory: 'barrels', investment: [[155624089, 10]] },
    3: { plugCategory: 'magazines', investment: [[1240592695, 5]] },
    4: { plugCategory: 'magazines', investment: [[155624089, 10]] },
    5: { plugCategory: 'frames' }, 56: { plugCategory: 'frames' }, 6: { plugCategory: 'frames' },
    7: { plugCategory: 'frames' }, 8: { plugCategory: 'frames' },
    9: { plugCategory: 'v400.plugs.weapons.masterworks.stat.range', investment: [[1240592695, 10]] },
    10: { plugCategory: 'v400.weapon.mod_magazine' },
  },
  plugSets: { 11: [1, 2], 12: [3, 4], 13: [5, 56, 6], 14: [7, 8] },
} as unknown as ManifestTables;

test('classifyMode sorts activities into roles', () => {
  assert.equal(classifyMode(84, [5, 84]), 'pvp-endgame');
  assert.equal(classifyMode(19, [5, 19]), 'pvp');
  assert.equal(classifyMode(4, [7, 4]), 'pve-endgame');
  assert.equal(classifyMode(82, [7, 82]), 'pve-endgame');
  assert.equal(classifyMode(46, [7, 18, 46]), 'pve-endgame');
  assert.equal(classifyMode(18, [7, 18]), 'pve');
  assert.equal(classifyMode(6, [7, 6]), 'patrol');
  assert.equal(classifyMode(63, [7, 63, 64]), 'gambit');
  assert.equal(classifyMode(32, [5, 32]), undefined);
  assert.equal(classifyMode(40, []), undefined);
});

const v = (value: number) => ({ basic: { value } });
const pgcr = {
  period: '2026-11-24T20:00:00Z',
  activityDetails: { instanceId: 'm1', mode: 84, modes: [5, 84] },
  entries: [
    {
      standing: 0, characterId: 'c1', player: { destinyUserInfo: { membershipId: 'p1' } },
      values: { killsDeathsRatio: v(1.5) },
      extended: { weapons: [{ referenceId: GUN, values: { uniqueWeaponKills: v(12), uniqueWeaponPrecisionKills: v(8) } }, { referenceId: BLUE_GUN, values: { uniqueWeaponKills: v(3) } }] },
    },
    {
      standing: 1, characterId: 'c2', player: { destinyUserInfo: { membershipId: 'p2' } }, values: {},
      extended: { weapons: [{ referenceId: GUN, values: { uniqueWeaponKills: v(4) } }] },
    },
  ],
} as any;
const profiles = {
  p1: {
    characterEquipment: { data: { c1: { items: [{ itemHash: GUN, itemInstanceId: 'i1' }, { itemHash: BLUE_GUN, itemInstanceId: 'i9' }] } } },
    itemComponents: { sockets: { data: {
      i1: { sockets: [{ plugHash: 0 }, { plugHash: 1 }, { plugHash: 3 }, { plugHash: 56 }, { plugHash: 7 }, { plugHash: 9 }, { plugHash: 10 }] },
      i9: { sockets: [{ plugHash: 1 }] },
    } } },
  },
  // p2 swapped the gun out after the match: no sample.
  p2: { characterEquipment: { data: { c2: { items: [] } } }, itemComponents: { sockets: { data: {} } } },
} as any;

test('extractSamples keeps legendary weapons still equipped, with perks, masterwork, and mod', () => {
  const s = extractSamples(manifest, pgcr, profiles);
  assert.equal(s.length, 1);
  assert.deepEqual(s[0], {
    match: 'm1', at: '2026-11-24T20:00:00Z', role: 'pvp-endgame', itemHash: GUN, copy: 'i1',
    perks: [1, 3, 56, 7], kills: 12, precisionKills: 8, won: true, masterwork: 9, mod: 10, kd: 1.5,
  });
});

test('rollup counts each copy once, folds enhanced perks, and scores lift over chance', () => {
  const base = { at: '2026-11-24T20:00:00Z', role: 'pve-endgame' as const, itemHash: GUN, kills: 10, precisionKills: 0 };
  const samples: Sample[] = [
    { ...base, match: 'a', copy: 'x', perks: [1, 3, 56, 7], masterwork: 9 },
    { ...base, match: 'b', copy: 'x', perks: [1, 3, 56, 7], masterwork: 9 }, // same copy again
    { ...base, match: 'c', copy: 'y', perks: [1, 3, 5, 7], masterwork: 9 },
    { ...base, match: 'd', copy: 'z', perks: [2, 4, 6, 8] },
    { ...base, match: 'e', copy: 'w', perks: [1, 3, 5, 8], role: 'patrol' },
  ];
  const r = rollup(manifest, samples, new Date('2026-11-25T00:00:00Z'));
  const gun = r.weapons[GUN]!;
  const endgame = gun.roles.find((x) => x.role === 'pve-endgame')!;
  assert.equal(endgame.copies, 3);
  assert.equal(endgame.kills, 40);
  // Explosive Payload (enhanced folded in) on 2 of 3 copies; 2 perks in the column, so chance 0.5.
  const trait = endgame.columns[2]![0]!;
  assert.deepEqual([trait.hash, trait.copies, trait.chance], [5, 2, 0.5]);
  assert.ok(Math.abs(trait.lift - 4 / 3) < 1e-9);
  assert.deepEqual(endgame.combos[0], { hashes: [5, 7], copies: 2, share: 2 / 3 });
  assert.deepEqual(endgame.masterworks[0], { hash: 9, copies: 2, share: 2 / 3 });
  // Range-leaning barrel/mag picks plus range masterworks: Range leads the stat lean.
  assert.equal(endgame.statLean[0]!.statHash, 1240592695);
  assert.ok(endgame.statLean[0]!.delta > 0);
  assert.equal(r.from, '2026-11-24T20:00:00Z');
  assert.deepEqual(gun.roles.map((x) => x.role), ['pve-endgame', 'patrol']);
});

test('appraiseCommunity grades a roll, marks PvE/PvP perks, and spots a better option', async () => {
  const { appraiseCommunity } = await import('./community.ts');
  const at = '2026-11-24T20:00:00Z';
  const s = (copy: string, role: Sample['role'], perks: number[]): Sample =>
    ({ match: copy, at, role, itemHash: GUN, copy, perks, kills: 1, precisionKills: 0 });
  const samples: Sample[] = [
    // PvE loves Explosive Payload + Firefly; PvP loves Rewind + Firefly. Barrel 1 and mag 3 everywhere.
    ...['a', 'b', 'c', 'd', 'e', 'f'].map((c) => s(c, 'pve-endgame', [1, 3, 5, 7])),
    s('g', 'pve-endgame', [1, 3, 6, 8]),
    ...['h', 'i', 'j', 'k', 'l'].map((c) => s(c, 'pvp-endgame', [1, 3, 6, 7])),
  ];
  const w = rollup(manifest, samples).weapons[GUN];
  // A copy with Explosive Payload (enhanced) + Firefly: a PvE roll.
  const pve = appraiseCommunity(manifest, w, GUN, [[{ hash: 1, active: true }], [{ hash: 3, active: true }], [{ hash: 56, active: true }], [{ hash: 7, active: true }]]);
  assert.equal(pve.grade, 'S');
  assert.equal(pve.usedFor, 'pve-endgame');
  assert.equal(pve.rollType, 'pve');
  assert.equal(pve.perks[2]![0]!.use, 'pve');
  assert.equal(pve.perks[3]![0]!.use, 'both');
  // A copy slotted with the unpopular barrel and Frenzy, but able to switch to Firefly.
  const meh = appraiseCommunity(manifest, w, GUN, [[{ hash: 2, active: true }], [{ hash: 3, active: true }], [{ hash: 6, active: true }], [{ hash: 8, active: true }, { hash: 7, active: false }]]);
  assert.ok(meh.grade && meh.bestGrade);
  assert.equal(meh.betterPossible, true);
  assert.equal(meh.perks[3]![0]!.better, true);
  assert.equal(meh.perks[0]![0]!.rel, 0);
  // No data: no grade.
  assert.equal(appraiseCommunity(manifest, undefined, GUN, [[{ hash: 1, active: true }]]).grade, undefined);
});

test('bestPicks and scoreRoll agree with the best grade', async () => {
  const { appraiseCommunity, scoreRoll, toGrade } = await import('./community.ts');
  const at = '2026-11-24T20:00:00Z';
  const samples: Sample[] = ['a', 'b', 'c', 'd', 'e', 'f'].map((c) => ({ match: c, at, role: 'pve' as const, itemHash: GUN, copy: c, perks: [1, 3, 5, 7], kills: 1, precisionKills: 0 }));
  const w = rollup(manifest, samples).weapons[GUN];
  const a = appraiseCommunity(manifest, w, GUN, [[{ hash: 2, active: true }, { hash: 1, active: false }], [{ hash: 3, active: true }], [{ hash: 6, active: true }, { hash: 5, active: false }], [{ hash: 7, active: true }]]);
  assert.deepEqual(a.bestPicks, [1, 0, 1, 0]);
  assert.deepEqual(a.traitColumns, [false, false, true, true]);
  assert.equal(toGrade(scoreRoll(a.perks, a.traitColumns, a.bestPicks)), a.bestGrade);
  assert.equal(a.bestGrade, 'S');
});
