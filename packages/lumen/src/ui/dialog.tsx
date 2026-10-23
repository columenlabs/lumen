import { cn } from '../lib/utils';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type * as React from 'react';

import { Button } from './button';
import { XIcon } from 'lucide-react';
import { usePhoneScreen } from '../hooks/use-keyboard-fit';

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
}) {
  // On a phone it is a full screen pinned to the top, its footer a bar at the top (usePhoneScreen).
  const style = usePhoneScreen(props.style);
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-(--dialog-pad) text-sm [--dialog-pad:--spacing(4)] text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm max-md:inset-0 max-md:h-full max-md:max-h-none max-md:w-full max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:content-start max-md:overflow-y-auto max-md:rounded-none max-md:pt-[calc(var(--dialog-pad)+env(safe-area-inset-top))] max-md:ring-0 max-md:end-fade max-md:[--end-fade:var(--dialog-pad)] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
          className,
        )}
        {...props}
        style={style}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-2 right-2 max-md:top-[calc(1.25rem+env(safe-area-inset-top))]"
              size="icon-sm"
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="dialog-header" className={cn('flex flex-col gap-2', className)} {...props} />
  );
}

/** A dialog's scrolling part: it reaches the dialog's edges, so its scroll bar sits on the frame and
 *  the focus rings of its fields are never cut by the scroll box. It and the
 *  footer bleed by `--dialog-pad`, the content's padding, so a dialog that changes its padding sets
 *  that variable (`[--dialog-pad:0px]`), never `p-0`, and they still meet its edges. */
const dialogBody =
  '-mx-(--dialog-pad) max-h-[60svh] min-h-0 overflow-y-auto px-(--dialog-pad) max-md:max-h-none max-md:overflow-visible';

/** With no footer under it the body reaches the dialog's bottom edge and fades into it (`end-fade`). */
function DialogBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-body"
      className={cn(
        dialogBody,
        'last:-mb-(--dialog-pad) last:pb-(--dialog-pad) last:end-fade last:[--end-fade:var(--dialog-pad)]',
        className,
      )}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        '-mx-(--dialog-pad) -mb-(--dialog-pad) flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end max-md:order-first max-md:-mt-(--dialog-pad) max-md:mb-0 max-md:flex-row max-md:justify-end max-md:rounded-none max-md:border-t-0 max-md:border-b max-md:pr-12',
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('font-heading text-base leading-none font-medium', className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        'text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground',
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  dialogBody,
};
