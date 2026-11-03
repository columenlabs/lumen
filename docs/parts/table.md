# Table: `LumenView`, `LumenLayout`

## Use it for

Every list of rows: a page's main table, a card's table, a drawer's runs. A page is a `LumenLayout` over a saved view config; the table is a `LumenView` card in it.

- A handful of label and value pairs: `FactList`.
- Rows that each expand to their own settings: `LumenExpandList` (see [settings.md](settings.md)).
- Header numbers: `TileRow fill` of `Tile`s, not a table.

## Anatomy

```
[ filter tokens…                 ]  ⚙         LumenTokenizedFilter, Columns
Name                      Status      Spend    first column stops at --lead-col-max
Lisbon store              ● Live    $1,204    one line per row, always; numbers right-aligned
▸ Group (3)                          $3,410    roll-up rows carry data-rollup
Total                                $9,882    Total via cardAgg / rollRender
                         ‹ 1 2 3 ›             pager holds its page while rows change in place
```

On a phone each row is a one-line card: the name and one value; the rest waits in the row's drawer.

## Tags

A field whose rows carry several free-form labels (a company's `ai`, `cybersecurity`, `favorite`) sets `tags: true` with `values`: each cell draws `TagChips`, every tag a chip in its colour with an icon first, on one line (past three, a `+N` chip whose hover names them all).

- The colour comes from the tag's name (`tagColor`, the chart palette), so a tag is the same colour on every row, page and app with nothing stored. The icon comes from the tag's words (`tagIcon`: `security` a shield, `ai` sparkles, `data` a database, `favorite` a star); no icon where no word fits.
- `color` and `iconOf` on the field override both (labels the person coloured).
- With `edit.many` the cell is the same chips plus the ✎ picker; the picker's rows carry the same colours and icons.
- Grouped by the field, a single tag's heading takes its colour and icon.
- Outside a table (a drawer, a card) draw the same `TagChips tags={…}`, never `Badge`s or comma text.

```tsx
{ key: 'tags', label: 'Tags', icon: Tags, value: (r) => r.tags.join(', ') || null, values: (r) => r.tags, tags: true, format: 'text', filterable: true }
```

## Resizable columns

Off by default. `configureLumen({ resizableColumns: true })` turns it on for every table in the app; one `LumenView` (or `LumenTable`) overrides with `resizable`. Each header gets a grip on its right edge (desktop only; a phone's rows are cards and a `fit` table wraps instead):

- Drag sets the column's width; a dragged width caps its cells, so a long name ends in an ellipsis with the full text on hover.
- ← and → on the focused grip move it 16px; double-click, Enter or Delete gives the column back its own width.
- Widths are kept on the device per table (`localStorage`, key `lumen:col-widths:<domain id>:<cardId>`); storage off, they last the visit.
- Every column still shows: a wider column makes the table scroll sideways, never drops another.

## Export

The header's Export (`download` control) downloads or copies the table as CSV: the rows shown, or with a filter on, Filtered or All. A table a server pages (`paging`) shows one page, so give `paging.all`, which fetches every row for the filter (the server may cap it), and Export saves those instead of the page.

- ✗ An app's own Download button beside a paged table. ✓ `paging.all`.

## Do / Don't

```tsx
// ✓ a domain, a saved config and rows; a row opens the docked drawer
<LumenView domain={jobsDomain} config={view.config} rows={jobs} onDetails={(r) => setOpen(r.id)} />

// ✗ shadcn Table, two lines in a cell, a unit as text
<Table>…<TableCell>{name}<br /><span className="text-xs">{url}</span></TableCell>…</Table>
<TableCell>{gb + ' GB'}</TableCell>
```

- ✗ A second line in a cell. ✓ One value; more in a hover tooltip or the drawer.
- ✗ `value + unit` text. ✓ `UnitValue`.
- ✗ An app's own pager beside a table. ✓ The view's `pagination` (`size` 10, 25, 50, 100 or 250; 25 by default), drawn by `LumenView`.
- ✗ Resetting the page on a new `rows` array. ✓ Only a new filter, sort, grouping or page size goes back to page 1.
- ✗ Another row of tabs to filter. ✓ A `LumenTokenizedFilter` field.
- ✗ Hiding columns to fit a narrow box (sidebar open, docked drawer). ✓ Every column shows; the table scrolls sideways and the name stays at `--lead-col-max`.
- ✗ Tags as comma text (`r.tags.join(', ')`) or a row of `Badge`s. ✓ `tags: true` on the field, `TagChips` elsewhere.
- ✗ An app's own column-drag code or saved widths. ✓ `configureLumen({ resizableColumns: true })` (every table) or `resizable` on one `LumenView`.

## Checked by

`lumen-ship check parts` rule `tags-text` (tags joined into comma text on a line with no `tags: true`). Review and the app's interaction smoke (AGENTS.md, UI gate 3: lines; Every column always shows: no hidden column at 1024, 1280 or 1440 wide, sidebar open or closed).
