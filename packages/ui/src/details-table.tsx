// The small tables of a details drawer (an app Holdings first): one row per
// item with positional cells, or facts as a two-row table (the labels as the header, the values
// under them). Every column but one fits its content and that one takes the rest, so a drawer's
// tables line up the same way whatever their values. In the shell so every app's drawers share
// it (Edge drift step 2, 2026-10-14).
import type { ReactNode } from 'react';
import { cn } from './lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table';

export interface DetailsTableProps {
  /** `grow` marks the column that takes the spare width; the last column does by default.
   *  `hideOnPhone` drops a column on a phone, so the rest fit without scrolling sideways. */
  head: { label: string; right?: boolean; grow?: boolean; hideOnPhone?: boolean }[];
  rows: { key: string; cells: ReactNode[] }[];
  /** An optional total row, one cell per column. */
  foot?: ReactNode[];
  /** The key of the row shown as picked, when rows can be picked. */
  selected?: string;
  /** Makes each row pickable by click or Enter/Space, for example to chart the picked row below. */
  onSelect?: (key: string) => void;
}

export function DetailsTable({ head, rows, foot, selected, onSelect }: DetailsTableProps) {
  const marked = head.findIndex((h) => h.grow);
  const grow = marked >= 0 ? marked : head.length - 1;
  const cell = (i: number) =>
    cn(
      head[i]?.right && 'num text-right',
      i !== grow && 'w-px',
      // A marked `grow` column (a name) takes the spare width and no more: a long name ends in an
      // ellipsis instead of pushing the other columns out of the card.
      i === marked && 'w-full max-w-0 truncate [&>*]:max-w-full',
      head[i]?.hideOnPhone && 'max-md:hidden',
    );
  return (
    <div className="-mx-1 overflow-x-auto overflow-y-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {head.map((h, i) => (
              <TableHead
                key={h.label}
                className={cn(
                  h.right && 'text-right',
                  i !== grow && 'w-px',
                  h.hideOnPhone && 'max-md:hidden',
                )}
              >
                {h.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow
              key={r.key}
              data-state={r.key === selected ? 'selected' : undefined}
              aria-current={r.key === selected || undefined}
              tabIndex={onSelect ? 0 : undefined}
              className={cn(
                onSelect &&
                  'cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
              )}
              onClick={onSelect && (() => onSelect(r.key))}
              onKeyDown={
                onSelect &&
                ((e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  onSelect(r.key);
                })
              }
            >
              {r.cells.map((c, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
                <TableCell key={i} className={cell(i)}>
                  {c}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
        {foot && (
          <TableFooter>
            <TableRow>
              {foot.map((c, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
                <TableCell key={i} className={cell(i)}>
                  {c}
                </TableCell>
              ))}
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </div>
  );
}

/** Facts as a two-row table: the labels as the header, the values under them. */
export function FactsTable({ items }: { items: [string, ReactNode][] }) {
  return (
    <DetailsTable
      head={items.map(([k], i) => ({ label: k, right: i > 0 }))}
      rows={[{ key: 'values', cells: items.map(([, v]) => v) }]}
    />
  );
}
