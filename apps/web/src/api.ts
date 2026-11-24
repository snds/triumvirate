import type { CharacterRow, ItemRow } from '@triumvirate/core';

export interface Inventory {
  signedIn: true;
  displayName: string;
  syncedAt: string;
  manifestVersion: string;
  characters: CharacterRow[];
  items: ItemRow[];
}

/** Resolves to null when not signed in. */
export async function fetchInventory(refresh = false): Promise<Inventory | null> {
  const res = await fetch(`/api/inventory${refresh ? '?refresh=1' : ''}`);
  if (res.status === 401) return null;
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

export async function logout(): Promise<void> {
  await fetch('/api/logout', { method: 'POST' });
}
