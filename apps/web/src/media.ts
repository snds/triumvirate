// Responsive hooks. The breakpoints mirror the ones documented in tokens.css; CSS custom
// properties can't be read inside @media, so the values live in both places.
import { useEffect, useState } from 'react';

/** Phones: one store at a time, bottom tab bar, full-screen sheets. Matches the 640px rules in app.css. */
export const COMPACT_QUERY = '(max-width: 640px)';
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
