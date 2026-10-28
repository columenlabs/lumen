# REVIEW.md — Lumen

What code review flags as blocking in this repo. Each item points to where its rule is written; the rule is not repeated here.

- Every rule under "Rules" in [`AGENTS.md`](AGENTS.md).
- Every pattern in [`DESIGN.md`](DESIGN.md), including Details on demand: helper text on screen where an `InfoTip` belongs, or an (i) where the label explains itself; and Actions: icon first: an action heavier than it needs (text where an icon is clear), an icon-only button with no `aria-label`, icons showing on every row at rest, or one or two actions behind a ⋯ menu; and Popups: always a way out: an overlay built outside the kit's `Sheet`, `Dialog` or `AlertDialog`, or one that hides the kit's × with no close of its own.
- A table row that shows on two lines at any width, a phone's 390px cards above all (AGENTS.md, Rows NEVER wrap): a value dropped onto a second line, a wrapping cell, or CSS that lets a row's cells wrap. Show the phone screenshot with every group open, and the interaction smoke passing at 390×844.
- A break of Prod safety in [`AGENTS.md`](AGENTS.md): heavy or unbounded work on load, on a request or on a Durable Object wake (it belongs in a budgeted alarm or queue step with a bookmark); a wait with no timeout or no fallback (a bare `fetch` with no signal, a device cache read outside `savedAnswers`, a lock with no bound); a rename or drop of a column or key an older build reads, or an `INSERT` that doesn't name its columns; a PR with no returning-user run (fresh, reload with saved data, stuck store); a correctness fix bundled with a feature.
- A screen that breaks its part's page in [`docs/parts/`](docs/parts/README.md) (its Do / Don't), or a change to a part's props or behaviour that leaves its page stale.
