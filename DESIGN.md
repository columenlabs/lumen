# DESIGN.md — Lumen

Design patterns every Lumen part and every app built on it follows. `AGENTS.md` and `REVIEW.md` point here; this file is the one place each pattern is written.

## Details on demand: InfoTip

Helper text lives behind an (i), not on the screen.

- A label, section title or option is one short line. Its explanation sits in an `InfoTip`: a small circled (i) right after the label, opened on hover or focus, and on tap on a phone. Build it from the kit's Radix Tooltip/Popover parts, never by hand.
- No grey hint lines under fields, section titles or options, and no paragraph under a page title. A footer or status line is a word or two ("Test to save", "Passed").
- The default is none. Most labels explain themselves (Name, Email, API key, Sent from, Test it, a route like Public internet) and get no (i). Add one only where a reader would truly guess wrong without it, such as a server address seen from a tunnel, where localhost means the tunnel's machine. A whole settings page usually has zero or one.
- The tip itself is one to three plain sentences. Errors and results are never tips: a failed check, a blocked Save (`SaveButton` with `FormIssue`s) or a test's outcome stays on the screen.
