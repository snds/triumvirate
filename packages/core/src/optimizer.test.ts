import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARMOR_BUCKETS, ARMOR_STATS, baseStats, optimizeArmor, type OptimizerItem } from './optimizer.ts';

let n = 1;
/** A Warlock armor piece with stats in game order: Weapons, Health, Class, Grenade, Super, Melee. */
const piece = (slot: number, stats: number[], over: Partial<OptimizerItem> = {}): OptimizerItem => ({
  instanceId: String(n++), itemHash: 1000 + slot, name: `Piece ${n}`, tier: 'Legendary', classType: 2, itemType: 2,
  bucketHash: ARMOR_BUCKETS[slot], owner: 'vault', equipped: false,
  stats: Object.fromEntries(ARMOR_STATS.map((s, i) => [s, stats[i]!])), ...over,
});
const flat = (v: number) => [v, v, v, v, v, v];
const grenadeHeavy = [0, 10, 0, 30, 0, 0];
const healthHeavy = [0, 30, 0, 0, 0, 10];

test('baseStats takes mods and masterwork back off', () => {
  assert.deepEqual(baseStats({ statDetails: [{ hash: 1, name: 'Grenade', value: 40, bonus: 10, numeric: false }] }), [0, 0, 0, 30, 0, 0]);
  assert.deepEqual(baseStats({ stats: { Health: 12 } }), [0, 12, 0, 0, 0, 0]);
});

test('picks the pieces that reach the targets, and plans mods for the rest', () => {
  const items = [0, 1, 2, 3, 4].flatMap((s) => [piece(s, grenadeHeavy), piece(s, healthHeavy)]);
  const out = optimizeArmor({ items, classType: 2, targets: { Grenade: 150 }, priority: ['Grenade'], modSlots: 0 });
  assert.equal(out.results[0]!.total[3], 150);
  assert.ok(out.results[0]!.pieces.every((p) => p.stats[3] === 30));
  const withMods = optimizeArmor({ items, classType: 2, targets: { Grenade: 150, Health: 100 }, modSlots: 5 });
  const best = withMods.results[0]!;
  assert.ok(best.total[3]! >= 150 && best.total[1]! >= 100);
  assert.ok(best.mods.reduce((a, b) => a + b, 0) <= 5);
});

test('says why when nothing fits', () => {
  const items = [0, 1, 2, 3, 4].map((s) => piece(s, flat(5)));
  const out = optimizeArmor({ items, classType: 2, targets: { Super: 200 }, modSlots: 5 });
  assert.equal(out.results.length, 0);
  assert.match(out.reason!, /No combination/);
  assert.match(optimizeArmor({ items: items.slice(1), classType: 2, targets: {} }).reason!, /helmet/);
});

test('only this class, and at most one exotic', () => {
  const items = [0, 1, 2, 3, 4].flatMap((s) => [
    piece(s, flat(5)),
    piece(s, flat(30), { tier: 'Exotic', itemHash: 5000 + s }),
    piece(s, flat(40), { classType: 1 }),
  ]);
  const out = optimizeArmor({ items, classType: 2, targets: {} });
  for (const r of out.results) {
    assert.ok(r.pieces.filter((p) => p.exotic).length <= 1);
    assert.ok(r.pieces.every((p) => !p.stats.includes(40)));
  }
  const none = optimizeArmor({ items, classType: 2, targets: {}, exotic: 'none' });
  assert.ok(none.results.every((r) => r.pieces.every((p) => !p.exotic)));
  const chosen = optimizeArmor({ items, classType: 2, targets: {}, exotic: 5002 });
  assert.ok(chosen.results.length > 0 && chosen.results.every((r) => r.pieces.some((p) => p.itemHash === 5002)));
});

test('a set bonus requirement keeps enough pieces of the set', () => {
  const SET = 77;
  const items = [0, 1, 2, 3, 4].flatMap((s) => [piece(s, flat(30)), piece(s, flat(10), { setHash: SET })]);
  const out = optimizeArmor({ items, classType: 2, targets: {}, set: { hash: SET, pieces: 4 } }, { [SET]: { name: 'Test Set', perks: [] } });
  const best = out.results[0]!;
  assert.equal(best.sets[0]!.count, 4);
  assert.equal(best.sets[0]!.name, 'Test Set');
});

test('pieces beaten in every stat are dropped before searching', () => {
  const items = [0, 1, 2, 3, 4].flatMap((s) => [piece(s, flat(20)), piece(s, flat(10)), piece(s, grenadeHeavy)]);
  const out = optimizeArmor({ items, classType: 2, targets: {} });
  assert.deepEqual(out.candidates, [2, 2, 2, 2, 2]);
});
