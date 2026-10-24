// Freshness marks:
// a column's colour says where it comes from, and a small mark beside its name says how it
// updates: a green dot Live (moves with the market: a quote), a calculator Live calc (worked out
// from a live field: Value, Unrealized, a formula over Price; , #861), ◷ As of (a daily or snapshot value: a close, a fact,
// the assistant frame's column) and nothing for a fixed value (Qty, Cost). Declared once on each field
// (`updates`, `from`); a formula's mark comes from the fields its expression reads.
import { formulaReads } from '@columenlabs/lumen-ui-types/views';
import { CalculatorIcon } from 'lucide-react';
import { FORMULAS_GROUP, type ViewDomain, type ViewField, groupOf, nameIndex } from './view-model';

export type Freshness = 'live' | 'calc' | 'asof';

export const FRESHNESS: Record<Freshness, { label: string; about: string }> = {
  live: { label: 'Live', about: 'moves with the market while it trades' },
  calc: { label: 'Live calc', about: 'worked out from a live field' },
  asof: { label: 'As of', about: 'a daily or snapshot value' },
};

/** The field keys a field is made from: its `from`, a share's field, the names a formula reads. */
function inputsOf<T>(domain: ViewDomain<T>, f: ViewField<T>): string[] {
  const out = new Set(f.from ?? []);
  if (f.share) out.add(f.share.of);
  if (groupOf(domain, f) === FORMULAS_GROUP && f.formula) {
    const byName = nameIndex(domain);
    for (const n of formulaReads(f.formula)) {
      const k = byName.get(n)?.key;
      if (k && k !== f.key) out.add(k);
    }
  }
  return [...out];
}

/** How a field updates: live, live calc, as of, or null for fixed. */
export function freshnessOf<T>(
  domain: ViewDomain<T>,
  f: ViewField<T>,
  seen: Set<string> = new Set(),
): Freshness | null {
  if (f.updates === 'live') return 'live';
  if (f.updates === 'calc') return 'calc';
  seen.add(f.key);
  let asof = f.updates === 'asof';
  for (const k of inputsOf(domain, f)) {
    if (seen.has(k)) continue;
    const g = domain.fields.find((x) => x.key === k);
    if (!g) continue;
    const r = freshnessOf(domain, g, seen);
    if (r === 'live' || r === 'calc') return 'calc';
    if (r === 'asof') asof = true;
  }
  return asof ? 'asof' : null;
}

/** The live fields a Live calc field reads, by label, for its tooltip (`from Price`). */
export function liveInputs<T>(domain: ViewDomain<T>, f: ViewField<T>): string[] {
  return inputsOf(domain, f)
    .map((k) => domain.fields.find((x) => x.key === k))
    .filter((g): g is ViewField<T> => {
      if (!g) return false;
      const r = freshnessOf(domain, g, new Set([f.key]));
      return r === 'live' || r === 'calc';
    })
    .map((g) => g.label);
}

/** The tooltip line under a header's path: `Live: moves with the market while it trades`. */
export function freshnessLine<T>(domain: ViewDomain<T>, f: ViewField<T>): string | null {
  const r = freshnessOf(domain, f);
  if (!r) return null;
  const m = FRESHNESS[r];
  if (r === 'calc') {
    const from = liveInputs(domain, f);
    return `${m.label}: worked out from ${from.length ? from.join(', ') : 'a live field'}`;
  }
  return `${m.label}: ${m.about}`;
}

/** The mark itself, drawn: a green dot for Live, a calculator for Live calc, a clock for As of. */
export function FreshnessIcon({ kind, className }: { kind: Freshness; className?: string }) {
  const base = `inline-block shrink-0 align-[-0.05em] ${className ?? ''}`;
  const cls = `${base} size-[0.62rem]`;
  const label = FRESHNESS[kind].label;
  if (kind === 'calc')
    return (
      <CalculatorIcon
        className={`${base} size-3`}
        strokeWidth={2.4}
        role="img"
        aria-label={label}
      />
    );
  if (kind === 'live')
    return (
      <svg viewBox="0 0 12 12" className={`${cls} text-gain`} role="img" aria-label={label}>
        <circle cx="6" cy="6" r="3.6" fill="currentColor" />
      </svg>
    );
  return (
    <svg viewBox="0 0 12 12" className={cls} role="img" aria-label={label}>
      <circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M6 3.4V6l1.8 1.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The mark beside a header's name; nothing for a fixed field. */
export function FreshnessMark<T>({
  domain,
  field,
}: { domain: ViewDomain<T>; field: ViewField<T> }) {
  const r = freshnessOf(domain, field);
  if (!r) return null;
  return (
    <span className="mr-1 inline-flex opacity-80">
      <FreshnessIcon kind={r} />
    </span>
  );
}

/** The marks the shown columns carry, in order live, live calc, as of. */
export function marksOf<T>(domain: ViewDomain<T>, columns: ViewField<T>[]): Freshness[] {
  const got = new Set(columns.map((c) => freshnessOf(domain, c)));
  return (['live', 'calc', 'asof'] as const).filter((r) => got.has(r));
}
