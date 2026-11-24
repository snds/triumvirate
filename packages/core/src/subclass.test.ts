import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ManifestTables } from './manifest.ts';
import { buildSubclassIndex } from './subclass.ts';

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
