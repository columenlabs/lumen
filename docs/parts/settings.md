# Settings: `LumenSettings`, `LumenExpandList`

## Use it for

An app's Settings page: one dialog on every host, General first, then a group per app. Each section is one `SettingsSectionDef`.

- A list of things in a section (providers, channels, accounts, phones): `LumenExpandList` of `LumenExpandRow`s.
- A few fields that save together: a `LumenForm` (see [form.md](form.md)) in the section's `content`, its Save in `footer`.
- Shared sections the kit already has: `SchedulesSection`, `NotificationsSettings`, `McpSettings`, `IntegrationRow`, `TimeZoneSelect`. Use them; never rebuild one.
- Alerts split from delivery: `NotificationsSettings parts="channels"` in one section (where messages go: email, ntfy, webhooks, set up once) and `parts="events"` in another (what goes where: one line per event, a column per channel). Events with a `group` sit under its label ("Limits", "Watchdog").

## Three slots (every thing in a section)

A thing you connect or turn on (a provider, a channel, a key, an account) is one `LumenExpandRow` with three slots, built on shadcn's `Field` and `InputGroup`:

```
[icon] Plaid  Production · keys ••91        ● Works  [on]  ›     header: status pill, on/off for the whole thing
       Environment   [Production|Sandbox]                          SettingField rows: one setting each
       Keys          [••••91            ✎]                          a value's own buttons sit inside it
       Webhook       [https://money…    ⧉]                [on]      a switch for one setting at the row's end
       ✓ Tested 8:41 AM                          ↻ Test  🗑          SettingActions: last result, Test, Remove
```

```tsx
<LumenExpandRow
  id="plaid" icon={<LinkIcon />} name="Plaid" meta="Production · keys ••91"
  status={<SettingStatus health={settingHealth(on, test)} title={`Tested ${when}`} />}
  toggle={{ checked: on, onCheckedChange: setOn, label: 'Plaid on' }}
  actions={<SettingActions test={test} onTest={runTest} remove={{ label: 'Remove keys', run: removeKeys }} />}
>
  <SettingField label="Environment"><ToggleGroup … /></SettingField>
  <SettingField label="Keys"><SettingValue label="Keys" value="••••91" mono onReplace={edit} /></SettingField>
  <SettingField label="Webhook" stack end={<Switch aria-label="Live updates" … />}>
    <SettingValue label="Webhook URL" value={url} mono copy />
  </SettingField>
</LumenExpandRow>
```

Rules:

1. **A row is a setting.** Never a lone button with a label in front ("Last test", "Remove Plaid keys").
2. **A label names the setting, not the thing**: "Keys" inside Plaid, never "Plaid keys".
3. **On/off for the whole thing is `toggle`** in the header; on/off for one setting is that row's `end`. Never a "Turn on" button or a trash icon for "off".
4. **Actions on the whole thing are in `SettingActions`**: Test, then Remove (trash, confirms) at the far right; anything else (Sync now, Sign in again) as an icon before them. Actions on one value sit inside its `SettingValue` (Copy, Replace).
5. **Status is the header pill only** (`SettingStatus`: Works, Failed, Not tested, Off, or a count). The action bar adds just the time or the error.
6. **Several controls on one row are one group** and never wrap. A long value takes `stack`: on a phone its label goes above it.
7. **A section's pill** is `health` on its `SettingsSectionDef`: `sectionHealth(items)`, the worst thing wins. The Settings list shows it as a dot.
8. **A row with only an `end`** (a switch or a status pill, no control) gives its label the whole row, so a short name never cuts off on a phone. A row with a control keeps the fixed label column (8rem, 6rem on a phone).
9. **A form that saves together** keeps label beside field (`SettingField`), and its Test result sits in its footer, not a row of its own.
10. **A section's header is one line, centred**: icon, title, a divider, then the one-line description, all on the same middle line (never baseline aligned, which drops the description under the title's line). On a phone the description goes under the title. The Settings panel draws it; an app never builds its own section header.

### Built on the slots
- `LumenConnection` (a key, a sign-in, a relay): one row per way to connect, its value with Replace or Sign in again inside. One way: its last test, Test and Remove sit in the action bar. Several ways: a Use row picks the one that runs, and each way's row ends in its own status, Test and Remove (on a phone the label and those sit above the value).
- `NotificationsSettings`: email and ntfy turn on and off with the header switch, and each webhook is one row.
- `McpSettings`: each server's address is a row with Copy, then From picks the app whose steps show.
- `SchedulesSection`'s editor: each setting is a row (On and Notify end in their switch).

## Anatomy

```
⚙ Email                            one-line description (≤ 64 chars)
  ▸ Relay A       tunnel                 Works      LumenExpandRow: name · meta · badge
  ▾ Relay B       public internet        Failed
      fields of this row …                           opens in place, one row at a time
──────────────────────────────────────────────────
  Passed                                       ↺  ✓  footer: a word or two, then icons
```

- `description` is one plain line of 64 characters or less, drawn beside the title (`Email | How the app sends mail`) and under it on a phone; nothing else under the title.
- Every row starts collapsed and shows its name, its one-line `meta` beside it, and its `status`. Opening one closes the others.
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
- ✗ A grey line under a row's fields. ✓ An `InfoTip` on the one label that needs it; `SettingRow`'s `description` draws one.
- ✗ A Settings page of the app's own (a `/settings` route or nav item). ✓ A section in the app's group of the one dialog, opened from anywhere with `?settings=<section>`.

## Checked by

`lumen-ship check settings-copy` (the 64-character description) and `hint-text`, `text-action`, `settings-page` (see [README](README.md#checked-by)).
