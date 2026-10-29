# Calendar: `LumenCalendar`

## Use it for

Things that happen on days: a program's sessions, a plan's tasks by due date, a schedule. Month, Week (with a time axis) and Agenda, over plain data the app passes in.

- Rows to sort, filter and total: `LumenView` (see [table.md](table.md)), with a date column.
- One date to pick in a form: `LumenDateInput`.
- Things by stage rather than by day: `LumenBoard` (see [board.md](board.md)).

## Anatomy

```
▦ Month  ▤ Week  ☰ Agenda                 ✓  ‹  ›   LumenTabs; Today, previous, next as IconButtons
October 2026   [Talks] [Workshops] [Deadlines]       the period (one line), category chips (ColorChip toggles)
Sun  Mon  Tue  Wed  Thu  Fri  Sat                    weekdays from weekStartsOn
 4    5 ● 9:00 Kickoff…   …                          a cell: day, up to 3 one-line events, "+N more"
Wed, Oct 7  Today                                    the picked day's list (always on a narrow box)
 9:00 AM  ● Kickoff and goals         Talks          one line: time, dot, title (truncates), category
```

- `events`: `{ id, title, start, end?, allDay?, category?, color? }`. `start` and `end` are instants (`Date` or ISO string), or a plain `YYYY-MM-DD` for a whole day; a plain end is inclusive.
- `categories`: `{ id, label, color }`. Their chips filter; an event takes its category's colour unless it has its own.
- `onSelect(event)` opens the app's drawer; `onRangeChange({ start, end, view })` fires with the instants on screen, so the app reads only those days.
- `timeZone` (an IANA zone, the browser's by default) is the zone every day and time is shown in.
- View and date are uncontrolled (`defaultView`, `defaultDate`) or controlled (`view` + `onViewChange`, `date` + `onDateChange`).
- On a box under 640px wide (a phone, a narrow drawer) Month shows dots with the picked day's list under the grid, and Agenda is the default view. Week's axis scrolls inside its own box and opens at the first event or 7 AM.

## Do / Don't

```tsx
// ✓ plain data in, the app's drawer out; fetch by the range on screen
<LumenCalendar events={events} categories={categories} timeZone={prefs.timeZone}
  onSelect={(e) => setOpen(e.id)} onRangeChange={({ start, end }) => setRange([start, end])} />

// ✗ a hand-made month grid, text buttons, times built from local Date methods
<div className="grid grid-cols-7">{days.map((d) => <div>{d.getDate()}…</div>)}</div>
<Button onClick={next}>Next month</Button>
```

- ✗ Wrapping an event's title onto a second line. ✓ It truncates; the full title is its hover.
- ✗ Loading every event the app has. ✓ Read by `onRangeChange` and pass that range's events.
- ✗ A second category filter of the app's own above it. ✓ `categories`; the chips are the filter.
- ✗ `h-full` on the calendar's card. ✓ It is as tall as its content; Week scrolls inside itself.

## Checked by

Review and the app's interaction smoke (AGENTS.md, UI gate 1 and 3: reach and lines).
