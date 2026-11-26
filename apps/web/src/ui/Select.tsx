import { Button, Label, ListBox, ListBoxItem, Popover, Select as AriaSelect, SelectValue } from 'react-aria-components';
import { Icon } from '../components/Icon.tsx';

export type SelectOption<V> = { value: V; label: string };

/**
 * Pick one from a list: the app's select. React Aria draws the list in our own popover, so long
 * lists scroll inside the screen, options can be read with the arrow keys or by typing, and the
 * list looks the same on every platform.
 *
 * Options are keyed by position, so any value works (including an empty string for "none").
 *
 * Anatomy: root (`className`) › label (visible `label`, or `ariaLabel` only)
 *          › trigger (`triggerClassName`) › value + chevron
 *          › popover (`.menu.select__list`) › option (`.menu__item`, selected gets `is-selected`)
 */
export function Select<V extends string | number>({ label, ariaLabel, value, options, onChange, className, labelClassName = 'field__label', triggerClassName = 'select__trigger' }: {
  /** Visible label above or beside the trigger. */
  label?: string;
  /** Accessible name when there is no visible label. */
  ariaLabel?: string;
  value: V;
  options: readonly SelectOption<V>[];
  onChange: (value: V) => void;
  className?: string;
  labelClassName?: string;
  triggerClassName?: string;
}) {
  const at = options.findIndex((o) => o.value === value);
  return (
    <AriaSelect
      className={className}
      aria-label={label ? undefined : ariaLabel}
      selectedKey={at >= 0 ? at : null}
      onSelectionChange={(k) => { if (k !== null) onChange(options[Number(k)]!.value); }}
    >
      {label && <Label className={labelClassName}>{label}</Label>}
      <Button className={triggerClassName}>
        <SelectValue className="select__value" />
        <Icon name="chevronDown" className="select__chevron" />
      </Button>
      <Popover className="menu select__list" offset={4}>
        <ListBox className="select__options">
          {options.map((o, i) => (
            <ListBoxItem key={i} id={i} textValue={o.label} className={({ isSelected }) => `menu__item${isSelected ? ' is-selected' : ''}`}>
              {({ isSelected }) => <><span className="menu__text">{o.label}</span>{isSelected && <Icon name="check" className="menu__end" />}</>}
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </AriaSelect>
  );
}
