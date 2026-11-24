import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DestinyProfileResponse } from 'bungie-api-ts/destiny2';
import { applyStep, checkMove, planMove } from './transfer.ts';
import { POSTMASTER_BUCKET, VAULT_BUCKET } from './vault.ts';

const KINETIC = 1498876634;
const chars = [
  { id: 'w', classType: 2, className: 'Warlock' },
  { id: 'h', classType: 1, className: 'Hunter' },
];
const gun = { owner: 'w', equipped: false, movable: true, classType: 3, itemType: 3, bucketHash: KINETIC, instanceId: '1' };
const account = { vault: { used: 10, capacity: 700 } };

test('plans the shortest route, through the vault between characters', () => {
  assert.deepEqual(planMove(gun, 'vault'), [{ kind: 'toVault', characterId: 'w' }]);
  assert.deepEqual(planMove({ owner: 'vault', bucketHash: KINETIC }, 'h'), [{ kind: 'fromVault', characterId: 'h' }]);
  assert.deepEqual(planMove(gun, 'h'), [{ kind: 'toVault', characterId: 'w' }, { kind: 'fromVault', characterId: 'h' }]);
  assert.deepEqual(planMove({ owner: 'w', bucketHash: POSTMASTER_BUCKET }, 'vault'),
    [{ kind: 'pull', characterId: 'w' }, { kind: 'toVault', characterId: 'w' }]);
  assert.deepEqual(planMove({ owner: 'w', bucketHash: POSTMASTER_BUCKET }, 'w'), [{ kind: 'pull', characterId: 'w' }]);
});

test('checks equipped, class, room, and postmaster rules', () => {
  assert.equal(checkMove(gun, 'h', chars, [], account).ok, true);
  assert.deepEqual(checkMove(gun, 'w', chars, [], account), { ok: false, reason: 'Already here', quiet: true });
  assert.equal(checkMove({ ...gun, equipped: true }, 'vault', chars, [], account).ok, false);
  assert.equal(checkMove({ ...gun, movable: false }, 'vault', chars, [], account).ok, false);
  const warlockBoots = { ...gun, classType: 2, itemType: 2 };
  assert.equal(checkMove(warlockBoots, 'h', chars, [], account).ok, false);
  const full = Array.from({ length: 9 }, () => ({ owner: 'h', equipped: false, bucketHash: KINETIC }));
  assert.equal(checkMove(gun, 'h', chars, full, account).ok, false);
  assert.equal(checkMove(gun, 'vault', chars, [], { vault: { used: 700, capacity: 700 } }).ok, false);
  const stuck = { ...gun, bucketHash: POSTMASTER_BUCKET, pullOnly: true };
  assert.equal(checkMove(stuck, 'w', chars, [], account).ok, true);
  assert.equal(checkMove(stuck, 'vault', chars, [], account).ok, false);
});

test('records each step in the snapshot', () => {
  const profile = {
    profileInventory: { data: { items: [] } },
    characterInventories: { data: { w: { items: [{ itemHash: 5, itemInstanceId: '1', bucketHash: POSTMASTER_BUCKET, location: 4 }] }, h: { items: [] } } },
  } as unknown as DestinyProfileResponse;
  const manifest = { items: { 5: { inventory: { bucketTypeHash: KINETIC } } } } as never;
  for (const step of planMove({ owner: 'w', bucketHash: POSTMASTER_BUCKET }, 'h')) assert.ok(applyStep(profile, '1', step, manifest));
  assert.equal(profile.characterInventories!.data!.w!.items.length, 0);
  assert.equal(profile.profileInventory!.data!.items.length, 0);
  assert.equal(profile.characterInventories!.data!.h!.items[0]!.bucketHash, KINETIC);
  assert.ok(applyStep(profile, '1', { kind: 'toVault', characterId: 'h' }, manifest));
  assert.equal(profile.profileInventory!.data!.items[0]!.bucketHash, VAULT_BUCKET);
  assert.equal(applyStep(profile, 'nope', { kind: 'toVault', characterId: 'h' }, manifest), false);
});
