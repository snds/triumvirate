// Bungie's activity-mode glyphs (PvE, Crucible, Raid…) in place of generic icons wherever the app
// names an activity. The glyph is a mask filled with currentColor, so it takes the same color
// states as the text beside it; with no manifest data yet it falls back to a Material Symbol.
import { createContext, useContext } from 'react';
import type { ActivityMode, BuildActivity, Role } from '@triumvirate/core/browser';
import { Icon, type IconName } from './Icon.tsx';

/** modeType values, as in core's MODE (kept here so the browser bundle needs no manifest code). */
export const MODE = { strike: 3, raid: 4, crucible: 5, explore: 6, pve: 7, nightfall: 46, gambit: 63, dungeon: 82, trials: 84 } as const;

export const ROLE_MODE: Record<Role, number> = {
  'pve-endgame': MODE.raid, pve: MODE.pve, patrol: MODE.explore, 'pvp-endgame': MODE.trials, pvp: MODE.crucible, gambit: MODE.gambit,
};
export const BUILD_MODE: Record<BuildActivity, number> = { endgame: MODE.raid, pvp: MODE.crucible, casual: MODE.explore };
export const USE_MODE = { pve: MODE.pve, pvp: MODE.crucible } as const;

const EMPTY: Record<string, ActivityMode> = {};
export const ModesContext = createContext<Record<string, ActivityMode>>(EMPTY);
export const useMode = (mode?: number) => {
  const modes = useContext(ModesContext);
  return mode === undefined ? undefined : modes[mode];
};

export function ModeIcon({ mode, fallback, className }: { mode: number; fallback: IconName; className?: string }) {
  const m = useMode(mode);
  if (!m?.icon) return <Icon name={fallback} className={className} />;
  return <span className={`mode-icon ${className ?? ''}`} style={{ ['--mode-glyph' as string]: `url("${m.icon}")` }} aria-hidden="true" />;
}
