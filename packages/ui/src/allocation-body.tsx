/**
 * An allocation widget's body (bar list, donut, allocation bar). It draws with the charts library,
 * so the widget frame loads it only when such a widget shows.
 */
import { ALLOCATION_MAX, type ViewCard, controlOn } from '@columenlabs/lumen-ui-types/views';
import {
  AllocationBar,
  Donut,
  Headline,
  RankedBars,
  STACK_MAX,
  StackedBars,
} from './lumen-widget-charts';
import { useAmountsHidden } from './shell';
import { type ChartConfig, ChartTooltip, ChartTooltipContent } from './ui/chart';
import { type ViewCellValue, type ViewField, label } from './view-model';
import { colorOf, exact, pct, short, sumBy } from './widget-values';

const Empty = ({ children = 'Nothing to show for these rows.' }: { children?: string }) => (
  <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>
);

export function AllocationBody<T>({
  card,
  own,
  read,
  field,
}: {
  card: Extract<ViewCard, { kind: 'allocation' }>;
  /** The widget's own rows (its filter applied). */
  own: T[];
  read: (f: ViewField<T>, r: T) => ViewCellValue;
  field: (key: string) => ViewField<T> | undefined;
}) {
  const hidden = useAmountsHidden();
  const by = field(card.by);
  const value = field(card.value);
  if (!by || !value) return <Empty>This widget's fields are not in this view.</Empty>;
  const masked = hidden && !!value.amount;
  const fmt = (v: number) => short(v, value.format, masked);
  const sums = sumBy(own, by, value, read);
  // An empty value reads "No sector", not "—"; counts say "1 sector", "3 sectors".
  const shown = (name: string, f: { label: string }) =>
    name === label(null) ? `No ${f.label.toLowerCase()}` : name;
  const count = (n: number) => `${n} ${by.label.toLowerCase()}${n === 1 ? '' : 's'}`;
  if (card.style === 'bar_list') {
    const bars = sums
      .filter((x) => x.v !== 0)
      .sort((a, b) => (card.desc ? b.v - a.v : a.v - b.v))
      .slice(0, card.n);
    if (!bars.length) return <Empty />;
    const net = bars.reduce((t, x) => t + x.v, 0);
    const abs = bars.reduce((t, x) => t + Math.abs(x.v), 0);
    const up = bars.filter((b) => b.v > 0).length;
    // Split by: each bar's parts by a text field, its 5 largest overall coloured as a donut of
    // that field colours them, the rest Other.
    const stackF = !card.signed && card.stack ? field(card.stack) : undefined;
    const stack = (() => {
      if (!stackF || stackF.key === by.key) return null;
      const order = sumBy(own, stackF, value, read).filter((x) => x.v > 0);
      // A split needs two known parts; with fewer (no sectors set yet) plain bars read better.
      if (order.filter((x) => x.name !== label(null)).length < 2) return null;
      const top = order.slice(0, STACK_MAX).map((x) => x.name);
      const parts = [...top, ...(order.length > STACK_MAX ? ['Other'] : [])].map((name, i) => ({
        name: shown(name, stackF),
        key: `p${i}`,
        fill: name === 'Other' ? 'var(--muted-foreground)' : colorOf(name, i),
      }));
      const keyOf = (n: string) => `p${top.includes(n) ? top.indexOf(n) : top.length}`;
      const rows = bars.map((b) => {
        const r: Record<string, number | string> = { name: shown(b.name, by), total: b.v };
        for (const x of own) {
          if (label(read(by, x)) !== b.name) continue;
          const v = read(value, x);
          if (typeof v !== 'number' || v <= 0) continue;
          const k = keyOf(label(read(stackF, x)));
          r[k] = ((r[k] as number) ?? 0) + v;
        }
        return r;
      });
      return { rows, parts };
    })();
    return (
      <>
        <Headline
          value={`${card.signed && net > 0 ? '+' : ''}${fmt(net)}`}
          tone={card.signed ? (net >= 0 ? 'gain' : 'loss') : undefined}
          caption={
            card.signed
              ? `net · ${up} up, ${bars.length - up} down`
              : `${value.label.toLowerCase()} across ${count(bars.length)}`
          }
        />
        {stack ? (
          <StackedBars
            rows={stack.rows}
            parts={stack.parts}
            fmt={fmt}
            exact={(v) => exact(v, value.format, masked)}
            share={(v) => pct(v, abs)}
          />
        ) : (
          <RankedBars
            id={card.id}
            items={bars.map((b, i) => ({
              ...b,
              name: shown(b.name, by),
              fill: card.signed ? (b.v >= 0 ? 'var(--gain)' : 'var(--loss)') : colorOf(b.name, i),
            }))}
            signed={card.signed}
            fmt={fmt}
            share={(v) => pct(Math.abs(v), abs)}
          />
        )}
      </>
    );
  }
  const parts = sums.filter((x) => x.v > 0).map((x) => ({ ...x, name: shown(x.name, by) }));
  const total = parts.reduce((t, x) => t + x.v, 0);
  const known = parts.filter((x) => x.name !== shown(label(null), by)).length;
  if (!total) return <Empty />;
  // Donut: `max` slices in all, Other the last. Allocation: the largest `max`, then Other.
  const keep = card.style === 'donut' ? card.max - 1 : (card.max ?? ALLOCATION_MAX);
  const limit = card.style === 'donut' ? card.max : keep;
  const rest = parts.length > limit ? parts.slice(keep) : [];
  const slices = rest.length
    ? [...parts.slice(0, keep), { name: 'Other', v: rest.reduce((t, x) => t + x.v, 0) }]
    : parts;
  const colored = slices.map((s, i) => ({
    ...s,
    key: `s${i}`,
    fill: s.name === 'Other' ? 'var(--muted-foreground)' : colorOf(s.name, i),
  }));
  if (card.style === 'donut')
    return (
      <Donut
        items={colored}
        total={total}
        fmt={fmt}
        share={(v) => pct(v, total)}
        caption={count(known)}
        legend={controlOn(card, 'legend')}
      />
    );
  // Allocation: one stacked bar, no legend; each wide slice names itself, and hovering a slice
  // gives its exact value and share, Other its 10 largest. The tooltip may leave the card.
  const config: ChartConfig = Object.fromEntries(
    colored.map((s) => [s.key, { label: s.name, color: s.fill }]),
  );
  const line = (name: string, v: number, fill?: string) => (
    <span key={name} className="flex w-full items-center gap-2">
      {fill && <span className="size-2 shrink-0 rounded-full" style={{ background: fill }} />}
      <span className="truncate font-medium">{name}</span>
      <span className="num ml-auto pl-3 whitespace-nowrap">
        {exact(v, value.format, masked)} · {pct(v, total)}
      </span>
    </span>
  );
  return (
    <div className="py-1">
      <Headline
        value={fmt(total)}
        caption={`${count(known)} · largest ${colored[0]?.name ?? ''} ${pct(colored[0]?.v ?? 0, total)}`}
      />
      <AllocationBar
        items={colored}
        total={total}
        config={config}
        share={(v) => pct(v, total)}
        tooltip={
          <ChartTooltip
            cursor={false}
            shared={false}
            allowEscapeViewBox={{ x: false, y: true }}
            wrapperStyle={{ zIndex: 50 }}
            content={
              <ChartTooltipContent
                hideLabel
                className="min-w-48 max-w-72"
                formatter={(v, name) => {
                  const s = colored.find((c) => c.key === name);
                  if (s?.name !== 'Other') return line(s?.name ?? String(name), Number(v), s?.fill);
                  return (
                    <span className="flex w-full flex-col gap-1">
                      {line(`Other (${rest.length})`, Number(v), s.fill)}
                      <span className="flex flex-col gap-0.5 border-t pt-1 text-muted-foreground">
                        {rest.slice(0, 10).map((x) => line(x.name, x.v))}
                        {rest.length > 10 && <span>+{rest.length - 10} more</span>}
                      </span>
                    </span>
                  );
                }}
              />
            }
          />
        }
      />
    </div>
  );
}
