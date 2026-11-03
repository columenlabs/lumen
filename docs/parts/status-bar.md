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

## Signals

Warnings and errors are `signals`, not `messages`: data the kit draws as a chip in slot 3 (counts by level, the top signal) that opens the Signals panel. See DESIGN.md, Signals.

```tsx
<LumenShell
  bar={{
    signals: events.map((e) => ({
      key: `${e.kind}:${e.account}:${e.meter}:${e.resource}`,
      level: e.level,            // 'act' | 'look' | 'fyi'
      kind: 'Burning fast', what: 'KV reads', where: 'worker-a', group: 'Prod',
      pace: '11% in 15m', used: 0.34, runsOut: '2h',
      at: e.at, href: `/meters/${e.meter}`,
    })),
    signalOptions: { onMute: saveMuteRule, settings: 'alerts', groupLabel: 'Account' },
  }}
/>
```

- ✗ `messages: [{ text: 'Spike: … 16× its normal hour (2,057 vs 125) · 2% of today\'s allowance used …', tone: 'warning' }]`
- ✓ `signals: [{ kind: 'Unusual', what: 'D1 rows written', where: 'worker-b', pace: '16× peak', used: .02, lands: .10, level: 'fyi' }]`

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
