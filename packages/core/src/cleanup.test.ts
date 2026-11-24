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
