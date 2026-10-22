// Connections:
// any card's rows connect to another domain's rows on key pairs (earnings next week ▸ your
// holdings, by symbol). The connected domain's fields join the card's catalog as one more group,
// `<to>_<field>`, each rolled up over the rows that match (a sum of amounts, the one value when
// all agree, else the values listed), with `<to>_count` for how many match. The app reads the
// connected rows (`JoinReaders.useDomains`); the keys are inferred from the keys both sides carry
// (symbol first), and a card that could connect offers it in one line ("Link to Holdings by
// Symbol? You hold 2 of these.") rather than another screen. Freshness carries through: a sum of
// live values is Live calc.
import { CATALOG, linkable } from '@columenlabs/lumen-types/catalog';
import type { SourceState } from '@columenlabs/lumen-types/domains';
import {
  CONNECTED_COUNT,
  type CustomViewConfig,
  type ViewConnection,
  connectedKey,
  inferConnection,
  linkSpace,
} from '@columenlabs/lumen-types/views';
import { HashIcon, Link2Icon, XIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { freshnessOf } from './freshness';
import { IconButton } from './icon-button';
import { Button } from './ui/button';
import {
  FORMULAS_GROUP,
  type ViewCellValue,
  type ViewDomain,
  type ViewField,
  type ViewFieldGroup,
} from './view-model';

/** One domain a card can connect to, as the app reads it. */
export interface ConnectedDomain {
  label: string;
  domain: ViewDomain<unknown>;
  rows: unknown[];
  state: SourceState['state'];
  detail?: string;
}

/** The header rule colour of every connected domain's columns. */
export const LINK_COLOR = 'var(--chart-9)';

/** Why an added link reads nothing yet. */
export const NOT_LINKED = 'Not linked: pick a field on each side';

/** A connection's group id in the field tree. */
export const linkGroupId = (to: string) => `link:${to}`;

/** A row's values for one side of a pair: a key the rows carry, else the field's value. */
function sideOf<T>(domain: ViewDomain<T>, name: string): ((row: T) => string[]) | null {
  const key = domain.keys?.[name as 'symbol' | 'account'];
  const norm = (v: string) => (name === 'symbol' ? v.trim().toUpperCase() : v.trim());
  if (key)
    return (row) => {
      const v = key(row);
      return (v === null || v === undefined ? [] : Array.isArray(v) ? v : [v]).map(norm);
    };
  const f = domain.fields.find((x) => x.key === name);
  if (!f) return null;
  return (row) => {
    const v = f.value(row);
    return v === null || v === '' ? [] : [norm(String(v))];
  };
}

/** The key pairs a connection uses: its own, else the ones both sides carry. */
export function connectionOn<T>(
  domain: ViewDomain<T>,
  to: ViewDomain<unknown> | undefined,
  c: Pick<ViewConnection, 'on'> | undefined,
): ViewConnection['on'] | null {
  if (c?.on?.length) return c.on;
  if (!to) return null;
  return inferConnection(Object.keys(domain.keys ?? {}), Object.keys(to.keys ?? {}));
}

/** The rows of `to` matching each value of the pairs, by the joined values. */
function indexOf(
  to: ConnectedDomain,
  on: ViewConnection['on'],
): { index: Map<string, unknown[]>; ok: boolean } {
  const sides = on.map((p) => sideOf(to.domain, p.to));
  const index = new Map<string, unknown[]>();
  if (sides.some((s) => !s)) return { index, ok: false };
  for (const r of to.rows) {
    const vals = sides.map((s) => (s ? s(r) : []));
    // One pair: each value the row carries is a key (a holding folding two accounts).
    const keys = on.length === 1 ? (vals[0] ?? []) : [vals.map((v) => v[0] ?? '').join('\u0000')];
    for (const k of keys) {
      if (!k) continue;
      const list = index.get(k);
      if (list) list.push(r);
      else index.set(k, [r]);
    }
  }
  return { index, ok: true };
}

/** The matching rows of a card row. */
function matcher<T>(
  domain: ViewDomain<T>,
  on: ViewConnection['on'],
  index: Map<string, unknown[]>,
): ((row: T) => unknown[]) | null {
  const sides = on.map((p) => sideOf(domain, p.from));
  if (sides.some((s) => !s)) return null;
  return (row) => {
    const vals = sides.map((s) => (s ? s(row) : []));
    const keys = on.length === 1 ? (vals[0] ?? []) : [vals.map((v) => v[0] ?? '').join('\u0000')];
    const out: unknown[] = [];
    const seen = new Set<unknown>();
    for (const k of keys)
      for (const r of index.get(k) ?? [])
        if (!seen.has(r)) {
          seen.add(r);
          out.push(r);
        }
    return out;
  };
}

/** A field rolled up over the matching rows: its own roll-up for numbers, else the one value or a list. */
function rollUp(f: ViewField<unknown>, rows: unknown[]): ViewCellValue {
  if (!rows.length) return null;
  const vs = rows.map((r) => f.value(r));
  const nums = vs.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (nums.length && nums.length === vs.filter((v) => v !== null).length) {
    // A per-unit value (a price, a %) has no sum: the one value when all agree. Anything else
    // without its own roll-up adds up (a quantity held in two accounts).
    const perUnit =
      f.format === 'percent' ||
      f.format === 'weight' ||
      ((f.format === 'price' || f.format === 'price_rounded') && !f.amount);
    const agg = f.aggregate ?? (perUnit ? undefined : 'sum');
    if (agg === 'sum') return nums.reduce((a, b) => a + b, 0);
    if (agg === 'mean') return nums.reduce((a, b) => a + b, 0) / nums.length;
    if (agg === 'min') return Math.min(...nums);
    if (agg === 'max') return Math.max(...nums);
    if (agg === 'count') return nums.length;
    return nums.every((n) => n === nums[0]) ? (nums[0] ?? null) : null;
  }
  const texts = [...new Set(vs.filter((v) => v !== null && v !== '').map(String))];
  if (!texts.length) return null;
  return texts.length <= 3
    ? texts.join(', ')
    : `${texts.slice(0, 3).join(', ')} +${texts.length - 3}`;
}

/** Fields a connection can carry: a value of the row, not a page's own working out. */
const carries = (f: ViewField<unknown>) => f.group !== FORMULAS_GROUP && !f.share && !f.compute;

/**
 * A card's connected fields and groups, and how each connected domain's read went. Connections
 * the app cannot read, or whose keys this card lacks, report as failed with why.
 */
export function connectionFields<T>(
  domain: ViewDomain<T>,
  connections: ViewConnection[],
  read: Record<string, ConnectedDomain>,
  taken: Set<string>,
): { fields: ViewField<T>[]; groups: ViewFieldGroup[]; sources: SourceState[] } {
  const fields: ViewField<T>[] = [];
  const groups: ViewFieldGroup[] = [];
  const sources: SourceState[] = [];
  for (const c of connections) {
    const to = read[c.to];
    const id = linkGroupId(c.to);
    const name = to?.label ?? CATALOG[c.to]?.label ?? c.to;
    if (!to) {
      sources.push({ id, name, state: 'off', detail: 'not on this desk' });
      continue;
    }
    const on = connectionOn(domain, to.domain, c);
    // Added but Not linked: it reads nothing and adds no columns until a
    // field on each side is picked; its group stays in the tree for that.
    if (!on) {
      sources.push({ id, name, state: 'off', detail: NOT_LINKED });
      groups.push({ id, label: name, color: LINK_COLOR, note: NOT_LINKED });
      continue;
    }
    const { index, ok } = indexOf(to, on);
    const match = ok ? matcher(domain, on, index) : null;
    if (!match) {
      // Still loading: its fields come with its rows.
      const detail = to.state === 'loading' ? 'loading…' : 'a linked field is missing';
      sources.push({ id, name, state: to.state === 'ok' ? 'failed' : to.state, detail });
      groups.push({ id, label: name, color: LINK_COLOR, note: detail });
      continue;
    }
    const by = on.map((p) => (p.from === p.to ? p.from : `${p.from} = ${p.to}`)).join(' + ');
    sources.push({ id, name, state: to.state, detail: to.detail ?? `linked by ${by}` });
    // Its own colour, apart from the card's own fields and the Symbol and Account joins.
    groups.push({ id, label: name, color: LINK_COLOR, note: `linked by ${by}` });
    // The matches of each row, worked out once per row object.
    const cache = new WeakMap<object, unknown[]>();
    const matches = (row: T) => {
      if (typeof row !== 'object' || row === null) return match(row);
      const hit = cache.get(row);
      if (hit) return hit;
      const m = match(row);
      cache.set(row, m);
      return m;
    };
    const count = connectedKey(c.to, CONNECTED_COUNT);
    if (!taken.has(count)) {
      taken.add(count);
      fields.push({
        key: count,
        name: `${linkSpace(c.to)}.${CONNECTED_COUNT}`,
        label: `${name}: rows`,
        icon: HashIcon,
        group: id,
        value: (row) => matches(row).length,
        format: 'rounded',
        formula: `how many ${name.toLowerCase()} rows match, by ${by}`,
        aggregate: 'sum',
        filterable: true,
      });
    }
    for (const f of to.domain.fields) {
      const key = connectedKey(c.to, f.key);
      if (!carries(f) || taken.has(key)) continue;
      taken.add(key);
      const fresh = freshnessOf(to.domain, f);
      fields.push({
        key,
        name: `${linkSpace(c.to)}.${f.key}`,
        label: f.label,
        icon: f.icon,
        group: id,
        value: (row) => rollUp(f, matches(row)),
        format: f.format,
        compact: f.compact,
        amount: f.amount,
        formula: `${f.formula ?? f.label}, over the ${name.toLowerCase()} rows that match`,
        aggregate: f.aggregate,
        filterable: f.filterable,
        groupable: f.groupable,
        ...(fresh ? { updates: fresh } : {}),
      });
    }
  }
  return { fields, groups, sources };
}

/** The domains a card could connect to now: not its own, not yet connected, sharing a key. */
export function connectCandidates(domainId: string, config: CustomViewConfig): string[] {
  const have = new Set((config.connections ?? []).map((c) => c.to));
  return linkable().filter((d) => d !== domainId && !have.has(d));
}

const DISMISSED = 'edge.connect.dismissed';
const readDismissed = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED) ?? '[]') as string[];
  } catch {
    return [];
  }
};

/**
 * The one-line offer under a card's filter ("do you want to link this frame
 * to this data domain by symbol"): the first domain it could connect to on a key both carry, with
 * how many of its rows match. Link adds the connection; ✕ hides the offer for this card on this
 * device. Nothing shows when no row would match.
 */
export function ConnectOffer<T>({
  domain,
  rows,
  config,
  read,
  cardKey,
  onConnect,
}: {
  domain: ViewDomain<T>;
  rows: T[];
  config: CustomViewConfig;
  read: Record<string, ConnectedDomain>;
  /** Names the card for ✕ (a view or tab id). */
  cardKey: string;
  onConnect?: (c: ViewConnection) => void;
}) {
  const [dismissed, setDismissed] = useState(readDismissed);
  const offer = useMemo(() => {
    // One link offered at a time, and none once the card has one: the rest is in Edit view.
    if (!onConnect || config.connections?.length) return null;
    for (const to of connectCandidates(domain.id, config)) {
      const other = read[to];
      if (!other || other.state !== 'ok' || dismissed.includes(`${cardKey}:${to}`)) continue;
      const on = connectionOn(domain, other.domain, undefined);
      if (!on) continue;
      const { index, ok } = indexOf(other, on);
      const match = ok ? matcher(domain, on, index) : null;
      if (!match) continue;
      const hits = rows.filter((r) => match(r).length > 0).length;
      if (hits) return { to, label: other.label, on, hits };
    }
    return null;
  }, [domain, rows, config, read, dismissed, cardKey, onConnect]);
  if (!offer || !onConnect) return null;
  const by = offer.on.map((p) => p.from).join(' + ');
  const hold =
    offer.to === 'holdings'
      ? `You hold ${offer.hits} of these.`
      : `${offer.hits} of these ${offer.hits === 1 ? 'has' : 'have'} ${offer.label.toLowerCase()}.`;
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      <Link2Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">
        Link to <span className="text-foreground">{offer.label}</span> by{' '}
        <span className="text-foreground">{by[0]?.toUpperCase() + by.slice(1)}</span>? {hold}
      </span>
      <Button
        size="xs"
        variant="outline"
        className="shrink-0"
        onClick={() => onConnect({ to: offer.to, on: offer.on })}
      >
        Link
      </Button>
      <IconButton
        icon={XIcon}
        size="icon-xs"
        label="Not now"
        onClick={() => {
          const next = [...dismissed, `${cardKey}:${offer.to}`];
          setDismissed(next);
          try {
            localStorage.setItem(DISMISSED, JSON.stringify(next.slice(-200)));
          } catch {
            // A private window keeps the choice for this visit only.
          }
        }}
      />
    </div>
  );
}
