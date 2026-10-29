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
- ✗ Resetting the page on a new `rows` array. ✓ Only a new filter, sort, grouping or page size goes back to page 1.
- ✗ Another row of tabs to filter. ✓ A `LumenTokenizedFilter` field.
- ✗ Hiding columns to fit a narrow box (sidebar open, docked drawer). ✓ Every column shows; the table scrolls sideways and the name stays at `--lead-col-max`.

## Checked by

Review and the app's interaction smoke (AGENTS.md, UI gate 3: lines; Every column always shows: no hidden column at 1024, 1280 or 1440 wide, sidebar open or closed).
