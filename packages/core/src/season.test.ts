import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seasonSummary, trackedProgressions } from './season.ts';
import { slimSeason } from './manifest.ts';

const ladder = (name: string) => ({ displayProperties: { name }, steps: ['GUARDIAN I', 'GUARDIAN II', 'BRAVE I', 'HEROIC III', 'GUARDIAN IV', 'a', 'b', 'c', 'd', 'e', 'LEGEND'].map((stepName) => ({ stepName, progressTotal: 100 })) });
const tables = slimSeason(
  { 10: { displayProperties: { name: 'Lawless' }, seasonNumber: 28, endDate: '2026-12-09T17:00:00Z', seasonPassList: [{ seasonPassHash: 20, seasonPassEndDate: '2099-01-01T17:00:00Z' }] } },
  { 20: { displayProperties: { name: 'Pass' }, rewardProgressionHash: 30, prestigeProgressionHash: 31 } },
  { 30: { displayProperties: { name: '' }, steps: [{ progressTotal: 0 }] }, 31: { displayProperties: { name: '' }, steps: [{ progressTotal: 500 }] }, 457612306: ladder('Vanguard Rank'), 99: { displayProperties: { name: 'Faction' }, steps: [{ stepName: 'Nobody' }] } },
  { 40: { displayProperties: { name: 'Implement' } } },
);
const prog = (level: number, stepIndex: number, progressToNextLevel: number, nextLevelAt: number, extra = {}) => ({ level, stepIndex, progressToNextLevel, nextLevelAt, levelCap: -1, currentResetCount: 0, ...extra });

test('slimSeason keeps the pass progressions and rank ladders, and nothing else', () => {
  assert.deepEqual(Object.keys(tables.progressions).sort(), ['30', '31', '457612306']);
  assert.deepEqual(tables.ranks, [457612306]);
  assert.deepEqual([...trackedProgressions({ season: tables })].sort(), [30, 31, 457612306]);
});

test('seasonSummary reads the pass, artifact, and ranks from the most recently played character', () => {
  const profile = {
    profile: { data: { currentSeasonHash: 10, currentSeasonPassHash: 20 } },
    characters: { data: {
      old: { characterId: 'old', dateLastPlayed: '2026-11-01T00:00:00Z' },
      new: { characterId: 'new', dateLastPlayed: '2026-11-25T00:00:00Z' },
    } },
    characterProgressions: { data: {
      old: { progressions: { 30: prog(1, 1, 0, 1) } },
      new: { progressions: { 30: prog(87, 87, 250, 1000, { levelCap: 110 }), 457612306: prog(4, 3, 40, 100, { currentResetCount: 2 }) }, seasonalArtifact: { artifactHash: 40, pointsUsed: 5 } },
    } },
    profileProgression: { data: { seasonalArtifact: { artifactHash: 40, pointsAcquired: 7, powerBonus: 21, powerBonusProgression: { progressToNextLevel: 5, nextLevelAt: 10 } } } },
  };
  const s = seasonSummary(profile as never, { season: tables }, new Date('2026-12-01T17:00:00Z'));
  assert.deepEqual(s.season, { name: 'Lawless', number: 28, endsAt: '2026-12-09T17:00:00Z', daysLeft: 8 });
  assert.deepEqual(s.pass, { name: 'Pass', rank: 87, progress: 250, next: 1000 });
  assert.equal(s.artifact?.powerBonus, 21);
  assert.equal(s.artifact?.points, 7);
  assert.equal(s.artifact?.pointsUsed, 5);
  assert.deepEqual(s.artifact?.powerProgress, { progress: 5, next: 10 });
  assert.deepEqual(s.ranks.map((r) => [r.name, r.rank, r.step, r.resets]), [['Vanguard Rank', 'Heroic III', 4, 2]]);
});

test('past the last pass rank, the count carries on in the prestige progression', () => {
  const profile = {
    profile: { data: { currentSeasonPassHash: 20 } },
    characters: { data: { a: { characterId: 'a', dateLastPlayed: '2026-11-25T00:00:00Z' } } },
    characterProgressions: { data: { a: { progressions: { 30: prog(110, 110, 0, 0, { levelCap: 110 }), 31: prog(3, 0, 120, 500) } } } },
  };
  assert.deepEqual(seasonSummary(profile as never, { season: tables }).pass, { name: 'Pass', rank: 113, progress: 120, next: 500 });
});
