import { XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useIsMobile } from './hooks/use-mobile';
import { IconButton } from './icon-button';
import { Button } from './ui/button';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './ui/resizable';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from './ui/sheet';

/** A drawer's width on desktop, as the resizable panel takes it ("32%", "320px"). */
type Size = `${number}%` | `${number}px`;

export interface LumenDrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** A muted line under the title ("Active · invited Oct 16"); read aloud only when left out. */
  description?: ReactNode;
  /** Stacked DrawerSections; the drawer pads and scrolls them. */
  children: ReactNode;
  /** The footer's actions, right-aligned (a destructive action, Cancel and Save); Close when left out. */
  footer?: ReactNode;
  /** Left side of the footer: a count or status line ("12 releases"). */
  footerStart?: ReactNode;
  /** Width on desktop: starts at `defaultSize`, drags between `minSize` and `maxSize`. */
  defaultSize?: Size;
  minSize?: Size;
  maxSize?: Size;
}

/**
 * The suite's one pullout drawer (named LumenDrawer), on every app.
 * Phone: a bottom sheet. Desktop: a right-side panel over the page whose width drags at its left
 * edge, 320px to 60% by default. The sheet spans the screen so the resizable group has room; only
 * the handle and the drawer take the pointer, so a click beside it falls through to the overlay
 * and closes it (`!` beats the inline pointer-events Radix sets on a modal's content). Its body
 * holds DrawerSections; its footer sits at the bottom (actions on the right, Close by default; on a
 * phone it shows only when there are actions, as the sheet's X closes it).
 */
export function LumenDrawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  footerStart,
  defaultSize = '32%',
  minSize = '320px',
  maxSize = '60%',
}: LumenDrawerProps) {
  const isMobile = useIsMobile();
  const head = (
    <div className="flex min-w-0 flex-col gap-0.5">
      <SheetTitle className="truncate">{title}</SheetTitle>
      <SheetDescription
        className={description ? 'truncate text-muted-foreground text-xs' : 'sr-only'}
      >
        {description ?? 'Details'}
      </SheetDescription>
    </div>
  );
  const body = <div className="flex flex-col px-4 pb-4">{children}</div>;
  // Every drawer ends on a footer, styled like a dialog's: the body scrolls above it and always
  // ends on a clear edge. Without actions of its own it offers Close, except on a phone, where the
  // sheet's X already closes it and a second Close only took room.
  const plain = !footer && !footerStart;
  const foot = (
    <footer
      data-slot="drawer-footer"
      className="flex shrink-0 items-center gap-2 border-t bg-muted/50 px-4 py-2.5"
    >
      {footerStart && (
        <div className="min-w-0 flex-1 truncate text-muted-foreground text-xs">{footerStart}</div>
      )}
      <div className="ml-auto flex items-center gap-2">
        {footer ?? (
          <SheetClose asChild>
            <Button type="button" size="sm" variant="outline">
              Close
            </Button>
          </SheetClose>
        )}
      </div>
    </footer>
  );
  return (
    // Not modal on desktop: the assistant, docked beside it, stays usable while the drawer is open.
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} modal={isMobile}>
      {isMobile ? (
        <SheetContent side="bottom" className="max-h-[85svh] gap-0 overflow-hidden">
          <SheetHeader className="order-first shrink-0 border-b">{head}</SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto pt-2">{body}</div>
          {!plain && foot}
        </SheetContent>
      ) : (
        <SheetContent
          side="right"
          showCloseButton={false}
          // The resize handle's grab zone is wider than the handle, so a drag can start on the
          // overlay; the panels library marks that pointerdown handled, and then it doesn't close.
          onPointerDownOutside={(e) =>
            e.detail.originalEvent.defaultPrevented && e.preventDefault()
          }
          className="pointer-events-none! gap-0 border-0 bg-transparent shadow-none data-[side=right]:left-0 data-[side=right]:w-auto data-[side=right]:border-l-0 data-[side=right]:sm:max-w-none"
        >
          <ResizablePanelGroup orientation="horizontal">
            <ResizablePanel minSize="40%" />
            <ResizableHandle withHandle className="pointer-events-auto" />
            <ResizablePanel
              defaultSize={defaultSize}
              minSize={minSize}
              maxSize={maxSize}
              data-slot="lumen-drawer"
              className="pointer-events-auto bg-popover shadow-lg"
            >
              <section className="flex h-full flex-col overflow-hidden">
                <header className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
                  {head}
                  <SheetClose asChild>
                    <IconButton icon={XIcon} label="Close" className="ml-auto" />
                  </SheetClose>
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto pt-2">{body}</div>
                {foot}
              </section>
            </ResizablePanel>
          </ResizablePanelGroup>
        </SheetContent>
      )}
    </Sheet>
  );
}
