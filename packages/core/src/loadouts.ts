// Equipping, locking, and loadouts. Pure logic: the web app checks an action instantly, and the
// server plans the same Bungie calls and records each finished step in its snapshot.
import type { DestinyItemComponent, DestinyProfileResponse } from 'bungie-api-ts/destiny2';
import type { ManifestTables } from './manifest.ts';
import type { AccountSummary, CharacterRow, ItemRow } from './vault.ts';
import { POSTMASTER_BUCKET, SUBCLASS_BUCKET } from './vault.ts';
import { CHARACTER_BUCKET_CARRIED, planMove, type MoveStep } from './transfer.ts';

/** Equippable slots, in game order: three weapons, five armor pieces, then ghost and subclass. */
export const GEAR_BUCKETS = [
  1498876634, // Kinetic
  2465295065, // Energy
  953998645, // Power
  3448274439, // Helmet
  3551918588, // Gauntlets
  14239492, // Chest
  20886954, // Legs
  1585787867, // Class item
  4023194814, // Ghost
] as const;
export const LOADOUT_BUCKETS: readonly number[] = [...GEAR_BUCKETS, SUBCLASS_BUCKET];
const WEAPON = 3;
const ARMOR = 2;
/** DestinyItemComponent.state bit 1 = locked. */
const STATE_LOCKED = 1;

type Row = Pick<ItemRow, 'owner' | 'equipped' | 'bucketHash' | 'instanceId' | 'itemHash' | 'classType' | 'itemType' | 'tier' | 'power' | 'name' | 'movable' | 'locked'>;
type Char = Pick<CharacterRow, 'id' | 'classType' | 'className'>;

export type ActionCheck = { ok: true } | { ok: false; reason: string; quiet?: boolean };

/** Only one exotic weapon and one exotic armor piece can be equipped at a time. */
const exoticKind = (i: Pick<Row, 'tier' | 'itemType'>) =>
  i.tier === 'Exotic' && (i.itemType === WEAPON || i.itemType === ARMOR) ? i.itemType : undefined;

/** Whether `item` can be equipped on `characterId`, and why not. */
export function checkEquip(item: Row, characterId: string, characters: Char[]): ActionCheck {
  const ch = characters.find((c) => c.id === characterId);
  if (!ch) return { ok: false, reason: 'Unknown character' };
  if (!item.instanceId || !item.bucketHash) return { ok: false, reason: 'This item can\'t be equipped' };
  if (item.bucketHash === POSTMASTER_BUCKET) return { ok: false, reason: 'Pull it from the postmaster first' };
  if (!LOADOUT_BUCKETS.includes(item.bucketHash)) return { ok: false, reason: 'This item can\'t be equipped' };
  if (item.equipped && item.owner === characterId) return { ok: false, reason: 'Already equipped', quiet: true };
  if (item.classType !== 3 && item.classType !== ch.classType) return { ok: false, reason: `Not usable by a ${ch.className}` };
  // Subclasses never leave their character.
  if (item.bucketHash === SUBCLASS_BUCKET && item.owner !== characterId) return { ok: false, reason: 'Subclasses stay on their character' };
  if (item.owner !== characterId && !item.movable && !item.equipped) return { ok: false, reason: 'This item can\'t be moved' };
  return { ok: true };
}

export type ActionStep =
  | (MoveStep & { instanceId: string; itemHash: number })
  | { kind: 'equip'; characterId: string; instanceIds: string[] };

export interface EquipPlan {
  steps: ActionStep[];
  /** Items left out, with why: missing, wrong class, nothing to swap in, no room. */
  skipped: { instanceId: string; name?: string; reason: string }[];
}

/**
 * The Bungie calls that put `targetIds` on `characterId` and equip them, the way the game would:
 * items come from the vault or another character first (that character gets a stand-in if it was
 * wearing it), a full slot sends its weakest spare to the vault, and a second exotic makes the
 * current one swap for a legendary in its slot.
 */
export function planEquip(
  targetIds: string[], characterId: string, items: Row[], characters: Char[], account?: Pick<AccountSummary, 'vault'>,
): EquipPlan {
  const plan: EquipPlan = { steps: [], skipped: [] };
  const byId = new Map(items.filter((i) => i.instanceId).map((i) => [i.instanceId!, { ...i }]));
  // Working copy: owner and equipped change as steps are planned, so later checks see them.
  const live = [...byId.values()];
  let vaultFree = account ? account.vault.capacity - account.vault.used : Infinity;
  const skip = (id: string, reason: string) => plan.skipped.push({ instanceId: id, name: byId.get(id)?.name, reason });

  // One target per slot; the last one named wins.
  const targets = new Map<number, Row>();
  for (const id of targetIds) {
    const item = byId.get(id);
    if (!item) { skip(id, 'Not in your inventory anymore'); continue; }
    const check = checkEquip(item, characterId, characters);
    if (!check.ok) { if (!check.quiet) skip(id, check.reason); continue; }
    targets.set(item.bucketHash!, item);
  }
  // Two exotics of one kind can't both go on; keep the first.
  const exoticSeen = new Set<number>();
  for (const [bucket, item] of targets) {
    const k = exoticKind(item);
    if (k === undefined) continue;
    if (exoticSeen.has(k)) { targets.delete(bucket); skip(item.instanceId!, 'Only one exotic of a kind can be equipped'); }
    exoticSeen.add(k);
  }
  const targetIdSet = new Set([...targets.values()].map((t) => t.instanceId!));

  const carried = (owner: string, bucket: number) => live.filter((i) => i.owner === owner && !i.equipped && i.bucketHash === bucket);
  const equippedIn = (owner: string, bucket: number) => live.find((i) => i.owner === owner && i.equipped && i.bucketHash === bucket);
  const best = (list: Row[]) => [...list].sort((a, b) => (b.power ?? 0) - (a.power ?? 0))[0];
  const move = (item: Row, to: string) => {
    for (const s of planMove({ owner: item.owner, bucketHash: item.bucketHash }, to)) {
      plan.steps.push({ ...s, instanceId: item.instanceId!, itemHash: item.itemHash });
    }
    if (item.owner === 'vault') vaultFree++;
    if (to === 'vault') vaultFree--;
    item.owner = to;
  };
  /** Frees a carried space in `bucket` on this character by sending its weakest spare to the vault. */
  const makeRoom = (bucket: number): boolean => {
    const spares = carried(characterId, bucket).filter((i) => !targetIdSet.has(i.instanceId!) && i.movable);
    if (carried(characterId, bucket).length < CHARACTER_BUCKET_CARRIED) return true;
    if (vaultFree <= 0 || spares.length === 0) return false;
    const weakest = [...spares].sort((a, b) => (a.power ?? 0) - (b.power ?? 0) || Number(a.locked) - Number(b.locked))[0]!;
    move(weakest, 'vault');
    return true;
  };

  const equipHere: string[] = [];
  for (const item of targets.values()) {
    const bucket = item.bucketHash!;
    if (item.owner !== characterId) {
      // Worn by another character: that one puts on a stand-in first (never an exotic, so it can't clash).
      if (item.equipped) {
        const standIn = best(carried(item.owner, bucket).filter((i) => !targetIdSet.has(i.instanceId!) && !exoticKind(i)));
        if (!standIn) { skip(item.instanceId!, `Nothing else in that slot for the ${characters.find((c) => c.id === item.owner)?.className ?? 'other character'} to wear`); continue; }
        plan.steps.push({ kind: 'equip', characterId: item.owner, instanceIds: [standIn.instanceId!] });
        standIn.equipped = true;
        item.equipped = false;
      }
      if (!makeRoom(bucket)) { skip(item.instanceId!, 'No room on this character or in the vault'); continue; }
      if (item.owner !== 'vault' && vaultFree <= 0) { skip(item.instanceId!, 'The vault is full, so it can\'t pass through'); continue; }
      move(item, characterId);
    }
    equipHere.push(item.instanceId!);
  }

  // Exotic clash with something already worn in another slot: swap that one for a legendary first.
  const swaps: string[] = [];
  for (const kind of exoticSeen) {
    const coming = [...targets.values()].find((t) => exoticKind(t) === kind && equipHere.includes(t.instanceId!));
    if (!coming) continue;
    const worn = live.find((i) => i.owner === characterId && i.equipped && exoticKind(i) === kind && i.bucketHash !== coming.bucketHash);
    if (!worn || targets.has(worn.bucketHash!)) continue; // that slot is being replaced anyway
    const bucket = worn.bucketHash!;
    let standIn = best(carried(characterId, bucket).filter((i) => !exoticKind(i)));
    if (!standIn) {
      const fromVault = best(live.filter((i) => i.owner === 'vault' && i.bucketHash === bucket && !exoticKind(i)
        && (i.classType === 3 || i.classType === characters.find((c) => c.id === characterId)?.classType)));
      if (fromVault && makeRoom(bucket)) { move(fromVault, characterId); standIn = fromVault; }
    }
    if (!standIn) {
      equipHere.splice(equipHere.indexOf(coming.instanceId!), 1);
      skip(coming.instanceId!, `${worn.name} is already your exotic, and there's no legendary to swap it for`);
      continue;
    }
    swaps.push(standIn.instanceId!);
  }

  const ids = [...swaps, ...equipHere];
  if (ids.length) plan.steps.push({ kind: 'equip', characterId, instanceIds: ids });
  return plan;
}

// ── Recording finished steps in a snapshot ─────────────────────

type Lists = { equipment?: DestinyItemComponent[]; inventory?: DestinyItemComponent[] };
const charLists = (profile: DestinyProfileResponse, characterId: string): Lists => ({
  equipment: profile.characterEquipment?.data?.[characterId]?.items as DestinyItemComponent[] | undefined,
  inventory: profile.characterInventories?.data?.[characterId]?.items as DestinyItemComponent[] | undefined,
});

/**
 * Records an equip in a profile snapshot: the item moves into the character's equipment and the
 * one it replaces drops into the inventory. False when the item isn't on that character.
 */
export function applyEquip(profile: DestinyProfileResponse, characterId: string, instanceId: string): boolean {
  const { equipment, inventory } = charLists(profile, characterId);
  if (!equipment || !inventory) return false;
  const n = inventory.findIndex((i) => i.itemInstanceId === instanceId);
  if (n < 0) return equipment.some((i) => i.itemInstanceId === instanceId);
  const [item] = inventory.splice(n, 1) as [DestinyItemComponent];
  const m = equipment.findIndex((i) => i.bucketHash === item.bucketHash);
  if (m >= 0) inventory.push(equipment.splice(m, 1, item)[0]!);
  else equipment.push(item);
  return true;
}

/** Records a lock or unlock in a profile snapshot. */
export function applyLock(profile: DestinyProfileResponse, instanceId: string, locked: boolean): boolean {
  const lists: DestinyItemComponent[][] = [];
  const vault = profile.profileInventory?.data?.items;
  if (vault) lists.push(vault as DestinyItemComponent[]);
  for (const id of Object.keys(profile.characters?.data ?? {})) {
    const { equipment, inventory } = charLists(profile, id);
    if (equipment) lists.push(equipment);
    if (inventory) lists.push(inventory);
  }
  for (const list of lists) {
    const n = list.findIndex((i) => i.itemInstanceId === instanceId);
    if (n < 0) continue;
    const item = list[n]!;
    // Snapshot data is plain JSON, so replacing the read-only field is safe here.
    list[n] = { ...item, state: locked ? item.state | STATE_LOCKED : item.state & ~STATE_LOCKED } as DestinyItemComponent;
    return true;
  }
  return false;
}

// ── In-game loadouts ───────────────────────────────────────────

export interface GameLoadout {
  /** The slot number in game, from 0. */
  index: number;
  name?: string;
  nameHash?: number;
  colorHash?: number;
  iconHash?: number;
  /** Background swatch and glyph, as the game draws the slot. */
  colorImage?: string;
  iconImage?: string;
  /** Instance ids in the loadout (subclass, weapons, armor), in the game's order. */
  items: string[];
  /** Plugs saved with each item (subclass abilities, armor mods), by instance id. */
  plugs: Record<string, number[]>;
  /** A slot nothing has been saved to. */
  empty: boolean;
}

/** Each character's in-game loadout slots, read from the CharacterLoadouts component (206). */
export function summarizeGameLoadouts(
  profile: DestinyProfileResponse, manifest: Pick<ManifestTables, 'loadoutStyles'>,
): Record<string, GameLoadout[]> {
  const styles = manifest.loadoutStyles;
  const name = new Map(styles?.names.map((n) => [n.hash, n.name]));
  const color = new Map(styles?.colors.map((c) => [c.hash, c.image]));
  const icon = new Map(styles?.icons.map((c) => [c.hash, c.image]));
  const out: Record<string, GameLoadout[]> = {};
  const data = (profile as DestinyProfileResponse & { characterLoadouts?: { data?: Record<string, { loadouts: { colorHash: number; iconHash: number; nameHash: number; items: { itemInstanceId: string; plugItemHashes: number[] }[] }[] }> } }).characterLoadouts?.data ?? {};
  for (const [characterId, c] of Object.entries(data)) {
    out[characterId] = c.loadouts.map((l, index) => {
      // Empty slots list placeholder items with instance id "0".
      const real = l.items.filter((i) => i.itemInstanceId && i.itemInstanceId !== '0');
      // Bungie's "no plug here" marker is 2166136261 (the FNV offset basis).
      const plugs = Object.fromEntries(real.map((i) => [i.itemInstanceId, i.plugItemHashes.filter((h) => h && h !== 2166136261)]));
      return {
        index,
        name: name.get(l.nameHash),
        nameHash: l.nameHash || undefined,
        colorHash: l.colorHash || undefined,
        iconHash: l.iconHash || undefined,
        colorImage: color.get(l.colorHash),
        iconImage: icon.get(l.iconHash),
        items: real.map((i) => i.itemInstanceId),
        plugs,
        empty: real.length === 0,
      };
    });
  }
  return out;
}

// ── Triumvirate's own loadouts ─────────────────────────────────

/** A loadout saved in Triumvirate: any number, any name, not tied to one character of a class. */
export interface SavedLoadout {
  id: string;
  name: string;
  /** 0 Titan, 1 Hunter, 2 Warlock, 3 any (weapons only). */
  classType: number;
  /** One per slot; item hash kept so a missing copy can still be named. */
  items: { instanceId: string; itemHash: number; bucketHash?: number }[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/** The gear a character is wearing, as loadout items (subclass included). */
export function equippedAsLoadout(items: Row[], characterId: string): SavedLoadout['items'] {
  return items
    .filter((i) => i.owner === characterId && i.equipped && i.instanceId && i.bucketHash && LOADOUT_BUCKETS.includes(i.bucketHash))
    .sort((a, b) => LOADOUT_BUCKETS.indexOf(a.bucketHash!) - LOADOUT_BUCKETS.indexOf(b.bucketHash!))
    .map((i) => ({ instanceId: i.instanceId!, itemHash: i.itemHash, bucketHash: i.bucketHash }));
}

/** Which of a loadout's items the character is already wearing, and which are gone. */
export function loadoutStatus(loadout: Pick<SavedLoadout, 'items'>, characterId: string, items: Row[]) {
  const byId = new Map(items.filter((i) => i.instanceId).map((i) => [i.instanceId!, i]));
  let worn = 0;
  const missing: string[] = [];
  for (const l of loadout.items) {
    const i = byId.get(l.instanceId);
    if (!i) missing.push(l.instanceId);
    else if (i.owner === characterId && i.equipped) worn++;
  }
  return { worn, missing, total: loadout.items.length, applied: worn === loadout.items.length && loadout.items.length > 0 };
}

/** Accepts a loadout from a request body, trimmed to known fields. Undefined when it doesn't hold up. */
export function cleanLoadout(body: unknown): Pick<SavedLoadout, 'name' | 'classType' | 'items' | 'notes'> | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 60) : '';
  const classType = Number(b.classType);
  if (!name || ![0, 1, 2, 3].includes(classType) || !Array.isArray(b.items)) return undefined;
  const items = b.items
    .filter((i): i is { instanceId: string; itemHash: number; bucketHash?: number } =>
      !!i && typeof i === 'object' && typeof (i as { instanceId?: unknown }).instanceId === 'string' && /^\d{1,20}$/.test((i as { instanceId: string }).instanceId)
      && Number.isInteger((i as { itemHash?: unknown }).itemHash))
    .slice(0, LOADOUT_BUCKETS.length)
    .map((i) => ({ instanceId: i.instanceId, itemHash: i.itemHash, ...(Number.isInteger(i.bucketHash) ? { bucketHash: i.bucketHash } : {}) }));
  if (items.length === 0) return undefined;
  const notes = typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim().slice(0, 500) : undefined;
  return { name, classType, items, ...(notes ? { notes } : {}) };
}
