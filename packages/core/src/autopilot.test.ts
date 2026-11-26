import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearedSince, decideCleanup, emptyCleanupState, openPicks, planPull, queuedItems, reconcileCleanup } from './autopilot.ts';
import type { CleanupCandidate } from './cleanup.ts';
import type { ItemRow } from './vault.ts';

let n = 0;
const item = (o: Partial<ItemRow> = {}): ItemRow => ({
  location: 'Vault', owner: 'vault', name: `Gun ${++n}`, type: 'Hand Cannon', bucket: 'Kinetic Weapons', bucketHash: 1,
  equipped: false, itemHash: 100 + n, instanceId: String(n), tier: 'Legendary', itemType: 3, classType: 3, locked: false, movable: true, ...o,
});
const now = new Date('2026-11-26T12:00:00Z');
const chars = [
  { id: 'w', classType: 2, className: 'Warlock' },
  { id: 't', classType: 0, className: 'Titan' },
];

test('decisions queue, keep, and undo; open picks skip decided items', () => {
  const a = item(), b = item(), c = item();
  let s = decideCleanup(emptyCleanupState(), [a, b, c], [a.instanceId!, 'nope'], 'dismantle', now);
  s = decideCleanup(s, [a, b, c], [b.instanceId!], 'keep', now);
  assert.equal(s.decisions[a.instanceId!]?.action, 'dismantle');
  assert.equal(s.decisions[a.instanceId!]?.name, a.name);
  assert.equal(s.decisions.nope, undefined);
  const picks = [a, b, c].map((item) => ({ item, reason: '', confidence: 'high' }) as CleanupCandidate);
  assert.deepEqual(openPicks(picks, s).map((p) => p.item), [c]);
  assert.deepEqual(queuedItems([a, b, c], s), [a]);
  s = decideCleanup(s, [a, b, c], [a.instanceId!], 'undo', now);
  assert.deepEqual(queuedItems([a, b, c], s), []);
});

test('reconcile moves dismantled items to cleared and drops queued items you locked', () => {
  const gone = item(), lockedNow = item(), keptGone = item(), stays = item();
  let s = decideCleanup(emptyCleanupState(), [gone, lockedNow, stays], [gone.instanceId!, lockedNow.instanceId!, stays.instanceId!], 'dismantle', now);
  s = decideCleanup(s, [keptGone], [keptGone.instanceId!], 'keep', now);
  const next = reconcileCleanup(s, [{ ...lockedNow, locked: true }, stays], now);
  assert.deepEqual(Object.keys(next.decisions), [stays.instanceId]);
  assert.deepEqual(next.cleared.map((c) => c.name), [gone.name]);
  assert.equal(clearedSince(next, 7, now), 1);
  assert.equal(clearedSince(next, 7, new Date('2026-12-10T00:00:00Z')), 0);
  assert.equal(reconcileCleanup(next, [stays], now), next, 'unchanged state is returned as is');
});

test('planPull brings vault items to the chosen character, class armor to its own class, and respects room', () => {
  const gun = item();
  const titanHelm = item({ itemType: 2, classType: 0, bucketHash: 2, bucket: 'Helmet' });
  const hunterHelm = item({ itemType: 2, classType: 1, bucketHash: 2, bucket: 'Helmet' });
  const onChar = item({ owner: 't' });
  const full = Array.from({ length: 9 }, () => item({ owner: 'w', bucketHash: 3 }));
  const noRoom = item({ bucketHash: 3 });
  const all = [gun, titanHelm, hunterHelm, onChar, noRoom, ...full];
  const plan = planPull([gun, titanHelm, hunterHelm, onChar, noRoom].map((i) => i.instanceId!), 'w', all, chars);
  assert.deepEqual(plan.steps.map((s) => [s.kind, 'instanceId' in s ? s.instanceId : '', s.characterId]), [
    ['fromVault', gun.instanceId, 'w'],
    ['fromVault', titanHelm.instanceId, 't'],
  ]);
  assert.deepEqual(plan.skipped.map((s) => s.reason), ['None of your characters can carry it', 'No room on your Warlock']);
});
