// Popular builds learned from the community crawl. For each player in a sampled match, the crawler
// already reads their equipped gear; this keeps what their armor says about the build: class, the
// exotic armor piece, any armor set worn as a set (2+ pieces), the subclass, and the character's
// stat totals. Rolled up over 30 days, the most worn exotics per class and activity become build
// suggestions the Builds sheet can add to your list. Pure logic; the crawler lives in the server.
import type { DestinyPostGameCarnageReportData, DestinyProfileResponse } from 'bungie-api-ts/destiny2';
import type { ManifestTables } from './manifest.ts';
import { classifyMode, type Role } from './community.ts';
import { ARMOR_STATS, type ArmorStat } from './optimizer.ts';
import type { BuildActivity, PopularBuild } from './builds.ts';

const ARMOR = 2;
const SUBCLASS_BUCKET = 3284755031;

/** One character's armor in one match. Hashes only: no names; the character id only dedupes. */
export interface ArmorSample {
  match: string;
  at: string;
  role: Role;
  /** Counts each character once per role, like weapon copies. */
  character: string;
  classType: number;
  /** The exotic armor piece worn, if any. */
  exotic?: number;
  /** Armor sets with 2 or more pieces worn (a set bonus is on). */
  sets?: number[];
  subclass?: number;
  /** Character stat totals, in ARMOR_STATS order (Weapons, Health, Class, Grenade, Super, Melee). */
  stats?: number[];
}

/** Where a role's builds count, in the Builds sheet's terms. */
export const ROLE_ACTIVITY: Record<Role, BuildActivity> = {
  'pve-endgame': 'endgame', 'pvp-endgame': 'pvp', pvp: 'pvp', pve: 'casual', patrol: 'casual', gambit: 'casual',
};

/**
 * Armor samples from one match report plus the players' profiles. Profiles need components 200
 * (characters, for stats and class) and 205 (equipment); without 200 the stats are left out.
 */
export function extractArmorSamples(
  manifest: Pick<ManifestTables, 'items' | 'extras' | 'stats'>,
  pgcr: DestinyPostGameCarnageReportData,
  profiles: Record<string, DestinyProfileResponse | undefined>,
): ArmorSample[] {
  const role = classifyMode(pgcr.activityDetails.mode, pgcr.activityDetails.modes);
  if (!role) return [];
  const statOrder = ARMOR_STATS.map((name) => Object.entries(manifest.stats).find(([, s]) => s.displayProperties.name === name)?.[0]);
  const out: ArmorSample[] = [];
  const done = new Set<string>();
  for (const e of pgcr.entries) {
    if (done.has(e.characterId)) continue;
    const profile = profiles[e.player.destinyUserInfo.membershipId];
    const gear = profile?.characterEquipment?.data?.[e.characterId]?.items;
    if (!gear?.length) continue;
    done.add(e.characterId);
    const ch = profile?.characters?.data?.[e.characterId];
    const s: ArmorSample = { match: pgcr.activityDetails.instanceId, at: pgcr.period, role, character: e.characterId, classType: ch?.classType ?? classOf(e) };
    const setCount = new Map<number, number>();
    for (const i of gear) {
      const d = manifest.items[i.itemHash];
      if (i.bucketHash === SUBCLASS_BUCKET) { s.subclass = i.itemHash; continue; }
      if (d?.itemType !== ARMOR) continue;
      if (d.inventory?.tierTypeName === 'Exotic') s.exotic = i.itemHash;
      const set = manifest.extras?.[i.itemHash]?.itemSetHash;
      if (set) setCount.set(set, (setCount.get(set) ?? 0) + 1);
    }
    const sets = [...setCount].filter(([, n]) => n >= 2).map(([h]) => h);
    if (sets.length) s.sets = sets;
    if (ch?.stats && statOrder.every(Boolean)) s.stats = statOrder.map((h) => ch.stats[Number(h)] ?? 0);
    if (s.classType > 2) continue;
    out.push(s);
  }
  return out;
}

/** Without the characters component, the match report's class name will do. */
const classOf = (e: { player: { characterClass?: string } }) =>
  ({ Titan: 0, Hunter: 1, Warlock: 2 } as Record<string, number>)[e.player.characterClass ?? ''] ?? 3;

export interface BuildUsage {
  classType: number;
  activity: BuildActivity;
  exotic: number;
  name: string;
  /** Characters seen wearing it in this activity. */
  players: number;
  /** Of all characters of this class seen in this activity. */
  share: number;
  /** The set most worn alongside it, when at least a quarter of them wear one. */
  set?: string;
  /** The three stats its wearers push highest, most first. */
  stats: ArmorStat[];
  /** The subclass most worn with it (e.g. "Nightstalker"). */
  subclass?: string;
}

export interface BuildUsageRollup {
  builtAt: string;
  samples: number;
  /** Per class and activity, most worn first. */
  usage: BuildUsage[];
}

/** Fewer wearers than this and an exotic isn't called popular. */
export const MIN_BUILD_PLAYERS = 5;

/** Most worn exotics per class and activity, each with its usual set, stats, and subclass. */
export function buildUsage(manifest: Pick<ManifestTables, 'items' | 'itemSets'>, samples: ArmorSample[], now = new Date()): BuildUsageRollup {
  // One vote per character, role, and exotic: the same player seen in many matches counts once.
  const seen = new Set<string>();
  const groups = new Map<string, ArmorSample[]>();
  const totals = new Map<string, Set<string>>();
  for (const s of samples) {
    const activity = ROLE_ACTIVITY[s.role];
    const key = `${s.classType}|${activity}`;
    const who = totals.get(key) ?? new Set<string>();
    who.add(s.character);
    totals.set(key, who);
    if (!s.exotic) continue;
    const id = `${key}|${s.exotic}|${s.character}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const g = `${key}|${s.exotic}`;
    groups.set(g, [...(groups.get(g) ?? []), s]);
  }
  const usage: BuildUsage[] = [];
  for (const [g, list] of groups) {
    const [cls, activity, exotic] = g.split('|');
    const name = manifest.items[Number(exotic)]?.displayProperties.name;
    if (!name) continue;
    const total = totals.get(`${cls}|${activity}`)?.size ?? list.length;
    // Stats: average totals, top three.
    const withStats = list.filter((s) => s.stats?.length === ARMOR_STATS.length);
    const avg = ARMOR_STATS.map((_, i) => withStats.reduce((n, s) => n + s.stats![i]!, 0) / (withStats.length || 1));
    const stats = withStats.length
      ? ARMOR_STATS.map((s, i) => [s, avg[i]!] as const).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s]) => s)
      : [];
    const top = <T,>(vals: T[]) => {
      const c = new Map<T, number>();
      for (const v of vals) c.set(v, (c.get(v) ?? 0) + 1);
      return [...c].sort((a, b) => b[1] - a[1])[0];
    };
    const set = top(list.flatMap((s) => s.sets ?? []));
    const sub = top(list.map((s) => s.subclass).filter((x): x is number => !!x));
    usage.push({
      classType: Number(cls), activity: activity as BuildActivity, exotic: Number(exotic), name,
      players: list.length, share: list.length / total, stats,
      ...(set && set[1] >= list.length / 4 && manifest.itemSets?.[set[0]] ? { set: manifest.itemSets[set[0]]!.name } : {}),
      ...(sub ? { subclass: manifest.items[sub[0]]?.displayProperties.name } : {}),
    });
  }
  usage.sort((a, b) => a.classType - b.classType || a.activity.localeCompare(b.activity) || b.players - a.players);
  return { builtAt: now.toISOString(), samples: samples.length, usage };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export interface BuildSuggestion {
  build: PopularBuild;
  /** e.g. "Worn by 18% of Hunters in endgame". */
  why: string;
  players: number;
  share: number;
}

/**
 * The most worn exotics per class and activity as builds, skipping exotics your list already has.
 * The same exotic popular in several activities becomes one build with all of them.
 */
export function suggestBuilds(rollup: BuildUsageRollup | undefined, existing: PopularBuild[], perGroup = 3): BuildSuggestion[] {
  if (!rollup) return [];
  const have = new Set(existing.filter((b) => b.exotic).map((b) => `${b.classType}|${norm(b.exotic!)}`));
  const picked = new Map<string, BuildSuggestion & { activities: Set<BuildActivity> }>();
  const counts = new Map<string, number>();
  for (const u of rollup.usage) {
    if (u.players < MIN_BUILD_PLAYERS || u.stats.length < 3) continue;
    const g = `${u.classType}|${u.activity}`;
    if ((counts.get(g) ?? 0) >= perGroup) continue;
    counts.set(g, (counts.get(g) ?? 0) + 1);
    const k = `${u.classType}|${norm(u.name)}`;
    if (have.has(k)) continue;
    const prev = picked.get(k);
    if (prev) {
      prev.activities.add(u.activity);
      if (u.players > prev.players) Object.assign(prev, { players: u.players, share: u.share, why: whyText(u) });
      continue;
    }
    picked.set(k, {
      activities: new Set([u.activity]), players: u.players, share: u.share, why: whyText(u),
      build: {
        id: `community-${u.classType}-${u.exotic}`, name: u.subclass ? `${u.name} ${u.subclass}` : u.name,
        classType: u.classType, activities: [], exotic: u.name, ...(u.set ? { set: u.set } : {}), stats: u.stats, source: 'community',
      },
    });
  }
  return [...picked.values()]
    .map(({ activities, ...s }) => ({ ...s, build: { ...s.build, activities: ['endgame', 'pvp', 'casual'].filter((a) => activities.has(a as BuildActivity)) as BuildActivity[] } }))
    .sort((a, b) => a.build.classType - b.build.classType || b.players - a.players);
}

const CLASS_PLURAL = ['Titans', 'Hunters', 'Warlocks'];
const ACTIVITY_WORDS: Record<BuildActivity, string> = { endgame: 'endgame', pvp: 'PvP', casual: 'casual play' };
const whyText = (u: BuildUsage) => `Worn by ${Math.round(u.share * 100)}% of ${CLASS_PLURAL[u.classType]} in ${ACTIVITY_WORDS[u.activity]} (${u.players} seen)`;
