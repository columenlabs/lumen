import { HoverCard as HoverCardPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from '../lib/utils';

function HoverCard({ ...props }: React.ComponentProps<typeof HoverCardPrimitive.Root>) {
  return <HoverCardPrimitive.Root data-slot="hover-card" {...props} />;
}

// Keyboard users reach a hover card by Tab, so its trigger shows the focus ring like a button.
function HoverCardTrigger({ className, ...props }: React.ComponentProps<typeof HoverCardPrimitive.Trigger>) {
  return (
    <HoverCardPrimitive.Trigger
      data-slot="hover-card-trigger"
      className={cn('rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50', className)}
      {...props}
    />
  );
}

function HoverCardContent({
  className,
  align = 'center',
  sideOffset = 4,
  collisionPadding = 8,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Content>) {
  return (
    <HoverCardPrimitive.Portal data-slot="hover-card-portal">
      <HoverCardPrimitive.Content
        data-slot="hover-card-content"
        align={align}
        sideOffset={sideOffset}
        // Never flush against (or past) the screen's edge on a phone.
        collisionPadding={collisionPadding}
        className={cn(
          'bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/10 z-[70] w-72 origin-(--radix-hover-card-content-transform-origin) rounded-lg p-3 text-sm shadow-md ring-1 outline-hidden duration-100',
          className,
        )}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  );
}

export { HoverCard, HoverCardTrigger, HoverCardContent };
