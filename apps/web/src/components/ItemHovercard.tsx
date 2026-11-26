import { useRef } from 'react';
import type { AppraisedItem } from '@triumvirate/core/browser';
import { ItemFacts, PerkGrid, StatBars, VerdictLine } from './ItemParts.tsx';
import { ItemHeader } from './ItemHeader.tsx';
import { HoverCard } from '../ui/HoverCard.tsx';

/** Quick look shown while hovering a tile: beside it, flipped to stay on screen. */
export function ItemHovercard({ item, anchor, copies }: { item: AppraisedItem; anchor: Element; copies: number }) {
  const target = useRef<Element | null>(anchor);
  target.current = anchor;
  const tier = item.tier.toLowerCase() || 'common';
  return (
    <HoverCard target={target} className={`hovercard tier-${tier}`}>
      <ItemHeader item={item} size="card" />
      <div className="hovercard__body">
        <p className="hovercard__where">{item.equipped ? 'Equipped · ' : ''}{item.location}</p>
        <VerdictLine item={item} />
        <ItemFacts item={item} copies={copies} />
        <PerkGrid item={item} />
        <StatBars item={item} compact />
        <p className="hovercard__hint">Click for full details</p>
      </div>
    </HoverCard>
  );
}
