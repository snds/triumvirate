import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AppraisedItem, CommunityAppraisal } from '@triumvirate/core';
import { defaultFilters, groupByType, passes, pct } from './rolls-view.ts';

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
  assert.equal(passes(gun({ location: 'Titan' }), undefined, f), true);
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
