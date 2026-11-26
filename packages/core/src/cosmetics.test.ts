import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ManifestTables } from './manifest.ts';
import { cosmetics } from './cosmetics.ts';

test('lists collectible ghosts, ships, sparrows, and shaders once each, owned first', () => {
  const m = {
    items: {
      1: { itemType: 24, collectibleHash: 11, displayProperties: { name: 'Bad Shell', icon: '/g.png', highResIcon: '/g-hi.png' }, inventory: { tierTypeName: 'Legendary' } },
      2: { itemType: 24, collectibleHash: 11, displayProperties: { name: 'Bad Shell (dupe)' } },
      3: { itemType: 21, collectibleHash: 13, displayProperties: { name: 'Arrowhead' }, inventory: { tierTypeName: 'Exotic' } },
      4: { itemType: 22, collectibleHash: 14, displayProperties: { name: 'Hidden Sparrow' } },
      5: { itemType: 19, itemSubType: 20, collectibleHash: 15, displayProperties: { name: 'Gloom' } },
      6: { itemType: 3, collectibleHash: 16, displayProperties: { name: 'A gun' } },
    },
    extras: { 1: { screenshot: '/shot/1.jpg' } },
    sources: { 3: 'Eververse' },
  } as unknown as ManifestTables;
  const list = cosmetics(m, { 11: { state: 0 }, 13: { state: 1 }, 14: { state: 4 }, 15: { state: 0 }, 16: { state: 0 } });
  assert.deepEqual(list.map((c) => [c.name, c.kind, c.owned]), [['Bad Shell', 'ghost', true], ['Gloom', 'shader', true], ['Arrowhead', 'ship', false]]);
  assert.equal(list[0]!.render, 'https://www.bungie.net/shot/1.jpg');
  assert.equal(list[0]!.highRes, 'https://www.bungie.net/g-hi.png');
  assert.equal(list[2]!.source, 'Eververse');
});
