# Board: `LumenBoard`

## Use it for

Items by stage, side by side: a plan's checkpoints and their tasks, a pipeline's steps, a hiring loop. Columns and items come in as data; the app opens an item in its own drawer.

- A long list to sort, filter or total: `LumenView` (see [table.md](table.md)), grouped by stage.
- Items on days: `LumenCalendar` (see [calendar.md](calendar.md)).

## Anatomy

```
┌ Checkpoint 1     12 ┐ ┌ Checkpoint 2      9 ┐   header: label (truncates), count
│ ☐ Task title… Oct 3 ⇄│ │ ☐ Task title  Review│   card: tick slot, title, meta, badges, Move to (hover)
│ ☑ Task title        │ │                     │   each column scrolls on its own (maxHeight)
│        …            │ │    Nothing here     │   an empty column's line
└─────────────────────┘ └─────────────────────┘   the board scrolls sideways in its own box
```

- `columns`: `{ id, label, count? }`; `count` defaults to the number of items in it.
- `items`: `{ id, column, title, meta?, badges? }`. `renderCard(item)` draws the card's body instead; keep it to one line.
- `tick(item)`: a slot before the title, such as a done `Checkbox`.
- `onOpen(item)` opens the app's drawer. `onMove(item, toColumn)` adds a Move to menu on each card: shown on hover or focus, always on a touch screen, and fully usable by keyboard. No drag library.
- On a box under 640px wide the columns become a snap scroller, one column a screen, with a `LumenSelector` above to jump to one; it follows the swipe.

## Do / Don't

```tsx
// ✓ data in, the drawer out, moves through the menu
<LumenBoard columns={checkpoints} items={tasks}
  tick={(t) => <Checkbox checked={t.done} onCheckedChange={(v) => setDone(t.id, v === true)} />}
  onOpen={(t) => setOpen(t.id)} onMove={(t, to) => move.mutate({ id: t.id, to })} />

// ✗ a card on two lines, a text button, the page scrolling sideways
<div className="flex">{cols.map((c) => <div className="w-80">…<p>{t.title}<br />{t.notes}</p>
  <Button>Move</Button></div>)}</div>
```

- ✗ Notes or a description on the card. ✓ One line; the rest is in the drawer.
- ✗ A drag-and-drop library for moves. ✓ `onMove`; the Move to menu works by keyboard and touch.
- ✗ Columns that stretch the page wider than the screen. ✓ The board scrolls inside itself.

## Checked by

Review and the app's interaction smoke (AGENTS.md, UI gate 1 and 3: reach and lines).
