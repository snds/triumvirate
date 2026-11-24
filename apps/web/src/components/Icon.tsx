// UI icons from Google Material Symbols (Rounded), self-hosted via the material-symbols package.
// Destiny-specific icons (elements, stats, currencies) come from Bungie's manifest instead.
const GLYPHS = {
  refresh: 'refresh',
  chevronDown: 'expand_more',
  chevronsLeft: 'keyboard_double_arrow_left',
  chevronsRight: 'keyboard_double_arrow_right',
  panelOpen: 'right_panel_open',
  panelClose: 'right_panel_close',
  signOut: 'logout',
  close: 'close',
  lock: 'lock',
  star: 'star',
  check: 'check',
  cross: 'close',
  power: 'diamond',
  openExternal: 'open_in_new',
  chat: 'forum',
} as const;

export type IconName = keyof typeof GLYPHS;

/** `filled` switches the font's FILL axis on, for solid glyphs like lock and star. */
export function Icon({ name, className, filled }: { name: IconName; className?: string; filled?: boolean }) {
  return (
    <span className={`icon material-symbols-rounded${filled ? ' icon--filled' : ''} ${className ?? ''}`} aria-hidden="true">
      {GLYPHS[name]}
    </span>
  );
}
