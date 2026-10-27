// Messages in the status bar: one line each, a few at most, the rest behind a "+N" chip. A long
// message ends in an ellipsis with its full text in a pop-up on hover or tap, and the same message
// posted again shows once with a count, so a burst of errors never floods the bar or pushes its
// other items off.
import type { ReactNode } from 'react';
import { useHoverOpen } from './hooks/use-hover-open';
import { useIsMobile } from './hooks/use-mobile';
import { cn } from './lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

export type StatusMessageTone = 'info' | 'success' | 'warning' | 'error';

export interface StatusMessage {
  text: string;
  /** Colours the text and its dot: error red, warning amber, success green; info has no dot. */
  tone?: StatusMessageTone;
  /** How many times it was posted, for an app that counts repeats itself; repeats in the list add up too. */
  count?: number;
}

/** Errors first, then warnings, so the message that matters most is the one in view. */
const RANK: Record<StatusMessageTone, number> = { error: 0, warning: 1, success: 2, info: 3 };

const TEXT: Record<StatusMessageTone, string | undefined> = {
  error: 'text-destructive',
  warning: 'text-warning',
  success: undefined,
  info: undefined,
};

const DOT: Record<StatusMessageTone, string | undefined> = {
  error: 'bg-destructive',
  warning: 'bg-warning',
  success: 'bg-gain',
  info: undefined,
};

interface Group extends Required<StatusMessage> {
  count: number;
}

/** One entry per distinct message (same tone, same words), counted, most severe first. */
export function groupStatusMessages(messages: readonly StatusMessage[]): Group[] {
  const groups = new Map<string, Group>();
  for (const m of messages) {
    const text = m.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const tone = m.tone ?? 'info';
    const key = `${tone}\u0000${text}`;
    const count = Math.max(1, m.count ?? 1);
    const g = groups.get(key);
    if (g) g.count += count;
    else groups.set(key, { text, tone, count });
  }
  // Map keeps first-seen order; the sort is stable, so equal tones keep it.
  return [...groups.values()].sort((a, b) => RANK[a.tone] - RANK[b.tone]);
}

const label = (g: Group) => (g.count > 1 ? `${g.text} (×${g.count})` : g.text);

function Dot({ tone }: { tone: StatusMessageTone }) {
  const color = DOT[tone];
  return color ? <span aria-hidden className={cn('size-2 shrink-0 rounded-full', color)} /> : null;
}

/** Keeps the pop-up off the window's edge on a narrow screen. */
const COLLISION_PAD = 8;

/**
 * A status bar trigger whose pop-up opens on hover with a mouse and on tap with a finger or
 * keyboard, like the services chip, so a phone can read the full text too (a tooltip never opens
 * on touch). Styled on its own classes only: a trigger owns `data-state`.
 */
function Pop({
  label: name,
  className,
  children,
  content,
}: {
  label?: string;
  className: string;
  children: ReactNode;
  content: ReactNode;
}) {
  const { open, setOpen, hover, content: pop } = useHoverOpen();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger aria-label={name} className={className} {...hover}>
        {children}
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        collisionPadding={COLLISION_PAD}
        className="w-auto max-w-sm gap-1.5 text-xs break-words"
        {...pop}
      >
        {content}
      </PopoverContent>
    </Popover>
  );
}

const TRIGGER =
  'flex h-6 items-center gap-1.5 rounded-md px-1.5 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none';

function Line({ group }: { group: Group }) {
  return (
    <Pop
      className={cn(TRIGGER, 'min-w-0 max-w-(--status-message-max)')}
      content={<p className={TEXT[group.tone]}>{label(group)}</p>}
    >
      <Dot tone={group.tone} />
      <span className={cn('min-w-0 truncate', TEXT[group.tone])}>{group.text}</span>
      {group.count > 1 && (
        <span className="num shrink-0 text-foreground/80" aria-label={`${group.count} times`}>
          ×{group.count}
        </span>
      )}
    </Pop>
  );
}

/**
 * The app's messages in the status bar. Each message is one line that ends in an ellipsis past
 * `--status-message-max`, with its full text on hover or tap; a repeated message shows once with
 * `×N`; past `max` messages (one on a phone), a `+N` chip lists the rest.
 */
export function StatusMessages({
  messages,
  max = 2,
  className,
}: {
  messages: readonly StatusMessage[];
  /** How many messages show at once on a wider screen; the rest go behind the `+N` chip. */
  max?: number;
  className?: string;
}) {
  const phone = useIsMobile();
  const groups = groupStatusMessages(messages);
  if (!groups.length) return null;
  const shown = groups.slice(0, phone ? 1 : Math.max(1, max));
  const rest = groups.slice(shown.length);
  return (
    <span aria-live="polite" className={cn('flex min-w-0 items-center gap-2', className)}>
      {shown.map((g) => (
        <Line key={`${g.tone}:${g.text}`} group={g} />
      ))}
      {rest.length > 0 && (
        <Pop
          label={`${rest.length} more messages`}
          className={cn(TRIGGER, 'num shrink-0 text-foreground/80')}
          content={
            <ul className="flex flex-col gap-1">
              {rest.map((g) => (
                <li key={`${g.tone}:${g.text}`} className="flex items-start gap-1.5">
                  <span className="flex h-4 items-center">
                    <Dot tone={g.tone} />
                  </span>
                  <span className={TEXT[g.tone]}>{label(g)}</span>
                </li>
              ))}
            </ul>
          }
        >
          +{rest.length}
        </Pop>
      )}
    </span>
  );
}
