import {
  CATALOG,
  type CatalogDomain,
  FRAME_LINK,
  catalogKeys,
  catalogTables,
  linkable,
} from '@columenlabs/lumen-types/catalog';
// Joins: the registry's
// join fields, attached to any card's rows by the keys they carry. A domain says how to read a
// row's symbol or account (`keys`); `useJoins` collects those of the rows for the join fields the
// view uses, reads them through the app's readers (symbol facts from `/api/symbols`, account facts
// from the accounts) and the shell's market feed (Price, Day %), and returns the domain with the
// join fields and groups after its own. Each source reports how it fared (ok, off, failed), which
// the column headers, the Columns tree, the status bar and the assistant panel all show, so a column
// with no source says why instead of dashes. One mechanism on every app; an app with no reader
// for a join shows its fields as off.
import {
  JOINS,
  JOIN_SOURCES,
  type JoinFieldSpec,
  type JoinKey,
  type SourceState,
  joinFields,
} from '@columenlabs/lumen-types/domains';
import {
  type FrameChoice,
  type FrameColumn,
  type FrameData,
  type FrameEditInput,
  type FrameMeta,
  type YourColumn,
  frameKeyAt,
} from '@columenlabs/lumen-types/frames';
import {
  type CustomViewConfig,
  type ViewConnection,
  allTilesOf,
  cardsOf,
  frameSpace,
  tileFieldKeys,
} from '@columenlabs/lumen-types/views';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  BadgeDollarSign,
  Banknote,
  Building2,
  CalendarClock,
  ChartLine,
  Gauge,
  HashIcon,
  Landmark,
  type LucideIcon,
  PlugIcon,
  RadioIcon,
  RefreshCwIcon,
  Repeat,
  Scale,
  TrendingUp,
  TypeIcon,
  Users,
} from 'lucide-react';
import { type ReactNode, createContext, useContext, useMemo, useState } from 'react';
import { apiJson } from './api-fetch';
import { useAssistant, useAssistantName } from './assistant-context';
import { type ConnectedDomain, connectCandidates, connectionFields } from './connections';
import { IconButton } from './icon-button';
import { useMarket } from './market/live';
import { StatusItem, useShell } from './shell';
import { useReportSources } from './source-health';
import type { ViewCellValue, ViewDomain, ViewField, ViewFieldGroup } from './view-model';
import { WORKSPACES_KEY, frameKey } from './workspace-keys';

/** One symbol's facts by field key; a missing key is no data. */
type SymbolFacts = Record<string, number | string | null>;

/** An account's facts, by its id. */
export interface AccountFacts {
  brokerage: string | null;
  trading: string | null;
  cash: number | null;
}

/**
 * How an app reads each join (an app: `/api/symbols` and its accounts). Each is a hook, called
 * on every render of a card that could join; `on` and `used` say whether to read at all.
 */
export interface JoinReaders {
  /** Facts by symbol for a broker and an app fields, when `on`. */
  useSymbolFacts?: (
    symbols: string[],
    on: boolean,
  ) => { facts: Record<string, SymbolFacts>; sources: SourceState[] };
  /** Facts by account id for the account fields in `used` (empty: none). */
  useAccountFacts?: (
    ids: string[],
    used: string[],
  ) => { facts: Record<string, AccountFacts>; sources: SourceState[] };
  /** Option fields by OCC id for the contract fields in `used` (empty: none). */
  useContractFacts?: (
    contracts: string[],
    used: string[],
  ) => { facts: Record<string, Record<string, ViewCellValue>>; sources: SourceState[] };
  /**
   * The rows of other domains a card connects to (connections), by domain id:
   * `ids` to read, `live` the ones a card shows (priced live), the rest only for the Link offer.
   */
  useDomains?: (ids: string[], live: string[]) => Record<string, ConnectedDomain>;
}

const NONE: string[] = [];
const NO_CONN: ViewConnection[] = [];
const noFacts = { facts: {}, sources: [] as SourceState[] };
/** Off, with why, for each source the Symbol join's fields name (but the feed's live price). */
const noSymbols = () => ({
  facts: {},
  sources: [...new Set(JOINS.symbol.fields.map((f) => f.source))]
    .filter((id) => id !== 'feed')
    .map(
      (id): SourceState => ({
        id,
        name: JOIN_SOURCES[id]?.name ?? id,
        state: 'off',
        detail: 'not on this desk',
      }),
    ),
});
const noContracts = {
  facts: {},
  sources: [
    { id: 'feed', name: 'Feed', state: 'off', detail: 'not on this desk' },
  ] as SourceState[],
};
const noAccounts = {
  facts: {},
  sources: [
    { id: 'accounts', name: 'Accounts', state: 'off', detail: 'not on this desk' },
  ] as SourceState[],
};
/** An app with no reader: the join's fields show as off, with why. */
const OFF_READERS: Required<JoinReaders> = {
  useSymbolFacts: (_symbols, on) => (on ? noSymbols() : noFacts),
  useAccountFacts: (_ids, used) => (used.length ? noAccounts : noFacts),
  useContractFacts: (_contracts, used) => (used.length ? noContracts : noFacts),
  useDomains: () => NO_DOMAINS,
};
const NO_DOMAINS: Record<string, ConnectedDomain> = {};

const ReadersCtx = createContext<Required<JoinReaders>>(OFF_READERS);

/** Gives every card under it the app's readers for the joins. */
export function JoinsProvider({
  readers,
  children,
}: { readers: JoinReaders; children: ReactNode }) {
  const value = useMemo(() => ({ ...OFF_READERS, ...readers }), [readers]);
  return <ReadersCtx.Provider value={value}>{children}</ReadersCtx.Provider>;
}

/** The join field keys a view uses anywhere: columns, filters, group, tiles, sort, pivot, cards, formulas. */
export function usedJoinKeys(config: CustomViewConfig, keys: Set<string>): string[] {
  if (!keys.size) return NONE;
  const named = [
    ...config.columns,
    ...config.filters.fields,
    ...config.filters.default.map((t) => t.key),
    ...config.group.fields,
    ...(config.group.default ? [config.group.default] : []),
    ...allTilesOf(config).flatMap(tileFieldKeys),
    ...(config.sort ? [config.sort.key] : []),
    ...(config.pivot ? [config.pivot.rows, config.pivot.columns, config.pivot.value] : []),
    ...cardsOf(config).flatMap((c) => [
      ...c.filter.map((t) => t.key),
      ...('by' in c ? [c.by, c.value] : []),
      ...(c.kind === 'table' && c.style === 'top_n' ? [c.sort, ...c.columns] : []),
      ...(c.kind === 'table' && c.style === 'table' && c.table
        ? [...c.table.columns, ...(c.table.sort ? [c.table.sort.key] : [])]
        : []),
      ...('date' in c ? [c.date, ...c.values] : []),
    ]),
  ];
  const used = new Set(named.filter((k) => keys.has(k)));
  for (const f of config.formulas)
    for (const k of keys) if (!used.has(k) && new RegExp(`\\b${k}\\b`).test(f.expr)) used.add(k);
  return [...used];
}

const TOPIC_ICONS: Record<string, LucideIcon> = {
  Live: RadioIcon,
  Valuation: Scale,
  Analysts: Users,
  Earnings: CalendarClock,
  Dividends: BadgeDollarSign,
  'Range and volume': ChartLine,
  Profile: Building2,
  'P/E history': Scale,
  Technicals: Gauge,
  Change: TrendingUp,
};
const KEY_ICONS: Record<string, LucideIcon> = {
  brokerage: Landmark,
  trading: Repeat,
  cash: Banknote,
};
const iconOf = (s: JoinFieldSpec) => KEY_ICONS[s.key] ?? TOPIC_ICONS[s.topic] ?? Activity;

/** A row's key values as a list (a folded holding has several accounts). */
const listOf = (v: string | string[] | null | undefined): string[] =>
  v === null || v === undefined ? NONE : Array.isArray(v) ? v : [v];
const TICKER = /^[A-Z][A-Z0-9.-]{0,9}$/;
/** A symbol as the joins key it: trimmed, upper case (a frame may carry `nvda`). */
const sym = (s: string) => s.trim().toUpperCase();
/** Symbols the feed follows live on one card, at most this many (it polls each one). */
const FEED_SYMBOLS = 40;
/** Symbols facts are read for on one card, at most. */
const FACT_SYMBOLS = 1000;

/** Something the status bar can do for a source: a linked frame's ↻ (run the assistant's script again). */
export interface JoinAction {
  label: string;
  run: () => void;
  busy: boolean;
  /** Why it cannot run now (shown instead of running). */
  disabled?: string;
}

/** A frame's as-of time as the status bar and the field tree show it. */
export const asOf = (at: string) =>
  new Date(at).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
/** The assistant's frames: their own colour, apart from the Symbol join's. */
const ASSISTANT_COLOR = 'var(--origin-assistant)';
/** The assistant's name where the app names none. */
const ASSISTANT = 'Assistant';
/** Your data: the person's own columns. */
export const YOURS_COLOR = 'var(--origin-yours)';
const recipeId = (id: string) => `recipe:${id}`;
/** A frame's group name on a card: `Assistant · Targets`, or `Yours · Notes` for the person's own. */
export const frameLabel = (meta: Pick<FrameMeta, 'name' | 'origin'>, assistant = 'Assistant') =>
  `${meta.origin === 'yours' ? 'Yours' : assistant} · ${meta.name}`;
export const frameColor = (meta: Pick<FrameMeta, 'origin'>) =>
  meta.origin === 'yours' ? YOURS_COLOR : ASSISTANT_COLOR;
/** The hand-edited cells of a frame, as `column\u0000key` (or `column\u0000#row`). */
export function editedCells(data: FrameData | undefined): Set<string> {
  return new Set(
    (data?.edits ?? []).map(
      (e) => `${e.column}\u0000${e.key !== undefined ? e.key.toUpperCase() : `#${e.row}`}`,
    ),
  );
}
export const editedKey = (column: string, key: string | number) =>
  `${column}\u0000${typeof key === 'number' ? `#${key}` : key.toUpperCase()}`;

/**
 * Edits in place: the cells the person types into a frame on any card, sent
 * to the assistant's API, and the frame's rows in the cache replaced with what came back.
 */
export function useFrameEdits(api: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, edits }: { id: string; edits: FrameEditInput[] }) =>
      json<FrameData>(`${api}/frames/${id}/cells`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ edits }),
      }),
    onSuccess: (data, { id }) => {
      qc.setQueryData(frameKey(api ?? '', id), data);
      void qc.invalidateQueries({ queryKey: [...WORKSPACES_KEY, api, 'ws'] });
    },
  });
}

/** The one Your data frame per key: every card with that key attaches the same columns. */
export const yoursName = (key: JoinKey) => `Your data · ${key === 'symbol' ? 'Symbol' : 'Account'}`;

/** Makes (or extends) the person's Your data frame for a key with one more column. */
export function useYourData(api: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, column }: { key: JoinKey; column: YourColumn }) =>
      json<FrameMeta>(`${api}/frames`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ name: yoursName(key), key, column }),
      }),
    onSuccess: (meta) => {
      void qc.invalidateQueries({ queryKey: frameKey(api ?? '', meta.id) });
      void qc.invalidateQueries({ queryKey: [...WORKSPACES_KEY, api, 'ws'] });
    },
  });
}

const json = <T,>(url: string, init?: RequestInit) => apiJson<T>(url, init, 'joins');

/** One linked frame as a card joins it: its rows by key value, and how its read went. */
interface Linked {
  id: string;
  meta: FrameMeta | null;
  /** The key column's index, or -1 while unknown. */
  keyAt: number;
  byKey: Map<string, (string | number | null)[]>;
  /** The cells the person typed, as `editedKey` makes them. */
  edited: Set<string>;
  state: SourceState['state'];
  detail?: string;
}

/**
 * The linked the assistant frames a view attaches (`config.frames`), read through the assistant's API: each frame's
 * rows by its key value, so `useJoins` can attach its columns to the rows by symbol or account.
 * Off an app with the assistant they read as off.
 */
function useLinkedFrames(ids: string[]): { frames: Linked[]; actions: Record<string, JoinAction> } {
  const api = useAssistant()?.api ?? null;
  const assistant = useAssistantName(ASSISTANT);
  const qc = useQueryClient();
  const reads = useQueries({
    queries: ids.map((id) => ({
      queryKey: frameKey(api ?? '', id),
      queryFn: () => json<FrameData>(`${api}/frames/${id}`),
      enabled: !!api,
      staleTime: Number.POSITIVE_INFINITY,
    })),
  });
  const [running, setRunning] = useState<string | null>(null);
  const refresh = useMutation({
    mutationFn: (id: string) => json<FrameData>(`${api}/frames/${id}/refresh`, { method: 'POST' }),
    onMutate: (id) => setRunning(id),
    onSuccess: (data, id) => {
      qc.setQueryData(frameKey(api ?? '', id), data);
      void qc.invalidateQueries({ queryKey: [...WORKSPACES_KEY, api, 'ws'] });
    },
    onSettled: () => setRunning(null),
  });
  const dataKey = reads
    .map(
      (r) =>
        `${r.status}:${r.data?.meta.at ?? ''}:${r.data?.edits?.length ?? 0}:${r.error?.message ?? ''}`,
    )
    .join('|');
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on each read's state and as-of.
  const frames = useMemo<Linked[]>(
    () =>
      ids.map((id, i) => {
        const r = reads[i];
        const meta = r?.data?.meta ?? null;
        const keyAt = meta?.key ? frameKeyAt(meta, meta.key) : -1;
        const byKey = new Map<string, (string | number | null)[]>();
        if (meta && keyAt >= 0)
          for (const row of r?.data?.rows ?? []) {
            const k = row[keyAt];
            if (k !== null && k !== undefined)
              byKey.set(meta.key === 'symbol' ? sym(String(k)) : String(k), row);
          }
        const failed = r?.error?.message;
        return {
          id,
          meta,
          keyAt,
          byKey,
          edited: editedCells(r?.data),
          state: !api ? 'off' : failed ? 'failed' : !meta ? 'loading' : keyAt < 0 ? 'failed' : 'ok',
          detail: !api
            ? 'no assistant on this desk'
            : failed
              ? failed.slice(0, 80)
              : meta
                ? keyAt < 0
                  ? 'the frame has no key column'
                  : `as of ${asOf(meta.at)}`
                : undefined,
        };
      }),
    [ids, dataKey, api],
  );
  const actions = useMemo<Record<string, JoinAction>>(
    () =>
      Object.fromEntries(
        frames
          .filter((f) => f.meta)
          .map((f) => [
            recipeId(f.id),
            {
              label: `Run ${assistant}’s script again for "${f.meta?.name}"`,
              run: () => refresh.mutate(f.id),
              busy: running === f.id,
              ...(f.meta?.origin === 'yours'
                ? { disabled: 'Your own column: type into its cells to change them' }
                : f.meta?.mode === 'static'
                  ? {
                      disabled: `${assistant} wrote these rows itself: type into a cell to change it`,
                    }
                  : {}),
            },
          ]),
      ),
    [frames, refresh.mutate, running, assistant],
  );
  return { frames, actions };
}

/**
 * Linked frames' columns as fields of `domain`: each column (but the key's) a field under the
 * frame's own group, read from the frame's row with the same key; a key in `taken` is skipped.
 */
function frameFieldsOf<T>(
  domain: ViewDomain<T>,
  frames: Linked[],
  taken: Set<string>,
  api: string | null,
  save: (v: { id: string; edits: FrameEditInput[] }) => Promise<FrameData>,
  assistant: string,
): { groups: ViewFieldGroup[]; fields: ViewField<T>[] } {
  const groups: ViewFieldGroup[] = [];
  const fields: ViewField<T>[] = [];
  for (const f of frames) {
    const meta = f.meta;
    const key = meta?.key;
    const keyOf = key ? domain.keys?.[key] : undefined;
    if (!meta || !key || !keyOf || f.keyAt < 0) continue;
    const gid = recipeId(f.id);
    groups.push({
      id: gid,
      label: frameLabel(meta, assistant),
      color: frameColor(meta),
      note:
        meta.origin === 'yours'
          ? `your own column, by ${key} · type into a cell`
          : `linked by ${key} · as of ${asOf(meta.at)}`,
    });
    const rowKey = (row: T) => {
      const ks = listOf(keyOf(row));
      if (ks.length !== 1) return null;
      const k = ks[0] ?? '';
      return key === 'symbol' ? sym(k) : k;
    };
    meta.columns.forEach((c, i) => {
      if (i === f.keyAt || taken.has(c.key)) return;
      taken.add(c.key);
      fields.push({
        key: c.key,
        name: `${frameSpace(meta.name)}.${c.key}`,
        label: c.label,
        icon: Activity,
        group: gid,
        amount: c.amount,
        value: (row) => {
          const k = rowKey(row);
          return k === null ? null : (f.byKey.get(k)?.[i] ?? null);
        },
        // Edits in place: the assistant or Your data cell takes a typed value;
        // the frame keeps it through every refresh and tells the assistant.
        ...(api && c.type !== 'date'
          ? {
              edit: {
                input: c.type === 'number' ? 'number' : 'text',
                edited: (row: T) => {
                  const k = rowKey(row);
                  return k !== null && f.edited.has(editedKey(c.key, k));
                },
                save: (row: T, value: string | null) => {
                  const k = rowKey(row);
                  if (k === null) return Promise.reject(new Error(`This row has no one ${key}.`));
                  return save({
                    id: f.id,
                    edits: [{ key: k, column: c.key, value }],
                  });
                },
              },
            }
          : {}),
        format: c.format,
        // A the assistant frame's column is as of its last read; the person's own column is fixed.
        ...(meta.origin === 'yours' ? {} : { updates: 'asof' as const }),
        filterable: true,
        groupable: c.type !== 'number',
        // A Total row means a sum of amounts, a mean of percents; a price (a target) adds up to nothing.
        ...(c.type === 'number' && c.format !== 'price' && c.format !== 'price_rounded'
          ? { aggregate: c.format === 'percent' ? 'mean' : 'sum' }
          : {}),
      });
    });
  }
  return { groups, fields };
}

/** A linked frame's group id in a card's field tree (`recipe:fr_…`). */
export const frameGroupId = recipeId;

/**
 * Edit widget's draft of `config.frames`: `domain` (the card's, joined with
 * its saved frames) with the frames `ids` lists, reading the ones it lacks and dropping the rest.
 */
export function useDraftFrames<T>(domain: ViewDomain<T>, ids: readonly string[]): ViewDomain<T> {
  const api = useAssistant()?.api ?? null;
  const edits = useFrameEdits(api);
  const assistant = useAssistantName(ASSISTANT);
  const has = new Set((domain.groups ?? []).map((g) => g.id));
  const missingKey = ids.filter((id) => !has.has(recipeId(id))).join(',');
  const missing = useMemo(() => (missingKey ? missingKey.split(',') : NONE), [missingKey]);
  const linked = useLinkedFrames(missing);
  const idsKey = ids.join(',');
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the ids by value.
  return useMemo(() => {
    const keep = new Set(ids.map(recipeId));
    const gone = (g?: string) => !!g?.startsWith('recipe:') && !keep.has(g);
    const fields = domain.fields.filter((f) => !gone(f.group));
    const groups = (domain.groups ?? []).filter((g) => !gone(g.id));
    const kept = { ...domain, fields, groups };
    const add = frameFieldsOf(
      kept,
      linked.frames,
      new Set(fields.map((f) => f.key)),
      api,
      edits.mutateAsync,
      assistant,
    );
    return { ...kept, fields: [...fields, ...add.fields], groups: [...groups, ...add.groups] };
  }, [domain, idsKey, linked.frames, api, edits.mutateAsync, assistant]);
}

/** The person's linked frames (recipes) a card can attach, for Edit widget's + Data. */
export function useFrameChoices(enabled: boolean) {
  const api = useAssistant()?.api ?? null;
  return useQuery({
    queryKey: [...WORKSPACES_KEY, api, 'frames'],
    queryFn: () => json<{ frames: FrameChoice[] }>(`${api}/frames`).then((r) => r.frames),
    enabled: enabled && !!api,
    staleTime: 30_000,
  });
}

/** A row of plain cells, as a link to a catalog domain or a recipe reads it. */
type CellRow = Record<string, ViewCellValue>;
interface PlainColumn {
  key: string;
  label: string;
  type: 'number' | 'text' | 'date';
  format?: FrameColumn['format'];
  amount?: boolean;
}
const titled = (k: string) => (k.charAt(0).toUpperCase() + k.slice(1)).replace(/_/g, ' ');

/** Plain rows as a domain: a field per column, and the keys (symbol, account) a column carries. */
export function rowsDomain(
  id: string,
  columns: PlainColumn[],
  keys: readonly JoinKey[],
): ViewDomain<CellRow> {
  const at = (k: JoinKey) =>
    columns[frameKeyAt({ columns: columns.map((c) => ({ ...c, format: c.format ?? 'text' })) }, k)]
      ?.key;
  return {
    id,
    rowKey: (r) => JSON.stringify(r),
    fields: columns.map((c) => ({
      key: c.key,
      name: c.key,
      label: c.label,
      icon: c.type === 'number' ? HashIcon : TypeIcon,
      value: (r) => r[c.key] ?? null,
      format: c.format ?? (c.type === 'number' ? 'number' : 'text'),
      amount: c.amount,
      filterable: true,
      groupable: c.type !== 'number',
      ...(c.type === 'number'
        ? { aggregate: c.format === 'percent' ? ('mean' as const) : ('sum' as const) }
        : {}),
    })),
    keys: Object.fromEntries(
      keys.flatMap((k) => {
        const col = at(k);
        return col
          ? [[k, (r: CellRow) => (r[col] === null || r[col] === undefined ? null : String(r[col]))]]
          : [];
      }),
    ),
  };
}

const asAny = (d: ViewDomain<CellRow>) => d as unknown as ViewDomain<unknown>;

/** A catalog domain's plain rows as the domain rows route answers them. */
interface DomainRows {
  label: string;
  rows: Record<string, string | number | boolean | null>[];
  more: boolean;
}
const ROWS_SAMPLE = 200;

/**
 * The rows of every domain or recipe the card links (any data domain or recipe,
 * read once a link is defined): the app's own readers for the ones it reads itself (`linkable`),
 * The assistant's API for the rest, a catalog domain through `GET /domains/:id/rows` as the person and a
 * recipe (`frame:<id>`) through its frame. `live` are the ones a card shows; the rest of `ids` are
 * read by the app only, for the Link offer.
 */
export function useDomainReads(ids: string[], live: string[]): Record<string, ConnectedDomain> {
  const readers = useContext(ReadersCtx);
  const api = useAssistant()?.api ?? null;
  const idsKey = ids.join(',');
  const liveKey = live.join(',');
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the ids by value.
  const split = useMemo(() => {
    const mine = linkable();
    const own = (x: string) => mine.includes(x);
    return {
      deskIds: ids.filter(own),
      deskLive: live.filter(own),
      rest: live.filter((x) => !own(x)),
    };
  }, [idsKey, liveKey]);
  const desk = readers.useDomains(split.deskIds, split.deskLive);
  const reads = useQueries({
    queries: split.rest.map((x) =>
      x.startsWith(FRAME_LINK)
        ? {
            queryKey: frameKey(api ?? '', x.slice(FRAME_LINK.length)),
            queryFn: (): Promise<unknown> =>
              json<FrameData>(`${api}/frames/${x.slice(FRAME_LINK.length)}`),
            enabled: !!api,
            staleTime: Number.POSITIVE_INFINITY,
          }
        : {
            queryKey: [...WORKSPACES_KEY, api, 'domain', x],
            queryFn: (): Promise<unknown> => json<DomainRows>(`${api}/domains/${x}/rows`),
            enabled: !!api,
            staleTime: 5 * 60_000,
          },
    ),
  });
  const dataKey = reads
    .map((r) => `${r.status}:${r.dataUpdatedAt}:${r.error?.message ?? ''}`)
    .join('|');
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on each read's state and time.
  return useMemo(() => {
    const out: Record<string, ConnectedDomain> = { ...desk };
    split.rest.forEach((x, i) => {
      const r = reads[i];
      const frame = x.startsWith(FRAME_LINK);
      const fallback = frame ? 'Recipe' : (CATALOG[x]?.label ?? x);
      const state: ConnectedDomain['state'] = !api
        ? 'off'
        : r?.status === 'success'
          ? 'ok'
          : r?.status === 'error'
            ? 'failed'
            : 'loading';
      const detail = !api ? 'needs an assistant on this desk' : r?.error?.message;
      if (!r?.data) {
        out[x] = {
          label: fallback,
          domain: asAny(rowsDomain(x, [], [])),
          rows: [],
          state,
          ...(detail ? { detail } : {}),
        };
        return;
      }
      if (frame) {
        const data = r.data as FrameData;
        const rows = data.rows.map(
          (v) =>
            Object.fromEntries(data.meta.columns.map((c, j) => [c.key, v[j] ?? null])) as CellRow,
        );
        const keys = (['symbol', 'account'] as const).filter((k) => frameKeyAt(data.meta, k) >= 0);
        out[x] = {
          label: data.meta.name,
          domain: asAny(rowsDomain(x, data.meta.columns, keys)),
          rows,
          state,
        };
        return;
      }
      const data = r.data as DomainRows;
      const seen = new Map<string, PlainColumn>();
      const named = new Map(
        catalogTables(x)
          .flatMap((t) => t.fields)
          .map((f) => [f.key, f.label]),
      );
      for (const row of data.rows.slice(0, ROWS_SAMPLE))
        for (const [k, v] of Object.entries(row))
          if (!seen.has(k) || (seen.get(k)?.type === 'text' && v === null))
            seen.set(k, {
              key: k,
              label: named.get(k) ?? titled(k),
              type: typeof v === 'number' ? 'number' : 'text',
            });
      const rows = data.rows.map(
        (row) =>
          Object.fromEntries(
            Object.entries(row).map(([k, v]) => [
              k,
              typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v,
            ]),
          ) as CellRow,
      );
      out[x] = {
        label: data.label,
        domain: asAny(rowsDomain(x, [...seen.values()], catalogKeys(x))),
        rows,
        state,
        ...(data.more ? { detail: `first ${rows.length.toLocaleString()} rows` } : {}),
      };
    });
    return out;
  }, [desk, split, dataKey, api]);
}

/** What one source shows after its name, from how it fared. */
export function detailOf(s: SourceState | undefined, idle: string): string {
  if (!s) return idle;
  if (s.state === 'ok') return s.detail ?? 'ok';
  if (s.state === 'loading') return 'loading…';
  return [s.state, s.detail].filter(Boolean).join(': ');
}

/**
 * `domain` with the registry's join fields for the keys its rows carry, loaded for the join fields
 * `config` uses over `rows`, and how each source fared. A domain with no keys comes back as is.
 */
export function useJoins<T>(
  domain: ViewDomain<T>,
  rows: T[],
  config: CustomViewConfig,
): {
  domain: ViewDomain<T>;
  sources: SourceState[];
  actions: Record<string, JoinAction>;
  /** What each connected or connectable domain read, for the Link offer. */
  read: Record<string, ConnectedDomain>;
} {
  const readers = useContext(ReadersCtx);
  const frameIdKey = (config.frames ?? NONE).join(',');
  const frameIds = useMemo(() => (frameIdKey ? frameIdKey.split(',') : NONE), [frameIdKey]);
  const api = useAssistant()?.api ?? null;
  const assistant = useAssistantName(ASSISTANT);
  const edits = useFrameEdits(api);
  const linked = useLinkedFrames(frameIds);
  // Connections: the domains this card connects to, read live, and the ones it could (the offer).
  const connections = config.connections ?? NO_CONN;
  const liveIdKey = connections.map((c) => c.to).join(',');
  const offerIdKey = Object.keys(domain.keys ?? {}).length
    ? connectCandidates(domain.id, config).join(',')
    : '';
  const liveIds = useMemo(() => (liveIdKey ? liveIdKey.split(',') : NONE), [liveIdKey]);
  const readIds = useMemo(
    () => [...new Set([...liveIds, ...(offerIdKey ? offerIdKey.split(',') : NONE)])],
    [liveIds, offerIdKey],
  );
  const read = useDomainReads(readIds, liveIds);
  const symbolOf = domain.keys?.symbol;
  const accountOf = domain.keys?.account;
  const contractOf = domain.keys?.contract;
  const ownKey = domain.fields.map((f) => f.key).join(',');
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the field keys.
  const specs = useMemo(() => {
    const own = ownKey.split(',');
    return {
      symbol: symbolOf ? joinFields(['symbol'], own) : [],
      account: accountOf ? joinFields(['account'], own) : [],
      contract: contractOf ? joinFields(['contract'], own) : [],
    };
  }, [ownKey, !!symbolOf, !!accountOf, !!contractOf]);
  const usedSymbol = usedJoinKeys(config, new Set(specs.symbol.map((f) => f.key)));
  const usedAccount = usedJoinKeys(config, new Set(specs.account.map((f) => f.key)));
  const usedContract = usedJoinKeys(config, new Set(specs.contract.map((f) => f.key)));
  const usedContractKey = usedContract.join(',');
  const contracts = useMemo(
    () =>
      contractOf && usedContractKey
        ? [...new Set(rows.flatMap((r) => listOf(contractOf(r))))].sort()
        : NONE,
    [rows, contractOf, usedContractKey],
  );
  const feedOn = usedSymbol.some((k) => specs.symbol.find((f) => f.key === k)?.source === 'feed');
  const factsOn = usedSymbol.some((k) => specs.symbol.find((f) => f.key === k)?.source !== 'feed');
  const symbols = useMemo(
    () =>
      symbolOf && (feedOn || factsOn)
        ? [...new Set(rows.flatMap((r) => listOf(symbolOf(r)).map(sym)))]
            .filter(Boolean)
            .sort()
            .slice(0, FACT_SYMBOLS)
        : NONE,
    [rows, symbolOf, feedOn, factsOn],
  );
  const feedSymbols = useMemo(
    () => (feedOn ? symbols.filter((s) => TICKER.test(s)).slice(0, FEED_SYMBOLS) : NONE),
    [symbols, feedOn],
  );
  const usedAccountKey = usedAccount.join(',');
  const ids = useMemo(
    () =>
      accountOf && usedAccountKey
        ? [...new Set(rows.flatMap((r) => listOf(accountOf(r))))].sort()
        : NONE,
    [rows, accountOf, usedAccountKey],
  );
  const market = useMarket(feedSymbols);
  const facts = readers.useSymbolFacts(symbols, factsOn);
  const acc = readers.useAccountFacts(ids, usedAccount);
  const opt = readers.useContractFacts(contracts, usedContract);
  // The feed redraws on every tick; the fields change only when a price does.
  const quotes =
    market.status === 'off' || !feedSymbols.length
      ? ''
      : JSON.stringify(
          Object.entries(market.series).map(([s, x]) => {
            const last = x.bars.at(-1)?.c ?? null;
            return [
              s,
              last,
              last !== null && x.prevClose ? ((last - x.prevClose) / x.prevClose) * 100 : null,
            ];
          }),
        );
  const live = useMemo(
    () =>
      new Map(
        quotes
          ? (JSON.parse(quotes) as [string, number | null, number | null][]).map(
              ([s, price, change]) => [s, { price, change_pct: change }],
            )
          : [],
      ),
    [quotes],
  );
  const connected = useMemo(
    () =>
      connectionFields(
        domain,
        connections,
        read,
        new Set([
          ...ownKey.split(','),
          ...specs.symbol.map((f) => f.key),
          ...specs.account.map((f) => f.key),
          ...specs.contract.map((f) => f.key),
        ]),
      ),
    [domain, connections, read, ownKey, specs],
  );
  const sources = useMemo<SourceState[]>(() => {
    const out: SourceState[] = [];
    if (feedOn)
      out.push({
        id: 'feed',
        name: 'Feed',
        state:
          market.status === 'off'
            ? 'off'
            : market.status === 'error'
              ? 'failed'
              : market.status === 'loading' || market.status === 'connecting'
                ? 'loading'
                : 'ok',
        detail:
          market.status === 'off'
            ? 'no feed on this desk'
            : market.status === 'error'
              ? (market.error ?? undefined)
              : market.status === 'closed'
                ? 'last session'
                : 'live',
      });
    if (factsOn) out.push(...facts.sources);
    if (usedAccountKey) out.push(...acc.sources);
    // The option quotes come from the same feed: one Feed line however many joins read it.
    if (usedContractKey) out.push(...opt.sources.filter((s) => !out.some((o) => o.id === s.id)));
    out.push(...connected.sources);
    for (const f of linked.frames) {
      const key = f.meta?.key;
      const carries = key ? !!domain.keys?.[key] : true;
      out.push({
        id: recipeId(f.id),
        name: f.meta ? frameLabel(f.meta, assistant) : `${assistant} · frame`,
        state: carries ? f.state : 'failed',
        detail: carries ? f.detail : `this card's rows carry no ${key}`,
      });
    }
    return out;
  }, [
    feedOn,
    factsOn,
    usedAccountKey,
    market.status,
    market.error,
    facts.sources,
    acc.sources,
    usedContractKey,
    opt.sources,
    linked.frames,
    domain.keys,
    connected.sources,
    assistant,
  ]);
  const joined = useMemo(() => {
    if (
      !specs.symbol.length &&
      !specs.account.length &&
      !specs.contract.length &&
      !linked.frames.length &&
      !connected.fields.length
    )
      return domain;
    const byId = new Map(sources.map((s) => [s.id, s]));
    const field = (
      spec: JoinFieldSpec,
      group: JoinKey,
      keyOf: (row: T) => string | string[] | null,
      read: (key: string) => ViewCellValue | undefined,
    ): ViewField<T> => ({
      key: spec.key,
      name: `${group}.${spec.key}`,
      label: spec.label,
      icon: iconOf(spec),
      group,
      topic: spec.topic || undefined,
      value: (row) => {
        const ks = listOf(keyOf(row));
        if (!ks.length || (spec.single && ks.length !== 1)) return null;
        const vs = ks.map(read);
        const first = vs[0];
        return first !== undefined && vs.every((v) => v === first) ? first : null;
      },
      format: spec.format,
      compact: spec.compact,
      empty: spec.empty,
      formula: spec.formula,
      amount: spec.amount,
      filterable: spec.category,
      groupable: spec.category,
      updates: spec.updates,
    });
    const fields: ViewField<T>[] = [
      ...(symbolOf
        ? specs.symbol.map((s) =>
            field(s, 'symbol', symbolOf, (k) =>
              s.source === 'feed'
                ? (live.get(sym(k))?.[s.key as 'price' | 'change_pct'] ?? null)
                : facts.facts[sym(k)]?.[s.key],
            ),
          )
        : []),
      ...(accountOf
        ? specs.account.map((s) =>
            field(s, 'account', accountOf, (k) => acc.facts[k]?.[s.key as keyof AccountFacts]),
          )
        : []),
      ...(contractOf
        ? specs.contract.map((s) =>
            field(s, 'contract', contractOf, (k) => opt.facts[k]?.[s.key] ?? null),
          )
        : []),
    ];
    // Linked frames: each column (but the key's) a field under the frame's own group, read from
    // the frame's row with the same key; a field the card already has keeps the card's.
    fields.push(...connected.fields);
    const taken = new Set([...domain.fields, ...fields].map((f) => f.key));
    const framed = frameFieldsOf(domain, linked.frames, taken, api, edits.mutateAsync, assistant);
    const frameGroups = framed.groups;
    fields.push(...framed.fields);
    const group = (key: JoinKey, fieldSpecs: JoinFieldSpec[]): ViewFieldGroup => ({
      id: key,
      label: JOINS[key].label,
      color: JOINS[key].color,
      note: JOINS[key].note,
      sources: Object.fromEntries(
        fieldSpecs
          .filter((s) => s.topic)
          .map((s) => [
            s.topic,
            {
              name: JOIN_SOURCES[s.source]?.name ?? s.source,
              color: JOIN_SOURCES[s.source]?.color ?? 'var(--chart-5)',
              detail: detailOf(byId.get(s.source), JOIN_SOURCES[s.source]?.idle ?? ''),
            },
          ]),
      ),
    });
    return {
      ...domain,
      // A domain with no groups of its own puts its fields under the first join's (Accounts).
      groups: [
        ...(domain.groups ?? []),
        ...(specs.symbol.length ? [group('symbol', specs.symbol)] : []),
        ...(specs.account.length ? [group('account', specs.account)] : []),
        ...(specs.contract.length ? [group('contract', specs.contract)] : []),
        ...connected.groups,
        ...frameGroups,
      ],
      fields: [...domain.fields, ...fields],
    };
  }, [
    connected,
    domain,
    specs,
    symbolOf,
    accountOf,
    contractOf,
    live,
    facts.facts,
    acc.facts,
    opt.facts,
    sources,
    linked.frames,
    api,
    edits.mutateAsync,
    assistant,
  ]);
  useReportSources(sources);
  return { domain: joined, sources, actions: linked.actions, read };
}

/** The status bar's word on each source: its dot and state, or a Connect button where it is off and can be turned on. */
export function SourceStatusItems({
  sources,
  actions,
}: { sources: SourceState[]; actions?: Record<string, JoinAction> }) {
  const { openSettings } = useShell();
  return (
    <>
      {sources.map((s) => {
        const action = actions?.[s.id];
        return s.state === 'off' && s.connect ? (
          <IconButton
            key={s.id}
            icon={PlugIcon}
            size="icon-xs"
            label={`Connect ${s.name} for its fields`}
            onClick={() => openSettings(s.connect)}
          />
        ) : (
          <span key={s.id} className="inline-flex items-center gap-0.5">
            <StatusItem
              label={s.name}
              value={detailOf(s, '')}
              ok={
                s.state === 'ok' ? true : s.state === 'loading' || s.state === 'off' ? null : false
              }
            />
            {action ? (
              <IconButton
                icon={RefreshCwIcon}
                size="icon-xs"
                label={action.disabled ?? action.label}
                busy={action.busy}
                disabled={action.busy || !!action.disabled}
                onClick={action.run}
              />
            ) : null}
          </span>
        );
      })}
    </>
  );
}
