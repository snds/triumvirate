import type { ReactNode } from 'react';

type Key = string | number;
import { ToggleButton, ToggleButtonGroup } from 'react-aria-components';

/**
 * Pick exactly one of a few options: the segmented control. React Aria gives it radio semantics
 * (a radio group of radios), arrow keys between options, and one tab stop for the whole row.
 * The look stays with the caller's classes: the selected option gets `is-selected`.
 *
 * Anatomy: group (`className`, default `segmented`) › option (`Segment`, default `segmented__option`)
 */
export function Segmented<K extends Key>({ label, labelledBy, value, onChange, className = 'segmented', children }: {
  label?: string;
  labelledBy?: string;
  value: K;
  onChange: (value: K) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <ToggleButtonGroup
      className={className}
      aria-label={label}
      aria-labelledby={labelledBy}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const [next] = keys;
        if (next !== undefined) onChange(next as K);
      }}
    >
      {children}
    </ToggleButtonGroup>
  );
}

/** One option in a `Segmented` group. `id` is the value it selects. */
export function Segment({ id, className = 'segmented__option', label, title, children }: {
  id: Key;
  className?: string;
  /** Accessible name when the visible content is only an icon or art. */
  label?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <ToggleButton
      id={id}
      aria-label={label}
      className={({ isSelected }) => `${className}${isSelected ? ' is-selected' : ''}`}
    >
      {title ? <span title={title} className="segment__inner">{children}</span> : children}
    </ToggleButton>
  );
}
