import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dimLoadoutLink, loadoutShareText } from './share.ts';

const items = [
  { itemHash: 1, instanceId: '11', name: 'Fatebringer', type: 'Hand Cannon', itemType: 3, bucket: 'Kinetic Weapons', tier: 'Legendary',
    perks: [[{ name: 'Arrowhead Brake', active: true }, { name: 'Smallbore', active: false }], [{ name: 'Explosive Payload', active: true }]] },
  { itemHash: 2, instanceId: '22', name: 'Celestial Nighthawk', type: 'Helmet', itemType: 2, bucket: 'Helmet', tier: 'Exotic' },
  { itemHash: 3, instanceId: '33', name: 'Nightstalker', type: 'Subclass', itemType: 16, bucket: 'Subclass', tier: 'Common' },
];
const loadout = {
  name: 'Golden Gun', classType: 1, notes: 'Boss DPS.',
  subclass: { name: 'Gunslinger', element: 'Solar', parts: { supers: [{ name: 'Golden Gun: Marksman' }], aspects: [{ name: 'Knock Em Down' }], fragments: [{ name: 'Ember of Torches' }] } },
};

test('the DIM link carries the gear by hash and id, without the subclass item', () => {
  const url = new URL(dimLoadoutLink(loadout, items as never));
  assert.equal(url.origin + url.pathname, 'https://app.destinyitemmanager.com/loadouts');
  const l = JSON.parse(url.searchParams.get('loadout')!);
  assert.equal(l.name, 'Golden Gun');
  assert.equal(l.classType, 1);
  assert.deepEqual(l.equipped, [{ id: '11', hash: 1 }, { id: '22', hash: 2 }]);
  assert.equal(l.notes, 'Boss DPS.');
});

test('the text summary reads like a build post', () => {
  assert.equal(loadoutShareText(loadout, items as never), [
    'Golden Gun · Hunter',
    'Subclass: Gunslinger (Solar)',
    '  Abilities: Golden Gun: Marksman',
    '  Aspects: Knock Em Down',
    '  Fragments: Ember of Torches',
    'Weapons:',
    '  Fatebringer (Hand Cannon): Arrowhead Brake, Explosive Payload',
    'Armor:',
    '  Celestial Nighthawk (exotic)',
    '',
    'Boss DPS.',
  ].join('\n'));
});
