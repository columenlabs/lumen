# DESIGN.md — Lumen

Design patterns every Lumen part and every app built on it follows. `AGENTS.md` and `REVIEW.md` point here; this file is the one place each pattern is written.

## Details on demand: InfoTip

Helper text lives behind an (i), not on the screen.

- A label, section title or option is one short line. Its explanation sits in an `InfoTip`: a small circled (i) right after the label, opened on hover or focus, and on tap on a phone. Build it from the kit's Radix Tooltip/Popover parts, never by hand.
- No grey hint lines under fields, section titles or options, and no paragraph under a page title. A footer or status line is a word or two ("Test to save", "Passed").
- Use few. Most labels explain themselves (Name, Email, API key, Sent from, Send test) and get none. An (i) earns its place only where the label alone would leave a reader guessing: a choice with a consequence, or a value whose format is not obvious (a server address seen from a tunnel). At most one per section, and never one per option in a list: put the list's explanation in one (i) on its title.
- The tip itself is one to three plain sentences. Errors and results are never tips: a failed check, a blocked Save (`SaveButton` with `FormIssue`s) or a test's outcome stays on the screen.
