import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardianIdentity, slimIdentity } from './identity.ts';

// Shapes from the live manifest: rank 8 is Justiciar; Ally's color is rgb(54, 163, 137).
const t = slimIdentity(
  { 1: { rankNumber: 8, displayProperties: { name: 'Justiciar', icon: '/r8.png' } } },
  {
    1062358355: { childCommendationNodeHashes: [154475713] },
    154475713: { displayProperties: { name: 'Ally' }, color: { red: 54, green: 163, blue: 137, alpha: 255 } },
    4180748446: { displayProperties: { name: 'Mastery' }, color: { red: 205, green: 125, blue: 44, alpha: 255 } },
  },
);

test('identity: rank by number, commendation groups with the game\'s colors', () => {
  const p = {
    profile: { data: { currentGuardianRank: 8 } },
    profileCommendations: { data: { totalScore: 420, commendationNodeScoresByHash: { 154475713: 300, 4180748446: 120 }, commendationNodePercentagesByHash: { 154475713: 71, 4180748446: 29 } } },
  } as never;
  const g = guardianIdentity(p, t)!;
  assert.deepEqual(g.rank, { number: 8, name: 'Justiciar', icon: 'https://www.bungie.net/r8.png' });
  assert.equal(g.commendations!.total, 420);
  assert.deepEqual(g.commendations!.groups.map((x) => [x.name, x.color, x.score, x.percent]), [
    ['Ally', '#36a389', 300, 71], ['Mastery', '#cd7d2c', 120, 29],
  ]);
});

test('identity: nothing to show without the tables or the data', () => {
  assert.equal(guardianIdentity({} as never, undefined), undefined);
  assert.equal(guardianIdentity({} as never, t), undefined);
});
