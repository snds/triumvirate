import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanupCandidates, dimSearch, type AppraisedItem } from './cleanup.ts';
import type { Verdict } from './wishlist.ts';

let n = 0;
const weapon = (verdict: Verdict, o: Partial<AppraisedItem> = {}): AppraisedItem => ({
  location: 'Vault', owner: 'vault', name: 'Fatebringer', type: 'Hand Cannon', bucket: 'Kinetic Weapons', equipped: false,
  itemHash: 1, instanceId: String(++n), tier: 'Legendary', itemType: 3, classType: 3, locked: false, power: 10,
  appraisal: { verdict, pve: false, pvp: false, rollCount: 5 }, ...o,
});
const armor = (stats: Record<string, number>, o: Partial<AppraisedItem> = {}): AppraisedItem => ({
  location: 'Vault', owner: 'vault', name: 'Helm', type: 'Helmet', bucket: 'Helmet', bucketHash: 9, equipped: false,
  itemHash: 50 + ++n, instanceId: String(n), tier: 'Legendary', itemType: 2, classType: 0, locked: false, stats, ...o,
});

test('flags weaker duplicates but keeps good rolls and locked copies', () => {
  const god = weapon('god');
  const meh = weapon('meh');
  const good = weapon('good');
  const lockedMeh = weapon('meh', { locked: true });
  const out = cleanupCandidates([meh, god, good, lockedMeh]);
  assert.deepEqual(out.map((c) => c.item), [meh]);
  assert.equal(out[0]?.confidence, 'high');
});

test('a lone unmatched roll is a medium-confidence suggestion; exotics are left alone', () => {
  const out = cleanupCandidates([weapon('meh', { itemHash: 7 }), weapon('meh', { itemHash: 8, tier: 'Exotic' })]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.confidence, 'medium');
});

test('armor beaten in every stat is flagged; a trade-off piece is not', () => {
  const best = armor({ Health: 20, Grenade: 20 }, { name: 'Best' });
  const worse = armor({ Health: 10, Grenade: 20 });
  const tradeoff = armor({ Health: 30, Grenade: 5 });
  const titanOnly = armor({ Health: 1, Grenade: 1 }, { classType: 1 });
  const out = cleanupCandidates([best, worse, tradeoff, titanOnly]);
  assert.deepEqual(out.map((c) => c.item), [worse]);
  assert.match(out[0]!.reason, /Best in the vault/);
});

test('higher gear tier protects a piece', () => {
  const lowTier = armor({ Health: 30 }, { gearTier: 2 });
  const highTier = armor({ Health: 20 }, { gearTier: 5 });
  assert.deepEqual(cleanupCandidates([lowTier, highTier]), []);
});

test('builds a DIM search for the candidates', () => {
  const out = cleanupCandidates([weapon('god', { itemHash: 3 }), weapon('meh', { itemHash: 3, instanceId: '42' })]);
  assert.equal(dimSearch(out), 'id:42');
});

test('community grades protect popular rolls and firm up weak ones', () => {
  const keeper = weapon('god', { itemHash: 20 });
  const popularDupe = weapon('meh', { itemHash: 20 });
  const middling = weapon('meh', { itemHash: 20 });
  const loneMehWeak = weapon('meh', { itemHash: 21 });
  const loneMehLoved = weapon('meh', { itemHash: 22 });
  const loneUnratedWeak = weapon('unrated', { itemHash: 23 });
  const loneTrashLoved = weapon('trash', { itemHash: 24 });
  const grades = {
    [popularDupe.instanceId!]: { grade: 'A' as const },
    [middling.instanceId!]: { grade: 'B' as const },
    [loneMehWeak.instanceId!]: { grade: 'F' as const },
    [loneMehLoved.instanceId!]: { grade: 'S' as const },
    [loneUnratedWeak.instanceId!]: { grade: 'D' as const },
    [loneTrashLoved.instanceId!]: { grade: 'A' as const },
  };
  const out = cleanupCandidates([keeper, popularDupe, middling, loneMehWeak, loneMehLoved, loneUnratedWeak, loneTrashLoved], grades);
  const by = new Map(out.map((c) => [c.item, c]));
  assert.equal(by.has(popularDupe), false, 'an A-grade duplicate stays');
  assert.equal(by.get(middling)?.confidence, 'medium');
  assert.equal(by.get(middling)?.keeperId, keeper.instanceId);
  assert.equal(by.get(loneMehWeak)?.confidence, 'high');
  assert.deepEqual(by.get(loneMehWeak)?.signals, { verdict: 'meh', grade: 'F' });
  assert.equal(by.has(loneMehLoved), false, 'an S-grade lone roll stays');
  assert.equal(by.get(loneUnratedWeak)?.confidence, 'medium');
  assert.equal(by.get(loneTrashLoved)?.confidence, 'medium');
});

test('community grade breaks a tie between duplicates', () => {
  const a = weapon('meh', { itemHash: 30, power: 10 });
  const b = weapon('meh', { itemHash: 30, power: 10 });
  const out = cleanupCandidates([a, b], { [b.instanceId!]: { grade: 'B' }, [a.instanceId!]: { grade: 'D' } });
  assert.deepEqual(out.map((c) => c.item), [a]);
});
