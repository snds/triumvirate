// Turns a raw GetProfile response into a flat, readable list of items by location.
import type { DestinyProfileResponse, DestinyItemComponent } from 'bungie-api-ts/destiny2';
import type { ManifestTables } from './manifest.ts';

export const VAULT_BUCKET = 138197802;
/** "Lost Items": the postmaster. Lives in each character's inventory and holds 21 items. */
export const POSTMASTER_BUCKET = 215593132;
export const POSTMASTER_CAPACITY = 21;
/** Character stats in in-game order (Armor 3.0 names: Weapons, Health, Class, Grenade, Super, Melee). */
const CHARACTER_STAT_ORDER = [2996146975, 392767087, 1943323491, 1735777505, 144602215, 4244567218];
export const CLASS_NAMES = ['Titan', 'Hunter', 'Warlock'];
/** Index = Bungie's DamageType enum value. */
export const DAMAGE_NAMES = ['', 'Kinetic', 'Arc', 'Solar', 'Void', 'Raid', 'Stasis', 'Strand'];
/** Bit 1 of DestinyItemComponent.state = locked in game. */
const STATE_LOCKED = 1;
/** Bit 8 = crafted (shaped) weapon. */
const STATE_CRAFTED = 8;
/** Socket categories on weapons. */
const SOCKET_INTRINSIC = 3956125808;
const SOCKET_WEAPON_PERKS = 4241085061;
const SOCKET_WEAPON_MODS = 2685412949;
/** DestinyObjectiveUiStyle.CraftingWeaponLevel. */
const OBJECTIVE_CRAFTED_LEVEL = 2;
export const STAT_RECOIL_DIRECTION = 2715839340;
// Mods-row plugs that are cosmetic or empty, so not worth a slot in the UI.
const NOT_A_MOD = /shader|ornament|memento|empty|default|tracker|deprecated/i;

export interface ItemRow {
  location: string;
  /** Character id, or 'vault'. */
  owner: string;
  name: string;
  type: string;
  bucket: string;
  bucketHash?: number;
  power?: number;
  equipped: boolean;
  itemHash: number;
  instanceId?: string;
  /** Full https URL to the item icon. */
  icon?: string;
  /** Season/expansion watermark drawn over the icon. */
  watermark?: string;
  /** e.g. Exotic, Legendary, Rare. */
  tier: string;
  /** DestinyItemType: 3 = weapon, 2 = armor. */
  itemType: number;
  /** 0 Titan, 1 Hunter, 2 Warlock, 3 any. */
  classType: number;
  damage?: string;
  /** Bungie's element icon (Kinetic, Arc, Solar, Void, Stasis, Strand). */
  damageIcon?: string;
  locked: boolean;
  /** Armor 3.0 gear tier (1-5); absent on older gear. */
  gearTier?: number;
  /** Weapon perk columns, in socket order. */
  perks?: PerkOption[][];
  /** Armor stats (e.g. Health, Grenade) or weapon stats (e.g. Range, Stability), by name. */
  stats?: Record<string, number>;
  /** The same stats in game order, with the bonus from perks, mods, and masterwork. */
  statDetails?: StatDetail[];
  /** Weapon frame (e.g. "Rapid-Fire Frame"). */
  intrinsic?: PerkOption;
  /** Masterwork and weapon mod, in socket order. */
  mods?: PerkOption[];
  crafted?: boolean;
  craftedLevel?: number;
  killTracker?: { label: string; count: number };
  flavorText?: string;
  /** Applied ornament ("fashion"), when it changes the look. `icon` above is then the ornament's art. */
  ornament?: { name: string; icon?: string };
  /** The item's own art, kept when an ornament replaces `icon`. */
  baseIcon?: string;
  /** Can be dragged somewhere: instanced, not equipped, and Bungie allows moving it. */
  movable?: boolean;
  /** A postmaster item Bungie won't transfer: it can only be pulled to its own character. */
  pullOnly?: boolean;
}

export interface PerkOption {
  name: string;
  icon?: string;
  /** True for the perk currently slotted in this column. */
  active: boolean;
  description?: string;
  /** Enhanced version of a trait (the game's yellow arrow). */
  enhanced?: boolean;
}

export interface StatDetail {
  hash: number;
  name: string;
  /** The value the game shows, bonuses included. */
  value: number;
  /** How much of `value` comes from perks, mods, and masterwork (can be negative). */
  bonus: number;
  /** Counts and times (RPM, Magazine): show the number, no bar. */
  numeric: boolean;
}

// Plug types that aren't part of a roll: cosmetics, trackers, and masterwork/mod slots.
const NOT_A_PERK = /shader|ornament|masterwork|mod\b|tracker|memento|empty|catalyst|deprecated|kill tracker/i;
const WEAPON = 3;
const ARMOR = 2;

export interface CharacterRow {
  id: string;
  className: string;
  classType: number;
  light: number;
  emblemBackground?: string;
  lastPlayed: string;
  /** Equipped title, e.g. "Iron Lord". */
  title?: string;
  /** The six character stats, in-game order. */
  stats?: CharacterStat[];
  /** The equipped subclass and what's slotted in it. */
  subclass?: EquippedSubclass;
}

export interface EquippedSubclass {
  /** e.g. "Voidwalker". */
  name: string;
  /** e.g. "Void", "Prismatic". */
  element: string;
  icon?: string;
  /** Slotted parts by slot: supers, grenades, melee, class_abilities, movement, aspects, fragments. */
  parts: Record<string, { name: string; icon?: string; description?: string }[]>;
}

export interface CharacterStat {
  name: string;
  value: number;
  icon?: string;
}

export interface Currency {
  name: string;
  quantity: number;
  icon?: string;
}

export interface AccountSummary {
  currencies: Currency[];
  /** Items in the vault and how many it holds. */
  vault: { used: number; capacity: number };
}

const bungieUrl = (path?: string) => (path ? `https://www.bungie.net${path}` : undefined);

/**
 * `manifest` adds stat names and icons; `titles` maps character id to the equipped
 * title (looked up separately, since the record table is too big to cache whole).
 */
export const SUBCLASS_BUCKET = 3284755031;
/** Plug categories of ornament sockets, e.g. armor_skins_warlock_head or a weapon's *_skins. */
const ORNAMENT_PLUG = /skins/i;
/** TransferStatuses.NotTransferrable. */
const TRANSFER_NOT_TRANSFERRABLE = 2;
const SUBCLASS_PLUG = /^(?:titan|hunter|warlock|shared)\.(\w+)\.(supers|grenades|melee|class_abilities|movement|aspects|fragments)$/;

/** Reads the subclass a character has equipped and every plug slotted into it. */
export function equippedSubclass(
  profile: DestinyProfileResponse, manifest: Pick<ManifestTables, 'items' | 'extras'>, characterId: string,
): EquippedSubclass | undefined {
  const item = profile.characterEquipment?.data?.[characterId]?.items.find((i) => i.bucketHash === SUBCLASS_BUCKET);
  if (!item) return undefined;
  const def = manifest.items[item.itemHash];
  const parts: EquippedSubclass['parts'] = {};
  let element = '';
  const socketList = item.itemInstanceId ? profile.itemComponents?.sockets?.data?.[item.itemInstanceId]?.sockets ?? [] : [];
  for (const socket of socketList) {
    if (!socket.plugHash) continue;
    const m = SUBCLASS_PLUG.exec(manifest.extras?.[socket.plugHash]?.plugCategory ?? '');
    const d = manifest.items[socket.plugHash];
    const name = d?.displayProperties.name;
    // Empty aspect/fragment sockets have plugs named "Empty ... Socket".
    if (!m || !name || /^empty/i.test(name)) continue;
    const [, el, slot] = m as unknown as [string, string, string];
    if (el !== 'shared' && !element) element = el[0]!.toUpperCase() + el.slice(1);
    (parts[slot] ??= []).push({ name, icon: bungieUrl(d.displayProperties.icon), description: d.displayProperties.description || undefined });
  }
  return { name: def?.displayProperties.name ?? 'Subclass', element, icon: bungieUrl(def?.displayProperties.icon), parts };
}

export function summarizeCharacters(
  profile: DestinyProfileResponse, manifest?: Pick<ManifestTables, 'stats'> & Partial<Pick<ManifestTables, 'items' | 'extras'>>,
  titles: Record<string, string> = {},
): CharacterRow[] {
  return Object.entries(profile.characters?.data ?? {})
    .map(([id, ch]) => ({
      id,
      className: CLASS_NAMES[ch.classType] ?? 'Character',
      classType: ch.classType,
      light: ch.light,
      emblemBackground: bungieUrl(ch.emblemBackgroundPath),
      lastPlayed: ch.dateLastPlayed,
      title: titles[id],
      subclass: manifest?.items && manifest.extras
        ? equippedSubclass(profile, { items: manifest.items, extras: manifest.extras }, id)
        : undefined,
      stats: manifest
        ? CHARACTER_STAT_ORDER.filter((h) => ch.stats?.[h] !== undefined).map((h) => ({
          name: manifest.stats[h]?.displayProperties.name ?? '',
          value: ch.stats[h]!,
          icon: bungieUrl(manifest.stats[h]?.displayProperties.icon),
        }))
        : undefined,
    }))
    // Most recently played first, the same order the game uses.
    .sort((a, b) => b.lastPlayed.localeCompare(a.lastPlayed));
}

/** Profile-wide numbers for the vault header: currencies and vault space. */
export function summarizeAccount(profile: DestinyProfileResponse, manifest: Pick<ManifestTables, 'items' | 'buckets'>): AccountSummary {
  const currencies = (profile.profileCurrencies?.data?.items ?? []).map((c) => {
    const d = manifest.items[c.itemHash];
    return { name: d?.displayProperties.name || 'Currency', quantity: c.quantity, icon: bungieUrl(d?.displayProperties.icon) };
  });
  const used = (profile.profileInventory?.data?.items ?? []).filter((i) => i.bucketHash === VAULT_BUCKET).length;
  return { currencies, vault: { used, capacity: manifest.buckets[VAULT_BUCKET]?.itemCount ?? 0 } };
}

export function summarizeProfile(profile: DestinyProfileResponse, manifest: ManifestTables): ItemRow[] {
  const instances = profile.itemComponents?.instances?.data ?? {};
  const sockets = profile.itemComponents?.sockets?.data ?? {};
  const reusable = profile.itemComponents?.reusablePlugs?.data ?? {};
  const itemStats = profile.itemComponents?.stats?.data ?? {};

  const plugObjectives = profile.itemComponents?.plugObjectives?.data ?? {};

  const plugInfo = (hash: number, active: boolean): PerkOption | undefined => {
    const d = manifest.items[hash];
    if (!d?.displayProperties.name) return undefined;
    const p: PerkOption = { name: d.displayProperties.name, icon: bungieUrl(d.displayProperties.icon), active };
    if (d.displayProperties.description) p.description = d.displayProperties.description;
    if (/enhanced/i.test(d.itemTypeDisplayName ?? '')) p.enhanced = true;
    return p;
  };
  const perkOption = (hash: number, active: boolean): PerkOption | undefined =>
    NOT_A_PERK.test(manifest.items[hash]?.itemTypeDisplayName ?? '') ? undefined : plugInfo(hash, active);

  /** Socket indexes per category, from the full item definition (absent with an older manifest cache). */
  const socketIndexes = (itemHash: number, category: number) =>
    manifest.extras?.[itemHash]?.socketCategories?.find(([c]) => c === category)?.[1];

  const weaponPerks = (instanceId: string, itemHash: number): PerkOption[][] | undefined => {
    const socketList = sockets[instanceId]?.sockets;
    if (!socketList) return undefined;
    const options = reusable[instanceId]?.plugs ?? {};
    const perkSockets = socketIndexes(itemHash, SOCKET_WEAPON_PERKS);
    const columns: PerkOption[][] = [];
    socketList.forEach((socket, index) => {
      if (!socket.plugHash || socket.isVisible === false) return;
      if (perkSockets && !perkSockets.includes(index)) return;
      const active = perkOption(socket.plugHash, true);
      if (!active) return;
      // Other perks this roll can switch to in the same column (multi-perk columns).
      const alts = (options[index] ?? [])
        .filter((p) => p.plugItemHash !== socket.plugHash)
        .map((p) => perkOption(p.plugItemHash, false))
        .filter((p): p is PerkOption => !!p);
      columns.push([active, ...alts]);
    });
    return columns;
  };

  /** Frame, masterwork, and mods: the sockets outside the perk columns. */
  const weaponExtras = (instanceId: string, itemHash: number) => {
    const socketList = sockets[instanceId]?.sockets ?? [];
    const intrinsicIndex = socketIndexes(itemHash, SOCKET_INTRINSIC)?.[0];
    const intrinsicHash = intrinsicIndex !== undefined ? socketList[intrinsicIndex]?.plugHash : undefined;
    const mods = (socketIndexes(itemHash, SOCKET_WEAPON_MODS) ?? [])
      .map((i) => socketList[i]?.plugHash)
      .filter((h): h is number => !!h && !NOT_A_MOD.test(manifest.items[h]?.displayProperties.name ?? '')
        && !NOT_A_MOD.test(manifest.items[h]?.itemTypeDisplayName ?? ''))
      .map((h) => plugInfo(h, true))
      .filter((p): p is PerkOption => !!p);
    return { intrinsic: intrinsicHash ? plugInfo(intrinsicHash, true) : undefined, mods: mods.length ? mods : undefined };
  };

  /** Crafted level and kill tracker count, from the objectives on plugged items. */
  const weaponProgress = (instanceId: string) => {
    let craftedLevel: number | undefined;
    let killTracker: { label: string; count: number } | undefined;
    for (const [plugHash, objectives] of Object.entries(plugObjectives[instanceId]?.objectivesPerPlug ?? {})) {
      const plugName = manifest.items[plugHash]?.displayProperties.name ?? '';
      for (const o of objectives) {
        const style = manifest.objectives?.[o.objectiveHash]?.uiStyle;
        if (style === OBJECTIVE_CRAFTED_LEVEL) craftedLevel = o.progress;
        else if (/tracker/i.test(plugName) && o.progress !== undefined) {
          killTracker = { label: manifest.objectives?.[o.objectiveHash]?.progressDescription || plugName, count: o.progress };
        }
      }
    }
    return { craftedLevel, killTracker };
  };

  /** Stats in the game's display order, each with the bonus that plugged perks and mods add. */
  const statDetails = (instanceId: string, itemHash: number): StatDetail[] | undefined => {
    const s = itemStats[instanceId]?.stats;
    if (!s) return undefined;
    const bonus = new Map<number, number>();
    for (const socket of sockets[instanceId]?.sockets ?? []) {
      // Frames and cosmetics carry no stats; perks, mods, and masterwork do.
      for (const [hash, value] of (socket.plugHash && manifest.extras?.[socket.plugHash]?.investment) || []) {
        bonus.set(hash, (bonus.get(hash) ?? 0) + value);
      }
    }
    const group = manifest.statGroups?.[manifest.extras?.[itemHash]?.statGroupHash ?? -1]?.scaledStats ?? [];
    const order = new Map(group.map((g, i) => [g.statHash, i]));
    const numeric = new Set(group.filter((g) => g.displayAsNumeric).map((g) => g.statHash));
    return Object.values(s)
      .map((st) => ({
        hash: st.statHash,
        name: manifest.stats[st.statHash]?.displayProperties.name ?? '',
        value: st.value,
        // Bonuses can't exceed the value itself (stats are clamped at 0).
        bonus: Math.min(bonus.get(st.statHash) ?? 0, st.value),
        numeric: numeric.has(st.statHash),
      }))
      .filter((d) => d.name && !['Attack', 'Defense', 'Power'].includes(d.name))
      // Stats the game shows come first, in its order; hidden ones (Aim Assistance, Zoom...) follow.
      .sort((a, b) => (order.get(a.hash) ?? 999) - (order.get(b.hash) ?? 999) || a.name.localeCompare(b.name));
  };

  const itemStatValues = (instanceId: string): Record<string, number> | undefined => {
    const s = itemStats[instanceId]?.stats;
    if (!s) return undefined;
    const out: Record<string, number> = {};
    for (const st of Object.values(s)) {
      const name = manifest.stats[st.statHash]?.displayProperties.name;
      // Attack/Defense is the power level, already shown elsewhere.
      if (name && name !== 'Attack' && name !== 'Defense' && name !== 'Power') out[name] = st.value;
    }
    return out;
  };
  const elementIcon = (hash?: number) => {
    const d = hash ? manifest.damageTypes?.[hash] : undefined;
    // The transparent version sits cleanly on tiles; fall back to the regular icon.
    return bungieUrl(d?.transparentIconPath || d?.displayProperties.icon);
  };
  const rows: ItemRow[] = [];
  /** The plug in an ornament ("skins") socket, if one other than the default is slotted. */
  const ornamentPlug = (instanceId?: string) => {
    if (!instanceId) return undefined;
    for (const socket of sockets[instanceId]?.sockets ?? []) {
      const h = socket.plugHash;
      if (h && ORNAMENT_PLUG.test(manifest.extras?.[h]?.plugCategory ?? '')) return h;
    }
    return undefined;
  };

  const toRow = (item: DestinyItemComponent, location: string, owner: string, equipped: boolean): ItemRow => {
    const def = manifest.items[item.itemHash];
    const bucketHash = item.bucketHash === VAULT_BUCKET ? def?.inventory?.bucketTypeHash : item.bucketHash;
    const inst = item.itemInstanceId ? instances[item.itemInstanceId] : undefined;
    const id = item.itemInstanceId;
    const isWeapon = def?.itemType === WEAPON;
    const extras = id && isWeapon ? weaponExtras(id, item.itemHash) : undefined;
    const progress = id && isWeapon ? weaponProgress(id) : undefined;
    const crafted = (item.state & STATE_CRAFTED) !== 0;
    const inPostmaster = item.bucketHash === POSTMASTER_BUCKET;
    const notTransferrable = (item.transferStatus & TRANSFER_NOT_TRANSFERRABLE) !== 0;
    // Postmaster items can always be pulled; anything else needs Bungie's go-ahead.
    // An ornament swaps the art, like in game. "Default" ornaments and same-art styles change nothing.
    // Bungie names it in overrideStyleItemHash; if that's missing (seen on some vault items),
    // fall back to the plug in the item's ornament socket.
    const styleHash = item.overrideStyleItemHash && item.overrideStyleItemHash !== item.itemHash
      ? item.overrideStyleItemHash : ornamentPlug(id);
    const styleDef = styleHash ? manifest.items[styleHash] : undefined;
    const styleIcon = styleDef?.displayProperties.icon;
    const ornament = styleDef && styleIcon && styleIcon !== def?.displayProperties.icon
      && !/^default/i.test(styleDef.displayProperties.name) ? styleDef : undefined;
    const movable = !!id && !equipped && item.bucketHash !== SUBCLASS_BUCKET && (inPostmaster || !notTransferrable);
    return {
      location,
      owner,
      name: def?.displayProperties.name || `Unknown item ${item.itemHash}`,
      type: def?.itemTypeDisplayName ?? '',
      bucket: (bucketHash && manifest.buckets[bucketHash]?.displayProperties.name) || '',
      bucketHash,
      power: inst?.primaryStat?.value,
      equipped,
      itemHash: item.itemHash,
      instanceId: item.itemInstanceId,
      icon: bungieUrl(ornament ? ornament.displayProperties.icon : def?.displayProperties.icon),
      watermark: bungieUrl(def?.iconWatermark),
      tier: def?.inventory?.tierTypeName ?? '',
      itemType: def?.itemType ?? 0,
      classType: def?.classType ?? 3,
      damage: inst?.damageType ? DAMAGE_NAMES[inst.damageType] : undefined,
      damageIcon: elementIcon(inst?.damageTypeHash),
      locked: (item.state & STATE_LOCKED) !== 0,
      gearTier: inst?.gearTier || undefined,
      perks: id && isWeapon ? weaponPerks(id, item.itemHash) : undefined,
      stats: id && (def?.itemType === ARMOR || isWeapon) ? itemStatValues(id) : undefined,
      // Optional extras: only set when present, so plain rows stay small.
      ...(id && (def?.itemType === ARMOR || isWeapon) && manifest.extras ? { statDetails: statDetails(id, item.itemHash) } : {}),
      ...(extras?.intrinsic ? { intrinsic: extras.intrinsic } : {}),
      ...(extras?.mods ? { mods: extras.mods } : {}),
      ...(crafted ? { crafted } : {}),
      ...(progress?.craftedLevel !== undefined ? { craftedLevel: progress.craftedLevel } : {}),
      ...(progress?.killTracker ? { killTracker: progress.killTracker } : {}),
      ...(manifest.extras?.[item.itemHash]?.flavorText ? { flavorText: manifest.extras[item.itemHash]!.flavorText } : {}),
      ...(ornament ? {
        ornament: { name: ornament.displayProperties.name, icon: bungieUrl(ornament.displayProperties.icon) },
        baseIcon: bungieUrl(def?.displayProperties.icon),
      } : {}),
      ...(movable ? { movable } : {}),
      ...(movable && inPostmaster && notTransferrable ? { pullOnly: true } : {}),
    };
  };

  for (const item of profile.profileInventory?.data?.items ?? []) {
    // Profile inventory also holds consumables and mods; keep only the vault here.
    if (item.bucketHash === VAULT_BUCKET) rows.push(toRow(item, 'Vault', 'vault', false));
  }

  const characters = profile.characters?.data ?? {};
  for (const [id, ch] of Object.entries(characters)) {
    const label = `${CLASS_NAMES[ch.classType] ?? 'Character'} (${ch.light})`;
    for (const item of profile.characterEquipment?.data?.[id]?.items ?? []) rows.push(toRow(item, label, id, true));
    for (const item of profile.characterInventories?.data?.[id]?.items ?? []) rows.push(toRow(item, label, id, false));
  }
  return rows;
}
