# Drawer: `LumenDrawer` + `DrawerSection`

## Use it for

The details or the editor of one row, opened from a list, a card or a link. A right-side panel on desktop whose width drags (320px to 60%), a bottom sheet on a phone.

- A list whose rows each open it: pass `dock="<name>"`, so it sits beside the page and the next row swaps it in place.
- A yes or no before something destructive: `LumenConfirm`, not a drawer.
- A whole new screen of its own: a page (a route with a `LumenLayout`), not a drawer.

## Anatomy

```
┌───────────────────────────────┐
│ Title                       × │  title (one line, truncates before the ×)
│ description                   │  one muted line, optional: what this is ("Active · Oct 16")
├───────────────────────────────┤
│ ▸ ⚙ Section   3          None │  DrawerSection: chevron, icon, title, count, short note
│   summary while closed        │  summary: what it is set to, only while closed
│ ▾ ⚙ Section                   │
│   fields / FactList / table   │  body: the section's own parts
├───────────────────────────────┤
│ 12 runs          🗑  ▶  ✓     │  footerStart · actions (data, drawn as icons) · footer: SaveButton
└───────────────────────────────┘
```

- Every body is `DrawerSection`s. No heading, card or divider of the app's own between them.
- Sections start folded; `defaultOpen` the one the person came for.
- Label and value pairs are `FactList`. Fields are the kit's inputs with an `InfoTip` where one is truly needed.
- The footer holds the drawer's actions, right-aligned: `actions` as data (`{ icon, label, onClick, busy, destructive }`), which the drawer draws as icon buttons in order, destructive first, then `SaveButton` in `footer`. With neither there is no footer; the × closes it.

## Do / Don't

```tsx
// ✓ data in the kit's slots; actions are icons
<LumenDrawer open={open} onClose={close} title={job.name} description={job.when} dock="jobs"
  footerStart={`${runs.length} runs`}
  actions={[
    { icon: TrashIcon, label: 'Delete', destructive: true, onClick: () => remove.mutate() },
    { icon: PlayIcon, label: 'Run now', busy: run.isPending, onClick: () => run.mutate() },
  ]}
  footer={<SaveButton issues={issues} busy={save.isPending} disabled={!dirty} onSave={() => save.mutate()} />}>
  <DrawerSection icon={GlobeIcon} title="Page" summary={job.url} defaultOpen>…</DrawerSection>
  <DrawerSection icon={BellIcon} title="Alerts" count={alerts.length}>…</DrawerSection>
</LumenDrawer>

// ✗ text buttons, a hand-made header, a grey hint line
<LumenDrawer …>
  <h3 className="font-semibold">Page</h3>
  <p className="text-xs text-muted-foreground">The address read on each run.</p>
  <Button onClick={run}>Run now</Button>
  <Button disabled={!valid} onClick={save}>Save</Button>
</LumenDrawer>
```

- ✗ A `Sheet` or `Dialog` from `ui/*` for a side panel. ✓ `LumenDrawer`.
- ✗ Tabs at the top of a drawer to split its sections. ✓ `DrawerSection`s that fold; `LumenTabs` only when the drawer shows two different things (a job and its runs).
- ✗ `h-full` on a card inside it: the drawer scrolls, a card is as tall as its content.

## Checked by

`hint-text`, `text-action`, `raw-overlay` (see [README](README.md#checked-by)).
