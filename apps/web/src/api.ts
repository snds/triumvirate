import type { AccountSummary, AppraisedItem, CharacterRow, CleanupCandidate } from '@triumvirate/core';

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
  cleanup: CleanupCandidate[];
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
