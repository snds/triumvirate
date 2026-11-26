import type { ReactNode } from 'react';
import { Button, Menu as AriaMenu, MenuItem, MenuTrigger, Popover, type Placement } from 'react-aria-components';

export interface MenuEntry {
  id: string;
  label: string;
  /** Leading icon (an <Icon />). */
  icon?: ReactNode;
  /** Trailing content, e.g. a count badge. */
  end?: ReactNode;
  /** The entry for the view you're on. */
  selected?: boolean;
}

/**
 * A button that opens a menu of actions. React Aria gives it arrow keys, typeahead, Home/End,
 * Escape, and focus return; it opens on tap without a hover flash. Looks come from the classes.
 *
 * Anatomy: trigger (Button, `triggerClassName`) › popover (`className`, default .menu)
 *   › header (optional, not focusable) · items (.menu__item, or `itemClassName`)
 */
export function Menu({ label, trigger, triggerClassName, triggerLabel, items, onAction, header, placement = 'bottom end', className = 'menu', itemClassName = 'menu__item', offset = 4 }: {
  /** Names the menu for screen readers. */
  label: string;
  trigger: ReactNode;
  triggerClassName: string;
  /** The trigger's accessible name, when its content is only an icon or needs more context. */
  triggerLabel?: string;
  items: MenuEntry[];
  onAction: (id: string) => void;
  header?: ReactNode;
  placement?: Placement;
  className?: string;
  itemClassName?: string;
  offset?: number;
}) {
  return (
    <MenuTrigger>
      <Button className={triggerClassName} aria-label={triggerLabel}>{trigger}</Button>
      <Popover className={className} placement={placement} offset={offset}>
        {header}
        <AriaMenu aria-label={label} className="menu__list" onAction={(key) => onAction(String(key))}>
          {items.map((i) => (
            <MenuItem key={i.id} id={i.id} textValue={i.label} className={`${itemClassName}${i.selected ? ' is-selected' : ''}`}>
              {i.icon}
              <span className="menu__text">{i.label}</span>
              {i.end}
            </MenuItem>
          ))}
        </AriaMenu>
      </Popover>
    </MenuTrigger>
  );
}
