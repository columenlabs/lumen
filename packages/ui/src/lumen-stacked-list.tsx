// LumenStackedList: rows that nest and fold, with columns that line up at every level (a source,
// the groups inside it, the items inside those). Each row is one line: a name (with chips or a mark
// after it) over an optional muted meta line, then the list's columns. A row with children or a
// notice has a chevron and starts folded; its notice (what needs the person) shows only while it is
// open. Row actions sit after the name and show on hover or focus only (DESIGN.md, Actions: icon
// first). Nothing about what the rows mean lives here: an app fills names, cells and actions.
// On a phone the columns marked `phone` stack at the row's end and the rest are left out.
import { ChevronRightIcon } from 'lucide-react';
import {
  type CSSProperties,
  type ReactNode,
  createContext,
  useContext,
  useMemo,
  useState,
} from 'react';
import { cn } from './lib/utils';
import { Collapsible, CollapsibleContent } from './ui/collapsible';

export interface StackedColumn {
  key: string;
  /** The header over the column; the list draws a header row when any column or `lead` has one. */
  label?: string;
  /** Any CSS track size: `9rem`, `minmax(6rem, auto)`. */
  width: string;
  /** `end` for numbers and controls, so header, values and totals share one edge. */
  align?: 'start' | 'end';
  /** Shown on a phone, stacked at the row's end; other columns are left out there. */
  phone?: boolean;
}

interface StackCtx {
  columns: StackedColumn[];
  depth: number;
}

const Ctx = createContext<StackCtx | null>(null);

export interface LumenStackedListProps {
  columns: StackedColumn[];
  /** The header over the names. */
  lead?: string;
  children: ReactNode;
  'aria-label'?: string;
  className?: string;
}

export function LumenStackedList({
  columns,
  lead,
  children,
  className,
  ...aria
}: LumenStackedListProps) {
  const ctx = useMemo(() => ({ columns, depth: 0 }), [columns]);
  const style = {
    '--stack-cols': `minmax(0,1fr) ${columns.map((c) => c.width).join(' ')}`,
  } as CSSProperties;
  const head = lead !== undefined || columns.some((c) => c.label);
  return (
    <Ctx.Provider value={ctx}>
      <div className={cn('flex min-w-0 flex-col text-sm', className)} style={style}>
        {head && (
          <div
            aria-hidden
            className="grid grid-cols-(--stack-cols) items-center gap-x-3 px-3 pb-1.5 text-xs font-medium text-muted-foreground max-sm:hidden"
          >
            <span className="pl-6">{lead}</span>
            <Cells
              columns={columns}
              cells={Object.fromEntries(columns.map((c) => [c.key, c.label]))}
            />
          </div>
        )}
        <ul className="flex flex-col [&>li:first-child>[data-stack-row]]:border-t-0" {...aria}>
          {children}
        </ul>
      </div>
    </Ctx.Provider>
  );
}

function Cells({
  columns,
  cells,
}: {
  columns: StackedColumn[];
  cells?: Record<string, ReactNode>;
}) {
  return (
    <div className="contents max-sm:flex max-sm:flex-col max-sm:items-end max-sm:gap-0.5">
      {columns.map((c) => (
        <div
          key={c.key}
          className={cn(
            'flex min-w-0 items-center',
            c.align === 'end' && 'justify-end text-right',
            !c.phone && 'max-sm:hidden',
          )}
        >
          {cells?.[c.key]}
        </div>
      ))}
    </div>
  );
}

export interface LumenStackedRowProps {
  /** The row's name: drawn on one line (an ellipsis past `--lead-col-max`) and its accessible name. */
  name: string;
  /** Drawn instead of `name`, such as a rename field; `name` stays the accessible name. */
  title?: ReactNode;
  /** Right after the name: a source chip, a ✎ mark. */
  adornments?: ReactNode;
  /** One muted line under the name. */
  meta?: ReactNode;
  /** One value per column, by `StackedColumn.key`. */
  cells?: Record<string, ReactNode>;
  /** Icons after the name, shown on hover or focus only. */
  actions?: ReactNode;
  /** What needs the person (a sign-in that broke): shown at the top while the row is open. */
  notice?: ReactNode;
  /** Rows under this one: LumenStackedRows. */
  children?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** `muted` dims the row (an item that is off). */
  tone?: 'default' | 'muted';
}

const isControl = (t: EventTarget | null) =>
  t instanceof Element &&
  t.closest('button, a, input, select, [role="button"], [role="combobox"], [data-stack-skip]') !==
    null;

export function LumenStackedRow({
  name,
  title,
  adornments,
  meta,
  cells,
  actions,
  notice,
  children,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  tone = 'default',
}: LumenStackedRowProps) {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('LumenStackedRow outside LumenStackedList');
  const { columns, depth } = ctx;
  const [own, setOwn] = useState(defaultOpen);
  const open = openProp ?? own;
  const setOpen = (o: boolean) => {
    if (openProp === undefined) setOwn(o);
    onOpenChange?.(o);
  };
  const has = Boolean(children) || Boolean(notice);
  const inner = useMemo(() => ({ columns, depth: depth + 1 }), [columns, depth]);
  const indent = { paddingInlineStart: `calc(${depth} * var(--spacing) * 6)` } as CSSProperties;
  const line = (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the chevron button is the keyboard control
    <div
      data-stack-row
      className={cn(
        'group/stack grid grid-cols-(--stack-cols) items-center gap-x-3 border-t px-3 max-sm:grid-cols-[minmax(0,1fr)_auto]',
        depth === 0 ? 'min-h-14 py-2' : 'min-h-10 py-1.5',
        depth === 1 && 'bg-muted/40',
        has && 'cursor-pointer',
        tone === 'muted' && 'text-muted-foreground',
      )}
      onClick={has ? (e) => !isControl(e.target) && setOpen(!open) : undefined}
    >
      <div className="flex min-w-0 items-center gap-1.5" style={indent}>
        {has ? (
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${open ? 'Fold' : 'Unfold'} ${name}`}
            className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted"
            onClick={() => setOpen(!open)}
          >
            <ChevronRightIcon className={cn('size-4 transition-transform', open && 'rotate-90')} />
          </button>
        ) : (
          <span className="w-6 shrink-0" aria-hidden />
        )}
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            {title ?? (
              <span
                title={name}
                className={cn('max-w-(--lead-col-max) truncate', depth < 2 && 'font-medium')}
              >
                {name}
              </span>
            )}
            {adornments}
            {actions && (
              <span className="flex shrink-0 items-center opacity-0 transition-opacity group-focus-within/stack:opacity-100 group-hover/stack:opacity-100">
                {actions}
              </span>
            )}
          </div>
          {meta && <div className="truncate text-xs text-muted-foreground">{meta}</div>}
        </div>
      </div>
      <Cells columns={columns} cells={cells} />
    </div>
  );
  if (!has) return <li>{line}</li>;
  return (
    <li>
      <Collapsible open={open} onOpenChange={setOpen}>
        {line}
        <CollapsibleContent>
          {notice && (
            <div
              className="border-t px-3 py-2"
              style={{
                paddingInlineStart: `calc(${depth + 1} * var(--spacing) * 6 + var(--spacing) * 3)`,
              }}
            >
              {notice}
            </div>
          )}
          {children && (
            <Ctx.Provider value={inner}>
              <ul className="flex flex-col">{children}</ul>
            </Ctx.Provider>
          )}
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}
