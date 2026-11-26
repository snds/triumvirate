import { Switch as AriaSwitch } from 'react-aria-components';

/**
 * On/off for a setting that applies right away. React Aria renders a real (hidden) checkbox with
 * the switch role, so Space toggles it and screen readers say "on" or "off". Name it with
 * `label`, or point `labelledBy` at visible text beside it.
 *
 * Anatomy: switch (`.switch`) › track (`.switch__track`) › thumb (`.switch__thumb`)
 * States: `data-selected` (on), `data-disabled`, `data-focus-visible` (ring on the track)
 */
export function Switch({ checked, onChange, label, labelledBy, title, disabled }: {
  checked: boolean;
  onChange: () => void;
  label?: string;
  labelledBy?: string;
  /** Hover hint on the track. */
  title?: string;
  disabled?: boolean;
}) {
  return (
    <AriaSwitch className="switch" isSelected={checked} onChange={onChange} aria-label={label} aria-labelledby={labelledBy} isDisabled={disabled}>
      <span className="switch__track" title={title}><span className="switch__thumb" /></span>
    </AriaSwitch>
  );
}
