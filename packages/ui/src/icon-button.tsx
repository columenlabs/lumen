// The shell's one button: icon only, its name in a tooltip and accessible name.
import { Link } from '@tanstack/react-router';
import type { ComponentProps, ComponentType } from 'react';
import { cn } from './lib/utils';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

export type IconButtonProps = Omit<ComponentProps<typeof Button>, 'size' | 'children'> & {
  /** A lucide icon, or any icon component that takes `className` (a view's own icon). */
  icon: ComponentType<{ className?: string }>;
  /** `icon-sm` (headers, toolbars) by default; `icon-xs` in table rows and chips, `icon` in forms. */
  size?: 'icon-xs' | 'icon-sm' | 'icon' | 'icon-lg';
  /** The action's name: the tooltip and the accessible name. */
  label: string;
  /** Opens this route instead of running `onClick`. */
  to?: string;
  /** Opens this outside address in a new tab instead of running `onClick`. */
  href?: string;
  /** Spins the icon while the action runs. */
  busy?: boolean;
  /** A toggle that is on (pinned, followed): its icon fills in the app colour. */
  pressed?: boolean;
};

/**
 * Every button: icon only, its name in a tooltip and accessible name, never
 * text. Headers use it as is; rows, toolbars and forms too. Works as the child of a `DialogTrigger`, `PopoverTrigger` or `DropdownMenuTrigger` (`asChild`).
 */
/** Layout classes that place the button among its siblings, not style it. */
const PLACE =
  /^(?:[a-z0-9-]+:)*-?(?:m[trblxy]?-|self-|order-|shrink|grow|sticky|left-|align-|hidden$|block$)/;

export function IconButton({
  icon: Icon,
  label,
  to,
  href,
  busy,
  pressed,
  variant = 'ghost',
  size = 'icon-sm',
  disabled,
  className,
  ...props
}: IconButtonProps) {
  // Disabled, the button sits in a tooltip wrapper: its place in the layout (margins, self, sticky,
  // visibility) moves to the wrapper so nothing shifts while it is disabled.
  const place = disabled ? (className ?? '').split(/\s+/).filter((c) => PLACE.test(c)) : [];
  const own = disabled ? (className ?? '').split(/\s+/).filter((c) => !PLACE.test(c)) : [];
  const icon = (
    <Icon className={cn(busy && 'animate-spin', pressed && 'fill-current text-primary')} />
  );
  const link = !disabled && (to || href);
  const button = (
    <Button
      variant={variant}
      size={size}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      asChild={!!link}
      className={disabled ? cn(own) : className}
      {...props}
    >
      {!link ? (
        icon
      ) : to ? (
        <Link to={to}>{icon}</Link>
      ) : (
        <a href={href} target="_blank" rel="noreferrer">
          {icon}
        </a>
      )}
    </Button>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* A disabled button gets no pointer events, so its tooltip hangs on a wrapper. */}
        {disabled ? <span className={cn('inline-flex', place)}>{button}</span> : button}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
