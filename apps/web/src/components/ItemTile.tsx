import { useHover } from '../hover.ts';
import { useDrag } from '../drag.ts';
import { useInventory } from '../inventory-context.ts';
import { Icon, type IconName } from './Icon.tsx';
import { ElementIcon } from './ElementIcon.tsx';
import type { AppraisedItem, Verdict } from '@triumvirate/core';

// Maps the item's rarity and element to semantic token names.
const tierClass = (tier: string) => `tier-${tier.toLowerCase() || 'common'}`;
const elementVar = (damage?: string) => (damage ? `var(--element-${damage.toLowerCase()})` : undefined);

export const VERDICT_LABEL: Record<Verdict, string> = {
  god: 'God roll',
  good: 'Recommended roll',
  meh: 'No recommended roll matches',
  trash: 'Marked as trash',
  unrated: 'No wish list data',
};
const BADGE: Partial<Record<Verdict, IconName>> = { god: 'star', good: 'check', meh: 'cross', trash: 'cross' };

export function ItemTile({
  item, size = 'md', onSelect,
}: { item: AppraisedItem; size?: 'md' | 'lg'; onSelect?: (i: AppraisedItem) => void }) {
  const hover = useHover();
  const drag = useDrag();
  const { moving } = useInventory();
  const isMoving = !!item.instanceId && moving.has(item.instanceId);
  const draggable = !!item.movable && !item.equipped && !isMoving;
  const verdict = item.appraisal?.verdict;
  const label = [item.name, item.type, item.damage, item.power && `${item.power} power`,
    verdict && VERDICT_LABEL[verdict], item.locked && 'locked'].filter(Boolean).join(' · ');
  return (
    <button
      type="button"
      className={`tile tile--${size} ${tierClass(item.tier)}${isMoving ? ' is-moving' : ''}${drag.item === item ? ' is-dragging' : ''}`}
      aria-label={label}
      aria-busy={isMoving || undefined}
      draggable={draggable}
      onDragStart={draggable ? (e) => {
        hover?.leave();
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.name);
        drag.start(item);
      } : undefined}
      onDragEnd={draggable ? () => drag.end() : undefined}
      onClick={onSelect ? () => { hover?.leave(); onSelect(item); } : undefined}
      onPointerEnter={hover ? (e) => hover.enter(item, e.currentTarget.getBoundingClientRect()) : undefined}
      onPointerLeave={hover ? () => hover.leave() : undefined}
    >
      {item.icon && <img className="tile__icon" src={item.icon} alt="" loading="lazy" />}
      {item.watermark && <img className="tile__watermark" src={item.watermark} alt="" loading="lazy" />}
      {verdict && BADGE[verdict] && <span className={`tile__badge tile__badge--${verdict}`}><Icon name={BADGE[verdict]} filled /></span>}
      {item.power !== undefined && (
        <span className="tile__power">
          {item.damageIcon
            ? <ElementIcon className="tile__element-icon" damage={item.damage} icon={item.damageIcon} />
            : item.damage && <span className="tile__element" style={{ background: elementVar(item.damage) }} />}
          {item.power}
        </span>
      )}
      {item.locked && <span className="tile__lock"><Icon name="lock" filled /></span>}
      {isMoving && <span className="tile__moving"><span className="spinner" /></span>}
    </button>
  );
}
