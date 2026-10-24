// Formula columns: a custom view computes its own columns from the domain's
// fields. Expressions are Jexl (an interpreter, no eval, so it also runs in the Worker), e.g.
// `holdings.market_value / group_sum("holdings.market_value") * 100`. group_sum("name") and
// total_sum("name") add a field over the row's group (every shown row when not grouped) and over
// every shown row.
//
// Names: a formula reads a field by where it comes from, the groups of the
// Columns tree: `<domain>.<field>` for the card's own domain, a join (`symbol.price`,
// `account.cash`) or a linked domain (`tax_lots.unrealized`); `frame.<frame>.<column>` for an
// assistant frame; and another formula by its bare key (`value_nonretire`), at any depth, never in a
// loop. Rows keep their flat field keys; each surface maps a name to its key (`FormulaNames`).
// Beyond the two sums it calls the date, text and number functions in `FORMULA_FUNCTIONS`
// (`year(transactions.date)`); any other function is refused by the check.
import jexl from 'jexl';
import { FORMULA_FUNCTIONS } from './formula-functions';

/** What a formula can read for one row. */
export interface ViewFormulaScope {
  /** A field's value on the row; null when it has none. */
  value: (key: string) => number | string | null;
  groupSum: (key: string) => number;
  totalSum: (key: string) => number;
}

export const viewFormulaFunctions = [
  'group_sum',
  'total_sum',
  ...FORMULA_FUNCTIONS.map((f) => f.name),
] as const;
const knownFunctions = new Set<string>(viewFormulaFunctions);
const textFunctions = new Set(FORMULA_FUNCTIONS.filter((f) => f.text).map((f) => f.name));

// Functions get only their arguments, so the row being evaluated is set around each evalSync
// (evaluation is synchronous, so one at a time).
let current: ViewFormulaScope | null = null;
const engine = new jexl.Jexl();
engine.addFunction('group_sum', (key: unknown) =>
  typeof key === 'string' && current ? current.groupSum(key) : Number.NaN,
);
engine.addFunction('total_sum', (key: unknown) =>
  typeof key === 'string' && current ? current.totalSum(key) : Number.NaN,
);
for (const f of FORMULA_FUNCTIONS) engine.addFunction(f.name, f.fn);

type Node = Record<string, unknown> & { type?: string; value?: unknown; from?: Node };

/**
 * Folds each dotted name (`symbol.price`, Jexl's member access) into one identifier whose value is
 * the whole name, so the scope reads `symbol.price` in one call, as it reads a bare formula key.
 */
function foldNames(n: unknown): void {
  if (!n || typeof n !== 'object') return;
  if (Array.isArray(n)) {
    for (const x of n) foldNames(x);
    return;
  }
  const node = n as Node;
  for (const v of Object.values(node)) foldNames(v);
  const from = node.from;
  if (
    node.type === 'Identifier' &&
    !node.relative &&
    from?.type === 'Identifier' &&
    !from.from &&
    !from.relative
  ) {
    node.value = `${String(from.value)}.${String(node.value)}`;
    node.from = undefined;
  }
}

/** Compiles a formula with its dotted names folded (throws on a syntax error). */
function compileNamed(expr: string) {
  const compiled = engine.compile(expr);
  foldNames(compiled._getAst());
  return compiled;
}

const scopeContext = (scope: ViewFormulaScope) =>
  new Proxy({} as Record<string, unknown>, {
    get: (_, name) => (typeof name === 'string' ? (scope.value(name) ?? undefined) : undefined),
  });

/** Compiles a formula (throws on a syntax error) into a row evaluator; a failed row is null. */
export function compileViewFormula(expr: string) {
  const compiled = compileNamed(expr);
  return (scope: ViewFormulaScope): number | string | null => {
    current = scope;
    try {
      const v: unknown = compiled.evalSync(scopeContext(scope));
      if (typeof v === 'number') return Number.isFinite(v) ? v : null;
      if (typeof v === 'boolean') return v ? 1 : 0;
      return typeof v === 'string' ? v : null;
    } catch {
      return null;
    } finally {
      current = null;
    }
  };
}

/**
 * Why a formula works out to no value on one row (blank formula columns showed
 * nothing, so neither the person nor the assistant could tell why): the error it threw, else the fields it
 * read that were empty, else those that held text where it did arithmetic. Null when it has a value.
 */
export function whyBlank(expr: string, scope: ViewFormulaScope): string | null {
  let compiled: ReturnType<typeof engine.compile>;
  try {
    compiled = compileNamed(expr);
  } catch (err) {
    return (err as Error).message.slice(0, 160);
  }
  const read = new Map<string, number | string | null>();
  current = scope;
  try {
    const v: unknown = compiled.evalSync(
      new Proxy({} as Record<string, unknown>, {
        get: (_, name) => {
          if (typeof name !== 'string') return undefined;
          const x = scope.value(name) ?? null;
          read.set(name, x);
          return x ?? undefined;
        },
      }),
    );
    if (
      (typeof v === 'number' && Number.isFinite(v)) ||
      typeof v === 'string' ||
      typeof v === 'boolean'
    )
      return null;
  } catch (err) {
    return `error: ${(err as Error).message.slice(0, 160)}`;
  } finally {
    current = null;
  }
  const empty = [...read].filter(([, x]) => x === null || x === '').map(([k]) => k);
  if (empty.length) return `${empty.join(', ')} ${empty.length === 1 ? 'is' : 'are'} empty`;
  const text = [...read].filter(([, x]) => typeof x === 'string').map(([k]) => k);
  if (text.length)
    return `${text.join(', ')} ${text.length === 1 ? 'is' : 'are'} text, not a number`;
  return 'it works out to no number (a division by 0?)';
}

type Ast = {
  type: string;
  name?: string;
  pool?: string;
  value?: unknown;
  operator?: string;
  left?: Ast;
  right?: Ast;
  consequent?: Ast;
  alternate?: Ast;
};
/** Whether every value a tree can end in is text: a quoted word, a ? : of them, or a join with one. */
const endsInText = (a: Ast | undefined): boolean => {
  if (!a) return false;
  if (a.type === 'Literal') return typeof a.value === 'string';
  if (a.type === 'FunctionCall') return textFunctions.has(String(a.name));
  if (a.type === 'ConditionalExpression')
    return endsInText(a.consequent) && endsInText(a.alternate);
  if (a.type === 'BinaryExpression' && a.operator === '+')
    return endsInText(a.left) || endsInText(a.right);
  return false;
};

/**
 * Whether a formula works out to text on every row: a label such as
 * `dew_point_f < 50 ? 'Dry' : 'Humid'`. Such a column shows as Text and has no number roll-up; one
 * that is text on some branches only keeps its number format, its text showing as written.
 */
export function viewFormulaIsText(expr: string): boolean {
  try {
    return endsInText(compileNamed(expr)._getAst() as Ast);
  } catch {
    return false;
  }
}

/** The functions a tree calls that the formula language lacks (a `|transform` is one too). */
function unknownFunctions(n: unknown, out: Set<string>): Set<string> {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) {
    for (const x of n) unknownFunctions(x, out);
    return out;
  }
  const node = n as Ast;
  if (
    node.type === 'FunctionCall' &&
    (node.pool !== 'functions' || !knownFunctions.has(String(node.name)))
  )
    out.add(String(node.name));
  for (const v of Object.values(node)) unknownFunctions(v, out);
  return out;
}

/** Why a formula can't run on fields `keys` (null: any field), or null when it can. */
export function checkViewFormula(expr: string, keys: string[] | null): string | null {
  let run: ReturnType<typeof compileViewFormula>;
  try {
    run = compileViewFormula(expr);
  } catch (e) {
    return `syntax: ${e instanceof Error ? e.message : String(e)}`;
  }
  const missing = [...unknownFunctions(compileNamed(expr)._getAst(), new Set())];
  if (missing.length)
    return `unknown function ${missing.join(', ')} (functions: ${viewFormulaFunctions.join(', ')})`;
  const unknown = new Set<string>();
  const known = (k: string) => {
    if (keys && !keys.includes(k)) unknown.add(k);
    return 1;
  };
  run({ value: known, groupSum: known, totalSum: known });
  return unknown.size ? `unknown field ${[...unknown].join(', ')}` : null;
}

/** The names a formula reads (fields and formulas, `group_sum` arguments included); [] when it does not parse. */
export function formulaReads(expr: string): string[] {
  let run: ReturnType<typeof compileViewFormula>;
  try {
    run = compileViewFormula(expr);
  } catch {
    return [];
  }
  const read = new Set<string>();
  const note = (k: string) => {
    read.add(k);
    return 1;
  };
  run({ value: note, groupSum: note, totalSum: note });
  return [...read];
}

/**
 * Which name a formula reads `key` by: what each surface builds from its fields (its own domain,
 * its joins, linked domains and frames, its formulas) and maps back to the row's field key.
 */
export type FormulaNames = Map<string, string>;

/** A frame's part of a name: `Earnings next week` is `frame.earnings_next_week`. */
export function frameSpace(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `frame.${/^[a-z_]/.test(s) ? s : `f_${s}`}`;
}

const TOKEN =
  /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/g;

/**
 * `expr` with every name it reads passed through `to` (a quoted name only as a group_sum or
 * total_sum argument); text in quotes and function names are left as they are. Saved formulas
 * from before names (bare field keys) are moved to names with it.
 */
export function renameFormula(expr: string, to: (name: string) => string): string {
  return expr.replace(TOKEN, (t, at: number) => {
    const q = t[0];
    if (q === '"' || q === "'") {
      if (!/_sum\(\s*$/.test(expr.slice(0, at))) return t;
      const inner = t.slice(1, -1);
      const next = to(inner);
      return next === inner ? t : `${q}${next}${q}`;
    }
    if (/^\s*\(/.test(expr.slice(at + t.length))) return t;
    if (t === 'true' || t === 'false' || t === 'null' || t === 'in') return t;
    return to(t);
  });
}

/**
 * The formulas that read one another in a loop, by key (`a` reads `b`, `b` reads `a`): each is
 * blank on every row, so a check refuses it.
 */
export function formulaLoops(formulas: { key: string; expr: string }[]): Set<string> {
  const keys = new Set(formulas.map((f) => f.key));
  const reads = new Map(
    formulas.map((f) => [f.key, formulaReads(f.expr).filter((k) => keys.has(k))]),
  );
  const out = new Set<string>();
  for (const f of formulas) {
    const seen = new Set<string>();
    const stack = [...(reads.get(f.key) ?? [])];
    while (stack.length) {
      const k = stack.pop() as string;
      if (k === f.key) {
        out.add(f.key);
        break;
      }
      if (seen.has(k)) continue;
      seen.add(k);
      stack.push(...(reads.get(k) ?? []));
    }
  }
  return out;
}
