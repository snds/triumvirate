import { useLayoutEffect, useRef, useState } from 'react';
import type { AppraisedItem } from '@triumvirate/core/browser';
import { ItemFacts, itemSummary, PerkGrid, StatBars, VerdictLine } from './ItemParts.tsx';

const GAP = 8;

/** Quick look shown while hovering a tile. Placed beside the tile, flipped to stay on screen. */
export function ItemHovercard({ item, anchor, copies }: { item: AppraisedItem; anchor: DOMRect; copies: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Prefer the right side; fall back to the left, then clamp.
    let left = anchor.right + GAP;
    if (left + width > vw - GAP) left = anchor.left - GAP - width;
    left = Math.max(GAP, left);
    const top = Math.min(Math.max(GAP, anchor.top), vh - height - GAP);
    setPos({ left, top });
  }, [item, anchor]);

  const tier = item.tier.toLowerCase() || 'common';
  return (
    <div
      ref={ref}
      className={`hovercard tier-${tier}`}
      role="tooltip"
      style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden', left: 0, top: 0 }}
    >
      <header className="hovercard__header">
        <strong className="hovercard__name">{item.name}</strong>
        <span className="hovercard__meta">{itemSummary(item)}</span>
      </header>
      <div className="hovercard__body">
        <div className="hovercard__power">
          {item.damageIcon && <img className="hovercard__element" src={item.damageIcon} alt="" />}
          {item.power !== undefined && <span>{item.power}</span>}
          {item.damage && <span className="muted">{item.damage}</span>}
          <span className="muted hovercard__where">{item.equipped ? 'Equipped · ' : ''}{item.location}</span>
        </div>
        <VerdictLine item={item} />
        <ItemFacts item={item} copies={copies} />
        <PerkGrid item={item} />
        <StatBars item={item} compact />
        <p className="hovercard__hint">Click for full details</p>
      </div>
    </div>
  );
}
