// "This week" for the Today digest: the weekly rotation (Nightfall, featured raid and dungeon) as
// image cards with their modifiers, and the event running now. Pure: the server fetches the public
// milestones and the few definitions they name, and this turns them into what the screen shows.
import type { DestinyPublicMilestone } from 'bungie-api-ts/destiny2';

export interface WeekModifier {
  name: string;
  icon?: string;
  description?: string;
}

export interface WeekActivity {
  hash: number;
  /** What the game calls the slot: "Nightfall", "Weekly Raid". */
  milestone: string;
  /** The place: "The Glassway", "Salvation's Edge". */
  name: string;
  /** Difficulty or flavor shown under the name: "Grandmaster". */
  detail?: string;
  /** The activity's 1280×720 key art (pgcrImage). */
  image?: string;
  modifiers: WeekModifier[];
  /** When this rotation ends (ISO). */
  endDate?: string;
}

export interface WeekEvent {
  name: string;
  description?: string;
  icon?: string;
  /** The event card's theme art, 500×259. */
  background?: string;
  /** The event's color as a CSS hex, for the banner's edge. */
  color?: string;
}

export interface ThisWeek {
  activities: WeekActivity[];
  event?: WeekEvent;
  builtAt: string;
}

type Display = { name?: string; description?: string; icon?: string; hasIcon?: boolean };
export interface WeekDefs {
  milestones: Map<number, { displayProperties?: Display }>;
  activities: Map<number, { displayProperties?: Display; pgcrImage?: string; modifiers?: { activityModifierHash: number }[] }>;
  modifiers: Map<number, { displayProperties?: Display; displayInActivitySelection?: boolean }>;
}

export interface EventCardDef {
  displayProperties?: Display;
  images?: { themeBackgroundImagePath?: string } | null;
  color?: { red: number; green: number; blue: number } | null;
}

const bungieUrl = (path?: string) => (path ? (path.startsWith('http') ? path : `https://www.bungie.net${path}`) : undefined);
/** Placeholder art Bungie uses when an activity has none of its own. */
const PLACEHOLDER = /placeholder/i;
const MAX = 6;

/** Every activity hash and modifier hash the milestones name, so the server knows what to fetch. */
export function weekHashes(milestones: Record<string, DestinyPublicMilestone>) {
  const all = Object.values(milestones);
  return {
    milestones: all.map((m) => m.milestoneHash),
    activities: [...new Set(all.flatMap((m) => (m.activities ?? []).map((a) => a.activityHash)))],
  };
}

/** Modifier hashes for the activities the server fetched (the milestone lists some; the definition lists the rest). */
export function weekModifierHashes(milestones: Record<string, DestinyPublicMilestone>, activities: WeekDefs['activities']): number[] {
  const out = new Set<number>();
  for (const m of Object.values(milestones)) {
    for (const a of m.activities ?? []) {
      for (const h of a.modifierHashes ?? []) out.add(h);
      for (const x of activities.get(a.activityHash)?.modifiers ?? []) out.add(x.activityModifierHash);
    }
  }
  return [...out];
}

/**
 * One card per milestone that has art, Nightfall first, then the game's own order. Each milestone
 * can list several difficulties of one activity; the one with the most visible modifiers wins.
 * A Nightfall's name is its difficulty ("Nightfall: Grandmaster") and its description is the strike,
 * so a short description that isn't a sentence is used as the name.
 */
export function thisWeek(
  milestones: Record<string, DestinyPublicMilestone>, defs: WeekDefs, event?: EventCardDef, now = new Date(),
  /** The account's string variables (profile component 1200), which fill "{var:N}" in modifier text. */
  vars: Record<string, number> = {},
): ThisWeek {
  const cards: (WeekActivity & { order: number })[] = [];
  const seen = new Set<string>();
  for (const m of Object.values(milestones)) {
    const options = (m.activities ?? []).map((a) => {
      const d = defs.activities.get(a.activityHash);
      const hashes = [...new Set([...(a.modifierHashes ?? []), ...(d?.modifiers ?? []).map((x) => x.activityModifierHash)])];
      return { a, d, modifiers: visibleModifiers(hashes, defs.modifiers, vars) };
    }).filter((o) => o.d?.pgcrImage && !PLACEHOLDER.test(o.d.pgcrImage));
    if (!options.length) continue;
    const best = options.reduce((x, y) => (y.modifiers.length > x.modifiers.length ? y : x));
    const dp = best.d!.displayProperties ?? {};
    const { name, detail } = activityName(dp);
    const key = `${name}|${best.d!.pgcrImage}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({
      hash: best.a.activityHash,
      milestone: defs.milestones.get(m.milestoneHash)?.displayProperties?.name || 'This week',
      name, ...(detail ? { detail } : {}),
      image: bungieUrl(best.d!.pgcrImage),
      modifiers: best.modifiers,
      ...(m.endDate ? { endDate: m.endDate } : {}),
      order: m.order ?? 0,
    });
  }
  const nightfall = (c: WeekActivity) => (/nightfall/i.test(`${c.milestone} ${c.detail ?? ''}`) ? 0 : 1);
  cards.sort((a, b) => nightfall(a) - nightfall(b) || a.order - b.order);
  return {
    activities: cards.slice(0, MAX).map(({ order: _order, ...c }) => c),
    ...(event ? { event: weekEvent(event) } : {}),
    builtAt: now.toISOString(),
  };
}

function activityName(dp: Display): { name: string; detail?: string } {
  const raw = (dp.name ?? '').trim();
  const desc = (dp.description ?? '').trim();
  // "Nightfall: Grandmaster" + "The Glassway" → "The Glassway", detail "Grandmaster".
  if (desc && desc.length <= 48 && !/[.!?]$/.test(desc)) {
    const detail = raw.includes(':') ? raw.split(':').pop()!.trim() : raw;
    return { name: desc, detail: detail || undefined };
  }
  // "Salvation's Edge: Standard" → "Salvation's Edge"; other suffixes stay as the detail.
  const [base, ...rest] = raw.split(':');
  const suffix = rest.join(':').trim();
  if (!suffix) return { name: raw || 'Activity' };
  return { name: base!.trim(), ...(suffix.toLowerCase() === 'standard' ? {} : { detail: suffix }) };
}

/** "{var:123}% bonus" → "25% bonus"; without a value the number and its unit go: "Bonus". */
export function fillVars(text: string, vars: Record<string, number>): string {
  const out = text.replace(/\{var:(\d+)\}(%?)\s*/g, (_, h: string, pct: string) => (h in vars ? `${vars[h]}${pct} ` : ''));
  return out.replace(/^\s*([a-z])/, (_, c: string) => c.toUpperCase()).trim();
}

function visibleModifiers(hashes: number[], defs: WeekDefs['modifiers'], vars: Record<string, number>): WeekModifier[] {
  const out: WeekModifier[] = [];
  const names = new Set<string>();
  for (const h of hashes) {
    const d = defs.get(h);
    const dp = d?.displayProperties;
    if (!d?.displayInActivitySelection || !dp?.name || !dp.icon || names.has(dp.name)) continue;
    names.add(dp.name);
    const description = dp.description ? fillVars(dp.description, vars) : '';
    out.push({ name: dp.name, icon: bungieUrl(dp.icon), ...(description ? { description } : {}) });
  }
  return out;
}

function weekEvent(e: EventCardDef): WeekEvent | undefined {
  const name = e.displayProperties?.name;
  if (!name) return undefined;
  const hex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return {
    name,
    ...(e.displayProperties?.description ? { description: e.displayProperties.description } : {}),
    ...(e.displayProperties?.icon ? { icon: bungieUrl(e.displayProperties.icon) } : {}),
    ...(e.images?.themeBackgroundImagePath ? { background: bungieUrl(e.images.themeBackgroundImagePath) } : {}),
    ...(e.color ? { color: `#${hex(e.color.red)}${hex(e.color.green)}${hex(e.color.blue)}` } : {}),
  };
}
