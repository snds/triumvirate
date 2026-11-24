// Small inline icon set (24px grid, stroke-based) so icons pick up currentColor.
const PATHS = {
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  chevronDown: 'M6 9l6 6 6-6',
  chevronsLeft: 'M11 17l-5-5 5-5M18 17l-5-5 5-5',
  chevronsRight: 'M13 17l5-5-5-5M6 17l5-5-5-5',
  // A panel with its right side marked: the chat panel.
  panelRight: 'M4 4h16v16H4zM15 4v16',
  signOut: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  close: 'M6 6l12 12M18 6L6 18',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={`icon ${className ?? ''}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
