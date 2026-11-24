// Parser and matcher for DIM-format wish lists (e.g. the community "voltron" list).
// Line format: dimwishlist:item=<hash>&perks=<hash>,<hash>#notes:<text>|tags:<tags>
// A "//notes:" line sets the notes for the entries that follow it until the next block.
import type { ManifestTables } from './manifest.ts';

export const VOLTRON_URL = 'https://raw.githubusercontent.com/48klocs/dim-wish-list-sources/master/voltron.txt';

export interface WishRoll {
  perks: number[];
  notes?: string;
  tags: string[];
  /** A negative item hash in the list means "this roll is trash". */
  trash: boolean;
}

export type WishList = Map<number, WishRoll[]>;

/** Splits "PvE PvE-God M+KB" or "pve,mkb" into lowercase tags. */
function parseTags(s: string): string[] {
  return s.split(/[\s,]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);
}

/** Pulls trailing "|tags:..." off a notes string. */
function splitNotes(raw: string): { notes?: string; tags: string[] } {
  const i = raw.lastIndexOf('|tags:');
  if (i === -1) return { notes: raw.trim() || undefined, tags: [] };
  return { notes: raw.slice(0, i).trim() || undefined, tags: parseTags(raw.slice(i + 6)) };
}

export function parseWishList(text: string): WishList {
  const list: WishList = new Map();
  let block: { notes?: string; tags: string[] } = { tags: [] };
  for (const line of text.split('\n')) {
    if (line.startsWith('//notes:')) {
      block = splitNotes(line.slice(8));
      continue;
    }
    if (!line.trim()) {
      block = { tags: [] }; // blank line ends a notes block
      continue;
    }
    if (!line.startsWith('dimwishlist:')) continue;
    const [body = '', inline] = line.slice('dimwishlist:'.length).split('#notes:');
    const params = new URLSearchParams(body);
    const rawHash = Number(params.get('item'));
    if (!Number.isFinite(rawHash) || rawHash === 0) continue;
    const perks = (params.get('perks') ?? '').split(',').map(Number).filter((n) => n > 0);
    const meta = inline !== undefined ? splitNotes(inline) : block;
    const hash = Math.abs(rawHash);
    const rolls = list.get(hash) ?? [];
    rolls.push({ perks, notes: meta.notes, tags: meta.tags, trash: rawHash < 0 });
    list.set(hash, rolls);
  }
  return list;
}

export type Verdict = 'god' | 'good' | 'meh' | 'trash' | 'unrated';

export interface Appraisal {
  verdict: Verdict;
  pve: boolean;
  pvp: boolean;
  /** Notes from the best matching roll, trimmed for display. */
  notes?: string;
  /** How many curated rolls exist for this weapon. */
  rollCount: number;
  /** Names of perks that appear in any recommended roll for this weapon, for highlighting. */
  wishedPerks?: string[];
}

const NOTE_LIMIT = 600;

/**
 * Compares a weapon's available perks (by name, so enhanced perks count as their
 * base perk) against every curated roll for that weapon.
 */
export function appraise(
  itemHash: number, perkNames: Set<string>, list: WishList, manifest: ManifestTables,
): Appraisal {
  const rolls = list.get(itemHash) ?? [];
  if (rolls.length === 0) return { verdict: 'unrated', pve: false, pvp: false, rollCount: 0 };
  const nameOf = (h: number) => manifest.items[h]?.displayProperties.name;
  const wishedPerks = [...new Set(rolls.filter((r) => !r.trash).flatMap((r) => r.perks.map(nameOf)))]
    .filter((n): n is string => !!n);
  const matching = rolls.filter((r) =>
    r.perks.every((h) => {
      const name = nameOf(h);
      // Perks we can't name (or masterworks) can't be checked, so they don't block a match.
      return !name || manifest.items[h]?.itemTypeDisplayName?.includes('Masterwork') || perkNames.has(name);
    }),
  );
  if (matching.some((r) => r.trash)) return { verdict: 'trash', pve: false, pvp: false, rollCount: rolls.length, wishedPerks };
  const good = matching.filter((r) => !r.trash);
  if (good.length === 0) return { verdict: 'meh', pve: false, pvp: false, rollCount: rolls.length, wishedPerks };
  const tags = new Set(good.flatMap((r) => r.tags));
  const best = good.find((r) => r.tags.some((t) => t.includes('god'))) ?? good[0]!;
  const notes = best.notes && best.notes.length > NOTE_LIMIT ? `${best.notes.slice(0, NOTE_LIMIT)}…` : best.notes;
  return {
    verdict: [...tags].some((t) => t.includes('god')) ? 'god' : 'good',
    pve: [...tags].some((t) => t.startsWith('pve')),
    pvp: [...tags].some((t) => t.startsWith('pvp')),
    notes,
    rollCount: rolls.length,
    wishedPerks,
  };
}
