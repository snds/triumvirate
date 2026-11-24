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

async function json<T>(res: Response): Promise<T> {
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

/** Resolves to null when not signed in. */
export async function fetchInventory(refresh = false): Promise<Inventory | null> {
  const res = await fetch(`/api/inventory${refresh ? '?refresh=1' : ''}`);
  if (res.status === 401) return null;
  return json<Inventory>(res);
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
