# Lumen parts: how to use them

One page per part an app builds screens from. Read the page before you add or change one of these in an app; a code reviewer checks the screen against it. The patterns behind them are in [`DESIGN.md`](../../DESIGN.md), the blocking list in [`REVIEW.md`](../../REVIEW.md).

Each page has the same four headings:

- **Use it for**: what the part is for, and what to reach for instead.
- **Anatomy**: what the part draws, top to bottom. The app passes data into these slots and draws nothing around them.
- **Do / Don't**: ✓ and ✗ code, the mistakes agents make most.
- **Checked by**: the `lumen-ship check` rule that fails CI when the page is broken, where one exists.

| Part | Page | Use it for |
|---|---|---|
| `LumenDrawer` + `DrawerSection` | [drawer.md](drawer.md) | The details or editor of one row, beside the list |
| `LumenPhoneDrawer` | [phone-drawer.md](phone-drawer.md) | A phone panel a toolbar button opens beside a live page, with minimize, maximize and close |
| `LumenBottomSheet` | [bottom-sheet.md](bottom-sheet.md) | A phone panel that rests at peek, half or full beside a live page |
| `LumenFloatingPanel` | [floating-panel.md](floating-panel.md) | A see-through panel the person drags, resizes and folds over a live page (a phone held sideways) |
| `LumenForm`, `SaveButton`, `FormIssue` | [form.md](form.md) | Fields that save together |
| `LumenSettings`, `LumenExpandList` | [settings.md](settings.md) | An app's Settings page |
| `LumenLoading` | [loading.md](loading.md) | Every screen whose data is still on its way: each part draws its own shape, never an empty |
| `LumenShell bar`, `useStatus` | [status-bar.md](status-bar.md) | What is true right now, nobody has to act on |
| `LumenSelector` | [selector.md](selector.md) | Every picker |
| `LumenView`, `LumenLayout` | [table.md](table.md) | Every list of rows |
| `LumenFilterPanel` | [filter-panel.md](filter-panel.md) | Browsing a big list by its fields' values, beside it |
| `LumenCalendar` | [calendar.md](calendar.md) | Things on days: month, week and agenda |
| `LumenBoard` | [board.md](board.md) | Items by stage, in columns |
| `LumenPlayer` | [player.md](player.md) | A video, an audio file, or slides over audio |
| `LumenShell tabs` | [tab-bar.md](tab-bar.md) | The main pages at the bottom of a phone screen |
| `VoiceButton` | [voice.md](voice.md) | Talking instead of typing into a message or note box |
| `useDevice`, `deviceNow` | [device.md](device.md) | The one answer to "what device is this": how a part looks, never what it can do |

## Three rules every page shares

1. **Icon first.** An action is an `IconButton`: the icon, its name in a tooltip and its `aria-label`, no text on the button. Save is `SaveButton`, Run, Test, Refresh, Copy, Edit and Delete are `IconButton`s. ([DESIGN.md, Actions: icon first](../../DESIGN.md#actions-icon-first))
2. **Details on demand.** No grey hint line under a field, a section title or a page title. Most labels need nothing; the few that do get an `InfoTip`. ([DESIGN.md, Details on demand](../../DESIGN.md#details-on-demand-infotip))
3. **Only the kit's overlays.** An app never imports `ui/sheet`, `ui/dialog`, `ui/select`, `ui/command` or `ui/combobox`: drawers are `LumenDrawer`, confirms `LumenConfirm`, pickers `LumenSelector`. ([DESIGN.md, Popups](../../DESIGN.md#popups-always-a-way-out))

## Checked by

`lumen-ship check parts <app folders>` counts each rule's breaks per folder against a baseline that may only fall (`scripts/parts.baseline`, one `<folder> <rule> <count>` a line). Rules:

| Rule | Fails on |
|---|---|
| `hint-text` | `<p className="… text-xs … text-muted-foreground …">`: a grey line under a field or title |
| `text-action` | a `<Button>` whose text starts with an action (Save, Run, Test, Send, Sync, Refresh, Copy, Edit, Delete, Remove, Retry, Reset) |
| `raw-overlay` | an import of `@columenlabs/lumen-ui/ui/{sheet,dialog,select,command,combobox}` |
| `tags-text` | tags or labels joined into comma text (`r.tags.join(', ')`) on a line with no `tags: true`: a `tags` field or `TagChips` |
| `key-input` | a password `Input` in an app: a key, token or secret is a `LumenConnection` field (secret, prefix, Test, Remove), never an `Input` with its own Save button ([settings.md](settings.md)) |
| `phone-drawer` | an app's own Minimize or Maximize control (a `"Minimize …"` or `"Maximize …"` name): a phone panel with window controls is `LumenPhoneDrawer` ([phone-drawer.md](phone-drawer.md)) |
| `settings-page` | a route, link or nav item (`path`, `to`, `href`) to a page named `settings`: an app's settings are sections of the one Settings dialog |
| `loading-as-empty` | a read still running drawn as text or nothing: a `Loading…` line, or `return null` while a query is pending or has no data. A `LumenLoading` scope or `LumenPending` instead ([loading.md](loading.md)) |
| `hand-skeleton` | an app's own skeleton: an import of `ui/skeleton` or a `LumenSkeleton`. The parts draw their own shape inside `LumenLoading` ([loading.md](loading.md)) |

`lumen-ship check parts --write-baseline <folders>` writes today's counts (only for a first run; lower a count by hand in the change that removes a break).
