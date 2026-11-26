import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maxPower } from './power.ts';
import type { ItemRow } from './vault.ts';

const B = { kinetic: 1498876634, energy: 2465295065, power: 953998645, helmet: 3448274439, arms: 3551918588, chest: 14239492, legs: 20886954, cls: 1585787867 };
let n = 0;
const gear = (bucketHash: number, power: number, o: Partial<ItemRow> = {}): ItemRow => ({
  location: 'Vault', owner: 'vault', name: `Item ${++n}`, type: '', bucket: '', bucketHash, equipped: false, itemHash: n,
  instanceId: String(n), tier: 'Legendary', itemType: [B.kinetic, B.energy, B.power].includes(bucketHash) ? 3 : 2,
  classType: [B.kinetic, B.energy, B.power].includes(bucketHash) ? 3 : 2, locked: false, power, ...o,
});

test('best per slot, one exotic per group, class-locked armor', () => {
  const items = [
    gear(B.kinetic, 550), gear(B.kinetic, 560, { tier: 'Exotic' }),
    gear(B.energy, 540), gear(B.energy, 570, { tier: 'Exotic' }), // +30 beats +10, so the energy exotic counts
    gear(B.power, 550),
    gear(B.helmet, 550), gear(B.arms, 550), gear(B.chest, 550), gear(B.legs, 550), gear(B.cls, 550),
    gear(B.helmet, 600, { classType: 0 }), // Titan helmet: not for a Warlock
    gear(B.chest, 560, { tier: 'Exotic' }), gear(B.legs, 565, { tier: 'Exotic' }),
  ];
  const p = maxPower(items, 2);
  assert.deepEqual(p.weapons.map((s) => s.power), [550, 570, 550]);
  assert.deepEqual(p.armor.map((s) => s.power), [550, 550, 550, 565, 550]);
  assert.equal(p.total, (550 + 570 + 550 + 550 * 4 + 565) / 8);
});

test('a slot with only an exotic still counts', () => {
  const p = maxPower([gear(B.kinetic, 500, { tier: 'Exotic' }), gear(B.energy, 520, { tier: 'Exotic' })], 2);
  assert.equal(p.weapons[0]!.power, 500);
  assert.equal(p.weapons[1]!.power, 520);
  assert.equal(p.weapons[2]!.power, 0);
  assert.equal(p.weapons[2]!.item, undefined);
});
