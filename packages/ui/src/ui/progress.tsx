import { Progress as ProgressPrimitive } from 'radix-ui';
import type * as React from 'react';

import { cn } from '../lib/utils';

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn('relative h-1 w-full overflow-hidden rounded-full bg-muted', className)}
      value={value}
      {...props}
    >
      {/* No value: indeterminate, a short segment sliding across (the shell's loading bar). */}
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          'h-full flex-1 bg-primary',
          value == null
            ? 'w-2/5 animate-[edge-progress_1.1s_linear_infinite] motion-reduce:animate-none'
            : 'w-full transition-all',
        )}
        style={value == null ? undefined : { transform: `translateX(-${100 - value}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
