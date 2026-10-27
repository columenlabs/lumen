// An editable text cell: click the value, pick one already in use or type a
// new one, or clear it. Saves at once through the field's `edit`. Clicks stay off the row, which
// opens its details.
import { PencilLineIcon, PlusIcon, XIcon } from 'lucide-react';
import { type ComponentType, type ReactNode, useEffect, useRef, useState } from 'react';
import { ColorChip, colorIcon, tintedIcon } from './color-dot';
import { cn } from './lib/utils';
import { LumenSelector } from './lumen-selector';
import { Input } from './ui/input';

const CLEAR = '\u0000clear';

export function EditCell({
  label,
  value,
  options,
  unused = [],
  chip,
  note,
  colorOf,
  fixed = false,
  edited = false,
  onSave,
}: {
  /** The field's name, e.g. `Basket`. */
  label: string;
  value: string | null;
  /** Values already in use, offered first. */
  options: string[];
  /** Values that exist but no row has, offered after. */
  unused?: string[];
  chip?: boolean;
  /** One line under the input saying what the edit covers, e.g. `every SPY holding`. */
  note?: string;
  /** A value's colour dot (the field's `color`). */
  colorOf?: (value: string) => string | undefined;
  /** Only `options` and `unused` may be picked; nothing typed is taken. */
  fixed?: boolean;
  /** Changed by hand from what it was: a small ✎ marks it. */
  edited?: boolean;
  onSave: (value: string | null) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // A pick keeps the list open until the save lands, so a failure shows in it.
  const picking = useRef(false);
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  const save = async (v: string | null) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(v);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      picking.current = false;
      setSaving(false);
    }
  };
  const row = (o: string) => {
    const c = colorOf?.(o);
    return { value: o, label: o, ...(c ? { icon: colorIcon(c) } : {}) };
  };
  const groups = [
    { label: 'In use', options: options.map(row) },
    { label: 'Unused', options: unused.map(row) },
    ...(value !== null
      ? [
          {
            label: '',
            options: [{ value: CLEAR, label: `Clear ${label.toLowerCase()}`, icon: XIcon }],
          },
        ]
      : []),
  ];
  return (
    // Clicks and keys stay off the row, which opens its details (the list is a portal, but React
    // events still bubble through here).
    <span
      className={edited ? 'inline-flex items-center gap-1' : 'contents'}
      onClick={stop}
      onKeyDown={stop}
    >
      <LumenSelector
        trigger={value === null ? 'icon' : chip ? 'chip' : 'field'}
        icon={value === null ? PlusIcon : undefined}
        size="sm"
        label={value === null ? `Set ${label}` : `${label}: ${value}`}
        className={
          value === null
            ? '-ml-1 size-6 text-muted-foreground'
            : chip
              ? 'h-6 border-0 bg-secondary px-2 text-xs font-normal text-secondary-foreground dark:bg-secondary'
              : '-ml-1.5 h-6 border-0 bg-transparent px-1.5 font-normal text-sm dark:bg-transparent'
        }
        groups={groups}
        value={value}
        empty={fixed ? 'No match.' : `Type a ${label.toLowerCase()} name.`}
        create={fixed ? undefined : (q) => q.trim() || null}
        createLabel={fixed ? undefined : (q) => `Set “${q.trim()}”`}
        open={open}
        onOpenChange={(o) => {
          if (!o && picking.current) return;
          setOpen(o);
          if (!o) setError(null);
        }}
        onChange={(v) => {
          picking.current = true;
          void save(v === CLEAR ? null : v);
        }}
        header={
          (note || error) && (
            <p
              role={error ? 'alert' : undefined}
              className={cn(
                'border-b px-3 py-2 text-xs',
                error ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {error ?? note}
            </p>
          )
        }
      />
      {edited && (
        <PencilLineIcon
          aria-label="Edited by hand"
          className="size-3 shrink-0 text-muted-foreground/70"
        />
      )}
    </span>
  );
}

/**
 * A cell of several values (labels): each shows as a chip with its colour;
 * a tap opens a picker that ticks any number and takes a typed name, and closing it saves them all
 * at once. Clicks stay off the row, which opens its details.
 */
export function EditManyCell({
  label,
  values,
  options,
  unused = [],
  note,
  colorOf,
  iconOf,
  onSave,
}: {
  label: string;
  values: string[];
  options: string[];
  unused?: string[];
  note?: string;
  colorOf?: (value: string) => string | undefined;
  /** A value's icon (a label's), drawn in its colour on its chip and in the picker. */
  iconOf?: (value: string) => ComponentType<{ className?: string }> | undefined;
  onSave: (values: string[]) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(values);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  const start = () => {
    setDraft(values);
    setError(null);
    setOpen(true);
  };
  const close = async () => {
    const same = draft.length === values.length && draft.every((v) => values.includes(v));
    if (same) return setOpen(false);
    setSaving(true);
    try {
      await onSave(draft);
      setOpen(false);
    } catch (e) {
      // The list stays open with why, so the picks are not lost.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const row = (o: string) => {
    const c = colorOf?.(o);
    const i = iconOf?.(o);
    return {
      value: o,
      label: o,
      ...(i ? { icon: tintedIcon(i, c) } : c ? { icon: colorIcon(c) } : {}),
    };
  };
  const all = [...options, ...unused];
  const picked = draft.filter((v) => !all.includes(v));
  const groups = [
    { label: 'In use', options: [...options, ...picked].map(row) },
    { label: 'Unused', options: unused.map(row) },
  ];
  return (
    <span className="inline-flex min-w-0 items-center gap-1" onClick={stop} onKeyDown={stop}>
      {values.length > 0 && (
        <button
          type="button"
          aria-label={`${label}: ${values.join(', ')}`}
          className="flex min-w-0 items-center gap-1 overflow-hidden rounded text-left"
          onClick={start}
        >
          {values.map((v) => (
            <ColorChip key={v} color={colorOf?.(v)} icon={iconOf?.(v)}>
              {v}
            </ColorChip>
          ))}
        </button>
      )}
      <LumenSelector
        multiple
        trigger="icon"
        icon={values.length ? PencilLineIcon : PlusIcon}
        size="sm"
        label={values.length ? `Change ${label.toLowerCase()}` : `Add ${label.toLowerCase()}`}
        className={cn(
          'size-6 text-muted-foreground',
          values.length
            ? 'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 max-md:opacity-100'
            : '-ml-1',
        )}
        groups={groups}
        value={draft}
        disabled={saving}
        empty={`Type a ${label.toLowerCase()} name.`}
        create={(q) => q.trim() || null}
        createLabel={(q) => `Add “${q.trim()}”`}
        open={open}
        onOpenChange={(o) => {
          if (o) start();
          else void close();
        }}
        onChange={setDraft}
        header={
          (note || error) && (
            <p
              role={error ? 'alert' : undefined}
              className={cn(
                'border-b px-3 py-2 text-xs',
                error ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {error ?? note}
            </p>
          )
        }
      />
    </span>
  );
}

/**
 * A cell typed in place (Edits in place), as in a sheet: a click or tap turns
 * the value into a box, Enter saves, Esc leaves it, Tab saves and moves to the next editable cell
 * on the row, and so does clicking away. A cell the person typed carries a small ✎.
 */
export function EditInputCell({
  label,
  value,
  type,
  edited = false,
  children,
  onSave,
}: {
  label: string;
  /** The raw value, for the box. */
  value: string | number | null;
  type: 'number' | 'text';
  edited?: boolean;
  /** The value as the table draws it. */
  children: ReactNode;
  onSave: (value: string | null) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const box = useRef<HTMLInputElement>(null);
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  const start = () => {
    setText(value === null ? '' : String(value));
    setError(null);
    setOpen(true);
  };
  useEffect(() => {
    if (open) box.current?.select();
  }, [open]);
  const save = async (then?: 'next') => {
    const next = text.trim() === '' ? null : text.trim();
    const same = (next ?? '') === (value === null ? '' : String(value));
    if (same || saving) {
      setOpen(false);
      if (then) moveRight(box.current);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
      setOpen(false);
      if (then) moveRight(box.current);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      box.current?.focus();
    } finally {
      setSaving(false);
    }
  };
  if (!open)
    return (
      <button
        type="button"
        data-edit-cell
        aria-label={`Edit ${label}`}
        className={cn(
          'group/cell inline-flex min-h-6 min-w-8 cursor-text items-center gap-1 rounded px-1 -mx-1 text-left hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none',
          value === null && 'text-muted-foreground/60',
        )}
        onClick={(e) => {
          stop(e);
          start();
        }}
        onKeyDown={(e) => {
          stop(e);
          if (e.key === 'Enter' || e.key === 'F2') start();
        }}
      >
        <span className="min-w-0">{value === null ? '—' : children}</span>
        {edited && (
          <PencilLineIcon
            aria-label="Edited by hand"
            className="size-3 shrink-0 text-muted-foreground/70"
          />
        )}
      </button>
    );
  return (
    <span className="contents" onClick={stop} onKeyDown={stop}>
      <Input
        ref={box}
        data-edit-cell
        aria-label={label}
        aria-invalid={error ? true : undefined}
        title={error ?? undefined}
        inputMode={type === 'number' ? 'decimal' : 'text'}
        value={text}
        disabled={saving}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void save();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setOpen(false);
          } else if (e.key === 'Tab') {
            e.preventDefault();
            void save('next');
          }
        }}
        className={cn(
          'h-6 w-24 min-w-16 max-w-48 px-1.5 -mx-1 font-[inherit] text-sm',
          type === 'number' && 'num text-right',
          error && 'border-destructive',
        )}
      />
    </span>
  );
}

/** Focuses the next editable cell after `from` on its row, else the first on the row below. */
function moveRight(from: HTMLElement | null) {
  const row = from?.closest('tr');
  if (!row) return;
  const cells = [...row.querySelectorAll<HTMLElement>('[data-edit-cell]')];
  const i = cells.indexOf(from as HTMLElement);
  const next =
    cells[i + 1] ?? row.nextElementSibling?.querySelector<HTMLElement>('[data-edit-cell]');
  // The box unmounts on save; its button takes its place on the next frame.
  requestAnimationFrame(() => (next?.isConnected ? next : null)?.focus());
}
