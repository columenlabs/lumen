# Filter panel: `LumenFilterPanel`

## Use it for

A list big enough that people browse it by facets (company, tag, place, level, date): each field becomes a section of values with counts, ticked in place, beside the list. It is the filter box laid out as a panel. Both read and write one `useLumenFilter` state, so a tick is a chip in the box and a chip's × unticks it in the panel.

- A short list, or one or two fields: the filter box alone (`LumenTokenizedFilter`).
- A choice that switches the whole page (All, Review, Pending): `LumenTabs`.

## Anatomy

```
desktop                                   phone
┌ Filters 3        ↺  ⇤ ┐  [≡3] [chips…]  [▽ 3] [chips…]    (filter icon, count)
│ Company (i)        ⊘  │                 ┌──── ▬ ───────────┐
│ ☑ Cloudflare     41   │                 │ Filters        × │  bottom sheet,
│ ☐ Apple         212   │                 │ 3 on           ↺ │  same body
│   61 more             │                 │ Company (i)      │
│ Fit (number)          │                 │ ☑ Cloudflare  41 │
│ [From] – [To]         │                 └──────────────────┘
└───────────────────────┘
```

- **Counts** come from `useFacetCounts`, the box's own: a field counts the rows the other fields keep, so picking one value never hides its siblings. Over one page of a server's rows, pass the server's counts as `facets` (from the same find query that returns the page). The kit never counts a page as if it were every row.
- **Hide** (⇤) folds the panel to the filter icon in the filter row. Whether it is open is kept per device, per page `id`. A phone starts closed and opens the sheet from that icon.
- **⊘** on a field leaves its ticked values out instead of keeping them, like Exclude on a chip.
- A field with more than six values shows the most common first, with "N more" (and a search past ten). "No <field>" sits on top when some rows have no value.

## Do / Don't

```tsx
// ✓ on a page: the layout draws the panel, the icon and the sheet
<LumenLayout
  domain={domain}
  config={config}
  rows={page.rows}
  paging={paging}
  onTokens={setTokens}           // the server reads the chips
  facets={page.facets}           // and counts each field over every row
  filterPanel={{ id: 'roles', tips: { fit: 'Sage scores roles you open or save.' } }}
/>

// ✓ outside a layout: one state, both views
const filter = useLumenFilter(rows, fields);
const panel = useFilterPanel('stores');
<LumenFilterPanel filter={filter} {...panel} />
<LumenFilterPanelButton filter={filter} {...panel} />
<LumenTokenizedFilter filter={filter} />

// ✗ a second filter state for the panel, or checkbox lists of the app's own
const [picked, setPicked] = useState<string[]>([]);
```

- ✗ Counting a server's page in the browser. ✓ `facets` from the server's find query.
- ✗ A grey hint line under a section. ✓ `tips` puts it in an InfoTip.
- ✗ Text buttons (Clear all, Apply). ✓ Ticks apply at once; Clear and Hide are icons.

## Checked by

`raw-overlay`, `hint-text` and `text-action` (see [README](README.md#checked-by)).
