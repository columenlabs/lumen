// A pick-one list of cards, each with an icon, a title and a line under it: the way an app asks
// "how do you want to do this?" when each option needs a sentence. For a short one-of-a-few
// choice without notes, use CardSegments.
import { Check } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from './ui/item';

export interface LumenChoiceOption<T extends string> {
  value: T;
  icon: ComponentType<{ className?: string }>;
  title: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export function LumenChoice<T extends string>({
  label,
  value,
  options,
  onValueChange,
}: {
  /** Names the group for screen readers. */
  label: string;
  /** The picked option, or null before the person picks. */
  value: T | null;
  options: LumenChoiceOption<T>[];
  onValueChange: (v: T) => void;
}) {
  return (
    <fieldset aria-label={label} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
      {options.map(({ value: v, icon: Icon, title, description, disabled }) => {
        const picked = v === value;
        return (
          <Item
            key={v}
            asChild
            variant="outline"
            className={picked ? 'border-primary bg-primary/5' : 'disabled:opacity-50'}
          >
            <button
              type="button"
              aria-pressed={picked}
              disabled={disabled}
              onClick={() => onValueChange(v)}
            >
              <ItemMedia variant="icon">
                <Icon className={picked ? 'text-primary' : undefined} />
              </ItemMedia>
              <ItemContent className="text-left">
                <ItemTitle>{title}</ItemTitle>
                {description && <ItemDescription>{description}</ItemDescription>}
              </ItemContent>
              {picked && <Check className="size-5 shrink-0 text-primary" />}
            </button>
          </Item>
        );
      })}
    </fieldset>
  );
}
