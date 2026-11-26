import type { ReactNode } from 'react';

type Key = string | number;
import { Tab as AriaTab, TabList as AriaTabList, TabPanel as AriaTabPanel, Tabs as AriaTabs } from 'react-aria-components';

/**
 * Tabs that swap a region of content. React Aria wires the tab list to its panel, moves between
 * tabs with the arrow keys, and gives the list one tab stop.
 *
 * The root draws nothing (`display: contents`), so the list and the panel can sit anywhere in
 * the caller's layout as long as both are inside it. Only the selected panel is rendered.
 *
 * Anatomy: root › list (`TabList`, caller's class) › tab (`Tab`, selected gets `is-selected`)
 *          root › panel (`TabPanel`, caller's class)
 */
export function Tabs<K extends Key>({ value, onChange, children }: {
  value: K;
  onChange: (value: K) => void;
  children: ReactNode;
}) {
  return (
    <AriaTabs className="tabs-root" selectedKey={value} onSelectionChange={(k) => onChange(k as K)}>
      {children}
    </AriaTabs>
  );
}

export function TabList({ label, className, children }: { label: string; className: string; children: ReactNode }) {
  return <AriaTabList aria-label={label} className={className}>{children}</AriaTabList>;
}

export function Tab({ id, className, label, title, children }: {
  id: Key;
  className: string;
  /** Accessible name when the tab shows only an icon. */
  label?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <AriaTab id={id} aria-label={label} className={({ isSelected }) => `${className}${isSelected ? ' is-selected' : ''}`}>
      {title ? <span title={title} className="segment__inner">{children}</span> : children}
    </AriaTab>
  );
}

/** The selected tab's content. Pass the current value as `id`. */
export function TabPanel({ id, className, children }: { id: Key; className?: string; children: ReactNode }) {
  return <AriaTabPanel id={id} className={className}>{children}</AriaTabPanel>;
}
