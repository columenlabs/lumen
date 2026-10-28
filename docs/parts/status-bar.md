# Status bar: `LumenShell bar`, `useStatus`

## Use it for

What is true right now that nobody has to act on: how fresh the data is, what is running, a warning that blocks nothing, one or two facts. Pick the surface by what the reader must do:

| Must act | Just did it | One row or card | Ambient | What this page is |
|---|---|---|---|---|
| Banner | Toast (`lumenToast`, with Undo) | Badge | **Status bar** | Header `meta` |

## Anatomy

```
● Updated 3m ago │ ⟳ Syncing 40 of 112 │ ⚠ Job boards offline ×3 +2 │ Next run in 12m │ ♥ What's new PT
  1 Sync           2 Work                 3 Message                    4 Facts (≤ 2)     5 End (kit)
```

On a phone the most urgent item shows (error, warning, work, sync) with a chip that opens the rest in a sheet. The bar never scrolls sideways.

## Do / Don't

```tsx
// ✓ data, not JSX; the page's main read is its sync
const jobs = useQuery(jobsQuery);
useStatus({ sync: querySync(jobs), facts: [{ label: 'Next run', at: nextRunAt }] });

// ✓ app-wide on the shell
<LumenShell bar={{ sync: { state: 'ok', label: 'Bank feed', at: syncedAt } }} … />

// ✗ JSX status items, a row count the pager shows, a spinner that waits
<LumenShell status={<StatusItem>42 rows</StatusItem>} … />
```

- ✗ "Updated". ✓ "Updated 3m ago": every item says what and when.
- ✗ A fetch made just for the bar. ✓ Read what the page already holds.
- ✗ An error the person must fix. ✓ A banner on the page.

## Checked by

Review only (REVIEW.md); the deprecated `status` prop shows on desktop only.
