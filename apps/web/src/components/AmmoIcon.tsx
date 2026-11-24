import type { AmmoType } from '@triumvirate/core/browser';

// Ammo type as the game color-codes it: white Primary, green Special, purple Heavy.
// Drawn as one, two, or three rounds so it reads without color too.
const ROUNDS: Record<AmmoType, number> = { Primary: 1, Special: 2, Heavy: 3 };

export function AmmoIcon({ ammo, className }: { ammo?: AmmoType; className?: string }) {
  if (!ammo) return null;
  const n = ROUNDS[ammo];
  const w = 6;
  const gap = 2;
  const width = n * w + (n - 1) * gap;
  return (
    <svg
      className={`ammo-icon ammo-icon--${ammo.toLowerCase()} ${className ?? ''}`}
      viewBox={`0 0 ${width} 16`}
      role="img"
      aria-label={`${ammo} ammo`}
    >
      <title>{`${ammo} ammo`}</title>
      {Array.from({ length: n }, (_, i) => (
        // A round: pointed tip, straight case.
        <path key={i} d={`M${i * (w + gap)} 16V6l${w / 2}-6l${w / 2} 6v10z`} />
      ))}
    </svg>
  );
}
