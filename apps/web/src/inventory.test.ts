import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ItemRow } from '@triumvirate/core';
import { groupBySlot, matches, planBulkMove, rowOf, SLOT_ORDER, timeAgo } from './inventory.ts';
import { checkMove } from '@triumvirate/core/browser';

const item = (o: Partial<ItemRow>): ItemRow => ({
  location: 'Vault', owner: 'vault', name: 'X', type: '', bucket: '', equipped: false, itemHash: 1,
  tier: 'Legendary', itemType: 3, classType: 3, locked: false, ...o,
});

test('search needs every word, across name, type, and element', () => {
  const sunshot = item({ name: 'Sunshot', type: 'Hand Cannon', damage: 'Solar', tier: 'Exotic' });
  assert.equal(matches(sunshot, 'solar hand', 'all'), true);
  assert.equal(matches(sunshot, 'solar auto', 'all'), false);
  assert.equal(matches(sunshot, '', 'armor'), false);
  assert.equal(matches({ ...sunshot, appraisal: { verdict: 'god', pve: true, pvp: false, rollCount: 3 } }, 'god', 'all'), true);
});

test('groups by slot in game order, by power, ignoring equipped', () => {
  const groups = groupBySlot([
    item({ name: 'B', bucket: 'Power Weapons', power: 10 }),
    item({ name: 'A', bucket: 'Kinetic Weapons', power: 5 }),
    item({ name: 'C', bucket: 'Kinetic Weapons', power: 50 }),
    item({ name: 'D', bucket: 'Kinetic Weapons', power: 1, equipped: true }),
    item({ name: 'Shader', bucket: 'Shaders' }),
  ], false);
  assert.deepEqual(groups.map((g) => g.slot), ['Kinetic Weapons', 'Power Weapons']);
  assert.deepEqual(groups[0]?.items.map((i) => i.name), ['C', 'A', 'D']);
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

test('recently moved items lead their slot, newest first', () => {
  const groups = groupBySlot([
    item({ name: 'High', bucket: 'Kinetic Weapons', power: 50, instanceId: '1' }),
    item({ name: 'Moved', bucket: 'Kinetic Weapons', power: 5, instanceId: '2' }),
    item({ name: 'Newest', bucket: 'Kinetic Weapons', power: 1, instanceId: '3' }),
  ], false, { 2: 100, 3: 200 });
  assert.deepEqual(groups[0]?.items.map((i) => i.name), ['Newest', 'Moved', 'High']);
});

test('every slot has its own grid row, in game order, so columns line up', () => {
  const rows = SLOT_ORDER.map(rowOf);
  assert.deepEqual(rows, [...rows].sort((a, b) => a - b));
  assert.equal(new Set(rows).size, SLOT_ORDER.length);
  assert.ok(rowOf('header') < rowOf('Kinetic Weapons'));
  assert.ok(rowOf('Ghost') < rowOf('Other'));
  assert.ok(rowOf('Other') < rowOf('postmaster'));
  // Unknown buckets share the Other row, the same as groupBySlot does.
  assert.equal(rowOf('Emotes'), rowOf('Other'));
});

test('bulk moves fill a slot one at a time and say why the rest stayed', () => {
  const chars = [{ id: 'w', classType: 2, className: 'Warlock' }];
  const helm = (n: number, owner: string, o: Partial<ItemRow> = {}) =>
    ({ ...item({ owner, bucket: 'Helmet', bucketHash: 3448274439, itemType: 2, classType: 2, instanceId: `h${n}` }), movable: true, ...o });
  // The Warlock carries 7 helmets (6 here plus h4), so only 2 more fit.
  const carried = Array.from({ length: 6 }, (_, n) => helm(100 + n, 'w'));
  const picked = [helm(1, 'vault'), helm(2, 'vault'), helm(3, 'vault'), helm(4, 'w'), helm(5, 'vault', { classType: 0 })];
  const all = [...carried, ...picked];
  const check = (i: (typeof all)[number], to: string, items: typeof all, account?: { vault: { used: number; capacity: number } }) => checkMove(i, to, chars, items, account);
  const plan = planBulkMove(picked, 'w', all, { vault: { used: 10, capacity: 700 } }, check);
  assert.deepEqual(plan.go.map((i) => i.instanceId), ['h1', 'h2']);
  // h4 is already there (quiet); h3 found no room; h5 is Titan armor.
  assert.deepEqual(plan.skip.map((s) => [s.item.instanceId, s.reason]), [['h3', 'No room in that slot'], ['h5', 'Not usable by a Warlock']]);
});

test('bulk moves to the vault stop when it fills up', () => {
  const picked = [1, 2, 3].map((n) => ({ ...item({ owner: 'w', instanceId: `i${n}` }), movable: true }));
  const plan = planBulkMove(picked, 'vault', picked, { vault: { used: 698, capacity: 700 } },
    (i, to, items, account) => checkMove(i, to, [], items, account));
  assert.equal(plan.go.length, 2);
  assert.equal(plan.skip[0]!.reason, 'Vault is full');
});
