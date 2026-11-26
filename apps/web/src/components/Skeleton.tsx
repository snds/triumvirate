import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/** Reads a duration token (e.g. --skeleton-wait) in ms, so the timers below follow tokens.css. */
function tokenMs(name: string, fallback: number): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = parseFloat(v);
  return Number.isFinite(n) ? (v.endsWith('ms') ? n : v.endsWith('s') ? n * 1000 : n) : fallback;
}

/** One placeholder block. Shape it with a modifier (line, title, round) and inline width or size. */
export function Sk({ kind, style }: { kind?: 'line' | 'title' | 'round' | 'block'; style?: CSSProperties }) {
  return <span className={`sk${kind ? ` sk--${kind}` : ''}`} style={style} />;
}

/**
 * Shows a skeleton while `loading`, then cross-fades it into the content in the same spot.
 * The skeleton itself waits --skeleton-wait before fading in (CSS), so a quick load never flashes one;
 * if it never became visible, the content simply arrives, with no exit to wait for.
 */
export function Reveal({ loading, skeleton, children, label = 'Loading', className }: {
  loading: boolean;
  skeleton: ReactNode;
  children?: ReactNode;
  /** What screen readers hear while it loads. */
  label?: string;
  className?: string;
}) {
  const [leaving, setLeaving] = useState(false);
  const since = useRef(performance.now());
  const was = useRef(loading);
  useLayoutEffect(() => {
    const before = was.current;
    was.current = loading;
    if (loading && !before) { since.current = performance.now(); setLeaving(false); return; }
    if (!loading && before && performance.now() - since.current > tokenMs('--skeleton-wait', 160)) {
      setLeaving(true);
      const t = setTimeout(() => setLeaving(false), tokenMs('--skeleton-exit', 120));
      return () => clearTimeout(t);
    }
  }, [loading]);

  return (
    <div className={`reveal${className ? ` ${className}` : ''}`} aria-busy={loading || undefined}>
      {(loading || leaving) && (
        <div className={`reveal__skeleton${leaving ? ' is-leaving' : ''}`} aria-hidden>{skeleton}</div>
      )}
      {loading ? <span className="visually-hidden" role="status">{label}</span> : <div className="reveal__content">{children}</div>}
    </div>
  );
}

/** Text blocks: a title, then groups of lines (a heading line and its paragraph). */
export function SkText({ groups = 2, lines = 2, title = true }: { groups?: number; lines?: number; title?: boolean }) {
  const widths = ['92%', '78%', '64%', '86%'];
  return (
    <div className="sk-stack sk-stack--loose">
      {title && <Sk kind="title" style={{ width: '42%' }} />}
      {Array.from({ length: groups }, (_, g) => (
        <div className="sk-stack" key={g}>
          <Sk kind="line" style={{ width: '28%' }} />
          {Array.from({ length: lines }, (_, l) => <Sk kind="line" key={l} style={{ width: widths[(g + l) % widths.length] }} />)}
        </div>
      ))}
    </div>
  );
}

/** Perk columns, as in the item dialog's every-roll grid and the watch editor. */
export function SkPerks({ columns = 4, rows = 4 }: { columns?: number; rows?: number }) {
  return (
    <div className="sk-perks" style={{ '--sk-columns': columns } as CSSProperties}>
      {Array.from({ length: columns * rows }, (_, i) => <Sk kind="round" key={i} />)}
    </div>
  );
}

/** Cards with an icon, two lines, and a meter: season cards, watch list entries, builds. */
export function SkCards({ count = 3 }: { count?: number }) {
  return (
    <div className="sk-cards">
      {Array.from({ length: count }, (_, i) => (
        <div className="sk-card" key={i}>
          <div className="sk-row">
            <Sk kind="block" style={{ width: 40, height: 40 }} />
            <div className="sk-stack"><Sk kind="line" style={{ width: '40%' }} /><Sk kind="title" style={{ width: '62%' }} /></div>
          </div>
          <Sk kind="line" style={{ width: '100%' }} />
        </div>
      ))}
    </div>
  );
}
