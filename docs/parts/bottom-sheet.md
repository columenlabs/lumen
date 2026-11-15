# Bottom sheet: `LumenBottomSheet`

## Use it for

A phone panel that stays on screen beside a live page, such as a 3D view, a map or a canvas. It rests at a peek, half or full height, and the person drags its handle between them. It has no dim and no blur, and taps above it reach the page. It never closes, so a running answer, an upload or a form inside it keeps going.

- The details or editor of one row: `LumenDrawer` (a bottom sheet on a phone, closed when done).
- A yes or no: `LumenConfirm`.

## Anatomy

```
 page (live)            page (live)            ┌──── grab ────┐
                        ┌──── grab ────┐       │ header       │
┌──── grab ────┐        │ header       │       │ body         │
│ header       │        │ body         │       │              │
└──────────────┘        └──────────────┘       └──────────────┘
 peek                    half                   full
```

- `snaps`: the rests, smallest first: a share of the screen (`0.5`) or px (`'76px'`). Peek is as tall as the handle plus the header, so the header (tabs) shows.
- `snap` / `onSnap`: where it rests, controlled. A header button or a tab tap moves it, and so does a drag.
- What it holds fills only the part on screen, so a composer or footer at its bottom stays in view at every snap.
- The page leaves room for the peek at its bottom (its status bar sits above it).

## Do / Don't

✓ `<LumenBottomSheet snaps={['76px', 0.5, 0.92]} snap={snap} onSnap={setSnap} title="Panel">{body}</LumenBottomSheet>`

✗ A Sheet the app opens and closes over a live page: the page dims and goes dead, and what the sheet holds unmounts on each close.

## Checked by

No lint rule. Review checks it against this page.
