# UI primitives

These are the app's interactive building blocks. Each one wraps a React Aria Components primitive.

- **React Aria** owns behavior: keyboard, focus, screen reader roles, placement, and scroll lock.
- **Our classes** own the look. Tokens live in `../tokens.css` (global → semantic → component) and styles live in `../app.css`.
- **Selected state.** A primitive with one marks it with our own `is-selected` class. Existing CSS reads that class; new CSS may read React Aria's `data-*` attributes instead.

Reach for one of these before hand-building a control. If none fits, add a primitive here rather than wiring roles and key handlers inside a screen.

| Primitive | Use it for | React Aria base |
|---|---|---|
| [Sheet](Sheet.tsx) | Any task panel: settings, editors, digest, optimizer. Bottom sheet on phone, centered on desktop. | ModalOverlay › Modal › Dialog |
| [ItemDialog](ItemDialog.tsx) | The item detail. Modal, except non-modal while the chat panel is open beside it. | ModalOverlay › Modal › Dialog |
| [Menu](Menu.tsx) | A button that opens a list of actions or views (profile, More tab, mid-width nav). | MenuTrigger › Popover › Menu |
| [InfoCard](InfoCard.tsx) | An explainer behind an ⓘ: opens on hover, pins on click, becomes a sheet on touch. | Popover + OverlayArrow, Sheet on touch |
| [HoverCard](HoverCard.tsx) | The item quick look beside a hovered tile. The app decides when it shows. | Tooltip with an always-open state |
| [Tabs](Tabs.tsx) | A row that swaps a region of content (item dialog, Records sections, Rolls options, Settings sections). | Tabs › TabList › Tab, TabPanel |
| [Segmented](Segmented.tsx) | Pick exactly one value from a few (item kind, character pickers, grade floor, class). | ToggleButtonGroup (radio semantics) |
| [Select](Select.tsx) | Pick one from a longer list (exotic, armor set, stat ranks, day, grade). | Select › Popover › ListBox |
| [Switch](Switch.tsx) | A setting that turns on or off right away. | Switch |

## Tabs or Segmented?

Ask what the row changes.

- If it swaps the panel below, use **Tabs**. Screen readers hear "tab, 2 of 5" and the panel is linked to its tab.
- If it picks a value that filters or configures the view, use **Segmented**. Screen readers hear "radio, selected."

Both look the same with `.segmented` and `.segmented__option`.

## Anatomy and tokens

### Sheet
- **Anatomy:** `.sheet-layer` (scrim) › `.sheet-frame` (layout only, `display: contents`) › `.sheet` › handle · header (title + close) · content · footer.
- **Tokens:** `--surface-sheet`, `--shadow-dialog`, `--radius-md`, `--overlay-scrim`.
- **Behavior:**
  - Focus stays inside.
  - The page behind stops scrolling.
  - Escape closes only the top layer.
  - Focus returns to the trigger.

### ItemDialog
- **Anatomy:** `.dialog-scrim` › `.dialog-frame` (layout only) › `.dialog.item-dialog`.
- **Tokens:** `--surface-sheet`, `--shadow-dialog`.
- **Chat open:** the dialog becomes non-modal so the chat stays usable. Escape still closes it unless focus is in the chat.

### Menu
- **Anatomy:** trigger (`triggerClassName`) › `.menu` popover › optional header · `.menu__item` (`.menu__text` label, optional icon and end slot).
- **Tokens:** `--surface-raised`, `--border-subtle`, `--radius-md`, `--shadow-2`, and `--surface-hover` for the focused item.
- **Keyboard:** arrow keys, Home/End, and typeahead.

### InfoCard
- **Anatomy:** `.info-trigger` › `.info-card` › `.info-card__arrow` · `.info-card__title` · body.
- **Placement:** read from `data-placement`.
- **Tokens:** `--surface-raised`, `--border-subtle`, `--shadow-3`.

### HoverCard
- **Anatomy:** `.hovercard` › caller content.
- **Placement:** end/top by default, flipping when there isn't room, kept 8px inside the window. Mouse only, never on touch.

### Tabs
- **Anatomy:** root (`.tabs-root`, `display: contents`) › list (caller class) › tab (caller class, plus `is-selected`); panel (caller class).
- **Rendering:** only the selected panel renders.
- **Tokens:** the caller's own tokens. `.tabs__tab` uses `--accent` for the selected underline; `.segmented__option` uses `--surface-active`.

### Segmented
- **Anatomy:** group (`.segmented` by default) › option (`.segmented__option` by default, plus `is-selected`).
- **Keyboard:** arrow keys move between options and Space or Enter selects. The row has one tab stop.
- **Tokens:** `--surface-raised`, `--surface-active`, `--border-subtle`, `--control-size`.

### Select
- **Anatomy:** root (`className`, for example `.field`) › label (`.field__label`) › trigger (`.select__trigger` plus the caller's look, such as `.optimizer__select` or `.rolls__select`) › value · chevron; popover (`.menu.select__list`) › option (`.menu__item`, `is-selected`, check in `.menu__end`).
- **Sizing:**
  - The list matches the trigger width.
  - It scrolls past 360px.
  - Options are keyed by position, so any value works.
- **Tokens:** `--surface-raised`, `--border-subtle`, `--radius-sm`, `--control-size`, `--accent-text` (selected), `--ring-focus`.

### Switch
- **Anatomy:** `.switch` › `.switch__track` › `.switch__thumb`.
- **State attributes:** `data-selected`, `data-disabled`, `data-focus-visible`.
- **Tokens:** `--switch-width`, `--switch-height`, `--switch-thumb`, `--switch-track-off`, `--switch-track-on`, `--switch-thumb-color`, `--switch-thumb-on`.

## Touch

On coarse pointers, `--control-size` grows to 44px, so every trigger, option, tab, and switch meets the touch-target size. Tooltips and hover cards never open on touch. InfoCard opens as a sheet instead.
