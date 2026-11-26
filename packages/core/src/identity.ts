// Guardian identity: the account's Guardian Rank and its commendation totals, for the profile card
// and the character headers. Pure logic over the saved profile and two tiny manifest tables.
import type { DestinyProfileResponse } from 'bungie-api-ts/destiny2';

export interface IdentityTables {
  /** Guardian Rank by rank number (1 New Light … 11 Paragon). */
  ranks: Record<string, { name: string; icon?: string }>;
  /** The four commendation groups (Ally, Fun, Mastery, Leadership) with the game's color for each. */
  commendationNodes: Record<string, { name: string; color: string }>;
}

export interface CommendationGroup { name: string; color: string; score: number; percent: number }

export interface GuardianIdentity {
  rank?: { number: number; name: string; icon?: string };
  /** Commendations received; absent when the profile hides them. */
  commendations?: { total: number; groups: CommendationGroup[] };
}

const url = (p?: string) => (p ? `https://www.bungie.net${p}` : undefined);
const hex = (c?: { red: number; green: number; blue: number }) =>
  c ? `#${[c.red, c.green, c.blue].map((n) => n.toString(16).padStart(2, '0')).join('')}` : '#888888';

/** Keeps names, icons, and colors from DestinyGuardianRankDefinition and DestinySocialCommendationNodeDefinition. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function slimIdentity(ranks: Record<string, any>, nodes: Record<string, any>): IdentityTables {
  const out: IdentityTables = { ranks: {}, commendationNodes: {} };
  for (const r of Object.values(ranks)) {
    if (!r?.rankNumber) continue;
    out.ranks[r.rankNumber] = { name: r.displayProperties?.name ?? `Rank ${r.rankNumber}`, ...(r.displayProperties?.icon ? { icon: url(r.displayProperties.icon) } : {}) };
  }
  // The root node has no name; its children are the four groups.
  for (const [h, n] of Object.entries(nodes)) {
    if (!n?.displayProperties?.name || !n.color) continue;
    out.commendationNodes[h] = { name: n.displayProperties.name, color: hex(n.color) };
  }
  return out;
}

export function guardianIdentity(profile: DestinyProfileResponse, t?: IdentityTables): GuardianIdentity | undefined {
  if (!t) return undefined;
  const out: GuardianIdentity = {};
  const n = profile.profile?.data?.currentGuardianRank;
  if (n) out.rank = { number: n, name: t.ranks[n]?.name ?? `Rank ${n}`, ...(t.ranks[n]?.icon ? { icon: t.ranks[n]!.icon } : {}) };
  const c = profile.profileCommendations?.data;
  if (c) {
    const groups = Object.entries(t.commendationNodes).map(([h, node]) => ({
      name: node.name, color: node.color,
      score: c.commendationNodeScoresByHash?.[Number(h)] ?? 0,
      percent: c.commendationNodePercentagesByHash?.[Number(h)] ?? 0,
    }));
    out.commendations = { total: c.totalScore ?? 0, groups };
  }
  return out.rank || out.commendations ? out : undefined;
}
