# Bottom sheet: `LumenBottomSheet`

## Use it for

A phone panel that stays on screen beside a live page, such as a 3D view, a map or a canvas. It rests at a peek, half or full height, and the person drags its handle between them. It has no dim and no blur, and taps above it reach the page. It is not modal: a field above it takes focus and the keyboard, and the page stays visible to screen readers. It never closes, so a running answer, an upload or a form inside it keeps going.

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

- `snaps`: the rests, smallest first: a share of the screen (`0.5`) or px (`'64px'`). Peek is as tall as the handle plus the header, so the header (tabs) shows and nothing below it. A px snap is measured above the phone's home bar; the sheet adds the bar. The page leaves `calc(<peek> + env(safe-area-inset-bottom))` at its bottom.
- `snap` / `onSnap`: where it rests, controlled. A header button or a tab tap moves it, and so does a drag.
- `header`: its top row (tabs, a title). It shows at every snap and drags the sheet with the grab bar: a swipe that starts anywhere on the bar's row or the header moves it, and a tap on the header's buttons still reaches them. A tap on the bar steps to the next rest. The body never drags the sheet, so its lists and chat scroll.
- What it holds fills only the part on screen, so a composer or footer at its bottom stays in view at every snap.
- Typing in it with a phone's keyboard up, it ends at the keyboard (as tall as its snap, or what is visible), so the field and a composer sit just above the keys. A field above the sheet leaves it where it rests.
- The page leaves room for the peek at its bottom (its status bar sits above it).

## Do / Don't

✓ `<LumenBottomSheet snaps={['64px', 0.5, 0.92]} snap={snap} onSnap={setSnap} title="Panel" header={<Tabs />}>{body}</LumenBottomSheet>`

✗ Tabs inside `children`: only the small grab bar then drags the sheet, and most swipes miss.

✗ A Sheet the app opens and closes over a live page: the page dims and goes dead, and what the sheet holds unmounts on each close.

## Checked by

No lint rule. Review checks it against this page.
