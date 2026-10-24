// The registry: what an app tells the kit about its own data, once at start, before anything
// renders or answers. The kit ships the shapes and the machinery (views, joins, connections, the
// catalog's lookups) with every list empty; `registerDomains` fills them. Call it from the module
// your entries import first, on the server and in the browser alike, so both read the same lists.
import { CATALOG, type CatalogDomain } from './catalog';
import {
  DOMAIN_KEYS,
  JOINS,
  JOIN_SOURCES,
  type JoinKey,
  type JoinSourceSpec,
  type JoinSpec,
} from './domains';
import {
  DOMAIN_OWN,
  type DomainFieldSet,
  FIELDS_MOVED,
  type ViewWidgetPreset,
  customViewFields,
  viewWidgetCatalog,
} from './views';

export interface DomainRegistry {
  /** Each join's fields (and label, note, colour), by the key they attach to. */
  joins?: Partial<Record<JoinKey, JoinSpec>>;
  /** Each source a join field names, with its name and colour. */
  joinSources?: Record<string, JoinSourceSpec>;
  /** The keys each domain's rows carry. */
  domainKeys?: Record<string, JoinKey[]>;
  /** Each domain's own field keys (the rest of its columns are join fields). */
  own?: Record<string, string[]>;
  /** Each domain's field keys for views. */
  fields?: Record<string, DomainFieldSet>;
  /** Pre-built widgets per domain. */
  widgets?: Record<string, ViewWidgetPreset[]>;
  /** Field keys a domain renamed, rewritten in saved configs on read. */
  moved?: Record<string, Record<string, string>>;
  /** Every data domain the app's pages show. */
  catalog?: Record<string, CatalogDomain>;
}

/** Adds `r` to the kit's lists; a later call adds to (and for the same id replaces) the earlier. */
export function registerDomains(r: DomainRegistry): void {
  for (const [k, spec] of Object.entries(r.joins ?? {}) as [JoinKey, JoinSpec][]) JOINS[k] = spec;
  Object.assign(JOIN_SOURCES, r.joinSources);
  Object.assign(DOMAIN_KEYS, r.domainKeys);
  Object.assign(DOMAIN_OWN, r.own);
  Object.assign(customViewFields, r.fields);
  Object.assign(viewWidgetCatalog, r.widgets);
  Object.assign(FIELDS_MOVED, r.moved);
  Object.assign(CATALOG, r.catalog);
}
