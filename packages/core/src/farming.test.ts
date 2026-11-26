import { test } from 'node:test';
import assert from 'node:assert/strict';
import { farmTargets, sourceGroup } from './farming.ts';
import type { WishList } from './wishlist.ts';

const def = (name: string, itemType = 3) => ({ displayProperties: { name, icon: '/i.png' }, itemType, itemTypeDisplayName: 'Hand Cannon', inventory: { tierTypeName: 'Legendary' } });
const manifest = {
  items: {
    1: def('Chased'), 2: def('Popular'), 3: def('Obscure'), 4: def('Have it'), 5: def('On sale'), 6: def('Eververse gun'), 7: def('Armor', 2),
    101: def('Perk A'), 102: def('Perk B'),
  },
  sources: { 1: '"Vault of Glass" Raid', 2: 'Complete strikes and earn rank-up packages from Commander Zavala.', 6: 'Eververse', 5: 'Banshee-44' },
} as never;
const god = { perks: [101, 102], tags: ['pve', 'god-pve'], trash: false };
const list: WishList = new Map([1, 2, 3, 4, 5, 6, 7].map((h) => [h, [god, { perks: [101], tags: ['pvp'], trash: false }]]));

test('lists missing god rolls you chase, can buy, or players use; skips what you have and what you cannot farm', () => {
  const out = farmTargets({
    manifest, wishList: list,
    items: [
      { itemHash: 1, itemType: 3, appraisal: { verdict: 'meh' } },
      { itemHash: 4, itemType: 3, appraisal: { verdict: 'god' } },
    ],
    vendors: [{ itemHash: 5, vendorName: 'Banshee-44', appraisal: { verdict: 'god' } }],
    seen: { 2: 40, 3: 2, 6: 99 },
  });
  assert.deepEqual(out.map((t) => t.name), ['On sale', 'Chased', 'Popular']);
  assert.deepEqual(out[0]!.vendor, { name: 'Banshee-44', god: true, good: true });
  assert.deepEqual(out[1]!.roll, { perks: ['Perk A', 'Perk B'], use: 'pve' });
  assert.equal(out[1]!.owned.copies, 1);
  assert.equal(out[2]!.seen, 40);
});

test('the limit keeps room for popular weapons you have never had', () => {
  const out = farmTargets({ manifest, wishList: list, items: [{ itemHash: 1, itemType: 3 }], seen: { 2: 40 }, limit: 1 });
  assert.equal(out.length, 1);
});

test('source names shorten for grouping', () => {
  assert.equal(sourceGroup('"Vault of Glass" Raid'), 'Vault of Glass raid');
  assert.equal(sourceGroup('Complete strikes and earn rank-up packages from Commander Zavala.'), 'Commander Zavala');
  assert.equal(sourceGroup('Open Legendary engrams and earn faction rank-up packages.'), 'Legendary engrams');
  assert.equal(sourceGroup('Acquired from Xûr'), 'Xûr');
  assert.equal(sourceGroup(undefined), 'Other');
});
