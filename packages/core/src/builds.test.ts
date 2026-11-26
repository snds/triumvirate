import { test } from 'node:test';
import assert from 'node:assert/strict';
import { armorKeeps, cleanupCandidates, type AppraisedItem } from './cleanup.ts';
import { bestInSlot, cleanBuilds, DEFAULT_BUILDS, type PopularBuild } from './builds.ts';
import { ARMOR_BUCKETS } from './optimizer.ts';

const [HELM, ARMS, CHEST] = ARMOR_BUCKETS;
const SETS = { 700: { name: 'Techsec', perks: [] }, 800: { name: 'Bushido', perks: [] } };
let n = 0;
const piece = (stats: Partial<Record<string, number>>, o: Partial<AppraisedItem> = {}): AppraisedItem => ({
  location: 'Vault', owner: 'vault', name: 'Helm', type: 'Helmet', bucket: 'Helmet', bucketHash: HELM, equipped: false,
  itemHash: 900 + ++n, instanceId: String(1000 + n), tier: 'Legendary', itemType: 2, classType: 2, locked: false,
  stats: stats as Record<string, number>, gearTier: 3, ...o,
});
const build = (o: Partial<PopularBuild> = {}): PopularBuild => ({ id: 'b', name: 'Grenade build', classType: 2, activities: ['endgame'], stats: ['Grenade', 'Class', 'Health'], ...o });

test('a set piece is kept when only a piece outside the set beats it', () => {
  const setHelm = piece({ Grenade: 20, Class: 10 }, { name: 'Techsec Helm', setHash: 700 });
  const looseHelm = piece({ Grenade: 30, Class: 20 }, { name: 'Loose Helm' });
  const out = cleanupCandidates([setHelm, looseHelm], {}, { sets: SETS });
  assert.deepEqual(out, []);
  const keeps = armorKeeps([setHelm, looseHelm], { sets: SETS });
  assert.equal(keeps[0]?.item, setHelm);
  assert.equal(keeps[0]?.saved, true);
  assert.match(keeps[0]!.reasons[0]!, /best Techsec helmet \(1 of 5 pieces/);
});

test('a set piece goes when another piece of the same set has an equal or better roll', () => {
  const keeper = piece({ Grenade: 30, Class: 20 }, { name: 'Techsec Helm', setHash: 700, location: 'Warlock', owner: 'w', power: 5 });
  const worse = piece({ Grenade: 20, Class: 20 }, { name: 'Techsec Helm', setHash: 700 });
  const twin = piece({ Grenade: 30, Class: 20 }, { name: 'Techsec Helm', setHash: 700, power: 1 });
  const other = piece({ Grenade: 10, Class: 10 }, { name: 'Bushido Helm', setHash: 800 });
  const out = cleanupCandidates([keeper, worse, twin, other], {}, { sets: SETS });
  assert.deepEqual(out.map((c) => c.item).sort((a, b) => a.instanceId!.localeCompare(b.instanceId!)), [worse, twin]);
  assert.ok(out.every((c) => c.keeperId === keeper.instanceId));
  assert.match(out.find((c) => c.item === twin)!.reason, /the same roll/);
  assert.equal(out[0]!.signals?.set, 'Techsec');
});

test('a loose legendary still loses to a set piece that beats it', () => {
  const setHelm = piece({ Grenade: 30, Class: 20 }, { setHash: 700 });
  const loose = piece({ Grenade: 20, Class: 20 });
  assert.deepEqual(cleanupCandidates([setHelm, loose], {}, { sets: SETS }).map((c) => c.item), [loose]);
});

test('compares rolled stats, not mods', () => {
  // Shows more Grenade only because of a +10 mod.
  const modded = piece({ Grenade: 30 }, { statDetails: [{ hash: 1, name: 'Grenade', value: 30, bonus: 10, numeric: false }] });
  const plain = piece({ Grenade: 25 });
  assert.deepEqual(cleanupCandidates([modded, plain]).map((c) => c.item), [modded]);
});

test('best in slot for a build keeps a piece out of the junk list and tags its activities', () => {
  const grenade = piece({ Grenade: 30, Health: 5 }, { name: 'Grenadier Helm' });
  const allRound = piece({ Grenade: 31, Health: 6, Class: 1 }, { name: 'Better Helm' });
  const pvpHelm = piece({ Weapons: 30, Health: 5 }, { name: 'Gunner Helm' });
  const pvpWorse = piece({ Weapons: 20, Health: 5 }, { name: 'Worse Gunner' });
  const builds = [build(), build({ id: 'p', name: 'Duelist', activities: ['pvp'], stats: ['Weapons', 'Health'] })];
  // Better Helm covers Grenadier Helm; Gunner Helm is the Duelist pick, so only its weaker twin goes.
  const out = cleanupCandidates([grenade, allRound, pvpHelm, pvpWorse], {}, { builds });
  assert.deepEqual(out.map((c) => c.item), [grenade, pvpWorse]);
  const keeps = armorKeeps([grenade, allRound, pvpHelm, pvpWorse], { builds });
  const gunner = keeps.find((k) => k.item === pvpHelm)!;
  assert.deepEqual(gunner.activities, ['pvp']);
  assert.match(gunner.reasons[0]!, /Best helmet you have for the Duelist build/);
});

test('the build exotic: best copy wins its slot, legendaries fill the rest', () => {
  const ga1 = piece({ Grenade: 20 }, { name: 'Getaway Artist', tier: 'Exotic', bucketHash: ARMS, itemHash: 5 });
  const ga2 = piece({ Grenade: 25 }, { name: 'Getaway Artist', tier: 'Exotic', bucketHash: ARMS, itemHash: 5 });
  const legArms = piece({ Grenade: 40 }, { bucketHash: ARMS });
  const chest = piece({ Grenade: 10 }, { bucketHash: CHEST });
  const fits = bestInSlot([ga1, ga2, legArms, chest], [build({ exotic: 'Getaway Artist' })]);
  assert.deepEqual([...fits.keys()].sort(), [ga2.instanceId, chest.instanceId].sort());
  assert.equal(fits.get(ga2.instanceId!)![0]!.exotic, true);
  // The weaker copy of the exotic is still a cleanup pick.
  assert.deepEqual(cleanupCandidates([ga1, ga2, legArms, chest], {}, { builds: [build({ exotic: 'Getaway Artist' })] }).map((c) => c.item), [ga1]);
});

test('a build that names a set uses set pieces where you own one', () => {
  const setHelm = piece({ Grenade: 10 }, { setHash: 700 });
  const loose = piece({ Grenade: 30 });
  const fits = bestInSlot([setHelm, loose], [build({ set: 'techsec' })], SETS);
  assert.deepEqual([...fits.keys()], [setHelm.instanceId]);
});

test('off builds and other classes protect nothing', () => {
  const helm = piece({ Grenade: 10 });
  assert.equal(bestInSlot([helm], [build({ off: true }), build({ classType: 0 })]).size, 0);
});

test('cleanBuilds drops malformed entries and keeps the defaults valid', () => {
  assert.equal(cleanBuilds(DEFAULT_BUILDS).length, DEFAULT_BUILDS.length);
  const out = cleanBuilds([{ name: 'x', classType: 2, activities: ['endgame', 'nope'], stats: ['Grenade', 'Luck'] }, { name: '', classType: 1 }, 'junk', { name: 'y', classType: 9, activities: ['pvp'], stats: ['Health'] }]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0]!.activities, ['endgame']);
  assert.deepEqual(out[0]!.stats, ['Grenade']);
});
