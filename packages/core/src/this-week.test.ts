import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillVars, thisWeek, weekHashes, weekModifierHashes, type WeekDefs } from './this-week.ts';

const milestones = {
  10: { milestoneHash: 10, order: 5, activities: [{ activityHash: 100, modifierHashes: [1] }, { activityHash: 101, modifierHashes: [1, 2, 3] }], endDate: '2026-12-01T17:00:00Z' },
  20: { milestoneHash: 20, order: 1, activities: [{ activityHash: 200, modifierHashes: [] }] },
  30: { milestoneHash: 30, order: 2, activities: [{ activityHash: 300, modifierHashes: [] }] },
} as never;

const defs: WeekDefs = {
  milestones: new Map([[10, { displayProperties: { name: 'Nightfall' } }], [20, { displayProperties: { name: 'Weekly Raid' } }]]),
  activities: new Map([
    [100, { displayProperties: { name: 'Nightfall: Hero', description: 'The Glassway' }, pgcrImage: '/pgcr/glass.jpg' }],
    [101, { displayProperties: { name: 'Nightfall: Grandmaster', description: 'The Glassway' }, pgcrImage: '/pgcr/glass.jpg', modifiers: [{ activityModifierHash: 4 }] }],
    [200, { displayProperties: { name: "Salvation's Edge: Standard", description: 'Free the Light.' }, pgcrImage: '/pgcr/se.jpg' }],
    [300, { displayProperties: { name: 'Mystery' }, pgcrImage: '/img/theme/destiny/bgs/pgcrs/placeholder.jpg' }],
  ]),
  modifiers: new Map([
    [1, { displayProperties: { name: 'Champions', icon: '/m1.png', description: 'Barrier and Overload.' }, displayInActivitySelection: true }],
    [2, { displayProperties: { name: 'Hidden', icon: '/m2.png' }, displayInActivitySelection: false }],
    [3, { displayProperties: { name: 'Champions', icon: '/m1b.png' }, displayInActivitySelection: true }],
    [4, { displayProperties: { name: 'Match Game', icon: '/m4.png' }, displayInActivitySelection: true }],
  ]),
};

test('builds one card per milestone, Nightfall first, best difficulty, visible modifiers only', () => {
  const w = thisWeek(milestones, defs, undefined, new Date('2026-11-26T00:00:00Z'));
  assert.equal(w.activities.length, 2);
  const [nf, raid] = w.activities;
  assert.deepEqual([nf!.milestone, nf!.name, nf!.detail, nf!.hash], ['Nightfall', 'The Glassway', 'Grandmaster', 101]);
  assert.deepEqual(nf!.modifiers.map((m) => m.name), ['Champions', 'Match Game']);
  assert.equal(nf!.image, 'https://www.bungie.net/pgcr/glass.jpg');
  assert.equal(nf!.endDate, '2026-12-01T17:00:00Z');
  assert.deepEqual([raid!.name, raid!.detail], ["Salvation's Edge", undefined]);
});

test('names every hash to fetch, and reads the event card', () => {
  assert.deepEqual(weekHashes(milestones).activities, [100, 101, 200, 300]);
  assert.deepEqual(weekModifierHashes(milestones, defs.activities).sort(), [1, 2, 3, 4]);
  const w = thisWeek({} as never, defs, { displayProperties: { name: 'Iron Banner', icon: '/ib.png' }, images: { themeBackgroundImagePath: '/img/ib.png' }, color: { red: 25, green: 50, blue: 25 } });
  assert.deepEqual(w.event, { name: 'Iron Banner', icon: 'https://www.bungie.net/ib.png', background: 'https://www.bungie.net/img/ib.png', color: '#193219' });
  assert.equal(thisWeek({} as never, defs, { displayProperties: { name: '' } }).event, undefined);
});

test('fills string variables in modifier text, or drops the number when unknown', () => {
  assert.equal(fillVars('{var:7}% bonus to outgoing Arc damage.', { 7: 25 }), '25% bonus to outgoing Arc damage.');
  assert.equal(fillVars('{var:7}% bonus to outgoing Arc damage.', {}), 'Bonus to outgoing Arc damage.');
  assert.equal(fillVars('Combatants deal {var:9} more.', {}), 'Combatants deal more.');
});
