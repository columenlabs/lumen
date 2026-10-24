// An option chain as calls | strike | puts, one row per strike, the strike pinned in the centre
// (an app's live chain; in the shell since Edge drift step 2, 2026-10-14). Calls read leftward
// and puts rightward from the strike, a row marks the price between strikes, and in-the-money
// cells are shaded. The app passes its rows and how each field reads and prints.
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table';
import { Fragment, useEffect, useMemo, useRef } from 'react';
import { cn } from '../lib/utils';
import { Badge } from '../ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

export interface OptionChainRow<Q> {
  strike: number;
  call?: Q;
  put?: Q;
}

export interface OptionChainField<Q> {
  key: string;
  label: string;
  value: (q: Q) => number | null;
  format: (v: number | null) => string;
}

const features = tableFeatures({});

export function OptionChainTable<Q>({
  rows,
  fields,
  spot,
  format,
}: {
  rows: OptionChainRow<Q>[];
  /** Read outward from the strike: the first field sits next to it on both sides. */
  fields: OptionChainField<Q>[];
  spot: number | null;
  /** How a strike and the price print. */
  format: (v: number) => string;
}) {
  const columns = useMemo(() => {
    const h = createColumnHelper<typeof features, OptionChainRow<Q>>();
    const side = (type: 'call' | 'put', list: OptionChainField<Q>[]) =>
      h.columns(
        list.map((f) =>
          h.accessor(
            (r) => {
              const q = r[type];
              return q === undefined ? null : f.value(q);
            },
            { id: `${type}-${f.key}`, header: f.label, cell: (c) => f.format(c.getValue()) },
          ),
        ),
      );
    return h.columns([
      h.group({ id: 'calls', header: 'Calls', columns: side('call', [...fields].reverse()) }),
      h.accessor('strike', { header: 'Strike', cell: (c) => format(c.getValue()) }),
      h.group({ id: 'puts', header: 'Puts', columns: side('put', fields) }),
    ]);
  }, [fields, format]);
  const table = useTable({ features, columns, data: rows });

  // Open centred on the money and on the strike column; re-centre only when the strike set changes.
  const box = useRef<HTMLDivElement>(null);
  const strikeKey = rows.length ? `${rows[0]?.strike}-${rows.length}` : '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the strike set, not every tick
  useEffect(() => {
    const el = box.current;
    const row = el?.querySelector<HTMLElement>('[data-spot]');
    if (el && row) el.scrollTop = row.offsetTop - el.clientHeight / 2;
    const strike = el?.querySelector<HTMLElement>('[data-strike]');
    if (el && strike)
      el.scrollLeft = strike.offsetLeft + strike.offsetWidth / 2 - el.clientWidth / 2;
  }, [strikeKey, spot === null]);

  return (
    <div
      ref={box}
      className="max-h-[70vh] overflow-auto rounded-lg border bg-card [&>[data-slot=table-container]]:overflow-visible"
    >
      <Table className="num text-xs">
        <TableHeader className="sticky top-0 z-10 bg-muted">
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id} className="hover:bg-transparent">
              {hg.headers.map((hd) => (
                <TableHead
                  key={hd.id}
                  colSpan={hd.colSpan}
                  className={cn(
                    'h-(--row-h) px-(--cell-x) text-right font-sans text-xs font-medium text-muted-foreground',
                    hd.column.id === 'strike' && 'text-center',
                    // Group labels sit next to the strike, so both read when the table opens centred.
                    hd.subHeaders.length > 0 && 'text-foreground',
                    hd.column.id === 'puts' && 'text-left',
                  )}
                >
                  {hd.isPlaceholder ? null : <table.FlexRender header={hd} />}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row, i, all) => {
            const k = row.original.strike;
            const prev = all[i - 1]?.original.strike;
            // The price sits between the last strike below it and the first at or above it.
            const marker =
              spot !== null && k >= spot && (prev === undefined ? k > spot : prev < spot) ? (
                <TableRow
                  key="spot"
                  data-spot
                  aria-label={`Price ${format(spot)}`}
                  className="bg-primary/10 hover:bg-primary/10"
                >
                  <TableCell colSpan={fields.length} className="h-6 p-0" />
                  <TableCell className="h-6 px-(--cell-x) py-0 text-center">
                    <Badge className="num h-5 px-1.5">{format(spot)}</Badge>
                  </TableCell>
                  <TableCell colSpan={fields.length} className="h-6 p-0" />
                </TableRow>
              ) : null;
            return (
              <Fragment key={row.id}>
                {marker}
                <TableRow>
                  {row.getAllCells().map((cell) => {
                    const id = cell.column.id;
                    const itm =
                      spot !== null &&
                      ((id.startsWith('call') && k < spot) || (id.startsWith('put') && k > spot));
                    return (
                      <TableCell
                        key={cell.id}
                        data-strike={id === 'strike' || undefined}
                        className={cn(
                          'h-(--row-h) px-(--cell-x) py-0 text-right',
                          id === 'strike' && 'bg-muted/60 text-center font-medium',
                          itm && 'bg-muted/40',
                          cell.getValue() === null && 'text-ink-subtle',
                        )}
                      >
                        <table.FlexRender cell={cell} />
                      </TableCell>
                    );
                  })}
                </TableRow>
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
