// Per-device view preferences, kept in localStorage. Storage can be blocked
// (private windows), so every read and write falls back silently.
import { useEffect, useRef, useState } from 'react';

/** Every pref lives under this prefix, so a backup can gather them all. */
export const PREF_PREFIX = 'triumvirate.';
/** Fired when a pref changes, so other components reading the same pref (Settings and the view it tunes) stay in step. */
const PREF_EVENT = 'triumvirate:pref';

export function usePref<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const storageKey = `${PREF_PREFIX}${key}`;
  const [value, setValue] = useState<T>(() => readPref(storageKey, initial));
  const first = useRef(true);
  useEffect(() => {
    // The first run only echoes what was just read; writing it back would announce a change that isn't one.
    if (first.current) { first.current = false; return; }
    try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* not saved; fine */ }
    window.dispatchEvent(new CustomEvent(PREF_EVENT, { detail: { key: storageKey, value } }));
  }, [storageKey, value]);
  useEffect(() => {
    const onPref = (e: Event) => {
      const d = (e as CustomEvent<{ key: string; value: T }>).detail;
      if (d.key === storageKey) setValue((v) => (Object.is(v, d.value) ? v : d.value));
    };
    window.addEventListener(PREF_EVENT, onPref);
    return () => window.removeEventListener(PREF_EVENT, onPref);
  }, [storageKey]);
  return [value, setValue];
}

function readPref<T>(storageKey: string, initial: T): T {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw === null ? initial : (JSON.parse(raw) as T);
  } catch {
    return initial;
  }
}

/** Every saved pref, for a backup file. */
export function allPrefs(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(PREF_PREFIX)) continue;
      try { out[k.slice(PREF_PREFIX.length)] = JSON.parse(localStorage.getItem(k)!); } catch { /* skip unreadable */ }
    }
  } catch { /* storage blocked */ }
  return out;
}

/** Writes prefs from a backup; the page reloads after, so every view reads them fresh. */
export function restorePrefs(prefs: Record<string, unknown>): number {
  let n = 0;
  for (const [k, v] of Object.entries(prefs)) {
    if (!/^[\w.-]{1,64}$/.test(k)) continue;
    try { localStorage.setItem(`${PREF_PREFIX}${k}`, JSON.stringify(v)); n++; } catch { /* storage blocked */ }
  }
  return n;
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

/** Auto refresh choices, in minutes; 0 is off. Bungie updates profiles about once a minute at best. */
export const AUTO_REFRESH = [
  { label: 'Off', value: 0 },
  { label: '1 min', value: 1 },
  { label: '2 min', value: 2 },
  { label: '5 min', value: 5 },
  { label: '15 min', value: 15 },
] as const;
