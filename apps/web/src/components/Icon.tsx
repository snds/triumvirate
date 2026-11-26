// UI icons from Google Material Symbols (Rounded), self-hosted via the material-symbols package.
// Destiny-specific icons (elements, stats, currencies) come from Bungie's manifest instead.
const GLYPHS = {
  refresh: 'refresh',
  chevronDown: 'expand_more',
  chevronRight: 'chevron_right',
  chevronsLeft: 'keyboard_double_arrow_left',
  chevronsRight: 'keyboard_double_arrow_right',
  signOut: 'logout',
  close: 'close',
  lock: 'lock',
  star: 'star',
  check: 'check',
  cross: 'close',
  power: 'diamond',
  openExternal: 'open_in_new',
  chat: 'forum',
  newChat: 'edit_square',
  history: 'history',
  autorenew: 'autorenew',
  ornament: 'palette',
  delete: 'delete',
  back: 'arrow_back',
  crafted: 'construction',
  tracker: 'my_location',
  copies: 'filter_none',
  enhanced: 'keyboard_double_arrow_up',
  arrowRight: 'arrow_forward',
  arrowUp: 'arrow_upward',
  pve: 'shield',
  pvp: 'swords',
  both: 'star',
  filter: 'filter_alt',
  sort: 'sort',
  activity: 'notifications',
  settings: 'settings',
  vendor: 'storefront',
  drop: 'new_releases',
  inventory: 'inventory_2',
  cleanup: 'delete_sweep',
  rolls: 'casino',
  vault: 'shelves',
  options: 'tune',
  search: 'search',
  clear: 'cancel',
  lockOpen: 'lock_open',
  equip: 'apparel',
  loadouts: 'checkroom',
  game: 'stadia_controller',
  save: 'bookmark_add',
  edit: 'edit',
  add: 'add',
  more: 'more_horiz',
  import: 'download',
  warning: 'warning',
  today: 'today',
  alertsOff: 'notifications_off',
  autopilot: 'auto_delete',
  pull: 'unarchive',
  info: 'info',
  select: 'checklist',
  checkCircle: 'check_circle',
  target: 'target',
  sale: 'sell',
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
