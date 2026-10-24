import { type ViewCard, controlOn } from '@columenlabs/lumen-ui-types/views';
// A second table on a LumenLayout page (every table is a LumenView): the
// page's own rows as a LumenView card with its own filter, Group button, Columns picker, pager and
// a header that pins under the page's tabs. Its link colour joins the page's filter links: its
// linked chips narrow every card of its colour, and it follows theirs. Pass it as a page card of kind `own` through `frame`, so the
// layout can move it and size it on the grid.
import type { RowData } from '@tanstack/react-table';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useGroup } from './group-button';
import { useJoins } from './joins';
import {
  type FilterField,
  type FilterToken,
  LumenTokenizedFilter,
  filterByTokens,
  useLumenFilter,
} from './lumen-filter';
import {
  followedBy,
  followsText,
  keyFilterFields,
  useLinks,
  usePublishLinks,
  useRowPick,
} from './lumen-links';
import type { LumenLoad } from './lumen-source';
import { type CustomViewConfig, LumenView, type ViewDomain } from './lumen-view';
import { type CardControls, cardFilterFields } from './lumen-widget';
import { filterFieldsOf } from './view-model';

export interface LumenViewCardProps<T> {
  /** Its card id on the page (its fold is kept per id); left out, its name. */
  id?: string;
  domain: ViewDomain<T>;
  /** The view's columns, filters and pagination; the Columns picker changes them for this visit. */
  config: CustomViewConfig;
  rows: T[];
  load?: LumenLoad;
  title?: string;
  /** Buttons in the card's header before the pager. */
  tools?: ReactNode;
  /** A short subtitle after the title (a repo path). */
  note?: ReactNode;
  /** Shown in place of the table (an empty state). */
  state?: ReactNode;
  /** A row click (pick a version, open a drawer). */
  onDetails?: (row: T) => void;
  /** Its place in the layout: the layout's `frame` hands these over. */
  controls?: CardControls;
  /** Its saved controls (Edit widget ▸ Controls), on a saved page's table. */
  shown?: ViewCard['controls'];
  /** Saves a Columns change; left out, it lasts the visit. */
  onColumns?: (columns: string[]) => void;
  /** Chips it shares with the cards of its colour besides its filter's: what a control in its
   *  header picked (`{key: 'book', value: 'Live'}`), like a code card's `publishes`. */
  publishes?: FilterToken[];
}

export function LumenViewCard<T extends RowData>({
  id,
  domain: base,
  config: saved,
  rows,
  load,
  title,
  tools,
  note,
  state,
  onDetails,
  controls,
  shown: savedControls,
  onColumns,
  publishes,
}: LumenViewCardProps<T>) {
  const [config, setConfig] = useState(saved);
  // A saved layout that changes (an edit, the assistant move) is drawn at once.
  const savedKey = JSON.stringify(saved);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the saved config's content.
  useEffect(() => setConfig(saved), [savedKey]);
  // The registry's join fields for the keys the rows carry.
  const { domain } = useJoins(base, rows, config);
  const fields = useMemo<FilterField<T>[]>(
    () => cardFilterFields(filterFieldsOf(domain.fields, config.filters.fields)),
    [domain.fields, config.filters.fields],
  );
  const filter = useLumenFilter(rows, fields, {
    text: domain.text,
    initial: config.filters.default,
  });
  const group = useGroup(domain, config);
  const cardId = id ?? config.name;
  const links = useLinks();
  const color = links?.colorOf(cardId) ?? null;
  const pick = useRowPick(domain, color);
  const sharedKey = JSON.stringify(publishes ?? []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on what its header shares.
  const published = useMemo(
    () => [...filter.tokens, ...pick.token, ...(publishes ?? [])],
    [filter.tokens, pick.token, sharedKey],
  );
  usePublishLinks(cardId, published);
  // What it follows from the page's other cards of its colour, read on any of its fields.
  const all = useMemo(
    () => [...cardFilterFields(domain.fields), ...keyFilterFields(domain.keys)],
    [domain.fields, domain.keys],
  );
  const follows = followedBy(links?.follows(cardId) ?? [], all, domain.keys);
  const followKey = JSON.stringify(follows);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on what it follows.
  const shown = useMemo(
    () =>
      follows.length ? filterByTokens(filter.results, all, follows, domain.text) : filter.results,
    [filter.results, all, followKey, domain.text],
  );
  const link = links && {
    color,
    onPick: (c: typeof color) => links.setColor(cardId, c),
    follows: followsText(follows),
    linked: color ? filter.tokens.length : 0,
  };
  const on = (k: 'filter' | 'group') => controlOn({ kind: 'table', controls: savedControls }, k);
  return (
    <LumenView
      domain={domain}
      config={config}
      rows={shown}
      total={rows.length}
      groupBy={group.groupField}
      pivot={group.pivot}
      subgroup={group.sub}
      load={load}
      state={state}
      onDetails={pick.onTap ?? onDetails}
      tapped={pick.tapped}
      title={title ?? config.name}
      inLayout
      cardId={cardId}
      controls={controls}
      tools={tools}
      note={note}
      filter={
        <>
          {on('filter') && (
            <LumenTokenizedFilter
              filter={filter}
              label={`Filter ${config.name}`}
              className="min-w-0 flex-1"
              link={link || undefined}
            />
          )}
          {on('group') && group.button}
        </>
      }
      filterCount={filter.tokens.length}
      link={link || undefined}
      shown={savedControls}
      onColumns={(columns) => {
        setConfig((c) => ({ ...c, columns }));
        onColumns?.(columns);
      }}
    />
  );
}
