import type { AccountSummary, AppraisedItem, ArmorKeep, ArmorSet, PopularBuild, CharacterRow, CleanupCandidate, ClearedItem, CommunityAppraisal, FarmTarget, SeasonSummary, Digest, GameLoadout, Grade, LoadoutStyles, RecordsScreen, ExoticGap, RollOptions, SavedLoadout, VendorGroupView, WatchEntry, WatchHit, WeaponOrnaments, BuildSuggestion } from '@triumvirate/core';

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
  /** Set on the device's saved copy, served by the service worker when there's no connection. */
  offline?: boolean;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Why a load failed, so the app can show the right screen:
 * - `bungie-down`: Bungie maintenance or an outage (retry on a timer)
 * - `server-down`: our server isn't answering, usually restarting after an update (retry soon)
 * - `access`: the Cloudflare Access sign-in for the site ran out (reload to sign in)
 * - `offline`: this device has no connection
 * - `other`: anything else; the message says what
 */
export type FailKind = 'bungie-down' | 'server-down' | 'access' | 'offline' | 'other';

export class AppError extends Error {
  constructor(readonly kind: FailKind, message: string) {
    super(message);
    this.name = 'AppError';
  }
}

/** Sorts any thrown value into a FailKind. A fetch that never got an answer is offline or the server. */
export function failKind(err: unknown): FailKind {
  if (err instanceof AppError) return err.kind;
  if (err instanceof TypeError) return navigator.onLine === false ? 'offline' : 'server-down';
  return 'other';
}

const SERVER_DOWN = 'The app server isn\'t answering. It may be restarting after an update.';

/**
 * Points every Bungie image at our own server, which keeps a copy on disk and tells the browser
 * to cache it for a year. Reloads then draw art from the browser cache instead of popping in.
 */
const sameOriginImages = (text: string) => text.replaceAll('"https://www.bungie.net/', '"/api/bungie-img/');

async function json<T>(res: Response, transform?: (text: string) => string): Promise<T> {
  const raw = await res.text();
  const text = transform ? transform(raw) : raw;
  let body: T & { error?: string; kind?: string };
  try { body = JSON.parse(text); } catch {
    // Cloudflare answers an expired Access sign-in with its own HTML page; a proxy answers a
    // stopped or restarting server with an empty 502.
    if (res.status === 403 || res.status === 401) throw new AppError('access', 'Your sign-in to this site ran out.');
    throw new AppError(res.ok ? 'other' : 'server-down', res.ok ? 'The app server sent back something unreadable.' : SERVER_DOWN);
  }
  if (!res.ok) {
    const kind: FailKind = body.kind === 'bungie-down' || body.kind === 'access' ? body.kind : 'other';
    throw new AppError(kind, body.error ?? `Request failed (${res.status})`);
  }
  return body;
}

/** Not signed in to Bungie; `reason` is set when a sign-in ran out rather than never happened. */
export interface SignedOut { signedIn: false; reason?: 'expired' }

/** Resolves to SignedOut when not signed in. Throws an AppError when it can't load. */
export async function fetchInventory(refresh = false): Promise<Inventory | SignedOut> {
  // A restart takes a few seconds; ride out a short one before giving up.
  for (let attempt = 0; ; attempt++) {
    try {
      // Our server never redirects this call, so a redirect is Cloudflare Access sending you to sign in.
      const res = await fetch(`/api/inventory${refresh ? '?refresh=1' : ''}`, { redirect: 'manual' });
      if (res.type === 'opaqueredirect') throw new AppError('access', 'Your sign-in to this site ran out.');
      if (res.status === 401) {
        const body = (await res.json().catch(() => ({}))) as { reason?: string };
        return { signedIn: false, reason: body.reason === 'expired' ? 'expired' : undefined };
      }
      const inv = await json<Inventory>(res, sameOriginImages);
      if (res.headers.get('x-triumvirate-saved')) inv.offline = true;
      return inv;
    } catch (err) {
      const kind = failKind(err);
      if (kind !== 'server-down' || attempt >= 3) throw err instanceof AppError ? err : new AppError(kind, kind === 'offline' ? 'You\'re offline.' : SERVER_DOWN);
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

/** The ornaments one weapon copy can wear, default first. Empty when it has none to choose. */
export const fetchOrnaments = async (instanceId: string): Promise<WeaponOrnaments> =>
  json(await fetch(`/api/items/${encodeURIComponent(instanceId)}/ornaments`), sameOriginImages);

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

export interface CollectResult extends ActionResult {
  /** Postmaster items pulled, and spares sent to the vault to make room. */
  pulled?: number;
  toVault?: number;
}
export const collectPostmaster = (characterId: string) => act<CollectResult>('/api/postmaster/collect', { characterId }, 'collect the postmaster');

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
export interface BuildsResponse {
  builds: PopularBuild[];
  custom: boolean;
  /** Popular exotics from the community crawl that the list doesn't have yet. Optional so an older server still renders. */
  suggestions?: BuildSuggestion[];
  /** When the community build data was built and from how many samples; absent before any crawl. */
  community?: { builtAt: string; samples: number };
  error?: string;
}
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
// ── Settings ──────────────────────────────────────────────────
export interface WishListSourceInfo {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  rolls: number;
  updatedAt?: string;
  error?: string;
}
export interface WishListsResponse { sources: WishListSourceInfo[]; error?: string }
export const fetchWishLists = async (): Promise<WishListsResponse> => json(await fetch('/api/settings/wishlists'));
/** Sends a wish list change. Never throws; a failure comes back as `error`. */
async function wishListCall(path: string, method: string, body?: unknown): Promise<WishListsResponse> {
  try {
    const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const out = (await res.json().catch(() => ({}))) as WishListsResponse;
    if (!res.ok && !out.error) out.error = `Couldn't update wish lists (${res.status})`;
    return out;
  } catch (err) {
    return { sources: [], error: err instanceof Error ? err.message : String(err) };
  }
}
export const addWishList = (url: string) => wishListCall('/api/settings/wishlists', 'POST', { url });
export const refreshWishLists = () => wishListCall('/api/settings/wishlists/refresh', 'POST', {});
export const setWishListEnabled = (id: string, enabled: boolean) => wishListCall(`/api/settings/wishlists/${encodeURIComponent(id)}`, 'PATCH', { enabled });
export const removeWishList = (id: string) => wishListCall(`/api/settings/wishlists/${encodeURIComponent(id)}`, 'DELETE');

export interface ServerStatus {
  now: string;
  syncedAt: string | null;
  manifestVersion: string | null;
  crawl: {
    hour: number | null;
    running: boolean;
    startedAt: string | null;
    lastRun: { finishedAt: string; requests: number; matches: number; samples: number; error?: string } | null;
    rollupBuiltAt: string | null;
    samples: number;
  };
  digest: { hour: number | null; latest: { date: string; builtAt: string } | null };
  watch: { everyMinutes: number | null; entries: number; checkedAt: string | null };
  alerts: boolean;
  agent: boolean;
  wishLists: WishListSourceInfo[] | null;
}
export const fetchStatus = async (): Promise<ServerStatus> => json(await fetch('/api/status'));

export interface BackupFile {
  app: 'triumvirate';
  kind: 'backup';
  version: number;
  exportedAt: string;
  data: Record<string, unknown>;
  /** This device's view settings (item size, roll filters...). */
  prefs?: Record<string, unknown>;
}
export const fetchBackup = async (): Promise<BackupFile> => json(await fetch('/api/backup'));
export const restoreBackup = (file: BackupFile) => act<{ restored?: string[]; error?: string }>('/api/backup', file, 'restore the backup');
// ── Vendors ───────────────────────────────────────────────────
export interface VendorsResponse {
  characterId: string;
  characters: { id: string; className: string; classType: number; emblemBackground?: string }[];
  fetchedAt: string;
  groups: VendorGroupView[];
  /** Rolled weapons and armor on sale, by row id (`vendor-<vendor>-<index>`), shaped like inventory items. */
  items: Record<string, AppraisedItem>;
  /** Community grade per weapon row id. */
  grades: Record<string, CommunityAppraisal>;
  /** Builds each armor row would be best in slot for. */
  fits: Record<string, string[]>;
}
/** One character's vendors; `refresh` asks Bungie again instead of the 15-minute copy. */
export const fetchVendors = async (characterId?: string, refresh = false): Promise<VendorsResponse> => {
  const q = new URLSearchParams();
  if (characterId) q.set('character', characterId);
  if (refresh) q.set('refresh', '1');
  return json(await fetch(`/api/vendors${q.size ? `?${q}` : ''}`), sameOriginImages);
};
// ── Records ───────────────────────────────────────────────────
export type RecordsResponse = RecordsScreen & {
  characterId?: string;
  characters: { id: string; className: string }[];
  fetchedAt: string;
  /** Record hashes tracked in this app. */
  pinned: number[];
  /** Exotics in your collections you haven't picked up. Optional so an older server still renders. */
  exotics?: ExoticGap[];
};
/** Titles, triumphs, tracked, and nearly done for one character; `refresh` asks Bungie again. */
export const fetchRecords = async (characterId?: string, refresh = false): Promise<RecordsResponse> => {
  const q = new URLSearchParams();
  if (characterId) q.set('character', characterId);
  if (refresh) q.set('refresh', '1');
  return json(await fetch(`/api/records${q.size ? `?${q}` : ''}`), sameOriginImages);
};
/** Tracks or untracks a triumph in this app. */
export const trackRecord = (hash: number, tracked: boolean) => act<{ tracked?: number[]; error?: string }>('/api/records/track', { hash, tracked }, 'track that triumph');

/** Claude connected to this server over MCP (see the server's mcp.ts). */
export interface McpStatus {
  /** The address to paste into Claude as a custom connector. */
  url: string;
  connections: { id: string; name: string; connectedAt: string; lastUsedAt?: string }[];
}
export const fetchMcp = async (): Promise<McpStatus> => json(await fetch('/api/mcp'));
export const disconnectMcp = async (id: string): Promise<void> => { await json(await fetch(`/api/mcp/${encodeURIComponent(id)}`, { method: 'DELETE' })); };
