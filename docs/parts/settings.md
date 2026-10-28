# Settings: `LumenSettings`, `LumenExpandList`

## Use it for

An app's Settings page: one dialog on every host, General first, then a group per app. Each section is one `SettingsSectionDef`.

- A list of things in a section (providers, channels, accounts, phones): `LumenExpandList` of `LumenExpandRow`s.
- A few fields that save together: a `LumenForm` (see [form.md](form.md)) in the section's `content`, its Save in `footer`.
- Shared sections the kit already has: `SchedulesSection`, `NotificationsSettings`, `McpSettings`, `IntegrationRow`, `TimeZoneSelect`. Use them; never rebuild one.

## Anatomy

```
⚙ Email                            one-line description (≤ 64 chars)
  ▸ Relay A       tunnel                 Works      LumenExpandRow: name · meta · badge
  ▾ Relay B       public internet        Failed
      fields of this row …                           opens in place, one row at a time
──────────────────────────────────────────────────
  Passed                                       ↺  ✓  footer: a word or two, then icons
```

- `description` is one plain line of 64 characters or less; nothing else under the title.
- Every row starts collapsed and shows its name, one line (`meta`) and a badge. Opening one closes the others.
- The footer's status is a word or two ("Passed", "Test to save"). Actions are icons.

## Do / Don't

```tsx
// ✓
const section: SettingsSectionDef = {
  id: 'email', title: 'Email', icon: MailIcon, description: 'How the app sends mail',
  content: (
    <LumenExpandList>
      {relays.map((r) => (
        <LumenExpandRow key={r.id} id={r.id} name={r.name} meta={r.route} badge={<Badge>{r.state}</Badge>}>
          <RelayForm relay={r} />
        </LumenExpandRow>
      ))}
    </LumenExpandList>
  ),
};

// ✗ a paragraph of help, every row open, cards per row
description: 'Pick a relay. Mail goes out through the relay you choose; a localhost address is reached over the tunnel…',
<Card className="h-full">…</Card>
```

- ✗ `h-full` on a card in a section: Settings scrolls, the card clips at one screen.
- ✗ A grey line under a row's fields. ✓ An `InfoTip` on the one label that needs it.

## Checked by

`lumen-ship check settings-copy` (the 64-character description) and `hint-text`, `text-action` (see [README](README.md#checked-by)).
