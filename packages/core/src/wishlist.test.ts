import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appraise, parseWishList } from './wishlist.ts';
import type { ManifestTables } from './manifest.ts';

const text = [
  'title:Test list',
  '//notes:Great for clearing adds.|tags:PvE PvE-God M+KB',
  'dimwishlist:item=100&perks=1,2',
  'dimwishlist:item=100&perks=1,3',
  '',
  'dimwishlist:item=100&perks=4#notes:Duel pick|tags:pvp,controller',
  'dimwishlist:item=-200&perks=5',
  'dimwishlist:item=300',
].join('\n');

const manifest = {
  items: {
    1: { displayProperties: { name: 'Arrowhead Brake' }, itemTypeDisplayName: 'Barrel' },
    2: { displayProperties: { name: 'Rampage' }, itemTypeDisplayName: 'Trait' },
    3: { displayProperties: { name: 'Kill Clip' }, itemTypeDisplayName: 'Trait' },
    4: { displayProperties: { name: 'Opening Shot' }, itemTypeDisplayName: 'Trait' },
    5: { displayProperties: { name: 'Hip-Fire Grip' }, itemTypeDisplayName: 'Trait' },
  },
} as unknown as ManifestTables;

const list = parseWishList(text);

test('parses block notes, inline notes, tags, and trash entries', () => {
  assert.equal(list.get(100)?.length, 3);
  assert.equal(list.get(100)?.[0]?.notes, 'Great for clearing adds.');
  assert.deepEqual(list.get(100)?.[0]?.tags, ['pve', 'pve-god', 'm+kb']);
  assert.deepEqual(list.get(100)?.[2]?.tags, ['pvp', 'controller']);
  assert.equal(list.get(200)?.[0]?.trash, true);
});

test('a roll with every listed perk is a god roll when tagged so', () => {
  const a = appraise(100, new Set(['Arrowhead Brake', 'Rampage', 'Outlaw']), list, manifest);
  assert.equal(a.verdict, 'god');
  assert.equal(a.pve, true);
  assert.equal(a.notes, 'Great for clearing adds.');
  assert.ok(a.wishedPerks?.includes('Rampage'));
});

test('missing one listed perk means no match', () => {
  assert.equal(appraise(100, new Set(['Rampage']), list, manifest).verdict, 'meh');
});

test('trash, whole-item entries, and unlisted weapons', () => {
  assert.equal(appraise(200, new Set(['Hip-Fire Grip']), list, manifest).verdict, 'trash');
  assert.equal(appraise(300, new Set(), list, manifest).verdict, 'good');
  assert.equal(appraise(999, new Set(), list, manifest).verdict, 'unrated');
});
