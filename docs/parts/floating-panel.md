# Floating panel: `LumenFloatingPanel`

## Use it for

A panel over a live page (a 3D view, a map, a canvas) where a side track or a bottom sheet takes too much room, such as a phone held sideways. It is see-through, the person drags it by its grip, resizes it from its edges or corner, and folds it to its header. Taps outside it reach the page. What it holds stays mounted while folded.

- A phone held upright: `LumenBottomSheet`.
- A desktop side panel: the kit's `Sidebar` in a `Resizable` track.

## Anatomy

```
┌⋮─ header (tabs) ──────── ⌃┐   ⋮ grip: drags it
│ body                      │   ⌃ folds it to the header
│                           │
└──────────────────────────◢┘   edges and corner resize it
```

- Its box is its parent, which must be `relative`. It stays inside it when the box changes size (a phone turning).
- `header`: the top row, between the grip and the fold button. Pair it with `LumenTabs variant="icons"`.
- `storageKey`: the device remembers where the person left it, its size and whether it is folded.
- `folded` / `onFold`: control the fold (a tab tap can open it).

## Do / Don't

✓ `<LumenFloatingPanel title="Panel" storageKey="app:float" header={<LumenTabs variant="icons" … />}>{body}</LumenFloatingPanel>`

✗ An app's own draggable card with pointer handlers.

## Tabs for small panels

`LumenTabs variant`: `row` (default, the rest in More), `stacked` (a phone sheet's bar: the tabs share the row, icon over a short name) and `icons` (icons only, each named in its tooltip and `aria-label`).

## Checked by

No lint rule. Review checks it against this page.
