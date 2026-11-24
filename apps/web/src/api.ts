import type { AppraisedItem, CharacterRow, CleanupCandidate } from '@triumvirate/core';

export interface Inventory {
  signedIn: true;
  displayName: string;
  syncedAt: string;
  manifestVersion: string;
  agentEnabled: boolean;
  characters: CharacterRow[];
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

export async function logout(): Promise<void> {
  await fetch('/api/logout', { method: 'POST' });
}

export async function askAgent(messages: ChatTurn[]): Promise<string> {
  const res = await fetch('/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  });
  return (await json<{ reply: string }>(res)).reply;
}
