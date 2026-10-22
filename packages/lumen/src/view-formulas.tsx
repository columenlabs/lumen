// Formula columns and tiles on a custom view: a view computes its own columns
// from the domain's fields (`config.formulas`, Jexl, `@columenlabs/lumen-types/views`) and rolls fields up
// into its own tiles (`config.tiles`). Each formula is a row of the Edit dialog's Fields list; its
// pencil opens this form under the row.
import {
  type ViewFormat,
  type ViewFormula,
  type ViewFormulaScope,
  type ViewOwnTile,
  checkViewFormula,
  compileViewFormula,
  formulaLoops,
  formulaReads,
  viewAggs,
  viewFormulaIsText,
  viewNumberFormats,
} from '@columenlabs/lumen-types/views';
import {
  CalendarCheckIcon,
  CalendarClockIcon,
  CalendarDaysIcon,
  CalendarFoldIcon,
  CalendarIcon,
  CalendarRangeIcon,
  CheckIcon,
  CircleAlertIcon,
  type LucideIcon,
  SigmaIcon,
  Trash2Icon,
  WandSparklesIcon,
} from 'lucide-react';
import { LumenConfirm } from './confirm';
import { FormulaInput, guessField, swapWord } from './formula-input';
import { IconButton } from './icon-button';
import { type LumenOption, LumenSelector } from './lumen-selector';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { FORMULAS_GROUP, type ViewDomain, type ViewField, fieldName, groupOf } from './view-model';

export const MAX_FORMULAS = 20;
/**
 * A format's short name, short enough for the field list's Format column, and how it reads
 *. ± marks the signed, gain/loss coloured ones.
 */
export const FORMAT_LABELS: Record<ViewFormat, string> = {
  number: 'Number',
  rounded: 'Rounded',
  integer: 'Integer',
  compact: 'Compact',
  signed: 'Number ±',
  price: 'Currency',
  price_rounded: 'Rounded $',
  price_signed: 'Currency ±',
  weight: 'Percent',
  percent: 'Percent ±',
  text: 'Text',
};
/**
 * A format as a chip glyph for the field list: $ the currency (USD, the only
 * one the views draw), # a number, % a percent, Aa text, ± the signed ones.
 */
const FORMAT_GLYPHS: Record<ViewFormat, string> = {
  number: '#',
  rounded: '#',
  integer: '#',
  compact: '#',
  signed: '±#',
  price: '$',
  price_rounded: '$',
  price_signed: '±$',
  weight: '%',
  percent: '±%',
  text: 'Aa',
};
/** Text fields whose icon is a calendar are dates (no date format exists; the icon says it). */
const DATE_ICONS = new Set<LucideIcon>([
  CalendarIcon,
  CalendarDaysIcon,
  CalendarRangeIcon,
  CalendarClockIcon,
  CalendarCheckIcon,
  CalendarFoldIcon,
]);
/** A field's type as a short chip, its full name on hover. */
export function FormatChip({ format, icon }: { format: ViewFormat; icon?: LucideIcon }) {
  const date = format === 'text' && !!icon && DATE_ICONS.has(icon);
  return (
    <Badge
      variant="outline"
      className="h-5 min-w-7 justify-center px-1.5 font-mono text-[0.7rem] font-normal text-muted-foreground"
      title={date ? 'Date' : FORMAT_LABELS[format]}
      aria-label={date ? 'Date' : FORMAT_LABELS[format]}
    >
      {date ? <CalendarDaysIcon className="size-3" /> : FORMAT_GLYPHS[format]}
    </Badge>
  );
}
const FORMAT_EXAMPLES: Record<ViewFormat, string> = {
  number: '1,234.56',
  rounded: '1,235',
  integer: '2026',
  compact: '1.2K · 10B',
  signed: '+1,234.56',
  price: '$1,234.56',
  price_rounded: '$1,235',
  price_signed: '+$1,234.56',
  weight: '12.3%',
  percent: '+12.3%',
  text: 'Abc',
};
/** The number formats as picker options, each with how it reads. */
export const formatOptions = (): LumenOption<ViewFormula['format']>[] =>
  viewNumberFormats.map((v) => ({
    value: v,
    label: FORMAT_LABELS[v],
    detail: FORMAT_EXAMPLES[v],
  }));
const NO_ROLLUP = '_none';
/** What a text formula's group and Total rows can show: no sum or average of words. */
const TEXT_AGGS = ['count', 'distinct', 'first', 'last'] as const;
type TextAgg = (typeof TEXT_AGGS)[number];
const isTextAgg = (a: ViewFormula['agg']): a is TextAgg => TEXT_AGGS.includes(a as TextAgg);

/**
 * A formula as it shows: a Text one has no sum or average of words, so its
 * group and Total rows are blank unless they count, or show the first or last value. Its format is
 * the person's pick; a number format on words just shows the words.
 */
export function shownFormula(f: ViewFormula): ViewFormula {
  if (f.format !== 'text') return f;
  return { ...f, agg: isTextAgg(f.agg) ? f.agg : 'none' };
}

/**
 * Fields as LumenSelector options, grouped by the domain's field groups (Holding, Symbol, Account,
 * Formulas) when it has them; without a domain or groups they are one list.
 */
export function fieldOptions<T>(fields: ViewField<T>[], domain?: ViewDomain<T>): LumenOption[] {
  const labels = new Map((domain?.groups ?? []).map((g) => [g.id, g.label]));
  const grouped = !!domain && (labels.size > 1 || fields.some((f) => f.group === FORMULAS_GROUP));
  return fields.map((f) => {
    const g = domain ? groupOf(domain, f) : f.group;
    return {
      value: f.key,
      label: f.label,
      icon: f.icon,
      group: grouped
        ? g === FORMULAS_GROUP
          ? 'Formulas'
          : (labels.get(g ?? '') ?? undefined)
        : undefined,
    };
  });
}

/** A view's formulas as fields: shown, sorted and rolled up like the domain's own. */
export function formulaFields<T>(formulas: ViewFormula[]): ViewField<T>[] {
  return formulas.map(shownFormula).map((f) => {
    let run: ((s: ViewFormulaScope) => number | string | null) | null;
    try {
      run = compileViewFormula(f.expr);
    } catch {
      run = null;
    }
    return {
      key: f.key,
      label: f.label,
      group: FORMULAS_GROUP,
      icon: SigmaIcon,
      value: () => null,
      format: f.format,
      formula: f.expr,
      // A formula can work out dollars from amounts; only a share (%) stays under Hide amounts.
      amount: f.format !== 'percent' && f.format !== 'weight' && f.format !== 'text',
      // `none` leaves group and Total rows blank: neither a roll-up nor the formula again.
      aggregate: f.agg && f.agg !== 'none' ? f.agg : undefined,
      rollFormula: f.agg === null,
      compute: (_, scope) => (run ? run(scope) : null),
    };
  });
}

/**
 * What is wrong with each formula on a domain (its fields, not its formulas); null where nothing.
 * A formula reads fields by name and any other formula by its key, never in a loop.
 */
export function formulaIssues<T>(
  formulas: ViewFormula[],
  domain: ViewDomain<T>,
): (string | null)[] {
  const keys = domain.fields.map((f) => f.key);
  const names = [...domain.fields.map((f) => fieldName(domain, f)), ...formulas.map((f) => f.key)];
  const loops = formulaLoops(formulas);
  return formulas.map((f, i) => {
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(f.key)) return 'Key: lowercase letters, digits and _';
    if (keys.includes(f.key) || formulas.slice(0, i).some((x) => x.key === f.key))
      return `Key ${f.key} is taken`;
    if (!f.label.trim()) return 'Give it a label';
    if (!f.expr.trim()) return 'Write an expression';
    const issue = checkViewFormula(f.expr, names);
    if (issue) return issue;
    if (!loops.has(f.key)) return null;
    const via = formulaReads(f.expr).filter((k) => loops.has(k) && k !== f.key);
    return `${f.key} loops back to itself${via.length ? ` through ${via.join(', ')}` : ''}`;
  });
}

/**
 * The fields and formulas a formula can read, as picker options: each field's name as the value
 * (`symbol.price`), grouped as in the Columns tree; the formulas by key, but `except`.
 */
export function formulaOptions<T>(
  domain: ViewDomain<T>,
  formulas: ViewFormula[],
  except?: string,
): LumenOption[] {
  const fields = domain.fields.filter((f) => groupOf(domain, f) !== FORMULAS_GROUP);
  return [
    ...fieldOptions(fields, domain).map((o, i) => {
      const f = fields[i] as ViewField<T>;
      return { ...o, value: fieldName(domain, f) };
    }),
    ...formulas
      .filter((f) => f.key !== except)
      .map((f) => ({ value: f.key, label: f.label || f.key, group: 'Formulas' })),
  ];
}

/** The DOM id of the FormulaForm field an issue from `formulaIssues` is about. */
export const formulaIssueTarget = (key: string, issue: string) =>
  `formula-${key}-${issue.startsWith('Key') ? 'key' : issue === 'Give it a label' ? 'label' : 'expr'}`;

export const AGG_LABELS: Record<ViewOwnTile['agg'], string> = {
  sum: 'Sum',
  mean: 'Average',
  min: 'Min',
  max: 'Max',
  count: 'Count',
  distinct: 'Distinct count',
  first: 'First',
  last: 'Last',
};
export const MAX_TILES = 8;

/**
 * One formula's form, under its row in the Fields list: label and key, the expression (fields
 * offered as you type), its format and how group and Total rows roll it up.
 */
export function FormulaForm({
  formula: f,
  issue,
  blank,
  fields,
  onChange,
  onRemove,
  onDone,
}: {
  formula: ViewFormula;
  issue: string | null;
  /** Why it is blank on some of the page's rows (`blank on 3 of 24 rows: x is empty`). */
  blank?: string | null;
  /** The fields and formulas it can read, by name, as picker options (`formulaOptions`). */
  fields: LumenOption[];
  onChange: (p: Partial<ViewFormula>) => void;
  /** Remove and Done, for a formula opened in a list. Left out (a dialog with its own footer), the
   *  form is bare: no row actions, no row tint or indent. */
  onRemove?: () => void;
  onDone?: () => void;
}) {
  const id = `formula-${f.key}`;
  const row = !!(onRemove && onDone);
  const shown = shownFormula(f);
  const text = shown.format === 'text';
  const words = viewFormulaIsText(f.expr);
  // Text is the default for words, never a lock: the format moves only when
  // the expression starts or stops giving words, and the picker can change it any time.
  const setExpr = (expr: string) => {
    const now = viewFormulaIsText(expr);
    if (now === words) return onChange({ expr });
    onChange(
      now
        ? { expr, format: 'text', agg: shownFormula({ ...f, format: 'text' }).agg }
        : { expr, format: 'number', agg: null },
    );
  };
  // `unknown field Price`: the field each name most likely means, offered as a one-tap fix.
  const unknown = issue?.startsWith('unknown field ')
    ? issue.slice('unknown field '.length).split(', ')
    : [];
  const fixes = unknown.flatMap((name) => {
    const to = guessField(name, fields);
    return to ? [{ name, to }] : [];
  });
  return (
    <div
      className={
        row ? 'col-span-full grid gap-3 border-t bg-muted/30 px-3 py-3 md:pl-10' : 'grid gap-3 p-4'
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-label`}>Label</Label>
          <Input
            id={`${id}-label`}
            value={f.label}
            onChange={(e) => onChange({ label: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-key`}>Key</Label>
          <Input
            id={`${id}-key`}
            className="font-mono text-xs"
            value={f.key}
            onChange={(e) => onChange({ key: e.target.value })}
          />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-expr`}>Expression</Label>
        <FormulaInput
          id={`${id}-expr`}
          invalid={!!issue}
          fields={fields}
          placeholder={'Type a field: market_value / group_sum("market_value") * 100'}
          value={f.expr}
          onChange={setExpr}
        />
        {issue ? (
          <p role="alert" className="flex flex-wrap items-center gap-1.5 text-xs text-destructive">
            <CircleAlertIcon className="size-3.5" />
            {fixes.length
              ? fixes.map(({ name, to }) => (
                  <span key={name} className="flex items-center gap-1.5">
                    No field {name}. Did you mean <code className="font-mono">{to.value}</code> (
                    {to.label})?
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => setExpr(swapWord(f.expr, name, to.value))}
                    >
                      <WandSparklesIcon />
                      Fix
                    </Button>
                  </span>
                ))
              : issue}
          </p>
        ) : blank ? (
          <p className="flex items-center gap-1.5 text-xs text-warning">
            <CircleAlertIcon className="size-3.5" />
            Reads fine, but {blank}
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-gain">
            <CheckIcon className="size-3.5" />
            Reads fine
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label>Format</Label>
          <LumenSelector
            label="Format"
            size="sm"
            className="w-40"
            options={[
              ...formatOptions(),
              { value: 'text', label: FORMAT_LABELS.text, detail: FORMAT_EXAMPLES.text },
            ]}
            value={shown.format}
            onChange={(v) =>
              onChange(
                v === 'text'
                  ? { format: v, agg: shownFormula({ ...f, format: v }).agg }
                  : { format: v, agg: text ? null : f.agg },
              )
            }
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Group and Total rows</Label>
          <LumenSelector
            label="Group and Total rows"
            size="sm"
            className="w-40"
            options={
              text
                ? [
                    { value: 'none', label: 'None' },
                    ...TEXT_AGGS.map((a) => ({ value: a, label: AGG_LABELS[a] })),
                  ]
                : [
                    { value: NO_ROLLUP, label: 'Same formula' },
                    ...viewAggs.map((a) => ({ value: a, label: AGG_LABELS[a] })),
                    { value: 'none', label: 'None' },
                  ]
            }
            value={shown.agg ?? NO_ROLLUP}
            onChange={(v) => onChange({ agg: v === NO_ROLLUP ? null : (v as ViewFormula['agg']) })}
          />
        </div>
        {onRemove && onDone && (
          <div className="ml-auto flex gap-2">
            <LumenConfirm
              title={`Remove formula ${f.label || f.key}?`}
              description="It leaves this view when you save."
              action="Remove"
              onConfirm={onRemove}
            >
              <IconButton icon={Trash2Icon} label="Remove formula" variant="destructive" />
            </LumenConfirm>
            <Button variant="outline" size="sm" onClick={onDone}>
              <CheckIcon />
              Done
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
