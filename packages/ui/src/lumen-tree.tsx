// LumenTree: rows that nest, read top to bottom. Each item is one row; an item with children has a
// chevron and folds, and its children hang off a guide line (green when `tone` is positive: the path
// that was taken). Nothing about what the rows mean lives here: an app fills `row` with its own
// words. Children stay mounted while folded, so `reveal` can find a row inside a closed item, open
// every item above it, scroll to it and flash it (a link from one row to another).
import { ChevronRightIcon } from 'lucide-react';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cn } from './lib/utils';
import { Collapsible, CollapsibleContent } from './ui/collapsible';

interface TreeContext {
  /** Opens every item above the row `id`, scrolls to it and flashes it. */
  reveal: (id: string) => void;
  /** Items told to open by the last reveal, and a count so the same set opens again. */
  opening: { ids: Set<string>; n: number };
}

const Ctx = createContext<TreeContext | null>(null);

/** The tree around the rows: `reveal` from any row inside it. */
export function useLumenTree(): TreeContext {
  const c = useContext(Ctx);
  if (!c) throw new Error('useLumenTree outside LumenTree');
  return c;
}

export interface LumenTreeProps {
  children: ReactNode;
  'aria-label'?: string;
  className?: string;
}

export function LumenTree({ children, className, ...aria }: LumenTreeProps) {
  const root = useRef<HTMLUListElement>(null);
  const [opening, setOpening] = useState<TreeContext['opening']>({ ids: new Set(), n: 0 });
  const reveal = useCallback((id: string) => {
    const el = root.current?.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(id)}"]`);
    if (!el) return;
    const ids = new Set<string>();
    for (let p = el.parentElement; p && p !== root.current; p = p.parentElement) {
      const k = p.getAttribute('data-tree-id');
      if (k) ids.add(k);
    }
    setOpening((o) => ({ ids, n: o.n + 1 }));
    requestAnimationFrame(() => {
      const row = el.querySelector<HTMLElement>(':scope > [data-tree-row]') ?? el;
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
      row.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' });
      row.animate(
        still
          ? [{ outline: '1px solid var(--primary)' }, { outline: '1px solid transparent' }]
          : [
              { backgroundColor: 'color-mix(in oklab, var(--primary) 35%, transparent)' },
              { backgroundColor: 'transparent' },
            ],
        { duration: 1600, easing: 'ease-out' },
      );
    });
  }, []);
  const ctx = useMemo(() => ({ reveal, opening }), [reveal, opening]);
  return (
    <Ctx.Provider value={ctx}>
      <ul ref={root} className={cn('flex flex-col', className)} {...aria}>
        {children}
      </ul>
    </Ctx.Provider>
  );
}

export interface LumenTreeItemProps {
  /** What `reveal` finds this row by. */
  id?: string;
  /** The row itself, laid out as a wrapping line beside the chevron. */
  row: ReactNode;
  /** Rows under this one: LumenTreeItems. */
  children?: ReactNode;
  defaultOpen?: boolean;
  /** `positive`: the guide under it is the colour of a path taken; `muted`: the row is dimmed. */
  tone?: 'default' | 'positive' | 'muted';
  className?: string;
}

const isControl = (t: EventTarget | null) =>
  t instanceof Element && t.closest('button, a, input, [role="button"], [data-tree-skip]') !== null;

export function LumenTreeItem({
  id,
  row,
  children,
  defaultOpen = false,
  tone = 'default',
  className,
}: LumenTreeItemProps) {
  const [open, setOpen] = useState(defaultOpen);
  const ctx = useContext(Ctx);
  const n = ctx?.opening.n ?? 0;
  const told = id !== undefined && (ctx?.opening.ids.has(id) ?? false);
  useEffect(() => {
    if (told && n > 0) setOpen(true);
  }, [told, n]);
  const has = children !== undefined && children !== null && children !== false;
  const line = (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the chevron button is the keyboard control
    <div
      data-tree-row
      className={cn(
        'flex min-h-7 flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md px-1.5 py-0.5 hover:bg-muted/60',
        has && 'cursor-pointer',
        tone === 'muted' && 'text-muted-foreground',
      )}
      onClick={has ? (e) => !isControl(e.target) && setOpen((o) => !o) : undefined}
    >
      {has ? (
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? 'Fold' : 'Unfold'}
          className="grid size-4 shrink-0 self-center place-items-center text-muted-foreground"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
        >
          <ChevronRightIcon className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        </button>
      ) : (
        <span className="w-4 shrink-0" aria-hidden />
      )}
      {row}
    </div>
  );
  return (
    <li data-tree-id={id} className={className}>
      {has ? (
        <Collapsible open={open} onOpenChange={setOpen}>
          {line}
          <CollapsibleContent forceMount className="data-[state=closed]:hidden">
            <ul
              className={cn(
                'ml-3 flex flex-col border-l pl-2.5 max-sm:ml-2 max-sm:pl-1.5',
                tone === 'positive' && 'border-rule-yes/40',
              )}
            >
              {children}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      ) : (
        line
      )}
    </li>
  );
}
