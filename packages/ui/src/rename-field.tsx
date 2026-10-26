// A name renamed in place (for a broker link accounts; shared so
// An app's bank accounts rename the same way): Enter or leaving the field saves, Escape undoes,
// empty or ↺ goes back to the source's own name, shown as the placeholder. Quiet at rest
// (DESIGN.md, Actions: icon first): a renamed name keeps a ✎ mark, the rest shows on hover or focus.
import { PencilIcon, RotateCcwIcon } from 'lucide-react';
import { useState } from 'react';
import { cn } from './lib/utils';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from './ui/input-group';

export interface RenameFieldProps {
  /** The name shown now: the person's own, or `original`. */
  value: string;
  /** The source's own name (the broker's, the bank's), what Reset goes back to. */
  original: string;
  /** Where `original` comes from, for the tooltip: "At the broker", "At the bank". */
  originLabel: string;
  /** null resets to `original`. */
  onSave: (name: string | null) => void;
}

export function RenameField({ value, original, originLabel, onSave }: RenameFieldProps) {
  const [typed, setTyped] = useState(value);
  const save = () => {
    const name = typed.trim();
    if (name === value) return;
    if (!name && value === original) return setTyped(value);
    onSave(name || null);
  };
  return (
    <InputGroup className="-ml-2 h-7 w-fit max-w-full border-transparent hover:border-input dark:bg-transparent">
      <InputGroupInput
        value={typed}
        placeholder={original}
        aria-label={`Rename ${value}`}
        title={value === original ? 'Rename' : `${originLabel}: ${original}`}
        onChange={(e) => setTyped(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setTyped(value);
            requestAnimationFrame(() => e.currentTarget?.blur());
          }
        }}
        className="field-sizing-content min-w-0 px-2 text-sm"
      />
      <InputGroupAddon align="inline-end">
        {/* At rest only a renamed name keeps its ✎; the ✎ and ↺ show on hover or focus. */}
        <PencilIcon
          className={cn(
            'size-3 group-focus-within/input-group:opacity-100 group-hover/input-group:opacity-100',
            value === original && 'opacity-0',
          )}
        />
        {value !== original && (
          <InputGroupButton
            className="opacity-0 group-focus-within/input-group:opacity-100 group-hover/input-group:opacity-100"
            size="icon-xs"
            aria-label={`Reset to ${original}`}
            title={`Reset to ${original}`}
            onClick={() => onSave(null)}
          >
            <RotateCcwIcon />
          </InputGroupButton>
        )}
      </InputGroupAddon>
    </InputGroup>
  );
}
