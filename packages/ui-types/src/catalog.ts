// The catalog: one list of every data domain an app's pages show, the app each belongs to, the
// tables its rows come from with their fields, and the function that reads them. The kit holds the
// shapes and the lookups; an app registers its domains once at start (`registerDomains` in
// ./registry), and Edit widget's + Data, connections and joins read them from here.
import { DOMAIN_KEYS, type JoinKey } from './domains';
import { DOMAIN_OWN, customViewFields } from './views';

/** Where a table's rows live. `built` rows are worked out in the app from what its reader returns. */
export type CatalogTableKind = 'd1' | 'clickhouse' | 'r2' | 'dataset' | 'live' | 'built';

export interface CatalogField {
  key: string;
  label?: string;
  /** Where the field sits in a reader's row when not at its key (`desks.data`). */
  from?: string;
}

export interface CatalogTable {
  /** As the admin page names it, e.g. "D1 members". */
  name: string;
  kind: CatalogTableKind;
  /** Rows sealed by the vault (a person's financial data, keys, chats). */
  sealed?: boolean;
  /** Left out: the domain's own fields from `customViewFields` (one list per domain, never two). */
  fields?: readonly CatalogField[];
}

export interface CatalogDomain {
  label: string;
  /** The app the domain belongs to, as the app names it (`trade`). */
  desk: string;
  about: string;
  /** `deprecated`: the assistant no longer sees it; `replacedBy` names what took its place. */
  status: 'live' | 'deprecated';
  replacedBy?: string;
  /** The app's own grouping for who may read it (an assistant's area); none: no reader. */
  area?: string;
  /** The function that reads its rows, `<ns>.<tool>`; none: no function returns them yet. */
  read?: string;
  /** Where the rows sit in the reader's answer (`members` for `{members: [...]}`); none: the answer is the rows. */
  rows?: string;
  /** The reader's input for a probe; `false`: it needs one only a person picks (an account). */
  probe?: Record<string, unknown> | false;
  /**
   * Another card may link this domain's rows by a key both carry (Edit widget's
   * + Data): the columns a link adds first. None: it cannot be linked yet.
   */
  link?: readonly string[];
  tables: readonly CatalogTable[];
}

/** Every registered data domain, by the id its pages and saved views use. */
export const CATALOG: Record<string, CatalogDomain> = {};

/** A domain's tables with their fields resolved (own fields from `customViewFields` where left out). */
export function catalogTables(id: string): { table: CatalogTable; fields: CatalogField[] }[] {
  const d = CATALOG[id];
  if (!d) return [];
  const base = DOMAIN_OWN[id] ?? customViewFields[id]?.columns ?? [];
  return d.tables.map((table) => ({
    table,
    fields: table.fields ? [...table.fields] : base.map((key) => ({ key })),
  }));
}

/** The live domains another card can link (`link`), by id. */
export const linkable = (): string[] =>
  Object.entries(CATALOG)
    .filter(([, d]) => d.status === 'live' && d.link)
    .map(([id]) => id);
/** The columns linking `id` adds first; none when it cannot be linked. */
export const linkColumns = (id: string): readonly string[] => CATALOG[id]?.link ?? [];
/**
 * A domain any card may add through Edit widget's + Data ("add any of the
 * available data domains or recipes, but they don't get activated unless a link is defined"): a
 * live one whose reader runs without an input only a person picks, read through
 * The app's domain rows route, or one the app reads itself (`linkable`).
 */
export const readableDomain = (id: string, catalog: Record<string, CatalogDomain> = CATALOG) => {
  const d = catalog[id];
  return !!d && d.status === 'live' && (linkable().includes(id) || (!!d.read && d.probe !== false));
};
/** A connection to a recipe (a frame) rather than a domain: `frame:<id>`. */
export const FRAME_LINK = 'frame:';
/** What is wrong with a view's links: each must be to a domain + Data can add, or a recipe. */
export const linkIssues = (connections: readonly { to: string }[] | undefined): string[] =>
  (connections ?? []).flatMap((c, i) =>
    c.to.startsWith(FRAME_LINK) || readableDomain(c.to)
      ? []
      : [`connections.${i}: ${c.to} cannot be linked: no reader returns its rows`],
  );

/** The keys a domain's rows carry (symbol, account), so the Symbol and Account fields join them. */
export const catalogKeys = (id: string): JoinKey[] => DOMAIN_KEYS[id] ?? [];

/** The catalog domains whose reader is one of `fns` (`<ns>.<tool>`) and that are live. */
export function readableDomains(
  fns: ReadonlySet<string>,
  catalog: Record<string, CatalogDomain> = CATALOG,
): [string, CatalogDomain][] {
  return Object.entries(catalog).filter(
    ([, d]) => d.status === 'live' && d.read !== undefined && fns.has(d.read),
  );
}
