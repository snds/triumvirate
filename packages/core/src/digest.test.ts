import { test } from 'node:test';
import assert from 'node:assert/strict';
import { armorNote, buildDigest, clip, digestFacts, digestNotice } from './digest.ts';

const w = (id: string, over: object = {}) => ({ instanceId: id, itemHash: Number(id.replace(/\D/g, '')) || 1, name: `Gun ${id}`, tier: 'Legendary', type: 'Hand Cannon', itemType: 3, location: 'Vault', ...over });
const a = (id: string, stats: Record<string, number>, over: object = {}) => ({ instanceId: id, itemHash: 2, name: `Helm ${id}`, tier: 'Legendary', type: 'Helmet', itemType: 2, location: 'Warlock', stats, ...over });
const base = { date: '2026-11-25', cleanup: [{ confidence: 'high' }, { confidence: 'medium' }], vault: { used: 500, capacity: 700 } };

test('first run only takes stock', () => {
  const d = buildDigest({ ...base, items: [w('1'), w('2')], grades: {} });
  assert.equal(d.firstRun, true);
  assert.equal(d.drops.total, 0);
  assert.deepEqual(d.seen, ['1', '2']);
  assert.deepEqual(d.cleanup, { count: 2, high: 1 });
});

test('new drops since last time, best first', () => {
  const items = [w('1'), w('2'), w('3', { appraisal: { verdict: 'god' } }), w('4'), a('5', { Grenade: 30, Super: 20, Health: 10 }), a('6', { Grenade: 5 })];
  const d = buildDigest({ ...base, items, prevSeen: ['1'], grades: { 2: { grade: 'B' }, 4: { grade: 'S' } } });
  assert.equal(d.firstRun, undefined);
  assert.equal(d.drops.total, 5);
  assert.deepEqual(d.drops.weapons.map((x) => x.instanceId), ['3', '4', '2']);
  assert.equal(d.drops.weapons[0]!.note, 'God roll');
  assert.equal(d.drops.weapons[1]!.note, 'S grade');
  assert.deepEqual(d.drops.armor.map((x) => x.instanceId), ['5', '6']);
  assert.equal(d.drops.armor[0]!.note, 'Stat total 60: Grenade 30, Super 20');
});

test('vendors: only A or better, or wish list picks', () => {
  const v = (id: string, over: object = {}) => ({ ...w(id), vendorName: 'Banshee-44', ...over });
  const d = buildDigest({ ...base, items: [], prevSeen: [], grades: {},
    vendors: { items: [v('v1'), v('v2'), v('v3', { appraisal: { verdict: 'good' } })], grades: { v1: { grade: 'A' }, v2: { grade: 'C' } } } });
  assert.deepEqual(d.vendors.map((x) => x.name), ['Gun v1', 'Gun v3']);
  assert.equal(d.vendors[0]!.where, 'Banshee-44');
  assert.equal(d.vendors[0]!.instanceId, undefined);
  assert.match(digestFacts(d), /Worth buying from vendors: Gun v1/);
});

test('armorNote uses base stats and tier', () => {
  assert.equal(armorNote({ gearTier: 4, statDetails: [{ hash: 1, name: 'Melee', value: 35, bonus: 10, numeric: false }] }), 'Tier 4 · Stat total 25: Melee 25');
});

test('digestNotice names the best news', () => {
  const items = [w('1'), w('2', { name: 'Fatebringer', appraisal: { verdict: 'god' } }), w('3')];
  const d = buildDigest({ ...base, items, prevSeen: ['1'], grades: {} });
  assert.deepEqual(digestNotice(d), { title: 'New god roll: Fatebringer', body: '2 new items · vault 500/700' });
  assert.equal(digestNotice({ ...d, lede: 'Keep Fatebringer. Then clear out the vault.' }).body, 'Keep Fatebringer. Then clear out the vault.');
  const quiet = buildDigest({ ...base, items: [w('1')], prevSeen: ['1'], grades: {} });
  assert.deepEqual(digestNotice(quiet), { title: 'Your daily digest', body: 'No new items · vault 500/700' });
  const first = buildDigest({ ...base, items: [w('1'), w('2')], grades: {} });
  assert.equal(digestNotice(first).body, 'It took stock of 2 items. New drops show up from tomorrow on.');
});

test('clip ends on a sentence or a word', () => {
  assert.equal(clip('One two. Three four five six seven.', 20), 'One two.');
  assert.equal(clip('alpha beta gamma delta', 13), 'alpha beta…');
  assert.equal(clip('short', 20), 'short');
});
