// LumenForm:
// a list of fields in, a laid-out form out. Label, (i), input and error sit the same way in every
// app; each field's own check runs as the person types, and Save is LumenShell's SaveButton, which
// lists what stands in the way and takes the person to it. A secret already saved shows masked and
// is kept while its box stays empty. LumenForm only puts the kit's parts together.

import { XIcon } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { type FormIssue, SaveButton } from './form-issues';
import { IconButton } from './icon-button';
import { InfoTip } from './info-tip';
import { type LumenOption, LumenSelector } from './lumen-selector';
import { Field, FieldError, FieldGroup, FieldLabel } from './ui/field';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';

/** A text field's value is a string; a `multi` field's is a list. */
export type LumenFormValue = string | string[];
export type LumenFormValues = Record<string, LumenFormValue>;

export interface LumenFormField {
  id: string;
  label: string;
  /** `text` by default. `secret` hides what is typed; `select` and `multi` are LumenSelector. */
  kind?: 'text' | 'secret' | 'number' | 'date' | 'textarea' | 'select' | 'multi';
  required?: boolean;
  /** More about the field, behind an (i) beside its label (`InfoTip`). Most fields need none. */
  info?: ReactNode;
  /** @deprecated Use `info`: drawn the same way, as an (i) beside the label, never a line under the field. */
  hint?: ReactNode;
  placeholder?: string;
  /** `select` and `multi`. */
  options?: readonly LumenOption[];
  /** A message when the value is wrong, else nothing: `v => v.startsWith('https://') || 'Must start with https://'`. */
  check?: (value: LumenFormValue, values: LumenFormValues) => string | true | undefined | null;
  /** `secret`: the saved value, masked (`••••3f9a`). An empty box keeps it. */
  saved?: string;
}

const isEmpty = (v: LumenFormValue | undefined) =>
  v === undefined || (Array.isArray(v) ? v.length === 0 : v.trim() === '');

/** What stands in the way of a save, one message per field. */
export function lumenFormIssues(
  fields: readonly LumenFormField[],
  values: LumenFormValues,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = values[f.id] ?? (f.kind === 'multi' ? [] : '');
    if (isEmpty(v)) {
      if (f.required && !(f.kind === 'secret' && f.saved)) out[f.id] = `${f.label} is needed`;
      continue;
    }
    const r = f.check?.(v, values);
    if (typeof r === 'string') out[f.id] = r;
  }
  return out;
}

export function LumenForm({
  fields,
  initial,
  onSave,
  onCancel,
  saveLabel = 'Save',
  busy = false,
  footer,
}: {
  fields: readonly LumenFormField[];
  initial?: LumenFormValues;
  /** Runs only when every check passes. A secret left empty is left out. */
  onSave: (values: LumenFormValues) => void;
  onCancel?: () => void;
  saveLabel?: string;
  busy?: boolean;
  /** Beside Save, on the left (a Test button, a note). */
  footer?: ReactNode;
}) {
  const base = useId();
  const [values, setValues] = useState<LumenFormValues>(initial ?? {});
  // A field shows its error once the person has left it, or tried to save.
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const errors = lumenFormIssues(fields, values);
  const domId = (id: string) => `${base}-${id}`;
  const issues: FormIssue[] = fields
    .filter((f) => errors[f.id])
    .map((f) => ({ where: f.label, message: errors[f.id] ?? '', target: domId(f.id) }));
  const set = (id: string, v: LumenFormValue) => setValues((s) => ({ ...s, [id]: v }));
  const touchAll = () => setTouched(new Set(fields.map((f) => f.id)));
  const touch = (id: string) => setTouched((s) => (s.has(id) ? s : new Set(s).add(id)));

  const save = () =>
    onSave(
      Object.fromEntries(
        Object.entries(values).filter(
          ([k, v]) => !(fields.find((f) => f.id === k)?.kind === 'secret' && isEmpty(v)),
        ),
      ),
    );

  const input = (f: LumenFormField) => {
    const id = domId(f.id);
    const invalid = touched.has(f.id) && !!errors[f.id];
    const text = (values[f.id] as string | undefined) ?? '';
    switch (f.kind) {
      case 'select':
        return (
          <LumenSelector
            id={id}
            label={f.label}
            options={f.options ?? []}
            placeholder={f.placeholder}
            value={text}
            onChange={(v) => {
              set(f.id, v);
              touch(f.id);
            }}
          />
        );
      case 'multi':
        return (
          <LumenSelector
            id={id}
            label={f.label}
            multiple
            options={f.options ?? []}
            placeholder={f.placeholder}
            value={(values[f.id] as string[] | undefined) ?? []}
            onChange={(v) => {
              set(f.id, v);
              touch(f.id);
            }}
          />
        );
      case 'textarea':
        return (
          <Textarea
            id={id}
            value={text}
            placeholder={f.placeholder}
            aria-invalid={invalid || undefined}
            onChange={(e) => set(f.id, e.target.value)}
            onBlur={() => touch(f.id)}
          />
        );
      default:
        return (
          <Input
            id={id}
            type={
              f.kind === 'secret'
                ? 'password'
                : f.kind === 'number'
                  ? 'number'
                  : f.kind === 'date'
                    ? 'date'
                    : 'text'
            }
            value={text}
            placeholder={f.kind === 'secret' && f.saved ? f.saved : f.placeholder}
            autoComplete={f.kind === 'secret' ? 'off' : undefined}
            className={f.kind === 'date' ? 'w-44' : undefined}
            aria-invalid={invalid || undefined}
            onChange={(e) => set(f.id, e.target.value)}
            onBlur={() => touch(f.id)}
          />
        );
    }
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        touchAll();
        if (!issues.length) save();
      }}
    >
      <FieldGroup>
        {fields.map((f) => {
          const invalid = touched.has(f.id) && !!errors[f.id];
          return (
            <Field key={f.id} data-invalid={invalid || undefined}>
              <FieldLabel htmlFor={domId(f.id)}>
                {f.label}
                {f.required && <span className="font-normal text-muted-foreground">required</span>}
                {(f.info ?? f.hint) && (
                  <InfoTip label={`About ${f.label}`}>{f.info ?? f.hint}</InfoTip>
                )}
              </FieldLabel>
              {input(f)}
              {invalid && <FieldError>{errors[f.id]}</FieldError>}
            </Field>
          );
        })}
      </FieldGroup>
      <div className="flex items-center justify-end gap-2 border-t pt-3">
        {footer}
        <div className="flex-1" />
        {onCancel && <IconButton type="button" icon={XIcon} label="Cancel" onClick={onCancel} />}
        {/* A tap on Save, blocked or not, shows every field's error. */}
        <span className="contents" onClickCapture={touchAll}>
          <SaveButton issues={issues} busy={busy} label={saveLabel} onSave={save} />
        </span>
      </div>
    </form>
  );
}
