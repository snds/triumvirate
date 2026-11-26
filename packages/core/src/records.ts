// Records: titles (seals), the triumph tree, tracked triumphs, and the ones nearly done.
// Pure logic. The server feeds it trimmed record and presentation node definitions (see
// slimRecordTables) and the profile's Records (900) and PresentationNodes (700) components.
import type { DestinyObjectiveProgress, DestinyPresentationNodeComponent, DestinyRecordComponent } from 'bungie-api-ts/destiny2';
import type { ManifestTables } from './manifest.ts';

// ── Trimmed definitions ──────────────────────────────────────

export interface RecordDef {
  name: string;
  description?: string;
  icon?: string;
  /** 1 = per character; else account-wide. */
  scope?: 1;
  /** Triumph score for finishing it. */
  score?: number;
  /** Interval records: one step per objective, each worth its own score. */
  intervals?: { objective: number; score: number }[];
  /** Seal completion records name the title, by gender ("Male", "Female"). */
  title?: Record<string, string>;
  /** The record that counts gildings, for a seal that can be gilded. */
  gilding?: number;
  /** Shown in place of the name and description while the game keeps it secret. */
  obscured?: { name?: string; description?: string };
}

export interface NodeDef {
  name: string;
  description?: string;
  icon?: string;
  scope?: 1;
  nodes?: number[];
  records?: number[];
  /** A seal's own record (it carries the title). */
  completionRecord?: number;
}

export interface RecordTables {
  version: string;
  /** Roots from the global constants; the active roots also come with the profile. */
  roots: { legacyTriumphs?: number; legacySeals?: number; catalysts?: number; crafting?: number };
  nodes: Record<string, NodeDef>;
  records: Record<string, RecordDef>;
}

const url = (p?: string) => (p ? `https://www.bungie.net${p}` : undefined);
const DEFAULT_ICON = '/img/misc/missing_icon_d2.png';

/** The legacy and other roots, from DestinyGlobalConstantsDefinition (one entry). */
export function recordRoots(constants?: Record<string, any>): RecordTables['roots'] {
  const c = constants ? Object.values(constants)[0] : undefined;
  if (!c) return {};
  return {
    legacyTriumphs: c.legacyTriumphsRootNodeHash || undefined,
    legacySeals: c.legacySealsRootNodeHash || undefined,
    catalysts: c.exoticCatalystsRootNodeHash || undefined,
    crafting: c.craftingRootNodeHash || undefined,
  };
}

/** Keeps what the Records screen reads of each presentation node. */
export function slimNodes(nodes: Record<string, any>): Record<string, NodeDef> {
  const out: Record<string, NodeDef> = {};
  for (const [h, n] of Object.entries(nodes)) {
    if (n.redacted) continue;
    const kids = n.children ?? {};
    const d: NodeDef = { name: n.displayProperties?.name ?? '' };
    if (n.displayProperties?.description) d.description = n.displayProperties.description;
    const icon = n.displayProperties?.icon && n.displayProperties.icon !== DEFAULT_ICON ? n.displayProperties.icon : n.originalIcon;
    if (icon) d.icon = url(icon);
    if (n.scope === 1) d.scope = 1;
    if (kids.presentationNodes?.length) d.nodes = kids.presentationNodes.map((x: any) => x.presentationNodeHash);
    if (kids.records?.length) d.records = kids.records.map((x: any) => x.recordHash);
    if (n.completionRecordHash) d.completionRecord = n.completionRecordHash;
    out[h] = d;
  }
  return out;
}

/** Keeps what the Records screen reads of each record (the full table is tens of MB). */
export function slimRecords(records: Record<string, any>): Record<string, RecordDef> {
  const out: Record<string, RecordDef> = {};
  for (const [h, r] of Object.entries(records)) {
    if (r.redacted) continue;
    const d: RecordDef = { name: r.displayProperties?.name ?? '' };
    if (r.displayProperties?.description) d.description = r.displayProperties.description;
    if (r.displayProperties?.icon && r.displayProperties.icon !== DEFAULT_ICON) d.icon = url(r.displayProperties.icon);
    if (r.scope === 1) d.scope = 1;
    if (r.completionInfo?.ScoreValue) d.score = r.completionInfo.ScoreValue;
    const iv = r.intervalInfo?.intervalObjectives ?? [];
    if (iv.length) d.intervals = iv.map((x: any) => ({ objective: x.intervalObjectiveHash, score: x.intervalScoreValue ?? 0 }));
    if (r.titleInfo?.hasTitle) {
      d.title = r.titleInfo.titlesByGender ?? {};
      if (r.titleInfo.gildingTrackingRecordHash) d.gilding = r.titleInfo.gildingTrackingRecordHash;
    }
    const ob = r.stateInfo;
    if (ob?.obscuredName || ob?.obscuredDescription) d.obscured = { name: ob.obscuredName || undefined, description: ob.obscuredDescription || undefined };
    out[h] = d;
  }
  return out;
}

// ── Views ────────────────────────────────────────────────────

/** DestinyRecordState flags. */
export const RECORD_STATE = { Redeemed: 1, RewardUnavailable: 2, ObjectiveNotCompleted: 4, Obscured: 8, Invisible: 16, EntitlementUnowned: 32, CanEquipTitle: 64 } as const;

export interface RecordObjective {
  description: string;
  progress: number;
  completion: number;
  complete: boolean;
}

export interface RecordView {
  hash: number;
  name: string;
  description?: string;
  icon?: string;
  score?: number;
  complete: boolean;
  /** Its reward claimed (or nothing to claim). */
  redeemed: boolean;
  /** Still a secret in game. */
  obscured?: boolean;
  objectives: RecordObjective[];
  /** 0–1, across all objectives, for sorting. */
  fraction: number;
  /** For interval records: steps done of all steps. */
  steps?: { done: number; total: number };
  /** The game's one tracked triumph. */
  trackedInGame?: boolean;
  /** Names of the categories above it, top first ("Destinations › Pale Heart"). */
  path?: string[];
}

export interface NodeView {
  hash: number;
  name: string;
  icon?: string;
  progress: number;
  completion: number;
  nodes?: NodeView[];
  records?: RecordView[];
}

export interface TitleView {
  hash: number;
  name: string;
  /** The title you'd wear ("Conqueror"). */
  title: string;
  icon?: string;
  description?: string;
  progress: number;
  completion: number;
  complete: boolean;
  /** Times gilded; absent for a seal that can't be gilded. */
  gilded?: number;
  /** Gilded this season. */
  gildedNow?: boolean;
  legacy: boolean;
  records: RecordView[];
}

export interface RecordsScreen {
  score: { active: number; legacy: number; lifetime: number };
  titles: TitleView[];
  triumphs: NodeView[];
  legacy: NodeView[];
  /** Hashes of the game's tracked triumph and the ones you track here, as views. */
  tracked: RecordView[];
  /** Incomplete triumphs at least `nearlyAt` done, most done first. */
  nearly: RecordView[];
}

export interface RecordsInput {
  tables: RecordTables;
  objectives?: ManifestTables['objectives'];
  profileRecords?: { score?: number; activeScore?: number; legacyScore?: number; lifetimeScore?: number; trackedRecordHash?: number; records?: Record<string, DestinyRecordComponent>; recordCategoriesRootNodeHash?: number; recordSealsRootNodeHash?: number };
  characterRecords?: { records?: Record<string, DestinyRecordComponent> };
  profileNodes?: Record<string, DestinyPresentationNodeComponent>;
  characterNodes?: Record<string, DestinyPresentationNodeComponent>;
  /** "Male" or "Female", for title names. */
  gender?: string;
  /** Record hashes tracked in this app. */
  tracked?: number[];
  /** Smallest fraction for the nearly-done list (default 0.75). */
  nearlyAt?: number;
  /** How many nearly-done triumphs to keep (default 40). */
  nearlyMax?: number;
}

const objProgress = (o: DestinyObjectiveProgress, objectives: RecordsInput['objectives']): RecordObjective => ({
  description: objectives?.[o.objectiveHash]?.progressDescription || '',
  progress: o.progress ?? 0,
  completion: o.completionValue || 1,
  complete: !!o.complete,
});

/** Builds the Records screen for one character (character-scoped records and nodes read from it). */
export function recordsScreen(input: RecordsInput): RecordsScreen {
  const { tables } = input;
  const pr = input.profileRecords ?? {};
  const trackedSet = new Set(input.tracked ?? []);
  const cache = new Map<number, RecordView | null>();

  const component = (hash: number, scope?: 1) =>
    scope === 1 ? input.characterRecords?.records?.[hash] : pr.records?.[hash] ?? input.characterRecords?.records?.[hash];
  const nodeComponent = (hash: number, scope?: 1) =>
    scope === 1 ? input.characterNodes?.[hash] ?? input.profileNodes?.[hash] : input.profileNodes?.[hash] ?? input.characterNodes?.[hash];

  /** One record as shown, or null when hidden (invisible, unknown, no state). */
  const record = (hash: number): RecordView | null => {
    if (cache.has(hash)) return cache.get(hash)!;
    const def = tables.records[hash];
    const c = component(hash, def?.scope);
    let v: RecordView | null = null;
    if (def && c && !(c.state & RECORD_STATE.Invisible)) {
      const obscured = (c.state & RECORD_STATE.Obscured) !== 0;
      const interval = (c.intervalObjectives?.length ?? 0) > 0;
      let objectives = (c.objectives ?? []).map((o) => objProgress(o, input.objectives));
      let steps: RecordView['steps'];
      if (interval) {
        const iv = c.intervalObjectives;
        const done = iv.filter((o) => o.complete).length;
        steps = { done, total: iv.length };
        // Show the step in progress (or the last one when all are done).
        const cur = iv.find((o) => !o.complete) ?? iv[iv.length - 1]!;
        objectives = [objProgress(cur, input.objectives)];
      }
      const complete = interval ? steps!.done === steps!.total : (c.state & RECORD_STATE.ObjectiveNotCompleted) === 0;
      const fraction = complete ? 1 : objectives.length
        ? objectives.reduce((n, o) => n + Math.min(1, o.progress / o.completion), 0) / objectives.length
        : 0;
      const score = def.intervals ? def.intervals.reduce((n, x) => n + x.score, 0) : def.score;
      v = {
        hash,
        name: obscured ? def.obscured?.name || 'Secret triumph' : def.name,
        ...(obscured ? (def.obscured?.description ? { description: def.obscured.description } : {}) : def.description ? { description: def.description } : {}),
        ...(def.icon ? { icon: def.icon } : {}),
        ...(score ? { score } : {}),
        complete,
        redeemed: (c.state & RECORD_STATE.Redeemed) !== 0,
        ...(obscured ? { obscured: true } : {}),
        objectives,
        fraction,
        ...(steps ? { steps } : {}),
        ...(pr.trackedRecordHash === hash ? { trackedInGame: true } : {}),
      };
    }
    cache.set(hash, v);
    return v;
  };

  /** A node and everything under it; null when hidden or empty. */
  const node = (hash: number, path: string[], depth = 0): NodeView | null => {
    const def = tables.nodes[hash];
    if (!def || depth > 6) return null;
    const c = nodeComponent(hash, def.scope);
    if (c && (c.state & 1)) return null; // Invisible
    const here = [...path, def.name].filter(Boolean);
    const nodes = (def.nodes ?? []).map((h) => node(h, here, depth + 1)).filter((x): x is NodeView => !!x);
    const records = (def.records ?? []).map((h) => {
      const r = record(h);
      if (r && !r.path) r.path = here;
      return r;
    }).filter((x): x is RecordView => !!x);
    if (!nodes.length && !records.length) return null;
    const progress = c?.progressValue ?? records.filter((r) => r.complete).length;
    const completion = c?.completionValue ?? records.length;
    return { hash, name: def.name, ...(def.icon ? { icon: def.icon } : {}), progress, completion, ...(nodes.length ? { nodes } : {}), ...(records.length ? { records } : {}) };
  };

  const children = (root?: number) => {
    const def = root ? tables.nodes[root] : undefined;
    return (def?.nodes ?? []).map((h) => node(h, [])).filter((x): x is NodeView => !!x);
  };

  const sealsFrom = (root: number | undefined, legacy: boolean): TitleView[] => {
    const out: TitleView[] = [];
    for (const h of (root ? tables.nodes[root]?.nodes : undefined) ?? []) {
      const def = tables.nodes[h];
      if (!def?.completionRecord) continue;
      const titleDef = tables.records[def.completionRecord];
      const titleComp = component(def.completionRecord, titleDef?.scope);
      if (!titleDef || (titleComp && titleComp.state & RECORD_STATE.Invisible)) continue;
      const c = nodeComponent(h, def.scope);
      const records = (def.records ?? []).map(record).filter((x): x is RecordView => !!x);
      // Seals usually hold their records under one child node.
      for (const k of def.nodes ?? []) for (const r of tables.nodes[k]?.records ?? []) { const v = record(r); if (v) records.push(v); }
      if (!records.length && !titleComp) continue;
      const progress = c?.progressValue ?? records.filter((r) => r.complete).length;
      const completion = c?.completionValue ?? records.length;
      const complete = titleComp ? (titleComp.state & RECORD_STATE.ObjectiveNotCompleted) === 0 : progress >= completion;
      const title = titleDef.title?.[input.gender ?? 'Male'] || titleDef.title?.Male || Object.values(titleDef.title ?? {})[0] || def.name;
      let gilded: number | undefined, gildedNow: boolean | undefined;
      if (titleDef.gilding) {
        const g = component(titleDef.gilding, tables.records[titleDef.gilding]?.scope);
        gilded = g?.completedCount ?? 0;
        gildedNow = g ? (g.state & RECORD_STATE.ObjectiveNotCompleted) === 0 : false;
      }
      out.push({
        hash: h, name: def.name, title, ...(def.icon ? { icon: def.icon } : {}), ...(def.description ? { description: def.description } : {}),
        progress, completion, complete, ...(gilded !== undefined ? { gilded, gildedNow } : {}), legacy, records,
      });
    }
    return out;
  };

  const triumphs = children(pr.recordCategoriesRootNodeHash);
  const legacy = children(tables.roots.legacyTriumphs);
  const titles = [...sealsFrom(pr.recordSealsRootNodeHash, false), ...sealsFrom(tables.roots.legacySeals, true)];

  // Everything visible, once, for the tracked and nearly-done lists.
  const all = [...new Set([...cache.values()].filter((x): x is RecordView => !!x))];
  const tracked = all.filter((r) => trackedSet.has(r.hash) || r.trackedInGame);
  // Tracked ones you never saw in the tree (a hash from elsewhere) still show.
  for (const h of trackedSet) if (!tracked.some((r) => r.hash === h)) { const r = record(h); if (r) tracked.push(r); }
  const at = input.nearlyAt ?? 0.75;
  const nearly = all
    .filter((r) => !r.complete && !r.obscured && r.fraction >= at)
    .sort((a, b) => b.fraction - a.fraction || (b.score ?? 0) - (a.score ?? 0) || a.name.localeCompare(b.name))
    .slice(0, input.nearlyMax ?? 40);

  return {
    score: { active: pr.activeScore ?? pr.score ?? 0, legacy: pr.legacyScore ?? 0, lifetime: pr.lifetimeScore ?? 0 },
    titles, triumphs, legacy, tracked, nearly,
  };
}

export interface RecordFilters {
  /** Hide completed triumphs (and nodes left empty by it). */
  hideComplete?: boolean;
  /** Case-insensitive match on name or description; a matching category keeps all of its triumphs. */
  query?: string;
}

const recordHit = (r: RecordView, q: string) => `${r.name} ${r.description ?? ''}`.toLowerCase().includes(q);

/** Filters records by the screen's switches. */
export function filterRecords(list: RecordView[], f: RecordFilters): RecordView[] {
  const q = f.query?.trim().toLowerCase();
  return list.filter((r) => !(f.hideComplete && r.complete) && (!q || recordHit(r, q)));
}

/** Filters a node tree; nodes with nothing left drop out. */
export function filterNodes(nodes: NodeView[], f: RecordFilters): NodeView[] {
  const q = f.query?.trim().toLowerCase();
  if (!q && !f.hideComplete) return nodes;
  const walk = (n: NodeView, keepAll: boolean): NodeView | null => {
    const hit = keepAll || (!!q && n.name.toLowerCase().includes(q));
    const nodes = (n.nodes ?? []).map((x) => walk(x, hit)).filter((x): x is NodeView => !!x);
    const records = (n.records ?? []).filter((r) => !(f.hideComplete && r.complete) && (!q || hit || recordHit(r, q)));
    if (!nodes.length && !records.length) return null;
    return { ...n, ...(nodes.length ? { nodes } : { nodes: undefined }), ...(records.length ? { records } : { records: undefined }) };
  };
  return nodes.map((n) => walk(n, false)).filter((x): x is NodeView => !!x);
}
