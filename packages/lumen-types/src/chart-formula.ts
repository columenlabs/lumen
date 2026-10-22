// Chart indicators the assistant or a person formulates: a formula over a symbol's bars in the view
// formula language (Jexl, an interpreter: no eval), read as series. `open high low close` are the
// bars (the chart's bars carry no volume); operators work bar by bar; functions are a fixed list, each taking a series and a
// window in bars (`ema(close, 9)`), and may nest (`sma(rsi(close, 14), 5)`). The server checks a
// formula before the assistant's move goes out; LumenChart runs it in the browser over the bars and warm-up.
import jexl from 'jexl';
import { z } from 'zod';

/** The bar fields a formula reads. */
export const FORMULA_FIELDS = ['open', 'high', 'low', 'close'] as const;
export type FormulaField = (typeof FORMULA_FIELDS)[number];

/** Each function's arguments: `x` a series, `n` a window in bars (a whole number written as is). */
export const FORMULA_FUNCTIONS = {
  sma: { args: ['x', 'n'], about: 'simple moving average' },
  ema: { args: ['x', 'n'], about: 'exponential moving average' },
  rsi: { args: ['x', 'n'], about: "relative strength, Wilder's (0 to 100)" },
  stdev: { args: ['x', 'n'], about: 'standard deviation over n bars' },
  highest: { args: ['x', 'n'], about: 'highest over n bars' },
  lowest: { args: ['x', 'n'], about: 'lowest over n bars' },
  sum: { args: ['x', 'n'], about: 'sum over n bars' },
  ref: { args: ['x', 'n'], about: 'x n bars ago' },
  change: { args: ['x', 'n'], about: '% change over n bars' },
  atr: { args: ['n'], about: 'average true range' },
  abs: { args: ['x'], about: 'absolute value' },
  min: { args: ['x', 'x'], about: 'the lower of two' },
  max: { args: ['x', 'x'], about: 'the higher of two' },
} as const satisfies Record<string, { args: readonly ('x' | 'n')[]; about: string }>;
export type FormulaFunction = keyof typeof FORMULA_FUNCTIONS;

/** The chart's catalog (LumenShell's `CHART_INDICATORS`), by id, for checking a spec on the server. */
export const CHART_INDICATOR_IDS = [
  'sma_20',
  'sma_50',
  'sma_200',
  'ema_9',
  'ema_21',
  'ema_50',
  'bollinger',
  'high_low_52w',
  'rsi_14',
  'macd',
  'atr_14',
  'rel_volume_20',
  'vwap_distance',
  'pe_trailing',
  'pe_forward',
  'iv30',
  'est_eps',
] as const;
export type ChartIndicatorId = (typeof CHART_INDICATOR_IDS)[number];

/** A window: 1 to 400 bars, like an app's indicators. */
export const MAX_FORMULA_WINDOW = 400;
const OPS = new Set(['+', '-', '*', '/', '%', '^', '==', '!=', '>', '>=', '<', '<=', '&&', '||']);

/** A formula read into a tree LumenChart runs. */
export type FormulaNode =
  | { k: 'num'; v: number }
  | { k: 'field'; name: FormulaField }
  | { k: 'op'; op: string; a: FormulaNode; b: FormulaNode }
  | { k: 'not'; a: FormulaNode }
  | { k: 'if'; test: FormulaNode; yes: FormulaNode; no: FormulaNode }
  | { k: 'call'; fn: FormulaFunction; args: FormulaNode[]; n: number };

/** One formula line on a chart: drawn on the price (`overlay`) or in its own pane (the default). */
export const chartFormulaSchema = z
  .object({
    label: z.string().trim().min(1).max(60),
    f: z.string().trim().min(1).max(400),
    where: z.enum(['overlay', 'pane']).optional(),
    /** Dashed reference levels in its pane (0, or 30 and 70). */
    refs: z.array(z.number().finite()).max(4).optional(),
  })
  .strict();
export type ChartFormula = z.infer<typeof chartFormulaSchema>;

/**
 * An indicator on a chart: a built-in by its warehouse name with any window (`ema_13`, `rsi_10`,
 * `bollinger_20_2`, `macd_12_26_9`, `atr_14`, `sma_200`), a sourced one (`pe_trailing`, `iv30`), a
 * saved formula by its id (`mine:<id>`), or a formula.
 */
export const indicatorSpecSchema = z.union([
  z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_:]{1,63}$/),
  chartFormulaSchema,
]);
export type IndicatorSpec = z.infer<typeof indicatorSpecSchema>;

/** A built-in's kind and numbers from its name; null when it is not one. */
export function builtinParams(id: string): { kind: string; params: number[] } | null {
  const m = /^(sma|ema|rsi|atr)_(\d{1,3})$/.exec(id);
  if (m) {
    const n = Number(m[2]);
    return n >= 2 && n <= MAX_FORMULA_WINDOW ? { kind: m[1] as string, params: [n] } : null;
  }
  const bb = /^bollinger_(\d{1,3})_(\d(?:p\d)?)$/.exec(id);
  if (bb) {
    const n = Number(bb[1]);
    const k = Number((bb[2] as string).replace('p', '.'));
    return n >= 2 && n <= MAX_FORMULA_WINDOW && k >= 0.5 && k <= 4
      ? { kind: 'bollinger', params: [n, k] }
      : null;
  }
  const md = /^macd_(\d{1,3})_(\d{1,3})_(\d{1,3})$/.exec(id);
  if (md) {
    const [f, s, g] = [md[1], md[2], md[3]].map(Number) as [number, number, number];
    return f >= 2 && s <= MAX_FORMULA_WINDOW && g >= 2 && g <= MAX_FORMULA_WINDOW && f < s
      ? { kind: 'macd', params: [f, s, g] }
      : null;
  }
  return null;
}

const engine = new jexl.Jexl();
/** Signs people paste (true minus, ×, ÷) read as the operators. */
const tidy = (f: string) => f.replace(/[−–]/g, '-').replace(/×/g, '*').replace(/÷/g, '/');

type Ast = {
  type: string;
  value?: unknown;
  name?: string;
  pool?: string;
  operator?: string;
  args?: Ast[];
  left?: Ast;
  right?: Ast;
  test?: Ast;
  consequent?: Ast;
  alternate?: Ast;
  from?: unknown;
};

class FormulaError extends Error {}

function read(a: Ast | undefined): FormulaNode {
  if (!a) throw new FormulaError('incomplete formula');
  switch (a.type) {
    case 'Literal':
      if (typeof a.value === 'number') return { k: 'num', v: a.value };
      if (typeof a.value === 'boolean') return { k: 'num', v: a.value ? 1 : 0 };
      throw new FormulaError('only numbers, fields and functions');
    case 'Identifier': {
      const name = String(a.value);
      if (a.from || !(FORMULA_FIELDS as readonly string[]).includes(name))
        throw new FormulaError(`unknown field ${name}: use ${FORMULA_FIELDS.join(', ')}`);
      return { k: 'field', name: name as FormulaField };
    }
    case 'BinaryExpression':
      if (!OPS.has(a.operator ?? '')) throw new FormulaError(`operator ${a.operator} not allowed`);
      return { k: 'op', op: a.operator as string, a: read(a.left), b: read(a.right) };
    case 'UnaryExpression':
      if (a.operator !== '!') throw new FormulaError(`operator ${a.operator} not allowed`);
      return { k: 'not', a: read(a.right) };
    case 'ConditionalExpression':
      return {
        k: 'if',
        test: read(a.test),
        yes: read(a.consequent),
        no: read(a.alternate ?? a.test),
      };
    case 'FunctionCall': {
      const fn = a.name as FormulaFunction;
      const spec = a.pool === 'functions' ? FORMULA_FUNCTIONS[fn] : undefined;
      if (!spec)
        throw new FormulaError(
          `unknown function ${a.name}: use ${Object.keys(FORMULA_FUNCTIONS).join(', ')}`,
        );
      const args = a.args ?? [];
      if (args.length !== spec.args.length)
        throw new FormulaError(`${fn}(${spec.args.join(', ')}) takes ${spec.args.length}`);
      let n = 0;
      const series: FormulaNode[] = [];
      spec.args.forEach((kind, i) => {
        const arg = args[i];
        if (kind === 'x') series.push(read(arg));
        else {
          const v = arg?.type === 'Literal' ? arg.value : null;
          if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > MAX_FORMULA_WINDOW)
            throw new FormulaError(
              `${fn}: the window is a whole number 1 to ${MAX_FORMULA_WINDOW}`,
            );
          n = v;
        }
      });
      return { k: 'call', fn, args: series, n };
    }
    default:
      throw new FormulaError('only numbers, fields, operators and functions');
  }
}

/** Bars a node needs before its first value. */
function lookbackOf(n: FormulaNode): number {
  switch (n.k) {
    case 'num':
    case 'field':
      return 0;
    case 'op':
      return Math.max(lookbackOf(n.a), lookbackOf(n.b));
    case 'not':
      return lookbackOf(n.a);
    case 'if':
      return Math.max(lookbackOf(n.test), lookbackOf(n.yes), lookbackOf(n.no));
    case 'call':
      return (
        Math.max(0, ...n.args.map(lookbackOf)) +
        (n.fn === 'abs' || n.fn === 'min' || n.fn === 'max' ? 0 : n.n)
      );
  }
}

/** A formula read and checked: its tree and the bars it needs first; throws with why not. */
export function parseChartFormula(f: string): { node: FormulaNode; lookback: number } {
  let ast: Ast;
  try {
    ast = engine.compile(tidy(f))._getAst() as Ast;
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    // Jexl reads `?` after a function call as a transform: the test needs its own brackets.
    throw new Error(
      /\(question\)/.test(why)
        ? 'syntax: put the condition in brackets, e.g. (close > sma(close, 50)) ? 1 : 0'
        : `syntax: ${why}`,
    );
  }
  try {
    const node = read(ast);
    if (node.k === 'num')
      throw new FormulaError('a formula reads the bars: use a field or function');
    return { node, lookback: lookbackOf(node) };
  } catch (e) {
    if (e instanceof FormulaError) throw new Error(e.message);
    throw e;
  }
}

/** Why a formula can't run, or null when it can. */
export function checkChartFormula(f: string): string | null {
  try {
    parseChartFormula(f);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Why an indicator spec can't be drawn (`known`: the chart's catalog ids), or null. */
export function indicatorSpecIssue(
  spec: IndicatorSpec,
  known: readonly string[] = CHART_INDICATOR_IDS,
): string | null {
  if (typeof spec !== 'string') {
    const wrong = checkChartFormula(spec.f);
    return wrong ? `${spec.label}: ${wrong}` : null;
  }
  if (spec.startsWith('mine:') || known.includes(spec) || builtinParams(spec)) return null;
  return `${spec}: not an indicator. Built-ins take any window (sma_N, ema_N, rsi_N, atr_N, bollinger_N_K, macd_F_S_G); else ${known.join(', ')}; or a formula {label, f}`;
}

/** How the assistant and people write formulas, for tool descriptions. */
export const CHART_FORMULA_HELP = `A formula is {label, f, where?: "overlay"|"pane" (default pane), refs?: [levels]}. f reads the bars as series: fields ${FORMULA_FIELDS.join(', ')}; operators + - * / % ^ > < >= <= == != && || ! and (test) ? a : b with the test in brackets, bar by bar; functions ${Object.entries(
  FORMULA_FUNCTIONS,
)
  .map(([k, v]) => `${k}(${v.args.join(', ')}) ${v.about}`)
  .join(
    '; ',
  )}. n is a whole number of bars, 1 to ${MAX_FORMULA_WINDOW}; functions nest, e.g. sma(rsi(close, 14), 5). Example: {label: "EMA 9/21 spread %", f: "(ema(close, 9) - ema(close, 21)) / close * 100", refs: [0]}. Draw on the price ("overlay") only what is in price units.`;
