// The data-domain registry: a DOMAIN is rows with their own fields and the
// KEYS its rows carry (symbol, account); a JOIN is a field set that attaches to any row carrying
// its key (symbol → Price, Valuation; account → Brokerage, Cash); a VIEW is one config over one
// domain. The kit holds the shapes and the machinery; an app registers its own joins, sources and
// domain keys once at start (`registerDomains` in ./registry), and every surface reads them: the
// shell's `useJoins` fills the join fields on any card, `customViewFields` lists them for agents,
// and each join reports how its sources fared, so a column with no source says why.
import type { ViewFormat } from './views';

/**
 * The keys a row can carry: a ticker (an option by its underlying), an account id, or an option
 * contract by its OCC id (a holding keeps position facts; the contract's own
 * terms and market data are the Option join's).
 */
export type JoinKey = 'symbol' | 'account' | 'contract';

/** Where a join field's values come from, by the id the app registered it under (`feed`). */
export type JoinSourceId = string;

export interface JoinFieldSpec {
  key: string;
  label: string;
  /** The sub-heading in the Columns tree ('' for none). */
  topic: string;
  source: JoinSourceId;
  format: ViewFormat;
  compact?: boolean;
  /** What an empty cell says (`N/A`); left out: a dash. */
  empty?: string;
  /** How it is made, shown under the field. */
  formula: string;
  /** Text worth grouping and filtering by. */
  category?: boolean;
  /** A holding amount that Hide amounts masks. */
  amount?: boolean;
  /** Only when the row has one key value (an account's cash on a line folding two accounts). */
  single?: boolean;
  /** `live` moves with the market (a quote), `asof` is a daily or synced value; left out: fixed. */
  updates?: 'live' | 'asof';
}

export interface JoinSpec {
  key: JoinKey;
  label: string;
  /** What the fields are looked up by, under the group in the Columns tree. */
  note: string;
  /** A theme colour for the group's dot and column-group header. */
  color: string;
  fields: JoinFieldSpec[];
}

/** Every join, by the key its fields attach to: empty until the app registers its fields. */
export const JOINS: Record<JoinKey, JoinSpec> = {
  symbol: {
    key: 'symbol',
    label: 'Symbol',
    note: 'by symbol',
    color: 'var(--chart-3)',
    fields: [],
  },
  account: {
    key: 'account',
    label: 'Account',
    note: 'by account',
    color: 'var(--chart-6)',
    fields: [],
  },
  contract: {
    key: 'contract',
    label: 'Option',
    note: 'by contract',
    color: 'var(--chart-2)',
    fields: [],
  },
};

/** One source of join fields: its name, colour, and what its line says when it has nothing to say. */
export interface JoinSourceSpec {
  name: string;
  /** Marks its topics in the tree and the headers. */
  color: string;
  /** The line's detail while it is fine (`live`, `daily close`). */
  idle?: string;
}

/** Each source, by id (the colour marks its topics in the tree and the headers). */
export const JOIN_SOURCES: Record<JoinSourceId, JoinSourceSpec> = {};

/**
 * The keys each registered domain's rows carry. A frame's keys are read from its columns
 * (`symbol`, `ticker` or `underlying`); a domain not listed here joins nothing.
 */
export const DOMAIN_KEYS: Record<string, JoinKey[]> = {};

/**
 * The join fields rows with `keys` get, in tree order, less the ones the domain has of its own:
 * an own field wins (Holdings' Price is the quote of the holding, an option's included; a
 * transaction's Price is its fill).
 */
export function joinFields(keys: readonly JoinKey[], own: Iterable<string>): JoinFieldSpec[] {
  const taken = new Set(own);
  const out: JoinFieldSpec[] = [];
  for (const k of keys)
    for (const f of JOINS[k].fields)
      if (!taken.has(f.key)) {
        taken.add(f.key);
        out.push(f);
      }
  return out;
}

/** The keys of `joinFields`, for a domain's field list. */
export const joinKeys = (keys: readonly JoinKey[], own: Iterable<string>) =>
  joinFields(keys, own).map((f) => f.key);

/**
 * How one source fared on the last read: `ok` with data, `off` where it is not set up (no
 * sign-in, no feed on this app), `failed` with why, `loading` while the first read runs.
 */
export interface SourceState {
  /** A registered source, or a linked frame as `frame:<frame id>`. */
  id: JoinSourceId | (string & {});
  name: string;
  state: 'ok' | 'off' | 'failed' | 'loading';
  /** What to show after the name: `live`, a day, or why it is off or failed. */
  detail?: string;
  /** The Settings section that turns it on, when the person can (`integrations`). */
  connect?: string;
}

/** One source as a line: `Feed live`, `Facts failed: timed out`. */
export const sourceLine = (s: SourceState) =>
  `${s.name} ${s.state === 'ok' ? (s.detail ?? 'ok') : [s.state, s.detail].filter(Boolean).join(': ')}`;
