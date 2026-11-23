# Phone drawer: `LumenPhoneDrawer`

## Use it for

A phone's panel that a toolbar button opens beside a live page (a 3D view, a map, a canvas): Parts, Parameters, Versions, a chat. Upright it rises from the bottom; held sideways it docks at the right. Its header is a window's: minimize, maximize or restore, close. No dim and no blur, so the page stays live. Closed, it stays mounted, so an answer or an upload inside it keeps going.

- A panel the person drags between rests with a grab bar: `LumenBottomSheet`.
- A see-through panel the person moves and resizes over the page: `LumenFloatingPanel`.
- The details or editor of one row of a list: `LumenDrawer`.

## Anatomy

```
 upright                 minimized              maximized           sideways
┌──────────────┐        ┌──────────────┐       ┌──────────────┐    ┌────────┬─────┐
│ page (live)  │        │ page (live)  │       │▣ Title  slot │    │ page   │▣ … │
│              │        │              │       │      − ❐ ×   │    │ (live) │−□×  │
├──────────────┤        │              │       │ body         │    │        │body │
│▣ Title slot −□×│      │              │       │              │    │        │     │
│ body         │        ├──────────────┤       │ (page hidden,│    │        │     │
└──────────────┘        │▣ Title  ❐□×  │       │  still there)│    └────────┴─────┘
                        └──────────────┘       └──────────────┘    minimized: a 48 px rail
```

- Header, one row (48 px): the panel's `icon`, its `title`, the slot, the panel's `actions`, then Minimize (`Minus`), Maximize (`Square`) or Restore (`Copy`), and Close (`X`). The controls are plain ghost `IconButton`s, edge to edge, one size; each tooltip names the panel ("Close Parts").
- Sizes (`size` / `onSizeChange`, or its own, starting `normal`): `normal` is 55% of the area upright and 340 px (at most 45%) sideways; `min` is the header only upright and a 48 px rail sideways (controls stacked, title hidden); `max` takes the whole area, and the page beside it gets no room but stays mounted, so Restore brings it back as it was. Restore from either goes to `normal`.
- The slot: a panel puts its own top row there with `PhoneDrawerHeader` (a count and Show all; undo, redo and "v6 of 6"; progress), so it never adds a row of its own. While the slot holds something the title hides (it stays the region's name). `usePhoneDrawerHeader()` is the slot, or null outside a drawer: a panel drawn on a desktop too reads it to draw its own row there instead.
- Filter chips in the slot are `PhoneDrawerFilter`: one joined group (All | Favorites | Changed), right after the icon.
- The body fills what is on screen. Rows inside are compact (about 30 px), with no indent a row does not need.
- Layout: the drawer and the page share one flex box (a column upright, a row sideways); the page is `min-h-0 min-w-0 flex-1`.
- Screen height: the full-screen box around them is `lumen-screen`, never `h-svh`, with `useScreenHeight()` called once in it. iOS Safari with its tabs at the bottom counts the strip under its own controls in `100svh`, so an `h-svh` page draws the drawer's bottom (a chat's text box) under them. `useScreenHeight` keeps `--lumen-screen-h` to what the browser shows (the visual viewport, so the keyboard too); `lumen-screen` falls back to `100svh` until it is measured.

## Do / Don't

✓ `<LumenPhoneDrawer title="Parameters" icon={SlidersIcon} open={open} sideways={sideways} onClose={() => setOpen(false)}>{panel}</LumenPhoneDrawer>`

✓ Inside the panel: `<PhoneDrawerHeader><PhoneDrawerFilter options={…} value={filter} onChange={setFilter} /></PhoneDrawerHeader>`

✗ A row of its own under the header for the panel's count, filter or undo: put it in the slot.

✗ `h-svh` (or `h-screen`, `100dvh`) on the full-screen box around a drawer: `lumen-screen`.

✗ An app's own Minimize, Maximize or Close buttons, a `ButtonGroup` of them, or chevrons for size.

✗ A hint or helper line in the drawer, or a backdrop or blur behind it.

✗ Unmounting the panel on close: `open={false}` keeps it, and its work, running.

## Checked by

`lumen-ship check parts` rule `phone-drawer`: an app's own control named "Minimize …" or "Maximize …".
