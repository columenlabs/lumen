# DESIGN.md — Lumen

Design patterns every Lumen part and every app built on it follows. `AGENTS.md` and `REVIEW.md` point here; this file is the one place each pattern is written.

## Details on demand: InfoTip

Helper text lives behind an (i), not on the screen.

- A label, section title or option is one short line. Its explanation sits in an `InfoTip`: a small circled (i) right after the label, opened on hover or focus, and on tap on a phone. Build it from the kit's Radix Tooltip/Popover parts, never by hand.
- No grey hint lines under fields, section titles or options, and no paragraph under a page title. A footer or status line is a word or two ("Test to save", "Passed").
- The default is none. Most labels explain themselves (Name, Email, API key, Sent from, Test it, a route like Public internet) and get no (i). Add one only where a reader would truly guess wrong without it, such as a server address seen from a tunnel, where localhost means the tunnel's machine. A whole settings page usually has zero or one.
- The tip itself is one to three plain sentences. Errors and results are never tips: a failed check, a blocked Save (`SaveButton` with `FormIssue`s) or a test's outcome stays on the screen.

## Actions: icon first

An action takes the lightest form a reader still gets right at a glance. Go down this list only as far as the icon needs:

1. **Icon.** The meaning is unmistakable: close ×, search, a chevron that opens a group. It still carries an `aria-label`.
2. **Icon with a tooltip.** A clear icon whose action is worth naming: rename ✎, copy, refresh, reset. The tooltip is the action's name in two or three words ("Rename", "Reset to original").
3. **Icon with text.** Only where no icon can carry it, and never for an action that has one: a new-thing button in an empty state ("New view") at most.
4. **Icon with a detail tooltip.** The action's effect needs a sentence before someone clicks it; the sentence goes in the tooltip, not on the screen (as in Details on demand).

**Save, Run and every footer action are icons** (Bikram, 2026-10-28: "why are you not using icon for save? and run?"). A main action is told apart by its fill (`variant="default"`), not by words: Save is `SaveButton` (✓, tooltip "Save"), Run is ▷, Remove is 🗑, each an `IconButton` with its name as tooltip and `aria-label`. A drawer with no actions has no footer; its × closes it. Words stay only inside a confirm (`LumenConfirm`), where the button answers the question asked.

Where actions sit:
- **Edit in place first.** A value the person can change is clicked or tapped to edit (`EditInputCell`), not reached through a button or menu. A value changed by hand carries the kit's small ✎ mark, with the original in its tooltip; clearing the box goes back to the original.
- **Row actions show on hover, inline.** One or two icons at the end of the row's name, shown on row hover or keyboard focus and hidden at rest, so a page of many rows stays quiet. Never put one or two actions behind a ⋯ or context menu.
- **No standing icons.** At rest a row shows only its data and, at most, a state mark such as ✎. On a phone (no hover) the tap on the value is the action; an icon shows only on the row being worked on.

## Popups: always a way out

Every sheet, drawer, dialog, picker and menu can be closed the obvious way, on a phone above all. The kit's overlay parts (`Sheet`, `Dialog`, `AlertDialog`, so `LumenDrawer`, `LumenSelector` and every part built on them) give it for free; never build an overlay without them.

- **A visible close.** A phone's bottom sheet always shows its × top right (`SheetContent` ignores `showCloseButton={false}` there). A dialog shows its × or a Cancel in its top bar; a part that hides the kit's × draws its own in its header.
- **Tap outside.** A phone's bottom sheet rises from the bottom and stops short of the top, so the dimmed page above it shows; a tap there closes it. Popovers and menus close the same way.
- **Swipe down.** The grab handle at a bottom sheet's top drags it down; a pull past 80 px or a flick closes it, a shorter one springs back. The handle comes with the sheet; never add one by hand.
- **Esc and back.** Esc closes the top overlay. On a phone the back button or gesture closes it too and leaves the page where it was (`useBackClose`); closing any other way pops that history entry again, unless a link inside already moved on.
- **Safe areas.** Bottom sheets pad the home indicator, side sheets and full-screen dialogs the notch.
- **Titles stop short of the ×.** A header's title truncates on one line before the close button (`SheetHeader`, `DialogHeader` reserve its room); a header's own actions sit left of it, never under it.

## Status bar: the dashboard

The status bar says what is true right now, at a glance, that nobody has to act on. Pick the surface by what the reader must do:

| Surface | When | Example |
|---|---|---|
| Banner | The page's main job is broken until someone acts. | Feed not connected · Connect |
| Toast | Someone just did something: confirm it, offer Undo, fade. | Saved 3 rows · Undo |
| Badge | The state of one row, card or nav item. | Failing · 12 |
| Status bar | The app's ambient state: fresh, busy, degraded. | Updated 3m ago · Syncing 40 of 112 |
| Header line (`meta`) | What this page is, in static words. | Pages you watch |

Five slots, in this order, drawn by the kit from data (`LumenShell bar`, `useStatus` in a page):

1. **Sync.** How fresh the page's data is: Updated 3m ago, Syncing (with its count), Saved copy, Offline, Did not update. `querySync(query)` reads it from the page's main TanStack query; a page's sync wins over the app's.
2. **Work.** This app's running task from the Tasks list, with its percent. It comes by itself where Tasks is mounted.
3. **Message.** A warning or error that blocks nothing (Job boards offline). Latest only, `×N` for repeats, `+N` for earlier ones.
4. **Page facts.** At most two facts this page has nowhere else to show (Next run in 12m). Never a row count the pager shows or a number a tile shows.
5. **End.** Health (admins), What's new, time zone. Fixed.

Rules:
- Every item says what and when: "Updated 3m ago", never just "Updated". Relative times stay current while the tab shows.
- One line, always. A long item ends in an ellipsis with the full text on hover or tap.
- On a phone the most urgent item shows (error, then warning, then work, then sync), with a chip that opens every item in a bottom sheet. The bar never scrolls sideways.
- Nothing in the bar waits or holds the page: it draws from what the page already has, and a read that has not answered shows its last state or nothing.
