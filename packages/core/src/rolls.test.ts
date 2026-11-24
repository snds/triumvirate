import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollOptions } from './rolls.ts';
import type { ManifestTables } from './manifest.ts';

test('lists every perk a weapon can roll, folding enhanced copies into their base perk', () => {
  const item = (name: string, type = 'Trait', icon = `/${name}.png`) => ({ displayProperties: { name, icon }, itemTypeDisplayName: type });
  const m = {
    version: 'x', buckets: {},
    stats: { 10: { displayProperties: { name: 'Range' } }, 11: { displayProperties: { name: 'Rounds Per Minute' } } },
    items: {
      100: item('Chroma Rush', 'Auto Rifle'), 1: item('Rapid-Fire Frame', 'Intrinsic'),
      2: item('Rampage'), 3: item('Kill Clip'), 4: item('Kill Clip Enhanced', 'Enhanced Trait'), 5: item('Kill Tracker', 'Tracker'),
    },
    statGroups: { 50: { scaledStats: [{ statHash: 11, displayAsNumeric: true }, { statHash: 10 }] } },
    plugSets: { 900: [2, 3, 4] },
    extras: {
      100: {
        statGroupHash: 50,
        socketCategories: [[3956125808, [0]], [4241085061, [1, 2]]],
        socketEntries: [[0, 1], [900, 0], [0, 5]],
        baseStats: [[10, 40], [11, 720]],
      },
    },
  } as unknown as ManifestTables;
  const r = rollOptions(m, 100)!;
  assert.equal(r.intrinsic?.name, 'Rapid-Fire Frame');
  assert.deepEqual(r.columns.map((c) => c.map((p) => p.name)), [['Rampage', 'Kill Clip']]);
  assert.deepEqual(r.baseStats.map((s) => [s.name, s.value, s.numeric]), [['Rounds Per Minute', 720, true], ['Range', 40, false]]);
  assert.equal(rollOptions(m, 999), undefined);
});
