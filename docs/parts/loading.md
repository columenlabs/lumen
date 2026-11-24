# Loading: `LumenLoading`

## Use it for

Every screen, section or card whose parts draw from reads that may not have answered yet. While they run, each part draws its own shape with bars in the slots data will fill, so the screen does not jump when the data lands. Nothing reads as empty, missing or "not set up" until a read has answered that way.

- Wrap the parts that draw from the reads: `<LumenLoading load={useLumenLoad(q1, q2)}>`.
- A failed read puts the kit's error with Retry in the scope's place. Never draw the empty or signed-out state for a read that failed.
- A card that loads its own source still uses `useLumenSource` and `LumenStates`, which this scope sits on.

## Anatomy

What each part draws inside a loading scope:

| Part | While loading |
|---|---|
| `LumenExpandRow` | Its fixed name and icon stay (an icon bar, size 8, where there is none); `meta` and the switch or `end` are bars; no health dot; it does not open |
| `LumenExpandList id` | As many bar rows as it showed last time on this device (`useRememberedCount`, 3 on the first visit). A list without `id` lets its rows draw themselves |
| `SettingField` | Its label stays; the control and `end` are bars |
| `LumenConnection` | Its row as above, so no "Not set up" meta and no Add |
| `Tile`, `TileToggleGroup` | Its label stays; the number, caption, lines and spark are bars of the same heights |
| `FactList` | Its labels stay; each value is a bar |
| `LumenView`, `LumenTable` | Its own header, then the rows it showed last as bars in each column, numbers on the right edge. No empty state, "No rows match", count, pager or Total |

A section built from its data (it cannot draw its rows before the read answers) uses `LumenPending` instead: `<LumenPending id="…" load={load} data={q.data}>{(data) => …}</LumenPending>`. Until the read answers it draws the order of field rows and expand rows the section showed last time on this device, each as bars (`shape` fixes it when the caller knows it, such as `"r"` for one row). A failed read shows the kit's error with Retry. The kit's own assistant, notification and email settings use it.

A part that draws data reads the scope with `useLumenLoading()` and draws a `LoadingBar` in each slot. A new data part does the same.

## Do / Don't

```tsx
// ✓ One scope over the section's reads; the parts draw their own shape.
const keys = useQuery(passkeysQuery);
const sessions = useQuery(sessionsQuery);
<LumenLoading load={useLumenLoad(keys, sessions)}>
  <LumenExpandList id="passkeys">
    {(keys.data ?? []).map((k) => <LumenExpandRow key={k.id} name={k.name} … />)}
  </LumenExpandList>
</LumenLoading>

// ✗ Loading drawn as empty: the empty state, Add or "Not set up" shows until the read lands.
const list = keys.data ?? [];
{list.length === 0 && <Empty>No passkeys yet</Empty>}

// ✗ A blank pane or a "Loading…" line while a read runs.
if (!keys.data) return null;
if (keys.isPending) return <p>Loading…</p>;

// ✗ A skeleton of the page's own: generic bars that are not the shape that lands.
{keys.isPending && <Skeleton className="h-40 w-full" />}
```

## Checked by

The `lumen-ship check parts` rules `loading-as-empty` and `hand-skeleton` are planned. Until they land, a reviewer checks it: a screen read with every `/api` call slowed by 1.5 s shows no empty state, no Add, no count and no blank or "Loading…" frame before its data, and its rows do not move when the data lands.
