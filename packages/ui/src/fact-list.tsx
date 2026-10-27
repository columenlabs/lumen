import { Fragment, type ReactNode } from 'react';
import { cn } from './lib/utils';

export interface Fact {
  label: string;
  value: ReactNode;
  /** The full value on hover, when the value is not plain text. */
  title?: string;
  /** A sentence that may take more lines ("What it inspects"); short values stay on one. */
  wrap?: boolean;
}

export interface FactListProps {
  facts: readonly (Fact | false | null | undefined)[];
  className?: string;
}

/**
 * Label and value pairs in a drawer or card ("Last seen  today 07:18 PM"). The labels take the
 * width of the longest one and the values the rest. Each sits on one line: a value that runs out
 * of room ends in an ellipsis, the whole of it on hover, so a time or an email never breaks.
 */
export function FactList({ facts, className }: FactListProps) {
  return (
    <dl className={cn('grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm', className)}>
      {facts.map(
        (f) =>
          f && (
            <Fragment key={f.label}>
              <dt className="whitespace-nowrap text-muted-foreground">{f.label}</dt>
              <dd
                className={cn('min-w-0', f.wrap ? 'break-words' : 'truncate')}
                title={
                  f.wrap
                    ? undefined
                    : (f.title ?? (typeof f.value === 'string' ? f.value : undefined))
                }
              >
                {f.value}
              </dd>
            </Fragment>
          ),
      )}
    </dl>
  );
}
