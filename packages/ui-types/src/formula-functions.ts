// The functions a view formula can call beyond group_sum and total_sum: dates, text and numbers,
// e.g. `year(transactions.date)`, `left(symbol.name, 3)`, `round(holdings.weight, 1)`. Dates are
// `YYYY-MM-DD` or ISO text (or epoch milliseconds), read in UTC so the browser and the server agree;
// date math is date-fns. A function given what it cannot use gives no value (a blank cell).
import { UTCDate, utc } from '@date-fns/utc';
import {
  differenceInCalendarDays,
  format,
  getDate,
  getISODay,
  getMonth,
  getQuarter,
  getYear,
  isValid,
  parseISO,
  startOfISOWeek,
  startOfMonth,
  startOfQuarter,
  startOfYear,
} from 'date-fns';

export interface FormulaFunction {
  name: string;
  /** How it is called, e.g. `left(text, n)`. */
  call: string;
  /** What it gives, in a few words. */
  detail: string;
  group: 'Date' | 'Text' | 'Number';
  /** It gives text (a column of it shows as Text). */
  text?: boolean;
  fn: (...args: unknown[]) => unknown;
}

const asDate = (v: unknown): Date | null => {
  const d =
    typeof v === 'number'
      ? new UTCDate(v)
      : typeof v === 'string' && v
        ? parseISO(v, { in: utc })
        : null;
  return d && isValid(d) ? d : null;
};
const asText = (v: unknown): string | null =>
  typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : null;
const asNum = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};
const day = (d: Date) => format(d, 'yyyy-MM-dd');

/** A date part: the function reads one date and gives a number. */
const part = (get: (d: Date) => number) => (v: unknown) => {
  const d = asDate(v);
  return d ? get(d) : undefined;
};
/** A text function: the first argument is the text, the rest numbers (or text, `rest`). */
const onText =
  (f: (s: string, ...rest: unknown[]) => string | number | boolean | null) =>
  (v: unknown, ...rest: unknown[]) => {
    const s = asText(v);
    return s === null ? undefined : (f(s, ...rest) ?? undefined);
  };
const STARTS: Record<string, (d: Date) => Date> = {
  week: startOfISOWeek,
  month: startOfMonth,
  quarter: startOfQuarter,
  year: startOfYear,
};

export const FORMULA_FUNCTIONS: FormulaFunction[] = [
  {
    name: 'year',
    call: 'year(date)',
    detail: 'the year, 2026',
    group: 'Date',
    fn: part(getYear),
  },
  {
    name: 'month',
    call: 'month(date)',
    detail: 'the month, 1 to 12',
    group: 'Date',
    fn: part((d) => getMonth(d) + 1),
  },
  {
    name: 'day',
    call: 'day(date)',
    detail: 'the day of the month',
    group: 'Date',
    fn: part(getDate),
  },
  {
    name: 'quarter',
    call: 'quarter(date)',
    detail: 'the quarter, 1 to 4',
    group: 'Date',
    fn: part(getQuarter),
  },
  {
    name: 'weekday',
    call: 'weekday(date)',
    detail: 'the day of the week, 1 Monday to 7 Sunday',
    group: 'Date',
    fn: part(getISODay),
  },
  {
    name: 'days_between',
    call: 'days_between(from, to)',
    detail: 'days from one date to another',
    group: 'Date',
    fn: (a, b) => {
      const from = asDate(a);
      const to = asDate(b);
      return from && to ? differenceInCalendarDays(to, from) : undefined;
    },
  },
  {
    name: 'start_of',
    call: "start_of(date, 'month')",
    detail: "the first day of its 'week', 'month', 'quarter' or 'year'",
    group: 'Date',
    text: true,
    fn: (v, unit) => {
      const d = asDate(v);
      const start = typeof unit === 'string' ? STARTS[unit] : undefined;
      return d && start ? day(start(d)) : undefined;
    },
  },
  {
    name: 'today',
    call: 'today()',
    detail: "today's date (UTC)",
    group: 'Date',
    text: true,
    fn: () => day(new UTCDate()),
  },
  {
    name: 'left',
    call: 'left(text, n)',
    detail: 'the first n characters',
    group: 'Text',
    text: true,
    fn: onText((s, n) => {
      const k = asNum(n);
      return k === null ? null : s.slice(0, Math.max(0, k));
    }),
  },
  {
    name: 'right',
    call: 'right(text, n)',
    detail: 'the last n characters',
    group: 'Text',
    text: true,
    fn: onText((s, n) => {
      const k = asNum(n);
      return k === null ? null : k <= 0 ? '' : s.slice(-k);
    }),
  },
  {
    name: 'mid',
    call: 'mid(text, start, length)',
    detail: 'length characters from position start (the first is 1)',
    group: 'Text',
    text: true,
    fn: onText((s, start, length) => {
      const a = asNum(start);
      const n = asNum(length);
      return a === null || n === null ? null : s.slice(Math.max(0, a - 1), Math.max(0, a - 1 + n));
    }),
  },
  {
    name: 'slice',
    call: 'slice(text, from, to)',
    detail: 'characters from index from up to to, the first is 0 (to left out: to the end)',
    group: 'Text',
    text: true,
    fn: onText((s, from, to) => {
      const a = asNum(from);
      if (a === null) return null;
      return to === undefined ? s.slice(a) : s.slice(a, asNum(to) ?? undefined);
    }),
  },
  {
    name: 'upper',
    call: 'upper(text)',
    detail: 'in capitals',
    group: 'Text',
    text: true,
    fn: onText((s) => s.toUpperCase()),
  },
  {
    name: 'lower',
    call: 'lower(text)',
    detail: 'in small letters',
    group: 'Text',
    text: true,
    fn: onText((s) => s.toLowerCase()),
  },
  {
    name: 'trim',
    call: 'trim(text)',
    detail: 'without spaces at either end',
    group: 'Text',
    text: true,
    fn: onText((s) => s.trim()),
  },
  {
    name: 'len',
    call: 'len(text)',
    detail: 'how many characters',
    group: 'Text',
    fn: onText((s) => s.length),
  },
  {
    name: 'concat',
    call: 'concat(a, b, ...)',
    detail: 'the values joined into one text (blanks left out)',
    group: 'Text',
    text: true,
    fn: (...args) =>
      args
        .map(asText)
        .filter((s) => s !== null)
        .join(''),
  },
  {
    name: 'contains',
    call: 'contains(text, part)',
    detail: 'whether the text holds part (any case)',
    group: 'Text',
    fn: onText((s, p) => {
      const q = asText(p);
      return q === null ? null : s.toLowerCase().includes(q.toLowerCase());
    }),
  },
  {
    name: 'replace',
    call: 'replace(text, find, with)',
    detail: 'every find swapped for with',
    group: 'Text',
    text: true,
    fn: onText((s, find, to) => {
      const f = asText(find);
      return f ? s.replaceAll(f, asText(to) ?? '') : null;
    }),
  },
  {
    name: 'split_part',
    call: "split_part(text, ',', n)",
    detail: 'the nth piece between separators (the first is 1)',
    group: 'Text',
    text: true,
    fn: onText((s, sep, n) => {
      const by = asText(sep);
      const k = asNum(n);
      return by && k !== null && k >= 1 ? (s.split(by)[k - 1] ?? null) : null;
    }),
  },
  {
    name: 'round',
    call: 'round(x, digits)',
    detail: 'rounded, to digits places (0 when left out)',
    group: 'Number',
    fn: (v, digits) => {
      const x = asNum(v);
      const p = 10 ** (asNum(digits) ?? 0);
      return x === null ? undefined : Math.round(x * p) / p;
    },
  },
  {
    name: 'abs',
    call: 'abs(x)',
    detail: 'without its sign',
    group: 'Number',
    fn: (v) => {
      const x = asNum(v);
      return x === null ? undefined : Math.abs(x);
    },
  },
  {
    name: 'min',
    call: 'min(a, b, ...)',
    detail: 'the smallest (blanks left out)',
    group: 'Number',
    fn: (...args) => {
      const xs = args.map(asNum).filter((x) => x !== null);
      return xs.length ? Math.min(...xs) : undefined;
    },
  },
  {
    name: 'max',
    call: 'max(a, b, ...)',
    detail: 'the largest (blanks left out)',
    group: 'Number',
    fn: (...args) => {
      const xs = args.map(asNum).filter((x) => x !== null);
      return xs.length ? Math.max(...xs) : undefined;
    },
  },
];

/** The functions as one line each, for an assistant's instructions. */
export const formulaFunctionsText = () =>
  FORMULA_FUNCTIONS.map((f) => `${f.call}: ${f.detail}`).join('; ');
