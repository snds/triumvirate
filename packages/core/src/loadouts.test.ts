import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DestinyProfileResponse } from 'bungie-api-ts/destiny2';
import { applyEquip, applyLock, checkEquip, cleanLoadout, equippedAsLoadout, loadoutStatus, planEquip, summarizeGameLoadouts } from './loadouts.ts';
import { SUBCLASS_BUCKET } from './vault.ts';

const KINETIC = 1498876634;
const ENERGY = 2465295065;
const HELMET = 3448274439;
const chars = [
  { id: 'w', classType: 2, className: 'Warlock' },
  { id: 'h', classType: 1, className: 'Hunter' },
];
let n = 100;
const row = (over: Partial<Parameters<typeof checkEquip>[0]> = {}) => ({
  owner: 'w', equipped: false, bucketHash: KINETIC, instanceId: String(n++), itemHash: 1, classType: 3, itemType: 3,
  tier: 'Legendary', power: 500, name: 'Gun', movable: true, locked: false, ...over,
});

test('checkEquip: class, subclass, postmaster, already worn', () => {
  assert.equal(checkEquip(row(), 'w', chars).ok, true);
  assert.deepEqual(checkEquip(row({ equipped: true }), 'w', chars), { ok: false, reason: 'Already equipped', quiet: true });
  assert.equal(checkEquip(row({ classType: 1, itemType: 2, bucketHash: HELMET }), 'w', chars).ok, false);
  assert.equal(checkEquip(row({ bucketHash: SUBCLASS_BUCKET, owner: 'h', movable: false }), 'w', chars).ok, false);
  assert.equal(checkEquip(row({ bucketHash: 215593132 }), 'w', chars).ok, false);
  assert.equal(checkEquip(row({ bucketHash: 12345 }), 'w', chars).ok, false);
});

test('planEquip: an item already carried is just equipped', () => {
  const gun = row();
  const plan = planEquip([gun.instanceId], 'w', [row({ equipped: true }), gun], chars);
  assert.deepEqual(plan.steps, [{ kind: 'equip', characterId: 'w', instanceIds: [gun.instanceId] }]);
  assert.deepEqual(plan.skipped, []);
});

test('planEquip: from the vault, and from another character through the vault', () => {
  const vaultGun = row({ owner: 'vault' });
  const hunterGun = row({ owner: 'h', bucketHash: ENERGY });
  const plan = planEquip([vaultGun.instanceId, hunterGun.instanceId], 'w', [vaultGun, hunterGun], chars);
  assert.deepEqual(plan.steps.map((s) => s.kind), ['fromVault', 'toVault', 'fromVault', 'equip']);
});

test('planEquip: a worn item on another character gets a stand-in there first', () => {
  const worn = row({ owner: 'h', equipped: true });
  const spare = row({ owner: 'h', power: 400 });
  const plan = planEquip([worn.instanceId], 'w', [worn, spare], chars);
  assert.deepEqual(plan.steps[0], { kind: 'equip', characterId: 'h', instanceIds: [spare.instanceId] });
  assert.equal(plan.steps.at(-1)!.kind, 'equip');
  const lonely = planEquip([worn.instanceId], 'w', [worn], chars);
  assert.equal(lonely.steps.length, 0);
  assert.match(lonely.skipped[0]!.reason, /Hunter/);
});

test('planEquip: a full slot sends its weakest spare to the vault first', () => {
  const spares = Array.from({ length: 9 }, (_, i) => row({ power: 400 + i }));
  const incoming = row({ owner: 'vault' });
  const plan = planEquip([incoming.instanceId], 'w', [...spares, incoming], chars, { vault: { used: 10, capacity: 700 } });
  assert.deepEqual(plan.steps[0], { kind: 'toVault', characterId: 'w', instanceId: spares[0]!.instanceId, itemHash: 1 });
  const full = planEquip([incoming.instanceId], 'w', [...spares, incoming], chars, { vault: { used: 700, capacity: 700 } });
  assert.equal(full.steps.length, 0);
  assert.equal(full.skipped.length, 1);
});

test('planEquip: a second exotic swaps the worn one for a legendary', () => {
  const wornExotic = row({ bucketHash: ENERGY, equipped: true, tier: 'Exotic', name: 'Sunshot' });
  const legendary = row({ bucketHash: ENERGY, power: 450 });
  const newExotic = row({ tier: 'Exotic', name: 'Ace' });
  const plan = planEquip([newExotic.instanceId], 'w', [wornExotic, legendary, newExotic], chars);
  assert.deepEqual(plan.steps, [{ kind: 'equip', characterId: 'w', instanceIds: [legendary.instanceId, newExotic.instanceId] }]);
  // Nothing to swap in: the new exotic is skipped and says why.
  const stuck = planEquip([newExotic.instanceId], 'w', [wornExotic, newExotic], chars);
  assert.equal(stuck.steps.length, 0);
  assert.match(stuck.skipped[0]!.reason, /Sunshot/);
  // Two exotic weapons in one request: only the first goes on.
  const other = row({ bucketHash: ENERGY, tier: 'Exotic' });
  const both = planEquip([newExotic.instanceId, other.instanceId], 'w', [newExotic, other], chars);
  assert.equal(both.skipped.length, 1);
});

const profile = () => ({
  characters: { data: { w: {} } },
  characterEquipment: { data: { w: { items: [{ itemInstanceId: '1', bucketHash: KINETIC, state: 0 }] } } },
  characterInventories: { data: { w: { items: [{ itemInstanceId: '2', bucketHash: KINETIC, state: 1 }] } } },
  profileInventory: { data: { items: [{ itemInstanceId: '3', bucketHash: 138197802, state: 0 }] } },
}) as unknown as DestinyProfileResponse;

test('applyEquip swaps equipment and inventory; applyLock flips the state bit', () => {
  const p = profile();
  assert.equal(applyEquip(p, 'w', '2'), true);
  assert.equal(p.characterEquipment!.data!.w!.items[0]!.itemInstanceId, '2');
  assert.equal(p.characterInventories!.data!.w!.items[0]!.itemInstanceId, '1');
  assert.equal(applyEquip(p, 'w', '9'), false);
  assert.equal(applyLock(p, '3', true), true);
  assert.equal(p.profileInventory!.data!.items[0]!.state & 1, 1);
  assert.equal(applyLock(p, '2', false), true);
  assert.equal(p.characterEquipment!.data!.w!.items[0]!.state & 1, 0);
});

test('summarizeGameLoadouts names slots and spots empty ones', () => {
  const p = {
    characterLoadouts: { data: { w: { loadouts: [
      { nameHash: 10, colorHash: 20, iconHash: 30, items: [{ itemInstanceId: '1', plugItemHashes: [5, 2166136261] }] },
      { nameHash: 0, colorHash: 0, iconHash: 0, items: [{ itemInstanceId: '0', plugItemHashes: [] }] },
    ] } } },
  } as unknown as DestinyProfileResponse;
  const styles = { names: [{ hash: 10, name: 'Raid' }], colors: [{ hash: 20, image: 'c.png' }], icons: [{ hash: 30, image: 'i.png' }], perCharacter: 10 };
  const out = summarizeGameLoadouts(p, { loadoutStyles: styles });
  assert.equal(out.w![0]!.name, 'Raid');
  assert.deepEqual(out.w![0]!.plugs, { 1: [5] });
  assert.equal(out.w![1]!.empty, true);
});

test('saved loadouts: from equipped gear, status, and request cleaning', () => {
  const items = [row({ equipped: true }), row({ equipped: true, bucketHash: HELMET, itemType: 2 }), row()];
  const l = equippedAsLoadout(items, 'w');
  assert.equal(l.length, 2);
  assert.equal(l[0]!.bucketHash, KINETIC);
  const status = loadoutStatus({ items: [...l, { instanceId: '999', itemHash: 1 }] }, 'w', items);
  assert.deepEqual({ worn: status.worn, missing: status.missing, applied: status.applied }, { worn: 2, missing: ['999'], applied: false });
  assert.equal(cleanLoadout({ name: ' ', classType: 2, items: l }), undefined);
  assert.equal(cleanLoadout({ name: 'Raid', classType: 7, items: l }), undefined);
  assert.equal(cleanLoadout({ name: 'Raid', classType: 2, items: [{ instanceId: 'x; drop', itemHash: 1 }] }), undefined);
  assert.equal(cleanLoadout({ name: 'Raid', classType: 2, items: l })?.items.length, 2);
});
