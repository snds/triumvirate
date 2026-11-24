// Per-device view preferences, kept in localStorage. Storage can be blocked
// (private windows), so every read and write falls back silently.
import { useEffect, useState } from 'react';

export function usePref<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const storageKey = `triumvirate.${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* not saved; fine */ }
  }, [storageKey, value]);
  return [value, setValue];
}

/** Item size steps, as multipliers on the tile size tokens. */
export const TILE_SCALES = [
  { label: 'S', value: 0.8 },
  { label: 'M', value: 1 },
  { label: 'L', value: 1.2 },
  { label: 'XL', value: 1.45 },
] as const;

/** Chat panel width limits, in px. The max also never exceeds 55% of the window. */
export const CHAT_WIDTH = { min: 340, max: 760, default: 460 } as const;
export const clampChatWidth = (w: number, windowWidth = window.innerWidth) =>
  Math.round(Math.max(CHAT_WIDTH.min, Math.min(w, CHAT_WIDTH.max, windowWidth * 0.55)));
