# Explorer: `LumenExplorer`

## Use it for

Any list a person browses as a tree or a flat list of named things they act on one at a time: parts, parameters, build steps, a drawing's dimensions or sections, folders, what is picked. One row, the same everywhere, so a person learns it once.

Reach for something else when:
- the rows are records with columns to sort and filter: `LumenView` ([table.md](table.md));
- the rows are a settings list that opens in place: `LumenExpandList` ([settings.md](settings.md));
- the rows are an app's pages: the shell's sidebar;
- the rows read top to bottom as a story with a guide line (a run's steps): `LumenTree`.

Built on react-arborist: rows are virtualized, and the keyboard (arrows, Enter, F2, ⇧ and ⌘ click), multi-select, rename in place and drag into a folder come with it.

## Anatomy

One line a row, 26px (36px with `touch`). Slots from the left, each a fixed width:

1. **Indent and chevron.** A `folder` (or a row with `children`) has a chevron and folds. A flat list (no folder at the top) keeps no chevron room.
2. **Icon.** The item's type `icon` (a lucide icon, or the app's own small control such as a colour swatch), coloured by `tint`. Its `status` is a dot on the icon, its words in the hover; `busy` spins in its place. `statusAt="end"` moves the status to the row's end.
3. **Swatch.** An optional 12px control after the icon (a part's colour or material). When any row has one, the others keep its room, so names line up.
4. **Name.** One line; a long name ends in an ellipsis, the full name in its hover. `display` shows a shorter text. `info` turns the hover into a card: what it does (`text`), what it touches (`tags`, under `tagsLabel`, default "Rebuilds"), and the field's usual range. Never a second line.
5. **Marks.** Small fixed-width things right after the name (a spinner and its time, a retry).
6. **Meta.** Grey detail: a count, a material, ×3. A folder's meta is set by `groupMeta`: the `count` of items under it, `none`, or the app's words.
7. **Field.** A value (`number`, `text`, `switch`), `fieldWidth` wide so values line up. It commits on Enter, on leaving it, or when a switch flips. `hint` is the usual range: outside it the field turns amber and says so, and the value is still taken. Only `limit` refuses a value; the field then goes back. When the kit's field can't hold the value (a list, a vector, a value in the app's own units with limits of its own), `control` puts the app's own control in the same slot, `fieldWidth` wide, so values still line up.
8. **Toggles.** Each `ExplorerToggle` (visibility, pin) has a slot:
   - `rail` (the default): its own button at the row's end. Its slot is kept on every row, so the column lines up, even where `when` leaves it out.
   - `icon`: no extra column. The icon slot turns into the toggle on hover, and shows it while it is on (a pinned parameter).
   - `menu`: only in the ⋯ menu, with a small mark after the name while it is on.
   - `quiet`: at rest, the toggle shows only on hover. Otherwise it is faint at rest.

**The ⋯ menu has no slot.** On hover it floats just left of the field and toggles, on a fade of the row's colour, over the end of the name or meta. It never covers a value. Right-click opens the same menu. Opening it picks the row first when it is not picked, because the menu acts on what is picked. A row whose `menu` returns nothing has no ⋯ (a group of parameters). `renameInMenu` adds Rename. With `touch` there is no hover: the ⋯ gets a slot of its own and is always shown, a long press shows the full name, and a tap on a picked row unpicks it.

`locked` rows take no rename and no drops (a group the app builds itself); drag needs `onMove`.

`open` sets a folder's first state over `openByDefault` (a loop's passes start folded).

**Rollback bar.** `bars` draws a CAD history's marker under the row it sits `at`, one bar per list of `rows` (each part's steps). Drag it, click the gap under another row, or move it with ↑ ↓ Home End (Esc goes to the end). Rows after it dim; the app moves it in `onMove(row)`. It hides while `search` filters.

`attrs` puts the app's own `data-*` attributes on the ⋯ button and the Rename item (`attrs={{ menu: {...}, rename: {...} }}`), and a toggle's `attrs` on its button, so an app can tag them for its own checks.

**Nothing moves.** Hover, focus, selection and an open menu change opacity, never width.

## Do / Don't

✓ Pass state in, take changes out: the explorer keeps no copy of the rows.

```tsx
<LumenExplorer
  label="Parts"
  data={rows}                       // ExplorerItem[], built from the app's state
  toggles={[visible]}               // { id, icon, offIcon, rest: true, label, onToggle }
  menu={(it) => <SelectionActions ids={[it.id]} />}
  onMenuOpen={(it) => pick(it.id)}  // the menu acts on what is picked
  renameInMenu
  onRename={rename}
  onMove={move}
  selection={picked}
  onSelect={pick}
/>
```

✓ A parameter: the pin in the icon slot, a field, the details in the hover.

```tsx
const pin: ExplorerToggle = { id: 'pin', icon: PinIcon, rest: false, quiet: true, slot: 'icon',
  when: (it) => !it.folder, label: (it, on) => `${on ? 'Unpin' : 'Pin'} ${it.name}`, onToggle: setPin };
<LumenExplorer label="Parameters" data={params} toggles={[pin]} groupMeta="none" infoSide="left" />
```

✗ Don't draw your own row with `react-arborist` or a list of `div`s, or show a button only on hover with `hidden group-hover:inline-flex`: it takes room only on hover and pushes its neighbours.

✗ Don't put a second line under a name (a description, a trace line, chips). It goes in `info`.

✗ Don't block a value outside its usual range. Only `limit` blocks.

✗ Don't give the explorer a height and a parent that scrolls. Leave out `height` and give the parent a height (`min-h-0 flex-1`): the explorer fills it and scrolls itself.

## Checked by

No rule yet. A reviewer checks a new explorer-style list against this page.
