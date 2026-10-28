# Picker: `LumenSelector`

## Use it for

Every choice from a list: a field's select or multi-select, a filter chip, an icon menu, a picker with search or create. It opens above its trigger when the room below is short, its list scrolls, and its search, header and footer (Done) stay in view.

- A choice of two or three that should all show at once: `LumenChoice` (or a toggle group), not a picker.
- A destructive confirm: `LumenConfirm`.

## Anatomy

```
[ Public internet  ▾ ]      trigger: 'field' (default) · 'chip' · 'icon'
┌────────────────────┐
│ 🔍 Search          │      search: 'auto' shows past a handful of options
│ Group              │      groups / option.group
│   ✓ Option   detail│      option: label, detail, icon, description (in its tip)
│   + Add "acme"     │      create: a new value typed in the search
│              Done  │      footer, multiple only
└────────────────────┘
```

## Do / Don't

```tsx
// ✓ options as data
<LumenSelector
  options={[{ value: 'tunnel', label: 'Tunnel' }, { value: 'public', label: 'Public internet' }]}
  value={route}
  onChange={setRoute}
/>

// ✗ shadcn's Select or a Command list in an app
import { Select, SelectContent } from '@columenlabs/lumen-ui/ui/select';
```

- ✗ A `DropdownMenu` of one or two actions behind ⋯. ✓ The actions as `IconButton`s on the row.
- ✗ Capping the list's height without its footer. ✓ Leave sizing to the kit.

## Checked by

`raw-overlay` (see [README](README.md#checked-by)).
