import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AppraisedItem, CommunityAppraisal } from '@triumvirate/core';
import { decodeFilters, defaultFilters, encodeFilters, followCharacter, groupByType, groupItems, locationKey, meetsGrade, passes, pct, updateStream } from './rolls-view.ts';

const gun = (o: Partial<AppraisedItem>): AppraisedItem => ({
  location: 'Vault', owner: 'vault', name: 'X', type: 'Hand Cannon', bucket: '', equipped: false, itemHash: 1,
  tier: 'Legendary', itemType: 3, classType: 3, locked: false, ...o,
});
const graded = (o: Partial<CommunityAppraisal>): CommunityAppraisal => ({ betterPossible: false, copies: 10, perks: [], traitColumns: [], bestPicks: [], ...o });

test('filters by roll type, grade range, better-possible, and location', () => {
  const f = defaultFilters();
  const a = gun({});
  assert.equal(passes(a, undefined, f), true); // ungraded passes at the full range
  f.gradeMin = 'B';
  assert.equal(passes(a, undefined, f), false);
  assert.equal(passes(a, graded({ grade: 'A' }), f), true);
  assert.equal(passes(a, graded({ grade: 'C' }), f), false);
  f.gradeMin = 'F';
  f.rollTypes = new Set(['pvp']);
  assert.equal(passes(a, graded({ rollType: 'pve' }), f), false);
  assert.equal(passes(a, graded({ rollType: 'pvp' }), f), true);
  f.rollTypes = new Set(['both', 'pve', 'pvp', 'none']);
  f.betterPossibleOnly = true;
  assert.equal(passes(a, graded({ betterPossible: false }), f), false);
  f.betterPossibleOnly = false;
  f.locations = new Set(['Titan']);
  assert.equal(passes(a, undefined, f), false);
  assert.equal(passes(gun({ location: 'Titan', owner: 'c1' }), undefined, f), true);
});

test('groups by weapon type with the best grades first', () => {
  const items = [gun({ name: 'B', instanceId: '1' }), gun({ name: 'A', instanceId: '2' }), gun({ name: 'Z', type: 'Auto Rifle', instanceId: '3' })];
  const groups = groupByType(items, { 1: graded({ grade: 'S' }), 2: graded({ grade: 'C' }) });
  assert.deepEqual(groups.map((g) => g.type), ['Auto Rifle', 'Hand Cannon']);
  assert.deepEqual(groups[1]!.items.map((i) => i.name), ['B', 'A']);
});

test('pct keeps a decimal for small shares', () => {
  assert.equal(pct(0.2637), '26%');
  assert.equal(pct(0.044), '4.4%');
});

test('saved filters round-trip through JSON and fill in missing or bad keys from the defaults', () => {
  const f = defaultFilters();
  f.locations = new Set(['Hunter', 'Vault']);
  f.gradeMin = 'A';
  const back = decodeFilters(JSON.parse(JSON.stringify(encodeFilters(f))));
  assert.deepEqual([...back.locations].sort(), ['Hunter', 'Vault']);
  assert.equal(back.gradeMin, 'A');
  const partial = decodeFilters({ gradeMax: 'Z' as never, betterPossibleOnly: true });
  assert.equal(partial.gradeMax, 'S');
  assert.equal(partial.betterPossibleOnly, true);
  assert.equal(partial.rarities.has('Exotic'), true);
  assert.equal(decodeFilters(null).gradeMin, 'F');
});

test('location filter keys on the class, not the light level', () => {
  assert.equal(locationKey({ location: 'Titan (2010)', owner: 'c1' }), 'Titan');
  assert.equal(locationKey({ location: 'Vault', owner: 'vault' }), 'Vault');
  const f = defaultFilters();
  f.locations = new Set(['Titan']);
  assert.equal(passes(gun({ location: 'Titan (2010)', owner: 'c1' }), undefined, f), true);
});

test('following the character swaps the class in the location filter and keeps the vault', () => {
  const f = defaultFilters();
  f.locations = new Set(['Titan', 'Vault']);
  assert.deepEqual([...followCharacter(f, 'Titan', 'Warlock').locations].sort(), ['Vault', 'Warlock']);
  const vaultOnly = { ...f, locations: new Set(['Vault']) };
  assert.equal(followCharacter(vaultOnly, 'Titan', 'Warlock'), vaultOnly);
  assert.equal(followCharacter(f, undefined, 'Warlock'), f);
});

test('groups by slot, element, or grade, and sorts by power or newest', () => {
  const items = [
    gun({ name: 'A', bucket: 'Power Weapons', damage: 'Solar', power: 10, instanceId: '5' }),
    gun({ name: 'B', bucket: 'Kinetic Weapons', damage: 'Kinetic', power: 30, instanceId: '9' }),
    gun({ name: 'C', bucket: 'Kinetic Weapons', damage: 'Kinetic', power: 20, instanceId: '7' }),
  ];
  const grades = { 5: graded({ grade: 'S' }), 9: graded({ grade: 'B' }) };
  assert.deepEqual(groupItems(items, grades, 'slot').map((g) => g.type), ['Kinetic Weapons', 'Power Weapons']);
  assert.deepEqual(groupItems(items, grades, 'grade').map((g) => g.type), ['Grade S', 'Grade B', 'Not graded']);
  assert.deepEqual(groupItems(items, grades, 'none', 'power')[0]!.items.map((i) => i.name), ['B', 'C', 'A']);
  assert.deepEqual(groupItems(items, grades, 'none', 'newest')[0]!.items.map((i) => i.name), ['B', 'C', 'A']);
  assert.deepEqual(groupItems(items, grades, 'element', 'name').map((g) => g.type), ['Kinetic', 'Solar']);
});

test('the activity stream takes stock first, then lists only new drops', () => {
  const first = updateStream(undefined, [gun({ instanceId: '1' })]);
  assert.deepEqual(first.added, []);
  const next = updateStream(first.state, [gun({ instanceId: '1' }), gun({ instanceId: '2', name: 'New' })], new Date('2026-11-24T20:00:00Z'));
  assert.deepEqual(next.added.map((d) => d.name), ['New']);
  assert.equal(next.state.drops[0]!.at, '2026-11-24T20:00:00.000Z');
  // Dismantled: it leaves the stream.
  assert.deepEqual(updateStream(next.state, [gun({ instanceId: '1' })]).state.drops, []);
  assert.equal(meetsGrade('A', 'B'), true);
  assert.equal(meetsGrade('C', 'B'), false);
  assert.equal(meetsGrade(undefined, 'F'), false);
});

test('groups by best activity in the game-mode order, with the role on each group', () => {
  const items = [gun({ name: 'A', instanceId: '1' }), gun({ name: 'B', instanceId: '2' }), gun({ name: 'C', instanceId: '3' })];
  const grades = { 1: graded({ usedFor: 'pvp' }), 2: graded({ usedFor: 'pve-endgame' }) };
  const g = groupItems(items, grades, 'use');
  assert.deepEqual(g.map((x) => [x.type, x.role]), [['PvE endgame', 'pve-endgame'], ['PvP', 'pvp'], ['No clear pick', undefined]]);
});
