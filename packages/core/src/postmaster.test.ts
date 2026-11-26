import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPullStack, planCollectPostmaster } from './postmaster.ts';
import { ENGRAM_BUCKET, POSTMASTER_BUCKET, type ItemRow } from './vault.ts';
import type { DestinyProfileResponse } from 'bungie-api-ts/destiny2';

const HELMET = 3448274439;
const KINETIC = 1498876634;
let n = 0;
const item = (o: Partial<ItemRow> = {}): ItemRow => ({
  location: 'Warlock', owner: 'w', name: `Thing ${++n}`, type: '', bucket: '', bucketHash: KINETIC,
  equipped: false, itemHash: 100 + n, instanceId: String(n), tier: 'Legendary', itemType: 3, classType: 3, locked: false, movable: true, power: 500, ...o,
});
const lost = (home: number, o: Partial<ItemRow> = {}) => item({ bucketHash: POSTMASTER_BUCKET, homeBucketHash: home, ...o });
const chars = [{ id: 'w' }, { id: 't' }];
const vault = { vault: { used: 100, capacity: 700 } };

test('pulls everything when there is room', () => {
  const a = lost(KINETIC), b = lost(HELMET, { itemType: 2 });
  const plan = planCollectPostmaster('w', [a, b, item({ owner: 't', bucketHash: POSTMASTER_BUCKET })], chars, vault);
  assert.deepEqual(plan.steps.map((s) => [s.kind, 'instanceId' in s && s.instanceId]), [['pull', a.instanceId], ['pull', b.instanceId]]);
  assert.equal(plan.skipped.length, 0);
});

test('a full slot sends its weakest unlocked spare to the vault first', () => {
  const spares = Array.from({ length: 9 }, (_, k) => item({ power: 500 + k, locked: k === 0 }));
  const exotic = item({ power: 400, tier: 'Exotic' });
  const worn = item({ equipped: true, power: 300 });
  const a = lost(KINETIC), b = lost(KINETIC);
  // Swap one spare for the low exotic: with 10 items it would be 10 spares, so replace the last.
  spares[8] = exotic;
  const plan = planCollectPostmaster('w', [...spares, worn, a, b], chars, vault);
  const ids = plan.steps.map((s) => `${s.kind}:${'instanceId' in s ? s.instanceId : ''}`);
  // Locked (power 500) and exotic stay; unlocked 501 then 502 make room. The equipped one never moves.
  assert.deepEqual(ids, [`toVault:${spares[1]!.instanceId}`, `pull:${a.instanceId}`, `toVault:${spares[2]!.instanceId}`, `pull:${b.instanceId}`]);
});

test('a full vault or full engram row skips with a reason', () => {
  const spares = Array.from({ length: 9 }, () => item());
  const engrams = Array.from({ length: 10 }, () => item({ bucketHash: ENGRAM_BUCKET, itemType: 8 }));
  const gun = lost(KINETIC), engram = lost(ENGRAM_BUCKET);
  const plan = planCollectPostmaster('w', [...spares, ...engrams, gun, engram], chars, { vault: { used: 700, capacity: 700 } });
  assert.equal(plan.steps.length, 0);
  assert.deepEqual(plan.skipped.map((s) => s.reason), ['No room in that slot, and the vault is full', 'Engram slots are full. Open some first.']);
});

test('stacks are pulled whole by item hash', () => {
  const mats = lost(1469714392, { instanceId: undefined, quantity: 12, itemHash: 999, movable: undefined });
  const plan = planCollectPostmaster('w', [mats], chars, vault);
  assert.deepEqual(plan.steps, [{ kind: 'pull', characterId: 'w', instanceId: '', itemHash: 999, stackSize: 12 }]);
});

test('applyPullStack moves a stack out of the postmaster', () => {
  const profile = { characterInventories: { data: { w: { items: [{ itemHash: 999, bucketHash: POSTMASTER_BUCKET, quantity: 3 }] } } } } as unknown as DestinyProfileResponse;
  assert.equal(applyPullStack(profile, 'w', 999, 1469714392), true);
  assert.equal(profile.characterInventories!.data!.w!.items[0]!.bucketHash, 1469714392);
  assert.equal(applyPullStack(profile, 'w', 999), false);
});
