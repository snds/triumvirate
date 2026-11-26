// Downloads only the manifest tables we need and caches them on disk,
// keyed by manifest version so a Bungie patch triggers a fresh download.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HttpClient } from 'bungie-api-ts/http';
import {
  getDestinyManifest,
  type DestinyInventoryBucketDefinition,
  type DestinyInventoryItemLiteDefinition,
  type DestinyStatDefinition,
  type DestinyDamageTypeDefinition,
  type DestinyInventoryItemDefinition,
  type DestinyObjectiveDefinition,
  type DestinyStatGroupDefinition,
  type DestinyBreakerTypeDefinition,
  type DestinyPlugSetDefinition,
  type DestinyLoadoutNameDefinition,
  type DestinyLoadoutColorDefinition,
  type DestinyLoadoutIconDefinition,
  type DestinyLoadoutConstantsDefinition,
  type DestinyEquipableItemSetDefinition,
  type DestinySandboxPerkDefinition,
} from 'bungie-api-ts/destiny2';
import { BUNGIE_ROOT } from './bungie.ts';
import { recordRoots, slimNodes, slimRecords, type RecordTables } from './records.ts';
import { slimIdentity, type IdentityTables } from './identity.ts';

export interface ManifestTables {
  version: string;
  items: Record<string, DestinyInventoryItemLiteDefinition>;
  buckets: Record<string, DestinyInventoryBucketDefinition>;
  stats: Record<string, DestinyStatDefinition>;
  /** Element names and icons (Kinetic, Arc, Solar...). Optional so test fixtures can skip it. */
  damageTypes?: Record<string, DestinyDamageTypeDefinition>;
  /** Fields the lite item table leaves out, trimmed from the full table. Optional for fixtures. */
  extras?: Record<string, ItemExtra>;
  /** Stat display order and which stats are plain numbers (RPM, Magazine). */
  statGroups?: Record<string, Pick<DestinyStatGroupDefinition, 'scaledStats'>>;
  /** Objective styles, to find crafted level and kill tracker counts. */
  objectives?: Record<string, ObjectiveExtra>;
  /** Champion stun types (Anti-Barrier, Overload, Unstoppable) with their icons. */
  breakerTypes?: Record<string, Pick<DestinyBreakerTypeDefinition, 'displayProperties'>>;
  /** Plug sets: the plugs each can roll (used for "every possible roll"). */
  plugSets?: Record<string, number[]>;
  /** In-game loadout names, colors, and icons, in the game's picker order. */
  loadoutStyles?: LoadoutStyles;
  /** Armor sets and the perks that switch on at 2 and 4 pieces, by set hash. */
  itemSets?: Record<string, ArmorSet>;
  /** Where an item comes from ("Source: ..." from its collection entry), by item hash. */
  sources?: Record<string, string>;
  /** Seasons, season passes, artifacts, and the rank progressions the season tracker reads. */
  season?: SeasonTables;
  /** Guardian Rank names and art, and the commendation groups' colors. */
  identity?: IdentityTables;
  /** Activity modes the app marks things with (PvE, Crucible, Raid…), by modeType. */
  modes?: Record<string, ActivityMode>;
}

export interface ActivityMode {
  name: string;
  /** Monochrome glyph, full bungie.net URL. */
  icon?: string;
  /** 1920×590 stats banner, full bungie.net URL. */
  banner?: string;
}

/** modeType values the app uses: Strike, Raid, Crucible, Explore, PvE, Nightfall, Gambit, Dungeon, Trials. */
export const MODE = { strike: 3, raid: 4, crucible: 5, explore: 6, pve: 7, nightfall: 46, gambit: 63, dungeon: 82, trials: 84 } as const;

/** Keeps the handful of modes in MODE: name, glyph, and banner. */
export function slimModes(full: Record<string, { modeType?: number; displayProperties?: { name?: string; icon?: string }; pgcrImage?: string }>) {
  const wanted = new Set<number>(Object.values(MODE));
  const out: Record<string, ActivityMode> = {};
  for (const d of Object.values(full)) {
    if (d.modeType === undefined || !wanted.has(d.modeType) || out[d.modeType]) continue;
    const url = (p?: string) => (p ? `https://www.bungie.net${p}` : undefined);
    out[d.modeType] = {
      name: d.displayProperties?.name ?? '',
      ...(d.displayProperties?.icon ? { icon: url(d.displayProperties.icon) } : {}),
      ...(d.pgcrImage ? { banner: url(d.pgcrImage) } : {}),
    };
  }
  return out;
}

export interface ProgressionInfo {
  name: string;
  icon?: string;
  /** Rank names and points per step (e.g. "Guardian I" … "Legend"). */
  steps: { name: string; total: number; icon?: string }[];
}
export interface SeasonTables {
  seasons: Record<string, { name: string; number: number; startDate?: string; endDate?: string; passes: { hash: number; start?: string; end?: string }[]; icon?: string; art?: string }>;
  passes: Record<string, { name: string; icon?: string; reward: number; prestige?: number }>;
  artifacts: Record<string, { name: string; icon?: string }>;
  /** Only the ranks and season pass progressions; the full table is mostly faction trivia. */
  progressions: Record<string, ProgressionInfo>;
  /** Rank progressions to show, in display order. */
  ranks: number[];
}

/** Rank progressions worth tracking: the ritual and vendor ranks ("Guardian I" ladders) and Competitive. */
const RANK_ORDER = [457612306, 2083746873, 3696598664, 3008065600, 2755675426, 1471185389, 2411069437, 3011295063];
const isRankLadder = (p: { steps?: { stepName?: string }[] }) => /^guardian i$/i.test(p.steps?.[0]?.stepName ?? '') && (p.steps?.length ?? 0) >= 10;

/** Joins the four small season tables into what the tracker needs. */
export function slimSeason(
  seasons: Record<string, any>, passes: Record<string, any>, progressions: Record<string, any>, artifacts: Record<string, any>,
): SeasonTables {
  const url = (p?: string) => (p ? `https://www.bungie.net${p}` : undefined);
  const out: SeasonTables = { seasons: {}, passes: {}, artifacts: {}, progressions: {}, ranks: [] };
  for (const [h, s] of Object.entries(seasons)) {
    out.seasons[h] = {
      name: s.displayProperties?.name ?? '', number: s.seasonNumber ?? 0, startDate: s.startDate, endDate: s.endDate,
      passes: (s.seasonPassList ?? []).map((x: any) => ({ hash: x.seasonPassHash, start: x.seasonPassStartDate, end: x.seasonPassEndDate })),
      icon: url(s.displayProperties?.icon),
      // Key art (720×405, soft transparent edges made to sit on a dark ground). Older seasons have none.
      ...(s.backgroundImagePath ? { art: url(s.backgroundImagePath) } : {}),
    };
  }
  const keep = new Set<number>();
  for (const [h, p] of Object.entries(passes)) {
    out.passes[h] = { name: p.displayProperties?.name ?? '', icon: url(p.displayProperties?.icon), reward: p.rewardProgressionHash, ...(p.prestigeProgressionHash ? { prestige: p.prestigeProgressionHash } : {}) };
    keep.add(p.rewardProgressionHash);
    if (p.prestigeProgressionHash) keep.add(p.prestigeProgressionHash);
  }
  const ladders = Object.entries(progressions).filter(([, p]) => isRankLadder(p) || Number(p.hash) === 3696598664).map(([h]) => Number(h));
  out.ranks = [...RANK_ORDER.filter((h) => ladders.includes(h)), ...ladders.filter((h) => !RANK_ORDER.includes(h))];
  for (const h of out.ranks) keep.add(h);
  for (const h of keep) {
    const p = progressions[h];
    if (!p) continue;
    out.progressions[h] = {
      name: p.displayProperties?.name ?? '', icon: url(p.rankIcon?.foregroundImagePath ?? p.displayProperties?.icon),
      steps: (p.steps ?? []).map((st: any) => ({ name: st.stepName ?? '', total: st.progressTotal ?? 0, ...(st.icon ? { icon: url(st.icon) } : {}) })),
    };
  }
  for (const [h, a] of Object.entries(artifacts)) out.artifacts[h] = { name: a.displayProperties?.name ?? '', icon: url(a.displayProperties?.icon) };
  return out;
}

/** Item hash to its collection source text, without the "Source: " prefix. Empty sources are left out. */
export function slimSources(full: Record<string, { itemHash?: number; sourceString?: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of Object.values(full)) {
    const text = c.sourceString?.replace(/^Source:\s*/i, '').trim();
    if (c.itemHash && text) out[c.itemHash] = text;
  }
  return out;
}

/** An armor set (Armor 3.0): its name and the bonus perks wearing enough of it turns on. */
export interface ArmorSet {
  name: string;
  icon?: string;
  perks: { count: number; name: string; description?: string; icon?: string }[];
}

/** Joins armor sets to their perk names, keeping only what the summary shows. */
export function slimItemSets(
  sets: Record<string, DestinyEquipableItemSetDefinition>, perks: Record<string, Pick<DestinySandboxPerkDefinition, 'displayProperties'>>,
): Record<string, ArmorSet> {
  const url = (p?: string) => (p ? `https://www.bungie.net${p}` : undefined);
  const out: Record<string, ArmorSet> = {};
  for (const [h, s] of Object.entries(sets)) {
    const list = (s.setPerks ?? []).map((sp) => {
      const d = perks[sp.sandboxPerkHash]?.displayProperties;
      return { count: sp.requiredSetCount, name: d?.name || `${sp.requiredSetCount}-piece bonus`, description: d?.description || undefined, icon: url(d?.icon) };
    }).sort((a, b) => a.count - b.count);
    if (!s.displayProperties?.name || list.length === 0) continue;
    out[h] = { name: s.displayProperties.name, icon: url(s.displayProperties.icon), perks: list };
  }
  return out;
}

/** The choices the game offers for naming and decorating an in-game loadout. */
export interface LoadoutStyles {
  names: { hash: number; name: string }[];
  colors: { hash: number; image: string }[];
  icons: { hash: number; image: string }[];
  /** Most slots a character can have (Guardian Rank unlocks them; the profile lists the ones you have). */
  perCharacter: number;
}

/** Joins the four small loadout tables into one, in the order the constants list them. */
export function slimLoadoutStyles(
  constants: Record<string, DestinyLoadoutConstantsDefinition>,
  names: Record<string, DestinyLoadoutNameDefinition>,
  colors: Record<string, DestinyLoadoutColorDefinition>,
  icons: Record<string, DestinyLoadoutIconDefinition>,
): LoadoutStyles {
  const c = Object.values(constants)[0];
  const order = <T>(hashes: number[] | undefined, table: Record<string, T>) =>
    (hashes?.length ? hashes : Object.keys(table).map(Number)).map((h) => [h, table[h]] as const).filter((x): x is readonly [number, T] => !!x[1]);
  return {
    names: order(c?.loadoutNameHashes, names).map(([hash, d]) => ({ hash, name: (d as DestinyLoadoutNameDefinition).name })),
    colors: order(c?.loadoutColorHashes, colors).map(([hash, d]) => ({ hash, image: `https://www.bungie.net${(d as DestinyLoadoutColorDefinition).colorImagePath}` })),
    icons: order(c?.loadoutIconHashes, icons).map(([hash, d]) => ({ hash, image: `https://www.bungie.net${(d as DestinyLoadoutIconDefinition).iconImagePath}` })),
    perCharacter: c?.loadoutCountPerCharacter ?? 10,
  };
}

/** The parts of the full item definition the app needs (the full table is hundreds of MB). */
export interface ItemExtra {
  statGroupHash?: number;
  /** e.g. "frames", "barrels", "v400.plugs.weapons.masterworks.stat.stability". */
  plugCategory?: string;
  /** Always-on stat bonuses this item gives when plugged in: [statHash, value]. */
  investment?: [number, number][];
  /** Socket category hash and the socket indexes in it. */
  socketCategories?: [number, number[]][];
  flavorText?: string;
  /** Gear: its DestinyLoreDefinition, read on demand for the item dialog's Lore tab. */
  loreHash?: number;
  /** Built-in champion stun (exotics and some legendaries). */
  breakerTypeHash?: number;
  /** Weapons: 1 Primary, 2 Special, 3 Heavy. */
  ammoType?: number;
  /** Weapons: the definition's stats before any perks, [statHash, value]. */
  baseStats?: [number, number][];
  /** Weapons: per socket, [plug set hash (0 if none), the plug it starts with]. */
  socketEntries?: [number, number][];
  /** Armor: the set it belongs to, for set bonuses. */
  itemSetHash?: number;
  /** Weapons, armor, and their ornaments: Bungie's 1920×1080 studio render, as a bungie.net path. */
  screenshot?: string;
  /**
   * Subclass parts whose own description is blank (most aspects and fragments): the text from
   * their sandbox perks, which is where the game keeps it.
   */
  description?: string;
  /** Working field while loading: the perks `description` is read from. Removed before saving. */
  perkHashes?: number[];
  /** Armor: its ornament socket as [socket index, plug set hash (0 if none), default plug]. Weapons
   *  keep every socket in `socketEntries`; armor keeps only this one, to stay small. */
  ornamentSocket?: [number, number, number];
}

export interface ObjectiveExtra {
  /** DestinyObjectiveUiStyle: 2 = crafted weapon level. */
  uiStyle: number;
  progressDescription?: string;
}

const SUBCLASS_PART = /^(?:titan|hunter|warlock|shared)\.\w+\.(?:supers|grenades|melee|class_abilities|movement|aspects|fragments)$/;

/** Moves perk text onto subclass parts that have none of their own, and drops the working field. */
export function fillPartDescriptions(extras: Record<string, ItemExtra>, perks: Record<string, { displayProperties: { description?: string } }>) {
  for (const x of Object.values(extras)) {
    if (!x.perkHashes) continue;
    const text = [...new Set(x.perkHashes.map((h) => perks[h]?.displayProperties.description?.trim()).filter(Boolean))].join('\n\n');
    if (text) x.description = text;
    delete x.perkHashes;
  }
  return extras;
}

/** Keeps only what ItemExtra needs, for gear and for plugs. */
export function slimItems(full: Record<string, DestinyInventoryItemDefinition>): Record<string, ItemExtra> {
  const out: Record<string, ItemExtra> = {};
  for (const [hash, d] of Object.entries(full)) {
    const gear = d.itemType === 2 || d.itemType === 3;
    if (!gear && !d.plug) continue;
    const x: ItemExtra = {};
    if (gear) {
      if (d.stats?.statGroupHash) x.statGroupHash = d.stats.statGroupHash;
      const cats = d.sockets?.socketCategories;
      if (cats?.length) x.socketCategories = cats.map((c) => [c.socketCategoryHash, c.socketIndexes]);
      if (d.flavorText) x.flavorText = d.flavorText;
      if (d.loreHash) x.loreHash = d.loreHash;
      if (d.breakerTypeHash) x.breakerTypeHash = d.breakerTypeHash;
      if (d.equippingBlock?.equipableItemSetHash) x.itemSetHash = d.equippingBlock.equipableItemSetHash;
      if (d.itemType === 2) {
        if (d.screenshot) x.screenshot = d.screenshot;
        const entries = d.sockets?.socketEntries ?? [];
        const at = entries.findIndex((e) => /skins/.test(full[e.singleInitialItemHash ?? 0]?.plug?.plugCategoryIdentifier ?? ''));
        if (at >= 0) {
          const e = entries[at]!;
          x.ornamentSocket = [at, e.reusablePlugSetHash ?? e.randomizedPlugSetHash ?? 0, e.singleInitialItemHash ?? 0];
        }
      }
      if (d.itemType === 3) {
        if (d.equippingBlock?.ammoType) x.ammoType = d.equippingBlock.ammoType;
        if (d.screenshot) x.screenshot = d.screenshot;
        const base = Object.values(d.stats?.stats ?? {}).filter((st) => st.value !== 0);
        if (base.length) x.baseStats = base.map((st) => [st.statHash, st.value]);
        const entries = d.sockets?.socketEntries ?? [];
        if (entries.length) {
          x.socketEntries = entries.map((e) => [e.randomizedPlugSetHash ?? e.reusablePlugSetHash ?? 0, e.singleInitialItemHash ?? 0]);
        }
      }
    }
    if (d.plug?.plugCategoryIdentifier) x.plugCategory = d.plug.plugCategoryIdentifier;
    if (SUBCLASS_PART.test(x.plugCategory ?? '') && !d.displayProperties?.description) {
      const perks = (d.perks ?? []).filter((p) => p.perkVisibility === 0).map((p) => p.perkHash);
      if (perks.length) x.perkHashes = perks;
    }
    // Ornaments carry their own render, shown in the item dialog's header and strip.
    if (d.screenshot && /skins/.test(x.plugCategory ?? '')) x.screenshot = d.screenshot;
    const inv = (d.investmentStats ?? []).filter((st) => !st.isConditionallyActive && st.value !== 0);
    if (inv.length) x.investment = inv.map((st) => [st.statTypeHash, st.value]);
    if (Object.keys(x).length) out[hash] = x;
  }
  return out;
}

const TABLES = {
  items: 'DestinyInventoryItemLiteDefinition',
  buckets: 'DestinyInventoryBucketDefinition',
  stats: 'DestinyStatDefinition',
  damageTypes: 'DestinyDamageTypeDefinition',
  statGroups: 'DestinyStatGroupDefinition',
  objectives: 'DestinyObjectiveDefinition',
  fullItems: 'DestinyInventoryItemDefinition',
  breakerTypes: 'DestinyBreakerTypeDefinition',
  plugSets: 'DestinyPlugSetDefinition',
  loadoutConstants: 'DestinyLoadoutConstantsDefinition',
  loadoutNames: 'DestinyLoadoutNameDefinition',
  loadoutColors: 'DestinyLoadoutColorDefinition',
  loadoutIcons: 'DestinyLoadoutIconDefinition',
  itemSets: 'DestinyEquipableItemSetDefinition',
  sandboxPerks: 'DestinySandboxPerkDefinition',
  collectibles: 'DestinyCollectibleDefinition',
  seasons: 'DestinySeasonDefinition',
  seasonPasses: 'DestinySeasonPassDefinition',
  progressions: 'DestinyProgressionDefinition',
  artifacts: 'DestinyArtifactDefinition',
  guardianRanks: 'DestinyGuardianRankDefinition',
  commendationNodes: 'DestinySocialCommendationNodeDefinition',
  modes: 'DestinyActivityModeDefinition',
} as const;

/** Bump when a slim table keeps new fields, so cached slim files are rebuilt. */
const SLIM_VERSION = 10;

/**
 * Opens the live manifest: its version, and a loader that downloads a table once and keeps it on
 * disk per version (trimmed first when `slim` is given, so only the small file is kept).
 */
async function openManifest(http: HttpClient, cacheDir: string, lang: string) {
  const { Response: m } = await getDestinyManifest(http);
  const dir = join(cacheDir, m.version.replace(/[^\w.-]/g, '_'));
  await mkdir(dir, { recursive: true });
  const paths = m.jsonWorldComponentContentPaths[lang];
  if (!paths) throw new Error(`Manifest has no "${lang}" language`);

  const download = async (table: string) => {
    const path = paths[table];
    if (!path) throw new Error(`Manifest has no ${table} table`);
    const res = await fetch(BUNGIE_ROOT + path);
    if (!res.ok) throw new Error(`Manifest download failed for ${table}: ${res.status}`);
    return res.text();
  };
  /** `tag` names a second slim cut of the same table (sandbox perks are cut once for sets, once for subclass parts). */
  const load = async <T>(table: string, slim?: (full: any) => T, tag?: string): Promise<T> => {
    const file = join(dir, `${table}${tag ? `.${tag}` : ''}${slim ? `.slim${SLIM_VERSION}` : ''}.json`);
    try {
      return JSON.parse(await readFile(file, 'utf8'));
    } catch {
      const text = await download(table);
      if (!slim) {
        await writeFile(file, text);
        return JSON.parse(text);
      }
      const trimmed = slim(JSON.parse(text));
      await writeFile(file, JSON.stringify(trimmed));
      return trimmed;
    }
  };
  return { m, load };
}

/**
 * Returns the manifest tables, or undefined when `currentVersion` is already the
 * live version (so a caller holding the tables in memory can skip re-parsing).
 */
export async function loadManifest(http: HttpClient, cacheDir: string, lang?: string): Promise<ManifestTables>;
export async function loadManifest(
  http: HttpClient, cacheDir: string, lang: string, currentVersion: string | undefined,
): Promise<ManifestTables | undefined>;
export async function loadManifest(
  http: HttpClient, cacheDir: string, lang = 'en', currentVersion?: string,
): Promise<ManifestTables | undefined> {
  const { m, load } = await openManifest(http, cacheDir, lang);
  if (currentVersion && currentVersion === m.version) return undefined;

  const [items, buckets, stats, damageTypes, statGroups, objectives, breakerTypes, plugSets] = await Promise.all([
    load<ManifestTables['items']>(TABLES.items),
    load<ManifestTables['buckets']>(TABLES.buckets),
    load<ManifestTables['stats']>(TABLES.stats),
    load<NonNullable<ManifestTables['damageTypes']>>(TABLES.damageTypes),
    load(TABLES.statGroups, (full: Record<string, DestinyStatGroupDefinition>) =>
      Object.fromEntries(Object.entries(full).map(([h, g]) => [h, { scaledStats: g.scaledStats }]))),
    load(TABLES.objectives, (full: Record<string, DestinyObjectiveDefinition>) =>
      Object.fromEntries(Object.entries(full).map(([h, o]) => [h, { uiStyle: o.uiStyle, progressDescription: o.progressDescription }]))),
    load(TABLES.breakerTypes, (full: Record<string, DestinyBreakerTypeDefinition>) =>
      Object.fromEntries(Object.entries(full).map(([h, b]) => [h, { displayProperties: b.displayProperties }]))),
    // Plugs that can currently drop; retired ones (currentlyCanRoll false) are left out.
    load(TABLES.plugSets, (full: Record<string, DestinyPlugSetDefinition>) =>
      Object.fromEntries(Object.entries(full).map(([h, ps]) => [h, ps.reusablePlugItems.filter((p) => p.currentlyCanRoll).map((p) => p.plugItemHash)]))),
  ]);
  // Loadout names, colors, and icons: four tiny tables. Cosmetic, so a missing one never blocks the app.
  const loadoutStyles = await Promise.all([
    load(TABLES.loadoutConstants), load(TABLES.loadoutNames), load(TABLES.loadoutColors), load(TABLES.loadoutIcons),
  ]).then(([c, n, col, i]) => slimLoadoutStyles(c as never, n as never, col as never, i as never)).catch(() => undefined);
  // Armor sets name their perks by sandbox perk; that table is big, so keep only what sets use.
  const itemSets = await load(TABLES.itemSets, (full: Record<string, DestinyEquipableItemSetDefinition>) => full)
    .then(async (sets) => {
      const used = new Set(Object.values(sets).flatMap((x) => x.setPerks?.map((p) => String(p.sandboxPerkHash)) ?? []));
      const perks = await load(TABLES.sandboxPerks, (full: Record<string, DestinySandboxPerkDefinition>) =>
        Object.fromEntries(Object.entries(full).filter(([h]) => used.has(h)).map(([h, p]) => [h, { displayProperties: p.displayProperties }])));
      return slimItemSets(sets, perks);
    }).catch(() => undefined);
  // Where weapons drop, for farming targets. A nice-to-have, so a missing table never blocks the app.
  const sources = await load(TABLES.collectibles, slimSources).catch(() => undefined);
  // The season tracker's tables: small, cosmetic, so a missing one never blocks the app.
  // Kept as downloaded (about 1 MB together) and joined in memory.
  const season = await Promise.all([
    load<Record<string, any>>(TABLES.seasons), load<Record<string, any>>(TABLES.seasonPasses),
    load<Record<string, any>>(TABLES.progressions), load<Record<string, any>>(TABLES.artifacts),
  ]).then(([a, b, c, d]) => slimSeason(a, b, c, d)).catch(() => undefined);
  // Guardian Rank and commendation colors: two tiny tables, cosmetic, never blocking.
  const identity = await Promise.all([
    load<Record<string, any>>(TABLES.guardianRanks), load<Record<string, any>>(TABLES.commendationNodes),
  ]).then(([r, n]) => slimIdentity(r, n)).catch(() => undefined);
  // Activity mode glyphs and banners: one small table, cosmetic, never blocking.
  const modes = await load(TABLES.modes, slimModes).catch(() => undefined);
  // The full item table is huge; load it after the others so peak memory stays lower.
  const extras = await load(TABLES.fullItems, slimItems);
  // Aspects and fragments describe themselves through sandbox perks; keep only those perks' text.
  const wanted = new Set(Object.values(extras).flatMap((x) => x.perkHashes ?? []).map(String));
  await load(TABLES.sandboxPerks, (full: Record<string, DestinySandboxPerkDefinition>) =>
    Object.fromEntries(Object.entries(full).filter(([h]) => wanted.has(h)).map(([h, p]) => [h, { displayProperties: p.displayProperties }])), 'parts')
    .then((perks) => fillPartDescriptions(extras, perks))
    .catch(() => fillPartDescriptions(extras, {}));
  return { version: m.version, items, buckets, stats, damageTypes, statGroups, objectives, breakerTypes, plugSets, extras, loadoutStyles, itemSets, sources, season, identity, modes };
}

/**
 * The Records screen's tables: record and presentation node definitions, trimmed, plus the
 * global constants for the legacy roots. Loaded on first use, not at start up (they're large).
 */
export async function loadRecordTables(http: HttpClient, cacheDir: string, lang = 'en'): Promise<RecordTables> {
  const { m, load } = await openManifest(http, cacheDir, lang);
  const [records, nodes, constants] = await Promise.all([
    load('DestinyRecordDefinition', slimRecords),
    load('DestinyPresentationNodeDefinition', slimNodes),
    // Tiny; without it only the legacy sections go missing.
    load<Record<string, any>>('DestinyGlobalConstantsDefinition').catch(() => undefined),
  ]);
  return { version: m.version, roots: recordRoots(constants), records, nodes };
}
