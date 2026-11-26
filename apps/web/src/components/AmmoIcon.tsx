import type { AmmoType } from '@triumvirate/core/browser';

// The in-game ammo badge, drawn from its intended construction rather than Bungie's 80px bitmap:
// a stroked frame with 45° chamfered corners holding one, two, or three rounds. Each round is a
// straight case with a separate pointed tip above it. Shapes only: color comes from CSS
// (white Primary, green Special, purple Heavy), and the round count reads without color too.
const ROUNDS: Record<AmmoType, number> = { Primary: 1, Special: 2, Heavy: 3 };

// Geometry, in viewBox units (34 × 24).
const W = 34;
const H = 24;
const STROKE = 2.5;
const CHAMFER = 4;
const ROUND_W = 3.8;
const ROUND_GAP = 2.4;
const TIP_H = 4.2;
const TIP_GAP = 1; // between tip and case
const CASE_H = 7.4;
/** Where the tip's straight sides end and its curve begins, as a share of the tip's height. */
const SHOULDER = 0.35;

/** The frame: a rectangle with all four corners cut at 45°, inset so the stroke stays inside. */
function framePoints() {
  const i = STROKE / 2;
  const [l, t, r, b, c] = [i, i, W - i, H - i, CHAMFER];
  return [[l + c, t], [r - c, t], [r, t + c], [r, b - c], [r - c, b], [l + c, b], [l, b - c], [l, t + c]]
    .map(([x, y]) => `${x},${y}`).join(' ');
}

export function AmmoIcon({ ammo, className }: { ammo?: AmmoType; className?: string }) {
  if (!ammo) return null;
  const n = ROUNDS[ammo];
  const groupW = n * ROUND_W + (n - 1) * ROUND_GAP;
  const x0 = (W - groupW) / 2;
  const roundH = TIP_H + TIP_GAP + CASE_H;
  const top = (H - roundH) / 2;
  return (
    <svg
      className={`ammo-icon ammo-icon--${ammo.toLowerCase()} ${className ?? ''}`}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`${ammo} ammo`}
    >
      <title>{`${ammo} ammo`}</title>
      <polygon className="ammo-icon__frame" points={framePoints()} fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinejoin="miter" />
      {Array.from({ length: n }, (_, i) => {
        const x = x0 + i * (ROUND_W + ROUND_GAP);
        const caseTop = top + TIP_H + TIP_GAP;
        return (
          <g key={i} fill="currentColor">
            {/* Tip: an ogive, two arcs (radius = the case width) meeting at a point, over short
                straight sides. */}
            <path d={`M${x} ${top + TIP_H}V${top + TIP_H * (1 - SHOULDER)}A${ROUND_W} ${ROUND_W} 0 0 1 ${x + ROUND_W / 2} ${top}A${ROUND_W} ${ROUND_W} 0 0 1 ${x + ROUND_W} ${top + TIP_H * (1 - SHOULDER)}V${top + TIP_H}Z`} />
            <rect x={x} y={caseTop} width={ROUND_W} height={CASE_H} />
          </g>
        );
      })}
    </svg>
  );
}
