// Responsive hooks. The breakpoints mirror the ones documented in tokens.css; CSS custom
// properties can't be read inside @media, so the values live in both places.
import { useEffect, useState } from 'react';

/** Phones: one store at a time, bottom tab bar, full-screen sheets. Matches the 640px rules in app.css. */
export const COMPACT_QUERY = '(max-width: 640px)';
/** Desktop too narrow for every view in the top bar: Cleanup, Vendors, and Records fold into More. */
export const MID_QUERY = '(min-width: 641px) and (max-width: 1439px)';
/** Narrow desktop: the profile button shows the avatar alone (name and sync time move into its menu). */
export const NARROW_QUERY = '(max-width: 1180px)';
/** No hover (touch screens): tips that say "point at" say "tap" instead. */
export const TOUCH_QUERY = '(hover: none)';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export const useCompact = () => useMediaQuery(COMPACT_QUERY);
