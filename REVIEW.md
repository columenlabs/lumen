# REVIEW.md — Lumen

What code review flags as blocking in this repo. Each item points to where its rule is written; the rule is not repeated here.

- Every rule under "Rules" in [`AGENTS.md`](AGENTS.md).
- Every pattern in [`DESIGN.md`](DESIGN.md), including Details on demand: helper text on screen where an `InfoTip` belongs, or an (i) where the label explains itself; and Actions: icon first: an action heavier than it needs (text where an icon is clear), an icon-only button with no `aria-label`, icons showing on every row at rest, or one or two actions behind a ⋯ menu; and Popups: always a way out: an overlay built outside the kit's `Sheet`, `Dialog` or `AlertDialog`, or one that hides the kit's × with no close of its own.
