import { renameFormula } from '@columenlabs/lumen-ui-types/views';
// Formula box with autocomplete: a formula reads fields by name, where they
// come from and their key (`symbol.price`, `frame.earnings_next_week.eps`, a formula's bare key),
// but people know fields by their labels (Price). Typing a word opens a LumenSelectorList under
// the box that matches labels and names fuzzily (`prc` finds Price, `symbol.` lists the Symbol
// fields); Tab or Enter puts the name in. It replaces the wall of key chips under the box.
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LumenOption, LumenSelectorListHandle } from './lumen-selector';
import { LumenSelectorList, fuzzyScore } from './lumen-selector';
import { Textarea } from './ui/textarea';

/** The roll-ups a formula can call, offered beside the fields. */
const FUNCTIONS: LumenOption[] = [
  {
    value: 'group_sum("")',
    label: 'group_sum',
    detail: 'a field summed over its group',
    group: 'Functions',
  },
  {
    value: 'total_sum("")',
    label: 'total_sum',
    detail: 'a field summed over every row',
    group: 'Functions',
  },
];

/** The name the caret is in (dots included), from its start to the caret. */
function wordAt(text: string, caret: number): { start: number; word: string } {
  const before = text.slice(0, caret);
  const m = /[A-Za-z_][A-Za-z0-9_.]*$/.exec(before);
  return m ? { start: caret - m[0].length, word: m[0] } : { start: caret, word: '' };
}

/** Does the name at `start` run on past the caret? Its whole length, for replacing it. */
function wordEnd(text: string, caret: number): number {
  const m = /^[A-Za-z0-9_.]*/.exec(text.slice(caret));
  return caret + (m?.[0].length ?? 0);
}

export function FormulaInput({
  id,
  value,
  onChange,
  fields,
  invalid,
  placeholder,
}: {
  id?: string;
  value: string;
  onChange: (expr: string) => void;
  /** What it can read: `value` the name, `label` what people call it, `group` its source. */
  fields: LumenOption[];
  invalid?: boolean;
  placeholder?: string;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const list = useRef<LumenSelectorListHandle>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const [closedAt, setClosedAt] = useState<string | null>(null);
  const moveTo = useRef<number | null>(null);
  const options = useMemo(
    () => [...fields.map((f) => ({ ...f, detail: f.value })), ...FUNCTIONS],
    [fields],
  );
  const { start, word } = caret === null ? { start: 0, word: '' } : wordAt(value, caret);
  const known = options.some((o) => o.value === word);
  const open = caret !== null && word.length > 0 && !known && closedAt !== `${start}:${word}`;

  useLayoutEffect(() => {
    if (moveTo.current === null || !box.current) return;
    box.current.setSelectionRange(moveTo.current, moveTo.current);
    setCaret(moveTo.current);
    moveTo.current = null;
  });

  const pick = (o: LumenOption) => {
    if (caret === null) return;
    const end = wordEnd(value, caret);
    const fn = o.value.endsWith('("")');
    const next = value.slice(0, start) + o.value + value.slice(end);
    // A function's caret goes between its quotes, ready for the field it sums.
    moveTo.current = start + (fn ? o.value.length - 2 : o.value.length);
    onChange(next);
  };
  const track = () => setCaret(box.current?.selectionStart ?? null);

  return (
    <div className="relative">
      <Textarea
        ref={box}
        id={id}
        rows={2}
        aria-invalid={invalid || undefined}
        aria-autocomplete="list"
        className="min-h-16 font-mono text-xs"
        placeholder={placeholder}
        value={value}
        spellCheck={false}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart);
        }}
        onKeyDown={(e) => {
          if (open && list.current?.key(e)) return;
        }}
        onKeyUp={(e) => {
          if (!['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(e.key)) track();
        }}
        onClick={track}
        onFocus={track}
        onBlur={() => setCaret(null)}
      />
      {open && (
        <LumenSelectorList
          fuzzy
          options={options}
          query={word}
          label="Fields"
          handle={list}
          onPick={pick}
          onClose={() => setClosedAt(`${start}:${word}`)}
          empty={`No field matches ${word}`}
          className="absolute top-full z-30 mt-1 w-full max-w-md"
        />
      )}
    </div>
  );
}

/**
 * For an `unknown field X` issue: the field X most likely means, by label first (Price is
 * price), then by the closest key or label.
 */
export function guessField(name: string, fields: LumenOption[]): LumenOption | null {
  const n = name.toLowerCase();
  // A name's field part: `price` (a formula from before names) or `holding.price` is `holdings.price`.
  const part = n.slice(n.lastIndexOf('.') + 1);
  const tail = (v: string) => v.toLowerCase().slice(v.lastIndexOf('.') + 1);
  return (
    fields.find((f) => f.label.toLowerCase() === n) ??
    fields.find((f) => f.value.toLowerCase() === n) ??
    fields.find((f) => tail(f.value) === part) ??
    fields.find((f) => f.label.toLowerCase().replace(/[^a-z0-9]+/g, '_') === part) ??
    closest(part, fields)
  );
}

function closest(n: string, fields: LumenOption[]): LumenOption | null {
  let best: LumenOption | null = null;
  let top = 0;
  for (const f of fields) {
    const key = f.value.slice(f.value.lastIndexOf('.') + 1);
    const v = Math.max(fuzzyScore(n, f.label) ?? 0, fuzzyScore(n, key) ?? 0);
    if (v > top) [best, top] = [f, v];
  }
  // Only a match on most of its letters in order, never a stray one.
  return top >= n.length * 2 ? best : null;
}

/** `expr` with every whole name `from` swapped for `to` (never part of a longer name). */
export const swapWord = (expr: string, from: string, to: string) =>
  renameFormula(expr, (n) => (n === from ? to : n));
