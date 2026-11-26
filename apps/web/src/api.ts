import type { AccountSummary, AppraisedItem, ArmorKeep, ArmorSet, PopularBuild, CharacterRow, CleanupCandidate, ClearedItem, CommunityAppraisal, FarmTarget, SeasonSummary, Digest, GameLoadout, Grade, LoadoutStyles, RollOptions, SavedLoadout, WatchEntry, WatchHit } from '@triumvirate/core';

export interface Inventory {
  signedIn: true;
  displayName: string;
  profilePicture?: string;
  syncedAt: string;
  manifestVersion: string;
  agentEnabled: boolean;
  characters: CharacterRow[];
  /** Optional so an older server still renders. */
  account?: AccountSummary;
  items: AppraisedItem[];
  /** Cleanup picks you haven't decided on yet. */
  cleanup: CleanupCandidate[];
  /** Items waiting in the dismantle queue. Optional so an older server still renders. */
  cleanupQueued?: number;
  /** In-game loadout slots by character id. Optional so an older server still renders. */
  gameLoadouts?: Record<string, GameLoadout[]>;
  loadoutStyles?: LoadoutStyles;
  /** Armor sets you own pieces of, for set bonuses. */
  itemSets?: Record<string, ArmorSet>;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** What to say when the app server isn't running or sent back nothing readable. */
const SERVER_DOWN = 'The app server isn\'t responding. Check the terminal running pnpm dev for an error, then try again.';

class ServerDown extends Error {}

/**
 * Points every Bungie image at our own server, which keeps a copy on disk and tells the browser
 * to cache it for a year. Reloads then draw art from the browser cache instead of popping in.
 */
const sameOriginImages = (text: string) => text.replaceAll('"https://www.bungie.net/', '"/api/bungie-img/');

async function json<T>(res: Response, transform?: (text: string) => string): Promise<T> {
  const raw = await res.text();
  const text = transform ? transform(raw) : raw;
  let body: T & { error?: string };
  // The dev proxy answers with an empty 500 or 502 when the server is down or restarting.
  try { body = JSON.parse(text); } catch { throw new ServerDown(res.ok ? 'The app server sent back something unreadable.' : SERVER_DOWN); }
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

/** Resolves to null when not signed in. */
export async function fetchInventory(refresh = false): Promise<Inventory | null> {
  // The server restarts itself after a git pull; give it a few seconds before giving up.
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`/api/inventory${refresh ? '?refresh=1' : ''}`);
      if (res.status === 401) return null;
      return await json<Inventory>(res, sameOriginImages);
    } catch (err) {
      if (!(err instanceof ServerDown) || attempt >= 5) throw err;
      await new Promise((f) => setTimeout(f, 1000 + attempt * 500));
    }
  }
}

export interface MoveResult {
  /** The item as it is now; on a failed move, wherever it ended up. */
  item?: AppraisedItem;
  account?: AccountSummary;
  error?: string;
}

/** Moves one item to a character id or 'vault'. Never throws; a failure comes back as `error`. */
export async function moveItem(instanceId: string, to: string): Promise<MoveResult> {
  try {
    const res = await fetch('/api/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId, to }),
    });
    const body = (await res.json().catch(() => ({}))) as MoveResult;
    if (!res.ok && !body.error) body.error = res.status === 401 ? 'Sign in again to move items.' : `Move failed (${res.status})`;
    return body;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function logout(): Promise<void> {
  await fetch('/api/logout', { method: 'POST' });
}

export type AgentEvent =
  | { type: 'status'; text: string }
  | { type: 'text'; delta: string }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string };

/** Streams the agent's progress as newline-delimited JSON events. */
export async function streamAgent(messages: ChatTurn[], onEvent: (e: AgentEvent) => void): Promise<void> {
  const res = await fetch('/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    // Events end with a newline; keep any partial line for the next chunk.
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as AgentEvent);
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as AgentEvent);
}

export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: string;
  turnCount: number;
}

export const listChats = async (): Promise<ChatSummary[]> => json(await fetch('/api/chats'));
export const getChat = async (id: string): Promise<ChatSummary & { turns: ChatTurn[] }> => json(await fetch(`/api/chats/${encodeURIComponent(id)}`));
export const saveChat = async (id: string, turns: ChatTurn[]): Promise<ChatSummary> => json(await fetch(`/api/chats/${encodeURIComponent(id)}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ turns }),
}));
export const deleteChat = async (id: string): Promise<void> => { await fetch(`/api/chats/${encodeURIComponent(id)}`, { method: 'DELETE' }); };
/** A fresh chat id: time first, so ids sort by when the chat began. */
export const newChatId = () => `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const rollCache = new Map<number, Promise<RollOptions>>();
/** Every roll a weapon can have. Cached per weapon for the session. */
export function fetchRolls(itemHash: number): Promise<RollOptions> {
  let p = rollCache.get(itemHash);
  if (!p) {
    p = fetch(`/api/items/${itemHash}/rolls`).then((r) => json<RollOptions>(r));
    p.catch(() => rollCache.delete(itemHash)); // let a failure be retried
    rollCache.set(itemHash, p);
  }
  return p;
}

export interface CommunityAppraisals {
  builtAt?: string;
  /** Samples in the 30-day window behind these grades. */
  samples: number;
  from?: string;
  to?: string;
  items: Record<string, CommunityAppraisal>;
}

/** Community grades for every weapon in the current inventory, keyed by instance id. */
export const fetchCommunityAppraisals = async (): Promise<CommunityAppraisals> => json(await fetch('/api/community/appraisals'));

/** Swaps a weapon's perks to options it already has. Never throws; a failure comes back as `error`. */
/** `applied` counts the perks Bungie accepted, which can be some of them when it stops partway. */
export async function applyPerks(instanceId: string, plugs: { socketIndex: number; plugHash: number }[]): Promise<{ item?: AppraisedItem; applied?: number; error?: string }> {
  try {
    const res = await fetch('/api/perks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId, plugs }),
    });
    const body = (await res.json().catch(() => ({}))) as { item?: AppraisedItem; applied?: number; error?: string };
    if (!res.ok && !body.error) body.error = res.status === 401 ? 'Sign in again to change perks.' : `Perk change failed (${res.status})`;
    return body;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export interface VendorOffers {
  fetchedAt: string;
  /** Vendor weapons, shaped like inventory rows; location is the vendor's name. */
  items: (AppraisedItem & { vendorHash: number; vendorName: string })[];
  grades: Record<string, CommunityAppraisal>;
}
export const fetchVendorOffers = async (refresh = false): Promise<VendorOffers> =>
  json(await fetch(`/api/community/vendors${refresh ? '?refresh=1' : ''}`), sameOriginImages);

// ── Equip, lock, and loadouts ─────────────────────────────────

export interface ActionResult {
  /** Every item whose place changed (equipped, moved, or swapped out). */
  items?: AppraisedItem[];
  account?: AccountSummary;
  /** Items a loadout couldn't put on, and why. */
  skipped?: { instanceId: string; name?: string; reason: string }[];
  error?: string;
}

/** POSTs an action. Never throws; a failure comes back as `error`. */
async function act<T extends { error?: string }>(path: string, body: unknown, what: string): Promise<T> {
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const out = sameOriginJson<T>(await res.text());
    if (!res.ok && !out.error) out.error = res.status === 401 ? `Sign in again to ${what}.` : `Couldn't ${what} (${res.status})`;
    return out;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) } as T;
  }
}
const sameOriginJson = <T>(text: string): T => { try { return JSON.parse(sameOriginImages(text)) as T; } catch { return {} as T; } };

export const equipItem = (instanceId: string, characterId: string) => act<ActionResult>('/api/equip', { instanceId, characterId }, 'equip items');
/** Several items at once (e.g. an optimizer result): moved over first, then equipped together. */
export const equipItems = (instanceIds: string[], characterId: string) => act<ActionResult>('/api/equip', { instanceIds, characterId }, 'equip items');
export const setLocked = (instanceId: string, locked: boolean) =>
  act<{ item?: AppraisedItem; error?: string }>('/api/lock', { instanceId, locked }, 'lock items');

export type LoadoutDraft = Pick<SavedLoadout, 'name' | 'classType' | 'items' | 'notes' | 'subclass' | 'artifact'>;
export type DigestView = Omit<Digest, 'seen'>;
export interface DigestResponse { digest: DigestView | null; dates: string[]; building?: boolean; error?: string }
export const fetchDigest = async (date?: string): Promise<DigestResponse> =>
  json(await fetch(`/api/digest${date ? `?date=${encodeURIComponent(date)}` : ''}`), sameOriginImages);
/** Builds today's digest now (syncs from Bungie first, so it takes a few seconds). */
export const runDigest = () => act<DigestResponse>('/api/digest/run', {}, 'build the digest');

export interface WatchResponse {
  entries: WatchEntry[];
  hits: WatchHit[];
  checkedAt: string | null;
  /** Minutes between automatic checks; null when the server doesn't check on its own. */
  everyMinutes: number | null;
  /** Whether the server can send phone alerts at all. */
  alerts: boolean;
  /** New hits from a check. */
  fresh?: number;
  error?: string;
}
export const fetchWatch = async (): Promise<WatchResponse> => json(await fetch('/api/watch'), sameOriginImages);
export const saveWatch = (w: { itemHash: number; perks: string[][]; minGrade?: Grade }) => act<WatchResponse>('/api/watch', w, 'save the watch');
export const removeWatch = async (id: string): Promise<WatchResponse> =>
  json(await fetch(`/api/watch/${encodeURIComponent(id)}`, { method: 'DELETE' }), sameOriginImages);
/** Checks vendors and drops now (syncs from Bungie first). */
export const checkWatch = () => act<WatchResponse>('/api/watch/check', {}, 'check your watch list');
export const listLoadouts = async (): Promise<SavedLoadout[]> => json(await fetch('/api/loadouts'), sameOriginImages);
export const createLoadout = async (l: LoadoutDraft): Promise<SavedLoadout> => json(await fetch('/api/loadouts', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(l),
}), sameOriginImages);
export const updateLoadout = async (id: string, l: LoadoutDraft): Promise<SavedLoadout> => json(await fetch(`/api/loadouts/${encodeURIComponent(id)}`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(l),
}), sameOriginImages);
export const deleteLoadout = async (id: string): Promise<void> => { await fetch(`/api/loadouts/${encodeURIComponent(id)}`, { method: 'DELETE' }); };
export const applyLoadout = (id: string, characterId: string) =>
  act<ActionResult>(`/api/loadouts/${encodeURIComponent(id)}/apply`, { characterId }, 'apply the loadout');

export interface GameSlotLook { nameHash?: number; colorHash?: number; iconHash?: number }
export const equipGameLoadout = (characterId: string, index: number) =>
  act<{ error?: string }>('/api/game-loadouts/equip', { characterId, index }, 'equip the loadout');
export const saveGameLoadout = (characterId: string, index: number, look: GameSlotLook) =>
  act<{ error?: string }>('/api/game-loadouts/save', { characterId, index, ...look }, 'save the loadout');
export const restyleGameLoadout = (characterId: string, index: number, look: GameSlotLook) =>
  act<{ error?: string }>('/api/game-loadouts/identify', { characterId, index, ...look }, 'rename the loadout');

// ── Cleanup autopilot ─────────────────────────────────────────

export interface CleanupStatus {
  /** Picks you haven't decided on. */
  picks: CleanupCandidate[];
  /** The dismantle queue, as the items are now. */
  queue: AppraisedItem[];
  kept: number;
  /** Queued items that have since left your inventory, newest first. */
  cleared: ClearedItem[];
  clearedWeek: number;
  /** When community grades last updated; absent before the first crawl. */
  community?: { builtAt: string; samples: number };
  /** Armor kept on purpose because of armor sets and popular builds. */
  keeps?: ArmorKeep[];
  /** Builds switched on. */
  builds?: number;
}
export const fetchCleanup = async (): Promise<CleanupStatus> => json(await fetch('/api/cleanup'), sameOriginImages);
/** Dismantle queues, keep locks in game, undo forgets (and unlocks what keep locked). */
export const decideCleanup = (instanceIds: string[], action: 'dismantle' | 'keep' | 'undo') =>
  act<Partial<CleanupStatus> & { items?: AppraisedItem[]; errors?: string[]; error?: string }>('/api/cleanup/decide', { instanceIds, action }, 'update cleanup');
/** Brings the queue out of the vault onto a character, where the game can dismantle it. */
export const pullCleanup = (characterId: string) =>
  act<Partial<CleanupStatus> & ActionResult>('/api/cleanup/pull', { characterId }, 'pull the queue');
// ── Popular builds (for armor cleanup) ───────────────────────
export interface BuildsResponse { builds: PopularBuild[]; custom: boolean; error?: string }
export const fetchBuilds = async (): Promise<BuildsResponse> => json(await fetch('/api/builds'));
/** Saves the list; `reset` goes back to the starting list. */
export async function saveBuilds(body: { builds: PopularBuild[] } | { reset: true }): Promise<BuildsResponse> {
  try {
    const res = await fetch('/api/builds', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const out = (await res.json().catch(() => ({}))) as BuildsResponse;
    if (!res.ok && !out.error) out.error = res.status === 401 ? 'Sign in again to save builds.' : `Couldn't save builds (${res.status})`;
    return out;
  } catch (err) {
    return { builds: [], custom: false, error: err instanceof Error ? err.message : String(err) };
  }
}
// ── Farming targets ───────────────────────────────────────────
export interface FarmingResponse {
  targets: FarmTarget[];
  /** When vendors were last checked; absent when they couldn't be. */
  vendorsAt?: string;
  vendorError?: string;
  community?: { builtAt: string; samples: number };
  /** False on a server whose item tables predate drop sources. */
  sourcesKnown: boolean;
}
export const fetchFarming = async (refresh = false): Promise<FarmingResponse> =>
  json(await fetch(`/api/farming${refresh ? '?refresh=1' : ''}`), sameOriginImages);
// ── Season tracker ────────────────────────────────────────────
export type SeasonResponse = SeasonSummary & { syncedAt: string };
export const fetchSeason = async (): Promise<SeasonResponse> => json(await fetch('/api/season'), sameOriginImages);
