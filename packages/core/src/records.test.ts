import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterNodes, filterRecords, recordRoots, recordsScreen, slimNodes, slimRecords, type RecordTables } from './records.ts';

const obj = (objectiveHash: number, progress: number, completionValue: number) => ({ objectiveHash, progress, completionValue, complete: progress >= completionValue, visible: true });
const NOT_DONE = 4;

function tables(): RecordTables {
  return {
    version: 'v1',
    roots: { legacySeals: 30 },
    nodes: slimNodes({
      10: { displayProperties: { name: 'Seals' }, children: { presentationNodes: [{ presentationNodeHash: 11 }, { presentationNodeHash: 13 }] } },
      11: { displayProperties: { name: 'Conqueror', icon: '/c.png' }, completionRecordHash: 900, children: { presentationNodes: [{ presentationNodeHash: 12 }] } },
      12: { displayProperties: { name: 'Conqueror triumphs' }, children: { records: [{ recordHash: 101 }, { recordHash: 102 }] } },
      13: { displayProperties: { name: 'Hidden seal' }, completionRecordHash: 903, children: { records: [{ recordHash: 101 }] } },
      20: { displayProperties: { name: 'Triumphs' }, children: { presentationNodes: [{ presentationNodeHash: 21 }] } },
      21: { displayProperties: { name: 'Destinations' }, children: { presentationNodes: [{ presentationNodeHash: 22 }] } },
      22: { displayProperties: { name: 'EDZ' }, children: { records: [201, 202, 203, 204, 205].map((recordHash) => ({ recordHash })) } },
      30: { displayProperties: { name: 'Legacy seals' }, children: { presentationNodes: [{ presentationNodeHash: 31 }] } },
      31: { displayProperties: { name: 'Rivensbane' }, completionRecordHash: 930, children: { records: [{ recordHash: 301 }] } },
      99: { redacted: true, displayProperties: { name: 'x' } },
    }),
    records: slimRecords({
      900: { displayProperties: { name: 'Conqueror' }, titleInfo: { hasTitle: true, titlesByGender: { Male: 'Conqueror', Female: 'Conqueror' }, gildingTrackingRecordHash: 901 } },
      901: { displayProperties: { name: 'Gild' } },
      903: { displayProperties: { name: 'Hidden' }, titleInfo: { hasTitle: true, titlesByGender: { Male: 'Hidden' } } },
      930: { displayProperties: { name: 'Rivensbane' }, titleInfo: { hasTitle: true, titlesByGender: { Male: 'Rivensbane' } } },
      101: { displayProperties: { name: 'Grandmaster' }, completionInfo: { ScoreValue: 20 } },
      102: { displayProperties: { name: 'Flawless' }, stateInfo: { obscuredName: 'Secret' } },
      201: { displayProperties: { name: 'Done deal', description: 'Finished' }, completionInfo: { ScoreValue: 5 } },
      202: { displayProperties: { name: 'Almost there', description: 'Kill things in the EDZ' }, completionInfo: { ScoreValue: 10 } },
      203: { displayProperties: { name: 'Invisible one' } },
      204: { displayProperties: { name: 'Stepper' }, intervalInfo: { intervalObjectives: [{ intervalObjectiveHash: 1, intervalScoreValue: 5 }, { intervalObjectiveHash: 2, intervalScoreValue: 5 }, { intervalObjectiveHash: 3, intervalScoreValue: 10 }] } },
      205: { displayProperties: { name: 'Per character' }, scope: 1 },
      301: { displayProperties: { name: 'Old raid' } },
      999: { redacted: true },
    }),
  };
}

function screen(tracked: number[] = []) {
  const rec = (state: number, objectives: ReturnType<typeof obj>[] = [], extra = {}) => ({ state, objectives, intervalObjectives: [], intervalsRedeemedCount: 0, rewardVisibilty: [], ...extra });
  return recordsScreen({
    tables: tables(),
    objectives: { 7: { progressDescription: 'Kills' } } as never,
    gender: 'Female',
    tracked,
    profileRecords: {
      activeScore: 1234, legacyScore: 99, lifetimeScore: 2000, trackedRecordHash: 202,
      recordCategoriesRootNodeHash: 20, recordSealsRootNodeHash: 10,
      records: {
        900: rec(NOT_DONE), 901: rec(0, [], { completedCount: 2 }), 903: rec(16), 930: rec(1),
        101: rec(1, [obj(7, 1, 1)]), 102: rec(NOT_DONE | 8, [obj(7, 0, 1)]),
        201: rec(1, [obj(7, 10, 10)]), 202: rec(NOT_DONE, [obj(7, 80, 100)]), 203: rec(16 | NOT_DONE),
        204: rec(NOT_DONE, [], { intervalObjectives: [obj(1, 10, 10), obj(2, 25, 25), obj(3, 30, 50)] }),
        301: rec(1, [obj(7, 1, 1)]),
      } as never,
    },
    characterRecords: { records: { 205: rec(NOT_DONE, [obj(7, 3, 4)]) } as never },
    profileNodes: { 11: { state: 0, progressValue: 1, completionValue: 2 } } as never,
  });
}

test('slimming drops redacted entries and keeps titles, scores, and intervals', () => {
  const t = tables();
  assert.equal(t.nodes[99], undefined);
  assert.equal(t.records[999], undefined);
  assert.deepEqual(t.records[900]!.title, { Male: 'Conqueror', Female: 'Conqueror' });
  assert.equal(t.records[900]!.gilding, 901);
  assert.equal(t.records[204]!.intervals!.length, 3);
  assert.equal(t.nodes[11]!.icon, 'https://www.bungie.net/c.png');
  assert.deepEqual(recordRoots({ 1: { legacySealsRootNodeHash: 5, exoticCatalystsRootNodeHash: 0 } }), { legacyTriumphs: undefined, legacySeals: 5, catalysts: undefined, crafting: undefined });
});

test('titles: progress, gilding, legacy, and hidden seals left out', () => {
  const s = screen();
  assert.deepEqual(s.titles.map((t) => [t.name, t.title, t.progress, t.completion, t.complete, t.legacy]), [
    ['Conqueror', 'Conqueror', 1, 2, false, false],
    ['Rivensbane', 'Rivensbane', 1, 1, true, true],
  ]);
  assert.equal(s.titles[0]!.gilded, 2);
  assert.equal(s.titles[0]!.gildedNow, true);
  assert.deepEqual(s.titles[0]!.records.map((r) => r.name), ['Grandmaster', 'Secret']);
  assert.equal(s.titles[0]!.records[1]!.obscured, true);
});

test('triumph tree: invisible records drop, intervals show the step in progress, character scope reads the character', () => {
  const s = screen();
  assert.deepEqual(s.score, { active: 1234, legacy: 99, lifetime: 2000 });
  const edz = s.triumphs[0]!.nodes![0]!;
  assert.equal(edz.name, 'EDZ');
  assert.deepEqual(edz.records!.map((r) => r.name), ['Done deal', 'Almost there', 'Stepper', 'Per character']);
  const stepper = edz.records![2]!;
  assert.deepEqual(stepper.steps, { done: 2, total: 3 });
  assert.equal(stepper.objectives[0]!.progress, 30);
  assert.equal(stepper.score, 20);
  assert.equal(stepper.complete, false);
  assert.equal(edz.records![3]!.objectives[0]!.description, 'Kills');
  assert.deepEqual(edz.records![1]!.path, ['Destinations', 'EDZ']);
  // No node component: counts its own records.
  assert.deepEqual([edz.progress, edz.completion], [1, 4]);
});

test('tracked joins the game\'s one with yours; nearly done is the most-done incomplete ones', () => {
  const s = screen([205]);
  assert.deepEqual(s.tracked.map((r) => r.name).sort(), ['Almost there', 'Per character']);
  assert.equal(s.tracked.find((r) => r.hash === 202)!.trackedInGame, true);
  assert.deepEqual(s.nearly.map((r) => [r.name, r.fraction]), [['Almost there', 0.8], ['Per character', 0.75]]);
});

test('filters: hide completed and search, keeping a matching category whole', () => {
  const s = screen();
  const all = s.triumphs[0]!.nodes![0]!.records!;
  assert.deepEqual(filterRecords(all, { hideComplete: true }).map((r) => r.name), ['Almost there', 'Stepper', 'Per character']);
  assert.deepEqual(filterRecords(all, { query: 'edz' }).map((r) => r.name), ['Almost there']);
  assert.equal(filterNodes(s.triumphs, { query: 'edz' })[0]!.nodes![0]!.records!.length, 4);
  assert.equal(filterNodes(s.triumphs, { query: 'zzz' }).length, 0);
  assert.equal(filterNodes(s.triumphs, { hideComplete: true })[0]!.nodes![0]!.records!.length, 3);
});
