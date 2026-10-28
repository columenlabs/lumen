# Form: `LumenForm`, `SaveButton`, `FormIssue`

## Use it for

Fields that save together: an editor in a drawer, a settings section, a new-thing form.

- A flat list of fields: `LumenForm` with `fields` (data, one object per field) and `onSave`.
- A form the app lays out itself (sections, a preview beside it): the kit's inputs, and `SaveButton` with the form's `FormIssue`s.
- One value changed in place (a name, a cell): `EditInputCell` or `RenameField`, no form and no Save.

## Anatomy

```
Name                      [ Lisbon store        ]   label: one line, no hint under it
API key (i)               [ ••••3f9a            ]   an InfoTip only where a reader would guess wrong
Route                     [ Public internet   ▾ ]   select / multi: LumenSelector
                                     ⚠ 2 to fix  ✓   SaveButton: issues chip, then the icon
```

- Every rule a value must meet is a `check` on its field (`LumenForm`) or a `FormIssue` (your own layout). The person sees them only through `SaveButton`: the chip counts them, Save takes them to the first one.
- `disabled` on `SaveButton` means only "nothing changed"; never use it to block a save that has problems.
- A test of the settings (Test it, Send test) is an `IconButton` beside Save. Its result shows on screen, never in a tip.

## Do / Don't

```tsx
// ✓ fields as data; the kit draws labels, inputs and Save
<LumenForm
  fields={[
    { id: 'name', label: 'Name', required: true },
    { id: 'url', label: 'Address', check: (v) => String(v).startsWith('https://') || 'Must start with https://' },
  ]}
  initial={job}
  onSave={(v) => save.mutate(v)}
  busy={save.isPending}
/>

// ✓ own layout: issues to SaveButton, field ids to jump to
const issues: FormIssue[] = url.startsWith('https://') ? [] : [{ where: 'Address', message: 'Must start with https://', target: 'job-url' }];
<SaveButton issues={issues} disabled={!dirty} busy={save.isPending} onSave={() => save.mutate()} />

// ✗ a silent disabled Save, a text button, a hint under the field
<Button disabled={!url.startsWith('https://')} onClick={save}>Save</Button>
<p className="text-xs text-muted-foreground">Must start with https://</p>
```

- ✗ `hint` on a `LumenField` to explain a label. ✓ Leave it out, or an `InfoTip` (`InfoLabel`).
- ✗ An error message under a field before the person tries to save. ✓ The `SaveButton` chip.
- ✗ Cancel as a text button in a drawer: the drawer's × and Esc close it.

## Checked by

`hint-text`, `text-action` (see [README](README.md#checked-by)).
