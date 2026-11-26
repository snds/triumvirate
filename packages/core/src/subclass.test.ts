import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ManifestTables } from './manifest.ts';
import { buildSubclassIndex, withSubclassArt } from './subclass.ts';
import { subclassFromPlugs, type EquippedSubclass } from './vault.ts';

test('groups class and shared subclass parts by element, deduped by name', () => {
  const m = {
    items: {
      1: { displayProperties: { name: 'Nova Bomb', icon: '/n.png' } },
      2: { displayProperties: { name: 'Feed the Void' } },
      3: { displayProperties: { name: 'Echo of Persistence' } },
      4: { displayProperties: { name: 'Echo of Persistence', icon: '/e.png' } },
      5: { displayProperties: { name: 'Empty Fragment Socket' } },
      6: { displayProperties: { name: 'Shield Throw' } },
    },
    extras: {
      1: { plugCategory: 'warlock.void.supers' },
      2: { plugCategory: 'warlock.void.aspects' },
      3: { plugCategory: 'shared.void.fragments' },
      4: { plugCategory: 'shared.void.fragments' },
      5: { plugCategory: 'shared.void.fragments' },
      6: { plugCategory: 'titan.void.melee' },
    },
  } as unknown as ManifestTables;
  const idx = buildSubclassIndex(m);
  const wv = idx.options.get('warlock.void')!;
  assert.deepEqual(wv.supers?.map((p) => p.name), ['Nova Bomb']);
  assert.deepEqual(wv.fragments, [{ name: 'Echo of Persistence', icon: 'https://www.bungie.net/e.png', description: undefined }]);
  assert.equal(wv.melee, undefined);
  assert.equal(idx.byName.get('nova bomb')?.icon, 'https://www.bungie.net/n.png');
});

test('prismatic parts carry banners, and old saved subclasses get them by name', () => {
  const m = {
    items: {
      1: { displayProperties: { name: 'Consecration', icon: '/c.png' }, secondaryIcon: '/c-banner.jpg' },
      2: { displayProperties: { name: 'Facet of Ruin' }, secondaryIcon: '/f-banner.jpg' },
      9: { displayProperties: { name: 'Prismatic Titan' } },
    },
    extras: { 1: { plugCategory: 'titan.prism.aspects' }, 2: { plugCategory: 'shared.prism.fragments' } },
  } as unknown as ManifestTables;
  const idx = buildSubclassIndex(m);
  assert.equal(idx.options.get('titan.prismatic')?.aspects?.[0]?.banner, 'https://www.bungie.net/c-banner.jpg');

  const live = subclassFromPlugs(9, [1, 2], m);
  assert.equal(live.element, 'Prismatic');
  assert.equal(live.parts.fragments?.[0]?.banner, 'https://www.bungie.net/f-banner.jpg');

  const saved: EquippedSubclass = { name: 'Prismatic Titan', element: 'Prism', parts: { aspects: [{ name: 'Consecration' }] } };
  const filled = withSubclassArt(saved, idx);
  assert.equal(filled.element, 'Prismatic');
  assert.equal(filled.parts.aspects?.[0]?.banner, 'https://www.bungie.net/c-banner.jpg');
  assert.equal(withSubclassArt(filled, idx), filled);
});
