// A file to bring in (a CSV, a statement): drop it on the field or pick it. The app holds the
// chosen file, so clearing the field after an upload is the app setting `file` back to null.
import { FileUpIcon, XIcon } from 'lucide-react';
import { type DragEvent, useId, useRef, useState } from 'react';
import { IconButton } from './icon-button';
import { cn } from './lib/utils';
import { Button } from './ui/button';

export interface LumenFileFieldProps {
  /** The chosen file, or null for none. */
  file: File | null;
  onFile: (file: File | null) => void;
  /** File types the picker offers, as the input's `accept` (`.csv,text/csv`). */
  accept?: string;
  /** What the field takes, for screen readers and the empty field ("CSV file"). */
  label: string;
  disabled?: boolean;
  className?: string;
}

/** A drop zone with a Choose button; the chosen file's name and size, and × to clear it. */
export function LumenFileField({
  file,
  onFile,
  accept,
  label,
  disabled,
  className,
}: LumenFileFieldProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const allowed = (f: File) => {
    if (!accept) return true;
    const name = f.name.toLowerCase();
    return accept.split(',').some((a) => {
      const t = a.trim().toLowerCase();
      if (t.startsWith('.')) return name.endsWith(t);
      if (t.endsWith('/*')) return f.type.startsWith(t.slice(0, -1));
      return f.type === t;
    });
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (!disabled && f && allowed(f)) onFile(f);
  };
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      className={cn(
        'flex min-w-0 items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm',
        over && 'border-primary bg-primary/5',
        disabled && 'opacity-50',
        className,
      )}
    >
      <FileUpIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      {file ? (
        <>
          <span className="min-w-0 flex-1 truncate" title={file.name}>
            {file.name}
          </span>
          <span className="num shrink-0 text-xs text-muted-foreground">{fileSize(file.size)}</span>
          <IconButton
            icon={XIcon}
            size="icon-xs"
            label="Clear file"
            disabled={disabled}
            onClick={() => onFile(null)}
          />
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            Drop a file or choose one
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => input.current?.click()}
          >
            Choose
          </Button>
        </>
      )}
      <input
        ref={input}
        id={id}
        type="file"
        accept={accept}
        aria-label={label}
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          // Emptied at once, so picking the same file again still reads it.
          e.target.value = '';
          if (f) onFile(f);
        }}
      />
    </div>
  );
}

const fileSize = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 ** 2
      ? `${(n / 1024).toFixed(0)} KB`
      : `${(n / 1024 ** 2).toFixed(1)} MB`;
