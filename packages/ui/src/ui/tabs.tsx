import { cn } from '../lib/utils';
import { Tabs as TabsPrimitive } from 'radix-ui';
import type * as React from 'react';

// One tab look on every desk: the open tab is underlined in the desk colour, so
// tabs read as navigation and the segmented ToggleGroups under them stay controls. No hairline across
// the row (option A): it cut across glass's wash and stopped short of the row's
// actions. Many tabs scroll sideways on a phone. Compact: little
// padding above and below, so a tab row costs one line and its text sits the gutter below the
// header, as the page sits from the sidebar ("too much space").

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn('flex flex-col gap-2', className)}
      {...props}
    />
  );
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        'inline-flex w-full items-center justify-start gap-6 overflow-x-auto overflow-y-hidden text-muted-foreground [scrollbar-width:none]',
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex shrink-0 items-center gap-1.5 px-0 pt-0 pb-2 after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent text-sm leading-4 font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:rounded-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:text-foreground data-[state=active]:after:bg-primary data-[state=active]:[&_svg]:text-primary [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('flex-1 outline-none', className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
