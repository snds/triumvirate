import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ItemRow } from '@triumvirate/core';
import { groupBySlot, matches, timeAgo } from './inventory.ts';

const item = (o: Partial<ItemRow>): ItemRow => ({
  location: 'Vault', owner: 'vault', name: 'X', type: '', bucket: '', equipped: false, itemHash: 1,
  tier: 'Legendary', itemType: 3, classType: 3, locked: false, ...o,
});

test('search needs every word, across name, type, and element', () => {
  const sunshot = item({ name: 'Sunshot', type: 'Hand Cannon', damage: 'Solar', tier: 'Exotic' });
  assert.equal(matches(sunshot, 'solar hand', 'all'), true);
  assert.equal(matches(sunshot, 'solar auto', 'all'), false);
  assert.equal(matches(sunshot, '', 'armor'), false);
});

test('groups by slot in game order, equipped then power first', () => {
  const groups = groupBySlot([
    item({ name: 'B', bucket: 'Power Weapons', power: 10 }),
    item({ name: 'A', bucket: 'Kinetic Weapons', power: 5 }),
    item({ name: 'C', bucket: 'Kinetic Weapons', power: 50 }),
    item({ name: 'D', bucket: 'Kinetic Weapons', power: 1, equipped: true }),
    item({ name: 'Shader', bucket: 'Shaders' }),
  ], false);
  assert.deepEqual(groups.map((g) => g.slot), ['Kinetic Weapons', 'Power Weapons']);
  assert.deepEqual(groups[0]?.items.map((i) => i.name), ['D', 'C', 'A']);
});

test('keeps non-gear items under Other when asked', () => {
  const groups = groupBySlot([item({ name: 'Shader', bucket: 'Shaders' })], true);
  assert.deepEqual(groups.map((g) => g.slot), ['Other']);
});

test('formats sync age', () => {
  const now = Date.parse('2026-11-24T12:00:00Z');
  assert.equal(timeAgo('2026-11-24T11:59:30Z', now), 'just now');
  assert.equal(timeAgo('2026-11-24T11:55:00Z', now), '5 min ago');
  assert.equal(timeAgo('2026-11-24T09:00:00Z', now), '3 hr ago');
});
