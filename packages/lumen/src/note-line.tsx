import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export interface NoteLineProps {
  icon: LucideIcon;
  /** The point, in a few words. */
  title: ReactNode;
  /** The detail, one line. */
  note?: ReactNode;
  /** A button the note carries. */
  action?: ReactNode;
}

/** One muted line over a card or page: an icon, what it says, and an optional button. */
export function NoteLine({ icon: Icon, title, note, action }: NoteLineProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-muted px-3 py-2 text-xs">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="font-medium">{title}</span>
        {note && <span className="text-muted-foreground"> {note}</span>}
      </span>
      {action}
    </div>
  );
}
