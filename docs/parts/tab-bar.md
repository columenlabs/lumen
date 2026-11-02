# Phone tab bar (`LumenShell tabs`)

## Use it for

An app whose people move between a few main pages on a phone all day (a dashboard, a plan, a course list). It puts up to four of them at the bottom of the screen, one tap away, with More opening the sidebar for every other page. Leave it out and the phone keeps the sidebar alone, as today.

## Anatomy

- Four tabs, each the page's icon over its name, taken from the first four `NavItem`s passed. The tab whose page you are on is in the accent colour (the closest match wins, as in the sidebar).
- More, last: opens the sidebar sheet. It is lit when none of the four is the page you are on.
- Phone only. The status bar rides just above it; it pads the phone's safe area at the bottom.

## Do / Don't

```tsx
// ✓ The same NavItems the sidebar uses, the main ones first.
<LumenShell nav={<NavGroup items={nav} />} tabs={nav.slice(0, 4)} … />

// ✗ A bar of the app's own fixed to the bottom of the page.
<div className="fixed bottom-0 …">…</div>
```

## Checked by

No lint rule. The app's interaction smoke checks reach and tap targets on a phone.
