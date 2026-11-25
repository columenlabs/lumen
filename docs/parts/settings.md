# Settings: `LumenSettings`, `LumenExpandList`

## Use it for

An app's Settings page: one dialog on every host, General first, then a group per app. Each section is one `SettingsSectionDef`.

- A list of things in a section (providers, channels, accounts, phones): `LumenExpandList` of `LumenExpandRow`s.
- A few fields that save together: a `LumenForm` (see [form.md](form.md)) in the section's `content`, its Save in `footer`.
- Shared sections the kit already has: `SchedulesSection`, `NotificationsSettings`, `McpSettings`, `IntegrationRow`, `TimeZoneSelect`. Use them; never rebuild one.
- One or two per-device choices of the app's own (what scrolling does, a default view): `preferences` on `LumenSettings` or `LumenShell`, `SettingField` rows added under General ▸ Preferences after the kit's. Never a section of its own for a single row. `observability={false}` hides Preferences ▸ Observability details (each view's load time) from people who don't need it, such as everyone but an app's admins.
- Alerts split from delivery: `NotificationsSettings parts="channels"` in one section (where messages go: email, ntfy, webhooks, set up once) and `parts="events"` in another (what goes where: one line per event, a column per channel). Events with a `group` sit under its label ("Limits", "Watchdog").

## Groups in the list (`sub`)

A section with `sub: true` sections after it is a group in the Settings list (the assistant ▸ Providers, Models, Skills). Nothing else to pass: the kit folds it.

- Folded by default. The group holding the open section unfolds itself, however it was opened (a click, `?settings=`, the assistant).
- The name opens the group's own section; the chevron at the right only folds or unfolds it (a disclosure button: `aria-expanded`, "Show/Hide <name> pages", Tab then Enter).
- Folded, the parent carries a problem of its sections (red failed, else grey not tested), never their green, and stands selected when one of them is open.
- Search unfolds every group (a matching section keeps its parent above it); clearing it folds them back as they were.
- Kept while the app runs; a reload folds them again. On a phone the section picker stays a flat, indented list.

```
✦ Assistant       ● ›     folded: a red or grey dot only when one of its sections has one
⚑ Feature flags
✦ Assistant         ⌄     unfolded
   🔑 Providers      ●
   ▣  Models
```

## One row standard (every setting, every app)

Three kinds of row, and two questions decide the rest, so a new setting needs no new design.

- **Value**: one setting, label left, control right (`SettingField`).
- **Thing**: something you connect or turn on (a provider, a channel, a sign-in method). A `LumenExpandRow` that folds open to its settings.
- **List**: things of one kind (passkeys, devices, webhooks). A `LumenExpandRow` that folds open to its items, with Add as the last line on the right.

The two questions:

1. **Can it be turned on or off?** Then `toggle`: a switch just left of the chevron. Nothing else says on or off.
2. **Can it work or break?** Then `health`: a dot on the row's icon. Green works (or is on and set up), red failed (its `healthTitle` says why on hover), a grey ring not checked yet, no dot when it is off or empty.

```
[icon●] Name   grey detail ………………………………… [switch] ›     every row, in this order
[🔑●] Passkeys   2 passkeys                              ›     a list: no switch
      MacBook               Last used 2 days ago     🗑        items: actions on the right, trash grey, red on hover
      iPhone                Added Nov 3              🗑
                                        [🔑 Add passkey]       Add: the last line, on the right
[📱●] Authenticator app   8 backup codes left    [on]   ›     a thing that turns on and off
[✉ ] Email code   name@example.com               [off]  ›     off: no dot
```

No chips or pills in the header and no empty columns: counts and names go in the grey detail (`meta`). The dot sits on the icon, so the right edge (switch, chevron) lines up down the list whatever each row has.

Every row has an icon. Give `icon` the thing's logo or icon (`SettingIcon icon={…}` draws it on a tile); left out, the row draws the name's first letter on that tile. So names start on one edge down a list, and the health dot never draws without an icon to sit on.

**Rows of the same controls line up.** When several `SettingField`s each hold the same controls (a model and an effort picker, then a switch), wrap them in `SettingColumns columns={n}` and give each field its controls as direct children, one per column. Each column is as wide as its widest control (up to `max`, 16rem by default; a longer value ends in an ellipsis with the full text on hover), so every row's controls start and end on the same edges and the `end` switches stand in one column. It is CSS grid with subgrid, nothing measured. A long label ends in an ellipsis with its full text on hover; on a phone the label takes its own line and the controls keep their columns under it. Never size a control with `w-*` to fake the line-up.

```
Default           [GPT-6.2 Sol       ⌄] [Medium ⌄] [on]
Prompt reviewer   [Claude Haiku 5.5  ⌄] [Low    ⌄] [off]
Chat              [GPT-6.1 Terra     ⌄] [Low    ⌄] [on]
```

While a section's reads run, wrap it in `LumenLoading` ([loading.md](loading.md)): each row keeps its name and icon, its detail and switch are bars, no dot shows, and a list of data rows (`LumenExpandList id`) draws as many bar rows as it had last time. Never draw a section's empty, Add or "Not set up" state before its reads answer.

## Three slots (every thing in a section)

Inside, a thing is built on shadcn's `Field` and `InputGroup`:

```
[icon●] Plaid  Production · keys ••91                 [on]  ›     header: health on the icon, on/off for the whole thing
       Environment   [Production|Sandbox]                          SettingField rows: one setting each
       Keys          [••••91            ✎]                          a value's own buttons sit inside it
       Webhook       [https://money…    ⧉]                [on]      a switch for one setting at the row's end
       ✓ Tested 8:41 AM                          ↻ Test  🗑          SettingActions: last result, Test, Remove
```

```tsx
<LumenExpandRow
  id="plaid" icon={<LinkIcon />} name="Plaid" meta="Production · keys ••91"
  health={settingHealth(on, test)} healthTitle={`Tested ${when}`}
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
5. **Health is a dot on the icon** (`health`, `healthTitle`; `SettingHealthDot` draws it): `works` or `on` green, `failed` red, `untested` a grey ring, none for `off`, empty or a thing that can't break. A count or a name is never a pill: it goes in the row's `meta` ("2 passkeys", "8 backup codes left"); `count` is only for a section's total. The action bar adds just the time or the error. `status` (a pill in the header) is deprecated.
6a. **The header's right side is the same on every row**: the switch or one quick action (`toggle` or `end`), then the chevron. A switch only when the thing turns on and off; a list has none. Adding to a list is its last line, an outline icon + text button on the right ("🔑 Add passkey"), lined up with its items' actions. An item's trash is grey and turns red on hover.
6. **Several controls on one row are one group** and never wrap. A long value takes `stack`: on a phone its label goes above it.
7. **A section's pill** is `health` on its `SettingsSectionDef`: `sectionHealth(items)`, the worst thing wins. The Settings list shows it as a dot.
8. **A row with only an `end`** (a switch or a status pill, no control) gives its label the whole row, so a short name never cuts off on a phone. A row with a control starts its label column at 8rem (6rem on a phone) and widens it for a longer name, so a label is never cut; on a phone it takes at most half the row and wraps there. The control sits flush to the row's right edge, its label on the left (a `stack` row's control starts at the left on a phone, under its label); never align a field by hand.
9. **A form that saves together** keeps label beside field (`SettingField`), and its Test result sits in its footer, not a row of its own.
10. **A key, token or secret is a `LumenConnection`**: its `fields` (`secret`, `prefix`) give the masked value with Replace, the check before Save, the status pill, Test and Remove. Never an `Input type="password"` with a ✓ of its own; the part check `key-input` fails one.
11. **A section's header is one line, centred**: icon, title, a divider, then the one-line description, all on the same middle line (never baseline aligned, which drops the description under the title's line). On a phone the description goes under the title. The Settings panel draws it; an app never builds its own section header.

### Built on the slots
- A row's `end` holds one quick action on the whole thing in its header (Add, Set up, Sign out everywhere else), an `IconButton`, outside the expand button.
- `LumenConnection` (a key, a sign-in, a relay): one row per way to connect, its value with Replace or Sign in again inside. One way: its last test, Test and Remove sit in the action bar. Several ways: a Use row picks the one that runs, and each way's row ends in its own status, Test and Remove (on a phone the label and those sit above the value). A device sign-in (its `signin.start` gives a `device`, and `signin.poll` finishes it) shows the code with Copy and Open, waits with the time left and connects by itself; Cancel, and Try again once it ran out or failed.
- `NotificationsSettings`: email and ntfy turn on and off with the header switch, and each webhook is one row.
- `McpSettings`: each server's address is a row with Copy, then From picks the app whose steps show.
- `SchedulesSection`'s editor: each setting is a row (On and Notify end in their switch).
- `LumenSignInMethods` (Security): passkeys (a list), authenticator app and emailed codes (things with a switch), each a `LumenExpandRow` under one bordered list, one open at a time. Its steps run inside its own row (a passkey's name box, the app's QR → 6 digits → backup codes), never over the whole section. The icon's dot is green when the method is set up; passkeys have no switch, and Add passkey is the list's last line on the right; each passkey shows Last used (`lastUsed`) or Added. Backup codes fold into the authenticator app's row ("8 backup codes left" in its meta, ↻ new codes inside); they get a row of their own only when there is no app. The app's switch starts setup (on) or turns it off after a confirm. `passwordless` (an app with no passwords: passkeys, Google, emailed codes) skips the password step and guards Turn off and new codes with a confirm. On a phone the QR step is an Open in authenticator app link.
- `LumenSessions` (Security ▸ Devices): where the person is signed in, folded under "Signed in on N"; open, this device first, then one line per kind of device (the same name once, ×N), each with Sign out; the header's `end` signs out everywhere else after a confirm.
- `LumenSecondStep`'s `trust` adds a Trust this device box under the code. Add a passkey waits on the device through `usePasskeyWait`: Cancel stays pressable and ends the wait at once, the wait gives up after `PASSKEY_WAIT_MS` (2 min), a closed or refused prompt is a quiet note (`PASSKEY_CANCELLED_TEXT`), never the browser's words. Pass `passkeys.onCancel` to close the browser's prompt (SimpleWebAuthn's `WebAuthnAbortService.cancelCeremony`); `onAdd` may answer the sign-in service's `{ error }` as is. A sign-in screen of the app's own uses the same hook for its passkey button and calls `cancel()` before Google or a code, so a passkey never locks the other ways in.

## Anatomy

```
⚙ Email                            one-line description (≤ 64 chars)
  ▸ ●Relay A      tunnel                       ›   LumenExpandRow: health on the icon · name · meta
  ▾ ●Relay B      public internet              ⌄   (red dot: failed, hover says why)
      fields of this row …                           opens in place, one row at a time
──────────────────────────────────────────────────
  Passed                                       ↺  ✓  footer: a word or two, then icons
```

- `description` is one plain line of 64 characters or less, drawn beside the title (`Email | How the app sends mail`) and under it on a phone; nothing else under the title.
- Every row starts collapsed and shows its icon with its health dot, its name and its one-line `meta` beside it. Opening one closes the others.
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
- ✗ A grey line under a row's fields. ✓ An `InfoTip` on the one label that needs it; `SettingField`'s `info` draws one.
- ✗ `SettingRow` or a row of your own. ✓ `SettingField`: every setting row in the kit is one (`SettingRow` is a deprecated name for it), and Settings' search hides a `SettingField` whose label and info miss the query.
- ✗ A section holding one per-device row ("Navigation" with just Scroll). ✓ That row in `preferences`, beside Time zone.
- ✗ A Settings page of the app's own (a `/settings` route or nav item). ✓ A section in the app's group of the one dialog, opened from anywhere with `?settings=<section>`.

## Checked by

`lumen-ship check settings-copy` (the 64-character description) and `hint-text`, `text-action`, `settings-page`, `key-input` (see [README](README.md#checked-by)).
