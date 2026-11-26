// Season tracker: the season pass rank, the artifact's power bonus and unlocked perks, and the
// ritual ranks (Vanguard, Crucible, Gambit...), all from one profile snapshot.
import type { DestinyProfileResponse, DestinyProgression } from 'bungie-api-ts/destiny2';
import type { ManifestTables, ProgressionInfo } from './manifest.ts';

export interface RankRow {
  hash: number;
  name: string;
  icon?: string;
  /** Current step name ("Guardian III", "Brave I"). */
  rank: string;
  /** 1-based step within the ladder, and how many steps it has. */
  step: number;
  steps: number;
  /** Points into this step, and the step's size. 0 of 0 means the ladder is maxed. */
  progress: number;
  next: number;
  /** Times reset this season. */
  resets: number;
}

export interface SeasonSummary {
  season?: { name: string; number: number; endsAt?: string; daysLeft?: number; icon?: string };
  pass?: { name: string; icon?: string; rank: number; progress: number; next: number; endsAt?: string; daysLeft?: number };
  artifact?: {
    name: string; icon?: string; powerBonus: number; points: number; pointsUsed?: number;
    /** XP toward the next power bonus level and the next perk point. */
    powerProgress?: { progress: number; next: number };
    pointProgress?: { progress: number; next: number };
  };
  ranks: RankRow[];
}

/** The rank progressions plus the current pass's two, so snapshots keep just these (see trimProgressions). */
export function trackedProgressions(m: Pick<ManifestTables, 'season'>): Set<number> {
  const out = new Set<number>(m.season?.ranks ?? []);
  for (const p of Object.values(m.season?.passes ?? {})) {
    out.add(p.reward);
    if (p.prestige) out.add(p.prestige);
  }
  return out;
}

// A far-future end date means "no end announced".
const realDate = (d?: string) => (d && Date.parse(d) < Date.parse('2090-01-01') ? d : undefined);
const daysUntil = (d: string | undefined, now: Date) => (d ? Math.max(0, Math.ceil((Date.parse(d) - now.getTime()) / 86_400_000)) : undefined);

/** "HEROIC III" reads as "Heroic III": words in title case, roman numerals kept. */
const titleCase = (name: string) => name.replace(/\S+/g, (w) => (/^[IVX]+$/.test(w) ? w : w[0]!.toUpperCase() + w.slice(1).toLowerCase()));

function rankRow(hash: number, info: ProgressionInfo, p: DestinyProgression): RankRow {
  const steps = info.steps.length;
  const i = Math.min(Math.max(p.stepIndex ?? p.level ?? 0, 0), Math.max(steps - 1, 0));
  return {
    hash, name: info.name, ...(info.steps[i]?.icon ?? info.icon ? { icon: info.steps[i]?.icon ?? info.icon } : {}),
    rank: titleCase(info.steps[i]?.name ?? '') || `Rank ${p.level}`,
    step: i + 1, steps,
    progress: p.progressToNextLevel ?? 0, next: p.nextLevelAt ?? 0,
    resets: p.currentResetCount ?? 0,
  };
}

/** Everything the tracker shows, read from the most recently played character. */
export function seasonSummary(profile: DestinyProfileResponse, manifest: Pick<ManifestTables, 'season'>, now = new Date()): SeasonSummary {
  const t = manifest.season;
  const out: SeasonSummary = { ranks: [] };
  const data = profile.profile?.data;
  const chars = Object.values(profile.characters?.data ?? {}).sort((a, b) => Date.parse(b.dateLastPlayed) - Date.parse(a.dateLastPlayed));
  const progressions = chars[0] ? profile.characterProgressions?.data?.[chars[0].characterId]?.progressions ?? {} : {};
  if (!t || !data) return out;

  const season = t.seasons[data.currentSeasonHash ?? -1];
  if (season) {
    const endsAt = realDate(season.endDate);
    out.season = { name: season.name, number: season.number, ...(endsAt ? { endsAt, daysLeft: daysUntil(endsAt, now) } : {}), ...(season.icon ? { icon: season.icon } : {}) };
  }

  const pass = t.passes[data.currentSeasonPassHash ?? -1];
  const reward = pass && progressions[pass.reward];
  if (pass && reward) {
    const prestige = pass.prestige ? progressions[pass.prestige] : undefined;
    // Past the last reward rank, the pass keeps counting in its prestige progression.
    const maxed = !!prestige && (reward.level ?? 0) >= (reward.levelCap > 0 ? reward.levelCap : Infinity);
    const live = maxed ? prestige! : reward;
    const window = season?.passes.find((x) => x.hash === data.currentSeasonPassHash);
    const endsAt = realDate(window?.end);
    out.pass = {
      name: pass.name, ...(pass.icon ? { icon: pass.icon } : {}),
      rank: (reward.level ?? 0) + (maxed ? prestige!.level ?? 0 : 0),
      progress: live.progressToNextLevel ?? 0, next: live.nextLevelAt ?? 0,
      ...(endsAt ? { endsAt, daysLeft: daysUntil(endsAt, now) } : {}),
    };
  }

  const art = (profile as { profileProgression?: { data?: { seasonalArtifact?: {
    artifactHash: number; pointsAcquired: number; powerBonus: number;
    powerBonusProgression?: DestinyProgression; pointProgression?: DestinyProgression;
  } } } }).profileProgression?.data?.seasonalArtifact;
  const charArt = chars[0] ? profile.characterProgressions?.data?.[chars[0].characterId]?.seasonalArtifact : undefined;
  const artHash = art?.artifactHash ?? charArt?.artifactHash;
  if (artHash) {
    const def = t.artifacts[artHash];
    const prog = (p?: DestinyProgression) => (p ? { progress: p.progressToNextLevel ?? 0, next: p.nextLevelAt ?? 0 } : undefined);
    out.artifact = {
      name: def?.name ?? 'Seasonal artifact', ...(def?.icon ? { icon: def.icon } : {}),
      powerBonus: art?.powerBonus ?? 0,
      points: art?.pointsAcquired ?? 0,
      ...(charArt ? { pointsUsed: charArt.pointsUsed } : {}),
      ...(prog(art?.powerBonusProgression) ? { powerProgress: prog(art?.powerBonusProgression) } : {}),
      ...(prog(art?.pointProgression) ? { pointProgress: prog(art?.pointProgression) } : {}),
    };
  }

  for (const h of t.ranks) {
    const info = t.progressions[h];
    const p = progressions[h];
    if (info && p) out.ranks.push(rankRow(h, info, p));
  }
  return out;
}
