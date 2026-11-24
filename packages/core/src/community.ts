// Community weapon data built only from Bungie's public API: which legendary and exotic weapons
// people use in each kind of activity, and which perks, masterworks, and mods those copies carry.
//
// How a sample is made: a match report (PGCR) says who played and which weapons got kills, but
// not the weapons' perks. A profile lookup right after shows each player's *equipped* weapons
// with their perks. When a weapon that got kills in the match is still equipped, we record that
// copy's roll against the match's activity. Pure logic only; the crawler lives in the server.
import type { DestinyPostGameCarnageReportData, DestinyProfileResponse } from 'bungie-api-ts/destiny2';
import type { ManifestTables } from './manifest.ts';

const SOCKET_WEAPON_PERKS = 4241085061;
const TIER_LEGENDARY = 5;

/** Where a weapon is used. "Endgame" splits out the activities people tune rolls for. */
export type Role = 'pvp-endgame' | 'pvp' | 'pve-endgame' | 'pve' | 'patrol' | 'gambit';
export const ROLES: Role[] = ['pve-endgame', 'pve', 'patrol', 'pvp-endgame', 'pvp', 'gambit'];

// DestinyActivityModeType numbers (a const enum in bungie-api-ts, so written as literals).
const M = {
  Story: 2, Strike: 3, Raid: 4, AllPvP: 5, Patrol: 6, AllPvE: 7, Nightfall: 16, HeroicNightfall: 17,
  IronBanner: 19, ScoredNightfall: 46, ScoredHeroicNightfall: 47, Gambit: 63, AllPvECompetitive: 64,
  GambitPrime: 75, PvPCompetitive: 69, Dungeon: 82, TrialsOfOsiris: 84, Offensive: 86, LostSector: 87,
  PrivateMatchesAll: 32,
} as const;

/** Sorts a match into a role from its mode list, or undefined for private matches and social spaces. */
export function classifyMode(mode: number, modes: readonly number[] = []): Role | undefined {
  const all = new Set([mode, ...modes]);
  if (all.has(M.PrivateMatchesAll)) return undefined;
  if (all.has(M.Gambit) || all.has(M.GambitPrime) || all.has(M.AllPvECompetitive)) return 'gambit';
  if (all.has(M.TrialsOfOsiris) || all.has(M.PvPCompetitive)) return 'pvp-endgame';
  if (all.has(M.AllPvP) || all.has(M.IronBanner)) return 'pvp';
  if (all.has(M.Raid) || all.has(M.Dungeon) || all.has(M.ScoredNightfall) || all.has(M.ScoredHeroicNightfall)) {
    return 'pve-endgame';
  }
  if (all.has(M.Patrol)) return 'patrol';
  if (all.has(M.AllPvE) || all.has(M.Strike) || all.has(M.Story) || all.has(M.Nightfall) || all.has(M.HeroicNightfall)
    || all.has(M.Offensive) || all.has(M.LostSector)) return 'pve';
  return undefined;
}

/** One weapon copy seen in use. Only hashes: no player names or ids are kept. */
export interface Sample {
  /** The match's instance id, so a re-crawl never double counts. */
  match: string;
  /** When the match started (ISO). */
  at: string;
  role: Role;
  itemHash: number;
  /** The copy's instance id, used only to count each copy once per role. */
  copy: string;
  /** Plug hash per perk column, in socket order (barrel, magazine, trait, trait, origin...). */
  perks: number[];
  masterwork?: number;
  mod?: number;
  kills: number;
  precisionKills: number;
  /** PvP: the player's kills/deaths ratio that match. */
  kd?: number;
  /** PvP: the player's team won. PvE: the player finished the activity. */
  won?: boolean;
}

const val = (v: Record<string, { basic: { value: number } }> | undefined, k: string) => v?.[k]?.basic.value;

/** Perk socket indexes for a weapon, from its definition. */
function perkSockets(manifest: ManifestTables, itemHash: number): number[] {
  return manifest.extras?.[itemHash]?.socketCategories?.find(([c]) => c === SOCKET_WEAPON_PERKS)?.[1] ?? [];
}

const plugCat = (manifest: ManifestTables, hash: number) => manifest.extras?.[hash]?.plugCategory ?? '';
const isMasterwork = (cat: string) => /masterworks?\.stat|\.masterwork/.test(cat);
const isWeaponMod = (cat: string) => /weapon\.mod_/.test(cat) && !/mod_empty/.test(cat);

/**
 * Samples from one match report plus the players' profiles (keyed by membership id). Profiles
 * need components 100, 205 (equipment), and 305 (sockets). Weapons below legendary are skipped.
 */
export function extractSamples(
  manifest: ManifestTables,
  pgcr: DestinyPostGameCarnageReportData,
  profiles: Record<string, DestinyProfileResponse | undefined>,
): Sample[] {
  const role = classifyMode(pgcr.activityDetails.mode, pgcr.activityDetails.modes);
  if (!role) return [];
  const match = pgcr.activityDetails.instanceId;
  const out: Sample[] = [];
  for (const e of pgcr.entries) {
    const profile = profiles[e.player.destinyUserInfo.membershipId];
    const equipped = profile?.characterEquipment?.data?.[e.characterId]?.items ?? [];
    const sockets = profile?.itemComponents?.sockets?.data ?? {};
    const pvp = role.startsWith('pvp');
    const won = pvp ? e.standing === 0 : val(e.values, 'completed') === 1;
    for (const w of e.extended?.weapons ?? []) {
      const def = manifest.items[w.referenceId];
      if ((def?.inventory?.tierType ?? 0) < TIER_LEGENDARY) continue;
      const copy = equipped.find((i) => i.itemHash === w.referenceId && i.itemInstanceId);
      const plugs = copy && sockets[copy.itemInstanceId!]?.sockets;
      if (!copy || !plugs) continue; // swapped out since the match, or the profile hides sockets
      const perks = perkSockets(manifest, w.referenceId).map((i) => plugs[i]?.plugHash ?? 0);
      if (!perks.length || perks.every((p) => !p)) continue;
      const s: Sample = {
        match, at: pgcr.period, role, itemHash: w.referenceId, copy: copy.itemInstanceId!, perks,
        kills: val(w.values, 'uniqueWeaponKills') ?? 0,
        precisionKills: val(w.values, 'uniqueWeaponPrecisionKills') ?? 0,
        won,
      };
      for (const p of plugs) {
        if (!p.plugHash) continue;
        const cat = plugCat(manifest, p.plugHash);
        if (isMasterwork(cat)) s.masterwork = p.plugHash;
        else if (isWeaponMod(cat)) s.mod = p.plugHash;
      }
      if (pvp) {
        const kd = val(e.values, 'killsDeathsRatio');
        if (kd !== undefined) s.kd = kd;
      }
      out.push(s);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Rollup: samples to per-weapon usage, by role.

export interface PerkUsage {
  /** The base (non-enhanced) perk's plug hash; enhanced copies count toward it. */
  hash: number;
  copies: number;
  /** Share of copies in this column that run it, 0 to 1. */
  share: number;
  /** The share it would have by pure luck: 1 / perks in the column. */
  chance: number;
  /** share / chance. Above 1 means people keep or pick it more than luck would give them. */
  lift: number;
}

export interface ComboUsage { hashes: [number, number]; copies: number; share: number }
export interface ShareOf { hash: number; copies: number; share: number }
export interface StatLean {
  statHash: number;
  /** Average stat points the chosen barrel, magazine, and masterwork add, minus the column average. */
  delta: number;
}

export interface RoleUsage {
  role: Role;
  /** Unique copies seen. */
  copies: number;
  kills: number;
  /** This weapon's share of all sampled legendary/exotic copies in this role, 0 to 1. */
  shareOfRole: number;
  /** One list per perk column, most used first. */
  columns: PerkUsage[][];
  /** Trait pairs (the two "frames" columns), most used first, top 10. */
  combos: ComboUsage[];
  masterworks: ShareOf[];
  mods: ShareOf[];
  /** Stats people chase with barrel, magazine, and masterwork picks, biggest lean first. */
  statLean: StatLean[];
}

export interface WeaponCommunity {
  itemHash: number;
  /** Where this weapon is used most relative to other weapons, by shareOfRole. */
  bestRole?: Role;
  roles: RoleUsage[];
}

export interface CommunityRollup {
  builtAt: string;
  /** First and last match time included. */
  from?: string;
  to?: string;
  samples: number;
  weapons: Record<string, WeaponCommunity>;
}

/** Maps an enhanced perk to its base perk (same name without "Enhanced"), within one column's pool. */
function baseOf(manifest: ManifestTables, pool: number[]): (hash: number) => number {
  const byName = new Map<string, number>();
  const name = (h: number) => (manifest.items[h]?.displayProperties.name ?? String(h)).replace(/\s+Enhanced$/i, '');
  const enhanced = (h: number) => /enhanced/i.test(manifest.items[h]?.itemTypeDisplayName ?? '');
  for (const h of [...pool].sort((a, b) => Number(enhanced(a)) - Number(enhanced(b)))) {
    if (!byName.has(name(h))) byName.set(name(h), h);
  }
  return (h) => byName.get(name(h)) ?? h;
}

/** The perks each column can roll, from the weapon's plug sets. */
function columnPools(manifest: ManifestTables, itemHash: number): number[][] {
  const entries = manifest.extras?.[itemHash]?.socketEntries ?? [];
  return perkSockets(manifest, itemHash).map((i) => {
    const [set, initial] = entries[i] ?? [0, 0];
    const pool = set ? manifest.plugSets?.[set] ?? [] : [];
    return pool.length ? pool : initial ? [initial] : [];
  });
}

const sortShare = <T extends { copies: number }>(xs: T[]) => xs.sort((a, b) => b.copies - a.copies);

export function rollup(manifest: ManifestTables, samples: Sample[], now = new Date()): CommunityRollup {
  // One entry per copy per role: the latest sample wins for the roll, kills add up.
  const copies = new Map<string, Sample & { totalKills: number }>();
  let from: string | undefined, to: string | undefined;
  for (const s of samples) {
    if (!from || s.at < from) from = s.at;
    if (!to || s.at > to) to = s.at;
    const key = `${s.role}|${s.copy}`;
    const prev = copies.get(key);
    if (!prev) copies.set(key, { ...s, totalKills: s.kills });
    else {
      const kills = prev.totalKills + s.kills;
      copies.set(key, s.at >= prev.at ? { ...s, totalKills: kills } : { ...prev, totalKills: kills });
    }
  }

  const roleTotals = new Map<Role, number>();
  const byWeapon = new Map<number, Map<Role, (Sample & { totalKills: number })[]>>();
  for (const c of copies.values()) {
    roleTotals.set(c.role, (roleTotals.get(c.role) ?? 0) + 1);
    let roles = byWeapon.get(c.itemHash);
    if (!roles) byWeapon.set(c.itemHash, (roles = new Map()));
    const list = roles.get(c.role) ?? [];
    list.push(c);
    roles.set(c.role, list);
  }

  const weapons: Record<string, WeaponCommunity> = {};
  for (const [itemHash, roles] of byWeapon) {
    const pools = columnPools(manifest, itemHash);
    const bases = pools.map((p) => baseOf(manifest, p));
    const traitCols = pools.map((p, i) => (p.some((h) => plugCat(manifest, h) === 'frames') ? i : -1)).filter((i) => i >= 0);
    // Base pool size per column (enhanced folded in), for the luck baseline.
    const poolSizes = pools.map((p, i) => new Set(p.map(bases[i]!)).size || 1);
    const statCols = pools.map((p, i) => (p.some((h) => /barrels|magazines|tubes|scopes|blades|arrows|batteries|guards|stocks/.test(plugCat(manifest, h))) ? i : -1)).filter((i) => i >= 0);

    const out: RoleUsage[] = [];
    for (const [role, list] of roles) {
      const n = list.length;
      const columns = pools.map((_, ci) => {
        const counts = new Map<number, number>();
        for (const c of list) {
          const h = c.perks[ci];
          if (h) counts.set(bases[ci]!(h), (counts.get(bases[ci]!(h)) ?? 0) + 1);
        }
        const chance = 1 / poolSizes[ci]!;
        return sortShare([...counts].map(([hash, k]) => ({ hash, copies: k, share: k / n, chance, lift: k / n / chance })));
      });

      const combos: ComboUsage[] = [];
      const [ta, tb] = traitCols;
      if (ta !== undefined && tb !== undefined) {
        const counts = new Map<string, number>();
        for (const c of list) {
          const a = c.perks[ta], b = c.perks[tb];
          if (a && b) {
            const key = `${bases[ta]!(a)}:${bases[tb]!(b)}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }
        }
        for (const [key, k] of counts) {
          const [a, b] = key.split(':').map(Number) as [number, number];
          combos.push({ hashes: [a, b], copies: k, share: k / n });
        }
        sortShare(combos).splice(10);
      }

      const shareOf = (pick: (c: Sample) => number | undefined) => {
        const counts = new Map<number, number>();
        for (const c of list) { const h = pick(c); if (h) counts.set(h, (counts.get(h) ?? 0) + 1); }
        return sortShare([...counts].map(([hash, k]) => ({ hash, copies: k, share: k / n })));
      };

      out.push({
        role,
        copies: n,
        kills: list.reduce((t, c) => t + c.totalKills, 0),
        shareOfRole: n / (roleTotals.get(role) ?? n),
        columns,
        combos,
        masterworks: shareOf((c) => c.masterwork),
        mods: shareOf((c) => c.mod),
        statLean: statLean(manifest, list, pools, statCols),
      });
    }
    out.sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
    // "Best used in" = where it punches above its weight: its share of that role vs its average share.
    const avg = out.reduce((t, r) => t + r.shareOfRole, 0) / (out.length || 1);
    const best = [...out].filter((r) => r.copies >= 5).sort((a, b) => b.shareOfRole / avg - a.shareOfRole / avg)[0];
    weapons[itemHash] = { itemHash, ...(best ? { bestRole: best.role } : {}), roles: out };
  }

  return { builtAt: now.toISOString(), ...(from ? { from } : {}), ...(to ? { to } : {}), samples: samples.length, weapons };
}

/**
 * Which stats people chase: for barrel/magazine-style columns and the masterwork, the stat points
 * of what they run, minus what an average pick from the same column would give.
 */
function statLean(manifest: ManifestTables, list: Sample[], pools: number[][], statCols: number[]): StatLean[] {
  const inv = (h: number) => manifest.extras?.[h]?.investment ?? [];
  const totals = new Map<number, number>();
  const add = (stat: number, v: number) => totals.set(stat, (totals.get(stat) ?? 0) + v);
  for (const ci of statCols) {
    const pool = pools[ci]!;
    if (!pool.length) continue;
    // Column average per stat.
    const avg = new Map<number, number>();
    for (const h of pool) for (const [s, v] of inv(h)) avg.set(s, (avg.get(s) ?? 0) + v / pool.length);
    for (const c of list) {
      const h = c.perks[ci];
      if (!h) continue;
      for (const [s, v] of inv(h)) add(s, v);
      for (const [s, v] of avg) add(s, -v);
    }
  }
  for (const c of list) if (c.masterwork) for (const [s, v] of inv(c.masterwork)) add(s, v);
  return [...totals]
    .map(([statHash, t]) => ({ statHash, delta: Math.round((t / list.length) * 10) / 10 }))
    .filter((x) => x.delta !== 0 && manifest.stats[x.statHash]?.displayProperties.name)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}
