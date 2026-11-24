# useDevice: what device this is

## Use it for

The one test of the device, for the kit and every app: `useDevice()` in a component, `deviceNow()` outside React (an event handler, a store, a worker bridge). It answers from media queries alone, so it follows every turn and resize, and it is true on the first render.

| Field | True when |
|---|---|
| `narrow` | Narrower than a tablet (under 768 px): a phone held upright |
| `sideways` | A phone on its side: 500 px tall or less, under a finger, and not narrow |
| `phone` | Laid out as a phone, either way up (`narrow` or `sideways`) |
| `touch` | The main pointer is a finger (no hover, no fine pointer) |
| `handheld` | A phone or tablet: `touch`, with a screen whose short side is under 1100 px |

`useIsMobile()` (= `narrow`) and `usePhoneLayout()` (= `{ phone, sideways }`) are deprecated wrappers of it.

## Anatomy

Nothing drawn. One shared set of listeners per media query, however many components ask, so a table that asks once per row adds none per row.

## Do / Don't

✓ The device picks how an action looks and where it sits: `const { phone } = useDevice(); return phone ? <SheetList … /> : <Popover … />`.

✓ What an action does, and when it can run, is the same on every device. A real difference (a tool there is no room for on a phone) is written down where the action is defined, with its reason, so it is seen and reviewed.

✗ `phone ? openPhoneCompare() : openCompare()`: two behaviours for one action. Give it one rule and let the device change only its look.

✗ `window.matchMedia('(max-width: 767px)')`, `matchMedia('(pointer: coarse)')`, `navigator.maxTouchPoints` or `window.innerWidth` in an app or a part: a second answer that drifts from this one (a sideways phone was a phone in one place and a computer in another).

✗ `useIsMobile()` where a sideways phone should count too: use `useDevice().phone`.

## Checked by

No kit rule yet. An app's own lint can fail a raw media query, and a device test inside an action's code.
