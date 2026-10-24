// A widget with its own main data (`source` on the card): it reads that domain or recipe itself
// (the same reads a link uses), joins its own links, and draws like any widget over those rows. It
// shares nothing of the page's rows; the page's chips reach it only by a key both carry.
import {
  type ViewWidget,
  isRowCard,
  isTableCard,
  sourceConfigOf,
  tilesOfCard,
} from '@columenlabs/lumen-ui-types/views';
import type { RowData } from '@tanstack/react-table';
import { useMemo } from 'react';
import { useDomainReads, useJoins } from './joins';
import { filterByTokens } from './lumen-filter';
import { followedBy, followsText, keyFilterFields, useLinks } from './lumen-links';
import type { LumenLoad } from './lumen-source';
import { mergeRows } from './lumen-view';
import { LumenViewCard } from './lumen-view-card';
import { type CardControls, LumenSavedWidget, cardFilterFields, cardTitle } from './lumen-widget';
import { LumenCard, SummaryTiles } from './summary-cards';
import { type ViewDomain, summaryCash, withViewFields } from './view-model';

/** A source read's state as the card's loading state. */
function loadOf(state: string, detail: string | undefined, label: string): LumenLoad {
  const failed = state === 'failed' || state === 'off';
  return {
    loading: state === 'loading',
    fetching: state === 'loading',
    refreshing: false,
    background: false,
    error: failed ? new Error(`${label}: ${detail ?? 'could not be read'}`) : null,
    stale: null,
    refresh: async () => {},
    tookMs: null,
    cached: false,
    at: null,
  };
}

export function SourcedCard({
  card,
  name,
  controls,
}: {
  card: ViewWidget & { source: string };
  /** The page's name, for a widget with no title of its own. */
  name: string;
  controls?: CardControls;
}) {
  const ids = useMemo(() => [card.source], [card.source]);
  const read = useDomainReads(ids, ids)[card.source];
  const base = (read?.domain ?? {
    id: card.source,
    rowKey: String,
    fields: [],
  }) as ViewDomain<RowData>;
  const rows = (read?.rows ?? []) as RowData[];
  const config = useMemo(() => sourceConfigOf(card, name), [card, name]);
  const load = loadOf(read?.state ?? 'loading', read?.detail, read?.label ?? card.source);
  if (isTableCard(card))
    return (
      <LumenViewCard
        id={card.id}
        domain={base}
        config={config}
        rows={
          card.filter.length
            ? filterByTokens(rows, cardFilterFields(base.fields), card.filter)
            : rows
        }
        load={load}
        title={card.title ?? read?.label ?? name}
        controls={controls}
        shown={card.controls}
      />
    );
  return (
    <SourcedWidget
      card={card}
      base={base}
      rows={rows}
      load={load}
      label={read?.label ?? name}
      controls={controls}
    />
  );
}

function SourcedWidget<T>({
  card,
  base,
  rows,
  load,
  label,
  controls,
}: {
  card: ViewWidget & { source: string };
  base: ViewDomain<T>;
  rows: T[];
  load: LumenLoad;
  label: string;
  controls?: CardControls;
}) {
  const config = useMemo(() => sourceConfigOf(card, label), [card, label]);
  const joins = useJoins(base, rows, config);
  const domain = useMemo(() => withViewFields(joins.domain, config), [joins.domain, config]);
  const fields = useMemo(
    () => [...cardFilterFields(domain.fields), ...keyFilterFields(domain.keys)],
    [domain.fields, domain.keys],
  );
  const links = useLinks();
  const follows = followedBy(links?.follows(card.id) ?? [], fields, domain.keys);
  const own = card.filter.length ? filterByTokens(rows, fields, card.filter, domain.text) : rows;
  const drawn = follows.length ? filterByTokens(own, fields, follows, domain.text) : own;
  const narrowed = card.filter.length > 0 || follows.length > 0;
  const counted =
    domain.cash && !summaryCash(isRowCard(card) ? card : {}, narrowed)
      ? drawn.filter((r) => !domain.cash?.(r))
      : drawn;
  const loading = load.loading;
  return (
    <LumenSavedWidget
      widget={card}
      title={card.title ?? cardTitle(card, label)}
      domain={domain}
      rows={drawn}
      link={
        links
          ? {
              color: links.colorOf(card.id),
              onPick: (c) => links.setColor(card.id, c),
              follows: followsText(follows),
            }
          : undefined
      }
      fields={fields}
      merge={(rs) => mergeRows(domain, rs, null)}
      load={load}
      tiles={
        'tile' in card ? (
          <LumenCard
            domain={domain}
            tile={card.tile}
            rows={counted}
            fields={fields}
            loading={loading}
            style={card.style}
            target={card.target}
            meter={card.meter}
            bands={card.bands}
          />
        ) : isRowCard(card) ? (
          <SummaryTiles
            domain={domain}
            tiles={tilesOfCard(config, card)}
            rows={counted}
            fields={fields}
            loading={loading}
          />
        ) : null
      }
      controls={controls}
    />
  );
}
