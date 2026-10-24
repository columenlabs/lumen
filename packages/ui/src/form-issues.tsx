// Save with issues: a Save that cannot go yet says why. Beside it a chip
// counts what needs fixing and lists it; Save, and each line of the list, takes the person to the
// issue: the editor opens its section or tab (`reveal`), then the field scrolls into view, takes
// the cursor and flashes red once. Nothing saves while an issue stands. Every editor and form in
// the suite uses this in place of a silent disabled Save.
import { CheckIcon, TriangleAlertIcon } from 'lucide-react';
import { type ComponentType, useState } from 'react';
import { cn } from './lib/utils';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

export interface FormIssue {
  /** Where it is, in the form's words: `Formula value`, `Name`. */
  where: string;
  /** What to fix: `Unknown field shares_nonret`. */
  message: string;
  /** The DOM id of the field to take the person to. */
  target?: string;
  /** Opens what hides the field (a section, a tab, a sub-editor) before the jump. */
  reveal?: () => void;
}

/** Opens what hides an issue, then scrolls to its field, focuses it and flashes it once. */
export function goToIssue(issue: FormIssue) {
  issue.reveal?.();
  if (!issue.target) return;
  const id = issue.target;
  // The field may mount only once its section opens: look for it for up to a second.
  let tries = 0;
  const find = () => {
    const el = document.getElementById(id);
    if (!el) {
      if (++tries < 20) setTimeout(find, 50);
      return;
    }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.focus({ preventScroll: true });
    delete el.dataset.issueFlash;
    // A frame between removing and setting restarts the animation on a second jump.
    requestAnimationFrame(() => {
      el.dataset.issueFlash = '';
      setTimeout(() => delete el.dataset.issueFlash, 1200);
    });
  };
  requestAnimationFrame(find);
}

/**
 * Save, and before it, while anything needs fixing, a chip with the count that lists each issue.
 * Save stays tappable then and takes the person to the first issue instead of saving.
 */
export function SaveButton({
  issues,
  onSave,
  label = 'Save',
  icon: Icon = CheckIcon,
  busy = false,
  disabled = false,
  type = 'button',
  className,
}: {
  issues: FormIssue[];
  onSave?: () => void;
  label?: string;
  icon?: ComponentType<{ className?: string }> | null;
  /** Saving now: Save waits. */
  busy?: boolean;
  /** Nothing to save (no change): Save is greyed and needs no reason. */
  disabled?: boolean;
  /** `submit` inside a form: the form's own submit runs only when there are no issues. */
  type?: 'button' | 'submit';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const blocked = issues.length > 0;
  const first = issues[0];
  const go = (issue: FormIssue) => {
    setOpen(false);
    goToIssue(issue);
  };
  return (
    <>
      {blocked && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
            >
              <TriangleAlertIcon />
              {issues.length} to fix
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 gap-1 p-1">
            <p className="px-2 pt-1 text-xs text-muted-foreground">
              Fix {issues.length === 1 ? 'this' : 'these'} to save. Tap one to go to it.
            </p>
            {issues.map((issue, i) => (
              <Button
                // biome-ignore lint/suspicious/noArrayIndexKey: two issues can share a place and message.
                key={i}
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto w-full flex-col items-start gap-0 px-2 py-1.5 text-left font-normal whitespace-normal"
                onClick={() => go(issue)}
              >
                <span className="text-xs font-medium">{issue.where}</span>
                <span className="text-xs text-destructive">{issue.message}</span>
              </Button>
            ))}
          </PopoverContent>
        </Popover>
      )}
      <Button
        type={blocked ? 'button' : type}
        size="sm"
        disabled={disabled || busy}
        aria-disabled={blocked || undefined}
        className={cn(blocked && 'opacity-50', className)}
        onClick={(e) => {
          if (first) {
            e.preventDefault();
            go(first);
          } else if (type === 'button') onSave?.();
        }}
      >
        {Icon && <Icon />}
        {label}
      </Button>
    </>
  );
}
