import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vendorWeapons } from './vendors.ts';
import type { ManifestTables } from './manifest.ts';

const manifest = {
  version: 't',
  items: {
    100: { displayProperties: { name: 'Sold Gun' }, itemTypeDisplayName: 'Hand Cannon', itemType: 3, inventory: { tierTypeName: 'Legendary', bucketTypeHash: 1 } },
    200: { displayProperties: { name: 'Shader' }, itemTypeDisplayName: 'Shader', itemType: 19, inventory: { tierTypeName: 'Legendary' } },
    300: { displayProperties: { name: 'Blue Gun' }, itemTypeDisplayName: 'Hand Cannon', itemType: 3, inventory: { tierTypeName: 'Rare' } },
    5: { displayProperties: { name: 'Explosive Payload' }, itemTypeDisplayName: 'Trait' },
    6: { displayProperties: { name: 'Rewind Rounds' }, itemTypeDisplayName: 'Trait' },
  },
  buckets: { 1: { displayProperties: { name: 'Kinetic Weapons' } } },
  stats: {},
} as unknown as ManifestTables;

const response = {
  sales: { data: { 77: { saleItems: { 0: { itemHash: 100, vendorItemIndex: 0 }, 1: { itemHash: 200, vendorItemIndex: 1 }, 2: { itemHash: 300, vendorItemIndex: 2 } } } } },
  itemComponents: {
    77: {
      sockets: { data: { 0: { sockets: [{ plugHash: 5, isVisible: true }] }, 2: { sockets: [{ plugHash: 5 }] } } },
      reusablePlugs: { data: { 0: { plugs: { 0: [{ plugItemHash: 5 }, { plugItemHash: 6 }] } } } },
    },
  },
} as any;

test('vendorWeapons reads legendary weapons for sale with their perk columns, once per roll', () => {
  const rows = vendorWeapons([{ characterId: 'c1', vendors: response }, { characterId: 'c2', vendors: response }], manifest, () => 'Banshee-44');
  assert.equal(rows.length, 1);
  const r = rows[0]!;
  assert.equal(r.name, 'Sold Gun');
  assert.equal(r.location, 'Banshee-44');
  assert.equal(r.owner, 'vendor:77');
  assert.equal(r.characterId, 'c1');
  assert.equal(r.bucket, 'Kinetic Weapons');
  assert.deepEqual(r.perks?.[0]?.map((p) => [p.name, p.active]), [['Explosive Payload', true], ['Rewind Rounds', false]]);
  assert.equal(r.movable, undefined);
});
