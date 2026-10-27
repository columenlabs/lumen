/**
 * How a widget's values read: short and exact numbers, shares, one colour per name and sums by a
 * field. Shared by the widget frame and its chart bodies, so a lazily loaded body never pulls the
 * frame back in.
 */
import { type ViewFormat, formatBytes, isDollarFormat } from '@columenlabs/lumen-ui-types/views';
import { maskAmount } from './shell';
import { type ViewCellValue, type ViewField, label } from './view-model';

export const MINUS = '−';
export const COMPACT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
/** A chart value in short form: $12.3K, −4.1%, 1.2M; masked while Hide amounts is on. */
export function short(v: number, format: ViewFormat, hidden: boolean) {
  if (hidden) return maskAmount('0');
  const sign = v < 0 ? MINUS : '';
  const abs = Math.abs(v);
  if (format === 'percent' || format === 'weight') return `${sign}${abs.toFixed(1)}%`;
  if (format === 'bytes') return `${sign}${formatBytes(abs)}`;
  if (isDollarFormat(format)) return `${sign}$${COMPACT.format(abs)}`;
  return `${sign}${COMPACT.format(abs)}`;
}
/** A chart value in full, for tooltips: $491,712.34, −4.1%; masked while Hide amounts is on. */
export function exact(v: number, format: ViewFormat, hidden: boolean) {
  if (hidden) return maskAmount('0');
  const sign = v < 0 ? MINUS : '';
  const abs = Math.abs(v);
  if (format === 'percent' || format === 'weight') return `${sign}${abs.toFixed(2)}%`;
  if (format === 'bytes') return `${sign}${formatBytes(abs)}`;
  const n = abs.toLocaleString('en-US', {
    maximumFractionDigits: format === 'rounded' || format === 'price_rounded' ? 0 : 2,
    useGrouping: format !== 'integer',
  });
  return `${sign}${isDollarFormat(format) ? '$' : ''}${n}`;
}
export const pct = (v: number, total: number) =>
  `${total ? ((v / total) * 100).toFixed(1) : '0.0'}%`;

/** One colour per name, by size, so the largest never share one; Cash is always grey. */
const PALETTE = [1, 2, 3, 4, 5, 6, 9, 7, 10].map((i) => `var(--chart-${i})`);
export const colorOf = (name: string, i: number) =>
  /cash/i.test(name) ? 'var(--chart-8)' : (PALETTE[i % PALETTE.length] ?? 'var(--chart-1)');

/** `value` summed by `by` over the rows, largest first; rows with no `by` read as —. */
export function sumBy<T>(
  rows: T[],
  by: ViewField<T>,
  value: ViewField<T>,
  read: (f: ViewField<T>, r: T) => ViewCellValue,
) {
  const m = new Map<string, number>();
  for (const r of rows) {
    const v = read(value, r);
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const k = label(read(by, r));
    m.set(k, (m.get(k) ?? 0) + v);
  }
  return [...m].map(([name, v]) => ({ name, v })).sort((a, b) => b.v - a.v);
}
